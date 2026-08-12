#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { appendFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const SHA_OR_REF_PATTERN = /^[A-Za-z0-9._/@-]+$/u;
const PACKAGING_PATTERNS = [
  /^package(?:-lock)?\.json$/u,
  /^desktop\//u,
  /^schemas\//u,
  /^shared\//u,
  /^public\/brand-logo\.png$/u,
  // Preserve the complete pre-existing dry-run surface. The classifier changes
  // when that work is scheduled, never which package-affecting paths receive it.
  /^scripts\/(?:application-update-config|attachment-storage|build-package|candidate-assessment|ci-evidence|create-release-assets|developer-preview|draft-aggregate|draft-service|finalize-attempt|html-source-parser|lifecycle-core|package-delivery-report|packaged-app-identity|product-contract|project-context-service|record-user-supplement|release-app-checkpoint|release-app-stage|release-candidate-provenance|release-provenance|scope-validator|source-gate-provenance|source-history-service|target-identity|user-supplement-core|verify-packaged-artifact|workspace-bridge)\.mjs$/u,
  /^scripts\/edit-chart-spec-protocol-v0\.1\.md$/u,
  /^tests\/(?:application-update-config|desktop-package|developer-preview-package|packaged-artifact-gate|release-app-stage|test-impact-map)\.test\.mjs$/u,
  /^tests\/test-impact-map\.json$/u,
  /^tests\/e2e\/electron\/playwright\.packaged(?:-startup)?\.config\.mjs$/u,
  /^tests\/e2e\/electron\/packaged-(?:runtime|startup)-smoke\.spec\.mjs$/u,
  /^\.github\/workflows\/(?:developer-preview|release-candidate|release-dry-run|release)\.yml$/u,
  /^(?:LICENSE|NOTICE|PRIVACY\.md|THIRD_PARTY_NOTICES\.md|PageRoot 用户声明与免责声明\.txt)$/u,
];

function assertSafeRef(value, label) {
  const normalized = String(value || "").trim();
  if (!SHA_OR_REF_PATTERN.test(normalized) || normalized.includes("..") || normalized.includes("//")) {
    throw new Error(`${label} must be a safe Git ref or SHA.`);
  }
  return normalized;
}

function normalizeChangedFiles(files) {
  return [...new Set((files || []).map((file) => String(file || "").replaceAll("\\", "/").replace(/^\.\//u, "")).filter(Boolean))].sort();
}

export function classifyPrCandidate({ changedFiles = [] } = {}) {
  const files = normalizeChangedFiles(changedFiles);
  const packagingFiles = files.filter((file) => PACKAGING_PATTERNS.some((pattern) => pattern.test(file)));
  const changedFileCount = files.length;
  const advisorySize = changedFileCount > 80 ? "large" : changedFileCount > 25 ? "medium" : "small";
  return Object.freeze({
    schemaVersion: 1,
    packagingRequired: packagingFiles.length > 0,
    advisoryScope: packagingFiles.length > 0 ? "packaging-risk" : "source-only",
    changedFileCount,
    advisorySize,
    changedFiles: files,
    packagingFiles,
    // This value is deliberately advisory. PR volume is never a merge blocker.
    sizePolicy: "advisory_only",
  });
}

function gitChangedFiles(base, head) {
  const result = spawnSync("git", ["diff", "--name-only", "-z", `${base}...${head}`], {
    cwd: productRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`git diff --name-only failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result.stdout.split("\0").filter(Boolean);
}

function resolveOutputPath(output) {
  const destination = path.resolve(productRoot, output);
  if (destination !== productRoot && !destination.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error("--output must remain inside the repository.");
  }
  return destination;
}

export async function writeCandidateClassification(classification, output = "output/pr-candidate/candidate.json") {
  const destination = resolveOutputPath(output);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, `${JSON.stringify(classification, null, 2)}\n`, "utf8");
  return destination;
}

async function writeGithubOutput(destination, values) {
  if (!destination) return;
  const lines = Object.entries(values).map(([key, value]) => `${key}=${String(value ?? "").replaceAll("\r", "").replaceAll("\n", "")}`);
  await appendFile(destination, `${lines.join("\n")}\n`, "utf8");
}

function parseOptions(argv) {
  const options = {
    base: process.env.PR_BASE_SHA || "",
    head: process.env.PR_HEAD_SHA || "HEAD",
    output: "output/pr-candidate/candidate.json",
    githubOutput: process.env.GITHUB_OUTPUT || "",
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--base") options.base = value;
    else if (argument === "--head") options.head = value;
    else if (argument === "--output") options.output = value;
    else if (argument === "--github-output") options.githubOutput = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  options.base = assertSafeRef(options.base, "--base");
  options.head = assertSafeRef(options.head, "--head");
  resolveOutputPath(options.output);
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const classification = classifyPrCandidate({ changedFiles: gitChangedFiles(options.base, options.head) });
  const destination = await writeCandidateClassification(classification, options.output);
  await writeGithubOutput(options.githubOutput, {
    packaging_required: classification.packagingRequired,
    advisory_scope: classification.advisoryScope,
    advisory_size: classification.advisorySize,
    changed_file_count: classification.changedFileCount,
    artifact_path: destination,
  });
  console.log(JSON.stringify(classification, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
