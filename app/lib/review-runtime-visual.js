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

/**
 * Maximum per-channel spread (0–255 scale) for a decoded capture that still
 * counts as one near-uniform surface. A chart host whose capture is a single
 * flat color almost certainly never rendered (blocked network, script error,
 * unfinished initialization), so identical blank pixels are not evidence that
 * the chart is unchanged.
 */
export const REVIEW_RUNTIME_VISUAL_UNIFORM_CHANNEL_SPREAD_LIMIT = 3;

/**
 * Per-channel delta (0–255 scale) at which one pixel counts as strongly
 * different rather than as raster noise.
 */
export const REVIEW_RUNTIME_VISUAL_STRONG_CHANNEL_DELTA = 28;

/**
 * Fraction of strongly different pixels required before a raster difference is
 * read as a real chart change. Re-sampling one unchanged chart at a different
 * sub-pixel offset repaints only the antialiased edges of what it already drew,
 * so its strong pixels stay a thin outline; moving the data repaints an area.
 * Below this budget the pair proves neither verdict and stays unverified.
 */
export const REVIEW_RUNTIME_VISUAL_STRONG_PIXEL_RATIO_BUDGET = 0.02;

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

/**
 * Fraction of compared pixels whose strongest channel delta reaches
 * REVIEW_RUNTIME_VISUAL_STRONG_CHANNEL_DELTA. A null result means the caller
 * must fail closed because the decoded images cannot be compared as one
 * same-sized RGBA pair.
 */
export function reviewRuntimeVisualStrongPixelRatio(beforePixels, afterPixels) {
  const before = rgbaPixels(beforePixels);
  const after = rgbaPixels(afterPixels);
  if (
    !before
    || !after
    || before.byteLength === 0
    || before.byteLength !== after.byteLength
    || before.byteLength % 4 !== 0
  ) return null;
  let strong = 0;
  for (let index = 0; index < before.byteLength; index += 4) {
    const delta = Math.max(
      Math.abs(before[index] - after[index]),
      Math.abs(before[index + 1] - after[index + 1]),
      Math.abs(before[index + 2] - after[index + 2]),
    );
    if (delta >= REVIEW_RUNTIME_VISUAL_STRONG_CHANNEL_DELTA) strong += 1;
  }
  return strong / (before.byteLength / 4);
}

export function isReviewRuntimeVisualRasterChangeStructural(value) {
  return Number.isFinite(value)
    && value >= REVIEW_RUNTIME_VISUAL_STRONG_PIXEL_RATIO_BUDGET;
}

/**
 * Detects a near-uniform decoded capture, ignoring alpha. A null/invalid RGBA
 * buffer is treated as uniform so the caller cannot mistake an undecodable
 * capture for verified pixels.
 */
export function reviewRuntimeVisualPixelsAreUniform(pixels) {
  const rgba = rgbaPixels(pixels);
  if (!rgba || rgba.byteLength === 0 || rgba.byteLength % 4 !== 0) return true;
  let minRed = 255;
  let maxRed = 0;
  let minGreen = 255;
  let maxGreen = 0;
  let minBlue = 255;
  let maxBlue = 0;
  for (let index = 0; index < rgba.byteLength; index += 4) {
    if (rgba[index] < minRed) minRed = rgba[index];
    if (rgba[index] > maxRed) maxRed = rgba[index];
    if (rgba[index + 1] < minGreen) minGreen = rgba[index + 1];
    if (rgba[index + 1] > maxGreen) maxGreen = rgba[index + 1];
    if (rgba[index + 2] < minBlue) minBlue = rgba[index + 2];
    if (rgba[index + 2] > maxBlue) maxBlue = rgba[index + 2];
  }
  const spread = Math.max(maxRed - minRed, maxGreen - minGreen, maxBlue - minBlue);
  return spread <= REVIEW_RUNTIME_VISUAL_UNIFORM_CHANNEL_SPREAD_LIMIT;
}

/**
 * Tri-state verdict per candidate. Dimming a chart host now requires positive
 * pixel evidence: everything the pipeline could not verify (missing captures,
 * undecodable PNGs, near-uniform blank surfaces) lands in unverifiedKeys
 * instead of silently reading as "unchanged".
 */
