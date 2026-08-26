import {
  access,
  constants as fsConstants,
  lstat,
  open,
  realpath,
} from "node:fs/promises";
import { spawn } from "node:child_process";
import { Readable, Transform, Writable } from "node:stream";
import path from "node:path";

import * as acp from "@agentclientprotocol/sdk";

import { sha256 } from "./lifecycle-core.mjs";
import {
  AGENT_POLICY_BRAND,
  MAX_HTML_BYTES,
  MAX_PROMPT_BYTES,
  assertAbsolutePath,
  assertObject,
  loadExecutionPolicy,
  readVerifiedRegularFile,
} from "./agent/policies/execution-policy.mjs";
import {
  createExecutionHost,
  terminateManagedProcess,
} from "./agent/hosts/execution-host.mjs";

const DEFAULT_STARTUP_TIMEOUT_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;
const MAX_SESSION_UPDATES = 512;
const PROCESS_PROTOCOL_DRAIN_MS = 250;
const MAX_ACP_FRAME_BYTES = MAX_HTML_BYTES + (2 * 1024 * 1024);
const SAFE_QODER_ENVIRONMENT_NAMES = Object.freeze(new Set([
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
const processClosePromises = new WeakMap();
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

const LEGACY_COMMON_MESSAGES = Object.freeze({
  RUNTIME_AUTHORITY_DRIFT: "PageRoot no longer authorizes mutations for this ACP Attempt.",
  INPUT_MANIFEST_SHAPE_MISMATCH:
    "The Qoder ACP driver only accepts PageRoot's exact current frozen input manifest shape.",
  OUTPUT_PREEXISTS: "The Qoder ACP driver requires a fresh Attempt output path.",
  COMPLETION_PREEXISTS: "The Qoder ACP driver requires a fresh Attempt completion path.",
  READ_NOT_AUTHORIZED_EXECUTION: "Qoder requested a file outside the frozen read set.",
  WRITE_NOT_AUTHORIZED: "Qoder may only write the exact Candidate output path.",
});

function policyError(code, message, details = {}) {
  const error = new Error(message);
  error.name = "QoderAcpPolicyError";
  error.code = code;
  error.details = details;
  return error;
}

function legacyCommonMessage(cause) {
  const suffix = String(cause.code || "").replace(/^AGENT_/u, "");
  if (suffix === "READ_NOT_AUTHORIZED") {
    return LEGACY_COMMON_MESSAGES.READ_NOT_AUTHORIZED_EXECUTION;
  }
  const exact = LEGACY_COMMON_MESSAGES[suffix];
  if (exact) return exact;
  return String(cause.message || "")
    .replace(/^Agent execution policy options/u, "ACP task policy options")
    .replaceAll("The Agent", "The ACP")
    .replaceAll("Agent line", "ACP line")
    .replaceAll("Agent limit", "ACP limit")
    .replaceAll("Agent session", "ACP session")
    .replaceAll("Agent read", "ACP read")
    .replaceAll("Agent turn", "ACP turn");
}

function adaptLegacyCommonError(cause) {
  if (!(cause instanceof Error)) return cause;
  if (cause.name === "AgentPolicyError" && /^AGENT_[A-Z0-9_]+$/u.test(cause.code)) {
    const suffix = cause.code.slice("AGENT_".length);
    const message = legacyCommonMessage(cause);
    cause.name = "QoderAcpPolicyError";
    cause.code = `ACP_${suffix}`;
    cause.message = message;
    return cause;
  }
  if (cause instanceof TypeError) {
    cause.message = String(cause.message)
      .replace(/^Agent execution policy options/u, "ACP task policy options")
      .replace(
        /^Restricted execution host requires a verified PageRoot task policy\.$/u,
        "Restricted ACP host requires a verified PageRoot task policy.",
      )
      .replace(
        /^Restricted execution host dependencies are invalid\.$/u,
        "Restricted ACP host dependencies are invalid.",
      )
      .replaceAll("agent/read_text_file path", "fs/read_text_file path")
      .replaceAll("agent/write_text_file path", "fs/write_text_file path");
  }
  return cause;
}

async function loadLegacyPolicy(loader, options) {
  try {
    return await loader(options);
  } catch (cause) {
    throw adaptLegacyCommonError(cause);
  }
}

function adaptLegacyHost(host) {
  return Object.fromEntries(Object.entries(host).map(([name, value]) => {
    if (typeof value !== "function") return [name, value];
    return [name, function legacyHostMethod(...args) {
      try {
        const result = value.apply(host, args);
        return result && typeof result.then === "function"
          ? result.catch((cause) => { throw adaptLegacyCommonError(cause); })
          : result;
      } catch (cause) {
        throw adaptLegacyCommonError(cause);
      }
    }];
  }));
}

export function loadQoderAcpTaskPolicy(options) {
  return loadLegacyPolicy(loadExecutionPolicy, options);
}

export function createRestrictedQoderAcpHost(policy, dependencies) {
  try {
    return adaptLegacyHost(createExecutionHost(policy, dependencies));
  } catch (cause) {
    throw adaptLegacyCommonError(cause);
  }
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size;
}

function sameExecutableIdentity(left, right) {
  return Boolean(
    left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.nlink === right.nlink
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.sha256 === right.sha256,
  );
}

async function readHandleAtStart(handle, size) {
  if (!Number.isSafeInteger(size) || size < 0) {
    throw policyError(
      "ACP_AGENT_EXECUTABLE_CHANGED",
      "The ACP Agent executable size is invalid.",
    );
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

async function openVerifiedAgentExecutable(executable, expectedExecutable) {
  const expectedPath = assertAbsolutePath(expectedExecutable?.path, "expected Qoder executable");
  if (executable !== expectedPath) {
    throw policyError(
      "ACP_AGENT_EXECUTABLE_CHANGED",
      "The ACP Agent executable path changed after PageRoot preflight.",
    );
  }
  const handle = await open(
    executable,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
  ).catch(() => {
    throw policyError(
      "ACP_AGENT_EXECUTABLE_CHANGED",
      "The ACP Agent executable could not be reopened after PageRoot preflight.",
    );
  });
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o022) !== 0) {
      throw policyError(
        "ACP_AGENT_EXECUTABLE_CHANGED",
        "The ACP Agent executable is no longer a protected regular file.",
      );
    }
    // Positional reads leave the inherited file description at byte zero so
    // the trusted runtime can consume these exact verified bytes through fd 3.
    const bytes = await readHandleAtStart(handle, before.size);
    const after = await handle.stat();
    const identity = {
      dev: after.dev,
      ino: after.ino,
      nlink: after.nlink,
      size: after.size,
      mtimeMs: after.mtimeMs,
      sha256: sha256(bytes),
    };
    if (
      !sameFileIdentity(before, after)
      || bytes.byteLength !== after.size
      || !sameExecutableIdentity(identity, expectedExecutable.identity)
    ) {
      throw policyError(
        "ACP_AGENT_EXECUTABLE_CHANGED",
        "The ACP Agent executable identity changed after PageRoot preflight.",
      );
    }
    return handle;
  } catch (cause) {
    await handle.close().catch(() => {});
    throw cause;
  }
}

function truncateUtf8Tail(value, byteLimit) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.byteLength <= byteLimit) return { value, truncated: false };
  let start = bytes.byteLength - byteLimit;
  while (start < bytes.byteLength && (bytes[start] & 0b1100_0000) === 0b1000_0000) {
    start += 1;
  }
  return {
    value: bytes.subarray(start).toString("utf8"),
    truncated: true,
  };
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
        if (newline === -1) {
          this.#frameBytes += bytes.byteLength - offset;
          break;
        }
        this.#frameBytes += newline - offset;
        if (this.#frameBytes > MAX_ACP_FRAME_BYTES) {
          throw policyError("ACP_FRAME_TOO_LARGE", "Qoder emitted an oversized ACP frame.");
        }
        this.#frameBytes = 0;
        offset = newline + 1;
      }
      if (this.#frameBytes > MAX_ACP_FRAME_BYTES) {
        throw policyError("ACP_FRAME_TOO_LARGE", "Qoder emitted an oversized ACP frame.");
      }
      callback(null, bytes);
    } catch (error) {
      callback(String(error?.code || "").startsWith("ACP_")
        ? error
        : policyError("ACP_UTF8_INVALID", "Qoder emitted invalid UTF-8 over ACP."));
    }
  }

  _flush(callback) {
    try {
      this.#decoder.decode();
      callback();
    } catch {
      callback(policyError("ACP_UTF8_INVALID", "Qoder emitted invalid UTF-8 over ACP."));
    }
  }
}

