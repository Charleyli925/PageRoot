import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDraftReviewCommand,
  buildDraftReviewCommandMarker,
  buildDraftReviewRequestMarker,
  classifyFreshSettlement,
  evaluateDraftReviewEligibility,
  findExistingDraftRequest,
  parseDraftReviewArguments,
  parseDraftReviewCommandMarker,
  parseDraftReviewRequestMarker,
  probeCompletion,
} from "../scripts/draft-review-request.mjs";

const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const secondSha = "c".repeat(40);
const trustedActor = "github-actions[bot]";

function pullRequest(overrides = {}) {
  return {
    number: 12,
    state: "open",
    draft: true,
    merged: false,
    head: { sha: headSha, repo: { full_name: "Charleyli925/PageRoot" } },
    base: { sha: baseSha },
    ...overrides,
  };
}

function comment({ body = "", author = trustedActor, id = 100 } = {}) {
  return { id, user: { login: author }, body };
}

function markerComment({
  head = headSha,
  base = baseSha,
  author = trustedActor,
  id = 100,
} = {}) {
  return comment({
    id,
    author,
    body: buildDraftReviewRequestMarker({ headSha: head, baseSha: base, sourceRunId: "31780925844" }),
  });
}

function evaluate(overrides = {}) {
  return evaluateDraftReviewEligibility({
    repository: "Charleyli925/PageRoot",
    pullRequest: pullRequest(),
    comments: [],
    expectedHeadSha: headSha,
    expectedBaseSha: baseSha,
    sourceRunId: "31780925844",
    ...overrides,
  });
}

function feedbackRun(overrides = {}) {
  return {
    path: ".github/workflows/pr-feedback.yml",
    event: "pull_request",
    conclusion: "success",
    head_sha: headSha,
    pull_requests: [{ number: 12 }],
    ...overrides,
  };
}

test("draft review markers bind full head and base SHAs and reject malformed bodies", () => {
  const marker = buildDraftReviewRequestMarker({
    headSha,
    baseSha,
    sourceRunId: "31780925844",
  });
  assert.match(marker, /pageroot-draft-review-request:v1/u);
  assert.match(marker, new RegExp("head=" + headSha, "u"));
  assert.match(marker, new RegExp("base=" + baseSha, "u"));
  assert.match(marker, /source_run=31780925844/u);
  assert.deepEqual(parseDraftReviewRequestMarker(marker), {
    headSha,
    baseSha,
    sourceRunId: "31780925844",
  });
  assert.equal(parseDraftReviewRequestMarker("no marker here"), null);
  assert.equal(
    parseDraftReviewRequestMarker(
      "<!-- pageroot-draft-review-request:v1\nhead=" + "d".repeat(39) + "\nbase=" + baseSha + "\n-->",
    ),
    null,
  );
  assert.equal(
    parseDraftReviewRequestMarker("<!-- pageroot-draft-review-request:v1\nhead=" + headSha + "\n-->"),
    null,
  );
  assert.equal(
    parseDraftReviewRequestMarker(
      "<!-- pageroot-draft-review-request:v1\nhead=" + headSha + "\nbase=" + baseSha + "\nhead=" + headSha + "\n-->",
    ),
    null,
  );
  assert.throws(
    () => buildDraftReviewRequestMarker({ headSha: "short", baseSha }),
    /40-character/u,
  );
});

test("maintainer command markers bind mode, head and base and reject malformed bodies", () => {
  const marker = buildDraftReviewCommandMarker({ mode: "request", headSha, baseSha });
  assert.deepEqual(parseDraftReviewCommandMarker(marker), { mode: "request", headSha, baseSha });
  assert.deepEqual(
    parseDraftReviewCommandMarker(buildDraftReviewCommandMarker({ mode: "close", headSha, baseSha })),
    { mode: "close", headSha, baseSha },
  );
  assert.equal(parseDraftReviewCommandMarker("ordinary text"), null);
  assert.equal(
    parseDraftReviewCommandMarker(
      "<!-- pageroot-draft-review-command:v1\nmode=merge\nhead=" + headSha + "\nbase=" + baseSha + "\n-->",
    ),
    null,
  );
  assert.throws(
    () => buildDraftReviewCommandMarker({ mode: "merge", headSha, baseSha }),
    /mode must be request or close/u,
  );
});

