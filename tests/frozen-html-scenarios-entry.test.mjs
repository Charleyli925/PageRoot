import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";

import { materializeSourceElementIdentity } from "../bridge/project-file-repository/working-copy.mjs";
import { FROZEN_SCENARIO_DEFINITIONS } from "./e2e/electron/real-html/frozen-entry-contract.mjs";
import { workspaceSourceFingerprint } from "./e2e/electron/real-html/workspace-provenance.mjs";
import { digestFrozenEntry } from "./e2e/electron/real-html/frozen-entry-contract.mjs";
import { FROZEN_FORMAT_OPERATIONS, readFrozenSelection } from "./e2e/electron/real-html/frozen-selection.mjs";
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
      {
        scope: "core-text-format", operation: "native-text", initialRuntime: "static", reopen: true,
        targets: [{ selectedId: "a-target", operations: ["activate", "input", "backspace", "save", "undo", "redo"], historyResume: "in-place" }],
      },
      {
        scope: "core-three-cycle", operation: "mixed", initialRuntime: "static", reopen: true, cycles: 3,
        targets: [
          { selectedId: "b-text", operations: ["activate", "input", "backspace", "save", "undo", "redo"], historyResume: "in-place" },
          { selectedId: "b-structure", operations: ["copy", "select-copy", "activate-copy", "input-copy", "save-copy"] },
        ],
      },
      {
        scope: "core-structure-closed-loop", operation: "structure", initialRuntime: "runtime", reopen: true,
        targets: [{ selectedId: "c-target", operations: ["copy", "move-copy", "input-restored", "save-restored"],
          projectionByOperation: { "move-copy": "candidate" }, rebuildPath: "runtime-candidate" }],
      },
    ],
  };
}

