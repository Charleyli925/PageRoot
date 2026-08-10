#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inflateRawSync } from "node:zlib";

import {
  collectReviewPolicySnapshot,
  evaluateReviewPolicy,
  summarizeReviewPolicy,
} from "./check-pr-review-policy.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const REPOSITORY_PATTERN = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u;
const CODEX_LOGIN = "chatgpt-codex-connector";
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const REVIEW_TIMEOUT_REASON = "review_wait_timed_out";
const EXPECTED_FAILED_JOBS = new Set(["review-policy", "release-gate"]);
const REQUIRED_GREEN_JOBS = Object.freeze([
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
]);
const DEFAULT_SETTLE_SECONDS = 30;
const DEFAULT_WAIT_SECONDS = 120;
const DEFAULT_POLL_SECONDS = 10;
const GITHUB_API_VERSION = "2022-11-28";
const MAX_REVIEW_ARTIFACT_BYTES = 1024 * 1024;

function normalizedLogin(value) {
  return String(value || "").toLowerCase().replace(/\[bot\]$/u, "");
}

function timestamp(value) {
  const milliseconds = Date.parse(value || "");
  return Number.isFinite(milliseconds) ? milliseconds : null;
}

function currentHeadSha(pullRequest) {
  return String(pullRequest?.head?.sha || pullRequest?.headRefOid || "").toLowerCase();
}

function currentBaseSha(pullRequest) {
  return String(pullRequest?.base?.sha || pullRequest?.baseRefOid || "").toLowerCase();
}

function ignored(reason, fields = {}) {
  return Object.freeze({ status: "ignored", reason, ...fields });
}

export function recoveryTriggerFromEvent(eventName, payload = {}) {
  const event = String(eventName || "");
  let actor = "";
  let pullRequest = 0;
  let kind = "";
  if (
    event === "issue_comment"
    && payload?.action === "created"
    && payload?.issue?.pull_request
  ) {
    actor = payload?.comment?.user?.login || "";
    pullRequest = Number(payload?.issue?.number || 0);
    kind = "issue_comment";
  } else if (
    event === "pull_request_review"
    && payload?.action === "submitted"
  ) {
    actor = payload?.review?.user?.login || "";
    pullRequest = Number(payload?.pull_request?.number || 0);
    kind = "pull_request_review";
  } else {
    return ignored("unsupported_event");
  }
  if (normalizedLogin(actor) !== CODEX_LOGIN) {
    return ignored("untrusted_actor", { actor: normalizedLogin(actor) || null });
  }
  if (!Number.isInteger(pullRequest) || pullRequest <= 0) {
    return ignored("pull_request_missing", { actor: CODEX_LOGIN });
  }
  return Object.freeze({
    status: "accepted",
    reason: "codex_review_event",
    kind,
    actor: CODEX_LOGIN,
    pullRequest,
  });
}

function workflowPathMatches(run) {
  const workflowPath = String(run?.path || "");
  return workflowPath === CI_WORKFLOW_PATH
    || workflowPath.startsWith(`${CI_WORKFLOW_PATH}@`);
}

function runPullRequestMatches(run, pullRequest) {
  const pullRequests = Array.isArray(run?.pull_requests) ? run.pull_requests : [];
  return pullRequests.length === 0
    || pullRequests.some((candidate) => Number(candidate?.number) === pullRequest);
}

export function selectReviewGateRun({
  workflowRuns = [],
  pullRequest,
  headSha,
  headRef = "",
  readyAt,
} = {}) {
  const readyAtMs = timestamp(readyAt);
  if (!Number.isFinite(readyAtMs) || !SHA_PATTERN.test(String(headSha || ""))) {
    return null;
  }
  return (workflowRuns || [])
    .filter((run) => (
      String(run?.event || "") === "pull_request"
      && String(run?.head_sha || "").toLowerCase() === headSha
      && workflowPathMatches(run)
      && runPullRequestMatches(run, pullRequest)
      && (!headRef || String(run?.head_branch || "") === headRef)
      && Number.isFinite(timestamp(run?.created_at))
      && timestamp(run?.created_at) >= readyAtMs
    ))
    .sort((left, right) => (
      (timestamp(right?.created_at) || 0) - (timestamp(left?.created_at) || 0)
      || Number(right?.id || 0) - Number(left?.id || 0)
    ))[0] || null;
}

