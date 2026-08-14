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
const GITHUB_API_VERSION = "2022-11-28";
const MAX_REST_PAGES = 20;

function normalizedLogin(value) {
  return String(value || "").toLowerCase().replace(/\[bot\]$/u, "");
}

function assertSha(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 40-character lowercase Git SHA.`);
  }
  return normalized;
}

function commentAuthor(value) {
  return value?.user?.login || value?.author?.login || value?.author || "";
}

function commentBody(value) {
  return String(value?.body ?? "");
}

export function buildDraftReviewRequestMarker({ headSha, baseSha, sourceRunId = null } = {}) {
  const head = assertSha(headSha, "headSha");
  const base = assertSha(baseSha, "baseSha");
  const lines = [`head=${head}`, `base=${base}`];
  if (sourceRunId !== null && sourceRunId !== undefined && sourceRunId !== "") {
    if (!RUN_ID_PATTERN.test(String(sourceRunId))) {
      throw new Error("sourceRunId must contain only digits.");
    }
    lines.push(`source_run=${String(sourceRunId)}`);
  }
  return `<!-- ${MARKER_NAME}\n${lines.join("\n")}\n-->`;
}

export function parseDraftReviewRequestMarker(body) {
  const text = String(body ?? "");
  const pattern = new RegExp(
    `<!--\\s*${MARKER_NAME}\\s*([\\r\\n][\\s\\S]*?)-->`,
    "iu",
  );
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
    `PageRoot Draft advisory review for exact head \`${head}\`.`,
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
      || workflowPath.startsWith(`${SOURCE_WORKFLOW_PATH}@`)
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

function resolveOutputPath(output) {
  const destination = path.resolve(productRoot, output);
  if (!destination.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error(`Output path escapes the repository: ${output}`);
  }
  return destination;
}

export function parseDraftReviewArguments(argv) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY || "",
    pullRequest: Number(process.env.PR_NUMBER || 0),
    expectedHeadSha: process.env.PR_HEAD_SHA || "",
    expectedBaseSha: process.env.PR_BASE_SHA || "",
    tokenEnv: "GITHUB_TOKEN",
    mode: "plan",
    output: "output/draft-review/draft-review.json",
    trustedActor: DEFAULT_TRUSTED_ACTOR,
    sourceRunId: process.env.GITHUB_RUN_ID || "",
    githubOutput: process.env.GITHUB_OUTPUT || "",
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (value === undefined || value === "") throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--pull-request") options.pullRequest = Number(value);
    else if (argument === "--expected-head") options.expectedHeadSha = value;
    else if (argument === "--expected-base") options.expectedBaseSha = value;
    else if (argument === "--token-env") options.tokenEnv = value;
    else if (argument === "--mode") options.mode = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--actor") options.trustedActor = value;
    else if (argument === "--source-run-id") options.sourceRunId = value;
    else if (argument === "--github-output") options.githubOutput = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!REPOSITORY_PATTERN.test(options.repository)) {
    throw new Error("--repository must use owner/name.");
  }
  if (!Number.isInteger(options.pullRequest) || options.pullRequest <= 0) {
    throw new Error("--pull-request must be a positive integer.");
  }
  options.expectedHeadSha = assertSha(options.expectedHeadSha, "--expected-head");
  options.expectedBaseSha = assertSha(options.expectedBaseSha, "--expected-base");
  if (!["plan", "request"].includes(options.mode)) {
    throw new Error("--mode must be plan or request.");
  }
  if (!options.tokenEnv) throw new Error("--token-env must name an environment variable.");
  if (!normalizedLogin(options.trustedActor)) {
    throw new Error("--actor must name a trusted comment author.");
  }
  if (options.sourceRunId && !RUN_ID_PATTERN.test(String(options.sourceRunId))) {
    throw new Error("--source-run-id must contain only digits.");
  }
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

export async function collectDraftReviewSnapshot(options, token) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const basePath = `/repos/${repositoryPath}`;
  const [pullRequest, comments] = await Promise.all([
    githubJson(`${apiBase}${basePath}/pulls/${options.pullRequest}`, token),
    restPages(apiBase, `${basePath}/issues/${options.pullRequest}/comments`, token),
  ]);
  return { pullRequest, comments };
}

async function postDraftReviewCommand(options, token, body) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const response = await githubJson(
    `${apiBase}/repos/${repositoryPath}/issues/${options.pullRequest}/comments`,
    token,
    { method: "POST", body: JSON.stringify({ body }) },
  );
  return { id: Number(response?.id || 0) || null, url: response?.html_url || null };
}

