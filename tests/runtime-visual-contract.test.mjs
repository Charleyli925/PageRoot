import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_VISUAL_CONTRACT,
  RUNTIME_VISUAL_CONTRACT_VERSION,
  acceptedRuntimeVisualEnvelope,
} from "../app/domain/runtime-visual-contract.js";
import {
  RUNTIME_VISUAL_FIXTURE_SOURCE_SHA,
  RUNTIME_VISUAL_HOSTILE_PAGES,
} from "./fixtures/runtime-visual-hostile-pages.mjs";

test("runtime visual producers and consumers share one immutable contract", () => {
  assert.equal(RUNTIME_VISUAL_CONTRACT_VERSION, 1);
  assert.equal(RUNTIME_VISUAL_CONTRACT.candidateLimit, 128);
  assert.equal(RUNTIME_VISUAL_CONTRACT.identityAttributeLimit, 24);
  assert.equal(RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs, 1_500);
  assert.equal(RUNTIME_VISUAL_CONTRACT.pageBudget.atoms, 8_192);
  assert.equal(Object.isFrozen(RUNTIME_VISUAL_CONTRACT), true);
  assert.equal(Object.isFrozen(RUNTIME_VISUAL_CONTRACT.pageBudget), true);
});

test("runtime visual envelopes bind contract, session, and full source SHA", () => {
  const expected = {
    sessionId: "review-contract-session",
    sourceSha256: RUNTIME_VISUAL_FIXTURE_SOURCE_SHA.before,
  };
  assert.deepEqual(acceptedRuntimeVisualEnvelope({
    contractVersion: RUNTIME_VISUAL_CONTRACT_VERSION,
    ...expected,
  }, expected), {
    contractVersion: RUNTIME_VISUAL_CONTRACT_VERSION,
    ...expected,
  });
  assert.equal(acceptedRuntimeVisualEnvelope({
    contractVersion: RUNTIME_VISUAL_CONTRACT_VERSION,
    ...expected,
    sourceSha256: RUNTIME_VISUAL_FIXTURE_SOURCE_SHA.after,
  }, expected), null);
  assert.equal(acceptedRuntimeVisualEnvelope({
    contractVersion: 0,
    ...expected,
  }, expected), null);
  assert.equal(acceptedRuntimeVisualEnvelope({
    contractVersion: "1",
    ...expected,
  }, expected), null);
});

test("the hostile-page matrix closes all eight live legacy threads", () => {
  assert.equal(RUNTIME_VISUAL_HOSTILE_PAGES.length, 8);
  assert.equal(
    new Set(RUNTIME_VISUAL_HOSTILE_PAGES.map(({ threadId }) => threadId)).size,
    8,
  );
  for (const fixture of RUNTIME_VISUAL_HOSTILE_PAGES) {
    assert.match(fixture.id, /^pr(?:100|105|107)-/u);
    assert.match(fixture.html, /<!doctype html>/iu);
    assert.ok(fixture.contract.length > 20);
    assert.ok(fixture.closureReason.length > 20);
  }
});
