import assert from "node:assert/strict";
import test from "node:test";

import { layoutCommentRailItems } from "../app/lib/comment-rail-layout.js";

test("comment rail follows page position even when another item is focused", () => {
  const result = layoutCommentRailItems({
    minimumTop: 80,
    items: [
      { key: "focused-late", targetTop: 420, height: 120, order: 1 },
      { key: "early", targetTop: 160, height: 100, order: 1 },
      { key: "middle", targetTop: 260, height: 110, order: 1 },
    ],
  });

  assert.deepEqual(result.orderedKeys, ["early", "middle", "focused-late"]);
  assert.equal(result.positions.early, 160);
  assert.equal(result.positions.middle, 280);
  assert.equal(result.positions["focused-late"], 420);
});

test("saved comments stay ahead of an unsaved draft at the same target", () => {
  const result = layoutCommentRailItems({
    minimumTop: 80,
    items: [
      { key: "__composer", targetTop: 180, height: 260, order: 3 },
      { key: "saved-later", targetTop: 180, height: 120, order: 2 },
      { key: "saved-earlier", targetTop: 180, height: 100, order: 1 },
    ],
  });

  assert.deepEqual(result.orderedKeys, [
    "saved-earlier",
    "saved-later",
    "__composer",
  ]);
  assert.equal(result.positions["saved-later"], 300);
  assert.equal(result.positions.__composer, 440);
});

test("expanding the header moves cards down without changing their order", () => {
  const items = [
    { key: "first", targetTop: 40, height: 100, order: 1 },
    { key: "second", targetTop: 100, height: 120, order: 1 },
  ];
  const folded = layoutCommentRailItems({ items, minimumTop: 90 });
  const expanded = layoutCommentRailItems({ items, minimumTop: 310 });

  assert.deepEqual(expanded.orderedKeys, folded.orderedKeys);
  assert.equal(folded.positions.first, 90);
  assert.equal(expanded.positions.first, 310);
  assert.equal(expanded.positions.second, 430);
});

test("measured heights and the shared gap prevent overlapping cards", () => {
  const result = layoutCommentRailItems({
    minimumTop: 80,
    gap: 16,
    items: [
      { key: "one", targetTop: 100, height: 145, order: 1 },
      { key: "two", targetTop: 120, height: 90, order: 1 },
      { key: "three", targetTop: 150, height: 70, order: 1 },
    ],
  });

  assert.equal(result.positions.one, 100);
  assert.equal(result.positions.two, 261);
  assert.equal(result.positions.three, 367);
  assert.equal(result.bottom, 453);
});

test("comment rail rejects a target without a measured coordinate", () => {
  assert.throws(
    () => layoutCommentRailItems({
      minimumTop: 80,
      items: [
        { key: "missing", targetTop: Number.NaN, height: 120, order: 1 },
      ],
    }),
    /has no measured coordinate/u,
  );
});
