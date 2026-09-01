import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeReviewStableIdTopology,
} from "../app/lib/review-stable-id-diff.js";

const item = (id, parentId, index) => ({ id, parentId, index });

test("a stable insertion does not report existing siblings as moved", () => {
  const result = analyzeReviewStableIdTopology(
    [item("a", "root", 0), item("b", "root", 1)],
    [item("new", "root", 0), item("a", "root", 1), item("b", "root", 2)],
  );

  assert.deepEqual(result.commonIds, ["a", "b"]);
  assert.deepEqual(result.addedIds, ["new"]);
  assert.deepEqual(result.movedIds, []);
});

test("ambiguous same-parent reorder reports the affected parent instead of guessing", () => {
  const result = analyzeReviewStableIdTopology(
    [item("a", "root", 0), item("b", "root", 1), item("c", "root", 2)],
    [item("b", "root", 0), item("a", "root", 1), item("c", "root", 2)],
  );

  assert.deepEqual(result.movedIds, []);
  assert.deepEqual(result.reorderedRanges, [{
    parentId: "root",
    beforeIds: ["a", "b", "c"],
    afterIds: ["b", "a", "c"],
  }]);
});

test("same-parent reorder names one element only when attribution is unique", () => {
  const result = analyzeReviewStableIdTopology(
    [item("a", "root", 0), item("b", "root", 1), item("c", "root", 2), item("d", "root", 3)],
    [item("c", "root", 0), item("a", "root", 1), item("b", "root", 2), item("d", "root", 3)],
  );

  assert.deepEqual(result.movedIds, ["c"]);
  assert.deepEqual(result.reorderedRanges, []);
});

test("cross-parent identity continuity is an exact movement fact", () => {
  const result = analyzeReviewStableIdTopology(
    [item("card", "column-a", 0), item("removed", "column-a", 1)],
    [item("card", "column-b", 0), item("added", "column-a", 0)],
  );

  assert.deepEqual(result.movedIds, ["card"]);
  assert.deepEqual(result.addedIds, ["added"]);
  assert.deepEqual(result.removedIds, ["removed"]);
});

test("duplicate IDs are excluded from exact identity analysis", () => {
  const result = analyzeReviewStableIdTopology(
    [item("duplicate", "a", 0), item("duplicate", "b", 0)],
    [item("duplicate", "c", 0)],
  );

  assert.deepEqual(result.commonIds, []);
  assert.deepEqual(result.addedIds, ["duplicate"]);
  assert.deepEqual(result.movedIds, []);
  assert.deepEqual(result.duplicateIds, ["duplicate"]);
});

test("duplicate IDs remain globally ambiguous beside valid continuity", () => {
  const result = analyzeReviewStableIdTopology(
    [item("stable", "root", 0), item("duplicate", "a", 0), item("duplicate", "b", 0)],
    [item("stable", "root", 0), item("duplicate", "c", 0), item("duplicate", "d", 0)],
  );

  assert.deepEqual(result.commonIds, ["stable"]);
  assert.deepEqual(result.duplicateIds, ["duplicate"]);
});

test("many distinct parents retain independent linear sibling topology", () => {
  const before = [];
  const after = [];
  for (let parent = 0; parent < 2_000; parent += 1) {
    before.push(item(`item-${parent}`, `parent-${parent}`, 0));
    after.push(item(`item-${parent}`, `parent-${parent}`, 0));
  }

  const result = analyzeReviewStableIdTopology(before, after);
  assert.equal(result.commonIds.length, 2_000);
  assert.deepEqual(result.movedIds, []);
});
