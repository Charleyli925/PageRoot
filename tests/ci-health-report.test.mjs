import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CI_HEALTH_WORKFLOW_INPUTS,
  renderCiHealthMarkdown,
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
    releaseDryRun: "release-dry-run.yml",
    releaseCandidate: "release-candidate.yml",
    release: "release.yml",
    developerPreview: "developer-preview.yml",
  });
  assert.match(reportScript, /CI_HEALTH_WORKFLOW_INPUTS\.ci/u);
  assert.doesNotMatch(reportScript, /pr-feedback|draft-review|review-debt|review-gate-recovery/u);
});
