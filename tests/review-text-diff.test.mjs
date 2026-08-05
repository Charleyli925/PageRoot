import assert from "node:assert/strict";
import test from "node:test";

import { sentenceAwareTextDifferences } from "../app/lib/review-text-diff.js";

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
