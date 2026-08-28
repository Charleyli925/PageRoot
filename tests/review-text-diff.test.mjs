import assert from "node:assert/strict";
import test from "node:test";

import {
  readableReviewTextFootprintPlan,
  reconcileReviewTextSurvivors,
  reviewSentenceRanges,
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
  assert.deepEqual(plan.before.phraseGroups, []);
  assert.equal(plan.before.anchorOffset, after.indexOf("主要"));
  assert.deepEqual(plan.after.evidenceRanges, differences.after);
  assert.deepEqual(plan.after.phraseGroups, [differences.after]);
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
  assert.deepEqual(plan.before.phraseGroups, [differences.before]);
  assert.equal(plan.before.anchorOffset, null);
  assert.deepEqual(plan.after.evidenceRanges, []);
  assert.deepEqual(plan.after.phraseGroups, []);
  assert.equal(plan.after.anchorOffset, before.indexOf("换言之，"));
});

test("insert and delete plans are strict mirrors when the sides are swapped", () => {
  const before = "稳定前缀，稳定后缀。";
  const after = "稳定前缀，新增内容，稳定后缀。";
  const differences = sentenceAwareTextDifferences(before, after);
  const inserted = readableReviewTextFootprintPlan(before, after, differences);
  const deleted = readableReviewTextFootprintPlan(after, before, {
    before: differences.after,
    after: differences.before,
  });

  assert.equal(inserted.operation, "insert");
  assert.equal(deleted.operation, "delete");
  assert.deepEqual(deleted.before, inserted.after);
  assert.deepEqual(deleted.after, inserted.before);
  assert.equal("scope" in inserted, false);
  assert.equal("density" in inserted, false);
});

test("an invisible navigation anchor never implies a visible footprint", () => {
  const plan = readableReviewTextFootprintPlan("甲乙", "甲新增乙", {
    before: [],
    after: [{ start: 1, end: 3 }],
  });

  assert.equal(plan.before.anchorOffset, 1);
  assert.deepEqual(plan.before.evidenceRanges, []);
  assert.deepEqual(plan.before.phraseGroups, []);
});

