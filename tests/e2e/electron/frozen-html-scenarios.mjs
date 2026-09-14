// Thin public entry for the reviewed A/B/C real-HTML scenario family.
// Listing and plan validation are read-only. Execution only dispatches the
// existing frozen executors; it never discovers or substitutes a target.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  createFrozenScenarioLedger,
  listFrozenScenarioDefinitions,
  parseFrozenEntryArgs,
  readFrozenScenarioPlanFile,
  recordFrozenScenarioOutcome,
  summarizeFrozenScenarioLedger,
  summarizeFrozenScenarioReport,
  validateNestedFrozenScenarioPlans,
} from "./real-html/frozen-entry-contract.mjs";
import { workspaceSourceFingerprint } from "./real-html/workspace-provenance.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const electronDirectory = path.dirname(scriptPath);
const productRoot = path.resolve(electronDirectory, "../..");
const DEFAULT_RENDERER_BUILD_TIMEOUT_MS = 180_000;
const DEFAULT_SCENARIO_TIMEOUT_MS = 15 * 60_000;

function reportError(error) {
  return {
    state: "FAIL",
    code: error?.code || error?.name || "FROZEN_ENTRY_FAILED",
    message: error?.message || String(error),
  };
}

function printJson(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function terminateProcessTree(child, signal = "SIGTERM") {
  if (!child || !child.pid) return;
  if (process.platform !== "win32") {
    try { process.kill(-child.pid, signal); } catch { /* The process may already be gone. */ }
  }
  try { child.kill(signal); } catch { /* The process may already be gone. */ }
}

/** Run a bounded child process and retain enough output to diagnose the first failure. */
export function runCommand(command, args, {
  env = process.env,
  timeoutMs = DEFAULT_SCENARIO_TIMEOUT_MS,
} = {}) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let spawnError = null;
    let timedOut = false;
    let settled = false;
    let killTimer = null;
    const child = spawn(command, args, {
      cwd: productRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const timer = setTimeout(() => {
      timedOut = true;
      terminateProcessTree(child);
      killTimer = setTimeout(() => terminateProcessTree(child, "SIGKILL"), 1_000);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (stdout) process.stdout.write(stdout);
      if (stderr) process.stderr.write(stderr);
      resolve({
        exitCode: Number.isInteger(status) ? status : null,
        signal: signal || null,
        timedOut,
        spawnError,
        stdout,
        stderr,
      });
    };
    child.once("error", (error) => {
      spawnError = { code: error.code || "SPAWN_ERROR", message: error.message };
      if (!child.pid) finish(null, null);
    });
    child.once("close", finish);
  });
}

export async function ensureRendererBuilt({ run = runCommand } = {}) {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath
    ? process.execPath
    : process.platform === "win32" ? "npm.cmd" : "npm";
  const args = npmExecPath
    ? [npmExecPath, "run", "desktop:renderer"]
    : ["run", "desktop:renderer"];
  const result = await run(command, args, {
    env: process.env,
    timeoutMs: DEFAULT_RENDERER_BUILD_TIMEOUT_MS,
  });
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    throw Object.assign(new Error("The desktop renderer build failed before frozen execution."), {
      code: "FROZEN_ENTRY_RENDERER_BUILD_FAILED",
      details: result,
    });
  }
  return result;
}

function planSummary(plan) {
  return {
    schemaVersion: plan.schemaVersion,
    kind: plan.kind,
    reviewStatus: plan.reviewStatus,
    digest: plan.digest,
    version: plan.version,
    scenarios: plan.scenarios.map((scenario, index) => ({
      order: index + 1,
      id: scenario.id,
      label: scenario.label || plan.definitions[index].label,
      purpose: scenario.purpose,
      runner: scenario.runner,
      scope: scenario.scope,
      manifestFile: path.basename(scenario.manifestPath),
      manifestSha256: scenario.manifestSha256,
      requiredFacts: plan.definitions[index].requiredFacts,
    })),
  };
}

function scenarioChild(scenario) {
  const moduleName = scenario.runner === "frozen-html-operation"
    ? "frozen-html-operation.mjs"
    : null;
  if (!moduleName) throw Object.assign(new Error(`Unsupported runner ${scenario.runner}.`), {
    code: "FROZEN_ENTRY_SCENARIO_RUNNER_INVALID",
  });
  return path.join(electronDirectory, moduleName);
}

function childEnvironment(scenario, { reportPath, reportDirectory, nestedPlan } = {}) {
  const env = { ...process.env, STEMMIO_FROZEN_SCENARIO_ID: scenario.id };
  if (!env.STEMMIO_E2E_WINDOW_MODE && env.STEMMIO_E2E_FOREGROUND !== "1") {
    // Real-HTML local runs should be inspectable without activating Stemmio.
    env.STEMMIO_E2E_WINDOW_MODE = "visible-background";
  }
  if (scenario.runner === "frozen-html-operation") {
    env.STEMMIO_FROZEN_MANIFEST = scenario.manifestPath;
    env.STEMMIO_FROZEN_MANIFEST_SHA256 = scenario.manifestSha256;
    env.STEMMIO_FROZEN_REPORT_PATH = reportPath;
    env.STEMMIO_FROZEN_REPORT_DIRECTORY = reportDirectory;
    env.STEMMIO_FROZEN_SCENARIO_SCOPE = scenario.scope;
    env.STEMMIO_FROZEN_EXPECTED_OPERATIONS = JSON.stringify(
      nestedPlan?.targets?.[0]?.operations || [],
    );
    env.STEMMIO_FROZEN_REQUIRED_REBUILD_OPERATION = nestedPlan?.targets?.[0]
      ?.projectionByOperation?.["move-copy"] || "";
  }
  return env;
}

