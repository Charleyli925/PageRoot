import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  RUNTIME_VISUAL_CONTRACT,
  RUNTIME_VISUAL_CONTRACT_VERSION,
  acceptedRuntimeVisualEnvelope,
} from "../app/domain/runtime-visual-contract.js";
import {
  RUNTIME_VISUAL_FIXTURE_SOURCE_SHA,
  RUNTIME_VISUAL_HOSTILE_PAGES,
  RUNTIME_VISUAL_SETTLEMENT_SOURCE_SHA,
} from "./fixtures/runtime-visual-hostile-pages.mjs";

const runtimeVisualContractDocument = await readFile(
  new URL("../docs/RUNTIME_VISUAL_CONTRACT.md", import.meta.url),
  "utf8",
);
const productRoot = fileURLToPath(new URL("../", import.meta.url));

function gitOutput(arguments_) {
  return execFileSync("git", arguments_, {
    cwd: productRoot,
    encoding: "utf8",
  });
}

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

test("the settlement matrix points to a reachable implementation snapshot", () => {
  assert.match(RUNTIME_VISUAL_SETTLEMENT_SOURCE_SHA, /^[0-9a-f]{40}$/u);
  assert.doesNotThrow(() => {
    execFileSync("git", [
      "merge-base",
      "--is-ancestor",
      RUNTIME_VISUAL_SETTLEMENT_SOURCE_SHA,
      "HEAD",
    ], {
      cwd: productRoot,
      stdio: "ignore",
    });
  });
  const fixtureAtSettlement = gitOutput([
    "show",
    `${RUNTIME_VISUAL_SETTLEMENT_SOURCE_SHA}:tests/fixtures/runtime-visual-hostile-pages.mjs`,
  ]);
  const browserOracleAtSettlement = gitOutput([
    "show",
    `${RUNTIME_VISUAL_SETTLEMENT_SOURCE_SHA}:tests/e2e/browser/native-dom-runtime-visual-binding.spec.mjs`,
  ]);
  assert.match(fixtureAtSettlement, /querySelector\('\[class~="chart-host"\]'\)\.className/u);
  assert.match(browserOracleAtSettlement, /runtimeVisualHostilePage\("pr115-class-write-causality"\)/u);
});

test("the hostile-page settlement matrix closes all thirteen tracked threads", () => {
  assert.equal(RUNTIME_VISUAL_HOSTILE_PAGES.length, 13);
  assert.equal(
    new Set(RUNTIME_VISUAL_HOSTILE_PAGES.map(({ threadId }) => threadId)).size,
    13,
  );
  assert.equal(
    RUNTIME_VISUAL_HOSTILE_PAGES.filter(({ pr }) => pr === 115).length,
    5,
  );
  const classWriteFixture = RUNTIME_VISUAL_HOSTILE_PAGES.find(
    ({ id }) => id === "pr115-class-write-causality",
  );
  assert.ok(classWriteFixture?.changedHtml);
  assert.match(classWriteFixture.changedHtml, /querySelector\('\[class~="chart-host"\]'\)/u);
  assert.doesNotMatch(classWriteFixture.changedHtml, /querySelector\("div"\)/u);
  assert.ok(runtimeVisualContractDocument.includes(RUNTIME_VISUAL_SETTLEMENT_SOURCE_SHA));
  for (const fixture of RUNTIME_VISUAL_HOSTILE_PAGES) {
    assert.match(fixture.id, /^pr(?:100|105|107|115)-/u);
    assert.match(fixture.html, /<!doctype html>/iu);
    assert.ok(fixture.contract.length > 20);
    assert.ok(fixture.closureReason.length > 20);
    assert.match(fixture.threadUrl, new RegExp(`/pull/${fixture.pr}#discussion_`, "u"));
    assert.ok(runtimeVisualContractDocument.includes(fixture.id));
    assert.ok(runtimeVisualContractDocument.includes(fixture.threadId));
    assert.ok(runtimeVisualContractDocument.includes(fixture.threadUrl));
  }
});
