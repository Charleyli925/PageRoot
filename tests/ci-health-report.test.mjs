import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { summarizeCiHealth } from "../scripts/ci-health-report.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function job({
  name,
  attempt,
  conclusion,
  startedAt,
  completedAt,
  steps = [],
}) {
  return {
    name,
    run_attempt: attempt,
    conclusion,
    started_at: startedAt,
    completed_at: completedAt,
    steps,
  };
}

test("CI health distinguishes full-gate latency, repeated green work and preflight failures", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-07-24T12:00:00.000Z",
    ciRuns: [{
      id: 100,
      event: "pull_request",
      head_sha: "a".repeat(40),
      pull_requests: [{ number: 25 }],
      created_at: "2026-07-24T10:00:00.000Z",
      updated_at: "2026-07-24T10:08:00.000Z",
    }],
    feedbackRuns: [],
    jobsByRunId: {
      100: [
        job({
          name: "source-node",
          attempt: 1,
          conclusion: "success",
          startedAt: "2026-07-24T10:00:00.000Z",
          completedAt: "2026-07-24T10:02:00.000Z",
        }),
        job({
          name: "electron-native",
          attempt: 1,
          conclusion: "failure",
          startedAt: "2026-07-24T10:00:00.000Z",
          completedAt: "2026-07-24T10:03:00.000Z",
          steps: [{
            name: "Prove hosted renderer scheduling before product tests",
            conclusion: "failure",
          }],
        }),
        job({
          name: "release-gate",
          attempt: 1,
          conclusion: "failure",
          startedAt: "2026-07-24T10:03:00.000Z",
          completedAt: "2026-07-24T10:03:10.000Z",
        }),
        job({
          name: "source-node",
          attempt: 2,
          conclusion: "success",
          startedAt: "2026-07-24T10:04:00.000Z",
          completedAt: "2026-07-24T10:06:00.000Z",
        }),
        job({
          name: "electron-native",
          attempt: 2,
          conclusion: "success",
          startedAt: "2026-07-24T10:04:00.000Z",
          completedAt: "2026-07-24T10:07:00.000Z",
          steps: [{
            name: "Prove hosted renderer scheduling before product tests",
            conclusion: "success",
          }],
        }),
        job({
          name: "release-gate",
          attempt: 2,
          conclusion: "success",
          startedAt: "2026-07-24T10:07:00.000Z",
          completedAt: "2026-07-24T10:07:10.000Z",
        }),
      ],
    },
    candidateRuns: [{ conclusion: "success" }, { conclusion: "failure" }],
    releaseRuns: [{ conclusion: "success" }],
  });

  assert.equal(report.sourceGate.completeRuns, 1);
  assert.equal(report.sourceGate.runsPerPullRequestAverage, 1);
  assert.equal(report.sourceGate.repeatedCandidateRuns, 0);
  assert.equal(report.sourceGate.attemptsPerTreeAverage, 2);
  assert.equal(report.sourceGate.wallMinutesP50, 8);
  assert.equal(report.sourceGate.wallMinutesP95, 8);
  assert.equal(report.runnerUse.repeatedGreenMinutes, 2);
  assert.equal(report.runnerUse.candidateChurnMinutes, 0);
  assert.equal(report.environmentPreflight.completed, 2);
  assert.equal(report.environmentPreflight.failed, 1);
  assert.equal(report.environmentPreflight.failureRate, 0.5);
  assert.deepEqual(report.releaseCandidate.conclusions, { success: 1, failure: 1 });
  assert.deepEqual(report.publication.conclusions, { success: 1 });
  assert.equal(report.publication.rebuildsAfterCandidateApproval, 0);
});

