// Renderer-side owner of the discussion turn projection.
//
// It owns no durable fact. The Bridge owns the live turn and its outcome, so
// this session holds a read projection plus the local in-flight intent, and
// publishes snapshots to the view.
//
// One rule is load-bearing, the same one the conversation projection follows: a
// discussion turn belongs to exactly one Document. Switching Document clears the
// projection immediately rather than leaving Document A's answer on screen under
// Document B's frame.
//
// A turn is never presented as complete unless the Bridge says so. `interrupted`
// stays visible in its own right, because a timed-out or cancelled turn that
// looks finished is worse than one that plainly says it stopped early.

const LIVE_STATES = ["starting", "running", "cancelling"];

function sameDocument(left, right) {
  return Boolean(
    left
    && right
    && left.projectId === right.projectId
    && left.documentId === right.documentId,
  );
}

export class DiscussionTurnSession {
  #context = null;

  #turn = null;

  #status = "idle";

  #error = null;

  #conversationId = null;

  #observer = null;

  #listeners = new Set();

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("DiscussionTurnSession listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.snapshot);
    return () => this.#listeners.delete(listener);
  }

  #emit() {
    const snapshot = this.snapshot;
    try {
      this.#observer?.(snapshot);
    } catch {
      // A view observer cannot change discussion turn authority.
    }
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // Supplemental subscribers cannot change discussion turn authority.
      }
    }
  }

  get snapshot() {
    return Object.freeze({
      context: this.#context,
      status: this.#status,
      turn: this.#turn,
      error: this.#error,
      conversationId: this.#conversationId,
      turnId: this.#turn?.turnId ?? null,
      sourceSha256: this.#turn?.sourceSha256 ?? null,
      phase: this.#turn?.phase ?? null,
      // The Agent's visible reply, bounded and sanitized by the driver. It is
      // read-only text and carries no authority over the page (ADR 0036).
      replyText: this.#turn?.replyText ?? "",
      replyTruncated: this.#turn?.replyTruncated === true,
      interrupted: this.#turn?.interrupted === true,
      interruptedReason: this.#turn?.interruptedReason ?? null,
      // The Composer uses this to keep one turn per Document, so it is derived
      // from state rather than tracked as a second boolean that can drift.
      busy: LIVE_STATES.includes(this.#status),
    });
  }

  isActive(context) {
    return sameDocument(this.#context, context);
  }

  /**
   * Marks the local intent to start a turn. The projection is cleared first, so
   * a previous answer never sits under a new question.
   */
  beginTurn(context, { conversationId = null } = {}) {
    this.#context = context ? { ...context } : null;
    this.#turn = null;
    this.#error = null;
    this.#conversationId = conversationId;
    this.#status = context ? "starting" : "idle";
    this.#emit();
    return this.snapshot;
  }

  /**
   * Publishes the Bridge's turn projection. A response for a Document the user
   * already left is discarded rather than displayed.
   */
  publish(context, turn) {
    if (!this.isActive(context)) return false;
    if (!turn) {
      // The Bridge has no session for this Document: nothing is in flight.
      this.#turn = null;
      this.#status = "idle";
      this.#error = null;
      this.#emit();
      return true;
    }
    this.#turn = turn;
    this.#conversationId = turn.conversationId ?? this.#conversationId;
    this.#status = String(turn.state || "idle");
    this.#error = null;
    this.#emit();
    return true;
  }

  fail(context, error) {
    if (!this.isActive(context)) return false;
    this.#status = "failed";
    this.#error = error ?? null;
    this.#emit();
    return true;
  }

  deactivate() {
    this.#context = null;
    this.#turn = null;
    this.#error = null;
    this.#conversationId = null;
    this.#status = "idle";
    this.#emit();
  }
}

export { LIVE_STATES as DISCUSSION_LIVE_STATES };
