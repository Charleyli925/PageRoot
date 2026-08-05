import assert from "node:assert/strict";
import test from "node:test";

import {
  REVIEW_SOURCE_NODE_ATTRIBUTE,
  prepareReviewCommentSourceProjection,
  resolveReviewCommentSourceElement,
} from "../app/lib/review-comment-source-map.js";
import {
  buildSourceIndex,
  createTargetRef,
} from "../app/lib/source-patch-core.js";

function selectionFor(targetRef) {
  return {
    id: targetRef.targetId,
    label: targetRef.label,
    level: targetRef.level,
    selector: targetRef.selector,
    textQuote: targetRef.textQuote,
    sourceAnchor: targetRef.sourceAnchor,
    fingerprint: targetRef.fingerprint,
    resolution: targetRef.resolution,
  };
}

test("review comment projection keeps repeated class targets source-distinct", () => {
  const source = `<main><article class="metric-card">锁单确收</article><article class="metric-card">IPV</article><article class="metric-card">CVR</article></main>`;
  const sourceIndex = buildSourceIndex(source);
  const cards = sourceIndex.elements.filter(
    (element) => element.tagName === "article",
  );
  const targets = cards.map((card, index) => createTargetRef(sourceIndex, card, {
    targetId: `metric-${index + 1}`,
    level: "subregion",
  }));

  assert.deepEqual(
    targets.map((target) => target.selector),
    ["article.metric-card", "article.metric-card", "article.metric-card"],
  );

  const projection = prepareReviewCommentSourceProjection(source);
  assert.equal(projection.projected, true);
  assert.equal(projection.sourceIndex?.sourceSha256, sourceIndex.sourceSha256);
  const resolved = targets.map((target) => resolveReviewCommentSourceElement(
    projection.sourceIndex,
    selectionFor(target),
  ));
  assert.equal(resolved.every(Boolean), true);
  assert.equal(new Set(resolved.map((element) => element.nodeId)).size, 3);
  resolved.forEach((element) => {
    assert.match(
      projection.html,
      new RegExp(`${REVIEW_SOURCE_NODE_ATTRIBUTE}="${element.nodeId}"`, "u"),
    );
  });
});

test("review comment projection falls back safely on reserved identity collisions", () => {
  const source = `<main ${REVIEW_SOURCE_NODE_ATTRIBUTE}="authored"><p id="unique-target">保留唯一目标</p></main>`;
  const sourceIndex = buildSourceIndex(source);
  const paragraph = sourceIndex.elements.find(
    (element) => element.tagName === "p",
  );
  const target = createTargetRef(sourceIndex, paragraph, {
    targetId: "unique-target",
    level: "subregion",
  });

  const projection = prepareReviewCommentSourceProjection(source);
  assert.equal(projection.projected, false);
  assert.equal(projection.html, source);
  assert.ok(projection.sourceIndex);
  const resolved = resolveReviewCommentSourceElement(
    projection.sourceIndex,
    selectionFor(target),
  );
  assert.equal(resolved?.nodeId, paragraph.nodeId);
  assert.equal(resolved?.selector, "#unique-target");
});

test("review comment source mapping fails closed for ambiguous and orphaned targets", () => {
  const repeated = `<main><section class="same">相同</section><section class="same">相同</section></main>`;
  const repeatedIndex = buildSourceIndex(repeated);
  const firstRepeated = repeatedIndex.elements.find(
    (element) => element.tagName === "section",
  );
  const repeatedTarget = createTargetRef(repeatedIndex, firstRepeated, {
    targetId: "repeated-target",
    level: "subregion",
  });
  const shiftedRepeatedIndex = buildSourceIndex(`<!-- shifted -->${repeated}`);
  assert.equal(
    resolveReviewCommentSourceElement(
      shiftedRepeatedIndex,
      selectionFor(repeatedTarget),
    ),
    null,
  );

  const unique = `<main><article id="removed-target">待移除</article></main>`;
  const uniqueIndex = buildSourceIndex(unique);
  const uniqueTarget = createTargetRef(
    uniqueIndex,
    uniqueIndex.elements.find((element) => element.tagName === "article"),
    { targetId: "removed-target", level: "subregion" },
  );
  assert.equal(
    resolveReviewCommentSourceElement(
      buildSourceIndex("<main></main>"),
      selectionFor(uniqueTarget),
    ),
    null,
  );
});
