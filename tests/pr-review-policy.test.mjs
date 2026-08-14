import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyReviewPriority,
  classifyReviewState,
  classifyReviewThread,
  collectReviewPolicySnapshot,
  evaluateReviewPolicy,
  reviewedCommitPrefix,
  summarizeReviewPolicy,
  writeReviewPolicyArtifact,
} from "../scripts/check-pr-review-policy.mjs";

const headSha = "a".repeat(40);
const oldSha = "b".repeat(40);
const baseSha = "c".repeat(40);
const readyAt = "2026-08-09T04:00:00.000Z";
const completedAt = "2026-08-09T04:01:00.000Z";

function pullRequest({ sha = headSha, base = baseSha, draft = false, state = "open" } = {}) {
  return { head: { sha }, base: { sha: base }, draft, state };
}

function codexReview({
  sha = headSha,
  submittedAt = completedAt,
  state = "COMMENTED",
  body = null,
  actor = "chatgpt-codex-connector[bot]",
  id = 10,
} = {}) {
  return {
    id,
    user: { login: actor },
    commit_id: sha,
    submitted_at: submittedAt,
    state,
    body: body ?? `### Codex Review\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\``,
  };
}

function codexReaction({
  createdAt = completedAt,
  content = "+1",
  actor = "chatgpt-codex-connector[bot]",
  id = 30,
} = {}) {
  return {
    id,
    user: { login: actor },
    content,
    created_at: createdAt,
  };
}

function thread({ priority = "P2", resolved = false, outdated = false, actor = "chatgpt-codex-connector", id = 20 } = {}) {
  return {
    isResolved: resolved,
    isOutdated: outdated,
    comments: { nodes: [{ databaseId: id, author: { login: actor }, path: "app/example.ts", body: `**![${priority} Badge](https://example.test/${priority}) Finding**` }] },
  };
}

function evaluate(overrides = {}) {
  return evaluateReviewPolicy({
    expectedHeadSha: headSha,
    expectedBaseSha: baseSha,
    pullRequest: pullRequest(),
    timelineEvents: [{ id: 1, event: "ready_for_review", created_at: readyAt }],
    reviews: [codexReview()],
    issueComments: [],
    issueReactions: [],
    reviewThreads: [],
    now: new Date("2026-08-09T04:01:31.000Z"),
    settleSeconds: 30,
    ...overrides,
  });
}

test("priority parsing defaults safely to deferred unclassified debt", () => {
  assert.equal(classifyReviewPriority("![P0 Badge](badge)"), "P0");
  assert.equal(classifyReviewPriority("![P3 Badge](x) then ![P1 Badge](x)"), "P1");
  assert.equal(
    classifyReviewPriority("![P2 Badge](x) This finding discusses P0/P1 behavior but remains P2."),
    "P2",
  );
  assert.equal(classifyReviewPriority("P1: a structured blocking finding"), "P1");
  assert.equal(classifyReviewPriority("ordinary comment"), "unclassified");
  assert.equal(reviewedCommitPrefix("**Reviewed commit:** `aaaaaaaaaa`"), "aaaaaaaaaa");
});

test("only active P0 and P1 threads block; P2/P3 and unclassified threads become debt", () => {
  assert.equal(classifyReviewThread(thread({ priority: "P0" })).state, "blocking");
  assert.equal(classifyReviewThread(thread({ priority: "P1" })).state, "blocking");
  assert.equal(classifyReviewThread(thread({ priority: "P2" })).state, "non_blocking");
  assert.equal(classifyReviewThread(thread({ priority: "P3" })).state, "non_blocking");
  assert.equal(classifyReviewThread(thread({ priority: "P1", resolved: true })).state, "ignored");
  assert.equal(classifyReviewThread(thread({ priority: "P1", outdated: true })).state, "ignored");
  assert.equal(classifyReviewThread({ comments: { nodes: [{ author: { login: "reviewer" }, body: "No badge" }] } }).priority, "unclassified");
});

test("only P0/P1 changes-requested reviews block regardless of reviewer", () => {
  assert.equal(classifyReviewState(codexReview({ state: "CHANGES_REQUESTED", body: "![P0 Badge](x)" })).state, "blocking");
  assert.equal(classifyReviewState(codexReview({ state: "CHANGES_REQUESTED", body: "![P1 Badge](x)" })).state, "blocking");
  assert.equal(classifyReviewState(codexReview({ state: "CHANGES_REQUESTED", body: "![P2 Badge](x)" })).state, "non_blocking");
  assert.equal(classifyReviewState(codexReview({ state: "CHANGES_REQUESTED", body: "![P3 Badge](x)" })).state, "non_blocking");
  assert.equal(classifyReviewState(codexReview({
    state: "CHANGES_REQUESTED",
    body: "![P3 Badge](x) followed by ![P1 Badge](x)",
  })).state, "blocking");
  assert.equal(classifyReviewState(codexReview({ state: "CHANGES_REQUESTED", actor: "maintainer" })).state, "non_blocking");
  assert.equal(classifyReviewState(codexReview({ state: "CHANGES_REQUESTED", actor: "maintainer", body: "![P1 Badge](x)" })).state, "blocking");
});

