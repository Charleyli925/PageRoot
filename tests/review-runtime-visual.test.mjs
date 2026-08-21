import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

import {
  acceptRuntimeVisualSnapshots,
  changedReviewRuntimeVisualCandidateKeys,
  classifyReviewRuntimeVisualCandidates,
  isReviewRuntimeVisualRasterDifferenceMeaningful,
  mergeReviewRuntimeVisualChanges,
  REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET,
  reviewRuntimeVisualMeanRgbDifference,
  reviewRuntimeVisualPixelsAreUniform,
  reviewRuntimeVisualSnapshotComparison,
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
    surfaceSha256: "",
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
    surfaceSha256: "",
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
  }), ["runtime-host-1"]);
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
  // outline-2 has no source change, so runtime pixels may only raise suspicion
  // there instead of inventing a confirmed one.
  assert.equal(merged.changes[1].id, "suspected-outline-2");
  assert.equal(merged.changes[1].suspected, true);
  assert.deepEqual(merged.markers, [
    { candidateKey: "runtime-host-1", changeId: "change-1", verdict: "changed" },
    { candidateKey: "runtime-host-2", changeId: "suspected-outline-2", verdict: "suspected" },
    { candidateKey: "runtime-host-3", changeId: "suspected-outline-2", verdict: "suspected" },
  ]);
});

test("tri-state classification only dims candidates with positive pixel evidence", () => {
  const candidates = [{ key: "runtime-host-1" }];
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [unavailable("runtime-host-1")],
  }), { changedKeys: [], stronglyChangedKeys: [], unverifiedKeys: ["runtime-host-1"] });
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [],
    after: [snapshot("runtime-host-1")],
  }), { changedKeys: [], stronglyChangedKeys: [], unverifiedKeys: ["runtime-host-1"] }, "a missing capture is never verified-unchanged");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1")],
  }), { changedKeys: [], stronglyChangedKeys: [], unverifiedKeys: [] }, "identical non-uniform pixels stay verified unchanged");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1")],
    uniformCandidateKeys: new Set(["runtime-host-1"]),
  }), { changedKeys: [], stronglyChangedKeys: [], unverifiedKeys: ["runtime-host-1"] }, "identical blank surfaces are not evidence");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
  }), { changedKeys: [], stronglyChangedKeys: [], unverifiedKeys: ["runtime-host-1"] }, "an undecodable raster pair has no verdict evidence");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET],
    ]),
  }), { changedKeys: [], stronglyChangedKeys: [], unverifiedKeys: [] }, "raster noise within budget stays verified unchanged");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET],
    ]),
    uniformCandidateKeys: new Set(["runtime-host-1"]),
  }), { changedKeys: [], stronglyChangedKeys: [], unverifiedKeys: ["runtime-host-1"] }, "two blank-ish rasters cannot verify a chart");
  assert.deepEqual(classifyReviewRuntimeVisualCandidates({
    candidates,
    before: [snapshot("runtime-host-1")],
    after: [snapshot("runtime-host-1", CHANGED_PNG)],
    rasterMeanRgbDifferenceByKey: new Map([
      ["runtime-host-1", REVIEW_RUNTIME_VISUAL_RASTER_MEAN_RGB_DIFFERENCE_BUDGET + 0.001],
    ]),
  }), { changedKeys: ["runtime-host-1"], stronglyChangedKeys: [], unverifiedKeys: [] });
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

test("a single unverified host surfaces its own suspicion", () => {
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
  // One host nobody could verify is actionable and stays inside the review's
  // suspicion budget, so it earns a frame rather than a silent dim.
  assert.deepEqual(
    merged.markers,
    [{ candidateKey: "runtime-host-1", changeId: "suspected-outline-1", verdict: "suspected" }],
  );
  assert.equal(merged.changes.length, 1);
  assert.equal(merged.changes[0].suspected, true);
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
  // The candidate is resolved once through the changed path, never counted a
  // second time as unverified. Without a source change in the section the
  // verdict it earns there is suspicion, not a confirmed visual fact.
  assert.deepEqual(merged.markers, [
    { candidateKey: "runtime-host-1", changeId: "suspected-outline-1", verdict: "suspected" },
  ]);
  assert.equal(merged.changes.length, 1);
  assert.equal(merged.changes[0].suspected, true);
});

