const TERMINAL_OUTCOMES = new Set([
  "ready",
  "rejected",
  "failed",
  "superseded",
]);

const SLOT_IDS = Object.freeze(["a", "b"]);
let coordinatorSequence = 0;

function otherSlot(slotId) {
  return slotId === "a" ? "b" : "a";
}

function normalizedIdentity(value) {
  if (
    !value
    || typeof value !== "object"
    || !Number.isSafeInteger(value.generation)
    || value.generation < 0
    || typeof value.sourceRevision !== "string"
    || !SLOT_IDS.includes(value.slotId)
    || !Number.isSafeInteger(value.slotLease)
    || value.slotLease < 1
  ) {
    throw new TypeError(
      "Runtime frame identity requires a generation, source revision, slot, and slot lease.",
    );
  }
  return {
    candidateId: String(value.candidateId || ""),
    generation: value.generation,
    sourceRevision: value.sourceRevision,
    slotId: value.slotId,
    slotLease: value.slotLease,
  };
}

function frozenIdentity(value) {
  return Object.freeze({
    candidateId: value.candidateId,
    generation: value.generation,
    sourceRevision: value.sourceRevision,
    slotId: value.slotId,
    slotLease: value.slotLease,
  });
}

function sameIdentity(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.candidateId === right.candidateId
    && left.generation === right.generation
    && left.sourceRevision === right.sourceRevision
    && left.slotId === right.slotId
    && left.slotLease === right.slotLease;
}

function frozenSlot(slot) {
  return Object.freeze({
    slotId: slot.slotId,
    slotLease: slot.slotLease,
    phase: slot.phase,
    identity: slot.identity ? frozenIdentity(slot.identity) : null,
  });
}

function frozenSnapshot({
  slots,
  activeSlotId,
  latest,
  lastKnownGood,
  nativeEdit,
  ignoredCallbackCount,
}) {
  return Object.freeze({
    slots: Object.freeze({
      a: frozenSlot(slots.a),
      b: frozenSlot(slots.b),
    }),
    activeSlotId,
    candidateSlotId: latest?.slotId || null,
    latestCandidate: latest ? frozenIdentity(latest) : null,
    latestPhase: latest?.phase || null,
    lastKnownGood: lastKnownGood ? frozenIdentity(lastKnownGood) : null,
    nativeEdit: nativeEdit ? Object.freeze({ ...nativeEdit }) : null,
    ignoredCallbackCount,
  });
}

/**
 * Single owner for the two physical Runtime iframe slots and candidate identity.
 * React owns iframe DOM effects; the coordinator owns only slot leases and
 * lifecycle transitions, so a stale callback can never acquire a reused slot.
 */
export class RuntimeFrameCoordinator {
  #coordinatorId = `runtime-${(++coordinatorSequence).toString(36)}`;
  #candidateSequence = 0;
  #slots = {
    a: { slotId: "a", slotLease: 0, phase: "active", identity: null },
    b: { slotId: "b", slotLease: 0, phase: "empty", identity: null },
  };
  #activeSlotId = "a";
  #latest = null;
  #lastKnownGood = null;
  #nativeEdit = null;
  #ignoredCallbackCount = 0;

  get snapshot() {
    return frozenSnapshot({
      slots: this.#slots,
      activeSlotId: this.#activeSlotId,
      latest: this.#latest,
      lastKnownGood: this.#lastKnownGood,
      nativeEdit: this.#nativeEdit,
      ignoredCallbackCount: this.#ignoredCallbackCount,
    });
  }

  beginCandidate({ generation, sourceRevision } = {}) {
    const previous = this.#latest;
    const slotId = previous?.slotId
      || (this.#activeSlotId ? otherSlot(this.#activeSlotId) : "a");
    const slot = this.#slots[slotId];
    const input = {
      candidateId: "pending",
      generation,
      sourceRevision,
      slotId,
      slotLease: slot.slotLease + 1,
    };
    normalizedIdentity(input);
    const identity = Object.freeze({
      candidateId: `${this.#coordinatorId}-${(++this.#candidateSequence).toString(36)}-${generation.toString(36)}`,
      generation,
      sourceRevision,
      slotId,
      slotLease: input.slotLease,
    });
    this.#latest = { ...identity, phase: "preparing" };
    this.#slots[slotId] = {
      slotId,
      slotLease: identity.slotLease,
      phase: "preparing",
      identity,
    };
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
    const slot = this.#slots[normalized.slotId];
    if (
      sameIdentity(this.#latest, normalized)
      && slot.slotLease === normalized.slotLease
      && sameIdentity(slot.identity, normalized)
    ) return true;
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
    const slotId = this.#latest.slotId;
    this.#slots[slotId] = {
      ...this.#slots[slotId],
      phase: "positioning",
    };
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
    if (outcome === "ready" && !this.canFinalize(candidate)) {
      return Object.freeze({
        accepted: false,
        preserveLastKnownGood: false,
        shouldUseStaticFallback: false,
      });
    }
    const identity = frozenIdentity(this.#latest);
    const preserveLastKnownGood = outcome !== "ready" && Boolean(this.#lastKnownGood);
    const slotId = identity.slotId;
    if (outcome === "ready") {
      const previousActiveSlotId = this.#activeSlotId;
      this.#lastKnownGood = identity;
      this.#activeSlotId = slotId;
      this.#slots[slotId] = {
        ...this.#slots[slotId],
        phase: "active",
        identity,
      };
      if (previousActiveSlotId && previousActiveSlotId !== slotId) {
        this.#slots[previousActiveSlotId] = {
          ...this.#slots[previousActiveSlotId],
          phase: "empty",
          identity: null,
        };
      }
    } else {
      this.#slots[slotId] = this.#activeSlotId === slotId
        ? {
            ...this.#slots[slotId],
            phase: "active",
            identity: null,
          }
        : {
            ...this.#slots[slotId],
            phase: "empty",
            identity: null,
          };
    }
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
    this.#slots = {
      a: { slotId: "a", slotLease: this.#slots.a.slotLease, phase: "active", identity: null },
      b: { slotId: "b", slotLease: this.#slots.b.slotLease, phase: "empty", identity: null },
    };
    this.#activeSlotId = "a";
    this.#latest = null;
    this.#lastKnownGood = null;
    this.#nativeEdit = null;
  }
}
