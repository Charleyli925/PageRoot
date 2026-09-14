// Shared, side-effect-free contracts for the frozen real-HTML entry point.
// This module deliberately does not import Playwright or Electron.  The entry
// point can therefore list and validate a plan before any product process is
// started.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const FROZEN_ENTRY_SCHEMA_VERSION = 1;
export const FROZEN_ENTRY_KIND = "stemmio-frozen-scenario-plan";
export const FROZEN_ENTRY_SCENARIO_IDS = Object.freeze(["A", "B", "C"]);
export const FROZEN_ENTRY_STATES = Object.freeze([
  "PASS",
  "FAIL",
  "NOT_APPLICABLE",
  "NOT_EXECUTED",
]);

export const FROZEN_SCENARIO_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: "A",
    label: "普通编辑、格式、历史的原位连续性",
    purpose: "text-format-history-in-place",
    runner: "frozen-html-operation",
    allowedRunners: Object.freeze(["frozen-html-operation"]),
    allowedScopes: Object.freeze(["core-text-format", "element-text-format"]),
    requiredFacts: Object.freeze([
      "native input",
      "source-scope",
      "undo/redo",
      "reopen",
      "no unnecessary runtime replacement",
    ]),
  }),
  Object.freeze({
    id: "B",
    label: "编辑 → 历史 → 复制 → 评论 → 继续编辑",
    purpose: "mixed-edit-history-copy-comment-continuation",
    runner: "frozen-html-operation",
    allowedRunners: Object.freeze(["frozen-html-operation"]),
    allowedScopes: Object.freeze(["core-three-cycle"]),
    requiredFacts: Object.freeze([
      "mixed operation ordering",
      "history",
      "element copy",
      "comment identity",
      "continuation",
    ]),
  }),
  Object.freeze({
    id: "C",
    label: "必要重建 → 正确接管 → 继续编辑 → 重开",
    purpose: "rebuild-takeover-continuation-reopen",
    runner: "frozen-html-operation",
    allowedRunners: Object.freeze(["frozen-html-operation"]),
    // The public C contract is deliberately the small complete loop. The
    // path-race and pressure scopes remain available to their specialized
    // low-level lanes, but neither one proves post-rebuild editing by itself.
    allowedScopes: Object.freeze(["core-structure-closed-loop"]),
    requiredFacts: Object.freeze([
      "request/candidate/generation lifecycle",
      "active takeover",
      "forced rebuild operation",
      "post-rebuild input and save",
      "continued edit",
      "reopen",
    ]),
  }),
]);

const DEFINITION_BY_ID = new Map(FROZEN_SCENARIO_DEFINITIONS.map((definition) => [definition.id, definition]));
const SHA256 = /^[a-f0-9]{64}$/u;
const SHA1 = /^[a-f0-9]{40}$/u;
const VALID_MODES = new Set(["list", "plan", "run", "preflight"]);

function contractError(code, message, details = {}) {
  throw Object.assign(new Error(message), { code, details });
}

function nonEmptyString(value, code, field) {
  if (typeof value !== "string" || value.trim() === "") {
    contractError(code, `${field} must be a non-empty string.`, { field, value });
  }
  return value;
}

function uniqueOption(options, key, value) {
  if (options[key] != null) {
    contractError("FROZEN_ENTRY_DUPLICATE_OPTION", `Duplicate ${key} option.`, { key });
  }
  options[key] = value;
}

function optionValue(argv, index, flag) {
  const value = argv[index + 1];
  if (value == null || value.startsWith("--")) {
    contractError("FROZEN_ENTRY_OPTION_VALUE_MISSING", `${flag} requires a value.`, { flag });
  }
  return value;
}

