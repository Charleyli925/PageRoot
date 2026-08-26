import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  constants as fsConstants,
  lstat,
  mkdtemp,
  open,
  readdir,
  rm,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createExecutionHost, terminateManagedProcess } from "../hosts/execution-host.mjs";
import { assertAgentSecurityProfile } from "../providers/agent-provider-contract.mjs";
import { defineAgentRuntime } from "./agent-runtime-contract.mjs";

const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;
const MAX_FRAME_BYTES = 1024 * 1024;
const MAX_SKILLS = 256;
const SAFE_ID = /^[^\u0000-\u001f\u007f]{1,256}$/u;

export class CodexExecutionError extends Error {
  constructor(code, message, { status = 503 } = {}) {
    super(message);
    this.name = "CodexExecutionError";
    this.code = code;
    this.status = status;
  }
}

function executionError(code, message, options) {
  return new CodexExecutionError(code, message, options);
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
    "--disable", "skill_search",
    "--disable", "skill_mcp_dependency_install",
    "--disable", "memories",
    "--config", "mcp_servers={}",
  ];
}

function sanitizedEnvironment(environment) {
  const result = { ...environment };
  delete result.APP_SERVER_LOGS;
  delete result.CODEX_APP_SERVER_LOGS;
  return result;
}

function sameCommandIdentity(actual, expected) {
  return Boolean(
    expected
    && actual.dev === expected.dev
    && actual.ino === expected.ino
    && actual.size === expected.size
    && actual.mtimeMs === expected.mtimeMs
    && actual.sha256 === expected.sha256,
  );
}

async function verifiedCommand(command, expected) {
  if (!expected) return null;
  const handle = await open(command, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0)).catch(() => {
    throw executionError("CODEX_INSTALLATION_CHANGED", "The Codex executable could not be reopened.", {
      status: 409,
    });
  });
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.nlink !== 1 || (before.mode & 0o022) !== 0) {
      throw executionError("CODEX_INSTALLATION_CHANGED", "The Codex executable is no longer protected.", {
        status: 409,
      });
    }
    const bytes = await handle.readFile();
    const after = await handle.stat();
    const identity = {
      dev: after.dev,
      ino: after.ino,
      size: after.size,
      mtimeMs: after.mtimeMs,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
      || bytes.byteLength !== after.size || !sameCommandIdentity(identity, expected)) {
      throw executionError("CODEX_INSTALLATION_CHANGED", "The Codex executable changed after preflight.", {
        status: 409,
      });
    }
    return { handle, bytes };
  } catch (cause) {
    await handle.close().catch(() => {});
    throw cause;
  }
}

async function executableSnapshot(verified) {
  if (!verified) return null;
  const root = await mkdtemp(path.join(os.tmpdir(), "stemmio-codex-runtime-"));
  const executable = path.join(root, process.platform === "win32" ? "codex.exe" : "codex");
  try {
    const target = await open(
      executable,
      fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
      0o700,
    );
    try {
      await target.writeFile(verified.bytes);
      await target.sync();
    } finally {
      await target.close();
    }
    if (process.platform !== "win32") await chmod(executable, 0o500);
    return { root, executable };
  } catch (cause) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw cause;
  }
}

export async function prepareVerifiedCodexExecutable({ command, expectedCommandIdentity } = {}) {
  if (typeof command !== "string" || !path.isAbsolute(command) || !expectedCommandIdentity) {
    throw new TypeError("Verified Codex executable preparation requires a command and identity.");
  }
  const verified = await verifiedCommand(command, expectedCommandIdentity);
  try {
    const snapshot = await executableSnapshot(verified);
    return Object.freeze({
      command: snapshot.executable,
      async cleanup() {
        await rm(snapshot.root, { recursive: true, force: true });
      },
    });
  } finally {
    await verified.handle.close().catch(() => {});
  }
}

function disabledSkillConfig(response) {
  const paths = [];
  for (const entry of Array.isArray(response?.data) ? response.data : []) {
    for (const skill of Array.isArray(entry?.skills) ? entry.skills : []) {
      const skillPath = typeof skill?.path === "string" ? skill.path : "";
      if (!path.isAbsolute(skillPath) || skillPath.includes("\0")) {
        throw executionError("CODEX_SKILL_CONFIG_INVALID", "Codex returned an invalid skill path.");
      }
      if (!paths.includes(skillPath)) paths.push(skillPath);
      if (paths.length > MAX_SKILLS) {
        throw executionError(
          "CODEX_SKILL_CONFIG_UNBOUNDED",
          "Codex returned more skills than Stemmio can disable safely.",
        );
      }
    }
  }
  return paths.map((skillPath) => Object.freeze({ path: skillPath, enabled: false }));
}

