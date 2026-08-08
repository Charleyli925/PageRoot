import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateReviewSettlement,
  latestExactReviewRequest,
  latestFinalReviewRequest,
  reviewedCommitPrefix,
  reviewPriority,
  finalReviewRequestBaseSha,
  finalReviewRequestSha,
  reviewRequestBaseSha,
  reviewRequestSha,
  visibleFinalReviewRequestBaseSha,
  visibleFinalReviewRequestSha,
  visibleReviewRequestBaseSha,
  visibleReviewRequestSha,
} from "../scripts/check-pr-review-settled.mjs";

const headSha = "a".repeat(40);
const oldSha = "b".repeat(40);
const baseSha = "c".repeat(40);
const oldBaseSha = "d".repeat(40);
const createdAt = "2026-08-08T03:59:00.000Z";
const requestAt = "2026-08-08T04:00:00.000Z";
const draftCompletedAt = "2026-08-08T04:00:30.000Z";
const readyAt = "2026-08-08T04:01:00.000Z";
const finalRequestAt = "2026-08-08T04:01:15.000Z";
const completedAt = "2026-08-08T04:02:00.000Z";

function request({
  sha = headSha,
  base = baseSha,
  createdAt = requestAt,
  updatedAt = createdAt,
  association = "OWNER",
  id = 10,
} = {}) {
  return {
    id,
    body: `@codex review\n\nReview exact head SHA \`${sha}\` on base SHA \`${base}\`.\n\n<!-- pageroot-codex-review-sha:${sha};base-sha:${base} -->`,
    user: { login: "maintainer" },
    author_association: association,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function finalRequest({
  sha = headSha,
  base = baseSha,
  createdAt = finalRequestAt,
  updatedAt = createdAt,
  association = "OWNER",
  id = 11,
} = {}) {
  return {
    id,
    body: `@codex review\n\nFinal review exact head SHA \`${sha}\` on base SHA \`${base}\`.\n\n<!-- pageroot-codex-final-review-sha:${sha};base-sha:${base} -->`,
    user: { login: "maintainer" },
    author_association: association,
    created_at: createdAt,
    updated_at: updatedAt,
  };
}

function pullRequest({
  sha = headSha,
  base = baseSha,
  draft = false,
  state = "open",
} = {}) {
  return { head: { sha }, base: { sha: base }, draft, state, created_at: createdAt };
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
    expectedBaseSha: baseSha,
    pullRequest: pullRequest(),
    issueComments: [request(), finalRequest()],
    timelineEvents: [{ id: 15, event: "ready_for_review", created_at: readyAt }],
    reviews: [draftReview(), exactReview()],
    reviewThreads: [],
    now: new Date("2026-08-08T04:05:01.000Z"),
    settleSeconds: 180,
    ...overrides,
  });
}

