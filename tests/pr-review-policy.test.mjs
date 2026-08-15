import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import test from "node:test";

import {
  classifyReviewPriority,
  classifyReviewThread,
  evaluateReviewSnapshot,
  summarizeReviewSnapshot,
  writeReviewPolicyArtifact,
} from "../scripts/check-pr-review-policy.mjs";
import {
  alreadyRequestedForHead,
  reviewCommentBody,
} from "../scripts/request-codex-review.mjs";

const headSha = "a".repeat(40);
const baseSha = "c".repeat(40);

function pullRequest({ sha = headSha, base = baseSha } = {}) {
  return { head: { sha }, base: { sha: base } };
}

function thread({
  body = "**P1 Badge** layout drift",
  resolved = false,
  outdated = false,
} = {}) {
  return {
    isResolved: resolved,
    isOutdated: outdated,
    comments: [{
      body,
      user: { login: "chatgpt-codex-connector[bot]" },
      path: "app/workbench.tsx",
      id: 11,
    }],
  };
}

test("priority classification reads badge and list forms", () => {
  assert.equal(classifyReviewPriority("**P0 Badge** crash"), "P0");
  assert.equal(classifyReviewPriority("- P2: leftover copy"), "P2");
  assert.equal(classifyReviewPriority("no priority here"), "unclassified");
});

test("active P0/P1 threads stay visible in the snapshot and never block", () => {
  const result = evaluateReviewSnapshot({
    expectedHeadSha: headSha,
    expectedBaseSha: baseSha,
    pullRequest: pullRequest(),
    reviewThreads: [thread()],
  });
  assert.equal(result.status, "reported");
  assert.equal(result.blocking, false);
  assert.equal(result.p0p1Findings[0].priority, "P1");
  assert.equal(result.p0p1Findings[0].state, "informational");
  assert.equal(summarizeReviewSnapshot(result).p0p1Count, 1);
});

test("resolved or outdated threads are ignored", () => {
  const finding = classifyReviewThread(thread({ resolved: true }));
  assert.equal(finding.state, "ignored");
});

test("Codex review requests stay informational and idempotent per head", () => {
  const head = "b".repeat(40);
  const body = reviewCommentBody(head);
  assert.match(body, /@codex review/u);
  assert.match(body, /does not block merge/u);
  assert.match(body, /release-gate/u);
  assert.equal(
    alreadyRequestedForHead([{
      user: { login: "github-actions[bot]" },
      body,
    }], head),
    true,
  );
  assert.equal(
    alreadyRequestedForHead([{
      user: { login: "github-actions[bot]" },
      body,
    }], "c".repeat(40)),
    false,
  );
});

test("the snapshot writer stays inside the repository", async () => {
  const result = evaluateReviewSnapshot({
    expectedHeadSha: headSha,
    expectedBaseSha: baseSha,
    pullRequest: pullRequest(),
  });
  const destination = await writeReviewPolicyArtifact(result);
  try {
    const written = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(written.status, "reported");
    assert.equal(written.blocking, false);
  } finally {
    await rm("output/review-policy", { recursive: true, force: true }).catch(() => {});
  }
});
