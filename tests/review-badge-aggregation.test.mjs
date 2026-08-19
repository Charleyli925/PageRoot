import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateReviewBadgeLabels,
  reviewBadgeFactCount,
  reviewBadgeLabelText,
  reviewBadgesCrowd,
} from "../app/lib/review-badge-aggregation.js";

const box = (overrides) => ({
  summary: "视觉调整",
  changeId: "c1",
  labelPrimary: true,
  left: 100,
  top: 0,
  right: 200,
  bottom: 20,
  ...overrides,
});

const primaryCount = (records) => records.filter((record) => (
  record.labelPrimary !== false && record.summary
)).length;

test("reviewBadgeLabelText appends a multiplier only for real clusters", () => {
  assert.equal(reviewBadgeLabelText("视觉调整", 1), "视觉调整");
  assert.equal(reviewBadgeLabelText("视觉调整", 3), "视觉调整 ×3");
  assert.equal(reviewBadgeLabelText("", 4), "内容调整 ×4");
  assert.equal(reviewBadgeLabelText(undefined, 1), "内容调整");
});

test("stacked same-summary badges collapse into one counted representative", () => {
  const records = [
    box({ changeId: "a", top: 0, bottom: 20 }),
    box({ changeId: "b", top: 24, bottom: 44 }),
    box({ changeId: "c", top: 48, bottom: 68 }),
  ];
  const result = aggregateReviewBadgeLabels(records, { labelReach: 26 });
  assert.equal(primaryCount(result), 1, "only one label should survive");
  const representative = result.find((record) => record.labelPrimary !== false);
  assert.equal(representative.changeId, "a", "topmost box represents the cluster");
  assert.equal(representative.labelCount, 3);
  assert.equal(reviewBadgeLabelText(representative.summary, representative.labelCount), "视觉调整 ×3");
});

test("different summaries never merge even when adjacent", () => {
  const records = [
    box({ changeId: "a", summary: "文本调整", top: 0, bottom: 20 }),
    box({ changeId: "b", summary: "段落改写", top: 24, bottom: 44 }),
  ];
  const result = aggregateReviewBadgeLabels(records, { labelReach: 26 });
  assert.equal(primaryCount(result), 2, "distinct summaries keep their own labels");
  assert.ok(result.every((record) => (record.labelCount || 1) === 1));
});

test("distant same-summary badges stay independent", () => {
  const records = [
    box({ changeId: "a", top: 0, bottom: 20 }),
    box({ changeId: "b", top: 400, bottom: 420 }),
  ];
  const result = aggregateReviewBadgeLabels(records, { labelReach: 26 });
  assert.equal(primaryCount(result), 2, "far apart regions do not aggregate");
});

test("same-summary badges in different columns stay independent", () => {
  const records = [
    box({ changeId: "a", left: 0, right: 80, top: 0, bottom: 20 }),
    box({ changeId: "b", left: 400, right: 480, top: 4, bottom: 24 }),
  ];
  const result = aggregateReviewBadgeLabels(records, { labelReach: 26 });
  assert.equal(primaryCount(result), 2, "side-by-side columns do not crowd");
});

test("the focused change keeps its label as the cluster representative", () => {
  const records = [
    box({ changeId: "a", top: 0, bottom: 20 }),
    box({ changeId: "b", top: 24, bottom: 44 }),
    box({ changeId: "c", top: 48, bottom: 68 }),
  ];
  const result = aggregateReviewBadgeLabels(records, { labelReach: 26, focus: "c" });
  const representative = result.find((record) => record.labelPrimary !== false);
  assert.equal(representative.changeId, "c", "focused change stays labelled");
  assert.equal(representative.labelCount, 3);
});

test("already-suppressed labels never inflate the count", () => {
  const records = [
    box({ changeId: "a", top: 0, bottom: 20 }),
    box({ changeId: "a", top: 22, bottom: 42, labelPrimary: false }),
    box({ changeId: "b", top: 44, bottom: 64 }),
  ];
  const result = aggregateReviewBadgeLabels(records, { labelReach: 26 });
  const representative = result.find((record) => record.labelPrimary !== false);
  assert.equal(primaryCount(result), 1);
  assert.equal(representative.labelCount, 2, "only label-bearing boxes are counted");
  assert.equal(result[1].labelPrimary, false, "a suppressed box stays suppressed");
});

test("a growing vertical reach links badges the small reach leaves apart", () => {
  const pair = () => [
    box({ changeId: "a", top: 0, bottom: 20 }),
    box({ changeId: "b", top: 60, bottom: 80 }),
  ];
  assert.equal(primaryCount(aggregateReviewBadgeLabels(pair(), { labelReach: 20 })), 2);
  assert.equal(primaryCount(aggregateReviewBadgeLabels(pair(), { labelReach: 48 })), 1);
});

test("aggregation preserves records and does not mutate the input", () => {
  const records = [
    box({ changeId: "a", top: 0, bottom: 20, tone: "style", renderFragments: [1, 2] }),
    box({ changeId: "b", top: 24, bottom: 44, tone: "style", renderFragments: [3] }),
  ];
  const snapshot = JSON.stringify(records);
  const result = aggregateReviewBadgeLabels(records, { labelReach: 26 });
  assert.equal(JSON.stringify(records), snapshot, "input array is not mutated");
  assert.equal(result.length, records.length, "every box is preserved");
  assert.deepEqual(result[0].renderFragments, [1, 2], "unrelated fields survive");
});

test("reviewBadgesCrowd requires a shared column", () => {
  const left = { left: 0, right: 80, top: 0, bottom: 20 };
  const sameColumn = { left: 10, right: 90, top: 30, bottom: 50 };
  const otherColumn = { left: 400, right: 480, top: 0, bottom: 20 };
  assert.equal(reviewBadgesCrowd(left, sameColumn, 26), true);
  assert.equal(reviewBadgesCrowd(left, otherColumn, 26), false);
});

test("a collapsed nested box contributes every fact it stands for", () => {
  assert.equal(reviewBadgeFactCount({}), 1);
  assert.equal(reviewBadgeFactCount({ labelCount: 4 }), 4);
  assert.equal(reviewBadgeFactCount({ labelCount: 0 }), 1);
  assert.equal(reviewBadgeFactCount(undefined), 1);

  const records = [
    box({ changeId: "a", top: 0, bottom: 20, labelCount: 3 }),
    box({ changeId: "b", top: 24, bottom: 44 }),
  ];
  const result = aggregateReviewBadgeLabels(records, { labelReach: 26 });
  const representative = result.find((record) => record.labelPrimary !== false);
  assert.equal(primaryCount(result), 1);
  assert.equal(
    representative.labelCount,
    4,
    "counting boxes instead of facts would under-report a collapsed cluster",
  );
  assert.equal(
    reviewBadgeLabelText(representative.summary, representative.labelCount),
    "视觉调整 ×4",
  );
});
