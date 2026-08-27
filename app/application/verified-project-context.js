export function copyProjectContext(context) {
  if (!context) return null;
  const epoch = Number(context.epoch);
  const projectId = String(context.projectId || "");
  const documentId = String(context.documentId || "");
  const sourcePath = String(context.sourcePath || "");
  if (!Number.isSafeInteger(epoch) || !sourcePath) return null;
  const target = context.projectRootPath && context.targetKind
    ? {
      projectRootPath: String(context.projectRootPath),
      targetKind: String(context.targetKind),
      workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
      versionId: context.versionId ? String(context.versionId) : null,
      exactSourcePath: String(context.exactSourcePath || sourcePath),
      sourceSha256: String(context.sourceSha256 || ""),
      sessionEpoch: Number(context.sessionEpoch ?? epoch),
    }
    : {};
  return Object.freeze({ epoch, projectId, documentId, sourcePath, ...target });
}

export function verifyProjectContext(candidate, live, {
  disposed = false,
  sameSourcePath = (left, right) => left === right,
} = {}) {
  if (disposed) return null;
  const context = copyProjectContext(candidate);
  if (!context || !live) return null;
  if (context.projectId && context.documentId) {
    return typeof live.matches === "function" && live.matches(context)
      ? context
      : null;
  }
  if (Number(live.epoch) !== context.epoch) return null;
  if (!sameSourcePath(live.sourcePath, context.sourcePath)) return null;
  return context;
}
