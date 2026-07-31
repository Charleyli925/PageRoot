function optionalId(value) {
  return value ? String(value) : null;
}

function initialSnapshot() {
  return Object.freeze({
    versions: Object.freeze([]),
    latestVersionId: null,
    currentBasedOnVersionId: null,
    currentExactVersionId: null,
    restoredFromVersionId: null,
    viewMode: "current",
    viewingVersionId: null,
  });
}

export class VersionSession {
  #observer = null;

  #snapshot = initialSnapshot();

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit(next) {
    this.#snapshot = Object.freeze({
      ...next,
      versions: Object.freeze([...(next.versions || [])]),
    });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change Version authority.
    }
  }

  reset() {
    this.#emit(initialSnapshot());
  }

  hydrate({
    versions,
    latestVersionId,
    currentBasedOnVersionId,
    currentExactVersionId,
    restoredFromVersionId = null,
  }) {
    this.#emit({
      ...this.#snapshot,
      versions: Array.isArray(versions) ? versions : [],
      latestVersionId: optionalId(latestVersionId),
      currentBasedOnVersionId: optionalId(currentBasedOnVersionId),
      currentExactVersionId: optionalId(currentExactVersionId),
      restoredFromVersionId: optionalId(restoredFromVersionId),
    });
    return this.#snapshot;
  }

  updateAuthority({
    versions,
    latestVersionId,
    currentBasedOnVersionId,
    currentExactVersionId,
    restoredFromVersionId,
  }) {
    const next = { ...this.#snapshot };
    if (versions !== undefined) {
      next.versions = Array.isArray(versions) ? versions : [];
    }
    if (latestVersionId !== undefined) {
      next.latestVersionId = optionalId(latestVersionId);
    }
    if (currentBasedOnVersionId !== undefined) {
      next.currentBasedOnVersionId = optionalId(currentBasedOnVersionId);
    }
    if (currentExactVersionId !== undefined) {
      next.currentExactVersionId = optionalId(currentExactVersionId);
    }
    if (restoredFromVersionId !== undefined) {
      next.restoredFromVersionId = optionalId(restoredFromVersionId);
    }
    this.#emit(next);
    return this.#snapshot;
  }

  markSourceEdited() {
    if (this.#snapshot.currentExactVersionId === null) return false;
    this.#emit({
      ...this.#snapshot,
      currentExactVersionId: null,
    });
    return true;
  }

  adoptCommitted(versionId) {
    const id = optionalId(versionId);
    if (!id) return false;
    this.#emit({
      ...this.#snapshot,
      latestVersionId: id,
      currentBasedOnVersionId: id,
      currentExactVersionId: id,
      restoredFromVersionId: null,
      viewMode: "current",
      viewingVersionId: null,
    });
    return true;
  }

  enterHistory(versionId) {
    const id = optionalId(versionId);
    if (!id) return false;
    this.#emit({
      ...this.#snapshot,
      viewMode: "history",
      viewingVersionId: id,
    });
    return true;
  }

  returnCurrent({
    currentBasedOnVersionId,
    currentExactVersionId,
    restoredFromVersionId,
  } = {}) {
    const next = {
      ...this.#snapshot,
      viewMode: "current",
      viewingVersionId: null,
    };
    if (currentBasedOnVersionId !== undefined) {
      next.currentBasedOnVersionId = optionalId(currentBasedOnVersionId);
    }
    if (currentExactVersionId !== undefined) {
      next.currentExactVersionId = optionalId(currentExactVersionId);
    }
    if (restoredFromVersionId !== undefined) {
      next.restoredFromVersionId = optionalId(restoredFromVersionId);
    }
    this.#emit(next);
    return this.#snapshot;
  }

  captureView() {
    return Object.freeze({
      viewMode: this.#snapshot.viewMode,
      viewingVersionId: this.#snapshot.viewingVersionId,
    });
  }

  restoreView(view) {
    if (!view || !["current", "history"].includes(view.viewMode)) {
      return false;
    }
    this.#emit({
      ...this.#snapshot,
      viewMode: view.viewMode,
      viewingVersionId:
        view.viewMode === "history"
          ? optionalId(view.viewingVersionId)
          : null,
    });
    return true;
  }

  get snapshot() {
    return this.#snapshot;
  }
}