export function evaluateReviewGateJobs(jobs = []) {
  const latestByName = new Map();
  for (const job of jobs || []) {
    const name = String(job?.name || "");
    if (name) latestByName.set(name, job);
  }
  for (const name of REQUIRED_GREEN_JOBS) {
    const conclusion = String(latestByName.get(name)?.conclusion || "");
    if (conclusion !== "success") {
      return ignored("required_source_job_not_green", { job: name, conclusion: conclusion || null });
    }
  }
  for (const name of EXPECTED_FAILED_JOBS) {
    const conclusion = String(latestByName.get(name)?.conclusion || "");
    if (conclusion !== "failure") {
      return ignored("review_failure_shape_changed", { job: name, conclusion: conclusion || null });
    }
  }
  const unexpected = [...latestByName.values()].find((job) => {
    const conclusion = String(job?.conclusion || "");
    return !["success", "skipped"].includes(conclusion)
      && !(
        EXPECTED_FAILED_JOBS.has(String(job?.name || ""))
        && conclusion === "failure"
      );
  });
  if (unexpected) {
    return ignored("non_review_job_failed", {
      job: String(unexpected.name || "unknown"),
      conclusion: String(unexpected.conclusion || "") || null,
    });
  }
  return Object.freeze({
    status: "eligible",
    reason: "only_review_gate_failed",
  });
}

export function evaluateReviewTimeoutArtifact({
  artifact,
  pullRequest,
  policyResult,
} = {}) {
  const headSha = currentHeadSha(pullRequest);
  const baseSha = currentBaseSha(pullRequest);
  if (
    artifact?.status !== "blocked"
    || artifact?.reason !== REVIEW_TIMEOUT_REASON
  ) return ignored("review_timeout_artifact_missing");
  if (
    artifact?.expectedHeadSha !== headSha
    || artifact?.currentHeadSha !== headSha
    || artifact?.expectedBaseSha !== baseSha
    || artifact?.currentBaseSha !== baseSha
  ) return ignored("review_timeout_artifact_pair_changed");
  if (artifact?.readyAt !== policyResult?.readyAt) {
    return ignored("review_timeout_ready_transition_changed");
  }
  if ((artifact?.blockingFindings || []).length > 0) {
    return ignored("review_timeout_artifact_has_blockers");
  }
  return Object.freeze({ status: "eligible", reason: REVIEW_TIMEOUT_REASON });
}