async function assertUniqueCandidateOutput(policy) {
  const outputRoot = path.dirname(policy.outputPath);
  const expectedName = path.basename(policy.outputPath);
  const entries = await readdir(outputRoot, { withFileTypes: true });
  if (entries.length !== 1 || entries[0].name !== expectedName || !entries[0].isFile()) {
    throw executionError(
      "CODEX_OUTPUT_SURFACE_INVALID",
      "Codex wrote outside the unique Candidate output file.",
      { status: 409 },
    );
  }
  const information = await lstat(policy.outputPath);
  if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1) {
    throw executionError(
      "CODEX_OUTPUT_SURFACE_INVALID",
      "The Codex Candidate output is not a protected regular file.",
      { status: 409 },
    );
  }
}

function finalizerRequest(policy, sessionId) {
  return Object.freeze({
    sessionId,
    command: policy.finalizer.command,
    args: [...policy.finalizer.args],
    cwd: policy.finalizer.cwd,
    env: Object.entries(policy.finalizer.env).map(([name, value]) => ({ name, value })),
    outputByteLimit: 64 * 1024,
  });
}

function waitForClose(child) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve({ exitCode: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve) => {
    child.once("close", (exitCode, signal) => resolve({ exitCode, signal }));
  });
}

function boundedTurnStatus(turn) {
  return ["completed", "interrupted", "failed", "inProgress"].includes(turn?.status)
    ? turn.status
    : "invalid";
}

function eventForNotification(message, identifiers) {
  const params = message?.params;
  if (!params || typeof params !== "object") return null;
  if (params.threadId && identifiers.threadId && params.threadId !== identifiers.threadId) return null;
  if (params.turnId && identifiers.turnId && params.turnId !== identifiers.turnId) return null;
  if (message.method === "item/agentMessage/delta" && typeof params.delta === "string") {
    return Object.freeze({ kind: "visible-text", text: params.delta });
  }
  if (message.method === "item/started") {
    const type = String(params.item?.type || "");
    if (type === "commandExecution") return Object.freeze({ kind: "tool-started", toolKind: "command" });
    if (type === "fileChange") return Object.freeze({ kind: "tool-started", toolKind: "file-change" });
  }
  if (message.method === "item/completed") {
    const type = String(params.item?.type || "");
    if (type === "fileChange") return Object.freeze({ kind: "file-written" });
    if (type === "commandExecution") return Object.freeze({ kind: "tool-completed", toolKind: "command" });
  }
  return null;
}

