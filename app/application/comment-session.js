function optionalId(value) {
  return value ? String(value) : null;
}

function frozenItems(value) {
  return Object.freeze(Array.isArray(value) ? [...value] : []);
}

function deletedIds(value) {
  return [...new Set(
    [...(value || [])].map(String).filter(Boolean),
  )];
}

function initialSnapshot() {
  return Object.freeze({
    comments: frozenItems(),
    changeEvents: frozenItems(),
    deletedCommentIds: frozenItems(),
    composerDraft: "",
    composerCommentId: null,
    composerAttachments: frozenItems(),
    composerTarget: null,
    editSession: null,
  });
}

export class CommentSession {
  #observer = null;

  #snapshot = initialSnapshot();

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit(next) {
    this.#snapshot = Object.freeze({
      ...next,
      comments: frozenItems(next.comments),
      changeEvents: frozenItems(next.changeEvents),
      deletedCommentIds: frozenItems(deletedIds(next.deletedCommentIds)),
      composerDraft: String(next.composerDraft || ""),
      composerCommentId: optionalId(next.composerCommentId),
      composerAttachments: frozenItems(next.composerAttachments),
      composerTarget: next.composerTarget || null,
      editSession: next.editSession || null,
    });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change comment working-copy authority.
    }
  }

  reset() {
    this.#emit(initialSnapshot());
    return this.#snapshot;
  }

  update({
    comments,
    changeEvents,
    deletedCommentIds,
    composerDraft,
    composerCommentId,
    composerAttachments,
    composerTarget,
    editSession,
  }) {
    const next = { ...this.#snapshot };
    if (comments !== undefined) next.comments = comments;
    if (changeEvents !== undefined) next.changeEvents = changeEvents;
    if (deletedCommentIds !== undefined) {
      next.deletedCommentIds = deletedIds(deletedCommentIds);
    }
    if (composerDraft !== undefined) next.composerDraft = composerDraft;
    if (composerCommentId !== undefined) {
      next.composerCommentId = composerCommentId;
    }
    if (composerAttachments !== undefined) {
      next.composerAttachments = composerAttachments;
    }
    if (composerTarget !== undefined) next.composerTarget = composerTarget;
    if (editSession !== undefined) next.editSession = editSession;
    this.#emit(next);
    return this.#snapshot;
  }

  setComments(comments) {
    return this.update({ comments });
  }

  setChangeEvents(changeEvents) {
    return this.update({ changeEvents });
  }

  setComposerDraft(composerDraft) {
    return this.update({ composerDraft });
  }

  setComposerCommentId(composerCommentId) {
    return this.update({ composerCommentId });
  }

  setComposerAttachments(composerAttachments) {
    return this.update({ composerAttachments });
  }

  setComposerTarget(composerTarget) {
    return this.update({ composerTarget });
  }

  setEditSession(editSession) {
    return this.update({ editSession });
  }

  clearComposer() {
    return this.update({
      composerDraft: "",
      composerCommentId: null,
      composerAttachments: [],
      composerTarget: null,
    });
  }

  replaceDeletedCommentIds(commentIds) {
    return this.update({ deletedCommentIds: commentIds });
  }

  markDeleted(commentId) {
    const id = optionalId(commentId);
    if (!id || this.#snapshot.deletedCommentIds.includes(id)) return false;
    this.update({
      deletedCommentIds: [...this.#snapshot.deletedCommentIds, id],
    });
    return true;
  }

  unmarkDeleted(commentId) {
    const id = optionalId(commentId);
    if (!id || !this.#snapshot.deletedCommentIds.includes(id)) return false;
    this.update({
      deletedCommentIds: this.#snapshot.deletedCommentIds.filter(
        (candidate) => candidate !== id,
      ),
    });
    return true;
  }

  clearDeletedCommentIds() {
    if (this.#snapshot.deletedCommentIds.length === 0) return false;
    this.update({ deletedCommentIds: [] });
    return true;
  }

  get comments() {
    return this.#snapshot.comments;
  }

  get changeEvents() {
    return this.#snapshot.changeEvents;
  }

  get deletedCommentIds() {
    return new Set(this.#snapshot.deletedCommentIds);
  }

  get composerDraft() {
    return this.#snapshot.composerDraft;
  }

  get composerCommentId() {
    return this.#snapshot.composerCommentId;
  }

  get composerAttachments() {
    return this.#snapshot.composerAttachments;
  }

  get composerTarget() {
    return this.#snapshot.composerTarget;
  }

  get editSession() {
    return this.#snapshot.editSession;
  }

  get snapshot() {
    return this.#snapshot;
  }
}
