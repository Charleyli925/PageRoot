import assert from "node:assert/strict";
import test from "node:test";

import {
  pairReviewSemanticTextUnits,
  readableReviewTextFootprintPlan,
  reviewTextSimilarity,
  sentenceAwareTextDifferences,
} from "../app/lib/review-text-diff.js";

function changedText(source, ranges) {
  return ranges.map(({ start, end }) => source.slice(start, end));
}

function compare(before, after) {
  const differences = sentenceAwareTextDifferences(before, after);
  return {
    before: changedText(before, differences.before),
    after: changedText(after, differences.after),
  };
}

test("semantic replacement does not preserve an accidental shared Han character", () => {
  const before = "而非「让每个商品卖得更好」（品均基本持平）。这说明增长主要来自有效成交覆盖扩大。";
  const after = "而非「让每个商品卖得更好」（单品效率整体稳定，增幅仅+0.10%）。这说明增长主要来自有效成交覆盖扩大。";

  assert.deepEqual(compare(before, after), {
    before: ["品均基本持平"],
    after: ["单品效率整体稳定，增幅仅+0.10%"],
  });
});

test("unchanged meaningful punctuation keeps independent clause edits separate", () => {
  assert.deepEqual(compare("规模扩大，效率稳定。", "规模收缩，效率提升。"), {
    before: ["扩大", "稳定"],
    after: ["收缩", "提升"],
  });
});

test("pure insertion keeps evidence and visible footprint only on the after side", () => {
  const before = "增长来自覆盖扩大。";
  const after = "增长主要来自覆盖扩大。";
  const differences = sentenceAwareTextDifferences(before, after);
  const plan = readableReviewTextFootprintPlan(before, after, differences);

  assert.deepEqual(compare(before, after), {
    before: [],
    after: ["主要"],
  });
  assert.equal(plan.operation, "insert");
  assert.deepEqual(plan.before.evidenceRanges, []);
  assert.deepEqual(plan.before.groups, []);
  assert.equal(plan.before.anchorOffset, after.indexOf("主要"));
  assert.deepEqual(plan.after.evidenceRanges, differences.after);
  assert.deepEqual(plan.after.groups, [differences.after]);
  assert.equal(plan.after.anchorOffset, null);
});

test("pure deletion keeps evidence and visible footprint only on the before side", () => {
  const before = "实验结果稳定。换言之，策略有效。";
  const after = "实验结果稳定。策略有效。";
  const differences = sentenceAwareTextDifferences(before, after);
  const plan = readableReviewTextFootprintPlan(before, after, differences);

  assert.deepEqual(compare(before, after), {
    before: ["换言之，"],
    after: [],
  });
  assert.equal(plan.operation, "delete");
  assert.deepEqual(plan.before.evidenceRanges, differences.before);
  assert.deepEqual(plan.before.groups, [differences.before]);
  assert.equal(plan.before.anchorOffset, null);
  assert.deepEqual(plan.after.evidenceRanges, []);
  assert.deepEqual(plan.after.groups, []);
  assert.equal(plan.after.anchorOffset, before.indexOf("换言之，"));
});

test("no text evidence produces no operation, anchor, or visible footprint", () => {
  const plan = readableReviewTextFootprintPlan("稳定文本", "稳定文本", {
    before: [],
    after: [],
  });

  assert.equal(plan.operation, "none");
  assert.deepEqual(plan.before, {
    evidenceRanges: [],
    groups: [],
    anchorOffset: null,
  });
  assert.deepEqual(plan.after, {
    evidenceRanges: [],
    groups: [],
    anchorOffset: null,
  });
});

test("a shared standalone Han word at the same clause edge stays unchanged", () => {
  assert.deepEqual(compare("在增长。", "在下降。"), {
    before: ["增长"],
    after: ["下降"],
  });
});

test("short Han copy keeps enough character similarity for block pairing", () => {
  assert.equal(reviewTextSimilarity("招商银行", "工商银行"), 0.75);
});

test("one accidental shared Han character does not make short blocks pairable", () => {
  assert.equal(reviewTextSimilarity("商品好", "单品稳"), 0);
});

test("long punctuation-free copy keeps distant edits in separate precise ranges", () => {
  const beforeWords = Array.from({ length: 520 }, (_, index) => `stable${index}`);
  const afterWords = [...beforeWords];
  afterWords[80] = "changedFirst";
  afterWords[440] = "changedSecond";

  assert.deepEqual(compare(beforeWords.join(" "), afterWords.join(" ")), {
    before: ["stable80", "stable440"],
    after: ["changedFirst", "changedSecond"],
  });
});

