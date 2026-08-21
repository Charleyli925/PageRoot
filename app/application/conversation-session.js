// Renderer-side owner of the conversation projection.
//
// It owns no durable fact. The Bridge is the only conversation writer, so this
// session holds a read projection plus the unsent Composer state, and publishes
// snapshots to the view.
//
// One rule is load-bearing here: a Conversation belongs to exactly one Document.
// Switching Document clears the projection immediately rather than keeping the
// previous Document's messages on screen while the next load is in flight —
// showing Document B's frame with Document A's conversation, even briefly, is
// the worst kind of defect because it looks like a feature.

const DEFAULT_INTENT = "discuss";

function sameDocument(left, right) {
  return Boolean(
    left
    && right
    && left.projectId === right.projectId
    && left.documentId === right.documentId,
  );
}

function frozenSnapshot(value) {
  return Object.freeze(value);
}

export class ConversationSession {
  #context = null;

  #conversation = null;

  #draft = null;

  #status = "idle";

  #error = null;

  #atMessageLimit = false;

  #observer = null;

  #listeners = new Set();

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("ConversationSession listener must be a function.");
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
      // A view observer cannot change conversation authority.
    }
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch {
        // Supplemental subscribers cannot change conversation authority.
      }
    }
  }

  get snapshot() {
    return frozenSnapshot({
      context: this.#context,
      conversation: this.#conversation,
      draft: this.#draft,
      status: this.#status,
      error: this.#error,
      atMessageLimit: this.#atMessageLimit,
      messages: this.#conversation?.messages ?? [],
      conversationId: this.#conversation?.conversationId ?? null,
      title: this.#conversation?.title ?? "",
      draftText: this.#draft?.text ?? "",
      draftIntent: this.#draft?.intent ?? DEFAULT_INTENT,
    });
  }

  isActive(context) {
    return sameDocument(this.#context, context);
  }

  /**
   * Begins loading a Document's conversation. The projection is cleared first
   * so the sidebar can never show one Document's messages under another.
   */
  beginLoad(context) {
    this.#context = context ? { ...context } : null;
    this.#conversation = null;
    this.#draft = null;
    this.#atMessageLimit = false;
    this.#error = null;
    this.#status = context ? "loading" : "idle";
    this.#emit();
    return this.snapshot;
  }

  /**
   * Publishes a loaded conversation. A response that arrived for a Document the
   * user already left is discarded rather than displayed.
   */
  publish(context, { conversation, draft, atMessageLimit = false } = {}) {
    if (!this.isActive(context)) return false;
    this.#conversation = conversation ?? null;
    this.#draft = draft ?? null;
    this.#atMessageLimit = Boolean(atMessageLimit);
    this.#error = null;
    this.#status = conversation ? "ready" : "idle";
    this.#emit();
    return true;
  }

  fail(context, error) {
    if (!this.isActive(context)) return false;
    this.#conversation = null;
    this.#draft = null;
    this.#atMessageLimit = false;
    this.#error = error ?? null;
    this.#status = "failed";
    this.#emit();
    return true;
  }

  /**
   * Updates the unsent Composer text locally. Persisting it is the workflow's
   * job; the view must stay responsive without waiting for a write.
   */
  setDraftText(text) {
    if (!this.#conversation) return false;
    const nextText = typeof text === "string" ? text : "";
    if ((this.#draft?.text ?? "") === nextText) return false;
    this.#draft = { ...(this.#draft || {}), text: nextText };
    this.#emit();
    return true;
  }

  setDraftIntent(intent) {
    if (!this.#conversation) return false;
    const nextIntent = String(intent || DEFAULT_INTENT);
    if ((this.#draft?.intent ?? DEFAULT_INTENT) === nextIntent) return false;
    this.#draft = { ...(this.#draft || {}), intent: nextIntent };
    this.#emit();
    return true;
  }

  /**
   * Accepts the Bridge's acknowledged draft. A stale acknowledgement never
   * overwrites text the user has typed since.
   */
  acknowledgeDraft(context, draft) {
    if (!this.isActive(context) || !draft) return false;
    if (draft.conversationId !== this.#conversation?.conversationId) return false;
    if (Number(draft.revision) < Number(this.#draft?.revision ?? -1)) return false;
    this.#draft = { ...draft, text: this.#draft?.text ?? draft.text };
    this.#emit();
    return true;
  }

  deactivate() {
    this.#context = null;
    this.#conversation = null;
    this.#draft = null;
    this.#atMessageLimit = false;
    this.#error = null;
    this.#status = "idle";
    this.#emit();
  }
}