export function qoderAcpEnvironment(overrides = {}, baseEnvironment = process.env) {
  assertObject(overrides, "Qoder environment");
  assertObject(baseEnvironment, "Qoder base environment");
  const result = {};
  for (const name of SAFE_QODER_ENVIRONMENT_NAMES) {
    if (typeof baseEnvironment[name] === "string") result[name] = baseEnvironment[name];
  }
  for (const [name, value] of Object.entries(overrides)) {
    if (!SAFE_QODER_ENVIRONMENT_NAMES.has(name) || typeof value !== "string") {
      throw new TypeError(`Qoder environment override ${JSON.stringify(name)} is not allowed.`);
    }
    result[name] = value;
  }
  return result;
}

function terminalExitStatus(child) {
  if (child.exitCode === null && child.signalCode === null) return null;
  return {
    exitCode: child.exitCode,
    signal: child.signalCode,
  };
}

async function waitForExit(child) {
  const existing = processClosePromises.get(child);
  if (existing) return existing;
  const terminal = terminalExitStatus(child);
  if (terminal) return terminal;
  const promise = new Promise((resolve, reject) => {
    const cleanup = () => {
      child.off("close", handleClose);
      child.off("error", handleError);
    };
    const handleClose = () => {
      cleanup();
      resolve(terminalExitStatus(child));
    };
    const handleError = (error) => {
      cleanup();
      reject(error);
    };
    child.once("close", handleClose);
    child.once("error", handleError);
  });
  processClosePromises.set(child, promise);
  return promise;
}

