import {
  RUNTIME_VISUAL_SNAPSHOT_LIMIT,
  acceptRuntimeVisualSnapshots,
} from "./runtime-visual-snapshots.js";

export const REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT =
  RUNTIME_VISUAL_SNAPSHOT_LIMIT;

/**
 * Mean absolute RGB-channel error (0–255 scale) permitted after an unchanged
 * visible-text summary. It absorbs Chromium's sub-pixel/tile raster noise
 * without making a byte-level PNG encoding difference a Review fact.
 */
export const REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET = 0.04;

export { acceptRuntimeVisualSnapshots };

/**
 * This is intentionally a pure classification step. Decoding untrusted-size
 * bounded PNG bytes belongs to the trusted browser adapter, not this module.
 */
export function reviewRuntimeVisualSnapshotComparison(before, after) {
  if (before?.state !== "captured" || after?.state !== "captured") {
    return "unavailable";
  }
  if (
    before.width !== after.width
    || before.height !== after.height
    || before.layoutWidth !== after.layoutWidth
    || before.layoutHeight !== after.layoutHeight
  ) return "changed";
  if (before.renderedTextSha256 !== after.renderedTextSha256) return "changed";
  if (before.pngSha256 === after.pngSha256) return "unchanged";
  return "raster";
}

function rgbaPixels(value) {
  return value instanceof Uint8Array || value instanceof Uint8ClampedArray
    ? value
    : null;
}

/**
 * Returns a bounded mean absolute RGB-channel error, ignoring alpha. A null
 * result means the caller must fail closed because the decoded images cannot
 * be compared as one same-sized RGBA pair.
 */
export function reviewRuntimeVisualMeanRgbDifference(beforePixels, afterPixels) {
  const before = rgbaPixels(beforePixels);
  const after = rgbaPixels(afterPixels);
  if (
    !before
    || !after
    || before.byteLength === 0
    || before.byteLength !== after.byteLength
    || before.byteLength % 4 !== 0
  ) return null;
  let totalDifference = 0;
  for (let index = 0; index < before.byteLength; index += 4) {
    totalDifference += Math.abs(before[index] - after[index]);
    totalDifference += Math.abs(before[index + 1] - after[index + 1]);
    totalDifference += Math.abs(before[index + 2] - after[index + 2]);
  }
  return totalDifference / ((before.byteLength / 4) * 3);
}

export function isReviewRuntimeVisualRasterDifferenceMeaningful(value) {
  return Number.isFinite(value)
    && value > REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET;
}

export function changedReviewRuntimeVisualCandidateKeys({
  candidates,
  before,
  after,
  rasterMeanRgbDifferenceByKey,
} = {}) {
  if (!Array.isArray(candidates) || !Array.isArray(before) || !Array.isArray(after)) {
    return Object.freeze([]);
  }
  const beforeByKey = new Map(before.map((snapshot) => [snapshot.key, snapshot]));
  const afterByKey = new Map(after.map((snapshot) => [snapshot.key, snapshot]));
  return Object.freeze(candidates.flatMap((candidate) => {
    const key = typeof candidate?.key === "string" ? candidate.key : "";
    if (!key) return [];
    const comparison = reviewRuntimeVisualSnapshotComparison(
      beforeByKey.get(key),
      afterByKey.get(key),
    );
    if (comparison === "changed") return [key];
    const rasterDifference = rasterMeanRgbDifferenceByKey instanceof Map
      ? rasterMeanRgbDifferenceByKey.get(key)
      : undefined;
    return comparison === "raster"
      && isReviewRuntimeVisualRasterDifferenceMeaningful(rasterDifference)
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
 * Runtime evidence can add one opaque style projection per changed source
 * host. Outline aggregation remains navigation metadata; it is never runtime
 * geometry authority.
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
  const markers = changedCandidates.map((candidate) => Object.freeze({
    candidateKey: candidate.key,
    changeId: candidate.changeId,
  }));
  return Object.freeze({
    changes: Object.freeze(mergedChanges),
    outline: Object.freeze(mergedOutline),
    markers: Object.freeze(markers),
  });
}
