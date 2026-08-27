import assert from "node:assert/strict";
import test from "node:test";

import { EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION } from "../app/domain/edit-runtime-contract.js";
import {
  frameDocumentMatchesExpected,
  hostHasAuthorPaint,
  isRuntimeFrameFrozenResult,
  runtimeFrameKeepsAuthorPaint,
  sameRuntimeGrant,
} from "../app/components/html-canvas-frame.ts";

function grant(overrides = {}) {
  return {
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    sessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    executionId: "bbbbbbbbbbbbbbbbbbbbbbbb",
    sourceSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    resourceSha256: "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
    scriptCount: 1,
    byteLength: 32,
    canvasGeneration: 1,
    hosts: [{ key: "chart", path: [0], tagName: "div", identityAttributes: [] }],
    ...overrides,
  };
}

function frame(overrides = {}) {
  return {
    verificationToken: "edit-runtime-frame-eeeeeeeeeeeeeeeeeeeeeeee",
    grant: grant(),
    elementGeneration: 1,
    settled: true,
    ...overrides,
  };
}

test("sameRuntimeGrant compares session, execution, source and canvas generation", () => {
  const left = grant();
  assert.equal(sameRuntimeGrant(left, grant()), true);
  assert.equal(sameRuntimeGrant(left, grant({ executionId: "ffffffffffffffffffffffff" })), false);
  assert.equal(sameRuntimeGrant(null, left), false);
});

test("frameDocumentMatchesExpected accepts either srcdoc or the written html", () => {
  const iframe = { srcdoc: "<html></html>" };
  assert.equal(frameDocumentMatchesExpected(iframe, "<html></html>", null), true);
  assert.equal(frameDocumentMatchesExpected({ srcdoc: "" }, "<html></html>", "<html></html>"), true);
  assert.equal(frameDocumentMatchesExpected({ srcdoc: "" }, "<html></html>", null), false);
});

test("isRuntimeFrameFrozenResult requires a complete unique host-key set", () => {
  const runtime = frame();
  assert.equal(isRuntimeFrameFrozenResult({
    state: "frozen",
    reason: null,
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    executionId: runtime.grant.executionId,
    sessionId: runtime.grant.sessionId,
    hostKeys: ["chart"],
  }, runtime), true);
  assert.equal(isRuntimeFrameFrozenResult({
    state: "frozen",
    reason: null,
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    executionId: runtime.grant.executionId,
    sessionId: runtime.grant.sessionId,
    hostKeys: ["chart", "chart"],
  }, runtime), false);
});

test("runtimeFrameKeepsAuthorPaint uses some, not every, host", () => {
  const painted = {
    nodeType: 1,
    tagName: "CANVAS",
    querySelector() { return null; },
  };
  const empty = {
    nodeType: 1,
    tagName: "DIV",
    querySelector() { return null; },
  };
  const documentNode = {
    querySelectorAll(selector) {
      return selector === "img[data-pageroot-edit-runtime-snapshot]" ? [] : [];
    },
    querySelector(selector) {
      if (selector.includes("chart")) return painted;
      if (selector.includes("empty")) return empty;
      return null;
    },
  };
  const runtime = frame({
    grant: grant({
      hosts: [
        { key: "chart", path: [0], tagName: "div", identityAttributes: [] },
        { key: "empty", path: [1], tagName: "div", identityAttributes: [] },
      ],
    }),
  });
  assert.equal(hostHasAuthorPaint(painted), true);
  assert.equal(hostHasAuthorPaint(empty), false);
  assert.equal(runtimeFrameKeepsAuthorPaint(documentNode, runtime), true);
});

test("runtimeFrameKeepsAuthorPaint rejects PNG snapshot substitutes", () => {
  const documentNode = {
    querySelectorAll(selector) {
      return selector === "img[data-pageroot-edit-runtime-snapshot]" ? [{}] : [];
    },
    querySelector() {
      return {
        nodeType: 1,
        tagName: "CANVAS",
        querySelector() { return null; },
      };
    },
  };
  assert.equal(runtimeFrameKeepsAuthorPaint(documentNode, frame()), false);
});
