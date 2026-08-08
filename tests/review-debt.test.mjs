import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  renderReviewDebtMarkdown,
  summarizeReviewDebt,
  writeReviewDebtArtifact,
} from "../scripts/review-debt.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function thread(priority, { resolved = false, outdated = false } = {}) {
  return {
    isResolved: resolved,
    isOutdated: outdated,
    comments: { nodes: [{ databaseId: 1, path: "app/example.ts", author: { login: "chatgpt-codex-connector" }, body: `![${priority} Badge](x)` }] },
  };
}

function review(priority, { id = 20, state = "CHANGES_REQUESTED", actor = "reviewer" } = {}) {
  return {
    id,
    state,
    user: { login: actor },
    body: priority ? `![${priority} Badge](x)` : "No priority",
  };
}

test("review debt preserves P2/P3/unclassified findings and excludes P0/P1 or resolved findings", () => {
  const report = summarizeReviewDebt({
    generatedAt: "2026-08-09T00:00:00.000Z",
    pullRequests: [{
      number: 12,
      html_url: "https://example.test/pr/12",
      title: "Deferred findings",
      reviewThreads: [thread("P0"), thread("P1"), thread("P2"), thread("P3"), thread("P2", { resolved: true }), {
        isResolved: false,
        isOutdated: false,
        comments: { nodes: [{ databaseId: 3, author: { login: "reviewer" }, body: "No priority" }] },
      }],
    }],
  });
  assert.equal(report.totalDeferredFindings, 3);
  assert.deepEqual(report.priorityCounts, { P2: 1, P3: 1, unclassified: 1 });
  assert.match(renderReviewDebtMarkdown(report), /operational backlog, not a merge blocker/u);
  assert.match(renderReviewDebtMarkdown(report), /#12/u);
});

test("review debt preserves non-blocking review-level changes requests without recording ordinary reviews", () => {
  const report = summarizeReviewDebt({
    generatedAt: "2026-08-09T00:00:00.000Z",
    pullRequests: [{
      number: 13,
      html_url: "https://example.test/pr/13",
      title: "Review-level deferred findings",
      reviews: [
        review("P2", { id: 21 }),
        review("P3", { id: 22 }),
        review(null, { id: 23 }),
        review("P1", { id: 24 }),
        review("P2", { id: 25, state: "COMMENTED" }),
      ],
    }],
  });
  assert.equal(report.totalDeferredFindings, 3);
  assert.deepEqual(report.priorityCounts, { P2: 1, P3: 1, unclassified: 1 });
  assert.deepEqual(report.findings.map((finding) => finding.reviewId), [21, 22, 23]);
  assert.deepEqual(report.findings.map((finding) => finding.findingKind), [
    "pull_request_review",
    "pull_request_review",
    "pull_request_review",
  ]);
});

test("a weekly rolling artifact is machine-readable and repository-scoped", async () => {
  const output = "output/review-debt/test-review-debt.json";
  try {
    const report = summarizeReviewDebt({ pullRequests: [] });
    const destination = await writeReviewDebtArtifact(report, output);
    const artifact = JSON.parse(await readFile(destination, "utf8"));
    assert.equal(artifact.schemaVersion, 1);
    assert.equal(artifact.totalDeferredFindings, 0);
    await assert.rejects(() => writeReviewDebtArtifact(report, "../../outside.json"), /inside the repository/u);
  } finally {
    await rm(output, { force: true }).catch(() => {});
    await rm("output/review-debt", { recursive: true, force: true }).catch(() => {});
  }
});

test("the weekly workflow can update only review debt from trusted default-branch code", async () => {
  const [workflow, debtScript] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/review-debt.yml"), "utf8"),
    readFile(path.join(productRoot, "scripts/review-debt.mjs"), "utf8"),
  ]);
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /pull-requests: read/u);
  assert.match(workflow, /issues: write/u);
  assert.match(workflow, /review-debt\.mjs sync/u);
  assert.match(workflow, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/u);
  assert.doesNotMatch(workflow, /pull_request:|pull_request_target|gh pr merge|mergePullRequest/u);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request/u);
  assert.match(debtScript, /classifyReviewState/u);
  assert.match(debtScript, /pulls\/\$\{pullRequest\.number\}\/reviews/u);
});