function passChildReport(env, version, nestedPlan, { incomplete = false } = {}) {
  const rows = (operations, targetId) => operations.map((operation) => ({
    operation, targetId, state: "PASS", reason: "EXPECTED", durationMs: 1,
  }));
  const lifecycle = { candidateRecords: [], lifecycleRecords: [], records: [] };
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
    source: { hashMatches: true, sizeMatches: true },
    display: {
      working: "sha256:a", displayed: "sha256:a",
      conditions: { workingMatches: true, displayedMatches: true },
    },
    finalSource: { hashMatches: true, sizeMatches: true },
    lifecycle,
    reopen: {
      state: "PASS", reason: "EXACT_REOPEN", durationMs: 1,
      source: { hashMatches: true, sizeMatches: true },
      display: { workingMatches: true, displayedMatches: true },
    },
  };
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "A") {
    report.operation = {
      operation: "select", targetId: nestedPlan.targets[0].selectedId,
      state: incomplete ? "NOT_EXECUTED" : "PASS", reason: "EXPECTED", durationMs: 1,
    };
    report.textOperations = rows(nestedPlan.targets[0].operations, nestedPlan.targets[0].selectedId);
    if (incomplete) report.textOperations = report.textOperations.slice(0, 1);
  }
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") report.mixed = {
    cycles: Array.from({ length: nestedPlan.cycles }, () => ({
      cycle: undefined,
      control: ["select-text", "create-comment", "select-structure", "resume-text", "verify-cycle"].map((operation) => ({
        operation,
        targetId: operation === "select-structure" ? nestedPlan.targets[1].selectedId : nestedPlan.targets[0].selectedId,
        state: "PASS",
        reason: "EXPECTED",
        durationMs: 1,
      })),
      text: rows(nestedPlan.targets[0].operations, nestedPlan.targets[0].selectedId),
      structure: rows(nestedPlan.targets[1].operations, nestedPlan.targets[1].selectedId),
      continuation: rows(["activate", "input", "backspace", "save", "undo", "redo"], nestedPlan.targets[0].selectedId),
    })),
    copyIds: ["b-copy-1", "b-copy-2", "b-copy-3"],
    checkpoint: rows(["reopen-cumulative", "delete-comment-1", "delete-comment-2", "delete-comment-3"], nestedPlan.targets[0].selectedId),
  };
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") {
    report.mixed.cycles = report.mixed.cycles.map((cycle, index) => ({
      ...cycle,
      cycle: index + 1,
      structure: cycle.structure.map((row, rowIndex) => ({
        ...row,
        targetId: rowIndex === 0 ? nestedPlan.targets[1].selectedId : report.mixed.copyIds[index],
      })),
    }));
  }
  if (env.STEMMIO_FROZEN_SCENARIO_ID === "C") {
    report.structure = { copyId: "c-copy" };
    report.operation = { operation: "select", targetId: "c-target", state: "PASS", reason: "EXPECTED", durationMs: 1 };
    const runtimeConditions = {
      knownExpectedPath: true, pathMatches: true, sourceMatches: true, documentKnown: true,
      generationKnown: true, documentMatches: true, generationMatches: true,
      requestMatches: true, candidateMatches: true, candidateReady: true,
      generationObserved: true, activeMatches: true, runtimeReady: true, noRejectedCandidate: true,
    };
    report.structureOperations = rows(nestedPlan.targets[0].operations, nestedPlan.targets[0].selectedId)
    .map((row) => row.operation === "move-copy"
      ? { ...row, targetId: "c-copy", actual: {
        planned: "candidate", outcome: "candidate", runtime: {
          path: "runtime-candidate", conditions: runtimeConditions,
          terminalConditions: { phaseSettled: true, runtimeReady: true },
          candidateId: "c-candidate", generation: 2,
        },
      } }
      : row)
      .map((row, rowIndex) => ({ ...row, targetId: rowIndex === 0 ? "c-target" : "c-copy" }));
    report.lifecycle = {
      candidateRecords: [{ kind: "candidate-created", candidateId: "c-candidate" }],
      lifecycleRecords: [
        { kind: "rebuild-request" }, { kind: "candidate-terminal" }, { kind: "generation" },
        { kind: "active-identity" }, { kind: "runtime-terminal" },
      ],
      records: [
        { kind: "candidate-created", candidateId: "c-candidate" },
        { kind: "rebuild-request" }, { kind: "candidate-terminal" }, { kind: "generation" },
        { kind: "active-identity" }, { kind: "runtime-terminal" },
      ],
    };
  }
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

test("B ledger rejects a missing cycle stage instead of counting cycle objects", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      const index = env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0
        : env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2;
      const report = passChildReport(env, version, nestedPlans[index]);
      if (env.STEMMIO_FROZEN_SCENARIO_ID === "B") report.mixed.cycles[1].structure.pop();
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(report));
      return { exitCode: 0, timedOut: false, signal: null, spawnError: null };
    },
    print: false,
  });
  assert.equal(result.report.ledger[0].state, "PASS");
  assert.equal(result.report.ledger[1].state, "FAIL");
  assert.equal(result.report.ledger[1].reason, "CHILD_REPORT_PROTOCOL_FAILED");
  assert.equal(result.report.ledger[2].state, "PASS");
  assert.equal(result.report.scenarioReports[1].firstFailure?.code,
    "FROZEN_ENTRY_CHILD_OPERATION_LEDGER_MISMATCH");
});

test("C ledger rejects a rebuild report with the wrong path or lifecycle proof", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      const index = env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0
        : env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2;
      const report = passChildReport(env, version, nestedPlans[index]);
      if (env.STEMMIO_FROZEN_SCENARIO_ID === "C") {
        const move = report.structureOperations.find((row) => row.operation === "move-copy");
        move.actual.runtime.path = "in-place";
        move.actual.runtime.conditions.pathMatches = false;
      }
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(report));
      return { exitCode: 0, timedOut: false, signal: null, spawnError: null };
    },
    print: false,
  });
  assert.equal(result.report.ledger[0].state, "PASS");
  assert.equal(result.report.ledger[1].state, "PASS");
  assert.equal(result.report.ledger[2].state, "FAIL");
  assert.equal(result.report.ledger[2].reason, "CHILD_REPORT_PROTOCOL_FAILED");
  assert.equal(result.report.scenarioReports[2].firstFailure?.code,
    "FROZEN_ENTRY_CHILD_REBUILD_EVIDENCE_INVALID");
});

