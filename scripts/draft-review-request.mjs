#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  classifyReviewPriority,
  classifyReviewThread,
  reviewedCommitPrefix,
} from "./check-pr-review-policy.mjs";
import {
  assertDraftReviewSha,
  buildDraftReviewRequestMarker,
  buildDraftReviewStatusMarker,
  CODEX_LOGIN,
  DEFAULT_TRUSTED_ACTOR,
  parseDraftReviewCommandMarker,
  parseDraftReviewRequestMarker,
  parseDraftReviewStatusMarker,
  recordSettledHead,
  settledHeadState,
  SETTLED_STATES,
} from "./draft-review-marker.mjs";

export {
  buildDraftReviewCommandMarker,
  buildDraftReviewRequestMarker,
  parseDraftReviewCommandMarker,
  parseDraftReviewRequestMarker,
} from "./draft-review-marker.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const RUN_ID_PATTERN = /^\d{1,64}$/u;
const SOURCE_WORKFLOW_PATH = ".github/workflows/pr-feedback.yml";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_REST_PAGES = 20;
const CLEAN_COMPLETION_PATTERN = /^Codex Review:\s*Didn't find any major issues\.[^\r\n]*\r?\n\r?\n/iu;
const TRUSTED_ASSOCIATIONS = new Set(["OWNER", "COLLABORATOR", "MEMBER"]);
const DEFAULT_SETTLE_SECONDS = 30;
const DEFAULT_TIMEOUT_SECONDS = 10 * 60;
const DEFAULT_POLL_SECONDS = 15;

function normalizedLogin(value) {
  return String(value || "").toLowerCase().replace(/\[bot\]$/u, "");
}

function isCodexActor(value) {
  return normalizedLogin(value) === CODEX_LOGIN;
}