test("the request comment asks Codex once and cannot be mistaken for final review evidence", () => {
  const body = buildDraftReviewCommand({ headSha, baseSha, sourceRunId: "31780925844" });
  assert.match(body, /^@codex review$/mu);
  assert.match(body, new RegExp(headSha, "u"));
  assert.match(body, new RegExp(baseSha, "u"));
  assert.match(body, /cannot satisfy the final Ready merge gate/u);
  assert.equal((body.match(/@codex review/gu) || []).length, 1);
  assert.deepEqual(parseDraftReviewRequestMarker(body), {
    headSha,
    baseSha,
    sourceRunId: "31780925844",
  });
});

test("only the trusted actor's exact-pair marker makes a request idempotent", () => {
  const comments = [
    comment({ id: 1, body: "ordinary discussion" }),
    markerComment({ id: 2, author: "Charleyli925" }),
    markerComment({ id: 3 }),
  ];
  assert.equal(findExistingDraftRequest(comments, { headSha, baseSha })?.id, 3);
  assert.equal(findExistingDraftRequest(comments, { headSha: secondSha, baseSha }), null);
  assert.equal(findExistingDraftRequest(comments, { headSha, baseSha: secondSha }), null);
  assert.equal(
    findExistingDraftRequest([markerComment({ id: 4 })], {
      headSha,
      baseSha,
      trustedActor: "Charleyli925",
    }),
    null,
  );
});

test("a same-repo open Draft on the exact pair is eligible", () => {
  const result = evaluate();
  assert.equal(result.status, "eligible");
  assert.equal(result.reason, "eligible");
  assert.equal(result.isDraft, true);
  assert.equal(result.isFork, false);
});

test("Ready, closed, merged, fork and ambiguous Pull Requests never auto-request", () => {
  assert.equal(
    evaluate({ pullRequest: pullRequest({ draft: false }) }).reason,
    "pull_request_is_not_draft",
  );
  assert.equal(
    evaluate({ pullRequest: pullRequest({ state: "closed" }) }).reason,
    "pull_request_is_closed",
  );
  assert.equal(
    evaluate({ pullRequest: pullRequest({ merged: true }) }).reason,
    "pull_request_is_closed",
  );
  assert.equal(
    evaluate({
      pullRequest: pullRequest({
        head: { sha: headSha, repo: { full_name: "someone-else/PageRoot" } },
      }),
    }).reason,
    "fork_pull_request",
  );
  assert.equal(
    evaluate({
      pullRequest: { number: 12, state: "open", draft: true, head: {}, base: { sha: baseSha } },
    }).reason,
    "pull_request_state_ambiguous",
  );
  assert.equal(evaluate({ pullRequest: null }).reason, "pull_request_missing");
});

test("a changed head or base fails closed and never accepts the stale pair", () => {
  assert.equal(
    evaluate({
      pullRequest: pullRequest({
        head: { sha: secondSha, repo: { full_name: "Charleyli925/PageRoot" } },
      }),
    }).reason,
    "head_sha_changed",
  );
  assert.equal(
    evaluate({ pullRequest: pullRequest({ base: { sha: secondSha } }) }).reason,
    "base_sha_changed",
  );
});

test("an existing trusted exact-pair request is recognized instead of duplicated", () => {
  const result = evaluate({ comments: [markerComment()] });
  assert.equal(result.status, "already_requested");
  assert.equal(result.reason, "already_requested");
  assert.equal(result.existingCommentId, 100);
  assert.equal(evaluate({ comments: [markerComment({ author: "Charleyli925" })] }).status, "eligible");
  assert.equal(evaluate({ comments: [markerComment({ head: secondSha })] }).status, "eligible");
});

