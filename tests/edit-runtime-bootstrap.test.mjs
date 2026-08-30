import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditRuntimeBootstrap,
} from "../desktop/edit-runtime-bootstrap.mjs";

test("disposable runtime bootstrap proves source nodes without freezing author work", () => {
  const source = createEditRuntimeBootstrap({
    executionId: "a".repeat(24),
    sessionId: "b".repeat(32),
  });

  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /claimedIds/u);
  assert.match(source, /Object\.defineProperty\(element/u);
  assert.match(source, /MutationObserver/u);
  assert.match(source, /markerAttribute \+ "\],\[" \+ config\.sourceNodeAttribute/u);
  assert.match(source, /data-pageroot-edit-runtime-source/u);
  assert.match(source, /data-html-ai-source-node-id/u);
  assert.match(source, /DOMContentLoaded/u);
  assert.match(source, /event\.preventDefault/u);
  assert.doesNotMatch(source, /setInterval|clearInterval|requestAnimationFrame/u);
  assert.doesNotMatch(source, /getAnimations|MessageChannel|runtimeQuietFrames/u);
  assert.doesNotMatch(source, /edit-runtime-frozen|edit-runtime-result/u);
  assert.doesNotMatch(source, /window\.fetch\s*=/u);
  assert.doesNotMatch(source, /window\.Worker\s*=/u);
  assert.doesNotMatch(source, /mutationRecordLimit/u);
  assert.doesNotMatch(source, /eval\s*\(/u);
});
