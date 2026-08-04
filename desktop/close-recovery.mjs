function closeAbortReason(error) {
  if (error instanceof Error && error.message.trim()) return error.message.trim();
  if (typeof error === "string" && error.trim()) return error.trim();
  return "桌面外壳未能完成安全关闭，应用已保持开启。";
}

export function normalizeCloseResult(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("关闭确认结果无效。");
  }
  const allowedKeys = new Set([
    "requestId",
    "ready",
    "reason",
    "presentation",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("关闭确认结果包含未支持的字段。");
  }
  if (
    typeof payload.requestId !== "string"
    || payload.requestId.length < 8
    || payload.requestId.length > 100
  ) {
    throw new TypeError("关闭确认 requestId 无效。");
  }
  if (typeof payload.ready !== "boolean") {
    throw new TypeError("关闭确认 ready 必须是布尔值。");
  }
  if (payload.ready && payload.presentation !== undefined) {
    throw new TypeError("已就绪的关闭确认不能声明阻断出口。");
  }
  if (
    !payload.ready
    && payload.presentation !== undefined
    && payload.presentation !== "in-app"
    && payload.presentation !== "native"
  ) {
    throw new TypeError("关闭阻断出口无效。");
  }
  const reason = payload.ready
    ? null
    : typeof payload.reason === "string" && payload.reason.trim()
      ? payload.reason.trim().slice(0, 500)
      : "编辑器尚未确认所有本地更改都已安全写入。";
  return Object.freeze({
    requestId: payload.requestId,
    ready: payload.ready,
    reason,
    presentation: payload.ready
      ? null
      : payload.presentation || "native",
  });
}

export function shouldPresentNativeCloseBlock(result) {
  return Boolean(
    result
    && result.ready === false
    && result.presentation !== "in-app",
  );
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

export async function runGuardedFinalExit({
  armFinalExit,
  executeFinalExit,
  restoreFinalExit,
}) {
  if (
    typeof armFinalExit !== "function"
    || typeof executeFinalExit !== "function"
    || typeof restoreFinalExit !== "function"
  ) {
    throw new TypeError("最终退出处理器配置无效。");
  }
  armFinalExit();
  try {
    return await executeFinalExit();
  } catch (error) {
    try {
      await restoreFinalExit(error);
    } catch (restoreError) {
      throw new AggregateError(
        [error, restoreError],
        `最终退出失败，恢复应用时也发生错误：${
          restoreError instanceof Error ? restoreError.message : String(restoreError)
        }`,
      );
    }
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