test("no text evidence produces no operation, anchor, or visible footprint", () => {
  const plan = readableReviewTextFootprintPlan("稳定文本", "稳定文本", {
    before: [],
    after: [],
  });

  assert.equal(plan.operation, "none");
  assert.deepEqual(plan.before, {
    evidenceRanges: [],
    phraseGroups: [],
    anchorOffset: null,
  });
  assert.deepEqual(plan.after, {
    evidenceRanges: [],
    phraseGroups: [],
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

test("dense rewrites keep exact phrase groups for the geometry stage", () => {
  const before = "综搜整体仍处于放缓背景，关键不在于单纯增加曝光，而在于识别商品需求，并用更匹配的供给承接；核心仍是让模型识别电商意图，再优化结果组织，把模糊兴趣转化为可验证需求。";
  const after = "综搜放缓，但电商搜索仍有较高大盘。关键是识别内容浏览中的潜在商品需求，并用匹配供给承接。供给可归纳为电商意图识别、优化结果组织，将模糊兴趣转为可验证需求。";
  const differences = sentenceAwareTextDifferences(before, after);
  const plan = readableReviewTextFootprintPlan(before, after, differences);

  assert.equal(plan.operation, "replace");
  assert.equal(plan.before.anchorOffset, null);
  assert.equal(plan.after.anchorOffset, null);
  assert.ok(plan.before.phraseGroups.length > 0);
  assert.ok(plan.after.phraseGroups.length > 0);
  assert.deepEqual(plan.before.phraseGroups.flat(), plan.before.evidenceRanges);
  assert.deepEqual(plan.after.phraseGroups.flat(), plan.after.evidenceRanges);
  assert.equal("scope" in plan, false);
  assert.equal("density" in plan, false);
});

test("one-sided evidence uses the same phrase plan in both directions", () => {
  const before = "稳定前句。稳定后句。";
  const after = "稳定前句。完整新增句。稳定后句。";
  const differences = sentenceAwareTextDifferences(before, after);
  const inserted = readableReviewTextFootprintPlan(before, after, differences);
  const deleted = readableReviewTextFootprintPlan(after, before, {
    before: differences.after,
    after: differences.before,
  });

  assert.equal(inserted.operation, "insert");
  assert.equal(deleted.operation, "delete");
  assert.deepEqual(deleted.before.phraseGroups, inserted.after.phraseGroups);
  assert.deepEqual(deleted.after.phraseGroups, inserted.before.phraseGroups);
});

test("stable outer sentences stay outside exact evidence without deciding geometry", () => {
  const before = "稳定前句。旧方案覆盖多个指标、多个渠道、多个阶段，并给出较长说明。稳定后句。";
  const after = "稳定前句。新方案改写全部口径、执行路径、验证方式，并补充另一组较长说明。稳定后句。";
  const differences = sentenceAwareTextDifferences(before, after);
  const plan = readableReviewTextFootprintPlan(before, after, differences);

  assert.equal("scope" in plan, false);
  assert.ok(changedText(before, plan.before.evidenceRanges).every((value) => (
    !value.includes("稳定前句") && !value.includes("稳定后句")
  )));
  assert.ok(changedText(after, plan.after.evidenceRanges).every((value) => (
    !value.includes("稳定前句") && !value.includes("稳定后句")
  )));
});

test("stable sentence offsets stay exact when a changed sentence has unchanged suffix text", () => {
  const source = "稳定前句。旧方案覆盖多个指标、多个渠道、多个阶段，并给出较长说明。稳定后句。";

  assert.deepEqual(reviewSentenceRanges(source), [
    { start: 0, end: 5 },
    { start: 5, end: 33 },
    { start: 33, end: 38 },
  ]);
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
  assert.equal(plan.before.phraseGroups.length, 2);
  assert.equal(plan.after.phraseGroups.length, 2);
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

  assert.equal(compact.before.phraseGroups.length, 1);
  assert.equal(separated.before.phraseGroups.length, 2);
});

test("merging four sentences into one keeps the surviving numbers unmarked", () => {
  const before = "内容平台搜索挤压传统电商的趋势不变，但大盘增量呈现增速放缓态势，26Q2 日均搜索请求 96.2 亿次，YoY +18%；较 26 年 1&2 月双月大盘增速 +20% 回落 2pp；增速放缓的同时结构变化加剧：抖系份额收缩、微信与小红书接棒增长；大盘增长动能加速向内容平台迁移。";
  const after = "大盘增量增速放缓（96.2 亿次/日，YoY +18%，较 1&2 月 +20% 回落 2pp），但结构变化加剧：抖系份额收缩，微信、小红书接棒增长。";
  const result = compare(before, after);
  const beforeMarked = result.before.join("");
  const afterMarked = result.after.join("");

  for (const survivor of ["96.2", "YoY", "+18%", "回落", "2pp", "结构变化加剧", "抖系份额收缩", "接棒增长"]) {
    assert.ok(
      !beforeMarked.includes(survivor),
      `${survivor} is still on the page and must not be struck through`,
    );
    assert.ok(
      !afterMarked.includes(survivor),
      `${survivor} was already on the page and must not be announced as new`,
    );
  }
  assert.ok(
    beforeMarked.includes("内容平台搜索挤压传统电商的趋势不变"),
    "text that really disappeared must stay marked",
  );
  const visible = (value) => [...value.replace(/\s/gu, "")].length;
  assert.ok(
    visible(afterMarked) < visible(after) * 0.25,
    `a mostly-reused rewrite must not mark ${visible(afterMarked)}/${visible(after)} characters as new`,
  );
});

test("survivor reconciliation only ever shrinks the marked set", () => {
  const cases = [
    ["甲乙丙丁。", "甲乙丙丁戊。"],
    ["第一句。第二句。第三句。", "第一句和第二句与第三句合并。"],
    ["单句改写前的完整说法。", "单句改写后的另一种完整说法。"],
    ["列表项一；列表项二；列表项三。", "列表项三；列表项一；列表项二。"],
    ["价格 12 元", "价格 18 元"],
  ];
  for (const [before, after] of cases) {
    const reconciled = sentenceAwareTextDifferences(before, after);
    const raw = reconcileReviewTextSurvivors(
      before,
      [{ start: 0, end: before.length }],
      after,
      [{ start: 0, end: after.length }],
    );
    const covered = (source, ranges) => ranges.reduce(
      (total, range) => total + [...source.slice(range.start, range.end).replace(/\s/gu, "")].length,
      0,
    );
    assert.ok(
      covered(before, reconciled.before) <= [...before.replace(/\s/gu, "")].length,
      `${before} → ${after}: marks cannot exceed the text`,
    );
    assert.ok(
      covered(after, raw.after) <= [...after.replace(/\s/gu, "")].length,
      `${before} → ${after}: reconciliation cannot invent marks`,
    );
  }
});

test("a pure reorder stays reported instead of reconciling itself away", () => {
  const before = "甲项目说明，乙项目说明。";
  const after = "乙项目说明，甲项目说明。";
  const reconciled = reconcileReviewTextSurvivors(
    before,
    [{ start: 0, end: before.length }],
    after,
    [{ start: 0, end: after.length }],
  );
  assert.ok(
    reconciled.before.length || reconciled.after.length,
    "emptying both sides would hide a real change",
  );
});

test("a punctuation-only residual never earns its own mark", () => {
  const dropped = reconcileReviewTextSurvivors(
    "甲乙丙、丁戊己",
    [{ start: 0, end: 7 }],
    "甲乙丙，丁戊己，庚辛",
    [{ start: 0, end: 10 }],
  );
  assert.deepEqual(dropped.before, [], "an enumeration comma swap is below the threshold");
  assert.deepEqual(
    dropped.after.map((range) => "甲乙丙，丁戊己，庚辛".slice(range.start, range.end)),
    ["，庚辛"],
    "the inserted words keep the punctuation they arrived with, as one range",
  );

  const punctuationOnly = reconcileReviewTextSurvivors(
    "甲乙丙、丁戊己",
    [{ start: 0, end: 7 }],
    "甲乙丙，丁戊己",
    [{ start: 0, end: 7 }],
  );
  assert.ok(
    punctuationOnly.before.length && punctuationOnly.after.length,
    "when punctuation is the only change it must still be reported",
  );
});
