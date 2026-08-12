import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  RUNTIME_VISUAL_CONTRACT,
  RUNTIME_VISUAL_CONTRACT_VERSION,
  acceptedRuntimeVisualEnvelope,
} from "../app/domain/runtime-visual-contract.js";

const runtimeVisualContractDocument = await readFile(
  new URL("../docs/RUNTIME_VISUAL_CONTRACT.md", import.meta.url),
  "utf8",
);
const architectureContractDocument = await readFile(
  new URL("../docs/ARCHITECTURE_CONTRACT.md", import.meta.url),
  "utf8",
);

test("runtime snapshot producers and consumers share one immutable contract", () => {
  assert.equal(RUNTIME_VISUAL_CONTRACT_VERSION, 2);
  assert.equal(RUNTIME_VISUAL_CONTRACT.candidateLimit, 128);
  assert.equal(RUNTIME_VISUAL_CONTRACT.identityAttributeLimit, 24);
  assert.equal(RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs, 1_500);
  assert.equal(RUNTIME_VISUAL_CONTRACT.pageBudget.visualLimit, 32);
  assert.deepEqual(RUNTIME_VISUAL_CONTRACT.pageBudget.viewport, {
    minWidth: 320,
    minHeight: 320,
    maxWidth: 4_096,
    maxHeight: 2_400,
  });
  assert.equal(RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels, 4_194_304);
  assert.equal(RUNTIME_VISUAL_CONTRACT.pageBudget.pngBytes, 2_000_000);
  assert.equal(RUNTIME_VISUAL_CONTRACT.pageBudget.pngDimension, 4_096);
  assert.equal(RUNTIME_VISUAL_CONTRACT.pageBudget.aggregatePngBytes, 16_000_000);
  assert.equal(RUNTIME_VISUAL_CONTRACT.pageBudget.renderedTextBytes, 64 * 1024);
  assert.equal(Object.isFrozen(RUNTIME_VISUAL_CONTRACT), true);
  assert.equal(Object.isFrozen(RUNTIME_VISUAL_CONTRACT.pageBudget), true);
  assert.equal(Object.isFrozen(RUNTIME_VISUAL_CONTRACT.pageBudget.viewport), true);
});

test("runtime snapshot envelopes bind contract, session, and full source SHA", () => {
  const expected = {
    sessionId: "review-contract-session",
    sourceSha256: `sha256:${"a".repeat(64)}`,
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
    sourceSha256: `sha256:${"b".repeat(64)}`,
  }, expected), null);
  assert.equal(acceptedRuntimeVisualEnvelope({
    contractVersion: 0,
    ...expected,
  }, expected), null);
  assert.equal(acceptedRuntimeVisualEnvelope({
    contractVersion: 1,
    ...expected,
  }, expected), null, "the prior visual snapshot schema must not mix with version 2");
});

test("the published contract names the Review-only snapshot boundary", () => {
  assert.match(runtimeVisualContractDocument, /SourceHostResolver/u);
  assert.match(runtimeVisualContractDocument, /RuntimeSnapshotOwner/u);
  assert.match(runtimeVisualContractDocument, /Review-only/u);
  assert.match(runtimeVisualContractDocument, /one\s+bounded before\/after pair through the same owner/u);
  assert.match(runtimeVisualContractDocument, /no second fresh pair/u);
  assert.match(runtimeVisualContractDocument, /renderedTextSha256/u);
  assert.match(runtimeVisualContractDocument, /mean absolute\s+RGB-channel error/u);
  assert.doesNotMatch(runtimeVisualContractDocument, /EditRuntimeSnapshotSession|side \(`edit`/u);
  assert.doesNotMatch(runtimeVisualContractDocument, /settlement matrix|thirteen tracked threads/u);
  assert.match(architectureContractDocument, /Edit does\s+not invoke the resolver or owner/u);
  assert.doesNotMatch(
    architectureContractDocument,
    /Edit uses the\s+same owner and resolver/u,
  );
});
