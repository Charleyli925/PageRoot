import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { playwrightRetries } from "../scripts/playwright-retry-policy.mjs";
import {
  classifyFailedJob,
  evaluateProductFlakyEvidence,
  evaluateShaFailureHistory,
  loadFlakyEvidence,
  parseTriageRecords,
  REQUIRED_PRODUCT_FLAKY_SUITES,
} from "../scripts/source-gate-attestation-guard.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEAD_SHA = "a".repeat(40);

function flakyRecord(suite, product = { failed: 0, flaky: 0, retries: 0 }) {
  return { suite, product, infra: { failed: 0, flaky: 0, retries: 0 } };
}

function requiredRecords() {
  return REQUIRED_PRODUCT_FLAKY_SUITES.map((suite) => flakyRecord(suite));
}

test("product contract Playwright configs never enable CI retries", async () => {
  const files = [
    "tests/e2e/browser/playwright.config.mjs",
    "tests/e2e/electron/playwright.config.mjs",
    "tests/e2e/electron/playwright.ai-closed-loop.config.mjs",
  ];
  for (const file of files) {
    const source = await readFile(path.join(productRoot, file), "utf8");
    assert.match(source, /playwrightRetries\(\)/u);
    assert.doesNotMatch(source, /process\.env\.CI \? 1/u);
  }
  const preflight = await readFile(
    path.join(productRoot, "tests/e2e/electron/playwright.ci-preflight.config.mjs"),
    "utf8",
  );
  assert.match(preflight, /playwrightRetries\(\{ infraSensitive: true \}\)/u);
  assert.equal(playwrightRetries(), 0);
});

test("product flaky evidence must cover every required suite with zero retries", () => {
  assert.equal(evaluateProductFlakyEvidence(requiredRecords()).ok, true);
  assert.equal(evaluateProductFlakyEvidence(requiredRecords().slice(1)).reason, "product_flaky_evidence_missing");
  const flaky = requiredRecords();
  flaky[0] = flakyRecord(flaky[0].suite, { failed: 0, flaky: 1, retries: 1 });
  const decision = evaluateProductFlakyEvidence(flaky);
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "product_contract_retry_or_flake");
  assert.equal(decision.product.flaky, 1);
});

test("infra-sensitive retries do not fail the product flaky gate", () => {
  const records = requiredRecords();
  records[0] = {
    ...records[0],
    infra: { failed: 0, flaky: 1, retries: 1 },
    retries: 1,
    flaky: 1,
  };
  assert.equal(evaluateProductFlakyEvidence(records).ok, true);
});

test("failed Electron suite steps are product and npm ci is environment", () => {
  assert.equal(classifyFailedJob({
    conclusion: "failure",
    steps: [{ name: "Run native Electron suite", conclusion: "failure" }],
  }), "product");
  assert.equal(classifyFailedJob({
    conclusion: "failure",
    steps: [{ name: "Install npm dependencies", conclusion: "failure" }],
  }), "ci_environment");
  assert.equal(classifyFailedJob({
    conclusion: "failure",
    steps: [{ name: "Upload diagnostics", conclusion: "failure" }],
  }), "untriaged");
});

test("the same SHA cannot attest after an untriaged product failure", () => {
  const blocked = evaluateShaFailureHistory({
    headSha: HEAD_SHA,
    currentRunId: 9,
    currentAttempt: 2,
    jobsByRunAttempt: {
      "9:1": [{
        conclusion: "failure",
        name: "electron-native-shard-1-of-3",
        steps: [{ name: "Run native Electron suite", conclusion: "failure" }],
      }],
      "9:2": [{ conclusion: "success", name: "electron-native-shard-1-of-3" }],
    },
  });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.reason, "untriaged_product_failure_same_sha");
  assert.equal(blocked.untriagedFailuresForSameSha, 1);
});

test("expired triage comments do not wash a product failure green", () => {
  const records = parseTriageRecords([{
    body: [
      "<!-- pageroot-ci-triage",
      "schemaVersion: 1",
      "classification: ci_environment",
      `sha: ${HEAD_SHA}`,
      "runId: 9",
      "attempt: 1",
      "expiresAt: 2026-01-01T00:00:00.000Z",
      "-->",
    ].join("\n"),
  }], { now: new Date("2026-09-05T00:00:00.000Z") });
  assert.equal(records.length, 0);
  const allowed = parseTriageRecords([{
    body: [
      "<!-- pageroot-ci-triage",
      "schemaVersion: 1",
      "classification: ci_environment",
      `sha: ${HEAD_SHA}`,
      "runId: 9",
      "attempt: 1",
      "expiresAt: 2026-09-12T00:00:00.000Z",
      "-->",
    ].join("\n"),
  }], { now: new Date("2026-09-05T00:00:00.000Z") });
  const decision = evaluateShaFailureHistory({
    headSha: HEAD_SHA,
    currentRunId: 9,
    currentAttempt: 2,
    jobsByRunAttempt: {
      "9:1": [{
        conclusion: "failure",
        name: "electron-native-shard-1-of-3",
        steps: [{ name: "Run native Electron suite", conclusion: "failure" }],
      }],
    },
    triageRecords: allowed,
  });
  assert.equal(decision.ok, true);
});

test("environment-only failures on a previous attempt do not block attestation", () => {
  const decision = evaluateShaFailureHistory({
    headSha: HEAD_SHA,
    currentRunId: 11,
    currentAttempt: 2,
    jobsByRunAttempt: {
      "11:1": [{
        conclusion: "failure",
        name: "electron-native-shard-1-of-3",
        steps: [{ name: "Install npm dependencies", conclusion: "failure" }],
      }],
    },
  });
  assert.equal(decision.ok, true);
  assert.equal(decision.untriagedFailuresForSameSha, 0);
});

test("loadFlakyEvidence reads only repository flaky summaries", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-flaky-evidence-"));
  try {
    const evidenceDir = path.join(tempRoot, "output");
    await mkdir(evidenceDir, { recursive: true });
    await writeFile(
      path.join(evidenceDir, "electron-ai-flaky.json"),
      `${JSON.stringify(flakyRecord("electron-ai"), null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(evidenceDir, "notes.txt"), "ignore\n", "utf8");
    const records = await loadFlakyEvidence(evidenceDir);
    assert.equal(records.length, 1);
    assert.equal(records[0].suite, "electron-ai");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
