#!/usr/bin/env node

import {
  appendFile,
  mkdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_DAYS = 30;
const MAX_WORKFLOW_RUN_PAGES = 20;
const MAX_JOB_PAGES = 20;
const PUBLICATION_STEP_NAME = "Publish immutable GitHub Release";
export const CI_HEALTH_WORKFLOW_INPUTS = Object.freeze({
  ci: "ci.yml",
  feedback: "pr-feedback.yml",
  releaseDryRun: "release-dry-run.yml",
  releaseCandidate: "release-candidate.yml",
  release: "release.yml",
});
const TARGETS = Object.freeze({
  attemptsPerTreeAverage: Object.freeze({ operator: "at_most", value: 1.5 }),
  runsPerPullRequestAverage: Object.freeze({ operator: "at_most", value: 1.25 }),
  wallMinutesP50: Object.freeze({ operator: "under", value: 6 }),
  wallMinutesP95: Object.freeze({ operator: "under", value: 10 }),
  repeatedGreenShare: Object.freeze({ operator: "under", value: 0.2 }),
  candidateChurnShare: Object.freeze({ operator: "under", value: 0.2 }),
  environmentPreflightFailureRate: Object.freeze({ operator: "under", value: 0.02 }),
  publicationRebuilds: Object.freeze({ operator: "at_most", value: 0 }),
});

function finiteDurationMinutes(startedAt, completedAt) {
  const startedMs = Date.parse(startedAt || "");
  const completedMs = Date.parse(completedAt || "");
  if (
    !Number.isFinite(startedMs)
    || !Number.isFinite(completedMs)
    || completedMs < startedMs
  ) return 0;
  return (completedMs - startedMs) / 60_000;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function percentile(values, percentage) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (sorted.length === 0) return null;
  const index = Math.max(0, Math.ceil((percentage / 100) * sorted.length) - 1);
  return round(sorted[index]);
}

function conclusionCounts(runs) {
  return (runs || []).reduce((counts, run) => {
    const conclusion = run?.conclusion || run?.status || "unknown";
    counts[conclusion] = (counts[conclusion] || 0) + 1;
    return counts;
  }, {});
}

function isCompletedWorkflowRun(run) {
  return run?.status === "completed" && Boolean(run?.conclusion);
}

function jobsForRun(jobsByRunId, runId) {
  return jobsByRunId?.[String(runId)] || [];
}

function isExecutedJob(job) {
  return job?.conclusion !== "skipped" && Boolean(job?.started_at && job?.completed_at);
}

function isFullGateLane(job) {
  return [
    "source-build",
    "source-node",
    "electron-native",
    "electron-ai",
  ].includes(job?.name) || /^browser-/u.test(job?.name || "");
}

function fullGateAttempts(jobs) {
  return new Set((jobs || [])
    .filter((job) => isExecutedJob(job) && isFullGateLane(job))
    .map((job) => Number(job.run_attempt || 1)))
    .size;
}

function runnerMinutesForRuns(runs, jobsByRunId) {
  return (runs || []).reduce((total, run) => (
    total + jobsForRun(jobsByRunId, run.id)
      .filter(isExecutedJob)
      .reduce((runTotal, job) => (
        runTotal + finiteDurationMinutes(job.started_at, job.completed_at)
      ), 0)
  ), 0);
}

function pullRequestKey(run) {
  const pullRequestNumber = (run?.pull_requests || [])
    .map((pullRequest) => Number(pullRequest?.number))
    .find((number) => Number.isInteger(number) && number > 0);
  if (pullRequestNumber) return `pr:${pullRequestNumber}`;
  if (run?.head_branch) return `branch:${run.head_branch}`;
  return `run:${run?.id || run?.head_sha || "unknown"}`;
}

function candidateRunCounts(fullRuns) {
  const counts = new Map();
  for (const run of fullRuns) {
    const key = pullRequestKey(run);
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.values()];
}

function repeatedCandidateRuns(fullRuns) {
  const previousShaByCandidate = new Map();
  return [...fullRuns]
    .sort((left, right) => {
      const leftAt = Date.parse(left.created_at || "");
      const rightAt = Date.parse(right.created_at || "");
      if (Number.isFinite(leftAt) && Number.isFinite(rightAt) && leftAt !== rightAt) {
        return leftAt - rightAt;
      }
      return Number(left?.id || 0) - Number(right?.id || 0);
    })
    .filter((run) => {
      const key = pullRequestKey(run);
      const sha = run?.head_sha || `unknown:${run?.id || "run"}`;
      const hasPreviousCandidate = previousShaByCandidate.has(key);
      const isCandidateTransition = (
        hasPreviousCandidate
        && previousShaByCandidate.get(key) !== sha
      );
      previousShaByCandidate.set(key, sha);
      return isCandidateTransition;
    });
}

function repeatedGreenMinutes(jobs) {
  const ordered = [...jobs].sort((left, right) => (
    Number(left.run_attempt || 1) - Number(right.run_attempt || 1)
    || Date.parse(left.started_at || "") - Date.parse(right.started_at || "")
  ));
  const previousConclusion = new Map();
  let minutes = 0;
  for (const job of ordered) {
    const attempt = Number(job.run_attempt || 1);
    if (
      attempt > 1
      && previousConclusion.get(job.name) === "success"
      && isExecutedJob(job)
    ) {
      minutes += finiteDurationMinutes(job.started_at, job.completed_at);
    }
    previousConclusion.set(job.name, job.conclusion);
  }
  return minutes;
}

function preflightSteps(jobs) {
  return jobs.flatMap((job) => (job.steps || []).filter((step) => (
    /^Prove hosted (?:renderer|Electron) scheduling/u.test(step?.name || "")
  )));
}

function publicationRebuildCount(releaseRuns, jobsByRunId) {
  const publishedRuns = (releaseRuns || []).filter((run) => (
    run?.conclusion === "success"
  ));
  if (publishedRuns.length === 0) return null;
  const jobs = publishedRuns.map((run) => jobsForRun(jobsByRunId, run.id));
  if (jobs.some((runJobs) => runJobs.length === 0)) return null;
  const stepsByRun = jobs.map((runJobs) => runJobs.flatMap((job) => job.steps || []));
  if (stepsByRun.some((steps) => !steps.some((step) => (
    step?.name === PUBLICATION_STEP_NAME && step?.conclusion === "success"
  )))) return null;
  return stepsByRun.flat().filter((step) => (
    step?.conclusion && step.conclusion !== "skipped"
    && /^(?:Assemble|Build|Package|Rebuild)\b|\b(?:electron-builder|npm run build)\b/iu.test(
      step?.name || "",
    )
  )).length;
}

function cancellationSummary(runs) {
  const total = (runs || []).length;
  const completedRuns = (runs || []).filter(isCompletedWorkflowRun);
  const cancelled = completedRuns.filter((run) => run.conclusion === "cancelled").length;
  return Object.freeze({
    total,
    completed: completedRuns.length,
    active: total - completedRuns.length,
    cancelled,
    rate: completedRuns.length > 0 ? round(cancelled / completedRuns.length) : null,
  });
}

function numericTarget(actual, target) {
  if (!Number.isFinite(actual)) {
    return Object.freeze({ actual: null, ...target, status: "no_data" });
  }
  const met = target.operator === "under"
    ? actual < target.value
    : actual <= target.value;
  return Object.freeze({ actual: round(actual), ...target, status: met ? "met" : "missed" });
}

function dependencyTarget(actual) {
  const normalized = String(actual || "unknown").toLowerCase();
  return Object.freeze({
    actual: normalized,
    operator: "equals",
    value: "success",
    status: normalized === "unknown" ? "no_data" : normalized === "success" ? "met" : "missed",
  });
}

function overallTargetStatus(metrics) {
  const statuses = Object.values(metrics).map((metric) => metric.status);
  if (statuses.includes("missed")) return "missed";
  if (statuses.includes("no_data")) return "insufficient_data";
  return "met";
}

export function summarizeCiHealth({
  periodDays,
  generatedAt,
  ciRuns,
  feedbackRuns = [],
  dryRunRuns = [],
  jobsByRunId,
  candidateRuns,
  releaseRuns,
  dependencyHealth = "unknown",
}) {
  const sourcePullRequestRuns = (ciRuns || []).filter((run) => run?.event === "pull_request");
  const feedbackPullRequestRuns = (feedbackRuns || []).filter((run) => run?.event === "pull_request");
  const dryRunPullRequestRuns = (dryRunRuns || []).filter((run) => (
    run?.event === "pull_request"
  ));
  const pullRequestRuns = [
    ...sourcePullRequestRuns,
    ...feedbackPullRequestRuns,
    ...dryRunPullRequestRuns,
  ];
  const completedPullRequestRuns = pullRequestRuns.filter(isCompletedWorkflowRun);
  const activePullRequestRuns = pullRequestRuns.filter((run) => (
    !isCompletedWorkflowRun(run)
  ));
  const completedSourcePullRequestRuns = sourcePullRequestRuns.filter(
    isCompletedWorkflowRun,
  );
  const fullRuns = completedSourcePullRequestRuns.filter((run) => (
    fullGateAttempts(jobsForRun(jobsByRunId, run.id)) > 0
  ));
  const activeFullRuns = sourcePullRequestRuns.filter((run) => (
    !isCompletedWorkflowRun(run)
    && fullGateAttempts(jobsForRun(jobsByRunId, run.id)) > 0
  ));
  const selectedFeedbackRuns = pullRequestRuns.filter((run) => jobsForRun(jobsByRunId, run.id).some((job) => (
    ["draft-feedback", "pr-feedback"].includes(job?.name) && job?.conclusion !== "skipped"
  )));
  const completedFeedbackRuns = selectedFeedbackRuns.filter(isCompletedWorkflowRun);
  const activeFeedbackRuns = selectedFeedbackRuns.filter((run) => (
    !isCompletedWorkflowRun(run)
  ));
  const fullDurations = fullRuns.map((run) => (
    finiteDurationMinutes(run.created_at, run.updated_at)
  )).filter((duration) => duration > 0);
  const allJobs = pullRequestRuns.flatMap((run) => jobsForRun(jobsByRunId, run.id));
  const runnerMinutes = allJobs
    .filter(isExecutedJob)
    .reduce((total, job) => (
      total + finiteDurationMinutes(job.started_at, job.completed_at)
    ), 0);
  const completedRunnerMinutes = runnerMinutesForRuns(completedPullRequestRuns, jobsByRunId);
  const activeRunnerMinutes = runnerMinutesForRuns(activePullRequestRuns, jobsByRunId);
  const repeatedMinutes = completedPullRequestRuns.reduce((total, run) => (
    total + repeatedGreenMinutes(jobsForRun(jobsByRunId, run.id))
  ), 0);
  const completedJobs = completedPullRequestRuns.flatMap((run) => (
    jobsForRun(jobsByRunId, run.id)
  ));
  const preflights = preflightSteps(completedJobs).filter((step) => (
    step.conclusion === "success" || step.conclusion === "failure"
  ));
  const failedPreflights = preflights.filter((step) => step.conclusion === "failure");
  const gateAttemptsBySha = {};
  for (const run of fullRuns) {
    const attempts = fullGateAttempts(jobsForRun(jobsByRunId, run.id));
    gateAttemptsBySha[run.head_sha] = (gateAttemptsBySha[run.head_sha] || 0) + attempts;
  }
  const gateAttemptCounts = Object.values(gateAttemptsBySha);
  const gateRunCounts = candidateRunCounts(fullRuns);
  const repeatedCandidates = repeatedCandidateRuns(fullRuns);
  const averageAttempts = gateAttemptCounts.length > 0
    ? gateAttemptCounts.reduce((total, count) => total + count, 0) / gateAttemptCounts.length
    : null;
  const averageRunsPerPullRequest = gateRunCounts.length > 0
    ? gateRunCounts.reduce((total, count) => total + count, 0) / gateRunCounts.length
    : null;
  const fullGateMinutes = runnerMinutesForRuns(fullRuns, jobsByRunId);
  const activeGateMinutes = runnerMinutesForRuns(activeFullRuns, jobsByRunId);
  const feedbackMinutes = runnerMinutesForRuns(completedFeedbackRuns, jobsByRunId);
  const completedDryRunPullRequestRuns = dryRunPullRequestRuns.filter(
    isCompletedWorkflowRun,
  );
  const releaseDryRunMinutes = runnerMinutesForRuns(
    completedDryRunPullRequestRuns,
    jobsByRunId,
  );
  const candidateChurnMinutes = runnerMinutesForRuns(repeatedCandidates, jobsByRunId);
  const repeatedShare = completedRunnerMinutes > 0
    ? repeatedMinutes / completedRunnerMinutes
    : null;
  const candidateChurnShare = completedRunnerMinutes > 0
    ? candidateChurnMinutes / completedRunnerMinutes
    : null;
  const preflightFailureRate = preflights.length > 0
    ? failedPreflights.length / preflights.length
    : null;
  const p50 = percentile(fullDurations, 50);
  const p95 = percentile(fullDurations, 95);
  const pullRequestCancellation = cancellationSummary(pullRequestRuns);
  const candidateCancellation = cancellationSummary(sourcePullRequestRuns);
  const roundedAverageAttempts = round(averageAttempts);
  const roundedAverageRunsPerPullRequest = round(averageRunsPerPullRequest);
  const roundedRepeatedShare = round(repeatedShare);
  const roundedCandidateChurnShare = round(candidateChurnShare);
  const roundedPreflightFailureRate = round(preflightFailureRate);
  const publicationRebuilds = publicationRebuildCount(releaseRuns, jobsByRunId);
  const targetMetrics = Object.freeze({
    attemptsPerTreeAverage: numericTarget(
      averageAttempts,
      TARGETS.attemptsPerTreeAverage,
    ),
    runsPerPullRequestAverage: numericTarget(
      averageRunsPerPullRequest,
      TARGETS.runsPerPullRequestAverage,
    ),
    wallMinutesP50: numericTarget(p50, TARGETS.wallMinutesP50),
    wallMinutesP95: numericTarget(p95, TARGETS.wallMinutesP95),
    repeatedGreenShare: numericTarget(
      repeatedShare,
      TARGETS.repeatedGreenShare,
    ),
    candidateChurnShare: numericTarget(
      candidateChurnShare,
      TARGETS.candidateChurnShare,
    ),
    environmentPreflightFailureRate: numericTarget(
      preflightFailureRate,
      TARGETS.environmentPreflightFailureRate,
    ),
    publicationRebuilds: numericTarget(
      publicationRebuilds,
      TARGETS.publicationRebuilds,
    ),
    dependencyHealth: dependencyTarget(dependencyHealth),
  });
  return Object.freeze({
    schemaVersion: 4,
    generatedAt,
    periodDays,
    sourceGate: {
      pullRequestRuns: pullRequestRuns.length,
      completedPullRequestRuns: completedPullRequestRuns.length,
      activePullRequestRuns: activePullRequestRuns.length,
      feedbackRuns: completedFeedbackRuns.length,
      activeFeedbackRuns: activeFeedbackRuns.length,
      completeRuns: fullRuns.length,
      activeRuns: activeFullRuns.length,
      uniqueTrees: gateAttemptCounts.length,
      candidatePullRequests: gateRunCounts.length,
      attemptsPerTreeAverage: roundedAverageAttempts,
      attemptsPerTreeP50: percentile(gateAttemptCounts, 50),
      runsPerPullRequestAverage: roundedAverageRunsPerPullRequest,
      runsPerPullRequestP50: percentile(gateRunCounts, 50),
      repeatedCandidateRuns: repeatedCandidates.length,
      wallMinutesP50: p50,
      wallMinutesP95: p95,
      target: {
        attemptsPerTreeAverageAtMost: 1.5,
        runsPerPullRequestAverageAtMost: 1.25,
        wallMinutesP50Under: 6,
        wallMinutesP95Under: 10,
      },
    },
    runnerUse: {
      totalMinutes: round(runnerMinutes),
      completedWorkflowMinutes: round(completedRunnerMinutes),
      activeWorkflowMinutes: round(activeRunnerMinutes),
      feedbackMinutes: round(feedbackMinutes),
      releaseDryRunMinutes: round(releaseDryRunMinutes),
      fullGateMinutes: round(fullGateMinutes),
      activeGateMinutes: round(activeGateMinutes),
      repeatedGreenMinutes: round(repeatedMinutes),
      repeatedGreenShare: roundedRepeatedShare,
      candidateChurnMinutes: round(candidateChurnMinutes),
      candidateChurnShare: roundedCandidateChurnShare,
      repeatedGreenTargetShareUnder: 0.2,
      candidateChurnTargetShareUnder: 0.2,
    },
    environmentPreflight: {
      completed: preflights.length,
      failed: failedPreflights.length,
      failureRate: roundedPreflightFailureRate,
      targetRateUnder: 0.02,
    },
    releaseCandidate: {
      runs: (candidateRuns || []).length,
      conclusions: conclusionCounts(candidateRuns),
    },
    releaseDryRun: {
      runs: dryRunPullRequestRuns.length,
      conclusions: conclusionCounts(dryRunPullRequestRuns),
    },
    publication: {
      runs: (releaseRuns || []).length,
      conclusions: conclusionCounts(releaseRuns),
      rebuildsAfterCandidateApproval: publicationRebuilds,
      targetRebuilds: 0,
    },
    workflowCancellation: {
      pullRequestRuns: pullRequestCancellation.total,
      completedPullRequestRuns: pullRequestCancellation.completed,
      activePullRequestRuns: pullRequestCancellation.active,
      cancelledPullRequestRuns: pullRequestCancellation.cancelled,
      pullRequestCancellationRate: pullRequestCancellation.rate,
      promotedCandidateRuns: candidateCancellation.total,
      completedPromotedCandidateRuns: candidateCancellation.completed,
      activePromotedCandidateRuns: candidateCancellation.active,
      cancelledPromotedCandidateRuns: candidateCancellation.cancelled,
      promotedCandidateCancellationRate: candidateCancellation.rate,
    },
    dependencyHealth: {
      status: targetMetrics.dependencyHealth.actual,
      target: "success",
    },
    targetAssessment: {
      overall: overallTargetStatus(targetMetrics),
      metrics: targetMetrics,
    },
  });
}

function parseOptions(argv) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY || "",
    tokenEnv: "GITHUB_TOKEN",
    days: DEFAULT_DAYS,
    output: "output/ci-health/ci-health.json",
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--token-env") options.tokenEnv = value;
    else if (argument === "--days") options.days = Number(value);
    else if (argument === "--output") options.output = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(options.repository)) {
    throw new Error("--repository must use owner/name.");
  }
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 90) {
    throw new Error("--days must be an integer from 1 to 90.");
  }
  return options;
}