function timestamp(value) {
  const milliseconds = Date.parse(value || "");
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function commentAuthor(value) {
  return value?.user?.login || value?.author?.login || value?.author || "";
}

function commentBody(value) {
  return String(value?.body ?? "");
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function pullRequestFields(pullRequest) {
  const headSha = String(
    pullRequest?.head?.sha || pullRequest?.headRefOid || "",
  ).toLowerCase();
  const baseSha = String(
    pullRequest?.base?.sha || pullRequest?.baseRefOid || "",
  ).toLowerCase();
  const headRepo = String(pullRequest?.head?.repo?.full_name || "");
  const state = String(pullRequest?.state || "");
  const draft = pullRequest?.draft === true || pullRequest?.isDraft === true;
  const merged = pullRequest?.merged === true || pullRequest?.mergedAt != null;
  return { headSha, baseSha, headRepo, state, draft, merged };
}

function skipped(reason, fields = {}) {
  return Object.freeze({ status: "skipped", reason, ...fields });
}

function workflowRunPullRequests(workflowRun) {
  return Array.isArray(workflowRun?.pull_requests) ? workflowRun.pull_requests : [];
}

export function buildDraftReviewCommand({ headSha, baseSha, sourceRunId = null } = {}) {
  const head = assertDraftReviewSha(headSha, "headSha");
  const base = assertDraftReviewSha(baseSha, "baseSha");
  const marker = buildDraftReviewRequestMarker({ headSha: head, baseSha: base, sourceRunId });
  return [
    "@codex review",
    "",
    "PageRoot Draft advisory review for exact head `" + head + "`.",
    "",
    "This review cannot satisfy the final Ready merge gate; `review-policy` still requires post-Ready exact head/base evidence.",
    "",
    marker,
    "",
  ].join("\n");
}

export function findExistingDraftRequest(
  comments = [],
  { headSha, baseSha, trustedActor = DEFAULT_TRUSTED_ACTOR } = {},
) {
  const head = assertDraftReviewSha(headSha, "headSha");
  const base = assertDraftReviewSha(baseSha, "baseSha");
  const actor = normalizedLogin(trustedActor);
  if (!actor) throw new Error("trustedActor is required.");
  for (const comment of comments) {
    if (normalizedLogin(commentAuthor(comment)) !== actor) continue;
    const marker = parseDraftReviewRequestMarker(commentBody(comment));
    if (marker && marker.headSha === head && marker.baseSha === base) return comment;
  }
  return null;
}

export function evaluateDraftReviewEligibility({
  repository = "",
  pullRequest = null,
  comments = [],
  expectedHeadSha = "",
  expectedBaseSha = "",
  sourceRunId = null,
  trustedActor = DEFAULT_TRUSTED_ACTOR,
  workflowRun = null,
} = {}) {
  const expectedHead = assertDraftReviewSha(expectedHeadSha, "expectedHeadSha");
  const expectedBase = assertDraftReviewSha(expectedBaseSha, "expectedBaseSha");
  const actor = normalizedLogin(trustedActor);
  if (!actor) throw new Error("trustedActor is required.");

  if (workflowRun) {
    const workflowPath = String(workflowRun.path || "");
    if (!(
      workflowPath === SOURCE_WORKFLOW_PATH
      || workflowPath.startsWith(SOURCE_WORKFLOW_PATH + "@")
    )) {
      return skipped("untrusted_source_workflow", { sourceWorkflowPath: workflowPath || null });
    }
    if (String(workflowRun.event || "") !== "pull_request") {
      return skipped("source_event_not_pull_request", { sourceEvent: workflowRun.event || null });
    }
    if (String(workflowRun.conclusion || "") !== "success") {
      return skipped("source_workflow_not_successful", { sourceConclusion: workflowRun.conclusion || null });
    }
    const runPullRequests = workflowRunPullRequests(workflowRun);
    if (runPullRequests.length === 0) return skipped("workflow_run_missing_pr");
    if (runPullRequests.length > 1) {
      return skipped("workflow_run_multiple_prs", { pullRequestCount: runPullRequests.length });
    }
    const runPullRequest = Number(runPullRequests[0]?.number || 0);
    const pullRequestNumber = Number(pullRequest?.number || 0);
    if (runPullRequest !== pullRequestNumber) {
      return skipped("workflow_run_pr_mismatch", {
        workflowPullRequest: runPullRequest || null,
        livePullRequest: pullRequestNumber || null,
      });
    }
  }

  const number = Number(pullRequest?.number || 0);
  const live = pullRequestFields(pullRequest);
  const common = {
    repository: repository || null,
    pullRequest: number || null,
    expectedHeadSha: expectedHead,
    expectedBaseSha: expectedBase,
    liveHeadSha: live.headSha || null,
    liveBaseSha: live.baseSha || null,
    isDraft: live.draft,
    isClosed: live.state === "closed" || live.merged,
    isMerged: live.merged,
    isFork: Boolean(
      live.headRepo
      && repository
      && live.headRepo.toLowerCase() !== String(repository).toLowerCase(),
    ),
    sourceRunId: sourceRunId ?? null,
  };

  if (!number) return skipped("pull_request_missing", common);
  if (!live.headSha || !live.baseSha || !live.state) {
    return skipped("pull_request_state_ambiguous", common);
  }
  if (live.state !== "open" || live.merged) return skipped("pull_request_is_closed", common);
  if (!live.draft) return skipped("pull_request_is_not_draft", common);
  if (common.isFork) return skipped("fork_pull_request", common);
  if (workflowRun && String(workflowRun.head_sha || "") !== expectedHead) {
    return skipped("workflow_run_stale", common);
  }
  if (live.headSha !== expectedHead) return skipped("head_sha_changed", common);
  if (live.baseSha !== expectedBase) return skipped("base_sha_changed", common);

  const existing = findExistingDraftRequest(comments, {
    headSha: expectedHead,
    baseSha: expectedBase,
    trustedActor: actor,
  });
  if (existing) {
    return Object.freeze({
      status: "already_requested",
      reason: "already_requested",
      ...common,
      existingCommentId: Number(existing.id || existing.databaseId || 0) || null,
    });
  }
  return Object.freeze({ status: "eligible", reason: "eligible", ...common });
}

export function probeCompletion({
  reviews = [],
  issueComments = [],
  expectedHeadSha,
  afterMs,
} = {}) {
  const head = String(expectedHeadSha || "").toLowerCase();
  if (!SHA_PATTERN.test(head) || !Number.isFinite(afterMs)) return null;
  const results = [];
  for (const review of reviews) {
    if (!isCodexActor(review?.user?.login || review?.author?.login)) continue;
    const commit = String(review?.commit_id || review?.commit?.oid || "").toLowerCase();
    const at = timestamp(review?.submitted_at || review?.submittedAt);
    if (commit !== head || !Number.isFinite(at) || at <= afterMs) continue;
    const prefix = reviewedCommitPrefix(review?.body);
    if (!prefix || !head.startsWith(prefix)) continue;
    results.push({
      kind: "codex_review",
      at,
      priority: classifyReviewPriority(review?.body),
      reviewId: Number(review?.id || 0) || null,
    });
  }
  for (const comment of issueComments) {
    if (!isCodexActor(commentAuthor(comment))) continue;
    const body = commentBody(comment);
    const createdAt = timestamp(comment?.created_at || comment?.createdAt);
    const updatedAt = timestamp(comment?.updated_at || comment?.updatedAt || comment?.created_at || comment?.createdAt);
    const lastEditedAt = comment?.last_edited_at || comment?.lastEditedAt || null;
    const prefix = reviewedCommitPrefix(body);
    if (
      Boolean(lastEditedAt)
      || createdAt !== updatedAt
      || !CLEAN_COMPLETION_PATTERN.test(body)
      || !prefix
      || !head.startsWith(prefix)
      || !Number.isFinite(createdAt)
      || createdAt <= afterMs
    ) continue;
    results.push({
      kind: "codex_clean_comment",
      at: createdAt,
      priority: "unclassified",
      commentId: Number(comment?.databaseId || comment?.id || 0) || null,
    });
  }
  results.sort((left, right) => right.at - left.at);
  return results[0] || null;
}

export function classifyProbeOutcome({ completion = null, reviewThreads = [] } = {}) {
  if (!completion) return null;
  const blockingThread = (reviewThreads || [])
    .map(classifyReviewThread)
    .some((finding) => finding.state === "blocking");
  const blockingReview = completion.priority === "P0" || completion.priority === "P1";
  return blockingThread || blockingReview ? "action_required" : "clean";
}

export function classifyFreshSettlement(pullRequest, command) {
  const live = pullRequestFields(pullRequest);
  if (live.headSha !== command?.headSha || live.baseSha !== command?.baseSha) {
    return Object.freeze({
      status: "stale",
      reason: "pair_changed_before_settlement",
      liveHeadSha: live.headSha || null,
      liveBaseSha: live.baseSha || null,
    });
  }
  if (live.state !== "open" || live.merged) {
    return Object.freeze({
      status: "stale",
      reason: "pull_request_closed_before_settlement",
      isClosed: true,
    });
  }
  if (!live.draft) {
    return Object.freeze({
      status: "promotion_overlap",
      reason: "promoted_before_settlement",
      isDraft: false,
    });
  }
  return Object.freeze({ status: "draft", reason: "still_draft", isDraft: true });
}

export function closeCommandDecision(pullRequest, command) {
  const recheck = classifyFreshSettlement(pullRequest, command);
  if (recheck.status !== "draft") {
    return Object.freeze({
      ...recheck,
      status: "refused",
      reason: "close_refused_while_promotable",
    });
  }
  return Object.freeze({ status: "closable", reason: "draft_pair_confirmed" });
}

export function validateAutoWorkflowRun({
  workflowRun = null,
  pullRequest = null,
  repository = "",
} = {}) {
  const workflowPath = String(workflowRun?.path || "");
  if (!(
    workflowPath === SOURCE_WORKFLOW_PATH
    || workflowPath.startsWith(SOURCE_WORKFLOW_PATH + "@")
  )) {
    return skipped("untrusted_source_workflow", { sourceWorkflowPath: workflowPath || null });
  }
  if (String(workflowRun?.event || "") !== "pull_request") {
    return skipped("source_event_not_pull_request", { sourceEvent: workflowRun?.event || null });
  }
  if (String(workflowRun?.conclusion || "") !== "success") {
    return skipped("source_workflow_not_successful", { sourceConclusion: workflowRun?.conclusion || null });
  }
  const runPullRequests = workflowRunPullRequests(workflowRun);
  if (runPullRequests.length === 0) return skipped("workflow_run_missing_pr");
  if (runPullRequests.length > 1) {
    return skipped("workflow_run_multiple_prs", { pullRequestCount: runPullRequests.length });
  }
  const number = Number(pullRequest?.number || 0);
  const runNumber = Number(runPullRequests[0]?.number || 0);
  if (!number || runNumber !== number) {
    return skipped("workflow_run_pr_mismatch", {
      workflowPullRequest: runNumber || null,
      livePullRequest: number || null,
    });
  }
  const head = String(workflowRun?.head_sha || "").toLowerCase();
  const live = pullRequestFields(pullRequest);
  if (!SHA_PATTERN.test(head) || head !== live.headSha) {
    return skipped("workflow_run_stale", { runHeadSha: head || null, liveHeadSha: live.headSha || null });
  }
  if (live.headRepo && repository && live.headRepo.toLowerCase() !== String(repository).toLowerCase()) {
    return skipped("fork_pull_request", { headRepo: live.headRepo });
  }
  return Object.freeze({ status: "eligible", reason: "eligible", pullRequest: number, headSha: head });
}

export function findDraftReviewStatusComment(
  comments = [],
  trustedActor = DEFAULT_TRUSTED_ACTOR,
) {
  const actor = normalizedLogin(trustedActor);
  for (const comment of comments) {
    if (normalizedLogin(commentAuthor(comment)) !== actor) continue;
    const status = parseDraftReviewStatusMarker(commentBody(comment));
    if (status) return { comment, status };
  }
  return null;
}

export function buildDraftReviewStatusText({ pullRequest, entries = [] } = {}) {
  const lines = ["### Draft Codex review status", ""];
  if (entries.length === 0) {
    lines.push("No settled Draft review rounds yet.");
  } else {
    for (const entry of entries) {
      lines.push("- `" + entry.headSha + "`: " + entry.state);
    }
  }
  lines.push("", buildDraftReviewStatusMarker({ pullRequest, entries }));
  return lines.join("\n");
}

function resolveOutputPath(output) {
  const destination = path.resolve(productRoot, output);
  if (!destination.startsWith(productRoot + path.sep)) {
    throw new Error("Output path escapes the repository: " + output);
  }
  return destination;
}

export function parseDraftReviewArguments(argv) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY || "",
    pullRequest: Number(process.env.PR_NUMBER || 0),
    commentId: Number(process.env.COMMENT_ID || 0),
    workflowRunId: Number(process.env.WORKFLOW_RUN_ID || 0),
    tokenEnv: "GITHUB_TOKEN",
    output: "output/draft-review/draft-review.json",
    trustedActor: DEFAULT_TRUSTED_ACTOR,
    sourceRunId: process.env.GITHUB_RUN_ID || "",
    githubOutput: process.env.GITHUB_OUTPUT || "",
    settleSeconds: DEFAULT_SETTLE_SECONDS,
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    pollSeconds: DEFAULT_POLL_SECONDS,
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (value === undefined || value === "") throw new Error(argument + " requires a value.");
    if (argument === "--repository") options.repository = value;
    else if (argument === "--pull-request") options.pullRequest = Number(value);
    else if (argument === "--comment-id") options.commentId = Number(value);
    else if (argument === "--workflow-run-id") options.workflowRunId = Number(value);
    else if (argument === "--token-env") options.tokenEnv = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--actor") options.trustedActor = value;
    else if (argument === "--source-run-id") options.sourceRunId = value;
    else if (argument === "--github-output") options.githubOutput = value;
    else if (argument === "--settle-seconds") options.settleSeconds = Number(value);
    else if (argument === "--timeout-seconds") options.timeoutSeconds = Number(value);
    else if (argument === "--poll-seconds") options.pollSeconds = Number(value);
    else throw new Error("Unknown argument: " + argument);
  }
  if (!REPOSITORY_PATTERN.test(options.repository)) {
    throw new Error("--repository must use owner/name.");
  }
  if (!options.tokenEnv) throw new Error("--token-env must name an environment variable.");
  if (!normalizedLogin(options.trustedActor)) {
    throw new Error("--actor must name a trusted comment author.");
  }
  if (options.sourceRunId && !RUN_ID_PATTERN.test(String(options.sourceRunId))) {
    throw new Error("--source-run-id must contain only digits.");
  }
  if (!Number.isInteger(options.settleSeconds) || options.settleSeconds < 0 || options.settleSeconds > 600) {
    throw new Error("--settle-seconds must be an integer from 0 to 600.");
  }
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 1 || options.timeoutSeconds > 3600) {
    throw new Error("--timeout-seconds must be an integer from 1 to 3600.");
  }
  if (!Number.isInteger(options.pollSeconds) || options.pollSeconds < 1 || options.pollSeconds > 60) {
    throw new Error("--poll-seconds must be an integer from 1 to 60.");
  }
  const hasComment = Number.isInteger(options.commentId) && options.commentId > 0;
  const hasRun = Number.isInteger(options.workflowRunId) && options.workflowRunId > 0;
  if (hasComment === hasRun) {
    throw new Error("Provide exactly one of --comment-id or --workflow-run-id.");
  }
  if (hasComment && (!Number.isInteger(options.pullRequest) || options.pullRequest <= 0)) {
    throw new Error("--pull-request must be a positive integer in command mode.");
  }
  resolveOutputPath(options.output);
  return options;
}

