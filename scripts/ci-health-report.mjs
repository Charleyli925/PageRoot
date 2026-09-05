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

export const CI_HEALTH_BUDGETS = Object.freeze({
  sameShaUntriagedWashGreen: 0,
  blockingProductRetries: 0,
  draftP95Minutes: 5,
  readyP95Minutes: 12,
});

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function sameShaWashGreenCount(ciRuns = []) {
  const bySha = new Map();
  for (const run of ciRuns) {
    if (run?.status !== "completed") continue;
    const sha = String(run.head_sha || "");
    if (!sha) continue;
    const entry = bySha.get(sha) || { success: false, failure: false };
    if (run.conclusion === "success") entry.success = true;
    if (run.conclusion === "failure") entry.failure = true;
    bySha.set(sha, entry);
  }
  let count = 0;
  for (const entry of bySha.values()) {
    // A later successful attempt of the same SHA is not wash-green by itself.
    // Only count SHAs that actually failed and later succeeded.
    if (entry.success && entry.failure) count += 1;
  }
  return count;
}

export function productRetryCount(flakyRecords = []) {
  return (flakyRecords || []).reduce((total, record) => {
    const flaky = Number.isInteger(record?.product?.flaky) ? record.product.flaky : 0;
    const retries = Number.isInteger(record?.product?.retries) ? record.product.retries : 0;
    return total + flaky + retries;
  }, 0);
}

export function budgetViolations(report) {
  const violations = [];
  const washGreen = Number(report?.sameShaWashGreen) || 0;
  if (washGreen > CI_HEALTH_BUDGETS.sameShaUntriagedWashGreen) {
    violations.push(Object.freeze({
      code: "same-sha-wash-green",
      blocking: true,
      actual: washGreen,
      limit: CI_HEALTH_BUDGETS.sameShaUntriagedWashGreen,
    }));
  }
  const productRetries = Number(report?.blockingProductRetries) || 0;
  if (productRetries > CI_HEALTH_BUDGETS.blockingProductRetries) {
    violations.push(Object.freeze({
      code: "blocking-product-retries",
      blocking: true,
      actual: productRetries,
      limit: CI_HEALTH_BUDGETS.blockingProductRetries,
    }));
  }
  const draftP95 = report?.draft?.p95Minutes;
  if (Number.isFinite(draftP95) && draftP95 > CI_HEALTH_BUDGETS.draftP95Minutes) {
    violations.push(Object.freeze({
      code: "draft-p95",
      blocking: false,
      actual: draftP95,
      limit: CI_HEALTH_BUDGETS.draftP95Minutes,
    }));
  }
  const readyP95 = report?.fullGate?.p95Minutes;
  if (Number.isFinite(readyP95) && readyP95 > CI_HEALTH_BUDGETS.readyP95Minutes) {
    violations.push(Object.freeze({
      code: "ready-p95",
      blocking: false,
      actual: readyP95,
      limit: CI_HEALTH_BUDGETS.readyP95Minutes,
    }));
  }
  return Object.freeze(violations);
}

export function shouldCreateCiHealthIssue(currentViolations, previousViolations, {
  currentGeneratedAt,
  previousGeneratedAt,
} = {}) {
  const currentBlocking = new Set(
    (currentViolations || []).filter((item) => item.blocking).map((item) => item.code),
  );
  if (currentBlocking.size === 0) return false;
  const previousBlocking = new Set(
    (previousViolations || []).filter((item) => item.blocking).map((item) => item.code),
  );
  const shared = [...currentBlocking].some((code) => previousBlocking.has(code));
  if (!shared) return false;
  const currentMs = Date.parse(currentGeneratedAt || "");
  const previousMs = Date.parse(previousGeneratedAt || "");
  if (!Number.isFinite(currentMs) || !Number.isFinite(previousMs)) return false;
  return currentMs - previousMs >= 6 * 24 * 60 * 60 * 1000;
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
  flakyRecords = [],
} = {}) {
  const completed = (ciRuns || []).filter((run) => run?.status === "completed");
  const counts = conclusionCounts(completed);
  const total = completed.length;
  const failed = counts.failure || 0;
  const success = counts.success || 0;
  const flakyRecovered = flakyJobCount(jobsByRunId);
  const observed = completed.filter((run) => (
    Object.hasOwn(jobsByRunId || {}, String(run.id))
  ));
  const gateIds = fullGateRunIds(jobsByRunId);
  const gateRuns = observed.filter((run) => gateIds.has(String(run.id)));
  const draftRuns = observed.filter((run) => !gateIds.has(String(run.id)));
  const report = {
    schemaVersion: 3,
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
    sameShaWashGreen: sameShaWashGreenCount(completed),
    blockingProductRetries: productRetryCount(flakyRecords),
    failedJobs: Object.freeze(failedJobNames(jobsByRunId)),
    fullGate: Object.freeze({ runs: gateRuns.length, ...durationStats(runDurations(gateRuns)) }),
    draft: Object.freeze({ runs: draftRuns.length, ...durationStats(runDurations(draftRuns)) }),
    jobs: jobTimingStats(jobsByRunId),
    failureCauses: Object.freeze(failureCauses(observed, jobsByRunId)),
  };
  report.budgetViolations = budgetViolations(report);
  return Object.freeze(report);
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
    `- Same SHA washed green: ${report.sameShaWashGreen || 0}`,
    `- Product-contract retries/flakes: ${report.blockingProductRetries || 0}`,
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
    "## Budget",
    ...((report.budgetViolations || []).length > 0
      ? report.budgetViolations.map((item) => (
        `- ${item.blocking ? "blocking" : "watch"} \`${item.code}\`: ${item.actual} (limit ${item.limit})`
      ))
      : ["- none"]),
    "",
  ].join("\n");
}

