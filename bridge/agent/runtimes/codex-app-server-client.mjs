import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 3_000;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_STDERR_CHARACTERS = 8_192;
const MAX_MODEL_PAGES = 4;
const MAX_PUBLIC_MODELS = 80;
const SAFE_MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._/:+-]{0,159}$/u;
const SAFE_REASONING = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/u;

export class CodexAppServerError extends Error {
  constructor(code, message, { status = 503 } = {}) {
    super(message);
    this.name = "CodexAppServerError";
    this.code = code;
    this.status = status;
  }
}

function fail(code, message, options) {
  throw new CodexAppServerError(code, message, options);
}

function boundedDiagnostic(current, chunk) {
  const combined = `${current}${String(chunk || "")}`;
  return combined.length <= MAX_STDERR_CHARACTERS
    ? combined
    : combined.slice(-MAX_STDERR_CHARACTERS);
}

function sanitizedEnvironment(environment) {
  const result = { ...environment };
  delete result.APP_SERVER_LOGS;
  delete result.CODEX_APP_SERVER_LOGS;
  return result;
}

function appServerArgs(prefix = []) {
  return [
    ...prefix,
    "app-server",
    "--stdio",
    "--strict-config",
    "--disable", "apps",
    "--disable", "plugins",
    "--disable", "browser_use",
    "--disable", "computer_use",
    "--disable", "multi_agent",
  ];
}

function normalizePublicModels(rows) {
  const models = [];
  const seen = new Set();
  for (const row of rows) {
    if (!row || typeof row !== "object" || row.hidden === true) continue;
    const rawId = String(row.id || row.model || "").trim();
    if (!SAFE_MODEL_ID.test(rawId) || seen.has(rawId)) continue;
    const efforts = [];
    for (const option of Array.isArray(row.supportedReasoningEfforts)
      ? row.supportedReasoningEfforts
      : []) {
      const effort = String(option?.reasoningEffort || "").trim();
      if (SAFE_REASONING.test(effort) && !efforts.includes(effort)) efforts.push(effort);
    }
    seen.add(rawId);
    models.push(Object.freeze({
      id: `codex:${rawId}`,
      providerModelId: rawId,
      displayName: String(row.displayName || rawId).trim().slice(0, 120) || rawId,
      reasoningEfforts: Object.freeze(efforts),
      defaultReasoningEffort: SAFE_REASONING.test(String(row.defaultReasoningEffort || ""))
        ? String(row.defaultReasoningEffort)
        : null,
      isDefault: row.isDefault === true,
    }));
    if (models.length >= MAX_PUBLIC_MODELS) break;
  }
  return Object.freeze(models);
}

function processExit(child) {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(Object.freeze({ code: child.exitCode, signal: child.signalCode }));
      return;
    }
    child.once("exit", (code, signal) => resolve(Object.freeze({ code, signal })));
  });
}

function timeout(milliseconds) {
  let handle;
  const promise = new Promise((resolve) => {
    handle = setTimeout(() => resolve(null), milliseconds);
    handle.unref?.();
  });
  return { promise, clear: () => clearTimeout(handle) };
}

async function terminateProcessTree(child, exitPromise, shutdownTimeoutMs) {
  child.stdin?.end?.();
  const graceful = timeout(shutdownTimeoutMs);
  let exited = await Promise.race([exitPromise, graceful.promise]);
  graceful.clear();
  if (exited) return exited;

  const signal = (name) => {
    if (!Number.isInteger(child.pid) || child.pid <= 0) return false;
    try {
      if (process.platform === "win32") return child.kill(name);
      process.kill(-child.pid, name);
      return true;
    } catch (cause) {
      if (cause?.code === "ESRCH") return true;
      return false;
    }
  };
  signal("SIGTERM");
  const terminating = timeout(shutdownTimeoutMs);
  exited = await Promise.race([exitPromise, terminating.promise]);
  terminating.clear();
  if (exited) return exited;
  signal("SIGKILL");
  const killing = timeout(shutdownTimeoutMs);
  exited = await Promise.race([exitPromise, killing.promise]);
  killing.clear();
  if (!exited) {
    fail(
      "CODEX_APP_SERVER_CLEANUP_UNCONFIRMED",
      "Codex App Server cleanup could not be confirmed.",
    );
  }
  return exited;
}

