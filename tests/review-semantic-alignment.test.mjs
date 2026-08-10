import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_SEMANTIC_ALIGNMENT_MATRIX_BUDGET,
  alignReviewSemanticUnits,
} from "../app/lib/review-semantic-alignment.js";

const unit = (text, overrides = {}) => ({
  kind: "item",
  text,
  ...overrides,
});

function matchedPairs(pairs) {
  return pairs.filter((pair) => pair.beforeIndex !== null && pair.afterIndex !== null);
}

function unmatchedAfter(pairs) {
  return pairs.filter((pair) => pair.beforeIndex === null).map((pair) => pair.afterIndex);
}

test("head, middle, and tail insertions preserve every stable sibling", async (context) => {
  const before = [unit("甲"), unit("乙"), unit("丙")];
  for (const [name, after, insertion] of [
    ["head", [unit("新增"), ...before], 0],
    ["middle", [before[0], unit("新增"), before[1], before[2]], 1],
    ["tail", [...before, unit("新增")], 3],
  ]) {
    await context.test(name, () => {
      const pairs = alignReviewSemanticUnits(before, after);
      assert.deepEqual(unmatchedAfter(pairs), [insertion]);
      assert.equal(matchedPairs(pairs).length, before.length);
      assert.ok(matchedPairs(pairs).every((pair) => pair.moved === false));
    });
  }
});

test("a repeated table value cannot steal a later exact row", () => {
  const row = (name, category, value) => unit(
    `${name}\u001f${category}\u001f${value}`,
    { kind: "table-row" },
  );
  const before = [
    row("品牌甲", "箱包", "3.7万"),
    row("品牌乙", "运动", "1.4万"),
    row("品牌丙", "户外", "2.3万"),
    row("品牌丁", "运动", "3.7万"),
  ];
  const after = [
    before[0],
    before[1],
    row("品牌新增", "运动", "1.4万"),
    before[2],
    before[3],
  ];
  const pairs = alignReviewSemanticUnits(before, after);

  assert.deepEqual(unmatchedAfter(pairs), [2]);
  assert.deepEqual(matchedPairs(pairs).map(({ beforeIndex, afterIndex }) => (
    [beforeIndex, afterIndex]
  )), [[0, 0], [1, 1], [2, 3], [3, 4]]);
});

test("duplicate multi-solution siblings stay unmatched instead of being guessed", () => {
  const before = [unit("重复项"), unit("重复项")];
  const after = [unit("重复项"), unit("重复项")];
  const pairs = alignReviewSemanticUnits(before, after);

  assert.equal(matchedPairs(pairs).length, 0);
  assert.equal(pairs.filter((pair) => pair.beforeIndex === null).length, 2);
  assert.equal(pairs.filter((pair) => pair.afterIndex === null).length, 2);
});

test("units from different parent keys never pair", () => {
  const pairs = alignReviewSemanticUnits(
    [unit("相同文字", { parentKey: "list-a" })],
    [unit("相同文字", { parentKey: "list-b" })],
  );

  assert.equal(matchedPairs(pairs).length, 0);
});

test("a unique empty atomic unit pairs only through its self compatibility signature", () => {
  const pairs = alignReviewSemanticUnits(
    [unit("", {
      kind: "atomic-content:CANVAS",
      compatibilitySignature: "html\u0000canvas\u0000aria-label=趋势图",
    })],
    [unit("", {
      kind: "atomic-content:CANVAS",
      compatibilitySignature: "html\u0000canvas\u0000aria-label=趋势图",
    })],
  );

  assert.deepEqual(matchedPairs(pairs).map(({ beforeIndex, afterIndex, match }) => (
    { beforeIndex, afterIndex, match }
  )), [{ beforeIndex: 0, afterIndex: 0, match: "weighted" }]);
});

test("empty visual units with a different compatibility signature stay unmatched", () => {
  const pairs = alignReviewSemanticUnits(
    [unit("", {
      kind: "atomic-content:SVG",
      compatibilitySignature: "svg\u0000svg\u0000role=img",
    })],
    [unit("", {
      kind: "atomic-content:SVG",
      compatibilitySignature: "svg\u0000svg\u0000role=presentation",
    })],
  );

  assert.equal(matchedPairs(pairs).length, 0);
  assert.deepEqual(unmatchedAfter(pairs), [0]);
});

test("repeated empty class-only nodes remain unmatched instead of becoming positional pairs", () => {
  const repeated = () => unit("", {
    kind: "container:DIV",
    compatibilitySignature: "html\u0000div",
  });
  const pairs = alignReviewSemanticUnits(
    [repeated(), repeated()],
    [repeated(), repeated()],
  );

  assert.equal(matchedPairs(pairs).length, 0);
  assert.equal(pairs.filter((pair) => pair.beforeIndex === null).length, 2);
  assert.equal(pairs.filter((pair) => pair.afterIndex === null).length, 2);
});

test("only a unique stable identity can establish an explicit move", () => {
  const before = [
    unit("项目甲", { stableId: "a" }),
    unit("项目乙", { stableId: "b" }),
    unit("项目丙", { stableId: "c" }),
  ];
  const after = [before[1], before[0], before[2]];
  const pairs = alignReviewSemanticUnits(before, after);

  assert.deepEqual(
    matchedPairs(pairs).filter((pair) => pair.moved).map((pair) => (
      [pair.beforeIndex, pair.afterIndex, pair.match]
    )).sort((left, right) => left[0] - right[0]),
    [[0, 1, "stable-id"], [1, 0, "stable-id"]],
  );
});

