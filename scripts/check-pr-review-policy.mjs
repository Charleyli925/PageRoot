#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const CODEX_LOGIN = "chatgpt-codex-connector";
const DEFAULT_SETTLE_SECONDS = 30;
const DEFAULT_TIMEOUT_SECONDS = 15 * 60;
const DEFAULT_POLL_SECONDS = 15;
const MAX_REST_PAGES = 20;
const POLICY_VERSION = "2026-08-09";
const PRIORITY_PATTERN = /\bP([0-3])(?:\s+Badge|\b)/giu;
const REVIEWED_COMMIT_PATTERN = /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,40})`/iu;
const CLEAN_COMPLETION_PATTERN = /^Codex Review:\s*Didn't find any major issues\.[^\r\n]*\r?\n\r?\n/iu;

function normalizedLogin(value) {
  return String(value || "").toLowerCase().replace(/\[bot\]$/u, "");
}

function isCodexActor(value) {
  return normalizedLogin(value) === CODEX_LOGIN;
}

function actorLogin(value) {
  return value?.user?.login || value?.author?.login || value?.author || "";
}

function timestamp(value) {
  const milliseconds = Date.parse(value || "");
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function assertSha(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 40-character lowercase Git SHA.`);
  }
  return normalized;
}

function inOpenInterval(value, after, before = Number.POSITIVE_INFINITY) {
  return Number.isFinite(value) && value > after && value < before;
}

function reviewSubmittedAt(review) {
  return timestamp(review?.submitted_at || review?.submittedAt);
}

function reviewCommitSha(review) {
  return String(
    review?.commit_id || review?.commit?.oid || review?.commitSha || "",
  ).toLowerCase();
}

function threadComments(thread) {
  if (Array.isArray(thread?.comments)) return thread.comments;
  return thread?.comments?.nodes || [];
}

function pullRequestHeadSha(pullRequest) {
  return String(
    pullRequest?.head?.sha || pullRequest?.headRefOid || pullRequest?.headSha || "",
  ).toLowerCase();
}

function pullRequestBaseSha(pullRequest) {
  return String(
    pullRequest?.base?.sha || pullRequest?.baseRefOid || pullRequest?.baseSha || "",
  ).toLowerCase();
}

export function classifyReviewPriority(body) {
  let highestRank = Number.POSITIVE_INFINITY;
  for (const match of String(body || "").matchAll(PRIORITY_PATTERN)) {
    highestRank = Math.min(highestRank, Number(match[1]));
  }
  return Number.isFinite(highestRank) ? `P${highestRank}` : "unclassified";
}

export function reviewedCommitPrefix(body) {
  return String(body || "").match(REVIEWED_COMMIT_PATTERN)?.[1]?.toLowerCase() || null;
}

