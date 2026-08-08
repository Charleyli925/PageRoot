import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CI_HEALTH_WORKFLOW_INPUTS,
  pullRequestMetrics,
  renderCiHealthMarkdown,
  summarizeCiHealth,
  summarizeCandidateFlow,
  workflowRuns,
} from "../scripts/ci-health-report.mjs";

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

function completedRun(run) {
  return {
    status: "completed",
    conclusion: "success",
    ...run,
  };
}

test("CI health distinguishes full-gate latency, repeated green work and preflight failures", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-07-24T12:00:00.000Z",
    ciRuns: [completedRun({
      id: 100,
      event: "pull_request",
      conclusion: "success",
      head_sha: "a".repeat(40),
      pull_requests: [{ number: 25 }],
      created_at: "2026-07-24T10:00:00.000Z",
      updated_at: "2026-07-24T10:08:00.000Z",
    })],
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
      900: [job({
        name: "publish-verified-candidate",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-07-24T11:00:00.000Z",
        completedAt: "2026-07-24T11:02:00.000Z",
        steps: [{
          name: "Verify downloaded provenance and every asset byte",
          conclusion: "success",
        }, {
          name: "Publish immutable GitHub Release",
          conclusion: "success",
        }],
      })],
    },
    candidateRuns: [{ conclusion: "success" }, { conclusion: "failure" }],
    releaseRuns: [{ id: 900, status: "completed", conclusion: "success" }],
    dependencyHealth: "success",
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
  assert.equal(report.workflowCancellation.pullRequestCancellationRate, 0);
  assert.equal(report.targetAssessment.metrics.dependencyHealth.status, "met");
  assert.equal(report.targetAssessment.overall, "missed");
  assert.match(renderCiHealthMarkdown(report), /Overall target status: \*\*❌ MISSED\*\*/u);
  assert.match(renderCiHealthMarkdown(report), /Total PR runner minutes/u);
});

test("CI health reports the final-candidate path, Ready churn, and review priority distribution", () => {
  const ciRuns = [completedRun({
    id: 700,
    event: "pull_request",
    head_sha: "a".repeat(40),
    pull_requests: [{ number: 120 }],
    created_at: "2026-08-09T10:05:00.000Z",
    updated_at: "2026-08-09T10:24:00.000Z",
  })];
  const pullRequests = [{
    number: 120,
    head: { sha: "a".repeat(40) },
    merged_at: "2026-08-09T10:35:00.000Z",
    timelineEvents: [
      { event: "ready_for_review", created_at: "2026-08-09T10:00:00.000Z" },
      { event: "ready_for_review", created_at: "2026-08-09T10:05:00.000Z" },
    ],
    reviews: [{
      state: "COMMENTED",
      user: { login: "chatgpt-codex-connector" },
      commit_id: "a".repeat(40),
      submitted_at: "2026-08-09T10:10:00.000Z",
      body: "![P1 Badge](x)\n\n**Reviewed commit:** `aaaaaaaaaa`",
    }, {
      state: "CHANGES_REQUESTED",
      user: { login: "maintainer" },
      submitted_at: "2026-08-09T10:11:00.000Z",
      body: "No priority attached to this deferred finding.",
    }],
    reviewComments: [
      { body: "![P0 Badge](x)" },
      { body: "![P2 Badge](x)" },
      { body: "![P3 Badge](x)" },
      { body: "No priority" },
    ],
  }];
  const jobsByRunId = {
    700: [job({
      name: "source-node",
      attempt: 1,
      conclusion: "success",
      startedAt: "2026-08-09T10:06:00.000Z",
      completedAt: "2026-08-09T10:17:00.000Z",
    }), job({
      name: "release-gate",
      attempt: 1,
      conclusion: "success",
      startedAt: "2026-08-09T10:23:00.000Z",
      completedAt: "2026-08-09T10:24:00.000Z",
    })],
  };
  const flow = summarizeCandidateFlow({ pullRequests, ciRuns, jobsByRunId });
  assert.equal(flow.readyTransitions, 2);
  assert.equal(flow.readyTransitionsPerPullRequestAverage, 2);
  assert.equal(flow.candidateToMergeMinutesP50, 30);
  assert.equal(flow.reviewMinutesP50, 5);
  assert.equal(flow.testMinutesP50, 12);
  assert.equal(flow.mergeWaitMinutesP50, 11);
  assert.deepEqual(flow.priorityCounts, { P0: 1, P1: 1, P2: 1, P3: 1, unclassified: 2 });

  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-08-09T11:00:00.000Z",
    ciRuns,
    jobsByRunId,
    candidateRuns: [],
    releaseRuns: [],
    pullRequests,
    dependencyHealth: "success",
  });
  assert.equal(report.candidateFlow.candidateToMergeMinutesP50, 30);
  assert.equal(report.targetAssessment.metrics.candidateToMergeMinutesP50.status, "met");
  assert.equal(report.targetAssessment.metrics.mergeWaitMinutesP50.status, "missed");
  assert.match(renderCiHealthMarkdown(report), /Candidate-to-merge P50/u);
  assert.match(renderCiHealthMarkdown(report), /Review findings P0\/P1\/P2\/P3/u);
});

