import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  acceptRuntimeVisualSnapshots,
  changedReviewRuntimeVisualCandidateKeys,
  classifyReviewRuntimeVisualCandidates,
  isReviewRuntimeVisualRasterChangeStructural,
  isReviewRuntimeVisualRasterDifferenceMeaningful,
  mergeReviewRuntimeVisualChanges,
  REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET,
  REVIEW_RUNTIME_VISUAL_STRONG_CHANNEL_DELTA,
  REVIEW_RUNTIME_VISUAL_STRONG_PIXEL_RATIO_BUDGET,
  reviewRuntimeVisualMeanRgbDifference,
  reviewRuntimeVisualPixelsAreUniform,
  reviewRuntimeVisualStrongPixelRatio,
} from "../app/lib/review-runtime-visual.js";
import { RUNTIME_VISUAL_CONTRACT } from "../app/domain/runtime-visual-contract.js";

const PNG = new Uint8Array(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==",
  "base64",
));
const CHANGED_PNG = new Uint8Array(PNG);
CHANGED_PNG[CHANGED_PNG.length - 1] ^= 1;

function pngWithDimensions(width, height, byteLength = PNG.byteLength) {
  const png = new Uint8Array(Math.max(byteLength, PNG.byteLength));
  png.set(PNG);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return png;
}

function hash(bytes) {
  return `sha256:${bytesToHex(sha256(bytes))}`;
}

function renderedTextHash(value) {
  return hash(new Uint8Array(Buffer.from(value, "utf8")));
}

function snapshot(key, pngBytes = PNG, overrides = {}) {
  return {
    key,
    state: "captured",
    pngSha256: hash(pngBytes),
    width: 1,
    height: 1,
    layoutWidth: 1,
    layoutHeight: 1,
    byteLength: pngBytes.byteLength,
    pngBytes: new Uint8Array(pngBytes),
    renderedTextSha256: renderedTextHash("图表 9.54"),
    ...overrides,
  };
}

function unavailable(key) {
  return {
    key,
    state: "unavailable",
    pngSha256: "",
    width: 0,
    height: 0,
    layoutWidth: 0,
    layoutHeight: 0,
    byteLength: 0,
    pngBytes: new Uint8Array(),
    renderedTextSha256: "",
  };
}

test("runtime snapshots accept only bounded declared PNG results", () => {
  const allowed = new Set(["runtime-host-1"]);
  const accepted = acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-1"),
  ], allowed);
  assert.equal(accepted?.length, 1);
  assert.equal(accepted?.[0].pngSha256, hash(PNG));
  assert.notEqual(accepted?.[0].pngBytes, PNG, "accepted bytes must be copied");
  assert.equal(acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-2"),
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), extra: true },
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), pngSha256: hash(CHANGED_PNG) },
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), width: 2 },
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), layoutWidth: 0 },
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    { ...snapshot("runtime-host-1"), renderedTextSha256: "" },
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    unavailable("runtime-host-1"),
  ], allowed)?.[0].state, "unavailable");
  assert.equal(acceptRuntimeVisualSnapshots(
    [],
    new Set(Array.from({ length: 33 }, (_, index) => `runtime-host-${index + 1}`)),
  ), null);
});

test("trusted runtime snapshot parser fails closed for hostile >2MB and >4096 results", () => {
  const allowed = new Set(["runtime-host-1"]);
  const { pngBytes, pngDimension } = RUNTIME_VISUAL_CONTRACT.pageBudget;
  const overByteLimit = pngWithDimensions(1, 1, pngBytes + 1);
  const overWidthLimit = pngWithDimensions(pngDimension + 1, 1);
  const overHeightLimit = pngWithDimensions(1, pngDimension + 1);

  assert.equal(acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-1", overByteLimit),
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-1", overWidthLimit, { width: pngDimension + 1 }),
  ], allowed), null);
  assert.equal(acceptRuntimeVisualSnapshots([
    snapshot("runtime-host-1", overHeightLimit, { height: pngDimension + 1 }),
  ], allowed), null);
});

