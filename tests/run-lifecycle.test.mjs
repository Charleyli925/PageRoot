import assert from "node:assert/strict";
import test from "node:test";

import {
  activeRunFromRecord,
  candidateAssessmentFromRecord,
  canonicalLifecycleState,
  deriveRunProgressSteps,
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

test("run progress exposes four user stages instead of internal validation steps", () => {
  const processing = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "processing",
  }, "copied");
  assert.deepEqual(
    processing.map(({ label, state }) => ({ label, state })),
    [
      { label: "已准备并复制", state: "done" },
      { label: "等待 AI 完成", state: "current" },
      { label: "正在校验并保存", state: "pending" },
      { label: "结果", state: "pending" },
    ],
  );
  assert.equal(
    processing[2].detail,
    "等待 AI 完成后自动校验并写入本地",
  );

  const copyFailure = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "processing",
  }, "failed");
  assert.equal(copyFailure.length, 4);
  assert.deepEqual(
    copyFailure.map(({ state }) => state),
    ["error", "pending", "pending", "pending"],
  );
  assert.equal(
    copyFailure[0].detail,
    "剪贴板写入失败；本轮要求已安全保留",
  );
});

test("run progress keeps completion, validation, and result facts separate", () => {
  const preCompletionError = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "error",
    error: "Attempt contains an unauthorized entry.",
  }, "copied");
  assert.deepEqual(
    preCompletionError.map(({ state }) => state),
    ["done", "error", "pending", "error"],
  );

  const validationError = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "error",
    completionObserved: true,
    error: "结果 Hash 不一致",
  }, "copied");
  assert.deepEqual(
    validationError.map(({ state }) => state),
    ["done", "done", "error", "error"],
  );
  assert.equal(validationError[2].detail, "结果 Hash 不一致");

  const ready = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "ready-to-open",
  });
  assert.deepEqual(
    ready.map(({ state }) => state),
    ["done", "done", "done", "current"],
  );
  assert.equal(ready[3].label, "新版本已准备好");
  assert.equal(ready[3].detail, "旧版未被覆盖，等待你审阅或直接打开");

  const continuityAttention = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "ready-to-open",
    candidateAssessment: {
      status: "attention",
    },
  });
  assert.deepEqual(
    continuityAttention.map(({ state }) => state),
    ["done", "done", "attention", "current"],
  );
  assert.equal(
    continuityAttention[3].detail,
    "页面变化较大，请先对比审阅再决定是否采用",
  );

  const noChange = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "no-change",
  });
  assert.deepEqual(
    noChange.map(({ state }) => state),
    ["done", "done", "done", "neutral"],
  );

  const conflict = deriveRunProgressSteps({
    requestId: "req_0001",
    status: "awaiting-conflict-resolution",
  });
  assert.deepEqual(
    conflict.map(({ state }) => state),
    ["done", "done", "error", "current"],
  );
  assert.equal(conflict[3].label, "请选择当前 HTML");
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

test("candidate assessment exposes only the renderer fields needed for review", () => {
  assert.deepEqual(candidateAssessmentFromRecord({
    status: "attention",
    issueCodes: ["PAGE_CONTINUITY_UNCERTAIN"],
    health: {
      completeDocument: true,
      bodyHasContent: true,
      // Legacy records can still carry this retired field; the renderer
      // decoder intentionally ignores it.
      executableSurfaceUnchanged: true,
    },
    continuity: { status: "uncertain", evidencePoints: 0 },
  }), {
    status: "attention",
    issueCodes: ["PAGE_CONTINUITY_UNCERTAIN"],
    health: {
      completeDocument: true,
      bodyHasContent: true,
    },
    continuity: { status: "uncertain" },
  });
  assert.equal(candidateAssessmentFromRecord({ status: "unknown" }), null);
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
    error: "本轮没有收到可用的完成结果，页面和评论仍然保留。",
    conflictId: "conflict_1",
    candidateOutputSha256: "sha256:candidate",
    validationReview: {
      status: "observed",
      hardViolationCodes: [],
      softViolationCodes: [],
    },
  });
});

test("active run errors are localized without exposing internal messages or codes", () => {
  const legacyExecutableFailure = activeRunFromRecord({
    requestId: "req_0002",
    status: "error",
    completionObserved: true,
    error: {
      code: "EXECUTABLE_CONTENT_CHANGED",
      message: "The candidate HTML could not be safely adopted.",
    },
  });
  assert.equal(
    legacyExecutableFailure.error,
    "返回的 HTML 无法安全采用，当前页面没有被覆盖。",
  );
  assert.equal(
    legacyExecutableFailure.errorCode,
    "EXECUTABLE_CONTENT_CHANGED",
  );
  assert.doesNotMatch(
    legacyExecutableFailure.error,
    /EXECUTABLE|candidate|脚本/iu,
  );

  const legacyScopeFailure = activeRunFromRecord({
    requestId: "req_0003",
    status: "error",
    completionObserved: true,
    error: {
      code: "HARD_VALIDATION_FAILED",
      message: "AI output failed: TARGET_AMBIGUOUS, TARGET_OUTSIDE_STRUCTURE",
    },
  });
  assert.equal(
    legacyScopeFailure.error,
    "返回的 HTML 无法安全采用，当前页面没有被覆盖。",
  );
  assert.doesNotMatch(legacyScopeFailure.error, /TARGET_|HARD_/u);
});
