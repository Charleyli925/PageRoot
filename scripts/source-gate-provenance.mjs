#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u;
const DEFAULT_MAX_AGE_HOURS = 168;
const DEFAULT_RETRIES = 3;

function git(root, args) {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout.trim();
}

function assertSha(value, label) {
  if (!SHA_PATTERN.test(value || "")) throw new Error(`${label} must be a 40-character Git SHA.`);
  return value;
}

function assertVersion(value, label) {
  if (!VERSION_PATTERN.test(value || "")) throw new Error(`${label} must be a semantic version.`);
  return value;
}

function assertRepository(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(value || "")) {
    throw new Error("repository must use the owner/name form.");
  }
  return value;
}

export function sourceGateArtifactName(treeSha, packageVersion) {
  return `PageRoot-source-gate-${assertSha(treeSha, "treeSha")}-${assertVersion(packageVersion, "packageVersion")}`;
}

export function readPackageVersions(packageJson, packageLock) {
  const packageVersion = assertVersion(packageJson?.version, "package.json version");
  const lockVersion = assertVersion(
    packageLock?.packages?.[""]?.version || packageLock?.version,
    "package-lock.json root version",
  );
  if (packageVersion !== lockVersion) {
    throw new Error(
      `package.json version ${packageVersion} does not match package-lock.json root version ${lockVersion}.`,
    );
  }
  return Object.freeze({ packageVersion, lockVersion });
}

export function evaluateSourceGateEvidence({
  currentCommitSha,
  currentTreeSha,
  packageVersion,
  pullRequests,
  workflowRuns,
  artifactsByRunId,
  now = new Date(),
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
}) {
  assertSha(currentCommitSha, "currentCommitSha");
  assertSha(currentTreeSha, "currentTreeSha");
  assertVersion(packageVersion, "packageVersion");
  if (!Number.isFinite(maxAgeHours) || maxAgeHours <= 0) {
    throw new Error("maxAgeHours must be a positive number.");
  }

  const pullRequest = (pullRequests || []).find((candidate) => (
    candidate?.merged_at
    && candidate?.merge_commit_sha === currentCommitSha
    && candidate?.base?.ref === "main"
    && SHA_PATTERN.test(candidate?.head?.sha || "")
  ));
  if (!pullRequest) {
    return Object.freeze({
      trusted: false,
      reason: "no_merged_pull_request",
      pullRequestNumber: null,
      runId: null,
    });
  }

  const matchingRuns = (workflowRuns || [])
    .filter((run) => (
      run?.event === "pull_request"
      && run?.status === "completed"
      && run?.conclusion === "success"
      && run?.head_sha === pullRequest.head.sha
    ))
    .sort((left, right) => (
      Date.parse(right.updated_at || right.created_at || "")
      - Date.parse(left.updated_at || left.created_at || "")
    ));
  if (matchingRuns.length === 0) {
    return Object.freeze({
      trusted: false,
      reason: "no_successful_source_gate",
      pullRequestNumber: pullRequest.number,
      runId: null,
    });
  }

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const maxAgeMs = maxAgeHours * 60 * 60 * 1000;
  const freshRuns = matchingRuns.filter((run) => {
    const completedMs = Date.parse(run.updated_at || run.created_at || "");
    return Number.isFinite(completedMs)
      && completedMs <= nowMs
      && nowMs - completedMs <= maxAgeMs;
  });
  if (freshRuns.length === 0) {
    return Object.freeze({
      trusted: false,
      reason: "source_gate_stale",
      pullRequestNumber: pullRequest.number,
      runId: matchingRuns[0]?.id || null,
    });
  }

  const expectedArtifact = sourceGateArtifactName(currentTreeSha, packageVersion);
  for (const run of freshRuns) {
    const artifacts = artifactsByRunId?.[String(run.id)] || [];
    const attestation = artifacts.find((artifact) => (
      artifact?.name === expectedArtifact && artifact?.expired !== true
    ));
    if (!attestation) continue;
    const completedMs = Date.parse(run.updated_at || run.created_at);
    return Object.freeze({
      trusted: true,
      reason: "matching_source_gate",
      pullRequestNumber: pullRequest.number,
      pullRequestHeadSha: pullRequest.head.sha,
      runId: run.id,
      artifactId: attestation.id,
      artifactName: attestation.name,
      ageHours: Math.round(((nowMs - completedMs) / (60 * 60 * 1000)) * 100) / 100,
    });
  }

  return Object.freeze({
    trusted: false,
    reason: "matching_attestation_missing",
    pullRequestNumber: pullRequest.number,
    runId: freshRuns[0]?.id || null,
  });
}