async function githubJson(url, token, init = {}) {
  const response = await globalThis.fetch(url, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error("GitHub API " + response.status + " for " + url + ": " + body);
  }
  return await response.json();
}

async function restPages(apiBase, apiPath, token) {
  const entries = [];
  for (let page = 1; page <= MAX_REST_PAGES; page += 1) {
    const separator = apiPath.includes("?") ? "&" : "?";
    const response = await githubJson(
      apiBase + apiPath + separator + "per_page=100&page=" + page,
      token,
    );
    if (!Array.isArray(response)) throw new Error("Expected an array from " + apiPath + ".");
    entries.push(...response);
    if (response.length < 100) return entries;
  }
  throw new Error("GitHub API pagination exceeded " + MAX_REST_PAGES + " pages for " + apiPath + ".");
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
      throw new Error("GitHub GraphQL: " + response.errors.map((error) => error.message).join("; "));
    }
    const connection = pathSelector(response?.data);
    if (!connection) throw new Error("Pull Request review evidence was unavailable.");
    entries.push(...(connection.nodes || []));
    if (!connection.pageInfo?.hasNextPage) return entries;
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error("GitHub GraphQL pagination omitted endCursor.");
  }
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

export async function collectDraftReviewSnapshot(options, token) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const graphqlUrl = process.env.GITHUB_GRAPHQL_URL || apiBase.replace(/\/api\/v3$/u, "/api") + "/graphql";
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const basePath = "/repos/" + repositoryPath;
  const [pullRequest, comments, reviews, issueReactions, reviewThreads] = await Promise.all([
    githubJson(apiBase + basePath + "/pulls/" + options.pullRequest, token),
    restPages(apiBase, basePath + "/issues/" + options.pullRequest + "/comments", token),
    restPages(apiBase, basePath + "/pulls/" + options.pullRequest + "/reviews", token),
    restPages(apiBase, basePath + "/issues/" + options.pullRequest + "/reactions", token),
    collectReviewThreads({ graphqlUrl, owner, name, pullRequest: options.pullRequest, token }),
  ]);
  return { pullRequest, comments, reviews, issueReactions, reviewThreads };
}

