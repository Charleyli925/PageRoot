import assert from "node:assert/strict";
import test from "node:test";

import {
  appendReviewProjectionFact,
  appendTrustedReviewProjectionFact,
  normalizeReviewProjectionFact,
  parseReviewProjectionFacts,
  ReviewProjectionFactOverflowError,
  REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT,
  reviewProjectionFactKey,
  reviewProjectionFactsCanMerge,
  reviewProjectionFactsForFilter,
  serializeReviewProjectionFacts,
} from "../app/lib/review-projection-facts.js";

const addedElement = {
  id: "element-added-1",
  type: "structure",
  semanticOwnerId: "semantic-owner-1",
  geometryOwnerId: "geometry-owner-1",
  scope: "element",
  operation: "insert",
  tone: "added",
  structureChange: "added",
  summary: "新增元素",
};

const removedText = {
  id: "text-removed-1",
  type: "text",
  semanticOwnerId: "semantic-owner-2",
  geometryOwnerId: "geometry-owner-2",
  scope: "text-phrase",
  operation: "delete",
  tone: "removed",
  textGroup: "text-group-1",
  summary: "删除内容",
};

test("projection keeps only text and added or removed element facts", () => {
  const facts = appendReviewProjectionFact(
    appendReviewProjectionFact([], addedElement),
    removedText,
  );

  assert.deepEqual(facts, [addedElement, removedText]);
  assert.deepEqual(parseReviewProjectionFacts(serializeReviewProjectionFacts(facts)), facts);
  assert.deepEqual(reviewProjectionFactsForFilter(facts, "structure"), [addedElement]);
  assert.deepEqual(reviewProjectionFactsForFilter(facts, "text"), [removedText]);
});

test("retired style, movement, and layout facts fail closed", () => {
  for (const fact of [
    { ...addedElement, type: "style", summary: "视觉调整" },
    { ...addedElement, structureChange: "moved", summary: "位置调整" },
    { ...removedText, operation: "layout", summary: "换行调整" },
  ]) {
    const normalized = normalizeReviewProjectionFact(fact);
    if (fact.type === "style") assert.equal(normalized, null);
    else {
      assert.ok(normalized);
      assert.equal(normalized.structureChange === "moved", false);
      assert.equal(normalized.operation === "layout", false);
    }
  }
});

test("only the same fact and owners may merge", () => {
  const geometrySibling = {
    ...addedElement,
    geometryOwnerId: "geometry-owner-3",
  };
  assert.equal(reviewProjectionFactsCanMerge(addedElement, { ...addedElement }), true);
  assert.equal(reviewProjectionFactsCanMerge(addedElement, removedText), false);
  assert.equal(reviewProjectionFactsCanMerge(addedElement, geometrySibling), false);
  assert.notEqual(reviewProjectionFactKey(addedElement), reviewProjectionFactKey(removedText));
  assert.notEqual(reviewProjectionFactKey(addedElement), reviewProjectionFactKey(geometrySibling));
});

test("a repeated fact updates itself without deleting an independent fact", () => {
  const facts = appendReviewProjectionFact(
    [addedElement, removedText],
    { ...addedElement, summary: "新增元素（卡片）" },
  );

  assert.deepEqual(facts, [
    { ...addedElement, summary: "新增元素（卡片）" },
    removedText,
  ]);
});

test("malformed serialized facts fail closed", () => {
  assert.deepEqual(parseReviewProjectionFacts("{not-json"), []);
  assert.deepEqual(parseReviewProjectionFacts(JSON.stringify([{
    id: "unsafe value",
    type: "structure",
    semanticOwnerId: "semantic-owner-4",
  }])), []);
});

test("trusted analysis fails explicitly instead of dropping a twenty-fifth fact", () => {
  const facts = Array.from({ length: REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT }, (_, index) => ({
    ...addedElement,
    id: `element-added-${index + 1}`,
  })).reduce((current, fact) => appendTrustedReviewProjectionFact(current, fact), []);
  const overflow = { ...addedElement, id: "element-added-overflow" };

  assert.equal(facts.length, REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT);
  assert.throws(
    () => appendTrustedReviewProjectionFact(facts, overflow),
    ReviewProjectionFactOverflowError,
  );
  assert.equal(appendReviewProjectionFact(facts, overflow).length, facts.length);
  assert.deepEqual(parseReviewProjectionFacts(JSON.stringify([...facts, overflow])), []);
});
