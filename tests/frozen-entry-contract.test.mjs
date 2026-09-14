import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  FROZEN_ENTRY_KIND,
  FROZEN_ENTRY_SCENARIO_IDS,
  FROZEN_ENTRY_STATES,
  FROZEN_SCENARIO_DEFINITIONS,
  createFrozenScenarioLedger,
  digestFrozenEntry,
  listFrozenScenarioDefinitions,
  parseFrozenEntryArgs,
  readFrozenScenarioPlan,
  recordFrozenScenarioOutcome,
  summarizeFrozenScenarioLedger,
  summarizeFrozenScenarioReport,
  validateFrozenNestedScenarioShape,
} from "./e2e/electron/real-html/frozen-entry-contract.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const version = Object.freeze({
  head: "a".repeat(40),
  tree: "b".repeat(40),
  workspaceSourceSha256: "c".repeat(64),
  untrackedFileCount: 0,
});

function envelope(overrides = {}) {
  return {
    schemaVersion: 1,
    kind: FROZEN_ENTRY_KIND,
    reviewStatus: "FROZEN",
    reviewedBy: "root",
    version,
    scenarios: FROZEN_SCENARIO_DEFINITIONS.map((definition) => ({
      id: definition.id,
      label: definition.label,
      purpose: definition.purpose,
      runner: definition.runner,
      scope: definition.allowedScopes[0],
      manifestPath: `/private/frozen/${definition.id}.json`,
      manifestSha256: "d".repeat(64),
      ...(definition.id === "B" ? { scope: "core-three-cycle" } : {}),
    })),
    ...overrides,
  };
}

test("the public entry exposes exactly three ordered scenario contracts", () => {
  assert.deepEqual(FROZEN_ENTRY_SCENARIO_IDS, ["A", "B", "C"]);
  assert.deepEqual(listFrozenScenarioDefinitions().map(({ id }) => id), ["A", "B", "C"]);
  assert.equal(FROZEN_ENTRY_STATES.includes("PASS"), true);
  assert.equal(FROZEN_ENTRY_STATES.includes("NOT_EXECUTED"), true);
});

test("argument parsing keeps list and plan read-only and rejects conflicts", () => {
  assert.deepEqual(parseFrozenEntryArgs(["--list"]), {
    mode: "list", manifestPath: null, manifestSha256: null,
  });
  assert.deepEqual(parseFrozenEntryArgs([
    "--plan", "--manifest", "/tmp/plan.json", "--manifest-sha256", "a".repeat(64),
  ]), {
    mode: "plan", manifestPath: "/tmp/plan.json", manifestSha256: "a".repeat(64),
  });
  assert.throws(() => parseFrozenEntryArgs([]), { code: "FROZEN_ENTRY_MANIFEST_REQUIRED" });
  for (const args of [
    ["--list", "--plan"],
    ["--list", "--manifest", "/tmp/plan.json"],
    ["--plan", "--manifest", "relative.json", "--manifest-sha256", "a".repeat(64)],
    ["--plan", "--manifest", "/tmp/plan.json"],
    ["--unknown"],
  ]) assert.throws(() => parseFrozenEntryArgs(args));
});

test("the composite manifest binds source identity and A/B/C ordering", () => {
  const bytes = Buffer.from(JSON.stringify(envelope()));
  const plan = readFrozenScenarioPlan(bytes, digestFrozenEntry(bytes), version);
  assert.deepEqual(plan.scenarios.map(({ id }) => id), ["A", "B", "C"]);
  assert.equal(plan.definitions[1].purpose, "mixed-edit-history-copy-comment-continuation");
  assert.throws(() => readFrozenScenarioPlan(bytes, "e".repeat(64), version), {
    code: "FROZEN_ENTRY_MANIFEST_DIGEST_MISMATCH",
  });
  const reordered = envelope({ scenarios: [envelope().scenarios[1], envelope().scenarios[0], envelope().scenarios[2]] });
  assert.throws(() => {
    const changed = Buffer.from(JSON.stringify(reordered));
    readFrozenScenarioPlan(changed, sha256(changed), version);
  }, { code: "FROZEN_ENTRY_SCENARIO_ORDER_INVALID" });
  assert.throws(() => readFrozenScenarioPlan(bytes, digestFrozenEntry(bytes), {
    ...version, workspaceSourceSha256: "e".repeat(64),
  }), { code: "FROZEN_ENTRY_SOURCE_VERSION_MISMATCH" });
  const duplicateManifest = envelope({
    scenarios: envelope().scenarios.map((scenario) => ({ ...scenario, manifestPath: "/private/frozen/shared.json" })),
  });
  assert.throws(() => {
    const changed = Buffer.from(JSON.stringify(duplicateManifest));
    readFrozenScenarioPlan(changed, sha256(changed), version);
  }, { code: "FROZEN_ENTRY_SCENARIO_MANIFEST_DUPLICATE" });
});