export function classifyReviewThread(thread) {
  const original = threadComments(thread)[0];
  if (!original) {
    return Object.freeze({ kind: "review_thread", priority: "unclassified", state: "ignored", reason: "thread_without_comment" });
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
  if (!active) return Object.freeze({ ...finding, state: "ignored", reason: "resolved_or_outdated" });
  if (priority === "P0" || priority === "P1") {
    return Object.freeze({ ...finding, state: "blocking", reason: "active_user_impact_finding" });
  }
  return Object.freeze({ ...finding, state: "non_blocking", reason: "deferred_review_debt" });
}

export function classifyReviewState(review) {
  const state = String(review?.state || "").toUpperCase();
  const priority = classifyReviewPriority(review?.body);
  const actor = normalizedLogin(actorLogin(review)) || "unknown";
  const finding = Object.freeze({
    kind: "pull_request_review",
    reviewId: review?.id || review?.databaseId || null,
    actor,
    reviewState: state || "UNKNOWN",
    priority,
    commitSha: reviewCommitSha(review) || null,
  });
  if (state !== "CHANGES_REQUESTED") {
    return Object.freeze({ ...finding, state: "non_blocking", reason: "review_not_changes_requested" });
  }
  if (priority === "P0" || priority === "P1") {
    return Object.freeze({ ...finding, state: "blocking", reason: "user_impact_changes_requested" });
  }
  return Object.freeze({ ...finding, state: "non_blocking", reason: "deferred_changes_requested" });
}

function latestReadyForReviewEvent(timelineEvents) {
  return (timelineEvents || [])
    .filter((event) => (
      event?.event === "ready_for_review"
      && Number.isFinite(timestamp(event?.created_at || event?.createdAt))
    ))
    .sort((left, right) => (
      timestamp(right?.created_at || right?.createdAt)
      - timestamp(left?.created_at || left?.createdAt)
    ))[0] || null;
}

function completionSignal(review, expectedHeadSha, readyAt) {
  const submittedAt = reviewSubmittedAt(review);
  const state = String(review?.state || "").toUpperCase();
  const commitSha = reviewCommitSha(review);
  const prefix = reviewedCommitPrefix(review?.body);
  if (
    !isCodexActor(actorLogin(review))
    || !["APPROVED", "COMMENTED", "CHANGES_REQUESTED"].includes(state)
    || commitSha !== expectedHeadSha
    || !prefix
    || !expectedHeadSha.startsWith(prefix)
    || !inOpenInterval(submittedAt, readyAt)
  ) return null;
  return Object.freeze({
    kind: "codex_review",
    id: review?.id || review?.databaseId || null,
    at: submittedAt,
    reviewState: state,
  });
}

function completionCommentSignal(comment, expectedHeadSha, readyAt) {
  const createdAt = timestamp(comment?.created_at || comment?.createdAt);
  const updatedAt = timestamp(comment?.updated_at || comment?.updatedAt || comment?.created_at || comment?.createdAt);
  const lastEditedAt = comment?.last_edited_at || comment?.lastEditedAt || null;
  const prefix = reviewedCommitPrefix(comment?.body);
  if (
    !isCodexActor(actorLogin(comment))
    || Boolean(lastEditedAt)
    || createdAt !== updatedAt
    || !CLEAN_COMPLETION_PATTERN.test(String(comment?.body || ""))
    || !prefix
    || !expectedHeadSha.startsWith(prefix)
    || !inOpenInterval(createdAt, readyAt)
  ) return null;
  return Object.freeze({
    kind: "codex_clean_comment",
    id: comment?.id || comment?.databaseId || null,
    at: createdAt,
    reviewState: "COMMENTED",
  });
}

function findingSummary(finding) {
  const at = finding?.at;
  return Object.freeze({
    ...finding,
    ...(Number.isFinite(at) ? { at: new Date(at).toISOString() } : {}),
  });
}

function policyResult(identity, status, reason, fields = {}) {
  return Object.freeze({
    schemaVersion: 1,
    policyVersion: POLICY_VERSION,
    ...identity,
    status,
    reason,
    reviewCompletedAt: null,
    reviewLatencySeconds: null,
    readyAt: null,
    blockingFindings: [],
    nonBlockingFindings: [],
    ...fields,
  });
}

export function evaluateReviewPolicy({
  expectedHeadSha,
  expectedBaseSha,
  pullRequest,
  issueComments = [],
  timelineEvents = [],
  reviews = [],
  reviewThreads = [],
  now = new Date(),
  settleSeconds = DEFAULT_SETTLE_SECONDS,
}) {
  const expectedHead = assertSha(expectedHeadSha, "expectedHeadSha");
  const expectedBase = assertSha(expectedBaseSha, "expectedBaseSha");
  if (!Number.isFinite(settleSeconds) || settleSeconds < 0) {
    throw new Error("settleSeconds must be a non-negative number.");
  }
  const nowMs = now instanceof Date ? now.getTime() : timestamp(now);
  if (!Number.isFinite(nowMs)) throw new Error("now must be a valid date.");
  const currentHeadSha = pullRequestHeadSha(pullRequest);
  const currentBaseSha = pullRequestBaseSha(pullRequest);
  const identity = Object.freeze({
    expectedHeadSha: expectedHead,
    currentHeadSha: currentHeadSha || null,
    expectedBaseSha: expectedBase,
    currentBaseSha: currentBaseSha || null,
  });
  if (currentHeadSha !== expectedHead) return policyResult(identity, "blocked", "head_sha_changed");
  if (currentBaseSha !== expectedBase) return policyResult(identity, "blocked", "base_sha_changed");
  if (String(pullRequest?.state || "").toLowerCase() !== "open") {
    return policyResult(identity, "blocked", "pull_request_not_open");
  }
  if (pullRequest?.draft === true || pullRequest?.isDraft === true) {
    return policyResult(identity, "blocked", "pull_request_is_draft");
  }

  const readyEvent = latestReadyForReviewEvent(timelineEvents);
  if (!readyEvent) return policyResult(identity, "waiting", "ready_transition_missing");
  const readyAtMs = timestamp(readyEvent?.created_at || readyEvent?.createdAt);
  if (!Number.isFinite(readyAtMs)) return policyResult(identity, "blocked", "ready_transition_invalid");
  const readyAt = new Date(readyAtMs).toISOString();

  const reviewFindings = (reviews || [])
    .filter((review) => (
      reviewCommitSha(review) === expectedHead
      && inOpenInterval(reviewSubmittedAt(review), readyAtMs)
    ))
    .map(classifyReviewState);
  const threadFindings = (reviewThreads || []).map(classifyReviewThread);
  const blockingFindings = [
    ...reviewFindings.filter((finding) => finding.state === "blocking"),
    ...threadFindings.filter((finding) => finding.state === "blocking"),
  ].map(findingSummary);
  const nonBlockingFindings = [
    ...reviewFindings.filter((finding) => finding.state === "non_blocking" && finding.reason !== "review_not_changes_requested"),
    ...threadFindings.filter((finding) => finding.state === "non_blocking"),
  ].map(findingSummary);
  const completions = [
    ...(reviews || []).map((review) => completionSignal(review, expectedHead, readyAtMs)).filter(Boolean),
    ...(issueComments || []).map((comment) => completionCommentSignal(comment, expectedHead, readyAtMs)).filter(Boolean),
  ].sort((left, right) => right.at - left.at);
  const completion = completions[0] || null;
  const baseFields = {
    readyAt,
    blockingFindings,
    nonBlockingFindings,
    reviewCompletedAt: completion ? new Date(completion.at).toISOString() : null,
    reviewLatencySeconds: completion ? Math.max(0, Math.round((completion.at - readyAtMs) / 1000)) : null,
  };
  if (blockingFindings.length > 0) {
    return policyResult(identity, "blocked", "blocking_review_finding", baseFields);
  }
  if (!completion) return policyResult(identity, "waiting", "final_review_in_progress", baseFields);
  const settlesAtMs = completion.at + settleSeconds * 1000;
  if (nowMs < settlesAtMs) {
    return policyResult(identity, "waiting", "settle_window", {
      ...baseFields,
      settlesAt: new Date(settlesAtMs).toISOString(),
    });
  }
  return policyResult(identity, "passed", "final_review_policy_passed", {
    ...baseFields,
    settlesAt: new Date(settlesAtMs).toISOString(),
  });
}

export function summarizeReviewPolicy(result) {
  return Object.freeze({
    schemaVersion: result.schemaVersion,
    policyVersion: result.policyVersion,
    status: result.status,
    reason: result.reason,
    expectedHeadSha: result.expectedHeadSha,
    currentHeadSha: result.currentHeadSha,
    expectedBaseSha: result.expectedBaseSha,
    currentBaseSha: result.currentBaseSha,
    readyAt: result.readyAt,
    reviewCompletedAt: result.reviewCompletedAt,
    reviewLatencySeconds: result.reviewLatencySeconds,
    blockingFindings: result.blockingFindings,
    nonBlockingFindings: result.nonBlockingFindings,
  });
}

function resolveOutputPath(output) {
  const destination = path.resolve(productRoot, output);
  if (destination !== productRoot && !destination.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error("--output must remain inside the repository.");
  }
  return destination;
}

export async function writeReviewPolicyArtifact(result, output = "output/review-policy/review-policy.json") {
  const destination = resolveOutputPath(output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(summarizeReviewPolicy(result), null, 2)}\n`, "utf8");
  return destination;
}

function parseOptions(argv) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY || "",
    pullRequest: Number(process.env.PR_NUMBER || 0),
    expectedHeadSha: process.env.PR_HEAD_SHA || "",
    expectedBaseSha: process.env.PR_BASE_SHA || "",
    tokenEnv: "GITHUB_TOKEN",
    settleSeconds: DEFAULT_SETTLE_SECONDS,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    pollSeconds: DEFAULT_POLL_SECONDS,
    mode: "wait",
    output: "output/review-policy/review-policy.json",
    githubOutput: process.env.GITHUB_OUTPUT || "",
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
    else if (argument === "--settle-seconds") options.settleSeconds = Number(value);
    else if (argument === "--timeout-seconds") options.timeoutSeconds = Number(value);
    else if (argument === "--poll-seconds") options.pollSeconds = Number(value);
    else if (argument === "--mode") options.mode = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--github-output") options.githubOutput = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!REPOSITORY_PATTERN.test(options.repository)) throw new Error("--repository must use owner/name.");
  if (!Number.isInteger(options.pullRequest) || options.pullRequest <= 0) throw new Error("--pull-request must be a positive integer.");
  options.expectedHeadSha = assertSha(options.expectedHeadSha, "--expected-head");
  options.expectedBaseSha = assertSha(options.expectedBaseSha, "--expected-base");
  if (!Number.isInteger(options.settleSeconds) || options.settleSeconds < 0 || options.settleSeconds > 600) {
    throw new Error("--settle-seconds must be an integer from 0 to 600.");
  }
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 1 || options.timeoutSeconds > 3600) {
    throw new Error("--timeout-seconds must be an integer from 1 to 3600.");
  }
  if (!Number.isInteger(options.pollSeconds) || options.pollSeconds < 1 || options.pollSeconds > 60) {
    throw new Error("--poll-seconds must be an integer from 1 to 60.");
  }
  if (!new Set(["wait", "revalidate"]).has(options.mode)) throw new Error("--mode must be wait or revalidate.");
  resolveOutputPath(options.output);
  return options;
}

async function githubJson(url, token, init = {}) {
  const response = await globalThis.fetch(url, {
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

async function graphqlConnection({ graphqlUrl, query, variables, pathSelector, token }) {
  const entries = [];
  let after = null;
  for (;;) {
    const response = await githubJson(graphqlUrl, token, {
      method: "POST",
      body: JSON.stringify({ query, variables: { ...variables, after } }),
    });
    if (response.errors?.length) {
      throw new Error(`GitHub GraphQL: ${response.errors.map((error) => error.message).join("; ")}`);
    }
    const connection = pathSelector(response?.data);
    if (!connection) throw new Error("Pull Request review evidence was unavailable.");
    entries.push(...(connection.nodes || []));
    if (!connection.pageInfo?.hasNextPage) return entries;
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error("GitHub GraphQL pagination omitted endCursor.");
  }
}

async function collectIssueComments({ graphqlUrl, owner, name, pullRequest, token }) {
  return graphqlConnection({
    graphqlUrl,
    token,
    variables: { owner, name, number: pullRequest },
    pathSelector: (data) => data?.repository?.pullRequest?.comments,
    query: `
      query($owner: String!, $name: String!, $number: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
          pullRequest(number: $number) {
            comments(first: 100, after: $after) {
              nodes { databaseId body createdAt updatedAt lastEditedAt author { login } }
              pageInfo { hasNextPage endCursor }
            }
          }
        }
      }
    `,
  });
}

async function collectReviewThreads({ graphqlUrl, owner, name, pullRequest, token }) {
  return graphqlConnection({
    graphqlUrl,
    token,
    variables: { owner, name, number: pullRequest },
    pathSelector: (data) => data?.repository?.pullRequest?.reviewThreads,
    query: `
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
    `,
  });
}

async function collectSnapshot(options, token) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const graphqlUrl = process.env.GITHUB_GRAPHQL_URL || `${apiBase.replace(/\/api\/v3$/u, "/api")}/graphql`;
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const basePath = `/repos/${repositoryPath}`;
  const [pullRequest, timelineEvents, reviews, issueComments, reviewThreads] = await Promise.all([
    githubJson(`${apiBase}${basePath}/pulls/${options.pullRequest}`, token),
    restPages(apiBase, `${basePath}/issues/${options.pullRequest}/events`, token),
    restPages(apiBase, `${basePath}/pulls/${options.pullRequest}/reviews`, token),
    collectIssueComments({ graphqlUrl, owner, name, pullRequest: options.pullRequest, token }),
    collectReviewThreads({ graphqlUrl, owner, name, pullRequest: options.pullRequest, token }),
  ]);
  return { pullRequest, timelineEvents, reviews, issueComments, reviewThreads };
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeGithubOutput(destination, values) {
  if (!destination) return;
  const lines = Object.entries(values).map(([key, value]) => {
    const normalized = String(value ?? "").replaceAll("\r", "").replaceAll("\n", "");
    return `${key}=${normalized}`;
  });
  await appendFile(destination, `${lines.join("\n")}\n`, "utf8");
}

async function appendSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const passed = result.status === "passed";
  const lines = [
    "### Review policy",
    "",
    `- Result: **${passed ? "PASS" : result.status.toUpperCase()}** (${result.reason})`,
    `- Expected/current head: \`${result.expectedHeadSha}\` / \`${result.currentHeadSha || "unavailable"}\``,
    `- Expected/current base: \`${result.expectedBaseSha}\` / \`${result.currentBaseSha || "unavailable"}\``,
    `- Ready transition: ${result.readyAt || "missing"}`,
    `- Final Codex completion: ${result.reviewCompletedAt || "not observed"}`,
    `- Review latency: ${result.reviewLatencySeconds ?? "n/a"} seconds`,
    `- Blocking P0/P1 or human findings: ${result.blockingFindings.length}`,
    `- Deferred P2/P3/unclassified findings: ${result.nonBlockingFindings.length}`,
    "",
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}