function summarizeDraftReview(result) {
  return {
    status: result.status,
    reason: result.reason,
    repository: result.repository || null,
    pullRequest: result.pullRequest || null,
    expectedHeadSha: result.expectedHeadSha,
    expectedBaseSha: result.expectedBaseSha,
    liveHeadSha: result.liveHeadSha || null,
    liveBaseSha: result.liveBaseSha || null,
    isDraft: result.isDraft ?? null,
    isClosed: result.isClosed ?? null,
    isFork: result.isFork ?? null,
    sourceRunId: result.sourceRunId ?? null,
    trustedActor: result.trustedActor || null,
    mode: result.mode || null,
    commentCreated: result.commentCreated ?? false,
    commentId: result.commentId ?? null,
    commentUrl: result.commentUrl ?? null,
    existingCommentId: result.existingCommentId ?? null,
    requestedAt: result.requestedAt ?? null,
  };
}

export async function writeDraftReviewArtifact(result, output = "output/draft-review/draft-review.json") {
  const destination = resolveOutputPath(output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(summarizeDraftReview(result), null, 2)}\n`, "utf8");
  return destination;
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
  const lines = [
    "### Draft Codex review request",
    "",
    `- Result: **${String(result.status).toUpperCase()}** (${result.reason})`,
    `- Pull request: ${result.pullRequest ?? "unavailable"}`,
    `- Expected head/base: \`${result.expectedHeadSha}\` / \`${result.expectedBaseSha}\``,
    `- Live head/base: \`${result.liveHeadSha ?? "unavailable"}\` / \`${result.liveBaseSha ?? "unavailable"}\``,
    `- Draft: ${String(result.isDraft ?? "unknown")}; fork: ${String(result.isFork ?? "unknown")}`,
    `- Comment created: ${String(result.commentCreated ?? false)}${result.commentId ? ` (id ${result.commentId})` : ""}`,
    "",
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
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

function mergeCommon(result, options) {
  return Object.freeze({
    ...result,
    repository: options.repository,
    trustedActor: options.trustedActor,
    mode: options.mode,
  });
}

function unavailableResult(options) {
  return mergeCommon(Object.freeze({
    status: "unavailable",
    reason: "github_evidence_unavailable",
    repository: options.repository,
    pullRequest: options.pullRequest,
    expectedHeadSha: options.expectedHeadSha,
    expectedBaseSha: options.expectedBaseSha,
    liveHeadSha: null,
    liveBaseSha: null,
    isDraft: null,
    isClosed: null,
    isFork: null,
    sourceRunId: options.sourceRunId || null,
    commentCreated: false,
  }), options);
}

async function runPlan(options) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  let result;
  try {
    const snapshot = await collectDraftReviewSnapshot(options, token);
    result = mergeCommon(evaluateDraftReviewEligibility({
      repository: options.repository,
      pullRequest: snapshot.pullRequest,
      comments: snapshot.comments,
      expectedHeadSha: options.expectedHeadSha,
      expectedBaseSha: options.expectedBaseSha,
      sourceRunId: options.sourceRunId || null,
      trustedActor: options.trustedActor,
      workflowRun: null,
    }), options);
  } catch (error) {
    result = unavailableResult(options);
    await persistResult(result, options);
    throw new Error(`Draft review evidence is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  await persistResult(result, options);
  return result;
}

async function runRequest(options) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  let decision;
  try {
    const snapshot = await collectDraftReviewSnapshot(options, token);
    decision = mergeCommon(evaluateDraftReviewEligibility({
      repository: options.repository,
      pullRequest: snapshot.pullRequest,
      comments: snapshot.comments,
      expectedHeadSha: options.expectedHeadSha,
      expectedBaseSha: options.expectedBaseSha,
      sourceRunId: options.sourceRunId || null,
      trustedActor: options.trustedActor,
      workflowRun: null,
    }), options);
  } catch (error) {
    const unavailable = unavailableResult(options);
    await persistResult(unavailable, options);
    throw new Error(`Draft review evidence is unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (decision.status === "already_requested") {
    await persistResult(decision, options);
    return decision;
  }
  if (decision.status !== "eligible") {
    await persistResult(decision, options);
    throw new Error(`Draft review request blocked: ${decision.reason}.`);
  }
  const command = buildDraftReviewCommand({
    headSha: options.expectedHeadSha,
    baseSha: options.expectedBaseSha,
    sourceRunId: options.sourceRunId || null,
  });
  let posted;
  try {
    posted = await postDraftReviewCommand(options, token, command);
  } catch (error) {
    const failed = mergeCommon(Object.freeze({
      ...decision,
      status: "request_failed",
      reason: "comment_post_failed",
      commentCreated: false,
    }), options);
    await persistResult(failed, options);
    throw new Error(`Draft review comment failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const result = mergeCommon(Object.freeze({
    ...decision,
    status: "requested",
    reason: "requested",
    commentCreated: true,
    commentId: posted.id,
    commentUrl: posted.url,
    requestedAt: new Date().toISOString(),
  }), options);
  await persistResult(result, options);
  return result;
}

async function run(options) {
  if (options.mode === "plan") return runPlan(options);
  return runRequest(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run(parseDraftReviewArguments(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
