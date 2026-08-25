import { createHash, randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { nowIso } from "../lifecycle-core.mjs";
import {
  DISCUSSION_TURN_TIMEOUT_MS,
  discussionPrompt,
  runDiscussionTurn,
} from "../discussion-turn-runner.mjs";
import { createAgentEventReducer, canonicalAgentEvent } from "./agent-events.mjs";
import { cleanAgentText, failAgentRuntime, AgentRuntimeError } from "./agent-errors.mjs";
import { defaultAgentLeaseStore } from "./agent-lease-store.mjs";
import {
  discussionPhaseForEvent,
  executionPhaseForEvent,
  publicDiscussionSession,
  publicExecutionSession,
} from "./agent-session-projector.mjs";
import { createDefaultProviderRegistry } from "./providers/provider-registry.mjs";
import {
  defaultManagedAgentDelivery,
  normalizeAgentDelivery,
} from "../../shared/agent-delivery.mjs";

export const TRUSTED_LOCAL_AGENT_POLICY_VERSION = "trusted-local-agent-v1";

const PREFLIGHT_TTL_MS = 2 * 60_000;
const TERMINAL_SESSION_TTL_MS = 30 * 60_000;
const DISCUSSION_RETENTION_MS = 10 * 60_000;
const MAX_RETAINED_SESSIONS = 100;
const MAX_PREFLIGHT_TICKETS = 20;
const CANCEL_TIMEOUT_MS = 12_000;
const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;
const SAFE_ID = /^[A-Za-z0-9_-]{1,160}$/u;
const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/u;
const LIVE_STATES = new Set(["starting", "running", "cancelling"]);
const PURPOSES = new Set(["execution", "discussion"]);

function validatePurpose(value, fallback = "execution") {
  const purpose = value || fallback;
  if (!PURPOSES.has(purpose)) {
    failAgentRuntime("AGENT_TICKET_PURPOSE_INVALID", "Agent 预检用途无效。", { status: 409 });
  }
  return purpose;
}

function validateTrustPolicy(value, status = 409) {
  if (value !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
    failAgentRuntime("AGENT_TRUST_POLICY_REQUIRED", "启动本机 Agent 前必须确认可信策略。", {
      status,
    });
  }
}

function canonicalSelection(value, trustPolicyVersion) {
  return normalizeAgentDelivery({
    mode: "managed-agent",
    selection: value || defaultManagedAgentDelivery().selection,
    trustPolicyVersion,
  }).selection;
}

function selectionFingerprint(selection) {
  return `sha256:${createHash("sha256").update(JSON.stringify(selection)).digest("hex")}`;
}

function sameSelection(left, right) {
  return selectionFingerprint(left) === selectionFingerprint(right);
}

function validateExecutionIdentity(value) {
  const identity = {
    projectId: cleanAgentText(value?.projectId),
    documentId: cleanAgentText(value?.documentId),
    requestId: cleanAgentText(value?.requestId),
    attemptId: cleanAgentText(value?.attemptId),
    sourcePath: typeof value?.sourcePath === "string" ? value.sourcePath : "",
  };
  if (!PROJECT_ID.test(identity.projectId) || !DOCUMENT_ID.test(identity.documentId)
    || !SAFE_ID.test(identity.requestId) || !SAFE_ID.test(identity.attemptId)
    || !path.isAbsolute(identity.sourcePath) || identity.sourcePath.includes("\0")) {
    failAgentRuntime("AGENT_TASK_IDENTITY_INVALID", "Agent 任务身份无效。", { status: 400 });
  }
  return Object.freeze(identity);
}

function executionKey(identity) {
  return [identity.projectId, identity.documentId, identity.requestId, identity.attemptId].join(":");
}

function discussionKey(documentId) {
  return String(documentId || "");
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

function timeoutAfter(milliseconds, code, message) {
  let handle;
  const promise = new Promise((_resolve, reject) => {
    handle = setTimeout(() => reject(new AgentRuntimeError(code, message, { status: 503 })), milliseconds);
  });
  return { promise, clear: () => clearTimeout(handle) };
}

export class AgentRuntimeCoordinator {
  #resolveTask;
  #environment;
  #clock;
  #providerRegistry;
  #leaseStore;
  #cancelTimeoutMs;
  #terminalSessionTtlMs;
  #discussionRetentionMs;
  #maxRetainedSessions;
  #tickets = new Map();
  #executionSessions = new Map();
  #discussionSessions = new Map();
  #pendingStarts = new Set();
  #eventReducer;
  #ownerToken = `agent_owner_${randomUUID().replaceAll("-", "")}`;
  #acceptingStarts = true;
  #shutdownPromise = null;
  #shutdownConfirmed = false;
  #preflightCleanupUnconfirmed = false;
  #discussion = null;
  #externalRedeemTicket = null;

  constructor({
    resolveTask,
    environment = process.env,
    clock = Date,
    commandResolver,
    policyLoader,
    runTask,
    preflightRunner,
    providerRegistry,
    leaseStore = defaultAgentLeaseStore,
    cancelTimeoutMs = CANCEL_TIMEOUT_MS,
    terminalSessionTtlMs = TERMINAL_SESSION_TTL_MS,
    discussionRetentionMs = DISCUSSION_RETENTION_MS,
    maxRetainedSessions = MAX_RETAINED_SESSIONS,
    redeemCommandTicket,
    ...discussionDependencies
  } = {}) {
    if (resolveTask !== undefined && typeof resolveTask !== "function") {
      throw new TypeError("AgentRuntimeCoordinator requires a task authority resolver.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("AgentRuntimeCoordinator requires a ClockPort.");
    }
    if (!leaseStore || typeof leaseStore.acquire !== "function"
      || typeof leaseStore.release !== "function") {
      throw new TypeError("AgentRuntimeCoordinator requires an AgentLeaseStore.");
    }
    for (const [value, label] of [
      [cancelTimeoutMs, "cancel timeout"],
      [terminalSessionTtlMs, "terminal-session TTL"],
      [discussionRetentionMs, "discussion retention"],
      [maxRetainedSessions, "retained-session limit"],
    ]) {
      if (!Number.isSafeInteger(value) || value <= 0) {
        throw new TypeError(`AgentRuntimeCoordinator ${label} must be a positive integer.`);
      }
    }
    this.#resolveTask = resolveTask || null;
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
    this.#discussionRetentionMs = discussionRetentionMs;
    this.#maxRetainedSessions = maxRetainedSessions;
    this.#eventReducer = createAgentEventReducer();
    this.#externalRedeemTicket = typeof redeemCommandTicket === "function"
      ? redeemCommandTicket
      : null;
    if (Object.keys(discussionDependencies).length > 0) {
      this.configureDiscussion(discussionDependencies);
    }
  }

  configureDiscussion({
    readWorkingCopy,
    recordQuestion,
    sealReply,
    runDiscussion = runDiscussionTurn,
    createTurnRunner,
    turnTimeoutMs = DISCUSSION_TURN_TIMEOUT_MS,
  } = {}) {
    if (this.#discussion) return;
    if (typeof readWorkingCopy !== "function" || typeof recordQuestion !== "function"
      || typeof sealReply !== "function" || typeof runDiscussion !== "function"
      || (createTurnRunner !== undefined && typeof createTurnRunner !== "function")
      || !Number.isSafeInteger(turnTimeoutMs) || turnTimeoutMs <= 0) {
      throw new TypeError("AgentRuntimeCoordinator discussion dependencies are invalid.");
    }
    this.#discussion = Object.freeze({
      readWorkingCopy,
      recordQuestion,
      sealReply,
      runDiscussion,
      turnTimeoutMs,
      createTurnRunner: createTurnRunner || (({ ticket, environment }) => (
        this.#providerRegistry.createTurnRunner(ticket, { environment })
      )),
    });
  }

  get disposed() {
    return !this.#acceptingStarts;
  }

  providerCatalog() {
    return this.#providerRegistry.catalog();
  }

  #assertAcceptingStarts() {
    if (!this.#acceptingStarts) {
      failAgentRuntime("AGENT_BRIDGE_DISPOSED", "Agent Bridge 已停止。", { status: 503 });
    }
  }

  #trackStart(operation) {
    this.#assertAcceptingStarts();
    const pending = Promise.resolve().then(operation);
    this.#pendingStarts.add(pending);
    void pending.finally(() => {
      this.#pendingStarts.delete(pending);
    }).catch(() => {});
    return pending;
  }

  #touch(entry) {
    entry.updatedAtMs = this.#clock.now();
    entry.updatedAt = nowIso(this.#clock);
  }

  #prune() {
    const now = this.#clock.now();
    for (const [ticketId, ticket] of this.#tickets) {
      if (ticket.expiresAt <= now) this.#tickets.delete(ticketId);
    }
    const terminal = [...this.#executionSessions.entries()]
      .filter(([, entry]) => !LIVE_STATES.has(entry.state) && entry.keepLease !== true)
      .sort((left, right) => left[1].updatedAtMs - right[1].updatedAtMs);
    for (const [key, entry] of terminal) {
      if (this.#executionSessions.size <= this.#maxRetainedSessions
        && entry.updatedAtMs + this.#terminalSessionTtlMs > now) break;
      this.#executionSessions.delete(key);
      this.#eventReducer.clear(entry.turnId);
    }
    for (const [key, entry] of this.#discussionSessions) {
      if (!LIVE_STATES.has(entry.state) && entry.keepLease !== true
        && now - entry.updatedAtMs > this.#discussionRetentionMs) {
        this.#discussionSessions.delete(key);
        this.#eventReducer.clear(entry.turnId);
      }
    }
  }

  async availability({ driver } = {}) {
    if (!this.#acceptingStarts) {
      return Object.freeze({ ok: true, status: "unavailable", reason: "check-failed", driver });
    }
    const result = await this.#providerRegistry.availability({
      driver,
      environment: this.#environment,
    });
    return Object.freeze({ ok: true, ...result, driver });
  }

  async preflight({ driver, selection, trustPolicyAccepted, purpose = "execution" } = {}) {
    this.#assertAcceptingStarts();
    const ticketPurpose = validatePurpose(purpose);
    if (this.#preflightCleanupUnconfirmed) {
      failAgentRuntime(
        "AGENT_PREFLIGHT_CLEANUP_UNCONFIRMED",
        this.#providerRegistry.preflightFailureMessageForDriver(
          driver,
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
    this.#assertAcceptingStarts();
    const requestedSelection = selection
      ? canonicalSelection(selection, trustPolicyAccepted)
      : Object.freeze({
          providerId: prepared.providerId,
          runtimeId: prepared.runtimeId,
          requestedModelId: null,
          resolvedModelId: null,
          reasoning: Object.freeze({
            requested: null,
            applied: null,
            resolution: "provider-default",
          }),
        });
    if (requestedSelection.providerId !== prepared.providerId
      || requestedSelection.runtimeId !== prepared.runtimeId
      || requestedSelection.requestedModelId !== null
      || requestedSelection.resolvedModelId !== null
      || requestedSelection.reasoning.resolution !== "provider-default") {
      failAgentRuntime(
        "AGENT_SELECTION_UNSUPPORTED",
        "The selected Agent model or reasoning policy is unsupported.",
        { status: 409 },
      );
    }
    const resolvedSelection = requestedSelection;
    const fingerprint = selectionFingerprint(resolvedSelection);
    const preflightId = `preflight_${randomUUID().replaceAll("-", "")}`;
    const createdAt = this.#clock.now();
    while (this.#tickets.size >= MAX_PREFLIGHT_TICKETS) {
      this.#tickets.delete(this.#tickets.keys().next().value);
    }
    this.#tickets.set(preflightId, Object.freeze({
      preflightId,
      purpose: ticketPurpose,
      driver: prepared.driver,
      providerId: prepared.providerId,
      runtimeId: prepared.runtimeId,
      securityProfile: prepared.securityProfile,
      installation: prepared.installation,
      installationDigest: prepared.installationDigest,
      capabilities: prepared.capabilities,
      evidence: prepared.evidence,
      selection: resolvedSelection,
      selectionFingerprint: fingerprint,
      createdAt,
      expiresAt: createdAt + PREFLIGHT_TTL_MS,
    }));
    return Object.freeze({
      ok: true,
      status: "ready",
      driver: prepared.driver,
      preflightId,
      trustPolicyVersion: TRUSTED_LOCAL_AGENT_POLICY_VERSION,
      agentVersion: prepared.evidence.version,
      modelCount: prepared.evidence.modelCount,
      models: prepared.evidence.models ?? [],
      selection: resolvedSelection,
      selectionFingerprint: fingerprint,
      expiresAt: new Date(createdAt + PREFLIGHT_TTL_MS).toISOString(),
    });
  }

  async redeemCommandTicket(preflightId, { purpose = "execution", driver } = {}) {
    this.#assertAcceptingStarts();
    const expectedPurpose = validatePurpose(purpose);
    if (this.#externalRedeemTicket && this.#tickets.size === 0) {
      const ticket = await this.#externalRedeemTicket(preflightId, { purpose: expectedPurpose, driver });
      return Object.freeze({ ...ticket, purpose: ticket.purpose || expectedPurpose });
    }
    const ticket = this.#tickets.get(preflightId);
    if (!ticket || ticket.expiresAt <= this.#clock.now()) {
      this.#tickets.delete(preflightId);
      failAgentRuntime("AGENT_PREFLIGHT_EXPIRED", "Agent 预检已过期，请重新确认后启动。", { status: 409 });
    }
    // Consume before every verification. A drifted, cross-provider or
    // cross-purpose ticket is never replayable after the failed attempt.
    this.#tickets.delete(preflightId);
    if (ticket.purpose !== expectedPurpose || (driver && ticket.driver !== driver)) {
      failAgentRuntime("AGENT_PREFLIGHT_PURPOSE_MISMATCH", "Agent 预检与本次操作不匹配，请重新检查。", {
        status: 409,
      });
    }
    const verified = await this.#providerRegistry.verifyTicket(ticket);
    if (verified.providerId !== ticket.providerId || verified.runtimeId !== ticket.runtimeId
      || verified.securityProfile !== ticket.securityProfile) {
      failAgentRuntime("AGENT_PROVIDER_TICKET_INVALID", "Agent provider ticket binding is invalid.", {
        status: 409,
      });
    }
    return verified;
  }

  #observe(entry, rawEvent, phaseForEvent, textField) {
    entry.nextSequence += 1;
    const canonical = canonicalAgentEvent(rawEvent, {
      turnId: entry.turnId,
      sequence: entry.nextSequence,
      timestamp: this.#clock.now(),
    });
    const reduced = this.#eventReducer.accept(canonical);
    if (!reduced.accepted) return;
    entry.eventCount = reduced.projection.eventCount;
    if (LIVE_STATES.has(entry.state)) {
      entry.phase = phaseForEvent(reduced.event, entry.phase);
    }
    if (textField) {
      entry[textField] = reduced.projection.visibleText;
      if (textField === "replyText") entry.replyTruncated = reduced.projection.textTruncated;
    }
    if (reduced.event.kind === "initialized") {
      if (["starting", "running"].includes(entry.state)) entry.state = "running";
      entry.agentName = cleanAgentText(reduced.event.agentName) || "Local Agent";
      entry.agentVersion = cleanAgentText(reduced.event.agentVersion) || entry.agentVersion;
    }
    this.#touch(entry);
  }

  async #releaseLease(entry) {
    if (!entry.lease || entry.keepLease) return !entry.keepLease;
    let released = false;
    try {
      released = await this.#leaseStore.release(entry.lease);
    } catch {
      released = false;
    }
    if (released !== true) {
      entry.keepLease = true;
      entry.retryable = false;
      entry.errorCode = "AGENT_RESTART_RECOVERY_REQUIRED";
      entry.errorMessage = this.#providerRegistry.failureMessageForDriver(
        entry.driver,
        "AGENT_RESTART_RECOVERY_REQUIRED",
      );
      this.#touch(entry);
      return false;
    }
    entry.lease = null;
    entry.cancelState = entry.cancelState === "provider-acknowledged"
      ? "termination-confirmed"
      : entry.cancelState;
    return true;
  }

  async submit({ driver, selection, trustPolicyAccepted, preflightId, ...identityInput } = {}) {
    this.#assertAcceptingStarts();
    this.#providerRegistry.resolveDriver(driver);
    validateTrustPolicy(trustPolicyAccepted);
    const requestedSelection = selection
      ? canonicalSelection(selection, trustPolicyAccepted)
      : null;
    const identity = validateExecutionIdentity(identityInput);
    this.#prune();
    const key = executionKey(identity);
    const existing = this.#executionSessions.get(key);
    if (existing && ["starting", "running", "cancelling", "completed"].includes(existing.state)) {
      return {
        ok: true,
        accepted: false,
        idempotent: true,
        session: publicExecutionSession(existing, existing.driver),
      };
    }
    if (existing && existing.retryable !== true) {
      failAgentRuntime(
        existing.errorCode || "AGENT_RETRY_BLOCKED",
        existing.errorMessage || "本轮 Agent 会话不能安全重试。请结束本轮后重新发送。",
        { status: 409 },
      );
    }
    const ticket = await this.redeemCommandTicket(preflightId, { purpose: "execution", driver });
    if (requestedSelection && !sameSelection(requestedSelection, ticket.selection)) {
      failAgentRuntime("AGENT_PROVIDER_TICKET_INVALID", "Agent selection does not match its preflight ticket.", {
        status: 409,
      });
    }
    if (!this.#resolveTask) throw new TypeError("Execution authority is not configured.");
    const task = await this.#resolveTask(identity);
    this.#assertAcceptingStarts();
    if (!task?.run || task.run.status !== "processing") {
      failAgentRuntime("AGENT_TASK_NOT_PROCESSING", "当前 Request 已不再等待 Agent 处理。", { status: 409 });
    }
    if (task.run.projectId !== identity.projectId || task.run.documentId !== identity.documentId
      || task.run.requestId !== identity.requestId || task.run.attemptId !== identity.attemptId
      || task.run.sourcePath !== identity.sourcePath) {
      failAgentRuntime("AGENT_TASK_IDENTITY_MISMATCH", "Request authority 与 Agent 任务身份不一致。", {
        status: 409,
      });
    }
    let delivery;
    try {
      delivery = normalizeAgentDelivery(task.request?.request?.agentDelivery);
    } catch {
      delivery = null;
    }
    if (delivery?.mode !== "managed-agent"
      || delivery.selection.providerId !== ticket.providerId
      || delivery.selection.runtimeId !== ticket.runtimeId
      || !sameSelection(delivery.selection, ticket.selection)
      || delivery.trustPolicyVersion !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
      failAgentRuntime("AGENT_DELIVERY_NOT_AUTHORIZED", "本轮 Request 没有授权所选 Agent 自动执行。", {
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
      const code = cleanAgentText(cause?.code, 120) || "AGENT_TASK_POLICY_INVALID";
      if (code === "AGENT_OUTPUT_PREEXISTS" || code === "AGENT_COMPLETION_PREEXISTS") {
        failAgentRuntime("AGENT_RETRY_OUTPUT_PRESENT", this.#providerRegistry.failureMessage(
          ticket,
          "AGENT_RETRY_OUTPUT_PRESENT",
        ), { status: 409 });
      }
      failAgentRuntime("AGENT_TASK_POLICY_INVALID", "本轮冻结资料或运行权限不再满足 Agent 启动条件。", {
        status: 409,
        details: { reasonCode: code },
      });
    }
    this.#assertAcceptingStarts();
    const lease = existing?.lease || await this.#leaseStore.acquire({
      providerId: ticket.providerId,
      runtimeId: ticket.runtimeId,
      purpose: "execution",
      driver: ticket.driver,
      projectId: identity.projectId,
      documentId: identity.documentId,
      requestId: identity.requestId,
      attemptId: identity.attemptId,
      requestPath: task.run.requestPath,
      ownerToken: this.#ownerToken,
      clock: this.#clock,
    });
    if (!this.#acceptingStarts) {
      const released = await this.#leaseStore.release(lease).catch(() => false);
      if (released !== true) this.#preflightCleanupUnconfirmed = true;
      this.#assertAcceptingStarts();
    }
    const controller = new AbortController();
    const entry = {
      purpose: "execution",
      turnId: identity.requestId,
      nextSequence: -1,
      identity,
      state: "starting",
      phase: "launching",
      startedAt: nowIso(this.#clock),
      updatedAt: nowIso(this.#clock),
      updatedAtMs: this.#clock.now(),
      agentName: null,
      agentVersion: ticket.evidence.version,
      eventCount: 0,
      errorCode: null,
      errorMessage: null,
      retryable: false,
      lease,
      keepLease: false,
      cancelState: null,
      controller,
      promise: null,
      visibleText: "",
    };
    this.#executionSessions.set(key, entry);
    const pendingEvents = [];
    let projectionActive = false;
    const publishEvent = (event) => {
      if (this.#executionSessions.get(key) === entry) {
        this.#observe(entry, event, executionPhaseForEvent, "visibleText");
      }
    };
    const observe = (event) => {
      if (projectionActive) publishEvent(event);
      else pendingEvents.push(event);
    };
    // Invoke the runtime before returning from submit so its cancellation
    // listener is installed before shutdown can win the next microtask.
    const runtimePromise = this.#providerRegistry.run(ticket, {
      policy,
      prompt: finalizerPrompt(policy),
      baseEnvironment: this.#environment,
      cancellationSignal: controller.signal,
      onEvent: observe,
    });
    setImmediate(() => {
      projectionActive = true;
      for (const event of pendingEvents.splice(0)) publishEvent(event);
    });
    entry.promise = Promise.resolve(runtimePromise).then(() => {
      if (this.#executionSessions.get(key) !== entry) return;
      entry.state = "completed";
      entry.phase = "awaiting-validation";
      entry.retryable = false;
      if (entry.cancelState === "requested") entry.cancelState = "provider-acknowledged";
      this.#touch(entry);
    }).catch(async (cause) => {
      if (this.#executionSessions.get(key) !== entry) return;
      const residue = await taskHasResidue(policy);
      const cleanupUnconfirmed = cause?.code === "AGENT_PROCESS_CLEANUP_UNCONFIRMED";
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
      if (entry.cancelState === "requested") entry.cancelState = "provider-acknowledged";
      this.#touch(entry);
    }).finally(async () => {
      await this.#releaseLease(entry);
    });
    void entry.promise.catch(() => {});
    return { ok: true, accepted: true, idempotent: false, session: publicExecutionSession(entry, entry.driver) };
  }

  executionStatus(identityInput) {
    const identity = validateExecutionIdentity(identityInput);
    this.#prune();
    const entry = this.#executionSessions.get(executionKey(identity));
    return publicExecutionSession(entry, entry?.driver);
  }

  interrupted(identityInput, { driver } = {}) {
    validateExecutionIdentity(identityInput);
    const timestamp = nowIso(this.#clock);
    return Object.freeze({
      driver,
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
        driver,
        "AGENT_RESTART_RECOVERY_REQUIRED",
      ),
    });
  }

  async cancelExecution(identityInput) {
    const identity = validateExecutionIdentity(identityInput);
    const entry = this.#executionSessions.get(executionKey(identity));
    if (!entry || !LIVE_STATES.has(entry.state)) {
      return { ok: true, stopped: false, session: publicExecutionSession(entry, entry?.driver) };
    }
    entry.cancelState = "requested";
    entry.state = "cancelling";
    entry.phase = "cancelling";
    this.#touch(entry);
    entry.controller.abort(new AgentRuntimeError("AGENT_CANCELLED", "Cancelled by PageRoot."));
    const timeout = timeoutAfter(
      this.#cancelTimeoutMs,
      "AGENT_CANCEL_UNCONFIRMED",
      "Agent 进程没有在限定时间内确认停止。",
    );
    try {
      await Promise.race([entry.promise, timeout.promise]);
    } finally {
      timeout.clear();
    }
    if (entry.keepLease === true || entry.lease) {
      failAgentRuntime(
        "AGENT_CANCEL_UNCONFIRMED",
        "Agent 进程停止未被确认。本轮 Request 仍保持处理中，不会解锁或覆盖它。",
        { status: 503 },
      );
    }
    entry.cancelState = "termination-confirmed";
    return { ok: true, stopped: true, session: publicExecutionSession(entry, entry.driver) };
  }

  async cancelDurableExecution({ identity, cancelRequest } = {}) {
    if (typeof cancelRequest !== "function") {
      throw new TypeError("AgentRuntimeCoordinator durable cancellation dependency is invalid.");
    }
    await this.cancelExecution(identity);
    const entry = this.#executionSessions.get(executionKey(validateExecutionIdentity(identity)));
    if (entry?.keepLease || entry?.lease) {
      failAgentRuntime("AGENT_CANCEL_UNCONFIRMED", "Agent 清理未确认，不能持久化取消。", { status: 503 });
    }
    const cancelled = await cancelRequest();
    if (entry) entry.cancelState = "durable-cancelled";
    return cancelled;
  }

  async discussionStart(input) {
    return this.#trackStart(() => this.#startDiscussion(input));
  }

  async #startDiscussion({
    driver,
    selection,
    trustPolicyAccepted,
    preflightId,
    projectId,
    documentId,
    sourcePath,
    conversationId,
    question,
    expectedSourceSha256,
  } = {}) {
    this.#assertAcceptingStarts();
    if (!this.#discussion) throw new TypeError("Discussion authority is not configured.");
    try {
      this.#providerRegistry.resolveDriver(driver);
    } catch {
      failAgentRuntime("AGENT_DRIVER_UNSUPPORTED", "所选 Agent 驱动不支持受管讨论。", { status: 422 });
    }
    validateTrustPolicy(trustPolicyAccepted, 422);
    if (!PROJECT_ID.test(String(projectId || "")) || !DOCUMENT_ID.test(String(documentId || ""))
      || !CONVERSATION_ID.test(String(conversationId || ""))) {
      failAgentRuntime("DISCUSSION_IDENTITY_INVALID", "讨论目标身份无效。", { status: 422 });
    }
    try {
      discussionPrompt({ question });
    } catch (cause) {
      failAgentRuntime(cleanAgentText(cause?.code, 120) || "DISCUSSION_QUESTION_INVALID", "这段讨论内容无法发送给所选 Agent。", {
        status: 422,
      });
    }
    this.#prune();
    const key = discussionKey(documentId);
    const existing = this.#discussionSessions.get(key);
    if (existing && LIVE_STATES.has(existing.state)) {
      return {
        ok: true,
        accepted: false,
        idempotent: true,
        session: publicDiscussionSession(existing, existing.driver),
      };
    }
    const workingCopy = await this.#discussion.readWorkingCopy({ sourcePath });
    this.#assertAcceptingStarts();
    if (workingCopy?.target?.projectId !== projectId
      || workingCopy?.target?.documentId !== documentId) {
      failAgentRuntime("DISCUSSION_IDENTITY_MISMATCH", "讨论目标与已登记的 Project File 不一致。", {
        status: 409,
      });
    }
    if (expectedSourceSha256 && expectedSourceSha256 !== workingCopy.sourceSha256) {
      failAgentRuntime("DISCUSSION_SOURCE_STALE", "页面内容已经变化，请重新发起讨论。", { status: 409 });
    }
    const turnId = `turn_${randomUUID().replaceAll("-", "")}`;
    const ticketPreview = this.#tickets.get(preflightId);
    const recordedSelection = selection
      ? canonicalSelection(selection, trustPolicyAccepted)
      : ticketPreview?.selection || Object.freeze({
          providerId: "legacy-provider",
          runtimeId: "legacy-runtime",
          requestedModelId: null,
          resolvedModelId: null,
          reasoning: Object.freeze({
            requested: null,
            applied: null,
            resolution: "provider-default",
          }),
        });
    let recorded;
    try {
      recorded = await this.#discussion.recordQuestion({
        sourcePath,
        conversationId,
        turnId,
        sourceSha256: workingCopy.sourceSha256,
        question,
        providerSelection: recordedSelection,
        providerBinding: {
          providerId: recordedSelection.providerId,
          runtimeId: recordedSelection.runtimeId,
        },
        capabilitySnapshotFingerprint: ticketPreview
          ? selectionFingerprint(ticketPreview.capabilities)
          : null,
      });
    } catch (cause) {
      failAgentRuntime(cleanAgentText(cause?.code, 120) || "DISCUSSION_RECORD_FAILED", "这条提问没有存下来，没有启动 Agent。", {
        status: 409,
      });
    }
    const recordedConversationId = cleanAgentText(recorded?.conversationId, 200) || conversationId;
    if (!this.#acceptingStarts) {
      await this.#discussion.sealReply({
        sourcePath,
        conversationId: recordedConversationId,
        turnId,
        status: "interrupted",
        replyText: "",
        replyTruncated: false,
      }).catch(() => {});
      this.#assertAcceptingStarts();
    }
    let ticket;
    try {
      ticket = await this.redeemCommandTicket(preflightId, { purpose: "discussion", driver });
      const redeemedSelection = ticket.selection || recordedSelection;
      if (!sameSelection(recordedSelection, redeemedSelection)) {
        failAgentRuntime("AGENT_PROVIDER_TICKET_INVALID", "Agent selection does not match its preflight ticket.", {
          status: 409,
        });
      }
    } catch (cause) {
      // The question is already durable. Seal the same Turn before surfacing the
      // ticket failure so restart can never reveal a permanently half-open round.
      await this.#discussion.sealReply({
        sourcePath,
        conversationId: recordedConversationId,
        turnId,
        status: "failed",
        replyText: "",
        replyTruncated: false,
      }).catch(() => {});
      throw cause;
    }
    this.#assertAcceptingStarts();
    const lease = await this.#leaseStore.acquire({
      providerId: ticket.providerId || "legacy-provider",
      runtimeId: ticket.runtimeId || "legacy-runtime",
      purpose: "discussion",
      driver: ticket.driver || driver,
      projectId,
      documentId,
      turnId,
      projectRoot: workingCopy.target.projectRootPath,
      ownerToken: this.#ownerToken,
      clock: this.#clock,
    });
    if (!this.#acceptingStarts) {
      const released = await this.#leaseStore.release(lease).catch(() => false);
      if (released !== true) this.#preflightCleanupUnconfirmed = true;
      this.#assertAcceptingStarts();
    }
    const controller = new AbortController();
    const entry = {
      purpose: "discussion",
      turnId,
      nextSequence: -1,
      documentId,
      conversationId: recordedConversationId,
      sourceSha256: workingCopy.sourceSha256,
      state: "starting",
      phase: "launching",
      startedAt: nowIso(this.#clock),
      updatedAt: nowIso(this.#clock),
      updatedAtMs: this.#clock.now(),
      agentName: null,
      agentVersion: ticket.evidence?.version || null,
      eventCount: 0,
      replyText: "",
      replyTruncated: false,
      recorded: false,
      interrupted: false,
      interruptedReason: null,
      errorCode: null,
      errorMessage: null,
      retryable: false,
      lease,
      keepLease: false,
      cancelState: null,
      controller,
      promise: null,
    };
    this.#discussionSessions.set(key, entry);
    const observe = (event) => {
      if (this.#discussionSessions.get(key) === entry) {
        this.#observe(entry, event, discussionPhaseForEvent, "replyText");
      }
    };
    entry.promise = Promise.resolve().then(() => {
      const runTurn = this.#discussion.createTurnRunner({
        ticket,
        environment: this.#environment,
      });
      return this.#discussion.runDiscussion({
        projectRoot: workingCopy.target.projectRootPath,
        turnId,
        html: workingCopy.content,
        expectedSourceSha256: workingCopy.sourceSha256,
        question,
        turnTimeoutMs: this.#discussion.turnTimeoutMs,
        cancellationSignal: controller.signal,
        onEvent: observe,
        runTurn,
      });
    }).then(
      (outcome) => ({
        state: outcome.status === "completed"
          ? "completed"
          : outcome.interruptedReason === "cancelled" ? "cancelled" : "interrupted",
        interrupted: outcome.interrupted === true,
        interruptedReason: outcome.interruptedReason || null,
        replyText: typeof outcome.replyText === "string" ? outcome.replyText : entry.replyText,
        replyTruncated: outcome.replyTruncated === true || entry.replyTruncated,
        errorCode: null,
        errorMessage: null,
      }),
      (cause) => ({
        state: "failed",
        interrupted: cause?.discussionOutcome?.interrupted === true,
        interruptedReason: cause?.discussionOutcome?.interruptedReason || null,
        replyText: entry.replyText,
        replyTruncated: entry.replyTruncated,
        errorCode: cleanAgentText(cause?.code, 120) || "DISCUSSION_TURN_FAILED",
        errorMessage: "这轮讨论没有完成。请稍后重试。",
        cleanupUnconfirmed: cause?.code === "AGENT_PROCESS_CLEANUP_UNCONFIRMED",
      }),
    ).then(async (settled) => {
      if (this.#discussionSessions.get(key) !== entry) return;
      if (settled.cleanupUnconfirmed) entry.keepLease = true;
      let recordFailure = null;
      try {
        await this.#discussion.sealReply({
          sourcePath,
          conversationId: entry.conversationId,
          turnId,
          status: settled.state === "failed" ? "failed" : settled.state,
          replyText: settled.replyText,
          replyTruncated: settled.replyTruncated,
        });
      } catch (cause) {
        recordFailure = cause;
      }
      entry.interrupted = settled.interrupted;
      entry.interruptedReason = settled.interruptedReason;
      entry.replyText = settled.replyText;
      entry.replyTruncated = settled.replyTruncated;
      entry.recorded = recordFailure === null;
      entry.errorCode = settled.errorCode || (recordFailure
        ? cleanAgentText(recordFailure?.code, 120) || "DISCUSSION_RECORD_FAILED"
        : null);
      entry.errorMessage = settled.errorMessage || (recordFailure
        ? "这轮讨论没有存进对话记录。"
        : null);
      entry.state = settled.state;
      entry.phase = settled.state;
      if (entry.cancelState === "requested") entry.cancelState = "provider-acknowledged";
      this.#touch(entry);
    }).finally(async () => {
      await this.#releaseLease(entry);
    });
    void entry.promise.catch(() => {});
    return {
      ok: true,
      accepted: true,
      idempotent: false,
      session: publicDiscussionSession(entry, entry.driver),
    };
  }

  discussionStatus({ documentId } = {}) {
    this.#prune();
    const entry = this.#discussionSessions.get(discussionKey(documentId));
    return publicDiscussionSession(entry, entry?.driver);
  }

  async cancelDiscussion({ documentId } = {}) {
    const entry = this.#discussionSessions.get(discussionKey(documentId));
    if (!entry || !LIVE_STATES.has(entry.state)) {
      return {
        ok: true,
        cancelled: false,
        session: publicDiscussionSession(entry, entry?.driver),
      };
    }
    entry.cancelState = "requested";
    entry.state = "cancelling";
    entry.phase = "cancelling";
    this.#touch(entry);
    entry.controller.abort();
    await entry.promise;
    if (entry.keepLease || entry.lease) {
      failAgentRuntime("AGENT_CANCEL_UNCONFIRMED", "Agent 讨论轮清理未被确认。", { status: 503 });
    }
    entry.cancelState = "termination-confirmed";
    return { ok: true, cancelled: true, session: publicDiscussionSession(entry, entry.driver) };
  }

  async shutdown() {
    if (this.#shutdownConfirmed) return;
    if (this.#shutdownPromise) return this.#shutdownPromise;
    this.#acceptingStarts = false;
    this.#tickets.clear();
    this.#shutdownPromise = (async () => {
      const startTimeout = timeoutAfter(
        this.#cancelTimeoutMs,
        "AGENT_SHUTDOWN_UNCONFIRMED",
        "无法确认 Agent 启动操作已停止；为避免失去控制，本次退出已取消。",
      );
      try {
        await Promise.race([
          Promise.allSettled([...this.#pendingStarts]),
          startTimeout.promise,
        ]);
      } catch {
        failAgentRuntime(
          "AGENT_SHUTDOWN_UNCONFIRMED",
          "无法确认 Agent 启动操作已停止；为避免失去控制，本次退出已取消。",
          { status: 503 },
        );
      } finally {
        startTimeout.clear();
      }
      const entries = [
        ...this.#discussionSessions.values(),
        ...this.#executionSessions.values(),
      ];
      for (const entry of entries) {
        if (LIVE_STATES.has(entry.state)) {
          entry.cancelState = "requested";
          entry.controller.abort(new AgentRuntimeError("AGENT_CANCELLED", "Bridge shutdown."));
        }
      }
      const timeout = timeoutAfter(
        this.#cancelTimeoutMs,
        "AGENT_SHUTDOWN_UNCONFIRMED",
        "无法确认 Agent 进程已停止；为避免失去控制，本次退出已取消。",
      );
      try {
        await Promise.race([
          Promise.allSettled(entries.map((entry) => entry.promise).filter(Boolean)),
          timeout.promise,
        ]);
      } catch {
        failAgentRuntime(
          "AGENT_SHUTDOWN_UNCONFIRMED",
          "无法确认 Agent 进程已停止；为避免失去控制，本次退出已取消。",
          { status: 503 },
        );
      } finally {
        timeout.clear();
      }
      const unconfirmed = entries.some((entry) => LIVE_STATES.has(entry.state)
        || entry.keepLease === true || entry.lease) || this.#preflightCleanupUnconfirmed;
      if (unconfirmed) {
        failAgentRuntime(
          "AGENT_SHUTDOWN_UNCONFIRMED",
          "无法确认 Agent 进程已停止；为避免失去控制，本次退出已取消。",
          { status: 503 },
        );
      }
      this.#shutdownConfirmed = true;
    })();
    try {
      await this.#shutdownPromise;
    } finally {
      this.#shutdownPromise = null;
    }
  }

  dispose() {
    return this.shutdown();
  }
}