function parseOptions(argv) {
  const options = {
    repository: "",
    days: DEFAULT_DAYS,
    tokenEnv: "GITHUB_TOKEN",
    output: "output/ci-health/ci-health.json",
    createIssue: false,
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--days") options.days = Number(value);
    else if (argument === "--token-env") options.tokenEnv = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--create-issue") options.createIssue = value === "true";
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

async function githubJson(url, token, { method = "GET", body } = {}) {
  const response = await globalThis.fetch(url, {
    method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const responseBody = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${url}: ${responseBody}`);
  }
  if (response.status === 204) return null;
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

export function ciHealthIssueBodies(report) {
  const violations = report.budgetViolations || [];
  const blocking = violations.filter((item) => item.blocking);
  const lines = [
    "PageRoot CI health found repeated blocking budget violations.",
    "",
    ...blocking.map((item) => `- \`${item.code}\`: ${item.actual} (limit ${item.limit})`),
    "",
    "This issue is opened only after two consecutive weekly reports share a blocking code.",
    "It does not fail `release-gate`.",
  ];
  return Object.freeze({
    watchTitle: "[CI health] blocking budget exceeded (week 1)",
    issueTitle: "[CI health] blocking budget exceeded for two consecutive weeks",
    body: lines.join("\n"),
    watchLabels: Object.freeze(["ci-health-watch"]),
    issueLabels: Object.freeze(["ci-health"]),
  });
}

async function syncCiHealthIssue(repository, token, report) {
  const blocking = (report.budgetViolations || []).filter((item) => item.blocking);
  if (blocking.length === 0) return null;
  const apiBase = `https://api.github.com/repos/${repository}`;
  const [openWatch, openHealth] = await Promise.all([
    githubJson(`${apiBase}/issues?labels=ci-health-watch&state=open&per_page=10`, token),
    githubJson(`${apiBase}/issues?labels=ci-health&state=open&per_page=10`, token),
  ]);
  const bodies = ciHealthIssueBodies(report);
  const watchIssues = Array.isArray(openWatch) ? openWatch : [];
  const healthIssues = Array.isArray(openHealth) ? openHealth : [];
  if (healthIssues.length > 0) {
    const existing = healthIssues[0];
    await githubJson(`${apiBase}/issues/${existing.number}/comments`, token, {
      method: "POST",
      body: { body: bodies.body },
    });
    return existing;
  }
  if (watchIssues.length === 0) {
    return await githubJson(`${apiBase}/issues`, token, {
      method: "POST",
      body: {
        title: bodies.watchTitle,
        body: bodies.body,
        labels: [...bodies.watchLabels],
      },
    });
  }
  const created = await githubJson(`${apiBase}/issues`, token, {
    method: "POST",
    body: {
      title: bodies.issueTitle,
      body: bodies.body,
      labels: [...bodies.issueLabels],
    },
  });
  await githubJson(`${apiBase}/issues/${watchIssues[0].number}`, token, {
    method: "PATCH",
    body: { state: "closed" },
  });
  return created;
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
  if (options.createIssue === true) {
    const issue = await syncCiHealthIssue(options.repository, token, report).catch((error) => {
      console.warn(`CI health issue sync skipped: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    });
    if (issue?.html_url) console.log(`CI health issue: ${issue.html_url}`);
  }
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
