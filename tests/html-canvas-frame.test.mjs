import assert from "node:assert/strict";
import test from "node:test";

import { EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION } from "../app/domain/edit-runtime-contract.js";
import {
  frameDocumentMatchesExpected,
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