export async function probeCodexAppServer({
  command,
  argsPrefix = [],
  cwd,
  environment = process.env,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  shutdownTimeoutMs = DEFAULT_SHUTDOWN_TIMEOUT_MS,
  spawnProcess = spawn,
} = {}) {
  if (typeof command !== "string" || !command || typeof cwd !== "string" || !cwd) {
    throw new TypeError("Codex App Server probe requires command and cwd.");
  }
  const child = spawnProcess(command, appServerArgs(argsPrefix), {
    cwd,
    env: sanitizedEnvironment(environment),
    detached: process.platform !== "win32",
    shell: false,
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (!child?.stdin || !child?.stdout || !child?.stderr) {
    throw new TypeError("Codex App Server process must expose stdio.");
  }

  const exitPromise = processExit(child);
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let bufferBytes = 0;
  let stderr = "";
  let nextId = 1;
  let protocolFailure = null;
  const pending = new Map();

  const rejectAll = (cause) => {
    if (!protocolFailure) protocolFailure = cause;
    for (const waiter of pending.values()) waiter.reject(cause);
    pending.clear();
  };
  const onStdout = (chunk) => {
    if (!Buffer.isBuffer(chunk)) chunk = Buffer.from(chunk);
    const decoded = decoder.write(chunk);
    if (decoded.includes("\ufffd")) {
      rejectAll(new CodexAppServerError(
        "CODEX_APP_SERVER_INVALID_UTF8",
        "Codex App Server returned invalid UTF-8.",
      ));
      return;
    }
    buffer += decoded;
    bufferBytes += chunk.length;
    if (bufferBytes > MAX_FRAME_BYTES && !buffer.includes("\n")) {
      rejectAll(new CodexAppServerError(
        "CODEX_APP_SERVER_FRAME_TOO_LARGE",
        "Codex App Server returned an oversized frame.",
      ));
      return;
    }
    let boundary;
    while ((boundary = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 1);
      bufferBytes = Buffer.byteLength(buffer);
      if (!line.trim()) continue;
      if (Buffer.byteLength(line) > MAX_FRAME_BYTES) {
        rejectAll(new CodexAppServerError(
          "CODEX_APP_SERVER_FRAME_TOO_LARGE",
          "Codex App Server returned an oversized frame.",
        ));
        return;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        rejectAll(new CodexAppServerError(
          "CODEX_APP_SERVER_PROTOCOL_INVALID",
          "Codex App Server returned an invalid protocol frame.",
        ));
        return;
      }
      if (message?.id === undefined || !pending.has(message.id)) continue;
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        waiter.reject(new CodexAppServerError(
          "CODEX_APP_SERVER_REQUEST_FAILED",
          "Codex App Server rejected a probe request.",
        ));
      } else {
        waiter.resolve(message.result);
      }
    }
  };
  child.stdout.on("data", onStdout);
  child.stderr.on("data", (chunk) => {
    stderr = boundedDiagnostic(stderr, chunk);
  });
  child.once("error", () => rejectAll(new CodexAppServerError(
    "CODEX_APP_SERVER_START_FAILED",
    "Codex App Server could not be started.",
  )));
  void exitPromise.then(({ code, signal }) => {
    if (pending.size === 0) return;
    rejectAll(new CodexAppServerError(
      "CODEX_APP_SERVER_EXITED",
      `Codex App Server exited before preflight completed (${code ?? signal ?? "unknown"}).`,
    ));
  });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => {
    if (protocolFailure) return Promise.reject(protocolFailure);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const handle = setTimeout(() => {
        pending.delete(id);
        reject(new CodexAppServerError(
          "CODEX_APP_SERVER_TIMEOUT",
          "Codex App Server preflight timed out.",
        ));
      }, requestTimeoutMs);
      handle.unref?.();
      pending.set(id, {
        resolve(value) {
          clearTimeout(handle);
          resolve(value);
        },
        reject(cause) {
          clearTimeout(handle);
          reject(cause);
        },
      });
      send({ method, id, params });
    });
  };

  let result;
  let failure;
  try {
    const initialized = await request("initialize", {
      clientInfo: {
        name: "stemmio",
        title: "Stemmio",
        version: "0.1.0",
      },
    });
    send({ method: "initialized", params: {} });
    const account = await request("account/read", { refreshToken: false });
    if (account?.requiresOpenaiAuth === true && !account.account) {
      fail("CODEX_AUTH_REQUIRED", "Codex requires an explicit login.", { status: 401 });
    }

    const rows = [];
    let cursor = null;
    for (let page = 0; page < MAX_MODEL_PAGES; page += 1) {
      const response = await request("model/list", {
        cursor,
        limit: 40,
        includeHidden: false,
      });
      if (Array.isArray(response?.data)) rows.push(...response.data);
      cursor = typeof response?.nextCursor === "string" && response.nextCursor
        ? response.nextCursor
        : null;
      if (!cursor || rows.length >= MAX_PUBLIC_MODELS) break;
    }
    const models = normalizePublicModels(rows);
    if (models.length === 0) {
      fail("CODEX_MODEL_CATALOG_EMPTY", "Codex returned no usable models.");
    }
    result = Object.freeze({
      protocol: "codex-app-server-v2",
      userAgent: typeof initialized?.userAgent === "string"
        ? initialized.userAgent.slice(0, 160)
        : null,
      authMode: typeof account?.account?.type === "string"
        ? account.account.type.slice(0, 40)
        : account?.requiresOpenaiAuth === false
          ? "provider-managed"
          : "authenticated",
      models,
    });
  } catch (cause) {
    failure = cause;
  } finally {
    child.stdout.removeListener("data", onStdout);
    try {
      await terminateProcessTree(child, exitPromise, shutdownTimeoutMs);
    } catch (cleanupCause) {
      failure = cleanupCause;
    }
  }
  if (failure) throw failure;
  return result;
}
