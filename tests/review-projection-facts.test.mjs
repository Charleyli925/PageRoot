import assert from "node:assert/strict";
import test from "node:test";

import {
  appendReviewProjectionFact,
  appendTrustedReviewProjectionFact,
  parseReviewProjectionFacts,
  ReviewProjectionFactOverflowError,
  REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT,
  reviewProjectionFactKey,
  reviewProjectionFactsCanMerge,
  reviewProjectionFactsForFilter,
  serializeReviewProjectionFacts,
} from "../app/lib/review-projection-facts.js";

const boxStyle = {
  id: "style-owner-1",
  type: "style",
  semanticOwnerId: "semantic-owner-4",
  geometryOwnerId: "geometry-owner-2",
  ownerKey: "style-owner-1",
  scope: "box",
  summary: "视觉调整",
};

const layoutStyle = {
  id: "layout-owner-2",
  type: "style",
  semanticOwnerId: "semantic-owner-4",
  geometryOwnerId: "geometry-owner-2",
  ownerKey: "layout-owner-2",
  scope: "content",
  operation: "layout",
  summary: "换行调整",
};

test("one element can preserve a box-style fact and a layout fact", () => {
  const facts = appendReviewProjectionFact(
    appendReviewProjectionFact([], boxStyle),
    layoutStyle,
  );

  assert.deepEqual(facts, [boxStyle, layoutStyle]);
  assert.deepEqual(parseReviewProjectionFacts(serializeReviewProjectionFacts(facts)), facts);
  assert.deepEqual(reviewProjectionFactsForFilter(facts, "style"), facts);
  assert.deepEqual(reviewProjectionFactsForFilter(facts, "text"), []);
});

test("only the same fact and owners may merge", () => {
  const geometrySibling = {
    ...boxStyle,
    geometryOwnerId: "geometry-owner-3",
  };
  assert.equal(reviewProjectionFactsCanMerge(boxStyle, { ...boxStyle }), true);
  assert.equal(reviewProjectionFactsCanMerge(boxStyle, layoutStyle), false);
  assert.equal(reviewProjectionFactsCanMerge(boxStyle, geometrySibling), false);
  assert.notEqual(reviewProjectionFactKey(boxStyle), reviewProjectionFactKey(layoutStyle));
  assert.notEqual(reviewProjectionFactKey(boxStyle), reviewProjectionFactKey(geometrySibling));
  assert.deepEqual(
    appendReviewProjectionFact([boxStyle], geometrySibling),
    [boxStyle, geometrySibling],
  );
});

test("a repeated fact updates itself without deleting an independent companion fact", () => {
  const facts = appendReviewProjectionFact(
    [boxStyle, layoutStyle],
    { ...boxStyle, summary: "视觉调整（边框）" },
  );

  assert.deepEqual(facts, [
    { ...boxStyle, summary: "视觉调整（边框）" },
    layoutStyle,
  ]);
});

test("malformed serialized facts fail closed without creating a projection record", () => {
  assert.deepEqual(parseReviewProjectionFacts("{not-json"), []);
  assert.deepEqual(parseReviewProjectionFacts(JSON.stringify([{
    id: "unsafe value",
    type: "style",
    semanticOwnerId: "semantic-owner-4",
  }])), []);
});

test("trusted analysis fails explicitly instead of silently dropping a twenty-fifth fact", () => {
  const facts = Array.from({ length: REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT }, (_, index) => ({
    ...boxStyle,
    id: `style-owner-${index + 1}`,
    ownerKey: `style-owner-${index + 1}`,
  })).reduce((current, fact) => appendTrustedReviewProjectionFact(current, fact), []);
  const overflow = {
    ...boxStyle,
    id: "style-owner-overflow",
    ownerKey: "style-owner-overflow",
  };

  assert.equal(facts.length, REVIEW_PROJECTION_FACTS_PER_ELEMENT_LIMIT);
  assert.throws(
    () => appendTrustedReviewProjectionFact(facts, overflow),
    ReviewProjectionFactOverflowError,
  );
  assert.equal(appendReviewProjectionFact(facts, overflow).length, facts.length);
  assert.deepEqual(parseReviewProjectionFacts(JSON.stringify([...facts, overflow])), []);
});
