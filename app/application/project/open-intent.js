export function planProjectOpen({
  closePhase = "idle",
  kind = "local",
} = {}) {
  if (closePhase === "ready") {
    return Object.freeze({
      kind: "reject",
      code: "PROJECT_OPEN_CLOSE_COMMITTED",
      reason: "当前窗口正在关闭，新的 HTML 将由下一次启动接收。",
    });
  }
  if (kind === "startup") {
    return Object.freeze({ kind: "ready", action: "startup" });
  }
  if (kind === "local" || kind === "recent") {
    return Object.freeze({ kind: "ready", action: "open-file" });
  }
  return Object.freeze({ kind: "ready", action: "open-registered" });
}
