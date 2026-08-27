export function planSourceLocatorRegister({
  epoch,
  liveEpoch,
  sourcePath,
  liveSourcePath,
  projectId,
  documentId,
  samePath = (left, right) => left === right,
} = {}) {
  if (
    Number(epoch) !== Number(liveEpoch)
    || !samePath(sourcePath, liveSourcePath)
    || !String(projectId || "")
    || !String(documentId || "")
    || !liveSourcePath
  ) {
    return Object.freeze({
      kind: "reject",
      code: "SOURCE_LOCATOR_STALE",
      reason: "注册身份与当前 locator 不一致。",
    });
  }
  return Object.freeze({ kind: "ready" });
}

export function planSourceLocatorTransition({
  nextSourcePath = "",
  previousSourcePath = null,
  liveSourcePath = "",
  samePath = (left, right) => left === right,
} = {}) {
  if (!nextSourcePath) {
    return Object.freeze({
      kind: "reject",
      code: "SOURCE_LOCATOR_MISSING",
      reason: "下一段工作文件路径无效。",
    });
  }
  if (previousSourcePath && !samePath(previousSourcePath, liveSourcePath)) {
    return Object.freeze({
      kind: "reject",
      code: "SOURCE_LOCATOR_STALE",
      reason: "源路径切换与当前 locator 不一致。",
    });
  }
  return Object.freeze({ kind: "ready" });
}
