#!/usr/bin/env node

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");

function parseOptions(argv) {
  const options = { report: "", suite: "" };
  while (argv.length > 0) {
    const argument = argv.shift();
    const value = argv.shift();
    if (!value) throw new Error(`${argument} requires a value.`);
    if (argument === "--report") options.report = value;
    else if (argument === "--suite") options.suite = value;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!options.report || !/^[\w./-]+$/u.test(options.report)) {
    throw new Error("--report must be a Playwright JSON reporter path.");
  }
  if (!options.suite || !/^[a-z0-9-]+$/u.test(options.suite)) {
    throw new Error("--suite must be kebab-case.");
  }
  return options;
}

export function summarizeFlakyRuns(report) {
  const summary = {
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    retries: 0,
    skipped: 0,
  };
  const supportedStatuses = new Set(["expected", "unexpected", "flaky", "skipped"]);
  const walk = (suite) => {
    for (const spec of suite?.specs || []) {
      for (const test of spec?.tests || []) {
        const status = String(test?.status || "");
        if (!supportedStatuses.has(status)) {
          throw new Error(
            `Playwright JSON reporter test has an unsupported status `
            + `${JSON.stringify(status)}; refusing to fabricate flaky/retry evidence.`,
          );
        }
        summary.total += 1;
        if (status === "expected") summary.passed += 1;
        else if (status === "unexpected") summary.failed += 1;
        else if (status === "flaky") summary.flaky += 1;
        else if (status === "skipped") summary.skipped += 1;
        const results = Array.isArray(test?.results) ? test.results : [];
        let testRetries = 0;
        for (const result of results) {
          const retry = Number(result?.retry);
          if (!Number.isInteger(retry) || retry < 0) {
            throw new Error(
              `Playwright JSON reporter result has an invalid retry count `
              + `${JSON.stringify(result?.retry)}; refusing to fabricate flaky/retry evidence.`,
            );
          }
          if (retry > 0) testRetries += 1;
        }
        summary.retries += testRetries;
      }
    }
    for (const child of suite?.suites || []) walk(child);
  };
  for (const suite of report?.suites || []) walk(suite);
  if (
    summary.total
    !== summary.passed + summary.failed + summary.flaky + summary.skipped
  ) {
    throw new Error(
      "Playwright flaky summary counts do not reconcile; refusing to write evidence.",
    );
  }
  return Object.freeze(summary);
}

export async function writeFlakyEvidence(summary, destination, metadata = {}) {
  const resolved = path.resolve(productRoot, destination);
  if (resolved !== productRoot && !resolved.startsWith(`${productRoot}${path.sep}`)) {
    throw new Error("Evidence destination must remain inside the repository.");
  }
  await mkdir(path.dirname(resolved), { recursive: true });
  const record = Object.freeze({
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    ...metadata,
    ...summary,
  });
  await writeFile(resolved, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return resolved;
}

async function run() {
  const options = parseOptions(process.argv.slice(2));
  const reportPath = path.resolve(productRoot, options.report);
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  const summary = summarizeFlakyRuns(report);
  if (summary.total === 0) {
    throw new Error(`Playwright report ${options.report} contains no tests.`);
  }
  const destination = await writeFlakyEvidence(
    summary,
    `output/ci-evidence/${options.suite}-flaky.json`,
    { suite: options.suite, report: options.report },
  );
  console.log(
    `[playwright-flaky-summary] ${options.suite}: `
    + `${summary.flaky} flaky, ${summary.retries} retry attempts, `
    + `${summary.failed} failed, ${summary.skipped} skipped of ${summary.total} tests.`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    await appendFile(process.env.GITHUB_STEP_SUMMARY, [
      "### Playwright retry evidence",
      "",
      `- Suite: \`${options.suite}\``,
      `- Tests: ${summary.total} total (${summary.passed} passed, ${summary.failed} failed, ${summary.flaky} flaky, ${summary.skipped} skipped)`,
      `- Retry attempts: ${summary.retries}`,
      `- Evidence: \`${path.relative(productRoot, destination)}\``,
      "",
    ].join("\n"), "utf8");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
