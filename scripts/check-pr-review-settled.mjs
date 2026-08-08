#!/usr/bin/env node

import { appendFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const DRAFT_REQUEST_PATTERN = /^@codex review\r?\n\r?\nReview exact head SHA `([0-9a-f]{40})` on base SHA `([0-9a-f]{40})`\.\r?\n\r?\n<!-- pageroot-codex-review-sha:([0-9a-f]{40});base-sha:([0-9a-f]{40}) -->[ \t]*(?:\r?\n)?$/u;
const CODEX_LOGIN = "chatgpt-codex-connector";
const TRUSTED_REQUEST_ASSOCIATIONS = new Set(["OWNER", "MEMBER", "COLLABORATOR"]);
const REVIEW_STATES = new Set(["APPROVED", "CHANGES_REQUESTED", "COMMENTED"]);
const BLOCKING_PRIORITIES = new Set(["P0", "P1", "P2"]);
const DEFAULT_SETTLE_SECONDS = 180;
const DEFAULT_TIMEOUT_SECONDS = 20 * 60;
const DEFAULT_POLL_SECONDS = 20;
const MAX_REST_PAGES = 20;
const CODEX_ENVIRONMENT_UNAVAILABLE_PATTERN = /\bcreate an environment for this repo\b/iu;
const CODEX_CLEAN_COMPLETION_PATTERN = /^Codex Review:\s*Didn't find any major issues\.[^\r\n]*\r?\n\r?\n/iu;

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

function assertSha(value, label) {
  const normalized = String(value || "").toLowerCase();
  if (!SHA_PATTERN.test(normalized)) {
    throw new Error(`${label} must be a 40-character lowercase Git SHA.`);
  }
  return normalized;
}

function requestIdentity(body) {
  const match = String(body || "").match(DRAFT_REQUEST_PATTERN);
  if (!match) return null;
  const headSha = match[1];
  const baseSha = match[2];
  if (match[3] !== headSha || match[4] !== baseSha) return null;
  return Object.freeze({ headSha, baseSha });
}

export function reviewRequestSha(body) {
  return requestIdentity(body)?.headSha || null;
}

export function reviewRequestBaseSha(body) {
  return requestIdentity(body)?.baseSha || null;
}

export function reviewedCommitPrefix(body) {
  const match = String(body || "").match(
    /\*\*Reviewed commit:\*\*\s*`([0-9a-f]{10,40})`/iu,
  );
  return match?.[1]?.toLowerCase() || null;
}

export function reviewPriority(body) {
  const match = String(body || "").match(/\bP([0-3])(?:\s+Badge|\b)/iu);
  return match ? `P${match[1]}` : null;
}

function commentAuthor(comment) {
  return comment?.user?.login || comment?.author?.login || comment?.author || "";
}

function commentAssociation(comment) {
  return String(comment?.author_association || comment?.authorAssociation || "").toUpperCase();
}

function commentCreatedAt(comment) {
  return comment?.created_at || comment?.createdAt || "";
}

function commentUpdatedAt(comment) {
  return comment?.updated_at || comment?.updatedAt || commentCreatedAt(comment);
}

function isTrustedRequestComment(comment) {
  const createdAt = timestamp(commentCreatedAt(comment));
  const updatedAt = timestamp(commentUpdatedAt(comment));
  return (
    !isCodexActor(commentAuthor(comment))
    && TRUSTED_REQUEST_ASSOCIATIONS.has(commentAssociation(comment))
    && Number.isFinite(createdAt)
    && updatedAt === createdAt
    && Boolean(requestIdentity(comment?.body))
  );
}

export function latestExactReviewRequest(issueComments, expectedHeadSha, expectedBaseSha) {
  const expectedHead = assertSha(expectedHeadSha, "expectedHeadSha");
  const expectedBase = assertSha(expectedBaseSha, "expectedBaseSha");
  return (issueComments || [])
    .filter((comment) => {
      if (!isTrustedRequestComment(comment)) return false;
      const identity = requestIdentity(comment.body);
      return identity.headSha === expectedHead && identity.baseSha === expectedBase;
    })
    .sort((left, right) => (
      timestamp(commentCreatedAt(right)) - timestamp(commentCreatedAt(left))
    ))[0] || null;
}

function hasCrossBaseReviewRequest(issueComments, expectedHeadSha, expectedBaseSha) {
  return (issueComments || []).some((comment) => {
    if (!isTrustedRequestComment(comment)) return false;
    const identity = requestIdentity(comment?.body);
    return (
      identity.headSha === expectedHeadSha
      && identity.baseSha !== expectedBaseSha
    );
  });
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

function latestDraftEventAtOrBefore(timelineEvents, readyAt) {
  return (timelineEvents || [])
    .filter((event) => (
      ["convert_to_draft", "converted_to_draft"].includes(event?.event)
      && Number.isFinite(timestamp(event?.created_at || event?.createdAt))
      && timestamp(event?.created_at || event?.createdAt) <= readyAt
    ))
    .sort((left, right) => (
      timestamp(right?.created_at || right?.createdAt)
      - timestamp(left?.created_at || left?.createdAt)
    ))[0] || null;
}

function inInterval(at, atOrAfter, before = Number.POSITIVE_INFINITY) {
  return Number.isFinite(at) && at >= atOrAfter && at < before;
}

function strictlyInInterval(at, after, before = Number.POSITIVE_INFINITY) {
  return Number.isFinite(at) && at > after && at < before;
}

function substantiveReviewSignal(review, expectedHeadSha, after, before) {
  const completedAt = timestamp(review?.submitted_at || review?.submittedAt);
  const state = String(review?.state || "").toUpperCase();
  const commitSha = String(
    review?.commit_id || review?.commit?.oid || review?.commitSha || "",
  ).toLowerCase();
  const prefix = reviewedCommitPrefix(review?.body);
  if (
    !isCodexActor(review?.user?.login || review?.author?.login || review?.author)
    || !REVIEW_STATES.has(state)
    || commitSha !== expectedHeadSha
    || !prefix
    || !expectedHeadSha.startsWith(prefix)
    || !strictlyInInterval(completedAt, after, before)
  ) return null;
  return {
    kind: "substantive_review",
    scope: "pull_request_review",
    at: completedAt,
    id: review?.id || review?.databaseId || null,
  };
}

function cleanReactionSignal(reaction, scope, after, before) {
  const completedAt = timestamp(reaction?.created_at || reaction?.createdAt);
  if (
    !isCodexActor(reaction?.user?.login || reaction?.author?.login || reaction?.author)
    || !["+1", "THUMBS_UP"].includes(reaction?.content)
    || !strictlyInInterval(completedAt, after, before)
  ) return null;
  return {
    kind: "clean_review_reaction",
    scope,
    at: completedAt,
    id: reaction?.id || reaction?.databaseId || null,
  };
}

function cleanCompletionCommentSignal(comment, expectedHeadSha, after, before) {
  const completedAt = timestamp(commentCreatedAt(comment));
  const updatedAt = timestamp(commentUpdatedAt(comment));
  const prefix = reviewedCommitPrefix(comment?.body);
  if (
    !isCodexActor(commentAuthor(comment))
    || updatedAt !== completedAt
    || !CODEX_CLEAN_COMPLETION_PATTERN.test(String(comment?.body || ""))
    || !prefix
    || !expectedHeadSha.startsWith(prefix)
    || !strictlyInInterval(completedAt, after, before)
  ) return null;
  return {
    kind: "clean_review_comment",
    scope: "issue_comment",
    at: completedAt,
    id: comment?.id || comment?.databaseId || null,
  };
}

function reviewCompletionSignals({
  expectedHeadSha,
  after,
  before = Number.POSITIVE_INFINITY,
  reviews = [],
  completionComments = [],
  reactionGroups = [],
}) {
  const signals = [];
  for (const review of reviews) {
    const signal = substantiveReviewSignal(review, expectedHeadSha, after, before);
    if (signal) signals.push(signal);
  }
  for (const comment of completionComments) {
    const signal = cleanCompletionCommentSignal(
      comment,
      expectedHeadSha,
      after,
      before,
    );
    if (signal) signals.push(signal);
  }
  for (const group of reactionGroups) {
    for (const reaction of group.reactions || []) {
      const signal = cleanReactionSignal(reaction, group.scope, after, before);
      if (signal) signals.push(signal);
    }
  }
  return signals.sort((left, right) => right.at - left.at);
}

function latestCodexEnvironmentFailure(issueComments, atOrAfter, before) {
  return (issueComments || [])
    .flatMap((comment) => {
      const failedAt = timestamp(commentCreatedAt(comment));
      if (
        !isCodexActor(commentAuthor(comment))
        || !CODEX_ENVIRONMENT_UNAVAILABLE_PATTERN.test(comment?.body || "")
        || !inInterval(failedAt, atOrAfter, before)
      ) return [];
      return [{
        kind: "codex_environment_unavailable",
        at: failedAt,
        id: comment?.id || comment?.databaseId || null,
      }];
    })
    .sort((left, right) => right.at - left.at)[0] || null;
}

function completionSummary(completion) {
  if (!completion) return null;
  return Object.freeze({
    kind: completion.kind,
    scope: completion.scope || null,
    id: completion.id,
    at: new Date(completion.at).toISOString(),
  });
}

function threadComments(thread) {
  if (Array.isArray(thread?.comments)) return thread.comments;
  return thread?.comments?.nodes || [];
}

function blockingThreads(reviewThreads) {
  return (reviewThreads || []).flatMap((thread) => {
    if (thread?.isResolved === true || thread?.is_resolved === true) return [];
    if (thread?.isOutdated === true || thread?.is_outdated === true) return [];
    const original = threadComments(thread)[0];
    if (!original || !isCodexActor(commentAuthor(original))) return [];
    const priority = reviewPriority(original.body);
    if (priority === "P3") return [];
    if (priority && !BLOCKING_PRIORITIES.has(priority)) return [];
    return [{
      priority: priority || "unclassified",
      path: original.path || null,
      commentId: original.databaseId || original.id || null,
    }];
  });
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

function outcome(identity, status, reason, fields = {}) {
  return Object.freeze({
    ...identity,
    status,
    reason,
    request: null,
    promotion: null,
    draftCompletion: null,
    completion: null,
    settlesAt: null,
    blockingThreads: [],
    ...fields,
  });
}

export function evaluateReviewSettlement({
  expectedHeadSha,
  expectedBaseSha,
  pullRequest,
  issueComments = [],
  timelineEvents = [],
  reviews = [],
  reviewThreads = [],
  requestReactions = [],
  pullRequestReactions = [],
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
  if (currentHeadSha !== expectedHead) {
    return outcome(identity, "blocked", "head_sha_changed");
  }
  if (currentBaseSha !== expectedBase) {
    return outcome(identity, "blocked", "base_sha_changed");
  }
  if (String(pullRequest?.state || "").toLowerCase() !== "open") {
    return outcome(identity, "blocked", "pull_request_not_open");
  }
  if (pullRequest?.draft === true || pullRequest?.isDraft === true) {
    return outcome(identity, "blocked", "pull_request_is_draft");
  }

  const readyEvent = latestReadyForReviewEvent(timelineEvents);
  if (!readyEvent) {
    return outcome(identity, "waiting", "ready_transition_missing");
  }
  const readyAt = timestamp(readyEvent?.created_at || readyEvent?.createdAt);
  const draftEvent = latestDraftEventAtOrBefore(timelineEvents, readyAt);
  if (
    draftEvent
    && timestamp(draftEvent?.created_at || draftEvent?.createdAt) === readyAt
  ) {
    return outcome(identity, "blocked", "draft_ready_order_ambiguous");
  }
  const draftStartedAt = draftEvent
    ? timestamp(draftEvent?.created_at || draftEvent?.createdAt)
    : timestamp(pullRequest?.created_at || pullRequest?.createdAt);
  if (!Number.isFinite(draftStartedAt)) {
    return outcome(identity, "blocked", "draft_interval_unavailable");
  }
  const promotion = Object.freeze({
    id: readyEvent?.id || readyEvent?.databaseId || null,
    at: new Date(readyAt).toISOString(),
    draftStartedAt: new Date(draftStartedAt).toISOString(),
  });

  const request = latestExactReviewRequest(issueComments, expectedHead, expectedBase);
  if (!request) {
    return outcome(identity, "blocked", "exact_sha_review_not_requested", { promotion });
  }
  const requestAt = timestamp(commentCreatedAt(request));
  const requestSummary = Object.freeze({
    id: request?.id || request?.databaseId || null,
    at: new Date(requestAt).toISOString(),
  });
  if (hasCrossBaseReviewRequest(issueComments, expectedHead, expectedBase)) {
    return outcome(identity, "blocked", "same_head_cross_base_request_ambiguous", {
      request: requestSummary,
      promotion,
    });
  }
  if (requestAt <= draftStartedAt || requestAt >= readyAt) {
    return outcome(identity, "blocked", "exact_sha_request_not_in_latest_draft", {
      request: requestSummary,
      promotion,
    });
  }

  const draftCompletion = reviewCompletionSignals({
    expectedHeadSha: expectedHead,
    after: requestAt,
    before: readyAt,
    reviews,
    completionComments: issueComments,
    reactionGroups: [
      { scope: "request_comment", reactions: requestReactions },
      { scope: "pull_request", reactions: pullRequestReactions },
    ],
  })[0] || null;
  const draftEnvironmentFailure = latestCodexEnvironmentFailure(
    issueComments,
    requestAt,
    readyAt,
  );
  if (
    draftEnvironmentFailure
    && (!draftCompletion || draftEnvironmentFailure.at >= draftCompletion.at)
  ) {
    return outcome(identity, "blocked", "draft_review_environment_unavailable", {
      request: requestSummary,
      promotion,
      draftCompletion: completionSummary(draftCompletion),
    });
  }
  if (!draftCompletion) {
    return outcome(identity, "blocked", "draft_review_not_completed_before_promotion", {
      request: requestSummary,
      promotion,
    });
  }

  const finalCompletion = reviewCompletionSignals({
    expectedHeadSha: expectedHead,
    after: readyAt,
    reviews,
    completionComments: issueComments,
    reactionGroups: [{ scope: "pull_request", reactions: pullRequestReactions }],
  })[0] || null;
  const finalEnvironmentFailure = latestCodexEnvironmentFailure(
    issueComments,
    readyAt,
    Number.POSITIVE_INFINITY,
  );
  if (
    finalEnvironmentFailure
    && (!finalCompletion || finalEnvironmentFailure.at >= finalCompletion.at)
  ) {
    return outcome(identity, "blocked", "final_review_environment_unavailable", {
      request: requestSummary,
      promotion,
      draftCompletion: completionSummary(draftCompletion),
      completion: completionSummary(finalCompletion),
    });
  }
  if (!finalCompletion) {
    return outcome(identity, "waiting", "final_review_in_progress", {
      request: requestSummary,
      promotion,
      draftCompletion: completionSummary(draftCompletion),
    });
  }

  const settlesAtMs = finalCompletion.at + settleSeconds * 1000;
  const fields = {
    request: requestSummary,
    promotion,
    draftCompletion: completionSummary(draftCompletion),
    completion: completionSummary(finalCompletion),
    settlesAt: new Date(settlesAtMs).toISOString(),
  };
  if (nowMs < settlesAtMs) {
    return outcome(identity, "waiting", "settle_window", fields);
  }

  const unresolved = blockingThreads(reviewThreads);
  if (unresolved.length > 0) {
    return outcome(identity, "blocked", "unresolved_blocking_threads", {
      ...fields,
      blockingThreads: unresolved,
    });
  }
  return outcome(identity, "settled", "exact_sha_review_settled", fields);
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
  if (!Number.isInteger(options.settleSeconds) || options.settleSeconds < 0 || options.settleSeconds > 600) {
    throw new Error("--settle-seconds must be an integer from 0 to 600.");
  }
  if (!Number.isInteger(options.timeoutSeconds) || options.timeoutSeconds < 1 || options.timeoutSeconds > 3600) {
    throw new Error("--timeout-seconds must be an integer from 1 to 3600.");
  }
  if (!Number.isInteger(options.pollSeconds) || options.pollSeconds < 1 || options.pollSeconds > 60) {
    throw new Error("--poll-seconds must be an integer from 1 to 60.");
  }
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

async function collectReviewThreads({ graphqlUrl, owner, name, pullRequest, token }) {
  const query = `
    query($owner: String!, $name: String!, $number: Int!, $after: String) {
      repository(owner: $owner, name: $name) {
        pullRequest(number: $number) {
          reviewThreads(first: 100, after: $after) {
            nodes {
              isResolved
              isOutdated
              comments(first: 20) {
                nodes {
                  databaseId
                  path
                  body
                  createdAt
                  author { login }
                }
              }
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
    const response = await githubJson(graphqlUrl, token, {
      method: "POST",
      body: JSON.stringify({
        query,
        variables: { owner, name, number: pullRequest, after },
      }),
    });
    if (response.errors?.length) {
      throw new Error(`GitHub GraphQL: ${response.errors.map((error) => error.message).join("; ")}`);
    }
    const connection = response?.data?.repository?.pullRequest?.reviewThreads;
    if (!connection) throw new Error("Pull Request review threads were unavailable.");
    threads.push(...(connection.nodes || []));
    if (!connection.pageInfo?.hasNextPage) return threads;
    after = connection.pageInfo.endCursor;
    if (!after) throw new Error("GitHub review-thread pagination omitted endCursor.");
  }
}

async function collectSnapshot(options, token) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const graphqlUrl = process.env.GITHUB_GRAPHQL_URL
    || `${apiBase.replace(/\/api\/v3$/u, "/api")}/graphql`;
  const [owner, name] = options.repository.split("/");
  const repositoryPath = [owner, name].map(encodeURIComponent).join("/");
  const basePath = `/repos/${repositoryPath}`;
  const [
    pullRequest,
    issueComments,
    timelineEvents,
    reviews,
    pullRequestReactions,
    reviewThreads,
  ] = await Promise.all([
    githubJson(`${apiBase}${basePath}/pulls/${options.pullRequest}`, token),
    restPages(apiBase, `${basePath}/issues/${options.pullRequest}/comments`, token),
    restPages(apiBase, `${basePath}/issues/${options.pullRequest}/events`, token),
    restPages(apiBase, `${basePath}/pulls/${options.pullRequest}/reviews`, token),
    restPages(apiBase, `${basePath}/issues/${options.pullRequest}/reactions`, token),
    collectReviewThreads({
      graphqlUrl,
      owner,
      name,
      pullRequest: options.pullRequest,
      token,
    }),
  ]);
  const request = latestExactReviewRequest(
    issueComments,
    options.expectedHeadSha,
    options.expectedBaseSha,
  );
  const requestId = request?.id || request?.databaseId;
  const requestReactions = requestId
    ? await restPages(apiBase, `${basePath}/issues/comments/${requestId}/reactions`, token)
    : [];
  return {
    pullRequest,
    issueComments,
    timelineEvents,
    reviews,
    reviewThreads,
    requestReactions,
    pullRequestReactions,
  };
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function conciseResult(result) {
  return {
    status: result.status,
    reason: result.reason,
    expectedHeadSha: result.expectedHeadSha,
    currentHeadSha: result.currentHeadSha,
    expectedBaseSha: result.expectedBaseSha,
    currentBaseSha: result.currentBaseSha,
    request: result.request,
    promotion: result.promotion,
    draftCompletion: result.draftCompletion,
    completion: result.completion,
    settlesAt: result.settlesAt,
    blockingThreads: result.blockingThreads,
  };
}

async function appendSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const status = result.status === "settled" ? "PASS" : "BLOCKED";
  const lines = [
    "### Exact head/base Codex review",
    "",
    `- Result: **${status}** (${result.reason})`,
    `- Expected/current head: \`${result.expectedHeadSha}\` / \`${result.currentHeadSha || "unavailable"}\``,
    `- Expected/current base: \`${result.expectedBaseSha}\` / \`${result.currentBaseSha || "unavailable"}\``,
    `- Draft exact-head/base request: ${result.request ? `comment ${result.request.id} at ${result.request.at}` : "missing"}`,
    `- Ready promotion: ${result.promotion ? `event ${result.promotion.id} at ${result.promotion.at}` : "missing"}`,
    `- Draft completion: ${result.draftCompletion ? `${result.draftCompletion.kind} at ${result.draftCompletion.at}` : "not observed"}`,
    `- Post-Ready completion: ${result.completion ? `${result.completion.kind} at ${result.completion.at}` : "not observed"}`,
    `- Settle boundary: ${result.settlesAt || "not reached"}`,
    `- Blocking active threads: ${result.blockingThreads.length}`,
    "",
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}

async function run(options) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  const deadline = Date.now() + options.timeoutSeconds * 1000;
  let lastReason = "";
  for (;;) {
    let snapshot;
    try {
      snapshot = await collectSnapshot(options, token);
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      if (lastReason !== "github_evidence_unavailable") {
        console.warn(`GitHub review evidence is temporarily unavailable: ${error instanceof Error ? error.message : String(error)}`);
        lastReason = "github_evidence_unavailable";
      }
      await delay(Math.min(options.pollSeconds * 1000, Math.max(1, deadline - Date.now())));
      continue;
    }
    const result = evaluateReviewSettlement({
      expectedHeadSha: options.expectedHeadSha,
      expectedBaseSha: options.expectedBaseSha,
      ...snapshot,
      settleSeconds: options.settleSeconds,
    });
    if (result.reason !== lastReason || result.status !== "waiting") {
      console.log(JSON.stringify(conciseResult(result), null, 2));
      lastReason = result.reason;
    }
    if (result.status === "settled") {
      await appendSummary(result);
      return result;
    }
    if (result.status === "blocked") {
      await appendSummary(result);
      throw new Error(`Codex review gate blocked: ${result.reason}.`);
    }
    if (Date.now() >= deadline) {
      const timedOut = Object.freeze({
        ...result,
        status: "blocked",
        reason: "review_wait_timed_out",
      });
      await appendSummary(timedOut);
      throw new Error("Codex review did not settle before the review wait timeout.");
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
