// Orchestrates one discussion turn per Document: start, poll, cancel, drain.
//
// It publishes only through `DiscussionTurnSession` and reads only the Bridge
// projection. It holds no durable state — the Bridge owns the live turn — and it
// never touches the Working Copy, a Request or a Candidate.
//
// Three ordering rules matter here:
//   - Start is single-flight per Document. The session's own state is the gate,
//     so a double-click cannot launch two turns, and the Bridge refuses a second
//     one anyway.
//   - Poll responses are fenced by Document and by a poll generation. A reply
//     that arrives after the user switched Document is dropped rather than
//     published under the wrong page.
//   - Drain cancels. A discussion turn is read-only and produces no durable
//     artifact, so at a close/switch boundary PageRoot stops it instead of
//     holding the boundary open for the turn's full budget. Waiting would block
//     closing the app for up to two minutes to preserve something disposable.
//
// When a turn settles, the Bridge has sealed its reply into the conversation
// record, so the workflow asks the conversation to reload once. The stored
// message then replaces the live one with identical text — which is why the view
// renders both through the same treatment.

const POLL_INTERVAL_MS = 1_200;
const LIVE_STATES = ["starting", "running", "cancelling"];

function sameDocument(left, right) {
  return Boolean(
    left
    && right
    && left.projectId === right.projectId
    && left.documentId === right.documentId,
  );
}

export class DiscussionTurnWorkflow {
  #bridgeClient;

  #session;

  #requestTicket;

  #freezeSelection;

  #onSettled;

  #scheduler;

  #intervalMs;

  #timer = null;

  #pollGeneration = 0;

  #starting = false;

  #disposed = false;

  constructor({
    bridgeClient,
    discussionTurnSession,
    requestTicket,
    freezeSelection,
    onSettled = null,
    scheduler = globalThis,
    pollIntervalMs = POLL_INTERVAL_MS,
  }) {
    if (
      !bridgeClient
      || typeof bridgeClient.startDiscussion !== "function"
      || typeof bridgeClient.discussionStatus !== "function"
    ) {
      throw new TypeError("DiscussionTurnWorkflow requires a discussion bridge client.");
    }
    if (!discussionTurnSession) {
      throw new TypeError("DiscussionTurnWorkflow requires a discussion turn session.");
    }
    if (typeof requestTicket !== "function") {
      throw new TypeError("DiscussionTurnWorkflow requires a preflight ticket provider.");
    }
    if (typeof freezeSelection !== "function") {
      throw new TypeError("DiscussionTurnWorkflow requires Agent selection authority.");
    }
    if (
      !scheduler
      || typeof scheduler.setInterval !== "function"
      || typeof scheduler.clearInterval !== "function"
    ) {
      throw new TypeError("DiscussionTurnWorkflow requires an interval Scheduler.");
    }
    this.#bridgeClient = bridgeClient;
    this.#session = discussionTurnSession;
    this.#requestTicket = requestTicket;
    this.#freezeSelection = freezeSelection;
    this.#onSettled = typeof onSettled === "function" ? onSettled : null;
    this.#scheduler = scheduler;
    this.#intervalMs = pollIntervalMs;
  }

  get session() {
    return this.#session;
  }

  get polling() {
    return this.#timer !== null;
  }