test("the final Ready review on the exact head passes after a 30-second settle window", () => {
  const result = evaluate();
  assert.equal(result.status, "passed");
  assert.equal(result.reason, "final_review_policy_passed");
  assert.equal(result.reviewLatencySeconds, 60);
  assert.deepEqual(result.blockingFindings, []);
});

test("pre-Ready Codex evidence never completes the policy because it cannot bind the frozen base", () => {
  const result = evaluate({
    reviews: [codexReview({ submittedAt: "2026-08-09T03:30:00.000Z" })],
  });
  assert.equal(result.status, "waiting");
  assert.equal(result.reason, "final_review_in_progress");
});

test("root +1 reactions still require the latest Ready transition because they carry no commit identity", () => {
  const result = evaluate({
    reviews: [],
    issueReactions: [codexReaction({ createdAt: "2026-08-09T03:59:59.000Z" })],
  });
  assert.equal(result.status, "waiting");
  assert.equal(result.reason, "final_review_in_progress");
});

test("advisory evaluation reports a Draft Pull Request without blocking and without inventing completion", () => {
  const result = evaluate({
    advisory: true,
    pullRequest: pullRequest({ draft: true }),
    timelineEvents: [],
    reviews: [codexReview({ submittedAt: "2026-08-09T03:30:00.000Z" })],
    now: new Date("2026-08-09T04:00:31.000Z"),
  });
  assert.equal(result.status, "waiting");
  assert.equal(result.reason, "final_review_in_progress");
  assert.equal(result.readyAt, null);
});

