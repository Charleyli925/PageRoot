import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditRuntimeBootstrap,
} from "../desktop/edit-runtime-bootstrap.mjs";

test("Edit runtime bootstrap is a self-contained parser-first freezer with no ambient network escape", () => {
  const source = createEditRuntimeBootstrap({
    freezeKey: "f".repeat(32),
    executionId: "a".repeat(24),
    sessionId: "b".repeat(32),
  });

  assert.doesNotThrow(() => new Function(source));
  assert.match(source, /state\.baseline = baseline\(\);/u);
  assert.match(source, /installTracking\(\);/u);
  assert.match(source, /await twoFrames\(\);/u);
  assert.match(source, /clearTrackedAsync\(\);/u);
  assert.match(source, /observer\.disconnect\(\)/u);
  assert.match(source, /document\.getAnimations/);
  assert.match(source, /window\.fetch = deny\("fetch"\)/u);
  assert.match(source, /window\.Worker = function\(\)/u);
  assert.match(source, /window\.open = deny\("window\.open"\)/u);
  assert.match(source, /pointer-events", "none", "important"/u);
  assert.match(source, /data-pageroot-edit-runtime-frozen/u);
  assert.match(source, /data-pageroot-edit-runtime-result/u);
  assert.doesNotMatch(source, /eval\s*\(/u);
});
