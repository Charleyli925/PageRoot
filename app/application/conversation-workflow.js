// Orchestrates conversation loading and draft persistence.
//
// It publishes only through `ConversationSession` and reads only the Bridge
// projection. It holds no durable state: the Bridge remains the single
// conversation writer.
//
// Two ordering rules matter here:
//   - A load is keyed to the Document that requested it. A response for a
//     Document the user already left is dropped, so switching documents can
//     never resolve into the wrong conversation.
//   - Draft writes are debounced and single-flight. The user keeps typing at
//     full speed while the message history is never rewritten for a keystroke.

const DRAFT_AUTOSAVE_DELAY_MS = 700;

function sameDocument(left, right) {
  return Boolean(
    left
    && right
    && left.projectId === right.projectId
    && left.documentId === right.documentId,
  );
}

export class ConversationWorkflow {
  #bridgeClient;

  #session;

  #delayMs;

  #timer = null;

  #timerHost;

  #dirty = false;
  #pendingDrafts = new Map();
  #writing = null;
  #refreshTimer = null;
  #loadGeneration = 0;

  constructor({
    bridgeClient,
    conversationSession,
    draftDelayMs = DRAFT_AUTOSAVE_DELAY_MS,
    timerHost = globalThis,
  }) {
    if (!bridgeClient) {
      throw new TypeError("ConversationWorkflow requires a bridge client.");
    }
    if (!conversationSession) {
      throw new TypeError("ConversationWorkflow requires a conversation session.");
    }
    this.#bridgeClient = bridgeClient;
    this.#session = conversationSession;
    this.#delayMs = draftDelayMs;
    this.#timerHost = timerHost;
  }

  get session() {
    return this.#session;
  }

  /**
   * Loads the current conversation for a Document. Opening the sidebar never
   * runs an Agent, contacts the network beyond the local Bridge, or creates a
   * Request.
   */
  async open(context) {
    if (!context?.sourcePath) {
      this.close();
      return null;
    }
    const flushed = this.flushDraft();
    this.#stopRefresh();
    const generation = ++this.#loadGeneration;
    this.#session.beginLoad(context);
    try {
      await flushed;
      if (generation !== this.#loadGeneration) return null;
      const payload = await this.#bridgeClient.conversation(context.sourcePath);
      // The user may have switched documents while this was in flight.
      if (generation !== this.#loadGeneration || !sameDocument(this.#session.snapshot.context, context)) return null;
      this.#session.publish(context, {
        conversation: payload?.conversation ?? null,
        draft: this.#pendingDrafts.get(payload?.conversation?.conversationId)?.draft ?? payload?.draft ?? null,
        atMessageLimit: payload?.atMessageLimit === true,
      });
      this.#scheduleRefresh(context, generation);
      return payload ?? null;
    } catch (error) {
      if (generation !== this.#loadGeneration) return null;
      this.#session.fail(context, error);
      return null;
    }
  }

  #stopRefresh() {
    if (this.#refreshTimer !== null) this.#timerHost.clearTimeout(this.#refreshTimer);
    this.#refreshTimer = null;
  }

  #scheduleRefresh(context, generation) {
    if (generation !== this.#loadGeneration) return;
    this.#refreshTimer = this.#timerHost.setTimeout(async () => {
      this.#refreshTimer = null;
      try {
        const payload = await this.#bridgeClient.conversation(context.sourcePath);
        if (generation !== this.#loadGeneration || !this.#session.isActive(context)) return;
        // A read refresh preserves local draft state and reading position.
        this.#session.publish(context, { conversation: payload?.conversation ?? null,
          draft: this.#session.snapshot.draft, atMessageLimit: payload?.atMessageLimit === true });
      } catch { /* Keep the last confirmed history during transient read failures. */ }
      this.#scheduleRefresh(context, generation);
    }, 1500);
    this.#refreshTimer?.unref?.();
  }

  close() {
    void this.flushDraft();
    this.#loadGeneration += 1;
    this.#stopRefresh();
    this.#cancelTimer();
    this.#session.deactivate();
  }

  async listConversations(context) {
    if (!context?.sourcePath) return null;
    try {
      return await this.#bridgeClient.conversationList(context.sourcePath);
    } catch {
      // A history listing failure must not disturb the active conversation.
      return null;
    }
  }

  /**
   * Records Composer text locally and schedules one debounced write. The view
   * never waits on the Bridge to show what the user typed.
   */
  updateDraftText(text) {
    if (this.#session.setDraftText(text)) { this.#dirty = true; this.#scheduleDraftWrite(); }
  }

  updateDraftIntent(intent) {
    if (this.#session.setDraftIntent(intent)) { this.#dirty = true; this.#scheduleDraftWrite(); }
  }

  #cancelTimer() {
    if (this.#timer === null) return;
    this.#timerHost.clearTimeout(this.#timer);
    this.#timer = null;
  }

  #scheduleDraftWrite() {
    this.#cancelTimer();
    this.#timer = this.#timerHost.setTimeout(() => {
      this.#timer = null;
      void this.#writeDraft();
    }, this.#delayMs);
  }

  /**
   * Flushes any pending draft. Close, project switch and document switch call
   * this so an unsent draft is never lost at a drain boundary.
   */
  get hasPendingDraft() { return this.#dirty || this.#pendingDrafts.size > 0 || this.#writing !== null; }

  async flushDraft() {
    this.#cancelTimer();
    await this.#writeDraft();
    return !this.hasPendingDraft;
  }

  async #writeDraft() {
    // Capture identity and bytes before close/open can replace the Session.
    const snapshot = this.#session.snapshot;
    if (this.#dirty && snapshot.context?.sourcePath && snapshot.conversationId) {
      this.#pendingDrafts.set(snapshot.conversationId, {
        context: snapshot.context, conversationId: snapshot.conversationId,
        draft: snapshot.draft, text: snapshot.draftText, intent: snapshot.draftIntent,
      });
      this.#dirty = false;
    }
    if (this.#writing) return this.#writing;
    if (!this.#pendingDrafts.size) return;
    this.#writing = (async () => {
      const failed = new Set();
      for (;;) {
        const entry = [...this.#pendingDrafts.entries()].find(([key]) => !failed.has(key));
        if (!entry) break;
        const [key, pending] = entry;
        try {
          const payload = await this.#bridgeClient.saveConversationDraft({
            sourcePath: pending.context.sourcePath,
            projectId: pending.context.projectId,
            documentId: pending.context.documentId,
            conversationId: pending.conversationId,
            text: pending.text, intent: pending.intent,
          });
          if (!payload?.draft) throw new Error("Draft write was not acknowledged.");
          if (this.#pendingDrafts.get(key) === pending) this.#pendingDrafts.delete(key);
          this.#session.acknowledgeDraft(pending.context, payload.draft);
        } catch {
          // Keep the captured document's text for reopening/retry. A bounded
          // drain reports failure instead of silently dropping an unsaved draft.
          failed.add(key);
        }
      }
    })().finally(() => { this.#writing = null; });
    return this.#writing;
  }
}

export { DRAFT_AUTOSAVE_DELAY_MS };
