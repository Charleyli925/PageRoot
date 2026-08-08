#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyReviewState,
  classifyReviewThread,
  latestEffectiveReviews,
} from "./check-pr-review-policy.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const MARKER = "<!-- pageroot-review-debt -->";
const STATE_MARKER_PREFIX = "<!-- pageroot-review-debt-state:";
const STATE_MARKER_PATTERN = /<!-- pageroot-review-debt-state:([A-Za-z0-9_-]+) -->/u;
const DEFAULT_TITLE = "[Review debt] P2/P3 and deferred findings";
const DEFAULT_DAYS = 7;
const MAX_PULL_REQUESTS = 100;
const MAX_PULL_REQUEST_PAGES = 10;
const MAX_REVIEW_PAGES = 10;
const MAX_ISSUE_PAGES = 10;

function priorityOrder(priority) {
  return ({ P2: 0, P3: 1, unclassified: 2 })[priority] ?? 3;
}

function findingKey(finding) {
  const identifier = finding.commentId || finding.reviewId;
  const fallback = [
    finding.path || "repository-wide",
    finding.actor || "unknown",
    finding.priority || "unclassified",
    finding.commitSha || "no-commit",
  ].join(":");
  return [
    Number(finding.pullRequestNumber),
    finding.findingKind || "unknown",
    identifier ? `id:${identifier}` : fallback,
  ].join("/");
}