  /**
   * Starts one read-only discussion turn for the Document the user is looking
   * at. It creates no Request and no Candidate, and the answer never replaces
   * the page.
   */
  async start(context, { question, conversationId = null, expectedSourceSha256 = null } = {}) {
    if (this.#disposed) return null;
    if (!context?.sourcePath || !context.projectId || !context.documentId) return null;
    // Single-flight: one in-flight turn per Document, matched by the Bridge.
    if (this.#starting || this.#session.snapshot.busy) return null;

    const selection = this.#freezeSelection();
    if (!selection) return null;
    this.#starting = true;
    this.#session.beginTurn(context, { conversationId, selection });
    try {
      const ticket = await this.#requestTicket({ selection, purpose: "discussion" });
      if (!ticket?.preflightId) {
        throw new TypeError("The discussion turn has no usable Agent ticket.");
      }
      // The user may have switched Document while preflight was in flight.
      if (!this.#session.isActive(context)) return null;
      const payload = await this.#bridgeClient.startDiscussion({
        selection,
        trustPolicyAccepted: ticket.trustPolicyAccepted,
        preflightId: ticket.preflightId,
        projectId: context.projectId,
        documentId: context.documentId,
        sourcePath: context.sourcePath,
        conversationId,
        question,
        ...(expectedSourceSha256 ? { expectedSourceSha256 } : {}),
      });
      if (!this.#session.isActive(context)) return null;
      this.#session.publish(context, payload?.session ?? null);
      this.#syncPolling();
      return payload ?? null;
    } catch (error) {
      this.#session.fail(context, error);
      return null;
    } finally {
      this.#starting = false;
    }
  }

  /**
   * Reads the Bridge's current turn state once. Polling stops as soon as the
   * turn settles, so an idle Document costs nothing.
   */
  async pollNow({ generation = this.#pollGeneration } = {}) {
    if (this.#disposed || generation !== this.#pollGeneration) return null;
    const context = this.#session.snapshot.context;
    if (!context?.sourcePath) {
      this.#stopPolling();
      return null;
    }
    try {
      const payload = await this.#bridgeClient.discussionStatus(context.sourcePath);
      if (generation !== this.#pollGeneration) return null;
      if (!sameDocument(this.#session.snapshot.context, context)) return null;
      const wasBusy = this.#session.snapshot.busy;
      this.#session.publish(context, payload?.discussion ?? null);
      // The turn just settled, so its reply is now a stored message. Reloading
      // once is what moves the answer from this turn into the conversation.
      if (wasBusy && !this.#session.snapshot.busy) this.#onSettled?.(context);
    } catch {
      // A failed status read leaves the last known projection in place and
      // retries on the next tick. It never invents a completed turn.
    }
    this.#syncPolling();
    return this.#session.snapshot;
  }

  /**
   * Stops the in-flight turn. The Bridge marks it interrupted rather than
   * pretending it finished, and its snapshot is deleted either way.
   */
  async cancel() {
    const context = this.#session.snapshot.context;
    if (!context?.sourcePath || !this.#session.snapshot.busy) return null;
    try {
      if (typeof this.#bridgeClient.cancelDiscussion === "function") {
        const payload = await this.#bridgeClient.cancelDiscussion({
          sourcePath: context.sourcePath,
        });
        if (sameDocument(this.#session.snapshot.context, context)) {
          this.#session.publish(context, payload?.session ?? null);
        }
      }
    } catch {
      // A failed cancel is reconciled by the next poll instead of guessing.
    }
    this.#syncPolling();
    return this.#session.snapshot;
  }

  /**
   * The drain boundary. Close, Document switch and submit call this: an
   * in-flight read-only turn is cancelled, not awaited.
   */
  async drain() {
    if (!this.#session.snapshot.busy) {
      this.#stopPolling();
      return;
    }
    await this.cancel();
    this.#stopPolling();
  }

  close() {
    this.#stopPolling();
    this.#session.deactivate();
  }

  dispose() {
    this.#disposed = true;
    this.#stopPolling();
  }

  #syncPolling() {
    if (this.#disposed) return;
    if (LIVE_STATES.includes(this.#session.snapshot.status)) this.#startPolling();
    else this.#stopPolling();
  }

  #startPolling() {
    if (this.#disposed || this.#timer !== null) return;
    const generation = this.#pollGeneration;
    this.#timer = this.#scheduler.setInterval(() => {
      void this.pollNow({ generation });
    }, this.#intervalMs);
  }

  #stopPolling() {
    this.#pollGeneration += 1;
    if (this.#timer === null) return;
    this.#scheduler.clearInterval(this.#timer);
    this.#timer = null;
  }
}

export { POLL_INTERVAL_MS as DISCUSSION_POLL_INTERVAL_MS };
