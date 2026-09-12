import assert from "node:assert/strict";
import test from "node:test";

import {
  createRealHtmlPlan,
  FIXED_STRUCTURE_SAMPLES,
  REAL_HTML_CAPABILITY_PLAN,
  REAL_HTML_OPERATION_IDS,
  REAL_HTML_STAGE_IDS,
} from "./e2e/electron/real-html/plan.mjs";
import { RealHtmlResultReport } from "./e2e/electron/real-html/result-report.mjs";
import { qualificationResultIssues } from "./e2e/electron/real-html/result-model.mjs";
import {
  RUNTIME_LIFECYCLE_REASONS,
  runtimeOperationOutcomes,
} from "./e2e/electron/real-html/runtime-lifecycle.mjs";
import {
  createFixedTextTargetPlan,
  TEXT_TARGET_REASON_CODES,
  validateFrozenTextTarget,
} from "./e2e/electron/real-html/text-targets.mjs";
import {
  CAPABILITY_MATRIX_REASONS,
  CAPABILITY_MATRIX_ROW_KINDS,
  CAPABILITY_MANIFEST_REASONS,
  createCapabilityManifest,
  createCapabilityMatrix,
  recordCapabilityTargetOutcome,
  selectCapabilityTargets,
} from "./e2e/electron/real-html/capability-manifest.mjs";
import {
  CONTINUITY_CHAIN_REASONS,
  evaluateContinuityChain,
  evaluateStaleCandidateFence,
  runtimeProjectionStale,
  STALE_CANDIDATE_REASONS,
} from "./e2e/electron/real-html/continuity-chain.mjs";
import { summarizeRuntimeObserverRecords } from "./e2e/electron/real-html/runtime-observer.mjs";

const VALID_CANDIDATE_EVIDENCE = Object.freeze({
  kind: "candidate-created",
  evidence: "candidate-id-absent-to-present",
  candidateId: "candidate-2",
});

test("real HTML plan always exposes independent A, B, C, D and E stages", () => {
  const plan = createRealHtmlPlan([{ id: "file-001", label: "private fixture 1" }]);
  assert.deepEqual(
    plan.files[0].stages.map(({ id }) => id),
    [
      REAL_HTML_STAGE_IDS.TEXT_EDITING,
      REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
      REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
      REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
      REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
    ],
  );
  assert.equal(
    plan.files[0].stages[0].operations.some(
      ({ id }) => id === REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
    ),
    false,
  );
  assert.equal(
    plan.files[0].stages[0].operations.some(
      ({ id }) => id === REAL_HTML_OPERATION_IDS.TEXT_PASTE,
    ),
    true,
  );
});

