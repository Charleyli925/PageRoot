export const NATIVE_BLOCK_MUTATION_STATES = Object.freeze({
  CLEAN: "clean",
  DIRTY_OWNED: "dirty-owned",
  DIRTY_UNOWNED: "dirty-unowned",
  POISONED: "poisoned",
});

export const NATIVE_BLOCK_COMMAND_REPLACEMENT_POLICY = "latest-wins";

const ACTIVE_COMPOSITION_PHASES = new Set([
  "composing",
  "settling",
  "stable",
  "timed-out",
]);

function clonePlainValue(value, seen = new Map()) {
  if (
    value === null
    || typeof value === "string"
    || typeof value === "number"
    || typeof value === "boolean"
    || typeof value === "undefined"
    || typeof value === "bigint"
  ) return value;
  if (typeof value === "symbol" || typeof value === "function") {
    throw new TypeError("Native block draft values must be data-only.");
  }
  if (seen.has(value)) {
    throw new TypeError("Native block draft values must not contain cycles.");
  }

  const copy = Array.isArray(value) ? [] : {};
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("Native block draft values must use plain objects.");
  }
  seen.set(value, copy);
  for (const key of Object.keys(value)) {
    copy[key] = clonePlainValue(value[key], seen);
  }
  seen.delete(value);
  return copy;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableCopy(value) {
  return deepFreeze(clonePlainValue(value));
}

function accepted(details = {}) {
  return immutableCopy({ accepted: true, ...details });
}

function rejected(reason, details = {}) {
  return immutableCopy({ accepted: false, reason, ...details });
}

function normalizeLease(lease) {
  if (
    !lease
    || typeof lease !== "object"
    || typeof lease.sessionId !== "string"
    || lease.sessionId.length === 0
    || !Number.isSafeInteger(lease.domGeneration)
    || lease.domGeneration < 0
    || typeof lease.sourceRevision !== "string"
    || lease.sourceRevision.length === 0
    || typeof lease.hostId !== "string"
    || lease.hostId.length === 0
  ) {
    throw new TypeError("Native block draft lease is invalid.");
  }
  return immutableCopy({
    sessionId: lease.sessionId,
    domGeneration: lease.domGeneration,
    sourceRevision: lease.sourceRevision,
    hostId: lease.hostId,
  });
}

function leasesMatch(left, right) {
  return Boolean(
    left
    && right
    && left.sessionId === right.sessionId
    && left.domGeneration === right.domGeneration
    && left.sourceRevision === right.sourceRevision
    && left.hostId === right.hostId,
  );
}

function isSafeUtf16Boundary(value, offset) {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return !(
    previous >= 0xd800
    && previous <= 0xdbff
    && next >= 0xdc00
    && next <= 0xdfff
  );
}

function normalizeSelection(selection, text, label = "selection") {
  if (
    !selection
    || typeof selection !== "object"
    || !Number.isSafeInteger(selection.anchor)
    || !Number.isSafeInteger(selection.focus)
    || selection.anchor < 0
    || selection.focus < 0
    || selection.anchor > text.length
    || selection.focus > text.length
    || !isSafeUtf16Boundary(text, selection.anchor)
    || !isSafeUtf16Boundary(text, selection.focus)
    || (selection.affinity !== "left" && selection.affinity !== "right")
  ) {
    throw new TypeError(`Native block draft ${label} is invalid.`);
  }
  return immutableCopy({
    anchor: selection.anchor,
    focus: selection.focus,
    affinity: selection.affinity,
  });
}

function selectionsMatch(left, right) {
  return Boolean(
    left
    && right
    && left.anchor === right.anchor
    && left.focus === right.focus
    && left.affinity === right.affinity,
  );
}

function normalizeCompositionId(compositionId) {
  if (typeof compositionId !== "string" || compositionId.length === 0) {
    throw new TypeError("Native block draft composition id is invalid.");
  }
  return compositionId;
}

function normalizeTaskTurn(taskTurn) {
  if (!Number.isSafeInteger(taskTurn) || taskTurn < 0) {
    throw new TypeError("Native block draft task turn is invalid.");
  }
  return taskTurn;
}

