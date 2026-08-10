import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

import {
  evaluateReviewGateRecovery,
  readZipJsonEntry,
  recoveryTriggerFromEvent,
  selectReviewGateRun,
} from "../scripts/recover-pr-review-gate.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const headSha = "a".repeat(40);
const baseSha = "b".repeat(40);
const readyAt = "2026-08-10T11:35:17.000Z";
const requiredGreenJobs = [
  "branch-policy",
  "candidate-context",
  "baseline-policy",
  "source-build",
  "source-node",
  "browser-shard-1-of-3",
  "browser-shard-2-of-3",
  "browser-shard-3-of-3",
  "browser-real-html",
  "electron-native",
  "electron-ai",
];

function acceptedTrigger() {
  return recoveryTriggerFromEvent("issue_comment", {
    action: "created",
    issue: { number: 133, pull_request: { url: "https://api.github.test/pulls/133" } },
    comment: { user: { login: "chatgpt-codex-connector[bot]" } },
  });
}

function pullRequest(overrides = {}) {
  return {
    number: 133,
    state: "open",
    draft: false,
    head: { sha: headSha, ref: "fix/review-timeout" },
    base: { sha: baseSha, ref: "main" },
    ...overrides,
  };
}

function policy(overrides = {}) {
  return {
    status: "passed",
    reason: "final_review_policy_passed",
    readyAt,
    expectedHeadSha: headSha,
    currentHeadSha: headSha,
    expectedBaseSha: baseSha,
    currentBaseSha: baseSha,
    blockingFindings: [],
    nonBlockingFindings: [],
    ...overrides,
  };
}

function workflowRun(overrides = {}) {
  return {
    id: 31384166697,
    run_attempt: 1,
    event: "pull_request",
    path: ".github/workflows/ci.yml@refs/pull/133/merge",
    head_sha: headSha,
    head_branch: "fix/review-timeout",
    created_at: "2026-08-10T11:35:21.000Z",
    status: "completed",
    conclusion: "failure",
    pull_requests: [{ number: 133 }],
    ...overrides,
  };
}

function jobs(overrides = {}) {
  const conclusions = new Map(Object.entries(overrides));
  return [
    ...requiredGreenJobs.map((name) => ({
      name,
      conclusion: conclusions.get(name) || "success",
    })),
    { name: "review-policy", conclusion: conclusions.get("review-policy") || "failure" },
    { name: "release-gate", conclusion: conclusions.get("release-gate") || "failure" },
    { name: "release-dry-run", conclusion: conclusions.get("release-dry-run") || "skipped" },
    { name: "main-integrity", conclusion: "skipped" },
  ];
}

function timeoutArtifact(overrides = {}) {
  return {
    status: "blocked",
    reason: "review_wait_timed_out",
    expectedHeadSha: headSha,
    currentHeadSha: headSha,
    expectedBaseSha: baseSha,
    currentBaseSha: baseSha,
    readyAt,
    blockingFindings: [],
    nonBlockingFindings: [],
    ...overrides,
  };
}

function recovery(overrides = {}) {
  return evaluateReviewGateRecovery({
    trigger: acceptedTrigger(),
    pullRequest: pullRequest(),
    policyResult: policy(),
    workflowRuns: [workflowRun()],
    jobs: jobs(),
    artifact: timeoutArtifact(),
    ...overrides,
  });
}

