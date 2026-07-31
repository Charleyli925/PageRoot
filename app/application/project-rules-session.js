function copyContext(context) {
  if (
    !context
    || !Number.isSafeInteger(Number(context.epoch))
    || !String(context.projectId || "")
    || !String(context.documentId || "")
    || !String(context.sourcePath || "")
  ) {
    return null;
  }
  return Object.freeze({
    epoch: Number(context.epoch),
    projectId: String(context.projectId),
    documentId: String(context.documentId),
    sourcePath: String(context.sourcePath),
  });
}

function sameContext(left, right) {
  return Boolean(
    left
    && right
    && left.epoch === right.epoch
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.sourcePath === right.sourcePath,
  );
}

function emptySnapshot(editorGeneration = 0) {
  return Object.freeze({
    open: false,
    path: "PROJECT.md",
    content: "",
    savedContent: "",
    loading: false,
    error: "",
    saving: false,
    saveError: "",
    compositionActive: false,
    editorGeneration,
  });
}

export class ProjectRulesSession {
  #bridgeClient;

  #errorMessage;

  #observer = null;

  #context = null;

  #generation = 0;

  #compositionSequence = 0;

  #composition = null;

  #savePromise = null;

  #snapshot = emptySnapshot();

  constructor({
    bridgeClient,
    errorMessage = (cause, fallback) => (
      cause instanceof Error && cause.message ? cause.message : fallback
    ),
  }) {
    if (
      !bridgeClient
      || typeof bridgeClient.projectFile !== "function"
      || typeof bridgeClient.updateProjectFile !== "function"
    ) {
      throw new TypeError(
        "ProjectRulesSession requires project-file Bridge commands.",
      );
    }
    this.#bridgeClient = bridgeClient;
    this.#errorMessage = errorMessage;
  }

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit(next) {
    this.#snapshot = Object.freeze({ ...next });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change project-rule authority.
    }
  }

  #isCurrent(context, generation) {
    return generation === this.#generation
      && sameContext(this.#context, context);
  }

  async open(context) {
    const nextContext = copyContext(context);
    if (!nextContext) {
      this.close();
      return false;
    }
    this.#generation += 1;
    const generation = this.#generation;
    this.#context = nextContext;
    this.#composition = null;
    this.#savePromise = null;
    this.#emit({
      ...emptySnapshot(this.#snapshot.editorGeneration),
      open: true,
      loading: true,
      content: "正在读取…",
      savedContent: "正在读取…",
    });
    try {
      const payload = await this.#bridgeClient.projectFile(
        nextContext.sourcePath,
        "PROJECT.md",
      );
      if (!this.#isCurrent(nextContext, generation)) return false;
      const content = String(payload?.content || "");
      this.#emit({
        ...this.#snapshot,
        content,
        savedContent: content,
        loading: false,
        error: "",
      });
      return true;
    } catch (cause) {
      if (!this.#isCurrent(nextContext, generation)) return false;
      this.#emit({
        ...this.#snapshot,
        content: "",
        savedContent: "",
        loading: false,
        error: this.#errorMessage(
          cause,
          "项目文件暂时无法读取；未显示任何可编辑的替代内容。",
        ),
      });
      return false;
    }
  }

  close() {
    this.#generation += 1;
    this.#context = null;
    this.#composition = null;
    this.#savePromise = null;
    this.#emit(emptySnapshot(this.#snapshot.editorGeneration));
  }

  updateContent(content) {
    if (
      !this.#snapshot.open
      || this.#snapshot.loading
      || this.#snapshot.error
      || this.#composition?.restoreRequested
    ) return false;
    this.#emit({
      ...this.#snapshot,
      content: String(content),
      saveError: "",
    });
    return true;
  }

  beginComposition(target, baselineValue) {
    if (!this.#snapshot.open || this.#snapshot.loading) return null;
    this.#compositionSequence += 1;
    this.#composition = {
      epoch: this.#compositionSequence,
      target,
      baselineValue: String(baselineValue),
      restoreRequested: false,
    };
    this.#emit({ ...this.#snapshot, compositionActive: true });
    return this.#composition.epoch;
  }

  finishComposition(target) {
    const active = this.#composition;
    if (!active || active.target !== target) return false;
    if (!active.restoreRequested) {
      this.#composition = null;
      this.#emit({ ...this.#snapshot, compositionActive: false });
    }
    return true;
  }

  leaveEditor() {
    const active = this.#composition;
    if (!active) return false;
    this.#composition = null;
    this.#emit({
      ...this.#snapshot,
      compositionActive: false,
      ...(active.restoreRequested
        ? {}
        : { content: active.baselineValue }),
    });
    return true;
  }

  restore() {
    if (!this.#snapshot.open) return null;
    const active = this.#composition;
    if (active) active.restoreRequested = true;
    this.#emit({
      ...this.#snapshot,
      content: this.#snapshot.savedContent,
      saveError: "",
      compositionActive: false,
      editorGeneration: this.#snapshot.editorGeneration + 1,
    });
    return active?.epoch ?? null;
  }

  settleRestore(compositionEpoch) {
    if (
      compositionEpoch !== null
      && this.#composition?.epoch === compositionEpoch
    ) {
      this.#composition = null;
      return true;
    }
    return false;
  }

  get compositionActive() {
    return Boolean(this.#composition);
  }

  async save({ locked = false } = {}) {
    if (this.#savePromise) return this.#savePromise;
    if (this.#composition) return false;
    if (
      this.#snapshot.open
      && !this.#snapshot.loading
      && !this.#snapshot.error
      && this.#snapshot.content === this.#snapshot.savedContent
    ) return true;
    if (
      !this.#snapshot.open
      || this.#snapshot.loading
      || this.#snapshot.error
      || locked
      || !this.#context
    ) return false;

    const context = this.#context;
    const generation = this.#generation;
    const nextContent = this.#snapshot.content;
    const save = async () => {
      this.#emit({ ...this.#snapshot, saving: true, saveError: "" });
      const markSaved = () => {
        this.#emit({
          ...this.#snapshot,
          savedContent: nextContent,
          saving: false,
          saveError: "",
        });
      };
      try {
        await this.#bridgeClient.updateProjectFile({
          sourcePath: context.sourcePath,
          projectId: context.projectId,
          content: nextContent,
        });
        if (!this.#isCurrent(context, generation)) return false;
        markSaved();
        return true;
      } catch (cause) {
        if (!this.#isCurrent(context, generation)) return false;
        try {
          const persisted = await this.#bridgeClient.projectFile(
            context.sourcePath,
            "PROJECT.md",
          );
          if (!this.#isCurrent(context, generation)) return false;
          if (String(persisted?.content || "") === nextContent) {
            markSaved();
            return true;
          }
        } catch {
          // The original mutation failure remains the useful explanation.
        }
        if (!this.#isCurrent(context, generation)) return false;
        this.#emit({
          ...this.#snapshot,
          saving: false,
          saveError: this.#errorMessage(
            cause,
            "项目规则暂时没有保存；内容仍保留在这里，可以再次保存。",
          ),
        });
        return false;
      }
    };
    const promise = save().finally(() => {
      if (this.#savePromise === promise) this.#savePromise = null;
    });
    this.#savePromise = promise;
    return promise;
  }

  inspect({ locked = false } = {}) {
    if (!this.#snapshot.open) return { state: "resolved" };
    if (this.#snapshot.error) {
      return {
        state: "blocked",
        reason: this.#snapshot.error,
      };
    }
    if (locked && this.#snapshot.content !== this.#snapshot.savedContent) {
      return {
        state: "blocked",
        reason: "AI 处理期间不能保存项目规则。",
      };
    }
    if (
      this.#composition
      || this.#snapshot.saving
      || this.#snapshot.content !== this.#snapshot.savedContent
    ) {
      return {
        state: "pending",
        reason: this.#composition
          ? "项目规则仍在输入中。"
          : "项目规则尚未保存。",
      };
    }
    return { state: "resolved" };
  }

  get snapshot() {
    return this.#snapshot;
  }
}