function normalizeReason(reason, fallback) {
  return typeof reason === "string" && reason.length > 0 ? reason : fallback;
}

function normalizeText(text, label = "text") {
  if (typeof text !== "string") {
    throw new TypeError(`Native block draft ${label} is invalid.`);
  }
  return text;
}

function normalizeCommand(command, sequence, compositionId) {
  if (
    !command
    || typeof command !== "object"
    || typeof command.kind !== "string"
    || command.kind.length === 0
  ) {
    throw new TypeError("Native block draft command is invalid.");
  }
  const authority = command.authority ?? "user-explicit";
  if (authority !== "user-explicit" && authority !== "system") {
    throw new TypeError("Native block draft command authority is invalid.");
  }
  return immutableCopy({
    sequence,
    kind: command.kind,
    authority,
    ...(Object.hasOwn(command, "payload")
      ? { payload: clonePlainValue(command.payload) }
      : {}),
    compositionId,
  });
}

function newCompositionGuard(compositionId, text, selection) {
  return immutableCopy({
    compositionId,
    phase: "composing",
    startText: text,
    startSelection: selection,
    candidateText: null,
    candidateSelection: null,
    stableObservationCount: 0,
    lastObservedTaskTurn: null,
    fallbackAuthorized: false,
  });
}

function resetSettlingGuard(guard) {
  return immutableCopy({
    ...guard,
    phase: "settling",
    candidateText: null,
    candidateSelection: null,
    stableObservationCount: 0,
    lastObservedTaskTurn: null,
    fallbackAuthorized: false,
  });
}

/**
 * Shadow-mode authority model for one source-backed native editing island.
 *
 * The draft never reads DOM. Callers may submit strictly session-owned input
 * evidence, or settling observations tied to the composition id that opened
 * in this draft. An unowned mutation blocks all later text adoption until a
 * canonical source rebase creates a new trustworthy baseline.
 */
export class NativeBlockEditDraft {
  #lease;

  #baselineText;

  #currentText;

  #baselineSelection;

  #currentSelection;

  #formatSkeleton;

  #mutationState = NATIVE_BLOCK_MUTATION_STATES.CLEAN;

  #mutationReason = null;

  #compositionGuard = null;

  #pendingCommand = null;

  #commandSequence = 0;

  #expired = false;

