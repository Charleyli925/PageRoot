import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  createPackageDeliverySnapshot,
  pullRequestStatusLabel,
  renderPackageDeliveryMarkdown,
  selectPackageBaseline,
  summarizeStatusChecks,
} from "../scripts/package-delivery-report.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headSha = "a".repeat(40);
const treeSha = "b".repeat(40);

test("formal reports use the prior stable tag when packaging an exact tagged commit", () => {
  assert.equal(
    selectPackageBaseline({
      tags: ["v0.9.5", "v0.9.4"],
      tagCommits: {
        "v0.9.5": headSha,
        "v0.9.4": "c".repeat(40),
      },
      headSha,
      kind: "formal",
    }),
    "v0.9.4",
  );
  assert.equal(
    selectPackageBaseline({
      tags: ["v0.9.5", "v0.9.4"],
      tagCommits: {
        "v0.9.5": "d".repeat(40),
        "v0.9.4": "c".repeat(40),
      },
      headSha,
      kind: "developer-preview",
    }),
    "v0.9.5",
  );
});

test("Pull Request status includes readiness, mergeability and live checks", () => {
  const checks = summarizeStatusChecks([
    {
      __typename: "CheckRun",
      status: "COMPLETED",
      conclusion: "SUCCESS",
    },
    {
      __typename: "CheckRun",
      status: "COMPLETED",
      conclusion: "FAILURE",
    },
    {
      __typename: "CheckRun",
      status: "COMPLETED",
      conclusion: "SKIPPED",
    },
  ]);
  assert.deepEqual(checks, {
    total: 3,
    passing: 1,
    failing: 1,
    pending: 0,
    skipped: 1,
    status: "FAILING",
  });
  assert.equal(
    pullRequestStatusLabel({
      state: "OPEN",
      isDraft: false,
      mergeStateStatus: "BLOCKED",
      reviewDecision: "REVIEW_REQUIRED",
      checks,
    }),
    "开放 · 可审查 · 合并受阻 · 待审查 · 检查失败",
  );
  assert.equal(pullRequestStatusLabel({ state: "MERGED" }), "已合并");
});

test("delivery Markdown reports exact package bytes, every PR and direct commits", () => {
  const pullRequests = [{
    number: 84,
    url: "https://github.com/Charleyli925/PageRoot/pull/84",
    title: "Distinguish developer preview packages and versions",
    summary: "Distinguish developer preview packages and versions",
    state: "OPEN",
    isDraft: false,
    mergeStateStatus: "BLOCKED",
    reviewDecision: null,
    checks: {
      total: 1,
      passing: 0,
      failing: 1,
      pending: 0,
      skipped: 0,
      status: "FAILING",
    },
    statusLabel: "开放 · 可审查 · 合并受阻 · 检查失败",
    commitShas: [headSha],
  }];
  const report = createPackageDeliverySnapshot({
    kind: "developer-preview",
    artifact: {
      file: "PageRoot-Developer-Preview-0.9.69993-arm64.dmg",
      path: "output/developer-preview/release/PageRoot-Developer-Preview-0.9.69993-arm64.dmg",
      version: "0.9.69993",
      architecture: "arm64",
      size: 123,
      sha256: "f".repeat(64),
    },
    repository: "Charleyli925/PageRoot",
    baseTag: "v0.9.5",
    headSha,
    treeSha,
    commits: [
      {
        sha: headSha,
        subject: "feat: package report",
        pullRequestNumbers: [84],
      },
      {
        sha: "c".repeat(40),
        subject: "chore: direct package adjustment",
        pullRequestNumbers: [],
      },
    ],
    changedFiles: ["AGENTS.md", "scripts/package-delivery-report.mjs"],
    additions: 120,
    deletions: 4,
    pullRequests,
    generatedAt: "2026-08-04T06:00:00.000Z",
  });
  const markdown = renderPackageDeliveryMarkdown(report);
  assert.match(markdown, /PageRoot-Developer-Preview-0\.9\.69993-arm64\.dmg/u);
  assert.match(markdown, /2 个提交、2 个文件（\+120 \/ -4）/u);
  assert.match(markdown, /\[#84\]\(https:\/\/github\.com\/Charleyli925\/PageRoot\/pull\/84\)/u);
  assert.match(markdown, /开放 · 可审查 · 合并受阻 · 检查失败/u);
  assert.match(markdown, /chore: direct package adjustment/u);
});

test("installer workflows generate a live delivery report after package verification", async () => {
  const [preview, candidate, release, agentGuide, releasing, playbook] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/developer-preview.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release-candidate.yml"), "utf8"),
    readFile(path.join(productRoot, ".github/workflows/release.yml"), "utf8"),
    readFile(path.join(productRoot, "AGENTS.md"), "utf8"),
    readFile(path.join(productRoot, "docs/RELEASING.md"), "utf8"),
    readFile(path.join(productRoot, "docs/DEVELOPER_PREVIEW_PLAYBOOK.md"), "utf8"),
  ]);
  assert.match(preview, /GH_TOKEN:\s*\$\{\{ github\.token \}\}/u);
  assert.match(preview, /package-delivery-report\.md/u);
  assert.match(candidate, /package-delivery-report\.mjs/u);
  assert.match(candidate, /output\/package-delivery/u);
  assert.match(release, /package-delivery-report\.mjs/u);
  assert.match(agentGuide, /every associated Pull Request/u);
  assert.match(releasing, /Mandatory installer delivery report/u);
  assert.match(playbook, /安装包内容报告/u);
});
