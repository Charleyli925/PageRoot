import assert from "node:assert/strict";
import test from "node:test";

import { reviewRegionAnnotations } from "../app/lib/review-region-annotation.js";

const record = (overrides) => ({
  changeId: "c1",
  summary: "视觉调整",
  tone: "style",
  left: 100,
  top: 40,
  right: 220,
  bottom: 70,
  ...overrides,
});

test("nearby records of one change group into one cluster with union bounds", () => {
  const regions = reviewRegionAnnotations([
    record({ left: 100, top: 40, right: 220, bottom: 70 }),
    record({ left: 60, top: 80, right: 300, bottom: 110 }),
  ]);
  assert.equal(regions.length, 1);
  assert.deepEqual(
    [regions[0].left, regions[0].top, regions[0].right, regions[0].bottom],
    [60, 40, 300, 110],
  );
  assert.equal(regions[0].changeId, "c1");
  assert.equal(regions[0].suspected, false);
});

test("far-apart parts of one change form their own clusters with own captions", () => {
  const regions = reviewRegionAnnotations([
    record({ summary: "段落改写", top: 40, bottom: 70 }),
    record({ summary: "文本调整", top: 90, bottom: 120 }),
    record({ summary: "新增内容", top: 400, bottom: 430 }),
  ], { clusterGap: 28 });
  assert.equal(regions.length, 2);
  assert.deepEqual(
    regions.map((region) => [region.top, region.bottom, region.summary]),
    [[40, 120, "段落改写 · 文本调整"], [400, 430, "新增内容"]],
  );
  assert.ok(regions.every((region) => region.changeId === "c1"));
});

test("the carrier is the cluster's topmost-leftmost input record", () => {
  const first = record({ summary: "视觉调整", top: 60, bottom: 80, left: 40 });
  const second = record({ summary: "新增内容", top: 40, bottom: 58, left: 200 });
  const regions = reviewRegionAnnotations([first, second]);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].carrier, second, "carrier must be the original record reference");
});

test("distinct changes stay distinct regions sorted by reading order", () => {
  const regions = reviewRegionAnnotations([
    record({ changeId: "low", top: 400, bottom: 420 }),
    record({ changeId: "high", top: 10, bottom: 30 }),
  ]);
  assert.deepEqual(regions.map((region) => region.changeId), ["high", "low"]);
});

test("the resting caption reads distinct kinds without counts", () => {
  const regions = reviewRegionAnnotations([
    record({ summary: "新增内容", top: 40, bottom: 60 }),
    record({ summary: "新增内容", top: 62, bottom: 80 }),
    record({ summary: "视觉调整", top: 82, bottom: 100 }),
  ]);
  assert.equal(regions[0].summary, "新增内容 · 视觉调整");
});

test("three or more kinds collapse the resting caption to 综合调整", () => {
  const regions = reviewRegionAnnotations([
    record({ summary: "新增内容" }),
    record({ summary: "视觉调整", top: 72, bottom: 90 }),
    record({ summary: "结构调整", top: 92, bottom: 110 }),
  ]);
  assert.equal(regions[0].summary, "综合调整");
});

test("clusters read their own kinds, not the whole change's", () => {
  const regions = reviewRegionAnnotations([
    record({ summary: "新增内容", top: 40, bottom: 60 }),
    record({ summary: "视觉调整", top: 400, bottom: 420 }),
  ], { clusterGap: 28 });
  assert.deepEqual(regions.map((region) => region.summary), ["新增内容", "视觉调整"]);
  assert.deepEqual(regions.map((region) => region.detail), ["新增内容", "视觉调整"]);
});

test("the focused caption counts facts per kind", () => {
  const regions = reviewRegionAnnotations([
    record({ summary: "新增内容", top: 40, bottom: 60 }),
    record({ summary: "新增内容", top: 62, bottom: 80 }),
    record({ summary: "新增内容", top: 82, bottom: 100 }),
    record({ summary: "视觉调整", top: 102, bottom: 120 }),
  ]);
  assert.equal(regions[0].detail, "新增内容 ×3 · 视觉调整");
});

test("a collapsed record contributes every fact it stands for", () => {
  const regions = reviewRegionAnnotations([
    record({ summary: "视觉调整", labelCount: 4 }),
    record({ summary: "视觉调整", top: 72, bottom: 90 }),
  ]);
  assert.equal(regions[0].detail, "视觉调整 ×5");
  assert.equal(regions[0].summary, "视觉调整");
});

test("kind order follows the topmost record, not insertion order", () => {
  const regions = reviewRegionAnnotations([
    record({ summary: "视觉调整", top: 62, bottom: 82 }),
    record({ summary: "新增内容", top: 40, bottom: 60 }),
  ]);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].summary, "新增内容 · 视觉调整");
});

test("nearby records merge into one cluster, distant parts keep their own", () => {
  const regions = reviewRegionAnnotations([
    record({ top: 40, bottom: 70 }),
    record({ top: 90, bottom: 120 }),
    record({ top: 400, bottom: 430 }),
  ], { clusterGap: 28 });
  assert.deepEqual(
    regions.map((region) => ({ top: region.top, bottom: region.bottom })),
    [
      { top: 40, bottom: 120 },
      { top: 400, bottom: 430 },
    ],
  );
});

test("a suspected record marks the whole region suspected", () => {
  const regions = reviewRegionAnnotations([
    record({ tone: "suspected", summary: "疑似有改动" }),
  ]);
  assert.equal(regions[0].suspected, true);
  assert.equal(regions[0].summary, "疑似有改动");
  assert.equal(regions[0].detail, "疑似有改动");
});

test("records without identity or finite geometry are ignored", () => {
  const regions = reviewRegionAnnotations([
    record({ changeId: "" }),
    record({ left: Number.NaN }),
    null,
    record({ changeId: "kept" }),
  ]);
  assert.equal(regions.length, 1);
  assert.equal(regions[0].changeId, "kept");
});

test("empty summaries fall back to 内容调整", () => {
  const regions = reviewRegionAnnotations([record({ summary: "" })]);
  assert.equal(regions[0].summary, "内容调整");
  assert.equal(regions[0].detail, "内容调整");
});

test("input records are not mutated", () => {
  const records = [
    record({ summary: "新增内容" }),
    record({ summary: "视觉调整", top: 80, bottom: 100 }),
  ];
  const snapshot = JSON.stringify(records);
  reviewRegionAnnotations(records);
  assert.equal(JSON.stringify(records), snapshot);
});
