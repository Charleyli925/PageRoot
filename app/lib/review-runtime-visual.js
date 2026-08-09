import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import { RUNTIME_VISUAL_CONTRACT } from "../domain/runtime-visual-contract.js";

export const REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT =
  RUNTIME_VISUAL_CONTRACT.pageBudget.visualLimit;

const MAX_PNG_BYTES = RUNTIME_VISUAL_CONTRACT.pageBudget.visualBytes;
const MAX_PNG_PIXELS = RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels;
const SNAPSHOT_KEYS = new Set([
  "key",
  "state",
  "pngSha256",
  "width",
  "height",
  "byteLength",
  "pngBytes",
]);
const PNG_HEADER = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_HASH_PATTERN = /^sha256:[a-f0-9]{64}$/u;

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum
    ? value
    : null;
}

function copiedPngBytes(value) {
  return value instanceof Uint8Array ? new Uint8Array(value) : null;
}

function pngDimensions(pngBytes) {
  if (pngBytes.byteLength < 24) return null;
  if (!PNG_HEADER.every((byte, index) => pngBytes[index] === byte)) return null;
  if (![73, 72, 68, 82].every((byte, index) => pngBytes[12 + index] === byte)) {
    return null;
  }
  const view = new DataView(pngBytes.buffer, pngBytes.byteOffset, pngBytes.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (
    width < 1
    || height < 1
    || width * height > MAX_PNG_PIXELS
  ) return null;
  return Object.freeze({ width, height });
}

function acceptedUnavailableSnapshot(rawSnapshot, key) {
  const pngBytes = copiedPngBytes(rawSnapshot.pngBytes);
  if (
    rawSnapshot.pngSha256 !== ""
    || rawSnapshot.width !== 0
    || rawSnapshot.height !== 0
    || rawSnapshot.byteLength !== 0
    || !pngBytes
    || pngBytes.byteLength !== 0
  ) return null;
  return Object.freeze({
    key,
    state: "unavailable",
    pngSha256: "",
    width: 0,
    height: 0,
    byteLength: 0,
    pngBytes,
  });
}

function acceptedCapturedSnapshot(rawSnapshot, key) {
  const pngBytes = copiedPngBytes(rawSnapshot.pngBytes);
  const byteLength = boundedInteger(rawSnapshot.byteLength, MAX_PNG_BYTES);
  if (
    !pngBytes
    || byteLength === null
    || byteLength !== pngBytes.byteLength
    || byteLength < 24
    || typeof rawSnapshot.pngSha256 !== "string"
    || !PNG_HASH_PATTERN.test(rawSnapshot.pngSha256)
  ) return null;
  const dimensions = pngDimensions(pngBytes);
  if (
    !dimensions
    || rawSnapshot.width !== dimensions.width
    || rawSnapshot.height !== dimensions.height
    || `sha256:${bytesToHex(sha256(pngBytes))}` !== rawSnapshot.pngSha256
  ) return null;
  return Object.freeze({
    key,
    state: "captured",
    pngSha256: rawSnapshot.pngSha256,
    width: dimensions.width,
    height: dimensions.height,
    byteLength,
    pngBytes,
  });
}

/**
 * The trusted renderer accepts only the exact candidate set it asked the
 * owner for. PNG bytes remain presentation data; validating and retaining
 * them here establishes the small snapshot shape used by Review today and
 * Edit's shared last-snapshot cache in the following milestone.
 */
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
  let pageBytes = 0;
  let pagePixels = 0;
  for (const rawSnapshot of value) {
    if (
      !isRecord(rawSnapshot)
      || Object.keys(rawSnapshot).some((key) => !SNAPSHOT_KEYS.has(key))
      || typeof rawSnapshot.key !== "string"
      || !allowedCandidateKeys.has(rawSnapshot.key)
      || seen.has(rawSnapshot.key)
    ) return null;
    const snapshot = rawSnapshot.state === "unavailable"
      ? acceptedUnavailableSnapshot(rawSnapshot, rawSnapshot.key)
      : rawSnapshot.state === "captured"
        ? acceptedCapturedSnapshot(rawSnapshot, rawSnapshot.key)
        : null;
    if (!snapshot) return null;
    pageBytes += snapshot.byteLength;
    pagePixels += snapshot.width * snapshot.height;
    if (
      pageBytes > RUNTIME_VISUAL_CONTRACT.pageBudget.visualBytes
      || pagePixels > MAX_PNG_PIXELS
    ) return null;
    seen.add(snapshot.key);
    accepted.push(snapshot);
  }
  return Object.freeze(accepted);
}

function runtimeSnapshotChanged(before, after) {
  return before?.state === "captured"
    && after?.state === "captured"
    && (
      before.pngSha256 !== after.pngSha256
      || before.width !== after.width
      || before.height !== after.height
      || before.byteLength !== after.byteLength
    );
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
    return key
      && runtimeSnapshotChanged(beforeByKey.get(key), afterByKey.get(key))
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

/**
 * Runtime evidence can add a single opaque style marker to an already static
 * review outline. It cannot change source bytes, acceptance semantics, or the
 * authored review page's knowledge of source-host identities.
 */
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
