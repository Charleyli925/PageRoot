import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { access, constants as fsConstants, lstat, open, realpath } from "node:fs/promises";
import { Readable, Transform, Writable } from "node:stream";

import * as acp from "@agentclientprotocol/sdk";

import { terminateManagedProcess } from "../hosts/execution-host.mjs";
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
  const runtime = await realpath(process.execPath);
  const adapterArgs = Array.isArray(launch.adapterArgs)
    && launch.adapterArgs.length <= 16
    && launch.adapterArgs.every((value) => typeof value === "string" && value.length <= 1_024)
    ? launch.adapterArgs
    : [];
  const processGroup = process.platform !== "win32";
  const diagnostic = boundedDiagnostic();
  let child;
  try {
    child = spawn(runtime, [
      "--no-warnings",
      "--experimental-vm-modules",
      "--input-type=module",
      "--eval",
      VERIFIED_ESM_LOADER_SOURCE,
      "--",
      launch.adapterEntry,
      ...adapterArgs,
    ], {
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

export async function runAgentNativeAcp(launch) {
  if (launch.securityProfile !== "agent-native") {
    throw new TypeError("Agent-native ACP runner requires the agent-native security profile.");
  }
  if (launch.purpose !== "discussion") {
    throw runtimeError(
      "AGENT_CAPABILITY_UNSUPPORTED",
      "Codex execution is disabled until the native sandbox authority gate passes.",
    );
  }
  return withAgentNativeAcpProcess(launch, ({ stream }) => runAcpTask({
    connection: stream,
    policy: launch.policy,
    prompt: launch.prompt,
    onEvent: launch.onEvent,
    cancellationSignal: launch.cancellationSignal,
    expectedAgentName: /codex/iu,
    ...(launch.startupTimeoutMs ? { startupTimeoutMs: launch.startupTimeoutMs } : {}),
    ...(launch.turnTimeoutMs ? { turnTimeoutMs: launch.turnTimeoutMs } : {}),
  }));
}