test("CI health accepts only exact-final-head Codex review evidence", () => {
  const headSha = "b".repeat(40);
  const pullRequest = {
    number: 121,
    head: { sha: headSha },
    timelineEvents: [{ event: "ready_for_review", created_at: "2026-08-09T10:00:00.000Z" }],
    reviews: [{
      state: "APPROVED",
      user: { login: "maintainer" },
      commit_id: headSha,
      submitted_at: "2026-08-09T10:01:00.000Z",
      body: "Approved by a maintainer, but not Codex.",
    }, {
      state: "COMMENTED",
      user: { login: "chatgpt-codex-connector" },
      commit_id: "a".repeat(40),
      submitted_at: "2026-08-09T10:02:00.000Z",
      body: "**Reviewed commit:** `aaaaaaaaaa`",
    }],
  };
  assert.equal(
    summarizeCandidateFlow({ pullRequests: [pullRequest] }).reviewMinutesP50,
    null,
  );

  pullRequest.issueComments = [{
    user: { login: "chatgpt-codex-connector" },
    created_at: "2026-08-09T10:03:00.000Z",
    updated_at: "2026-08-09T10:03:00.000Z",
    body: "Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** `bbbbbbbbbb`",
  }];
  assert.equal(
    summarizeCandidateFlow({ pullRequests: [pullRequest] }).reviewMinutesP50,
    3,
  );
});

test("CI health binds gate and test completion to the final promoted SHA", () => {
  const oldSha = "a".repeat(40);
  const finalSha = "b".repeat(40);
  const ciRuns = [completedRun({
    id: 710,
    event: "pull_request",
    head_sha: oldSha,
    pull_requests: [{ number: 122 }],
    created_at: "2026-08-09T10:00:00.000Z",
    updated_at: "2026-08-09T10:16:00.000Z",
  }), completedRun({
    id: 711,
    event: "pull_request",
    head_sha: finalSha,
    pull_requests: [{ number: 122 }],
    created_at: "2026-08-09T10:20:00.000Z",
    updated_at: "2026-08-09T10:30:00.000Z",
  })];
  const flow = summarizeCandidateFlow({
    ciRuns,
    jobsByRunId: {
      710: [job({
        name: "source-node",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-09T10:01:00.000Z",
        completedAt: "2026-08-09T10:14:00.000Z",
      }), job({
        name: "release-gate",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-09T10:15:00.000Z",
        completedAt: "2026-08-09T10:16:00.000Z",
      })],
      711: [job({
        name: "source-node",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-09T10:21:00.000Z",
        completedAt: "2026-08-09T10:27:00.000Z",
      }), job({
        name: "release-gate",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-09T10:29:00.000Z",
        completedAt: "2026-08-09T10:30:00.000Z",
      })],
    },
    pullRequests: [{
      number: 122,
      head: { sha: finalSha },
      merged_at: "2026-08-09T10:35:00.000Z",
      timelineEvents: [
        { event: "ready_for_review", created_at: "2026-08-09T10:00:00.000Z" },
        { event: "ready_for_review", created_at: "2026-08-09T10:20:00.000Z" },
      ],
    }],
  });
  assert.equal(flow.testMinutesP50, 7);
  assert.equal(flow.mergeWaitMinutesP50, 5);
  assert.equal(flow.candidateToMergeMinutesP50, 15);
});