function sectionDocuments({ helper, types, candidateOverrides = {} }) {
  return {
    changes: [{
      id: "change-1",
      label: "观察与备注",
      helper,
      types,
      beforePresent: true,
      afterPresent: true,
    }],
    outline: [{
      id: "outline-1",
      group: "页面",
      label: "观察与备注",
      helper,
      changeId: "change-1",
      types,
    }],
    runtimeVisualCandidates: [{
      key: "runtime-host-1",
      outlineId: "outline-1",
      changeId: "change-1",
      label: "观察与备注",
      ...candidateOverrides,
    }],
  };
}

test("runtime style evidence never rewrites wording the type list cannot rebuild", () => {
  ["新增内容", "删除内容", "位置调整"].forEach((helper) => {
    const merged = mergeReviewRuntimeVisualChanges(
      sectionDocuments({ helper, types: ["structure"] }),
      { changedKeys: ["runtime-host-1"], stronglyChangedKeys: [], unverifiedKeys: [] },
    );
    assert.equal(merged.changes[0].helper, helper, `${helper} must survive runtime style evidence`);
    assert.deepEqual(merged.changes[0].types, ["structure", "style"]);
    assert.equal(merged.outline[0].helper, helper, "the outline entry keeps it too");
  });
});

test("runtime style evidence still refreshes wording the type list does describe", () => {
  const merged = mergeReviewRuntimeVisualChanges(
    sectionDocuments({ helper: "文本调整", types: ["text"] }),
    { changedKeys: ["runtime-host-1"], stronglyChangedKeys: [], unverifiedKeys: [] },
  );
  assert.equal(merged.changes[0].helper, "文本、视觉调整");
  assert.equal(merged.outline[0].helper, "文本、视觉调整");
});

test("an unverified host surfaces suspicion whether or not the user commented on it", () => {
  const documents = {
    changes: [],
    outline: [
      { id: "outline-1", group: "页面", label: "图 1", helper: "本轮未修改", types: [] },
      { id: "outline-2", group: "页面", label: "图 2", helper: "本轮未修改", types: [] },
    ],
    runtimeVisualCandidates: [
      {
        key: "runtime-host-1",
        outlineId: "outline-1",
        changeId: "runtime-change-outline-1",
        label: "图 1",
      },
      {
        key: "runtime-host-2",
        outlineId: "outline-2",
        changeId: "runtime-change-outline-2",
        label: "图 2",
      },
    ],
  };
  const merged = mergeReviewRuntimeVisualChanges(documents, {
    changedKeys: [],
    unverifiedKeys: ["runtime-host-1"],
  });
  assert.deepEqual(
    merged.markers,
    [{ candidateKey: "runtime-host-1", changeId: "suspected-outline-1", verdict: "suspected" }],
    "an uncommented unverified host must not be presented as verified-unchanged context",
  );
});

test("a page that mostly failed to verify reports per-host suspicion only where the user asked", () => {
  const outline = [];
  const runtimeVisualCandidates = [];
  for (let index = 1; index <= 4; index += 1) {
    outline.push({
      id: `outline-${index}`,
      group: "页面",
      label: `图 ${index}`,
      helper: "本轮未修改",
      types: [],
    });
    runtimeVisualCandidates.push({
      key: `runtime-host-${index}`,
      outlineId: `outline-${index}`,
      changeId: `runtime-change-outline-${index}`,
      label: `图 ${index}`,
      ...(index === 2 ? { commented: true } : {}),
    });
  }
  const merged = mergeReviewRuntimeVisualChanges(
    { changes: [], outline, runtimeVisualCandidates },
    {
      changedKeys: [],
      unverifiedKeys: runtimeVisualCandidates.map((candidate) => candidate.key),
    },
  );
  assert.deepEqual(
    merged.markers.map((marker) => marker.candidateKey),
    ["runtime-host-2"],
    "a blocked chart library is one page-level cause, not four amber frames",
  );
});

const surfaceHash = (value) => renderedTextHash(`surface:${value}`);

test("a readable drawing surface decides ahead of the window raster", () => {
  // The window capture differs because the host moved half a device pixel, but
  // the chart drew exactly the same bytes into its own surface. Comparing
  // window pixels here is what produced 100% false positives on real pages.
  assert.equal(
    reviewRuntimeVisualSnapshotComparison(
      snapshot("runtime-host-1", PNG, { surfaceSha256: surfaceHash("2166136261") }),
      snapshot("runtime-host-1", CHANGED_PNG, {
        pngSha256: hash(CHANGED_PNG),
        byteLength: CHANGED_PNG.byteLength,
        surfaceSha256: surfaceHash("2166136261"),
      }),
    ),
    "unchanged",
  );
});