async function readLocalIdentity(root) {
  const [packageJson, packageLock] = await Promise.all([
    readFile(path.join(root, "package.json"), "utf8").then(JSON.parse),
    readFile(path.join(root, "package-lock.json"), "utf8").then(JSON.parse),
  ]);
  const versions = readPackageVersions(packageJson, packageLock);
  return Object.freeze({
    commitSha: assertSha(git(root, ["rev-parse", "HEAD"]), "HEAD"),
    treeSha: assertSha(git(root, ["rev-parse", "HEAD^{tree}"]), "HEAD tree"),
    subject: git(root, ["log", "-1", "--format=%s"]),
    dirtyPaths: git(root, ["status", "--porcelain=v1", "--untracked-files=all"]),
    ...versions,
  });
}

function parseOptions(argv) {
  const command = argv.shift();
  if (!/^(?:create|verify)$/u.test(command || "")) {
    throw new Error("Usage: source-gate-provenance.mjs <create|verify> [options]");
  }
  const options = {
    command,
    repository: process.env.GITHUB_REPOSITORY || "",
    output: "output/source-gate/source-gate.json",
    githubOutput: process.env.GITHUB_OUTPUT || "",
    workflow: "ci.yml",
    tokenEnv: "GITHUB_TOKEN",
    mode: "required",
    missingAssociation: "fail",
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    retries: DEFAULT_RETRIES,
    pullRequest: null,
    pullRequestHead: "",
    pullRequestBase: "",
    runId: "",
    runAttempt: "",
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--repository") options.repository = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--github-output") options.githubOutput = value;
    else if (argument === "--workflow") options.workflow = value;
    else if (argument === "--token-env") options.tokenEnv = value;
    else if (argument === "--mode") options.mode = value;
    else if (argument === "--missing-association") options.missingAssociation = value;
    else if (argument === "--max-age-hours") options.maxAgeHours = Number(value);
    else if (argument === "--retries") options.retries = Number(value);
    else if (argument === "--pull-request") options.pullRequest = Number(value);
    else if (argument === "--pull-request-head") options.pullRequestHead = value;
    else if (argument === "--pull-request-base") options.pullRequestBase = value;
    else if (argument === "--run-id") options.runId = value;
    else if (argument === "--run-attempt") options.runAttempt = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  assertRepository(options.repository);
  if (!/^(?:required|advisory)$/u.test(options.mode)) {
    throw new Error("--mode must be required or advisory.");
  }
  if (!/^(?:fail|warn)$/u.test(options.missingAssociation)) {
    throw new Error("--missing-association must be fail or warn.");
  }
  if (!Number.isInteger(options.retries) || options.retries < 1 || options.retries > 5) {
    throw new Error("--retries must be an integer from 1 to 5.");
  }
  return options;
}

async function writeOutputs(destination, values) {
  if (!destination) return;
  const lines = Object.entries(values).map(([key, value]) => {
    const normalized = String(value ?? "").replaceAll("\r", "").replaceAll("\n", "");
    return `${key}=${normalized}`;
  });
  await appendFile(destination, `${lines.join("\n")}\n`, "utf8");
}

