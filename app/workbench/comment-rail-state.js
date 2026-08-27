export function deriveComposerState(input) {
  if (input.relinkingTarget) {
    return { kind: "relinking", commentId: input.relinkingTarget };
  }
  if (input.editingCommentId && input.commentEditSession) {
    return {
      kind: "editing",
      commentId: input.editingCommentId,
      draft: {
        text: input.commentEditDraft,
        commentId: input.editingCommentId,
        attachments: input.commentEditAttachments,
        target: null,
      },
      session: input.commentEditSession,
    };
  }
  if (input.composerOpen && input.draftTarget) {
    return {
      kind: "new",
      target: input.draftTarget,
      draft: {
        text: input.draft,
        commentId: input.draftCommentId,
        attachments: input.draftAttachments,
        target: input.draftTarget,
      },
    };
  }
  return {
    kind: "closed",
    collapsedDraft: input.hasCollapsedCommentDraft
      ? {
        text: input.draft,
        commentId: input.draftCommentId,
        attachments: input.draftAttachments,
        target: input.draftTarget,
      }
      : null,
  };
}

export function composerViewFields(composer) {
  return {
    composerOpen: composer.kind === "new",
    draftTarget: composer.kind === "new"
      ? composer.target
      : composer.kind === "closed"
        ? composer.collapsedDraft?.target || null
        : null,
    draft: composer.kind === "new"
      ? composer.draft.text
      : composer.kind === "closed"
        ? composer.collapsedDraft?.text || ""
        : composer.kind === "editing"
          ? composer.draft.text
          : "",
    draftCommentId: composer.kind === "new"
      ? composer.draft.commentId
      : composer.kind === "closed"
        ? composer.collapsedDraft?.commentId || null
        : composer.kind === "editing"
          ? composer.commentId
          : null,
    draftAttachments: composer.kind === "new"
      ? composer.draft.attachments
      : composer.kind === "closed"
        ? composer.collapsedDraft?.attachments || []
        : composer.kind === "editing"
          ? composer.draft.attachments
          : [],
    hasCollapsedCommentDraft:
      composer.kind === "closed" && Boolean(composer.collapsedDraft),
    editingCommentId: composer.kind === "editing" ? composer.commentId : null,
    commentEditSession: composer.kind === "editing" ? composer.session : null,
    commentEditDraft: composer.kind === "editing" ? composer.draft.text : "",
    commentEditAttachments:
      composer.kind === "editing" ? composer.draft.attachments : [],
    relinkingTarget: composer.kind === "relinking" ? composer.commentId : null,
  };
}
