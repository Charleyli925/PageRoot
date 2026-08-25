import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  access,
  chmod,
  constants as fsConstants,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  symlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

import { terminateManagedProcess } from "../hosts/execution-host.mjs";
import { macosAgentSandboxProfile } from "../sandbox/macos-agent-sandbox.mjs";
import {
  disposeCodexExecutionWorkspace,
  prepareCodexExecutionWorkspace,
  publishCodexExecutionOutput,
} from "../native/codex-workspace.mjs";
import { runAcpTask } from "../../qoder-acp-client.mjs";

const MAX_ACP_FRAME_BYTES = 4 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 16 * 1024;
const SAFE_ENVIRONMENT_NAMES = Object.freeze(new Set([
  "CODEX_HOME",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOGNAME",
  "NO_COLOR",
  "PATH",
  "SHELL",
  "TERM",
  "TMPDIR",
  "USER",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
]));
const VERIFIED_ESM_LOADER_SOURCE = `
import { readFileSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";

const identifier = pathToFileURL(process.argv[1]).href;
const require = createRequire(identifier);
const builtins = new Set(builtinModules.map((name) => name.replace(/^node:/u, "")));
const resolveSpecifier = (specifier) => {
  if (specifier.startsWith("node:")) return specifier;
  if (builtins.has(specifier)) return "node:" + specifier;
  if (/^[a-zA-Z][a-zA-Z+.-]*:/u.test(specifier)) return specifier;
  if (specifier.startsWith(".") || specifier.startsWith("/")) {
    return new URL(specifier, identifier).href;
  }
  return pathToFileURL(require.resolve(specifier)).href;
};
const externalModules = new Map();
const linkExternal = async (specifier) => {
  const resolved = resolveSpecifier(specifier);
  if (!externalModules.has(resolved)) {
    externalModules.set(resolved, import(resolved).then((namespace) => {
      const names = Object.keys(namespace);
      return new SyntheticModule(names, function initialize() {
        for (const name of names) this.setExport(name, namespace[name]);
      }, { identifier: resolved });
    }));
  }
  return externalModules.get(resolved);
};
const module = new SourceTextModule(readFileSync(3, "utf8"), {
  identifier,
  initializeImportMeta(meta) {
    meta.url = identifier;
    meta.filename = fileURLToPath(identifier);
    meta.dirname = dirname(meta.filename);
    meta.resolve = (specifier) => resolveSpecifier(specifier);
  },
  importModuleDynamically: async (specifier) => {
    const dependency = await linkExternal(specifier);
    if (dependency.status === "unlinked") await dependency.link(() => {});
    if (dependency.status === "linked") await dependency.evaluate();
    return dependency;
  },
});
await module.link(linkExternal);
await module.evaluate();
`;

function runtimeError(code, message, details) {
  const error = new Error(message);
  error.name = "AgentNativeAcpError";
  error.code = code;
  if (details) error.details = details;
  return error;
}

function sameIdentity(actual, expected) {
  return actual.dev === expected.dev
    && actual.ino === expected.ino
    && actual.nlink === expected.nlink
    && actual.size === expected.size
    && actual.mtimeMs === expected.mtimeMs;
}

async function readHandleBytes(handle, size) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw runtimeError("CODEX_ADAPTER_UNTRUSTED", "The pinned Codex ACP adapter size is invalid.");
  }
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  while (offset < size) {
    const result = await handle.read(bytes, offset, size - offset, offset);
    if (result.bytesRead === 0) break;
    offset += result.bytesRead;
  }
  return bytes.subarray(0, offset);
}

async function openVerifiedAdapter(filePath, expectedIdentity) {
  const resolved = await realpath(filePath).catch(() => {
    throw runtimeError("CODEX_ADAPTER_UNTRUSTED", "The pinned Codex ACP adapter is unavailable.");
  });
  if (resolved !== filePath) {
    throw runtimeError("CODEX_ADAPTER_UNTRUSTED", "The pinned Codex ACP adapter path changed.");
  }
  const handle = await open(resolved, "r");
  try {
    const information = await handle.stat();
    if (!information.isFile() || information.isSymbolicLink?.()
      || information.nlink !== 1 || (information.mode & 0o022) !== 0
      || !sameIdentity(information, expectedIdentity)) {
      throw runtimeError("CODEX_ADAPTER_UNTRUSTED", "The pinned Codex ACP adapter identity changed.");
    }
    const bytes = await readHandleBytes(handle, information.size);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== expectedIdentity.sha256) {
      throw runtimeError("CODEX_ADAPTER_UNTRUSTED", "The pinned Codex ACP adapter bytes changed.");
    }
    return handle;
  } catch (cause) {
    await handle.close().catch(() => {});
    throw cause;
  }
}