  constructor({
    lease,
    baselineText,
    baselineSelection,
    formatSkeleton = null,
  }) {
    this.#lease = normalizeLease(lease);
    this.#baselineText = normalizeText(baselineText, "baseline text");
    this.#currentText = this.#baselineText;
    this.#baselineSelection = normalizeSelection(
      baselineSelection,
      this.#baselineText,
      "baseline selection",
    );
    this.#currentSelection = this.#baselineSelection;
    this.#formatSkeleton = immutableCopy(formatSkeleton);
  }

  snapshot() {
    return immutableCopy({
      lease: this.#lease,
      baselineText: this.#baselineText,
      currentText: this.#currentText,
      baselineSelection: this.#baselineSelection,
      currentSelection: this.#currentSelection,
      formatSkeleton: this.#formatSkeleton,
      mutationState: this.#mutationState,
      mutationReason: this.#mutationReason,
      compositionGuard: this.#compositionGuard,
      pendingCommand: this.#pendingCommand,
      expired: this.#expired,
    });
  }

  #authorizeLease(candidate) {
    let normalized;
    try {
      normalized = normalizeLease(candidate);
    } catch {
      return rejected("invalid-lease");
    }
    if (!leasesMatch(this.#lease, normalized)) return rejected("stale-lease");
    if (this.#expired) return rejected("expired-lease");
    return accepted();
  }

  #authorizeOwnedEvidence(candidate, compositionId) {
    const leaseResult = this.#authorizeLease(candidate);
    if (!leaseResult.accepted) return leaseResult;
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.POISONED) {
      return rejected("poisoned");
    }
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.DIRTY_UNOWNED) {
      return rejected("unowned-dom");
    }

    if (this.#compositionGuard && ACTIVE_COMPOSITION_PHASES.has(
      this.#compositionGuard.phase,
    )) {
      if (compositionId === null || typeof compositionId === "undefined") {
        return rejected("composition-id-required");
      }
      if (compositionId !== this.#compositionGuard.compositionId) {
        return rejected("stale-composition");
      }
      if (
        this.#compositionGuard.phase === "timed-out"
        || this.#compositionGuard.phase === "cancelled"
      ) {
        return rejected("composition-closed");
      }
    } else if (compositionId !== null && typeof compositionId !== "undefined") {
      return rejected("stale-composition");
    }
    return accepted();
  }

  #markOwnedMutation(reason = "session-owned") {
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.CLEAN) {
      this.#mutationState = NATIVE_BLOCK_MUTATION_STATES.DIRTY_OWNED;
      this.#mutationReason = reason;
    }
  }

  recordOwnedMutation({ lease, compositionId = null, reason } = {}) {
    const authority = this.#authorizeOwnedEvidence(lease, compositionId);
    if (!authority.accepted) return authority;
    this.#markOwnedMutation(normalizeReason(reason, "session-owned-mutation"));
    return accepted({ mutationState: this.#mutationState });
  }

  recordOwnedText({
    lease,
    text,
    selection,
    evidence,
    compositionId = null,
  } = {}) {
    if (evidence !== "input" && evidence !== "composition") {
      return rejected("invalid-owned-evidence");
    }
    if (
      evidence === "composition"
      && (compositionId === null || typeof compositionId === "undefined")
    ) {
      return rejected("composition-id-required");
    }
    const authority = this.#authorizeOwnedEvidence(lease, compositionId);
    if (!authority.accepted) return authority;

    let normalizedText;
    let normalizedSelection;
    try {
      normalizedText = normalizeText(text);
      normalizedSelection = normalizeSelection(selection, normalizedText);
    } catch {
      return rejected(typeof text === "string" ? "invalid-selection" : "invalid-text");
    }

    const contentChanged = normalizedText !== this.#currentText;
    const selectionChanged = !selectionsMatch(
      normalizedSelection,
      this.#currentSelection,
    );
    this.#currentText = normalizedText;
    this.#currentSelection = normalizedSelection;
    this.#markOwnedMutation(`session-owned-${evidence}`);

    if (
      this.#compositionGuard
      && (this.#compositionGuard.phase === "settling"
        || this.#compositionGuard.phase === "stable")
      && (contentChanged || selectionChanged)
    ) {
      this.#compositionGuard = resetSettlingGuard(this.#compositionGuard);
    }

    return accepted({
      currentText: this.#currentText,
      currentSelection: this.#currentSelection,
      mutationState: this.#mutationState,
    });
  }

  recordUnownedMutation({ lease, reason } = {}) {
    const authority = this.#authorizeLease(lease);
    if (!authority.accepted) return authority;
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.POISONED) {
      return rejected("poisoned");
    }
    if (this.#mutationState !== NATIVE_BLOCK_MUTATION_STATES.DIRTY_UNOWNED) {
      this.#mutationState = NATIVE_BLOCK_MUTATION_STATES.DIRTY_UNOWNED;
      this.#mutationReason = normalizeReason(reason, "unowned-dom-mutation");
    }
    if (
      this.#compositionGuard
      && this.#compositionGuard.fallbackAuthorized
    ) {
      this.#compositionGuard = resetSettlingGuard(this.#compositionGuard);
    }
    return accepted({ mutationState: this.#mutationState });
  }

  poison({ lease, reason } = {}) {
    const authority = this.#authorizeLease(lease);
    if (!authority.accepted) return authority;
    this.#mutationState = NATIVE_BLOCK_MUTATION_STATES.POISONED;
    this.#mutationReason = normalizeReason(reason, "unsafe-dom-mutation");
    if (this.#compositionGuard) {
      this.#compositionGuard = immutableCopy({
        ...this.#compositionGuard,
        fallbackAuthorized: false,
      });
    }
    return accepted({ mutationState: this.#mutationState });
  }

  beginComposition({ lease, compositionId, selection } = {}) {
    const leaseResult = this.#authorizeLease(lease);
    if (!leaseResult.accepted) return leaseResult;
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.POISONED) {
      return rejected("poisoned");
    }
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.DIRTY_UNOWNED) {
      return rejected("unowned-dom");
    }

    let normalizedId;
    let normalizedSelection = this.#currentSelection;
    try {
      normalizedId = normalizeCompositionId(compositionId);
      if (selection) {
        normalizedSelection = normalizeSelection(selection, this.#currentText);
      }
    } catch {
      return rejected("invalid-composition-start");
    }
    if (this.#compositionGuard?.compositionId === normalizedId) {
      return rejected("duplicate-composition");
    }

    this.#currentSelection = normalizedSelection;
    this.#compositionGuard = newCompositionGuard(
      normalizedId,
      this.#currentText,
      normalizedSelection,
    );
    return accepted({ compositionId: normalizedId });
  }

  endComposition({ lease, compositionId } = {}) {
    const authority = this.#authorizeOwnedEvidence(lease, compositionId);
    if (!authority.accepted) return authority;
    if (!this.#compositionGuard || this.#compositionGuard.phase !== "composing") {
      return rejected("composition-already-ended");
    }
    this.#compositionGuard = resetSettlingGuard(this.#compositionGuard);
    return accepted({ phase: "settling" });
  }

  observeSettling({
    lease,
    compositionId,
    text,
    selection,
    taskTurn,
  } = {}) {
    const authority = this.#authorizeOwnedEvidence(lease, compositionId);
    if (!authority.accepted) return authority;
    if (
      !this.#compositionGuard
      || (this.#compositionGuard.phase !== "settling"
        && this.#compositionGuard.phase !== "stable")
    ) {
      return rejected("composition-not-settling");
    }

    let normalizedText;
    let normalizedSelection;
    let normalizedTurn;
    try {
      normalizedText = normalizeText(text, "settling text");
      normalizedSelection = normalizeSelection(selection, normalizedText);
      normalizedTurn = normalizeTaskTurn(taskTurn);
    } catch {
      return rejected("invalid-settling-observation");
    }

    const guard = this.#compositionGuard;
    if (
      guard.lastObservedTaskTurn !== null
      && normalizedTurn < guard.lastObservedTaskTurn
    ) {
      return rejected("stale-task-turn");
    }
    const observationMatches = guard.candidateText === normalizedText
      && selectionsMatch(guard.candidateSelection, normalizedSelection);
    let stableObservationCount = observationMatches
      ? guard.stableObservationCount
      : 1;
    if (
      observationMatches
      && normalizedTurn > guard.lastObservedTaskTurn
    ) {
      stableObservationCount = Math.min(2, stableObservationCount + 1);
    }

    const stable = stableObservationCount >= 2;
    this.#compositionGuard = immutableCopy({
      ...guard,
      phase: stable ? "stable" : "settling",
      candidateText: normalizedText,
      candidateSelection: normalizedSelection,
      stableObservationCount,
      lastObservedTaskTurn: normalizedTurn,
      fallbackAuthorized: stable,
    });
    this.#markOwnedMutation("session-owned-composition-observation");

    if (stable) {
      this.#currentText = normalizedText;
      this.#currentSelection = normalizedSelection;
    }
    return accepted({
      stable,
      stableObservationCount,
      advancedTaskTurn: observationMatches
        && normalizedTurn > guard.lastObservedTaskTurn,
    });
  }

  markCompositionTimeout({ lease, compositionId } = {}) {
    const authority = this.#authorizeOwnedEvidence(lease, compositionId);
    if (!authority.accepted) return authority;
    if (!this.#compositionGuard) return rejected("composition-missing");
    if (this.#compositionGuard.phase === "stable") {
      return rejected("composition-already-stable");
    }
    this.#compositionGuard = immutableCopy({
      ...this.#compositionGuard,
      phase: "timed-out",
      candidateText: null,
      candidateSelection: null,
      stableObservationCount: 0,
      lastObservedTaskTurn: null,
      fallbackAuthorized: false,
    });
    return accepted({ phase: "timed-out", fallbackAuthorized: false });
  }

  cancelComposition({ lease, compositionId } = {}) {
    const leaseResult = this.#authorizeLease(lease);
    if (!leaseResult.accepted) return leaseResult;
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.POISONED) {
      return rejected("poisoned");
    }
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.DIRTY_UNOWNED) {
      return rejected("unowned-dom");
    }
    if (!this.#compositionGuard) return rejected("composition-missing");
    if (compositionId !== this.#compositionGuard.compositionId) {
      return rejected("stale-composition");
    }
    if (this.#compositionGuard.phase === "stable") {
      return rejected("composition-already-stable");
    }
    if (this.#compositionGuard.phase === "cancelled") {
      return rejected("composition-already-cancelled");
    }
    this.#currentText = this.#compositionGuard.startText;
    this.#currentSelection = this.#compositionGuard.startSelection;
    this.#compositionGuard = immutableCopy({
      ...this.#compositionGuard,
      phase: "cancelled",
      candidateText: null,
      candidateSelection: null,
      stableObservationCount: 0,
      lastObservedTaskTurn: null,
      fallbackAuthorized: false,
    });
    this.#markOwnedMutation("session-owned-composition-cancel");
    return accepted({
      phase: "cancelled",
      currentText: this.#currentText,
      currentSelection: this.#currentSelection,
    });
  }

  /**
   * Discards browser-owned marked text after it has reached the shadow
   * draft's stable phase but before PageRoot has granted SourcePatch
   * authority. Unlike cancelComposition(), this is deliberately valid for a
   * stable guard. The controller may use it only while it still owns the
   * matching composition snapshot.
   */
  discardProvisionalComposition({ lease, compositionId } = {}) {
    const leaseResult = this.#authorizeLease(lease);
    if (!leaseResult.accepted) return leaseResult;
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.POISONED) {
      return rejected("poisoned");
    }
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.DIRTY_UNOWNED) {
      return rejected("unowned-dom");
    }
    if (!this.#compositionGuard) return rejected("composition-missing");
    if (compositionId !== this.#compositionGuard.compositionId) {
      return rejected("stale-composition");
    }
    if (this.#compositionGuard.phase === "cancelled") {
      return accepted({
        phase: "cancelled",
        currentText: this.#currentText,
        currentSelection: this.#currentSelection,
      });
    }

    this.#currentText = this.#compositionGuard.startText;
    this.#currentSelection = this.#compositionGuard.startSelection;
    this.#compositionGuard = immutableCopy({
      ...this.#compositionGuard,
      phase: "cancelled",
      candidateText: null,
      candidateSelection: null,
      stableObservationCount: 0,
      lastObservedTaskTurn: null,
      fallbackAuthorized: false,
    });
    if (this.#currentText === this.#baselineText) {
      this.#mutationState = NATIVE_BLOCK_MUTATION_STATES.CLEAN;
      this.#mutationReason = null;
    } else {
      this.#mutationState = NATIVE_BLOCK_MUTATION_STATES.DIRTY_OWNED;
      this.#mutationReason = "session-owned-composition-discard";
    }
    return accepted({
      phase: "cancelled",
      currentText: this.#currentText,
      currentSelection: this.#currentSelection,
    });
  }

  compositionFallbackCandidate({ lease, compositionId } = {}) {
    const leaseResult = this.#authorizeLease(lease);
    if (!leaseResult.accepted) return leaseResult;
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.POISONED) {
      return rejected("poisoned");
    }
    if (this.#mutationState === NATIVE_BLOCK_MUTATION_STATES.DIRTY_UNOWNED) {
      return rejected("unowned-dom");
    }
    if (!this.#compositionGuard) return rejected("composition-missing");
    if (compositionId !== this.#compositionGuard.compositionId) {
      return rejected("stale-composition");
    }
    if (
      this.#compositionGuard.phase !== "stable"
      || !this.#compositionGuard.fallbackAuthorized
      || this.#compositionGuard.stableObservationCount < 2
    ) {
      return rejected("composition-not-stable");
    }
    return accepted({
      candidate: {
        compositionId,
        text: this.#currentText,
        selection: this.#currentSelection,
      },
    });
  }

  acknowledgeComposition({ lease, compositionId } = {}) {
    const leaseResult = this.#authorizeLease(lease);
    if (!leaseResult.accepted) return leaseResult;
    if (!this.#compositionGuard) return rejected("composition-missing");
    if (compositionId !== this.#compositionGuard.compositionId) {
      return rejected("stale-composition");
    }
    if (
      this.#compositionGuard.phase !== "stable"
      && this.#compositionGuard.phase !== "cancelled"
    ) {
      return rejected("composition-not-final");
    }
    this.#compositionGuard = null;
    return accepted();
  }

  queueCommand({ lease, command } = {}) {
    const leaseResult = this.#authorizeLease(lease);
    if (!leaseResult.accepted) return leaseResult;
    let normalized;
    try {
      normalized = normalizeCommand(
        command,
        this.#commandSequence + 1,
        this.#compositionGuard?.compositionId ?? null,
      );
    } catch {
      return rejected("invalid-command");
    }
    this.#commandSequence += 1;
    const replacedCommand = this.#pendingCommand;
    this.#pendingCommand = normalized;
    return accepted({
      policy: NATIVE_BLOCK_COMMAND_REPLACEMENT_POLICY,
      pendingCommand: this.#pendingCommand,
      replacedCommand,
    });
  }

  takePendingCommand({ lease } = {}) {
    const leaseResult = this.#authorizeLease(lease);
    if (!leaseResult.accepted) return leaseResult;
    const command = this.#pendingCommand;
    this.#pendingCommand = null;
    return accepted({ command });
  }

  rebaseFromSource({
    lease,
    nextLease,
    baselineText,
    baselineSelection,
    formatSkeleton = this.#formatSkeleton,
    preservePendingCommand = true,
    advanceLease = null,
  } = {}) {
    const leaseResult = this.#authorizeLease(lease);
    if (!leaseResult.accepted) return leaseResult;

    let normalizedLease;
    let normalizedSelection;
    let normalizedSkeleton;
    let normalizedText;
    try {
      normalizedText = normalizeText(baselineText, "baseline text");
      normalizedLease = normalizeLease(nextLease);
      normalizedSelection = normalizeSelection(
        baselineSelection,
        normalizedText,
        "baseline selection",
      );
      normalizedSkeleton = immutableCopy(formatSkeleton);
    } catch {
      return rejected("invalid-source-rebase");
    }

    // All fallible normalization is complete before the outer EditLease CAS.
    // Once that CAS succeeds, the assignments below are deliberately
    // infallible so the controller and shadow draft cannot land on different
    // source revisions.
    if (advanceLease !== null && typeof advanceLease !== "function") {
      return rejected("invalid-lease-advance");
    }
    if (!leasesMatch(this.#lease, normalizedLease)) {
      if (!advanceLease) return rejected("lease-advance-required");
      let advanced = false;
      try {
        advanced = advanceLease(this.#lease, normalizedLease) === true;
      } catch {
        advanced = false;
      }
      if (!advanced) return rejected("lease-advance-rejected");
    }

    this.#lease = normalizedLease;
    this.#baselineText = normalizedText;
    this.#currentText = normalizedText;
    this.#baselineSelection = normalizedSelection;
    this.#currentSelection = normalizedSelection;
    this.#formatSkeleton = normalizedSkeleton;
    this.#mutationState = NATIVE_BLOCK_MUTATION_STATES.CLEAN;
    this.#mutationReason = null;
    this.#compositionGuard = null;
    if (!preservePendingCommand) this.#pendingCommand = null;
    this.#expired = false;
    return accepted({ lease: this.#lease });
  }

  expire({ lease, reason } = {}) {
    const leaseResult = this.#authorizeLease(lease);
    if (!leaseResult.accepted) return leaseResult;
    this.#expired = true;
    this.#mutationState = NATIVE_BLOCK_MUTATION_STATES.POISONED;
    this.#mutationReason = normalizeReason(reason, "lease-expired");
    if (this.#compositionGuard) {
      this.#compositionGuard = immutableCopy({
        ...this.#compositionGuard,
        fallbackAuthorized: false,
      });
    }
    return accepted({ mutationState: this.#mutationState });
  }
}
