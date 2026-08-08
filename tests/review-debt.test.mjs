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
  const workflow = await readFile(path.join(productRoot, ".github/workflows/review-debt.yml"), "utf8");
  assert.match(workflow, /schedule:/u);
  assert.match(workflow, /workflow_dispatch:/u);
  assert.match(workflow, /contents: read/u);
  assert.match(workflow, /pull-requests: read/u);
  assert.match(workflow, /issues: write/u);
  assert.match(workflow, /review-debt\.mjs sync/u);
  assert.match(workflow, /github\.ref == format\('refs\/heads\/\{0\}', github\.event\.repository\.default_branch\)/u);
  assert.doesNotMatch(workflow, /pull_request:|pull_request_target|gh pr merge|mergePullRequest/u);
  assert.doesNotMatch(workflow, /ref: \$\{\{ github\.event\.pull_request/u);
});
