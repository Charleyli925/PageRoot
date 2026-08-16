function initialSnapshot() {
  return Object.freeze({
    status: "idle",
    activeApplicationId: null,
    queuedApplicationId: null,
    deferredApplicationId: null,
    deferredSequence: 0,
  });
}

function copyApplication(value) {
  if (
    !value
    || typeof value.applicationId !== "string"
    || !value.applicationId
  ) return null;
  return Object.freeze({
    applicationId: value.applicationId,
    value: value.value,
  });
}

/**
 * Owns accepted main-process project results until the renderer can safely
 * publish them. It is deliberately FIFO: a later accepted result must not
 * erase an earlier successful result merely because that predecessor is still
 * waiting for the final Canvas fence.
 */
export class ProjectApplicationSession {
  #observer = null;

  #snapshot = initialSnapshot();

  #active = null;

  #queued = [];

  #deferred = null;

  #deferredSequence = 0;

  #observedDeferredSequence = 0;

  #sawSwitchBlocker = false;

  #execute = null;

  #drainPromise = null;

  #generation = 0;

  #receipts = new Map();

  #waiters = new Map();

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit() {
    const status = this.#active
      ? "applying"
      : this.#deferred
        ? "deferred"
        : this.#queued.length > 0
          ? "queued"
          : "idle";
    this.#snapshot = Object.freeze({
      status,
      activeApplicationId: this.#active?.applicationId || null,
      queuedApplicationId: this.#queued[0]?.applicationId || null,
      deferredApplicationId: this.#deferred?.applicationId || null,
      deferredSequence: this.#deferredSequence,
    });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change project-application authority.
    }
  }

  #drain() {
    if (this.#drainPromise) return this.#drainPromise;
    if (this.#deferred) return Promise.resolve();
    const generation = this.#generation;
    const drain = async () => {
      while (generation === this.#generation) {
        const application = this.#queued.shift();
        if (!application) break;
        this.#active = application;
        this.#emit();

        let result = "complete";
        try {
          result = await this.#execute?.(application);
        } catch {
          // The executor owns presentation of an actionable failure. A failed
          // predecessor must not strand later accepted project results.
        }

        if (generation !== this.#generation) break;
        this.#active = null;
        if (result === "deferred") {
          this.#deferred = application;
          this.#deferredSequence += 1;
          this.#sawSwitchBlocker = false;
          this.#emit();
          break;
        }
        this.#settle(application.applicationId, result === "complete" || !result
          ? "succeeded"
          : String(result));
        this.#emit();
      }
    };
    const promise = drain().finally(() => {
      if (this.#drainPromise !== promise) return;
      this.#drainPromise = null;
      if (this.#queued.length > 0 && !this.#deferred) {
        void this.#drain();
      } else {
        this.#emit();
      }
    });
    this.#drainPromise = promise;
    return promise;
  }

  enqueue(value, execute) {
    const application = copyApplication(value);
    if (!application || typeof execute !== "function") return false;
    this.#execute = execute;
    this.#queued.push(application);
    this.#emit();
    void this.#drain();
    return true;
  }

  resume(execute) {
    if (!this.#deferred || typeof execute !== "function") return false;
    this.#execute = execute;
    this.#queued.unshift(this.#deferred);
    this.#deferred = null;
    this.#emit();
    void this.#drain();
    return true;
  }

  // This session owns the FIFO predecessor's blocker transition, so Workbench
  // keeps no second retry history for an accepted project result.
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

  waitFor(applicationId) {
    const id = String(applicationId || "");
    if (!id) {
      return Promise.resolve(Object.freeze({
        applicationId: "",
        result: "stale",
      }));
    }
    const existing = this.#receipts.get(id);
    if (existing) return Promise.resolve(existing);
    return new Promise((resolve) => {
      const waiters = this.#waiters.get(id) || [];
      waiters.push(resolve);
      this.#waiters.set(id, waiters);
    });
  }

  #settle(applicationId, result) {
    const receipt = Object.freeze({
      applicationId: String(applicationId),
      result: String(result || "succeeded"),
    });
    this.#receipts.set(receipt.applicationId, receipt);
    const waiters = this.#waiters.get(receipt.applicationId) || [];
    this.#waiters.delete(receipt.applicationId);
    for (const resolve of waiters) resolve(receipt);
  }

  dispose() {
    this.#generation += 1;
    this.#observer = null;
    this.#active = null;
    this.#queued = [];
    this.#deferred = null;
    this.#observedDeferredSequence = 0;
    this.#sawSwitchBlocker = false;
    this.#execute = null;
    for (const [applicationId, waiters] of this.#waiters) {
      const receipt = Object.freeze({
        applicationId,
        result: "stale",
      });
      this.#receipts.set(applicationId, receipt);
      for (const resolve of waiters) resolve(receipt);
    }
    this.#waiters.clear();
    this.#emit();
  }

  get snapshot() {
    return this.#snapshot;
  }
}
