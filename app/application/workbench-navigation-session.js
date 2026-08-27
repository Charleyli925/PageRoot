const PHASES = new Set([
  "idle",
  "admitted",
  "preparing",
  "awaiting-user",
  "opening",
  "applied",
  "display-ready",
  "hydrating",
  "canvas-verified",
  "committed",
]);
const NEXT_PHASES = Object.freeze({
  admitted: new Set(["preparing", "opening"]),
  preparing: new Set(["awaiting-user", "opening", "canvas-verified"]),
  "awaiting-user": new Set(["opening"]),
  opening: new Set(["awaiting-user", "applied"]),
  applied: new Set(["display-ready", "hydrating"]),
  "display-ready": new Set(["committed"]),
  hydrating: new Set(["canvas-verified"]),
  "canvas-verified": new Set(["committed"]),
  committed: new Set(),
});

function freezeSnapshot(value) {
  return Object.freeze({
    revision: Number(value.revision) || 0,
    admissionOrdinal: Number(value.admissionOrdinal) || 0,
    phase: PHASES.has(value.phase) ? value.phase : "idle",
    transactionId: value.transactionId ? String(value.transactionId) : null,
    intent: value.intent ? Object.freeze({ ...value.intent }) : null,
    receipt: value.receipt ? Object.freeze({ ...value.receipt }) : null,
    lastReceipt: value.lastReceipt ? Object.freeze({ ...value.lastReceipt }) : null,
    error: value.error ? Object.freeze({ ...value.error }) : null,
  });
}

export const INITIAL_WORKBENCH_NAVIGATION_SNAPSHOT = freezeSnapshot({
  revision: 0,
  admissionOrdinal: 0,
  phase: "idle",
  transactionId: null,
  intent: null,
  receipt: null,
  lastReceipt: null,
  error: null,
});

export class WorkbenchNavigationSession {
  #listeners = new Set();
  #snapshot = INITIAL_WORKBENCH_NAVIGATION_SNAPSHOT;

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("navigation listener is required");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  admit({ transactionId, intent, admissionOrdinal }) {
    if (this.#snapshot.phase !== "idle") return null;
    return this.#publish({
      admissionOrdinal,
      phase: "admitted",
      transactionId,
      intent,
      receipt: null,
      lastReceipt: this.#snapshot.lastReceipt,
      error: null,
    });
  }

  transition(transactionId, phase, patch = {}) {
    if (
      !PHASES.has(phase)
      || phase === "idle"
      || this.#snapshot.transactionId !== String(transactionId || "")
      || !NEXT_PHASES[this.#snapshot.phase]?.has(phase)
    ) return null;
    return this.#publish({
      ...this.#snapshot,
      ...patch,
      phase,
      transactionId: this.#snapshot.transactionId,
    });
  }

  applied(transactionId, receipt) {
    return this.transition(transactionId, "applied", { receipt });
  }

  finish(transactionId, { receipt = null, error = null } = {}) {
    if (this.#snapshot.transactionId !== String(transactionId || "")) return null;
    if (receipt) {
      this.transition(transactionId, "committed", { receipt, error });
    }
    return this.#publish({
      admissionOrdinal: this.#snapshot.admissionOrdinal,
      phase: "idle",
      transactionId: null,
      intent: null,
      receipt: null,
      lastReceipt: receipt || this.#snapshot.lastReceipt,
      error,
    });
  }

  dispose() {
    this.#listeners.clear();
    if (this.#snapshot.phase !== "idle") {
      this.#snapshot = freezeSnapshot({
        ...INITIAL_WORKBENCH_NAVIGATION_SNAPSHOT,
        revision: this.#snapshot.revision + 1,
        admissionOrdinal: this.#snapshot.admissionOrdinal,
        lastReceipt: this.#snapshot.lastReceipt,
        error: Object.freeze({ code: "WORKBENCH_NAVIGATION_DISPOSED", reason: "navigation disposed" }),
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
        // Presentation projection cannot interrupt navigation authority.
      }
    }
    return this.#snapshot;
  }
}