test("structure samples require explicit expected-copyability markers", () => {
  assert.match(FIXED_STRUCTURE_SAMPLES.expectedCopyable.selector, /expected-copyable/u);
  assert.match(FIXED_STRUCTURE_SAMPLES.expectedNonCopyable.selector, /expected-non-copyable/u);
  assert.doesNotMatch(FIXED_STRUCTURE_SAMPLES.expectedCopyable.selector, /^p(?:\[|$)/u);
  assert.doesNotMatch(FIXED_STRUCTURE_SAMPLES.expectedNonCopyable.selector, /^canvas(?:\[|$)/u);
});

test("real HTML plan declares the frozen capability matrix sampling contract", () => {
  const plan = createRealHtmlPlan([{ id: "file-001" }]);
  assert.equal(REAL_HTML_CAPABILITY_PLAN.minimumCoverage, 0.6);
  assert.equal(plan.metadata.capabilityPlan.ordering, "tabId/sourceOrder/StableID");
  assert.deepEqual(plan.metadata.capabilityPlan.rowKinds, ["capability-observation", "actual-behavior"]);
  assert.ok(plan.files[0].stages.find(
    ({ id }) => id === REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
  ).operations.some(({ id }) => id === REAL_HTML_OPERATION_IDS.CAPABILITY_MATRIX_RESULT));
  assert.ok(plan.files[0].stages.find(
    ({ id }) => id === REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
  ).operations.some(
    ({ id }) => id === REAL_HTML_OPERATION_IDS.CAPABILITY_RUNTIME_GENERATED_BOUNDARY,
  ));
});

function textSnapshot(id, overrides = {}) {
  return {
    id,
    tag: "p",
    parentId: "pr1_00000000000040008000000000000001",
    documentOrder: 1,
    textLength: 24,
    childCount: 0,
    descendantSourceIds: [],
    sourceIdValid: true,
    domIdentityValid: true,
    visible: true,
    interactive: false,
    sourceEditable: true,
    format: { bold: false, italic: false, underline: false },
    ...overrides,
  };
}

test("text preflight freezes one format-off host plus two ordinary hosts without fallback", () => {
  const snapshots = [
    textSnapshot("pr1_00000000000040008000000000000010", { tag: "h1", format: { bold: true, italic: false, underline: false } }),
    textSnapshot("pr1_00000000000040008000000000000011", { documentOrder: 2 }),
    textSnapshot("pr1_00000000000040008000000000000012", { documentOrder: 3 }),
    textSnapshot("pr1_00000000000040008000000000000013", { documentOrder: 4 }),
  ];
  const plan = createFixedTextTargetPlan(snapshots);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.targets.map(({ id }) => id), [
    snapshots[1].id,
    snapshots[0].id,
    snapshots[2].id,
  ]);
  assert.equal(plan.targets.length, 3);
});

test("text preflight keeps the visible snapshot of one Stable ID across authored tabs", () => {
  const sharedId = "pr1_00000000000040008000000000000010";
  const plan = createFixedTextTargetPlan([
    textSnapshot(sharedId, { visible: false, tabId: "tab-a" }),
    textSnapshot(sharedId, { visible: true, tabId: "tab-b" }),
    textSnapshot("pr1_00000000000040008000000000000011", { documentOrder: 2 }),
    textSnapshot("pr1_00000000000040008000000000000012", { documentOrder: 3 }),
  ]);
  assert.equal(plan.ok, true);
  assert.equal(plan.targets.find((target) => target.id === sharedId)?.tabId, "tab-b");
});

test("text preflight rejects invalid DOM identity and invalid samples instead of selecting a replacement", () => {
  const duplicate = textSnapshot("pr1_00000000000040008000000000000010", {
    domIdentityValid: false,
  });
  const duplicatePlan = createFixedTextTargetPlan([
    duplicate,
    { ...duplicate, documentOrder: 2 },
    textSnapshot("pr1_00000000000040008000000000000011", { documentOrder: 3 }),
  ]);
  assert.equal(duplicatePlan.ok, false);
  assert.equal(duplicatePlan.reasonCode, TEXT_TARGET_REASON_CODES.SNAPSHOT_INCOMPLETE);
  assert.equal(
    duplicatePlan.rejected[0].reasons[0],
    TEXT_TARGET_REASON_CODES.DOM_IDENTITY_INVALID,
  );

  const rejectedPlan = createFixedTextTargetPlan([
    textSnapshot("pr1_00000000000040008000000000000010", {
      descendantSourceIds: ["pr1_00000000000040008000000000000099"],
    }),
    textSnapshot("pr1_00000000000040008000000000000011", { visible: false, documentOrder: 2 }),
    textSnapshot("pr1_00000000000040008000000000000012", { sourceEditable: false, documentOrder: 3 }),
  ]);
  assert.equal(rejectedPlan.ok, false);
  assert.equal(rejectedPlan.reasonCode, TEXT_TARGET_REASON_CODES.SNAPSHOT_INCOMPLETE);
  assert.deepEqual(rejectedPlan.rejected.map(({ reasons }) => reasons[0]), [
    TEXT_TARGET_REASON_CODES.CONTAINER_REJECTED,
    TEXT_TARGET_REASON_CODES.HIDDEN_REJECTED,
    TEXT_TARGET_REASON_CODES.EDITABLE_REJECTED,
  ]);
});

test("text execution revalidates frozen source identity but ignores self-authored order shifts", () => {
  const plan = createFixedTextTargetPlan([
    textSnapshot("pr1_00000000000040008000000000000010"),
    textSnapshot("pr1_00000000000040008000000000000011", { documentOrder: 2 }),
    textSnapshot("pr1_00000000000040008000000000000012", { documentOrder: 3 }),
  ]).targets[0];
  const drifted = validateFrozenTextTarget(
    textSnapshot(plan.id, { parentId: "pr1_00000000000040008000000000000002", documentOrder: 8 }),
    plan,
  );
  assert.equal(drifted.ok, false);
  assert.ok(drifted.reasons.includes(TEXT_TARGET_REASON_CODES.DOM_IDENTITY_DRIFT));
});

test("a failed A category leaves B, C, D and E executable for the same file", () => {
  const report = new RealHtmlResultReport(["file-001"]);
  report.failStage("file-001", REAL_HTML_STAGE_IDS.TEXT_EDITING, {
    exactReason: "TEXT_PREFLIGHT_FAILED",
  });
  const rows = report.rowsForFile("file-001");
  const aRows = rows.filter((row) => row.stageId === REAL_HTML_STAGE_IDS.TEXT_EDITING);
  const laterRows = rows.filter((row) => [
    REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
    REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
    REAL_HTML_STAGE_IDS.CAPABILITY_MATRIX,
    REAL_HTML_STAGE_IDS.CONTINUITY_CHAIN,
  ].includes(row.stageId));
  assert.ok(aRows.some((row) => row.reasonCode === "UPSTREAM_STAGE_FAILED"));
  assert.equal(laterRows.every((row) => row.reasonCode === "NOT_STARTED"), true);
  assert.equal(laterRows.every((row) => row.state === "NOT_EXECUTED"), true);
});

test("runtime facts prove rebuild, Candidate and generation independently", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_DYNAMIC_RECOVERY].state, "NOT_APPLICABLE");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_STATIC_FALLBACK].state, "NOT_APPLICABLE");
});

test("runtime rebuild uses its own reload baseline when no A-stage continuity pair exists", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: null,
    ordinaryAfter: null,
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].details.ordinaryObserved,
    false,
  );
});

test("a static non-candidate document does not require Candidate creation", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: null,
    ordinaryAfter: null,
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateNotApplicableReason:
      RUNTIME_LIFECYCLE_REASONS.STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE,
    candidateEvidence: null,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "NOT_APPLICABLE");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE,
  );
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "PASS");
});

test("failed Runtime preparation cannot make Candidate not applicable", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: null,
    ordinaryAfter: null,
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateNotApplicableReason:
      RUNTIME_LIFECYCLE_REASONS.RUNTIME_PREPARATION_FAILED_BEFORE_CANDIDATE,
    candidateEvidence: null,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "FAIL");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.CANDIDATE_CREATION_NOT_OBSERVED,
  );
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "PASS");
});

test("Runtime projection stale attributes preserve true and false semantics", () => {
  assert.equal(runtimeProjectionStale("false"), false);
  assert.equal(runtimeProjectionStale("true"), true);
  assert.equal(runtimeProjectionStale(null), null);
  assert.equal(runtimeProjectionStale("unknown"), null);
});