test("CI health excludes flow intervals outside its report window", () => {
  const flow = summarizeCandidateFlow({
    since: "2026-08-01T00:00:00.000Z",
    pullRequests: [{
      number: 123,
      merged_at: "2026-07-02T00:00:00.000Z",
      updated_at: "2026-08-09T00:00:00.000Z",
      timelineEvents: [{ event: "ready_for_review", created_at: "2026-07-01T00:00:00.000Z" }],
    }, {
      number: 124,
      merged_at: "2026-08-02T00:10:00.000Z",
      timelineEvents: [{ event: "ready_for_review", created_at: "2026-08-02T00:00:00.000Z" }],
    }],
  });
  assert.equal(flow.readyTransitions, 1);
  assert.equal(flow.candidateToMergeMinutesP50, 10);
  assert.deepEqual(flow.rows.map((row) => row.pullRequestNumber), [124]);
});

test("CI health separates active gate work from terminal gate metrics", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-08-08T12:05:00.000Z",
    ciRuns: [completedRun({
      id: 101,
      event: "pull_request",
      head_sha: "a".repeat(40),
      pull_requests: [{ number: 26 }],
      created_at: "2026-08-08T10:00:00.000Z",
      updated_at: "2026-08-08T10:08:00.000Z",
    }), {
      id: 102,
      event: "pull_request",
      status: "in_progress",
      conclusion: null,
      head_sha: "b".repeat(40),
      pull_requests: [{ number: 27 }],
      created_at: "2026-08-08T12:00:00.000Z",
      updated_at: "2026-08-08T12:01:00.000Z",
    }],
    jobsByRunId: {
      101: [job({
        name: "source-build",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:08:00.000Z",
      })],
      102: [job({
        name: "source-build",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-08T12:00:00.000Z",
        completedAt: "2026-08-08T12:01:00.000Z",
      })],
    },
    candidateRuns: [],
    releaseRuns: [],
    dependencyHealth: "success",
  });

  assert.equal(report.sourceGate.completeRuns, 1);
  assert.equal(report.sourceGate.activeRuns, 1);
  assert.equal(report.sourceGate.wallMinutesP50, 8);
  assert.equal(report.sourceGate.wallMinutesP95, 8);
  assert.equal(report.sourceGate.attemptsPerTreeAverage, 1);
  assert.equal(report.runnerUse.totalMinutes, 9);
  assert.equal(report.runnerUse.completedWorkflowMinutes, 8);
  assert.equal(report.runnerUse.activeWorkflowMinutes, 1);
  assert.equal(report.runnerUse.fullGateMinutes, 8);
  assert.equal(report.runnerUse.activeGateMinutes, 1);
  assert.equal(report.workflowCancellation.completedPullRequestRuns, 1);
  assert.equal(report.workflowCancellation.activePullRequestRuns, 1);
  assert.equal(report.workflowCancellation.pullRequestCancellationRate, 0);
  const markdown = renderCiHealthMarkdown(report);
  assert.match(markdown, /Active gates with completed source work \| 1/u);
  assert.match(markdown, /Active-workflow recorded runner minutes \| 1/u);
});

