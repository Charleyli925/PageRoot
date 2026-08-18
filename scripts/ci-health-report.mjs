#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const DEFAULT_DAYS = 30;
const MAX_WORKFLOW_RUN_PAGES = 20;
const MAX_JOB_PAGES = 20;
const MAX_JOB_RUNS = 60;
const GITHUB_API_VERSION = "2022-11-28";

export const CI_HEALTH_WORKFLOW_INPUTS = Object.freeze({
  ci: "ci.yml",
  ciHealth: "ci-health.yml",
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

function percentile(values, quantile) {
  if (!values || values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(quantile * sorted.length))];
}

function minutes(milliseconds) {
  return milliseconds == null ? null : round(milliseconds / 60000, 1);
}

function durationStats(durationsMs) {
  return Object.freeze({
    p50Minutes: minutes(percentile(durationsMs, 0.5)),
    p95Minutes: minutes(percentile(durationsMs, 0.95)),
    maxMinutes: minutes(durationsMs.length > 0 ? Math.max(...durationsMs) : null),
  });
}

// Queue time (created -> started) and execution time (started -> completed)
// are different bottlenecks: the first is runner supply, the second is
// product work. Mixing them hides which one is hurting.
export function jobTimingStats(jobsByRunId) {
  const byName = {};
  for (const jobs of Object.values(jobsByRunId || {})) {
    for (const job of jobs || []) {
      if (!job || job.conclusion === "skipped") continue;
      const name = String(job.name || "unknown")
        .replace(/^browser-shard-\d+-of-\d+$/u, "browser-shard");
      const entry = byName[name] ||= {
        executions: 0,
        failures: 0,
        cancelled: 0,
        queueMs: [],
        executionMs: [],
      };
      entry.executions += 1;
      if (job.conclusion === "failure") entry.failures += 1;
      if (job.conclusion === "cancelled") entry.cancelled += 1;
      const queue = Date.parse(job.started_at || "") - Date.parse(job.created_at || "");
      const execution = Date.parse(job.completed_at || "") - Date.parse(job.started_at || "");
      if (Number.isFinite(queue) && queue >= 0) entry.queueMs.push(queue);
      if (Number.isFinite(execution) && execution >= 0) entry.executionMs.push(execution);
    }
  }
  return Object.freeze(Object.fromEntries(Object.entries(byName).map(([name, entry]) => [
    name,
    Object.freeze({
      executions: entry.executions,
      failures: entry.failures,
      cancelled: entry.cancelled,
      queue: durationStats(entry.queueMs),
      execution: durationStats(entry.executionMs),
    }),
  ])));
}

// A run is a full source gate when release-gate actually executed; every
// other observed run is Draft-style feedback with a much smaller budget.
export function fullGateRunIds(jobsByRunId) {
  const ids = new Set();
  for (const [runId, jobs] of Object.entries(jobsByRunId || {})) {
    const gate = (jobs || []).some((job) => (
      job?.name === "release-gate" && job?.conclusion !== "skipped"
    ));
    if (gate) ids.add(String(runId));
  }
  return ids;
}

function runDurations(runs) {
  return runs
    .map((run) => (
      Date.parse(run.updated_at || "") - Date.parse(run.run_started_at || run.created_at || "")
    ))
    .filter((duration) => Number.isFinite(duration) && duration > 0);
}

function failureCauses(runs, jobsByRunId) {
  return runs
    .filter((run) => run.conclusion === "failure")
    .map((run) => Object.freeze({
      runId: run.id,
      url: run.html_url || "",
      failedJobs: (jobsByRunId?.[String(run.id)] || [])
        .filter((job) => job?.conclusion === "failure")
        .map((job) => String(job.name || "unknown")),
    }));
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
  // The wall-time split only covers runs whose jobs were actually fetched,
  // so an unobserved run is never misclassified as Draft feedback.
  const observed = completed.filter((run) => (
    Object.hasOwn(jobsByRunId || {}, String(run.id))
  ));
  const gateIds = fullGateRunIds(jobsByRunId);
  const gateRuns = observed.filter((run) => gateIds.has(String(run.id)));
  const draftRuns = observed.filter((run) => !gateIds.has(String(run.id)));
  return Object.freeze({
    schemaVersion: 2,
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
    fullGate: Object.freeze({ runs: gateRuns.length, ...durationStats(runDurations(gateRuns)) }),
    draft: Object.freeze({ runs: draftRuns.length, ...durationStats(runDurations(draftRuns)) }),
    jobs: jobTimingStats(jobsByRunId),
    failureCauses: Object.freeze(failureCauses(observed, jobsByRunId)),
  });
}

export function renderCiHealthMarkdown(report) {
  const failedJobs = (report.failedJobs || []).length === 0
    ? "none"
    : report.failedJobs.join(", ");
  const bucket = (label, value) => (
    `- ${label}: ${value.runs} runs`
    + ` (p50 ${value.p50Minutes ?? "-"} min, p95 ${value.p95Minutes ?? "-"} min,`
    + ` max ${value.maxMinutes ?? "-"} min)`
  );
  const jobRows = Object.entries(report.jobs || {})
    .sort((left, right) => (
      (right[1].execution.p95Minutes ?? 0) - (left[1].execution.p95Minutes ?? 0)
    ))
    .map(([name, job]) => (
      `| ${name} | ${job.executions} | ${job.failures} | ${job.cancelled}`
      + ` | ${job.queue.p50Minutes ?? "-"}/${job.queue.p95Minutes ?? "-"}`
      + ` | ${job.execution.p50Minutes ?? "-"}/${job.execution.p95Minutes ?? "-"}/${job.execution.maxMinutes ?? "-"} |`
    ));
  const causes = (report.failureCauses || []).slice(0, 10).map((cause) => (
    `- run ${cause.runId}: ${cause.failedJobs.join(", ") || "no failed job recorded"}`
    + (cause.url ? ` ${cause.url}` : "")
  ));
  return [
    `# CI health (${report.periodDays} days)`,
    "",
    `- Workflow: \`${report.workflow}\``,
    `- Runs: ${report.totals.runs} (${report.totals.success} success, ${report.totals.failure} failure)`,
    `- Failure rate: ${report.failureRate ?? 0}`,
    `- Jobs that failed then succeeded on retry: ${report.flakyRecoveredJobs}`,
    `- Failed job names: ${failedJobs}`,
    bucket("Full-gate runs", report.fullGate || { runs: 0, ...durationStats([]) }),
    bucket("Draft feedback runs", report.draft || { runs: 0, ...durationStats([]) }),
    "",
    "| job | executions | failures | cancelled | queue p50/p95 min | execution p50/p95/max min |",
    "|---|---|---|---|---|---|",
    ...jobRows,
    "",
    "## Failed runs",
    ...(causes.length > 0 ? causes : ["- none"]),
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

// GitHub list endpoints wrap their results in an object envelope such as
// { total_count, workflow_runs } or { total_count, jobs }.
export function extractRestList(response, listKey, url) {
  if (Array.isArray(response)) return response;
  const list = response?.[listKey];
  if (!Array.isArray(list)) {
    throw new Error(`Expected a ${listKey} array from ${url}.`);
  }
  return list;
}

async function restPages(url, token, { maxPages, listKey }) {
  const entries = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const separator = url.includes("?") ? "&" : "?";
    const pageUrl = `${url}${separator}per_page=100&page=${page}`;
    const list = extractRestList(await githubJson(pageUrl, token), listKey, pageUrl);
    entries.push(...list);
    if (list.length < 100) return entries;
  }
  throw new Error(`GitHub API pagination exceeded ${maxPages} pages for ${url}.`);
}

async function collectRuns(repository, token, sinceIso) {
  const apiBase = `https://api.github.com/repos/${repository}`;
  const runs = await restPages(
    `${apiBase}/actions/runs?created=${encodeURIComponent(`>=${sinceIso}`)}`,
    token,
    { maxPages: MAX_WORKFLOW_RUN_PAGES, listKey: "workflow_runs" },
  );
  const ciRuns = workflowRuns(runs, `.github/workflows/${CI_HEALTH_WORKFLOW_INPUTS.ci}`);
  const jobsByRunId = {};
  for (const run of ciRuns.slice(0, MAX_JOB_RUNS)) {
    jobsByRunId[run.id] = await restPages(
      `${apiBase}/actions/runs/${run.id}/jobs`,
      token,
      { maxPages: MAX_JOB_PAGES, listKey: "jobs" },
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
  const markdown = renderCiHealthMarkdown(report);
  const markdownDestination = `${destination.replace(/\.json$/u, "")}.md`;
  await writeFile(markdownDestination, markdown, "utf8");
  console.log(markdown);
  console.log(`CI health report: ${destination}`);
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run(parseOptions(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