test("an unknown Candidate applicability reason cannot hide missing evidence", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: null,
    ordinaryAfter: null,
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateNotApplicableReason: "INVENTED_REASON",
    candidateEvidence: null,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "FAIL");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.CANDIDATE_CREATION_NOT_OBSERVED,
  );
});

test("runtime facts fail when edit rebuilds or reload Candidate evidence is absent", () => {
  const ordinaryRebuild = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-b", generation: "2" },
    reloadBefore: { document: "doc-b", generation: "2" },
    reloadAfter: { document: "doc-c", generation: "3" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.deepEqual(
    ordinaryRebuild[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD],
    {
      state: "FAIL",
      reasonCode: "OPERATION_FAILED",
      details: {
        exactReason: RUNTIME_LIFECYCLE_REASONS.RUNTIME_REBUILD_UNEXPECTED_DURING_ORDINARY_EDIT,
        ordinary: ordinaryRebuild[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].details.ordinary,
        reload: ordinaryRebuild[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].details.reload,
      },
    },
  );

  const missingCandidate = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence: null,
  });
  assert.equal(missingCandidate[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "FAIL");
  assert.equal(
    missingCandidate[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.CANDIDATE_CREATION_NOT_OBSERVED,
  );
});

test("Candidate requires the canonical root absent-to-present event and a non-empty ID", () => {
  for (const candidateEvidence of [
    { kind: "candidate-created", evidence: "candidate-id-absent-to-present", candidateId: "" },
    { kind: "candidate-created", evidence: "candidate-frame-role-transition", candidateId: "candidate-2" },
    { kind: "candidate-created", evidence: "candidate-id-absent-to-present", candidateId: null },
    true,
  ]) {
    const outcomes = runtimeOperationOutcomes({
      ordinaryBefore: { document: "doc-a", generation: "1" },
      ordinaryAfter: { document: "doc-a", generation: "1" },
      reloadBefore: { document: "doc-a", generation: "1" },
      reloadAfter: { document: "doc-b", generation: "2" },
      candidateEvidence,
    });
    assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_CANDIDATE].state, "FAIL");
  }
});

test("runtime rebuild and generation evidence cannot substitute for each other", () => {
  const documentOnly = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-b", generation: "1" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(documentOnly[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(documentOnly[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "FAIL");

  const generationOnly = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "1" },
    ordinaryAfter: { document: "doc-a", generation: "1" },
    reloadBefore: { document: "doc-a", generation: "1" },
    reloadAfter: { document: "doc-a", generation: "2" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(generationOnly[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "FAIL");
  assert.equal(generationOnly[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "PASS");
});

test("runtime generation must advance monotonically", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: "3" },
    ordinaryAfter: { document: "doc-a", generation: "3" },
    reloadBefore: { document: "doc-a", generation: "3" },
    reloadAfter: { document: "doc-b", generation: "2" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "PASS");
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state, "FAIL");
});

test("runtime generation rejects missing, empty and non-numeric identities", () => {
  for (const beforeGeneration of [null, "", "not-a-number", "1.5", "0"]) {
    const outcomes = runtimeOperationOutcomes({
      ordinaryBefore: { document: "doc-a", generation: "1" },
      ordinaryAfter: { document: "doc-a", generation: "1" },
      reloadBefore: { document: "doc-a", generation: beforeGeneration },
      reloadAfter: { document: "doc-b", generation: "2" },
      candidateEvidence: VALID_CANDIDATE_EVIDENCE,
    });
    assert.equal(
      outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_GENERATION].state,
      "FAIL",
      `baseline ${JSON.stringify(beforeGeneration)} must not prove generation advance`,
    );
  }
});

test("runtime rebuild fails closed when identity evidence is missing", () => {
  const outcomes = runtimeOperationOutcomes({
    ordinaryBefore: { document: "doc-a", generation: null },
    ordinaryAfter: { document: "doc-a", generation: "2" },
    reloadBefore: { document: "doc-a", generation: "2" },
    reloadAfter: { document: "doc-b", generation: "3" },
    candidateEvidence: VALID_CANDIDATE_EVIDENCE,
  });
  assert.equal(outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].state, "FAIL");
  assert.equal(
    outcomes[REAL_HTML_OPERATION_IDS.RUNTIME_REBUILD].details.exactReason,
    RUNTIME_LIFECYCLE_REASONS.RUNTIME_IDENTITY_EVIDENCE_INVALID,
  );
});

test("result report records real operation selectors instead of shrinking the plan", () => {
  const report = new RealHtmlResultReport(["file-001"]);
  report.passOperation(
    "file-001",
    REAL_HTML_STAGE_IDS.TEXT_EDITING,
    REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
  );
  const row = report.rowsForFile("file-001").find(
    (candidate) => candidate.operationId === REAL_HTML_OPERATION_IDS.TEXT_ACTIVATE,
  );
  assert.equal(row.state, "PASS");
  assert.equal(report.model.rows.length, report.plan.files[0].stages.reduce(
    (count, stage) => count + stage.operations.length + 1,
    1,
  ));
});

test("result report accepts an object selector for a non-applicable operation", () => {
  const report = new RealHtmlResultReport(["file-001"]);
  report.notApplicableOperation(
    "file-001",
    REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
    REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
    { exactReason: "FIXED_SAMPLE_NOT_FOUND" },
  );
  const row = report.rowsForFile("file-001").find(
    (candidate) => candidate.operationId === REAL_HTML_OPERATION_IDS.STRUCTURE_COPYABLE,
  );
  assert.equal(row.state, "NOT_APPLICABLE");
  assert.equal(row.details.exactReason, "FIXED_SAMPLE_NOT_FOUND");
});