test("automatic requests only follow a successful PR Feedback run on the same PR and head", () => {
  assert.equal(evaluate({ workflowRun: feedbackRun() }).status, "eligible");
  assert.equal(
    evaluate({ workflowRun: feedbackRun({ path: ".github/workflows/ci.yml" }) }).reason,
    "untrusted_source_workflow",
  );
  assert.equal(
    evaluate({ workflowRun: feedbackRun({ event: "workflow_dispatch" }) }).reason,
    "source_event_not_pull_request",
  );
  assert.equal(
    evaluate({ workflowRun: feedbackRun({ conclusion: "failure" }) }).reason,
    "source_workflow_not_successful",
  );
  assert.equal(
    evaluate({ workflowRun: feedbackRun({ pull_requests: [] }) }).reason,
    "workflow_run_missing_pr",
  );
  assert.equal(
    evaluate({ workflowRun: feedbackRun({ pull_requests: [{ number: 1 }, { number: 2 }] }) }).reason,
    "workflow_run_multiple_prs",
  );
  assert.equal(
    evaluate({ workflowRun: feedbackRun({ pull_requests: [{ number: 7 }] }) }).reason,
    "workflow_run_pr_mismatch",
  );
  assert.equal(
    evaluate({ workflowRun: feedbackRun({ head_sha: secondSha }) }).reason,
    "workflow_run_stale",
  );
});

test("probe completion only accepts post-request Codex evidence bound to the exact head", () => {
  const after = Date.parse("2026-08-09T04:00:00.000Z");
  const review = {
    id: 1,
    user: { login: "chatgpt-codex-connector[bot]" },
    commit_id: headSha,
    submitted_at: "2026-08-09T04:01:00.000Z",
    body: "### Codex Review\n\n**Reviewed commit:** `" + headSha.slice(0, 10) + "`",
  };
  const result = probeCompletion({ reviews: [review], expectedHeadSha: headSha, afterMs: after });
  assert.equal(result.kind, "codex_review");
  assert.equal(result.priority, "unclassified");

  assert.equal(
    probeCompletion({
      reviews: [{ ...review, commit_id: secondSha }],
      expectedHeadSha: headSha,
      afterMs: after,
    }),
    null,
  );
  assert.equal(
    probeCompletion({
      reviews: [{ ...review, submitted_at: "2026-08-09T03:59:00.000Z" }],
      expectedHeadSha: headSha,
      afterMs: after,
    }),
    null,
  );
  assert.equal(
    probeCompletion({
      reviews: [{ ...review, user: { login: "maintainer" } }],
      expectedHeadSha: headSha,
      afterMs: after,
    }),
    null,
  );
});

test("fresh settlement revalidation refuses to close the marker after promotion", () => {
  const command = { mode: "request", headSha, baseSha };
  assert.equal(classifyFreshSettlement(pullRequest(), command).status, "draft");
  assert.equal(
    classifyFreshSettlement(pullRequest({ draft: false }), command).status,
    "promotion_overlap",
  );
  assert.equal(
    classifyFreshSettlement(pullRequest({ state: "closed" }), command).reason,
    "pull_request_closed_before_settlement",
  );
  assert.equal(
    classifyFreshSettlement(
      pullRequest({ head: { sha: secondSha, repo: { full_name: "Charleyli925/PageRoot" } } }),
      command,
    ).reason,
    "pair_changed_before_settlement",
  );
  assert.equal(
    classifyFreshSettlement(pullRequest({ base: { sha: secondSha } }), command).reason,
    "pair_changed_before_settlement",
  );
});

test("CLI argument parsing validates repository, PR, comment and polling bounds", () => {
  const options = parseDraftReviewArguments([
    "--repository", "Charleyli925/PageRoot",
    "--pull-request", "12",
    "--comment-id", "31",
  ]);
  assert.equal(options.repository, "Charleyli925/PageRoot");
  assert.equal(options.pullRequest, 12);
  assert.equal(options.commentId, 31);
  assert.throws(
    () => parseDraftReviewArguments([
      "--repository", "Charleyli925/PageRoot",
      "--pull-request", "12",
      "--comment-id", "31",
      "--poll-seconds", "0",
    ]),
    /--poll-seconds/u,
  );
  assert.throws(
    () => parseDraftReviewArguments([
      "--repository", "Charleyli925/PageRoot",
      "--pull-request", "12",
    ]),
    /--comment-id/u,
  );
});
