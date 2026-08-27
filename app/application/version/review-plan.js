export function planVersionPrepareReview({
  disposed = false,
  ready = false,
  baseHashOk = false,
} = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "VERSION_WORKFLOW_DISPOSED",
      reason: "版本工作流已经停止。",
    });
  }
  if (!ready) {
    return Object.freeze({
      kind: "reject",
      code: "VERSION_REVIEW_PRECONDITION",
      reason: "当前没有可安全审阅的候选版本。",
    });
  }
  if (!baseHashOk) {
    return Object.freeze({
      kind: "reject",
      code: "VERSION_REVIEW_BASE_HASH_INVALID",
      reason: "当前候选缺少可核验的冻结源文件 Hash。",
    });
  }
  return Object.freeze({ kind: "ready" });
}

export function planVersionActivate({
  disposed = false,
  ready = false,
  projectHydrating = false,
} = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "VERSION_WORKFLOW_DISPOSED",
      reason: "版本工作流已经停止。",
    });
  }
  if (!ready) {
    return Object.freeze({
      kind: "reject",
      code: "VERSION_ACTIVATION_PRECONDITION",
      reason: "当前没有可确认打开的候选版本。",
    });
  }
  if (projectHydrating) {
    return Object.freeze({
      kind: "reject",
      code: "VERSION_ACTIVATION_PROJECT_UNAVAILABLE",
      reason: "项目状态仍在读取，不能打开候选版本。",
    });
  }
  return Object.freeze({ kind: "ready" });
}
