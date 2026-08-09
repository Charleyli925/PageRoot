import { RUNTIME_VISUAL_CONTRACT } from "../domain/runtime-visual-contract.js";

export const REVIEW_RUNTIME_VISUAL_DEADLINE_MS =
  RUNTIME_VISUAL_CONTRACT.comparisonDeadlineMs;
export const REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT =
  RUNTIME_VISUAL_CONTRACT.candidateLimit;

const MAX_RUNTIME_VISUAL_ATOMS = RUNTIME_VISUAL_CONTRACT.pageBudget.hostAtoms;
const MAX_RUNTIME_CANVAS_PIXELS = RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels;
const SIGNATURE_PATTERN = /^(?:[a-f0-9]{32}|[a-f0-9]{64}):[1-9]\d{0,7}$/u;
const SNAPSHOT_KEYS = new Set([
  "key",
  "state",
  "contentSignature",
  "paintSignature",
  "geometrySignature",
  "vectorSignature",
  "canvasSignature",
  "contentAtoms",
  "paintAtoms",
  "geometryAtoms",
  "vectorAtoms",
  "canvasPixels",
]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function acceptedSignature(value, atomCount) {
  if (atomCount === 0) return value === "" ? "" : null;
  return typeof value === "string" && SIGNATURE_PATTERN.test(value)
    ? value
    : null;
}

export function acceptReviewRuntimeVisualSnapshots(value, allowedCandidateKeys) {
  if (
    !Array.isArray(value)
    || !(allowedCandidateKeys instanceof Set)
    || allowedCandidateKeys.size > REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT
    || value.length !== allowedCandidateKeys.size
    || value.length > REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT
  ) return null;

  const seen = new Set();
  const accepted = [];
  let pageAtoms = 0;
  let pageCanvasPixels = 0;
  for (const rawSnapshot of value) {
    if (
      !isRecord(rawSnapshot)
      || Object.keys(rawSnapshot).some((key) => !SNAPSHOT_KEYS.has(key))
    ) return null;
    const key = typeof rawSnapshot.key === "string" ? rawSnapshot.key : "";
    const state = rawSnapshot.state;
    const contentAtoms = boundedInteger(
      rawSnapshot.contentAtoms,
      MAX_RUNTIME_VISUAL_ATOMS,
    );
    const paintAtoms = boundedInteger(
      rawSnapshot.paintAtoms,
      MAX_RUNTIME_VISUAL_ATOMS,
    );
    const geometryAtoms = boundedInteger(
      rawSnapshot.geometryAtoms,
      MAX_RUNTIME_VISUAL_ATOMS,
    );
    const vectorAtoms = boundedInteger(
      rawSnapshot.vectorAtoms,
      MAX_RUNTIME_VISUAL_ATOMS,
    );
    const canvasPixels = boundedInteger(
      rawSnapshot.canvasPixels,
      MAX_RUNTIME_CANVAS_PIXELS,
    );
    if (
      !key
      || !allowedCandidateKeys.has(key)
      || seen.has(key)
      || (state !== "empty" && state !== "stable" && state !== "unavailable")
      || contentAtoms === null
      || paintAtoms === null
      || geometryAtoms === null
      || vectorAtoms === null
      || canvasPixels === null
    ) return null;

    const contentSignature = acceptedSignature(
      rawSnapshot.contentSignature,
      contentAtoms,
    );
    const paintSignature = acceptedSignature(
      rawSnapshot.paintSignature,
      paintAtoms,
    );
    const geometrySignature = acceptedSignature(
      rawSnapshot.geometrySignature,
      geometryAtoms,
    );
    const vectorSignature = acceptedSignature(
      rawSnapshot.vectorSignature,
      vectorAtoms,
    );
    const canvasSignature = acceptedSignature(
      rawSnapshot.canvasSignature,
      canvasPixels,
    );
    const atomCount = contentAtoms + paintAtoms + geometryAtoms + vectorAtoms;
    pageAtoms += atomCount;
    pageCanvasPixels += canvasPixels;
    if (
      contentSignature === null
      || paintSignature === null
      || geometrySignature === null
      || vectorSignature === null
      || canvasSignature === null
      || (
        (state === "empty" || state === "unavailable")
        && (atomCount !== 0 || canvasPixels !== 0)
      )
      || (state === "stable" && atomCount === 0 && canvasPixels === 0)
      || atomCount > RUNTIME_VISUAL_CONTRACT.pageBudget.hostAtoms
      || pageAtoms > RUNTIME_VISUAL_CONTRACT.pageBudget.atoms
      || pageCanvasPixels > RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels
    ) return null;

    seen.add(key);
    accepted.push(Object.freeze({
      key,
      state,
      contentSignature,
      paintSignature,
      geometrySignature,
      vectorSignature,
      canvasSignature,
      contentAtoms,
      paintAtoms,
      geometryAtoms,
      vectorAtoms,
      canvasPixels,
    }));
  }
  return Object.freeze(accepted);
}

export function selectPrioritizedReviewRuntimeVisualCandidates(
  candidates,
  maximum = REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT,
) {
  if (!Array.isArray(candidates)) return Object.freeze([]);
  const limit = Number.isSafeInteger(maximum)
    ? Math.max(0, Math.min(REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT, maximum))
    : REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT;
  return Object.freeze(candidates
    .map((candidate, index) => ({
      candidate,
      index,
      priority: Number.isFinite(candidate?.commentPriority)
        ? Math.max(0, Math.trunc(candidate.commentPriority))
        : 0,
    }))
    .sort((left, right) => right.priority - left.priority || left.index - right.index)
    .slice(0, limit)
    .map(({ candidate }) => candidate));
}

function runtimeSnapshotChanged(before, after) {
  if (before.state === "unavailable" || after.state === "unavailable") return false;
  if (before.state !== after.state) {
    return before.state === "stable" || after.state === "stable";
  }
  if (before.state !== "stable") return false;
  const canvasChanged = before.canvasSignature !== after.canvasSignature
    && Math.max(before.canvasPixels, after.canvasPixels) > 0;
  const vectorChanged = before.vectorSignature !== after.vectorSignature
    && Math.max(before.vectorAtoms, after.vectorAtoms) > 0;
  const contentChanged = before.contentSignature !== after.contentSignature
    && Math.max(before.contentAtoms, after.contentAtoms) > 0;
  const paintChanged = before.paintSignature !== after.paintSignature
    && Math.max(before.paintAtoms, after.paintAtoms) > 0;
  const geometryChanged = before.geometrySignature !== after.geometrySignature
    && (
      Math.max(before.geometryAtoms, after.geometryAtoms) >= 2
      || Math.max(before.vectorAtoms, after.vectorAtoms) > 0
      || (
        Math.max(before.geometryAtoms, after.geometryAtoms) > 0
        && (
          Math.max(before.paintAtoms, after.paintAtoms) > 0
          || Math.max(before.contentAtoms, after.contentAtoms) > 0
        )
      )
    );
  return canvasChanged
    || vectorChanged
    || contentChanged
    || paintChanged
    || geometryChanged;
}

function runtimeSnapshotsMatch(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.key === right.key
    && left.state === right.state
    && left.contentSignature === right.contentSignature
    && left.paintSignature === right.paintSignature
    && left.geometrySignature === right.geometrySignature
    && left.vectorSignature === right.vectorSignature
    && left.canvasSignature === right.canvasSignature
    && left.contentAtoms === right.contentAtoms
    && left.paintAtoms === right.paintAtoms
    && left.geometryAtoms === right.geometryAtoms
    && left.vectorAtoms === right.vectorAtoms
    && left.canvasPixels === right.canvasPixels;
}

export function changedReviewRuntimeVisualCandidateKeys({
  candidates,
  before,
  after,
} = {}) {
  if (!Array.isArray(candidates) || !Array.isArray(before) || !Array.isArray(after)) {
    return Object.freeze([]);
  }
  const beforeByKey = new Map(before.map((snapshot) => [snapshot.key, snapshot]));
  const afterByKey = new Map(after.map((snapshot) => [snapshot.key, snapshot]));
  return Object.freeze(candidates.flatMap((candidate) => {
    const key = typeof candidate?.key === "string" ? candidate.key : "";
    const beforeSnapshot = beforeByKey.get(key);
    const afterSnapshot = afterByKey.get(key);
    return key
      && beforeSnapshot
      && afterSnapshot
      && runtimeSnapshotChanged(beforeSnapshot, afterSnapshot)
      ? [key]
      : [];
  }));
}

function canonicalTypes(types) {
  const values = new Set(Array.isArray(types) ? types : []);
  return ["text", "structure", "style"].filter((type) => values.has(type));
}

function helperForTypes(types) {
  const labels = canonicalTypes(types).map((type) => (
    type === "text" ? "文本" : type === "structure" ? "结构" : "视觉"
  ));
  return labels.length ? `${labels.join("、")}调整` : "本轮未修改";
}

export function mergeReviewRuntimeVisualChanges(documents, changedCandidateKeys) {
  const changes = Array.isArray(documents?.changes) ? documents.changes : [];
  const outline = Array.isArray(documents?.outline) ? documents.outline : [];
  const candidates = Array.isArray(documents?.runtimeVisualCandidates)
    ? documents.runtimeVisualCandidates
    : [];
  const changedKeys = new Set(Array.isArray(changedCandidateKeys) ? changedCandidateKeys : []);
  const outlineIds = new Set(outline.map((item) => item.id));
  const changedCandidates = candidates.filter((candidate) => (
    changedKeys.has(candidate.key) && outlineIds.has(candidate.outlineId)
  ));
  if (!changedCandidates.length) {
    return Object.freeze({
      changes,
      outline,
      markers: Object.freeze([]),
    });
  }

  const candidatesByChangeId = new Map();
  changedCandidates.forEach((candidate) => {
    const group = candidatesByChangeId.get(candidate.changeId) || [];
    group.push(candidate);
    candidatesByChangeId.set(candidate.changeId, group);
  });
  const updatedChangesById = new Map(changes.map((change) => {
    if (!candidatesByChangeId.has(change.id)) return [change.id, change];
    const types = canonicalTypes([...change.types, "style"]);
    return [change.id, Object.freeze({
      ...change,
      types: Object.freeze(types),
      helper: helperForTypes(types),
    })];
  }));
  const syntheticChanges = [];
  outline.forEach((outlineItem) => {
    const candidate = changedCandidates.find((item) => item.outlineId === outlineItem.id);
    if (!candidate || updatedChangesById.has(candidate.changeId)) return;
    const types = Object.freeze(["style"]);
    const change = Object.freeze({
      id: candidate.changeId,
      label: candidate.label,
      helper: "视觉调整",
      types,
      beforePresent: true,
      afterPresent: true,
      ...(candidate.panelKey ? { panelKey: candidate.panelKey } : {}),
      ...(candidate.panelPath?.length ? { panelPath: [...candidate.panelPath] } : {}),
    });
    updatedChangesById.set(change.id, change);
    syntheticChanges.push(change);
  });

  const mergedChanges = [
    ...changes.map((change) => updatedChangesById.get(change.id) || change),
    ...syntheticChanges,
  ];
  const changedCandidateByOutline = new Map(
    changedCandidates.map((candidate) => [candidate.outlineId, candidate]),
  );
  const mergedOutline = outline.map((item) => {
    const candidate = changedCandidateByOutline.get(item.id);
    if (!candidate) return item;
    const types = canonicalTypes([...item.types, "style"]);
    return Object.freeze({
      ...item,
      changeId: candidate.changeId,
      types: Object.freeze(types),
      helper: helperForTypes(types),
    });
  });
  // The authored review page receives only opaque section-level fallback
  // markers. Several runtime hosts can belong to one static outline, so send
  // one marker per outline instead of exposing host identities or causing the
  // page-side all-or-nothing marker validator to reject duplicates.
  const seenMarkerOutlineIds = new Set();
  const markers = changedCandidates.flatMap((candidate) => {
    if (seenMarkerOutlineIds.has(candidate.outlineId)) return [];
    seenMarkerOutlineIds.add(candidate.outlineId);
    return [Object.freeze({
      changeId: candidate.changeId,
      outlineId: candidate.outlineId,
    })];
  });
  return Object.freeze({
    changes: Object.freeze(mergedChanges),
    outline: Object.freeze(mergedOutline),
    markers: Object.freeze(markers),
  });
}

export class ReviewRuntimeVisualCoordinator {
  constructor({
    candidates,
    onResolve,
    onRequestConfirmation,
    deadlineMs = REVIEW_RUNTIME_VISUAL_DEADLINE_MS,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (handle) => clearTimeout(handle),
  } = {}) {
    this.candidates = Array.isArray(candidates) ? Object.freeze([...candidates]) : Object.freeze([]);
    this.allowedCandidateKeys = new Set(this.candidates.map((candidate) => candidate.key));
    this.confirmationCandidateKeys = new Set(this.candidates
      .filter((candidate) => candidate?.requiresDeterministicConfirmation === true)
      .map((candidate) => candidate.key));
    this.onResolve = typeof onResolve === "function" ? onResolve : () => {};
    this.onRequestConfirmation = typeof onRequestConfirmation === "function"
      ? onRequestConfirmation
      : () => false;
    this.deadlineMs = Number.isFinite(deadlineMs)
      ? Math.max(1, Math.min(5_000, Math.round(deadlineMs)))
      : REVIEW_RUNTIME_VISUAL_DEADLINE_MS;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.snapshots = { before: null, after: null };
    this.confirmationSnapshots = { before: null, after: null };
    this.phase = "initial";
    this.resolved = false;
    this.disposed = false;
    this.timer = null;
  }

  start() {
    if (
      this.resolved
      || this.disposed
      || !this.candidates.length
      || this.timer !== null
    ) return false;
    if (this.phase === "awaiting-confirmation") this.phase = "confirmation";
    if (this.phase !== "initial" && this.phase !== "confirmation") return false;
    this.timer = this.setTimer(
      () => {
        if (this.phase === "confirmation") {
          this.failConfirmation();
          return;
        }
        this.#resolve(Object.freeze([]));
      },
      this.deadlineMs,
    );
    return true;
  }

  accept(side, rawSnapshots) {
    if (
      this.resolved
      || this.disposed
      || (side !== "before" && side !== "after")
      || (
        this.phase !== "initial"
        && this.phase !== "awaiting-confirmation"
        && this.phase !== "confirmation"
      )
    ) return false;
    this.start();
    const snapshots = this.phase === "confirmation"
      ? this.confirmationSnapshots
      : this.snapshots;
    if (snapshots[side] !== null) return false;
    snapshots[side] = acceptReviewRuntimeVisualSnapshots(
      rawSnapshots,
      this.allowedCandidateKeys,
    ) || Object.freeze([]);
    if (snapshots.before !== null && snapshots.after !== null) {
      if (this.phase === "initial") this.#resolveInitialSnapshots();
      else this.#resolveConfirmedSnapshots();
    }
    return true;
  }

  failConfirmation() {
    if (
      this.resolved
      || this.disposed
      || (this.phase !== "awaiting-confirmation" && this.phase !== "confirmation")
      || this.snapshots.before === null
      || this.snapshots.after === null
    ) return false;
    this.#resolve(this.#initialChangedCandidateKeys().filter((key) => (
      !this.confirmationCandidateKeys.has(key)
    )));
    return true;
  }

  #initialChangedCandidateKeys() {
    if (this.snapshots.before === null || this.snapshots.after === null) {
      return Object.freeze([]);
    }
    return changedReviewRuntimeVisualCandidateKeys({
      candidates: this.candidates,
      before: this.snapshots.before,
      after: this.snapshots.after,
    });
  }

  #resolveInitialSnapshots() {
    const changedCandidateKeys = this.#initialChangedCandidateKeys();
    const needsConfirmation = changedCandidateKeys.some((key) => (
      this.confirmationCandidateKeys.has(key)
    ));
    if (!needsConfirmation) {
      this.#resolve(changedCandidateKeys);
      return;
    }
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.phase = "awaiting-confirmation";
    let confirmationRequested = false;
    try {
      confirmationRequested = this.onRequestConfirmation() === true;
    } catch {
      confirmationRequested = false;
    }
    if (!confirmationRequested) this.failConfirmation();
  }

  #resolveConfirmedSnapshots() {
    if (
      this.confirmationSnapshots.before === null
      || this.confirmationSnapshots.after === null
    ) return;
    const initialBeforeByKey = new Map(this.snapshots.before.map((snapshot) => [
      snapshot.key,
      snapshot,
    ]));
    const initialAfterByKey = new Map(this.snapshots.after.map((snapshot) => [
      snapshot.key,
      snapshot,
    ]));
    const confirmedBeforeByKey = new Map(this.confirmationSnapshots.before.map((snapshot) => [
      snapshot.key,
      snapshot,
    ]));
    const confirmedAfterByKey = new Map(this.confirmationSnapshots.after.map((snapshot) => [
      snapshot.key,
      snapshot,
    ]));
    const stableConfirmationKeys = new Set([...this.confirmationCandidateKeys].filter((key) => (
      runtimeSnapshotsMatch(initialBeforeByKey.get(key), confirmedBeforeByKey.get(key))
      && runtimeSnapshotsMatch(initialAfterByKey.get(key), confirmedAfterByKey.get(key))
    )));
    this.#resolve(this.#initialChangedCandidateKeys().filter((key) => (
      !this.confirmationCandidateKeys.has(key) || stableConfirmationKeys.has(key)
    )));
  }

  #resolve(changedCandidateKeys) {
    if (this.resolved || this.disposed) return;
    this.resolved = true;
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.onResolve(Object.freeze([...changedCandidateKeys]));
  }

  dispose() {
    if (this.timer !== null) this.clearTimer(this.timer);
    this.timer = null;
    this.disposed = true;
  }
}
