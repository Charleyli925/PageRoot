import assert from "node:assert/strict";
import test from "node:test";

import {
  activeRunFromRecord,
  canonicalLifecycleState,
  hasObservedCompletion,
  isLockedLifecycleState,
  validationReviewFromRecord,
} from "../app/domain/run-lifecycle.js";

test("legacy lifecycle names are decoded only at the domain boundary", () => {
  assert.equal(canonicalLifecycleState("waiting"), "processing");
  assert.equal(canonicalLifecycleState("result-ready"), "validating");
  assert.equal(canonicalLifecycleState("canceled"), "cancelled");
  assert.equal(canonicalLifecycleState("unknown"), "processing");
});

test("legacy completed payload with a Version becomes ready-to-open", () => {
  assert.equal(
    canonicalLifecycleState("completed", { readyVersion: true }),
    "ready-to-open",
  );
  assert.equal(
    canonicalLifecycleState("ready", { readyVersion: true }),
    "ready-to-open",
  );
});

test("one canonical lock policy owns lifecycle interaction state", () => {
  assert.equal(isLockedLifecycleState("processing"), true);
  assert.equal(isLockedLifecycleState("ready-to-open"), true);
  assert.equal(isLockedLifecycleState("complete"), false);
  assert.equal(isLockedLifecycleState("cancelled"), false);
});

test("AI completion progress uses explicit evidence instead of generic errors", () => {
  assert.equal(hasObservedCompletion({ status: "processing" }), false);
  assert.equal(hasObservedCompletion({ status: "error" }), false);
  assert.equal(hasObservedCompletion({
    status: "error",
    completionObserved: true,
  }), true);
  assert.equal(hasObservedCompletion({
    status: "awaiting-conflict-resolution",
  }), true);
  assert.equal(hasObservedCompletion({
    status: "recovering-transaction",
  }), true);
});

test("legacy validation review choices are decoded at the domain boundary", () => {
  assert.deepEqual(validationReviewFromRecord({
    status: "waived",
    hardViolationCodes: ["scope"],
    softViolationCodes: ["copy"],
  }), {
    status: "observed",
    hardViolationCodes: ["scope"],
    softViolationCodes: ["copy"],
  });
  assert.equal(validationReviewFromRecord({ status: "unknown" }), null);
});

test("active run records decode transport aliases into one canonical model", () => {
  assert.deepEqual(activeRunFromRecord({
    projectId: "project_1",
    documentId: "document_1",
    requestId: "req_0001",
    lifecycleState: "waiting",
    candidateVersionOrdinal: 3,
    error: { message: "later" },
    conflict: {
      conflictId: "conflict_1",
      candidateSha256: "sha256:candidate",
    },
    validationReview: { status: "waived" },
  }), {
    projectId: "project_1",
    documentId: "document_1",
    requestId: "req_0001",
    attemptId: "attempt_001",
    requestPath: "",
    attemptPath: "",
    handoffMessage: "",
    status: "processing",
    sourcePath: "",
    baseSnapshotSha256: "",
    previousVersionId: null,
    basedOnVersionId: null,
    freezeCutoffRevision: 0,
    candidateVersionId: "",
    candidateVersionLabel: "版本 3",
    submittedAt: "",
    error: "later",
    conflictId: "conflict_1",
    candidateOutputSha256: "sha256:candidate",
    validationReview: {
      status: "observed",
      hardViolationCodes: [],
      softViolationCodes: [],
    },
  });
});