async function assertCodexBinary(filePath, expectedIdentity) {
  const resolved = await realpath(filePath).catch(() => {
    throw runtimeError("CODEX_INNER_UNAVAILABLE", "The pinned Codex App Server is unavailable.");
  });
  if (resolved !== filePath) {
    throw runtimeError("CODEX_INNER_INCOMPATIBLE", "The pinned Codex binary path changed.");
  }
  const information = await lstat(resolved);
  if (!information.isFile() || information.isSymbolicLink()
    || information.nlink !== 1 || (information.mode & 0o022) !== 0
    || !sameIdentity(information, expectedIdentity)) {
    throw runtimeError("CODEX_INNER_INCOMPATIBLE", "The pinned Codex binary identity changed.");
  }
  await access(resolved, fsConstants.X_OK).catch(() => {
    throw runtimeError("CODEX_INNER_INCOMPATIBLE", "The pinned Codex binary is not executable.");
  });
  return resolved;
}

async function assertCodeModeHost(filePath, expectedIdentity) {
  if (!filePath || !expectedIdentity) {
    throw runtimeError(
      "CODEX_INNER_INCOMPATIBLE",
      "The pinned Codex code-mode host identity is unavailable.",
    );
  }
  return assertCodexBinary(filePath, expectedIdentity);
}

export function codexAcpEnvironment({
  baseEnvironment = process.env,
  codexBinary,
  mode = "read-only",
  config = {},
} = {}) {
  const environment = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (typeof baseEnvironment?.[name] === "string") environment[name] = baseEnvironment[name];
  }
  environment.NO_COLOR = "1";
  environment.CODEX_PATH = codexBinary;
  environment.INITIAL_AGENT_MODE = mode;
  environment.CODEX_CONFIG = JSON.stringify(config);
  if (process.versions.electron) environment.ELECTRON_RUN_AS_NODE = "1";
  return environment;
}

class AcpFrameGuard extends Transform {
  #decoder = new TextDecoder("utf-8", { fatal: true });
  #frameBytes = 0;

  _transform(chunk, _encoding, callback) {
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      this.#decoder.decode(bytes, { stream: true });
      let offset = 0;
      for (;;) {
        const newline = bytes.indexOf(0x0a, offset);
        if (newline < 0) break;
        this.#frameBytes += newline - offset;
        if (this.#frameBytes > MAX_ACP_FRAME_BYTES) {
          throw runtimeError("CODEX_ACP_FRAME_TOO_LARGE", "Codex emitted an oversized ACP frame.");
        }
        this.#frameBytes = 0;
        offset = newline + 1;
      }
      this.#frameBytes += bytes.byteLength - offset;
      if (this.#frameBytes > MAX_ACP_FRAME_BYTES) {
        throw runtimeError("CODEX_ACP_FRAME_TOO_LARGE", "Codex emitted an oversized ACP frame.");
      }
      callback(null, bytes);
    } catch (cause) {
      callback(String(cause?.code || "").startsWith("CODEX_")
        ? cause
        : runtimeError("CODEX_ACP_UTF8_INVALID", "Codex emitted invalid UTF-8 over ACP."));
    }
  }

  _flush(callback) {
    try {
      this.#decoder.decode();
      callback();
    } catch {
      callback(runtimeError("CODEX_ACP_UTF8_INVALID", "Codex emitted invalid UTF-8 over ACP."));
    }
  }
}

function boundedDiagnostic() {
  let bytes = 0;
  let digest = createHash("sha256");
  let truncated = false;
  return {
    append(chunk) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const remaining = MAX_DIAGNOSTIC_BYTES - bytes;
      if (remaining > 0) {
        const kept = value.subarray(0, remaining);
        digest.update(kept);
        bytes += kept.byteLength;
      }
      truncated ||= value.byteLength > remaining;
    },
    snapshot() {
      return Object.freeze({
        byteLength: bytes,
        sha256: digest.digest("hex"),
        truncated,
      });
    },
  };
}