test("runtime comparison is strict for layout and rendered text, but requires a meaningful raster delta", () => {
  const candidates = [{ key: "runtime-host-1" }];
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1")],
  }), []);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
  }), []);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET],
    ]),
  }), []);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET + 0.001],
    ]),
    rasterStrongPixelRatioByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_STRONG_PIXEL_RATIO_BUDGET],
    ]),
  }), ["runtime-host-1"]);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET + 0.001],
    ]),
  }), [], "a raster difference with no structural evidence is not a change");
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", PNG, { layoutWidth: 2 })],
  }), ["runtime-host-1"]);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", PNG, {
      renderedTextSha256: renderedTextHash("图表 9.55"),
    })],
  }), ["runtime-host-1"], "a visible numeric character change has no raster tolerance");
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [unavailable("runtime-host-1")],
  }), []);
  assert.deepEqual(changedReviewRuntimeVisualCandidateKeys({
    candidates,
    before: [],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
  }), []);
});

test("raster noise budget is an RGB mean, not a changed-pixel percentage", () => {
  const before = new Uint8Array(100 * 4);
  const singleChannelNoise = new Uint8Array(before);
  singleChannelNoise[0] = 1;
  const visibleDelta = new Uint8Array(before);
  visibleDelta[0] = 13;

  assert.equal(reviewRuntimeVisualMeanRgbDifference(before, before), 0);
  assert.equal(reviewRuntimeVisualMeanRgbDifference(before, new Uint8Array(3)), null);
  assert.equal(
    isReviewRuntimeVisualRasterDifferenceMeaningful(
      reviewRuntimeVisualMeanRgbDifference(before, singleChannelNoise),
    ),
    false,
  );
  assert.equal(
    isReviewRuntimeVisualRasterDifferenceMeaningful(
      reviewRuntimeVisualMeanRgbDifference(before, visibleDelta),
    ),
    true,
  );
});

test("runtime visual merge reuses outline metadata but preserves one marker per candidate", () => {
  const documents = {
    changes: [{
      id: "change-1",
      label: "核心结论",
      helper: "文本调整",
      types: ["text"],
      beforePresent: true,
      afterPresent: true,
    }],
    outline: [
      {
        id: "outline-1",
        group: "页面",
        label: "核心结论",
        helper: "文本调整",
        changeId: "change-1",
        types: ["text"],
      },
      {
        id: "outline-2",
        group: "页面",
        label: "图表区",
        helper: "本轮未修改",
        types: [],
      },
    ],
    runtimeVisualCandidates: [
      {
        key: "runtime-host-1",
        outlineId: "outline-1",
        changeId: "change-1",
        label: "核心结论",
      },
      {
        key: "runtime-host-2",
        outlineId: "outline-2",
        changeId: "runtime-change-outline-2",
        label: "图表区",
      },
      {
        key: "runtime-host-3",
        outlineId: "outline-2",
        changeId: "runtime-change-outline-2",
        label: "图表区",
      },
    ],
  };
  const merged = mergeReviewRuntimeVisualChanges(documents, [
    "runtime-host-1",
    "runtime-host-2",
    "runtime-host-3",
  ]);
  assert.equal(merged.changes.length, 2);
  assert.deepEqual(merged.changes[0].types, ["text", "style"]);
  assert.equal(merged.changes[1].id, "runtime-change-outline-2");
  assert.deepEqual(merged.markers, [
    { candidateKey: "runtime-host-1", changeId: "change-1", verdict: "changed" },
    { candidateKey: "runtime-host-2", changeId: "runtime-change-outline-2", verdict: "changed" },
    { candidateKey: "runtime-host-3", changeId: "runtime-change-outline-2", verdict: "changed" },
  ]);
});

