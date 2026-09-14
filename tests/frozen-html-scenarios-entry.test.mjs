import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { FROZEN_SCENARIO_DEFINITIONS } from "./e2e/electron/real-html/frozen-entry-contract.mjs";
import { workspaceSourceFingerprint } from "./e2e/electron/real-html/workspace-provenance.mjs";
import { digestFrozenEntry } from "./e2e/electron/real-html/frozen-entry-contract.mjs";
import { executePlan, ensureRendererBuilt, runCommand } from "./e2e/electron/frozen-html-scenarios.mjs";

const root = path.resolve(import.meta.dirname, "..");
const entry = path.join(root, "tests/e2e/electron/frozen-html-scenarios.mjs");

function run(args, env = process.env) {
  return spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

test("frozen scenario list is available without building or starting Electron", () => {
  const result = run(["--list"]);
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.deepEqual(output.scenarios.map(({ id }) => id), ["A", "B", "C"]);
  assert.match(output.note, /does not start Electron/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /desktop:renderer/u);
});

test("preflight requires an explicit corpus and does not fall back to discovery", () => {
  const env = { ...process.env };
  delete env.STEMMIO_REAL_HTML_DIR;
  const result = run(["--preflight"], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FROZEN_ENTRY_CORPUS_REQUIRED/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /AUTOMATIC_DISCOVERY_EXECUTION/u);
});

test("plan validation fails before renderer build when a nested manifest is missing", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stemmio-frozen-entry-test-"));
  const current = workspaceSourceFingerprint(root);
  const plan = {
    schemaVersion: 1,
    kind: "stemmio-frozen-scenario-plan",
    reviewStatus: "FROZEN",
    reviewedBy: "root",
    version: current,
    scenarios: FROZEN_SCENARIO_DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      purpose: definition.purpose,
      runner: definition.runner,
      scope: definition.allowedScopes[0],
      manifestPath: path.join(directory, `${definition.id}.json`),
      manifestSha256: "a".repeat(64),
    })),
  };
  plan.scenarios[1].scope = "core-three-cycle";
  const file = path.join(directory, "plan.json");
  const bytes = Buffer.from(JSON.stringify(plan));
  await writeFile(file, bytes);
  const result = run([
    "--plan", "--manifest", file, "--manifest-sha256", digestFrozenEntry(bytes),
  ]);
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /FROZEN_ENTRY_SCENARIO_MANIFEST_READ_FAILED/u);
  assert.doesNotMatch(`${result.stdout}${result.stderr}`, /desktop:renderer/u);
});

function dispatcherFixture(version) {
  const scenarios = FROZEN_SCENARIO_DEFINITIONS.map((definition) => ({
    id: definition.id,
    label: definition.label,
    purpose: definition.purpose,
    runner: definition.runner,
    scope: definition.allowedScopes[0],
    manifestPath: `/tmp/frozen-${definition.id}.json`,
    manifestSha256: `${definition.id.toLowerCase()}${"a".repeat(63)}`,
  }));
  return {
    plan: {
      schemaVersion: 1,
      kind: "stemmio-frozen-scenario-plan",
      reviewStatus: "FROZEN",
      reviewedBy: "root",
      digest: "d".repeat(64),
      version,
      scenarios,
      definitions: FROZEN_SCENARIO_DEFINITIONS,
    },
    nestedPlans: [
      { reopen: true, targets: [{ operations: ["activate"] }] },
      { reopen: true, cycles: 3, targets: [{ operations: ["input"] }] },
      {
        scope: "core-structure-closed-loop", operation: "structure", initialRuntime: "runtime", reopen: true,
        targets: [{ operations: ["copy", "move-copy", "input-restored", "save-restored"],
          projectionByOperation: { "move-copy": "candidate" }, rebuildPath: "runtime-candidate" }],
      },
    ],
  };
}

function passChildReport(env, version, nestedPlan, { incomplete = false } = {}) {
  const rows = (operations) => operations.map((operation) => ({ operation, state: "PASS", reason: "EXPECTED" }));
  const report = {
    schemaVersion: 1,
    kind: "stemmio-frozen-html-operation-result",
    scenarioId: env.STEMMIO_FROZEN_SCENARIO_ID,
    scope: env.STEMMIO_FROZEN_SCENARIO_SCOPE,
    manifestDigest: env.STEMMIO_FROZEN_MANIFEST_SHA256,
    reportPath: env.STEMMIO_FROZEN_REPORT_PATH,
    reportDirectory: path.dirname(env.STEMMIO_FROZEN_REPORT_PATH),
    version,
    state: "PASS",
    cleanup: "PASS",
    calls: [{ kind: "fixture" }],
    source: { sha256: "a".repeat(64) },
    display: { working: "sha256:a", displayed: "sha256:a" },
    finalSource: { sha256: "a".repeat(64) },
    lifecycle: { records: [] },
    reopen: { state: "PASS", reason: "EXACT_REOPEN" },
  };
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "A") report.operation = {
    operation: "select", state: incomplete ? "NOT_EXECUTED" : "PASS", reason: "EXPECTED",
  };
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") report.mixed = {
    cycles: Array.from({ length: nestedPlan.cycles }, () => ({
      control: rows(["select-text", "verify-cycle"]), text: rows(["input"]),
      structure: rows(["copy"]), continuation: rows(["input"]),
    })),
  };
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "C") report.structureOperations = rows(nestedPlan.targets[0].operations)
    .map((row) => row.operation === "move-copy"
      ? { ...row, actual: { planned: "candidate", outcome: "candidate", runtime: { runtime: "runtime-candidate" } } }
      : row);
  return report;
}