export function evaluateReviewGateRecovery({
  trigger,
  pullRequest,
  policyResult,
  workflowRuns = [],
  jobs = [],
  artifact,
} = {}) {
  if (trigger?.status !== "accepted") return trigger || ignored("trigger_missing");
  if (Number(pullRequest?.number) !== trigger.pullRequest) {
    return ignored("pull_request_identity_changed");
  }
  if (
    String(pullRequest?.state || "").toLowerCase() !== "open"
    || pullRequest?.draft === true
    || pullRequest?.isDraft === true
  ) return ignored("pull_request_not_ready");
  if (policyResult?.status !== "passed") {
    return ignored("live_review_policy_not_passed", { policyReason: policyResult?.reason || null });
  }
  const headSha = currentHeadSha(pullRequest);
  const baseSha = currentBaseSha(pullRequest);
  if (
    !SHA_PATTERN.test(headSha)
    || !SHA_PATTERN.test(baseSha)
    || policyResult?.expectedHeadSha !== headSha
    || policyResult?.currentHeadSha !== headSha
    || policyResult?.expectedBaseSha !== baseSha
    || policyResult?.currentBaseSha !== baseSha
    || (policyResult?.blockingFindings || []).length > 0
  ) return ignored("live_review_policy_pair_changed");
  const run = selectReviewGateRun({
    workflowRuns,
    pullRequest: trigger.pullRequest,
    headSha,
    headRef: String(pullRequest?.head?.ref || ""),
    readyAt: policyResult.readyAt,
  });
  if (!run) return ignored("matching_ci_run_missing");
  if (run?.status !== "completed" || run?.conclusion !== "failure") {
    return ignored("matching_ci_run_not_failed", {
      runId: Number(run?.id || 0) || null,
      runStatus: run?.status || null,
      runConclusion: run?.conclusion || null,
    });
  }
  const jobResult = evaluateReviewGateJobs(jobs);
  if (jobResult.status !== "eligible") {
    return Object.freeze({ ...jobResult, runId: Number(run.id) });
  }
  const artifactResult = evaluateReviewTimeoutArtifact({ artifact, pullRequest, policyResult });
  if (artifactResult.status !== "eligible") {
    return Object.freeze({ ...artifactResult, runId: Number(run.id) });
  }
  return Object.freeze({
    status: "eligible",
    reason: "late_review_can_rerun_failed_jobs",
    runId: Number(run.id),
    runAttempt: Number(run.run_attempt || 1),
    headSha,
    baseSha,
  });
}

function findEndOfCentralDirectory(buffer) {
  const minimumOffset = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= minimumOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  return -1;
}

export function readZipJsonEntry(input, entrySuffix = "review-policy.json") {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input);
  if (buffer.length > MAX_REVIEW_ARTIFACT_BYTES) {
    throw new Error("Review-policy artifact exceeds the 1 MiB safety limit.");
  }
  const endOffset = findEndOfCentralDirectory(buffer);
  if (endOffset < 0) throw new Error("Review-policy artifact is not a supported ZIP archive.");
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  const centralOffset = buffer.readUInt32LE(endOffset + 16);
  if (entryCount === 0xffff || centralOffset === 0xffffffff) {
    throw new Error("ZIP64 review-policy artifacts are not supported.");
  }
  let offset = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) {
      throw new Error("Review-policy artifact central directory is invalid.");
    }
    const flags = buffer.readUInt16LE(offset + 8);
    const compression = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    offset += 46 + nameLength + extraLength + commentLength;
    if (!name.endsWith(entrySuffix)) continue;
    if ((flags & 0x1) !== 0) throw new Error("Encrypted review-policy artifacts are not supported.");
    if (uncompressedSize > MAX_REVIEW_ARTIFACT_BYTES) {
      throw new Error("Review-policy artifact entry exceeds the 1 MiB safety limit.");
    }
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      throw new Error("Review-policy artifact local entry is invalid.");
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataOffset, dataOffset + compressedSize);
    const content = compression === 0
      ? compressed
      : compression === 8
        ? inflateRawSync(compressed, { maxOutputLength: MAX_REVIEW_ARTIFACT_BYTES })
        : null;
    if (!content) throw new Error(`Unsupported review-policy ZIP compression: ${compression}.`);
    if (content.length !== uncompressedSize) {
      throw new Error("Review-policy artifact entry size is invalid.");
    }
    return JSON.parse(content.toString("utf8"));
  }
  throw new Error(`Review-policy artifact did not contain ${entrySuffix}.`);
}

function resolveOutputPath(output) {
  const destination = path.resolve(productRoot, output);
  if (destination !== productRoot && !destination.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error("--output must remain inside the repository.");
  }
  return destination;
}