test("a reordered exact signature is not promoted into a movement fact", () => {
  const before = [
    unit("完全相同甲", { exactSignature: "exact-a" }),
    unit("完全相同乙", { exactSignature: "exact-b" }),
  ];
  const pairs = alignReviewSemanticUnits(before, [before[1], before[0]]);

  assert.equal(matchedPairs(pairs).length, 2);
  assert.ok(matchedPairs(pairs).every((pair) => pair.moved === false));
});

test("an ordinary insertion without identity is never reported as movement", () => {
  const before = [unit("项目甲"), unit("项目乙")];
  const after = [before[0], unit("普通新增"), before[1]];
  const pairs = alignReviewSemanticUnits(before, after);

  assert.deepEqual(unmatchedAfter(pairs), [1]);
  assert.ok(pairs.every((pair) => pair.moved === false));
});

test("stable text boundaries keep a long middle insertion paired", () => {
  const pairs = alignReviewSemanticUnits(
    [unit("稳定前缀，稳定后缀。", { kind: "leaf-text-block:P" })],
    [unit("稳定前缀，新增说明需要跨越多个实际文字行并保持独立框选，稳定后缀。", {
      kind: "leaf-text-block:P",
    })],
  );

  assert.deepEqual(matchedPairs(pairs).map(({ beforeIndex, afterIndex, moved }) => ({
    beforeIndex,
    afterIndex,
    moved,
  })), [{ beforeIndex: 0, afterIndex: 0, moved: false }]);
});

test("swapping before and after mirrors every pair and insertion", () => {
  const before = [unit("甲"), unit("乙"), unit("丙")];
  const after = [before[0], unit("新增"), before[1], before[2]];
  const forward = alignReviewSemanticUnits(before, after);
  const reverse = alignReviewSemanticUnits(after, before);
  const normalizedForward = forward.map((pair) => (
    `${pair.beforeIndex ?? "x"}:${pair.afterIndex ?? "x"}:${pair.match}:${pair.moved}`
  )).sort();
  const normalizedReverse = reverse.map((pair) => (
    `${pair.afterIndex ?? "x"}:${pair.beforeIndex ?? "x"}:${pair.match}:${pair.moved}`
  )).sort();

  assert.deepEqual(normalizedReverse, normalizedForward);
});

test("the over-budget fallback stays monotonic and keeps a middle insertion", () => {
  const before = Array.from({ length: 90 }, (_, index) => unit(
    `项目${index}旧口径说明`,
    { exactSignature: `before-${index}` },
  ));
  const after = before.map((entry, index) => unit(
    `项目${index}新口径说明`,
    { exactSignature: `after-${index}` },
  ));
  after.splice(45, 0, unit("项目新增独立口径", { exactSignature: "inserted" }));
  const pairs = alignReviewSemanticUnits(before, after, {
    matrixBudget: 64,
    lookahead: 8,
  });
  const matched = matchedPairs(pairs).sort((left, right) => left.beforeIndex - right.beforeIndex);

  assert.ok(REVIEW_SEMANTIC_ALIGNMENT_MATRIX_BUDGET >= 60_000);
  assert.deepEqual(unmatchedAfter(pairs), [45]);
  assert.equal(matched.length, before.length);
  assert.ok(matched.every((pair, index) => (
    index === 0 || pair.afterIndex > matched[index - 1].afterIndex
  )));
});

test("large table rows and list items stay ordered within their own parent budget", () => {
  const changedSequence = (kind, parentKey, count, insertionAt) => {
    const before = Array.from({ length: count }, (_, index) => unit(
      `稳定前缀 ${index} 的旧说明保持可配对`,
      { kind, parentKey, affinities: [`${kind}:${index}`] },
    ));
    const after = before.map((entry, index) => unit(
      `稳定前缀 ${index} 的新说明保持可配对`,
      { kind, parentKey, affinities: [`${kind}:${index}`] },
    ));
    after.splice(insertionAt, 0, unit(
      `新增 ${kind} 不借用稳定项`,
      { kind, parentKey, affinities: [`${kind}:inserted`] },
    ));
    return { before, after };
  };
  const cases = [
    changedSequence("table-row", "table:primary/tbody", 240, 120),
    changedSequence("list-item", "list:primary", 320, 160),
  ];
  for (const { before, after } of cases) {
    const pairs = alignReviewSemanticUnits(before, after, {
      matrixBudget: REVIEW_SEMANTIC_ALIGNMENT_MATRIX_BUDGET,
      lookahead: 32,
    });
    const matched = matchedPairs(pairs).sort((left, right) => (
      left.beforeIndex - right.beforeIndex
    ));
    const insertionAt = after.findIndex((entry) => entry.text.startsWith("新增 "));
    assert.deepEqual(unmatchedAfter(pairs), [insertionAt]);
    assert.equal(matched.length, before.length);
    assert.ok(matched.every((pair, index) => (
      index === 0 || pair.afterIndex > matched[index - 1].afterIndex
    )));
  }
});