async function collectIssueComment(options, token, commentId) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  return githubJson(apiBase + "/repos/" + repositoryPath + "/issues/comments/" + commentId, token);
}

async function collectPullRequestOnly(options, token, pullRequest = options.pullRequest) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  return githubJson(apiBase + "/repos/" + repositoryPath + "/pulls/" + pullRequest, token);
}

async function collectWorkflowRun(options, token, runId) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  return githubJson(apiBase + "/repos/" + repositoryPath + "/actions/runs/" + runId, token);
}

async function postIssueComment(options, token, body, pullRequest = options.pullRequest) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const response = await githubJson(
    apiBase + "/repos/" + repositoryPath + "/issues/" + pullRequest + "/comments",
    token,
    { method: "POST", body: JSON.stringify({ body }) },
  );
  return {
    id: Number(response?.id || 0) || null,
    url: response?.html_url || null,
    createdAt: response?.created_at || null,
  };
}

async function patchIssueComment(options, token, commentId, body) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  await githubJson(
    apiBase + "/repos/" + repositoryPath + "/issues/comments/" + commentId,
    token,
    { method: "PATCH", body: JSON.stringify({ body }) },
  );
}

async function deleteIssueComment(options, token, commentId) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const response = await globalThis.fetch(
    apiBase + "/repos/" + repositoryPath + "/issues/comments/" + commentId,
    {
      method: "DELETE",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: "Bearer " + token,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    },
  );
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error("GitHub API " + response.status + " deleting comment " + commentId + ": " + body);
  }
}

