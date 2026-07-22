function closeAbortReason(error) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "桌面外壳未能完成安全关闭，应用已保持开启。";
}

export function closeAbortPayload(requestId, error) {
  if (typeof requestId !== "string" || requestId.length < 8 || requestId.length > 100) {
    return null;
  }
  return Object.freeze({
    requestId,
    reason: closeAbortReason(error).slice(0, 500),
  });
}

export async function stopBridgeOrNotifyCloseAborted({
  requestId,
  stopBridge,
  notifyCloseAborted,
}) {
  if (typeof stopBridge !== "function" || typeof notifyCloseAborted !== "function") {
    throw new TypeError("关闭恢复处理器配置无效。");
  }
  try {
    return await stopBridge();
  } catch (error) {
    const payload = closeAbortPayload(requestId, error);
    if (payload) await notifyCloseAborted(payload);
    throw error;
  }
}

export function canCloseDuringHydration({
  projectHydrating,
  viewTransitioning,
  submissionPending,
  persistState,
  pendingWrite,
  flushInProgress,
  draftPending,
  draftFlushInProgress,
  editRevision,
  lastPersistedRevision,
}) {
  return Boolean(
    projectHydrating
    && !viewTransitioning
    && !submissionPending
    && persistState === "idle"
    && !pendingWrite
    && !flushInProgress
    && !draftPending
    && !draftFlushInProgress
    && Number.isSafeInteger(editRevision)
    && Number.isSafeInteger(lastPersistedRevision)
    && editRevision <= lastPersistedRevision
  );
}

export function shouldRecoverEditorAfterCloseAbort({
  approvedRequestId,
  abortedRequestId,
  imposedEditorFreeze,
  projectLocked,
  projectHydrating,
  projectLoadError,
  viewTransitioning,
  submissionPending,
  persistState,
  pendingWrite,
  flushInProgress,
  draftPending,
  draftFlushInProgress,
  draftPersistError,
  editRevision,
  lastPersistedRevision,
}) {
  return Boolean(
    imposedEditorFreeze
    && typeof approvedRequestId === "string"
    && approvedRequestId === abortedRequestId
    && !projectLocked
    && !projectHydrating
    && !projectLoadError
    && !viewTransitioning
    && !submissionPending
    && persistState === "idle"
    && !pendingWrite
    && !flushInProgress
    && !draftPending
    && !draftFlushInProgress
    && !draftPersistError
    && Number.isSafeInteger(editRevision)
    && Number.isSafeInteger(lastPersistedRevision)
    && editRevision <= lastPersistedRevision
  );
}
