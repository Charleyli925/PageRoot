import assert from "node:assert/strict";
import test from "node:test";

import {
  computeAlignedRailOffset,
  computeCommentRailMinimumOffset,
  consumeRailRestoreWheel,
  layoutCommentRailItems,
  routeCommentRailWheel,
  shouldSubmitCommentOnEnter,
  stabilizeCommentTargetLayouts,
} from "../app/lib/comment-rail-layout.js";

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

test("focused alignment translates the queue without changing its order", () => {
  const result = layoutCommentRailItems({
    minimumTop: 80,
    items: [
      { key: "first", targetTop: 120, height: 140, order: 1 },
      { key: "second", targetTop: 180, height: 140, order: 2 },
      { key: "third", targetTop: 260, height: 140, order: 3 },
    ],
  });
  const offset = computeAlignedRailOffset({
    targetTop: 260,
    cardTop: result.positions.third,
  });

  assert.deepEqual(result.orderedKeys, ["first", "second", "third"]);
  assert.equal(result.positions.third + offset, 260);
  assert.ok(offset < 0);
});

test("focused alignment never hides the focused card behind the rail header", () => {
  assert.equal(computeAlignedRailOffset({
    targetTop: 24,
    cardTop: 220,
    minimumTop: 118,
  }), -102);
  assert.equal(220 + computeAlignedRailOffset({
    targetTop: 24,
    cardTop: 220,
    minimumTop: 118,
  }), 118);
});

test("aligned queue never translates below its natural position", () => {
  assert.equal(computeAlignedRailOffset({
    targetTop: 320,
    cardTop: 180,
  }), 0);
});

test("comment overflow stays inside the authored page bottom", () => {
  assert.equal(computeCommentRailMinimumOffset({
    contentBottom: 1_180,
    viewportBottom: 744,
  }), -436);
  assert.equal(computeCommentRailMinimumOffset({
    contentBottom: 620,
    viewportBottom: 744,
  }), 0);
  assert.equal(computeCommentRailMinimumOffset({
    contentBottom: Number.NaN,
    viewportBottom: 744,
  }), 0);
});

test("global comments stay before local comments regardless of canvas position", () => {
  const result = layoutCommentRailItems({
    minimumTop: 80,
    items: [
      {
        key: "local-near-top",
        targetTop: 90,
        height: 100,
        order: 1,
        scopeRank: 1,
      },
      {
        key: "global",
        targetTop: 80,
        height: 100,
        order: 2,
        scopeRank: 0,
      },
      {
        key: "local-later",
        targetTop: 320,
        height: 100,
        order: 3,
        scopeRank: 1,
      },
    ],
  });

  assert.deepEqual(result.orderedKeys, [
    "global",
    "local-near-top",
    "local-later",
  ]);
});

test("native text editing freezes visible target coordinates until editing ends", () => {
  const previous = {
    one: {
      targetId: "one",
      status: "visible",
      resolution: "exact",
      top: 120,
      height: 42,
    },
  };
  const next = {
    one: {
      targetId: "one",
      status: "visible",
      resolution: "rebound",
      top: 260,
      height: 88,
      tabGroupKey: "report-tabs",
    },
  };

  assert.deepEqual(stabilizeCommentTargetLayouts({
    previous,
    next,
    textEditing: true,
  }), {
    one: {
      ...next.one,
      top: 120,
      height: 42,
    },
  });
  assert.equal(stabilizeCommentTargetLayouts({
    previous,
    next,
    textEditing: false,
  }), next);
});

test("Enter submits comments, Shift+Enter and IME composition do not", () => {
  assert.equal(shouldSubmitCommentOnEnter({ key: "Enter" }), true);
  assert.equal(shouldSubmitCommentOnEnter({
    key: "Enter",
    shiftKey: true,
  }), false);
  assert.equal(shouldSubmitCommentOnEnter({
    key: "Enter",
    isComposing: true,
  }), false);
  assert.equal(shouldSubmitCommentOnEnter({ key: "a" }), false);
});

test("upward wheel restores hidden comments only after the page reaches top", () => {
  const pageFirst = routeCommentRailWheel({
    pageScrollTop: 90,
    pageMaxScrollTop: 900,
    railOffset: -140,
    deltaY: -120,
  });
  assert.equal(pageFirst.pageScrollTop, 0);
  assert.equal(pageFirst.railOffset, -110);
  assert.equal(pageFirst.remainder, 0);

  const restoreOnly = routeCommentRailWheel({
    pageScrollTop: 0,
    pageMaxScrollTop: 900,
    railOffset: -110,
    deltaY: -50,
  });
  assert.equal(restoreOnly.pageScrollTop, 0);
  assert.equal(restoreOnly.railOffset, -60);
  assert.equal(restoreOnly.remainder, 0);
});

test("rail restore returns unused upward wheel after reaching natural position", () => {
  assert.deepEqual(consumeRailRestoreWheel({
    offset: -30,
    deltaY: -80,
  }), {
    offset: 0,
    consumed: 30,
    remainder: -50,
  });
});

test("downward wheel keeps aligned queue stable and scrolls the page", () => {
  const result = routeCommentRailWheel({
    pageScrollTop: 40,
    pageMaxScrollTop: 900,
    railOffset: -140,
    deltaY: 75,
  });
  assert.equal(result.pageScrollTop, 115);
  assert.equal(result.railOffset, -140);
  assert.equal(result.remainder, 0);
});

test("downward wheel pulls hidden comments in only after the page reaches bottom", () => {
  const pageThenRail = routeCommentRailWheel({
    pageScrollTop: 860,
    pageMaxScrollTop: 900,
    railOffset: 0,
    railMinOffset: -260,
    deltaY: 100,
  });
  assert.equal(pageThenRail.pageScrollTop, 900);
  assert.equal(pageThenRail.railOffset, -60);
  assert.equal(pageThenRail.remainder, 0);

  const shortPage = routeCommentRailWheel({
    pageScrollTop: 0,
    pageMaxScrollTop: 0,
    railOffset: 0,
    railMinOffset: -260,
    deltaY: 400,
  });
  assert.equal(shortPage.pageScrollTop, 0);
  assert.equal(shortPage.railOffset, -260);
  assert.equal(shortPage.remainder, 140);
});
