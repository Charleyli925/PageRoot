export function planRunSubmitEntry({ disposed = false } = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "RUN_WORKFLOW_DISPOSED",
      reason: "本轮任务工作流已经停止。",
    });
  }
  return Object.freeze({ kind: "ready" });
}

export function planRunSubmit({
  sourcePath = null,
  context = null,
  submissionPending = false,
  activeLocked = false,
  hasComposerDraft = false,
  hasDirtyEdit = false,
} = {}) {
  if (!sourcePath || !context) {
    return Object.freeze({
      kind: "reject",
      code: "RUN_SUBMISSION_PROJECT_UNAVAILABLE",
      reason: "请先打开并建立当前 HTML 的项目资料。",
    });
  }
  if (submissionPending || activeLocked) {
    return Object.freeze({
      kind: "reject",
      code: "RUN_SUBMISSION_LOCKED",
      reason: "当前项目正在处理上一轮要求。",
    });
  }
  if (hasComposerDraft) {
    return Object.freeze({
      kind: "reject",
      code: "RUN_SUBMISSION_COMMENT_DRAFT",
      reason: "还有一条评论未保存。",
    });
  }
  if (hasDirtyEdit) {
    return Object.freeze({
      kind: "reject",
      code: "RUN_SUBMISSION_COMMENT_EDIT",
      reason: "还有一条评论编辑尚未保存。",
    });
  }
  return Object.freeze({ kind: "ready" });
}
