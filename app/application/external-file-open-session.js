const MAX_REMEMBERED_REQUESTS = 64;

function copyConfirmation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const requestId = typeof value.requestId === "string" ? value.requestId : "";
  const classification = typeof value.classification === "string"
    ? value.classification
    : "";
  if (!requestId || !classification) return null;
  return Object.freeze({ ...value, requestId, classification });
}

function copyRequest(value) {
  if (!value || typeof value.requestId !== "string" || !value.requestId) {
    return null;
  }
  return Object.freeze({
    requestId: value.requestId,
    sourcePath: typeof value.sourcePath === "string" ? value.sourcePath : "",
    classification: typeof value.classification === "string"
      ? value.classification
      : null,
    confirmation: copyConfirmation(value.confirmation || (
      value.classification ? value : null
    )),
  });
}

function initialSnapshot() {
  return Object.freeze({
    status: "idle",
    activeRequestId: null,
    queuedRequestId: null,
    deferredRequestId: null,
    deferredSequence: 0,
    confirmation: null,
    attention: null,
  });
}

/**
 * Owns renderer-side external-file delivery. At most one request is opened at
 * a time; a newer OS request replaces only work that has not started yet.
 * Deferred requests stay here rather than leaking into Workbench's ordinary
 * project-picker retry state.
 */
export class ExternalFileOpenSession {
  #observer = null;

  #snapshot = initialSnapshot();

  #active = null;

  #queued = null;

  #deferred = null;

  #confirmation = null;

  #attention = null;

  #awaitingConfirmation = false;

  #deferredSequence = 0;

  #observedDeferredSequence = 0;

  #sawSwitchBlocker = false;

  #execute = null;

  #drainPromise = null;

  #generation = 0;

