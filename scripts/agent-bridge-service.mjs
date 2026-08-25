import { randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  lstat,
  mkdir,
  open,
  unlink,
} from "node:fs/promises";
import path from "node:path";

import { sha256 } from "./lifecycle-core.mjs";
import { AgentProviderError as AgentBridgeError } from "./agent/providers/agent-provider-contract.mjs";
import { createDefaultProviderRegistry } from "./agent/providers/provider-registry.mjs";
export { parsePublicModels, resolveQoderAcpCommand } from "./agent/providers/qoder-provider.mjs";
export { AgentBridgeError };

export const TRUSTED_LOCAL_AGENT_POLICY_VERSION = "trusted-local-agent-v1";

const AGENT_VISIBLE_TEXT_LIMIT = 64 * 1024;

const DRIVER = "qoder-acp";
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
    visibleText: entry.visibleText || "",
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
  #providerRegistry;
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
    commandResolver,
    policyLoader,
    runTask,
    preflightRunner,
    providerRegistry,
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
    if (preflightRunner !== undefined && typeof preflightRunner !== "function") {
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
    this.#providerRegistry = providerRegistry || createDefaultProviderRegistry({
      commandResolver,
      ...(policyLoader ? { policyLoader } : {}),
      ...(runTask ? { runTask } : {}),
      ...(preflightRunner ? { preflightRunner } : {}),
    });
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

  async availability() {
    if (this.#disposed) {
      return Object.freeze({
        ok: true,
        status: "unavailable",
        reason: "check-failed",
        driver: DRIVER,
      });
    }
    const result = await this.#providerRegistry.availability({
      driver: DRIVER,
      environment: this.#environment,
    });
    return Object.freeze({ ok: true, ...result, driver: DRIVER });
  }

  async preflight({ driver, trustPolicyAccepted } = {}) {
    if (this.#disposed) fail("AGENT_BRIDGE_DISPOSED", "Agent Bridge 已停止。", { status: 503 });
    if (this.#preflightCleanupUnconfirmed) {
      fail(
        "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
        this.#providerRegistry.preflightFailureMessageForDriver(
          DRIVER,
          "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
        ),
        { status: 503 },
      );
    }
    this.#providerRegistry.resolveDriver(driver);
    validateTrustPolicy(trustPolicyAccepted);
    this.#prune();
    let prepared;
    try {
      prepared = await this.#providerRegistry.preflight({
        driver,
        environment: this.#environment,
      });
    } catch (cause) {
      if (cause?.code === "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED") {
        this.#preflightCleanupUnconfirmed = true;
      }
      throw cause;
    }
    const preflightId = `preflight_${randomUUID().replaceAll("-", "")}`;
    const createdAt = this.#clock.now();
    while (this.#tickets.size >= MAX_PREFLIGHT_TICKETS) {
      this.#tickets.delete(this.#tickets.keys().next().value);
    }
    this.#tickets.set(preflightId, Object.freeze({
      preflightId,
      driver: prepared.driver,
      providerId: prepared.providerId,
      runtimeId: prepared.runtimeId,
      installation: prepared.installation,
      installationDigest: prepared.installationDigest,
      capabilities: prepared.capabilities,
      evidence: prepared.evidence,
      createdAt,
      expiresAt: createdAt + PREFLIGHT_TTL_MS,
    }));
    return Object.freeze({
      ok: true,
      status: "ready",
      driver: DRIVER,
      preflightId,
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      agentVersion: prepared.evidence.version,
      modelCount: prepared.evidence.modelCount,
      models: prepared.evidence.models ?? [],
      expiresAt: new Date(createdAt + PREFLIGHT_TTL_MS).toISOString(),
    });
  }

  // This service owns the one-use preflight ticket store (see
  // docs/STATE_OWNERSHIP.md), so a non-Request use such as a discussion turn
  // redeems the ticket here instead of keeping a second copy of it. The caller
  // receives the verified command only, and the same expiry, one-use and
  // identity-recheck rules apply as for an execution submit.
  async redeemCommandTicket(preflightId) {
    if (this.#disposed) fail("AGENT_BRIDGE_DISPOSED", "Agent Bridge 已停止。", { status: 503 });
    const ticket = this.#tickets.get(preflightId);
    if (!ticket || ticket.expiresAt <= this.#clock.now()) {
      this.#tickets.delete(preflightId);
      fail("AGENT_PREFLIGHT_EXPIRED", "Qoder 预检已过期，请重新确认后启动。", { status: 409 });
    }
    this.#tickets.delete(preflightId);
    return this.#providerRegistry.verifyTicket(ticket);
  }

  async submit({
    driver,
    trustPolicyAccepted,
    preflightId,
    ...identityInput
  } = {}) {
    if (this.#disposed) fail("AGENT_BRIDGE_DISPOSED", "Agent Bridge 已停止。", { status: 503 });
    this.#providerRegistry.resolveDriver(driver);
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
    const ticket = await this.redeemCommandTicket(preflightId);

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
      task.request?.request?.agentDelivery?.mode !== ticket.driver
      || task.request?.request?.agentDelivery?.trustPolicyVersion
        !== TRUSTED_LOCAL_AGENT_POLICY_VERSION
    ) {
      fail("AGENT_DELIVERY_NOT_AUTHORIZED", "本轮 Request 没有授权 Qoder ACP 自动执行。", {
        status: 409,
      });
    }

    let policy;
    try {
      policy = await this.#providerRegistry.loadExecutionPolicy(ticket, {
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
            this.#providerRegistry.failureMessage(ticket, "AGENT_RETRY_OUTPUT_PRESENT"),
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
      visibleText: "",
    };
    this.#sessions.set(key, entry);

    const observe = (event) => {
      if (this.#sessions.get(key) !== entry) return;
      entry.eventCount = Math.min(MAX_PUBLIC_SESSION_EVENTS, entry.eventCount + 1);
      entry.phase = phaseForEvent(event, entry.phase);
      // ADR 0037: what the Agent says while it works, kept bounded here as well as in
      // the driver so a misbehaving Agent cannot grow this session record without
      // limit. It is narration only and never affects the Candidate verdict.
      if (event?.kind === "visible-text" && typeof event.text === "string") {
        const room = AGENT_VISIBLE_TEXT_LIMIT - entry.visibleText.length;
        if (room > 0) {
          /*
           * Chunk boundaries are not word boundaries. Joining them raw produced
           * "structure.Now" and "sequence.I've", so a sentence that ended one chunk ran
           * into the one that began the next. A single space is added only where the
           * seam is unambiguous: a sentence end meeting a new sentence's start. Code,
           * URLs and CJK text never match that shape and are left exactly as sent.
           */
          const seamNeedsSpace =
            /[.!?]$/u.test(entry.visibleText) && /^[A-Z`]/u.test(event.text);
          if (seamNeedsSpace && room > 1) entry.visibleText += " ";
          const left = AGENT_VISIBLE_TEXT_LIMIT - entry.visibleText.length;
          if (left > 0) entry.visibleText += event.text.slice(0, left);
        }
      }
      if (event?.kind === "initialized") {
        entry.state = "running";
        entry.agentName = cleanText(event.agentName) || "Qoder CLI";
        entry.agentVersion = cleanText(event.agentVersion) || entry.agentVersion;
      }
      entry.updatedAtMs = this.#clock.now();
      entry.updatedAt = nowIso(this.#clock);
    };

    entry.promise = Promise.resolve().then(() => this.#providerRegistry.run(ticket, {
      policy,
      prompt: finalizerPrompt(policy),
      baseEnvironment: this.#environment,
      cancellationSignal: controller.signal,
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
          : this.#providerRegistry.classifyRunFailure(ticket, cause);
      entry.state = controller.signal.aborted ? "cancelled" : "failed";
      entry.phase = controller.signal.aborted ? "cancelled" : "failed";
      entry.errorCode = code;
      entry.errorMessage = this.#providerRegistry.failureMessage(ticket, code);
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
      errorMessage: this.#providerRegistry.failureMessageForDriver(
        DRIVER,
        "AGENT_RESTART_RECOVERY_REQUIRED",
      ),
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