test("Draft and final exact-head/base requests require distinct trusted canonical markers", () => {
  assert.equal(reviewRequestSha(request().body), headSha);
  assert.equal(reviewRequestBaseSha(request().body), baseSha);
  assert.equal(visibleReviewRequestSha(request().body), headSha);
  assert.equal(visibleReviewRequestBaseSha(request().body), baseSha);
  assert.equal(finalReviewRequestSha(finalRequest().body), headSha);
  assert.equal(finalReviewRequestBaseSha(finalRequest().body), baseSha);
  assert.equal(visibleFinalReviewRequestSha(finalRequest().body), headSha);
  assert.equal(visibleFinalReviewRequestBaseSha(finalRequest().body), baseSha);
  assert.equal(reviewRequestSha(finalRequest().body), null);
  assert.equal(finalReviewRequestSha(request().body), null);
  assert.equal(reviewedCommitPrefix("**Reviewed commit:** `aaaaaaaaaa`"), "aaaaaaaaaa");
  assert.equal(reviewPriority("![P1 Badge](badge)"), "P1");
  assert.equal(latestExactReviewRequest([
    request({ id: 1, createdAt: "2026-08-08T03:00:00.000Z" }),
    request({ id: 2, createdAt: "2026-08-08T03:30:00.000Z" }),
    request({ id: 3, association: "CONTRIBUTOR" }),
    { ...request({ id: 4 }), body: "@codex review" },
    {
      ...request({ id: 5 }),
      body: request().body.replace(`Review exact head SHA \`${headSha}\``, `Review exact head SHA \`${oldSha}\``),
    },
    request({
      id: 6,
      createdAt: "2026-08-08T03:45:00.000Z",
      updatedAt: "2026-08-08T03:59:00.000Z",
    }),
    request({ id: 7, base: oldBaseSha, createdAt: "2026-08-08T03:50:00.000Z" }),
  ], headSha, baseSha).id, 2);
  assert.equal(visibleReviewRequestSha(
    request().body.replace(
      `Review exact head SHA \`${headSha}\` on base SHA \`${baseSha}\`.`,
      `<!-- Review exact head SHA \`${headSha}\` on base SHA \`${baseSha}\`. -->\nReview exact head SHA \`${oldSha}\` on base SHA \`${baseSha}\`.`,
    ),
  ), null);
  assert.equal(visibleReviewRequestSha(
    `${request().body}\nReview exact head SHA \`${headSha}\` on base SHA \`${baseSha}\`.`,
  ), null);
  assert.equal(visibleReviewRequestSha(
    `${request().body}\n<!-- unterminated`,
  ), null);
  assert.equal(visibleReviewRequestSha(
    `@codex review\n\n[request]: https://example.test "Review exact head SHA \`${headSha}\` on base SHA \`${baseSha}\`"\n\n<!-- pageroot-codex-review-sha:${headSha};base-sha:${baseSha} -->`,
  ), null);
  assert.equal(reviewRequestSha(
    `${request().body}\n<!-- pageroot-codex-review-sha:${headSha};base-sha:${baseSha} -->`,
  ), null);
  assert.equal(reviewRequestSha(
    request().body.replace(`;base-sha:${baseSha}`, ""),
  ), null);
  assert.equal(latestFinalReviewRequest([
    finalRequest({ id: 7, createdAt: "2026-08-08T04:01:10.000Z" }),
    finalRequest({ id: 8, createdAt: "2026-08-08T04:01:20.000Z" }),
    finalRequest({ id: 9, association: "CONTRIBUTOR" }),
    {
      ...finalRequest({ id: 10 }),
      body: finalRequest().body.replace(`Final review exact head SHA \`${headSha}\``, `Final review exact head SHA \`${oldSha}\``),
    },
    finalRequest({ id: 11, base: oldBaseSha, createdAt: "2026-08-08T04:01:30.000Z" }),
  ], headSha, baseSha).id, 8);
  assert.equal(visibleFinalReviewRequestSha(
    finalRequest().body.replace("Final review exact head SHA", "Review exact head SHA"),
  ), null);
  assert.equal(finalReviewRequestSha(
    `${finalRequest().body}\n<!-- pageroot-codex-final-review-sha:${headSha};base-sha:${baseSha} -->`,
  ), null);
});

test("Draft and final Codex reviews bind to the current head/base pair and their promotion phase", () => {
  assert.equal(evaluate().status, "settled");
  assert.equal(evaluate().draftCompletion.at, draftCompletedAt);
  assert.equal(evaluate().finalRequest.at, finalRequestAt);
  assert.equal(evaluate({
    reviews: [draftReview({ sha: oldSha }), exactReview()],
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    reviews: [draftReview({ submittedAt: "2026-08-08T03:59:59.000Z" }), exactReview()],
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    reviews: [draftReview()],
  }).reason, "codex_final_review_in_progress");
  assert.equal(evaluate({
    reviews: [draftReview(), exactReview({ sha: oldSha })],
  }).reason, "codex_final_review_in_progress");
  assert.equal(evaluate({
    reviews: [draftReview(), { ...exactReview(), state: "DISMISSED" }],
  }).reason, "codex_final_review_in_progress");
  assert.equal(evaluate({
    issueComments: [request()],
  }).reason, "final_exact_sha_review_not_requested");
  assert.equal(evaluate({
    issueComments: [request(), finalRequest({
      createdAt: "2026-08-08T04:00:45.000Z",
    })],
  }).reason, "final_exact_sha_request_not_after_ready");
  assert.equal(evaluate({ pullRequest: pullRequest({ sha: oldSha }) }).reason, "head_sha_changed");
  assert.equal(evaluate({ pullRequest: pullRequest({ base: oldBaseSha }) }).reason, "base_sha_changed");
  assert.equal(evaluate({
    expectedBaseSha: oldBaseSha,
  }).reason, "base_sha_changed");
  assert.equal(evaluate({
    issueComments: [request({ base: oldBaseSha }), finalRequest()],
  }).reason, "exact_sha_review_not_requested");
  assert.equal(evaluate({
    issueComments: [request(), finalRequest({ base: oldBaseSha })],
  }).reason, "final_exact_sha_review_not_requested");
});

