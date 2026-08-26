import { isBridgeRequestError } from "./bridge-client.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const SWITCH_DEADLINE_MS = 15_000;

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value });
}

function blocked(code, reason) {
  return Object.freeze({
    status: "blocked",
    code: String(code),
    reason: String(reason),
  });
}

function rejected(code, reason) {
  return Object.freeze({
    status: "rejected",
    code: String(code),
    reason: String(reason),
  });
}

function unknown(operationId, reason) {
  return Object.freeze({
    status: "unknown",
    operationId: String(operationId),
    reason: String(reason),
  });
}

function stale(identity) {
  return Object.freeze({
    status: "stale",
    identity: Object.freeze({ ...identity }),
  });
}

function copyOpenRequest(value) {
  if (!value || typeof value.requestId !== "string" || !value.requestId) return null;
  return Object.freeze({
    requestId: value.requestId,
    sourcePath: typeof value.sourcePath === "string" ? value.sourcePath : "",
  });
}

function copyOpenConfirmation(value) {
  if (!value || typeof value.requestId !== "string" || !value.requestId) return null;
  const classification = typeof value.classification === "string"
    ? value.classification
    : "";
  if (
    classification !== "new-external"
    && classification !== "known-external"
  ) return null;
  return Object.freeze({
    requestId: value.requestId,
    classification,
    sourceFileName: typeof value.sourceFileName === "string" ? value.sourceFileName : "",
    visibleV1FileName: typeof value.visibleV1FileName === "string"
      ? value.visibleV1FileName
      : "",
    projectsRootLabel: typeof value.projectsRootLabel === "string"
      ? value.projectsRootLabel
      : "文稿 › PageRoot › 项目",
    projectName: typeof value.projectName === "string" ? value.projectName : "",
    currentBasedOnVersionId: value.currentBasedOnVersionId || null,
    currentBasedOnOrdinal: Number(value.currentBasedOnOrdinal) || 0,
    latestOfficialVersionId: value.latestOfficialVersionId || null,
    latestOfficialOrdinal: Number(value.latestOfficialOrdinal) || 0,
    currentDiffersFromBase: value.currentDiffersFromBase === true,
    sourceRelation: value.sourceRelation === "changed" ? "changed" : "unchanged",
    deleteOriginal: value.deleteOriginal === true,
    busy: value.busy === true,
  });
}

function asOpenResult(value) {
  if (!value) return Object.freeze({ kind: "empty" });
  if (
    value.openKind === "confirmation"
    || (
      typeof value.requestId === "string"
      && value.requestId
      && (
        value.classification === "new-external"
        || value.classification === "known-external"
      )
      && typeof value.html !== "string"
    )
  ) {
    const confirmation = copyOpenConfirmation(value);
    return confirmation
      ? Object.freeze({ kind: "confirmation", confirmation })
      : Object.freeze({ kind: "invalid" });
  }
  const project = copyProject(value);
  return project
    ? Object.freeze({ kind: "project", project })
    : Object.freeze({ kind: "invalid" });
}

function copyProject(value) {
  if (!value || typeof value.name !== "string" || typeof value.html !== "string") {
    return null;
  }
  const sourcePath = value.sourcePath ? String(value.sourcePath) : null;
  const sha256 = value.sha256 ? String(value.sha256) : null;
  return Object.freeze({
    ...(value.path ? { path: String(value.path) } : {}),
    name: value.name,
    sourcePath,
    html: value.html,
    sha256,
    ...(value.lastModifiedAt
      ? { lastModifiedAt: String(value.lastModifiedAt) }
      : {}),
  });
}

function initialSnapshot(externalFileOpenSession, projectApplicationSession) {
  return Object.freeze({
    hydration: Object.freeze({
      phase: "idle",
      generation: 0,
      epoch: 0,
      sourcePath: null,
      error: null,
    }),
    switch: Object.freeze({ phase: "idle", operationId: null }),
    rename: Object.freeze({ phase: "idle", operationId: null }),
    open: Object.freeze({ phase: "idle", operationId: null, pendingKind: null }),
    close: Object.freeze({ phase: "idle", requestId: null }),
    openConfirmation: null,
    externalOpen: externalFileOpenSession.snapshot,
    projectApplication: projectApplicationSession.snapshot,
  });
}

function sourceFileName(sourcePath) {
  const value = String(sourcePath || "");
  const separator = Math.max(value.lastIndexOf("/"), value.lastIndexOf("\\"));
  return value.slice(separator + 1);
}

function sourceExtension(sourcePath) {
  return sourceFileName(sourcePath).match(/(\.html?)$/iu)?.[1] || "";
}

function normalizedRenameStem(value, sourcePath) {
  const extension = sourceExtension(sourcePath);
  let stem = String(value || "").normalize("NFC").trim();
  if (extension && stem.toLowerCase().endsWith(extension.toLowerCase())) {
    stem = stem.slice(0, -extension.length).trim();
  }
  return stem;
}

function sourceStem(sourcePath) {
  const name = sourceFileName(sourcePath);
  const extension = sourceExtension(sourcePath);
  return name.slice(0, Math.max(0, name.length - extension.length)).normalize("NFC");
}

function rebasedManagedOpenTarget(openTarget, nextSourcePath, sourceSha256) {
  if (!openTarget || typeof openTarget !== "object" || Array.isArray(openTarget)) {
    return null;
  }
  const exactSourcePath = String(nextSourcePath || "");
  if (!exactSourcePath) return null;
  return {
    ...openTarget,
    exactSourcePath,
    ...(sourceSha256 ? { sourceSha256: String(sourceSha256) } : {}),
  };
}

function documentIsStable(session) {
  return Boolean(
    session
    && !session.pendingWrite
    && !session.flushPromise
    && session.persistState === "idle"
    && session.editRevision === session.lastPersistedRevision
  );
}

function projectErrorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  return cause && typeof cause === "object" && cause.code
    ? String(cause.code)
    : fallback;
}

function projectErrorMessage(codecs, cause, fallback) {
  return codecs.errorMessage(cause, fallback);
}

