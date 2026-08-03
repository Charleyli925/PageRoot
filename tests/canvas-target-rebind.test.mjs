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

test("history target transitions keep an independently identified comment on the edited element", () => {
  const before = "<!doctype html><html><body><div>撤回前文字</div></body></html>";
  const after = "<!doctype html><html><body><div>撤回后文字</div></body></html>";
  const beforeOperationTarget = selectionFor(before, "target_operation");
  const afterOperationTarget = selectionFor(after, "target_operation");
  const commentTarget = {
    ...selectionFor(after, "target_comment"),
    // The current exact source anchor proves the alias in `after`, while the
    // changed text intentionally makes a generic post-hoc rebind insufficient.
    selector: "",
  };

  assert.equal(
    rebindCanvasSelectionTargets(before, [commentTarget])[0].resolution,
    "orphaned",
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