test("dense multi-line copy rewrites promote to one readable block footprint", () => {
  const before = "综搜整体仍处于放缓背景，关键不在于单纯增加曝光，而在于识别商品需求，并用更匹配的供给承接；核心仍是让模型识别电商意图，再优化结果组织，把模糊兴趣转化为可验证需求。";
  const after = "综搜放缓，但电商搜索仍有较高大盘。关键是识别内容浏览中的潜在商品需求，并用匹配供给承接。供给可归纳为电商意图识别、优化结果组织，将模糊兴趣转为可验证需求。";
  const differences = sentenceAwareTextDifferences(before, after);
  const plan = readableReviewTextFootprintPlan(before, after, differences);

  assert.equal(plan.operation, "replace");
  assert.equal(plan.before.anchorOffset, null);
  assert.equal(plan.after.anchorOffset, null);
  assert.equal(plan.scope, "block");
  assert.equal(plan.before.groups.length, 1);
  assert.equal(plan.after.groups.length, 1);
  assert.ok(plan.density >= 0.45);
});

test("a meaningful stable gap keeps precise phrase footprints separate", () => {
  const before = "规模扩大但效率稳定";
  const after = "规模收缩但效率提升";
  const differences = sentenceAwareTextDifferences(before, after);
  const plan = readableReviewTextFootprintPlan(before, after, differences);

  assert.deepEqual(compare(before, after), {
    before: ["扩大", "稳定"],
    after: ["收缩", "提升"],
  });
  assert.equal(plan.scope, "inline");
  assert.equal(plan.before.groups.length, 2);
  assert.equal(plan.after.groups.length, 2);
});

test("tiny unchanged gaps are absorbed but sentence boundaries split footprints", () => {
  const compact = readableReviewTextFootprintPlan(
    "甲乙中丙丁",
    "戊己中庚辛",
    {
      before: [{ start: 0, end: 2 }, { start: 3, end: 5 }],
      after: [{ start: 0, end: 2 }, { start: 3, end: 5 }],
    },
  );
  const separated = readableReviewTextFootprintPlan(
    "甲乙。稳定句。丙丁",
    "戊己。稳定句。庚辛",
    {
      before: [{ start: 0, end: 2 }, { start: 7, end: 9 }],
      after: [{ start: 0, end: 2 }, { start: 7, end: 9 }],
    },
  );

  assert.equal(compact.scope, "inline");
  assert.equal(compact.before.groups.length, 1);
  assert.equal(separated.scope, "inline");
  assert.equal(separated.before.groups.length, 2);
});

test("monotonic semantic pairing leaves only a fourth numbered line unmatched", () => {
  const unit = (text) => ({ kind: "numbered-line", text });
  const before = [
    unit("① 业务盘子：整体规模稳定。"),
    unit("② 实验贡献：日均增量明确。"),
    unit("③ 经营解读：效率保持稳定。"),
  ];
  const after = [
    ...before,
    unit("④ 后续重点：继续观察新增商品。"),
  ];

  assert.deepEqual(pairReviewSemanticTextUnits(before, after), [
    { beforeIndex: 0, afterIndex: 0 },
    { beforeIndex: 1, afterIndex: 1 },
    { beforeIndex: 2, afterIndex: 2 },
    { beforeIndex: null, afterIndex: 3 },
  ]);
});

test("table rows pair monotonically when an inserted row repeats a cell value", () => {
  const row = (text) => ({ kind: "table-row", text });
  const before = [
    row("COACH/蔻驰\u001f箱包皮具\u001f3.7万"),
    row("Wilson/威尔胜\u001f运动/健身\u001f1.4万"),
    row("ARC'TERYX/始祖鸟\u001f户外/登山\u001f2.3万"),
    row("耐克\u001f运动/健身\u001f3.7万"),
  ];
  const after = [
    before[0],
    before[1],
    row("阿迪达斯\u001f运动/健身\u001f1.4万"),
    before[2],
    before[3],
  ];

  assert.deepEqual(pairReviewSemanticTextUnits(before, after), [
    { beforeIndex: 0, afterIndex: 0 },
    { beforeIndex: 1, afterIndex: 1 },
    { beforeIndex: null, afterIndex: 2 },
    { beforeIndex: 2, afterIndex: 3 },
    { beforeIndex: 3, afterIndex: 4 },
  ]);
});

test("large semantic unit lists stay bounded while preserving an insertion", () => {
  const before = Array.from({ length: 800 }, (_, index) => ({
    kind: "table-row",
    text: `品牌${index}\u001f类目${index % 7}\u001f${index}万`,
  }));
  const after = [
    ...before.slice(0, 420),
    { kind: "table-row", text: "新增品牌\u001f类目0\u001f1.4万" },
    ...before.slice(420),
  ];
  const pairs = pairReviewSemanticTextUnits(before, after);

  assert.deepEqual(pairs[420], { beforeIndex: null, afterIndex: 420 });
  assert.deepEqual(pairs.at(-1), { beforeIndex: 799, afterIndex: 800 });
  assert.equal(pairs.length, 801);
});

test("stable text boundaries keep a long middle insertion in the same block", () => {
  const before = [{
    kind: "block:P",
    text: "稳定前缀，稳定后缀。",
  }];
  const after = [{
    kind: "block:P",
    text: "稳定前缀，新增说明需要跨越多个实际文字行并保持独立框选，稳定后缀。",
  }];

  assert.deepEqual(pairReviewSemanticTextUnits(before, after), [
    { beforeIndex: 0, afterIndex: 0 },
  ]);
});
