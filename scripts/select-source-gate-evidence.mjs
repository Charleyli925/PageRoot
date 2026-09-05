#!/usr/bin/env node

import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  REQUIRED_PRODUCT_FLAKY_SUITES,
  inspectFlakyRecord,
} from "./source-gate-attestation-guard.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const ARTIFACT_DIRECTORY_PATTERN = /^PageRoot-(.+)-evidence-(\d+)-(\d+)$/u;

export function parseEvidenceArtifactDirectory(name) {
  const match = ARTIFACT_DIRECTORY_PATTERN.exec(String(name || ""));
  if (!match) return null;
  return Object.freeze({
    suite: match[1],
    runId: Number(match[2]),
    attempt: Number(match[3]),
  });
}

export function selectSourceGateEvidence(candidates, {
  requiredSuites = REQUIRED_PRODUCT_FLAKY_SUITES,
  currentAttempt,
} = {}) {
  const attempt = Number(currentAttempt);
  if (!Number.isInteger(attempt) || attempt <= 0) {
    throw new Error("currentAttempt must be a positive integer.");
  }
  const bySuite = new Map();
  for (const candidate of candidates || []) {
    if (!candidate?.suite || !candidate.record) continue;
    const list = bySuite.get(candidate.suite) || [];
    list.push(candidate);
    bySuite.set(candidate.suite, list);
  }
  const selected = [];
  const missing = [];
  const invalid = [];
  for (const suite of requiredSuites) {
    const options = [...(bySuite.get(suite) || [])]
      .filter((item) => Number.isInteger(item.attempt) && item.attempt > 0 && item.attempt <= attempt)
      .sort((left, right) => right.attempt - left.attempt);
    const valid = options.find((item) => inspectFlakyRecord(item.record, suite).ok);
    if (!valid) {
      if (options.length === 0) missing.push(suite);
      else invalid.push(suite);
      continue;
    }
    selected.push(Object.freeze({
      suite,
      attempt: valid.attempt,
      reused: valid.attempt !== attempt,
      record: valid.record,
      sourceDirectory: valid.sourceDirectory || null,
      sourceFile: valid.sourceFile || null,
    }));
  }
  return Object.freeze({
    ok: missing.length === 0 && invalid.length === 0,
    reason: missing.length > 0
      ? "product_flaky_evidence_missing"
      : invalid.length > 0
        ? "product_flaky_evidence_invalid"
        : "product_flaky_evidence_selected",
    missing: Object.freeze(missing),
    invalid: Object.freeze(invalid),
    selected: Object.freeze(selected),
  });
}

async function readFlakyFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const records = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      records.push(...await readFlakyFiles(fullPath));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith("-flaky.json")) continue;
    records.push({
      fileName: entry.name,
      filePath: fullPath,
      record: JSON.parse(await readFile(fullPath, "utf8")),
    });
  }
  return records;
}

export async function collectEvidenceCandidates(attemptsDir) {
  const entries = await readdir(attemptsDir, { withFileTypes: true }).catch(() => []);
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsed = parseEvidenceArtifactDirectory(entry.name);
    if (!parsed) continue;
    const sourceDirectory = path.join(attemptsDir, entry.name);
    for (const file of await readFlakyFiles(sourceDirectory)) {
      candidates.push({
        ...parsed,
        record: file.record,
        sourceDirectory: entry.name,
        sourceFile: file.filePath,
        fileName: file.fileName,
      });
    }
  }
  return candidates;
}

function parseOptions(argv) {
  const options = {
    from: "output/ci-evidence-attempts",
    to: "output/ci-evidence",
    runAttempt: process.env.GITHUB_RUN_ATTEMPT || "",
  };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--from") options.from = value;
    else if (argument === "--to") options.to = value;
    else if (argument === "--run-attempt") options.runAttempt = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  const runAttempt = Number(options.runAttempt);
  if (!Number.isInteger(runAttempt) || runAttempt <= 0) {
    throw new Error("--run-attempt must be a positive integer.");
  }
  return { ...options, runAttempt };
}

export async function materializeSelectedEvidence({
  from,
  to,
  runAttempt,
  requiredSuites = REQUIRED_PRODUCT_FLAKY_SUITES,
} = {}) {
  const fromDir = path.resolve(productRoot, from);
  const toDir = path.resolve(productRoot, to);
  if (fromDir !== productRoot && !fromDir.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error("--from must remain inside the repository.");
  }
  if (toDir !== productRoot && !toDir.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error("--to must remain inside the repository.");
  }
  const decision = selectSourceGateEvidence(await collectEvidenceCandidates(fromDir), {
    requiredSuites,
    currentAttempt: runAttempt,
  });
  if (!decision.ok) {
    throw new Error(
      `Refusing source-gate evidence selection: ${decision.reason}`
      + `${decision.missing.length ? `; missing ${decision.missing.join(", ")}` : ""}`
      + `${decision.invalid.length ? `; invalid ${decision.invalid.join(", ")}` : ""}.`,
    );
  }
  await mkdir(toDir, { recursive: true });
  for (const item of decision.selected) {
    const destination = path.join(toDir, `${item.suite}-flaky.json`);
    if (item.sourceFile) await copyFile(item.sourceFile, destination);
    else await writeFile(destination, `${JSON.stringify(item.record, null, 2)}\n`, "utf8");
  }
  const manifest = Object.freeze({
    schemaVersion: 1,
    selectedAt: new Date().toISOString(),
    currentAttempt: runAttempt,
    sources: decision.selected.map((item) => ({
      suite: item.suite,
      attempt: item.attempt,
      reused: item.reused,
      sourceDirectory: item.sourceDirectory,
    })),
  });
  await writeFile(
    path.join(toDir, "source-gate-evidence-sources.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
  return { ...decision, manifest };
}

async function run() {
  const options = parseOptions(process.argv.slice(2));
  const result = await materializeSelectedEvidence(options);
  for (const item of result.selected) {
    console.log(
      `[source-gate-evidence] ${item.suite}: attempt ${item.attempt}`
      + `${item.reused ? " (reused earlier success)" : ""}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
