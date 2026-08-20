import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  access,
  constants as fsConstants,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  unlink,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import semver from "semver";

import { LifecycleError, sha256 } from "./lifecycle-core.mjs";
import {
  loadQoderAcpTaskPolicy,
  qoderAcpEnvironment,
  runQoderAcpTask,
  runVerifiedQoderJavaScript,
} from "./qoder-acp-client.mjs";

export const TRUSTED_LOCAL_AGENT_POLICY_VERSION = "trusted-local-agent-v1";

const DRIVER = "qoder-acp";
const MIN_QODER_VERSION = "1.1.27";
const PREFLIGHT_TTL_MS = 2 * 60_000;
const TERMINAL_SESSION_TTL_MS = 30 * 60_000;
const MAX_RETAINED_SESSIONS = 100;
const MAX_PREFLIGHT_TICKETS = 20;
const MAX_PUBLIC_SESSION_EVENTS = 2_048;
const CANCEL_TIMEOUT_MS = 12_000;
const AGENT_LEASE_DIRECTORY = "agent-bridge-leases";
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;
const execFileAsync = promisify(execFile);

export class AgentBridgeError extends LifecycleError {
  constructor(code, message, { status = 422, details } = {}) {
    super(code, message, details, status);
    this.name = "AgentBridgeError";
  }
}

function fail(code, message, options) {
  throw new AgentBridgeError(code, message, options);
}

function cleanText(value, maxLength = 160) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, maxLength);
}

function nowIso(clock) {
  return new Date(Math.max(0, Number(clock.now()) || 0)).toISOString();
}

function validateDriver(value) {
  if (value !== DRIVER) {
    fail("AGENT_DRIVER_UNSUPPORTED", "当前只支持 Qoder CLI 的 ACP 驱动。", { status: 400 });
  }
  return value;
}

function validateTrustPolicy(value) {
  if (value !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
    fail(
      "AGENT_TRUST_POLICY_REQUIRED",
      "启动 Qoder CLI 前必须确认可信本机 Agent 策略。",
      { status: 409 },
    );
  }
  return value;
}

function validateIdentity(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("AGENT_TASK_IDENTITY_INVALID", "Agent 任务身份无效。", { status: 400 });
  }
  const identity = {
    projectId: cleanText(value.projectId),
    documentId: cleanText(value.documentId),
    requestId: cleanText(value.requestId),
    attemptId: cleanText(value.attemptId),
    sourcePath: typeof value.sourcePath === "string" ? value.sourcePath : "",
  };
  if (
    !PROJECT_ID.test(identity.projectId)
    || !DOCUMENT_ID.test(identity.documentId)
    || !SAFE_ID.test(identity.requestId)
    || !SAFE_ID.test(identity.attemptId)
    || !path.isAbsolute(identity.sourcePath)
    || identity.sourcePath.includes("\0")
  ) {
    fail("AGENT_TASK_IDENTITY_INVALID", "Agent 任务身份无效。", { status: 400 });
  }
  return Object.freeze(identity);
}

function taskKey(identity) {
  return [
    identity.projectId,
    identity.documentId,
    identity.requestId,
    identity.attemptId,
  ].join(":");
}

function leasePathForTask(requestPath, identity) {
  const requestRoot = path.resolve(String(requestPath || ""));
  const requestsRoot = path.dirname(requestRoot);
  if (
    !path.isAbsolute(requestRoot)
    || path.basename(requestRoot) !== identity.requestId
    || path.basename(requestsRoot) !== "requests"
  ) {
    fail("AGENT_TASK_POLICY_INVALID", "本轮 Request 路径不能建立安全的 Agent 启动租约。", {
      status: 409,
    });
  }
  const controlRoot = path.dirname(requestsRoot);
  const digest = sha256(Buffer.from(taskKey(identity), "utf8")).replace(/^sha256:/u, "");
  return Object.freeze({
    directory: path.join(controlRoot, AGENT_LEASE_DIRECTORY),
    path: path.join(controlRoot, AGENT_LEASE_DIRECTORY, `${digest}.json`),
  });
}