export async function writeRecoveryArtifact(result, output = "output/review-gate-recovery/recovery.json") {
  const destination = resolveOutputPath(output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return destination;
}

async function appendSummary(result) {
  if (!process.env.GITHUB_STEP_SUMMARY) return;
  const lines = [
    "### Review gate recovery",
    "",
    `- Result: **${String(result.status || "unknown").toUpperCase()}** (${result.reason || "unknown"})`,
    `- Pull Request: ${result.pullRequest ? `#${result.pullRequest}` : "n/a"}`,
    `- Head/base: \`${result.headSha || "n/a"}\` / \`${result.baseSha || "n/a"}\``,
    `- Original CI run: ${result.runId || "n/a"}`,
    "",
  ];
  await appendFile(process.env.GITHUB_STEP_SUMMARY, `${lines.join("\n")}\n`, "utf8");
}

async function githubRequest(apiBase, apiPath, token, init = {}) {
  const response = await globalThis.fetch(`${apiBase}${apiPath}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      ...(init.headers || {}),
    },
  });
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${apiPath}: ${body}`);
  }
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function githubArtifact(apiBase, repository, artifactId, token) {
  const response = await globalThis.fetch(
    `${apiBase}/repos/${encodeURIComponentPath(repository)}/actions/artifacts/${artifactId}/zip`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": GITHUB_API_VERSION,
      },
    },
  );
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub artifact API ${response.status}: ${body}`);
  }
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_REVIEW_ARTIFACT_BYTES) {
    throw new Error("Review-policy artifact download exceeds the 1 MiB safety limit.");
  }
  return Buffer.from(await response.arrayBuffer());
}

function encodeURIComponentPath(repository) {
  return repository.split("/").map(encodeURIComponent).join("/");
}

async function recoveryInputs(options, token, pullRequest, policyResult) {
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const repositoryPath = encodeURIComponentPath(options.repository);
  const headSha = currentHeadSha(pullRequest);
  const runsResponse = await githubRequest(
    apiBase,
    `/repos/${repositoryPath}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${headSha}&per_page=100`,
    token,
  );
  const workflowRuns = runsResponse?.workflow_runs || [];
  const run = selectReviewGateRun({
    workflowRuns,
    pullRequest: options.pullRequest,
    headSha,
    headRef: String(pullRequest?.head?.ref || ""),
    readyAt: policyResult.readyAt,
  });
  if (!run || run.status !== "completed" || run.conclusion !== "failure") {
    return { workflowRuns, run, jobs: [], artifact: null };
  }
  const [jobsResponse, artifactsResponse] = await Promise.all([
    githubRequest(
      apiBase,
      `/repos/${repositoryPath}/actions/runs/${run.id}/jobs?filter=latest&per_page=100`,
      token,
    ),
    githubRequest(
      apiBase,
      `/repos/${repositoryPath}/actions/runs/${run.id}/artifacts?per_page=100`,
      token,
    ),
  ]);
  const artifactName = `PageRoot-review-policy-${run.id}-${run.run_attempt || 1}`;
  const artifactRecord = (artifactsResponse?.artifacts || []).find((candidate) => (
    candidate?.name === artifactName && candidate?.expired !== true
  ));
  const artifact = artifactRecord
    ? readZipJsonEntry(await githubArtifact(
        apiBase,
        options.repository,
        artifactRecord.id,
        token,
      ))
    : null;
  return {
    workflowRuns,
    run,
    jobs: jobsResponse?.jobs || [],
    artifact,
  };
}

function parseOptions(argv) {
  const options = {
    repository: process.env.GITHUB_REPOSITORY || "",
    pullRequest: 0,
    eventName: process.env.GITHUB_EVENT_NAME || "",
    eventPath: process.env.GITHUB_EVENT_PATH || "",
    tokenEnv: "GITHUB_TOKEN",
    settleSeconds: DEFAULT_SETTLE_SECONDS,
    waitSeconds: DEFAULT_WAIT_SECONDS,
    pollSeconds: DEFAULT_POLL_SECONDS,
    output: "output/review-gate-recovery/recovery.json",
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--event-name") options.eventName = value;
    else if (argument === "--event-path") options.eventPath = value;
    else if (argument === "--token-env") options.tokenEnv = value;
    else if (argument === "--settle-seconds") options.settleSeconds = Number(value);
    else if (argument === "--wait-seconds") options.waitSeconds = Number(value);
    else if (argument === "--poll-seconds") options.pollSeconds = Number(value);
    else if (argument === "--output") options.output = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!REPOSITORY_PATTERN.test(options.repository)) throw new Error("--repository must use owner/name.");
  if (!options.eventName) throw new Error("--event-name is required.");
  if (!options.eventPath) throw new Error("--event-path is required.");
  for (const [name, value, minimum, maximum] of [
    ["--settle-seconds", options.settleSeconds, 0, 600],
    ["--wait-seconds", options.waitSeconds, 1, 600],
    ["--poll-seconds", options.pollSeconds, 1, 60],
  ]) {
    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} must be an integer from ${minimum} to ${maximum}.`);
    }
  }
  resolveOutputPath(options.output);
  return options;
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function finish(result, options) {
  await writeRecoveryArtifact(result, options.output);
  await appendSummary(result);
  console.log(JSON.stringify(result, null, 2));
  return result;
}