function zipWithEntry(entryName, content, compression = 0) {
  const name = Buffer.from(entryName, "utf8");
  const data = Buffer.from(content, "utf8");
  const compressed = compression === 8 ? deflateRawSync(data) : data;
  const local = Buffer.alloc(30 + name.length);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(compression, 8);
  local.writeUInt32LE(compressed.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  name.copy(local, 30);
  const central = Buffer.alloc(46 + name.length);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(compression, 10);
  central.writeUInt32LE(compressed.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(name.length, 28);
  name.copy(central, 46);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(local.length + compressed.length, 16);
  return Buffer.concat([local, compressed, central, end]);
}

test("recovery accepts only a new Codex comment or submitted review on a Pull Request", () => {
  assert.deepEqual(acceptedTrigger(), {
    status: "accepted",
    reason: "codex_review_event",
    kind: "issue_comment",
    actor: "chatgpt-codex-connector",
    pullRequest: 133,
  });
  assert.equal(recoveryTriggerFromEvent("pull_request_review", {
    action: "submitted",
    pull_request: { number: 133 },
    review: { user: { login: "chatgpt-codex-connector" } },
  }).status, "accepted");
  assert.equal(recoveryTriggerFromEvent("issue_comment", {
    action: "created",
    issue: { number: 133, pull_request: {} },
    comment: { user: { login: "someone-else" } },
  }).reason, "untrusted_actor");
  assert.equal(recoveryTriggerFromEvent("issue_comment", {
    action: "edited",
    issue: { number: 133, pull_request: {} },
    comment: { user: { login: "chatgpt-codex-connector" } },
  }).reason, "unsupported_event");
});

test("only the latest CI run after the exact Ready transition is selected", () => {
  const selected = selectReviewGateRun({
    workflowRuns: [
      workflowRun({ id: 1, created_at: "2026-08-10T11:30:00.000Z" }),
      workflowRun({ id: 2, head_branch: "other-branch" }),
      workflowRun({ id: 3 }),
    ],
    pullRequest: 133,
    headSha,
    headRef: "fix/review-timeout",
    readyAt,
  });
  assert.equal(selected.id, 3);
});

test("late exact-pair review recovers only a review timeout with every source job green", () => {
  const result = recovery();
  assert.equal(result.status, "eligible");
  assert.equal(result.reason, "late_review_can_rerun_failed_jobs");
  assert.equal(result.runId, 31384166697);
  assert.equal(result.headSha, headSha);
  assert.equal(result.baseSha, baseSha);
});

test("product failures, changed pairs, Draft state and blocking review artifacts never recover", () => {
  assert.equal(recovery({ jobs: jobs({ "electron-ai": "failure" }) }).reason,
    "required_source_job_not_green");
  assert.equal(recovery({ artifact: timeoutArtifact({ reason: "blocking_review_finding" }) }).reason,
    "review_timeout_artifact_missing");
  assert.equal(recovery({ artifact: timeoutArtifact({ currentBaseSha: "c".repeat(40) }) }).reason,
    "review_timeout_artifact_pair_changed");
  assert.equal(recovery({ policyResult: policy({ status: "blocked", reason: "pull_request_is_draft" }) }).reason,
    "live_review_policy_not_passed");
  assert.equal(recovery({ pullRequest: pullRequest({ draft: true }) }).reason,
    "pull_request_not_ready");
  assert.equal(recovery({ policyResult: policy({ currentHeadSha: "c".repeat(40) }) }).reason,
    "live_review_policy_pair_changed");
});

test("review timeout JSON is read from the downloaded Actions ZIP", () => {
  const artifact = timeoutArtifact();
  const archive = zipWithEntry(
    "nested/review-policy.json",
    `${JSON.stringify(artifact)}\n`,
    8,
  );
  assert.deepEqual(readZipJsonEntry(archive), artifact);
  assert.throws(() => readZipJsonEntry(Buffer.from("not-a-zip")), /ZIP archive/u);
});

test("recovery workflow uses trusted default-branch code and narrowly scoped rerun authority", async () => {
  const [workflow, script] = await Promise.all([
    readFile(path.join(productRoot, ".github/workflows/review-gate-recovery.yml"), "utf8"),
    readFile(path.join(productRoot, "scripts/recover-pr-review-gate.mjs"), "utf8"),
  ]);
  assert.match(workflow, /issue_comment:[\s\S]*types: \[created\]/u);
  assert.match(workflow, /pull_request_review:[\s\S]*types: \[submitted\]/u);
  assert.match(workflow, /actions: write/u);
  assert.match(workflow, /contents: read/u);
  assert.doesNotMatch(workflow, /contents: write|issues: write|pull-requests: write/u);
  assert.match(workflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/u);
  assert.match(workflow, /persist-credentials: false/u);
  assert.match(workflow, /recover-pr-review-gate\.mjs/u);
  assert.doesNotMatch(workflow, /pull_request_target|gh pr merge|mergePullRequest/u);
  assert.match(script, /\/rerun-failed-jobs/u);
  assert.doesNotMatch(script, /\/rerun(?:["'`]|\?)/u);
});
