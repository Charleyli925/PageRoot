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
      assert.ok(matchedPairs(pairs).every((pair) => !("moved" in pair)));
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

test("a persistent stable identity pairs across source parents", () => {
  const pairs = alignReviewSemanticUnits(
    [unit("同一源码元素", { stableId: "pageroot:pr1_source", parentKey: "list-a" })],
    [unit("同一源码元素已移动", { stableId: "pageroot:pr1_source", parentKey: "list-b" })],
  );

  assert.deepEqual(matchedPairs(pairs).map(({ beforeIndex, afterIndex, match }) => ({
    beforeIndex,
    afterIndex,
    match,
  })), [{ beforeIndex: 0, afterIndex: 0, match: "stable-id" }]);
});

test("a legacy explicit identity remains scoped to its paired parent", () => {
  const pairs = alignReviewSemanticUnits(
    [unit("旧元素", { stableId: "id:legacy", parentKey: "list-a" })],
    [unit("旧元素", { stableId: "id:legacy", parentKey: "list-b" })],
  );

  assert.equal(matchedPairs(pairs).length, 0);
});

test("globally ambiguous persistent identities cannot pair through fallback evidence", () => {
  const ambiguous = (text) => unit(text, {
    stableId: null,
    identityAmbiguous: true,
    exactSignature: "same-subtree",
    compatibilitySignature: "same-element",
    relocationKey: "same-relocation",
  });
  const pairs = alignReviewSemanticUnits(
    [ambiguous("重复源码元素")],
    [ambiguous("重复源码元素")],
  );

  assert.equal(matchedPairs(pairs).length, 0);
  assert.deepEqual(unmatchedAfter(pairs), [0]);
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

test("reordered stable identities remain paired without creating a movement fact", () => {
  const before = [
    unit("项目甲", { stableId: "a" }),
    unit("项目乙", { stableId: "b" }),
    unit("项目丙", { stableId: "c" }),
  ];
  const after = [before[1], before[0], before[2]];
  const pairs = alignReviewSemanticUnits(before, after);

  assert.deepEqual(
    matchedPairs(pairs).map((pair) => (
      [pair.beforeIndex, pair.afterIndex, pair.match]
    )).sort((left, right) => left[0] - right[0]),
    [[0, 1, "stable-id"], [1, 0, "stable-id"], [2, 2, "stable-id"]],
  );
  assert.ok(pairs.every((pair) => !("moved" in pair)));
});

test("a reordered exact signature is not promoted into a movement fact", () => {
  const before = [
    unit("完全相同甲", { exactSignature: "exact-a" }),
    unit("完全相同乙", { exactSignature: "exact-b" }),
  ];
  const pairs = alignReviewSemanticUnits(before, [before[1], before[0]]);

  assert.equal(matchedPairs(pairs).length, 2);
  assert.ok(matchedPairs(pairs).every((pair) => !("moved" in pair)));
});

test("a uniquely titled card remains paired when it moves and its internals change", () => {
  const jdRelocation = "panel:retail\u0000container:DIV\u0000metric\u0000京东零售经营利润";
  const before = [
    unit("京东零售经营利润 135 亿元 -3.3% 旧单行说明", {
      kind: "container:DIV",
      exactSignature: "jd-before",
      relocationKey: jdRelocation,
    }),
    unit("稳定卡片", { exactSignature: "stable-card" }),
  ];
  const after = [
    before[1],
    unit("京东零售经营利润 135 亿元 -3.3% 新的多行说明与内部标记", {
      kind: "container:DIV",
      exactSignature: "jd-after",
      relocationKey: jdRelocation,
    }),
  ];
  const pairs = alignReviewSemanticUnits(before, after);

  assert.deepEqual(
    matchedPairs(pairs).map((pair) => (
      [pair.beforeIndex, pair.afterIndex, pair.match]
    )).sort((left, right) => left[0] - right[0]),
    [[0, 1, "weighted"], [1, 0, "exact-signature"]],
  );
  assert.ok(pairs.every((pair) => !("moved" in pair)));
});

test("duplicate relocation titles remain ambiguous instead of being guessed", () => {
  const duplicate = (text, exactSignature) => unit(text, {
    kind: "container:DIV",
    exactSignature,
    relocationKey: "panel:retail\u0000container:DIV\u0000metric\u0000重复指标",
  });
  const pairs = alignReviewSemanticUnits(
    [duplicate("北方仓储周转红线", "before-a"), duplicate("南区门店库存阈值", "before-b")],
    [duplicate("海外广告买量策略", "after-b"), duplicate("研发费用资本化口径", "after-a")],
  );

  assert.equal(matchedPairs(pairs).length, 0);
  assert.equal(pairs.filter((pair) => pair.beforeIndex === null).length, 2);
  assert.equal(pairs.filter((pair) => pair.afterIndex === null).length, 2);
});

test("an exact duplicate does not make its changed relocation peer look unique", () => {
  const relocationKey = "panel:retail\u0000container:DIV\u0000metric\u0000重复卡片";
  const exact = unit("重复卡片的稳定内容", {
    kind: "container:DIV",
    exactSignature: "duplicate-exact",
    relocationKey,
  });
  const pairs = alignReviewSemanticUnits(
    [
      exact,
      unit("北方仓储周转红线", {
        kind: "container:DIV",
        exactSignature: "changed-before",
        relocationKey,
      }),
    ],
    [
      exact,
      unit("海外广告买量策略", {
        kind: "container:DIV",
        exactSignature: "changed-after",
        relocationKey,
      }),
    ],
  );

  assert.deepEqual(matchedPairs(pairs).map(({ beforeIndex, afterIndex, match }) => (
    { beforeIndex, afterIndex, match }
  )), [{ beforeIndex: 0, afterIndex: 0, match: "exact-signature" }]);
  assert.deepEqual(
    pairs.filter((pair) => pair.afterIndex === null).map((pair) => pair.beforeIndex),
    [1],
  );
  assert.deepEqual(unmatchedAfter(pairs), [1]);
});

test("an ordinary insertion stays unmatched without disturbing stable siblings", () => {
  const before = [unit("项目甲"), unit("项目乙")];
  const after = [before[0], unit("普通新增"), before[1]];
  const pairs = alignReviewSemanticUnits(before, after);

  assert.deepEqual(unmatchedAfter(pairs), [1]);
  assert.ok(pairs.every((pair) => !("moved" in pair)));
});

test("stable text boundaries keep a long middle insertion paired", () => {
  const pairs = alignReviewSemanticUnits(
    [unit("稳定前缀，稳定后缀。", { kind: "leaf-text-block:P" })],
    [unit("稳定前缀，新增说明需要跨越多个实际文字行并合并为一个框，稳定后缀。", {
      kind: "leaf-text-block:P",
    })],
  );

  assert.deepEqual(matchedPairs(pairs).map(({ beforeIndex, afterIndex }) => ({
    beforeIndex,
    afterIndex,
  })), [{ beforeIndex: 0, afterIndex: 0 }]);
});

test("a completely rewritten singleton keeps the same compatible element", () => {
  const pairs = alignReviewSemanticUnits(
    [unit("旧文案完全不同", {
      kind: "list-item:LI",
      compatibilitySignature: "list-item\u0000:LI\u0000li",
      parentKey: "list:primary",
    })],
    [unit("自动闭环验收通过", {
      kind: "list-item:LI",
      compatibilitySignature: "list-item\u0000:LI\u0000li",
      parentKey: "list:primary",
    })],
  );

  assert.deepEqual(matchedPairs(pairs).map(({ beforeIndex, afterIndex, match }) => ({
    beforeIndex,
    afterIndex,
    match,
  })), [{ beforeIndex: 0, afterIndex: 0, match: "weighted" }]);
});

test("a singleton with different own structure stays an element replacement", () => {
  const pairs = alignReviewSemanticUnits(
    [unit("天气晴朗", {
      kind: "list-item:LI",
      compatibilitySignature: "list-item\u0000:LI\u0000li:data-role=old",
    })],
    [unit("自动闭环", {
      kind: "list-item:LI",
      compatibilitySignature: "list-item\u0000:LI\u0000li:data-role=new",
    })],
  );

  assert.equal(matchedPairs(pairs).length, 0);
  assert.deepEqual(unmatchedAfter(pairs), [0]);
});

test("swapping before and after mirrors every pair and insertion", () => {
  const before = [unit("甲"), unit("乙"), unit("丙")];
  const after = [before[0], unit("新增"), before[1], before[2]];
  const forward = alignReviewSemanticUnits(before, after);
  const reverse = alignReviewSemanticUnits(after, before);
  const normalizedForward = forward.map((pair) => (
    `${pair.beforeIndex ?? "x"}:${pair.afterIndex ?? "x"}:${pair.match}`
  )).sort();
  const normalizedReverse = reverse.map((pair) => (
    `${pair.afterIndex ?? "x"}:${pair.beforeIndex ?? "x"}:${pair.match}`
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
