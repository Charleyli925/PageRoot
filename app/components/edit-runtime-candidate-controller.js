const TERMINAL_OUTCOMES = new Set([
  "ready",
  "rejected",
  "failed",
  "superseded",
]);

let controllerSequence = 0;

function normalizedIdentity(value) {
  if (
    !value
    || typeof value !== "object"
    || !Number.isSafeInteger(value.generation)
    || value.generation < 0
    || typeof value.sourceRevision !== "string"
  ) {
    throw new TypeError("Runtime candidate identity requires a generation and source revision.");
  }
  return {
    candidateId: String(value.candidateId || ""),
    generation: value.generation,
    sourceRevision: value.sourceRevision,
  };
}

function frozenIdentity(value) {
  return Object.freeze({
    candidateId: value.candidateId,
    generation: value.generation,
    sourceRevision: value.sourceRevision,
  });
}

function sameIdentity(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.candidateId === right.candidateId
    && left.generation === right.generation
    && left.sourceRevision === right.sourceRevision;
}

function frozenSnapshot({
  latest = null,
  lastKnownGood = null,
  nativeEdit = null,
  ignoredCallbackCount = 0,
} = {}) {
  return Object.freeze({
    latestCandidate: latest ? frozenIdentity(latest) : null,
    latestPhase: latest?.phase || null,
    lastKnownGood: lastKnownGood ? frozenIdentity(lastKnownGood) : null,
    nativeEdit: nativeEdit ? Object.freeze({ ...nativeEdit }) : null,
    ignoredCallbackCount,
  });
}

/**
 * Pure ownership for disposable Runtime candidate identity and transitions.
 * React remains responsible for iframe DOM, viewport and Selection effects.
 */
export class EditRuntimeCandidateController {
  #controllerId = `runtime-${(++controllerSequence).toString(36)}`;
  #candidateSequence = 0;
  #latest = null;
  #lastKnownGood = null;
  #nativeEdit = null;
  #ignoredCallbackCount = 0;

  get snapshot() {
    return frozenSnapshot({
      latest: this.#latest,
      lastKnownGood: this.#lastKnownGood,
      nativeEdit: this.#nativeEdit,
      ignoredCallbackCount: this.#ignoredCallbackCount,
    });
  }

  beginCandidate({ generation, sourceRevision } = {}) {
    const input = normalizedIdentity({ generation, sourceRevision });
    const previous = this.#latest;
    const identity = Object.freeze({
      candidateId: `${this.#controllerId}-${(++this.#candidateSequence).toString(36)}-${generation.toString(36)}`,
      generation: input.generation,
      sourceRevision: input.sourceRevision,
    });
    this.#latest = { ...identity, phase: "preparing" };
    return Object.freeze({
      identity,
      supersededCandidate: previous ? frozenIdentity(previous) : null,
    });
  }

  accepts(candidate) {
    let normalized;
    try {
      normalized = normalizedIdentity(candidate);
    } catch {
      this.#ignoredCallbackCount += 1;
      return false;
    }
    if (sameIdentity(this.#latest, normalized)) return true;
    this.#ignoredCallbackCount += 1;
    return false;
  }

  canPromote(candidate) {
    return this.accepts(candidate)
      && this.#latest?.phase === "preparing"
      && this.#nativeEdit === null;
  }

  beginPositioning(candidate) {
    if (!this.canPromote(candidate)) return false;
    this.#latest = { ...this.#latest, phase: "positioning" };
    return true;
  }

  canFinalize(candidate) {
    if (!this.accepts(candidate) || this.#latest?.phase !== "positioning") return false;
    return this.#nativeEdit === null
      || (
        this.#nativeEdit.kind === "resume"
        && this.#nativeEdit.candidateId === this.#latest.candidateId
      );
  }

  beginNativeEdit({ candidate = null } = {}) {
    if (candidate) {
      let normalized;
      try {
        normalized = normalizedIdentity(candidate);
      } catch {
        return false;
      }
      if (
        !sameIdentity(this.#latest, normalized)
        || this.#latest?.phase !== "positioning"
      ) return false;
      this.#nativeEdit = {
        kind: "resume",
        candidateId: normalized.candidateId,
      };
      return true;
    }
    if (this.#latest?.phase === "positioning") return false;
    this.#nativeEdit = { kind: "user", candidateId: null };
    return true;
  }

  endNativeEdit() {
    const hadNativeEdit = this.#nativeEdit !== null;
    this.#nativeEdit = null;
    return hadNativeEdit;
  }

  settle(candidate, outcome) {
    if (!TERMINAL_OUTCOMES.has(outcome) || !this.accepts(candidate)) {
      return Object.freeze({
        accepted: false,
        preserveLastKnownGood: false,
        shouldUseStaticFallback: false,
      });
    }
    const directFrameReady = outcome === "ready"
      && this.#latest?.phase === "preparing"
      && this.#nativeEdit === null;
    if (outcome === "ready" && !directFrameReady && !this.canFinalize(candidate)) {
      return Object.freeze({
        accepted: false,
        preserveLastKnownGood: false,
        shouldUseStaticFallback: false,
      });
    }
    const identity = frozenIdentity(this.#latest);
    const preserveLastKnownGood = outcome !== "ready" && Boolean(this.#lastKnownGood);
    if (outcome === "ready") this.#lastKnownGood = identity;
    if (
      this.#nativeEdit?.kind === "resume"
      && this.#nativeEdit.candidateId === identity.candidateId
      && outcome !== "ready"
    ) this.#nativeEdit = null;
    this.#latest = null;
    return Object.freeze({
      accepted: true,
      preserveLastKnownGood,
      shouldUseStaticFallback: (
        (outcome === "failed" || outcome === "rejected")
        && !preserveLastKnownGood
      ),
    });
  }

  reset() {
    this.#latest = null;
    this.#lastKnownGood = null;
    this.#nativeEdit = null;
  }
}