async function githubJson(apiPath, token, { allowNotFound = false } = {}) {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await globalThis.fetch(`${apiBase}${apiPath}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (allowNotFound && response.status === 404) return null;
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${apiPath}: ${body}`);
  }
  return await response.json();
}

export async function workflowRuns({ repositoryPath, workflow, token, since }) {
  const results = [];
  const sinceMs = Date.parse(since);
  const createdFilter = encodeURIComponent(`>=${since}`);
  for (let page = 1; page <= MAX_WORKFLOW_RUN_PAGES; page += 1) {
    const response = await githubJson(
      `/repos/${repositoryPath}/actions/workflows/${encodeURIComponent(workflow)}/runs`
      + `?created=${createdFilter}&per_page=100&page=${page}`,
      token,
      { allowNotFound: true },
    );
    if (!response) return [];
    const runs = response.workflow_runs || [];
    results.push(...runs.filter((run) => Date.parse(run.created_at || "") >= sinceMs));
    if (runs.length < 100) return results;
  }
  throw new Error(
    `${workflow} exceeded ${MAX_WORKFLOW_RUN_PAGES * 100} runs in the requested window.`,
  );
}

async function jobsForWorkflowRun(repositoryPath, run, token) {
  const jobs = [];
  for (let page = 1; page <= MAX_JOB_PAGES; page += 1) {
    const response = await githubJson(
      `/repos/${repositoryPath}/actions/runs/${run.id}/jobs?filter=all&per_page=100&page=${page}`,
      token,
    );
    const pageJobs = response.jobs || [];
    jobs.push(...pageJobs);
    if (pageJobs.length < 100) return jobs;
  }
  throw new Error(
    `Workflow run ${run.id} exceeded ${MAX_JOB_PAGES * 100} jobs.`,
  );
}

