import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CI_HEALTH_BUDGETS,
  CI_HEALTH_WORKFLOW_INPUTS,
  budgetViolations,
  extractRestList,
  fullGateRunIds,
  jobTimingStats,
  renderCiHealthMarkdown,
  sameShaWashGreenCount,
  shouldCreateCiHealthIssue,
  summarizeCiHealth,
  workflowRuns,
} from "../scripts/ci-health-report.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function job({ name, attempt, conclusion }) {
  return {
    name,
    run_attempt: attempt,
    conclusion,
  };
}

function completedRun(run) {
  return {
    status: "completed",
    conclusion: "success",
    path: ".github/workflows/ci.yml",
    ...run,
  };
}

test("CI health summarizes conclusions and retry-recovered jobs", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-08-15T12:00:00.000Z",
    ciRuns: [
      completedRun({ id: 100, conclusion: "success" }),
      completedRun({ id: 101, conclusion: "failure" }),
    ],
    jobsByRunId: {
      100: [
        job({ name: "source-node", attempt: 2, conclusion: "success" }),
      ],
      101: [
        job({ name: "electron-native", attempt: 1, conclusion: "failure" }),
      ],
    },
  });
  assert.equal(report.totals.runs, 2);
  assert.equal(report.totals.success, 1);
  assert.equal(report.totals.failure, 1);
  assert.equal(report.failureRate, 0.5);
  assert.equal(report.flakyRecoveredJobs, 1);
  assert.equal(report.sameShaWashGreen, 0);
  assert.deepEqual(report.failedJobs, ["electron-native"]);
  assert.match(renderCiHealthMarkdown(report), /electron-native/u);
});

test("workflowRuns matches the CI workflow path", () => {
  const runs = workflowRuns([
    { path: ".github/workflows/ci.yml", id: 1 },
    { path: ".github/workflows/release.yml", id: 2 },
  ], ".github/workflows/ci.yml");
  assert.deepEqual(runs.map((run) => run.id), [1]);
});

test("CI health inputs cover the remaining workflows and no retired review files", async () => {
  const reportScript = await readFile(
    path.join(productRoot, "scripts/ci-health-report.mjs"),
    "utf8",
  );
  assert.deepEqual(CI_HEALTH_WORKFLOW_INPUTS, {
    ci: "ci.yml",
    ciHealth: "ci-health.yml",
    releaseDryRun: "release-dry-run.yml",
    releaseCandidate: "release-candidate.yml",
    release: "release.yml",
    developerPreview: "developer-preview.yml",
  });
  assert.match(reportScript, /CI_HEALTH_WORKFLOW_INPUTS\.ci/u);
  assert.doesNotMatch(reportScript, /pr-feedback|draft-review|review-debt|review-gate-recovery/u);
});

test("REST list payloads unwrap the GitHub object envelope", () => {
  assert.deepEqual(
    extractRestList({ total_count: 1, workflow_runs: [{ id: 7 }] }, "workflow_runs", "u"),
    [{ id: 7 }],
  );
  assert.deepEqual(extractRestList([{ id: 3 }], "jobs", "u"), [{ id: 3 }]);
  assert.throws(
    () => extractRestList({ message: "rate limited" }, "jobs", "u"),
    /jobs array/u,
  );
});

test("queue and execution time split per job while skipped jobs stay out", () => {
  const stats = jobTimingStats({
    100: [
      {
        name: "browser-shard-2-of-3",
        conclusion: "success",
        created_at: "2026-08-18T00:00:00Z",
        started_at: "2026-08-18T00:01:00Z",
        completed_at: "2026-08-18T00:05:00Z",
      },
      {
        name: "electron-native",
        conclusion: "skipped",
        created_at: "2026-08-18T00:00:00Z",
        started_at: "2026-08-18T00:00:00Z",
        completed_at: "2026-08-18T00:00:00Z",
      },
    ],
  });
  assert.equal(stats["browser-shard"].executions, 1);
  assert.equal(stats["browser-shard"].queue.p50Minutes, 1);
  assert.equal(stats["browser-shard"].execution.p50Minutes, 4);
  assert.equal(stats["electron-native"], undefined);
});