test("clean Codex comments and reactions bind to the correct exact-head/base request", () => {
  const cleanComment = {
    id: 40,
    user: { login: "chatgpt-codex-connector[bot]" },
    created_at: completedAt,
    body: "Codex Review: Didn't find any major issues.\n\n**Reviewed commit:** `aaaaaaaaaa`",
  };
  assert.equal(evaluate({
    issueComments: [request(), finalRequest(), cleanComment],
    reviews: [draftReview()],
  }).completion.kind, "review_completion_comment");
  assert.equal(evaluate({
    reviews: [draftReview()],
    finalRequestReactions: [{
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
      created_at: completedAt,
    }],
  }).reason, "codex_final_review_in_progress");
  assert.equal(evaluate({
    reviews: [exactReview()],
    requestReactions: [{
      id: 52,
      user: { login: "chatgpt-codex-connector[bot]" },
      content: "+1",
      created_at: draftCompletedAt,
    }],
  }).draftCompletion.kind, "clean_review_reaction");
  assert.equal(evaluate({
    reviews: [exactReview()],
    finalRequestReactions: [{
      id: 53,
      user: { login: "chatgpt-codex-connector[bot]" },
      content: "+1",
      created_at: draftCompletedAt,
    }],
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    reviews: [draftReview()],
    requestReactions: [{
      id: 54,
      user: { login: "chatgpt-codex-connector[bot]" },
      content: "+1",
      created_at: completedAt,
    }],
  }).reason, "codex_final_review_in_progress");
  assert.equal(evaluate({
    issueComments: [request(), finalRequest(), {
      id: 55,
      user: { login: "maintainer" },
      author_association: "OWNER",
      created_at: "2026-08-08T04:01:30.000Z",
      updated_at: "2026-08-08T04:01:30.000Z",
      body: "> @codex review\n\nQuoted context only.",
    }],
    reviews: [draftReview()],
    finalRequestReactions: [{
      id: 56,
      user: { login: "chatgpt-codex-connector[bot]" },
      content: "+1",
      created_at: completedAt,
    }],
  }).status, "settled");
  assert.equal(evaluate({
    reviews: [draftReview()],
    finalRequestReactions: [{
      id: 58,
      user: { login: "chatgpt-codex-connector[bot]" },
      content: "+1",
      created_at: "2026-08-08T04:01:14.000Z",
    }],
  }).reason, "codex_final_review_in_progress");
});

test("Codex environment failures block promotion immediately until a later Draft review succeeds", () => {
  const unavailable = {
    id: 60,
    user: { login: "chatgpt-codex-connector" },
    created_at: "2026-08-08T04:00:10.000Z",
    body: "To use Codex here, create an environment for this repo.",
  };
  assert.equal(evaluate({
    issueComments: [request(), finalRequest(), unavailable],
    reviews: [exactReview()],
  }).reason, "codex_review_environment_unavailable");
  assert.equal(evaluate({
    issueComments: [request(), finalRequest(), unavailable],
    reviews: [draftReview(), exactReview()],
  }).status, "settled");

  const finalUnavailable = {
    ...unavailable,
    id: 61,
    created_at: "2026-08-08T04:01:30.000Z",
  };
  assert.equal(evaluate({
    issueComments: [request(), finalRequest(), finalUnavailable],
    reviews: [draftReview()],
  }).reason, "codex_final_review_environment_unavailable");
  assert.equal(evaluate({
    issueComments: [request(), finalRequest(), finalUnavailable],
    reviews: [draftReview(), exactReview()],
  }).status, "settled");
});

