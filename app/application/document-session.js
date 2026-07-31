const PERSIST_STATES = new Set([
  "idle",
  "preview-dirty",
  "queued",
  "writing",
  "failed",
  "conflict",
]);

function revision(value) {
  const next = Number(value);
  return Number.isSafeInteger(next) && next >= 0 ? next : 0;
}

function persistState(value) {
  return PERSIST_STATES.has(value) ? value : "idle";
}

function initialSnapshot({
  html = "",
  sourceSha256 = null,
} = {}) {
  return Object.freeze({
    html: String(html),
    sourceSha256: sourceSha256 ? String(sourceSha256) : null,
    editRevision: 0,
    lastPersistedRevision: 0,
    persistState: "idle",
    persistError: "",
  });
}

export class DocumentSession {
  #observer = null;

  #snapshot;

  #pendingWrite = null;

  #flushPromise = null;

  constructor(options = {}) {
    this.#snapshot = initialSnapshot(options);
  }

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit(next) {
    this.#snapshot = Object.freeze({ ...next });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change source authority.
    }
  }

  update({
    html,
    sourceSha256,
    editRevision,
    lastPersistedRevision,
    persistState: nextPersistState,
    persistError,
    pendingWrite,
  }) {
    const next = { ...this.#snapshot };
    if (html !== undefined) next.html = String(html);
    if (sourceSha256 !== undefined) {
      next.sourceSha256 = sourceSha256 ? String(sourceSha256) : null;
    }
    if (editRevision !== undefined) {
      next.editRevision = revision(editRevision);
    }
    if (lastPersistedRevision !== undefined) {
      next.lastPersistedRevision = revision(lastPersistedRevision);
    }
    if (nextPersistState !== undefined) {
      next.persistState = persistState(nextPersistState);
    }
    if (persistError !== undefined) {
      next.persistError = String(persistError || "");
    }
    if (pendingWrite !== undefined) {
      this.#pendingWrite = pendingWrite || null;
    }
    this.#emit(next);
    return this.#snapshot;
  }

  reset({
    html,
    sourceSha256 = null,
    editRevision = 0,
    lastPersistedRevision = 0,
  }) {
    this.#pendingWrite = null;
    this.#emit({
      html: String(html || ""),
      sourceSha256: sourceSha256 ? String(sourceSha256) : null,
      editRevision: revision(editRevision),
      lastPersistedRevision: revision(lastPersistedRevision),
      persistState: "idle",
      persistError: "",
    });
    return this.#snapshot;
  }

  beginEdit(html) {
    if (this.#snapshot.persistState === "conflict") {
      return this.#snapshot.editRevision;
    }
    const nextRevision = this.#snapshot.editRevision + 1;
    this.#emit({
      ...this.#snapshot,
      html: String(html),
      editRevision: nextRevision,
      persistError: "",
    });
    return nextRevision;
  }

  setHtml(html) {
    this.#emit({ ...this.#snapshot, html: String(html) });
  }

  setSourceSha256(sourceSha256) {
    this.#emit({
      ...this.#snapshot,
      sourceSha256: sourceSha256 ? String(sourceSha256) : null,
    });
  }

  setEditRevision(value) {
    this.#emit({ ...this.#snapshot, editRevision: revision(value) });
  }

  setLastPersistedRevision(value) {
    this.#emit({
      ...this.#snapshot,
      lastPersistedRevision: revision(value),
    });
  }

  setPersistence({
    state = this.#snapshot.persistState,
    error = this.#snapshot.persistError,
  } = {}) {
    this.#emit({
      ...this.#snapshot,
      persistState: persistState(state),
      persistError: String(error || ""),
    });
  }

  setPersistState(state) {
    this.setPersistence({ state });
  }

  setPersistError(error) {
    this.setPersistence({ error });
  }

  setPendingWrite(write) {
    this.#pendingWrite = write || null;
    return this.#pendingWrite;
  }

  takePendingWrite() {
    const write = this.#pendingWrite;
    this.#pendingWrite = null;
    return write;
  }

  setFlushPromise(promise) {
    if (promise !== null && typeof promise?.then !== "function") {
      throw new TypeError("Document flush authority must be a Promise.");
    }
    this.#flushPromise = promise;
    return promise;
  }

  clearFlushPromise(promise) {
    if (this.#flushPromise !== promise) return false;
    this.#flushPromise = null;
    return true;
  }

  get html() {
    return this.#snapshot.html;
  }

  get sourceSha256() {
    return this.#snapshot.sourceSha256;
  }

  get editRevision() {
    return this.#snapshot.editRevision;
  }

  get lastPersistedRevision() {
    return this.#snapshot.lastPersistedRevision;
  }

  get persistState() {
    return this.#snapshot.persistState;
  }

  get persistError() {
    return this.#snapshot.persistError;
  }

  get pendingWrite() {
    return this.#pendingWrite;
  }

  get flushPromise() {
    return this.#flushPromise;
  }

  get snapshot() {
    return this.#snapshot;
  }
}
