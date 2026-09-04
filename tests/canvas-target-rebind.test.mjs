import assert from "node:assert/strict";
import test from "node:test";

import {
  rebindCanvasSelectionTargets,
  rebindCanvasSelectionTargetsAcrossHistory,
} from "../app/lib/canvas-target-rebind.js";
import {
  buildSourceIndex,
  createTargetRef,
} from "../app/lib/source-patch-core.js";

function selectionFor(source, targetId) {
  const index = buildSourceIndex(source);
  const element = index.elements.find((candidate) => candidate.tagName === "div");
  assert.ok(element);
  const target = createTargetRef(index, element, {
    targetId,
    label: "测试段落",
    level: "subregion",
  });
  return {
    id: target.targetId,
    label: target.label,
    selector: target.selector,
    level: "part",
    tagName: target.fingerprint.tagName,
    text: target.textQuote,
    textQuote: target.textQuote,
    sourceAnchor: target.sourceAnchor,
    fingerprint: target.fingerprint,
    resolution: target.resolution,
  };
}

function stableSelectionFor(source, elementId, targetId) {
  const index = buildSourceIndex(source);
  const element = index.byPagerootId.get(elementId);
  assert.ok(element);
  const target = createTargetRef(index, element, {
    targetId,
    label: "稳定评论目标",
    level: "subregion",
  });
  return {
    id: target.targetId,
    elementId: target.elementId,
    expectedSourceSha256: target.expectedSourceSha256,
    label: target.label,
    selector: target.selector,
    level: "part",
    tagName: target.fingerprint.tagName,
    text: target.textQuote,
    textQuote: target.textQuote,
    sourceAnchor: target.sourceAnchor,
    fingerprint: target.fingerprint,
    resolution: target.resolution,
  };
}

test("current comments stay exact by stable element ID and never bind a replacement", () => {
  const elementId = "pr1_11111111111141118111111111111111";
  const rootId = "pr1_22222222222242229222222222222222";
  const siblingId = "pr1_3333333333334333a333333333333333";
  const replacementId = "pr1_4444444444444444b444444444444444";
  const before = `<main data-pageroot-id="${rootId}"><div data-pageroot-id="${elementId}">原文</div><aside data-pageroot-id="${siblingId}">相邻</aside></main>`;
  const comment = {
    ...stableSelectionFor(before, elementId, "target_comment_stable"),
    textLocator: {
      quote: "原文",
      startOffset: 0,
      endOffset: 2,
      affinity: "forward",
    },
  };
  const after = `<main data-pageroot-id="${rootId}"><aside data-pageroot-id="${siblingId}">相邻</aside><div data-pageroot-id="${elementId}">改字后</div></main>`;
  const [rebound] = rebindCanvasSelectionTargets(after, [comment]);
  assert.equal(rebound.id, "target_comment_stable");
  assert.equal(rebound.elementId, elementId);
  assert.equal(rebound.resolution, "exact");
  assert.equal(rebound.textQuote, "改字后");
  assert.equal(rebound.expectedSourceSha256, buildSourceIndex(after).sourceSha256);
  assert.equal(rebound.sourceAnchor.sourceSha256, rebound.expectedSourceSha256);
  assert.deepEqual(rebound.textLocator, comment.textLocator);

  const replaced = `<main data-pageroot-id="${rootId}"><div data-pageroot-id="${replacementId}">原文</div><aside data-pageroot-id="${siblingId}">相邻</aside></main>`;
  const [orphaned] = rebindCanvasSelectionTargets(replaced, [comment]);
  assert.equal(orphaned.resolution, "orphaned");
  assert.equal(orphaned.elementId, elementId);
});

test("history target transitions keep an independently identified comment on the edited element", () => {
  const elementId = "pr1_11111111111141118111111111111111";
  const before = `<!doctype html><html><body><div data-pageroot-id="${elementId}">撤回前文字</div></body></html>`;
  const after = `<!doctype html><html><body><div data-pageroot-id="${elementId}">撤回后文字</div></body></html>`;
  const beforeOperationTarget = stableSelectionFor(before, elementId, "target_operation");
  const afterOperationTarget = stableSelectionFor(after, elementId, "target_operation");
  const commentTarget = {
    ...stableSelectionFor(after, elementId, "target_comment"),
    selector: "",
  };

  assert.equal(
    rebindCanvasSelectionTargets(before, [commentTarget])[0].resolution,
    "exact",
  );

  const [rebound] = rebindCanvasSelectionTargetsAcrossHistory(
    after,
    before,
    [commentTarget],
    {
      fromTarget: afterOperationTarget,
      toTarget: beforeOperationTarget,
    },
  );
  assert.equal(rebound.id, "target_comment");
  assert.equal(rebound.resolution, "exact");
  assert.equal(rebound.textQuote, "撤回前文字");
  assert.equal(
    rebound.sourceAnchor.sourceSha256,
    beforeOperationTarget.sourceAnchor.sourceSha256,
  );
});
