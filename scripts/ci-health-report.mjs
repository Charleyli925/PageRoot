#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_DAYS = 30;
const MAX_WORKFLOW_RUN_PAGES = 20;
const MAX_JOB_PAGES = 20;
const GITHUB_API_VERSION = "2022-11-28";

export const CI_HEALTH_WORKFLOW_INPUTS = Object.freeze({
  ci: "ci.yml",
  releaseDryRun: "release-dry-run.yml",
  releaseCandidate: "release-candidate.yml",
  release: "release.yml",
  developerPreview: "developer-preview.yml",
});

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function conclusionCounts(runs) {
  return (runs || []).reduce((counts, run) => {
    const conclusion = run?.conclusion || run?.status || "unknown";
    counts[conclusion] = (counts[conclusion] || 0) + 1;
    return counts;
  }, {});
}

export function workflowRuns(runs, workflowPath) {
  return (runs || []).filter((run) => {
    const pathName = String(run?.path || "");
    return pathName === workflowPath || pathName.endsWith(`/${workflowPath}`);
  });
}

function failedJobNames(jobsByRunId) {
  const names = [];
  for (const jobs of Object.values(jobsByRunId || {})) {
    for (const job of jobs || []) {
      if (job?.conclusion === "failure") names.push(String(job.name || "unknown"));
    }
  }
  return names;
}

function flakyJobCount(jobsByRunId) {
  let flaky = 0;
  for (const jobs of Object.values(jobsByRunId || {})) {
    for (const job of jobs || []) {
      const attempt = Number(job?.run_attempt || 1);
      if (attempt > 1 && job?.conclusion === "success") flaky += 1;
    }
  }
  return flaky;
}

export function summarizeCiHealth({
  periodDays = DEFAULT_DAYS,
  generatedAt = new Date().toISOString(),
  ciRuns = [],
  jobsByRunId = {},
} = {}) {
  const completed = (ciRuns || []).filter((run) => run?.status === "completed");
  const counts = conclusionCounts(completed);
  const total = completed.length;
  const failed = counts.failure || 0;
  const success = counts.success || 0;
  const flakyRecovered = flakyJobCount(jobsByRunId);
  return Object.freeze({
    schemaVersion: 1,
    periodDays,
    generatedAt,
    workflow: CI_HEALTH_WORKFLOW_INPUTS.ci,
    totals: Object.freeze({
      runs: total,
      success,
      failure: failed,
      cancelled: counts.cancelled || 0,
      skipped: counts.skipped || 0,
    }),
    failureRate: total === 0 ? 0 : round(failed / total),
    flakyRecoveredJobs: flakyRecovered,
    failedJobs: Object.freeze(failedJobNames(jobsByRunId)),
  });
}

export function renderCiHealthMarkdown(report) {
  const failedJobs = (report.failedJobs || []).length === 0
    ? "none"
    : report.failedJobs.join(", ");
  return [
    `# CI health (${report.periodDays} days)`,
    "",
    `- Workflow: \`${report.workflow}\``,
    `- Runs: ${report.totals.runs} (${report.totals.success} success, ${report.totals.failure} failure)`,
    `- Failure rate: ${report.failureRate ?? 0}`,
    `- Jobs that failed then succeeded on retry: ${report.flakyRecoveredJobs}`,
    `- Failed job names: ${failedJobs}`,
    "",
  ].join("\n");
}

function parseOptions(argv) {
  const options = {
    repository: "",
    days: DEFAULT_DAYS,
    tokenEnv: "GITHUB_TOKEN",
    output: "output/ci-health/ci-health.json",
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--days") options.days = Number(value);
    else if (argument === "--token-env") options.tokenEnv = value;
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

async function githubJson(url, token) {
  const response = await globalThis.fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }
  return await response.json();
}

async function restPages(url, token, { maxPages }) {
  const entries = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    const response = await githubJson(`${url}${separator}per_page=100&page=${page}`, token);
    if (!Array.isArray(response)) throw new Error(`Expected an array from ${url}.`);
    entries.push(...response);
    if (response.length < 100) return entries;
  }
  throw new Error(`GitHub API pagination exceeded ${maxPages} pages for ${url}.`);
}

async function collectRuns(repository, token, sinceIso) {
  const apiBase = `https://api.github.com/repos/${repository}`;
  const runs = await restPages(
    `${apiBase}/actions/runs?created=>=${sinceIso}`,
    token,
    { maxPages: MAX_WORKFLOW_RUN_PAGES },
  );
  const ciRuns = workflowRuns(runs, `.github/workflows/${CI_HEALTH_WORKFLOW_INPUTS.ci}`);
  const jobsByRunId = {};
  for (const run of ciRuns.slice(0, 30)) {
    jobsByRunId[run.id] = await restPages(
      `${apiBase}/actions/runs/${run.id}/jobs`,
      token,
      { maxPages: MAX_JOB_PAGES },
    );
  }
  return { ciRuns, jobsByRunId };
}

async function run(options) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  const since = new Date(Date.now() - options.days * 24 * 60 * 60 * 1000).toISOString();
  const { ciRuns, jobsByRunId } = await collectRuns(options.repository, token, since);
  const report = summarizeCiHealth({
    periodDays: options.days,
    generatedAt: new Date().toISOString(),
    ciRuns,
    jobsByRunId,
  });
  const destination = path.resolve(productRoot, options.output);
  if (destination !== productRoot && !destination.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error("--output must remain inside the repository.");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(renderCiHealthMarkdown(report));
  console.log(`CI health report: ${destination}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run(parseOptions(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
