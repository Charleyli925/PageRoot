#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { classifyReviewState, classifyReviewThread } from "./check-pr-review-policy.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MARKER = "<!-- pageroot-review-debt -->";
const DEFAULT_TITLE = "[Review debt] P2/P3 and deferred findings";
const DEFAULT_DAYS = 7;
const MAX_PULL_REQUESTS = 100;
const MAX_PULL_REQUEST_PAGES = 10;
const MAX_REVIEW_PAGES = 10;
const MAX_ISSUE_PAGES = 10;

function priorityOrder(priority) {
  return ({ P2: 0, P3: 1, unclassified: 2 })[priority] ?? 3;
}

function normalizeFinding({ pullRequest, finding }) {
  return Object.freeze({
    pullRequestNumber: Number(pullRequest?.number),
    pullRequestUrl: pullRequest?.html_url || pullRequest?.url || null,
    pullRequestTitle: pullRequest?.title || "Untitled Pull Request",
    updatedAt: pullRequest?.updated_at || pullRequest?.updatedAt || null,
    priority: finding.priority,
    findingKind: finding.kind || "unknown",
    path: finding.path || null,
    commentId: finding.commentId || null,
    reviewId: finding.reviewId || null,
    reviewState: finding.reviewState || null,
    commitSha: finding.commitSha || null,
    actor: finding.actor || "unknown",
    reason: finding.reason,
  });
}

export function summarizeReviewDebt({ pullRequests = [], generatedAt = new Date().toISOString(), periodDays = DEFAULT_DAYS } = {}) {
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 31) {
    throw new Error("periodDays must be an integer from 1 to 31.");
  }
  const findings = (pullRequests || []).flatMap((pullRequest) => {
    const threadFindings = (pullRequest.reviewThreads || pullRequest.review_threads || [])
      .map(classifyReviewThread)
      .filter((finding) => finding.state === "non_blocking")
      .map((finding) => normalizeFinding({ pullRequest, finding }));
    const reviewFindings = (pullRequest.reviews || [])
      .map(classifyReviewState)
      .filter((finding) => finding.state === "non_blocking" && finding.reason === "deferred_changes_requested")
      .map((finding) => normalizeFinding({ pullRequest, finding }));
    return [...threadFindings, ...reviewFindings];
  }).sort((left, right) => (
    priorityOrder(left.priority) - priorityOrder(right.priority)
    || Number(left.pullRequestNumber) - Number(right.pullRequestNumber)
    || String(left.path || "").localeCompare(String(right.path || ""))
  ));
  const counts = findings.reduce((result, finding) => {
    result[finding.priority] = (result[finding.priority] || 0) + 1;
    return result;
  }, { P2: 0, P3: 0, unclassified: 0 });
  return Object.freeze({
    schemaVersion: 1,
    generatedAt,
    periodDays,
    pullRequestsScanned: (pullRequests || []).length,
    totalDeferredFindings: findings.length,
    priorityCounts: counts,
    findings,
  });
}

export function renderReviewDebtMarkdown(report) {
  const rows = report.findings.length === 0
    ? ["| — | — | — | — | — |", "| No current deferred findings | — | — | — | — |"]
    : report.findings.map((finding) => {
      const pr = finding.pullRequestUrl
        ? `[#${finding.pullRequestNumber}](${finding.pullRequestUrl})`
        : `#${finding.pullRequestNumber}`;
      return `| ${pr} | ${finding.priority} | ${finding.path || "repository-wide"} | ${finding.actor} | ${finding.reason} |`;
    });
  return [
    MARKER,
    "# Review debt (weekly rolling)",
    "",
    "This issue is an operational backlog, not a merge blocker. It retains deferred inline-thread and review-level findings; only active P0/P1 findings or P0/P1 changes-requested reviews remain blocking in the PR review policy.",
    "",
    `- Window: last ${report.periodDays} days`,
    `- Generated: ${report.generatedAt}`,
    `- Recent PRs scanned: ${report.pullRequestsScanned}`,
    `- Deferred findings: ${report.totalDeferredFindings} (P2 ${report.priorityCounts.P2}, P3 ${report.priorityCounts.P3}, unclassified ${report.priorityCounts.unclassified})`,
    "",
    "| Pull Request | Priority | Path | Reporter | Policy treatment |",
    "| --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "Triage these findings in focused maintenance work. Do not add code, change a PR, or merge anything from this workflow.",
    "",
  ].join("\n");
}

