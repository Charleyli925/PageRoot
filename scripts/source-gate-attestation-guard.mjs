import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { INFRA_SENSITIVE_TAG, isInfraSensitiveTest } from "./playwright-retry-policy.mjs";

export const REQUIRED_PRODUCT_FLAKY_SUITES = Object.freeze([
  "browser-shard-1-of-3",
  "browser-shard-2-of-3",
  "browser-shard-3-of-3",
  "electron-native-shard-1-of-3",
  "electron-native-shard-2-of-3",
  "electron-native-shard-3-of-3",
  "electron-ai",
]);

export const PRODUCT_SOURCE_STEP_NAMES = Object.freeze(new Set([
  "Run full Node suite",
  "Run static checks and build the shared web renderer",
  "Run native Electron suite",
  "Run deterministic AI closed-loop suite",
  "Run shard-1-of-3",
  "Run shard-2-of-3",
  "Run shard-3-of-3",
  "Run real-html",
]));

const ENVIRONMENT_STEP_PATTERN = /(?:npm ci|Install npm|Playwright|preflight|Restore Electron|hosted renderer|system dependencies|Install Playwright)/iu;
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const TRIAGE_COMMENT_PATTERN = /<!--\s*pageroot-ci-triage\b([\s\S]*?)-->/u;

export function classifyFlakyTest(test, spec = {}) {
  const title = `${spec.title || ""} ${test?.title || ""}`.trim();
  const tags = [
    ...(Array.isArray(test?.tags) ? test.tags : []),
    ...(Array.isArray(spec?.tags) ? spec.tags : []),
  ];
  return isInfraSensitiveTest({ title, tags });
}

export function evaluateProductFlakyEvidence(records, { requiredSuites = REQUIRED_PRODUCT_FLAKY_SUITES } = {}) {
  const bySuite = new Map((records || []).map((record) => [record.suite, record]));
  const missing = requiredSuites.filter((suite) => !bySuite.has(suite));
  if (missing.length > 0) {
    return Object.freeze({
      ok: false,
      reason: "product_flaky_evidence_missing",
      missing,
      product: Object.freeze({ failed: 0, flaky: 0, retries: 0 }),
    });
  }
  let failed = 0;
  let flaky = 0;
  let retries = 0;
  for (const suite of requiredSuites) {
    const record = bySuite.get(suite);
    failed += Number(record?.product?.failed) || 0;
    flaky += Number(record?.product?.flaky) || 0;
    retries += Number(record?.product?.retries) || 0;
  }
  if (failed > 0 || flaky > 0 || retries > 0) {
    return Object.freeze({
      ok: false,
      reason: "product_contract_retry_or_flake",
      missing: [],
      product: Object.freeze({ failed, flaky, retries }),
    });
  }
  return Object.freeze({
    ok: true,
    reason: "product_contract_clean",
    missing: [],
    product: Object.freeze({ failed: 0, flaky: 0, retries: 0 }),
  });
}

export function isProductSourceStep(stepName) {
  return PRODUCT_SOURCE_STEP_NAMES.has(String(stepName || ""));
}

export function isEnvironmentStep(stepName) {
  return ENVIRONMENT_STEP_PATTERN.test(String(stepName || ""));
}

export function classifyFailedJob(job) {
  if (!job || job.conclusion !== "failure") return null;
  const failedSteps = (job.steps || []).filter((step) => step?.conclusion === "failure");
  if (failedSteps.some((step) => isProductSourceStep(step.name))) return "product";
  if (failedSteps.length > 0 && failedSteps.every((step) => isEnvironmentStep(step.name))) {
    return "ci_environment";
  }
  return "untriaged";
}

export function parseTriageRecords(comments, { now = new Date() } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const records = [];
  for (const comment of comments || []) {
    const match = TRIAGE_COMMENT_PATTERN.exec(String(comment?.body || ""));
    if (!match) continue;
    const fields = Object.fromEntries(
      match[1]
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          const separator = line.indexOf(":");
          if (separator <= 0) return null;
          return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()];
        })
        .filter(Boolean),
    );
    if (fields.schemaVersion !== "1") continue;
    if (fields.classification !== "ci_environment") continue;
    if (!SHA_PATTERN.test(fields.sha || "")) continue;
    const runId = Number(fields.runId);
    const attempt = Number(fields.attempt);
    const expiresAt = Date.parse(fields.expiresAt || "");
    if (!Number.isInteger(runId) || runId <= 0) continue;
    if (!Number.isInteger(attempt) || attempt <= 0) continue;
    if (!Number.isFinite(expiresAt) || expiresAt <= nowMs) continue;
    records.push(Object.freeze({
      sha: fields.sha,
      runId,
      attempt,
      classification: "ci_environment",
      expiresAt: new Date(expiresAt).toISOString(),
    }));
  }
  return Object.freeze(records);
}

function triageCoversFailure(records, { sha, runId, attempt }) {
  return (records || []).some((record) => (
    record.sha === sha
    && record.runId === Number(runId)
    && record.attempt === Number(attempt)
    && record.classification === "ci_environment"
  ));
}

export function evaluateShaFailureHistory({
  headSha,
  currentRunId,
  currentAttempt,
  jobsByRunAttempt = {},
  triageRecords = [],
} = {}) {
  if (!SHA_PATTERN.test(headSha || "")) {
    throw new Error("headSha must be a 40-character Git SHA.");
  }
  const runId = Number(currentRunId);
  const attempt = Number(currentAttempt);
  if (!Number.isInteger(runId) || runId <= 0) {
    throw new Error("currentRunId must be a positive integer.");
  }
  if (!Number.isInteger(attempt) || attempt <= 0) {
    throw new Error("currentAttempt must be a positive integer.");
  }
  const untriaged = [];
  for (const [key, jobs] of Object.entries(jobsByRunAttempt)) {
    const [historyRunId, historyAttempt] = key.split(":").map(Number);
    if (historyRunId === runId && historyAttempt === attempt) continue;
    if (!Number.isInteger(historyRunId) || !Number.isInteger(historyAttempt)) continue;
    for (const job of jobs || []) {
      const classification = classifyFailedJob(job);
      if (!classification) continue;
      if (classification === "ci_environment") continue;
      if (triageCoversFailure(triageRecords, {
        sha: headSha,
        runId: historyRunId,
        attempt: historyAttempt,
      })) continue;
      untriaged.push(Object.freeze({
        runId: historyRunId,
        attempt: historyAttempt,
        job: String(job.name || "unknown"),
        classification,
      }));
    }
  }
  if (untriaged.length > 0) {
    return Object.freeze({
      ok: false,
      reason: "untriaged_product_failure_same_sha",
      untriagedFailuresForSameSha: untriaged.length,
      failures: Object.freeze(untriaged),
    });
  }
  return Object.freeze({
    ok: true,
    reason: "same_sha_clean_or_triaged",
    untriagedFailuresForSameSha: 0,
    failures: Object.freeze([]),
  });
}

export async function loadFlakyEvidence(evidenceDir) {
  const entries = await readdir(evidenceDir, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith("-flaky.json")) continue;
    const payload = JSON.parse(await readFile(path.join(evidenceDir, entry.name), "utf8"));
    records.push(payload);
  }
  return records;
}

export { INFRA_SENSITIVE_TAG };
