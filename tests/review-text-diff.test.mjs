import assert from "node:assert/strict";
import test from "node:test";

import {
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

test("pure insertion remains a precise addition with before-side context", () => {
  assert.deepEqual(compare("增长来自覆盖扩大。", "增长主要来自覆盖扩大。"), {
    before: [],
    after: ["主要"],
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
