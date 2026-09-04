import assert from "node:assert/strict";
import test from "node:test";

import {
  prepareReviewCommentSourceProjection,
  resolveReviewCommentSourceElement,
} from "../app/lib/review-comment-source-map.js";
import {
  buildSourceIndex,
  createTargetRef,
} from "../app/lib/source-patch-core.js";
import { materializeSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";

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
    elementId: targetRef.elementId,
    expectedSourceSha256: targetRef.expectedSourceSha256,
  };
}

test("review comment projection keeps identified class targets source-distinct without rewriting HTML", () => {
  const identified = materializeSourceElementIdentity(
    `<main><article class="metric-card">锁单确收</article><article class="metric-card">IPV</article><article class="metric-card">CVR</article></main>`,
  ).html;
  const sourceIndex = buildSourceIndex(identified);
  const cards = sourceIndex.elements.filter(
    (element) => element.tagName === "article",
  );
  const targets = cards.map((card, index) => createTargetRef(sourceIndex, card, {
    targetId: `metric-${index + 1}`,
    level: "subregion",
  }));

  assert.equal(new Set(targets.map((target) => target.selector)).size, 3);
  targets.forEach((target, index) => {
    assert.equal(target.elementId, cards[index].pagerootId);
    assert.equal(
      target.selector,
      `article[data-pageroot-id="${cards[index].pagerootId}"]`,
    );
  });

  const projection = prepareReviewCommentSourceProjection(identified);
  assert.equal(projection.projected, true);
  assert.equal(projection.html, identified);
  assert.equal(projection.sourceIndex?.sourceSha256, sourceIndex.sourceSha256);
  const resolved = targets.map((target) => resolveReviewCommentSourceElement(
    projection.sourceIndex,
    selectionFor(target),
  ));
  assert.equal(resolved.every(Boolean), true);
  assert.equal(new Set(resolved.map((element) => element.pagerootId)).size, 3);
  resolved.forEach((element) => {
    assert.equal(element.pagerootIdentityStatus, "valid");
    assert.match(
      projection.html,
      new RegExp(`data-pageroot-id="${element.pagerootId}"`, "u"),
    );
  });
});

test("review comment projection leaves unidentified unique selectors byte-equal", () => {
  const source = `<main><p id="unique-target">保留唯一目标</p></main>`;
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
  assert.equal(resolved?.selector, "#unique-target");
  assert.equal(resolved?.pagerootId, paragraph.pagerootId);
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
