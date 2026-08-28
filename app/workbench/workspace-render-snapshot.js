function sameObjectFieldsExcept(left, right, ignored) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") {
    return false;
  }
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  for (const key of keys) {
    if (ignored.has(key)) continue;
    if (!Object.is(left[key], right[key])) return false;
  }
  return true;
}

function sameEditSessionStructure(left, right) {
  return sameObjectFieldsExcept(left, right, new Set(["draftText"]));
}

function sameCommentWorkingCopyStructure(left, right) {
  return sameObjectFieldsExcept(
    left,
    right,
    new Set(["composerDraft", "editSession"]),
  ) && sameEditSessionStructure(left?.editSession, right?.editSession);
}

function sameCommentPersistencePresentation(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  return left.attachmentUploadCount === right.attachmentUploadCount
    && left.draft?.error === right.draft?.error;
}

function sameProjectRulesStructure(left, right) {
  return sameObjectFieldsExcept(left, right, new Set(["content"]));
}

function sameRunHandoffStructure(left, right) {
  return sameObjectFieldsExcept(
    left,
    right,
    new Set(["visibleText", "visibleTextUpdates", "textTruncated", "updatedAt"]),
  );
}

function sameRunSessionStructure(left, right) {
  return sameObjectFieldsExcept(
    left,
    right,
    new Set(["activeHandoff"]),
  ) && sameRunHandoffStructure(left?.activeHandoff, right?.activeHandoff);
}

/**
 * The composition root does not render comment text drafts. Keep those
 * high-frequency facts on the comments capability subscription while still
 * publishing every structural comment, persistence-error and upload change
 * needed by Canvas, Review and the workspace banner.
 */
export function sameWorkbenchRenderSnapshot(previous, next) {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return sameObjectFieldsExcept(
    previous,
    next,
    new Set(["commentSession", "comment", "projectRules", "runSession"]),
  ) && sameCommentWorkingCopyStructure(
    previous.commentSession,
    next.commentSession,
  ) && sameCommentPersistencePresentation(
    previous.comment,
    next.comment,
  ) && sameProjectRulesStructure(
    previous.projectRules,
    next.projectRules,
  ) && sameRunSessionStructure(previous.runSession, next.runSession);
}