test("CI health exposes complete-gate churn across different SHAs of one Pull Request", () => {
  const ciRuns = [
    completedRun({
      id: 201,
      event: "pull_request",
      head_sha: "a".repeat(40),
      pull_requests: [{ number: 80 }],
      created_at: "2026-07-24T09:00:00.000Z",
      updated_at: "2026-07-24T09:10:00.000Z",
    }),
    completedRun({
      id: 202,
      event: "pull_request",
      head_sha: "b".repeat(40),
      pull_requests: [{ number: 80 }],
      created_at: "2026-07-24T10:00:00.000Z",
      updated_at: "2026-07-24T10:08:00.000Z",
    }),
    completedRun({
      id: 203,
      event: "pull_request",
      head_sha: "c".repeat(40),
      pull_requests: [{ number: 81 }],
      created_at: "2026-07-24T11:00:00.000Z",
      updated_at: "2026-07-24T11:07:00.000Z",
    }),
  ];
  const feedbackRuns = [completedRun({
    id: 204,
    event: "pull_request",
    head_sha: "d".repeat(40),
    pull_requests: [{ number: 80 }],
    created_at: "2026-07-24T12:00:00.000Z",
    updated_at: "2026-07-24T12:02:00.000Z",
  })];
  const jobsByRunId = {
    201: [job({
      name: "source-build",
      attempt: 1,
      conclusion: "success",
      startedAt: "2026-07-24T09:00:00.000Z",
      completedAt: "2026-07-24T09:10:00.000Z",
    })],
    202: [job({
      name: "source-build",
      attempt: 1,
      conclusion: "success",
      startedAt: "2026-07-24T10:00:00.000Z",
      completedAt: "2026-07-24T10:08:00.000Z",
    })],
    203: [job({
      name: "source-build",
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
    dependencyHealth: "success",
  });

  assert.equal(report.schemaVersion, 6);
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
  assert.equal(report.targetAssessment.metrics.runsPerPullRequestAverage.status, "missed");
});

test("CI health excludes same-SHA full-gate reruns from cross-SHA candidate churn", () => {
  const sameSha = "a".repeat(40);
  const laterSha = "b".repeat(40);
  const ciRuns = [completedRun({
    id: 205,
    event: "pull_request",
    head_sha: sameSha,
    pull_requests: [{ number: 82 }],
    created_at: "2026-07-24T09:00:00.000Z",
    updated_at: "2026-07-24T09:03:00.000Z",
  }), completedRun({
    id: 206,
    event: "pull_request",
    head_sha: sameSha,
    pull_requests: [{ number: 82 }],
    created_at: "2026-07-24T10:00:00.000Z",
    updated_at: "2026-07-24T10:04:00.000Z",
  }), completedRun({
    id: 207,
    event: "pull_request",
    head_sha: laterSha,
    pull_requests: [{ number: 82 }],
    created_at: "2026-07-24T11:00:00.000Z",
    updated_at: "2026-07-24T11:05:00.000Z",
  }), completedRun({
    id: 208,
    event: "pull_request",
    head_sha: laterSha,
    pull_requests: [{ number: 82 }],
    created_at: "2026-07-24T12:00:00.000Z",
    updated_at: "2026-07-24T12:06:00.000Z",
  })];
  const jobsByRunId = Object.fromEntries(ciRuns.map((run) => ([run.id, [job({
    name: "source-build",
    attempt: 1,
    conclusion: "success",
    startedAt: run.created_at,
    completedAt: run.updated_at,
  })]])));

  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-07-24T12:30:00.000Z",
    ciRuns,
    jobsByRunId,
    candidateRuns: [],
    releaseRuns: [],
    dependencyHealth: "success",
  });

  assert.equal(report.sourceGate.completeRuns, 4);
  assert.equal(report.sourceGate.repeatedCandidateRuns, 1);
  assert.equal(report.runnerUse.fullGateMinutes, 18);
  assert.equal(report.runnerUse.candidateChurnMinutes, 5);
  assert.equal(report.runnerUse.candidateChurnShare, 0.28);
});

test("CI health counts a return to an earlier SHA as new candidate churn", () => {
  const firstSha = "a".repeat(40);
  const secondSha = "b".repeat(40);
  const shas = [firstSha, firstSha, secondSha, secondSha, firstSha, firstSha];
  const ciRuns = shas.map((headSha, index) => completedRun({
    id: 209 + index,
    event: "pull_request",
    head_sha: headSha,
    pull_requests: [{ number: 83 }],
    created_at: `2026-07-24T${String(9 + index).padStart(2, "0")}:00:00.000Z`,
    updated_at: `2026-07-24T${String(9 + index).padStart(2, "0")}:01:00.000Z`,
  }));
  const jobsByRunId = Object.fromEntries(ciRuns.map((run) => ([run.id, [job({
    name: "source-build",
    attempt: 1,
    conclusion: "success",
    startedAt: run.created_at,
    completedAt: run.updated_at,
  })]])));

  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-07-24T15:30:00.000Z",
    ciRuns,
    jobsByRunId,
    candidateRuns: [],
    releaseRuns: [],
    dependencyHealth: "success",
  });

  assert.equal(report.sourceGate.completeRuns, 6);
  assert.equal(report.sourceGate.repeatedCandidateRuns, 2);
  assert.equal(report.runnerUse.fullGateMinutes, 6);
  assert.equal(report.runnerUse.candidateChurnMinutes, 2);
  assert.equal(report.runnerUse.candidateChurnShare, 0.33);
});