async function createAttestation(options) {
  const identity = await readLocalIdentity(productRoot);
  if (identity.dirtyPaths) {
    throw new Error(`Source gate attestation requires a clean checkout:\n${identity.dirtyPaths}`);
  }
  if (!Number.isInteger(options.pullRequest) || options.pullRequest <= 0) {
    throw new Error("--pull-request must be a positive integer.");
  }
  assertSha(options.pullRequestHead, "pull request head");
  assertSha(options.pullRequestBase, "pull request base");
  if (!/^\d+$/u.test(options.runId) || !/^\d+$/u.test(options.runAttempt)) {
    throw new Error("--run-id and --run-attempt must be positive integers.");
  }
  const artifactName = sourceGateArtifactName(identity.treeSha, identity.packageVersion);
  const attestation = Object.freeze({
    schemaVersion: 1,
    repository: options.repository,
    event: "pull_request",
    pullRequestNumber: options.pullRequest,
    pullRequestHeadSha: options.pullRequestHead,
    pullRequestBaseSha: options.pullRequestBase,
    testedCommitSha: identity.commitSha,
    testedTreeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    packageLockVersion: identity.lockVersion,
    workflowRunId: Number(options.runId),
    workflowRunAttempt: Number(options.runAttempt),
    artifactName,
    createdAt: new Date().toISOString(),
  });
  const destination = path.resolve(productRoot, options.output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  await writeOutputs(options.githubOutput, {
    trusted: true,
    reason: "source_gate_completed",
    tree_sha: identity.treeSha,
    package_version: identity.packageVersion,
    artifact_name: artifactName,
    attestation_path: destination,
  });
  console.log(`Source gate attestation: ${destination}`);
  console.log(`Source gate artifact: ${artifactName}`);
  return attestation;
}

async function githubJson(apiPath, token, { allowNotFound = false } = {}) {
  const apiBase = process.env.GITHUB_API_URL || "https://api.github.com";
  const response = await globalThis.fetch(`${apiBase}${apiPath}`, {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });
  if (response.status === 404 && allowNotFound) return null;
  if (!response.ok) {
    const body = (await response.text()).slice(0, 500);
    throw new Error(`GitHub API ${response.status} for ${apiPath}: ${body}`);
  }
  return await response.json();
}

// A squash-merge subject carries its own pull-request number. That fact
// travels with the commit itself, so it stays valid when the eventually
// consistent commit->pulls association index has not caught up yet or has
// been pruned later.
export function parsePullRequestNumberFromSubject(subject) {
  const match = /\(#(\d+)\)$/u.exec(String(subject || "").trim());
  return match ? Number(match[1]) : null;
}

export function pullRequestMatchesCommit(pullRequest, commitSha) {
  return Boolean(
    pullRequest?.merged_at
    && pullRequest?.merge_commit_sha === commitSha
    && pullRequest?.base?.ref === "main",
  );
}

// Distinguishes "the platform has no association data at all" (unrecoverable
// by a rerun, warn-eligible) from "the commit names a pull request that does
// not match it" (always a hard failure).
export function classifyMissingAssociation({ parsedNumber, parsedPullRequest }) {
  return parsedNumber && parsedPullRequest
    ? "pull_request_mismatch"
    : "association_unavailable";
}

async function collectRemoteEvidence(options, identity) {
  const token = process.env[options.tokenEnv] || "";
  if (!token) throw new Error(`Environment variable ${options.tokenEnv} is required.`);
  const repositoryPath = options.repository.split("/").map(encodeURIComponent).join("/");
  const parsedNumber = parsePullRequestNumberFromSubject(identity.subject);
  const parsedPullRequest = parsedNumber
    ? await githubJson(`/repos/${repositoryPath}/pulls/${parsedNumber}`, token, {
      allowNotFound: true,
    })
    : null;
  let pullRequests;
  if (pullRequestMatchesCommit(parsedPullRequest, identity.commitSha)) {
    pullRequests = [parsedPullRequest];
  } else {
    const associated = await githubJson(
      `/repos/${repositoryPath}/commits/${identity.commitSha}/pulls`,
      token,
    );
    pullRequests = [
      ...(parsedPullRequest ? [parsedPullRequest] : []),
      ...(associated || []),
    ];
  }
  const pullRequest = pullRequests.find((candidate) => (
    pullRequestMatchesCommit(candidate, identity.commitSha)
  ));
  if (!pullRequest) {
    return { parsedNumber, parsedPullRequest, pullRequests, workflowRuns: [], artifactsByRunId: {} };
  }
  const workflow = encodeURIComponent(options.workflow);
  const runsResponse = await githubJson(
    `/repos/${repositoryPath}/actions/workflows/${workflow}/runs`
    + `?event=pull_request&status=success&head_sha=${pullRequest.head.sha}&per_page=100`,
    token,
  );
  const workflowRuns = runsResponse.workflow_runs || [];
  const artifactsByRunId = {};
  await Promise.all(workflowRuns.slice(0, 10).map(async (run) => {
    const response = await githubJson(
      `/repos/${repositoryPath}/actions/runs/${run.id}/artifacts?per_page=100`,
      token,
    );
    artifactsByRunId[String(run.id)] = response.artifacts || [];
  }));
  return { parsedNumber, parsedPullRequest, pullRequests, workflowRuns, artifactsByRunId };
}

function delay(milliseconds) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

async function verifyAttestation(options) {
  const identity = await readLocalIdentity(productRoot);
  if (identity.dirtyPaths) {
    throw new Error(`Source gate verification requires a clean checkout:\n${identity.dirtyPaths}`);
  }
  let result = null;
  let association = null;
  let error = null;
  for (let attempt = 1; attempt <= options.retries; attempt += 1) {
    try {
      const { parsedNumber, parsedPullRequest, ...evidence } = await collectRemoteEvidence(
        options,
        identity,
      );
      association = { parsedNumber, parsedPullRequest };
      result = evaluateSourceGateEvidence({
        currentCommitSha: identity.commitSha,
        currentTreeSha: identity.treeSha,
        packageVersion: identity.packageVersion,
        ...evidence,
        maxAgeHours: options.maxAgeHours,
      });
      error = null;
      if (result.trusted || result.reason === "source_gate_stale") break;
    } catch (caught) {
      error = caught;
    }
    if (attempt < options.retries) await delay(2 ** (attempt - 1) * 1000);
  }
  if (error) {
    if (options.mode === "required") throw error;
    result = Object.freeze({
      trusted: false,
      reason: "github_evidence_unavailable",
      pullRequestNumber: null,
      runId: null,
    });
  }
  if (!result.trusted && result.reason === "no_merged_pull_request") {
    result = Object.freeze({
      ...result,
      reason: classifyMissingAssociation({
        parsedNumber: association?.parsedNumber ?? null,
        parsedPullRequest: association?.parsedPullRequest ?? null,
      }),
    });
  }
  await writeOutputs(options.githubOutput, {
    trusted: result.trusted,
    reason: result.reason,
    pull_request: result.pullRequestNumber || "",
    run_id: result.runId || "",
    tree_sha: identity.treeSha,
    package_version: identity.packageVersion,
  });
  console.log(JSON.stringify({
    ...result,
    commitSha: identity.commitSha,
    treeSha: identity.treeSha,
    packageVersion: identity.packageVersion,
    maxAgeHours: options.maxAgeHours,
  }));
  if (!result.trusted && options.mode === "required") {
    if (result.reason === "association_unavailable" && options.missingAssociation === "warn") {
      console.warn(
        "WARNING: GitHub has no pull-request association for this commit and the "
        + "commit subject names no pull request. A rerun cannot recover this, so "
        + "the check passes with a warning instead of failing.",
      );
    } else {
      throw new Error(`Current source is not covered by a reusable PR source gate: ${result.reason}.`);
    }
  }
  return result;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.command === "create") await createAttestation(options);
  else await verifyAttestation(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