// ProjectWorkflow is the PR-3 renderer project-transition boundary. Main owns
// durable project-open ordering; the injected renderer Sessions keep their
// existing fact ownership. This workflow owns only hydration/switch/close
// operations, accepted-result execution and their stale-result fences.
export class ProjectWorkflow {
  #bridgeClient;
  #ensureRegistered;
  #projectSession;
  #documentSession;
  #commentSession;
  #draftSession;
  #versionSession;
  #commentWorkflow;
  #runSession;
  #projectRulesWorkflow;
  #externalFileOpenSession;
  #projectApplicationSession;
  #documentWorkflow;
  #drainCoordinator;
  #codecs;
  #hashPort;
  #canvasPort;
  #projectOpenPort;
  #viewStatePort;
  #recentRunsPort;
  #policies;
  #scheduler;
  #clock;
  #listeners = new Set();
  #eventListeners = new Set();
  #snapshot;
  #hydrationGeneration = 0;
  #operationSequence = 0;
  #openSequence = 0;
  #applicationSequence = 0;
  #pendingOpen = null;
  #browserOpenOperationId = null;
  #openConfirmation = null;
  #externalAckPending = new Map();
  #renamePromise = null;
  #sourceLocatorPromise = null;
  #pendingLocatorReconcile = null;
  #appliedWatcherGeneration = 0;
  #locatorRetryHandle = null;
  #registeredProjectsRefresh = null;
  #reconcileScheduled = false;
  #disposed = false;
  #closeLifecycle = {
    preparingRequestId: null,
    frozenRequestId: null,
    abortedRequestIds: new Set(),
  };

  constructor({
    bridgeClient,
    ensureRegistered,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    commentWorkflow,
    runSession,
    projectRulesWorkflow,
    externalFileOpenSession,
    projectApplicationSession,
    documentWorkflow,
    drainCoordinator,
    codecs,
    ports = {},
    policies = {},
    scheduler = globalThis,
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.workspace !== "function"
      || typeof bridgeClient.source !== "function"
      || typeof bridgeClient.projectFile !== "function"
      || typeof bridgeClient.openFolder !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires its project Bridge methods.");
    }
    if (typeof ensureRegistered !== "function") {
      throw new TypeError("ProjectWorkflow requires registration authority.");
    }
    if (!projectSession || typeof projectSession.openLocator !== "function") {
      throw new TypeError("ProjectWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.reset !== "function") {
      throw new TypeError("ProjectWorkflow requires DocumentSession injection.");
    }
    if (!commentSession || typeof commentSession.reset !== "function") {
      throw new TypeError("ProjectWorkflow requires CommentSession injection.");
    }
    if (!draftSession || typeof draftSession.deactivate !== "function") {
      throw new TypeError("ProjectWorkflow requires DraftSession injection.");
    }
    if (!versionSession || typeof versionSession.reset !== "function") {
      throw new TypeError("ProjectWorkflow requires VersionSession injection.");
    }
    if (
      !commentWorkflow
      || typeof commentWorkflow.inspectDraft !== "function"
      || typeof commentWorkflow.drainDraft !== "function"
      || typeof commentWorkflow.recoverDraft !== "function"
      || typeof commentWorkflow.inspectAttachment !== "function"
      || typeof commentWorkflow.waitForAttachments !== "function"
      || typeof commentWorkflow.resetForProjectTransition !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires CommentWorkflow composition.");
    }
    if (!runSession || typeof runSession.activate !== "function") {
      throw new TypeError("ProjectWorkflow requires RunSession injection.");
    }
    if (
      !projectRulesWorkflow
      || typeof projectRulesWorkflow.inspect !== "function"
      || typeof projectRulesWorkflow.drain !== "function"
      || typeof projectRulesWorkflow.resetForProjectTransition !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires ProjectRulesWorkflow composition.");
    }
    if (!externalFileOpenSession || typeof externalFileOpenSession.enqueue !== "function") {
      throw new TypeError("ProjectWorkflow requires ExternalFileOpenSession injection.");
    }
    if (!projectApplicationSession || typeof projectApplicationSession.enqueue !== "function") {
      throw new TypeError("ProjectWorkflow requires ProjectApplicationSession injection.");
    }
    if (
      !documentWorkflow
      || typeof documentWorkflow.flush !== "function"
      || typeof documentWorkflow.enqueueEdit !== "function"
      || typeof documentWorkflow.clearRecovery !== "function"
      || typeof documentWorkflow.resetForProjectTransition !== "function"
      || typeof documentWorkflow.captureProjectTransitionAuthority !== "function"
      || typeof documentWorkflow.restoreProjectTransitionAuthority !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires DocumentWorkflow composition.");
    }
    if (!drainCoordinator || typeof drainCoordinator.replace !== "function") {
      throw new TypeError("ProjectWorkflow requires the Controller DrainCoordinator.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("ProjectWorkflow requires a HashPort.");
    }
    if (!ports.canvas || typeof ports.canvas.freeze !== "function") {
      throw new TypeError("ProjectWorkflow requires a CanvasAuthorityPort.");
    }
    if (!ports.projectOpen || typeof ports.projectOpen.mode !== "function") {
      throw new TypeError("ProjectWorkflow requires a ProjectOpenPort.");
    }
    if (!ports.viewState || typeof ports.viewState.isTransitioning !== "function") {
      throw new TypeError("ProjectWorkflow requires a ViewStatePort.");
    }
    if (!ports.recentRuns || typeof ports.recentRuns.hydrate !== "function") {
      throw new TypeError("ProjectWorkflow requires a RecentRunsPort.");
    }
    if (
      typeof policies.canCloseDuringHydration !== "function"
      || typeof policies.shouldRecoverAfterCloseAbort !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires close coordination policies.");
    }
    if (
      !scheduler
      || typeof scheduler.setTimeout !== "function"
      || typeof scheduler.clearTimeout !== "function"
    ) {
      throw new TypeError("ProjectWorkflow requires a SchedulerPort.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("ProjectWorkflow requires a ClockPort.");
    }
    for (const method of [
      "isRecord",
      "sameSourcePath",
      "versionsFromWorkspace",
      "draftAuthorityFromWorkspace",
      "authoritativeDraftRevision",
      "commentsFromRecords",
      "changesFromDraftRecords",
      "rebindTargetsPreservingGlobal",
      "activeRunFromRecord",
      "isLockedLifecycleState",
      "commentEditSessionHasChanges",
      "recoveryIdentityFromRecord",
      "errorMessage",
    ]) {
      if (typeof codecs?.[method] !== "function") {
        throw new TypeError(`ProjectWorkflow codec ${method} is required.`);
      }
    }

    this.#bridgeClient = bridgeClient;
    this.#ensureRegistered = ensureRegistered;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#commentSession = commentSession;
    this.#draftSession = draftSession;
    this.#versionSession = versionSession;
    this.#commentWorkflow = commentWorkflow;
    this.#runSession = runSession;
    this.#projectRulesWorkflow = projectRulesWorkflow;
    this.#externalFileOpenSession = externalFileOpenSession;
    this.#projectApplicationSession = projectApplicationSession;
    this.#documentWorkflow = documentWorkflow;
    this.#drainCoordinator = drainCoordinator;
    this.#codecs = codecs;
    this.#hashPort = ports.hash;
    this.#canvasPort = ports.canvas;
    this.#projectOpenPort = ports.projectOpen;
    this.#viewStatePort = ports.viewState;
    this.#recentRunsPort = ports.recentRuns;
    this.#policies = policies;
    this.#scheduler = scheduler;
    this.#clock = clock;
    this.#snapshot = initialSnapshot(
      externalFileOpenSession,
      projectApplicationSession,
    );

    this.#externalFileOpenSession.setObserver(() => {
      this.#publishSnapshot();
      this.#scheduleDeferredReconciliation();
    });
    this.#projectApplicationSession.setObserver(() => {
      this.#publishSnapshot();
      this.#scheduleDeferredReconciliation();
    });
    this.#registerDrainObligations();
  }

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("ProjectWorkflow listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("ProjectWorkflow event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    if (this.#locatorRetryHandle && typeof this.#scheduler.clearTimeout === "function") {
      this.#scheduler.clearTimeout(this.#locatorRetryHandle);
    }
    this.#locatorRetryHandle = null;
    this.#pendingLocatorReconcile = null;
    this.#externalAckPending.clear();
    this.#externalFileOpenSession.setObserver(null);
    this.#projectApplicationSession.setObserver(null);
    this.#externalFileOpenSession.dispose();
    this.#projectApplicationSession.dispose();
    for (const name of [
      "external-file-open",
      "project-application",
      "project-hydration",
      "view-transition",
      "submission",
      "attachments",
      "project-rules",
      "source",
      "draft",
      "native-edit",
    ]) this.#drainCoordinator.remove(name);
    this.#listeners.clear();
    this.#eventListeners.clear();
  }

  get projectHydrating() {
    return this.#snapshot.hydration.phase === "hydrating";
  }

  get projectLoadError() {
    return this.#snapshot.hydration.phase === "failed"
      ? this.#snapshot.hydration.error
      : null;
  }

  reportLoadFailure(message) {
    const reason = String(message || "项目状态需要重新读取。");
    this.#setHydration({
      phase: "failed",
      epoch: this.#projectSession.epoch,
      sourcePath: this.#projectSession.sourcePath,
      error: reason,
    });
  }

  async retryHydration() {
    const sourcePath = this.#projectSession.sourcePath;
    if (!sourcePath) {
      return blocked("PROJECT_SOURCE_REQUIRED", "当前页面没有可重新读取的源文件。");
    }
    const epoch = this.#projectSession.epoch;
    this.#setHydration({ phase: "hydrating", epoch, sourcePath, error: null });
    return this.refreshWorkspace({
      sourcePath,
      epoch,
      sourceTransitionToken: epoch,
    });
  }

  async refreshWorkspace({
    sourcePath,
    epoch,
    fromDeferred = false,
    sourceTransitionToken,
  } = {}) {
    if (this.#disposed) {
      return blocked("PROJECT_WORKFLOW_DISPOSED", "项目读取工作流已经停止。");
    }
    if (!fromDeferred && sourceTransitionToken === undefined) {
      const deferred = this.#deferCanvasCommand(
        "external-refresh",
        () => this.refreshWorkspace({
          sourcePath,
          epoch,
          fromDeferred: true,
          sourceTransitionToken,
        }),
        { authority: "system" },
      );
      if (deferred) return deferred;
    }
    return this.#hydrateWorkspace({
      sourcePath,
      epoch,
      sourceTransitionToken,
    });
  }

  async prepareSwitch({ fromDeferred = false } = {}) {
    if (this.#disposed) {
      return blocked("PROJECT_WORKFLOW_DISPOSED", "项目切换工作流已经停止。");
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "project-switch",
        () => this.prepareSwitch({ fromDeferred: true }),
      );
      if (deferred) return deferred;
    }

    const operationId = this.#nextOperationId("switch");
    this.#setSwitch("preparing", operationId);
    try {
      const hardBlocker = this.#drainCoordinator
        .inspect("switch")
        .find((status) => status.state === "blocked");
      if (hardBlocker) {
        return blocked("PROJECT_SWITCH_BLOCKED", hardBlocker.reason);
      }
      if (this.projectLoadError) {
        this.#commentWorkflow.resetForProjectTransition();
        this.#draftSession.deactivate();
        this.#documentWorkflow.resetForProjectTransition();
        return succeeded({ operationId });
      }
      if (this.#runSession.activeLocked) {
        const drained = await this.#drainCoordinator.drain("switch", {
          deadlineAt: this.#clock.now() + SWITCH_DEADLINE_MS,
        });
        return drained.ok
          ? succeeded({ operationId })
          : blocked("PROJECT_SWITCH_DRAIN_BLOCKED", drained.reason);
      }
      if (this.#documentWorkflow.hasHistoryAction) {
        const historyOutcome = await this.#documentWorkflow.waitForHistoryAction();
        if (historyOutcome.status !== "succeeded") {
          return blocked(
            "PROJECT_SWITCH_HISTORY_PENDING",
            "当前撤销或重做没有安全完成。",
          );
        }
      }

      const canvasIsMounted = typeof this.#canvasPort.isMounted !== "function"
        || this.#canvasPort.isMounted();
      const shouldCommitCanvas = !this.#isHistoryView() && canvasIsMounted;
      let committed = shouldCommitCanvas
        ? this.#canvasPort.fencePendingEdit({
            resumeEditing: false,
            trigger: "project-switch",
          })
        : null;
      if (shouldCommitCanvas && (!committed || !committed.ok)) {
        const reason = committed?.reason || "请点回文字完成输入，再切换项目。";
        this.#canvasPort.showCommitBlocked?.(reason);
        return blocked("PROJECT_SWITCH_NATIVE_EDIT", reason);
      }

      const cutoffRevision = this.#documentSession.editRevision;
      const drained = await this.#drainCoordinator.drain("switch", {
        deadlineAt: this.#clock.now() + SWITCH_DEADLINE_MS,
      });
      if (!drained.ok) {
        return blocked("PROJECT_SWITCH_DRAIN_BLOCKED", drained.reason);
      }
      if (
        this.#documentSession.editRevision !== cutoffRevision
        || this.#documentSession.pendingWrite
        || this.#documentSession.flushPromise
        || this.#documentWorkflow.hasHistoryAction
      ) {
        return blocked(
          "PROJECT_SWITCH_SOURCE_CHANGED",
          "当前 HTML 在切换边界后仍有修改尚未安全写回。",
        );
      }
      if (shouldCommitCanvas) {
        const canvasOutcome = await this.#documentWorkflow.ensureCurrentCanvas({
          context: this.#projectSession.context || undefined,
        });
        if (canvasOutcome.status !== "succeeded") {
          return blocked(
            "PROJECT_SWITCH_CANVAS_UNVERIFIED",
            canvasOutcome.reason || "当前画布尚未完成自动恢复。",
          );
        }
        committed = this.#canvasPort.fencePendingEdit({
          resumeEditing: false,
          trigger: "project-switch",
        });
        if (!committed || !committed.ok) {
          return blocked(
            "PROJECT_SWITCH_FINAL_FENCE",
            committed?.reason || "当前画布尚未完成最终安全收口。",
          );
        }
      }
      if (
        this.#projectSession.sourcePath
        && committed
        && (
          this.#documentSession.lastPersistedRevision !== cutoffRevision
          || this.#documentSession.sourceSha256 !== committed.sourceSha256
        )
      ) {
        return blocked(
          "PROJECT_SWITCH_SOURCE_MISMATCH",
          "当前 HTML 与画布的最终身份不一致。",
        );
      }
      return succeeded({ operationId });
    } catch (cause) {
      return rejected(
        projectErrorCode(cause, "PROJECT_SWITCH_REJECTED"),
        projectErrorMessage(this.#codecs, cause, "项目切换前的安全检查失败。"),
      );
    } finally {
      this.#setSwitch("idle", null);
    }
  }

  async openProject({
    kind = "local",
    sourcePath,
    projectId,
    fromDeferred = false,
  } = {}) {
    if (this.#snapshot.close.phase === "ready") {
      return blocked(
        "PROJECT_OPEN_CLOSE_COMMITTED",
        "当前窗口正在关闭，新的 HTML 将由下一次启动接收。",
      );
    }
    if (kind === "startup") return this.#openStartup();
    const operationId = this.#nextOpenOperation();
    this.#setOpen("opening", operationId, null);
    try {
      if (
        kind === "local"
        && this.#projectOpenPort.mode() === "browser-file"
      ) {
        // Request the hidden file input in this same user-activation turn.
        // Awaiting prepareSwitch() first yields past the click, so Chromium
        // silently ignores input.click() and encoding-error "重新选择" cannot
        // reopen the picker. The accepted-project FIFO still fences on apply.
        this.#pendingOpen = null;
        this.#browserOpenOperationId = operationId;
        this.#emit({ type: "project-browser-file-requested", operationId });
        return succeeded({ operationId, awaitingFile: true });
      }

      if (kind === "local" || kind === "recent") {
        const opened = kind === "recent"
          ? await this.#projectOpenPort.openRecent(String(sourcePath || ""))
          : await this.#projectOpenPort.openLocal();
        if (this.#snapshot.close.phase === "ready") {
          return blocked(
            "PROJECT_OPEN_CLOSE_COMMITTED",
            "当前窗口正在关闭，没有接收新的 HTML。",
          );
        }
        const result = asOpenResult(opened);
        if (result.kind === "empty") {
          return succeeded({ operationId, opened: false });
        }
        if (result.kind === "confirmation") {
          this.#presentOpenConfirmation(result.confirmation);
          return succeeded({
            operationId,
            opened: false,
            awaitingConfirmation: true,
          });
        }
        if (result.kind !== "project") {
          return rejected(
            "PROJECT_OPEN_REJECTED",
            "这次打开没有返回可安全切换的 HTML。",
          );
        }
        const switchOutcome = await this.prepareSwitch({ fromDeferred });
        if (this.#snapshot.close.phase === "ready") {
          return blocked(
            "PROJECT_OPEN_CLOSE_COMMITTED",
            "当前窗口正在关闭，没有接收新的 HTML。",
          );
        }
        if (switchOutcome.status !== "succeeded") {
          this.#pendingOpen = Object.freeze({
            kind,
            sourcePath: sourcePath || null,
            projectId: projectId || null,
          });
          this.#setOpen("deferred", null, kind);
          return switchOutcome;
        }
        this.#pendingOpen = null;
        const accepted = this.#enqueueAcceptedProject(result.project, {
          kind,
          operationId,
          sourcePath: sourcePath || null,
        });
        if (!accepted) {
          return rejected(
            "PROJECT_APPLICATION_REJECTED",
            "无法安排当前 HTML 的安全切换。",
          );
        }
        return succeeded({ operationId, opened: true });
      }

      const switchOutcome = await this.prepareSwitch({ fromDeferred });
      if (this.#snapshot.close.phase === "ready") {
        return blocked(
          "PROJECT_OPEN_CLOSE_COMMITTED",
          "当前窗口正在关闭，没有接收新的 HTML。",
        );
      }
      if (switchOutcome.status !== "succeeded") {
        this.#pendingOpen = Object.freeze({
          kind,
          sourcePath: sourcePath || null,
          projectId: projectId || null,
        });
        this.#setOpen("deferred", null, kind);
        return switchOutcome;
      }
      this.#pendingOpen = null;
      const project = await this.#openRegisteredProject(String(projectId || ""));
      if (!project) return succeeded({ operationId, opened: false });
      if (this.#snapshot.close.phase === "ready") {
        return blocked(
          "PROJECT_OPEN_CLOSE_COMMITTED",
          "当前窗口正在关闭，没有接收新的 HTML。",
        );
      }
      const accepted = this.#enqueueAcceptedProject(project, {
        kind,
        operationId,
        sourcePath: sourcePath || null,
      });
      if (!accepted) {
        return rejected(
          "PROJECT_APPLICATION_REJECTED",
          "无法安排当前 HTML 的安全切换。",
        );
      }
      return succeeded({ operationId, opened: true });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        kind === "recent"
          ? "文件可能已移动；可重新选择当前位置，或移除旧记录。"
          : kind === "registered"
            ? "项目目录或工作文件在打开前发生变化；当前项目仍保持不变。"
          : "文件可能已移动或暂时不可读；可重新选择。",
      );
      this.#emit({
        type: "project-open-failed",
        kind,
        operationId,
        reason,
        sourcePath: sourcePath || null,
      });
      return rejected(projectErrorCode(cause, "PROJECT_OPEN_REJECTED"), reason);
    } finally {
      if (this.#snapshot.open.operationId === operationId) {
        this.#setOpen("idle", null, this.#pendingOpen?.kind || null);
      }
    }
  }

  acceptBrowserProject({ operationId, project } = {}) {
    if (this.#snapshot.close.phase === "ready") {
      return blocked(
        "PROJECT_OPEN_CLOSE_COMMITTED",
        "当前窗口正在关闭，没有接收新的 HTML。",
      );
    }
    if (!operationId && !this.#browserOpenOperationId) {
      // A trusted hidden file input can be populated directly (for example by
      // accessibility automation) without the real picker command. It still
      // enters the accepted FIFO, whose executor repeats the full switch fence.
      return this.acceptProject(project, {
        kind: "browser-file",
        operationId: this.#nextOpenOperation(),
        sourcePath: null,
      });
    }
    if (!operationId || operationId !== this.#browserOpenOperationId) {
      return stale({ operationId: String(operationId || ""), kind: "browser-file" });
    }
    this.#browserOpenOperationId = null;
    const accepted = this.#enqueueAcceptedProject(project, {
      kind: "browser-file",
      operationId,
      sourcePath: null,
    });
    this.#setOpen("idle", null, null);
    return accepted
      ? succeeded({ operationId, accepted: true })
      : rejected("PROJECT_APPLICATION_REJECTED", "无法安排当前 HTML 的安全切换。");
  }

  acceptProject(project, {
    kind = "accepted",
    operationId = this.#nextOpenOperation(),
    sourcePath = null,
  } = {}) {
    if (this.#snapshot.close.phase === "ready") {
      return blocked(
        "PROJECT_OPEN_CLOSE_COMMITTED",
        "当前窗口正在关闭，没有接收新的 HTML。",
      );
    }
    const accepted = this.#enqueueAcceptedProject(project, {
      kind,
      operationId,
      sourcePath,
    });
    return accepted
      ? succeeded({ operationId, accepted: true })
      : rejected("PROJECT_APPLICATION_REJECTED", "无法安排当前 HTML 的安全切换。");
  }

  acceptExternalProject(value) {
    if (this.#snapshot.close.phase === "ready") {
      return blocked(
        "EXTERNAL_PROJECT_CLOSE_COMMITTED",
        "当前窗口正在关闭，外部 HTML 由下一次启动接收。",
      );
    }
    const request = copyOpenRequest(value);
    if (!request) {
      return rejected("EXTERNAL_PROJECT_REQUEST_INVALID", "外部 HTML 请求身份无效。");
    }
    const accepted = this.#externalFileOpenSession.enqueue(
      request,
      (next, options) => this.#openExternalProject(next, options),
    );
    if (accepted) this.#pendingOpen = null;
    this.#publishSnapshot();
    return accepted
      ? succeeded({ requestId: request.requestId })
      : blocked("EXTERNAL_PROJECT_DUPLICATE", "这个外部 HTML 请求已经处理过。");
  }

  resumeDeferredExternalProject() {
    const resumed = this.#externalFileOpenSession.resume(
      (request, options) => this.#openExternalProject(request, options),
    );
    return resumed
      ? succeeded({ resumed: true })
      : blocked("EXTERNAL_PROJECT_NOT_DEFERRED", "没有等待重试的外部 HTML。");
  }

  resumeDeferredProjectApplication() {
    const resumed = this.#projectApplicationSession.resume(
      (application) => this.#applyAcceptedProject(application),
    );
    return resumed
      ? succeeded({ resumed: true })
      : blocked("PROJECT_APPLICATION_NOT_DEFERRED", "没有等待继续的 HTML 切换。");
  }

  reconcileDeferred() {
    if (this.#disposed) return;
    const switchBlocked = this.#drainCoordinator
      .inspect("switch")
      .some((status) => status.state !== "resolved");
    if (this.#projectApplicationSession.snapshot.status === "deferred") {
      const retry = this.#projectApplicationSession.reconcileDeferredSwitch({
        switchBlocked,
        execute: (application) => this.#applyAcceptedProject(application),
      });
      if (retry === "action-required") {
        this.#emit({ type: "project-application-deferred" });
      }
      return;
    }
    if (this.#externalFileOpenSession.snapshot.status === "deferred") {
      const retry = this.#externalFileOpenSession.reconcileDeferredSwitch({
        switchBlocked,
        execute: (request, options) => this.#openExternalProject(request, options),
      });
      if (retry === "action-required") {
        const requestId = this.#externalFileOpenSession.snapshot.deferredRequestId;
        this.#emit({
          type: "external-project-open-deferred",
          requestId,
          ackPending: Boolean(requestId && this.#externalAckPending.has(requestId)),
        });
      }
      return;
    }
    if (!this.#pendingOpen || switchBlocked) return;
    const pending = this.#pendingOpen;
    this.#pendingOpen = null;
    void this.openProject({ ...pending, fromDeferred: true });
  }

  async prepareClose({ requestId, deadlineAt } = {}) {
    const closeRequestId = String(requestId || "");
    if (!closeRequestId || !Number.isFinite(Number(deadlineAt))) {
      return {
        ready: false,
        reason: "桌面关闭请求缺少完整身份。",
        presentation: "native",
      };
    }
    let imposedEditorFreeze = false;
    let frozenHtml = null;
    let frozenSourceSha256 = null;
    let ready = false;
    const lifecycle = this.#closeLifecycle;
    const inAppBlock = (reason) => ({
      ready: false,
      reason: String(reason),
      presentation: "in-app",
    });
    const projectOpenInFlight = () => (
      this.#snapshot.open.phase === "opening"
      || this.#externalFileOpenSession.snapshot.status !== "idle"
      || this.#projectApplicationSession.snapshot.status !== "idle"
    );
    const drainProjectOpenSessions = async () => {
      while (projectOpenInFlight()) {
        const result = await this.#drainCoordinator.drain("close", {
          deadlineAt: Number(deadlineAt) - 250,
        });
        if (!result.ok) return inAppBlock(result.reason);
      }
      return null;
    };
    lifecycle.preparingRequestId = closeRequestId;
    this.#setClose("preparing", closeRequestId);
    try {
      const projectOpenBlock = await drainProjectOpenSessions();
      if (projectOpenBlock) return projectOpenBlock;
      if (this.projectHydrating) {
        if (projectOpenInFlight()) {
          return inAppBlock("HTML 打开仍未安全完成，已取消关闭。");
        }
        const draftState = this.#draftSession.inspect();
        if (this.#policies.canCloseDuringHydration({
          projectHydrating: true,
          viewTransitioning: this.#viewStatePort.isTransitioning(),
          submissionPending: this.#runSession.submissionPending,
          persistState: this.#documentSession.persistState,
          pendingWrite: Boolean(this.#documentSession.pendingWrite),
          flushInProgress: Boolean(this.#documentSession.flushPromise),
          draftPending: draftState.pending,
          draftFlushInProgress: draftState.writing,
          editRevision: this.#documentSession.editRevision,
          lastPersistedRevision: this.#documentSession.lastPersistedRevision,
        })) {
          ready = true;
          return { ready: true };
        }
        return inAppBlock("项目状态尚未读取完成，已取消关闭以避免覆盖未知编辑状态。");
      }
      if (this.projectLoadError) {
        if (projectOpenInFlight()) {
          return inAppBlock("HTML 打开仍未安全完成，已取消关闭。");
        }
        if (
          this.#documentSession.pendingWrite
          || this.#documentSession.flushPromise
          || this.#documentWorkflow.hasHistoryAction
        ) {
          return inAppBlock("项目读取失败且仍有待恢复的 HTML 修改，请先重试读取或导出副本。");
        }
        ready = true;
        return { ready: true };
      }
      if (this.#documentWorkflow.hasHistoryAction) {
        const historyOutcome = await this.#documentWorkflow.waitForHistoryAction();
        if (historyOutcome.status !== "succeeded") {
          return inAppBlock("当前撤销或重做没有安全完成，已取消关闭。");
        }
      }
      const canvasIsMounted = typeof this.#canvasPort.isMounted !== "function"
        || this.#canvasPort.isMounted();
      if (
        !this.#isHistoryView()
        && !this.#runSession.activeLocked
        && canvasIsMounted
      ) {
        const frozen = this.#canvasPort.freeze();
        if (!frozen) {
          return inAppBlock("编辑画布尚未就绪，已取消关闭以避免丢失文字草稿。");
        }
        if (!frozen.ok) {
          return inAppBlock(frozen.reason || "当前文字草稿无法安全提交，已取消关闭。");
        }
        imposedEditorFreeze = true;
        frozenHtml = frozen.html;
        frozenSourceSha256 = frozen.sourceSha256;
        lifecycle.frozenRequestId = closeRequestId;
        if (
          frozen.html !== this.#documentSession.html
          && (Boolean(this.#projectSession.sourcePath) || Boolean(frozen.pendingMutation))
        ) {
          const editOutcome = this.#documentWorkflow.enqueueEdit({
            html: frozen.html,
            mutation: frozen.pendingMutation || undefined,
            context: this.#projectSession.context || undefined,
          });
          if (editOutcome.status !== "succeeded") {
            return inAppBlock(editOutcome.reason || "当前文字没有进入安全写回队列。");
          }
        }
      }
      const cutoffRevision = this.#documentSession.editRevision;
      const drained = await this.#drainCoordinator.drain("close", {
        deadlineAt: Number(deadlineAt) - 250,
      });
      if (!drained.ok) return inAppBlock(drained.reason);
      if (
        imposedEditorFreeze
        && this.#projectSession.sourcePath
        && frozenHtml !== null
      ) {
        const boundaryOutcome = await this.#documentWorkflow.reconcileBoundary({
          frozenHtml,
          reportedSourceSha256: frozenSourceSha256,
          cutoffRevision,
          identity: this.#projectSession.snapshot,
          timeoutMs: 2_500,
        });
        if (boundaryOutcome.status !== "succeeded") {
          const reason = boundaryOutcome.reason
            || "关闭核对期间当前项目已切换，当前页面仍保持开启。";
          this.#emit({
            type: "project-close-reconciliation-blocked",
            code: boundaryOutcome.code || "",
            reason,
          });
          return inAppBlock(reason);
        }
      }
      if (lifecycle.abortedRequestIds.has(closeRequestId)) {
        return inAppBlock("桌面外壳已取消本次关闭。");
      }
      if (projectOpenInFlight()) {
        return inAppBlock("HTML 打开在关闭核对期间开始，已取消本次关闭。");
      }
      ready = true;
      this.#setClose("ready", closeRequestId);
      return { ready: true };
    } catch (cause) {
      return {
        ready: false,
        reason: cause instanceof Error ? cause.message : "关闭前安全写入检查失败。",
        presentation: "native",
      };
    } finally {
      if (lifecycle.preparingRequestId === closeRequestId) {
        lifecycle.preparingRequestId = null;
      }
      if (!ready && imposedEditorFreeze && !this.#runSession.activeLocked) {
        if (lifecycle.frozenRequestId === closeRequestId) {
          lifecycle.frozenRequestId = null;
        }
        this.#canvasPort.unlock?.();
      }
      lifecycle.abortedRequestIds.delete(closeRequestId);
      if (!ready) this.#setClose("idle", null);
    }
  }

  abortClose({ requestId } = {}) {
    const closeRequestId = String(requestId || "");
    if (!closeRequestId) return;
    const lifecycle = this.#closeLifecycle;
    lifecycle.abortedRequestIds.add(closeRequestId);
    if (lifecycle.preparingRequestId === closeRequestId) return;
    if (
      this.#snapshot.close.requestId === closeRequestId
      && this.#snapshot.close.phase === "ready"
    ) {
      this.#setClose("idle", null);
    }
    if (lifecycle.frozenRequestId !== closeRequestId) {
      lifecycle.abortedRequestIds.delete(closeRequestId);
      return;
    }
    const draftState = this.#draftSession.inspect();
    const mayRecover = this.#policies.shouldRecoverAfterCloseAbort({
      approvedRequestId: lifecycle.frozenRequestId,
      abortedRequestId: closeRequestId,
      imposedEditorFreeze: true,
      projectLocked: this.#runSession.activeLocked,
      projectHydrating: this.projectHydrating,
      projectLoadError: Boolean(this.projectLoadError),
      viewTransitioning: this.#viewStatePort.isTransitioning(),
      submissionPending: this.#runSession.submissionPending,
      persistState: this.#documentSession.persistState,
      pendingWrite: Boolean(this.#documentSession.pendingWrite),
      flushInProgress: Boolean(this.#documentSession.flushPromise),
      draftPending: draftState.pending,
      draftFlushInProgress: draftState.writing,
      draftPersistError: Boolean(draftState.error),
      editRevision: this.#documentSession.editRevision,
      lastPersistedRevision: this.#documentSession.lastPersistedRevision,
    });
    if (!mayRecover) return;
    lifecycle.frozenRequestId = null;
    lifecycle.abortedRequestIds.delete(closeRequestId);
    this.#canvasPort.unlock?.();
    this.#setClose("idle", null);
  }

  hasPending(boundary) {
    return this.#drainCoordinator.hasPending(boundary);
  }

  inspectDrain(boundary) {
    return this.#drainCoordinator.inspect(boundary);
  }

  drain(boundary, options) {
    return this.#drainCoordinator.drain(boundary, options);
  }

  drainCloseFallback({ deadlineAt } = {}) {
    return this.#drainCoordinator.drain("close", {
      deadlineAt: Number(deadlineAt) || this.#clock.now() + 3_000,
    });
  }

  async readProjectFile({ context, relativePath } = {}) {
    const activeContext = context || this.#projectSession.context;
    if (!activeContext || !this.#projectSession.matches(activeContext)) {
      return blocked("PROJECT_CONTEXT_REQUIRED", "当前项目身份尚未完成初始化。");
    }
    try {
      const payload = await this.#bridgeClient.projectFile(
        activeContext.sourcePath,
        String(relativePath || ""),
      );
      if (!this.#projectSession.matches(activeContext)) return stale(activeContext);
      return succeeded({ content: String(payload.content || "") });
    } catch (cause) {
      return this.#outcomeFromCause(
        this.#nextOperationId("project-file"),
        cause,
        "PROJECT_FILE_REJECTED",
        "项目文件暂时无法读取。",
      );
    }
  }

  async openProjectRecords({ context } = {}) {
    const activeContext = context || this.#projectSession.context;
    if (!activeContext || !this.#projectSession.matches(activeContext)) {
      return blocked("PROJECT_CONTEXT_REQUIRED", "当前项目身份尚未完成初始化。");
    }
    const operationId = this.#nextOperationId("project-folder");
    try {
      const payload = await this.#bridgeClient.openFolder({
        sourcePath: activeContext.sourcePath,
      });
      if (!this.#projectSession.matches(activeContext)) return stale(activeContext);
      if (payload.ok === false) {
        return rejected("PROJECT_FOLDER_REJECTED", "无法打开项目记录。");
      }
      return succeeded({ opened: true });
    } catch (cause) {
      return this.#outcomeFromCause(
        operationId,
        cause,
        "PROJECT_FOLDER_REJECTED",
        "项目记录暂时无法打开。",
      );
    }
  }

  async refreshRecents() {
    if (typeof this.#projectOpenPort.listRecent !== "function") {
      return succeeded({ projects: [] });
    }
    try {
      const projects = await this.#projectOpenPort.listRecent();
      this.#emit({ type: "project-recents-loaded", projects });
      return succeeded({ projects });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        "最近打开记录暂时无法读取。",
      );
      this.#emit({ type: "project-recents-failed", reason });
      return rejected("PROJECT_RECENTS_REJECTED", reason);
    }
  }

  async refreshRegisteredProjects() {
    if (typeof this.#projectOpenPort.listRegistered !== "function") {
      return succeeded({ projects: [] });
    }
    if (this.#registeredProjectsRefresh) return this.#registeredProjectsRefresh;
    this.#registeredProjectsRefresh = this.#refreshRegisteredProjects();
    return this.#registeredProjectsRefresh;
  }

  async #refreshRegisteredProjects() {
    try {
      const projects = await this.#projectOpenPort.listRegistered();
      this.#emit({ type: "project-catalog-loaded", projects });
      return succeeded({ projects });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        "项目目录暂时无法读取。",
      );
      this.#emit({ type: "project-catalog-failed", reason });
      return rejected("PROJECT_CATALOG_REJECTED", reason);
    } finally {
      this.#registeredProjectsRefresh = null;
    }
  }

  scheduleProjectListRefreshAfterSettlement(context) {
    if (this.#disposed || !context || !this.#projectSession.matches(context)) return;
    // Project/Document/Version/Draft/Comment publication and Working Copy
    // confirmation are the authoritative path. Recent and catalog are
    // deferrable projections that refresh only after that settlement and
    // must never block or downgrade it.
    void Promise.all([
      this.refreshRecents(),
      this.refreshRegisteredProjects(),
    ]);
  }

  renameSource({ stem, deadlineAt } = {}) {
    if (this.#disposed) {
      return Promise.resolve(blocked(
        "PROJECT_WORKFLOW_DISPOSED",
        "项目工作流已经停止。",
      ));
    }
    if (this.#renamePromise) return this.#renamePromise;
    if (this.#sourceLocatorPromise) {
      return this.#sourceLocatorPromise.then(() => this.renameSource({ stem, deadlineAt }));
    }
    const operation = this.#runSourceRename({ stem, deadlineAt });
    this.#renamePromise = operation;
    this.#sourceLocatorPromise = operation;
    operation.finally(() => {
      if (this.#renamePromise === operation) this.#renamePromise = null;
      if (this.#sourceLocatorPromise === operation) this.#sourceLocatorPromise = null;
    }).catch(() => {
      // #runSourceRename always converts failures to typed outcomes.
    });
    return operation;
  }

  reconcileExternalSourceLocator(input = {}) {
    if (this.#disposed) {
      return Promise.resolve(blocked(
        "PROJECT_WORKFLOW_DISPOSED",
        "项目工作流已经停止。",
      ));
    }
    const request = {
      reason: String(input.reason || "watch"),
      watcherGeneration: Number(input.watcherGeneration || 0),
      previousSourcePath: input.previousSourcePath
        ? String(input.previousSourcePath)
        : null,
      sourceMissing: input.sourceMissing === true
        ? true
        : input.sourceMissing === false ? false : null,
    };
    if (!this.#pendingLocatorReconcile) {
      this.#pendingLocatorReconcile = request;
    } else if (
      request.watcherGeneration >= Number(this.#pendingLocatorReconcile.watcherGeneration || 0)
    ) {
      const pending = this.#pendingLocatorReconcile;
      this.#pendingLocatorReconcile = {
        ...request,
        sourceMissing: pending.sourceMissing === true || request.sourceMissing === true
          ? true
          : pending.sourceMissing === false && request.sourceMissing === false
            ? false
            : null,
      };
    }
    if (this.#sourceLocatorPromise) {
      return this.#sourceLocatorPromise.then((result) => {
        if (this.#disposed) {
          return blocked("PROJECT_WORKFLOW_DISPOSED", "项目工作流已经停止。");
        }
        if (this.#sourceLocatorPromise) return this.#sourceLocatorPromise;
        if (this.#pendingLocatorReconcile) {
          return this.reconcileExternalSourceLocator(this.#pendingLocatorReconcile);
        }
        return result;
      });
    }
    const requested = this.#pendingLocatorReconcile;
    this.#pendingLocatorReconcile = null;
    const operation = this.#runLocatorReconcile(requested);
    this.#sourceLocatorPromise = operation;
    operation.finally(() => {
      if (this.#sourceLocatorPromise === operation) this.#sourceLocatorPromise = null;
    }).catch(() => {
      // #runLocatorReconcile always converts failures to typed outcomes.
    });
    return operation;
  }

  async #runSourceRename({ stem, deadlineAt } = {}) {
    let context = this.#projectSession.context;
    let previousSourcePath = context?.sourcePath || "";
    let expectedSha256 = this.#documentSession.sourceSha256;
    const requestedStem = normalizedRenameStem(stem, previousSourcePath);
    const operationId = this.#nextOperationId("source-rename");
    const renameDeadline = Number(deadlineAt) || Date.now() + SWITCH_DEADLINE_MS;
    let canvasFrozen = false;
    let renameCommitted = false;
    try {
      if (!context || !this.#projectSession.matches(context)) {
        return blocked("SOURCE_RENAME_CONTEXT_REQUIRED", "当前项目身份尚未完成初始化。");
      }
      if (this.#managedOpenTarget()) {
        const reconciled = await this.#runLocatorReconcile({
          reason: "rename",
          previousSourcePath,
        });
        if (reconciled.status === "rejected" || reconciled.status === "unknown") {
          return reconciled;
        }
        context = this.#projectSession.context;
        previousSourcePath = context?.sourcePath || previousSourcePath;
        expectedSha256 = this.#documentSession.sourceSha256;
        if (!context || !this.#projectSession.matches(context)) {
          return stale(context || { sourcePath: previousSourcePath });
        }
        if (this.#documentSession.persistState === "conflict") {
          return blocked(
            "SOURCE_RENAME_CONFLICT",
            "当前 HTML 与外部文件存在冲突，请先选择要保留的版本。",
          );
        }
      }
      if (!previousSourcePath || !expectedSha256 || !SHA256.test(expectedSha256)) {
        return blocked("SOURCE_RENAME_SOURCE_REQUIRED", "当前源 HTML 尚未形成可验证的文件身份。");
      }
      if (!requestedStem) {
        return rejected("SOURCE_RENAME_STEM_REQUIRED", "请输入新的 HTML 文件名。");
      }
      if (this.#runSession.activeLocked) {
        return blocked("SOURCE_RENAME_RUN_LOCKED", "当前 AI 任务仍在处理，不能修改文件名。");
      }
      if (this.projectHydrating || this.projectLoadError || this.#isHistoryView()) {
        return blocked("SOURCE_RENAME_VIEW_UNAVAILABLE", "当前视图尚未形成可安全重命名的源页面。");
      }
      if (typeof this.#projectOpenPort.renameSource !== "function") {
        return blocked("SOURCE_RENAME_UNAVAILABLE", "当前运行环境不能安全修改 HTML 文件名。");
      }

      const currentStem = sourceStem(previousSourcePath);
      if (requestedStem === currentStem) {
        return succeeded({ context, unchanged: true, sourcePath: previousSourcePath });
      }

      const committed = this.#canvasPort.fencePendingEdit?.({
        resumeEditing: true,
        trigger: "project-rename",
      });
      if (!committed || !committed.ok) {
        return blocked(
          "SOURCE_RENAME_NATIVE_EDIT_PENDING",
          String(committed?.reason || "请先完成当前文字输入，再修改文件名。"),
        );
      }
      if (
        committed.html !== this.#documentSession.html
        || committed.pendingMutation
      ) {
        const enqueued = this.#documentWorkflow.enqueueEdit({
          html: committed.html,
          mutation: committed.pendingMutation || undefined,
          context,
        });
        if (enqueued.status !== "succeeded") {
          return this.#dependencyOutcome(
            enqueued,
            context,
            "SOURCE_RENAME_DOCUMENT_EDIT_REJECTED",
            "当前文字尚未安全进入源 HTML 写回队列。",
          );
        }
      }

      const drained = await this.#drainCoordinator.drain("switch", {
        deadlineAt: renameDeadline,
      });
      if (!drained.ok) {
        return blocked(
          "SOURCE_RENAME_DRAIN_INCOMPLETE",
          String(drained.reason || "当前项目尚未完成安全保存。"),
        );
      }
      if (
        this.#disposed
        || !this.#projectSession.matches(context)
        || !this.#codecs.sameSourcePath(this.#projectSession.sourcePath, previousSourcePath)
        || this.#documentSession.sourceSha256 !== expectedSha256
        || !documentIsStable(this.#documentSession)
        || this.#documentWorkflow.hasHistoryAction
      ) {
        return stale(context);
      }

      const frozen = this.#canvasPort.freeze(
        "编辑画布尚未完成安全收口，不能修改文件名。",
      );
      if (!frozen?.ok) {
        return blocked(
          "SOURCE_RENAME_CANVAS_FENCE_REJECTED",
          String(frozen?.reason || "编辑画布尚未完成安全收口。"),
        );
      }
      canvasFrozen = true;
      if (
        frozen.html !== this.#documentSession.html
        || frozen.pendingMutation
      ) {
        const enqueued = this.#documentWorkflow.enqueueEdit({
          html: frozen.html,
          mutation: frozen.pendingMutation || undefined,
          context,
        });
        if (enqueued.status !== "succeeded") {
          return this.#dependencyOutcome(
            enqueued,
            context,
            "SOURCE_RENAME_FINAL_EDIT_REJECTED",
            "刚刚的文字输入没有安全写入源 HTML。",
          );
        }
        return blocked(
          "SOURCE_RENAME_FINAL_EDIT_QUEUED",
          "刚刚还有文字输入，源页正在安全保存，请稍后再试。",
        );
      }

      this.#setRename("renaming", operationId);
      let result;
      try {
        result = await this.#projectOpenPort.renameSource({
          operationId,
          sourcePath: previousSourcePath,
          stem: requestedStem,
          expectedSha256,
        });
      } catch (cause) {
        const active = typeof this.#projectOpenPort.getActive === "function"
          ? await this.#projectOpenPort.getActive().catch(() => null)
          : null;
        const expectedFileName = `${requestedStem}${sourceExtension(previousSourcePath)}`;
        if (
          !active
          || active.sha256 !== expectedSha256
          || sourceFileName(active.sourcePath).normalize("NFC")
            !== expectedFileName.normalize("NFC")
        ) throw cause;
        result = {
          ...active,
          operationId,
          previousSourcePath,
          fileName: expectedFileName,
          stem: requestedStem,
          extension: sourceExtension(previousSourcePath),
          renamed: true,
          replayed: true,
          workspaceRelinked: false,
        };
      }
      if (
        !result
        || String(result.operationId || "") !== operationId
        || !this.#codecs.sameSourcePath(result.previousSourcePath, previousSourcePath)
        || String(result.sha256 || "") !== expectedSha256
        || !String(result.sourcePath || "")
      ) {
        throw new Error("重命名结果与当前文件身份不一致。");
      }
      renameCommitted = true;
      if (
        this.#disposed
        || !this.#projectSession.matches(context)
        || this.#documentSession.sourceSha256 !== expectedSha256
      ) return stale(context);

      const nextSourcePath = String(result.sourcePath);
      const transitioned = this.#publishSourceLocatorChange({
        previousSourcePath,
        nextSourcePath,
        context,
        expectedSha256,
        openTarget: this.#projectSession.openTarget,
      });
      if (!transitioned || !this.#projectSession.context) {
        throw new Error("文件已重命名，但当前项目身份已经变化。");
      }

      const [recents, hydrated] = await Promise.all([
        this.refreshRecents(),
        this.refreshWorkspace({
          sourcePath: nextSourcePath,
          epoch: transitioned.epoch,
          fromDeferred: true,
        }),
      ]);
      if (
        recents.status !== "succeeded"
        || hydrated.status !== "succeeded"
      ) {
        return unknown(
          operationId,
          "文件名已经修改，但项目状态还没有完成刷新。",
        );
      }
      const nextContext = this.#projectSession.context;
      if (!nextContext || !this.#codecs.sameSourcePath(nextContext.sourcePath, nextSourcePath)) {
        return stale(transitioned);
      }
      this.scheduleProjectListRefreshAfterSettlement(nextContext);
      this.#emit({
        type: "project-source-renamed",
        context: nextContext,
        operationId,
        previousSourcePath,
        sourcePath: nextSourcePath,
        projectName: String(result.stem || requestedStem),
        lastModifiedAt: result.lastModifiedAt ? String(result.lastModifiedAt) : null,
      });
      return succeeded({
        context: nextContext,
        sourcePath: nextSourcePath,
        projectName: String(result.stem || requestedStem),
        lastModifiedAt: result.lastModifiedAt ? String(result.lastModifiedAt) : null,
      });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        renameCommitted
          ? "文件名已经修改，但项目状态还没有完成刷新。"
          : "文件名没有修改，请检查名称后重试。",
      );
      if (renameCommitted) {
        this.#emit({
          type: "project-source-rename-unknown",
          context,
          operationId,
          reason,
        });
        return unknown(operationId, reason);
      }
      return this.#outcomeFromCause(
        operationId,
        cause,
        "SOURCE_RENAME_REJECTED",
        reason,
      );
    } finally {
      if (canvasFrozen) {
        this.#setRename("idle", null);
        const unlock = () => {
          if (!this.#disposed) this.#canvasPort.unlock?.();
        };
        if (typeof this.#canvasPort.requestFrame === "function") {
          this.#canvasPort.requestFrame(unlock);
        } else {
          unlock();
        }
      }
    }
  }

  #managedOpenTarget() {
    const openTarget = this.#projectSession.openTarget;
    const context = this.#projectSession.context;
    if (
      !openTarget
      || !context
      || openTarget.targetKind !== "working-copy"
      || !String(openTarget.workingCopyId || "")
      || !String(openTarget.versionId || "")
      || String(openTarget.projectId || "") !== String(context.projectId || "")
      || String(openTarget.documentId || "") !== String(context.documentId || "")
    ) return null;
    return openTarget;
  }

  #now() {
    return Number(this.#clock?.now?.() || Date.now());
  }

  #scheduleLocatorRetry(input) {
    if (this.#disposed) return;
    if (this.#locatorRetryHandle && typeof this.#scheduler.clearTimeout === "function") {
      this.#scheduler.clearTimeout(this.#locatorRetryHandle);
    }
    if (typeof this.#scheduler.setTimeout !== "function") return;
    this.#locatorRetryHandle = this.#scheduler.setTimeout(() => {
      this.#locatorRetryHandle = null;
      if (!this.#disposed) void this.reconcileExternalSourceLocator(input);
    }, 200);
  }

  #publishSourceLocatorChange({
    previousSourcePath,
    nextSourcePath,
    context,
    expectedSha256,
    openTarget = null,
  }) {
    const canonicalSourcePath = String(nextSourcePath || "");
    const nextOpenTarget = rebasedManagedOpenTarget(
      openTarget,
      canonicalSourcePath,
      expectedSha256,
    );
    this.#runSession.rebaseSource({
      previousSourcePath,
      sourcePath: canonicalSourcePath,
      projectId: context.projectId,
    });
    const transitioned = this.#projectSession.transitionSource({
      previousSourcePath,
      sourcePath: canonicalSourcePath,
      projectId: context.projectId,
      documentId: context.documentId,
      ...(nextOpenTarget ? { openTarget: nextOpenTarget } : {}),
    });
    this.#documentSession.publishAuthority({
      html: this.#documentSession.html,
      sourceSha256: expectedSha256,
      pendingWrite: null,
    });
    this.#documentWorkflow.clearRecovery({
      documentId: context.documentId,
      sourcePath: previousSourcePath,
    });
    this.#documentWorkflow.resetForProjectTransition();
    this.#commentWorkflow.resetForProjectTransition();
    this.#projectRulesWorkflow.resetForProjectTransition();
    return transitioned;
  }

  async #runLocatorReconcile({
    reason = "watch",
    watcherGeneration = 0,
    previousSourcePath = null,
    sourceMissing = null,
  } = {}) {
    const requestedReason = String(reason || "watch");
    const userRename = requestedReason === "rename";
    const context = this.#projectSession.context;
    if (!context) {
      return blocked("SOURCE_LOCATOR_CONTEXT_REQUIRED", "当前项目身份尚未完成初始化。");
    }
    const currentPath = context.sourcePath;
    if (
      previousSourcePath
      && !this.#codecs.sameSourcePath(previousSourcePath, currentPath)
    ) {
      return succeeded({ ignored: true, reason: "stale-path", sourcePath: currentPath });
    }
    if (
      watcherGeneration > 0
      && watcherGeneration < this.#appliedWatcherGeneration
    ) {
      return succeeded({ ignored: true, reason: "stale-generation", sourcePath: currentPath });
    }

    if (requestedReason === "watch" && sourceMissing === false) {
      let observed = succeeded({ unchanged: true });
      if (typeof this.#documentWorkflow.observeExternalSourceChange === "function") {
        observed = await this.#documentWorkflow.observeExternalSourceChange({
          sourcePath: currentPath,
        });
      }
      return succeeded({
        context: this.#projectSession.context,
        sourcePath: currentPath,
        previousSourcePath: currentPath,
        status: observed.value?.conflict ? "content-changed" : "unchanged",
        relocated: false,
        contentChanged: Boolean(observed.value?.conflict),
        projectName: sourceStem(currentPath),
        ignored: false,
        observed: observed.value || null,
      });
    }

    const defer = (code, message) => {
      if (!userRename) {
        this.#scheduleLocatorRetry({
          reason: requestedReason,
          watcherGeneration,
          previousSourcePath: currentPath,
          sourceMissing,
        });
      }
      return blocked(code, message);
    };

    if (this.projectHydrating || this.projectLoadError || this.#isHistoryView()) {
      return defer(
        "SOURCE_LOCATOR_VIEW_UNAVAILABLE",
        "当前视图尚未形成可安全核对的源页面。",
      );
    }
    if (this.#runSession.activeLocked) {
      return defer(
        "SOURCE_LOCATOR_RUN_LOCKED",
        "当前 AI 任务仍在处理，稍后会再核对文件位置。",
      );
    }

    const committed = this.#canvasPort.fencePendingEdit?.({
      resumeEditing: true,
      trigger: "source-locator-reconcile",
    });
    if (committed && !committed.ok) {
      return defer(
        "SOURCE_LOCATOR_NATIVE_EDIT_PENDING",
        String(committed.reason || "请先完成当前文字输入，再继续。"),
      );
    }
    if (
      committed
      && (
        committed.html !== this.#documentSession.html
        || committed.pendingMutation
      )
    ) {
      const enqueued = this.#documentWorkflow.enqueueEdit({
        html: committed.html,
        mutation: committed.pendingMutation || undefined,
        context,
      });
      if (enqueued.status !== "succeeded") {
        return this.#dependencyOutcome(
          enqueued,
          context,
          "SOURCE_LOCATOR_DOCUMENT_EDIT_REJECTED",
          "当前文字尚未安全进入源 HTML 写回队列。",
        );
      }
      return defer(
        "SOURCE_LOCATOR_DOCUMENT_EDIT_QUEUED",
        "刚刚还有文字输入，源页正在安全保存，稍后会再核对文件位置。",
      );
    }

    const drained = await this.#drainCoordinator.drain("switch", {
      deadlineAt: this.#now() + SWITCH_DEADLINE_MS,
    });
    if (!drained.ok) {
      return defer(
        "SOURCE_LOCATOR_DRAIN_INCOMPLETE",
        String(drained.reason || "当前项目尚未完成安全保存。"),
      );
    }
    if (this.#disposed) {
      return blocked("PROJECT_WORKFLOW_DISPOSED", "项目工作流已经停止。");
    }

    const liveContext = this.#projectSession.context;
    if (
      !liveContext
      || !this.#projectSession.matches(liveContext)
      || (
        previousSourcePath
        && !this.#codecs.sameSourcePath(previousSourcePath, liveContext.sourcePath)
        && !this.#codecs.sameSourcePath(liveContext.sourcePath, currentPath)
      )
    ) {
      return succeeded({ ignored: true, reason: "stale-session" });
    }
    if (
      this.#documentSession.persistState === "conflict"
      && typeof this.#documentWorkflow.observeExternalSourceChange === "function"
    ) {
      return this.#documentWorkflow.observeExternalSourceChange({
        sourcePath: liveContext.sourcePath,
      });
    }

    const openTarget = this.#managedOpenTarget();
    const canReconcileManaged = Boolean(
      openTarget
      && typeof this.#projectOpenPort.reconcileActiveManagedSource === "function"
      && SHA256.test(this.#documentSession.sourceSha256 || "")
    );
    const operationId = this.#nextOperationId("source-locator");
    try {
      let result = null;
      if (canReconcileManaged) {
        result = await this.#projectOpenPort.reconcileActiveManagedSource({
          operationId,
          previousSourcePath: liveContext.sourcePath,
          projectId: liveContext.projectId,
          documentId: liveContext.documentId,
          workingCopyId: String(openTarget.workingCopyId),
          versionId: String(openTarget.versionId),
          expectedSourceSha256: this.#documentSession.sourceSha256,
          reason: requestedReason,
          ...(watcherGeneration > 0 ? { watcherGeneration } : {}),
        });
        if (
          !result
          || String(result.operationId || "") !== operationId
          || !result.openTarget
          || result.openTarget.targetKind !== "working-copy"
          || String(result.openTarget.projectId || "") !== liveContext.projectId
          || String(result.openTarget.documentId || "") !== liveContext.documentId
          || String(result.openTarget.workingCopyId || "") !== String(openTarget.workingCopyId)
          || String(result.openTarget.versionId || "") !== String(openTarget.versionId)
          || !String(result.sourcePath || "")
        ) {
          throw new Error("当前工作文件身份无法核对，PageRoot 没有切换路径。");
        }
        const nextGeneration = Number(result.watcherGeneration || 0);
        if (nextGeneration > 0) {
          this.#appliedWatcherGeneration = Math.max(
            this.#appliedWatcherGeneration,
            nextGeneration,
          );
        }
        const nextSourcePath = String(
          result.openTarget?.exactSourcePath || result.sourcePath || "",
        );
        const pathChanged = !this.#codecs.sameSourcePath(
          nextSourcePath,
          liveContext.sourcePath,
        );
        if (pathChanged) {
          const expectedSha256 = this.#documentSession.sourceSha256;
          const transitioned = this.#publishSourceLocatorChange({
            previousSourcePath: liveContext.sourcePath,
            nextSourcePath,
            context: liveContext,
            expectedSha256,
            openTarget: result.openTarget,
          });
          if (!transitioned || !this.#projectSession.context) {
            throw new Error("文件位置已恢复，但当前项目身份已经变化。");
          }
          const recents = await this.refreshRecents();
          if (recents.status !== "succeeded") {
            return unknown(operationId, "文件位置已经恢复，但项目状态还没有完成刷新。");
          }
          const nextContext = this.#projectSession.context;
          if (!nextContext) {
            throw new Error("文件位置已恢复，但当前项目身份已经变化。");
          }
          this.scheduleProjectListRefreshAfterSettlement(nextContext);
          this.#emit({
            type: "project-source-relocated",
            context: nextContext,
            operationId,
            previousSourcePath: liveContext.sourcePath,
            sourcePath: nextSourcePath,
            projectName: sourceStem(nextSourcePath),
            status: String(result.status || "relocated"),
            contentChanged: result.status === "content-changed",
          });
        }
      }

      const observedPath = this.#projectSession.sourcePath || liveContext.sourcePath;
      let observed = succeeded({ unchanged: true });
      if (typeof this.#documentWorkflow.observeExternalSourceChange === "function") {
        observed = await this.#documentWorkflow.observeExternalSourceChange({
          sourcePath: observedPath,
        });
      }
      const nextContext = this.#projectSession.context;
      return succeeded({
        context: nextContext,
        sourcePath: observedPath,
        previousSourcePath: liveContext.sourcePath,
        status: result?.status || (observed.value?.conflict ? "content-changed" : "unchanged"),
        relocated: Boolean(
          result
          && !this.#codecs.sameSourcePath(observedPath, liveContext.sourcePath),
        ),
        contentChanged: Boolean(
          result?.status === "content-changed" || observed.value?.conflict,
        ),
        projectName: sourceStem(observedPath),
        ignored: false,
        observed: observed.value || null,
      });
    } catch (cause) {
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        "当前工作文件暂时无法核对位置，PageRoot 没有切换路径。",
      );
      this.#emit({
        type: "project-source-locator-failed",
        context: this.#projectSession.context || liveContext,
        operationId,
        code: projectErrorCode(cause, "SOURCE_LOCATOR_REJECTED"),
        reason,
      });
      return this.#outcomeFromCause(
        operationId,
        cause,
        "SOURCE_LOCATOR_REJECTED",
        reason,
      );
    }
  }

  async #openRegisteredProject(projectId) {
    if (typeof this.#projectOpenPort.openRegistered !== "function") {
      throw new Error("当前运行环境不能安全打开项目目录中的 HTML。");
    }
    return this.#projectOpenPort.openRegistered(projectId);
  }

  #registerDrainObligations() {
    this.#drainCoordinator.replace("external-file-open", {
      label: "等待外部 HTML 打开完成",
      inspect: (boundary) => {
        if (boundary !== "close") return { state: "resolved" };
        const status = this.#externalFileOpenSession.snapshot.status;
        if (
          this.#openConfirmation
          || status === "awaiting-confirmation"
          || (status !== "idle" && status !== "attention")
        ) {
          return {
            state: "pending",
            reason: this.#openConfirmation
              ? "外部 HTML 打开确认仍在等待选择。"
              : "外部 HTML 正在读取或等待安全切换。",
          };
        }
        return { state: "resolved" };
      },
      drain: ({ deadlineAt }) => this.#drainExternalOpenForClose(deadlineAt),
    });
    this.#drainCoordinator.replace("project-application", {
      label: "等待已接收的 HTML 切换完成",
      inspect: (boundary) => (
        boundary === "close"
        && this.#projectApplicationSession.snapshot.status !== "idle"
      ) ? {
        state: "pending",
        reason: "已接收的 HTML 仍在完成安全切换。",
      } : { state: "resolved" },
      drain: () => this.#waitUntil(
        () => this.#projectApplicationSession.snapshot.status === "idle",
      ),
    });
    this.#drainCoordinator.replace("project-picker", {
      label: "等待本地 HTML 选择完成",
      inspect: (boundary) => (
        boundary === "close" && this.#snapshot.open.phase === "opening"
      ) ? {
        state: "pending",
        reason: "本地 HTML 选择仍在等待结果。",
      } : { state: "resolved" },
      drain: () => this.#waitUntil(
        () => this.#snapshot.open.phase !== "opening",
      ),
    });
    this.#drainCoordinator.replace("project-hydration", {
      label: "等待项目读取完成",
      inspect: (boundary) => (
        boundary === "switch" && this.projectHydrating
      ) ? {
        state: "pending",
        reason: "当前项目仍在读取，不能开始新的项目切换。",
      } : { state: "resolved" },
    });
    this.#drainCoordinator.replace("view-transition", {
      label: "等待页面切换完成",
      inspect: (boundary) => {
        // A source rename owns the final Canvas fence while its desktop
        // transaction is unresolved. This must be an Application fact rather
        // than depending on the asynchronous React projection of the
        // workflow snapshot; otherwise a close or project switch could slip
        // between the desktop call and the next presentation render.
        if (this.#snapshot.rename.phase !== "idle") {
          return {
            state: "blocked",
            reason: "正在安全修改 HTML 文件名，请等待本次操作完成后再继续。",
          };
        }
        return this.#viewStatePort.isTransitioning() && boundary !== "history"
          ? {
              state: "blocked",
              reason: "正在核对历史或当前 HTML，请等待本次切换完成后再继续。",
            }
          : { state: "resolved" };
      },
    });
    this.#drainCoordinator.replace("submission", {
      label: "等待本轮提交准备结束",
      inspect: (boundary) => (
        boundary !== "submit" && this.#runSession.submissionPending
      ) ? {
        state: "pending",
        reason: "内部 AI 的冻结 Request 尚未安全建立。",
      } : { state: "resolved" },
      drain: () => this.#waitUntil(() => !this.#runSession.submissionPending),
    });
    this.#drainCoordinator.replace("attachments", {
      label: "等待附件添加完成",
      inspect: () => this.#commentWorkflow.inspectAttachment(),
      drain: () => this.#commentWorkflow.waitForAttachments(),
    });
    this.#drainCoordinator.replace("project-rules", {
      label: "等待项目规则保存",
      inspect: () => this.#projectRulesWorkflow.inspect(),
      drain: () => this.#projectRulesWorkflow.drain(),
    });
    this.#drainCoordinator.replace("source", {
      label: "等待当前 HTML 写回",
      inspect: (boundary) => this.#inspectSourceObligation(boundary),
      drain: async () => {
        if (this.#documentWorkflow.hasHistoryAction) {
          const history = await this.#documentWorkflow.waitForHistoryAction();
          if (history.status !== "succeeded") return false;
        }
        const outcome = await this.#documentWorkflow.flush({
          throughRevision: this.#documentSession.editRevision,
        });
        return outcome.status === "succeeded";
      },
    });
    this.#drainCoordinator.replace("draft", {
      label: "等待评论记录写入",
      alwaysDrain: true,
      inspect: (boundary) => this.#inspectDraftObligation(boundary),
      drain: ({ boundary }) => this.#drainDraftObligation(boundary),
    });
    this.#drainCoordinator.replace("native-edit", {
      label: "等待当前文字输入收口",
      inspect: () => this.#canvasPort.hasPendingNativeEdit?.()
        ? { state: "pending", reason: "当前文字尚未完成输入，不能离开编辑画布。" }
        : { state: "resolved" },
    });
  }

  #inspectSourceObligation(boundary) {
    if (this.#runSession.activeLocked && boundary !== "submit") {
      return { state: "resolved" };
    }
    if (!this.#projectSession.sourcePath && this.#documentSession.editRevision > 0) {
      return {
        state: "blocked",
        reason: "当前编辑尚未绑定本地 HTML，请先导出或打开本地文件。",
      };
    }
    if (this.#documentSession.persistState === "conflict") {
      return {
        state: "blocked",
        reason: "当前 HTML 与外部文件存在冲突，请先选择保留哪一份。",
      };
    }
    if (this.#documentSession.persistState === "failed") {
      return {
        state: "blocked",
        reason: this.#documentSession.persistError
          || "当前 HTML 尚未安全写回，请先处理保存失败。",
      };
    }
    if (
      this.#documentSession.pendingWrite
      || this.#documentSession.flushPromise
      || this.#documentWorkflow.hasHistoryAction
      || this.#documentSession.editRevision > this.#documentSession.lastPersistedRevision
    ) {
      return { state: "pending", reason: "当前 HTML 仍有修改尚未安全写回源文件。" };
    }
    return { state: "resolved" };
  }

  #inspectDraftObligation(boundary) {
    return this.#commentWorkflow.inspectDraft({
      boundary,
      projectLoadError: this.projectLoadError,
    });
  }

  async #drainDraftObligation(boundary) {
    return this.#commentWorkflow.drainDraft({
      boundary,
      projectLoadError: this.projectLoadError,
    });
  }

  async #openStartup() {
    const operationId = this.#nextOpenOperation();
    const startupOpenSequence = this.#openSequence;
    this.#setOpen("opening", operationId, null);
    try {
      const [activeResult, recentResult] = await Promise.allSettled([
        this.#projectOpenPort.getActive?.(),
        this.#projectOpenPort.listRecent?.(),
      ]);
      const recent = recentResult.status === "fulfilled"
        ? recentResult.value || []
        : [];
      if (recentResult.status === "fulfilled") {
        this.#emit({ type: "project-recents-loaded", projects: recent });
      } else {
        this.#emit({
          type: "project-recents-failed",
          reason: projectErrorMessage(
            this.#codecs,
            recentResult.reason,
            "最近打开记录暂时无法读取。",
          ),
        });
      }
      const active = activeResult.status === "fulfilled" ? activeResult.value : null;
      if (activeResult.status === "rejected") {
        this.#emit({
          type: "project-startup-failed",
          reason: projectErrorMessage(
            this.#codecs,
            activeResult.reason,
            "文件可能已移动、删除或损坏。源页没有打开其他内容来替代它。",
          ),
        });
      } else {
        this.#emit({ type: "project-startup-ready" });
      }
      const startupIsCurrent = this.#openSequence === startupOpenSequence;
      void this.#recentRunsPort.hydrate(
        recent,
        startupIsCurrent ? active?.sourcePath || null : null,
      );
      if (!startupIsCurrent) {
        return succeeded({ operationId, opened: false });
      }
      const result = asOpenResult(active);
      if (result.kind === "confirmation") {
        this.#presentOpenConfirmation(result.confirmation);
        return succeeded({
          operationId,
          opened: false,
          awaitingConfirmation: true,
        });
      }
      if (result.kind === "project") {
        if (this.#snapshot.close.phase === "ready") {
          return blocked(
            "PROJECT_OPEN_CLOSE_COMMITTED",
            "当前窗口正在关闭，没有接收新的 HTML。",
          );
        }
        if (!this.#enqueueAcceptedProject(result.project, {
          kind: "startup",
          operationId,
          sourcePath: result.project.sourcePath || null,
        })) {
          return rejected(
            "PROJECT_APPLICATION_REJECTED",
            "无法安排当前 HTML 的安全切换。",
          );
        }
        return succeeded({ operationId, opened: true });
      }
      return succeeded({ operationId, opened: false });
    } catch (cause) {
      return rejected(
        "PROJECT_STARTUP_REJECTED",
        projectErrorMessage(this.#codecs, cause, "上次打开的 HTML 无法恢复。"),
      );
    } finally {
      if (this.#snapshot.open.operationId === operationId) {
        this.#setOpen("idle", null, null);
      }
    }
  }

  #enqueueAcceptedProject(projectValue, metadata) {
    if (this.#snapshot.close.phase === "ready") return false;
    const project = copyProject(projectValue);
    if (!project) return false;
    this.#applicationSequence += 1;
    const applicationId = `project-application-${this.#applicationSequence}`;
    return this.#projectApplicationSession.enqueue({
      applicationId,
      value: Object.freeze({ project, metadata: Object.freeze({ ...metadata }) }),
    }, (application) => this.#applyAcceptedProject(application))
      ? applicationId
      : false;
  }

  async #applyAcceptedProject(application) {
    if (this.#snapshot.close.phase === "ready") return "complete";
    const { metadata } = application.value;
    let { project } = application.value;
    if (this.projectHydrating && !this.#retireHydrationForAcceptedSuccessor()) {
      return "deferred";
    }
    // epoch 0 has no previously opened renderer authority to drain or fence.
    // Startup still enters the accepted-result FIFO, but its first publication
    // must not depend on an edit Canvas that only mounts for an opened locator.
    if (this.#projectSession.epoch > 0) {
      const switchOutcome = await this.prepareSwitch();
      if (switchOutcome.status !== "succeeded") {
        return "deferred";
      }
    }
    if (this.#snapshot.close.phase === "ready") return "complete";
    // In-memory browser HTML has no disk Hash. Confirming the next switch
    // fence requires DocumentSession.sourceSha256, so fill it before publish.
    if (!project.sha256) {
      project = Object.freeze({
        ...project,
        sha256: await this.#hashPort.sha256(project.html),
      });
    }
    let canvasFrozen = false;
    let applied = false;
    const canvasIsMounted = typeof this.#canvasPort.isMounted !== "function"
      || this.#canvasPort.isMounted();
    if (
      this.#projectSession.sourcePath
      && !this.projectLoadError
      && !this.#isHistoryView()
      && canvasIsMounted
    ) {
      const cutoff = this.#documentSession.editRevision;
      const frozen = this.#canvasPort.freeze(
        "当前编辑画布尚未完成安全收口，暂不能切换 HTML。",
      );
      if (!frozen?.ok) {
        this.#canvasPort.showCommitBlocked?.(
          frozen?.reason || "当前编辑画布尚未完成安全收口。",
        );
        return "deferred";
      }
      canvasFrozen = true;
      if (
        this.#documentSession.editRevision !== cutoff
        || this.#documentSession.pendingWrite
        || this.#documentSession.flushPromise
      ) {
        this.#canvasPort.unlock?.();
        return "deferred";
      }
    }
    try {
      this.#applyProject(project);
      applied = true;
      const epoch = this.#projectSession.epoch;
      // Accepted-result FIFO owns synchronous publication order, not remote
      // hydration latency. A successor may retire this query only after the
      // workflow proves that the just-published project has no mutable work.
      void (async () => {
        const [, hydrated] = await Promise.all([
          this.refreshRecents(),
          this.refreshWorkspace({
            sourcePath: project.sourcePath,
            epoch,
            sourceTransitionToken: epoch,
          }),
        ]);
        if (hydrated.status === "succeeded") {
          // Defer the read-only catalog projection until hydration and any lazy
          // registration/Working-Copy adoption have settled. Running catalog in
          // parallel with hydration lets its Repository scan reorder the shared
          // queue and can leave a just-imported project stuck in "hydrating".
          this.scheduleProjectListRefreshAfterSettlement(this.#projectSession.context);
        }
      })().catch((cause) => {
        this.#emit({
          type: "project-hydration-failed",
          reason: projectErrorMessage(
            this.#codecs,
            cause,
            "项目状态暂时无法读取，请重试。",
          ),
        });
      });
    } catch (cause) {
      this.#emit({
        type: "project-open-failed",
        kind: metadata.kind,
        operationId: metadata.operationId,
        sourcePath: metadata.sourcePath,
        reason: projectErrorMessage(
          this.#codecs,
          cause,
          "文件暂时无法完成安全切换；当前项目仍保持打开。",
        ),
      });
    } finally {
      if (canvasFrozen && !applied) this.#canvasPort.unlock?.();
    }
    return "complete";
  }

  #retireHydrationForAcceptedSuccessor() {
    const unsafe = this.#drainCoordinator
      .inspect("switch")
      .some((status) => (
        status.name !== "project-hydration"
        && status.state !== "resolved"
      ));
    if (unsafe) return false;
    this.#hydrationGeneration += 1;
    this.#setHydration({
      phase: "idle",
      epoch: this.#projectSession.epoch,
      sourcePath: this.#projectSession.sourcePath,
      error: null,
    });
    this.#markHydrationStage("superseded");
    return true;
  }

  async #openExternalProject(request, { isSuperseded }) {
    if (isSuperseded()) return "complete";
    if (this.#externalAckPending.has(request.requestId)) {
      return await this.#retryPendingExternalAck(request.requestId)
        ? "complete"
        : "deferred";
    }
    const operationId = this.#nextOpenOperation();
    try {
      if (typeof this.#projectOpenPort.acceptExternal !== "function") {
        const reason = "当前 PageRoot 版本缺少外部文件打开通道，请重新安装最新版本。";
        this.#emit({
          type: "external-project-open-unavailable",
          requestId: request.requestId,
          reason,
        });
        return await this.#ackWithCompletion(request.requestId, { kind: "session" })
          ? "complete"
          : "deferred";
      }
      const opened = await this.#projectOpenPort.acceptExternal(request.requestId);
      if (isSuperseded() || this.#snapshot.close.phase === "ready") return "complete";
      const result = asOpenResult(opened);
      if (result.kind === "confirmation") {
        this.#externalFileOpenSession.presentConfirmation(
          request.requestId,
          result.confirmation,
        );
        this.#presentOpenConfirmation(result.confirmation);
        return "awaiting-confirmation";
      }
      if (result.kind !== "project") {
        throw new Error("这次外部打开没有返回可安全切换的 HTML。");
      }
      const switchOutcome = await this.prepareSwitch();
      if (switchOutcome.status !== "succeeded") return "deferred";
      if (isSuperseded()) return "complete";
      if (!this.#enqueueAcceptedProject(result.project, {
        kind: "external",
        operationId,
        sourcePath: result.project.sourcePath || null,
      })) {
        throw new Error("无法安排外部 HTML 的安全切换。");
      }
      if (!await this.#ackWithCompletion(request.requestId, { kind: "session" })) {
        return "deferred";
      }
    } catch (cause) {
      if (!isSuperseded()) {
        this.#emit({
          type: "project-open-failed",
          kind: "external",
          operationId,
          sourcePath: request.sourcePath || null,
          reason: projectErrorMessage(
            this.#codecs,
            cause,
            "文件可能已移动、暂时不可读，或不是完整的 HTML 页面；当前项目仍保持打开。",
          ),
        });
        if (!await this.#ackWithCompletion(request.requestId, { kind: "session" })) {
          return "deferred";
        }
      }
    }
    return "complete";
  }

  #presentOpenConfirmation(descriptor) {
    const confirmation = copyOpenConfirmation({
      ...descriptor,
      deleteOriginal: false,
      busy: false,
    });
    if (!confirmation) return false;
    if (
      this.#openConfirmation
      && this.#openConfirmation.requestId !== confirmation.requestId
    ) {
      this.#cancelPreparedIntent(this.#openConfirmation.requestId);
    }
    this.#openConfirmation = confirmation;
    this.#publishSnapshot();
    return true;
  }

  #setOpenConfirmation(next) {
    const confirmation = copyOpenConfirmation(next);
    this.#openConfirmation = confirmation;
    this.#publishSnapshot();
    return confirmation;
  }

  #clearOpenConfirmation() {
    this.#openConfirmation = null;
    this.#publishSnapshot();
  }

  #cancelPreparedIntent(requestId) {
    if (
      !requestId
      || typeof this.#projectOpenPort.cancelPrepared !== "function"
    ) return;
    void this.#projectOpenPort.cancelPrepared(requestId);
  }

  async #ackExternalOpen(requestId) {
    if (typeof this.#projectOpenPort.ackExternal !== "function") return true;
    try {
      await this.#projectOpenPort.ackExternal(requestId);
      return true;
    } catch (cause) {
      this.#emit({
        type: "external-open-ack-failed",
        requestId,
        confirmation: this.#confirmationRequiresExternalAck(requestId),
        reason: projectErrorMessage(
          this.#codecs,
          cause,
          "外部 HTML 已处理，但下一个打开请求尚未解锁。",
        ),
      });
      return false;
    }
  }

  #confirmationRequiresExternalAck(requestId) {
    const snapshot = this.#externalFileOpenSession.snapshot;
    return snapshot.status === "awaiting-confirmation"
      && snapshot.activeRequestId === String(requestId || "");
  }

  #applyExternalAckCompletion(requestId, completion) {
    if (completion.kind === "cancel-confirmation") {
      if (completion.external === true) {
        this.#externalFileOpenSession.cancelConfirmation(requestId);
      }
      if (this.#openConfirmation?.requestId === requestId) {
        this.#clearOpenConfirmation();
      }
      return succeeded({ canceled: true, requestId });
    }
    if (completion.kind === "complete-confirmation") {
      if (completion.external === true) {
        this.#externalFileOpenSession.completeConfirmation(requestId);
      }
      if (this.#openConfirmation?.requestId === requestId) {
        this.#clearOpenConfirmation();
      }
      this.#emit(completion.event);
      return succeeded(completion.value);
    }
    return succeeded({ requestId, acknowledged: true });
  }

  async #ackWithCompletion(requestId, completion) {
    if (!await this.#ackExternalOpen(requestId)) {
      this.#externalAckPending.set(requestId, Object.freeze({ ...completion }));
      return null;
    }
    this.#externalAckPending.delete(requestId);
    return this.#applyExternalAckCompletion(requestId, completion);
  }

  async #retryPendingExternalAck(requestId) {
    const completion = this.#externalAckPending.get(requestId);
    if (!completion) return null;
    return this.#ackWithCompletion(requestId, completion);
  }

  setExternalOpenDeleteOriginal({ requestId, deleteOriginal } = {}) {
    const confirmation = this.#openConfirmation;
    if (!confirmation || confirmation.requestId !== String(requestId || "")) {
      return stale({ requestId: String(requestId || "") });
    }
    if (confirmation.classification !== "new-external") {
      return rejected(
        "EXTERNAL_OPEN_DELETE_NOT_ALLOWED",
        "只有首次导入才能在成功后删除原文件。",
      );
    }
    this.#setOpenConfirmation({
      ...confirmation,
      deleteOriginal: deleteOriginal === true,
      busy: confirmation.busy,
    });
    return succeeded({ deleteOriginal: deleteOriginal === true });
  }

  async cancelExternalOpen({ requestId } = {}) {
    const requestedId = String(requestId || "");
    if (this.#externalAckPending.has(requestedId)) {
      return await this.#retryPendingExternalAck(requestedId) || rejected(
        "EXTERNAL_OPEN_ACK_REJECTED",
        "这次打开已取消，但下一个 Finder 请求尚未解锁。",
      );
    }
    const confirmation = this.#openConfirmation;
    if (!confirmation || confirmation.requestId !== String(requestId || "")) {
      return stale({ requestId: String(requestId || "") });
    }
    this.#cancelPreparedIntent(confirmation.requestId);
    const completion = {
      kind: "cancel-confirmation",
      external: this.#confirmationRequiresExternalAck(confirmation.requestId),
    };
    const completed = completion.external
      ? await this.#ackWithCompletion(confirmation.requestId, completion)
      : this.#applyExternalAckCompletion(confirmation.requestId, completion);
    if (!completed) {
      this.#setOpenConfirmation({ ...confirmation, busy: false });
      return rejected(
        "EXTERNAL_OPEN_ACK_REJECTED",
        "这次打开已取消，但下一个 Finder 请求尚未解锁。",
      );
    }
    return completed;
  }

  async confirmExternalOpen({
    requestId,
    action,
    deleteOriginal = false,
  } = {}) {
    if (action === "view-initial") {
      return rejected(
        "EXTERNAL_OPEN_ACTION_UNSUPPORTED",
        "这条打开确认不提供查看初始版本。",
      );
    }
    const confirmation = this.#openConfirmation;
    if (!confirmation || confirmation.requestId !== String(requestId || "")) {
      return stale({ requestId: String(requestId || "") });
    }
    if (this.#externalAckPending.has(confirmation.requestId)) {
      return await this.#retryPendingExternalAck(confirmation.requestId) || rejected(
        "EXTERNAL_OPEN_ACK_REJECTED",
        "HTML 已完成打开，但下一个 Finder 请求尚未解锁。",
      );
    }
    if (
      confirmation.classification === "new-external"
      && action !== "import-new"
    ) {
      return rejected(
        "EXTERNAL_OPEN_ACTION_MISMATCH",
        "新的外部 HTML 只能选择导入并打开。",
      );
    }
    if (
      confirmation.classification === "known-external"
      && action !== "continue-current"
    ) {
      return rejected(
        "EXTERNAL_OPEN_ACTION_MISMATCH",
        "已导入的原文件只能打开之前的项目。",
      );
    }
    const shouldDelete = confirmation.classification === "new-external"
      && (deleteOriginal === true || confirmation.deleteOriginal === true);
    this.#setOpenConfirmation({
      ...confirmation,
      deleteOriginal: shouldDelete,
      busy: true,
    });
    // epoch 0 has no previously opened renderer authority to drain or fence.
    // Cold-start last-active B/C confirmation must not depend on an edit Canvas
    // that only mounts after a project locator is published.
    const hasBoundProject = this.#projectSession.epoch > 0;
    const previousAuthority = hasBoundProject
      ? this.captureManagedSourceTransitionAuthority()
      : null;
    if (hasBoundProject) {
      const switchOutcome = await this.prepareSwitch();
      if (switchOutcome.status !== "succeeded") {
        this.#setOpenConfirmation({
          ...this.#openConfirmation,
          busy: false,
        });
        return switchOutcome;
      }
    }
    if (typeof this.#projectOpenPort.commitPrepared !== "function") {
      this.#setOpenConfirmation({
        ...this.#openConfirmation,
        busy: false,
      });
      return rejected(
        "EXTERNAL_OPEN_COMMIT_UNAVAILABLE",
        "当前 PageRoot 版本缺少导入确认通道，请重新安装最新版本。",
      );
    }
    try {
      const committed = await this.#projectOpenPort.commitPrepared({
        requestId: confirmation.requestId,
        action,
        ...(shouldDelete ? { deleteOriginal: true } : {}),
      });
      const project = copyProject(committed);
      if (!project) {
        throw Object.assign(new Error("导入确认没有返回可打开的项目文件。"), {
          code: "EXTERNAL_OPEN_COMMIT_INVALID",
        });
      }
      this.#applyProject(project);
      const epoch = this.#projectSession.epoch;
      try {
        const [, hydrated] = await Promise.all([
          this.refreshRecents(),
          this.refreshWorkspace({
            sourcePath: project.sourcePath,
            epoch,
            sourceTransitionToken: epoch,
          }),
        ]);
        if (hydrated.status === "succeeded") {
          await this.refreshRegisteredProjects();
        }
      } catch (cause) {
        this.#emit({
          type: "project-hydration-failed",
          reason: projectErrorMessage(
            this.#codecs,
            cause,
            "项目状态暂时无法读取，请重试。",
          ),
        });
      }
      const canvasOutcome = await this.#documentWorkflow.ensureCurrentCanvas({
        context: this.#projectSession.context || undefined,
      });
      if (canvasOutcome.status !== "succeeded") {
        if (typeof this.#projectOpenPort.rollbackPrepared === "function") {
          await this.#projectOpenPort.rollbackPrepared(confirmation.requestId);
        }
        if (previousAuthority) {
          this.restoreManagedSourceTransitionAuthority(previousAuthority);
        }
        this.#setOpenConfirmation({
          ...confirmation,
          deleteOriginal: shouldDelete,
          busy: false,
        });
        this.#emit({
          type: "external-open-canvas-failed",
          requestId: confirmation.requestId,
          reason: canvasOutcome.reason || "当前画布尚未完成自动恢复。",
        });
        return canvasOutcome;
      }
      let disposition = "kept";
      if (typeof this.#projectOpenPort.finalizePrepared === "function") {
        const finalized = await this.#projectOpenPort.finalizePrepared(
          confirmation.requestId,
        );
        disposition = finalized?.disposition || "kept";
      }
      const completion = {
        kind: "complete-confirmation",
        external: this.#confirmationRequiresExternalAck(confirmation.requestId),
        event: Object.freeze({
          type: "external-open-completed",
          requestId: confirmation.requestId,
          action,
          imported: action === "import-new",
          disposition,
          visibleV1FileName: confirmation.visibleV1FileName,
          sourcePath: project.sourcePath,
        }),
        value: Object.freeze({
          requestId: confirmation.requestId,
          opened: true,
          disposition,
        }),
      };
      const completed = completion.external
        ? await this.#ackWithCompletion(confirmation.requestId, completion)
        : this.#applyExternalAckCompletion(confirmation.requestId, completion);
      if (!completed) {
        this.#setOpenConfirmation({
          ...confirmation,
          deleteOriginal: shouldDelete,
          busy: false,
        });
        return rejected(
          "EXTERNAL_OPEN_ACK_REJECTED",
          "HTML 已完成打开，但下一个 Finder 请求尚未解锁。",
        );
      }
      return completed;
    } catch (cause) {
      const reclassified = cause?.details?.confirmation
        || cause?.confirmation;
      if (cause?.code === "OPEN_INTENT_RECLASSIFIED" && reclassified) {
        const next = copyOpenConfirmation({
          ...reclassified,
          deleteOriginal: false,
          busy: false,
        });
        if (next) {
          this.#externalFileOpenSession.presentConfirmation(next.requestId, next);
          this.#presentOpenConfirmation(next);
          this.#emit({
            type: "external-open-reclassified",
            requestId: next.requestId,
            reason: projectErrorMessage(
              this.#codecs,
              cause,
              "这份原文件已经关联到现有项目。",
            ),
          });
          return rejected(cause.code, cause.message);
        }
      }
      this.#setOpenConfirmation({
        ...(this.#openConfirmation || confirmation),
        busy: false,
      });
      const reason = projectErrorMessage(
        this.#codecs,
        cause,
        "这次打开没有完成，当前项目仍保持打开。",
      );
      this.#emit({
        type: "project-open-failed",
        kind: "external-confirmation",
        operationId: confirmation.requestId,
        sourcePath: null,
        reason,
      });
      return rejected(
        projectErrorCode(cause, "EXTERNAL_OPEN_COMMIT_REJECTED"),
        reason,
      );
    }
  }

  retryExternalOpen({ requestId } = {}) {
    const pending = this.#externalAckPending.get(String(requestId || ""));
    if (pending) return this.#retryPendingExternalAck(String(requestId || ""));
    const confirmation = this.#openConfirmation;
    if (!confirmation || confirmation.requestId !== String(requestId || "")) {
      return Promise.resolve(stale({ requestId: String(requestId || "") }));
    }
    return this.confirmExternalOpen({
      requestId: confirmation.requestId,
      action: confirmation.classification === "new-external"
        ? "import-new"
        : "continue-current",
      deleteOriginal: confirmation.deleteOriginal,
    });
  }

  #applyProject(project) {
    this.#markHydrationStage("apply-start");
    const outgoingRun = this.#runSession.activeRun;
    const outgoingSourcePath = this.#projectSession.sourcePath;
    if (
      outgoingRun
      && outgoingSourcePath
      && !this.#codecs.sameSourcePath(outgoingSourcePath, project.sourcePath)
    ) {
      if (outgoingRun.status === "ready-to-open") {
        this.#runSession.markResult(outgoingSourcePath, {
          state: "ready",
          label: "新版本可查看",
          updatedAt: this.#clock.now(),
        });
      } else if (outgoingRun.status === "awaiting-conflict-resolution") {
        this.#runSession.markResult(outgoingSourcePath, {
          state: "conflict",
          label: "需要处理",
          updatedAt: this.#clock.now(),
        });
      } else if (this.#codecs.isLockedLifecycleState(outgoingRun.status)) {
        this.#runSession.markResult(outgoingSourcePath, {
          state: "processing",
          label: "正在处理",
          updatedAt: this.#clock.now(),
        });
      }
    }
    const locator = this.#projectSession.openLocator(project.sourcePath || null);
    this.#runSession.activate(project.sourcePath || null);
    this.#documentWorkflow.resetForProjectTransition();
    this.#documentSession.reset({
      html: project.html,
      sourceSha256: project.sha256 || null,
    });
    this.#setHydration({
      phase: project.sourcePath ? "hydrating" : "idle",
      epoch: locator.epoch,
      sourcePath: project.sourcePath || null,
      error: null,
    });
    this.#markHydrationStage("apply-authority");
    this.#commentWorkflow.resetForProjectTransition();
    this.#draftSession.deactivate();
    this.#projectRulesWorkflow.resetForProjectTransition();
    this.#commentSession.reset();
    this.#versionSession.reset();
    this.#markHydrationStage("apply-authority:sessions-reset");
    this.#canvasPort.invalidateRenderAcks?.();
    if (project.sourcePath) this.#runSession.clearResult(project.sourcePath);
    this.#pendingOpen = null;
    this.#markHydrationStage("apply-authority:canvas-reset");
    this.#emit({
      type: "project-applied",
      project,
      epoch: locator.epoch,
      activeLocked: this.#runSession.activeLocked,
    });
    this.#markHydrationStage("apply-authority:published");
    this.#canvasPort.applyPageViewContext?.(null);
    this.#canvasPort.clearSelection?.();
    if (!this.#runSession.activeLocked) this.#canvasPort.unlock?.();
    this.#markHydrationStage("apply-authority:unlocked");
    this.#markHydrationStage("apply-complete");
  }

  async #hydrateWorkspace({ sourcePath, epoch, sourceTransitionToken }) {
    let activeSource = sourcePath === undefined
      ? this.#projectSession.sourcePath
      : sourcePath;
    if (!activeSource) return succeeded({ hydrated: false });
    let activeEpoch = epoch ?? this.#projectSession.epoch;
    const hydrationGeneration = this.#hydrationGeneration;
    const query = this.#projectSession.beginQuery("workspace", {
      sourcePath: activeSource,
    });
    const queryIsCurrent = () => (
      this.#projectSession.isQueryCurrent(query)
      && hydrationGeneration === this.#hydrationGeneration
      && activeEpoch === this.#projectSession.epoch
      && this.#codecs.sameSourcePath(this.#projectSession.sourcePath, activeSource)
    );
    const transitionAuthorized = Boolean(
      sourceTransitionToken !== undefined
      && sourceTransitionToken === activeEpoch
      && sourceTransitionToken === this.#projectSession.epoch
      && this.projectHydrating,
    );
    let sourceBoundaryFrozen = false;
    let mustAdoptSource = transitionAuthorized;
    let recoveredAutosaveConflict = false;
    const rollback = this.#captureHydrationAuthority();
    let publicationStarted = false;
    const operationId = this.#nextOperationId("hydration");
    try {
      this.#markHydrationStage("workspace-request");
      if (this.projectHydrating && !transitionAuthorized) {
        throw new Error("这次项目读取缺少与当前项目一致的源码切换令牌。");
      }
      const payload = await this.#bridgeClient.workspace(activeSource);
      this.#markHydrationStage("workspace-response");
      if (!queryIsCurrent()) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });

      const nextProjectId = String(payload.projectId || "");
      const nextDocumentId = String(payload.documentId || "");
      const canonicalSourcePath = String(
        payload.sourcePath
        || (this.#codecs.isRecord(payload.current) ? payload.current.path : "")
        || activeSource,
      );
      const workspaceHash = String(payload.currentHtmlSha256 || "");
      if (workspaceHash && !SHA256.test(workspaceHash)) {
        throw new Error("项目状态返回的源 HTML Hash 无效。");
      }
      const openTarget = this.#codecs.isRecord(payload.openTarget)
        ? payload.openTarget
        : null;
      let preparedTransition = null;
      if (!this.#codecs.sameSourcePath(canonicalSourcePath, activeSource)) {
        if (!mustAdoptSource) {
          const frozen = this.#canvasPort.freeze(
            "项目状态包含新的源文件，但当前编辑画布尚未就绪。",
          );
          if (!frozen?.ok) {
            throw new Error(frozen?.reason || "无法在安全收口当前编辑后切换源文件。");
          }
          sourceBoundaryFrozen = true;
        }
        const versionId = String(
          payload.currentExactVersionId || payload.latestVersionId || "",
        );
        if (!nextProjectId || !nextDocumentId || !workspaceHash || !versionId) {
          throw new Error("项目已经生成新文件，但缺少切换当前文件所需的完整身份。");
        }
        preparedTransition = await this.prepareGeneratedSourceTransition({
          previousSourcePath: activeSource,
          nextSourcePath: canonicalSourcePath,
          expectedSha256: workspaceHash,
          nextProjectId,
          nextDocumentId,
          versionId,
          openTarget,
        });
        if (!preparedTransition.updatesCurrentProject) return stale({
          operationId,
          epoch: activeEpoch,
          sourcePath: activeSource,
        });
        if (!queryIsCurrent()) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
        mustAdoptSource = true;
      }

      const projectRecord = this.#codecs.isRecord(payload.project) ? payload.project : {};
      const workspacePaths = this.#codecs.isRecord(payload.paths) ? payload.paths : {};
      const currentDocument = this.#documentSession.snapshot;
      const currentHtmlHash = await this.#hashPort.sha256(currentDocument.html);
      if (!queryIsCurrent()) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
      const currentDocumentClean = Boolean(
        currentDocument.persistState === "idle"
        && currentDocument.editRevision === currentDocument.lastPersistedRevision
        && !this.#documentSession.pendingWrite
        && !this.#documentSession.flushPromise
      );
      const cleanProjectionMismatch = Boolean(
        currentDocumentClean && workspaceHash && currentHtmlHash !== workspaceHash
      );
      let authoritativeHtml = currentDocument.html;
      let authoritativeHash = currentDocument.sourceSha256 || workspaceHash;
      let authoritativeLastModifiedAt = String(payload.lastModifiedAt || "");
      let sourcePayload = null;
      if (preparedTransition?.activatedProject) {
        authoritativeHtml = preparedTransition.activatedProject.html;
        authoritativeHash = preparedTransition.activatedProject.sha256;
        authoritativeLastModifiedAt = String(
          preparedTransition.activatedProject.lastModifiedAt
          || payload.lastModifiedAt
          || "",
        );
      } else if (mustAdoptSource || cleanProjectionMismatch) {
        mustAdoptSource = true;
        this.#markHydrationStage("source-request");
        sourcePayload = await this.#bridgeClient.source(canonicalSourcePath);
        this.#markHydrationStage("source-response");
        if (!queryIsCurrent()) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
        if (
          String(sourcePayload.projectId || "") !== nextProjectId
          || String(sourcePayload.documentId || "") !== nextDocumentId
        ) {
          throw new Error("读取期间源文件身份发生变化，已保持只读；请重新打开该文件。");
        }
        authoritativeHtml = String(sourcePayload.content || "");
        authoritativeHash = String(sourcePayload.sha256 || "");
        if (
          !authoritativeHash
          || await this.#hashPort.sha256(authoritativeHtml) !== authoritativeHash
          || (workspaceHash && authoritativeHash !== workspaceHash)
        ) {
          throw new Error("源 HTML 内容与服务端 Hash 不一致，已拒绝开放编辑。");
        }
        authoritativeLastModifiedAt = String(
          sourcePayload.lastModifiedAt || payload.lastModifiedAt || "",
        );
      } else if (currentDocumentClean && workspaceHash) {
        authoritativeHash = workspaceHash;
      } else if (
        workspaceHash
        && currentDocument.sourceSha256
        && workspaceHash !== currentDocument.sourceSha256
      ) {
        throw new Error("本地编辑期间源文件身份发生变化，已停止刷新以保留当前内容。");
      }
      if (!authoritativeHash) throw new Error("项目状态缺少当前源 HTML Hash。");
      if (!queryIsCurrent()) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });

      const publishVersion = () => this.#versionSession.hydrate({
        versions: this.#codecs.versionsFromWorkspace(payload),
        latestVersionId: payload.latestVersionId,
        currentBasedOnVersionId:
          sourcePayload?.currentBasedOnVersionId || payload.currentBasedOnVersionId,
        currentExactVersionId:
          sourcePayload?.currentExactVersionId || payload.currentExactVersionId,
        restoredFromVersionId:
          sourcePayload?.restoredFromVersionId
          || payload.restoredFromVersionId
          || projectRecord.restoredFromVersionId,
      });
      let context = null;
      this.#markHydrationStage("publication-start");
      publicationStarted = true;
      if (preparedTransition) {
        context = this.commitGeneratedSourceTransition({
          prepared: preparedTransition,
          html: authoritativeHtml,
          sourceSha256: authoritativeHash,
          publishVersion,
        });
      } else {
        const hydrationOpenTarget = rebasedManagedOpenTarget(
          this.#codecs.isRecord(payload.openTarget)
            ? payload.openTarget
            : this.#projectSession.openTarget,
          activeSource,
          authoritativeHash,
        );
        context = this.#projectSession.register({
          epoch: activeEpoch,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          sourcePath: activeSource,
          ...(hydrationOpenTarget ? { openTarget: hydrationOpenTarget } : {}),
        });
        if (!context) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
        if (mustAdoptSource || authoritativeHtml !== currentDocument.html) {
          this.#documentSession.publishAuthority({
            html: authoritativeHtml,
            sourceSha256: authoritativeHash,
          });
          this.#canvasPort.invalidateRenderAcks?.();
        } else {
          this.#documentSession.update({
            html: authoritativeHtml,
            sourceSha256: authoritativeHash,
          });
        }
        publishVersion();
      }
      this.#markHydrationStage("publication-committed");
      if (!context) return stale({ operationId, epoch: activeEpoch, sourcePath: activeSource });
      activeSource = context.sourcePath;
      activeEpoch = context.epoch;
      this.#documentWorkflow.replaceRecoveryIdentity(
        this.#codecs.recoveryIdentityFromRecord(payload.recoveryIdentity),
      );
      const runtime = this.#codecs.isRecord(payload.runtimeState)
        ? payload.runtimeState
        : {};
      const runtimeConflict = this.#codecs.isRecord(runtime.conflict)
        ? runtime.conflict
        : null;
      const edit = this.#codecs.isRecord(runtime.edit) ? runtime.edit : {};
      const serverRevision = Number(runtime.editRevision || edit.editRevision || 0);
      const serverPersistedRevision = Number(
        runtime.lastPersistedRevision
        || edit.lastPersistedRevision
        || serverRevision,
      );
      this.#documentSession.update({
        editRevision: Math.max(this.#documentSession.editRevision, serverRevision),
        lastPersistedRevision: Math.max(
          this.#documentSession.lastPersistedRevision,
          serverPersistedRevision,
        ),
      });

      const draftRecord = this.#codecs.draftAuthorityFromWorkspace(payload);
      const serverDraftRevision = this.#codecs.authoritativeDraftRevision(draftRecord);
      let recoveredEvents = this.#commentSession.changeEvents;
      if (
        nextProjectId
        && nextDocumentId
        && authoritativeHash
        && this.#codecs.isRecord(payload.sourceHistory)
      ) {
        this.#documentWorkflow.activateSourceHistory({
          context,
          sourceSha256: authoritativeHash,
          history: payload.sourceHistory,
          preservePending: Boolean(this.#documentSession.pendingWrite),
        });
      }
      if (!this.#draftSession.isActive(context) || serverDraftRevision >= this.#draftSession.revision) {
        this.#draftSession.activate(context, serverDraftRevision, draftRecord);
        const recovered = this.#commentWorkflow.recoverDraft({
          context,
          serverComments: this.#codecs.commentsFromRecords(draftRecord.comments),
          serverEvents: this.#codecs.changesFromDraftRecords(draftRecord.changeEvents),
          serverDraftRevision: this.#draftSession.revision,
          serverDeletedCommentIds: Array.isArray(draftRecord.deletedCommentIds)
            ? draftRecord.deletedCommentIds.map(String)
            : [],
          serverAppliedOperationIds: Array.isArray(draftRecord.appliedOperationIds)
            ? draftRecord.appliedOperationIds.map(String)
            : [],
          serverBasedOnVersionId: payload.currentBasedOnVersionId
            ? String(payload.currentBasedOnVersionId)
            : null,
        });
        const rebound = this.#codecs.rebindTargetsPreservingGlobal(
          this.#documentSession.html,
          [
            ...recovered.comments.map((comment) => comment.target),
            ...(recovered.composerTarget ? [recovered.composerTarget] : []),
          ],
        );
        const targets = new Map(rebound.map((target) => [target.id, target]));
        const recoveredComments = recovered.comments.map((comment) => ({
          ...comment,
          target: targets.get(comment.target.id) || {
            ...comment.target,
            resolution: "orphaned",
          },
        }));
        recoveredEvents = recovered.changeEvents;
        const recoveredEditComment = recovered.commentEdit
          ? recoveredComments.find(
              (comment) => comment.commentId === recovered.commentEdit?.commentId,
            ) || null
          : null;
        const recoveredEditSession = recovered.commentEdit && recoveredEditComment
          ? {
              commentId: recoveredEditComment.commentId,
              baselineText: recoveredEditComment.text,
              baselineAttachments: [...(recoveredEditComment.attachments || [])],
              draftText: recovered.commentEdit.draftText,
              draftAttachments: [...recovered.commentEdit.draftAttachments],
            }
          : null;
        const nextEditSession = this.#codecs.commentEditSessionHasChanges(recoveredEditSession)
          ? recoveredEditSession
          : null;
        const composerTarget = recovered.composerTarget
          ? targets.get(recovered.composerTarget.id) || {
              ...recovered.composerTarget,
              resolution: "orphaned",
            }
          : null;
        this.#commentSession.update({
          comments: recoveredComments,
          changeEvents: recoveredEvents,
          composerDraft: recovered.composerDraft,
          composerCommentId: recovered.composerCommentId,
          composerAttachments: recovered.composerAttachments,
          composerTarget,
          editSession: nextEditSession,
        });
        this.#emit({ type: "project-draft-recovered" });
      }

      const recoveredRunRecord = this.#codecs.isRecord(runtime.activeRun)
        ? runtime.activeRun
        : this.#codecs.isRecord(payload.activeRun)
          ? payload.activeRun
          : null;
      const recoveredRun = this.#codecs.activeRunFromRecord(
        recoveredRunRecord
          ? { ...recoveredRunRecord, ...(runtimeConflict ? { conflict: runtimeConflict } : {}) }
          : null,
      );
      const recoveredOutcome = this.#codecs.activeRunFromRecord(payload.recentRunOutcome);
      if (recoveredOutcome) this.#runSession.rememberOutcome(recoveredOutcome);
      else if (!recoveredRun) this.#runSession.forgetOutcome(activeSource);
      let showHandoff = false;
      if (recoveredRun && this.#codecs.isLockedLifecycleState(recoveredRun.status)) {
        this.#runSession.trackRun(recoveredRun, { recovered: true });
        showHandoff = this.projectHydrating;
      } else {
        const tracked = this.#runSession.runForSource(activeSource);
        if (tracked) this.#runSession.removeRun(tracked);
        else {
          const visible = this.#runSession.activeRun;
          const keepTerminal = Boolean(
            recoveredOutcome
            && visible
            && ["error", "no-change"].includes(visible.status)
            && visible.requestId === recoveredOutcome.requestId
            && visible.attemptId === recoveredOutcome.attemptId,
          );
          if (!keepTerminal) this.#runSession.clearActiveRun();
        }
        if (!sourceBoundaryFrozen && !this.projectHydrating) this.#canvasPort.unlock?.();
      }
      if (transitionAuthorized && authoritativeHash) {
        const recoveredLocally = await this.#documentWorkflow.recoverAutosave({
          context,
          currentSourceSha256: authoritativeHash,
          serverRevision,
        });
        if (!this.#projectSession.matches(context)) return stale(context);
        if (
          recoveredLocally.status === "succeeded"
          && !recoveredLocally.value.recovered
          && runtimeConflict
          && String(runtimeConflict.type || "") === "autosave-source"
          && typeof this.#bridgeClient.conflictCandidate === "function"
        ) {
          const conflictPayload = await this.#bridgeClient
            .conflictCandidate(activeSource)
            .catch(() => ({}));
          if (
            this.#projectSession.matches(context)
            && typeof conflictPayload.content === "string"
          ) {
            const candidateHtml = conflictPayload.content;
            const candidateHash = await this.#hashPort.sha256(candidateHtml);
            if (
              candidateHash !== String(conflictPayload.sha256 || "")
              || !this.#projectSession.matches(context)
            ) throw new Error("恢复候选的内容 Hash 与冲突记录不一致。");
            this.#documentWorkflow.adoptConflictCandidate({
              context,
              html: candidateHtml,
              authoritativeSourceSha256: authoritativeHash,
              expectedSourceSha256: String(
                conflictPayload.expectedSourceSha256
                || runtimeConflict.expectedSourceSha256
                || "",
              ),
              revision: Math.max(
                serverRevision,
                Number(conflictPayload.editRevision || runtimeConflict.editRevision || 0),
              ),
              events: recoveredEvents,
            });
          }
          recoveredAutosaveConflict = true;
        }
      }
      if (mustAdoptSource) {
        const expectedHtml = this.#documentSession.html;
        const expectedHash = await this.#hashPort.sha256(expectedHtml);
        this.#markHydrationStage("verify-rendered");
        await this.#canvasPort.verifyRendered?.(expectedHtml, expectedHash, context);
        if (!this.#projectSession.matches(context)) return stale(context);
      }
      if (recoveredAutosaveConflict) {
        const frozen = this.#canvasPort.freeze(
          "冲突候选已恢复，但编辑画布尚未就绪。",
        );
        if (!frozen?.ok) throw new Error(frozen?.reason || "无法冻结已恢复的冲突候选。");
        this.#documentSession.setPersistence({
          state: "conflict",
          error: "源 HTML 在自动写回前被外部修改。工作台候选和外部文件均已保留，请比较后重新载入或导出当前编辑。",
        });
      }
      this.#setHydration({
        phase: "idle",
        epoch: activeEpoch,
        sourcePath: activeSource,
        error: null,
      });
      this.#emit({
        type: "project-hydrated",
        context,
        projectName: projectRecord.displayName ? String(projectRecord.displayName) : null,
        projectRecordsPath: String(
          workspacePaths.projectRecords || payload.projectRoot || "",
        ) || null,
        lastModifiedAt: authoritativeLastModifiedAt || null,
        showHandoff,
      });
      this.#markHydrationStage("ready");
      if (sourceBoundaryFrozen && !recoveredAutosaveConflict && !this.#runSession.activeLocked) {
        this.#canvasPort.requestFrame?.(() => this.#canvasPort.unlock?.());
      }
      return succeeded({ context, hydrated: true });
    } catch (cause) {
      if (
        publicationStarted
        && activeEpoch === this.#projectSession.epoch
        && this.#codecs.sameSourcePath(this.#projectSession.sourcePath, activeSource)
      ) {
        const restored = this.#rollbackHydrationAuthority(rollback);
        activeEpoch = restored.epoch;
        activeSource = restored.sourcePath;
      }
      if (
        activeEpoch === this.#projectSession.epoch
        && this.#codecs.sameSourcePath(this.#projectSession.sourcePath, activeSource)
      ) {
        const reason = projectErrorMessage(
          this.#codecs,
          cause,
          "项目状态暂时无法读取，请重试；源文件没有被改动。",
        );
        this.#setHydration({
          phase: "failed",
          epoch: activeEpoch,
          sourcePath: activeSource,
          error: reason,
        });
        this.#canvasPort.invalidateRenderAcks?.();
        this.#emit({ type: "project-hydration-failed", reason });
        this.#markHydrationStage("failed");
      }
      return this.#outcomeFromCause(
        operationId,
        cause,
        "PROJECT_HYDRATION_REJECTED",
        projectErrorMessage(
          this.#codecs,
          cause,
          "项目状态暂时无法读取，请重试；源文件没有被改动。",
        ),
      );
    } finally {
      if (
        transitionAuthorized
        && this.projectHydrating
        && activeEpoch === this.#projectSession.epoch
        && this.#codecs.sameSourcePath(this.#projectSession.sourcePath, activeSource)
      ) {
        this.#setHydration({
          phase: "idle",
          epoch: activeEpoch,
          sourcePath: activeSource,
          error: null,
        });
        this.#markHydrationStage("released");
      }
    }
  }

  #captureHydrationAuthority() {
    return Object.freeze({
      project: this.#projectSession.snapshot,
      document: this.#documentSession.snapshot,
      pendingWrite: this.#documentSession.pendingWrite,
      version: this.#versionSession.snapshot,
      comment: this.#commentSession.snapshot,
      draftContext: this.#draftSession.context,
      draftRevision: this.#draftSession.revision,
      documentWorkflow: this.#documentWorkflow.captureProjectTransitionAuthority(),
      run: Object.freeze({
        activeSourcePath: this.#runSession.snapshot.activeSourcePath,
        activeRun: this.#runSession.activeRun,
        recentOutcome: this.#runSession.snapshot.recentOutcome,
        runs: [...this.#runSession.runs],
        backgroundResults: [...this.#runSession.snapshot.backgroundResults],
      }),
    });
  }

  #rollbackHydrationAuthority(previous) {
    const priorProject = previous.project;
    let locator = this.#projectSession.locator;
    let context = null;
    if (
      priorProject.sourcePath
      && priorProject.epoch === this.#projectSession.epoch
      && this.#codecs.sameSourcePath(
        priorProject.sourcePath,
        this.#projectSession.sourcePath,
      )
    ) {
      locator = this.#projectSession.locator;
    } else {
      locator = this.#projectSession.openLocator(priorProject.sourcePath || null);
    }
    if (
      priorProject.registered
      && priorProject.sourcePath
      && priorProject.projectId
      && priorProject.documentId
    ) {
      context = this.#projectSession.register({
        epoch: locator.epoch,
        sourcePath: priorProject.sourcePath,
        projectId: priorProject.projectId,
        documentId: priorProject.documentId,
        ...(priorProject.openTarget ? { openTarget: priorProject.openTarget } : {}),
      });
    } else if (this.#projectSession.context) {
      locator = this.#projectSession.openLocator(priorProject.sourcePath || null);
    }

    this.#documentWorkflow.resetForProjectTransition();
    this.#documentSession.publishAuthority({
      html: previous.document.html,
      sourceSha256: previous.document.sourceSha256,
      editRevision: previous.document.editRevision,
      lastPersistedRevision: previous.document.lastPersistedRevision,
      persistState: previous.document.persistState,
      persistError: previous.document.persistError,
      pendingWrite: previous.pendingWrite,
    });
    this.#versionSession.hydrate({
      versions: previous.version.versions,
      latestVersionId: previous.version.latestVersionId,
      currentBasedOnVersionId: previous.version.currentBasedOnVersionId,
      currentExactVersionId: previous.version.currentExactVersionId,
      restoredFromVersionId: previous.version.restoredFromVersionId,
    });
    if (previous.version.viewMode === "history") {
      this.#versionSession.restoreView?.({
        viewMode: "history",
        viewingVersionId: previous.version.viewingVersionId,
      });
    }
    this.#commentSession.update(previous.comment);
    if (context && typeof this.#draftSession.replaceAuthority === "function") {
      this.#draftSession.replaceAuthority(context, previous.draftRevision, {
        draftRevision: previous.draftRevision,
        comments: previous.comment.comments,
        changeEvents: previous.comment.changeEvents,
        deletedCommentIds: previous.comment.deletedCommentIds,
        appliedOperationIds: [],
      });
    } else {
      this.#draftSession.deactivate();
    }

    for (const run of this.#runSession.runs) this.#runSession.removeRun(run);
    this.#runSession.activate(previous.run.activeSourcePath);
    for (const run of previous.run.runs) {
      this.#runSession.trackRun(run, { activate: "never" });
    }
    this.#runSession.setActiveRun(previous.run.activeRun);
    if (previous.run.recentOutcome) {
      this.#runSession.rememberOutcome(previous.run.recentOutcome);
    } else {
      this.#runSession.forgetOutcome(previous.run.activeSourcePath);
    }
    for (const [sourcePath] of this.#runSession.snapshot.backgroundResults) {
      this.#runSession.clearResult(sourcePath);
    }
    for (const [sourcePath, result] of previous.run.backgroundResults) {
      this.#runSession.markResult(sourcePath, result);
    }
    this.#documentWorkflow.restoreProjectTransitionAuthority({
      authority: previous.documentWorkflow,
      context,
      sourceSha256: previous.document.sourceSha256,
    });
    this.#canvasPort.invalidateRenderAcks?.();
    return Object.freeze({
      epoch: this.#projectSession.epoch,
      sourcePath: this.#projectSession.sourcePath,
    });
  }

  captureManagedSourceTransitionAuthority() {
    return this.#captureHydrationAuthority();
  }

  restoreManagedSourceTransitionAuthority(authority) {
    if (!authority || typeof authority !== "object") return null;
    return this.#rollbackHydrationAuthority(authority);
  }

  // VersionWorkflow shares this narrow transition primitive with Candidate
  // promotion, historical Working Copy continuation and future Registry
  // project activation. The caller prepares async host work first; this method
  // never publishes a partial Project/Document/Version tuple.
  async prepareManagedSourceTransition({
    previousSourcePath,
    nextSourcePath,
    expectedSha256,
    nextProjectId,
    nextDocumentId,
    versionId,
    openTarget = null,
    operationId = null,
  }) {
    const updatesCurrentProject = Boolean(
      (
        nextProjectId
        && this.#projectSession.projectId
        && this.#projectSession.projectId === nextProjectId
      )
      || this.#codecs.sameSourcePath(this.#projectSession.sourcePath, previousSourcePath)
      || this.#codecs.sameSourcePath(this.#projectSession.sourcePath, nextSourcePath)
    );
    if (!nextSourcePath || this.#codecs.sameSourcePath(nextSourcePath, previousSourcePath)) {
      return Object.freeze({
        previousSourcePath,
        nextSourcePath,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        openTarget,
        updatesCurrentProject,
        activatedProject: null,
      });
    }
    const isManagedWorkingCopy = Boolean(
      openTarget
      && openTarget.targetKind === "working-copy"
      && String(openTarget.projectId || "") === String(nextProjectId || "")
      && String(openTarget.documentId || "") === String(nextDocumentId || "")
      && String(openTarget.workingCopyId || "")
      && String(openTarget.versionId || "") === String(versionId || "")
      && String(openTarget.projectRootPath || "")
    );
    const activatedProject = isManagedWorkingCopy
      ? await this.#activateManagedWorkingCopy({
          previousSourcePath,
          nextSourcePath,
          expectedSha256,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          workingCopyId: String(openTarget.workingCopyId),
          versionId,
          projectRootPath: String(openTarget.projectRootPath),
          ...(operationId ? { operationId: String(operationId) } : {}),
        })
      : await this.#activateGeneratedVersion({
          previousSourcePath,
          nextSourcePath,
          expectedSha256,
          projectId: nextProjectId,
          versionId,
        });
    if (
      !this.#codecs.sameSourcePath(activatedProject.sourcePath, nextSourcePath)
      || activatedProject.sha256 !== expectedSha256
      || await this.#hashPort.sha256(activatedProject.html) !== expectedSha256
    ) throw new Error("生成版本的路径、HTML 与 Hash 没有形成完整一致的候选。");
    return Object.freeze({
      previousSourcePath,
      nextSourcePath,
      projectId: nextProjectId,
      documentId: nextDocumentId,
      openTarget,
      updatesCurrentProject,
      activatedProject,
    });
  }

  async #activateGeneratedVersion(input) {
    if (typeof this.#projectOpenPort.activateGeneratedVersion !== "function") {
      throw new Error("当前运行环境不能安全切换到生成的新版本文件。");
    }
    return this.#projectOpenPort.activateGeneratedVersion(input);
  }

  async #activateManagedWorkingCopy(input) {
    if (typeof this.#projectOpenPort.activateManagedWorkingCopy !== "function") {
      throw new Error("当前运行环境不能安全切换到托管工作文件。");
    }
    return this.#projectOpenPort.activateManagedWorkingCopy(input);
  }

  commitManagedSourceTransition({
    prepared,
    html,
    sourceSha256,
    publishVersion = () => {},
    publishSessions = null,
  }) {
    if (!prepared.updatesCurrentProject) return null;
    const changesSourcePath = !this.#codecs.sameSourcePath(
      this.#projectSession.sourcePath,
      prepared.nextSourcePath,
    );
    if (changesSourcePath) {
      this.#runSession.rebaseSource({
        previousSourcePath: prepared.previousSourcePath,
        sourcePath: prepared.nextSourcePath,
        projectId: prepared.projectId,
      });
    }
    const transition = changesSourcePath
      ? this.#projectSession.transitionSource({
          previousSourcePath: prepared.previousSourcePath,
          sourcePath: prepared.nextSourcePath,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
          openTarget: prepared.openTarget,
        })
      : this.#projectSession.context || this.#projectSession.register({
          epoch: this.#projectSession.epoch,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
          sourcePath: prepared.nextSourcePath,
          ...(prepared.openTarget ? { openTarget: prepared.openTarget } : {}),
        });
    if (!transition || !this.#projectSession.context) return null;

    // Publication is deliberately synchronous: no consumer can observe a new
    // Project without the complete Document tuple, Version/Draft/Comment
    // authority and new Canvas generation.
    if (changesSourcePath) {
      this.#documentWorkflow.resetForProjectTransition();
      this.#commentWorkflow.resetForProjectTransition();
      this.#projectRulesWorkflow.resetForProjectTransition();
    }
    this.#documentSession.publishAuthority({
      html,
      sourceSha256,
      pendingWrite: null,
    });
    if (typeof publishSessions === "function") {
      publishSessions(this.#projectSession.context);
    } else {
      publishVersion();
      if (changesSourcePath) this.#draftSession.deactivate();
    }
    this.#canvasPort.invalidateRenderAcks?.();
    return this.#projectSession.context;
  }

  // Kept as a compatibility seam for the already-published Candidate route.
  // New managed source callers use the generic names above.
  async prepareGeneratedSourceTransition(input) {
    return this.prepareManagedSourceTransition(input);
  }

  commitGeneratedSourceTransition(input) {
    return this.commitManagedSourceTransition(input);
  }

  #deferCanvasCommand(kind, run, options = {}) {
    if (typeof this.#canvasPort.deferCommand !== "function") return null;
    let resolveDeferred;
    const outcome = new Promise((resolve) => {
      resolveDeferred = resolve;
    });
    const deferred = this.#canvasPort.deferCommand(
      kind,
      () => Promise.resolve(run()).then(resolveDeferred, (cause) => {
        resolveDeferred(rejected(
          "PROJECT_DEFERRED_COMMAND_REJECTED",
          projectErrorMessage(this.#codecs, cause, "延后的项目操作失败。"),
        ));
      }),
      {
        ...options,
        onDiscard: () => resolveDeferred(blocked(
          "PROJECT_DEFERRED_COMMAND_DISCARDED",
          "当前项目已经变化，延后的操作没有执行。",
        )),
      },
    );
    return deferred ? outcome : null;
  }

  #scheduleDeferredReconciliation() {
    if (this.#reconcileScheduled || this.#disposed) return;
    this.#reconcileScheduled = true;
    Promise.resolve().then(() => {
      this.#reconcileScheduled = false;
      this.reconcileDeferred();
    });
  }

  #waitUntil(predicate) {
    if (predicate()) return Promise.resolve();
    return new Promise((resolve) => {
      const poll = () => {
        if (predicate()) {
          resolve();
          return;
        }
        this.#scheduler.setTimeout(poll, 40);
      };
      this.#scheduler.setTimeout(poll, 40);
    });
  }

  async #drainExternalOpenForClose(deadlineAt) {
    while (this.#clock.now() < Number(deadlineAt)) {
      const confirmation = this.#openConfirmation;
      if (confirmation) {
        const canceled = await this.cancelExternalOpen({
          requestId: confirmation.requestId,
        });
        if (canceled.status !== "succeeded") {
          await new Promise((resolve) => this.#scheduler.setTimeout(resolve, 40));
        }
        continue;
      }
      if (this.#externalFileOpenSession.snapshot.status === "idle") return true;
      await this.#waitUntil(() => (
        Boolean(this.#openConfirmation)
        || this.#externalFileOpenSession.snapshot.status === "idle"
      ));
    }
    return false;
  }

  #dependencyOutcome(outcome, identity, fallbackCode, fallbackReason) {
    if (outcome?.status === "stale") return stale(identity);
    if (outcome?.status === "unknown") {
      return unknown(outcome.operationId || this.#nextOperationId("source-rename"), (
        outcome.reason || fallbackReason
      ));
    }
    if (outcome?.status === "rejected") {
      return rejected(outcome.code || fallbackCode, outcome.reason || fallbackReason);
    }
    return blocked(outcome?.code || fallbackCode, outcome?.reason || fallbackReason);
  }

  #setHydration({ phase, epoch, sourcePath, error }) {
    if (phase === "hydrating") this.#hydrationGeneration += 1;
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      hydration: Object.freeze({
        phase,
        generation: this.#hydrationGeneration,
        epoch: Number(epoch) || 0,
        sourcePath: sourcePath ? String(sourcePath) : null,
        error: error ? String(error) : null,
      }),
    });
    this.#notify();
  }

  #setSwitch(phase, operationId) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      switch: Object.freeze({ phase, operationId }),
    });
    this.#notify();
  }

  #setRename(phase, operationId) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      rename: Object.freeze({ phase, operationId }),
    });
    this.#notify();
  }

  #setOpen(phase, operationId, pendingKind) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      open: Object.freeze({ phase, operationId, pendingKind }),
    });
    this.#notify();
  }

  #setClose(phase, requestId) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      close: Object.freeze({ phase, requestId }),
    });
    this.#notify();
  }

  #publishSnapshot() {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      openConfirmation: this.#openConfirmation,
      externalOpen: this.#externalFileOpenSession.snapshot,
      projectApplication: this.#projectApplicationSession.snapshot,
    });
    this.#notify();
  }

  #notify() {
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // A presentation subscriber cannot affect project authority.
      }
    }
  }

  #emit(event) {
    if (this.#disposed) return;
    const frozen = Object.freeze(event);
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // A presentation event listener cannot affect project authority.
      }
    }
  }

  #isHistoryView() {
    return this.#versionSession.snapshot.viewMode === "history";
  }

  #markHydrationStage(stage) {
    this.#emit({ type: "project-hydration-stage", stage: String(stage) });
  }

  #nextOperationId(prefix) {
    this.#operationSequence += 1;
    return [
      prefix,
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#operationSequence.toString(36),
    ].join("_");
  }

  #nextOpenOperation() {
    this.#openSequence += 1;
    return [
      "project-open",
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#openSequence.toString(36),
    ].join("_");
  }

  #outcomeFromCause(operationId, cause, fallbackCode, fallbackMessage) {
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      return unknown(operationId, fallbackMessage);
    }
    return rejected(projectErrorCode(cause, fallbackCode), fallbackMessage);
  }
}