async function persistResult(result, options) {
  const destination = await writeReviewPolicyArtifact(result, options.output);
  await writeGithubOutput(options.githubOutput, {
    status: result.status,
    reason: result.reason,
    artifact_path: destination,
    review_completed_at: result.reviewCompletedAt || "",
    review_latency_seconds: result.reviewLatencySeconds ?? "",
    blocking_findings: result.blockingFindings.length,
    non_blocking_findings: result.nonBlockingFindings.length,
  });
  await appendSummary(result);
  return destination;
}

async function run(options) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  const deadline = Date.now() + (options.mode === "revalidate" ? 0 : options.timeoutSeconds * 1000);
  let lastReason = "";
  for (;;) {
    let snapshot;
    try {
      snapshot = await collectSnapshot(options, token);
    } catch (error) {
      if (options.mode === "revalidate" || Date.now() >= deadline) throw error;
      if (lastReason !== "github_evidence_unavailable") {
        console.warn(`GitHub review evidence is temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`);
        lastReason = "github_evidence_unavailable";
      }
      await delay(Math.min(options.pollSeconds * 1000, Math.max(1, deadline - Date.now())));
      continue;
    }
    const result = evaluateReviewPolicy({
      expectedHeadSha: options.expectedHeadSha,
      expectedBaseSha: options.expectedBaseSha,
      ...snapshot,
      settleSeconds: options.mode === "revalidate" ? 0 : options.settleSeconds,
    });
    if (result.reason !== lastReason || result.status !== "waiting") {
      console.log(JSON.stringify(summarizeReviewPolicy(result), null, 2));
      lastReason = result.reason;
    }
    if (result.status === "passed") {
      await persistResult(result, options);
      return result;
    }
    if (result.status === "blocked" || options.mode === "revalidate") {
      await persistResult(result, options);
      throw new Error(`Review policy blocked: ${result.reason}.`);
    }
    if (Date.now() >= deadline) {
      const timedOut = Object.freeze({ ...result, status: "blocked", reason: "review_wait_timed_out" });
      await persistResult(timedOut, options);
      throw new Error("Final review did not settle before the review wait timeout.");
    }
    await delay(Math.min(options.pollSeconds * 1000, Math.max(1, deadline - Date.now())));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run(parseOptions(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
