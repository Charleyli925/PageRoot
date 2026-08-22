// Bridge-owned discussion turn sessions.
//
// This is deliberately a separate service from `AgentBridgeService` rather than
// a second mode inside it: the two turn kinds carry different authority, and the
// PRD requires that separation to be real rather than a flag. A discussion turn
// creates no Request, no Candidate and no Version, never touches `activeRequest`
// or runtime state, and never runs a finalizer.
//
// What this service owns: one in-flight discussion turn per Document (PRD §17.5),
// the bounded public projection of that turn, and the mapping from a turn
// outcome to a session state. What it does not own: the Qoder command and
// executable identity (redeemed as a one-use ticket from `AgentBridgeService`),
// the Working Copy bytes (read through the repository) and the snapshot
// lifecycle (owned by `runDiscussionTurn`).

import { randomUUID } from "node:crypto";

import {
  AgentBridgeError,
  TRUSTED_LOCAL_AGENT_POLICY_VERSION,
} from "./agent-bridge-service.mjs";
import {
  DISCUSSION_TURN_TIMEOUT_MS,
  discussionPrompt,
  runDiscussionTurn,
} from "./discussion-turn-runner.mjs";
import { nowIso } from "./lifecycle-core.mjs";
import { runQoderAcpTask } from "./qoder-acp-client.mjs";

const DRIVER = "qoder-acp";
const PROJECT_ID = /^project_[a-f0-9]{16,64}$/u;
const DOCUMENT_ID = /^doc_[a-f0-9]{16,64}$/u;
const CONVERSATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,80}$/u;
const MAX_PUBLIC_SESSION_EVENTS = 512;
const SETTLED_SESSION_RETENTION_MS = 10 * 60_000;
const LIVE_STATES = ["starting", "running", "cancelling"];

function fail(code, message, options) {
  throw new AgentBridgeError(code, message, options);
}

function cleanText(value, maxLength = 160) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/gu, "")
    .trim()
    .slice(0, maxLength);
}

// The renderer receives turn state only: no snapshot path, no prompt, no page
// bytes, no command and no environment. Two things do cross: the context Hash,
// because the renderer already holds the same Working Copy Hash and needs to know
// which bytes were discussed, and the Agent's visible reply, which is the whole
// payload of a discussion turn and is bounded and sanitized by the driver
// (ADR 0036). The reply carries no authority: it cannot change the page.
function publicDiscussion(entry) {
  if (!entry) return null;
  return Object.freeze({
    driver: DRIVER,
    state: entry.state,
    phase: entry.phase,
    conversationId: entry.conversationId,
    turnId: entry.turnId,
    sourceSha256: entry.sourceSha256,
    startedAt: entry.startedAt,
    updatedAt: entry.updatedAt,
    agentName: entry.agentName || null,
    agentVersion: entry.agentVersion || null,
    eventCount: entry.eventCount,
    replyText: entry.replyText,
    replyTruncated: entry.replyTruncated === true,
    interrupted: entry.interrupted === true,
    ...(entry.interruptedReason ? { interruptedReason: entry.interruptedReason } : {}),
    ...(entry.errorCode ? { errorCode: entry.errorCode } : {}),
    ...(entry.errorMessage ? { errorMessage: entry.errorMessage } : {}),
  });
}

function phaseForEvent(event, current) {
  switch (event?.kind) {
    case "initialized": return "starting-session";
    case "file-read": return "reading-page";
    case "visible-text": return "replying";
    case "session-update": return "discussing";
    case "turn-stopping":
    case "turn-stopped": return "finishing";
    case "host-cancelling": return "cancelling";
    default: return current;
  }
}

// Discussion reuses the execution path's spawn contract unchanged: verified
// executable identity, no shell, `--acp`, and the Agent-name fence. Only the
// policy differs, and the shared driver derives the read-only host from it.
function defaultTurnRunner({ ticket, environment }) {
  return async ({ policy, prompt, turnTimeoutMs, cancellationSignal, onEvent }) => runQoderAcpTask({
    command: ticket.command.command,
    expectedExecutable: {
      path: ticket.command.command,
      identity: ticket.command.identity,
    },
    args: ["--acp"],
    policy,
    prompt,
    environment: {},
    baseEnvironment: environment,
    useVerifiedJavaScriptRuntime: ticket.command.source === "verified-npm-package",
    cancellationSignal,
    expectedAgentName: ticket.command.source === "e2e-override"
      ? /qoder|pageroot-e2e/iu
      : /qoder/iu,
    turnTimeoutMs,
    onEvent,
  });
}