test("tri-state classification only dims candidates with positive pixel evidence", () => {
  const candidates = [{ key: "runtime-host-1" }];
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [unavailable("runtime-host-1")],
  }), { changedKeys: [], unverifiedKeys: ["runtime-host-1"] });
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [],
    after: [snapshot("runtime-host-1")],
  }), { changedKeys: [], unverifiedKeys: ["runtime-host-1"] }, "a missing capture is never verified-unchanged");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1")],
  }), { changedKeys: [], unverifiedKeys: [] }, "identical non-uniform pixels stay verified unchanged");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1")],
    uniformCandidateKeys: new Set(["runtime-host-1"]),
  }), { changedKeys: [], unverifiedKeys: ["runtime-host-1"] }, "identical blank surfaces are not evidence");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
  }), { changedKeys: [], unverifiedKeys: ["runtime-host-1"] }, "an undecodable raster pair has no verdict evidence");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET],
    ]),
  }), { changedKeys: [], unverifiedKeys: [] }, "raster noise within budget stays verified unchanged");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET],
    ]),
    uniformCandidateKeys: new Set(["runtime-host-1"]),
  }), { changedKeys: [], unverifiedKeys: ["runtime-host-1"] }, "two blank-ish rasters cannot verify a chart");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET + 0.001],
    ]),
    rasterStrongPixelRatioByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_STRONG_PIXEL_RATIO_BUDGET],
    ]),
  }), { changedKeys: ["runtime-host-1"], unverifiedKeys: [] });
  // An unchanged chart re-sampled at another sub-pixel phase differs everywhere
  // a little and nowhere much. That pair proves neither verdict, so it stays a
  // suspected region instead of being announced as a visual change.
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET + 0.5],
    ]),
    rasterStrongPixelRatioByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_STRONG_PIXEL_RATIO_BUDGET / 2],
    ]),
  }), { changedKeys: [], unverifiedKeys: ["runtime-host-1"] });
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET + 0.5],
    ]),
  }), { changedKeys: [], unverifiedKeys: ["runtime-host-1"] }, "a missing ratio fails closed");
});

test("the strong-pixel ratio separates a repainted area from a shifted edge", () => {
  const surface = (fill) => {
    const pixels = new Uint8Array(100 * 4);
    for (let index = 0; index < pixels.byteLength; index += 4) {
      pixels[index] = fill;
      pixels[index + 1] = fill;
      pixels[index + 2] = fill;
      pixels[index + 3] = 255;
    }
    return pixels;
  };
  const before = surface(255);
  const shiftedEdge = surface(255);
  // One antialiased edge landed one pixel over: a single strongly different
  // pixel out of a hundred.
  shiftedEdge[0] = 0;
  shiftedEdge[1] = 0;
  shiftedEdge[2] = 0;
  assert.equal(reviewRuntimeVisualStrongPixelRatio(before, shiftedEdge), 0.01);
  assert.equal(isReviewRuntimeVisualRasterChangeStructural(0.01), false);
  const repaintedArea = surface(255);
  for (let index = 0; index < 10 * 4; index += 4) {
    repaintedArea[index] = 0;
    repaintedArea[index + 1] = 0;
    repaintedArea[index + 2] = 0;
  }
  assert.equal(reviewRuntimeVisualStrongPixelRatio(before, repaintedArea), 0.1);
  assert.equal(isReviewRuntimeVisualRasterChangeStructural(0.1), true);
  // Noise below the per-channel delta never counts, however wide it spreads.
  const noisy = surface(255 - (REVIEW_RUNTIME_VISUAL_STRONG_CHANNEL_DELTA - 1));
  assert.equal(reviewRuntimeVisualStrongPixelRatio(before, noisy), 0);
  assert.equal(reviewRuntimeVisualStrongPixelRatio(before, null), null);
  assert.equal(isReviewRuntimeVisualRasterChangeStructural(null), false);
});

test("near-uniform pixel detection treats undecodable buffers as uniform", () => {
  const blank = new Uint8Array(64 * 4).fill(255);
  assert.equal(reviewRuntimeVisualPixelsAreUniform(blank), true);
  const noisyBlank = new Uint8Array(blank);
  noisyBlank[0] = 252;
  assert.equal(reviewRuntimeVisualPixelsAreUniform(noisyBlank), true);
  const rendered = new Uint8Array(blank);
  rendered[0] = 40;
  assert.equal(reviewRuntimeVisualPixelsAreUniform(rendered), false);
  assert.equal(reviewRuntimeVisualPixelsAreUniform(null), true);
  assert.equal(reviewRuntimeVisualPixelsAreUniform(new Uint8Array(3)), true);
});