test("scenario ledger preserves one terminal fact per scenario without retries", () => {
  const plan = readFrozenScenarioPlan(Buffer.from(JSON.stringify(envelope())), digestFrozenEntry(Buffer.from(JSON.stringify(envelope()))), version);
  let ledger = createFrozenScenarioLedger(plan);
  ledger = recordFrozenScenarioOutcome(ledger, "A", { state: "PASS", details: { exitCode: 0 } });
  ledger = recordFrozenScenarioOutcome(ledger, "B", { state: "FAIL", reason: "CHILD_EXIT_1" });
  ledger = recordFrozenScenarioOutcome(ledger, "C", { state: "NOT_EXECUTED", reason: "ENVIRONMENT_BLOCKED" });
  assert.throws(() => recordFrozenScenarioOutcome(ledger, "B", { state: "PASS" }), {
    code: "FROZEN_ENTRY_LEDGER_FINAL",
  });
  assert.deepEqual(summarizeFrozenScenarioLedger(ledger), {
    planned: 3, PASS: 1, FAIL: 1, NOT_APPLICABLE: 0, NOT_EXECUTED: 1, complete: true,
  });
});

test("a valid plan can be written and read with the same digest", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "stemmio-frozen-entry-contract-"));
  const file = path.join(directory, "plan.json");
  const bytes = Buffer.from(JSON.stringify(envelope()));
  await writeFile(file, bytes);
  assert.equal(digestFrozenEntry(bytes), sha256(bytes));
  assert.ok(file.startsWith("/"));
});

test("C rejects copy-only or descriptive-only rebuild plans", () => {
  const scenario = { id: "C", runner: "frozen-html-operation", scope: "core-structure-closed-loop" };
  const target = {
    rebuildPath: "runtime-candidate",
    operations: ["copy"],
    projectionByOperation: {},
  };
  assert.throws(() => validateFrozenNestedScenarioShape(scenario, {
    scope: scenario.scope, operation: "structure", initialRuntime: "runtime", reopen: true, targets: [target],
  }), { code: "FROZEN_ENTRY_REBUILD_CONTRACT_INVALID" });
  assert.throws(() => validateFrozenNestedScenarioShape(scenario, {
    scope: scenario.scope, operation: "structure", initialRuntime: "runtime", reopen: true,
    targets: [{ ...target, operations: ["copy", "input-restored", "save-restored"], projectionByOperation: {} }],
  }), { code: "FROZEN_ENTRY_REBUILD_CONTRACT_INVALID" });
  assert.doesNotThrow(() => validateFrozenNestedScenarioShape(scenario, {
    scope: scenario.scope, operation: "structure", initialRuntime: "runtime", reopen: true,
    targets: [{ ...target, operations: ["copy", "input-restored", "save-restored"],
      projectionByOperation: { "move-copy": "candidate" } }],
  }));
});

test("child PASS requires report evidence beyond a zero exit code", () => {
  const scenario = envelope().scenarios[0];
  const nestedPlan = { reopen: true };
  const base = {
    schemaVersion: 1,
    kind: "stemmio-frozen-html-operation-result",
    scenarioId: "A",
    scope: scenario.scope,
    manifestDigest: scenario.manifestSha256,
    version,
    state: "PASS",
    cleanup: "PASS",
    calls: [],
    source: { sha256: "a".repeat(64) },
    display: { working: "sha256:a", displayed: "sha256:a" },
    finalSource: { sha256: "a".repeat(64) },
    lifecycle: { records: [] },
    reopen: { state: "PASS" },
    operation: { operation: "select", state: "PASS" },
  };
  assert.equal(summarizeFrozenScenarioReport(base, scenario, nestedPlan, version).operationCount, 1);
  assert.throws(() => summarizeFrozenScenarioReport({ ...base, operation: undefined }, scenario, nestedPlan, version), {
    code: "FROZEN_ENTRY_CHILD_REPORT_INCOMPLETE",
  });
  assert.throws(() => summarizeFrozenScenarioReport({ ...base, lifecycle: undefined }, scenario, nestedPlan, version), {
    code: "FROZEN_ENTRY_CHILD_LIFECYCLE_EVIDENCE_MISSING",
  });
  assert.throws(() => summarizeFrozenScenarioReport({ ...base, state: "FAIL", firstFailure: undefined }, scenario, nestedPlan, version), {
    code: "FROZEN_ENTRY_CHILD_FAILURE_EVIDENCE_MISSING",
  });
});
