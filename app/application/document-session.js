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

const CANVAS_AUTHORITY_STATES = new Set([
  "idle",
  "pending",
  "verified",
  "failed",
]);

function canvasAuthority({
  status = "idle",
  generation = 0,
  renderedSha256 = null,
  error = null,
} = {}) {
  return Object.freeze({
    status: CANVAS_AUTHORITY_STATES.has(status) ? status : "idle",
    generation: revision(generation),
    renderedSha256: renderedSha256 ? String(renderedSha256) : null,
    error: error ? String(error) : null,
  });
}

function pendingCanvasAuthority(generation) {
  return canvasAuthority({
    status: "pending",
    generation,
  });
}

function boundaryBlock(code, reason, confirmed = false) {
  return Object.freeze({
    ready: false,
    code,
    reason,
    confirmed,
  });
}

function initialSnapshot({
  html = "",
  sourceSha256 = null,
} = {}) {
  return Object.freeze({
    html: String(html),
    sourceSha256: sourceSha256 ? String(sourceSha256) : null,
    canvasGeneration: 0,
    editRevision: 0,
    lastPersistedRevision: 0,
    persistState: "idle",
    persistError: "",
    hasPendingWrite: false,
    isFlushing: false,
    canvasAuthority: canvasAuthority({ generation: 0 }),
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
    this.#snapshot = Object.freeze({
      ...next,
      hasPendingWrite: Boolean(this.#pendingWrite),
      isFlushing: Boolean(this.#flushPromise),
    });
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
    const canvasGeneration = this.#snapshot.canvasGeneration + 1;
    this.#emit({
      html: String(html || ""),
      sourceSha256: sourceSha256 ? String(sourceSha256) : null,
      canvasGeneration,
      editRevision: revision(editRevision),
      lastPersistedRevision: revision(lastPersistedRevision),
      persistState: "idle",
      persistError: "",
      canvasAuthority: pendingCanvasAuthority(canvasGeneration),
    });
    return this.#snapshot;
  }

  publishAuthority({
    html,
    sourceSha256,
    editRevision,
    lastPersistedRevision,
    persistState: nextPersistState,
    persistError,
    pendingWrite,
  }) {
    const canvasGeneration = this.#snapshot.canvasGeneration + 1;
    const next = {
      ...this.#snapshot,
      html: String(html),
      sourceSha256: sourceSha256 ? String(sourceSha256) : null,
      canvasGeneration,
      canvasAuthority: pendingCanvasAuthority(canvasGeneration),
    };
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

  reloadCanvas() {
    const canvasGeneration = this.#snapshot.canvasGeneration + 1;
    this.#emit({
      ...this.#snapshot,
      canvasGeneration,
      canvasAuthority: pendingCanvasAuthority(canvasGeneration),
    });
    return this.#snapshot;
  }

  confirmCanvas({ generation, renderedSha256 } = {}) {
    const expectedGeneration = revision(generation);
    const expectedHash = renderedSha256 ? String(renderedSha256) : "";
    if (
      expectedGeneration !== this.#snapshot.canvasGeneration
      || !expectedHash
      || expectedHash !== this.#snapshot.sourceSha256
    ) {
      return false;
    }
    this.#emit({
      ...this.#snapshot,
      canvasAuthority: canvasAuthority({
        status: "verified",
        generation: expectedGeneration,
        renderedSha256: expectedHash,
      }),
    });
    return true;
  }

  failCanvas({ generation, error } = {}) {
    const expectedGeneration = revision(generation);
    if (expectedGeneration !== this.#snapshot.canvasGeneration) return false;
    this.#emit({
      ...this.#snapshot,
      canvasAuthority: canvasAuthority({
        status: "failed",
        generation: expectedGeneration,
        error: error || "画布没有在时限内确认载入目标 HTML。",
      }),
    });
    return true;
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
      canvasAuthority: pendingCanvasAuthority(this.#snapshot.canvasGeneration),
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
    this.#emit(this.#snapshot);
    return promise;
  }

  clearFlushPromise(promise) {
    if (this.#flushPromise !== promise) return false;
    this.#flushPromise = null;
    this.#emit(this.#snapshot);
    return true;
  }

  async reconcilePersistedBoundary({
    frozenHtml,
    reportedSourceSha256 = null,
    cutoffRevision,
    hashHtml,
    readSource,
    isCurrent,
    acceptsSource,
  }) {
    if (
      typeof hashHtml !== "function"
      || typeof readSource !== "function"
      || typeof isCurrent !== "function"
      || typeof acceptsSource !== "function"
    ) {
      throw new TypeError("Document boundary reconciliation is not configured.");
    }

    const html = String(frozenHtml);
    const cutoff = revision(cutoffRevision);
    const stillCurrent = () => Boolean(
      isCurrent()
      && this.#snapshot.editRevision === cutoff
      && this.#snapshot.html === html
      && !this.#pendingWrite
      && !this.#flushPromise
    );

    let frozenSha256;
    try {
      frozenSha256 = String(await hashHtml(html));
    } catch {
      return boundaryBlock(
        "frozen-integrity-unavailable",
        "当前页面暂时无法完成内容校验，源页已保持开启；再次关闭时会自动继续。",
      );
    }
    if (!/^sha256:[a-f0-9]{64}$/u.test(frozenSha256)) {
      return boundaryBlock(
        "frozen-integrity-unavailable",
        "当前页面暂时无法完成内容校验，源页已保持开启；再次关闭时会自动继续。",
      );
    }
    if (!stillCurrent()) {
      return boundaryBlock(
        "session-changed",
        "关闭核对期间当前页面发生了变化，源页已保持开启；再次关闭时会自动继续。",
      );
    }

    const metadataRepaired = Boolean(
      reportedSourceSha256
      && String(reportedSourceSha256) !== frozenSha256
    );
    if (
      this.#snapshot.persistState === "idle"
      && this.#snapshot.sourceSha256 === frozenSha256
      && this.#snapshot.lastPersistedRevision >= cutoff
    ) {
      return Object.freeze({
        ready: true,
        repaired: metadataRepaired,
        sourceSha256: frozenSha256,
        lastModifiedAt: "",
      });
    }

    let source;
    try {
      source = await readSource();
    } catch {
      return boundaryBlock(
        "source-unavailable",
        "源文件暂时无法完成最终核对，当前页面仍保留；再次关闭时会自动继续。",
      );
    }
    let sourceAccepted = false;
    try {
      sourceAccepted = Boolean(
        source
        && typeof source === "object"
        && !Array.isArray(source)
        && acceptsSource(source)
      );
    } catch {
      sourceAccepted = false;
    }
    if (!stillCurrent() || !sourceAccepted) {
      return boundaryBlock(
        "source-identity-changed",
        "核对期间当前文件身份发生了变化，源页已保持开启；再次关闭时会自动继续。",
      );
    }

    const content = typeof source?.content === "string" ? source.content : null;
    const declaredSha256 = String(source?.sha256 || "");
    let actualSha256 = "";
    if (content !== null) {
      try {
        actualSha256 = String(await hashHtml(content));
      } catch {
        actualSha256 = "";
      }
    }
    if (
      content === null
      || !/^sha256:[a-f0-9]{64}$/u.test(declaredSha256)
      || actualSha256 !== declaredSha256
    ) {
      return boundaryBlock(
        "source-integrity-failed",
        "源文件的内容校验没有通过。当前页面没有覆盖文件；请先导出 PageRoot 工作副本，再重新读取源文件。",
        true,
      );
    }
    if (!stillCurrent()) {
      return boundaryBlock(
        "session-changed",
        "核对期间当前页面发生了变化，源页已保持开启；再次关闭时会自动继续。",
      );
    }
    if (content !== html || declaredSha256 !== frozenSha256) {
      const reason = "磁盘中的 HTML 已被其他操作修改。当前页面没有覆盖任何一份；请先导出 PageRoot 工作副本，或重新载入磁盘文件。";
      this.setPersistence({ state: "conflict", error: reason });
      return boundaryBlock("source-diverged", reason, true);
    }

    this.update({
      sourceSha256: frozenSha256,
      lastPersistedRevision: Math.max(
        this.#snapshot.lastPersistedRevision,
        cutoff,
      ),
      persistState: "idle",
      persistError: "",
    });
    return Object.freeze({
      ready: true,
      repaired: true,
      sourceSha256: frozenSha256,
      lastModifiedAt: String(source?.lastModifiedAt || ""),
    });
  }

  get html() {
    return this.#snapshot.html;
  }

  get sourceSha256() {
    return this.#snapshot.sourceSha256;
  }

  get canvasGeneration() {
    return this.#snapshot.canvasGeneration;
  }

  get canvasAuthority() {
    return this.#snapshot.canvasAuthority;
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