function resolveOutputPath(output) {
  const destination = path.resolve(productRoot, output);
  if (destination !== productRoot && !destination.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error("--output must remain inside the repository.");
  }
  return destination;
}

export async function writeReviewDebtArtifact(report, output = "output/review-debt/review-debt.json") {
  const destination = resolveOutputPath(output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return destination;
}

function parseOptions(argv) {
  const options = {
    command: "sync",
    repository: process.env.GITHUB_REPOSITORY || "",
    tokenEnv: "GITHUB_TOKEN",
    days: DEFAULT_DAYS,
    title: DEFAULT_TITLE,
    output: "output/review-debt/review-debt.json",
    githubOutput: process.env.GITHUB_OUTPUT || "",
    dryRun: false,
  };
  if (argv[0] && !argv[0].startsWith("--")) options.command = argv.shift();
  while (argv.length > 0) {
    const argument = argv.shift();
    if (argument === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--token-env") options.tokenEnv = value;
    else if (argument === "--days") options.days = Number(value);
    else if (argument === "--title") options.title = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--github-output") options.githubOutput = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.command !== "sync") throw new Error("Usage: review-debt.mjs sync [options]");
  if (!REPOSITORY_PATTERN.test(options.repository)) throw new Error("--repository must use owner/name.");
  if (!Number.isInteger(options.days) || options.days < 1 || options.days > 31) throw new Error("--days must be an integer from 1 to 31.");
  resolveOutputPath(options.output);
  return options;
}

async function githubJson(apiBase, apiPath, token, init = {}) {
  const response = await globalThis.fetch(`${apiBase}${apiPath}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${apiPath}: ${body}`);
  }
  return await response.json();
}

async function githubArrayPages({ apiBase, apiPath, token, maxPages, label }) {
  const entries = [];
  const separator = apiPath.includes("?") ? "&" : "?";
  for (let page = 1; page <= maxPages; page += 1) {
    const response = await githubJson(
      apiBase,
      `${apiPath}${separator}per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(response)) throw new Error(`Expected a ${label} array from GitHub.`);
    entries.push(...response);
    if (response.length < 100) return entries;
  }
  throw new Error(`${label} pagination exceeded ${maxPages * 100} entries.`);
}

async function graphqlThreads({ graphqlUrl, owner, name, number, token }) {
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $after) {
            nodes {
              isResolved isOutdated
              comments(first: 20) { nodes { databaseId path body author { login } } }
            }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    }
  `;
  const threads = [];
  let after = null;
  for (;;) {
    const response = await globalThis.fetch(graphqlUrl, {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query, variables: { owner, name, number, after } }),
    });
    if (!response.ok) throw new Error(`GitHub GraphQL ${response.status} while reading PR #${number}.`);
    const payload = await response.json();
    if (payload.errors?.length) throw new Error(`GitHub GraphQL: ${payload.errors.map((error) => error.message).join("; ")}`);
    const connection = payload?.data?.repository?.pullRequest?.reviewThreads;
    if (!connection) throw new Error(`Review threads unavailable for PR #${number}.`);
    threads.push(...(connection.nodes || []));
    if (!connection.pageInfo?.hasNextPage) return threads;
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error(`Review-thread pagination omitted endCursor for PR #${number}.`);
  }
}

async function collectRecentPullRequests({ repository, token, days }) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const graphqlUrl = process.env.GITHUB_GRAPHQL_URL || `${apiBase.replace(/\/api\/v3$/u, "/api")}/graphql`;
  const [owner, name] = repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const sinceMs = Date.now() - days * 24 * 60 * 60 * 1000;
  const recent = [];
  for (let page = 1; page <= MAX_PULL_REQUEST_PAGES; page += 1) {
    const pulls = await githubJson(
      apiBase,
      `/repos/${repositoryPath}/pulls?state=all&sort=updated&direction=desc&per_page=${MAX_PULL_REQUESTS}&page=${page}`,
      token,
    );
    if (!Array.isArray(pulls)) throw new Error("Expected a Pull Request array from GitHub.");
    const updatedAt = pulls.map((pullRequest) => Date.parse(pullRequest.updated_at || ""));
    recent.push(...pulls.filter((pullRequest) => {
      const updatedMs = Date.parse(pullRequest.updated_at || "");
      return Number.isFinite(updatedMs) && updatedMs >= sinceMs;
    }));
    const oldest = updatedAt.filter(Number.isFinite).sort((left, right) => left - right)[0];
    if (pulls.length < MAX_PULL_REQUESTS || (Number.isFinite(oldest) && oldest < sinceMs)) break;
    if (page === MAX_PULL_REQUEST_PAGES) {
      throw new Error(`Pull Request debt window exceeded ${MAX_PULL_REQUEST_PAGES * MAX_PULL_REQUESTS} entries.`);
    }
  }
  const enriched = await Promise.all(recent.map(async (pullRequest) => {
    const [reviewThreads, reviews] = await Promise.all([
      graphqlThreads({ graphqlUrl, owner, name, number: pullRequest.number, token }),
      githubArrayPages({
        apiBase,
        apiPath: `/repos/${repositoryPath}/pulls/${pullRequest.number}/reviews`,
        token,
        maxPages: MAX_REVIEW_PAGES,
        label: `Pull Request #${pullRequest.number} review`,
      }),
    ]);
    return { ...pullRequest, reviewThreads, reviews };
  }));
  return { apiBase, repositoryPath, pullRequests: enriched };
}

async function findRollingIssue({ apiBase, repositoryPath, token }) {
  for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
    const issues = await githubJson(apiBase, `/repos/${repositoryPath}/issues?state=open&per_page=100&page=${page}`, token);
    if (!Array.isArray(issues)) throw new Error("Expected an issue array from GitHub.");
    const match = issues.find((issue) => !issue.pull_request && String(issue.body || "").includes(MARKER));
    if (match) return match;
    if (issues.length < 100) return null;
  }
  throw new Error(`Open issue search exceeded ${MAX_ISSUE_PAGES * 100} entries.`);
}