function childProcessSummary(child) {
  return {
    exitCode: child?.exitCode ?? null,
    signal: child?.signal || null,
    timedOut: child?.timedOut === true,
    spawnError: child?.spawnError || null,
  };
}

function nestedPlanSummary(nestedPlan = {}) {
  return {
    scope: nestedPlan.scope || null,
    operation: nestedPlan.operation || null,
    initialRuntime: nestedPlan.initialRuntime || null,
    reopen: nestedPlan.reopen === true,
    cycles: Number.isSafeInteger(nestedPlan.cycles) ? nestedPlan.cycles : null,
    operations: Array.isArray(nestedPlan.targets?.[0]?.operations)
      ? nestedPlan.targets[0].operations
      : [],
    expectedRebuild: nestedPlan.targets?.[0]?.projectionByOperation?.["move-copy"] || null,
    rebuildPath: nestedPlan.targets?.[0]?.rebuildPath || null,
  };
}

function readChildReport(reportPath) {
  if (!existsSync(reportPath)) return { report: null, error: { code: "FROZEN_ENTRY_CHILD_REPORT_MISSING" } };
  try {
    return { report: JSON.parse(readFileSync(reportPath, "utf8")), error: null };
  } catch (error) {
    return { report: null, error: reportError(Object.assign(error, { code: "FROZEN_ENTRY_CHILD_REPORT_JSON_INVALID" })) };
  }
}