test("qualification audit rejects unresolved rows and non-applicable rows without exact reasons", () => {
  const clean = qualificationResultIssues([
    { level: "operation", state: "PASS", details: null },
    {
      level: "operation",
      state: "NOT_APPLICABLE",
      details: { exactReason: "STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE" },
    },
  ]);
  assert.deepEqual(clean, { unexplainedNotApplicable: [], unresolvedRows: [] });

  const unexplained = { level: "operation", state: "NOT_APPLICABLE", details: {} };
  const unresolved = { level: "stage", state: "NOT_EXECUTED", details: null };
  const rejected = qualificationResultIssues([unexplained, unresolved]);
  assert.deepEqual(rejected.unexplainedNotApplicable, [unexplained]);
  assert.deepEqual(rejected.unresolvedRows, [unresolved]);
});

function capabilityId(number) {
  return `pr1_${String(number).padStart(32, "0")}`;
}

function capabilityEvidence({ allTop = false } = {}) {
  const entries = [
    ["h1", "text", "text-input", "tab-a", "top"],
    ["p", "format", "text-format", "tab-a", "middle"],
    ["li", "structure", "structure-copy", "tab-a", "bottom"],
    ["button", "interaction", "activation", "tab-b", "top"],
    ["table", "table", "table-edit", "tab-b", "middle"],
    ["pre", "code", "code-edit", "tab-b", "bottom"],
    ["a", "link", "link-edit", "tab-b", "bottom"],
  ].map(([tagName, capabilityFamily, behaviorFamily, tabId, region], index) => ({
    id: capabilityId(index + 1),
    tagName,
    pagerootId: capabilityId(index + 1),
    pagerootIdentityStatus: "valid",
    sourceOrder: index,
    capabilityFamilies: [capabilityFamily],
    behaviorFamilies: [behaviorFamily],
    live: {
      stableId: capabilityId(index + 1),
      visible: true,
      isConnected: true,
      tabId,
      region: allTop ? "top" : region,
      tag: tagName,
      type: capabilityFamily,
      capabilityFamilies: [capabilityFamily],
      behaviorFamilies: [behaviorFamily],
    },
  }));
  const sourceElements = entries.map((entry) => ({
    id: entry.id,
    tagName: entry.tagName,
    pagerootId: entry.pagerootId,
    pagerootIdentityStatus: entry.pagerootIdentityStatus,
    sourceOrder: entry.sourceOrder,
    capabilityFamilies: entry.capabilityFamilies,
    behaviorFamilies: entry.behaviorFamilies,
  }));
  const sourceIndex = {
    elements: sourceElements,
    byPagerootId: new Map(sourceElements.map((entry) => [entry.pagerootId, entry])),
    pagerootIdentity: { issues: [] },
  };
  return {
    sourceIndex,
    liveDom: entries.map(({ live }) => live),
  };
}

function admittedCapabilityEvidence(options = {}) {
  return createCapabilityManifest(capabilityEvidence(options));
}

test("capability manifest requires dual authored/source-index and live-DOM Stable-ID proof", () => {
  const id = capabilityId(1);
  const sourceOnly = capabilityId(90);
  const liveOnly = capabilityId(91);
  const invalid = "pr1_not-a-stable-id";
  const evidence = capabilityEvidence();
  evidence.sourceIndex.elements.push({
    nodeId: "element:private-parser-handle",
    tagName: "p",
    sourceOrder: 90,
    capabilityFamilies: ["text"],
  });
  evidence.sourceIndex.elements.push({
    pagerootId: sourceOnly,
    pagerootIdentityStatus: "valid",
    tagName: "p",
    sourceOrder: 90,
    capabilityFamilies: ["text"],
  });
  evidence.sourceIndex.elements.push({
    pagerootId: invalid,
    pagerootIdentityStatus: "invalid",
    tagName: "p",
    sourceOrder: 91,
    capabilityFamilies: ["text"],
  });
  evidence.liveDom.push({
    stableId: liveOnly,
    visible: true,
    isConnected: true,
    tabId: "tab-a",
    region: "top",
    capabilityFamilies: ["text"],
  });
  const manifest = createCapabilityManifest(evidence);
  assert.equal(manifest.entries.some((entry) => entry.elementId === id), true);
  assert.equal(manifest.entries.some((entry) => entry.elementId === "element:private-parser-handle"), false);
  assert.ok(manifest.excluded.some((entry) => entry.reasons.includes(CAPABILITY_MANIFEST_REASONS.SOURCE_ID_MISSING)));
  assert.ok(manifest.excluded.some((entry) => entry.elementId === sourceOnly
    && entry.reasons.includes(CAPABILITY_MANIFEST_REASONS.LIVE_DOM_MISSING)));
  assert.ok(manifest.excluded.some((entry) => entry.elementId === liveOnly
    && entry.reasons.includes(CAPABILITY_MANIFEST_REASONS.SOURCE_ID_NOT_FOUND)));
  assert.ok(manifest.excluded.some((entry) => entry.reasons.includes(CAPABILITY_MANIFEST_REASONS.INVALID_STABLE_ID)));
  assert.equal(manifest.entries.every((entry) => !Object.hasOwn(entry, "nodeId")), true);
  assert.equal(manifest.metadata.noNodeIdFallback, true);
});