async function collectJobs(repositoryPath, runs, token) {
  const jobsByRunId = {};
  const batchSize = 10;
  for (let index = 0; index < runs.length; index += batchSize) {
    const batch = runs.slice(index, index + batchSize);
    const entries = await Promise.all(batch.map(async (run) => {
      const jobs = await jobsForWorkflowRun(repositoryPath, run, token);
      return [String(run.id), jobs];
    }));
    Object.assign(jobsByRunId, Object.fromEntries(entries));
  }
  return jobsByRunId;
}

export function renderCiHealthMarkdown(report) {
  const percent = (value) => (
    Number.isFinite(value) ? `${round(value * 100)}%` : "n/a"
  );
  const status = (value) => ({
    met: "✅ MET",
    missed: "❌ MISSED",
    no_data: "⚪ NO DATA",
    insufficient_data: "⚪ INSUFFICIENT DATA",
  })[value] || `⚪ ${String(value || "UNKNOWN").toUpperCase()}`;
  const metricStatus = (name) => status(report.targetAssessment.metrics[name].status);
  return [
    "## PageRoot CI health",
    "",
    `Window: ${report.periodDays} days`,
    `Overall target status: **${status(report.targetAssessment.overall)}**`,
    `Dependency baseline: **${status(report.targetAssessment.metrics.dependencyHealth.status)}** (${report.dependencyHealth.status})`,
    "",
    "| Metric | Actual | Target | Status |",
    "| --- | ---: | ---: | --- |",
    `| Complete gate attempts per Tree | ${report.sourceGate.attemptsPerTreeAverage ?? "n/a"} | <= 1.5 | ${metricStatus("attemptsPerTreeAverage")} |`,
    `| Complete gates per Pull Request | ${report.sourceGate.runsPerPullRequestAverage ?? "n/a"} | <= 1.25 | ${metricStatus("runsPerPullRequestAverage")} |`,
    `| Full PR wall P50 | ${report.sourceGate.wallMinutesP50 ?? "n/a"} min | < 6 min | ${metricStatus("wallMinutesP50")} |`,
    `| Full PR wall P95 | ${report.sourceGate.wallMinutesP95 ?? "n/a"} min | < 10 min | ${metricStatus("wallMinutesP95")} |`,
    `| Repeated-green runner share | ${percent(report.runnerUse.repeatedGreenShare)} | < 20% | ${metricStatus("repeatedGreenShare")} |`,
    `| Cross-SHA candidate churn share | ${percent(report.runnerUse.candidateChurnShare)} | < 20% | ${metricStatus("candidateChurnShare")} |`,
    `| Environment preflight failure rate | ${percent(report.environmentPreflight.failureRate)} | < 2% | ${metricStatus("environmentPreflightFailureRate")} |`,
    `| Publication rebuilds | ${report.publication.rebuildsAfterCandidateApproval ?? "n/a"} | 0 | ${metricStatus("publicationRebuilds")} |`,
    "",
    "### Recorded workload",
    "",
    "| Metric | Value |",
    "| --- | ---: |",
    `| Complete gates | ${report.sourceGate.completeRuns} |`,
    `| Active gates with completed source work | ${report.sourceGate.activeRuns} |`,
    `| Repeated candidate gates | ${report.sourceGate.repeatedCandidateRuns} |`,
    `| Total PR runner minutes | ${report.runnerUse.totalMinutes} |`,
    `| Completed-workflow runner minutes | ${report.runnerUse.completedWorkflowMinutes} |`,
    `| Active-workflow recorded runner minutes | ${report.runnerUse.activeWorkflowMinutes} |`,
    `| Full-gate runner minutes | ${report.runnerUse.fullGateMinutes} |`,
    `| Active-gate recorded runner minutes | ${report.runnerUse.activeGateMinutes} |`,
    `| Feedback runner minutes | ${report.runnerUse.feedbackMinutes} |`,
    `| Release-dry-run runner minutes | ${report.runnerUse.releaseDryRunMinutes} |`,
    `| Candidate-churn runner minutes | ${report.runnerUse.candidateChurnMinutes} |`,
    `| Active PR workflow runs | ${report.workflowCancellation.activePullRequestRuns} |`,
    `| Cancelled completed PR workflow runs | ${report.workflowCancellation.cancelledPullRequestRuns}/${report.workflowCancellation.completedPullRequestRuns} (${percent(report.workflowCancellation.pullRequestCancellationRate)}) |`,
    `| Active promoted candidates | ${report.workflowCancellation.activePromotedCandidateRuns} |`,
    `| Cancelled completed promoted candidates | ${report.workflowCancellation.cancelledPromotedCandidateRuns}/${report.workflowCancellation.completedPromotedCandidateRuns} (${percent(report.workflowCancellation.promotedCandidateCancellationRate)}) |`,
    "",
    `Candidate conclusions: \`${JSON.stringify(report.releaseCandidate.conclusions)}\``,
    "",
    `Release dry-run conclusions: \`${JSON.stringify(report.releaseDryRun.conclusions)}\``,
    "",
    `Publication conclusions: \`${JSON.stringify(report.publication.conclusions)}\``,
    "",
  ].join("\n");
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  const generatedAt = new Date();
  const since = new Date(
    generatedAt.getTime() - options.days * 24 * 60 * 60 * 1000,
  ).toISOString();
  const repositoryPath = options.repository.split("/").map(encodeURIComponent).join("/");
  const [ciRuns, feedbackRuns, dryRunRuns, candidateRuns, releaseRuns] = await Promise.all([
    workflowRuns({ repositoryPath, workflow: CI_HEALTH_WORKFLOW_INPUTS.ci, token, since }),
    workflowRuns({ repositoryPath, workflow: CI_HEALTH_WORKFLOW_INPUTS.feedback, token, since }),
    workflowRuns({ repositoryPath, workflow: CI_HEALTH_WORKFLOW_INPUTS.releaseDryRun, token, since }),
    workflowRuns({ repositoryPath, workflow: CI_HEALTH_WORKFLOW_INPUTS.releaseCandidate, token, since }),
    workflowRuns({ repositoryPath, workflow: CI_HEALTH_WORKFLOW_INPUTS.release, token, since }),
  ]);
  const pullRequestRuns = [...ciRuns, ...feedbackRuns, ...dryRunRuns]
    .filter((run) => run.event === "pull_request");
  const jobsByRunId = await collectJobs(
    repositoryPath,
    [...pullRequestRuns, ...releaseRuns],
    token,
  );
  const report = summarizeCiHealth({
    periodDays: options.days,
    generatedAt: generatedAt.toISOString(),
    ciRuns,
    feedbackRuns,
    dryRunRuns,
    jobsByRunId,
    candidateRuns,
    releaseRuns,
    dependencyHealth: process.env.DEPENDENCY_HEALTH_RESULT || "unknown",
  });
  const destination = path.resolve(productRoot, options.output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const summary = renderCiHealthMarkdown(report);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, `${summary}\n`, "utf8");
  }
  console.log(`CI health report: ${destination}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