export function classifyReviewRuntimeVisualCandidates({
  candidates,
  before,
  after,
  rasterMeanRgbDifferenceByKey,
  rasterStrongPixelRatioByKey,
  uniformCandidateKeys,
} = {}) {
  const empty = Object.freeze({
    changedKeys: Object.freeze([]),
    unverifiedKeys: Object.freeze([]),
  });
  if (!Array.isArray(candidates)) return empty;
  const beforeByKey = new Map(
    Array.isArray(before) ? before.map((snapshot) => [snapshot.key, snapshot]) : [],
  );
  const afterByKey = new Map(
    Array.isArray(after) ? after.map((snapshot) => [snapshot.key, snapshot]) : [],
  );
  const uniformKeys = uniformCandidateKeys instanceof Set
    ? uniformCandidateKeys
    : new Set(Array.isArray(uniformCandidateKeys) ? uniformCandidateKeys : []);
  const changedKeys = [];
  const unverifiedKeys = [];
  candidates.forEach((candidate) => {
    const key = typeof candidate?.key === "string" ? candidate.key : "";
    if (!key) return;
    const comparison = reviewRuntimeVisualSnapshotComparison(
      beforeByKey.get(key),
      afterByKey.get(key),
    );
    if (comparison === "changed") {
      changedKeys.push(key);
      return;
    }
    if (comparison === "unavailable") {
      unverifiedKeys.push(key);
      return;
    }
    if (comparison === "unchanged") {
      if (uniformKeys.has(key)) unverifiedKeys.push(key);
      return;
    }
    const rasterDifference = rasterMeanRgbDifferenceByKey instanceof Map
      ? rasterMeanRgbDifferenceByKey.get(key)
      : undefined;
    if (!Number.isFinite(rasterDifference)) {
      // The PNG pair could not be decoded and compared, so this candidate has
      // no pixel evidence in either direction.
      unverifiedKeys.push(key);
      return;
    }
    if (isReviewRuntimeVisualRasterDifferenceMeaningful(rasterDifference)) {
      // A difference alone is not a chart change. Re-cropping the same chart at
      // a different sub-pixel offset also differs, so require the difference to
      // be structural; anything weaker proves neither verdict.
      const strongRatio = rasterStrongPixelRatioByKey instanceof Map
        ? rasterStrongPixelRatioByKey.get(key)
        : undefined;
      if (isReviewRuntimeVisualRasterChangeStructural(strongRatio)) {
        changedKeys.push(key);
        return;
      }
      unverifiedKeys.push(key);
      return;
    }
    if (uniformKeys.has(key)) unverifiedKeys.push(key);
  });
  return Object.freeze({
    changedKeys: Object.freeze(changedKeys),
    unverifiedKeys: Object.freeze(unverifiedKeys),
  });
}