export async function executePlan(plan, currentVersion, nestedPlans = [], {
  build = ensureRendererBuilt,
  run = runCommand,
  scenarioTimeoutMs = DEFAULT_SCENARIO_TIMEOUT_MS,
  print = true,
} = {}) {
  const output = mkdtempSync(path.join(tmpdir(), "stemmio-frozen-scenarios-"));
  const ledgerStart = createFrozenScenarioLedger(plan);
  const report = {
    schemaVersion: 1,
    kind: "stemmio-frozen-scenario-run",
    source: currentVersion,
    plan: planSummary(plan),
    reportDirectory: output,
    ledger: ledgerStart,
    scenarioReports: [],
    state: "NOT_EXECUTED",
  };
  const writeReport = () => writeFileSync(
    path.join(output, "scenario-results.json"),
    `${JSON.stringify({ ...report, summary: summarizeFrozenScenarioLedger(report.ledger) }, null, 2)}\n`,
  );
  writeReport();

  try {
    await build();
  } catch (error) {
    for (const [index, scenario] of plan.scenarios.entries()) {
      const scenarioDirectory = path.join(output, scenario.id);
      mkdirSync(scenarioDirectory, { recursive: true });
      const reportPath = path.join(scenarioDirectory, "result.json");
      const failure = reportError(error);
      const scenarioReport = {
        order: index + 1,
        id: scenario.id,
        scope: scenario.scope,
        manifestSha256: scenario.manifestSha256,
        nestedPlan: nestedPlanSummary(nestedPlans[index]),
        reportPath,
        process: null,
        evidence: null,
        firstFailure: failure,
      };
      report.scenarioReports.push(scenarioReport);
      report.ledger = recordFrozenScenarioOutcome(report.ledger, scenario.id, {
        state: "NOT_EXECUTED",
        reason: "ENVIRONMENT_BLOCKED",
        details: scenarioReport,
      });
    }
    report.state = "NOT_EXECUTED";
    report.firstFailure = reportError(error);
    report.summary = summarizeFrozenScenarioLedger(report.ledger);
    writeReport();
    if (print) printJson(report);
    return { exitCode: 1, reportDirectory: output, report };
  }

  for (const [index, scenario] of plan.scenarios.entries()) {
    const scenarioDirectory = path.join(output, scenario.id);
    mkdirSync(scenarioDirectory, { recursive: true });
    const reportPath = path.join(scenarioDirectory, "result.json");
    const nestedPlan = nestedPlans[index] || {};
    let child = null;
    let childReport = null;
    let childReportReadError = null;
    let evidence = null;
    let protocolError = null;
    try {
      child = await run(process.execPath, [scenarioChild(scenario)], {
        env: childEnvironment(scenario, { reportPath, reportDirectory: scenarioDirectory, nestedPlan }),
        timeoutMs: scenarioTimeoutMs,
      });
    } catch (error) {
      child = { exitCode: null, signal: null, timedOut: false,
        spawnError: reportError(Object.assign(error, { code: "FROZEN_ENTRY_CHILD_SPAWN_FAILED" })) };
    }
    ({ report: childReport, error: childReportReadError } = readChildReport(reportPath));
    if (childReport && !childReportReadError) {
      try {
        if (childReport.reportPath !== reportPath || childReport.reportDirectory !== scenarioDirectory) {
          throw Object.assign(new Error("Child report path is not bound to this scenario invocation."), {
            code: "FROZEN_ENTRY_CHILD_REPORT_PATH_INVALID",
            details: {
              expectedPath: reportPath,
              actualPath: childReport.reportPath,
              expectedDirectory: scenarioDirectory,
              actualDirectory: childReport.reportDirectory,
            },
          });
        }
        evidence = summarizeFrozenScenarioReport(childReport, scenario, nestedPlan, currentVersion);
      } catch (error) {
        protocolError = reportError(error);
      }
    }
    let state = "FAIL";
    let reason = "CHILD_REPORT_PROTOCOL_FAILED";
    if (child?.spawnError) {
      state = "NOT_EXECUTED";
      reason = "CHILD_SPAWN_FAILED";
    } else if (child?.timedOut) {
      reason = "CHILD_TIMEOUT";
    } else if (childReportReadError) {
      reason = childReportReadError.code === "FROZEN_ENTRY_CHILD_REPORT_MISSING"
        ? "CHILD_REPORT_MISSING" : "CHILD_REPORT_INVALID";
    } else if (protocolError) {
      reason = "CHILD_REPORT_PROTOCOL_FAILED";
    } else if (childReport?.state === "NOT_EXECUTED") {
      state = "NOT_EXECUTED";
      reason = "CHILD_REPORT_NOT_EXECUTED";
    } else if (childReport?.state === "PASS" && child?.exitCode === 0) {
      state = "PASS";
      reason = "SCENARIO_COMPLETED";
    } else if (childReport?.state === "FAIL") {
      reason = "CHILD_REPORT_FAILED";
    } else if (child?.exitCode !== 0) {
      reason = `CHILD_EXIT_${child?.exitCode ?? "UNKNOWN"}`;
    }
    const scenarioReport = {
      order: index + 1,
      id: scenario.id,
      scope: scenario.scope,
      manifestSha256: scenario.manifestSha256,
      nestedPlan: nestedPlanSummary(nestedPlan),
      reportPath,
      process: childProcessSummary(child),
      evidence,
      firstFailure: child?.timedOut
        ? { code: "CHILD_TIMEOUT" }
        : child?.spawnError
          ? child.spawnError
          : childReport?.firstFailure || protocolError || childReportReadError || null,
    };
    report.scenarioReports.push(scenarioReport);
    report.ledger = recordFrozenScenarioOutcome(report.ledger, scenario.id, {
      state,
      reason,
      details: scenarioReport,
    });
    // A scenario failure is retained, but never causes an implicit retry or
    // prevents the independent later scenario from producing its own facts.
    writeReport();
  }
  const summary = summarizeFrozenScenarioLedger(report.ledger);
  report.summary = summary;
  report.state = summary.FAIL > 0 || summary.NOT_EXECUTED > 0 ? "FAIL" : "PASS";
  writeReport();
  if (print) printJson(report);
  return { exitCode: report.state === "PASS" ? 0 : 1, reportDirectory: output, report };
}

async function main(argv) {
  const options = parseFrozenEntryArgs(argv);
  if (options.mode === "list") {
    printJson({
      mode: "list",
      execution: "node tests/e2e/electron/frozen-html-scenarios.mjs",
      scenarios: listFrozenScenarioDefinitions(),
      note: "Listing does not start Electron and does not discover or substitute targets.",
    });
    return 0;
  }
  if (options.mode === "preflight") {
    if (!process.env.STEMMIO_REAL_HTML_DIR) {
      throw Object.assign(new Error("Set STEMMIO_REAL_HTML_DIR for the read-only capability preflight."), {
        code: "FROZEN_ENTRY_CORPUS_REQUIRED",
      });
    }
    await ensureRendererBuilt();
    const result = await runCommand(process.execPath, [path.join(electronDirectory, "local-html-corpus.mjs")], {
      env: { ...process.env, STEMMIO_REAL_HTML_MODE: "capability-preflight-only" },
    });
    return result.exitCode ?? 1;
  }

  const currentVersion = workspaceSourceFingerprint(productRoot);
  const plan = readFrozenScenarioPlanFile(options.manifestPath, options.manifestSha256, currentVersion);
  const nestedPlans = await validateNestedFrozenScenarioPlans(plan, currentVersion);
  if (options.mode === "plan") {
    printJson({ mode: "plan", plan: planSummary(plan), note: "Plan validation is read-only; Electron was not started." });
    return 0;
  }
  return (await executePlan(plan, currentVersion, nestedPlans)).exitCode;
}

if (pathToFileURL(process.argv[1] || "").href === import.meta.url) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (error) {
    printJson(reportError(error));
    process.exitCode = 1;
  }
}
