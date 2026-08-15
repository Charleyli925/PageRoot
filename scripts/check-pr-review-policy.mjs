#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const POLICY_VERSION = "2026-08-15.1";
const PRIORITY_BADGE_PATTERN = /\bP([0-3])\s+Badge\b/giu;
const PRIORITY_LINE_PATTERN = /(?:^|\r?\n)\s*(?:[-*]\s*)?(?:\*\*)?\[?P([0-3])\]?(?:\*\*)?\s*[:：-]/gimu;
const GITHUB_API_VERSION = "2022-11-28";
const MAX_REST_PAGES = 20;

function normalizedLogin(value) {
  return String(value || "").toLowerCase().replace(/\[bot\]$/u, "");
}

function actorLogin(value) {
  return value?.user?.login || value?.author?.login || value?.author || "";
}

function assertSha(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA_PATTERN.test(normalized)) throw new Error(`${label} must be a 40-character Git SHA.`);
  return normalized;
}

export function classifyReviewPriority(body) {
  let highestRank = Number.POSITIVE_INFINITY;
  const text = String(body || "");
  for (const pattern of [PRIORITY_BADGE_PATTERN, PRIORITY_LINE_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      highestRank = Math.min(highestRank, Number(match[1]));
    }
  }
  return Number.isFinite(highestRank) ? `P${highestRank}` : "unclassified";
}

function threadComments(thread) {
  if (Array.isArray(thread?.comments)) return thread.comments;
  return thread?.comments?.nodes || [];
}

export function classifyReviewThread(thread) {
  const original = threadComments(thread)[0];
  if (!original) {
    return Object.freeze({
      kind: "review_thread",
      priority: "unclassified",
      state: "ignored",
      reason: "thread_without_comment",
    });
  }
  const priority = classifyReviewPriority(original.body);
  const active = !(thread?.isResolved === true || thread?.is_resolved === true)
    && !(thread?.isOutdated === true || thread?.is_outdated === true);
  const finding = Object.freeze({
    kind: "review_thread",
    priority,
    active,
    actor: normalizedLogin(actorLogin(original)) || "unknown",
    path: original.path || null,
    commentId: original.databaseId || original.id || null,
  });
  if (!active) {
    return Object.freeze({ ...finding, state: "ignored", reason: "resolved_or_outdated" });
  }
  if (priority === "P0" || priority === "P1") {
    return Object.freeze({ ...finding, state: "informational", reason: "active_user_impact_finding" });
  }
  return Object.freeze({ ...finding, state: "informational", reason: "non_blocking_finding" });
}

export function summarizeReviewSnapshot(result) {
  return Object.freeze({
    status: result.status,
    reason: result.reason,
    expectedHeadSha: result.expectedHeadSha,
    currentHeadSha: result.currentHeadSha,
    p0p1Count: result.p0p1Findings.length,
    otherCount: result.otherFindings.length,
  });
}

function parseOptions(argv) {
  const options = {
    repository: "",
    pullRequest: 0,
    expectedHeadSha: "",
    expectedBaseSha: "",
    tokenEnv: "GITHUB_TOKEN",
    output: "output/review-policy/review-policy.json",
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--pull-request") options.pullRequest = Number(value);
    else if (argument === "--expected-head") options.expectedHeadSha = value;
    else if (argument === "--expected-base") options.expectedBaseSha = value;
    else if (argument === "--token-env") options.tokenEnv = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--mode" || argument === "--settle-seconds" || argument === "--timeout-seconds" || argument === "--poll-seconds" || argument === "--github-output") {
      continue;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!REPOSITORY_PATTERN.test(options.repository)) throw new Error("--repository must use owner/name.");
  if (!Number.isInteger(options.pullRequest) || options.pullRequest <= 0) {
    throw new Error("--pull-request must be a positive integer.");
  }
  options.expectedHeadSha = assertSha(options.expectedHeadSha, "--expected-head");
  options.expectedBaseSha = assertSha(options.expectedBaseSha, "--expected-base");
  return options;
}

