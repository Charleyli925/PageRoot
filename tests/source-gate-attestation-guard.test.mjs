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
  inspectFlakyRecord,
  loadFlakyEvidence,
  parseTriageRecords,
  REQUIRED_PRODUCT_FLAKY_SUITES,
} from "../scripts/source-gate-attestation-guard.mjs";
import { materializeSelectedEvidence } from "../scripts/select-source-gate-evidence.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HEAD_SHA = "a".repeat(40);

function flakyRecord(suite, {
  product = { failed: 0, flaky: 0, retries: 0 },
  infra = { failed: 0, flaky: 0, retries: 0 },
  passed = 3,
  skipped = 0,
} = {}) {
  const failed = product.failed + infra.failed;
  const flaky = product.flaky + infra.flaky;
  const retries = product.retries + infra.retries;
  return {
    schemaVersion: 2,
    suite,
    total: passed + failed + flaky + skipped,
    passed,
    failed,
    flaky,
    skipped,
    retries,
    product,
    infra,
  };
}

function requiredRecords() {
  return REQUIRED_PRODUCT_FLAKY_SUITES.map((suite) => flakyRecord(suite));
}

function trustedTriage({
  sha = HEAD_SHA,
  runId = 9,
  attempt = 1,
  job = "electron-native-shard-1-of-3",
  reason = "hosted runner disk exhausted",
  expiresAt = "2026-09-12T00:00:00.000Z",
  authorAssociation = "MEMBER",
} = {}) {
  return {
    author_association: authorAssociation,
    body: [
      "<!-- pageroot-ci-triage",
      "schemaVersion: 1",
      "classification: ci_environment",
      `sha: ${sha}`,
      `runId: ${runId}`,
      `attempt: ${attempt}`,
      `job: ${job}`,
      `reason: ${reason}`,
      `expiresAt: ${expiresAt}`,
      "-->",
    ].join("\n"),
  };
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
  flaky[0] = flakyRecord(flaky[0].suite, { product: { failed: 0, flaky: 1, retries: 1 }, passed: 2 });
  const decision = evaluateProductFlakyEvidence(flaky);
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "product_contract_retry_or_flake");
  assert.equal(decision.product.flaky, 1);
});

test("suite names without product statistics are not treated as a clean run", () => {
  const namedOnly = REQUIRED_PRODUCT_FLAKY_SUITES.map((suite) => ({ suite }));
  const decision = evaluateProductFlakyEvidence(namedOnly);
  assert.equal(decision.ok, false);
  assert.equal(decision.reason, "product_flaky_evidence_invalid");
  assert.equal(inspectFlakyRecord({ suite: "electron-ai" }).ok, false);
});

test("all-skipped suites and unreconciled counts cannot attest", () => {
  const skipped = requiredRecords();
  skipped[0] = flakyRecord(skipped[0].suite, { passed: 0, skipped: 4 });
  assert.equal(evaluateProductFlakyEvidence(skipped).reason, "product_flaky_evidence_all_skipped");
  const empty = requiredRecords();
  empty[0] = { ...flakyRecord(empty[0].suite), total: 0, passed: 0 };
  assert.equal(evaluateProductFlakyEvidence(empty).reason, "product_flaky_evidence_empty");
});

test("infra-sensitive retries do not fail the product flaky gate", () => {
  const records = requiredRecords();
  records[0] = flakyRecord(records[0].suite, {
    passed: 2,
    infra: { failed: 0, flaky: 1, retries: 1 },
  });
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
  assert.equal(classifyFailedJob({
    conclusion: "failure",
    name: "release-gate",
    steps: [{ name: "Create exact-tree source gate attestation", conclusion: "failure" }],
  }), "aggregate");
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

test("untrusted or job-wide triage comments cannot wash product failures green", () => {
  const now = new Date("2026-09-05T00:00:00.000Z");
  assert.equal(parseTriageRecords([trustedTriage({ authorAssociation: "NONE" })], { now }).length, 0);
  assert.equal(parseTriageRecords([{
    author_association: "MEMBER",
    body: trustedTriage().body.replace("job: electron-native-shard-1-of-3\n", ""),
  }], { now }).length, 0);
  const otherJob = parseTriageRecords([trustedTriage({
    job: "electron-native-shard-2-of-3",
  })], { now });
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
    triageRecords: otherJob,
  });
  assert.equal(decision.ok, false);
});

