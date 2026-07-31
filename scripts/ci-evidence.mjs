#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  appendFile,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { finished } from "node:stream/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const MAX_CAPTURE_BYTES = 512 * 1024;
const PACKAGED_ARTIFACT_STAGES = new Set([
  "developer-preview",
  "artifact-candidate",
  "artifact-preflight",
  "artifact-sign",
  "artifact-notarize-app",
  "artifact-checkpoint",
  "artifact-notarize-dmg",
  "artifact-final",
]);
const ALLOWED_STAGES = new Set([
  "draft-feedback",
  "source-build",
  "source-test",
  "environment-preflight",
  "post-merge",
  ...PACKAGED_ARTIFACT_STAGES,
  "publish",
]);

export function isAllowedCiEvidenceStage(stage) {
  return ALLOWED_STAGES.has(stage);
}

function git(args) {
  const result = spawnSync("git", args, {
    cwd: productRoot,
    encoding: "utf8",
  });
  return result.status === 0 ? result.stdout.trim() : "";
}

function safeSegment(value, label) {
  if (!/^[a-z0-9][a-z0-9._-]{0,79}$/u.test(value || "")) {
    throw new Error(`${label} must use lowercase letters, numbers, dots, underscores or hyphens.`);
  }
  return value;
}

function parseArguments(argv) {
  if (argv.shift() !== "run") {
    throw new Error(
      "Usage: ci-evidence.mjs run --suite <name> --stage <stage> -- <command> [args...]",
    );
  }
  const options = { suite: "", stage: "", command: "", args: [] };
  while (argv.length > 0) {
    const argument = argv.shift();
    if (argument === "--") {
      options.command = argv.shift() || "";
      options.args = argv;
      break;
    }
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--suite") options.suite = value;
    else if (argument === "--stage") options.stage = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  safeSegment(options.suite, "suite");
  if (!isAllowedCiEvidenceStage(options.stage)) {
    throw new Error(`Unknown stage ${JSON.stringify(options.stage)}.`);
  }
  if (!options.command) throw new Error("A command is required after --.");
  return options;
}

export function normalizeFailureText(value, repositoryRoot = productRoot) {
  const withoutAnsi = String(value || "").replace(
    /\u001b\[[0-?]*[ -/]*[@-~]/gu,
    "",
  );
  const root = path.resolve(repositoryRoot);
  const normalized = withoutAnsi
    .replaceAll(root, "<repo>")
    .replace(/\b[0-9a-f]{40}\b/giu, "<sha>")
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z\b/gu, "<timestamp>")
    .replace(/\/(?:private\/)?(?:var\/folders|tmp)\/[^\s:]+/gu, "<tmp>")
    .replace(/\b(?:run|attempt)[-_ ]?(?:id)?[=: ]+\d+\b/giu, "<run>")
    .replace(/\b\d+(?:\.\d+)?(?:ms|s|m)\b/gu, "<duration>");
  const lines = normalized.split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
  const diagnostic = lines.filter((line) => (
    /(?:error|fail|timeout|timed out|expect|assert|exception|exit code|✘)/iu.test(line)
  ));
  return (diagnostic.length > 0 ? diagnostic : lines).slice(-40).join("\n").slice(-12_000);
}

export function failureFingerprint({
  suite,
  stage,
  output,
  repositoryRoot = productRoot,
}) {
  const normalized = normalizeFailureText(output, repositoryRoot);
  const digest = createHash("sha256")
    .update("pageroot-ci-failure-v1\0")
    .update(suite)
    .update("\0")
    .update(stage)
    .update("\0")
    .update(normalized)
    .digest("hex")
    .slice(0, 20);
  return Object.freeze({
    signature: `pageroot-ci-v1:${digest}`,
    normalizedExcerpt: normalized,
  });
}

export function classificationForStage(stage, failed) {
  if (!failed) {
    return Object.freeze({
      category: null,
      categorySource: "not_applicable",
      candidateCategories: [],
    });
  }
  if (stage === "environment-preflight") {
    return Object.freeze({
      category: "ci_environment",
      categorySource: "deterministic_preflight",
      candidateCategories: ["ci_environment"],
    });
  }
  if (PACKAGED_ARTIFACT_STAGES.has(stage) || stage === "publish") {
    return Object.freeze({
      category: "packaged_artifact",
      categorySource: "stage_hint",
      candidateCategories: ["packaged_artifact", "ci_environment", "test_script"],
    });
  }
  return Object.freeze({
    category: "needs_triage",
    categorySource: "stage_hint",
    candidateCategories: ["product", "test_script", "ci_environment"],
  });
}

function commandDisplay(command, args) {
  return [command, ...args].map((part) => (
    /^[a-z0-9_./:@=+-]+$/iu.test(part) ? part : JSON.stringify(part)
  )).join(" ");
}

function appendBounded(chunks, chunk, state) {
  chunks.push(chunk);
  state.bytes += chunk.length;
  while (state.bytes > MAX_CAPTURE_BYTES && chunks.length > 1) {
    state.bytes -= chunks.shift().length;
  }
}

async function appendStepSummary(record) {
  const destination = process.env.GITHUB_STEP_SUMMARY;
  if (!destination) return;
  const rows = [
    "",
    `### CI evidence: ${record.suite}`,
    "",
    "| Result | Stage | Category | Signature | Duration |",
    "| --- | --- | --- | --- | ---: |",
    `| ${record.status} | ${record.stage} | ${record.classification.category || "none"} | ${record.failure?.signature || "none"} | ${record.durationMs} ms |`,
    "",
  ];
  await appendFile(destination, `${rows.join("\n")}\n`, "utf8");
}

async function run(options) {
  const evidenceDirectory = path.join(productRoot, "output", "ci-evidence");
  await mkdir(evidenceDirectory, { recursive: true });
  const logPath = path.join(evidenceDirectory, `${options.suite}.log`);
  const recordPath = path.join(evidenceDirectory, `${options.suite}.json`);
  const logStream = createWriteStream(logPath, { flags: "w" });
  const chunks = [];
  const captureState = { bytes: 0 };
  const startedAt = new Date();
  const display = commandDisplay(options.command, options.args);
  console.log(`[ci-evidence:${options.suite}] ${display}`);

  let spawnError = null;
  let exitCode = null;
  let signal = null;
  const child = spawn(options.command, options.args, {
    cwd: productRoot,
    env: process.env,
    stdio: ["inherit", "pipe", "pipe"],
  });
  child.on("error", (error) => {
    spawnError = error;
  });
  for (const [stream, destination] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    stream.on("data", (chunk) => {
      destination.write(chunk);
      logStream.write(chunk);
      appendBounded(chunks, Buffer.from(chunk), captureState);
    });
  }
  await new Promise((resolve) => {
    child.once("close", (code, childSignal) => {
      exitCode = code;
      signal = childSignal;
      resolve();
    });
  });
  logStream.end();
  await finished(logStream);

  const completedAt = new Date();
  const failed = Boolean(spawnError || signal || exitCode !== 0);
  const capturedOutput = Buffer.concat(chunks).toString("utf8");
  const fingerprint = failed
    ? failureFingerprint({
      suite: options.suite,
      stage: options.stage,
      output: spawnError ? `${capturedOutput}\n${spawnError.stack || spawnError}` : capturedOutput,
    })
    : null;
  const classification = classificationForStage(options.stage, failed);
  const record = Object.freeze({
    schemaVersion: 1,
    suite: options.suite,
    stage: options.stage,
    status: failed ? "failed" : "passed",
    classification,
    failure: fingerprint ? {
      signature: fingerprint.signature,
      normalizedExcerpt: fingerprint.normalizedExcerpt,
      exitCode,
      signal,
      spawnError: spawnError?.message || null,
    } : null,
    command: display,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMs: completedAt.getTime() - startedAt.getTime(),
    repository: {
      commitSha: git(["rev-parse", "HEAD"]),
      treeSha: git(["rev-parse", "HEAD^{tree}"]),
      dirty: Boolean(git(["status", "--porcelain=v1", "--untracked-files=all"])),
    },
    github: {
      repository: process.env.GITHUB_REPOSITORY || null,
      workflow: process.env.GITHUB_WORKFLOW || null,
      runId: process.env.GITHUB_RUN_ID || null,
      runAttempt: process.env.GITHUB_RUN_ATTEMPT || null,
      job: process.env.GITHUB_JOB || null,
      ref: process.env.GITHUB_REF || null,
      sha: process.env.GITHUB_SHA || null,
      runnerOs: process.env.RUNNER_OS || null,
      runnerArch: process.env.RUNNER_ARCH || null,
    },
    logPath: path.relative(productRoot, logPath),
  });
  await writeFile(recordPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await appendStepSummary(record);
  console.log(`[ci-evidence:${options.suite}] ${record.status}: ${path.relative(productRoot, recordPath)}`);
  if (fingerprint) {
    console.error(
      `[ci-evidence:${options.suite}] ${classification.category} ${fingerprint.signature}`,
    );
  }
  process.exitCode = failed ? (exitCode || 1) : 0;
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  await run(options);
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