export async function runCodexAppServerTask({
  command,
  expectedCommandIdentity = null,
  argsPrefix = [],
  cwd,
  environment = process.env,
  policy,
  prompt,
  model,
  effort = null,
  cancellationSignal,
  onEvent = () => {},
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  turnTimeoutMs = DEFAULT_TURN_TIMEOUT_MS,
  spawnProcess = spawn,
  hostFactory = createExecutionHost,
} = {}) {
  if (typeof command !== "string" || !path.isAbsolute(command)
    || typeof cwd !== "string" || !path.isAbsolute(cwd)
    || typeof prompt !== "string" || !prompt
    || typeof model !== "string" || !model
    || !policy || typeof policy !== "object") {
    throw new TypeError("Codex App Server runtime launch is invalid.");
  }
  if (cancellationSignal && typeof cancellationSignal.addEventListener !== "function") {
    throw new TypeError("Codex cancellationSignal must be an AbortSignal.");
  }
  if (typeof onEvent !== "function" || typeof spawnProcess !== "function" || typeof hostFactory !== "function") {
    throw new TypeError("Codex App Server runtime dependencies are invalid.");
  }

  const host = hostFactory(policy, { onEvent });
  const sessionId = `codex_${policy.requestId}_${policy.attemptId}`;
  host.bindSessionId(sessionId);
  const preparedCommand = expectedCommandIdentity
    ? await prepareVerifiedCodexExecutable({ command, expectedCommandIdentity })
    : null;
  let child;
  try {
    child = spawnProcess(preparedCommand?.command || command, appServerArgs(argsPrefix), {
      cwd,
      env: sanitizedEnvironment(environment),
      detached: process.platform !== "win32",
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (cause) {
    await preparedCommand?.cleanup().catch(() => {});
    throw cause;
  }
  if (!child?.stdin || !child?.stdout || !child?.stderr) {
    throw new TypeError("Codex App Server process must expose stdio.");
  }
  const closePromise = waitForClose(child);
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let frameBytes = 0;
  let nextId = 1;
  let protocolFailure = null;
  let cleanupConfirmed = false;
  let cleanupRequested = false;
  const pending = new Map();
  const identifiers = { threadId: null, turnId: null };
  let completeTurn;
  let rejectTurn;
  const turnCompleted = new Promise((resolve, reject) => {
    completeTurn = resolve;
    rejectTurn = reject;
  });
  void turnCompleted.catch(() => {});

  const rejectAll = (cause) => {
    if (!protocolFailure) protocolFailure = cause;
    for (const waiter of pending.values()) waiter.reject(cause);
    pending.clear();
    rejectTurn(cause);
  };
  const respondUnsupported = (message) => {
    child.stdin.write(`${JSON.stringify({
      id: message.id,
      error: { code: -32601, message: "Stemmio denies App Server requests." },
    })}\n`);
    rejectAll(executionError(
      "CODEX_PERMISSION_REQUESTED",
      "Codex requested an interaction that this execution profile forbids.",
      { status: 409 },
    ));
  };
  const acceptMessage = (message) => {
    if (message?.id !== undefined && message?.method && !pending.has(message.id)) {
      respondUnsupported(message);
      return;
    }
    if (message?.id !== undefined && pending.has(message.id)) {
      const waiter = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        waiter.reject(executionError(
          "CODEX_APP_SERVER_REQUEST_FAILED",
          "Codex App Server rejected an execution request.",
        ));
      } else {
        waiter.resolve(message.result);
      }
      return;
    }
    const event = eventForNotification(message, identifiers);
    if (event) onEvent(event);
    if (message?.method === "turn/completed") {
      const turn = message.params?.turn;
      if (message.params?.threadId !== identifiers.threadId || turn?.id !== identifiers.turnId) return;
      completeTurn(turn);
    }
  };
  const onStdout = (chunk) => {
    try {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      buffer += decoder.decode(bytes, { stream: true });
      frameBytes += bytes.byteLength;
      if (frameBytes > MAX_FRAME_BYTES && !buffer.includes("\n")) {
        throw executionError("CODEX_APP_SERVER_FRAME_TOO_LARGE", "Codex returned an oversized frame.");
      }
      let boundary;
      while ((boundary = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 1);
        frameBytes = Buffer.byteLength(buffer);
        if (!line.trim()) continue;
        if (Buffer.byteLength(line) > MAX_FRAME_BYTES) {
          throw executionError("CODEX_APP_SERVER_FRAME_TOO_LARGE", "Codex returned an oversized frame.");
        }
        let message;
        try {
          message = JSON.parse(line);
        } catch {
          throw executionError("CODEX_APP_SERVER_PROTOCOL_INVALID", "Codex returned invalid JSONL.");
        }
        acceptMessage(message);
      }
    } catch (cause) {
      rejectAll(cause instanceof CodexExecutionError
        ? cause
        : executionError("CODEX_APP_SERVER_INVALID_UTF8", "Codex returned invalid UTF-8."));
    }
  };
  child.stdout.on("data", onStdout);
  child.stderr.resume();
  child.once("error", () => rejectAll(executionError(
    "CODEX_APP_SERVER_START_FAILED",
    "Codex App Server could not be started.",
  )));
  void closePromise.then(({ exitCode, signal }) => {
    if (!cleanupRequested && !cleanupConfirmed && !protocolFailure) {
      rejectAll(executionError(
        "CODEX_APP_SERVER_EXITED",
        `Codex App Server exited before cleanup (${exitCode ?? signal ?? "unknown"}).`,
      ));
    }
  });

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (method, params) => {
    if (protocolFailure) return Promise.reject(protocolFailure);
    const id = nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(executionError("CODEX_APP_SERVER_TIMEOUT", `Codex ${method} timed out.`));
      }, requestTimeoutMs);
      timer.unref?.();
      pending.set(id, {
        resolve(value) { clearTimeout(timer); resolve(value); },
        reject(cause) { clearTimeout(timer); reject(cause); },
      });
      send({ method, id, params });
    });
  };
  const abort = () => rejectAll(executionError("CODEX_CANCELLED", "Codex execution was cancelled."));
  if (cancellationSignal?.aborted) abort();
  else cancellationSignal?.addEventListener("abort", abort, { once: true });

  let failure = null;
  try {
    const initialized = await request("initialize", {
      clientInfo: { name: "stemmio", title: "Stemmio", version: "0.1.0" },
    });
    send({ method: "initialized", params: {} });
    onEvent({
      kind: "initialized",
      agentName: "Codex",
      agentVersion: typeof initialized?.userAgent === "string"
        ? initialized.userAgent.slice(0, 120)
        : null,
    });
    const skills = await request("skills/list", { cwds: [cwd], forceReload: true });
    const disabledSkills = disabledSkillConfig(skills);
    const thread = await request("thread/start", {
      cwd,
      ephemeral: true,
      model,
      approvalPolicy: "never",
      sandbox: "workspace-write",
      config: {
        mcp_servers: {},
        skills: { config: disabledSkills },
        web_search: "disabled",
      },
      developerInstructions: [
        "This is one Stemmio page-modification turn.",
        "Do not use MCP, skills, plugins, apps, web, browser, computer use, subagents, or permission requests.",
        "Do not modify any path except the exact Candidate output path named by the user prompt.",
      ].join("\n"),
    });
    identifiers.threadId = thread?.thread?.id;
    if (!SAFE_ID.test(String(identifiers.threadId || ""))) {
      throw executionError("CODEX_THREAD_INVALID", "Codex did not create a valid ephemeral thread.");
    }
    const turn = await request("turn/start", {
      threadId: identifiers.threadId,
      input: [{ type: "text", text: prompt }],
      cwd,
      model,
      effort,
      approvalPolicy: "never",
      sandboxPolicy: {
        type: "workspaceWrite",
        writableRoots: [cwd],
        networkAccess: false,
        excludeTmpdirEnvVar: true,
        excludeSlashTmp: true,
      },
    });
    identifiers.turnId = turn?.turn?.id;
    if (!SAFE_ID.test(String(identifiers.turnId || ""))) {
      throw executionError("CODEX_TURN_INVALID", "Codex did not create a valid turn.");
    }
    const turnTimer = setTimeout(() => rejectTurn(executionError(
      "CODEX_TURN_TIMEOUT",
      "Codex execution timed out.",
    )), turnTimeoutMs);
    turnTimer.unref?.();
    const completed = await turnCompleted.finally(() => clearTimeout(turnTimer));
    if (boundedTurnStatus(completed) !== "completed") {
      throw executionError("CODEX_TURN_FAILED", "Codex did not complete the page modification turn.");
    }
  } catch (cause) {
    failure = cause;
  } finally {
    cancellationSignal?.removeEventListener?.("abort", abort);
    child.stdout.removeListener("data", onStdout);
    child.stdin.end();
    cleanupRequested = true;
    try {
      await terminateManagedProcess(child, { processGroup: process.platform !== "win32" });
      await closePromise.catch(() => {});
      cleanupConfirmed = true;
    } catch {
      failure = executionError(
        "CODEX_APP_SERVER_CLEANUP_UNCONFIRMED",
        "Codex App Server cleanup could not be confirmed.",
      );
    }
    if (preparedCommand) {
      await preparedCommand.cleanup().catch(() => {
        failure = executionError(
          "CODEX_APP_SERVER_CLEANUP_UNCONFIRMED",
          "The verified Codex runtime snapshot could not be removed.",
        );
      });
    }
  }
  if (failure) {
    await host.cancel().catch(() => {});
    await host.dispose().catch(() => {});
    throw failure;
  }

  try {
    await assertUniqueCandidateOutput(policy);
    const requestParams = finalizerRequest(policy, sessionId);
    const terminal = await host.createTerminal(requestParams);
    const status = await host.waitForTerminalExit({
      sessionId,
      terminalId: terminal.terminalId,
    });
    if (status?.exitCode !== 0 || status?.signal) {
      throw executionError("CODEX_FINALIZER_FAILED", "The fixed Candidate finalizer failed.");
    }
    const result = await host.assertTurnCompleted();
    onEvent({ kind: "completion", status: result.status });
    return result;
  } finally {
    await host.dispose();
  }
}

export function createCodexAppServerRuntime({ runTask = runCodexAppServerTask } = {}) {
  if (typeof runTask !== "function") throw new TypeError("Codex App Server runtime requires runTask().");
  return defineAgentRuntime({
    runtimeId: "app-server",
    run(launch) {
      if (!launch || typeof launch !== "object" || Array.isArray(launch)) {
        throw new TypeError("Codex App Server runtime requires a launch descriptor.");
      }
      assertAgentSecurityProfile(launch.securityProfile, "Codex launch securityProfile");
      if (launch.securityProfile !== "agent-native") {
        throw executionError(
          "AGENT_SECURITY_PROFILE_MISMATCH",
          "Codex App Server requires the agent-native security profile.",
          { status: 409 },
        );
      }
      return runTask(launch);
    },
  });
}

export const codexAppServerRuntime = createCodexAppServerRuntime();
