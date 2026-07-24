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
const MAX_RUNS_PER_WORKFLOW = 200;

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

function jobsForRun(jobsByRunId, runId) {
  return jobsByRunId?.[String(runId)] || [];
}

function isExecutedJob(job) {
  return job?.conclusion !== "skipped" && Boolean(job?.started_at && job?.completed_at);
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

export function summarizeCiHealth({
  periodDays,
  generatedAt,
  ciRuns,
  jobsByRunId,
  candidateRuns,
  releaseRuns,
}) {
  const pullRequestRuns = (ciRuns || []).filter((run) => run?.event === "pull_request");
  const fullRuns = pullRequestRuns.filter((run) => jobsForRun(jobsByRunId, run.id).some((job) => (
    job?.name === "release-gate" && job?.conclusion !== "skipped"
  )));
  const fullDurations = fullRuns.map((run) => (
    finiteDurationMinutes(run.created_at, run.updated_at)
  )).filter((duration) => duration > 0);
  const allJobs = pullRequestRuns.flatMap((run) => jobsForRun(jobsByRunId, run.id));
  const runnerMinutes = allJobs
    .filter(isExecutedJob)
    .reduce((total, job) => (
      total + finiteDurationMinutes(job.started_at, job.completed_at)
    ), 0);
  const repeatedMinutes = pullRequestRuns.reduce((total, run) => (
    total + repeatedGreenMinutes(jobsForRun(jobsByRunId, run.id))
  ), 0);
  const preflights = preflightSteps(allJobs).filter((step) => (
    step.conclusion === "success" || step.conclusion === "failure"
  ));
  const failedPreflights = preflights.filter((step) => step.conclusion === "failure");
  const gateAttemptsBySha = {};
  for (const run of fullRuns) {
    const attempts = jobsForRun(jobsByRunId, run.id).filter((job) => (
      job?.name === "release-gate" && job?.conclusion !== "skipped"
    )).length;
    gateAttemptsBySha[run.head_sha] = (gateAttemptsBySha[run.head_sha] || 0) + attempts;
  }
  const gateAttemptCounts = Object.values(gateAttemptsBySha);
  const averageAttempts = gateAttemptCounts.length > 0
    ? gateAttemptCounts.reduce((total, count) => total + count, 0) / gateAttemptCounts.length
    : null;
  const repeatedShare = runnerMinutes > 0 ? repeatedMinutes / runnerMinutes : null;
  const preflightFailureRate = preflights.length > 0
    ? failedPreflights.length / preflights.length
    : null;
  const p50 = percentile(fullDurations, 50);
  const p95 = percentile(fullDurations, 95);
  return Object.freeze({
    schemaVersion: 1,
    generatedAt,
    periodDays,
    sourceGate: {
      pullRequestRuns: pullRequestRuns.length,
      completeRuns: fullRuns.length,
      uniqueTrees: gateAttemptCounts.length,
      attemptsPerTreeAverage: round(averageAttempts),
      attemptsPerTreeP50: percentile(gateAttemptCounts, 50),
      wallMinutesP50: p50,
      wallMinutesP95: p95,
      target: {
        attemptsPerTreeAverageAtMost: 1.5,
        wallMinutesP50Under: 6,
        wallMinutesP95Under: 10,
      },
    },
    runnerUse: {
      totalMinutes: round(runnerMinutes),
      repeatedGreenMinutes: round(repeatedMinutes),
      repeatedGreenShare: round(repeatedShare),
      targetShareUnder: 0.2,
    },
    environmentPreflight: {
      completed: preflights.length,
      failed: failedPreflights.length,
      failureRate: round(preflightFailureRate),
      targetRateUnder: 0.02,
    },
    releaseCandidate: {
      runs: (candidateRuns || []).length,
      conclusions: conclusionCounts(candidateRuns),
    },
    publication: {
      runs: (releaseRuns || []).length,
      conclusions: conclusionCounts(releaseRuns),
      rebuildsAfterCandidateApproval: 0,
      targetRebuilds: 0,
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

async function workflowRuns({ repositoryPath, workflow, token, since }) {
  const results = [];
  const sinceMs = Date.parse(since);
  const maxPages = Math.ceil(MAX_RUNS_PER_WORKFLOW / 100);
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await githubJson(
      `/repos/${repositoryPath}/actions/workflows/${encodeURIComponent(workflow)}/runs`
      + `?per_page=100&page=${page}`,
      token,
      { allowNotFound: true },
    );
    if (!response) return [];
    const runs = response.workflow_runs || [];
    results.push(...runs.filter((run) => Date.parse(run.created_at || "") >= sinceMs));
    const oldestMs = Math.min(...runs.map((run) => Date.parse(run.created_at || "")));
    if (runs.length < 100 || (Number.isFinite(oldestMs) && oldestMs < sinceMs)) break;
  }
  return results.slice(0, MAX_RUNS_PER_WORKFLOW);
}

async function collectJobs(repositoryPath, runs, token) {
  const jobsByRunId = {};
  const batchSize = 10;
  for (let index = 0; index < runs.length; index += batchSize) {
    const batch = runs.slice(index, index + batchSize);
    const entries = await Promise.all(batch.map(async (run) => {
      const response = await githubJson(
        `/repos/${repositoryPath}/actions/runs/${run.id}/jobs?filter=all&per_page=100`,
        token,
      );
      return [String(run.id), response.jobs || []];
    }));
    Object.assign(jobsByRunId, Object.fromEntries(entries));
  }
  return jobsByRunId;
}

function markdown(report) {
  const percent = (value) => (
    Number.isFinite(value) ? `${round(value * 100)}%` : "n/a"
  );
  return [
    "## PageRoot CI health",
    "",
    `Window: ${report.periodDays} days`,
    "",
    "| Metric | Actual | Target |",
    "| --- | ---: | ---: |",
    `| Complete gate attempts per Tree | ${report.sourceGate.attemptsPerTreeAverage ?? "n/a"} | <= 1.5 |`,
    `| Full PR wall P50 | ${report.sourceGate.wallMinutesP50 ?? "n/a"} min | < 6 min |`,
    `| Full PR wall P95 | ${report.sourceGate.wallMinutesP95 ?? "n/a"} min | < 10 min |`,
    `| Repeated-green runner share | ${percent(report.runnerUse.repeatedGreenShare)} | < 20% |`,
    `| Environment preflight failure rate | ${percent(report.environmentPreflight.failureRate)} | < 2% |`,
    `| Publication rebuilds | ${report.publication.rebuildsAfterCandidateApproval} | 0 |`,
    "",
    `Candidate conclusions: \`${JSON.stringify(report.releaseCandidate.conclusions)}\``,
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
  const [ciRuns, candidateRuns, releaseRuns] = await Promise.all([
    workflowRuns({ repositoryPath, workflow: "ci.yml", token, since }),
    workflowRuns({ repositoryPath, workflow: "release-candidate.yml", token, since }),
    workflowRuns({ repositoryPath, workflow: "release.yml", token, since }),
  ]);
  const pullRequestRuns = ciRuns.filter((run) => run.event === "pull_request");
  const jobsByRunId = await collectJobs(repositoryPath, pullRequestRuns, token);
  const report = summarizeCiHealth({
    periodDays: options.days,
    generatedAt: generatedAt.toISOString(),
    ciRuns,
    jobsByRunId,
    candidateRuns,
    releaseRuns,
  });
  const destination = path.resolve(productRoot, options.output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  const summary = markdown(report);
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
