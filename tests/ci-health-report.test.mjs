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
      created_at: "2026-07-24T10:00:00.000Z",
      updated_at: "2026-07-24T10:08:00.000Z",
    }],
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
  assert.equal(report.sourceGate.attemptsPerTreeAverage, 2);
  assert.equal(report.sourceGate.wallMinutesP50, 8);
  assert.equal(report.sourceGate.wallMinutesP95, 8);
  assert.equal(report.runnerUse.repeatedGreenMinutes, 2);
  assert.equal(report.environmentPreflight.completed, 2);
  assert.equal(report.environmentPreflight.failed, 1);
  assert.equal(report.environmentPreflight.failureRate, 0.5);
  assert.deepEqual(report.releaseCandidate.conclusions, { success: 1, failure: 1 });
  assert.deepEqual(report.publication.conclusions, { success: 1 });
  assert.equal(report.publication.rebuildsAfterCandidateApproval, 0);
});

test("CI health keeps empty periods explicit instead of reporting false zero rates", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-07-24T12:00:00.000Z",
    ciRuns: [],
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
  const workflow = await readFile(
    path.join(productRoot, ".github/workflows/ci-health.yml"),
    "utf8",
  );
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /actions: read/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /ci-health-report\.mjs/u);
  assert.match(workflow, /retention-days: 90/u);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|issues: write/u);
});