test("CI health exposes complete-gate churn across different SHAs of one Pull Request", () => {
  const ciRuns = [
    {
      id: 201,
      event: "pull_request",
      head_sha: "a".repeat(40),
      pull_requests: [{ number: 80 }],
      created_at: "2026-07-24T09:00:00.000Z",
      updated_at: "2026-07-24T09:10:00.000Z",
    },
    {
      id: 202,
      event: "pull_request",
      head_sha: "b".repeat(40),
      pull_requests: [{ number: 80 }],
      created_at: "2026-07-24T10:00:00.000Z",
      updated_at: "2026-07-24T10:08:00.000Z",
    },
    {
      id: 203,
      event: "pull_request",
      head_sha: "c".repeat(40),
      pull_requests: [{ number: 81 }],
      created_at: "2026-07-24T11:00:00.000Z",
      updated_at: "2026-07-24T11:07:00.000Z",
    },
  ];
  const feedbackRuns = [{
    id: 204,
    event: "pull_request",
    head_sha: "d".repeat(40),
    pull_requests: [{ number: 80 }],
    created_at: "2026-07-24T12:00:00.000Z",
    updated_at: "2026-07-24T12:02:00.000Z",
  }];
  const jobsByRunId = {
    201: [job({
      name: "release-gate",
      attempt: 1,
      conclusion: "success",
      startedAt: "2026-07-24T09:00:00.000Z",
      completedAt: "2026-07-24T09:10:00.000Z",
    })],
    202: [job({
      name: "release-gate",
      attempt: 1,
      conclusion: "success",
      startedAt: "2026-07-24T10:00:00.000Z",
      completedAt: "2026-07-24T10:08:00.000Z",
    })],
    203: [job({
      name: "release-gate",
      attempt: 1,
      conclusion: "success",
      startedAt: "2026-07-24T11:00:00.000Z",
      completedAt: "2026-07-24T11:07:00.000Z",
    })],
    204: [job({
      name: "pr-feedback",
      attempt: 1,
      conclusion: "success",
      startedAt: "2026-07-24T12:00:00.000Z",
      completedAt: "2026-07-24T12:02:00.000Z",
    })],
  };

  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-07-24T12:30:00.000Z",
    ciRuns,
    feedbackRuns,
    jobsByRunId,
    candidateRuns: [],
    releaseRuns: [],
  });

  assert.equal(report.schemaVersion, 2);
  assert.equal(report.sourceGate.pullRequestRuns, 4);
  assert.equal(report.sourceGate.feedbackRuns, 1);
  assert.equal(report.sourceGate.completeRuns, 3);
  assert.equal(report.sourceGate.candidatePullRequests, 2);
  assert.equal(report.sourceGate.runsPerPullRequestAverage, 1.5);
  assert.equal(report.sourceGate.runsPerPullRequestP50, 1);
  assert.equal(report.sourceGate.repeatedCandidateRuns, 1);
  assert.equal(report.runnerUse.totalMinutes, 27);
  assert.equal(report.runnerUse.feedbackMinutes, 2);
  assert.equal(report.runnerUse.fullGateMinutes, 25);
  assert.equal(report.runnerUse.candidateChurnMinutes, 8);
  assert.equal(report.runnerUse.candidateChurnShare, 0.3);
});

test("CI health keeps empty periods explicit instead of reporting false zero rates", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-07-24T12:00:00.000Z",
    ciRuns: [],
    feedbackRuns: [],
    jobsByRunId: {},
    candidateRuns: [],
    releaseRuns: [],
  });
  assert.equal(report.sourceGate.attemptsPerTreeAverage, null);
  assert.equal(report.sourceGate.wallMinutesP50, null);
  assert.equal(report.runnerUse.repeatedGreenShare, null);
  assert.equal(report.environmentPreflight.failureRate, null);
});

test("CI health workflow stays read-only and retains a machine-readable report", async () => {
  const [workflow, reportScript] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/ci-health.yml"), "utf8"),
    readFile(path.join(productRoot, "scripts/ci-health-report.mjs"), "utf8"),
  ]);
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /actions: read/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /ci-health-report\.mjs/u);
  assert.match(workflow, /retention-days: 90/u);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|issues: write/u);
  assert.match(reportScript, /workflow: "ci\.yml"/u);
  assert.match(reportScript, /workflow: "pr-feedback\.yml"/u);
});
