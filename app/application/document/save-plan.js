export function planDocumentEnqueue({
  disposed = false,
  persistState = "idle",
} = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_WORKFLOW_DISPOSED",
      reason: "文档持久化工作流已经停止。",
    });
  }
  if (persistState === "conflict") {
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_PERSISTENCE_CONFLICT",
      reason: "当前 HTML 与外部文件存在冲突，请先选择要保留的版本。",
    });
  }
  return Object.freeze({ kind: "ready" });
}

export function planDocumentSave({
  disposed = false,
  flushInFlight = false,
  pendingWrite = null,
  editRevision = 0,
  lastPersistedRevision = 0,
} = {}) {
  if (disposed) {
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_WORKFLOW_DISPOSED",
      reason: "文档持久化工作流已经停止。",
    });
  }
  if (flushInFlight) {
    return Object.freeze({ kind: "wait" });
  }
  if (!pendingWrite) {
    if (Number(editRevision) <= Number(lastPersistedRevision)) {
      return Object.freeze({
        kind: "ready",
        action: "idle",
        revision: Number(lastPersistedRevision),
      });
    }
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_SOURCE_UNBOUND",
      reason: "当前编辑尚未绑定本地 HTML，无法写回源文件。",
    });
  }
  if (!pendingWrite.sourcePath) {
    return Object.freeze({
      kind: "reject",
      code: "DOCUMENT_SOURCE_UNBOUND",
      reason: "当前编辑尚未绑定本地 HTML，无法写回源文件。",
    });
  }
  return Object.freeze({
    kind: "ready",
    action: "write",
  });
}
