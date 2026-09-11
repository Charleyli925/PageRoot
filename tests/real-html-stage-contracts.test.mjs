import assert from "node:assert/strict";
import test from "node:test";

import {
  createRealHtmlPlan,
  FIXED_STRUCTURE_SAMPLES,
  REAL_HTML_OPERATION_IDS,
  REAL_HTML_STAGE_IDS,
} from "./e2e/electron/real-html/plan.mjs";
import { RealHtmlResultReport } from "./e2e/electron/real-html/result-report.mjs";
import {
  RUNTIME_LIFECYCLE_REASONS,
  runtimeOperationOutcomes,
} from "./e2e/electron/real-html/runtime-lifecycle.mjs";

const VALID_CANDIDATE_EVIDENCE = Object.freeze({
  kind: "candidate-created",
  evidence: "candidate-id-absent-to-present",
  candidateId: "candidate-2",
});

test("real HTML plan always exposes independent A, B and C stages", () => {
  const plan = createRealHtmlPlan([{ id: "file-001", label: "private fixture 1" }]);
  assert.deepEqual(
    plan.files[0].stages.map(({ id }) => id),
    [
      REAL_HTML_STAGE_IDS.TEXT_EDITING,
      REAL_HTML_STAGE_IDS.ELEMENT_STRUCTURE,
      REAL_HTML_STAGE_IDS.RUNTIME_IFRAME,
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