test("a differing drawing surface is a change even when the window pixels match", () => {
  assert.equal(
    reviewRuntimeVisualSnapshotComparison(
      snapshot("runtime-host-1", PNG, { surfaceSha256: surfaceHash("1") }),
      snapshot("runtime-host-1", PNG, { surfaceSha256: surfaceHash("2") }),
    ),
    "changed",
  );
});

test("a surface reading only one side can never decide", () => {
  // A tainted canvas, an unreadable context or a host with no surface at all
  // leaves the digest empty on that side; the pair must fall back to the
  // raster path instead of comparing a hash against nothing.
  ["before", "after"].forEach((side) => {
    const readable = { surfaceSha256: surfaceHash("2166136261") };
    assert.equal(
      reviewRuntimeVisualSnapshotComparison(
        snapshot("runtime-host-1", PNG, side === "before" ? readable : { surfaceSha256: "" }),
        snapshot("runtime-host-1", CHANGED_PNG, {
          pngSha256: hash(CHANGED_PNG),
          byteLength: CHANGED_PNG.byteLength,
          ...(side === "after" ? readable : { surfaceSha256: "" }),
        }),
      ),
      "raster",
      `a digest present only on the ${side} side must not decide`,
    );
  });
});

test("dimension and visible-text evidence still outrank a matching surface", () => {
  const matching = { surfaceSha256: surfaceHash("2166136261") };
  assert.equal(
    reviewRuntimeVisualSnapshotComparison(
      snapshot("runtime-host-1", PNG, matching),
      snapshot("runtime-host-1", PNG, { ...matching, layoutWidth: 2 }),
    ),
    "changed",
    "a resized host changed even if it redrew the same surface bytes",
  );
  assert.equal(
    reviewRuntimeVisualSnapshotComparison(
      snapshot("runtime-host-1", PNG, matching),
      snapshot("runtime-host-1", PNG, {
        ...matching,
        renderedTextSha256: renderedTextHash("图表 9.55"),
      }),
    ),
    "changed",
    "a visible label edit stays a change",
  );
});

test("position-independent evidence confirms a change with no section corroboration", () => {
  // A chart's data and colours are driven from a script or stylesheet outside
  // its own section, so on real pages the section holds no static change at
  // all. Requiring corroboration there downgraded every genuine chart edit to
  // amber; a surface digest survives a move and window compositing, so it
  // stands on its own.
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
    stronglyChangedKeys: ["runtime-host-1"],
    unverifiedKeys: [],
  });
  assert.deepEqual(
    merged.markers,
    [{ candidateKey: "runtime-host-1", changeId: "runtime-change-outline-1", verdict: "changed" }],
  );
  assert.equal(merged.changes[0].suspected, undefined);
});

test("raster-only evidence still needs section corroboration", () => {
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
    stronglyChangedKeys: [],
    unverifiedKeys: [],
  });
  assert.deepEqual(
    merged.markers,
    [{ candidateKey: "runtime-host-1", changeId: "suspected-outline-1", verdict: "suspected" }],
    "pixel distance cannot tell a redrawn chart from a shifted one",
  );
});

test("more than one unverified host becomes a page-level fact", () => {
  const outline = [];
  const runtimeVisualCandidates = [];
  for (let index = 1; index <= 3; index += 1) {
    outline.push({
      id: `outline-${index}`,
      group: "页面",
      label: `图 ${index}`,
      helper: "本轮未修改",
      types: [],
    });
    runtimeVisualCandidates.push({
      key: `runtime-host-${index}`,
      outlineId: `outline-${index}`,
      changeId: `runtime-change-outline-${index}`,
      label: `图 ${index}`,
      ...(index === 3 ? { commented: true } : {}),
    });
  }
  const merged = mergeReviewRuntimeVisualChanges(
    { changes: [], outline, runtimeVisualCandidates },
    {
      changedKeys: [],
      stronglyChangedKeys: [],
      unverifiedKeys: runtimeVisualCandidates.map((candidate) => candidate.key),
    },
  );
  assert.deepEqual(
    merged.markers.map((marker) => marker.candidateKey),
    ["runtime-host-3"],
    "a shared cause is one fact, and only the host the user asked about keeps its frame",
  );
});