test("capability manifest excludes duplicate, hidden, inert, generated and no-capability elements with reasons", () => {
  const evidence = capabilityEvidence();
  const add = (id, sourceOverrides, liveOverrides) => {
    const source = {
      pagerootId: id,
      pagerootIdentityStatus: "valid",
      tagName: "div",
      sourceOrder: 100 + evidence.sourceIndex.elements.length,
      ...sourceOverrides,
    };
    evidence.sourceIndex.elements.push(source);
    evidence.sourceIndex.byPagerootId.set(id, source);
    evidence.liveDom.push({
      stableId: id,
      visible: true,
      isConnected: true,
      tabId: "tab-a",
      region: "middle",
      capabilityFamilies: ["text"],
      ...liveOverrides,
    });
  };
  const duplicateId = capabilityId(101);
  add(duplicateId, { capabilityFamilies: ["text"] }, { capabilityFamilies: ["text"] });
  evidence.sourceIndex.elements.push({
    pagerootId: duplicateId,
    pagerootIdentityStatus: "valid",
    tagName: "div",
    sourceOrder: 102,
    capabilityFamilies: ["text"],
  });
  add(capabilityId(102), { capabilityFamilies: ["text"] }, { visible: false });
  add(capabilityId(103), { capabilityFamilies: ["text"] }, { inert: true });
  add(capabilityId(104), { capabilityFamilies: ["text"] }, { runtimeGenerated: true });
  add(capabilityId(105), {}, { capabilityFamilies: [] });
  const manifest = createCapabilityManifest(evidence);
  const reasonFor = (id) => manifest.excluded.find((entry) => entry.elementId === id)?.reasons || [];
  assert.ok(reasonFor(duplicateId).includes(CAPABILITY_MANIFEST_REASONS.DUPLICATE_STABLE_ID));
  assert.ok(reasonFor(capabilityId(102)).includes(CAPABILITY_MANIFEST_REASONS.HIDDEN_ELEMENT));
  assert.ok(reasonFor(capabilityId(103)).includes(CAPABILITY_MANIFEST_REASONS.INERT_ELEMENT));
  assert.ok(reasonFor(capabilityId(104)).includes(CAPABILITY_MANIFEST_REASONS.LIVE_RUNTIME_GENERATED));
  assert.ok(reasonFor(capabilityId(105)).includes(CAPABILITY_MANIFEST_REASONS.NO_CAPABILITY));
});

test("capability target selection covers dimensions before the deterministic ceil(60%) fill", () => {
  const manifest = admittedCapabilityEvidence();
  const first = selectCapabilityTargets(manifest);
  const second = selectCapabilityTargets(manifest);
  assert.deepEqual(
    first.selected.map((entry) => entry.elementId),
    second.selected.map((entry) => entry.elementId),
  );
  assert.ok(first.selected.length >= Math.ceil(manifest.entries.length * 0.6));
  assert.deepEqual(first.order, "tabId/sourceOrder/StableID");
  for (const family of manifest.capabilityFamilies) {
    assert.equal(first.selected.some((entry) => entry.capabilityFamilies.includes(family)), true);
  }
  for (const region of ["top", "middle", "bottom"]) {
    assert.equal(first.selected.some((entry) => entry.region === region), true);
  }
  for (const tabId of manifest.tabs) assert.equal(first.selected.some((entry) => entry.tabId === tabId), true);
  for (const majorType of manifest.majorTypes) {
    assert.equal(first.selected.some((entry) => entry.type === majorType), true);
  }
});

test("failed fixed capability target is retained and never replaced", () => {
  const selection = selectCapabilityTargets(admittedCapabilityEvidence());
  const before = selection.selected.map((entry) => entry.elementId);
  const failed = recordCapabilityTargetOutcome(selection, before[0], {
    state: "FAIL",
    reasonCode: "CAPABILITY_ACTION_FAILED",
  });
  assert.deepEqual(failed.selected.map((entry) => entry.elementId), before);
  assert.deepEqual(failed.replacements, []);
  assert.deepEqual(failed.failedElementIds, [before[0]]);
  assert.equal(failed.selected[0].outcome.state, "FAIL");
});

function passingCapabilityMatrix(overrides = {}) {
  const manifest = admittedCapabilityEvidence();
  const selection = selectCapabilityTargets(manifest);
  return createCapabilityMatrix({
    manifest,
    selection,
    observations: selection.selected.map((entry) => ({
      elementId: entry.elementId,
      capabilityFamily: entry.capabilityFamilies[0],
      state: "PASS",
      reasonCode: CAPABILITY_MATRIX_REASONS.OBSERVED,
    })),
    behaviors: manifest.behaviorFamilies.map((behaviorFamily) => ({
      elementId: selection.selected[0].elementId,
      behaviorFamily,
      kind: CAPABILITY_MATRIX_ROW_KINDS.BEHAVIOR,
      assigned: true,
      state: "PASS",
      reasonCode: CAPABILITY_MATRIX_REASONS.BEHAVIOR_OBSERVED,
    })),
    originalSource: { hash: "sha256:original", size: 100 },
    observedSource: { hash: "sha256:original", size: 100 },
    ...overrides,
  });
}

test("capability matrix separates observations from actual behavior and passes complete evidence", () => {
  const matrix = passingCapabilityMatrix();
  assert.equal(matrix.verdict.ok, true);
  assert.equal(matrix.observations.every((row) => row.kind === CAPABILITY_MATRIX_ROW_KINDS.OBSERVATION), true);
  assert.equal(matrix.actualBehaviors.every((row) => row.kind === CAPABILITY_MATRIX_ROW_KINDS.BEHAVIOR), true);
  assert.equal(matrix.verdict.coveredElementIds.length, new Set(matrix.verdict.coveredElementIds).size);
  assert.equal(matrix.verdict.coverage >= 0.6, true);
});

