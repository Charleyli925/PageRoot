// Thin public entry for the reviewed A/B/C real-HTML scenario family.
// Listing and plan validation are read-only. Execution only dispatches the
// existing frozen executors; it never discovers or substitutes a target.
import { mkdtempSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import {
  createFrozenScenarioLedger,
  listFrozenScenarioDefinitions,
  parseFrozenEntryArgs,
  readFrozenScenarioPlanFile,
  recordFrozenScenarioOutcome,
  summarizeFrozenScenarioLedger,
  validateNestedFrozenScenarioPlans,
} from "./real-html/frozen-entry-contract.mjs";
import { workspaceSourceFingerprint } from "./real-html/workspace-provenance.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const electronDirectory = path.dirname(scriptPath);
const productRoot = path.resolve(electronDirectory, "../..");

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

function runCommand(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: productRoot,
    env,
    stdio: "inherit",
  });
  if (result.error) throw Object.assign(new Error(result.error.message), {
    code: "FROZEN_ENTRY_CHILD_SPAWN_FAILED",
    cause: result.error,
  });
  return {
    exitCode: Number.isInteger(result.status) ? result.status : 1,
    signal: result.signal || null,
  };
}

function ensureRendererBuilt() {
  const npmCommand = process.env.npm_execpath || "npm";
  const result = runCommand(process.execPath, [npmCommand, "run", "desktop:renderer"], process.env);
  if (result.exitCode !== 0) {
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
    : scenario.runner === "frozen-html-extended-stress"
      ? "frozen-html-extended-stress.mjs"
      : null;
  if (!moduleName) throw Object.assign(new Error(`Unsupported runner ${scenario.runner}.`), {
    code: "FROZEN_ENTRY_SCENARIO_RUNNER_INVALID",
  });
  return path.join(electronDirectory, moduleName);
}

function childEnvironment(scenario) {
  const env = { ...process.env, STEMMIO_FROZEN_SCENARIO_ID: scenario.id };
  if (scenario.runner === "frozen-html-operation") {
    env.STEMMIO_FROZEN_MANIFEST = scenario.manifestPath;
    env.STEMMIO_FROZEN_MANIFEST_SHA256 = scenario.manifestSha256;
  } else {
    env.STEMMIO_EXTENDED_MANIFEST = scenario.manifestPath;
    env.STEMMIO_EXTENDED_MANIFEST_SHA256 = scenario.manifestSha256;
    env.STEMMIO_EXTENDED_FILE_ID = scenario.fileId;
  }
  return env;
}

async function executePlan(plan, currentVersion) {
  const output = mkdtempSync(path.join(tmpdir(), "stemmio-frozen-scenarios-"));
  const ledgerStart = createFrozenScenarioLedger(plan);
  const report = {
    schemaVersion: 1,
    kind: "stemmio-frozen-scenario-run",
    source: currentVersion,
    plan: planSummary(plan),
    reportDirectory: output,
    ledger: ledgerStart,
    state: "NOT_EXECUTED",
  };
  const writeReport = () => writeFileSync(
    path.join(output, "scenario-results.json"),
    `${JSON.stringify({ ...report, summary: summarizeFrozenScenarioLedger(report.ledger) }, null, 2)}\n`,
  );
  writeReport();

  try {
    ensureRendererBuilt();
  } catch (error) {
    for (const scenario of plan.scenarios) {
      report.ledger = recordFrozenScenarioOutcome(report.ledger, scenario.id, {
        state: "NOT_EXECUTED",
        reason: "ENVIRONMENT_BLOCKED",
        details: reportError(error),
      });
    }
    report.state = "NOT_EXECUTED";
    report.firstFailure = reportError(error);
    writeReport();
    printJson({ ...report, summary: summarizeFrozenScenarioLedger(report.ledger) });
    return 1;
  }

  for (const scenario of plan.scenarios) {
    let child;
    try {
      child = runCommand(process.execPath, [scenarioChild(scenario)], childEnvironment(scenario));
    } catch (error) {
      report.ledger = recordFrozenScenarioOutcome(report.ledger, scenario.id, {
        state: "FAIL",
        reason: "CHILD_SPAWN_FAILED",
        details: reportError(error),
      });
      continue;
    }
    report.ledger = recordFrozenScenarioOutcome(report.ledger, scenario.id, {
      state: child.exitCode === 0 ? "PASS" : "FAIL",
      reason: child.exitCode === 0 ? "SCENARIO_COMPLETED" : `CHILD_EXIT_${child.exitCode}`,
      details: child,
    });
    // A scenario failure is retained, but never causes an implicit retry or
    // prevents the independent later scenario from producing its own facts.
    writeReport();
  }
  const summary = summarizeFrozenScenarioLedger(report.ledger);
  report.summary = summary;
  report.state = summary.FAIL > 0 || summary.NOT_EXECUTED > 0 ? "FAIL" : "PASS";
  writeReport();
  printJson(report);
  return report.state === "PASS" ? 0 : 1;
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
    ensureRendererBuilt();
    return runCommand(process.execPath, [path.join(electronDirectory, "local-html-corpus.mjs")], {
      ...process.env,
      STEMMIO_REAL_HTML_MODE: "capability-preflight-only",
    }).exitCode;
  }

  const currentVersion = workspaceSourceFingerprint(productRoot);
  const plan = readFrozenScenarioPlanFile(options.manifestPath, options.manifestSha256, currentVersion);
  await validateNestedFrozenScenarioPlans(plan, currentVersion);
  if (options.mode === "plan") {
    printJson({ mode: "plan", plan: planSummary(plan), note: "Plan validation is read-only; Electron was not started." });
    return 0;
  }
  return executePlan(plan, currentVersion);
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  printJson(reportError(error));
  process.exitCode = 1;
}