test("unverified commented candidates surface as suspected changes without claiming verified facts", () => {
  const documents = {
    changes: [{
      id: "change-1",
      label: "核心结论",
      helper: "文本调整",
      types: ["text"],
      beforePresent: true,
      afterPresent: true,
    }],
    outline: [
      {
        id: "outline-1",
        group: "页面",
        label: "核心结论",
        helper: "文本调整",
        changeId: "change-1",
        types: ["text"],
      },
      {
        id: "outline-2",
        group: "页面",
        label: "图表区",
        helper: "本轮未修改",
        types: [],
      },
      {
        id: "outline-3",
        group: "页面",
        label: "未评论图表区",
        helper: "本轮未修改",
        types: [],
      },
    ],
    runtimeVisualCandidates: [
      {
        key: "runtime-host-1",
        outlineId: "outline-1",
        changeId: "change-1",
        label: "核心结论",
        commented: true,
      },
      {
        key: "runtime-host-2",
        outlineId: "outline-2",
        changeId: "runtime-change-outline-2",
        label: "图表区",
        commented: true,
      },
      {
        key: "runtime-host-3",
        outlineId: "outline-2",
        changeId: "runtime-change-outline-2",
        label: "图表区",
        commented: true,
      },
      {
        key: "runtime-host-4",
        outlineId: "outline-3",
        changeId: "runtime-change-outline-3",
        label: "未评论图表区",
      },
    ],
  };
  const merged = mergeReviewRuntimeVisualChanges(documents, {
    changedKeys: [],
    unverifiedKeys: [
      "runtime-host-1",
      "runtime-host-2",
      "runtime-host-3",
      "runtime-host-4",
    ],
  });
  assert.equal(merged.changes.length, 3);
  assert.deepEqual(merged.changes[0].types, ["text"], "confirmed change stays untouched");
  const suspectedChanges = merged.changes.filter((change) => change.suspected);
  assert.deepEqual(
    suspectedChanges.map((change) => change.id),
    ["suspected-outline-1", "suspected-outline-2"],
  );
  suspectedChanges.forEach((change) => {
    assert.equal(change.helper, "疑似有改动（无法核实）");
    assert.deepEqual(change.types, ["style"]);
  });
  assert.equal(
    merged.outline[0].changeId,
    "change-1",
    "an outline slot with a confirmed change is never overwritten by suspicion",
  );
  assert.equal(merged.outline[1].changeId, "suspected-outline-2");
  assert.equal(merged.outline[1].helper, "疑似有改动（无法核实）");
  assert.equal(
    merged.outline[2].changeId,
    undefined,
    "an uncommented unverified host keeps the plain dimmed presentation",
  );
  assert.deepEqual(merged.markers, [
    { candidateKey: "runtime-host-1", changeId: "suspected-outline-1", verdict: "suspected" },
    { candidateKey: "runtime-host-2", changeId: "suspected-outline-2", verdict: "suspected" },
    { candidateKey: "runtime-host-3", changeId: "suspected-outline-2", verdict: "suspected" },
  ], "uncommented unverified hosts emit no suspected marker");
});

test("uncommented unverified candidates alone leave the documents untouched", () => {
  const documents = {
    changes: [],
    outline: [{
      id: "outline-1",
      group: "页面",
      label: "图表区",
      helper: "本轮未修改",
      types: [],
    }],
    runtimeVisualCandidates: [{
      key: "runtime-host-1",
      outlineId: "outline-1",
      changeId: "runtime-change-outline-1",
      label: "图表区",
    }],
  };
  const merged = mergeReviewRuntimeVisualChanges(documents, {
    changedKeys: [],
    unverifiedKeys: ["runtime-host-1"],
  });
  assert.deepEqual(merged.changes, []);
  assert.deepEqual(merged.markers, []);
  assert.equal(merged.outline[0].changeId, undefined);
});

test("a changed verdict beats an unverified verdict for the same candidate", () => {
  const documents = {
    changes: [],
    outline: [{
      id: "outline-1",
      group: "页面",
      label: "图表区",
      helper: "本轮未修改",
      types: [],
    }],
    runtimeVisualCandidates: [{
      key: "runtime-host-1",
      outlineId: "outline-1",
      changeId: "runtime-change-outline-1",
      label: "图表区",
    }],
  };
  const merged = mergeReviewRuntimeVisualChanges(documents, {
    changedKeys: ["runtime-host-1"],
    unverifiedKeys: ["runtime-host-1"],
  });
  assert.deepEqual(merged.markers, [
    { candidateKey: "runtime-host-1", changeId: "runtime-change-outline-1", verdict: "changed" },
  ]);
  assert.equal(merged.changes.length, 1);
  assert.equal(merged.changes[0].suspected, undefined);
});