async function fileExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

export async function captureQoderAcpReviewBoundary({
  repository,
  target,
  projectRoot,
}) {
  if (typeof repository?.workspace !== "function") {
    throw new TypeError("A ProjectFileRepository-compatible workspace reader is required.");
  }
  const verifiedTarget = assertObject(target, "Working Copy target");
  const verifiedProjectRoot = await realpath(
    assertAbsolutePath(projectRoot, "projectRoot"),
  );
  const targetProjectRoot = await realpath(
    assertAbsolutePath(verifiedTarget.projectRootPath, "target.projectRootPath"),
  );
  if (verifiedProjectRoot !== targetProjectRoot) {
    throw policyError(
      "ACP_REVIEW_EVIDENCE_INVALID",
      "The Working Copy evidence root does not match the target Project File.",
    );
  }
  const workspace = await repository.workspace({
    sourcePath: assertAbsolutePath(verifiedTarget.exactSourcePath, "target.exactSourcePath"),
  });
  if (!workspace) {
    throw policyError(
      "ACP_REVIEW_EVIDENCE_INVALID",
      "The Working Copy evidence workspace could not be loaded.",
    );
  }
  const controlRoot = path.join(verifiedProjectRoot, ".pageroot");
  const manifestFile = await readVerifiedRegularFile(
    path.join(controlRoot, "manifest.json"),
    verifiedProjectRoot,
    "Project manifest evidence",
  );
  const versionSnapshots = [];
  for (const version of workspace.manifest.versions) {
    const snapshot = await readVerifiedRegularFile(
      path.join(controlRoot, version.snapshotRelativePath),
      verifiedProjectRoot,
      "Version snapshot evidence",
    );
    versionSnapshots.push({
      versionId: version.versionId,
      contentSha256: sha256(snapshot.bytes),
    });
  }
  return {
    target: {
      projectId: workspace.target.projectId,
      documentId: workspace.target.documentId,
      workingCopyId: workspace.target.workingCopyId,
      versionId: workspace.target.versionId,
      targetKind: workspace.target.targetKind,
      exactSourcePath: workspace.target.exactSourcePath,
      sourceSha256: workspace.target.sourceSha256,
    },
    manifest: workspace.manifest,
    manifestFileSha256: sha256(manifestFile.bytes),
    workingCopy: workspace.workingCopy,
    workingCopyState: workspace.workingCopyState,
    workingCopies: workspace.workingCopies,
    draft: workspace.draft,
    contentSha256: sha256(Buffer.from(workspace.content, "utf8")),
    versionSnapshots,
  };
}

