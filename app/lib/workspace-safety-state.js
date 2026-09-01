// Workspace safety is the only durable, workspace-level interruption besides
// irreversible confirmation. Copy lives here so Workbench cannot free-form a
// second toast for the same persist/locator fact. At most one safety kind is
// presented: the existing workspace-unavailable banner outranks the persist
// conflict/failed banner; closing-after-save stays on the chrome status line.

/**
 * @param {string} code
 * @returns {{ title: string, message: string, source: "locator" } | null}
 */
export function workspaceUnavailableFromCode(code) {
  switch (String(code || "")) {
    case "MANAGED_PATH_AMBIGUOUS":
      return {
        title: "无法确定工作文件",
        message: "检测到多个同等候选文件；修改仍保留，请先恢复唯一文件位置。",
        source: "locator",
      };
    case "WORKING_COPY_UNAVAILABLE":
      return {
        title: "文件暂不可用",
        message: "当前工作文件暂时不可用，修改仍保留。",
        source: "locator",
      };
    case "REGISTERED_PROJECT_UNAVAILABLE":
      return {
        title: "项目暂不可用",
        message: "修改仍保留；放回原登记位置后自动恢复",
        source: "locator",
      };
    case "MANAGED_SOURCE_IDENTITY_MISMATCH":
      return {
        title: "无法核对工作文件",
        message: "当前工作文件身份无法核对，PageRoot 没有切换路径。",
        source: "locator",
      };
    default:
      return null;
  }
}

/**
 * @param {{
 *   pendingExit?: boolean,
 *   persistState?: string,
 *   persistError?: string,
 *   workspaceIssue?: { title?: string, message?: string } | null,
 * }} [input]
 * @returns {{
 *   kind: "save-blocked" | "source-conflict" | "workspace-unavailable" | "closing-after-save",
 *   reason?: string,
 * } | null}
 */
export function deriveWorkspaceSafetyState({
  pendingExit = false,
  persistState = "idle",
  persistError = "",
  workspaceIssue = null,
} = {}) {
  if (workspaceIssue) {
    return {
      kind: "workspace-unavailable",
      reason: String(workspaceIssue.message || workspaceIssue.title || ""),
    };
  }
  if (persistState === "conflict") {
    return {
      kind: "source-conflict",
      reason: persistError || "您的编辑内容仍在，可先预览外部版本再决定。",
    };
  }
  if (persistState === "failed") {
    return {
      kind: "save-blocked",
      reason: persistError || "工作台保留了当前编辑内容，不会假装已经更新。",
    };
  }
  if (pendingExit) {
    return { kind: "closing-after-save" };
  }
  return null;
}