test("repeated promotion cannot recycle requests or completions from an earlier Draft interval", () => {
  const repeatedTimeline = [
    { id: 70, event: "ready_for_review", created_at: readyAt },
    { id: 71, event: "convert_to_draft", created_at: "2026-08-08T04:03:00.000Z" },
    { id: 72, event: "ready_for_review", created_at: "2026-08-08T04:04:00.000Z" },
  ];
  assert.equal(evaluate({
    timelineEvents: repeatedTimeline,
    reviews: [draftReview(), exactReview(), exactReview({
      id: 73,
      submittedAt: "2026-08-08T04:05:00.000Z",
    })],
    now: new Date("2026-08-08T04:08:01.000Z"),
  }).reason, "exact_sha_request_not_in_latest_draft");
  assert.equal(evaluate({
    issueComments: [request({ createdAt: "2026-08-08T04:03:10.000Z" })],
    timelineEvents: repeatedTimeline,
    reviews: [exactReview(), exactReview({
      id: 73,
      submittedAt: "2026-08-08T04:05:00.000Z",
    })],
    now: new Date("2026-08-08T04:08:01.000Z"),
  }).reason, "draft_review_not_completed_before_promotion");
  assert.equal(evaluate({
    issueComments: [request({
      createdAt: requestAt,
      updatedAt: "2026-08-08T04:03:10.000Z",
    })],
    timelineEvents: repeatedTimeline,
  }).reason, "exact_sha_review_not_requested");

  const secondDraftRequest = request({
    id: 74,
    createdAt: "2026-08-08T04:03:10.000Z",
  });
  const secondDraftCompletion = exactReview({
    id: 75,
    submittedAt: "2026-08-08T04:03:30.000Z",
  });
  assert.equal(evaluate({
    issueComments: [secondDraftRequest, finalRequest()],
    timelineEvents: repeatedTimeline,
    reviews: [secondDraftCompletion, exactReview({
      id: 76,
      submittedAt: "2026-08-08T04:05:00.000Z",
    })],
  }).reason, "final_exact_sha_request_not_after_ready");

  const secondFinalRequest = finalRequest({
    id: 77,
    createdAt: "2026-08-08T04:04:10.000Z",
  });
  assert.equal(evaluate({
    issueComments: [secondDraftRequest, secondFinalRequest],
    timelineEvents: repeatedTimeline,
    reviews: [secondDraftCompletion, exactReview({
      id: 78,
      submittedAt: "2026-08-08T04:04:05.000Z",
    })],
  }).reason, "codex_final_review_in_progress");
  assert.equal(evaluate({
    issueComments: [secondDraftRequest, secondFinalRequest],
    timelineEvents: repeatedTimeline,
    reviews: [secondDraftCompletion, exactReview({
      id: 79,
      submittedAt: "2026-08-08T04:05:00.000Z",
    })],
    now: new Date("2026-08-08T04:08:01.000Z"),
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
  }).reason, "exact_sha_request_not_in_latest_draft");
  assert.equal(evaluate({ issueComments: [request()] }).reason, "final_exact_sha_review_not_requested");
  assert.equal(evaluate({
    pullRequest: {
      head: { sha: headSha },
      base: { sha: baseSha },
      draft: false,
      state: "open",
    },
  }).reason, "draft_interval_unavailable");
  assert.equal(evaluate({ pullRequest: pullRequest({ draft: true }) }).reason, "pull_request_is_draft");
  assert.equal(evaluate({ pullRequest: pullRequest({ state: "closed" }) }).reason, "pull_request_not_open");
});