test("CI health records cancellation rates without treating pre-review jobs as full gates", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-08-08T12:00:00.000Z",
    ciRuns: [completedRun({
      id: 301,
      event: "pull_request",
      conclusion: "cancelled",
      head_sha: "a".repeat(40),
      pull_requests: [{ number: 90 }],
    }), completedRun({
      id: 302,
      event: "pull_request",
      conclusion: "failure",
      head_sha: "b".repeat(40),
      pull_requests: [{ number: 91 }],
    })],
    feedbackRuns: [completedRun({
      id: 303,
      event: "pull_request",
      conclusion: "cancelled",
      pull_requests: [{ number: 90 }],
    }), completedRun({
      id: 304,
      event: "pull_request",
      conclusion: "success",
      pull_requests: [{ number: 91 }],
    })],
    jobsByRunId: {
      302: [job({
        name: "review-policy",
        attempt: 1,
        conclusion: "failure",
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:01:00.000Z",
      })],
      304: [job({
        name: "pr-feedback",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-08T10:02:00.000Z",
        completedAt: "2026-08-08T10:03:00.000Z",
      })],
    },
    candidateRuns: [],
    releaseRuns: [],
    dependencyHealth: "success",
  });

  assert.equal(report.sourceGate.completeRuns, 0);
  assert.equal(report.workflowCancellation.cancelledPullRequestRuns, 2);
  assert.equal(report.workflowCancellation.pullRequestCancellationRate, 0.5);
  assert.equal(report.workflowCancellation.cancelledPromotedCandidateRuns, 1);
  assert.equal(report.workflowCancellation.promotedCandidateCancellationRate, 0.5);
});

test("CI health includes automatic Release Dry Run minutes and cancellations in PR totals", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-08-08T12:00:00.000Z",
    ciRuns: [],
    feedbackRuns: [],
    dryRunRuns: [completedRun({
      id: 305,
      event: "pull_request",
      conclusion: "success",
    }), completedRun({
      id: 306,
      event: "pull_request",
      conclusion: "cancelled",
    })],
    jobsByRunId: {
      305: [job({
        name: "assemble-and-checkpoint-unsigned-app",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:02:00.000Z",
      }), job({
        name: "restore-rebuild-oracles-and-launch",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-08T10:02:00.000Z",
        completedAt: "2026-08-08T10:05:00.000Z",
      })],
    },
    candidateRuns: [],
    releaseRuns: [],
    dependencyHealth: "success",
  });

  assert.equal(report.sourceGate.pullRequestRuns, 2);
  assert.equal(report.runnerUse.totalMinutes, 5);
  assert.equal(report.runnerUse.releaseDryRunMinutes, 5);
  assert.equal(report.releaseDryRun.runs, 2);
  assert.deepEqual(report.releaseDryRun.conclusions, { success: 1, cancelled: 1 });
  assert.equal(report.workflowCancellation.pullRequestCancellationRate, 0.5);
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
  assert.equal(report.workflowCancellation.pullRequestCancellationRate, null);
  assert.equal(report.publication.rebuildsAfterCandidateApproval, null);
  assert.equal(report.targetAssessment.metrics.publicationRebuilds.status, "no_data");
  assert.match(renderCiHealthMarkdown(report), /\| Publication rebuilds \| n\/a \| 0 \| ⚪ NO DATA \|/u);
  assert.equal(report.targetAssessment.overall, "insufficient_data");
});

test("CI health derives rebuild attempts only from proven publication job steps", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-08-08T12:00:00.000Z",
    ciRuns: [],
    feedbackRuns: [],
    jobsByRunId: {
      401: [job({
        name: "publish-verified-candidate",
        attempt: 1,
        conclusion: "success",
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:02:00.000Z",
        steps: [
          { name: "Build release assets", conclusion: "success" },
          { name: "Publish immutable GitHub Release", conclusion: "success" },
        ],
      })],
    },
    candidateRuns: [],
    releaseRuns: [{ id: 401, status: "completed", conclusion: "success" }],
    dependencyHealth: "success",
  });

  assert.equal(report.publication.rebuildsAfterCandidateApproval, 1);
  assert.equal(report.targetAssessment.metrics.publicationRebuilds.status, "missed");
});

test("CI health reports no publication data when Release fails before publishing", () => {
  const report = summarizeCiHealth({
    periodDays: 30,
    generatedAt: "2026-08-08T12:00:00.000Z",
    ciRuns: [],
    feedbackRuns: [],
    jobsByRunId: {
      402: [job({
        name: "publish-verified-candidate",
        attempt: 1,
        conclusion: "failure",
        startedAt: "2026-08-08T10:00:00.000Z",
        completedAt: "2026-08-08T10:00:10.000Z",
        steps: [{ name: "Require exact version on current main", conclusion: "failure" }],
      })],
    },
    candidateRuns: [],
    releaseRuns: [{ id: 402, status: "completed", conclusion: "failure" }],
    dependencyHealth: "success",
  });

  assert.equal(report.publication.rebuildsAfterCandidateApproval, null);
  assert.equal(report.targetAssessment.metrics.publicationRebuilds.status, "no_data");
});