function summarizeDraftReview(result) {
  return {
    status: result.status,
    reason: result.reason,
    repository: result.repository || null,
    pullRequest: result.pullRequest || null,
    commentId: result.commentId || null,
    expectedHeadSha: result.expectedHeadSha || null,
    expectedBaseSha: result.expectedBaseSha || null,
    liveHeadSha: result.liveHeadSha || null,
    liveBaseSha: result.liveBaseSha || null,
    isDraft: result.isDraft ?? null,
    isClosed: result.isClosed ?? null,
    isFork: result.isFork ?? null,
    sourceRunId: result.sourceRunId ?? null,
    trustedActor: result.trustedActor || null,
    authorAssociation: result.authorAssociation || null,
    commentCreated: result.commentCreated ?? false,
    commentUrl: result.commentUrl ?? null,
    existingCommentId: result.existingCommentId ?? null,
    reviewCompletedAt: result.reviewCompletedAt ?? null,
    reviewCompletionKind: result.reviewCompletionKind ?? null,
    reviewPriority: result.reviewPriority ?? null,
    requestedAt: result.requestedAt ?? null,
    statusCommentId: result.statusCommentId ?? null,
  };
}

export async function writeDraftReviewArtifact(result, output = "output/draft-review/draft-review.json") {
  const destination = resolveOutputPath(output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, JSON.stringify(summarizeDraftReview(result), null, 2) + "\n", "utf8");
  return destination;
}

async function writeGithubOutput(destination, values) {
  if (!destination) return;
  const lines = Object.entries(values).map(([key, value]) => {
    const normalized = String(value ?? "").replaceAll("\r", "").replaceAll("\n", "");
    return key + "=" + normalized;
  });
  await appendFile(destination, lines.join("\n") + "\n", "utf8");
}

