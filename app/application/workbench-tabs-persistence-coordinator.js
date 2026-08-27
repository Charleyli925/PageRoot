function freezeSnapshot(value) {
  return Object.freeze({
    revision: Number(value.revision) || 0,
    requestedRevision: Number(value.requestedRevision) || 0,
    acknowledgedRevision: Number(value.acknowledgedRevision) || 0,
    phase: value.phase || "idle",
    restartSafe: value.restartSafe !== false,
    error: value.error ? String(value.error) : null,
  });
}

export const INITIAL_WORKBENCH_TABS_PERSISTENCE_SNAPSHOT = freezeSnapshot({
  revision: 0,
  requestedRevision: 0,
  acknowledgedRevision: 0,
  phase: "idle",
  restartSafe: true,
  error: null,
});

export class WorkbenchTabsPersistenceCoordinator {
  #port;
  #clock;
  #setTimer;
  #clearTimer;
  #listeners = new Set();
  #drainWaiters = new Set();
  #snapshot = INITIAL_WORKBENCH_TABS_PERSISTENCE_SNAPSHOT;
  #latest = null;
  #writing = false;
  #disposed = false;
  #closeRevision = null;
  #bufferedWhileClose = null;

  constructor({
    port = null,
    clock = { now: Date.now },
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
  } = {}) {
    this.#port = port;
    this.#clock = clock;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("persistence listener is required");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async load() {
    if (this.#disposed || typeof this.#port?.get !== "function") return null;
    this.#publish({ ...this.#snapshot, phase: "loading", restartSafe: false, error: null });
    try {
      const state = await this.#port.get();
      this.#publish({ ...this.#snapshot, phase: "idle", restartSafe: true, error: null });
      this.#settleDrains();
      return state;
    } catch (cause) {
      this.#publish({
        ...this.#snapshot,
        phase: "failed",
        restartSafe: false,
        error: String(cause?.message || cause || "无法读取上次的标签页状态。"),
      });
      this.#settleDrains();
      throw cause;
    }
  }

  commit(state) {
    if (this.#disposed || typeof this.#port?.set !== "function") return null;
    if (this.#closeRevision !== null) {
      this.#bufferedWhileClose = state;
      return Object.freeze({
        requestedRevision: this.#closeRevision,
        deferred: true,
      });
    }
    const requestedRevision = this.#snapshot.requestedRevision + 1;
    this.#latest = Object.freeze({ requestedRevision, state });
    this.#publish({
      ...this.#snapshot,
      requestedRevision,
      phase: this.#writing ? "writing" : "queued",
      restartSafe: false,
      error: null,
    });
    void this.#pump();
    return Object.freeze({ requestedRevision });
  }

  pinCloseRevision() {
    if (this.#disposed || this.#closeRevision !== null) return null;
    this.#closeRevision = this.#snapshot.requestedRevision;
    return this.#closeRevision;
  }

  releaseCloseRevision() {
    if (this.#closeRevision === null) return false;
    this.#closeRevision = null;
    const buffered = this.#bufferedWhileClose;
    this.#bufferedWhileClose = null;
    if (buffered) this.commit(buffered);
    return true;
  }

  retry() {
    if (this.#disposed || !this.#latest) return false;
    if (this.#latest.requestedRevision <= this.#snapshot.acknowledgedRevision) return true;
    this.#publish({ ...this.#snapshot, phase: "queued", error: null });
    void this.#pump();
    return true;
  }

  drain({ deadlineAt, throughRevision } = {}) {
    const targetRevision = Number.isFinite(Number(throughRevision))
      ? Math.max(0, Number(throughRevision))
      : this.#snapshot.requestedRevision;
    if (this.#snapshot.phase === "failed") {
      return Promise.resolve(Object.freeze({
        ok: false,
        reason: this.#snapshot.error || "标签页状态写入失败。",
      }));
    }
    if (
      this.#snapshot.phase !== "loading"
      && this.#snapshot.acknowledgedRevision >= targetRevision
    ) {
      return Promise.resolve(Object.freeze({ ok: true, revision: this.#snapshot.acknowledgedRevision }));
    }
    const remaining = Math.max(0, Number(deadlineAt) - Number(this.#clock.now()));
    if (this.#disposed || remaining <= 0) {
      return Promise.resolve(Object.freeze({ ok: false, reason: "标签页状态未在关闭时限内写入。" }));
    }
    return new Promise((resolve) => {
      const waiter = {
        targetRevision,
        timer: null,
        resolve: (result) => {
          if (!this.#drainWaiters.delete(waiter)) return;
          if (waiter.timer !== null) this.#clearTimer(waiter.timer);
          resolve(Object.freeze(result));
        },
      };
      waiter.timer = this.#setTimer(() => waiter.resolve({
        ok: false,
        reason: "标签页状态未在关闭时限内写入。",
      }), remaining);
      this.#drainWaiters.add(waiter);
    });
  }

  dispose() {
    this.#disposed = true;
    this.#closeRevision = null;
    this.#bufferedWhileClose = null;
    for (const waiter of [...this.#drainWaiters]) waiter.resolve({
      ok: false,
      reason: "标签页状态写入已停止。",
    });
    this.#listeners.clear();
  }

  async #pump() {
    if (this.#writing || this.#disposed || !this.#latest) return;
    this.#writing = true;
    while (!this.#disposed && this.#latest) {
      const target = this.#latest;
      if (target.requestedRevision <= this.#snapshot.acknowledgedRevision) break;
      this.#publish({ ...this.#snapshot, phase: "writing", restartSafe: false, error: null });
      try {
        await this.#port.set(target.state);
      } catch (cause) {
        this.#writing = false;
        this.#publish({
          ...this.#snapshot,
          phase: "failed",
          restartSafe: false,
          error: String(cause?.message || cause || "标签页状态写入失败。"),
        });
        this.#settleDrains();
        return;
      }
      this.#publish({
        ...this.#snapshot,
        acknowledgedRevision: target.requestedRevision,
        phase: this.#latest.requestedRevision > target.requestedRevision ? "queued" : "idle",
        restartSafe: this.#latest.requestedRevision <= target.requestedRevision,
        error: null,
      });
      this.#settleDrains();
      if (this.#latest.requestedRevision <= target.requestedRevision) break;
    }
    this.#writing = false;
  }

  #settleDrains() {
    if (this.#snapshot.phase === "failed") {
      for (const waiter of [...this.#drainWaiters]) waiter.resolve({
        ok: false,
        reason: this.#snapshot.error || "标签页状态写入失败。",
      });
      return;
    }
    if (this.#snapshot.phase === "loading") return;
    for (const waiter of [...this.#drainWaiters]) {
      if (this.#snapshot.acknowledgedRevision < waiter.targetRevision) continue;
      waiter.resolve({
        ok: true,
        revision: this.#snapshot.acknowledgedRevision,
      });
    }
  }

  #publish(next) {
    this.#snapshot = freezeSnapshot({
      ...next,
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation projection cannot interrupt persistence authority.
      }
    }
  }
}
