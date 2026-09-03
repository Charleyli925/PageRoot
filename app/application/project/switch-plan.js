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
  persistedSourceSha256 = sourceSha256,
  workingHtmlSha256 = persistedSourceSha256,
  canvasStatus = "idle",
  renderedSha256 = "",
  canvasRenderedSha256 = renderedSha256,
} = {}) {
  const reusable = obligationsResolved
    && !hasPendingNativeEdit
    && !hasHistoryAction
    && persistState === "idle"
    && !pendingWrite
    && !flushInFlight
    && Number(editRevision) === Number(lastPersistedRevision)
    && Boolean(sourcePath)
    && Boolean(persistedSourceSha256)
    && Boolean(workingHtmlSha256)
    && canvasStatus === "verified"
    && String(canvasRenderedSha256) === String(workingHtmlSha256)
    && String(workingHtmlSha256) === String(persistedSourceSha256);
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

export function planProjectSwitchAfterSourceProtection({
  needsSourceProtection = false,
  sourcePath = "",
  lastPersistedRevision = 0,
  cutoffRevision = 0,
  committedSourceSha256 = "",
  documentSourceSha256 = "",
  persistedSourceSha256 = documentSourceSha256,
  workingHtmlSha256 = persistedSourceSha256,
  protectionHtmlSha256 = "",
  recoveryProtected = false,
} = {}) {
  if (!needsSourceProtection) {
    return Object.freeze({ kind: "ready" });
  }
  const workingHash = String(workingHtmlSha256 || "");
  const committedHash = String(committedSourceSha256 || "");
  if (recoveryProtected && (
    !workingHash
    || committedHash !== workingHash
    || String(protectionHtmlSha256 || "") !== workingHash
  )) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_PROTECTION_MISMATCH",
      reason: "当前 HTML、画布与恢复保护凭证不一致。",
    });
  }
  if (!recoveryProtected && sourcePath && (
    Number(lastPersistedRevision) !== Number(cutoffRevision)
    || String(persistedSourceSha256 || "") !== workingHash
    || committedHash !== workingHash
  )) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_SWITCH_SOURCE_MISMATCH",
      reason: "当前 HTML 与已持久化源的最终身份不一致。",
    });
  }
  return Object.freeze({ kind: "ready" });
}