test("advisory evaluation surfaces active P0/P1 findings on a Draft Pull Request", () => {
  const result = evaluate({
    advisory: true,
    pullRequest: pullRequest({ draft: true }),
    timelineEvents: [],
    reviews: [],
    reviewThreads: [thread({ priority: "P1" })],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "blocking_review_finding");
  assert.equal(result.blockingFindings[0].priority, "P1");
});

test("advisory evaluation uses the same post-Ready completion contract after promotion", () => {
  const result = evaluate({
    advisory: true,
    reviews: [codexReview()],
  });
  assert.equal(result.status, "passed");
  assert.equal(result.reason, "final_review_policy_passed");
});

test("a post-Ready Codex thumbs-up reaction is an accepted clean completion", () => {
  const result = evaluate({
    reviews: [],
    issueReactions: [codexReaction()],
  });
  assert.equal(result.status, "passed");
  assert.equal(result.reviewCompletionKind, "codex_clean_reaction");
  assert.equal(result.reviewLatencySeconds, 60);
});

test("only the Codex +1 created after the latest Ready transition can complete review", () => {
  for (const reaction of [
    codexReaction({ createdAt: "2026-08-09T03:59:59.000Z" }),
    codexReaction({ actor: "maintainer" }),
    codexReaction({ content: "heart" }),
  ]) {
    const result = evaluate({ reviews: [], issueReactions: [reaction] });
    assert.equal(result.status, "waiting");
    assert.equal(result.reason, "final_review_in_progress");
  }

  const result = evaluate({
    reviews: [],
    issueReactions: [codexReaction()],
    timelineEvents: [
      { id: 1, event: "ready_for_review", created_at: readyAt },
      { id: 2, event: "ready_for_review", created_at: "2026-08-09T04:02:00.000Z" },
    ],
    now: new Date("2026-08-09T04:03:00.000Z"),
  });
  assert.equal(result.status, "waiting");
  assert.equal(result.reason, "final_review_in_progress");
});

test("no Draft marker or Draft review is required", () => {
  const result = evaluate({ issueComments: [] });
  assert.equal(result.status, "passed");
});

test("policy rejects stale heads, missing Ready evidence, unfinished final review, and active P0/P1", () => {
  assert.equal(evaluate({ pullRequest: pullRequest({ sha: oldSha }) }).reason, "head_sha_changed");
  assert.equal(evaluate({ timelineEvents: [] }).reason, "ready_transition_missing");
  assert.equal(evaluate({ pullRequest: pullRequest({ draft: true }) }).reason, "pull_request_is_draft");
  assert.equal(evaluate({ reviews: [] }).reason, "final_review_in_progress");
  const p0 = evaluate({ reviewThreads: [thread({ priority: "P0" })] });
  assert.equal(p0.status, "blocked");
  assert.equal(p0.reason, "blocking_review_finding");
  assert.equal(p0.blockingFindings[0].priority, "P0");
});

test("an active same-head P0/P1 changes request from Draft still blocks after Ready", () => {
  const result = evaluate({
    reviews: [
      codexReview(),
      codexReview({
        id: 11,
        actor: "maintainer",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-08-09T03:59:00.000Z",
        body: "![P1 Badge](x) This is still unresolved.",
      }),
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.reason, "blocking_review_finding");
  assert.equal(result.blockingFindings[0].priority, "P1");
});

test("a reviewer’s later same-head decision supersedes their earlier changes request", () => {
  const result = evaluate({
    now: new Date("2026-08-09T04:02:31.000Z"),
    reviews: [
      codexReview(),
      codexReview({
        id: 11,
        actor: "maintainer",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-08-09T03:59:00.000Z",
        body: "![P1 Badge](x) This concern needs a decision.",
      }),
      codexReview({
        id: 12,
        actor: "maintainer",
        state: "APPROVED",
        submittedAt: "2026-08-09T04:02:00.000Z",
        body: "The earlier P1 concern is withdrawn.",
      }),
    ],
  });
  assert.equal(result.status, "passed");
  assert.deepEqual(result.blockingFindings, []);
});

test("a plain follow-up comment cannot supersede a same-head P0/P1 changes request", () => {
  const result = evaluate({
    reviews: [
      codexReview(),
      codexReview({
        id: 13,
        actor: "maintainer",
        state: "CHANGES_REQUESTED",
        submittedAt: "2026-08-09T03:59:00.000Z",
        body: "![P1 Badge](x) This concern remains active.",
      }),
      codexReview({
        id: 14,
        actor: "maintainer",
        state: "COMMENTED",
        submittedAt: "2026-08-09T04:02:00.000Z",
        body: "A follow-up note without an explicit approval.",
      }),
    ],
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.blockingFindings[0].priority, "P1");
});

test("P2/P3/unclassified findings are recorded without blocking a final candidate", () => {
  const result = evaluate({
    reviewThreads: [thread({ priority: "P2" }), thread({ priority: "P3", id: 21 }), {
      isResolved: false,
      isOutdated: false,
      comments: { nodes: [{ databaseId: 22, author: { login: "maintainer" }, path: "a", body: "No priority" }] },
    }],
    reviews: [codexReview({ state: "CHANGES_REQUESTED", body: "![P2 Badge](x)\n\n**Reviewed commit:** `aaaaaaaaaa`" })],
  });
  assert.equal(result.status, "passed");
  assert.equal(result.nonBlockingFindings.length, 4);
  assert.equal(summarizeReviewPolicy(result).status, "passed");
});

test("an immediate revalidation can use zero settle seconds", () => {
  const result = evaluate({
    now: new Date(completedAt),
    settleSeconds: 0,
  });
  assert.equal(result.status, "passed");
});

test("review-policy snapshot reads root Pull Request reactions from GitHub", async () => {
  const originalFetch = globalThis.fetch;
  const requestedUrls = [];
  globalThis.fetch = async (url, init = {}) => {
    const requestUrl = String(url);
    requestedUrls.push(requestUrl);
    if (requestUrl.endsWith("/graphql")) {
      const query = JSON.parse(String(init.body || "{}")).query || "";
      const connectionName = query.includes("reviewThreads") ? "reviewThreads" : "comments";
      return new Response(JSON.stringify({
        data: {
          repository: {
            pullRequest: {
              [connectionName]: {
                nodes: [],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          },
        },
      }), { status: 200 });
    }
    if (new URL(requestUrl).pathname.endsWith("/pulls/158")) {
      return new Response(JSON.stringify(pullRequest()), { status: 200 });
    }
    const entries = requestUrl.includes("/issues/158/reactions?")
      ? [codexReaction()]
      : [];
    return new Response(JSON.stringify(entries), { status: 200 });
  };
  try {
    const snapshot = await collectReviewPolicySnapshot({
      repository: "Charleyli925/PageRoot",
      pullRequest: 158,
      expectedHeadSha: headSha,
      expectedBaseSha: baseSha,
    }, "test-token");
    assert.equal(snapshot.issueReactions.length, 1);
    assert.equal(snapshot.issueReactions[0].content, "+1");
    assert.ok(requestedUrls.some((url) => url.includes("/issues/158/reactions?per_page=100&page=1")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("review-policy artifact carries machine-readable completion and findings", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-review-policy-"));
  let destination = null;
  try {
    const result = evaluate({
      reviews: [],
      issueReactions: [codexReaction()],
      reviewThreads: [thread({ priority: "P2" })],
    });
    const relative = path.relative(
      path.resolve(path.dirname(new URL("../scripts/check-pr-review-policy.mjs", import.meta.url).pathname), ".."),
      path.join(tempRoot, "review-policy.json"),
    );
    await assert.rejects(() => writeReviewPolicyArtifact(result, relative), /inside the repository/u);
    destination = await writeReviewPolicyArtifact(result, "output/review-policy/test-policy.json");
    const artifact = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(artifact.policyVersion, "2026-08-14.2");
    assert.equal(artifact.status, "passed");
    assert.equal(artifact.reviewCompletionKind, "codex_clean_reaction");
    assert.equal(artifact.nonBlockingFindings[0].priority, "P2");
  } finally {
    if (destination) await rm(destination, { force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});