async function run(options) {
  const payload = JSON.parse(await readFile(options.eventPath, "utf8"));
  const trigger = recoveryTriggerFromEvent(options.eventName, payload);
  if (trigger.status !== "accepted") return finish(trigger, options);
  options.pullRequest = trigger.pullRequest;
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  const deadline = Date.now() + options.waitSeconds * 1000;
  let snapshot = null;
  let policyResult = null;
  for (;;) {
    snapshot = await collectReviewPolicySnapshot(options, token);
    const headSha = currentHeadSha(snapshot.pullRequest);
    const baseSha = currentBaseSha(snapshot.pullRequest);
    if (!SHA_PATTERN.test(headSha) || !SHA_PATTERN.test(baseSha)) {
      return finish(ignored("live_pull_request_pair_missing", {
        pullRequest: trigger.pullRequest,
      }), options);
    }
    policyResult = evaluateReviewPolicy({
      expectedHeadSha: headSha,
      expectedBaseSha: baseSha,
      ...snapshot,
      settleSeconds: options.settleSeconds,
    });
    if (policyResult.status === "passed") break;
    if (
      policyResult.status !== "waiting"
      || !["final_review_in_progress", "settle_window"].includes(policyResult.reason)
      || Date.now() >= deadline
    ) {
      return finish(ignored("live_review_policy_not_passed", {
        pullRequest: trigger.pullRequest,
        headSha,
        baseSha,
        policy: summarizeReviewPolicy(policyResult),
      }), options);
    }
    await delay(Math.min(options.pollSeconds * 1000, Math.max(1, deadline - Date.now())));
  }

  const inputs = await recoveryInputs(options, token, snapshot.pullRequest, policyResult);
  const decision = evaluateReviewGateRecovery({
    trigger,
    pullRequest: snapshot.pullRequest,
    policyResult,
    workflowRuns: inputs.workflowRuns,
    jobs: inputs.jobs,
    artifact: inputs.artifact,
  });
  const result = {
    ...decision,
    pullRequest: trigger.pullRequest,
    headSha: currentHeadSha(snapshot.pullRequest),
    baseSha: currentBaseSha(snapshot.pullRequest),
    policy: summarizeReviewPolicy(policyResult),
  };
  if (decision.status !== "eligible") return finish(result, options);
  const apiBase = (process.env.GITHUB_API_URL || "https://api.github.com").replace(/\/$/u, "");
  const repositoryPath = encodeURIComponentPath(options.repository);
  await githubRequest(
    apiBase,
    `/repos/${repositoryPath}/actions/runs/${decision.runId}/rerun-failed-jobs`,
    token,
    { method: "POST", body: JSON.stringify({ enable_debug_logging: false }) },
  );
  return finish({
    ...result,
    status: "rerun_requested",
    reason: "late_review_rerun_requested",
  }, options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run(parseOptions(process.argv.slice(2))).catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
