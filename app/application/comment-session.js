function optionalId(value) {
  return value ? String(value) : null;
}

function frozenItems(value) {
  return Object.freeze(Array.isArray(value) ? [...value] : []);
}

function frozenDeletedIds(value) {
  return Object.freeze([...new Set(
    [...(value || [])].map(String).filter(Boolean),
  )]);
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

  #listeners = new Set();

  #snapshot = initialSnapshot();

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("CommentSession listener must be a function.");
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(next) {
    this.#snapshot = Object.freeze(next);
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change comment working-copy authority.
    }
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Workflow observers cannot change the committed working copy.
      }
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
  } = {}) {
    const current = this.#snapshot;
    this.#emit({
      comments: comments === undefined
        ? current.comments
        : frozenItems(comments),
      changeEvents: changeEvents === undefined
        ? current.changeEvents
        : frozenItems(changeEvents),
      deletedCommentIds: deletedCommentIds === undefined
        ? current.deletedCommentIds
        : frozenDeletedIds(deletedCommentIds),
      composerDraft: composerDraft === undefined
        ? current.composerDraft
        : String(composerDraft || ""),
      composerCommentId: composerCommentId === undefined
        ? current.composerCommentId
        : optionalId(composerCommentId),
      composerAttachments: composerAttachments === undefined
        ? current.composerAttachments
        : frozenItems(composerAttachments),
      composerTarget: composerTarget === undefined
        ? current.composerTarget
        : composerTarget || null,
      editSession: editSession === undefined
        ? current.editSession
        : editSession || null,
    });
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