  #rememberedRequestIds = new Set();

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit() {
    const status = this.#awaitingConfirmation
      ? "awaiting-confirmation"
      : this.#active
        ? "opening"
        : this.#deferred
          ? "deferred"
          : this.#queued
            ? "queued"
            : this.#attention
              ? "attention"
              : "idle";
    this.#snapshot = Object.freeze({
      status,
      activeRequestId: this.#active?.requestId || null,
      queuedRequestId: this.#queued?.requestId || null,
      deferredRequestId: this.#deferred?.requestId || null,
      deferredSequence: this.#deferredSequence,
      confirmation: this.#confirmation,
      attention: this.#attention,
    });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change external-open authority.
    }
  }

  #remember(request) {
    if (this.#rememberedRequestIds.has(request.requestId)) return false;
    this.#rememberedRequestIds.add(request.requestId);
    while (this.#rememberedRequestIds.size > MAX_REMEMBERED_REQUESTS) {
      const oldest = this.#rememberedRequestIds.values().next().value;
      if (!oldest) break;
      this.#rememberedRequestIds.delete(oldest);
    }
    return true;
  }

  #drain() {
    if (this.#drainPromise) return this.#drainPromise;
    if (this.#awaitingConfirmation) return Promise.resolve();
    const generation = this.#generation;
    const drain = async () => {
      while (generation === this.#generation) {
        if (this.#awaitingConfirmation) break;
        const request = this.#queued;
        if (!request) break;
        this.#queued = null;
        this.#active = request;
        this.#emit();

        let result = "complete";
        try {
          result = await this.#execute?.(request, {
            isSuperseded: () => (
              generation !== this.#generation || this.#queued !== null
            ),
          });
        } catch {
          // The caller presents actionable errors; one failed request cannot
          // strand a later request in the queue.
        }

        if (generation !== this.#generation) break;
        if (result === "awaiting-confirmation") {
          this.#awaitingConfirmation = true;
          this.#confirmation = request.confirmation || this.#confirmation;
          this.#attention = null;
          this.#emit();
          break;
        }
        this.#active = null;
        this.#confirmation = null;
        if (result === "deferred" && !this.#queued) {
          this.#deferred = request;
          this.#deferredSequence += 1;
          this.#sawSwitchBlocker = false;
          this.#emit();
          break;
        }
        this.#emit();
      }
    };
    const promise = drain().finally(() => {
      if (this.#drainPromise !== promise) return;
      this.#drainPromise = null;
      if (this.#queued && !this.#deferred && !this.#awaitingConfirmation) {
        void this.#drain();
      } else {
        this.#emit();
      }
    });
    this.#drainPromise = promise;
    return promise;
  }

  enqueue(value, execute) {
    const request = copyRequest(value);
    if (!request || typeof execute !== "function" || !this.#remember(request)) {
      return false;
    }
    this.#execute = execute;
    // A newly delivered OS intent is newer than an earlier retry waiting for
    // the editor or persistence drain to become safe. It also replaces a
    // confirmation the user has not accepted yet.
    this.#deferred = null;
    this.#attention = null;
    if (this.#awaitingConfirmation) {
      this.#awaitingConfirmation = false;
      this.#confirmation = null;
      this.#active = null;
    }
    this.#queued = request;
    this.#emit();
    void this.#drain();
    return true;
  }

  presentConfirmation(requestId, descriptor) {
    if (!this.#active || this.#active.requestId !== String(requestId || "")) {
      return false;
    }
    const confirmation = copyConfirmation(descriptor);
    if (!confirmation) return false;
    this.#confirmation = confirmation;
    this.#awaitingConfirmation = true;
    this.#attention = null;
    this.#emit();
    return true;
  }

  completeConfirmation(requestId) {
    if (!this.#awaitingConfirmation || this.#active?.requestId !== String(requestId || "")) {
      return false;
    }
    this.#awaitingConfirmation = false;
    this.#confirmation = null;
    this.#attention = null;
    this.#active = null;
    this.#emit();
    void this.#drain();
    return true;
  }

  cancelConfirmation(requestId) {
    if (!this.#awaitingConfirmation || this.#active?.requestId !== String(requestId || "")) {
      return false;
    }
    this.#awaitingConfirmation = false;
    this.#confirmation = null;
    this.#attention = null;
    this.#active = null;
    this.#emit();
    void this.#drain();
    return true;
  }

  setAttention(requestId, attention) {
    if (this.#active?.requestId !== String(requestId || "")) return false;
    this.#attention = attention && typeof attention === "object"
      ? Object.freeze({ ...attention })
      : null;
    this.#emit();
    return true;
  }

  resume(execute) {
    if (!this.#deferred || typeof execute !== "function") return false;
    this.#execute = execute;
    this.#queued = this.#deferred;
    this.#deferred = null;
    this.#emit();
    void this.#drain();
    return true;
  }

  // A new deferred request retries only after an observed blocker clears;
  // otherwise it awaits the explicit retry action.
  reconcileDeferredSwitch({ switchBlocked, execute }) {
    if (!this.#deferred || typeof execute !== "function") return "idle";
    this.#execute = execute;

    if (this.#observedDeferredSequence !== this.#deferredSequence) {
      this.#observedDeferredSequence = this.#deferredSequence;
      this.#sawSwitchBlocker = Boolean(switchBlocked);
      return switchBlocked ? "blocked" : "action-required";
    }
    if (switchBlocked) {
      this.#sawSwitchBlocker = true;
      return "blocked";
    }
    if (!this.#sawSwitchBlocker) return "blocked";
    this.#sawSwitchBlocker = false;
    return this.resume(execute) ? "resumed" : "idle";
  }

  dispose() {
    this.#generation += 1;
    this.#observer = null;
    this.#active = null;
    this.#queued = null;
    this.#deferred = null;
    this.#confirmation = null;
    this.#attention = null;
    this.#awaitingConfirmation = false;
    this.#observedDeferredSequence = 0;
    this.#sawSwitchBlocker = false;
    this.#execute = null;
    this.#emit();
  }

  get snapshot() {
    return this.#snapshot;
  }
}