function buildClient(host) {
  return acp
    .client({ name: "pageroot-agent-bridge" })
    .onRequest(acp.methods.client.session.requestPermission, ({ params, signal }) => (
      host.requestPermission(params, signal)
    ))
    .onRequest(acp.methods.client.fs.readTextFile, ({ params, signal }) => (
      host.readTextFile(params, signal)
    ))
    .onRequest(acp.methods.client.fs.writeTextFile, ({ params, signal }) => (
      host.writeTextFile(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.create, ({ params, signal }) => (
      host.createTerminal(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.output, ({ params, signal }) => (
      host.terminalOutput(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.waitForExit, ({ params, signal }) => (
      host.waitForTerminalExit(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.kill, ({ params, signal }) => (
      host.killTerminal(params, signal)
    ))
    .onRequest(acp.methods.client.terminal.release, ({ params, signal }) => (
      host.releaseTerminal(params, signal)
    ));
}

function timeoutController(timeoutMs) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("ACP timeouts must be positive integers.");
  }
  const controller = new AbortController();
  let rejectExpired;
  const expired = new Promise((_resolve, reject) => {
    rejectExpired = reject;
  });
  const timer = setTimeout(() => {
    const error = policyError("ACP_TIMEOUT", "The ACP operation timed out.");
    rejectExpired(error);
    controller.abort(error);
  }, timeoutMs);
  return {
    controller,
    expired,
    clear() {
      clearTimeout(timer);
    },
  };
}

function cancellationGate(signal) {
  if (signal !== undefined && signal !== null && !(signal instanceof AbortSignal)) {
    throw new TypeError("ACP cancellationSignal must be an AbortSignal.");
  }
  if (!signal) {
    return {
      promise: new Promise(() => {}),
      dispose() {},
    };
  }
  let rejectCancelled;
  const promise = new Promise((_resolve, reject) => {
    rejectCancelled = reject;
  });
  const cancel = () => {
    const reason = policyError("ACP_CANCELLED", "The PageRoot ACP task was cancelled.");
    if (signal.reason instanceof Error) reason.cause = signal.reason;
    rejectCancelled(reason);
  };
  if (signal.aborted) cancel();
  else signal.addEventListener("abort", cancel, { once: true });
  return {
    promise,
    dispose() {
      signal.removeEventListener("abort", cancel);
    },
  };
}

function combinedSignal(...signals) {
  const active = signals.filter(Boolean);
  if (active.length === 0) return undefined;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function normalizedAgentInfo(value) {
  const agentInfo = value && typeof value === "object" ? value : {};
  const clean = (input, fallback) => {
    const normalized = String(input || fallback)
      .replace(/[\u0000-\u001f\u007f]/gu, "")
      .trim()
      .slice(0, 160);
    return normalized || fallback;
  };
  return Object.freeze({
    name: clean(agentInfo.name, "unknown"),
    version: clean(agentInfo.version, "unknown"),
  });
}

function summarizeUpdate(update) {
  const type = String(update?.sessionUpdate || "unknown");
  if (type === "tool_call" || type === "tool_call_update") {
    return {
      type,
      toolKind: String(update.kind || "unknown"),
      status: String(update.status || "unknown"),
    };
  }
  return { type };
}

// Visible Agent narration is bounded and sanitized. Only what the Agent says is
// captured; hidden reasoning and every other update type are dropped.
function visibleTextChunk(update) {
  if (update?.sessionUpdate !== "agent_message_chunk") return "";
  if (update.content?.type !== "text") return "";
  return String(update.content.text || "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, "");
}

function visibleTextBuffer(byteLimit) {
  let text = "";
  let bytes = 0;
  let truncated = false;
  return {
    append(chunk) {
      if (!chunk || truncated) return "";
      const remaining = byteLimit - bytes;
      if (remaining <= 0) {
        truncated = true;
        return "";
      }
      const size = Buffer.byteLength(chunk, "utf8");
      if (size <= remaining) {
        text += chunk;
        bytes += size;
        return chunk;
      }
      // Cut on a character boundary, then stop accepting text. A clipped reply
      // must be marked, never silently shortened.
      const kept = truncateUtf8Tail(chunk, remaining);
      text += kept.value;
      bytes += Buffer.byteLength(kept.value, "utf8");
      truncated = true;
      return kept.value;
    },
    get value() {
      return text;
    },
    get truncated() {
      return truncated;
    },
  };
}

// `buildClient` wires every one of these to the host, and the driver itself
// binds, cancels and disposes it. A host that cannot answer all of them would
// fail as an undefined-method TypeError mid-turn instead of a policy error.
const ACP_HOST_METHODS = Object.freeze([
  "bindSessionId",
  "requestPermission",
  "readTextFile",
  "writeTextFile",
  "createTerminal",
  "terminalOutput",
  "waitForTerminalExit",
  "killTerminal",
  "releaseTerminal",
  "cancel",
  "dispose",
]);

function driverProfile({
  mode,
  createHost,
  clientCapabilities,
  requiresTurnCompletion,
  visibleTextByteLimit,
  requiredHostMethods,
}) {
  return Object.freeze({
    mode,
    createHost,
    clientCapabilities,
    requiresTurnCompletion,
    visibleTextByteLimit,
    requiredHostMethods,
    assertHost(host) {
      const missing = requiredHostMethods.filter(
        (name) => typeof host?.[name] !== "function",
      );
      if (missing.length > 0) {
        throw policyError(
          "ACP_HOST_CONTRACT_INCOMPLETE",
          `The ${mode} ACP host does not implement ${missing.join(", ")}.`,
          { mode, missing },
        );
      }
      return host;
    },
  });
}

const ACP_DRIVER_PROFILES = new Map([
  ["execution", driverProfile({
    mode: "execution",
    createHost: (policy, onEvent) => createRestrictedQoderAcpHost(policy, { onEvent }),
    clientCapabilities: Object.freeze({
      fs: Object.freeze({ readTextFile: true, writeTextFile: true }),
      terminal: true,
    }),
    // An execution turn only counts once the fixed finalizer has proven itself.
    requiresTurnCompletion: true,
    // Agent narration is bounded and has zero weight in Candidate acceptance.
    visibleTextByteLimit: 64 * 1024,
    requiredHostMethods: Object.freeze([...ACP_HOST_METHODS, "assertTurnCompleted"]),
  })],
]);

export function acpDriverProfile(policy) {
  assertObject(policy, "policy");
  if (policy[AGENT_POLICY_BRAND] !== true) {
    throw new TypeError("The ACP driver requires a verified PageRoot policy.");
  }
  const profile = typeof policy.mode === "string"
    ? ACP_DRIVER_PROFILES.get(policy.mode)
    : undefined;
  if (!profile) {
    throw policyError(
      "ACP_POLICY_MODE_UNSUPPORTED",
      "The ACP driver does not support this policy mode.",
    );
  }
  return profile;
}

export async function runAcpTask({
  connection,
  policy,
  prompt,
  onEvent = () => {},
  startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS,
  turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  cancellationSignal,
  expectedAgentName,
}) {
  const isStream = Boolean(connection?.readable && connection?.writable);
  const isAgentApp = typeof connection?.connect === "function"
    && typeof connection?.connectWith === "function";
  if (!isStream && !isAgentApp) {
    throw new TypeError("An ACP Stream or AgentApp connection is required.");
  }
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new TypeError("ACP prompt must be a non-empty string.");
  }
  if (Buffer.byteLength(prompt, "utf8") > MAX_PROMPT_BYTES) {
    throw policyError("ACP_PROMPT_TOO_LARGE", "The ACP prompt exceeds 256 KiB.");
  }
  if (
    expectedAgentName !== undefined
    && !(expectedAgentName instanceof RegExp)
  ) {
    throw new TypeError("expectedAgentName must be a RegExp.");
  }
  const profile = acpDriverProfile(policy);
  const host = profile.assertHost(profile.createHost(policy, onEvent));
  const client = buildClient(host);
  const startupTimeout = timeoutController(startupTimeoutMs);
  const cancellation = cancellationGate(cancellationSignal);
  const updates = [];
  let droppedUpdateCount = 0;
  // Zero budget means this mode captures no prose at all (ADR 0036).
  const visibleText = visibleTextBuffer(profile.visibleTextByteLimit);
  const cancelStartup = () => {
    void host.cancel().catch(() => {});
  };
  startupTimeout.controller.signal.addEventListener("abort", cancelStartup, { once: true });
  cancellationSignal?.addEventListener("abort", cancelStartup, { once: true });
  try {
    const connected = client.connectWith(connection, async (context) => {
      const startupSignal = combinedSignal(
        startupTimeout.controller.signal,
        cancellationSignal,
      );
      const initialized = await Promise.race([
        context.request(
          acp.methods.agent.initialize,
          {
            protocolVersion: acp.PROTOCOL_VERSION,
            clientCapabilities: profile.clientCapabilities,
            clientInfo: {
              name: "pageroot-agent-bridge",
              title: "PageRoot Agent Bridge",
              version: "1.0.0",
            },
          },
          { cancellationSignal: startupSignal },
        ),
        startupTimeout.expired,
        cancellation.promise,
      ]);
      if (initialized.protocolVersion !== acp.PROTOCOL_VERSION) {
        throw policyError(
          "ACP_PROTOCOL_UNSUPPORTED",
          `Qoder selected unsupported ACP protocol ${initialized.protocolVersion}.`,
        );
      }
      const agentInfo = normalizedAgentInfo(initialized.agentInfo);
      if (expectedAgentName) expectedAgentName.lastIndex = 0;
      if (expectedAgentName && !expectedAgentName.test(agentInfo.name)) {
        throw policyError(
          "ACP_AGENT_IDENTITY_MISMATCH",
          "The selected ACP executable did not identify itself as Qoder CLI.",
        );
      }
      onEvent(Object.freeze({
        kind: "initialized",
        protocolVersion: initialized.protocolVersion,
        agentName: agentInfo.name,
        agentVersion: agentInfo.version,
      }));

      const session = await Promise.race([
        context.buildSession({
          cwd: policy.requestRoot,
          mcpServers: [],
        }).start({ cancellationSignal: startupSignal }),
        startupTimeout.expired,
        cancellation.promise,
      ]);
      startupTimeout.clear();
      host.bindSessionId(session.sessionId);
      const turnTimeout = timeoutController(turnTimeoutMs);
      const turnSignal = combinedSignal(
        turnTimeout.controller.signal,
        cancellationSignal,
      );
      const cancelTurn = () => {
        void host.cancel().catch(() => {});
        void context.notify(acp.methods.agent.session.cancel, {
          sessionId: session.sessionId,
        }).catch(() => {});
      };
      turnTimeout.controller.signal.addEventListener("abort", cancelTurn, { once: true });
      cancellationSignal?.addEventListener("abort", cancelTurn, { once: true });
      try {
        const promptPromise = session.prompt(prompt, {
          cancellationSignal: turnSignal,
        });
        void promptPromise.catch(() => {});
        for (;;) {
          const message = await Promise.race([
            session.nextUpdate(),
            turnTimeout.expired,
            cancellation.promise,
          ]);
          if (message.kind === "stop") {
            onEvent(Object.freeze({ kind: "turn-stopping", stopReason: message.stopReason }));
            // Never soften this into an optional call: for a mode that requires
            // completion, a renamed or missing method must fail the turn instead
            // of silently skipping the finalizer proof.
            const completion = profile.requiresTurnCompletion
              ? await host.assertTurnCompleted()
              : null;
            onEvent(Object.freeze({ kind: "turn-stopped", stopReason: message.stopReason }));
            return {
              initialized,
              sessionId: session.sessionId,
              stopReason: message.stopReason,
              completion,
              updates,
              droppedUpdateCount,
              visibleText: visibleText.value,
              visibleTextTruncated: visibleText.truncated,
            };
          }
          // Capture the Agent's own words before the update is reduced to a
          // summary. A mode with no text budget appends nothing.
          const chunk = visibleText.append(visibleTextChunk(message.update));
          if (chunk) onEvent(Object.freeze({ kind: "visible-text", text: chunk }));
          const summary = summarizeUpdate(message.update);
          if (updates.length < MAX_SESSION_UPDATES) {
            updates.push(summary);
            onEvent(Object.freeze({ kind: "session-update", ...summary }));
          } else {
            droppedUpdateCount += 1;
            if (droppedUpdateCount === 1) {
              onEvent(Object.freeze({ kind: "session-updates-truncated" }));
            }
          }
        }
      } finally {
        turnTimeout.controller.signal.removeEventListener("abort", cancelTurn);
        cancellationSignal?.removeEventListener("abort", cancelTurn);
        turnTimeout.clear();
        session.dispose();
      }
    });
    void connected.catch(() => {});
    return await Promise.race([connected, cancellation.promise]);
  } finally {
    startupTimeout.controller.signal.removeEventListener("abort", cancelStartup);
    cancellationSignal?.removeEventListener("abort", cancelStartup);
    startupTimeout.clear();
    cancellation.dispose();
    await host.dispose();
  }
}

async function trustedCurrentJavaScriptRuntime() {
  const runtime = await realpath(process.execPath).catch(() => {
    throw policyError(
      "ACP_AGENT_RUNTIME_INVALID",
      "The trusted PageRoot JavaScript runtime is unavailable.",
    );
  });
  const information = await lstat(runtime).catch(() => null);
  if (!information?.isFile() || information.isSymbolicLink()) {
    throw policyError(
      "ACP_AGENT_RUNTIME_INVALID",
      "The trusted PageRoot JavaScript runtime is invalid.",
    );
  }
  await access(runtime, fsConstants.X_OK).catch(() => {
    throw policyError(
      "ACP_AGENT_RUNTIME_INVALID",
      "The trusted PageRoot JavaScript runtime is not executable.",
    );
  });
  return runtime;
}

export async function prepareVerifiedQoderJavaScriptExecution({
  command,
  expectedExecutable,
  environment = {},
  baseEnvironment = process.env,
} = {}) {
  const requestedExecutable = assertAbsolutePath(command, "Qoder JavaScript command");
  const executable = await realpath(requestedExecutable).catch(() => {
    throw policyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is unavailable.");
  });
  const executableInformation = await lstat(executable);
  if (!executableInformation.isFile() || executableInformation.isSymbolicLink()) {
    throw policyError(
      "ACP_AGENT_EXECUTABLE_INVALID",
      "The ACP Agent executable must resolve to a regular file.",
    );
  }
  await access(executable, fsConstants.X_OK).catch(() => {
    throw policyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is not executable.");
  });
  const executableHandle = await openVerifiedAgentExecutable(executable, expectedExecutable);
  let consumed = false;
  try {
    const runtime = await trustedCurrentJavaScriptRuntime();
    const childEnvironment = qoderAcpEnvironment(environment, baseEnvironment);
    if (process.versions.electron) {
      // This capability is constructed inside PageRoot. It is deliberately
      // absent from the caller-overridable environment allowlist.
      childEnvironment.ELECTRON_RUN_AS_NODE = "1";
    }
    return Object.freeze({
      executable,
      async spawn({ args = [], cwd, detached = false, stdin = "pipe" } = {}) {
        if (consumed) {
          throw policyError(
            "ACP_AGENT_EXECUTION_CONSUMED",
            "The verified Qoder execution descriptor has already been consumed.",
          );
        }
        consumed = true;
        try {
          return spawn(runtime, [
            "--no-warnings",
            "--experimental-vm-modules",
            "--input-type=module",
            "--eval",
            VERIFIED_ESM_LOADER_SOURCE,
            "--",
            executable,
            ...args,
          ], {
            cwd,
            env: childEnvironment,
            detached,
            shell: false,
            stdio: [stdin, "pipe", "pipe", executableHandle.fd],
          });
        } finally {
          // spawn duplicates fd 3 into the child before returning. Closing the
          // parent handle cannot change the inode/bytes inherited by the child.
          await executableHandle.close().catch(() => {});
        }
      },
      async close() {
        if (consumed) return;
        consumed = true;
        await executableHandle.close().catch(() => {});
      },
    });
  } catch (cause) {
    await executableHandle.close().catch(() => {});
    throw cause;
  }
}

export async function runVerifiedQoderJavaScript({
  command,
  expectedExecutable,
  args = [],
  cwd,
  environment = {},
  baseEnvironment = process.env,
  timeoutMs = 30_000,
  maxBuffer = 128 * 1024,
  processTerminator = terminateManagedProcess,
} = {}) {
  if (typeof processTerminator !== "function") {
    throw new TypeError("Verified Qoder process terminator must be a function.");
  }
  const prepared = await prepareVerifiedQoderJavaScriptExecution({
    command,
    expectedExecutable,
    environment,
    baseEnvironment,
  });
  const processGroup = process.platform !== "win32";
  let child;
  try {
    child = await prepared.spawn({
      args,
      cwd,
      detached: processGroup,
      stdin: "ignore",
    });
  } catch (cause) {
    await prepared.close();
    throw cause;
  }

  const stdout = [];
  const stderr = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  return new Promise((resolve, reject) => {
    let settled = false;
    let timeoutHandle;

    const cleanup = () => {
      clearTimeout(timeoutHandle);
      child.stdout?.off("data", handleStdout);
      child.stderr?.off("data", handleStderr);
      child.off("close", handleClose);
      child.off("error", handleError);
    };
    const output = () => ({
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    });
    const fail = async (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      const cleanupConfirmed = await processTerminator(child, { processGroup }).then(
        (value) => value === true,
        () => false,
      );
      const failure = cleanupConfirmed
        ? error
        : policyError(
          "ACP_PREFLIGHT_CLEANUP_UNCONFIRMED",
          "The Qoder preflight process group could not be confirmed stopped.",
        );
      Object.assign(failure, output());
      reject(failure);
    };
    const append = (target, chunk, currentBytes, label) => {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      if (currentBytes + bytes.byteLength > maxBuffer) {
        const error = new Error(`Qoder ${label} exceeded the preflight output limit.`);
        error.code = "ERR_CHILD_PROCESS_STDIO_MAXBUFFER";
        void fail(error);
        return currentBytes;
      }
      target.push(bytes);
      return currentBytes + bytes.byteLength;
    };
    const handleStdout = (chunk) => {
      stdoutBytes = append(stdout, chunk, stdoutBytes, "stdout");
    };
    const handleStderr = (chunk) => {
      stderrBytes = append(stderr, chunk, stderrBytes, "stderr");
    };
    const handleError = (cause) => {
      void fail(cause instanceof Error ? cause : new Error(String(cause)));
    };
    const handleClose = async (exitCode, signal) => {
      if (settled) return;
      settled = true;
      cleanup();
      const captured = output();
      const cleanupConfirmed = await processTerminator(child, { processGroup }).then(
        (value) => value === true,
        () => false,
      );
      if (!cleanupConfirmed) {
        const error = policyError(
          "ACP_PREFLIGHT_CLEANUP_UNCONFIRMED",
          "The Qoder preflight process group could not be confirmed stopped.",
        );
        Object.assign(error, captured);
        reject(error);
        return;
      }
      if (exitCode === 0) {
        resolve(captured);
        return;
      }
      const error = new Error(`Qoder exited with status ${exitCode ?? signal ?? "unknown"}.`);
      error.code = exitCode;
      error.signal = signal;
      Object.assign(error, captured);
      reject(error);
    };

    child.stdout?.on("data", handleStdout);
    child.stderr?.on("data", handleStderr);
    child.once("close", (...values) => {
      void handleClose(...values);
    });
    child.once("error", handleError);
    timeoutHandle = setTimeout(() => {
      const error = new Error("Qoder preflight timed out.");
      error.code = "ETIMEDOUT";
      error.killed = true;
      void fail(error);
    }, timeoutMs);
    timeoutHandle.unref?.();
  });
}

export async function runQoderAcpTask({
  command,
  args = ["--acp"],
  policy,
  prompt,
  environment = {},
  onEvent = () => {},
  startupTimeoutMs,
  turnTimeoutMs,
  cancellationSignal,
  expectedAgentName,
  expectedExecutable,
  useVerifiedJavaScriptRuntime = false,
  baseEnvironment = process.env,
}) {
  if (cancellationSignal?.aborted) {
    throw policyError("ACP_CANCELLED", "The PageRoot ACP task was cancelled.");
  }
  const requestedExecutable = assertAbsolutePath(command, "Qoder ACP command");
  const executable = await realpath(requestedExecutable).catch(() => {
    throw policyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is unavailable.");
  });
  const executableInformation = await lstat(executable);
  if (!executableInformation.isFile() || executableInformation.isSymbolicLink()) {
    throw policyError(
      "ACP_AGENT_EXECUTABLE_INVALID",
      "The ACP Agent executable must resolve to a regular file.",
    );
  }
  await access(executable, fsConstants.X_OK).catch(() => {
    throw policyError("ACP_AGENT_EXECUTABLE_INVALID", "The ACP Agent executable is not executable.");
  });
  const stderr = { value: "", truncated: false };
  const processGroup = process.platform !== "win32";
  let child;
  if (useVerifiedJavaScriptRuntime) {
    if (!expectedExecutable) {
      throw policyError(
        "ACP_AGENT_EXECUTABLE_INVALID",
        "Verified JavaScript execution requires preflight executable identity.",
      );
    }
    const prepared = await prepareVerifiedQoderJavaScriptExecution({
      command: executable,
      expectedExecutable,
      environment,
      baseEnvironment,
    });
    child = await prepared.spawn({
      args,
      cwd: policy.requestRoot,
      detached: processGroup,
      stdin: "pipe",
    });
  } else {
    const executableHandle = expectedExecutable
      ? await openVerifiedAgentExecutable(executable, expectedExecutable)
      : null;
    const childEnvironment = qoderAcpEnvironment(environment, baseEnvironment);
    try {
      child = spawn(executable, [...args], {
        cwd: policy.requestRoot,
        env: childEnvironment,
        detached: processGroup,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      });
    } finally {
      await executableHandle?.close().catch(() => {});
    }
  }
  const childExitPromise = waitForExit(child);
  void childExitPromise.catch(() => {});
  let turnStopObserved = false;
  const earlyExitPromise = childExitPromise.then(
    async (status) => {
      await new Promise((resolve) => setTimeout(resolve, PROCESS_PROTOCOL_DRAIN_MS));
      if (turnStopObserved) return new Promise(() => {});
      throw policyError(
        "ACP_AGENT_EXITED_EARLY",
        "The ACP Agent process exited before the task completed.",
        { status },
      );
    },
    (cause) => {
      const error = policyError(
        "ACP_AGENT_PROCESS_ERROR",
        "The ACP Agent process could not be started or observed.",
      );
      error.cause = cause;
      throw error;
    },
  );
  void earlyExitPromise.catch(() => {});
  child.stdin?.on("error", () => {});
  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk) => {
    const next = truncateUtf8Tail(stderr.value + chunk, 16 * 1024);
    stderr.value = next.value;
    stderr.truncated ||= next.truncated;
  });
  const guardedStdout = child.stdout.pipe(new AcpFrameGuard());
  const stream = acp.ndJsonStream(
    Writable.toWeb(child.stdin),
    Readable.toWeb(guardedStdout),
  );
  try {
    const observeEvent = (event) => {
      if (event?.kind === "turn-stopping") turnStopObserved = true;
      onEvent(event);
    };
    const result = await Promise.race([
      runAcpTask({
        connection: stream,
        policy,
        prompt,
        onEvent: observeEvent,
        cancellationSignal,
        expectedAgentName,
        ...(startupTimeoutMs ? { startupTimeoutMs } : {}),
        ...(turnTimeoutMs ? { turnTimeoutMs } : {}),
      }),
      earlyExitPromise,
    ]);
    return {
      ...result,
      stderr: stderr.value,
      stderrTruncated: stderr.truncated,
    };
  } catch (cause) {
    let failure = cause;
    if (String(cause?.message || cause) === "ACP connection closed") {
      const status = await Promise.race([
        childExitPromise.then(
          (value) => value,
          () => null,
        ),
        new Promise((resolve) => setTimeout(resolve, 50, null)),
      ]);
      if (status) {
        failure = policyError(
          "ACP_AGENT_EXITED_EARLY",
          "The ACP Agent process exited before the task completed.",
          { status },
        );
      }
    }
    const error = failure instanceof Error ? failure : new Error(String(failure));
    error.qoderStderr = stderr.value;
    error.qoderStderrTruncated = stderr.truncated;
    throw error;
  } finally {
    child.stdin?.end();
    if (!(await terminateManagedProcess(child, { processGroup }))) {
      throw policyError(
        "ACP_PROCESS_CLEANUP_UNCONFIRMED",
        "The ACP Agent process group could not be confirmed stopped.",
      );
    }
  }
}