async function updateRollingIssue({ apiBase, repositoryPath, token, title, body }) {
  const existing = await findRollingIssue({ apiBase, repositoryPath, token });
  if (existing) {
    const issue = await githubJson(apiBase, `/repos/${repositoryPath}/issues/${existing.number}`, token, {
      method: "PATCH",
      body: JSON.stringify({ title, body }),
    });
    return Object.freeze({ action: "updated", number: issue.number, url: issue.html_url || null });
  }
  const issue = await githubJson(apiBase, `/repos/${repositoryPath}/issues`, token, {
    method: "POST",
    body: JSON.stringify({ title, body }),
  });
  return Object.freeze({ action: "created", number: issue.number, url: issue.html_url || null });
}

async function writeGithubOutput(destination, values) {
  if (!destination) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value ?? "").replaceAll("\r", "").replaceAll("\n", "")}`);
  await appendFile(destination, `${lines.join("\n")}\n`, "utf8");
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  const collected = await collectRecentPullRequests({ repository: options.repository, token, days: options.days });
  const report = summarizeReviewDebt({ pullRequests: collected.pullRequests, periodDays: options.days });
  const destination = await writeReviewDebtArtifact(report, options.output);
  const body = renderReviewDebtMarkdown(report);
  const issue = options.dryRun
    ? Object.freeze({ action: "dry_run", number: null, url: null })
    : await updateRollingIssue({
      apiBase: collected.apiBase,
      repositoryPath: collected.repositoryPath,
      token,
      title: options.title,
      body,
    });
  await writeGithubOutput(options.githubOutput, {
    artifact_path: destination,
    deferred_findings: report.totalDeferredFindings,
    issue_action: issue.action,
    issue_number: issue.number || "",
    issue_url: issue.url || "",
  });
  console.log(body);
  console.log(`Review debt artifact: ${destination}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