export class DiscussionBridgeService {
  #redeemCommandTicket;
  #readWorkingCopy;
  #runDiscussion;
  #createTurnRunner;
  #environment;
  #clock;
  #turnTimeoutMs;
  #sessions = new Map();
  #disposed = false;

  constructor({
    redeemCommandTicket,
    readWorkingCopy,
    runDiscussion = runDiscussionTurn,
    createTurnRunner = defaultTurnRunner,
    environment = process.env,
    clock = Date,
    turnTimeoutMs = DISCUSSION_TURN_TIMEOUT_MS,
  } = {}) {
    if (
      typeof redeemCommandTicket !== "function"
      || typeof readWorkingCopy !== "function"
      || typeof runDiscussion !== "function"
      || typeof createTurnRunner !== "function"
    ) {
      throw new TypeError("DiscussionBridgeService dependencies are invalid.");
    }
    this.#redeemCommandTicket = redeemCommandTicket;
    this.#readWorkingCopy = readWorkingCopy;
    this.#runDiscussion = runDiscussion;
    this.#createTurnRunner = createTurnRunner;
    this.#environment = environment;
    this.#clock = clock;
    this.#turnTimeoutMs = turnTimeoutMs;
  }

  #prune() {
    const now = this.#clock.now();
    for (const [key, entry] of this.#sessions) {
      if (LIVE_STATES.includes(entry.state)) continue;
      if (now - entry.updatedAtMs > SETTLED_SESSION_RETENTION_MS) this.#sessions.delete(key);
    }
  }

  async start({
    driver,
    trustPolicyAccepted,
    preflightId,
    projectId,
    documentId,
    sourcePath,
    conversationId,
    question,
    expectedSourceSha256,
  } = {}) {
    if (this.#disposed) {
      fail("AGENT_BRIDGE_DISPOSED", "Agent Bridge 已停止。", { status: 503 });
    }
    if (driver !== DRIVER) {
      fail("AGENT_DRIVER_UNSUPPORTED", "PageRoot 只支持受管 Qoder ACP 讨论。", { status: 422 });
    }
    if (trustPolicyAccepted !== TRUSTED_LOCAL_AGENT_POLICY_VERSION) {
      fail("AGENT_TRUST_POLICY_REQUIRED", "需要先确认本机 Qoder 使用条款。", { status: 422 });
    }
    if (!PROJECT_ID.test(String(projectId || "")) || !DOCUMENT_ID.test(String(documentId || ""))) {
      fail("DISCUSSION_IDENTITY_INVALID", "讨论目标身份无效。", { status: 422 });
    }
    if (!CONVERSATION_ID.test(String(conversationId || ""))) {
      fail("DISCUSSION_IDENTITY_INVALID", "讨论所属对话身份无效。", { status: 422 });
    }
    // Reject an unusable question before anything is spawned or written, so the
    // caller learns synchronously instead of through a failed async turn.
    try {
      discussionPrompt({ question });
    } catch (cause) {
      fail(
        cleanText(cause?.code, 120) || "DISCUSSION_QUESTION_INVALID",
        "这段讨论内容无法发送给 Qoder。",
        { status: 422 },
      );
    }

    this.#prune();
    const existing = this.#sessions.get(documentId);
    if (existing && LIVE_STATES.includes(existing.state)) {
      // PRD §17.5: one in-flight turn per Document. A repeat start is answered
      // with the live turn instead of launching a second Qoder process.
      return { ok: true, accepted: false, idempotent: true, session: publicDiscussion(existing) };
    }

    const workingCopy = await this.#readWorkingCopy({ sourcePath });
    if (
      workingCopy?.target?.projectId !== projectId
      || workingCopy?.target?.documentId !== documentId
    ) {
      fail(
        "DISCUSSION_IDENTITY_MISMATCH",
        "讨论目标与已登记的 Project File 不一致。",
        { status: 409 },
      );
    }
    if (expectedSourceSha256 && expectedSourceSha256 !== workingCopy.sourceSha256) {
      fail(
        "DISCUSSION_SOURCE_STALE",
        "页面内容已经变化，请重新发起讨论。",
        { status: 409 },
      );
    }

    // The renderer never names the snapshot directory: the turn id is minted
    // here so a caller cannot choose a path segment.
    const turnId = `turn_${randomUUID().replaceAll("-", "")}`;
    const ticket = await this.#redeemCommandTicket(preflightId);
    const controller = new AbortController();
    const startedAtMs = this.#clock.now();
    const entry = {
      documentId,
      conversationId,
      turnId,
      sourceSha256: workingCopy.sourceSha256,
      state: "starting",
      phase: "launching",
      startedAt: nowIso(this.#clock),
      updatedAt: nowIso(this.#clock),
      updatedAtMs: startedAtMs,
      agentName: null,
      agentVersion: ticket.evidence?.version || null,
      eventCount: 0,
      replyText: "",
      replyTruncated: false,
      interrupted: false,
      interruptedReason: null,
      errorCode: null,
      errorMessage: null,
      controller,
      promise: null,
    };
    this.#sessions.set(documentId, entry);

    const touch = () => {
      entry.updatedAtMs = this.#clock.now();
      entry.updatedAt = nowIso(this.#clock);
    };
    const observe = (event) => {
      if (this.#sessions.get(documentId) !== entry) return;
      entry.eventCount = Math.min(MAX_PUBLIC_SESSION_EVENTS, entry.eventCount + 1);
      entry.phase = phaseForEvent(event, entry.phase);
      if (event?.kind === "initialized") {
        entry.state = "running";
        entry.agentName = cleanText(event.agentName) || "Qoder CLI";
        entry.agentVersion = cleanText(event.agentVersion) || entry.agentVersion;
      }
      // The reply streams in as it arrives, so the user reads it while it is
      // being written instead of waiting for the turn to settle. The driver has
      // already bounded and sanitized every chunk.
      if (event?.kind === "visible-text") entry.replyText += event.text;
      touch();
    };

    entry.promise = this.#runDiscussion({
      projectRoot: workingCopy.target.projectRootPath,
      turnId,
      html: workingCopy.content,
      expectedSourceSha256: workingCopy.sourceSha256,
      question,
      turnTimeoutMs: this.#turnTimeoutMs,
      cancellationSignal: controller.signal,
      onEvent: observe,
      runTurn: this.#createTurnRunner({ ticket, environment: this.#environment }),
    }).then((outcome) => {
      if (this.#sessions.get(documentId) !== entry) return;
      entry.interrupted = outcome.interrupted === true;
      entry.interruptedReason = outcome.interruptedReason || null;
      // The settled outcome is authoritative over the streamed fragments.
      if (typeof outcome.replyText === "string") entry.replyText = outcome.replyText;
      entry.replyTruncated = outcome.replyTruncated === true;
      entry.state = outcome.status === "completed"
        ? "completed"
        : outcome.interruptedReason === "cancelled"
          ? "cancelled"
          : "interrupted";
      entry.phase = entry.state;
      touch();
    }).catch((cause) => {
      if (this.#sessions.get(documentId) !== entry) return;
      entry.state = "failed";
      entry.phase = "failed";
      entry.errorCode = cleanText(cause?.code, 120) || "DISCUSSION_TURN_FAILED";
      entry.errorMessage = "这轮讨论没有完成。请稍后重试。";
      // A turn that produced an answer but could not clean up still reports what
      // the user already saw.
      if (cause?.discussionOutcome) {
        entry.interrupted = cause.discussionOutcome.interrupted === true;
        entry.interruptedReason = cause.discussionOutcome.interruptedReason || null;
      }
      touch();
    });
    void entry.promise.catch(() => {});

    return { ok: true, accepted: true, idempotent: false, session: publicDiscussion(entry) };
  }

  status({ documentId } = {}) {
    this.#prune();
    return publicDiscussion(this.#sessions.get(String(documentId || "")));
  }

  async cancel({ documentId } = {}) {
    const entry = this.#sessions.get(String(documentId || ""));
    if (!entry || !LIVE_STATES.includes(entry.state)) {
      return { ok: true, cancelled: false, session: publicDiscussion(entry) };
    }
    entry.state = "cancelling";
    entry.phase = "cancelling";
    entry.updatedAtMs = this.#clock.now();
    entry.updatedAt = nowIso(this.#clock);
    entry.controller.abort();
    await entry.promise?.catch(() => {});
    return { ok: true, cancelled: true, session: publicDiscussion(entry) };
  }

  async dispose() {
    this.#disposed = true;
    const settling = [];
    for (const entry of this.#sessions.values()) {
      if (!LIVE_STATES.includes(entry.state)) continue;
      entry.controller.abort();
      if (entry.promise) settling.push(entry.promise.catch(() => {}));
    }
    await Promise.allSettled(settling);
  }
}