/** Parse the public command line without touching the product or filesystem. */
export function parseFrozenEntryArgs(argv = []) {
  if (!Array.isArray(argv)) contractError("FROZEN_ENTRY_ARGS_INVALID", "Arguments must be an array.");
  const options = { mode: null, manifestPath: null, manifestSha256: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--list") {
      if (options.mode != null) contractError("FROZEN_ENTRY_MODE_CONFLICT", "Only one entry mode is allowed.");
      options.mode = "list";
    } else if (arg === "--plan") {
      if (options.mode != null) contractError("FROZEN_ENTRY_MODE_CONFLICT", "Only one entry mode is allowed.");
      options.mode = "plan";
    } else if (arg === "--preflight" || arg === "--capability-preflight") {
      if (options.mode != null) contractError("FROZEN_ENTRY_MODE_CONFLICT", "Only one entry mode is allowed.");
      options.mode = "preflight";
    } else if (arg === "--manifest") {
      uniqueOption(options, "manifestPath", optionValue(argv, index, arg));
      index += 1;
    } else if (arg === "--manifest-sha256") {
      uniqueOption(options, "manifestSha256", optionValue(argv, index, arg));
      index += 1;
    } else {
      contractError("FROZEN_ENTRY_UNKNOWN_OPTION", `Unknown frozen entry option ${arg}.`, { arg });
    }
  }
  options.mode ||= "run";
  if (!VALID_MODES.has(options.mode)) contractError("FROZEN_ENTRY_MODE_INVALID", "Invalid frozen entry mode.");
  const needsManifest = options.mode === "plan" || options.mode === "run";
  if (needsManifest && !options.manifestPath) {
    contractError("FROZEN_ENTRY_MANIFEST_REQUIRED", `${options.mode} requires --manifest.`);
  }
  if (needsManifest && !options.manifestSha256) {
    contractError("FROZEN_ENTRY_MANIFEST_DIGEST_REQUIRED", `${options.mode} requires --manifest-sha256.`);
  }
  if (options.mode === "list" || options.mode === "preflight") {
    if (options.manifestPath || options.manifestSha256) {
      contractError("FROZEN_ENTRY_MANIFEST_NOT_ALLOWED", `${options.mode} does not accept a manifest.`);
    }
  }
  if (options.manifestSha256 && !SHA256.test(options.manifestSha256)) {
    contractError("FROZEN_ENTRY_DIGEST_INVALID", "--manifest-sha256 must be a SHA-256 hex digest.");
  }
  if (options.manifestPath && !path.isAbsolute(options.manifestPath)) {
    contractError("FROZEN_ENTRY_MANIFEST_PATH_INVALID", "--manifest must be an absolute path.", {
      manifestPath: options.manifestPath,
    });
  }
  return Object.freeze(options);
}