async function githubJson(url, token, init = {}) {
  const response = await globalThis.fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${url}: ${body}`);
  }
  return await response.json();
}

async function restPages(apiBase, apiPath, token) {
  const entries = [];
  for (let page = 1; page <= MAX_REST_PAGES; page += 1) {
    const separator = apiPath.includes("?") ? "&" : "?";
    const response = await githubJson(
      `${apiBase}${apiPath}${separator}per_page=100&page=${page}`,
      token,
    );
    if (!Array.isArray(response)) throw new Error(`Expected an array from ${apiPath}.`);
    entries.push(...response);
    if (response.length < 100) return entries;
  }
  throw new Error(`GitHub API pagination exceeded ${MAX_REST_PAGES} pages for ${apiPath}.`);
}

export function evaluateReviewSnapshot({
  expectedHeadSha,
  expectedBaseSha,
  pullRequest,
  reviewThreads = [],
} = {}) {
  const expectedHead = assertSha(expectedHeadSha, "expectedHeadSha");
  const expectedBase = assertSha(expectedBaseSha, "expectedBaseSha");
  const currentHeadSha = String(pullRequest?.head?.sha || "").toLowerCase() || null;
  const currentBaseSha = String(pullRequest?.base?.sha || "").toLowerCase() || null;
  const findings = (reviewThreads || []).map(classifyReviewThread);
  const p0p1Findings = findings.filter((finding) => finding.priority === "P0" || finding.priority === "P1");
  const otherFindings = findings.filter((finding) => finding.priority !== "P0" && finding.priority !== "P1" && finding.state !== "ignored");
  return Object.freeze({
    schemaVersion: 1,
    policyVersion: POLICY_VERSION,
    status: "reported",
    reason: "informational_review_snapshot",
    blocking: false,
    expectedHeadSha: expectedHead,
    currentHeadSha,
    expectedBaseSha: expectedBase,
    currentBaseSha,
    p0p1Findings,
    otherFindings,
  });
}

export async function writeReviewPolicyArtifact(result, output = "output/review-policy/review-policy.json") {
  const destination = path.resolve(productRoot, output);
  if (destination !== productRoot && !destination.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error("--output must remain inside the repository.");
  }
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return destination;
}

async function collectSnapshot(options, token) {
  const apiBase = `https://api.github.com/repos/${options.repository}`;
  const pullRequest = await githubJson(`${apiBase}/pulls/${options.pullRequest}`, token);
  const comments = await restPages(apiBase, `/pulls/${options.pullRequest}/comments`, token);
  const reviewThreads = comments.map((comment) => ({
    isResolved: false,
    isOutdated: Boolean(comment?.position == null && comment?.original_position != null),
    comments: [comment],
  }));
  return { pullRequest, reviewThreads };
}

async function run(options) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  let result;
  try {
    const snapshot = await collectSnapshot(options, token);
    result = evaluateReviewSnapshot({
      expectedHeadSha: options.expectedHeadSha,
      expectedBaseSha: options.expectedBaseSha,
      ...snapshot,
    });
  } catch (error) {
    console.warn(`Review snapshot is temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`);
    result = evaluateReviewSnapshot({
      expectedHeadSha: options.expectedHeadSha,
      expectedBaseSha: options.expectedBaseSha,
      pullRequest: {
        head: { sha: options.expectedHeadSha },
        base: { sha: options.expectedBaseSha },
      },
      reviewThreads: [],
    });
    result = Object.freeze({
      ...result,
      reason: "github_evidence_unavailable",
    });
  }
  const destination = await writeReviewPolicyArtifact(result, options.output);
  console.log(JSON.stringify(summarizeReviewSnapshot(result), null, 2));
  console.log(`Review snapshot: ${destination}`);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run(parseOptions(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
