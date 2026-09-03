import assert from "node:assert/strict";
import test from "node:test";

import { EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION } from "../app/domain/edit-runtime-contract.js";
import {
  clampRuntimeScroll,
  frameDocumentMatchesExpected,
  runtimeAnchorScrollTop,
  runtimePositionWithinTolerance,
  RUNTIME_HANDOFF_TOLERANCE_PX,
  sameRuntimeGrant,
} from "../app/components/html-canvas-frame.js";

function grant(overrides = {}) {
  return {
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    sessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    executionId: "bbbbbbbbbbbbbbbbbbbbbbbb",
    sourceSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    resourceSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    documentBasePath: "/",
    scriptCount: 1,
    byteLength: 32,
    canvasGeneration: 1,
    programIdentity: "program-a",
    ...overrides,
  };
}

test("sameRuntimeGrant compares resource and program identity", () => {
  const left = grant();
  assert.equal(sameRuntimeGrant(left, grant()), true);
  assert.equal(sameRuntimeGrant(left, grant({ executionId: "ffffffffffffffffffffffff" })), false);
  assert.equal(sameRuntimeGrant(left, grant({ documentBasePath: "/assets/" })), false);
  assert.equal(sameRuntimeGrant(left, grant({ programIdentity: "program-b" })), false);
  assert.equal(sameRuntimeGrant(null, left), false);
});

test("frameDocumentMatchesExpected accepts either srcdoc or the written html", () => {
  const iframe = { srcdoc: "<html></html>" };
  assert.equal(frameDocumentMatchesExpected(iframe, "<html></html>", null), true);
  assert.equal(frameDocumentMatchesExpected({ srcdoc: "" }, "<html></html>", "<html></html>"), true);
  assert.equal(frameDocumentMatchesExpected({ srcdoc: "" }, "<html></html>", null), false);
});

test("runtime handoff clamps shortened documents instead of falling back to the top", () => {
  assert.equal(clampRuntimeScroll(840, 320), 320);
  assert.equal(clampRuntimeScroll(-20, 320), 0);
  assert.equal(runtimeAnchorScrollTop({
    currentScrollTop: 0,
    currentAnchorOffsetY: 620,
    desiredAnchorOffsetY: 180,
    maximumScrollTop: 900,
  }), 440);
  assert.equal(runtimeAnchorScrollTop({
    currentScrollTop: 0,
    currentAnchorOffsetY: 620,
    desiredAnchorOffsetY: 180,
    maximumScrollTop: 240,
  }), 240);
});

test("runtime handoff uses the eight-pixel presentation-anchor contract", () => {
  assert.equal(RUNTIME_HANDOFF_TOLERANCE_PX, 8);
  assert.equal(runtimePositionWithinTolerance(480, 472.1), true);
  assert.equal(runtimePositionWithinTolerance(480, 471.9), false);
});
