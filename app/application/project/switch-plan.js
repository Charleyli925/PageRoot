export function planProjectSwitchEntry({
  disposed = false,
  drainBlockedReason = null,
  projectLoadError = false,
  runLocked = false,
  hasHistoryAction = false,
} = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_WORKFLOW_DISPOSED",
      reason: "项目切换工作流已经停止。",
    });
  }
  if (drainBlockedReason) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_BLOCKED",
      reason: String(drainBlockedReason),
    });
  }
  if (projectLoadError) {
    return Object.freeze({ kind: "ready", action: "reset-failed" });
  }
  if (runLocked) {
    return Object.freeze({ kind: "ready", action: "drain-run-lock" });
  }
  if (hasHistoryAction) {
    return Object.freeze({ kind: "wait", reason: "history" });
  }
  return Object.freeze({ kind: "ready", action: "continue" });
}

export function planProjectSwitchFence({
  needsCanvasCommit = false,
  fenceOk = true,
  fenceReason = "",
} = {}) {
  if (!needsCanvasCommit) {
    return Object.freeze({ kind: "ready" });
  }
  if (!fenceOk) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_NATIVE_EDIT",
      reason: String(fenceReason || "请点回文字完成输入，再切换项目。"),
    });
  }
  return Object.freeze({ kind: "ready" });
}

export function planProjectSwitchValidationLease({
  obligationsResolved = false,
  hasPendingNativeEdit = false,
  hasHistoryAction = false,
  persistState = "idle",
  pendingWrite = false,
  flushInFlight = false,
  editRevision = 0,
  lastPersistedRevision = 0,
  sourcePath = "",
  sourceSha256 = "",
  canvasStatus = "idle",
  renderedSha256 = "",
} = {}) {
  const reusable = obligationsResolved
    && !hasPendingNativeEdit
    && !hasHistoryAction
    && persistState === "idle"
    && !pendingWrite
    && !flushInFlight
    && Number(editRevision) === Number(lastPersistedRevision)
    && Boolean(sourcePath)
    && Boolean(sourceSha256)
    && canvasStatus === "verified"
    && String(renderedSha256) === String(sourceSha256);
  return Object.freeze({
    kind: "ready",
    action: reusable ? "reuse-verified" : "full-check",
  });
}

export function planProjectSwitchAfterDrain({
  editRevision = 0,
  cutoffRevision = 0,
  pendingWrite = false,
  flushInFlight = false,
  hasHistoryAction = false,
  recoveryProtected = false,
} = {}) {
  if (
    Number(editRevision) !== Number(cutoffRevision)
    || (pendingWrite && !recoveryProtected)
    || flushInFlight
    || hasHistoryAction
  ) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_SOURCE_CHANGED",
      reason: "当前 HTML 在切换边界后仍有修改尚未安全写回。",
    });
  }
  return Object.freeze({ kind: "ready" });
}

export function planProjectSwitchAfterCanvas({
  needsCanvasCommit = false,
  canvasOk = true,
  canvasReason = "",
  finalFenceOk = true,
  finalFenceReason = "",
  sourcePath = "",
  lastPersistedRevision = 0,
  cutoffRevision = 0,
  committedSourceSha256 = "",
  documentSourceSha256 = "",
  recoveryProtected = false,
} = {}) {
  if (!needsCanvasCommit) {
    return Object.freeze({ kind: "ready" });
  }
  if (!canvasOk) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_CANVAS_UNVERIFIED",
      reason: String(canvasReason || "当前画布尚未完成自动恢复。"),
    });
  }
  if (!finalFenceOk) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_FINAL_FENCE",
      reason: String(finalFenceReason || "当前画布尚未完成最终安全收口。"),
    });
  }
  if (
    !recoveryProtected
    &&
    sourcePath
    && (
      Number(lastPersistedRevision) !== Number(cutoffRevision)
      || String(documentSourceSha256 || "") !== String(committedSourceSha256 || "")
    )
  ) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_SOURCE_MISMATCH",
      reason: "当前 HTML 与画布的最终身份不一致。",
    });
  }
  return Object.freeze({ kind: "ready" });
}