export async function withAgentNativeAcpProcess(launch, operation) {
  if (!launch || typeof launch !== "object" || Array.isArray(launch)
    || typeof operation !== "function") {
    throw new TypeError("Agent-native ACP launch and operation are required.");
  }
  const adapterHandle = await openVerifiedAdapter(
    launch.adapterEntry,
    launch.adapterEntryIdentity,
  );
  const codexBinary = await assertCodexBinary(launch.codexBinary, launch.codexBinaryIdentity);
  if (launch.purpose === "execution") {
    await assertCodeModeHost(launch.codeModeHost, launch.codeModeHostIdentity);
  }
  const runtime = await realpath(process.execPath);
  const adapterArgs = Array.isArray(launch.adapterArgs)
    && launch.adapterArgs.length <= 16
    && launch.adapterArgs.every((value) => typeof value === "string" && value.length <= 1_024)
    ? launch.adapterArgs
    : [];
  const processGroup = process.platform !== "win32";
  const diagnostic = boundedDiagnostic();
  let child;
  const runtimeArguments = [
      "--no-warnings",
      "--experimental-vm-modules",
      "--input-type=module",
      "--eval",
      VERIFIED_ESM_LOADER_SOURCE,
      "--",
      launch.adapterEntry,
      ...adapterArgs,
    ];
  const sandboxed = typeof launch.sandboxProfile === "string";
  const executable = sandboxed ? "/usr/bin/sandbox-exec" : runtime;
  const spawnArguments = sandboxed
    ? ["-p", launch.sandboxProfile, runtime, ...runtimeArguments]
    : runtimeArguments;
  try {
    child = spawn(executable, spawnArguments, {
      cwd: launch.cwd,
      env: codexAcpEnvironment({
        baseEnvironment: launch.baseEnvironment,
        codexBinary,
        mode: launch.mode,
        config: launch.codexConfig,
      }),
      detached: processGroup,
      shell: false,
      stdio: ["pipe", "pipe", "pipe", adapterHandle.fd],
    });
  } finally {
    await adapterHandle.close().catch(() => {});
  }
  child.stderr?.on("data", (chunk) => diagnostic.append(chunk));
  child.stdin?.on("error", () => {});
  const guardedStdout = child.stdout.pipe(new AcpFrameGuard());
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(guardedStdout),
  );
  let operationError = null;
  try {
    return await operation({ stream, child });
  } catch (cause) {
    operationError = cause instanceof Error ? cause : new Error(String(cause));
    if (!operationError.code && operationError.message === "ACP connection closed") {
      operationError.code = "CODEX_ACP_CONNECTION_CLOSED";
    }
    throw operationError;
  } finally {
    child.stdin?.end();
    const cleanupConfirmed = await terminateManagedProcess(child, { processGroup }).catch(() => false);
    if (!cleanupConfirmed) {
      const cleanup = runtimeError(
        "AGENT_PROCESS_CLEANUP_UNCONFIRMED",
        "The Codex ACP process group could not be confirmed stopped.",
        { diagnostic: diagnostic.snapshot() },
      );
      if (operationError) cleanup.cause = operationError;
      throw cleanup;
    }
  }
}

async function existingAuthFile(baseEnvironment) {
  const codexHome = baseEnvironment?.CODEX_HOME
    || (baseEnvironment?.HOME ? path.join(baseEnvironment.HOME, ".codex") : null);
  if (!codexHome) return null;
  const candidate = path.join(codexHome, "auth.json");
  const information = await lstat(candidate).catch(() => null);
  return information?.isFile() && !information.isSymbolicLink()
    ? realpath(candidate)
    : null;
}

