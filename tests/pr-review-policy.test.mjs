import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  classifyReviewPriority,
  classifyReviewState,
  classifyReviewThread,
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
    reviewThreads: [],
    now: new Date("2026-08-09T04:01:31.000Z"),
    settleSeconds: 30,
    ...overrides,
  });
}

test("priority parsing defaults safely to deferred unclassified debt", () => {
  assert.equal(classifyReviewPriority("![P0 Badge](badge)"), "P0");
  assert.equal(classifyReviewPriority("![P3 Badge](x) then ![P1 Badge](x)"), "P1");
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

test("no Draft marker or Draft review is required", () => {
  const result = evaluate({ issueComments: [] });
  assert.equal(result.status, "passed");
});

test("policy rejects stale heads, missing Ready evidence, unfinished final review, and active P0/P1", () => {
  assert.equal(evaluate({ pullRequest: pullRequest({ sha: oldSha }) }).reason, "head_sha_changed");
  assert.equal(evaluate({ timelineEvents: [] }).reason, "ready_transition_missing");
  assert.equal(evaluate({ reviews: [] }).reason, "final_review_in_progress");
  const p0 = evaluate({ reviewThreads: [thread({ priority: "P0" })] });
  assert.equal(p0.status, "blocked");
  assert.equal(p0.reason, "blocking_review_finding");
  assert.equal(p0.blockingFindings[0].priority, "P0");
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

test("review-policy artifact carries machine-readable blocking and deferred findings", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "pageroot-review-policy-"));
  let destination = null;
  try {
    const result = evaluate({ reviewThreads: [thread({ priority: "P2" })] });
    const relative = path.relative(
      path.resolve(path.dirname(new URL("../scripts/check-pr-review-policy.mjs", import.meta.url).pathname), ".."),
      path.join(tempRoot, "review-policy.json"),
    );
    await assert.rejects(() => writeReviewPolicyArtifact(result, relative), /inside the repository/u);
    destination = await writeReviewPolicyArtifact(result, "output/review-policy/test-policy.json");
    const artifact = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(artifact.policyVersion, "2026-08-09");
    assert.equal(artifact.status, "passed");
    assert.equal(artifact.nonBlockingFindings[0].priority, "P2");
  } finally {
    if (destination) await rm(destination, { force: true });
    await rm(tempRoot, { recursive: true, force: true });
  }
});
