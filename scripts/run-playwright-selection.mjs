import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const productRoot = path.resolve(path.dirname(scriptPath), "..");
const playwrightCli = path.join(productRoot, "node_modules/playwright/cli.js");

function normalizeTag(value) {
  return String(value || "").replace(/^@/u, "");
}

function normalizeFile(value) {
  return String(value || "").replaceAll("\\", "/").replace(/^\.\//u, "");
}

function testKey(test) {
  return JSON.stringify([test.project, test.file, test.titlePath]);
}

export function collectPlaywrightReportTests(report, root = productRoot) {
  const tests = [];
  const rootDir = report?.config?.rootDir || root;
  const visit = (suite, parentTitles = []) => {
    const isFileRoot = Number(suite.line || 0) === 0 && suite.file && suite.title === suite.file;
    const titlePath = isFileRoot || !suite.title ? parentTitles : [...parentTitles, suite.title];
    for (const spec of suite.specs || []) {
      const file = normalizeFile(spec.file);
      const repositoryFile = normalizeFile(path.relative(root, path.resolve(rootDir, file)));
      for (const test of spec.tests || []) {
        const entry = {
          project: test.projectName || "",
          file,
          repositoryFile,
          titlePath: [...titlePath, spec.title],
          tags: [...new Set((spec.tags || []).map(normalizeTag))].sort(),
          status: test.status || "unknown",
          results: test.results || [],
        };
        entry.key = testKey(entry);
        tests.push(entry);
      }
    }
    for (const child of suite.suites || []) visit(child, titlePath);
  };
  for (const suite of report?.suites || []) visit(suite);
  return [...new Map(tests.map((test) => [test.key, test])).values()];
}

export function selectPlaywrightTests(discovered, { tags = [], files = [] } = {}) {
  const requestedTags = new Set(tags.map(normalizeTag));
  const requestedFiles = new Set(files.map(normalizeFile));
  const selected = discovered.filter((test) => (
    test.tags.some((tag) => requestedTags.has(tag))
    || requestedFiles.has(test.repositoryFile)
  ));
  const missingTags = [...requestedTags].filter(
    (tag) => !selected.some((test) => test.tags.includes(tag)),
  );
  const missingFiles = [...requestedFiles].filter(
    (file) => !selected.some((test) => test.repositoryFile === file),
  );
  return { selected, missingTags, missingFiles };
}

function manifestLine(test) {
  const project = test.project ? `[${test.project}] › ` : "";
  return `${project}${[test.file, ...test.titlePath].join(" › ")}`;
}

function disposition(test) {
  if (test.status === "expected") return "passed";
  if (test.status === "skipped") return "skipped";
  if (test.status === "flaky") return "flaky";
  return "failed";
}

export function reconcilePlaywrightTests(planned, actual) {
  const plannedByKey = new Map(planned.map((test) => [test.key, test]));
  const actualByKey = new Map(actual.map((test) => [test.key, test]));
  const notExecuted = [...plannedByKey.keys()].filter((key) => !actualByKey.has(key));
  const unexpected = [...actualByKey.keys()].filter((key) => !plannedByKey.has(key));
  const counts = { passed: 0, failed: 0, skipped: 0, flaky: 0 };
  for (const test of actual) counts[disposition(test)] += 1;
  return {
    planned: planned.length,
    executed: actual.length,
    ...counts,
    notExecuted,
    unexpected,
  };
}

function parseArguments(argv) {
  const options = { config: "", testList: "", reconciliation: "", report: "", tags: [], files: [] };
  while (argv.length > 0) {
    const argument = argv.shift();
    if (argument === "--config") options.config = argv.shift() || "";
    else if (argument === "--test-list") options.testList = argv.shift() || "";
    else if (argument === "--reconciliation") options.reconciliation = argv.shift() || "";
    else if (argument === "--report") options.report = argv.shift() || "";
    else if (argument === "--tag") options.tags.push(argv.shift() || "");
    else if (argument === "--file") options.files.push(argv.shift() || "");
    else throw new Error(`Unknown argument: ${argument}`);
  }
  for (const key of ["config", "testList", "reconciliation", "report"]) {
    if (!options[key]) throw new Error(`--${key.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)} is required.`);
  }
  if (options.tags.length === 0 && options.files.length === 0) {
    throw new Error("At least one --tag or --file selector is required.");
  }
  return options;
}

async function runCapture(args) {
  const child = spawn(process.execPath, [playwrightCli, ...args], {
    cwd: productRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdout = [];
  const stderr = [];
  child.stdout.on("data", (chunk) => stdout.push(Buffer.from(chunk)));
  child.stderr.on("data", (chunk) => stderr.push(Buffer.from(chunk)));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolve(value ?? 1));
  });
  if (code !== 0) {
    throw new Error(Buffer.concat(stderr).toString("utf8") || Buffer.concat(stdout).toString("utf8"));
  }
  return Buffer.concat(stdout).toString("utf8");
}

async function runInherited(args) {
  const child = spawn(process.execPath, [playwrightCli, ...args], {
    cwd: productRoot,
    env: process.env,
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (value) => resolve(value ?? 1));
  });
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  const discovery = JSON.parse(await runCapture([
    "test",
    "--config",
    options.config,
    "--list",
    "--reporter=json",
  ]));
  const discovered = collectPlaywrightReportTests(discovery);
  const selection = selectPlaywrightTests(discovered, options);
  if (selection.missingTags.length > 0 || selection.missingFiles.length > 0) {
    throw new Error(
      `Playwright selectors were not discovered. Missing tags: ${selection.missingTags.join(", ") || "none"}; `
      + `missing files: ${selection.missingFiles.join(", ") || "none"}.`,
    );
  }
  if (selection.selected.length === 0) throw new Error("Playwright selection is empty.");
  await mkdir(path.dirname(options.testList), { recursive: true });
  await writeFile(
    options.testList,
    `${selection.selected.map(manifestLine).sort().join("\n")}\n`,
  );
  const exitCode = await runInherited([
    "test",
    "--config",
    options.config,
    "--test-list",
    options.testList,
  ]);
  let actual = [];
  let reportError = null;
  try {
    actual = collectPlaywrightReportTests(JSON.parse(await readFile(options.report, "utf8")));
  } catch (error) {
    reportError = error instanceof Error ? error.message : String(error);
  }
  const reconciliation = reconcilePlaywrightTests(selection.selected, actual);
  const evidence = {
    schemaVersion: 1,
    config: options.config,
    selectors: { tags: options.tags, files: options.files },
    discovered: discovered.length,
    selected: selection.selected.map((test) => ({
      project: test.project,
      file: test.repositoryFile,
      titlePath: test.titlePath,
    })),
    reportError,
    ...reconciliation,
  };
  await mkdir(path.dirname(options.reconciliation), { recursive: true });
  await writeFile(options.reconciliation, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(
    `Playwright reconciliation: ${evidence.planned} planned, ${evidence.executed} executed, `
    + `${evidence.passed} passed, ${evidence.failed} failed, ${evidence.skipped} skipped, `
    + `${evidence.notExecuted.length} not executed.`,
  );
  if (reportError || reconciliation.notExecuted.length > 0 || reconciliation.unexpected.length > 0) {
    throw new Error("Playwright planned/discovered/executed reconciliation failed.");
  }
  if (exitCode !== 0) process.exitCode = exitCode;
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