test("expired triage comments do not wash a product failure green", () => {
  const records = parseTriageRecords([
    trustedTriage({ expiresAt: "2026-01-01T00:00:00.000Z" }),
  ], { now: new Date("2026-09-05T00:00:00.000Z") });
  assert.equal(records.length, 0);
  const allowed = parseTriageRecords([trustedTriage()], {
    now: new Date("2026-09-05T00:00:00.000Z"),
  });
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

test("a failed release-gate after an environment recovery does not lock attestation", () => {
  const decision = evaluateShaFailureHistory({
    headSha: HEAD_SHA,
    currentRunId: 12,
    currentAttempt: 2,
    jobsByRunAttempt: {
      "12:1": [{
        conclusion: "failure",
        name: "release-gate",
        steps: [{ name: "Create exact-tree source gate attestation", conclusion: "failure" }],
      }, {
        conclusion: "failure",
        name: "electron-native-shard-1-of-3",
        steps: [{ name: "Install npm dependencies", conclusion: "failure" }],
      }],
    },
  });
  assert.equal(decision.ok, true);
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

test("flaky evidence round-trips upload layout and reuses an earlier successful attempt", async () => {
  const attemptsDir = path.join(productRoot, "output/ci-evidence-roundtrip-attempts");
  const evidenceDir = path.join(productRoot, "output/ci-evidence-roundtrip");
  await rm(attemptsDir, { recursive: true, force: true });
  await rm(evidenceDir, { recursive: true, force: true });
  try {
    for (const suite of REQUIRED_PRODUCT_FLAKY_SUITES) {
      const attempt = suite === "electron-ai" ? 1 : 2;
      const directory = path.join(
        attemptsDir,
        `PageRoot-${suite}-evidence-44-${attempt}`,
      );
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, `${suite}-flaky.json`),
        `${JSON.stringify(flakyRecord(suite), null, 2)}\n`,
        "utf8",
      );
    }
    const result = await materializeSelectedEvidence({
      from: "output/ci-evidence-roundtrip-attempts",
      to: "output/ci-evidence-roundtrip",
      runAttempt: 2,
    });
    assert.equal(result.ok, true);
    const reused = result.selected.find((item) => item.suite === "electron-ai");
    assert.equal(reused.attempt, 1);
    assert.equal(reused.reused, true);
    const loaded = await loadFlakyEvidence(evidenceDir);
    assert.equal(evaluateProductFlakyEvidence(loaded).ok, true);
    const manifest = JSON.parse(
      await readFile(path.join(evidenceDir, "source-gate-evidence-sources.json"), "utf8"),
    );
    assert.equal(manifest.sources.find((item) => item.suite === "electron-ai").reused, true);
  } finally {
    await rm(attemptsDir, { recursive: true, force: true });
    await rm(evidenceDir, { recursive: true, force: true });
  }
});

test("release-gate downloads evidence into the directory the attestation script reads", async () => {
  const workflow = await readFile(path.join(productRoot, ".github/workflows/ci.yml"), "utf8");
  assert.match(workflow, /path: output\/ci-evidence-attempts/u);
  assert.match(workflow, /select-source-gate-evidence\.mjs/u);
  assert.match(workflow, /--evidence-dir output\/ci-evidence/u);
  assert.doesNotMatch(
    workflow,
    /Download product flaky evidence[\s\S]*?path: \./u,
  );
});