test("full-gate wall time splits from Draft feedback by an executed release-gate", () => {
  const gateJob = {
    name: "release-gate",
    conclusion: "success",
    created_at: "2026-08-18T00:08:00Z",
    started_at: "2026-08-18T00:08:30Z",
    completed_at: "2026-08-18T00:09:00Z",
  };
  const draftJob = {
    name: "pr-feedback",
    conclusion: "failure",
    created_at: "2026-08-18T00:00:00Z",
    started_at: "2026-08-18T00:00:30Z",
    completed_at: "2026-08-18T00:01:00Z",
  };
  const jobsByRunId = { 100: [gateJob], 101: [draftJob] };
  assert.deepEqual([...fullGateRunIds(jobsByRunId)], ["100"]);
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-08-18T12:00:00.000Z",
    ciRuns: [
      completedRun({
        id: 100,
        run_started_at: "2026-08-18T00:00:00Z",
        updated_at: "2026-08-18T00:10:00Z",
      }),
      completedRun({
        id: 101,
        conclusion: "failure",
        html_url: "https://example.test/run/101",
        run_started_at: "2026-08-18T00:00:00Z",
        updated_at: "2026-08-18T00:01:00Z",
      }),
    ],
    jobsByRunId,
  });
  assert.equal(report.fullGate.runs, 1);
  assert.equal(report.fullGate.p50Minutes, 10);
  assert.equal(report.draft.runs, 1);
  assert.equal(report.draft.p50Minutes, 1);
  assert.deepEqual(report.failureCauses, [{
    runId: 101,
    url: "https://example.test/run/101",
    failedJobs: ["pr-feedback"],
  }]);
  const markdown = renderCiHealthMarkdown(report);
  assert.match(markdown, /Full-gate runs: 1 runs/u);
  assert.match(markdown, /release-gate/u);
  assert.match(markdown, /https:\/\/example\.test\/run\/101/u);
});

test("the scheduled ci-health workflow may open issues and is not a merge gate", async () => {
  const workflow = await readFile(
    path.join(productRoot, ".github/workflows/ci-health.yml"),
    "utf8",
  );
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /cron: "0 1 \* \* 1"/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /actions: read/u);
  assert.match(workflow, /contents: read/u);
  assert.doesNotMatch(workflow, /secrets\.|contents: write|pull-requests: write/u);
  assert.match(workflow, /timeout-minutes: 15/u);
  assert.match(workflow, /issues: write/u);
  assert.match(workflow, /ci-health-report\.mjs/u);
  assert.match(workflow, /GITHUB_STEP_SUMMARY/u);
});

test("same SHA success after a failed attempt counts as washed green", () => {
  assert.equal(sameShaWashGreenCount([
    completedRun({ id: 1, head_sha: "a".repeat(40), run_attempt: 2, conclusion: "success" }),
  ]), 1);
  assert.equal(sameShaWashGreenCount([
    completedRun({ id: 1, head_sha: "a".repeat(40), conclusion: "success" }),
    completedRun({ id: 2, head_sha: "a".repeat(40), conclusion: "failure" }),
  ]), 1);
  assert.equal(sameShaWashGreenCount([
    completedRun({ id: 1, head_sha: "a".repeat(40), conclusion: "success" }),
  ]), 0);
});

test("blocking CI health budgets persist two weeks before opening an issue", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-09-05T00:00:00.000Z",
    ciRuns: [
      completedRun({
        id: 7,
        head_sha: "b".repeat(40),
        run_attempt: 2,
        conclusion: "success",
      }),
    ],
    flakyRecords: [{ product: { failed: 0, flaky: 1, retries: 1 } }],
  });
  assert.equal(report.sameShaWashGreen, 1);
  assert.equal(report.blockingProductRetries, 2);
  const violations = budgetViolations(report);
  assert.equal(violations.some((item) => item.code === "same-sha-wash-green" && item.blocking), true);
  assert.equal(shouldCreateCiHealthIssue(violations, []), false);
  assert.equal(shouldCreateCiHealthIssue(violations, violations), true);
  assert.equal(CI_HEALTH_BUDGETS.sameShaUntriagedWashGreen, 0);
  assert.match(renderCiHealthMarkdown(report), /Same SHA washed green: 1/u);
});
