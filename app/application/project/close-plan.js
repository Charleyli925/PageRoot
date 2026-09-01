export function planProjectCloseIdentity({
  requestId = "",
  deadlineAt = NaN,
} = {}) {
  if (!String(requestId || "") || !Number.isFinite(Number(deadlineAt))) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_CLOSE_IDENTITY_INVALID",
      reason: "桌面关闭请求缺少完整身份。",
      presentation: "in-app",
    });
  }
  return Object.freeze({ kind: "ready" });
}

export function planProjectCloseHydration({
  projectOpenInFlight = false,
  projectHydrating = false,
  canCloseDuringHydration = false,
  projectLoadError = false,
  pendingDirty = false,
} = {}) {
  if (projectHydrating) {
    if (projectOpenInFlight) {
      return Object.freeze({
        kind: "reject",
        code: "PROJECT_CLOSE_OPEN_IN_FLIGHT",
        reason: "HTML 打开仍未安全完成，已取消关闭。",
        presentation: "in-app",
      });
    }
    if (canCloseDuringHydration) {
      return Object.freeze({ kind: "ready", action: "allow-hydration" });
    }
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_CLOSE_HYDRATING",
      reason: "项目状态尚未读取完成，已取消关闭以避免覆盖未知编辑状态。",
      presentation: "in-app",
    });
  }
  if (projectLoadError) {
    if (projectOpenInFlight) {
      return Object.freeze({
        kind: "reject",
        code: "PROJECT_CLOSE_OPEN_IN_FLIGHT",
        reason: "HTML 打开仍未安全完成，已取消关闭。",
        presentation: "in-app",
      });
    }
    if (pendingDirty) {
      return Object.freeze({
        kind: "reject",
        code: "PROJECT_CLOSE_LOAD_ERROR_DIRTY",
        reason: "项目读取失败且仍有待恢复的 HTML 修改，请先重试读取或导出当前 HTML。",
        presentation: "in-app",
      });
    }
    return Object.freeze({ kind: "ready", action: "allow-load-error" });
  }
  return Object.freeze({ kind: "ready", action: "continue" });
}

export function planProjectCloseAbort({
  aborted = false,
  projectOpenInFlight = false,
} = {}) {
  if (aborted) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_CLOSE_ABORTED",
      reason: "桌面外壳已取消本次关闭。",
      presentation: "in-app",
    });
  }
  if (projectOpenInFlight) {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_CLOSE_OPEN_IN_FLIGHT",
      reason: "HTML 打开在关闭核对期间开始，已取消本次关闭。",
      presentation: "in-app",
    });
  }
  return Object.freeze({ kind: "ready" });
}