function sortFindings(left, right) {
  return (
    priorityOrder(left.priority) - priorityOrder(right.priority)
    || Number(left.pullRequestNumber) - Number(right.pullRequestNumber)
    || String(left.path || "").localeCompare(String(right.path || ""))
    || String(left.actor || "").localeCompare(String(right.actor || ""))
  );
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

function normalizeStoredFinding(finding) {
  const pullRequestNumber = Number(finding?.pullRequestNumber);
  if (!Number.isInteger(pullRequestNumber) || pullRequestNumber < 1) {
    throw new Error("Stored review-debt finding has no valid Pull Request number.");
  }
  const priority = ["P2", "P3", "unclassified"].includes(finding?.priority)
    ? finding.priority
    : "unclassified";
  return Object.freeze({
    pullRequestNumber,
    pullRequestUrl: finding?.pullRequestUrl || null,
    pullRequestTitle: finding?.pullRequestTitle || "Untitled Pull Request",
    updatedAt: finding?.updatedAt || null,
    priority,
    findingKind: finding?.findingKind || "unknown",
    path: finding?.path || null,
    commentId: finding?.commentId || null,
    reviewId: finding?.reviewId || null,
    reviewState: finding?.reviewState || null,
    commitSha: finding?.commitSha || null,
    actor: finding?.actor || "unknown",
    reason: finding?.reason || "deferred_review_debt",
    firstObservedAt: finding?.firstObservedAt || null,
    lastObservedAt: finding?.lastObservedAt || null,
    source: finding?.source === "carried_forward" ? "carried_forward" : "current_window",
  });
}

function countsFor(findings) {
  return findings.reduce((result, finding) => {
    result[finding.priority] = (result[finding.priority] || 0) + 1;
    return result;
  }, { P2: 0, P3: 0, unclassified: 0 });
}

export function summarizeReviewDebt({
  pullRequests = [],
  retainedFindings = [],
  generatedAt = new Date().toISOString(),
  periodDays = DEFAULT_DAYS,
} = {}) {
  if (!Number.isInteger(periodDays) || periodDays < 1 || periodDays > 31) {
    throw new Error("periodDays must be an integer from 1 to 31.");
  }
  const currentFindings = (pullRequests || []).flatMap((pullRequest) => {
    const threadFindings = (pullRequest.reviewThreads || pullRequest.review_threads || [])
      .map(classifyReviewThread)
      .filter((finding) => finding.state === "non_blocking")
      .map((finding) => normalizeFinding({ pullRequest, finding }));
    const expectedHeadSha = pullRequest?.head?.sha || pullRequest?.headSha || pullRequest?.headRefOid || null;
    const reviewFindings = latestEffectiveReviews(pullRequest.reviews || [], { expectedHeadSha })
      .map(classifyReviewState)
      .filter((finding) => finding.state === "non_blocking" && finding.reason === "deferred_changes_requested")
      .map((finding) => normalizeFinding({ pullRequest, finding }));
    return [...threadFindings, ...reviewFindings];
  });
  const previousByKey = new Map((retainedFindings || [])
    .map(normalizeStoredFinding)
    .map((finding) => [findingKey(finding), finding]));
  const currentKeys = new Set(currentFindings.map(findingKey));
  const scannedPullRequestNumbers = new Set((pullRequests || [])
    .map((pullRequest) => Number(pullRequest?.number))
    .filter((number) => Number.isInteger(number) && number > 0));
  const observed = currentFindings.map((finding) => {
    const previous = previousByKey.get(findingKey(finding));
    return Object.freeze({
      ...finding,
      firstObservedAt: previous?.firstObservedAt || generatedAt,
      lastObservedAt: generatedAt,
      source: "current_window",
    });
  });
  const carriedForward = [...previousByKey.values()]
    .filter((finding) => (
      !currentKeys.has(findingKey(finding))
      && !scannedPullRequestNumbers.has(finding.pullRequestNumber)
    ))
    .map((finding) => Object.freeze({
      ...finding,
      source: "carried_forward",
    }));
  const findings = [...observed, ...carriedForward].sort(sortFindings);
  const counts = countsFor(findings);
  return Object.freeze({
    schemaVersion: 2,
    generatedAt,
    periodDays,
    pullRequestsScanned: (pullRequests || []).length,
    totalDeferredFindings: findings.length,
    currentWindowFindings: observed.length,
    carriedForwardFindings: carriedForward.length,
    priorityCounts: counts,
    findings,
  });
}

export function parseReviewDebtState(markdown) {
  const body = String(markdown || "");
  const match = body.match(STATE_MARKER_PATTERN);
  if (!match) return null;
  let state;
  try {
    state = JSON.parse(Buffer.from(match[1], "base64url").toString("utf8"));
  } catch (error) {
    throw new Error(`Review-debt issue state is invalid: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (state?.schemaVersion !== 1 || !Array.isArray(state?.findings)) {
    throw new Error("Review-debt issue state has an unsupported schema.");
  }
  return Object.freeze({
    schemaVersion: state.schemaVersion,
    findings: state.findings.map(normalizeStoredFinding),
  });
}

function stateMarker(report) {
  const state = JSON.stringify({
    schemaVersion: 1,
    findings: report.findings,
  });
  return `${STATE_MARKER_PREFIX}${Buffer.from(state, "utf8").toString("base64url")} -->`;
}

export function renderReviewDebtMarkdown(report) {
  const rows = report.findings.length === 0
    ? ["| — | — | — | — | — | — |", "| No deferred findings | — | — | — | — | — |"]
    : report.findings.map((finding) => {
      const pr = finding.pullRequestUrl
        ? `[#${finding.pullRequestNumber}](${finding.pullRequestUrl})`
        : `#${finding.pullRequestNumber}`;
      const source = finding.source === "carried_forward" ? "carried forward" : "current window";
      return `| ${pr} | ${finding.priority} | ${finding.path || "repository-wide"} | ${finding.actor} | ${source} | ${finding.reason} |`;
    });
  return [
    MARKER,
    "# Review debt (weekly rolling)",
    "",
    "This issue is an operational backlog, not a merge blocker. It retains deferred inline-thread and review-level findings; only active P0/P1 findings or P0/P1 changes-requested reviews remain blocking in the PR review policy. A finding that ages out of the seven-day activity scan is carried forward rather than silently discarded; it is removed when its Pull Request is scanned again and the finding is no longer active.",
    "",
    `- Window: last ${report.periodDays} days`,
    `- Generated: ${report.generatedAt}`,
    `- Recent PRs scanned: ${report.pullRequestsScanned}`,
    `- Deferred findings: ${report.totalDeferredFindings} (P2 ${report.priorityCounts.P2}, P3 ${report.priorityCounts.P3}, unclassified ${report.priorityCounts.unclassified})`,
    `- Current-window findings: ${report.currentWindowFindings}; carried forward: ${report.carriedForwardFindings}`,
    "",
    "| Pull Request | Priority | Path | Reporter | Presence | Policy treatment |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
    "Triage these findings in focused maintenance work. Do not add code, change a PR, or merge anything from this workflow.",
    "",
    stateMarker(report),
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

async function updateRollingIssue({ apiBase, repositoryPath, token, title, body, existing }) {
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
  const existing = await findRollingIssue({
    apiBase: collected.apiBase,
    repositoryPath: collected.repositoryPath,
    token,
  });
  const previousState = existing ? parseReviewDebtState(existing.body) : null;
  const report = summarizeReviewDebt({
    pullRequests: collected.pullRequests,
    retainedFindings: previousState?.findings || [],
    periodDays: options.days,
  });
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
      existing,
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