test("capability matrix rejects under-60 coverage, all-top selection and missing dimensions", () => {
  const underCovered = passingCapabilityMatrix({
    observations: [],
  });
  assert.equal(underCovered.verdict.ok, false);
  assert.ok(underCovered.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.COVERAGE_BELOW_THRESHOLD));

  const allTopManifest = admittedCapabilityEvidence({ allTop: true });
  const allTopSelection = selectCapabilityTargets(allTopManifest);
  const allTop = createCapabilityMatrix({
    manifest: allTopManifest,
    selection: allTopSelection,
    observations: allTopSelection.selected.map((entry) => ({ elementId: entry.elementId, state: "PASS" })),
    originalSource: { hash: "sha256:top", size: 100 },
    observedSource: { hash: "sha256:top", size: 100 },
  });
  assert.equal(allTop.verdict.ok, false);
  assert.ok(allTop.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.MISSING_REGION));
  assert.ok(allTop.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.MISSING_MAJOR_TYPE) === false);

  const missingBehavior = passingCapabilityMatrix({
    requiredBehaviorFamilies: ["not-executed-family"],
  });
  assert.equal(missingBehavior.verdict.ok, false);
  assert.ok(missingBehavior.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.MISSING_BEHAVIOR_FAMILY));
});

test("capability matrix rejects failure states, unassigned behavior, timeout, empty reason and source changes", () => {
  for (const state of ["FAIL", "NOT_EXECUTED", "BLOCKED", "UNKNOWN"]) {
    const matrix = passingCapabilityMatrix({
      observations: [{ elementId: capabilityId(1), state, reasonCode: state === "UNKNOWN" ? "UNKNOWN_EVIDENCE" : "ACTION_FAILED" }],
    });
    assert.equal(matrix.verdict.ok, false, state);
  }
  const unassigned = passingCapabilityMatrix({
    behaviors: [{
      elementId: capabilityId(1),
      behaviorFamily: "activation",
      kind: CAPABILITY_MATRIX_ROW_KINDS.BEHAVIOR,
      assigned: false,
      state: "PASS",
      reasonCode: CAPABILITY_MATRIX_REASONS.UNASSIGNED_BEHAVIOR,
    }],
    requiredBehaviorFamilies: ["activation"],
  });
  assert.equal(unassigned.verdict.ok, false);
  assert.ok(unassigned.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.MISSING_BEHAVIOR_FAMILY));

  const timeout = passingCapabilityMatrix({ harnessState: "HARNESS_TIMEOUT" });
  assert.equal(timeout.verdict.ok, false);
  assert.ok(timeout.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.HARNESS_TIMEOUT));

  const emptyReason = passingCapabilityMatrix({
    observations: [{ elementId: capabilityId(1), state: "FAIL", reasonCode: "" }],
  });
  assert.ok(emptyReason.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.ROW_REASON_EMPTY));

  const changedHash = passingCapabilityMatrix({
    observedSource: { hash: "sha256:changed", size: 100 },
  });
  assert.ok(changedHash.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.ORIGINAL_SOURCE_HASH_CHANGED));
  const changedSize = passingCapabilityMatrix({
    observedSource: { hash: "sha256:original", size: 101 },
  });
  assert.ok(changedSize.verdict.failures.some((failure) => failure.code === CAPABILITY_MATRIX_REASONS.ORIGINAL_SOURCE_SIZE_CHANGED));
});