async function acquireAgentLease({ requestPath, identity, ownerToken, clock }) {
  const target = leasePathForTask(requestPath, identity);
  await mkdir(target.directory, { recursive: true, mode: 0o700 });
  const directoryInformation = await lstat(target.directory).catch(() => null);
  if (
    !directoryInformation?.isDirectory()
    || directoryInformation.isSymbolicLink()
    || (directoryInformation.mode & 0o022) !== 0
  ) {
    fail("AGENT_LEASE_UNSAFE", "Agent 启动租约目录不安全，PageRoot 没有启动 Qoder。", {
      status: 409,
    });
  }
  let handle;
  try {
    handle = await open(
      target.path,
      fsConstants.O_WRONLY
        | fsConstants.O_CREAT
        | fsConstants.O_EXCL
        | (fsConstants.O_NOFOLLOW || 0),
      0o600,
    );
  } catch (cause) {
    if (cause?.code === "EEXIST") {
      fail(
        "AGENT_RESTART_RECOVERY_REQUIRED",
        "Bridge 上次退出后无法证明旧 Qoder 会话已经停止。请结束本轮，再重新发送为新的 Request。",
        { status: 409 },
      );
    }
    fail("AGENT_LEASE_UNAVAILABLE", "Agent 启动租约无法安全建立，PageRoot 没有启动 Qoder。", {
      status: 409,
    });
  }
  try {
    await handle.writeFile(`${JSON.stringify({
      schemaVersion: 1,
      kind: "qoder-agent-lease",
      projectId: identity.projectId,
      documentId: identity.documentId,
      requestId: identity.requestId,
      attemptId: identity.attemptId,
      ownerToken,
      bridgePid: process.pid,
      createdAt: nowIso(clock),
    })}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  return Object.freeze({ ...target, ownerToken });
}

async function releaseAgentLease(lease) {
  if (!lease?.path || !lease.ownerToken) return false;
  let handle;
  try {
    handle = await open(
      lease.path,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW || 0),
    );
    const information = await handle.stat();
    if (!information.isFile() || information.nlink !== 1) return false;
    const record = JSON.parse(await handle.readFile("utf8"));
    if (record?.ownerToken !== lease.ownerToken) return false;
  } catch {
    return false;
  } finally {
    await handle?.close().catch(() => {});
  }
  return unlink(lease.path).then(() => true, () => false);
}

const DEFAULT_AGENT_LEASE_STORE = Object.freeze({
  acquire: acquireAgentLease,
  release: releaseAgentLease,
});

async function taskHasResidue(policy) {
  const exists = async (filePath) => lstat(filePath).then(
    () => true,
    (cause) => cause?.code !== "ENOENT",
  );
  const [output, completion] = await Promise.all([
    exists(policy.outputPath),
    exists(policy.completionPath),
  ]);
  return output || completion;
}

function qoderFailure(code) {
  switch (code) {
    case "QODER_AUTH_REQUIRED":
      return "Qoder CLI 尚未登录。请先在 Qoder CLI 完成登录，再重试本轮。";
    case "QODER_ACCOUNT_CAPACITY_UNAVAILABLE":
    case "QODER_CAPACITY_UNAVAILABLE":
      return "Qoder 账号当前没有可用模型容量。本轮 Request 已保留，可稍后重试或复制给其他 Agent。";
    case "QODER_COMMAND_NOT_FOUND":
      return "没有找到独立安装的 Qoder CLI。请先安装 Qoder CLI，或改用复制任务。";
    case "QODER_COMMAND_UNTRUSTED":
      return "找到的 Qoder CLI 不符合独立安装校验，PageRoot 没有启动它。";
    case "ACP_CANCELLED":
      return "Qoder 已停止。";
    case "ACP_AGENT_IDENTITY_MISMATCH":
      return "ACP 进程没有证明自己是 Qoder CLI，PageRoot 已停止它。";
    case "ACP_RUNTIME_AUTHORITY_DRIFT":
      return "本轮 Request 权限已经变化，Qoder 的后续写入已被拒绝。";
    case "AGENT_RETRY_OUTPUT_PRESENT":
      return "本轮已留下未最终化输出，PageRoot 不会覆盖或转交同一路径。请结束本轮后重新发送。";
    case "AGENT_RESTART_RECOVERY_REQUIRED":
      return "Bridge 上次退出后无法证明旧 Qoder 会话已经停止。请结束本轮，再重新发送为新的 Request。";
    default:
      return "Qoder CLI 没有完成本轮任务。Request 与当前 HTML 均已保留。";
  }
}

function qoderPreflightFailure(code) {
  switch (code) {
    case "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED":
      return "Qoder 预检进程未确认停止。PageRoot 尚未创建本轮 Request；为避免失去控制，本次不能继续，应用也不会退出。";
    case "QODER_AUTH_REQUIRED":
      return "Qoder CLI 尚未登录。PageRoot 尚未创建本轮 Request；请先完成登录，再重试或改用复制任务。";
    case "QODER_COMMAND_NOT_FOUND":
      return "没有找到独立安装的 Qoder CLI。PageRoot 尚未创建本轮 Request；请先安装，或改用复制任务。";
    case "QODER_COMMAND_UNTRUSTED":
      return "找到的 Qoder CLI 不符合独立安装校验。PageRoot 尚未创建本轮 Request，也没有启动该命令。";
    case "QODER_COMMAND_CHANGED":
      return "Qoder CLI 在预检期间发生变化。PageRoot 尚未创建本轮 Request，也没有启动变化后的命令。";
    case "QODER_VERSION_INVALID":
      return "Qoder CLI 没有返回可验证的版本号。PageRoot 尚未创建本轮 Request；请更新或重新安装后再试。";
    case "QODER_VERSION_MISMATCH":
      return "Qoder CLI 版本与独立安装清单不一致。PageRoot 尚未创建本轮 Request；请重新安装后再试。";
    case "QODER_ACCOUNT_CAPACITY_UNAVAILABLE":
    case "QODER_CAPACITY_UNAVAILABLE":
      return "Qoder 账号当前没有可用模型容量。PageRoot 尚未创建本轮 Request；当前 HTML 和评论保持不变，可稍后重试或改用复制任务。";
    case "QODER_PREFLIGHT_TIMEOUT":
      return "Qoder CLI 预检超时。PageRoot 尚未创建本轮 Request；当前 HTML 和评论保持不变，可重试或改用复制任务。";
    default:
      return "Qoder CLI 预检没有完成。PageRoot 尚未创建本轮 Request；当前 HTML 和评论保持不变，可重试或改用复制任务。";
  }
}

function normalizedPreflightError(cause) {
  const code = cause instanceof AgentBridgeError
    ? cleanText(cause.code, 120) || "QODER_PREFLIGHT_FAILED"
    : "QODER_COMMAND_UNTRUSTED";
  const status = code === "QODER_AUTH_REQUIRED"
    ? 401
    : code === "QODER_COMMAND_NOT_FOUND"
      ? 404
      : Number.isSafeInteger(cause?.status)
        ? cause.status
        : 503;
  return new AgentBridgeError(code, qoderPreflightFailure(code), { status });
}

function classifyPreflightFailure(cause) {
  const combined = `${cause?.stdout || ""}\n${cause?.stderr || ""}\n${cause?.message || ""}`;
  if (/not logged in|sign in|login required|unauthenticated/iu.test(combined)) {
    return "QODER_AUTH_REQUIRED";
  }
  if (/capacity|quota|no available model|model unavailable/iu.test(combined)) {
    return "QODER_CAPACITY_UNAVAILABLE";
  }
  if (cause?.killed || cause?.code === "ETIMEDOUT" || cause?.signal === "SIGTERM") {
    return "QODER_PREFLIGHT_TIMEOUT";
  }
  return "QODER_PREFLIGHT_FAILED";
}

function classifyRunFailure(cause) {
  const combined = `${cause?.message || ""}\n${cause?.qoderStderr || ""}`;
  if (/not logged in|sign in|login required|unauthenticated/iu.test(combined)) {
    return "QODER_AUTH_REQUIRED";
  }
  if (/capacity|quota|no available model|model unavailable/iu.test(combined)) {
    return "QODER_ACCOUNT_CAPACITY_UNAVAILABLE";
  }
  return cleanText(cause?.code, 120) || "QODER_ACP_RUN_FAILED";
}

function commandCandidates(environment, homeDirectory) {
  const values = [
    path.join(homeDirectory, ".npm-global", "bin", "qodercli"),
    path.join(homeDirectory, ".local", "bin", "qodercli"),
    "/opt/homebrew/bin/qodercli",
    "/usr/local/bin/qodercli",
  ];
  for (const directory of String(environment.PATH || "").split(path.delimiter)) {
    if (!directory || !path.isAbsolute(directory)) continue;
    values.push(path.join(directory, "qodercli"));
  }
  return [...new Set(values)];
}

async function fileIdentity(filePath) {
  try {
    const information = await lstat(filePath);
    if (
      !information.isFile()
      || information.isSymbolicLink()
      || information.nlink !== 1
      || (information.mode & 0o022) !== 0
    ) {
      fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI executable is not a protected regular file.");
    }
    await access(filePath, fsConstants.X_OK).catch(() => {
      fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI executable is not executable.");
    });
    const bytes = await readFile(filePath);
    return Object.freeze({
      dev: information.dev,
      ino: information.ino,
      nlink: information.nlink,
      size: information.size,
      mtimeMs: information.mtimeMs,
      sha256: sha256(bytes),
    });
  } catch (cause) {
    if (cause instanceof AgentBridgeError) throw cause;
    fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI executable identity could not be verified.");
  }
}

async function validateNpmQoderCommand(candidate) {
  let executable;
  try {
    executable = await realpath(candidate);
  } catch {
    return null;
  }
  if (/\.app\/Contents\//u.test(executable)) {
    fail(
      "QODER_COMMAND_UNTRUSTED",
      "PageRoot 不会使用 Qoder 桌面应用内置的 CLI；请独立安装 Qoder CLI。",
    );
  }
  if (path.basename(executable) !== "qodercli.js" || path.basename(path.dirname(executable)) !== "bundle") {
    return null;
  }
  const packageRoot = path.dirname(path.dirname(executable));
  let manifest;
  try {
    manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  } catch {
    return null;
  }
  if (
    manifest?.name !== "@qoder-ai/qodercli"
    || manifest?.bin?.qodercli !== "bundle/qodercli.js"
    || !semver.valid(manifest?.version)
    || semver.lt(manifest.version, MIN_QODER_VERSION)
  ) {
    fail(
      "QODER_COMMAND_UNTRUSTED",
      `独立 Qoder CLI 必须是 @qoder-ai/qodercli ${MIN_QODER_VERSION} 或更高版本。`,
    );
  }
  const [identity, packageInformation] = await Promise.all([
    fileIdentity(executable),
    lstat(packageRoot).catch(() => {
      fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI package directory could not be verified.");
    }),
  ]);
  if (!packageInformation.isDirectory() || (packageInformation.mode & 0o022) !== 0) {
    fail("QODER_COMMAND_UNTRUSTED", "Qoder CLI package directory is writable by other users.");
  }
  return Object.freeze({
    command: executable,
    version: manifest.version,
    identity,
    source: "verified-npm-package",
  });
}

export async function resolveQoderAcpCommand({
  environment = process.env,
  homeDirectory = os.homedir(),
} = {}) {
  const configured = cleanText(environment.PAGEROOT_QODER_ACP_COMMAND, 4_096);
  const testOverride = configured
    && environment.PAGEROOT_E2E === "1"
    && environment.PAGEROOT_QODER_ACP_ALLOW_TEST_COMMAND === "1";
  if (configured && !testOverride) {
    fail(
      "QODER_COMMAND_UNTRUSTED",
      "PAGEROOT_QODER_ACP_COMMAND 只允许用于显式 E2E 测试。",
    );
  }
  if (testOverride) {
    if (!path.isAbsolute(configured)) {
      fail("QODER_COMMAND_UNTRUSTED", "测试 Qoder 命令必须是绝对路径。");
    }
    const executable = await realpath(configured).catch(() => null);
    if (!executable) fail("QODER_COMMAND_NOT_FOUND", "测试 Qoder 命令不存在。");
    return Object.freeze({
      command: executable,
      version: null,
      identity: await fileIdentity(executable),
      source: "e2e-override",
    });
  }

  for (const candidate of commandCandidates(environment, homeDirectory)) {
    const resolved = await validateNpmQoderCommand(candidate);
    if (resolved) return resolved;
  }
  fail(
    "QODER_COMMAND_NOT_FOUND",
    "没有找到独立安装的 Qoder CLI。",
    { status: 404 },
  );
}

async function assertCommandUnchanged(command) {
  const current = await fileIdentity(command.command);
  if (
    current.dev !== command.identity.dev
    || current.ino !== command.identity.ino
    || current.nlink !== command.identity.nlink
    || current.size !== command.identity.size
    || current.mtimeMs !== command.identity.mtimeMs
    || current.sha256 !== command.identity.sha256
  ) {
    fail("QODER_COMMAND_CHANGED", "Qoder CLI 在预检后发生变化，PageRoot 没有启动它。", {
      status: 409,
    });
  }
}

async function executePreflightCommand(command, args, environment, timeout) {
  if (command.source === "verified-npm-package") {
    return runVerifiedQoderJavaScript({
      command: command.command,
      expectedExecutable: {
        path: command.command,
        identity: command.identity,
      },
      args,
      baseEnvironment: environment,
      timeoutMs: timeout,
      maxBuffer: 128 * 1024,
    });
  }
  return execFileAsync(command.command, args, {
    env: qoderAcpEnvironment({}, environment),
    encoding: "utf8",
    timeout,
    maxBuffer: 128 * 1024,
    windowsHide: true,
  });
}

async function preflightQoder(command, environment) {
  try {
    const versionResult = await executePreflightCommand(
      command,
      ["--version"],
      environment,
      10_000,
    );
    const reportedVersion = cleanText(versionResult.stdout, 80).split(/\s+/u)[0];
    if (!semver.valid(reportedVersion)) {
      fail("QODER_VERSION_INVALID", "Qoder CLI 没有返回可验证的版本号。");
    }
    if (command.version && reportedVersion !== command.version) {
      fail("QODER_VERSION_MISMATCH", "Qoder CLI 版本与安装清单不一致。");
    }
    const modelResult = await executePreflightCommand(
      command,
      ["--list-models"],
      environment,
      30_000,
    );
    const models = String(modelResult.stdout || "")
      .split(/\r?\n/u)
      .map((line) => cleanText(line, 160))
      .filter((line) => line && line.toUpperCase() !== "MODEL");
    if (models.length === 0) {
      fail("QODER_CAPACITY_UNAVAILABLE", "Qoder 当前没有返回可用模型。");
    }
    return Object.freeze({ version: reportedVersion, modelCount: models.length });
  } catch (cause) {
    const code = cause?.code === "ACP_PREFLIGHT_CLEANUP_UNCONFIRMED"
      ? "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED"
      : cause instanceof AgentBridgeError
        ? cause.code
        : classifyPreflightFailure(cause);
    fail(code, qoderPreflightFailure(code), {
      status: code === "QODER_AUTH_REQUIRED"
        ? 401
        : Number.isSafeInteger(cause?.status)
          ? cause.status
          : 503,
    });
  }
}

function finalizerPrompt(policy) {
  const terminalRequest = {
    command: policy.finalizer.command,
    args: [...policy.finalizer.args],
    cwd: policy.finalizer.cwd,
    env: Object.entries(policy.finalizer.env).map(([name, value]) => ({ name, value })),
  };
  return [
    "Complete this single frozen PageRoot task.",
    `Read ${policy.manifestPath} and then every file in its exact readOrder.`,
    `Follow ${policy.promptPath}.`,
    `Write one complete HTML document only to ${policy.outputPath}.`,
    "Then invoke ACP terminal/create exactly once with this JSON request:",
    JSON.stringify(terminalRequest),
    "Do not use a shell wrapper or write any other path.",
    "The result remains a Candidate pending PageRoot review and must not replace the Working Copy.",
  ].join("\n");
}

function publicSession(entry) {
  if (!entry) return null;
  return Object.freeze({
    driver: DRIVER,
    state: entry.state,
    phase: entry.phase,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    agentName: entry.agentName || null,
    agentVersion: entry.agentVersion || null,
    eventCount: entry.eventCount,
    retryable: entry.retryable === true,
    ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    ...(entry.errorMessage ? { errorMessage: entry.errorMessage } : {}),
  });
}

function phaseForEvent(event, current) {
  switch (event?.kind) {
    case "initialized": return "starting-session";
    case "file-read": return "reading-task";
    case "file-written": return "writing-candidate";
    case "terminal-created": return "finalizing";
    case "completion-verified":
    case "turn-stopping":
    case "turn-stopped": return "awaiting-validation";
    case "host-cancelling": return "cancelling";
    default: return current;
  }
}

export class AgentBridgeService {
  #resolveTask;
  #environment;
  #clock;
  #commandResolver;
  #policyLoader;
  #runTask;
  #preflightRunner;
  #leaseStore;
  #cancelTimeoutMs;
  #terminalSessionTtlMs;
  #maxRetainedSessions;
  #tickets = new Map();
  #sessions = new Map();
  #ownerToken = `agent_owner_${randomUUID().replaceAll("-", "")}`;
  #disposed = false;
  #disposePromise = null;
  #shutdownConfirmed = false;
  #preflightCleanupUnconfirmed = false;

  constructor({
    resolveTask,
    environment = process.env,
    clock = Date,
    commandResolver = resolveQoderAcpCommand,
    policyLoader = loadQoderAcpTaskPolicy,
    runTask = runQoderAcpTask,
    preflightRunner = preflightQoder,
    leaseStore = DEFAULT_AGENT_LEASE_STORE,
    cancelTimeoutMs = CANCEL_TIMEOUT_MS,
    terminalSessionTtlMs = TERMINAL_SESSION_TTL_MS,
    maxRetainedSessions = MAX_RETAINED_SESSIONS,
  } = {}) {
    if (typeof resolveTask !== "function") {
      throw new TypeError("AgentBridgeService requires a task authority resolver.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("AgentBridgeService requires a ClockPort.");
    }
    if (typeof preflightRunner !== "function") {
      throw new TypeError("AgentBridgeService requires a Qoder preflight runner.");
    }
    if (
      !leaseStore
      || typeof leaseStore.acquire !== "function"
      || typeof leaseStore.release !== "function"
    ) {
      throw new TypeError("AgentBridgeService requires an AgentLeaseStore.");
    }
    if (!Number.isSafeInteger(cancelTimeoutMs) || cancelTimeoutMs <= 0) {
      throw new TypeError("AgentBridgeService cancel timeout must be a positive integer.");
    }
    if (!Number.isSafeInteger(terminalSessionTtlMs) || terminalSessionTtlMs <= 0) {
      throw new TypeError("AgentBridgeService terminal-session TTL must be a positive integer.");
    }
    if (!Number.isSafeInteger(maxRetainedSessions) || maxRetainedSessions <= 0) {
      throw new TypeError("AgentBridgeService retained-session limit must be a positive integer.");
    }
    this.#resolveTask = resolveTask;
    this.#environment = environment;
    this.#clock = clock;
    this.#commandResolver = commandResolver;
    this.#policyLoader = policyLoader;
    this.#runTask = runTask;
    this.#preflightRunner = preflightRunner;
    this.#leaseStore = leaseStore;
    this.#cancelTimeoutMs = cancelTimeoutMs;
    this.#terminalSessionTtlMs = terminalSessionTtlMs;
    this.#maxRetainedSessions = maxRetainedSessions;
  }

  #prune() {
    const now = this.#clock.now();
    for (const [ticketId, ticket] of this.#tickets) {
      if (ticket.expiresAt <= now) this.#tickets.delete(ticketId);
    }
    const terminal = [...this.#sessions.entries()]
      .filter(([, entry]) => (
        !["starting", "running", "cancelling"].includes(entry.state)
        // keepLease means process-group cleanup was never confirmed. That is
        // a safety fence, not presentation history, and must survive both TTL
        // and capacity pruning until the Bridge itself is retired.
        && entry.keepLease !== true
      ))
      .sort((left, right) => left[1].updatedAtMs - right[1].updatedAtMs);
    for (const [key, entry] of terminal) {
      if (
        this.#sessions.size <= this.#maxRetainedSessions
        && entry.updatedAtMs + this.#terminalSessionTtlMs > now
      ) break;
      this.#sessions.delete(key);
    }
  }

  async preflight({ driver, trustPolicyAccepted } = {}) {
    if (this.#disposed) fail("AGENT_BRIDGE_DISPOSED", "Agent Bridge 已停止。", { status: 503 });
    if (this.#preflightCleanupUnconfirmed) {
      fail(
        "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
        qoderPreflightFailure("AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED"),
        { status: 503 },
      );
    }
    validateDriver(driver);
    validateTrustPolicy(trustPolicyAccepted);
    this.#prune();
    let command;
    let evidence;
    try {
      command = await this.#commandResolver({ environment: this.#environment });
      evidence = await this.#preflightRunner(command, this.#environment);
      await assertCommandUnchanged(command);
    } catch (cause) {
      const error = normalizedPreflightError(cause);
      if (error.code === "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED") {
        this.#preflightCleanupUnconfirmed = true;
      }
      throw error;
    }
    const preflightId = `preflight_${randomUUID().replaceAll("-", "")}`;
    const createdAt = this.#clock.now();
    while (this.#tickets.size >= MAX_PREFLIGHT_TICKETS) {
      this.#tickets.delete(this.#tickets.keys().next().value);
    }
    this.#tickets.set(preflightId, Object.freeze({
      preflightId,
      command,
      evidence,
      createdAt,
      expiresAt: createdAt + PREFLIGHT_TTL_MS,
    }));
    return Object.freeze({
      ok: true,
      status: "ready",
      driver: DRIVER,
      preflightId,
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      agentVersion: evidence.version,
      modelCount: evidence.modelCount,
      expiresAt: new Date(createdAt + PREFLIGHT_TTL_MS).toISOString(),
    });
  }

  async submit({
    driver,
    trustPolicyAccepted,
    preflightId,
    ...identityInput
  } = {}) {
    if (this.#disposed) fail("AGENT_BRIDGE_DISPOSED", "Agent Bridge 已停止。", { status: 503 });
    validateDriver(driver);
    validateTrustPolicy(trustPolicyAccepted);
    const identity = validateIdentity(identityInput);
    this.#prune();
    const key = taskKey(identity);
    const existing = this.#sessions.get(key);
    if (existing && ["starting", "running", "cancelling", "completed"].includes(existing.state)) {
      return { ok: true, accepted: false, idempotent: true, session: publicSession(existing) };
    }
    if (existing && existing.retryable !== true) {
      fail(
        existing.errorCode || "AGENT_RETRY_BLOCKED",
        existing.errorMessage || "本轮 Qoder 会话不能安全重试。请结束本轮后重新发送。",
        { status: 409 },
      );
    }
    const ticket = this.#tickets.get(preflightId);
    if (!ticket || ticket.expiresAt <= this.#clock.now()) {
      this.#tickets.delete(preflightId);
      fail("AGENT_PREFLIGHT_EXPIRED", "Qoder 预检已过期，请重新确认后启动。", { status: 409 });
    }
    this.#tickets.delete(preflightId);
    await assertCommandUnchanged(ticket.command);

    const task = await this.#resolveTask(identity);
    if (!task?.run || task.run.status !== "processing") {
      fail("AGENT_TASK_NOT_PROCESSING", "当前 Request 已不再等待 Agent 处理。", { status: 409 });
    }
    if (
      task.run.projectId !== identity.projectId
      || task.run.documentId !== identity.documentId
      || task.run.requestId !== identity.requestId
      || task.run.attemptId !== identity.attemptId
      || task.run.sourcePath !== identity.sourcePath
    ) {
      fail("AGENT_TASK_IDENTITY_MISMATCH", "Request authority 与 Agent 任务身份不一致。", {
        status: 409,
      });
    }
    if (
      task.request?.request?.agentDelivery?.mode !== DRIVER
      || task.request?.request?.agentDelivery?.trustPolicyVersion
        !== TRUSTED_LOCAL_AGENT_POLICY_VERSION
    ) {
      fail("AGENT_DELIVERY_NOT_AUTHORIZED", "本轮 Request 没有授权 Qoder ACP 自动执行。", {
        status: 409,
      });
    }

    let policy;
    try {
      policy = await this.#policyLoader({
        requestPath: task.run.requestPath,
        promptPath: task.run.promptPath,
        outputPath: task.run.outputPath,
        completionPath: task.run.completionPath,
      });
    } catch (cause) {
      const code = cleanText(cause?.code, 120) || "AGENT_TASK_POLICY_INVALID";
      if (code === "ACP_OUTPUT_PREEXISTS" || code === "ACP_COMPLETION_PREEXISTS") {
        fail(
          "AGENT_RETRY_OUTPUT_PRESENT",
            qoderFailure("AGENT_RETRY_OUTPUT_PRESENT"),
          { status: 409 },
        );
      }
      fail(
        "AGENT_TASK_POLICY_INVALID",
        "本轮冻结资料或运行权限不再满足 Qoder ACP 启动条件。",
        { status: 409, details: { reasonCode: code } },
      );
    }
    const lease = existing?.lease || await this.#leaseStore.acquire({
      requestPath: task.run.requestPath,
      identity,
      ownerToken: this.#ownerToken,
      clock: this.#clock,
    });
    const startedAtMs = this.#clock.now();
    const controller = new AbortController();
    const entry = {
      identity,
      state: "starting",
      phase: "launching",
      startedAt: nowIso(this.#clock),
      updatedAt: nowIso(this.#clock),
      updatedAtMs: startedAtMs,
      agentName: null,
      agentVersion: ticket.evidence.version,
      eventCount: 0,
      errorCode: null,
      errorMessage: null,
      retryable: false,
      lease,
      keepLease: false,
      controller,
      promise: null,
    };
    this.#sessions.set(key, entry);

    const observe = (event) => {
      if (this.#sessions.get(key) !== entry) return;
      entry.eventCount = Math.min(MAX_PUBLIC_SESSION_EVENTS, entry.eventCount + 1);
      entry.phase = phaseForEvent(event, entry.phase);
      if (event?.kind === "initialized") {
        entry.state = "running";
        entry.agentName = cleanText(event.agentName) || "Qoder CLI";
        entry.agentVersion = cleanText(event.agentVersion) || entry.agentVersion;
      }
      entry.updatedAtMs = this.#clock.now();
      entry.updatedAt = nowIso(this.#clock);
    };

    entry.promise = Promise.resolve().then(() => this.#runTask({
      command: ticket.command.command,
      expectedExecutable: {
        path: ticket.command.command,
        identity: ticket.command.identity,
      },
      args: ["--acp"],
      policy,
      prompt: finalizerPrompt(policy),
      environment: {},
      baseEnvironment: this.#environment,
      useVerifiedJavaScriptRuntime: ticket.command.source === "verified-npm-package",
      cancellationSignal: controller.signal,
      expectedAgentName: ticket.command.source === "e2e-override"
        ? /qoder|pageroot-e2e/iu
        : /qoder/iu,
      onEvent: observe,
    })).then(() => {
      if (this.#sessions.get(key) !== entry) return;
      entry.state = "completed";
      entry.phase = "awaiting-validation";
      entry.updatedAtMs = this.#clock.now();
      entry.updatedAt = nowIso(this.#clock);
      entry.retryable = false;
    }).catch(async (cause) => {
      if (this.#sessions.get(key) !== entry) return;
      const residue = await taskHasResidue(policy);
      const cleanupUnconfirmed = cause?.code === "ACP_PROCESS_CLEANUP_UNCONFIRMED";
      const code = residue
        ? "AGENT_RETRY_OUTPUT_PRESENT"
        : cleanupUnconfirmed
          ? "AGENT_RESTART_RECOVERY_REQUIRED"
          : classifyRunFailure(cause);
      entry.state = controller.signal.aborted ? "cancelled" : "failed";
      entry.phase = controller.signal.aborted ? "cancelled" : "failed";
      entry.errorCode = code;
      entry.errorMessage = qoderFailure(code);
      entry.retryable = !controller.signal.aborted && !residue && !cleanupUnconfirmed;
      entry.keepLease = cleanupUnconfirmed;
      entry.updatedAtMs = this.#clock.now();
      entry.updatedAt = nowIso(this.#clock);
    }).finally(async () => {
      if (!entry.keepLease) {
        await this.#leaseStore.release(entry.lease);
        entry.lease = null;
      }
    });
    void entry.promise.catch(() => {});
    return { ok: true, accepted: true, idempotent: false, session: publicSession(entry) };
  }

  status(identityInput) {
    const identity = validateIdentity(identityInput);
    this.#prune();
    return publicSession(this.#sessions.get(taskKey(identity)));
  }

  interrupted(identityInput) {
    validateIdentity(identityInput);
    const timestamp = nowIso(this.#clock);
    return Object.freeze({
      driver: DRIVER,
      state: "interrupted",
      phase: "interrupted",
      startedAt: null,
      updatedAt: timestamp,
      agentName: null,
      agentVersion: null,
      eventCount: 0,
      retryable: false,
      errorCode: "AGENT_RESTART_RECOVERY_REQUIRED",
      errorMessage: qoderFailure("AGENT_RESTART_RECOVERY_REQUIRED"),
    });
  }

  async cancel(identityInput) {
    const identity = validateIdentity(identityInput);
    const entry = this.#sessions.get(taskKey(identity));
    if (!entry || !["starting", "running", "cancelling"].includes(entry.state)) {
      return { ok: true, stopped: false, session: publicSession(entry) };
    }
    entry.state = "cancelling";
    entry.phase = "cancelling";
    entry.updatedAtMs = this.#clock.now();
    entry.updatedAt = nowIso(this.#clock);
    entry.controller.abort(new AgentBridgeError("ACP_CANCELLED", "Cancelled by PageRoot."));
    let timeoutHandle;
    const timeout = new Promise((_resolve, reject) => {
      timeoutHandle = setTimeout(() => reject(new AgentBridgeError(
        "AGENT_CANCEL_UNCONFIRMED",
        "Qoder 进程没有在限定时间内确认停止。",
        { status: 503 },
      )), this.#cancelTimeoutMs);
      timeoutHandle.unref?.();
    });
    try {
      await Promise.race([entry.promise, timeout]);
    } finally {
      clearTimeout(timeoutHandle);
    }
    if (entry.keepLease === true) {
      fail(
        "AGENT_CANCEL_UNCONFIRMED",
        "Qoder 进程停止未被确认。本轮 Request 仍保持处理中，PageRoot 不会解锁或覆盖它。",
        { status: 503 },
      );
    }
    return { ok: true, stopped: true, session: publicSession(entry) };
  }

  async dispose() {
    if (this.#shutdownConfirmed) return;
    if (this.#disposePromise) return this.#disposePromise;
    this.#disposed = true;
    this.#tickets.clear();
    this.#disposePromise = (async () => {
      const running = [...this.#sessions.values()].filter(
        (entry) => ["starting", "running", "cancelling"].includes(entry.state),
      );
      for (const entry of running) {
        entry.controller.abort(new AgentBridgeError("ACP_CANCELLED", "Bridge shutdown."));
      }
      let timeoutHandle;
      const timeout = new Promise((_resolve, reject) => {
        timeoutHandle = setTimeout(() => reject(new AgentBridgeError(
          "AGENT_SHUTDOWN_UNCONFIRMED",
          "PageRoot 无法确认 Qoder 进程已停止；为避免失去控制，本次退出已取消。",
          { status: 503 },
        )), this.#cancelTimeoutMs);
        timeoutHandle.unref?.();
      });
      try {
        await Promise.race([
          Promise.all(running.map((entry) => entry.promise)),
          timeout,
        ]);
      } catch (cause) {
        if (cause instanceof AgentBridgeError && cause.code === "AGENT_SHUTDOWN_UNCONFIRMED") {
          throw cause;
        }
        throw new AgentBridgeError(
          "AGENT_SHUTDOWN_UNCONFIRMED",
          "PageRoot 无法确认 Qoder 进程已停止；为避免失去控制，本次退出已取消。",
          { status: 503 },
        );
      } finally {
        clearTimeout(timeoutHandle);
      }

      const unconfirmed = [...this.#sessions.values()].some((entry) => (
        ["starting", "running", "cancelling"].includes(entry.state)
        || entry.keepLease === true
      )) || this.#preflightCleanupUnconfirmed;
      if (unconfirmed) {
        throw new AgentBridgeError(
          "AGENT_SHUTDOWN_UNCONFIRMED",
          "PageRoot 无法确认 Qoder 进程已停止；为避免失去控制，本次退出已取消。",
          { status: 503 },
        );
      }
      this.#shutdownConfirmed = true;
    })();
    try {
      await this.#disposePromise;
    } finally {
      this.#disposePromise = null;
    }
  }
}