async function appendSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const lines = [
    "### Draft Codex review",
    "",
    "- Result: **" + String(result.status).toUpperCase() + "** (" + result.reason + ")",
    "- Pull request: " + (result.pullRequest ?? "unavailable"),
    "- Expected head/base: `" + result.expectedHeadSha + "` / `" + result.expectedBaseSha + "`",
    "- Comment created: " + String(result.commentCreated ?? false),
    "- Review completion: " + (result.reviewCompletionKind ?? "none") + " (" + (result.reviewPriority ?? "n/a") + ")",
    "",
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, lines.join("\n") + "\n", "utf8");
}

async function persistResult(result, options) {
  const destination = await writeDraftReviewArtifact(result, options.output);
  await writeGithubOutput(options.githubOutput, {
    status: result.status,
    reason: result.reason,
    artifact_path: destination,
    comment_created: result.commentCreated ? "true" : "false",
    comment_id: result.commentId || "",
  });
  await appendSummary(result);
  return destination;
}

function commandResult(options, fields) {
  return Object.freeze({
    repository: options.repository,
    trustedActor: options.trustedActor,
    pullRequest: options.pullRequest,
    commentId: options.commentId || null,
    sourceRunId: options.sourceRunId || null,
    ...fields,
  });
}

function unavailableResult(options) {
  return commandResult(options, {
    status: "unavailable",
    reason: "github_evidence_unavailable",
    commentCreated: false,
  });
}

async function upsertDraftReviewStatus(options, token, existing, pullRequest, entries) {
  const text = buildDraftReviewStatusText({ pullRequest, entries });
  const existingId = Number(existing?.id || existing?.databaseId || 0);
  if (existingId) {
    await patchIssueComment(options, token, existingId, text);
    return existingId;
  }
  const posted = await postIssueComment(options, token, text, pullRequest);
  return posted.id;
}

async function waitForProbeSettlement(options, token, posted, command, snapshotAtStart) {
  const requestAt = timestamp(posted?.createdAt) ?? Date.now();
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  const existingStatus = findDraftReviewStatusComment(snapshotAtStart.comments, options.trustedActor);
  const settledEntries = existingStatus?.status?.entries || [];
  for (;;) {
    await delay(Math.min(options.pollSeconds * 1000, Math.max(1, deadline - Date.now())));
    const snapshot = await collectDraftReviewSnapshot(options, token);
    const live = pullRequestFields(snapshot.pullRequest);
    if (live.headSha !== command.headSha || live.baseSha !== command.baseSha) {
      return commandResult(options, {
        status: "stale",
        reason: "pair_changed_before_settlement",
        liveHeadSha: live.headSha || null,
        liveBaseSha: live.baseSha || null,
        commentCreated: true,
        commentId: posted.id,
        commentUrl: posted.url,
      });
    }
    if (live.state !== "open" || live.merged) {
      return commandResult(options, {
        status: "stale",
        reason: "pull_request_closed_before_settlement",
        isClosed: true,
        commentCreated: true,
        commentId: posted.id,
        commentUrl: posted.url,
      });
    }
    if (!live.draft) {
      return commandResult(options, {
        status: "promotion_overlap",
        reason: "promoted_before_settlement",
        isDraft: false,
        commentCreated: true,
        commentId: posted.id,
        commentUrl: posted.url,
      });
    }
    const completion = probeCompletion({
      reviews: snapshot.reviews,
      issueComments: snapshot.comments,
      expectedHeadSha: command.headSha,
      afterMs: requestAt,
    });
    if (completion) {
      const recheck = classifyFreshSettlement(
        await collectPullRequestOnly(options, token),
        command,
      );
      if (recheck.status !== "draft") {
        return commandResult(options, {
          ...recheck,
          commentCreated: true,
          commentId: posted.id,
          commentUrl: posted.url,
          requestedAt: new Date(requestAt).toISOString(),
        });
      }
      const outcome = classifyProbeOutcome({ completion, reviewThreads: snapshot.reviewThreads });
      await deleteIssueComment(options, token, posted.id);
      const entries = recordSettledHead(settledEntries, { headSha: command.headSha, state: outcome });
      const statusCommentId = await upsertDraftReviewStatus(options, token, existingStatus?.comment || null, options.pullRequest, entries);
      return commandResult(options, {
        status: outcome,
        reason: "probe_settled",
        commentCreated: true,
        commentId: posted.id,
        commentUrl: posted.url,
        requestedAt: new Date(requestAt).toISOString(),
        reviewCompletedAt: new Date(completion.at).toISOString(),
        reviewCompletionKind: completion.kind,
        reviewPriority: completion.priority,
        statusCommentId,
      });
    }
    if (Date.now() >= deadline) {
      const entries = recordSettledHead(settledEntries, { headSha: command.headSha, state: "timed_out" });
      const statusCommentId = await upsertDraftReviewStatus(options, token, existingStatus?.comment || null, options.pullRequest, entries);
      return commandResult(options, {
        status: "timed_out",
        reason: "probe_wait_timeout",
        commentCreated: true,
        commentId: posted.id,
        commentUrl: posted.url,
        requestedAt: new Date(requestAt).toISOString(),
        statusCommentId,
      });
    }
  }
}