async function prepareDiscussionIsolation(launch) {
  if (process.platform !== "darwin") {
    throw runtimeError(
      "CODEX_SANDBOX_PLATFORM_UNSUPPORTED",
      "Codex Discussion requires the pinned macOS sandbox boundary.",
    );
  }
  const policy = launch.policy;
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-turn-")));
  const contextRoot = path.join(root, "context");
  const stateRoot = path.join(root, "state");
  const codexHome = path.join(stateRoot, "codex-home");
  const temporaryRoot = path.join(stateRoot, "tmp");
  const homeRoot = path.join(stateRoot, "home");
  await Promise.all([
    mkdir(contextRoot, { mode: 0o700 }),
    mkdir(codexHome, { recursive: true, mode: 0o700 }),
    mkdir(temporaryRoot, { recursive: true, mode: 0o700 }),
    mkdir(homeRoot, { recursive: true, mode: 0o700 }),
  ]);
  const copiedFiles = [];
  let snapshotText = null;
  try {
    for (const readable of policy.readableFiles) {
      const name = path.basename(readable.path);
      const target = path.join(contextRoot, name);
      const before = await readFile(readable.path);
      if (`sha256:${createHash("sha256").update(before).digest("hex")}` !== readable.sha256) {
        throw runtimeError("CODEX_DISCUSSION_INPUT_DRIFT", "The discussion input changed before sandboxing.");
      }
      await copyFile(readable.path, target, fsConstants.COPYFILE_EXCL);
      await chmod(target, 0o400);
      copiedFiles.push(Object.freeze({ ...readable, path: target }));
      if (readable.role === "discussion-snapshot") snapshotText = before.toString("utf8");
    }
    await chmod(contextRoot, 0o500);
    const authFile = await existingAuthFile(launch.baseEnvironment);
    if (authFile) await symlink(authFile, path.join(codexHome, "auth.json"));
    const packageRoot = path.resolve(path.dirname(launch.adapterEntry), "..", "..", "..");
    const sandboxProfile = macosAgentSandboxProfile({
      runtime: await realpath(process.execPath),
      codexBinary: launch.codexBinary,
      packageRoot,
      contextRoot,
      stateRoot,
      authFile,
    });
    const isolatedPolicy = Object.freeze({
      ...policy,
      requestRoot: contextRoot,
      snapshotPath: path.join(contextRoot, path.basename(policy.snapshotPath)),
      promptPath: path.join(contextRoot, path.basename(policy.promptPath)),
      readableFiles: Object.freeze(copiedFiles),
    });
    if (snapshotText === null) {
      throw runtimeError(
        "CODEX_DISCUSSION_INPUT_MISSING",
        "The Codex discussion snapshot is unavailable.",
      );
    }
    const inlinePrompt = [
      launch.prompt,
      "",
      "For this sandboxed Codex turn, the exact read-only snapshot is inlined below.",
      "Do not invoke a command, file, network, MCP, skill, plugin, app, or subagent tool.",
      `Snapshot SHA-256: ${policy.sourceSha256}`,
      `Snapshot UTF-8 byte length: ${Buffer.byteLength(snapshotText, "utf8")}`,
      "<stemmio-read-only-snapshot>",
      snapshotText,
      "</stemmio-read-only-snapshot>",
    ].join("\n");
    if (Buffer.byteLength(inlinePrompt, "utf8") > 256 * 1024) {
      throw runtimeError(
        "CODEX_DISCUSSION_CONTEXT_TOO_LARGE",
        "The current page is too large for a command-free Codex discussion turn.",
      );
    }
    return Object.freeze({
      root,
      launch: Object.freeze({
        ...launch,
        cwd: contextRoot,
        policy: isolatedPolicy,
        prompt: inlinePrompt,
        sandboxProfile,
        baseEnvironment: Object.freeze({
          ...(launch.baseEnvironment || {}),
          HOME: homeRoot,
          CODEX_HOME: codexHome,
          TMPDIR: temporaryRoot,
          XDG_CACHE_HOME: path.join(stateRoot, "cache"),
          XDG_CONFIG_HOME: path.join(stateRoot, "config"),
          XDG_DATA_HOME: path.join(stateRoot, "data"),
        }),
      }),
    });
  } catch (cause) {
    await chmod(contextRoot, 0o700).catch(() => {});
    await rm(root, { recursive: true, force: true });
    throw cause;
  }
}

export async function runAgentNativeAcp(launch) {
  if (launch.securityProfile !== "agent-native") {
    throw new TypeError("Agent-native ACP runner requires the agent-native security profile.");
  }
  if (launch.purpose !== "discussion" && launch.purpose !== "execution") {
    throw runtimeError(
      "AGENT_CAPABILITY_UNSUPPORTED",
      "The requested Codex operation is unsupported.",
    );
  }
  if (launch.purpose === "execution") {
    const workspace = await prepareCodexExecutionWorkspace(launch);
    try {
      const result = await withAgentNativeAcpProcess(workspace.launch, ({ stream }) => runAcpTask({
        connection: stream,
        policy: workspace.launch.policy,
        prompt: workspace.launch.prompt,
        onEvent: workspace.launch.onEvent,
        cancellationSignal: workspace.launch.cancellationSignal,
        expectedAgentName: /codex/iu,
        sessionConfigOptions: workspace.launch.sessionConfigOptions,
        completionAuthority: "bridge",
        sessionCwd: workspace.launch.cwd,
        ...(workspace.launch.startupTimeoutMs
          ? { startupTimeoutMs: workspace.launch.startupTimeoutMs }
          : {}),
        ...(workspace.launch.turnTimeoutMs
          ? { turnTimeoutMs: workspace.launch.turnTimeoutMs }
          : {}),
      }));
      const published = await publishCodexExecutionOutput({
        workspace,
        policy: launch.policy,
        cancellationSignal: launch.cancellationSignal,
      });
      return Object.freeze({ ...result, completion: published });
    } finally {
      await disposeCodexExecutionWorkspace(workspace);
    }
  }
  const isolated = await prepareDiscussionIsolation(launch);
  try {
    return await withAgentNativeAcpProcess(isolated.launch, ({ stream }) => runAcpTask({
      connection: stream,
      policy: isolated.launch.policy,
      prompt: isolated.launch.prompt,
      onEvent: isolated.launch.onEvent,
      cancellationSignal: isolated.launch.cancellationSignal,
      expectedAgentName: /codex/iu,
      sessionConfigOptions: isolated.launch.sessionConfigOptions,
      ...(isolated.launch.startupTimeoutMs
        ? { startupTimeoutMs: isolated.launch.startupTimeoutMs }
        : {}),
      ...(isolated.launch.turnTimeoutMs ? { turnTimeoutMs: isolated.launch.turnTimeoutMs } : {}),
    }));
  } finally {
    await chmod(path.join(isolated.root, "context"), 0o700).catch(() => {});
    await rm(isolated.root, { recursive: true, force: true });
  }
}