function fullContinuityEvidence() {
  return {
    request: { sourceRevision: "sha256:source-2", reason: "structure-edit", status: "submitted" },
    candidate: { candidateId: "candidate-2", sourceRevision: "sha256:source-2", status: "ready" },
    generation: { before: 1, after: 2, observed: true },
    active: { candidateId: "candidate-2", generation: 2, documentId: "runtime-doc-2" },
    runtime: { candidateId: "candidate-2", generation: 2, documentId: "runtime-doc-2", terminal: true, phase: "settled", outcome: "ready" },
    rebuildSource: { hash: "sha256:source-2", size: 180 },
    workingSource: { hash: "sha256:source-2", size: 200 },
    displayedSource: {
      hash: "sha256:source-2",
      workingProjectionHash: "sha256:source-2",
      stale: false,
      size: 200,
    },
    selection: {
      expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      after: { elementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", connected: true },
      focus: {
        activeElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        anchorElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        focusElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      },
    },
    previousTargetRetired: true,
    ordinaryEdit: {
      before: { documentId: "runtime-doc-1", generation: 1 },
      after: { documentId: "runtime-doc-1", generation: 1 },
    },
    continuation: {
      mode: "session-ended",
      expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      directInputApplied: false,
      directTargetId: null,
      sessionEnded: true,
      relocatedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      relocatedInputApplied: true,
    },
  };
}

test("continuity chain passes only when each request, Candidate, generation, Active, Runtime, source and focus fact is present", () => {
  const chain = evaluateContinuityChain(fullContinuityEvidence());
  assert.equal(chain.ok, true);
  assert.equal(chain.state, "PASS");
  for (const part of [
    "request",
    "candidateIdentity",
    "candidateTerminal",
    "generation",
    "activeIdentity",
    "runtimeTerminal",
    "sourceConsistency",
    "selection",
    "focus",
    "continuation",
    "previousTarget",
  ]) assert.equal(chain.parts[part].state, "PASS", part);
});

test("continuity chain does not substitute generation for Candidate/ID or Candidate terminal", () => {
  const generationOnly = fullContinuityEvidence();
  delete generationOnly.candidate;
  const noCandidate = evaluateContinuityChain(generationOnly);
  assert.equal(noCandidate.ok, false);
  assert.equal(noCandidate.parts.candidateIdentity.reasonCode, CONTINUITY_CHAIN_REASONS.CANDIDATE_MISSING);

  const noTerminal = fullContinuityEvidence();
  delete noTerminal.candidate.status;
  const candidateOnly = evaluateContinuityChain(noTerminal);
  assert.equal(candidateOnly.ok, false);
  assert.equal(candidateOnly.parts.candidateIdentity.state, "PASS");
  assert.equal(candidateOnly.parts.candidateTerminal.reasonCode, CONTINUITY_CHAIN_REASONS.CANDIDATE_TERMINAL_MISSING);
});

test("continuity chain rejects wrong Candidate promotion and stale Candidate source", () => {
  const wrongPromotion = fullContinuityEvidence();
  wrongPromotion.active.candidateId = "candidate-old";
  const wrong = evaluateContinuityChain(wrongPromotion);
  assert.equal(wrong.parts.candidateIdentity.state, "PASS");
  assert.equal(wrong.parts.activeIdentity.reasonCode, CONTINUITY_CHAIN_REASONS.ACTIVE_CANDIDATE_MISMATCH);

  const stale = fullContinuityEvidence();
  stale.candidate.sourceRevision = "sha256:old-source";
  stale.request.sourceRevision = "sha256:old-source";
  const staleResult = evaluateContinuityChain(stale);
  assert.equal(staleResult.ok, false);
  assert.equal(staleResult.parts.candidateIdentity.reasonCode, CONTINUITY_CHAIN_REASONS.CANDIDATE_SOURCE_MISMATCH);
});

test("continuity chain rejects a Candidate attached to a different rebuild request", () => {
  const mismatched = fullContinuityEvidence();
  mismatched.request.sourceRevision = "sha256:request-source";
  const result = evaluateContinuityChain(mismatched);
  assert.equal(result.ok, false);
  assert.equal(
    result.parts.candidateIdentity.reasonCode,
    CONTINUITY_CHAIN_REASONS.CANDIDATE_REQUEST_MISMATCH,
  );
});

test("continuity chain compares Candidate to the rebuild snapshot, not later continuation source", () => {
  const continued = fullContinuityEvidence();
  continued.workingSource = { hash: "sha256:source-3", size: 220 };
  continued.displayedSource = {
    hash: "sha256:source-3",
    workingProjectionHash: "sha256:source-3",
    stale: false,
    size: 220,
  };
  const result = evaluateContinuityChain(continued);
  assert.equal(result.ok, true);
  assert.equal(result.parts.candidateIdentity.state, "PASS");
  assert.equal(result.parts.sourceConsistency.state, "PASS");
});

test("continuity chain rejects wrong or detached selection, ordinary rebuild, unknown and timeout evidence", () => {
  const wrongSelection = fullContinuityEvidence();
  wrongSelection.selection.after.elementId = "pr1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  const wrong = evaluateContinuityChain(wrongSelection);
  assert.equal(wrong.parts.selection.reasonCode, CONTINUITY_CHAIN_REASONS.SELECTION_ELEMENT_MISMATCH);

  const detached = fullContinuityEvidence();
  detached.selection.after.connected = false;
  const detachedResult = evaluateContinuityChain(detached);
  assert.equal(detachedResult.parts.selection.reasonCode, CONTINUITY_CHAIN_REASONS.DETACHED_LOCATOR);

  const rebuilt = fullContinuityEvidence();
  rebuilt.ordinaryEdit.after.generation = 2;
  const rebuiltResult = evaluateContinuityChain(rebuilt);
  assert.equal(rebuiltResult.parts.ordinaryEdit.reasonCode, CONTINUITY_CHAIN_REASONS.ORDINARY_EDIT_REBUILT_RUNTIME);

  const missingOrdinary = fullContinuityEvidence();
  delete missingOrdinary.ordinaryEdit;
  const missingOrdinaryResult = evaluateContinuityChain(missingOrdinary);
  assert.equal(
    missingOrdinaryResult.parts.ordinaryEdit.reasonCode,
    CONTINUITY_CHAIN_REASONS.ORDINARY_EDIT_EVIDENCE_MISSING,
  );

  const missingSelectionIdentity = fullContinuityEvidence();
  delete missingSelectionIdentity.selection.after.elementId;
  delete missingSelectionIdentity.selection.focus;
  const missingSelectionResult = evaluateContinuityChain(missingSelectionIdentity);
  assert.equal(missingSelectionResult.ok, false);
  assert.equal(
    missingSelectionResult.parts.selection.reasonCode,
    CONTINUITY_CHAIN_REASONS.SELECTION_MISSING,
  );
  assert.equal(
    missingSelectionResult.parts.focus.reasonCode,
    CONTINUITY_CHAIN_REASONS.FOCUS_ELEMENT_MISMATCH,
  );

  const wrongContinuation = fullContinuityEvidence();
  wrongContinuation.continuation = {
    mode: "without-refocus",
    expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    directInputApplied: true,
    directTargetId: "pr1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  };
  const wrongContinuationResult = evaluateContinuityChain(wrongContinuation);
  assert.equal(
    wrongContinuationResult.parts.continuation.reasonCode,
    CONTINUITY_CHAIN_REASONS.CONTINUATION_WRONG_TARGET,
  );

  const unknown = evaluateContinuityChain({ ...fullContinuityEvidence(), harnessStatus: "UNKNOWN" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.failures[0].code, CONTINUITY_CHAIN_REASONS.UNKNOWN_EVIDENCE);

  const timeout = evaluateContinuityChain({ ...fullContinuityEvidence(), harnessTimeout: true });
  assert.equal(timeout.ok, false);
  assert.equal(timeout.failures[0].code, CONTINUITY_CHAIN_REASONS.HARNESS_TIMEOUT);
});

test("explicit static N/A applies only to Candidate facts and cannot hide other missing evidence", () => {
  const staticResult = evaluateContinuityChain({
    request: { sourceRevision: "sha256:static", status: "submitted" },
    staticNotApplicableReason: RUNTIME_LIFECYCLE_REASONS.STATIC_DOCUMENT_HAS_NO_RUNTIME_CANDIDATE,
  });
  assert.equal(staticResult.ok, false);
  assert.equal(staticResult.parts.candidateIdentity.state, "NOT_APPLICABLE");
  assert.equal(staticResult.parts.candidateTerminal.state, "NOT_APPLICABLE");

  const preparationFailed = evaluateContinuityChain({
    request: { sourceRevision: "sha256:failed", status: "submitted" },
    staticNotApplicableReason:
      RUNTIME_LIFECYCLE_REASONS.RUNTIME_PREPARATION_FAILED_BEFORE_CANDIDATE,
  });
  assert.equal(preparationFailed.parts.candidateIdentity.state, "FAIL");
  assert.equal(
    preparationFailed.parts.candidateIdentity.reasonCode,
    CONTINUITY_CHAIN_REASONS.CANDIDATE_MISSING,
  );

  const unexplained = evaluateContinuityChain({
    request: { sourceRevision: "sha256:no-candidate", status: "submitted" },
    generation: { before: 1, after: 2 },
  });
  assert.equal(unexplained.ok, false);
  assert.equal(unexplained.parts.candidateIdentity.reasonCode, CONTINUITY_CHAIN_REASONS.CANDIDATE_MISSING);
});

function fullStaleCandidateEvidence() {
  return {
    heldCandidate: {
      candidateId: "candidate-held",
      activeCandidateId: "candidate-active",
      sourceRevision: "sha256:held",
    },
    heldSource: { hash: "sha256:held", size: 180 },
    latestSource: { hash: "sha256:latest", size: 195 },
    continuation: {
      expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      directInputApplied: false,
      directTargetId: null,
      sessionEnded: true,
      relocatedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      relocatedInputApplied: true,
    },
    finalSource: {
      hash: "sha256:latest",
      workingHash: "sha256:latest",
      displayedHash: "sha256:latest",
      stale: false,
      latestMarkerPresent: true,
    },
  };
}

test("stale Candidate fence accepts both safe continuation modes and preserves the latest source", () => {
  const relocated = evaluateStaleCandidateFence(fullStaleCandidateEvidence());
  assert.equal(relocated.ok, true);

  const direct = fullStaleCandidateEvidence();
  direct.continuation = {
    expectedElementId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    directInputApplied: true,
    directTargetId: "pr1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    sessionEnded: false,
    relocatedElementId: null,
    relocatedInputApplied: false,
  };
  assert.equal(evaluateStaleCandidateFence(direct).ok, true);
});

test("stale Candidate fence rejects wrong delivery and stale overwrite independently", () => {
  const wrongCandidateRevision = fullStaleCandidateEvidence();
  wrongCandidateRevision.heldCandidate.sourceRevision = "sha256:wrong-held";
  assert.equal(
    evaluateStaleCandidateFence(wrongCandidateRevision).parts.sourceAdvance.reasonCode,
    STALE_CANDIDATE_REASONS.HELD_CANDIDATE_SOURCE_MISMATCH,
  );

  const wrongTarget = fullStaleCandidateEvidence();
  wrongTarget.continuation.directInputApplied = true;
  wrongTarget.continuation.directTargetId = "pr1_bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  assert.equal(
    evaluateStaleCandidateFence(wrongTarget).parts.continuation.reasonCode,
    STALE_CANDIDATE_REASONS.CONTINUATION_WRONG_TARGET,
  );

  const overwritten = fullStaleCandidateEvidence();
  overwritten.finalSource = {
    hash: "sha256:held",
    workingHash: "sha256:held",
    displayedHash: "sha256:held",
    stale: false,
    latestMarkerPresent: false,
  };
  const overwrittenResult = evaluateStaleCandidateFence(overwritten);
  assert.equal(overwrittenResult.ok, false);
  assert.equal(
    overwrittenResult.parts.finalSource.reasonCode,
    STALE_CANDIDATE_REASONS.STALE_CANDIDATE_OVERWROTE_SOURCE,
  );

  const staleProjection = fullStaleCandidateEvidence();
  staleProjection.finalSource.displayedHash = "sha256:held";
  staleProjection.finalSource.stale = true;
  assert.equal(
    evaluateStaleCandidateFence(staleProjection).parts.finalSource.reasonCode,
    STALE_CANDIDATE_REASONS.FINAL_PROJECTION_STALE,
  );
});

test("runtime observer summaries keep Candidate, generation and Runtime terminal observations independent", () => {
  const summary = summarizeRuntimeObserverRecords([
    { kind: "candidate-created", evidence: "candidate-id-absent-to-present", candidateId: "candidate-2" },
    { kind: "generation", beforeGeneration: "1", afterGeneration: "2" },
    { kind: "candidate-terminal", terminal: "ready", candidateId: "candidate-2" },
    {
      kind: "runtime-terminal",
      terminal: "ready",
      phase: "settled",
      outcome: "ready",
      candidateId: "candidate-2",
      generation: "2",
    },
  ]);
  assert.equal(summary.hasCandidate, true);
  assert.equal(summary.hasGeneration, true);
  assert.equal(summary.hasCandidateTerminal, true);
  assert.equal(summary.hasRuntimeTerminal, true);
  assert.equal(summary.candidate.candidateId, "candidate-2");
  assert.equal(summary.generation.beforeGeneration, "1");
  assert.equal(summary.candidateTerminal.terminal, "ready");
  assert.equal(summary.runtimeTerminal.terminal, "ready");
});