test("valid dispatch records A→B→C child reports and evidence paths", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH,
        JSON.stringify(passChildReport(env, version, nestedPlans[env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2])));
      return { exitCode: 0, signal: null, timedOut: false, spawnError: null };
    },
    print: false,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.report.ledger.map(({ id, state }) => [id, state]), [["A", "PASS"], ["B", "PASS"], ["C", "PASS"]]);
  assert.equal(result.report.scenarioReports.length, 3);
  assert.ok(result.report.scenarioReports.every(({ reportPath, evidence }) => reportPath.endsWith("/result.json") && evidence));
});

test("a failed or timed-out B retains first failure and does not prevent C", async () => {
  for (const mode of ["failure", "timeout"]) {
    const version = workspaceSourceFingerprint(root);
    const { plan, nestedPlans } = dispatcherFixture(version);
    const result = await executePlan(plan, version, nestedPlans, {
      build: async () => ({ exitCode: 0 }),
      run: async (_command, _args, { env }) => {
        if (env.STEMMIO_FROZEN_SCENARIO_ID === "B" && mode === "timeout") {
          return { exitCode: null, signal: "SIGTERM", timedOut: true, spawnError: null };
        }
        if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") {
          await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify({
            ...passChildReport(env, version, nestedPlans[1]), state: "FAIL",
            firstFailure: { code: "FIXTURE_FIRST_FAILURE", step: "input" }, cleanup: "PASS",
          }));
          return { exitCode: 1, signal: null, timedOut: false, spawnError: null };
        }
        await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(passChildReport(
          env, version, nestedPlans[env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : 2],
        )));
        return { exitCode: 0, signal: null, timedOut: false, spawnError: null };
      },
      print: false,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.report.ledger[1].state, "FAIL");
    assert.equal(result.report.ledger[2].state, "PASS");
    assert.equal(result.report.scenarioReports[1].firstFailure?.code, mode === "timeout" ? "CHILD_TIMEOUT" : "FIXTURE_FIRST_FAILURE");
  }
});

test("zero exit with a missing or incomplete report cannot become PASS", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") return { exitCode: 0, timedOut: false, signal: null, spawnError: null };
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(passChildReport(
        env, version, nestedPlans[env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : 2],
        { incomplete: env.STEMMIO_FROZEN_SCENARIO_ID === "A" },
      )));
      return { exitCode: 0, timedOut: false, signal: null, spawnError: null };
    },
    print: false,
  });
  assert.equal(result.report.ledger[0].state, "FAIL");
  assert.equal(result.report.ledger[1].reason, "CHILD_REPORT_MISSING");
  assert.equal(result.report.ledger[2].state, "PASS");
});

test("a child report from another invocation cannot be associated with the current scenario", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      const report = passChildReport(
        env,
        version,
        nestedPlans[env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2],
      );
      if (env.STEMMIO_FROZEN_SCENARIO_ID === "A") {
        report.reportPath = "/tmp/stale-result.json";
        report.reportDirectory = "/tmp";
      }
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(report));
      return { exitCode: 0, timedOut: false, signal: null, spawnError: null };
    },
    print: false,
  });
  assert.equal(result.report.ledger[0].state, "FAIL");
  assert.equal(result.report.ledger[0].reason, "CHILD_REPORT_PROTOCOL_FAILED");
  assert.equal(result.report.ledger[1].state, "PASS");
  assert.equal(result.report.ledger[2].state, "PASS");
});

test("renderer build failure marks every scenario NOT_EXECUTED", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => { throw Object.assign(new Error("build unavailable"), { code: "FIXTURE_BUILD_FAILED" }); },
    run: async () => { throw new Error("child must not start"); },
    print: false,
  });
  assert.deepEqual(result.report.ledger.map(({ state, reason }) => [state, reason]), [
    ["NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
    ["NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
    ["NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
  ]);
  assert.equal(result.report.scenarioReports.length, 3);
  assert.ok(result.report.scenarioReports.every(({ evidence, process, firstFailure }) => (
    evidence === null && process === null && firstFailure?.code === "FIXTURE_BUILD_FAILED"
  )));
});

test("direct node invocation uses the npm executable when npm_execpath is absent", async () => {
  const previous = process.env.npm_execpath;
  delete process.env.npm_execpath;
  let invocation;
  try {
    await ensureRendererBuilt({ run: async (command, args) => {
      invocation = { command, args };
      return { exitCode: 0, timedOut: false, spawnError: null };
    } });
  } finally {
    if (previous === undefined) delete process.env.npm_execpath;
    else process.env.npm_execpath = previous;
  }
  assert.equal(invocation.command, process.platform === "win32" ? "npm.cmd" : "npm");
  assert.deepEqual(invocation.args, ["run", "desktop:renderer"]);
});

test("bounded child execution terminates a hung process without waiting indefinitely", async () => {
  const started = Date.now();
  const result = await runCommand(process.execPath, ["-e", "setTimeout(() => {}, 10_000)"], {
    timeoutMs: 50,
  });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.exitCode, 0);
  assert.ok(Date.now() - started < 2_000);
});

test("child spawn errors are reported without waiting for the scenario timeout", async () => {
  const result = await runCommand("/definitely/missing/stemmio-child", [], { timeoutMs: 100 });
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, null);
  assert.equal(result.spawnError?.code, "ENOENT");
});