export function digestFrozenEntry(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertVersion(version, currentVersion = null) {
  if (!version || typeof version !== "object"
    || !SHA1.test(version.head || "")
    || !SHA1.test(version.tree || "")
    || !SHA256.test(version.workspaceSourceSha256 || "")
    || !Number.isSafeInteger(version.untrackedFileCount)
    || version.untrackedFileCount < 0) {
    contractError("FROZEN_ENTRY_VERSION_INVALID", "The frozen scenario plan has invalid source provenance.");
  }
  if (currentVersion) {
    for (const field of ["head", "tree", "workspaceSourceSha256", "untrackedFileCount"]) {
      if (version[field] !== currentVersion[field]) {
        contractError("FROZEN_ENTRY_SOURCE_VERSION_MISMATCH", `Frozen plan ${field} does not match the current source.`, {
          field,
          expected: currentVersion[field],
          actual: version[field],
        });
      }
    }
  }
}

function assertScenarioDescriptor(scenario, index, currentVersion = null) {
  if (!scenario || typeof scenario !== "object") {
    contractError("FROZEN_ENTRY_SCENARIO_INVALID", "Each frozen scenario must be an object.", { index });
  }
  const definition = DEFINITION_BY_ID.get(scenario.id);
  if (!definition || index !== FROZEN_ENTRY_SCENARIO_IDS.indexOf(scenario.id)) {
    contractError("FROZEN_ENTRY_SCENARIO_ORDER_INVALID", "Frozen scenarios must be exactly A, B, C in order.", {
      index,
      id: scenario.id,
    });
  }
  if (scenario.runner !== definition.runner || !definition.allowedRunners.includes(scenario.runner)) {
    contractError("FROZEN_ENTRY_SCENARIO_RUNNER_INVALID", `Scenario ${scenario.id} has an unsupported runner.`, {
      id: scenario.id,
      runner: scenario.runner,
    });
  }
  if (!definition.allowedScopes.includes(scenario.scope)) {
    contractError("FROZEN_ENTRY_SCENARIO_SCOPE_INVALID", `Scenario ${scenario.id} has an unsupported scope.`, {
      id: scenario.id,
      scope: scenario.scope,
      allowedScopes: definition.allowedScopes,
    });
  }
  if (typeof scenario.manifestPath !== "string" || !path.isAbsolute(scenario.manifestPath)) {
    contractError("FROZEN_ENTRY_SCENARIO_MANIFEST_PATH_INVALID", `Scenario ${scenario.id} needs an absolute manifestPath.`);
  }
  if (!SHA256.test(scenario.manifestSha256 || "")) {
    contractError("FROZEN_ENTRY_SCENARIO_DIGEST_INVALID", `Scenario ${scenario.id} needs a manifestSha256.`);
  }
  if (scenario.label != null) nonEmptyString(scenario.label, "FROZEN_ENTRY_SCENARIO_LABEL_INVALID", "scenario.label");
  if (scenario.purpose !== definition.purpose) {
    contractError("FROZEN_ENTRY_SCENARIO_PURPOSE_INVALID", `Scenario ${scenario.id} purpose is not the reviewed contract.`, {
      id: scenario.id,
      purpose: scenario.purpose,
      expected: definition.purpose,
    });
  }
  if (currentVersion && scenario.version) assertVersion(scenario.version, currentVersion);
  return definition;
}

/**
 * Validate the composite manifest envelope. Nested executor-specific
 * contracts are checked by `validateNestedFrozenScenarioPlans` below.
 */
export function readFrozenScenarioPlan(bytes, expectedSha256, currentVersion = null) {
  const raw = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  if (!SHA256.test(expectedSha256 || "") || digestFrozenEntry(raw) !== expectedSha256) {
    contractError("FROZEN_ENTRY_MANIFEST_DIGEST_MISMATCH", "Frozen scenario plan digest does not match its bytes.");
  }
  let plan;
  try {
    plan = JSON.parse(raw.toString("utf8"));
  } catch (cause) {
    contractError("FROZEN_ENTRY_MANIFEST_JSON_INVALID", "Frozen scenario plan is not valid JSON.", {
      cause: cause?.message,
    });
  }
  if (plan?.schemaVersion !== FROZEN_ENTRY_SCHEMA_VERSION
    || plan.kind !== FROZEN_ENTRY_KIND
    || plan.reviewStatus !== "FROZEN"
    || plan.reviewedBy !== "root") {
    contractError("FROZEN_ENTRY_HEADER_INVALID", "Frozen scenario plan header is not reviewed.");
  }
  assertVersion(plan.version, currentVersion);
  if (!Array.isArray(plan.scenarios) || plan.scenarios.length !== FROZEN_ENTRY_SCENARIO_IDS.length) {
    contractError("FROZEN_ENTRY_SCENARIO_COUNT_INVALID", "Frozen scenario plan must contain A, B and C exactly once.");
  }
  const definitions = plan.scenarios.map((scenario, index) => assertScenarioDescriptor(scenario, index, currentVersion));
  const nestedManifestPaths = plan.scenarios.map((scenario) => scenario.manifestPath);
  if (new Set(nestedManifestPaths).size !== nestedManifestPaths.length) {
    contractError("FROZEN_ENTRY_SCENARIO_MANIFEST_DUPLICATE", "A scenario manifest cannot be reused by two scenarios.");
  }
  return Object.freeze({
    ...plan,
    scenarios: Object.freeze(plan.scenarios.map((scenario) => Object.freeze({ ...scenario }))),
    definitions: Object.freeze(definitions),
    digest: expectedSha256,
  });
}

export function readFrozenScenarioPlanFile(manifestPath, expectedSha256, currentVersion = null) {
  if (!path.isAbsolute(manifestPath)) {
    contractError("FROZEN_ENTRY_MANIFEST_PATH_INVALID", "The composite manifest path must be absolute.");
  }
  let bytes;
  try {
    bytes = readFileSync(manifestPath);
  } catch (cause) {
    contractError("FROZEN_ENTRY_MANIFEST_READ_FAILED", "Unable to read the composite frozen manifest.", {
      code: cause?.code,
    });
  }
  return readFrozenScenarioPlan(bytes, expectedSha256, currentVersion);
}

export function validateFrozenNestedScenarioShape(scenario, nestedPlan) {
  if (!nestedPlan || typeof nestedPlan !== "object") {
    contractError("FROZEN_ENTRY_NESTED_PLAN_INVALID", `Scenario ${scenario.id} nested plan is invalid.`);
  }
  if (scenario.runner === "frozen-html-operation") {
    if (nestedPlan.scope !== scenario.scope) {
      contractError("FROZEN_ENTRY_NESTED_SCOPE_MISMATCH", `Scenario ${scenario.id} nested scope differs from its envelope.`, {
        expected: scenario.scope,
        actual: nestedPlan.scope,
      });
    }
    if (scenario.id === "A" && nestedPlan.operation !== "native-text") {
      contractError("FROZEN_ENTRY_SCENARIO_OPERATION_INVALID", "Scenario A must use native-text.");
    }
    if (scenario.id === "B" && nestedPlan.operation !== "mixed") {
      contractError("FROZEN_ENTRY_SCENARIO_OPERATION_INVALID", "Scenario B must use mixed.");
    }
    if (scenario.id === "C" && nestedPlan.operation !== "mixed" && nestedPlan.operation !== "structure") {
      contractError("FROZEN_ENTRY_SCENARIO_OPERATION_INVALID", "Scenario C must exercise a rebuild-capable operation.");
    }
    if (scenario.id === "A" && nestedPlan.reopen !== true) {
      contractError("FROZEN_ENTRY_REOPEN_REQUIRED", "Scenario A must include an explicit reopen check.");
    }
    if (scenario.id === "B" && (nestedPlan.reopen !== true || nestedPlan.cycles !== 3)) {
      contractError("FROZEN_ENTRY_MIXED_CYCLE_CONTRACT_INVALID", "Scenario B must be the reviewed three-cycle mixed flow.");
    }
    if (scenario.id === "C") {
      const target = Array.isArray(nestedPlan.targets) ? nestedPlan.targets[0] : null;
      const operations = Array.isArray(target?.operations) ? target.operations : [];
      const forcedRebuild = target?.projectionByOperation?.["move-copy"];
      if (nestedPlan.scope !== "core-structure-closed-loop"
        || nestedPlan.operation !== "structure"
        || !["runtime", "static"].includes(nestedPlan.initialRuntime)
        || nestedPlan.reopen !== true
        || !operations.includes("input-restored")
        || !operations.includes("save-restored")
        || !["candidate", "recovered"].includes(forcedRebuild)
        || !["runtime-candidate", "static-rebuild"].includes(target?.rebuildPath)) {
        contractError(
          "FROZEN_ENTRY_REBUILD_CONTRACT_INVALID",
          "Scenario C must freeze a runtime rebuild, post-rebuild input/save, and reopen facts.",
        );
      }
    }
  }
  return nestedPlan;
}

/** Validate executor-specific manifests using their existing frozen contracts. */
export async function validateNestedFrozenScenarioPlans(plan, currentVersion = null) {
  const selection = await import("./frozen-selection.mjs");
  const nested = [];
  for (const scenario of plan.scenarios) {
    let bytes;
    try {
      bytes = readFileSync(scenario.manifestPath);
    } catch (cause) {
      contractError("FROZEN_ENTRY_SCENARIO_MANIFEST_READ_FAILED", `Unable to read scenario ${scenario.id} manifest.`, {
        id: scenario.id,
        code: cause?.code,
      });
    }
    if (digestFrozenEntry(bytes) !== scenario.manifestSha256) {
      contractError("FROZEN_ENTRY_SCENARIO_MANIFEST_DIGEST_MISMATCH", `Scenario ${scenario.id} manifest digest mismatch.`, {
        id: scenario.id,
      });
    }
    let nestedPlan;
    if (scenario.runner === "frozen-html-operation") {
      nestedPlan = selection.readFrozenSelection(bytes, scenario.manifestSha256);
    } else {
      contractError("FROZEN_ENTRY_SCENARIO_RUNNER_INVALID", `Unsupported runner ${scenario.runner}.`);
    }
    if (currentVersion && nestedPlan.workspaceSourceSha256 && nestedPlan.workspaceSourceSha256 !== currentVersion.workspaceSourceSha256) {
      contractError("FROZEN_ENTRY_NESTED_SOURCE_VERSION_MISMATCH", `Scenario ${scenario.id} nested source differs from the current source.`);
    }
    if (currentVersion && nestedPlan.version?.workspaceSourceSha256
      && nestedPlan.version.workspaceSourceSha256 !== currentVersion.workspaceSourceSha256) {
      contractError("FROZEN_ENTRY_NESTED_SOURCE_VERSION_MISMATCH", `Scenario ${scenario.id} nested source differs from the current source.`);
    }
    nested.push(validateFrozenNestedScenarioShape(scenario, nestedPlan));
  }
  return Object.freeze(nested);
}

function operationRows(value, rows = []) {
  if (Array.isArray(value)) {
    for (const item of value) operationRows(item, rows);
    return rows;
  }
  if (!value || typeof value !== "object") return rows;
  if (typeof value.operation === "string" && typeof value.state === "string") rows.push(value);
  for (const [key, child] of Object.entries(value)) {
    if (key !== "calls" && key !== "version" && key !== "source" && key !== "display") operationRows(child, rows);
  }
  return rows;
}

function reportVersionMatches(version, currentVersion) {
  return Boolean(version && currentVersion
    && ["head", "tree", "workspaceSourceSha256", "untrackedFileCount"]
      .every((field) => version[field] === currentVersion[field]));
}

/**
 * Validate the child result protocol before a parent scenario may become PASS.
 * This keeps exit code as a necessary signal, not the result oracle.
 */
export function summarizeFrozenScenarioReport(report, scenario, nestedPlan, currentVersion) {
  if (!report || typeof report !== "object") {
    contractError("FROZEN_ENTRY_CHILD_REPORT_INVALID", `Scenario ${scenario.id} child report is not an object.`);
  }
  if (report.schemaVersion !== 1 || report.kind !== "stemmio-frozen-html-operation-result"
    || report.scenarioId !== scenario.id || report.scope !== scenario.scope
    || report.manifestDigest !== scenario.manifestSha256
    || !reportVersionMatches(report.version, currentVersion)) {
    contractError("FROZEN_ENTRY_CHILD_REPORT_IDENTITY_INVALID", `Scenario ${scenario.id} child report is not bound to this plan.`, {
      scenarioId: report.scenarioId,
      scope: report.scope,
      manifestDigest: report.manifestDigest,
    });
  }
  if (!FROZEN_ENTRY_STATES.includes(report.state)) {
    contractError("FROZEN_ENTRY_CHILD_REPORT_STATE_INVALID", `Scenario ${scenario.id} child report has an invalid state.`);
  }
  const rows = operationRows(report);
  const failures = rows.filter((row) => row.state !== "PASS");
  if (report.state === "PASS") {
    if (rows.length === 0 || failures.length > 0 || report.cleanup !== "PASS") {
      contractError("FROZEN_ENTRY_CHILD_REPORT_INCOMPLETE", `Scenario ${scenario.id} PASS report has incomplete operation evidence.`, {
        operationCount: rows.length,
        incomplete: failures.map((row) => ({ operation: row.operation, state: row.state, reason: row.reason })),
        cleanup: report.cleanup,
      });
    }
    if (nestedPlan.reopen === true && report.reopen?.state !== "PASS") {
      contractError("FROZEN_ENTRY_CHILD_REOPEN_MISSING", `Scenario ${scenario.id} PASS report is missing a successful reopen fact.`);
    }
    if (scenario.id === "B"
      && (!Array.isArray(report.mixed?.cycles) || report.mixed.cycles.length !== nestedPlan.cycles)) {
      contractError("FROZEN_ENTRY_CHILD_MIXED_CYCLES_MISSING", "Scenario B PASS report is missing one report group per frozen cycle.");
    }
    if (!report.source || !report.display || !report.finalSource) {
      contractError("FROZEN_ENTRY_CHILD_SOURCE_EVIDENCE_MISSING", `Scenario ${scenario.id} PASS report is missing source/display evidence.`);
    }
    if (!report.lifecycle || typeof report.lifecycle !== "object") {
      contractError("FROZEN_ENTRY_CHILD_LIFECYCLE_EVIDENCE_MISSING", `Scenario ${scenario.id} PASS report is missing lifecycle evidence.`);
    }
    if (scenario.id === "C") {
      const requiredOperation = "move-copy";
      const row = rows.find((candidate) => candidate.operation === requiredOperation);
      const expected = nestedPlan.targets?.[0]?.projectionByOperation?.[requiredOperation];
      const runtime = row?.actual?.runtime;
      if (!row || row.state !== "PASS" || !["candidate", "recovered"].includes(expected)
        || !["candidate", "recovered"].includes(row.actual?.outcome)
        || !runtime || runtime.runtime === "in-place"
        || !rows.some((candidate) => candidate.operation === "input-restored" && candidate.state === "PASS")
        || !rows.some((candidate) => candidate.operation === "save-restored" && candidate.state === "PASS")) {
        contractError("FROZEN_ENTRY_CHILD_REBUILD_EVIDENCE_MISSING", "Scenario C PASS report is missing the forced rebuild continuation evidence.");
      }
    }
  } else if (report.state === "FAIL" && !report.firstFailure) {
    contractError("FROZEN_ENTRY_CHILD_FAILURE_EVIDENCE_MISSING", `Scenario ${scenario.id} FAIL report is missing firstFailure.`);
  }
  const lifecycleRecords = Array.isArray(report.lifecycle)
    ? report.lifecycle.length
    : Array.isArray(report.lifecycle?.lifecycleRecords)
      ? report.lifecycle.lifecycleRecords.length
      : Array.isArray(report.lifecycle?.records)
        ? report.lifecycle.records.length
        : 0;
  return Object.freeze({
    state: report.state,
    operationCount: rows.length,
    completedOperations: rows.filter((row) => row.state === "PASS").length,
    failedOperations: failures.length,
    firstFailure: report.firstFailure || null,
    reopen: report.reopen ? { state: report.reopen.state, reason: report.reopen.reason || null } : null,
    lifecycle: { records: lifecycleRecords, reportPath: report.reportPath || null },
    requiredRebuild: scenario.id === "C" ? {
      operation: "move-copy",
      expected: nestedPlan.targets?.[0]?.projectionByOperation?.["move-copy"] || null,
      actual: rows.find((row) => row.operation === "move-copy")?.actual || null,
    } : null,
  });
}

export function listFrozenScenarioDefinitions() {
  return FROZEN_SCENARIO_DEFINITIONS.map(({ id, label, purpose, runner, allowedScopes, requiredFacts }) => ({
    id, label, purpose, runner, allowedScopes: [...allowedScopes], requiredFacts: [...requiredFacts],
  }));
}

export function createFrozenScenarioLedger(plan) {
  return plan.scenarios.map((scenario, index) => ({
    order: index + 1,
    id: scenario.id,
    label: scenario.label || plan.definitions[index].label,
    runner: scenario.runner,
    scope: scenario.scope,
    state: "NOT_EXECUTED",
    reason: "NOT_STARTED",
    details: null,
  }));
}

export function recordFrozenScenarioOutcome(ledger, id, outcome) {
  if (!Array.isArray(ledger)) contractError("FROZEN_ENTRY_LEDGER_INVALID", "Scenario ledger must be an array.");
  const index = ledger.findIndex((row) => row.id === id);
  if (index < 0) contractError("FROZEN_ENTRY_LEDGER_UNKNOWN_ID", `Unknown scenario ${id}.`, { id });
  const current = ledger[index];
  if (current.state !== "NOT_EXECUTED" || current.reason !== "NOT_STARTED") {
    contractError("FROZEN_ENTRY_LEDGER_FINAL", `Scenario ${id} already has a terminal result.`, { id });
  }
  if (!outcome || !FROZEN_ENTRY_STATES.includes(outcome.state)) {
    contractError("FROZEN_ENTRY_LEDGER_STATE_INVALID", `Scenario ${id} has an invalid result state.`, { id });
  }
  const reason = outcome.reason || (outcome.state === "PASS" ? "COMPLETED" : null);
  if (!reason) contractError("FROZEN_ENTRY_LEDGER_REASON_REQUIRED", `Scenario ${id} needs a failure or blocked reason.`, { id });
  return ledger.map((row, rowIndex) => rowIndex === index
    ? { ...row, state: outcome.state, reason, details: outcome.details ?? null }
    : { ...row });
}

export function summarizeFrozenScenarioLedger(ledger) {
  if (!Array.isArray(ledger) || ledger.length !== FROZEN_ENTRY_SCENARIO_IDS.length) {
    contractError("FROZEN_ENTRY_LEDGER_INVALID", "Scenario ledger must contain A, B and C.");
  }
  const ids = ledger.map((row) => row.id);
  if (JSON.stringify(ids) !== JSON.stringify(FROZEN_ENTRY_SCENARIO_IDS)) {
    contractError("FROZEN_ENTRY_LEDGER_ORDER_INVALID", "Scenario ledger order must be A, B, C.");
  }
  const counts = Object.fromEntries(FROZEN_ENTRY_STATES.map((state) => [state, 0]));
  for (const row of ledger) {
    if (!FROZEN_ENTRY_STATES.includes(row.state)) {
      contractError("FROZEN_ENTRY_LEDGER_STATE_INVALID", `Unknown scenario ledger state ${row.state}.`);
    }
    if (!row.reason || typeof row.reason !== "string") {
      contractError("FROZEN_ENTRY_LEDGER_REASON_REQUIRED", `Scenario ${row.id} has no result reason.`);
    }
    counts[row.state] += 1;
  }
  return {
    planned: ledger.length,
    ...counts,
    complete: ledger.every((row) => row.state !== "NOT_EXECUTED" || row.reason !== "NOT_STARTED"),
  };
}

export function scenarioDefinition(id) {
  return DEFINITION_BY_ID.get(id) || null;
}
