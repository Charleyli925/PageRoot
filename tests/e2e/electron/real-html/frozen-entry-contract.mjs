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
const STABLE_ELEMENT_ID = /^sm1_[0-9a-f]{12}4[0-9a-f]{3}[89ab][0-9a-f]{15}$/u;
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
      const copyProjection = target?.projectionByOperation?.copy || target?.expectedProjection;
      if (nestedPlan.scope !== "core-structure-closed-loop"
        || nestedPlan.operation !== "structure"
        || !["runtime", "static"].includes(nestedPlan.initialRuntime)
        || nestedPlan.reopen !== true
        || !operations.includes("copy")
        || !operations.includes("move-copy")
        || !operations.includes("input-restored")
        || !operations.includes("save-restored")
        || !["candidate", "recovered"].includes(forcedRebuild)
        || !["candidate", "recovered"].includes(copyProjection)
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

function reportVersionMatches(version, currentVersion) {
  return Boolean(version && currentVersion
    && ["head", "tree", "workspaceSourceSha256", "untrackedFileCount"]
      .every((field) => version[field] === currentVersion[field]));
}

const FROZEN_TEXT_OPERATIONS = Object.freeze([
  "activate", "input", "backspace", "save", "undo", "redo",
]);
const FROZEN_REENTRY_CONTINUATION_OPERATIONS = Object.freeze([
  "activate", "input", "backspace", "save", "undo", "resume-after-undo", "redo", "resume-after-redo",
]);
const FROZEN_MIXED_CONTROL_OPERATIONS = Object.freeze([
  "select-text", "create-comment", "select-structure", "resume-text", "verify-cycle",
]);

function continuationOperations(target) {
  return target?.historyResume === "explicit-reentry"
    ? FROZEN_REENTRY_CONTINUATION_OPERATIONS
    : FROZEN_TEXT_OPERATIONS;
}

function normalizeSelectionOperation(row) {
  if (!row || typeof row !== "object") return row;
  // The shared selection executor records the resolved identity as `actual`
  // (and the frozen target as `expected`), while staged operation rows carry a
  // canonical targetId. Normalize only this one ingress shape before ledger
  // reconciliation; the planned `expected` value is never accepted as actual
  // evidence, and a missing operation remains missing.
  return {
    ...row,
    operation: typeof row.operation === "string" ? row.operation : null,
    targetId: typeof row.targetId === "string"
      ? row.targetId
      : typeof row.actual === "string" ? row.actual : null,
  };
}

function copyOutputId(row) {
  const actual = row?.actual;
  const source = actual?.source || actual?.result?.source;
  const id = source?.copyId || actual?.copyId || actual?.result?.copyId;
  return typeof id === "string" && id.trim() !== "" ? id : null;
}

function copyOutputRows(rows, sourceId) {
  return Array.isArray(rows)
    ? rows.filter((row) => row?.operation === "copy" && row?.targetId === sourceId)
    : [];
}

const COPY_SOURCE_CONDITIONS = Object.freeze([
  "originalUnique", "originalBytesMatch", "originalLeaf", "parentMatches", "siblingMatches", "offsetMatches",
  "positiveInsertion", "prefixUnchanged", "suffixUnchanged", "oneLeafInserted", "freshId",
  "idsUnique", "exactlyOneAdded", "copyAttributeShape", "equivalentBytes", "copyParentMatches",
]);

function validateOutputBindings(scenario, nestedPlan, report) {
  const mismatches = [];
  const bindings = [];
  const check = ({ cycle = null, rows, sourceId, declaredId }) => {
    const candidates = copyOutputRows(rows, sourceId);
    const row = candidates.length === 1 ? candidates[0] : null;
    const actualId = copyOutputId(row);
    const conditions = row?.actual?.source?.conditions || row?.actual?.result?.source?.conditions;
    const conditionsMatch = COPY_SOURCE_CONDITIONS.every((key) => conditions?.[key] === true);
    if (candidates.length !== 1 || !row) {
      mismatches.push({ cycle, reason: "COPY_ROW_MISSING_OR_DUPLICATE", sourceId, count: candidates.length });
    }
    if (!STABLE_ELEMENT_ID.test(actualId || "") || actualId === sourceId) {
      mismatches.push({ cycle, reason: "COPY_OUTPUT_ID_INVALID", sourceId, actualId });
    }
    if (!conditionsMatch) {
      mismatches.push({ cycle, reason: "COPY_SOURCE_PROOF_INCOMPLETE", conditions: conditions || null });
    }
    if (declaredId !== actualId) {
      mismatches.push({ cycle, reason: "COPY_OUTPUT_SUMMARY_MISMATCH", declaredId, actualId });
    }
    bindings.push({ cycle, sourceId, id: actualId });
  };
  if (scenario.id === "B") {
    const structureTarget = nestedPlan?.targets?.[1];
    const cycles = Array.isArray(report.mixed?.cycles) ? report.mixed.cycles : [];
    for (let index = 0; index < (nestedPlan?.cycles || 0); index += 1) {
      check({ cycle: index + 1, rows: cycles[index]?.structure, sourceId: structureTarget?.selectedId,
        declaredId: report.mixed?.copyIds?.[index] });
    }
    if (!Array.isArray(report.mixed?.copyIds)
      || report.mixed.copyIds.length !== nestedPlan.cycles
      || new Set(report.mixed.copyIds).size !== report.mixed.copyIds.length) {
      mismatches.push({ reason: "COPY_OUTPUT_SUMMARY_SHAPE_INVALID", copyIds: report.mixed?.copyIds || null });
    }
  } else if (scenario.id === "C") {
    const target = nestedPlan?.targets?.[0];
    check({ rows: report.structureOperations, sourceId: target?.selectedId, declaredId: report.structure?.copyId });
  }
  if (mismatches.length > 0) {
    contractError("FROZEN_ENTRY_CHILD_OUTPUT_BINDING_MISMATCH",
      `Scenario ${scenario.id} report does not bind the copy output to its verified source transaction.`, {
        scenarioId: scenario.id, mismatches,
      });
  }
  return bindings;
}

function operationGroups(scenario, nestedPlan, report) {
  const groups = [];
  const add = (stage, expectedOperations, actualRows, cycle = null, actualCycle = null) => {
    groups.push({ stage, cycle, expectedOperations, actualRows, actualCycle });
  };
  const target = nestedPlan?.targets?.[0];
  if (scenario.id === "A") {
    add("selection", [{ operation: "select", targetId: target?.selectedId }], [normalizeSelectionOperation(report.operation)]);
    add("text", (target?.operations || []).map((operation) => ({
      operation, targetId: target?.selectedId,
    })), report.textOperations);
  } else if (scenario.id === "B") {
    const textTarget = nestedPlan?.targets?.[0];
    const structureTarget = nestedPlan?.targets?.[1];
    const cycles = Array.isArray(report.mixed?.cycles) ? report.mixed.cycles : [];
    for (let index = 0; index < (nestedPlan?.cycles || 0); index += 1) {
      const actual = cycles[index];
      const copyId = copyOutputId(copyOutputRows(actual?.structure, structureTarget?.selectedId)[0]);
      add("control", FROZEN_MIXED_CONTROL_OPERATIONS.map((operation) => ({
        operation,
        targetId: operation === "select-structure" ? structureTarget?.selectedId : textTarget?.selectedId,
      })), actual?.control, index + 1, actual?.cycle);
      add("text", (textTarget?.operations || []).map((operation) => ({
        operation, targetId: textTarget?.selectedId,
      })), actual?.text, index + 1, actual?.cycle);
      add("structure", (structureTarget?.operations || []).map((operation, operationIndex) => ({
        operation,
        targetId: operationIndex === 0 || operation.startsWith("probe-")
          ? structureTarget?.selectedId : copyId,
      })), actual?.structure, index + 1, actual?.cycle);
      add("continuation", continuationOperations(textTarget).map((operation) => ({
        operation, targetId: textTarget?.selectedId,
      })), actual?.continuation, index + 1, actual?.cycle);
    }
    add("checkpoint", ["reopen-cumulative", ...Array.from(
      { length: nestedPlan?.cycles || 0 }, (_, index) => `delete-comment-${index + 1}`,
    )].map((operation) => ({ operation, targetId: textTarget?.selectedId })), report.mixed?.checkpoint);
  } else if (scenario.id === "C") {
    const copyId = copyOutputId(copyOutputRows(report.structureOperations, target?.selectedId)[0]);
    add("selection", [{ operation: "select", targetId: target?.selectedId }], [normalizeSelectionOperation(report.operation)]);
    add("structure", (target?.operations || []).map((operation, operationIndex) => ({
      operation,
      targetId: operationIndex === 0 ? target?.selectedId : copyId,
    })), report.structureOperations);
  }
  return groups;
}

function knownOperationRows(scenario, nestedPlan, report) {
  return operationGroups(scenario, nestedPlan, report).flatMap((group) => (
    Array.isArray(group.actualRows) ? group.actualRows : []
  ));
}

function reconcileOperationLedger(scenario, nestedPlan, report) {
  const groups = operationGroups(scenario, nestedPlan, report);
  const mismatches = [];
  for (const group of groups) {
    if (group.cycle !== null && group.actualCycle !== group.cycle) {
      mismatches.push({ stage: group.stage, cycle: group.cycle,
        expectedCycle: group.cycle, actualCycle: group.actualCycle });
    }
    if (!Array.isArray(group.actualRows) || group.actualRows.length !== group.expectedOperations.length) {
      mismatches.push({ stage: group.stage, cycle: group.cycle,
        expectedCount: group.expectedOperations.length,
        actualCount: Array.isArray(group.actualRows) ? group.actualRows.length : null });
      continue;
    }
    for (const [index, expected] of group.expectedOperations.entries()) {
      const actual = group.actualRows[index];
      if (typeof expected.operation !== "string" || expected.operation.length === 0
        || typeof expected.targetId !== "string" || expected.targetId.length === 0
        || actual?.operation !== expected.operation || actual?.targetId !== expected.targetId) {
        mismatches.push({ stage: group.stage, cycle: group.cycle, sequence: index + 1,
          expected, actual: actual ? { operation: actual.operation, targetId: actual.targetId } : null });
      }
    }
  }
  if (mismatches.length > 0) {
    contractError(
      "FROZEN_ENTRY_CHILD_OPERATION_LEDGER_MISMATCH",
      `Scenario ${scenario.id} report does not match its frozen operation ledger.`,
      { scenarioId: scenario.id, mismatches },
    );
  }
  const outputBindings = validateOutputBindings(scenario, nestedPlan, report);
  return { rows: groups.flatMap((group) => group.actualRows), outputBindings };
}

function requireCompleteEvidence(condition, code, details) {
  if (!condition) contractError(code, "Frozen child evidence is incomplete.", details);
}

function validateOperationEvidence(rows, scenario) {
  for (const [index, row] of rows.entries()) {
    const actual = row?.actual;
    const actualObject = actual && typeof actual === "object" && !Array.isArray(actual)
      && Object.keys(actual).length > 0;
    const actualScalar = typeof actual === "string" && actual.trim() !== "";
    const operationFact = (() => {
      if (["input", "input-copy", "input-restored"].includes(row?.operation)) {
        return actualObject && typeof actual.appended === "string" && actual.appended.length > 0;
      }
      if (["backspace", "delete-forward"].includes(row?.operation)) {
        return actualObject && typeof actual.removed === "string" && actual.removed.length > 0;
      }
      if (["save", "save-copy", "save-restored", "save-newline"].includes(row?.operation)) {
        return actualObject && (
          SHA256.test(actual.sourceSha256 || "")
          || SHA256.test(actual.restoredSha256 || "")
          || typeof actual.sourceContains === "string"
          || (actual.changedRanges && typeof actual.changedRanges === "object")
          || typeof actual.outsideUnchanged === "boolean"
        );
      }
      if (row?.operation === "copy") {
        return actualObject && (actual.source || actual.copyId || actual.result);
      }
      if (row?.operation === "move-copy") {
        return actualObject && (actual.runtime || actual.outcome || actual.planned);
      }
      return actualObject || actualScalar;
    })();
    requireCompleteEvidence(row?.state === "PASS"
      && typeof row.reason === "string" && row.reason.trim() !== ""
      && Number.isFinite(row.durationMs) && row.durationMs >= 0
      && operationFact,
    "FROZEN_ENTRY_CHILD_OPERATION_EVIDENCE_INVALID", {
      scenarioId: scenario.id, sequence: index + 1,
      operation: row?.operation || null,
      actual: actual ?? null,
      reason: row?.reason || null, durationMs: row?.durationMs ?? null,
    });
  }
}

function validateSourceEvidence(report, scenario, nestedPlan) {
  const source = report.source;
  const finalSource = report.finalSource;
  const display = report.display;
  requireCompleteEvidence(source?.hashMatches === true && source?.sizeMatches === true,
    "FROZEN_ENTRY_CHILD_SOURCE_EVIDENCE_INVALID", { scenarioId: scenario.id, source });
  requireCompleteEvidence(finalSource?.hashMatches === true && finalSource?.sizeMatches === true,
    "FROZEN_ENTRY_CHILD_FINAL_SOURCE_EVIDENCE_INVALID", { scenarioId: scenario.id, finalSource });
  requireCompleteEvidence(display?.conditions?.workingMatches === true
    && display?.conditions?.displayedMatches === true,
    "FROZEN_ENTRY_CHILD_DISPLAY_EVIDENCE_INVALID", { scenarioId: scenario.id, display });
  if (report.reopen) {
    requireCompleteEvidence(report.reopen.state === "PASS"
      && typeof report.reopen.reason === "string" && report.reopen.reason.trim() !== ""
      && Number.isFinite(report.reopen.durationMs) && report.reopen.durationMs >= 0
      && report.reopen.source?.hashMatches === true && report.reopen.source?.sizeMatches === true
      && report.reopen.display?.workingMatches === true
      && report.reopen.display?.displayedMatches === true
      && report.reopen.target?.id === nestedPlan?.targets?.[0]?.selectedId
      && report.reopen.target?.tag === nestedPlan?.targets?.[0]?.selectedTag,
    "FROZEN_ENTRY_CHILD_REOPEN_EVIDENCE_INVALID", {
      scenarioId: scenario.id, reopen: report.reopen,
    });
  }
}

function validateRuntimeConfiguration(report, scenario, nestedPlan) {
  const initial = report.runtimeConfig;
  const reopened = report.reopen?.runtimeConfig;
  const expectedStructuralInPlace = scenario.id === "C"
    && ["candidate", "recovered"].includes(nestedPlan?.targets?.[0]
      ?.projectionByOperation?.["move-copy"])
    ? "disabled" : "enabled";
  const validWindowMode = ["hidden", "visible-background", "foreground"].includes(initial?.windowMode);
  requireCompleteEvidence(validWindowMode
    && initial.structuralInPlace === expectedStructuralInPlace
    && (!report.reopen || (reopened?.windowMode === initial.windowMode
      && reopened?.structuralInPlace === initial.structuralInPlace)),
  "FROZEN_ENTRY_RUNTIME_CONFIGURATION_INVALID", {
    scenarioId: scenario.id, expectedStructuralInPlace, initial, reopened,
  });
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateLifecycleEvidence(report, scenario, nestedPlan, rebuildRow = null) {
  const lifecycle = report.lifecycle;
  const candidateRecords = lifecycle?.candidateRecords;
  const lifecycleRecords = lifecycle?.lifecycleRecords;
  const expectedRecords = Array.isArray(candidateRecords) && Array.isArray(lifecycleRecords)
    ? [...candidateRecords, ...lifecycleRecords] : [];
  requireCompleteEvidence(lifecycle && typeof lifecycle === "object"
    && Array.isArray(lifecycle.records)
    && Array.isArray(candidateRecords)
    && Array.isArray(lifecycleRecords)
    && lifecycle.records.length === expectedRecords.length
    && lifecycle.records.every((record, index) => canonicalJson(record) === canonicalJson(expectedRecords[index]))
    && [...candidateRecords, ...lifecycleRecords]
      .every((record) => record && typeof record === "object"
        && typeof record.kind === "string" && record.kind.trim() !== ""),
  "FROZEN_ENTRY_CHILD_LIFECYCLE_EVIDENCE_INVALID", {
    scenarioId: scenario.id, lifecycle,
  });
  if (scenario.id !== "C") return;
  const expectedPath = nestedPlan.targets?.[0]?.rebuildPath;
  if (expectedPath !== "runtime-candidate") {
    requireCompleteEvidence(candidateRecords.length === 0,
      "FROZEN_ENTRY_CHILD_STATIC_LIFECYCLE_INVALID", { scenarioId: scenario.id, lifecycle });
    return;
  }
  const kinds = new Set(lifecycleRecords.map((record) => record?.kind));
  const runtime = rebuildRow?.actual?.runtime;
  const candidateId = runtime?.candidateId;
  const generation = String(runtime?.generation || "");
  const generationRecord = lifecycleRecords.find((record) => record?.kind === "generation"
    && String(record.afterGeneration || record.generation || "") === generation
    && record.candidateId === candidateId);
  requireCompleteEvidence(
    ["rebuild-request", "generation", "runtime-terminal"].every((kind) => kinds.has(kind))
      && typeof candidateId === "string" && candidateId.trim() !== ""
      && candidateRecords.some((record) => record?.kind === "candidate-created"
        && record.candidateId === candidateId)
      && lifecycleRecords.some((record) => record?.kind === "candidate-terminal"
        && record.candidateId === candidateId && record.terminal === "ready")
      && Boolean(generationRecord)
      && lifecycleRecords.some((record) => record?.kind === "active-identity"
        && record.candidateId === candidateId && String(record.generation || "") === generation)
      && lifecycleRecords.some((record) => record?.kind === "runtime-terminal"
        && record.candidateId === candidateId && String(record.generation || "") === generation
        && record.phase === "settled" && (record.outcome === "ready" || record.terminal === "ready")),
    "FROZEN_ENTRY_CHILD_REBUILD_LIFECYCLE_INVALID",
    { scenarioId: scenario.id, expectedPath, lifecycle },
  );
}

function validateRebuildEvidence(row, nestedPlan) {
  const target = nestedPlan.targets?.[0];
  const expectedOutcome = target?.projectionByOperation?.["move-copy"];
  const expectedPath = target?.rebuildPath;
  const actual = row?.actual;
  const runtime = actual?.runtime;
  const conditions = runtime?.conditions;
  const terminalConditions = runtime?.terminalConditions;
  const requiredConditionKeys = expectedPath === "runtime-candidate"
    ? ["knownExpectedPath", "pathMatches", "sourceMatches", "documentKnown", "generationKnown",
      "documentMatches", "generationMatches", "requestMatches", "candidateMatches", "candidateReady",
      "generationObserved", "activeMatches", "runtimeReady", "noRejectedCandidate"]
    : ["knownPath", "documentChanged", "generationChanged", "sourceMatches", "candidateAbsent", "staticTerminal"];
  const conditionFacts = requiredConditionKeys.every((key) => conditions?.[key] === true);
  const terminalFacts = expectedPath === "runtime-candidate"
    ? terminalConditions?.phaseSettled === true && terminalConditions?.runtimeReady === true
    : terminalConditions?.phaseStatic === true && terminalConditions?.runtimeNotCandidate === true;
  requireCompleteEvidence(row?.operation === "move-copy"
    && row.state === "PASS"
    && ["candidate", "recovered"].includes(expectedOutcome)
    && actual?.outcome === expectedOutcome
    && runtime?.path === expectedPath
    && conditionFacts && terminalFacts
    && Number.isSafeInteger(Number(runtime?.generation)) && Number(runtime.generation) > 0
    && (expectedPath !== "runtime-candidate" || typeof runtime.candidateId === "string")
    && (expectedPath !== "runtime-candidate" || runtime.candidateId.trim() !== ""),
  "FROZEN_ENTRY_CHILD_REBUILD_EVIDENCE_INVALID", {
    expectedOutcome, expectedPath, actual,
  });
}

function validateRebuildContinuation(rows, copyId) {
  const input = rows.find((row) => row?.operation === "input-restored");
  const save = rows.find((row) => row?.operation === "save-restored");
  requireCompleteEvidence(input?.actual?.id === copyId
    && typeof input.actual.appended === "string" && input.actual.appended.length > 0
    && SHA256.test(save?.actual?.restoredSha256 || "")
    && Number.isSafeInteger(save?.actual?.persistedRevision)
    && save.actual.persistedRevision >= 0,
  "FROZEN_ENTRY_CHILD_REBUILD_CONTINUATION_INVALID", { copyId, input: input?.actual, save: save?.actual });
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
  let rows = knownOperationRows(scenario, nestedPlan, report);
  let outputBindings = null;
  if (report.state === "PASS") {
    const reconciled = reconcileOperationLedger(scenario, nestedPlan, report);
    rows = reconciled.rows;
    outputBindings = reconciled.outputBindings;
  }
  const failures = rows.filter((row) => row?.state !== "PASS");
  if (report.state === "PASS") {
    if (rows.length === 0 || failures.length > 0 || report.cleanup !== "PASS") {
      contractError("FROZEN_ENTRY_CHILD_REPORT_INCOMPLETE", `Scenario ${scenario.id} PASS report has incomplete operation evidence.`, {
        operationCount: rows.length,
        incomplete: failures.map((row) => ({ operation: row?.operation, state: row?.state, reason: row?.reason })),
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
    validateOperationEvidence(rows, scenario);
    validateSourceEvidence(report, scenario, nestedPlan);
    validateRuntimeConfiguration(report, scenario, nestedPlan);
    const rebuildRow = rows.find((candidate) => candidate.operation === "move-copy");
    validateLifecycleEvidence(report, scenario, nestedPlan, rebuildRow);
    if (scenario.id === "C") {
      validateRebuildEvidence(rebuildRow, nestedPlan);
      const outputId = copyOutputId(copyOutputRows(report.structureOperations, nestedPlan.targets?.[0]?.selectedId)[0]);
      validateRebuildContinuation(rows, outputId);
      requireCompleteEvidence(report.reopen?.output?.id === outputId
        && report.reopen.output.present === (report.structure?.reopenCopyPresent === true),
      "FROZEN_ENTRY_CHILD_REBUILD_REOPEN_INVALID", { outputId, reopen: report.reopen?.output });
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
    operationLedger: rows.map((row) => ({
      operation: row.operation || null,
      targetId: row.targetId || null,
      state: row.state || null,
      reason: row.reason || null,
      durationMs: Number.isFinite(row.durationMs) ? row.durationMs : null,
    })),
    outputBindings,
    source: report.source,
    display: report.display?.conditions || null,
    finalSource: report.finalSource,
    lifecycle: {
      records: lifecycleRecords,
      candidateRecords: report.lifecycle?.candidateRecords?.length || 0,
      lifecycleRecords: report.lifecycle?.lifecycleRecords?.length || 0,
      reportPath: report.reportPath || null,
    },
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