export function changedReviewRuntimeVisualCandidateKeys({
  candidates,
  before,
  after,
  rasterMeanRgbDifferenceByKey,
  rasterStrongPixelRatioByKey,
} = {}) {
  return classifyReviewRuntimeVisualCandidates({
    candidates,
    before,
    after,
    rasterMeanRgbDifferenceByKey,
    rasterStrongPixelRatioByKey,
  }).changedKeys;
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
 * Wording the type list cannot reconstruct. A whole-section insertion, removal
 * or move is a source fact, so adding runtime style evidence must not rewrite
 * it into a generic "…调整".
 */
const SOURCE_AUTHORED_HELPERS = new Set(["新增内容", "删除内容", "位置调整"]);

function helperWithRuntimeStyle(helper, types) {
  return SOURCE_AUTHORED_HELPERS.has(helper) ? helper : helperForTypes(types);
}

/**
 * A page where most chart hosts cannot be verified has one page-level cause —
 * a blocked chart library, a script error — rather than one cause per host.
 * Drawing a frame on every host there would drown the review, so per-host
 * suspicion is bounded by scale.
 */
function unverifiedIsPageLevel(unverifiedCount, candidateCount) {
  return candidateCount > 0 && unverifiedCount * 2 > candidateCount;
}

/**
 * Runtime evidence can add one opaque style projection to a change the source
 * diff already found, and it can raise suspicion. It can never invent a
 * confirmed change.
 *
 * Current HTML bytes are authoritative, so a pixel difference is a verified
 * visual fact only where the source diff also found a change in the same
 * outline section. A pixel difference in a section whose source is unchanged
 * has no source cause the differ could see; presenting it as a confirmed
 * change lets the runtime fabricate a fact, so it lands in the amber
 * "疑似有改动" state instead. Amber costs the reviewer confidence; a false
 * confirmed change costs them trust in every other verdict on the page.
 *
 * Suspicion no longer depends on whether the user happened to comment on the
 * host. That coupling hid the signal exactly where a missed change is most
 * dangerous — the hosts nobody thought to comment on — and it let an
 * unverified host keep the dimmed presentation that claims "verified
 * unchanged context". Noise is bounded by scale instead, and a comment now
 * only raises a host above that bound rather than gating it.
 */
export function mergeReviewRuntimeVisualChanges(documents, verdicts) {
  const changes = Array.isArray(documents?.changes) ? documents.changes : [];
  const outline = Array.isArray(documents?.outline) ? documents.outline : [];
  const candidates = Array.isArray(documents?.runtimeVisualCandidates)
    ? documents.runtimeVisualCandidates
    : [];
  const changedKeys = new Set(Array.isArray(verdicts)
    ? verdicts
    : Array.isArray(verdicts?.changedKeys) ? verdicts.changedKeys : []);
  const unverifiedKeys = new Set(
    Array.isArray(verdicts?.unverifiedKeys) ? verdicts.unverifiedKeys : [],
  );
  const outlineIds = new Set(outline.map((item) => item.id));
  // A candidate carries the outline section's own change id when the source
  // diff found one, and a pre-allocated id when it did not, so membership in
  // the change list is exactly the source-corroboration test.
  const sourceChangeIds = new Set(changes.map((change) => change.id));
  const scopedCandidates = candidates.filter((candidate) => (
    outlineIds.has(candidate.outlineId)
  ));
  const changedCandidates = scopedCandidates.filter((candidate) => (
    changedKeys.has(candidate.key) && sourceChangeIds.has(candidate.changeId)
  ));
  const uncorroboratedCandidates = scopedCandidates.filter((candidate) => (
    changedKeys.has(candidate.key) && !sourceChangeIds.has(candidate.changeId)
  ));
  const unverifiedCandidates = scopedCandidates.filter((candidate) => (
    unverifiedKeys.has(candidate.key) && !changedKeys.has(candidate.key)
  ));
  // A comment is a floor, never a gate: a host the user asked about always
  // surfaces its suspicion, and every other unverified host surfaces too
  // unless the whole page failed to verify.
  const pageLevelFailure = unverifiedIsPageLevel(
    unverifiedCandidates.length,
    scopedCandidates.length,
  );
  const suspectedCandidates = [
    ...uncorroboratedCandidates,
    ...unverifiedCandidates.filter((candidate) => (
      !pageLevelFailure || candidate.commented === true
    )),
  ];
  if (!changedCandidates.length && !suspectedCandidates.length) {
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
      helper: helperWithRuntimeStyle(change.helper, types),
    })];
  }));
  const syntheticChanges = [];
  // A suspected change is always its own synthetic entry. Folding it into an
  // existing confirmed change would present "cannot verify" as a verified
  // visual fact.
  const suspectedChangeIdByOutline = new Map();
  suspectedCandidates.forEach((candidate) => {
    if (suspectedChangeIdByOutline.has(candidate.outlineId)) return;
    const changeId = `suspected-${candidate.outlineId}`;
    if (updatedChangesById.has(changeId)) return;
    suspectedChangeIdByOutline.set(candidate.outlineId, changeId);
    const change = Object.freeze({
      id: changeId,
      label: candidate.label,
      helper: "疑似有改动（无法核实）",
      types: Object.freeze(["style"]),
      suspected: true,
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
    if (candidate) {
      const types = canonicalTypes([...item.types, "style"]);
      return Object.freeze({
        ...item,
        changeId: candidate.changeId,
        types: Object.freeze(types),
        helper: helperWithRuntimeStyle(item.helper, types),
      });
    }
    // A suspected host only claims the outline slot when the section has no
    // confirmed change of its own, so the map entry stays clickable without
    // overwriting verified facts.
    const suspectedChangeId = suspectedChangeIdByOutline.get(item.id);
    if (!suspectedChangeId || item.changeId) return item;
    return Object.freeze({
      ...item,
      changeId: suspectedChangeId,
      types: Object.freeze(canonicalTypes([...item.types, "style"])),
      helper: "疑似有改动（无法核实）",
    });
  });
  const markers = [
    ...changedCandidates.map((candidate) => Object.freeze({
      candidateKey: candidate.key,
      changeId: candidate.changeId,
      verdict: "changed",
    })),
    ...suspectedCandidates.flatMap((candidate) => {
      const changeId = suspectedChangeIdByOutline.get(candidate.outlineId);
      return changeId
        ? [Object.freeze({
          candidateKey: candidate.key,
          changeId,
          verdict: "suspected",
        })]
        : [];
    }),
  ];
  return Object.freeze({
    changes: Object.freeze(mergedChanges),
    outline: Object.freeze(mergedOutline),
    markers: Object.freeze(markers),
  });
}
