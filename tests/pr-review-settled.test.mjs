import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReviewSettlement,
  latestExactReviewRequest,
  reviewedCommitPrefix,
  reviewPriority,
  reviewRequestSha,
  visibleReviewRequestSha,
} from "../scripts/check-pr-review-settled.mjs";

const headSha = "a".repeat(40);
const oldSha = "b".repeat(40);
const requestAt = "2026-08-08T04:00:00.000Z";
const draftCompletedAt = "2026-08-08T04:00:30.000Z";
const readyAt = "2026-08-08T04:01:00.000Z";
const completedAt = "2026-08-08T04:02:00.000Z";

function request({
  sha = headSha,
  createdAt = requestAt,
  updatedAt = createdAt,
  association = "OWNER",
  id = 10,
} = {}) {
  return {
    id,
    body: `@codex review\n\nReview exact SHA \`${sha}\`.\n\n<!-- pageroot-codex-review-sha:${sha} -->`,
    user: { login: "maintainer" },
    author_association: association,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function pullRequest({ sha = headSha, draft = false, state = "open" } = {}) {
  return { head: { sha }, draft, state };
}

function exactReview({ sha = headSha, submittedAt = completedAt, id = 20 } = {}) {
  return {
    id,
    user: { login: "chatgpt-codex-connector" },
    commit_id: sha,
    submitted_at: submittedAt,
    state: "COMMENTED",
  };
}

function draftReview(overrides = {}) {
  return exactReview({ id: 19, submittedAt: draftCompletedAt, ...overrides });
}

function codexThread({
  priority = "P2",
  resolved = false,
  outdated = false,
  path = "scripts/example.mjs",
} = {}) {
  return {
    isResolved: resolved,
    isOutdated: outdated,
    comments: {
      nodes: [{
        databaseId: 30,
        author: { login: "chatgpt-codex-connector" },
        path,
        body: `**![${priority} Badge](https://example.test/${priority}) Finding**`,
      }],
    },
  };
}

function evaluate(overrides = {}) {
  return evaluateReviewSettlement({
    expectedHeadSha: headSha,
    pullRequest: pullRequest(),
    issueComments: [request()],
    timelineEvents: [{ id: 15, event: "ready_for_review", created_at: readyAt }],
    reviews: [draftReview(), exactReview()],
    reviewThreads: [],
    now: new Date("2026-08-08T04:05:01.000Z"),
    settleSeconds: 180,
    ...overrides,
  });
}

test("exact-SHA review requests require the trusted hidden marker", () => {
  assert.equal(reviewRequestSha(request().body), headSha);
  assert.equal(visibleReviewRequestSha(request().body), headSha);
  assert.equal(reviewedCommitPrefix("**Reviewed commit:** `aaaaaaaaaa`"), "aaaaaaaaaa");
  assert.equal(reviewPriority("![P1 Badge](badge)"), "P1");
  assert.equal(latestExactReviewRequest([
    request({ id: 1, createdAt: "2026-08-08T03:00:00.000Z" }),
    request({ id: 2, createdAt: "2026-08-08T03:30:00.000Z" }),
    request({ id: 3, association: "CONTRIBUTOR" }),
    { ...request({ id: 4 }), body: "@codex review" },
    {
      ...request({ id: 5 }),
      body: request().body.replace(`Review exact SHA \`${headSha}\``, `Review exact SHA \`${oldSha}\``),
    },
  ], headSha).id, 2);
  assert.equal(visibleReviewRequestSha(
    request().body.replace(
      `Review exact SHA \`${headSha}\`.`,
      `<!-- Review exact SHA \`${headSha}\`. -->\nReview exact SHA \`${oldSha}\`.`,
    ),
  ), null);
  assert.equal(visibleReviewRequestSha(
    `${request().body}\nReview exact SHA \`${headSha}\`.`,
  ), null);
  assert.equal(visibleReviewRequestSha(
    `${request().body}\n<!-- unterminated`,
  ), null);
  assert.equal(visibleReviewRequestSha(
    `@codex review\n\n[request]: https://example.test "Review exact SHA \`${headSha}\`"\n\n<!-- pageroot-codex-review-sha:${headSha} -->`,
  ), null);
  assert.equal(reviewRequestSha(
    `${request().body}\n<!-- pageroot-codex-review-sha:${headSha} -->`,
  ), null);
});

test("Draft and final Codex reviews bind to the current full head SHA and their promotion phase", () => {
  assert.equal(evaluate().status, "settled");
  assert.equal(evaluate().draftCompletion.at, draftCompletedAt);
  assert.equal(evaluate({
    reviews: [draftReview({ sha: oldSha }), exactReview()],
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    reviews: [draftReview({ submittedAt: "2026-08-08T03:59:59.000Z" }), exactReview()],
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    reviews: [draftReview()],
  }).reason, "codex_review_in_progress");
  assert.equal(evaluate({
    reviews: [draftReview(), exactReview({ sha: oldSha })],
  }).reason, "codex_review_in_progress");
  assert.equal(evaluate({ pullRequest: pullRequest({ sha: oldSha }) }).reason, "head_sha_changed");
});

test("clean Codex completion comments and reactions remain exact-request-bound", () => {
  const cleanComment = {
    id: 40,
    user: { login: "chatgpt-codex-connector[bot]" },
    created_at: completedAt,
    body: "Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** `aaaaaaaaaa`",
  };
  assert.equal(evaluate({
    issueComments: [request(), cleanComment],
    reviews: [draftReview()],
  }).completion.kind, "review_completion_comment");
  assert.equal(evaluate({
    reviews: [draftReview()],
    requestReactions: [{
      id: 50,
      user: { login: "chatgpt-codex-connector[bot]" },
      content: "+1",
      created_at: completedAt,
    }],
  }).completion.kind, "clean_review_reaction");
  assert.equal(evaluate({
    reviews: [draftReview()],
    issueReactions: [{
      id: 51,
      user: { login: "chatgpt-codex-connector[bot]" },
      content: "+1",
      created_at: "2026-08-08T03:59:00.000Z",
    }],
  }).reason, "codex_review_in_progress");
});

test("Codex environment failures block promotion immediately until a later Draft review succeeds", () => {
  const unavailable = {
    id: 60,
    user: { login: "chatgpt-codex-connector" },
    created_at: "2026-08-08T04:00:10.000Z",
    body: "To use Codex here, create an environment for this repo.",
  };
  assert.equal(evaluate({
    issueComments: [request(), unavailable],
    reviews: [exactReview()],
  }).reason, "codex_review_environment_unavailable");
  assert.equal(evaluate({
    issueComments: [request(), unavailable],
    reviews: [draftReview(), exactReview()],
  }).status, "settled");
});

test("the settle window prevents late review threads from racing the full gate", () => {
  const result = evaluate({ now: new Date("2026-08-08T04:04:59.999Z") });
  assert.equal(result.status, "waiting");
  assert.equal(result.reason, "settle_window");
  assert.equal(result.settlesAt, "2026-08-08T04:05:00.000Z");
});

test("unresolved current P0-P2 Codex threads block while resolved, outdated and P3 threads do not", () => {
  for (const priority of ["P0", "P1", "P2"]) {
    const result = evaluate({ reviewThreads: [codexThread({ priority })] });
    assert.equal(result.status, "blocked");
    assert.equal(result.reason, "unresolved_blocking_threads");
    assert.equal(result.blockingThreads[0].priority, priority);
  }
  assert.equal(evaluate({
    reviewThreads: [
      codexThread({ priority: "P1", resolved: true }),
      codexThread({ priority: "P2", outdated: true }),
      codexThread({ priority: "P3" }),
    ],
  }).status, "settled");
});

test("Ready promotion fails closed when the exact request is absent or the PR returns to Draft", () => {
  assert.equal(evaluate({ issueComments: [] }).reason, "exact_sha_review_not_requested");
  assert.equal(evaluate({ timelineEvents: [] }).reason, "ready_transition_missing");
  assert.equal(evaluate({
    issueComments: [request({ createdAt: "2026-08-08T04:01:30.000Z" })],
  }).reason, "exact_sha_request_not_in_draft");
  assert.equal(evaluate({ pullRequest: pullRequest({ draft: true }) }).reason, "pull_request_is_draft");
  assert.equal(evaluate({ pullRequest: pullRequest({ state: "closed" }) }).reason, "pull_request_not_open");
});