async function runCommandRequest(options, token, association, command, snapshot) {
  const statusInfo = findDraftReviewStatusComment(snapshot.comments, options.trustedActor);
  const previousState = settledHeadState(statusInfo?.status?.entries || [], command.headSha);
  if (SETTLED_STATES.has(previousState)) {
    const result = commandResult(options, {
      status: "already_settled",
      reason: "already_settled",
      authorAssociation: association,
      commentCreated: false,
      settledState: previousState,
    });
    await persistResult(result, options);
    return result;
  }
  const eligibility = evaluateDraftReviewEligibility({
    repository: options.repository,
    pullRequest: snapshot.pullRequest,
    comments: snapshot.comments,
    expectedHeadSha: command.headSha,
    expectedBaseSha: command.baseSha,
    sourceRunId: options.sourceRunId || null,
    trustedActor: options.trustedActor,
    workflowRun: null,
  });
  if (eligibility.status === "already_requested") {
    const result = commandResult(options, { ...eligibility, authorAssociation: association, commentCreated: false });
    await persistResult(result, options);
    return result;
  }
  if (eligibility.status !== "eligible") {
    const result = commandResult(options, { ...eligibility, authorAssociation: association, commentCreated: false });
    await persistResult(result, options);
    throw new Error("Draft review request blocked: " + eligibility.reason + ".");
  }
  const body = buildDraftReviewCommand({
    headSha: command.headSha,
    baseSha: command.baseSha,
    sourceRunId: options.sourceRunId || null,
  });
  let posted;
  try {
    posted = await postIssueComment(options, token, body);
  } catch (error) {
    const failed = commandResult(options, {
      ...eligibility,
      status: "request_failed",
      reason: "comment_post_failed",
      authorAssociation: association,
      commentCreated: false,
    });
    await persistResult(failed, options);
    throw new Error("Draft review comment failed: " + (error instanceof Error ? error.message : String(error)));
  }
  const settled = await waitForProbeSettlement(options, token, posted, command, snapshot);
  await persistResult(settled, options);
  return settled;
}

async function runCommentCommand(options) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error("Environment variable " + options.tokenEnv + " is required.");
  let comment;
  let snapshot;
  try {
    [comment, snapshot] = await Promise.all([
      collectIssueComment(options, token, options.commentId),
      collectDraftReviewSnapshot(options, token),
    ]);
  } catch (error) {
    const unavailable = unavailableResult(options);
    await persistResult(unavailable, options);
    throw new Error("Draft review evidence is unavailable: " + (error instanceof Error ? error.message : String(error)));
  }
  const association = String(comment?.author_association || "");
  if (!TRUSTED_ASSOCIATIONS.has(association)) {
    const rejected = commandResult(options, {
      status: "rejected",
      reason: "untrusted_command_author",
      authorAssociation: association || null,
      commentCreated: false,
    });
    await persistResult(rejected, options);
    throw new Error("Draft review command rejected: untrusted author association " + (association || "missing") + ".");
  }
  const command = parseDraftReviewCommandMarker(commentBody(comment));
  if (!command) {
    const unrecognized = commandResult(options, {
      status: "rejected",
      reason: "unrecognized_command",
      authorAssociation: association,
      commentCreated: false,
    });
    await persistResult(unrecognized, options);
    throw new Error("Draft review command rejected: no valid pageroot-draft-review-command marker.");
  }
  if (command.mode === "close") {
    const closeDecision = closeCommandDecision(snapshot.pullRequest, command);
    if (closeDecision.status !== "closable") {
      const refused = commandResult(options, {
        ...closeDecision,
        authorAssociation: association,
        commentCreated: false,
      });
      await persistResult(refused, options);
      throw new Error("Draft review close refused: the PR is not Draft on the exact head/base (" + closeDecision.reason + ").");
    }
    const existing = findExistingDraftRequest(snapshot.comments, {
      headSha: command.headSha,
      baseSha: command.baseSha,
      trustedActor: options.trustedActor,
    });
    const existingId = Number(existing?.id || existing?.databaseId || 0);
    if (!existingId) {
      const result = commandResult(options, {
        status: "nothing_to_close",
        reason: "nothing_to_close",
        authorAssociation: association,
        commentCreated: false,
      });
      await persistResult(result, options);
      return result;
    }
    const requestCreatedAt = timestamp(existing?.created_at || existing?.createdAt);
    const settlement = Number.isFinite(requestCreatedAt)
      ? probeCompletion({
        reviews: snapshot.reviews,
        issueComments: snapshot.comments,
        expectedHeadSha: command.headSha,
        afterMs: requestCreatedAt,
      })
      : null;
    if (!settlement) {
      const refused = commandResult(options, {
        status: "refused",
        reason: "close_refused_unsettled",
        authorAssociation: association,
        commentCreated: false,
        existingCommentId: existingId,
      });
      await persistResult(refused, options);
      throw new Error("Draft review close refused: the probe round has not settled for the exact head; keep the marker until settlement is correlated.");
    }
    await deleteIssueComment(options, token, existingId);
    const result = commandResult(options, {
      status: "closed",
      reason: "probe_marker_closed",
      authorAssociation: association,
      commentCreated: false,
      existingCommentId: existingId,
    });
    await persistResult(result, options);
    return result;
  }
  return runCommandRequest(options, token, association, command, snapshot);
}

