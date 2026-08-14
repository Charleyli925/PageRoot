#!/usr/bin/env node

import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const RUN_ID_PATTERN = /^\d{1,64}$/u;
export const DEFAULT_TRUSTED_ACTOR = "github-actions[bot]";
const SOURCE_WORKFLOW_PATH = ".github/workflows/pr-feedback.yml";
const MARKER_NAME = "pageroot-draft-review-request:v1";
const COMMAND_NAME = "pageroot-draft-review-command:v1";
const GITHUB_API_VERSION = "2022-11-28";
const MAX_REST_PAGES = 20;
const CODEX_LOGIN = "chatgpt-codex-connector";
const REVIEWED_COMMIT_PATTERN = /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,40})`/iu;
const PRIORITY_BADGE_PATTERN = /\bP([0-3])\s+Badge\b/giu;
const PRIORITY_LINE_PATTERN = /(?:^|\r?\n)\s*(?:[-*]\s*)?(?:\*\*)?\[?P([0-3])\]?(?:\*\*)?\s*[:：-]/gimu;
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

function assertSha(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(label + " must be a 40-character lowercase Git SHA.");
  }
  return normalized;
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

export function buildDraftReviewRequestMarker({ headSha, baseSha, sourceRunId = null } = {}) {
  const head = assertSha(headSha, "headSha");
  const base = assertSha(baseSha, "baseSha");
  const lines = ["head=" + head, "base=" + base];
  if (sourceRunId !== null && sourceRunId !== undefined && sourceRunId !== "") {
    if (!RUN_ID_PATTERN.test(String(sourceRunId))) {
      throw new Error("sourceRunId must contain only digits.");
    }
    lines.push("source_run=" + String(sourceRunId));
  }
  return "<!-- " + MARKER_NAME + "\n" + lines.join("\n") + "\n-->";
}

export function parseDraftReviewRequestMarker(body) {
  const text = String(body ?? "");
  const pattern = new RegExp("<!--\\s*" + MARKER_NAME + "\\s*([\\r\\n][\\s\\S]*?)-->", "iu");
  const match = text.match(pattern);
  if (!match) return null;
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return null;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!["head", "base", "source_run"].includes(key)) return null;
    if (fields.has(key)) return null;
    fields.set(key, value);
  }
  const headSha = String(fields.get("head") ?? "").toLowerCase();
  const baseSha = String(fields.get("base") ?? "").toLowerCase();
  if (!SHA_PATTERN.test(headSha) || !SHA_PATTERN.test(baseSha)) return null;
  const sourceRunId = fields.has("source_run") ? String(fields.get("source_run")) : null;
  if (sourceRunId !== null && !RUN_ID_PATTERN.test(sourceRunId)) return null;
  return Object.freeze({ headSha, baseSha, sourceRunId });
}

export function buildDraftReviewCommandMarker({ mode, headSha, baseSha } = {}) {
  const normalizedMode = String(mode || "");
  if (!["request", "close"].includes(normalizedMode)) {
    throw new Error("command mode must be request or close.");
  }
  const head = assertSha(headSha, "headSha");
  const base = assertSha(baseSha, "baseSha");
  return [
    "<!-- " + COMMAND_NAME,
    "mode=" + normalizedMode,
    "head=" + head,
    "base=" + base,
    "-->",
  ].join("\n");
}

export function parseDraftReviewCommandMarker(body) {
  const text = String(body ?? "");
  const pattern = new RegExp("<!--\\s*" + COMMAND_NAME + "\\s*([\\r\\n][\\s\\S]*?)-->", "iu");
  const match = text.match(pattern);
  if (!match) return null;
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) return null;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!["mode", "head", "base"].includes(key)) return null;
    if (fields.has(key)) return null;
    fields.set(key, value);
  }
  const mode = String(fields.get("mode") ?? "");
  const headSha = String(fields.get("head") ?? "").toLowerCase();
  const baseSha = String(fields.get("base") ?? "").toLowerCase();
  if (!["request", "close"].includes(mode)) return null;
  if (!SHA_PATTERN.test(headSha) || !SHA_PATTERN.test(baseSha)) return null;
  return Object.freeze({ mode, headSha, baseSha });
}

export function findExistingDraftRequest(
  comments = [],
  { headSha, baseSha, trustedActor = DEFAULT_TRUSTED_ACTOR } = {},
) {
  const head = assertSha(headSha, "headSha");
  const base = assertSha(baseSha, "baseSha");
  const actor = normalizedLogin(trustedActor);
  if (!actor) throw new Error("trustedActor is required.");
  for (const comment of comments) {
    if (normalizedLogin(commentAuthor(comment)) !== actor) continue;
    const marker = parseDraftReviewRequestMarker(commentBody(comment));
    if (marker && marker.headSha === head && marker.baseSha === base) return comment;
  }
  return null;
}

export function buildDraftReviewCommand({ headSha, baseSha, sourceRunId = null } = {}) {
  const head = assertSha(headSha, "headSha");
  const base = assertSha(baseSha, "baseSha");
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
  const expectedHead = assertSha(expectedHeadSha, "expectedHeadSha");
  const expectedBase = assertSha(expectedBaseSha, "expectedBaseSha");
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

function classifyProbePriority(body) {
  let highestRank = Number.POSITIVE_INFINITY;
  const text = String(body || "");
  for (const pattern of [PRIORITY_BADGE_PATTERN, PRIORITY_LINE_PATTERN]) {
    for (const match of text.matchAll(pattern)) {
      highestRank = Math.min(highestRank, Number(match[1]));
    }
  }
  return Number.isFinite(highestRank) ? "P" + highestRank : "unclassified";
}

export function probeCompletion({
  reviews = [],
  expectedHeadSha,
  afterMs,
} = {}) {
  const head = String(expectedHeadSha || "").toLowerCase();
  if (!SHA_PATTERN.test(head) || !Number.isFinite(afterMs)) return null;
  const results = [];
  // Reactions and clean comments carry no head or request identity, so they
  // can never prove that this exact head's round settled. Only an exact-commit
  // Codex review with a matching Reviewed commit prefix may close the marker.
  for (const review of reviews) {
    if (!isCodexActor(review?.user?.login || review?.author?.login)) continue;
    const commit = String(review?.commit_id || review?.commit?.oid || "").toLowerCase();
    const at = timestamp(review?.submitted_at || review?.submittedAt);
    if (commit !== head || !Number.isFinite(at) || at <= afterMs) continue;
    const prefix = (String(review?.body ?? "").match(REVIEWED_COMMIT_PATTERN)?.[1] || "").toLowerCase();
    if (!prefix || !head.startsWith(prefix)) continue;
    results.push({
      kind: "codex_review",
      at,
      priority: classifyProbePriority(review?.body),
      reviewId: Number(review?.id || 0) || null,
    });
  }
  results.sort((left, right) => right.at - left.at);
  return results[0] || null;
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
  if (!Number.isInteger(options.pullRequest) || options.pullRequest <= 0) {
    throw new Error("--pull-request must be a positive integer.");
  }
  if (!Number.isInteger(options.commentId) || options.commentId <= 0) {
    throw new Error("--comment-id must be a positive integer.");
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

export async function collectDraftReviewSnapshot(options, token) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const basePath = "/repos/" + repositoryPath;
  const [pullRequest, comments, reviews, issueReactions] = await Promise.all([
    githubJson(apiBase + basePath + "/pulls/" + options.pullRequest, token),
    restPages(apiBase, basePath + "/issues/" + options.pullRequest + "/comments", token),
    restPages(apiBase, basePath + "/pulls/" + options.pullRequest + "/reviews", token),
    restPages(apiBase, basePath + "/issues/" + options.pullRequest + "/reactions", token),
  ]);
  return { pullRequest, comments, reviews, issueReactions };
}

async function collectIssueComment(options, token, commentId) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  return githubJson(apiBase + "/repos/" + repositoryPath + "/issues/comments/" + commentId, token);
}

async function collectPullRequestOnly(options, token) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  return githubJson(apiBase + "/repos/" + repositoryPath + "/pulls/" + options.pullRequest, token);
}

async function postDraftReviewCommand(options, token, body) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const response = await githubJson(
    apiBase + "/repos/" + repositoryPath + "/issues/" + options.pullRequest + "/comments",
    token,
    { method: "POST", body: JSON.stringify({ body }) },
  );
  return {
    id: Number(response?.id || 0) || null,
    url: response?.html_url || null,
    createdAt: response?.created_at || null,
  };
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
    "### Draft Codex review command",
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
    commentId: options.commentId,
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

async function waitForProbeSettlement(options, token, posted, command) {
  const requestAt = timestamp(posted?.createdAt) ?? Date.now();
  const deadline = Date.now() + options.timeoutSeconds * 1000;
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
      issueReactions: snapshot.issueReactions,
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
      await deleteIssueComment(options, token, posted.id);
      return commandResult(options, {
        status: completion.priority === "P0" || completion.priority === "P1"
          ? "action_required"
          : "clean",
        reason: "probe_settled",
        commentCreated: true,
        commentId: posted.id,
        commentUrl: posted.url,
        requestedAt: new Date(requestAt).toISOString(),
        reviewCompletedAt: new Date(completion.at).toISOString(),
        reviewCompletionKind: completion.kind,
        reviewPriority: completion.priority,
      });
    }
    if (Date.now() >= deadline) {
      return commandResult(options, {
        status: "timed_out",
        reason: "probe_wait_timeout",
        commentCreated: true,
        commentId: posted.id,
        commentUrl: posted.url,
        requestedAt: new Date(requestAt).toISOString(),
      });
    }
  }
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

  if (command.mode === "close") {
    const existing = findExistingDraftRequest(snapshot.comments, {
      headSha: command.headSha,
      baseSha: command.baseSha,
      trustedActor: options.trustedActor,
    });
    const existingId = Number(existing?.id || existing?.databaseId || 0);
    if (!existingId) {
      const result = commandResult(options, {
        ...eligibility,
        status: "nothing_to_close",
        reason: "nothing_to_close",
        authorAssociation: association,
        commentCreated: false,
      });
      await persistResult(result, options);
      return result;
    }
    await deleteIssueComment(options, token, existingId);
    const result = commandResult(options, {
      ...eligibility,
      status: "closed",
      reason: "probe_marker_closed",
      authorAssociation: association,
      commentCreated: false,
      existingCommentId: existingId,
    });
    await persistResult(result, options);
    return result;
  }

  const existing = findExistingDraftRequest(snapshot.comments, {
    headSha: command.headSha,
    baseSha: command.baseSha,
    trustedActor: options.trustedActor,
  });
  if (existing) {
    const result = commandResult(options, {
      ...eligibility,
      status: "already_requested",
      reason: "already_requested",
      authorAssociation: association,
      commentCreated: false,
      existingCommentId: Number(existing.id || existing.databaseId || 0) || null,
    });
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
    posted = await postDraftReviewCommand(options, token, body);
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
  const settled = await waitForProbeSettlement(options, token, posted, command);
  await persistResult(settled, options);
  return settled;
}

async function run(options) {
  return runCommentCommand(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run(parseDraftReviewArguments(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