test("CI health paginates the complete requested workflow window", async () => {
  const originalFetch = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async (url) => {
    requested.push(String(url));
    const page = Number(new URL(url).searchParams.get("page"));
    const count = page < 3 ? 100 : 1;
    return {
      ok: true,
      status: 200,
      async json() {
        return {
          workflow_runs: Array.from({ length: count }, (_, index) => ({
            id: page * 1000 + index,
            created_at: "2026-08-08T00:00:00.000Z",
          })),
        };
      },
    };
  };
  try {
    const runs = await workflowRuns({
      repositoryPath: "owner/repository",
      workflow: "ci.yml",
      token: "test-token",
      since: "2026-08-01T00:00:00.000Z",
    });
    assert.equal(runs.length, 201);
    assert.equal(requested.length, 3);
    assert.ok(requested.every((url) => (
      new URL(url).searchParams.get("created") === ">=2026-08-01T00:00:00.000Z"
    )));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CI health fails closed when the Pull Request activity window exceeds its page cap", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const parsed = new URL(url);
    const page = Number(parsed.searchParams.get("page"));
    return {
      ok: true,
      status: 200,
      async json() {
        return Array.from({ length: 100 }, (_, index) => ({
          number: page * 1000 + index,
          updated_at: "2026-08-09T00:00:00.000Z",
        }));
      },
    };
  };
  try {
    await assert.rejects(
      () => pullRequestMetrics({
        repositoryPath: "owner/repository",
        token: "test-token",
        since: "2026-08-01T00:00:00.000Z",
      }),
      /exceeded 500 updated entries/u,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CI health workflow stays read-only and retains a machine-readable report", async () => {
  const [workflow, reportScript] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/ci-health.yml"), "utf8"),
    readFile(path.join(productRoot, "scripts/ci-health-report.mjs"), "utf8"),
  ]);
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /cron: "17 1 \* \* \*"/u);
  assert.match(workflow, /actions: read/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /issues: read/u);
  assert.match(workflow, /pull-requests: read/u);
  assert.match(workflow, /ci-health-report\.mjs/u);
  assert.match(workflow, /name: dependency-health/u);
  assert.match(workflow, /npm run audit:dependencies/u);
  assert.match(workflow, /needs: dependency-health/u);
  assert.match(workflow, /if: \$\{\{ always\(\) \}\}/u);
  assert.match(workflow, /DEPENDENCY_HEALTH_RESULT: \$\{\{ needs\.dependency-health\.result \}\}/u);
  assert.match(workflow, /retention-days: 90/u);
  assert.doesNotMatch(workflow, /contents: write|pull-requests: write|issues: write/u);
  assert.deepEqual(CI_HEALTH_WORKFLOW_INPUTS, {
    ci: "ci.yml",
    feedback: "pr-feedback.yml",
    releaseDryRun: "release-dry-run.yml",
    releaseCandidate: "release-candidate.yml",
    release: "release.yml",
  });
  assert.match(reportScript, /workflow: CI_HEALTH_WORKFLOW_INPUTS\.ci/u);
  assert.match(reportScript, /workflow: CI_HEALTH_WORKFLOW_INPUTS\.feedback/u);
  assert.match(reportScript, /workflow: CI_HEALTH_WORKFLOW_INPUTS\.releaseDryRun/u);
  assert.match(reportScript, /workflow: CI_HEALTH_WORKFLOW_INPUTS\.releaseCandidate/u);
  assert.match(reportScript, /workflow: CI_HEALTH_WORKFLOW_INPUTS\.release/u);
  assert.match(reportScript, /pullRequestMetrics\(\{ repositoryPath, token, since \}\)/u);
  assert.match(reportScript, /issues\/\$\{number\}\/comments/u);
  assert.match(reportScript, /Candidate-to-merge P50/u);
  assert.match(reportScript, /\| Metric \| Actual \| Target \| Status \|/u);
  assert.match(reportScript, /Cancelled completed promoted candidates/u);
});