async function runAutoCommand(options) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error("Environment variable " + options.tokenEnv + " is required.");
  let run;
  let pullRequest;
  let snapshot;
  try {
    run = await collectWorkflowRun(options, token, options.workflowRunId);
    const runNumber = Number(workflowRunPullRequests(run)?.[0]?.number || 0);
    if (!runNumber) throw new Error("The triggering workflow run names no Pull Request.");
    options = { ...options, pullRequest: runNumber };
    pullRequest = await collectPullRequestOnly(options, token, runNumber);
    snapshot = await collectDraftReviewSnapshot(options, token);
  } catch (error) {
    const unavailable = unavailableResult(options);
    await persistResult(unavailable, options);
    throw new Error("Draft review evidence is unavailable: " + (error instanceof Error ? error.message : String(error)));
  }
  const trigger = validateAutoWorkflowRun({
    workflowRun: run,
    pullRequest,
    repository: options.repository,
  });
  const common = commandResult(options, {
    ...trigger,
    pullRequest: trigger.pullRequest || null,
    commentId: null,
  });
  if (trigger.status !== "eligible") {
    await persistResult(common, options);
    return common;
  }
  const command = Object.freeze({
    mode: "request",
    headSha: pullRequestFields(pullRequest).headSha,
    baseSha: pullRequestFields(pullRequest).baseSha,
  });
  const statusInfo = findDraftReviewStatusComment(snapshot.comments, options.trustedActor);
  const previousState = settledHeadState(statusInfo?.status?.entries || [], command.headSha);
  if (SETTLED_STATES.has(previousState)) {
    const result = commandResult(options, {
      ...common,
      status: "already_settled",
      reason: "already_settled",
      commentCreated: false,
      settledState: previousState,
    });
    await persistResult(result, options);
    return result;
  }
  const eligibility = evaluateDraftReviewEligibility({
    repository: options.repository,
    pullRequest: snapshot.pullRequest,
    comments: snapshot.comments,
    expectedHeadSha: command.headSha,
    expectedBaseSha: command.baseSha,
    sourceRunId: options.sourceRunId || null,
    trustedActor: options.trustedActor,
    workflowRun: run,
  });
  if (eligibility.status === "already_requested") {
    const result = commandResult(options, { ...eligibility, commentCreated: false });
    await persistResult(result, options);
    return result;
  }
  if (eligibility.status !== "eligible") {
    const result = commandResult(options, { ...eligibility, commentCreated: false });
    await persistResult(result, options);
    return result;
  }
  const body = buildDraftReviewCommand({
    headSha: command.headSha,
    baseSha: command.baseSha,
    sourceRunId: options.sourceRunId || null,
  });
  let posted;
  try {
    posted = await postIssueComment(options, token, body);
  } catch (error) {
    const failed = commandResult(options, {
      ...eligibility,
      status: "request_failed",
      reason: "comment_post_failed",
      commentCreated: false,
    });
    await persistResult(failed, options);
    throw new Error("Draft review comment failed: " + (error instanceof Error ? error.message : String(error)));
  }
  const settled = await waitForProbeSettlement(options, token, posted, command, snapshot);
  await persistResult(settled, options);
  return settled;
}

async function run(options) {
  if (options.commentId > 0) return runCommentCommand(options);
  return runAutoCommand(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run(parseDraftReviewArguments(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
