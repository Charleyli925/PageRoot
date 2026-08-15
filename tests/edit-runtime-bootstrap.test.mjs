import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditRuntimeBootstrap,
} from "../desktop/edit-runtime-bootstrap.mjs";

test("one-shot bootstrap freezes author async work and performs one final source audit", () => {
  const source = createEditRuntimeBootstrap({
    executionId: "a".repeat(24),
    sessionId: "b".repeat(32),
  });

  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /captureBaseline\(\)/u);
  assert.match(source, /installTracking\(\)/u);
  assert.match(source, /prepareHiddenHostGeometry\(\)/u);
  assert.match(source, /restoreHiddenHostGeometry\(\)/u);
  assert.match(source, /clearTrackedAsync\(\)/u);
  assert.match(source, /removeTrackedListeners\(\)/u);
  assert.match(source, /disconnectTrackedObservers\(\)/u);
  assert.match(source, /document\.getAnimations/u);
  assert.match(source, /closeTrackedPorts\(\)/u);
  assert.match(source, /MessageChannel/u);
  assert.match(source, /messagePortClose/u);
  assert.match(source, /document-replacement/u);
  assert.match(source, /runtime-node-outside-host/u);
  assert.match(source, /pointer-events/u);
  assert.match(source, /runtimeSettleMs/u);
  assert.match(source, /data-pageroot-edit-runtime-frozen/u);
  assert.match(source, /data-pageroot-edit-runtime-result/u);
  assert.doesNotMatch(source, /window\.fetch\s*=/u);
  assert.doesNotMatch(source, /window\.Worker\s*=/u);
  assert.doesNotMatch(source, /mutationRecordLimit/u);
  assert.doesNotMatch(source, /eval\s*\(/u);
});