test("public opt-in entry smoke traverses the real A child and parent report protocol", {
  skip: process.env.STEMMIO_RUN_PUBLIC_FROZEN_ENTRY !== "1",
}, async () => {
  const version = workspaceSourceFingerprint(root);
  const directory = await mkdtemp(path.join(tmpdir(), "stemmio-public-frozen-entry-"));
  const id = `sm1_${"a".repeat(12)}4${"b".repeat(3)}8${"c".repeat(15)}`;
  const template = `<!doctype html><html><head><meta charset="utf-8"><title>Public frozen entry</title></head><body><p data-stemmio-id="${id}">Public entry target</p></body></html>`;
  let allocatedIdentity = 0;
  const materialized = materializeSourceElementIdentity(template, {
    randomUUIDFactory: () => `00000000-0000-4000-8000-${String(++allocatedIdentity).padStart(12, "0")}`,
  });
  const html = Buffer.from(materialized.html, "utf8");
  const originalPath = path.join(directory, "original.html");
  const seedPath = path.join(directory, "seed.html");
  const nestedPath = path.join(directory, "A.json");
  await Promise.all([writeFile(originalPath, html), writeFile(seedPath, html)]);
  const identity = {
    path: seedPath,
    sha256: createHash("sha256").update(html).digest("hex"),
    size: html.length,
  };
  const nested = {
    schemaVersion: 1,
    scope: "core-text-format",
    reviewStatus: "FROZEN",
    reviewedBy: "root",
    fileId: "H99",
    initialRuntime: "static",
    operation: "native-text",
    original: { ...identity, path: originalPath },
    seed: identity,
    workspaceSourceSha256: version.workspaceSourceSha256,
    reopen: true,
    targets: [{
      clickId: id,
      selectedId: id,
      clickTag: "p",
      selectedTag: "p",
      mapping: "self",
      expectedCapability: "AVAILABLE",
      contractReason: "UNIQUE_REACHABLE_AUTHORED_TARGET",
      sourceProof: "REVIEWED_EXACT_SEED",
      tabId: null,
      scrollContainer: "document",
      textCapability: {
        expected: "AVAILABLE",
        basis: "SOURCE_EDITABLE_ISLAND",
        clickPoint: "first-direct-text-character",
      },
      operations: [...FROZEN_FORMAT_OPERATIONS],
      textNodePath: [0],
      initialBold: false,
      historyAdoption: "editable-island-in-place",
      historyResume: "in-place",
      historyBasis: "REVIEWED_CANONICAL_ISLAND",
      formatCapability: {
        scope: "text-range",
        expected: "AVAILABLE",
        basis: "SOURCE_SAFE_TEXT_RANGE_WRAPPER",
      },
    }],
  };
  const nestedBytes = Buffer.from(JSON.stringify(nested));
  await writeFile(nestedPath, nestedBytes);
  const nestedDigest = digestFrozenEntry(nestedBytes);
  const fixture = dispatcherFixture(version);
  const plan = {
    ...fixture.plan,
    scenarios: fixture.plan.scenarios.map((scenario, index) => index === 0
      ? { ...scenario, scope: "core-text-format", manifestPath: nestedPath, manifestSha256: nestedDigest }
      : scenario),
  };
  const nestedPlans = [readFrozenSelection(nestedBytes, nestedDigest), ...fixture.nestedPlans.slice(1)];
  const result = await executePlan(plan, version, nestedPlans, {
    build: () => ensureRendererBuilt(),
    run: async (command, args, options) => {
      if (options.env.STEMMIO_FROZEN_SCENARIO_ID === "A") return runCommand(command, args, options);
      await writeFile(options.env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(passChildReport(
        options.env,
        version,
        nestedPlans[options.env.STEMMIO_FROZEN_SCENARIO_ID === "B" ? 1 : 2],
      )));
      return { exitCode: 0, signal: null, timedOut: false, spawnError: null,
        cleanup: { attempted: false, confirmed: true, signal: null } };
    },
    scenarioTimeoutMs: 180_000,
    print: false,
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.report.ledger.map(({ id: scenarioId, state }) => [scenarioId, state]), [
    ["A", "PASS"], ["B", "PASS"], ["C", "PASS"],
  ]);
  assert.equal(result.report.scenarioReports[0].evidence.operationCount, FROZEN_FORMAT_OPERATIONS.length + 1);
  assert.equal(result.report.scenarioReports[0].process.cleanup.confirmed, true);
  assert.ok(result.report.scenarioReports[0].process.stdoutPath.endsWith("/A/child.stdout.log"));
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

test("an unconfirmed process-group cleanup blocks later scenarios as an environment failure", async () => {
  const version = workspaceSourceFingerprint(root);
  const { plan, nestedPlans } = dispatcherFixture(version);
  const calls = [];
  const result = await executePlan(plan, version, nestedPlans, {
    build: async () => ({ exitCode: 0 }),
    run: async (_command, _args, { env }) => {
      calls.push(env.STEMMIO_FROZEN_SCENARIO_ID);
      const index = env.STEMMIO_FROZEN_SCENARIO_ID === "A" ? 0 : 1;
      await writeFile(env.STEMMIO_FROZEN_REPORT_PATH, JSON.stringify(passChildReport(env, version, nestedPlans[index])));
      return {
        exitCode: 0, signal: null, timedOut: false, spawnError: null,
        cleanup: env.STEMMIO_FROZEN_SCENARIO_ID === "B"
          ? { attempted: true, confirmed: false, signal: "SIGKILL" }
          : { attempted: false, confirmed: true, signal: null },
      };
    },
    print: false,
  });
  assert.deepEqual(calls, ["A", "B"]);
  assert.deepEqual(result.report.ledger.map(({ id, state, reason }) => [id, state, reason]), [
    ["A", "PASS", "SCENARIO_COMPLETED"],
    ["B", "NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
    ["C", "NOT_EXECUTED", "ENVIRONMENT_BLOCKED"],
  ]);
  assert.equal(result.report.scenarioReports[2].firstFailure?.code, "FROZEN_ENTRY_PROCESS_CLEANUP_UNCONFIRMED");
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

test("direct node invocation uses npm_execpath when npm launched the entry", async () => {
  const previous = process.env.npm_execpath;
  process.env.npm_execpath = "/tmp/fake-npm-cli.js";
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
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, ["/tmp/fake-npm-cli.js", "run", "desktop:renderer"]);
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

test("bounded child execution waits for the owned process group after the parent closes", async () => {
  const result = await runCommand(process.execPath, ["-e", [
    "const { spawn } = require('node:child_process');",
    "spawn(process.execPath, ['-e', \"process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)\"], { stdio: 'ignore' });",
    "setTimeout(() => {}, 10000);",
  ].join(" ")], { timeoutMs: 50 });
  assert.equal(result.timedOut, true);
  assert.equal(result.cleanup?.confirmed, true);
});

test("child output keeps a bounded summary while preserving complete per-scenario logs", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stemmio-frozen-output-"));
  const result = await runCommand(process.execPath, ["-e", "process.stdout.write('x'.repeat(40000))"], {
    timeoutMs: 1_000,
    outputDirectory: directory,
    printOutput: false,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.length, 32 * 1024);
  assert.equal((await readFile(result.stdoutPath, "utf8")).length, 40_000);
  assert.equal(result.cleanup?.confirmed, true);
});

test("child spawn errors are reported without waiting for the scenario timeout", async () => {
  const result = await runCommand("/definitely/missing/stemmio-child", [], { timeoutMs: 100 });
  assert.equal(result.timedOut, false);
  assert.equal(result.exitCode, null);
  assert.equal(result.spawnError?.code, "ENOENT");
});
