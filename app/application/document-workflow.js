import { isBridgeRequestError } from "./bridge-client.js";
import { createDocumentWorkflowCodecs } from "./document-workflow-codecs.js";

const AUTOSAVE_DELAY_MS = 100;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function isNativeEditCheckpoint(mutation) {
  return Boolean(
    mutation
    && mutation.kind === "text"
    && (
      mutation.property === "editableIslandHtml"
      || mutation.property === "textFragmentHtml"
    ),
  );
}

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

function stale(context) {
  return Object.freeze({ status: "stale", context: Object.freeze({ ...context }) });
}

function revision(value) {
  const next = Number(value);
  return Number.isSafeInteger(next) && next >= 0 ? next : 0;
}

function sourceErrorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  return cause && typeof cause === "object" && cause.code
    ? String(cause.code)
    : fallback;
}

function sameContext(left, right, sameSourcePath) {
  return Boolean(
    left
    && right
    && Number(left.epoch) === Number(right.epoch)
    && String(left.projectId || "") === String(right.projectId || "")
    && String(left.documentId || "") === String(right.documentId || "")
    && sameSourcePath(left.sourcePath, right.sourcePath),
  );
}

function sameOpenTarget(left, right, sameSourcePath) {
  return Boolean(
    sameOpenRoute(left, right, sameSourcePath)
    && String(left.sourceSha256 || "") === String(right.sourceSha256 || "")
  );
}

function sameOpenRoute(left, right, sameSourcePath) {
  return Boolean(
    sameContext(left, right, sameSourcePath)
    && String(left.projectRootPath || "") === String(right.projectRootPath || "")
    && String(left.targetKind || "") === String(right.targetKind || "")
    && String(left.workingCopyId || "") === String(right.workingCopyId || "")
    && String(left.versionId || "") === String(right.versionId || "")
    && sameSourcePath(left.exactSourcePath || left.sourcePath, right.exactSourcePath || right.sourcePath)
    && Number(left.sessionEpoch ?? left.epoch) === Number(right.sessionEpoch ?? right.epoch)
  );
}

function copyContext(context) {
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

function invalidAcknowledgement(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function identityMatches(left, right, sameSourcePath) {
  return Boolean(
    left
    && right
    && String(left.token || "") === String(right.token || "")
    && String(left.projectId || "") === String(right.projectId || "")
    && String(left.documentId || "") === String(right.documentId || "")
    && sameSourcePath(left.sourcePath, right.sourcePath)
    && String(left.basedOnVersionId || "") === String(right.basedOnVersionId || "")
    && String(left.sourceSha256 || "") === String(right.sourceSha256 || "")
    && Number(left.editRevision) === Number(right.editRevision),
  );
}

// DocumentWorkflow is the PR-2 durable-source boundary.  It receives existing
// Sessions by injection; it never creates a second fact owner and never imports
// the renderer's Workbench or DOM implementation.
export class DocumentWorkflow {
  #bridgeClient;
  #ensureRegistered;
  #projectSession;
  #documentSession;
  #commentSession;
  #versionSession;
  #sourceHistorySession;
  #codecs;
  #hashPort;
  #recoveryStore;
  #canvasPort;
  #scheduler;
  #clock;
  #listeners = new Set();
  #autosaveTimer = null;
  #historyActionPromise = null;
  #auditPending = [];
  #auditInFlight = new Set();
  #recoveryIdentity = null;
  #operationSequence = 0;
  #disposed = false;

  constructor({
    bridgeClient,
    ensureRegistered,
    projectSession,
    documentSession,
    commentSession,
    versionSession,
    sourceHistorySession,
    codecs,
    ports = {},
    scheduler = globalThis,
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.autosave !== "function"
      || typeof bridgeClient.source !== "function"
      || typeof bridgeClient.workspace !== "function"
      || typeof bridgeClient.sourceHistoryAction !== "function"
      || typeof bridgeClient.resolveConflict !== "function"
    ) {
      throw new TypeError("DocumentWorkflow requires its durable Bridge methods.");
    }
    if (typeof ensureRegistered !== "function") {
      throw new TypeError("DocumentWorkflow requires project registration authority.");
    }
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("DocumentWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.beginEdit !== "function") {
      throw new TypeError("DocumentWorkflow requires DocumentSession injection.");
    }
    if (!commentSession || typeof commentSession.update !== "function") {
      throw new TypeError("DocumentWorkflow requires CommentSession injection.");
    }
    if (!versionSession || typeof versionSession.markSourceEdited !== "function") {
      throw new TypeError("DocumentWorkflow requires VersionSession injection.");
    }
    if (!sourceHistorySession || typeof sourceHistorySession.record !== "function") {
      throw new TypeError("DocumentWorkflow requires SourceHistorySession injection.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("DocumentWorkflow requires a HashPort.");
    }
    if (
      !ports.recoveryStore
      || typeof ports.recoveryStore.readRecords !== "function"
      || typeof ports.recoveryStore.write !== "function"
      || typeof ports.recoveryStore.remove !== "function"
    ) {
      throw new TypeError("DocumentWorkflow requires a RecoveryStore port.");
    }
    if (!ports.canvas || typeof ports.canvas.invalidateRenderAcks !== "function") {
      throw new TypeError("DocumentWorkflow requires a CanvasAuthorityPort.");
    }
    if (
      !scheduler
      || typeof scheduler.setTimeout !== "function"
      || typeof scheduler.clearTimeout !== "function"
    ) {
      throw new TypeError("DocumentWorkflow requires a SchedulerPort.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("DocumentWorkflow requires a ClockPort.");
    }

    this.#bridgeClient = bridgeClient;
    this.#ensureRegistered = ensureRegistered;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#commentSession = commentSession;
    this.#versionSession = versionSession;
    this.#sourceHistorySession = sourceHistorySession;
    this.#codecs = createDocumentWorkflowCodecs(codecs);
    this.#hashPort = ports.hash;
    this.#recoveryStore = ports.recoveryStore;
    this.#canvasPort = ports.canvas;
    this.#scheduler = scheduler;
    this.#clock = clock;
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("DocumentWorkflow event listener must be a function.");
    }
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.#clearAutosaveTimer();
    this.#listeners.clear();
  }

  get hasHistoryAction() {
    return Boolean(this.#historyActionPromise);
  }

  get recoveryIdentity() {
    return this.#recoveryIdentity;
  }

  get pendingAuditEvents() {
    return [...this.#auditPending];
  }

  replaceRecoveryIdentity(identity) {
    this.#recoveryIdentity = identity || null;
    return this.#recoveryIdentity;
  }

  captureProjectTransitionAuthority() {
    return Object.freeze({
      recoveryIdentity: this.#recoveryIdentity,
      sourceHistory: this.#sourceHistorySession.snapshot,
      sourceHistoryOperations: this.#sourceHistorySession.pendingOperations,
    });
  }

  restoreProjectTransitionAuthority({
    authority,
    context,
    sourceSha256,
  } = {}) {
    this.#recoveryIdentity = authority?.recoveryIdentity || null;
    const activeContext = copyContext(context);
    const history = authority?.sourceHistory;
    if (!activeContext || !this.#isCurrent(activeContext) || !history || !sourceSha256) {
      this.#sourceHistorySession.deactivate?.();
      return false;
    }
    this.#sourceHistorySession.activate(
      activeContext,
      String(sourceSha256),
      history,
    );
    this.#sourceHistorySession.restorePending(
      activeContext,
      authority.sourceHistoryOperations,
    );
    return true;
  }

  resetForProjectTransition({ clearRecovery = false, context } = {}) {
    this.#clearAutosaveTimer();
    this.#auditPending = [];
    this.#auditInFlight.clear();
    this.#recoveryIdentity = null;
    this.#sourceHistorySession.deactivate?.();
    if (clearRecovery) this.#persistRecovery(null, context);
  }

  clearRecovery(context) {
    this.#persistRecovery(null, context);
  }

  clearAutosaveTimer() {
    this.#clearAutosaveTimer();
  }

  clearAudit() {
    this.#auditPending = [];
    this.#auditInFlight.clear();
  }

  activateSourceHistory({ context, sourceSha256, history, preservePending = false } = {}) {
    const activeContext = copyContext(context);
    if (!activeContext || !this.#isCurrent(activeContext)) {
      return activeContext ? stale(activeContext) : blocked(
        "DOCUMENT_CONTEXT_REQUIRED",
        "当前页面尚未完成项目身份初始化。",
      );
    }
    this.#sourceHistorySession.activate(
      activeContext,
      String(sourceSha256 || ""),
      history,
      { preservePending },
    );
    return succeeded({ active: true });
  }

  async waitForHistoryAction() {
    return this.#historyActionPromise
      ? this.#historyActionPromise
      : succeeded({ idle: true });
  }

  enqueueEdit({ html, mutation, sourceTransaction, context } = {}) {
    if (this.#disposed) {
      return blocked("DOCUMENT_WORKFLOW_DISPOSED", "文档持久化工作流已经停止。");
    }
    if (this.#documentSession.persistState === "conflict") {
      return blocked(
        "DOCUMENT_PERSISTENCE_CONFLICT",
        "当前 HTML 与外部文件存在冲突，请先选择要保留的版本。",
      );
    }
    const writeContext = this.#writeContext(context);
    const nextHtml = String(html ?? "");
    const nextRevision = this.#documentSession.editRevision + 1;
    if (sourceTransaction && writeContext.sourcePath) {
      try {
        this.#sourceHistorySession.record(
          writeContext,
          sourceTransaction,
          nextRevision,
          new Date(this.#clock.now()).toISOString(),
        );
      } catch (cause) {
        return rejected(
          "SOURCE_HISTORY_RECORD_REJECTED",
          this.#codecs.errorMessage(cause, "源码历史与当前编辑不一致。"),
        );
      }
    }

    const revisionAfterEdit = this.#documentSession.beginEdit(nextHtml);
    if (revisionAfterEdit !== nextRevision) {
      return blocked(
        "DOCUMENT_EDIT_REJECTED",
        "当前文档不接受新的编辑，请先处理现有冲突。",
      );
    }
    this.#versionSession.markSourceEdited();
    this.#canvasPort.invalidateRenderAcks();

    if (mutation) {
      const nextEvents = this.#codecs.appendDirectEditEvent({
        mutation,
        revision: nextRevision,
        createdAt: new Date(this.#clock.now()).toISOString(),
        basedOnVersionId: this.#versionSession.snapshot.currentBasedOnVersionId,
        events: this.#commentSession.changeEvents,
        pendingEvents: this.#auditPending,
        inFlightKeys: this.#auditInFlight,
        nextEventId: () => this.#nextOperationId("change"),
      });
      this.#commentSession.setChangeEvents(nextEvents.events);
      this.#auditPending = nextEvents.pendingEvents;
      this.#emit({
        type: "document-direct-edit-recorded",
        context: writeContext,
        mutation,
        events: nextEvents.events,
      });
    }

    if (!writeContext.sourcePath) {
      this.#clearAutosaveTimer();
      this.#documentSession.update({
        pendingWrite: null,
        persistState: "preview-dirty",
        persistError: "",
      });
      return succeeded({ revision: nextRevision, queued: false });
    }

    const write = this.#createWrite(writeContext, nextHtml, nextRevision);
    this.#documentSession.setPendingWrite(write);
    this.#persistRecovery(write, writeContext);
    this.#documentSession.setPersistence({ state: "queued", error: "" });
    this.#scheduleAutosave({ immediate: isNativeEditCheckpoint(mutation) });
    this.#emit({
      type: "document-edit-queued",
      context: writeContext,
      revision: nextRevision,
    });
    return succeeded({ revision: nextRevision, queued: true });
  }

  async flush({ throughRevision } = {}) {
    if (this.#disposed) {
      return blocked("DOCUMENT_WORKFLOW_DISPOSED", "文档持久化工作流已经停止。");
    }
    this.#clearAutosaveTimer();
    const cutoff = throughRevision === undefined ? undefined : revision(throughRevision);
    const currentPromise = this.#documentSession.flushPromise;
    if (currentPromise) {
      const outcome = await currentPromise;
      if (!outcome || outcome.status !== "succeeded") return outcome || blocked(
        "DOCUMENT_FLUSH_UNKNOWN",
        "当前文档写入没有返回可验证结果。",
      );
      if (
        cutoff === undefined
        || this.#documentSession.lastPersistedRevision >= cutoff
      ) return outcome;
    }

    this.#reconstructPendingWrite();
    if (!this.#documentSession.pendingWrite) {
      return this.#documentSession.editRevision
        <= this.#documentSession.lastPersistedRevision
        ? succeeded({ revision: this.#documentSession.lastPersistedRevision, idle: true })
        : blocked(
          "DOCUMENT_SOURCE_UNBOUND",
          "当前编辑尚未绑定本地 HTML，无法写回源文件。",
        );
    }

    const promise = this.#runFlush(cutoff);
    this.#documentSession.setFlushPromise(promise);
    try {
      return await promise;
    } finally {
      this.#documentSession.clearFlushPromise(promise);
    }
  }

  performHistoryAction({ direction, context } = {}) {
    if (this.#disposed) {
      return Promise.resolve(blocked(
        "DOCUMENT_WORKFLOW_DISPOSED",
        "文档持久化工作流已经停止。",
      ));
    }
    if (direction !== "undo" && direction !== "redo") {
      return Promise.resolve(rejected(
        "SOURCE_HISTORY_DIRECTION_INVALID",
        "只能撤销或重做源码历史。",
      ));
    }
    if (this.#historyActionPromise) return this.#historyActionPromise;
    const operation = this.#runHistoryAction({
      direction,
      context: copyContext(context) || this.#projectSession.context,
    });
    this.#historyActionPromise = operation;
    operation.finally(() => {
      if (this.#historyActionPromise === operation) {
        this.#historyActionPromise = null;
      }
    });
    return operation;
  }

  async reloadAuthority({
    context,
    acceptExternalConflict = false,
    externalAuthorityAccepted = false,
  } = {}) {
    const activeContext = copyContext(context) || this.#projectSession.context;
    if (!activeContext) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    if (!this.#isCurrent(activeContext)) return stale(activeContext);
    const previousDocument = this.#documentSession.snapshot;
    const previousPendingWrite = this.#documentSession.pendingWrite;
    const previousVersionView = this.#versionSession.captureView();
    let externalAccepted = Boolean(externalAuthorityAccepted);
    try {
      if (acceptExternalConflict && !externalAccepted) {
        await this.#bridgeClient.resolveConflict({
          ...activeContext,
          action: "force-unlock",
        });
        externalAccepted = true;
        if (!this.#isCurrent(activeContext)) return stale(activeContext);
      }
      const payload = await this.#bridgeClient.source(activeContext.sourcePath);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      this.#assertSourcePayload(payload, activeContext, "重新读取时文件身份发生变化，已拒绝覆盖当前项目。");
      const html = String(payload.content || "");
      const sourceSha256 = String(payload.sha256 || "");
      if (!SHA256.test(sourceSha256) || await this.#hashPort.sha256(html) !== sourceSha256) {
        throw invalidAcknowledgement(
          "重新读取的源 HTML 与声明 Hash 不一致。",
          "INVALID_SOURCE_ACK",
        );
      }
      this.#documentSession.publishAuthority({
        html,
        sourceSha256,
        pendingWrite: null,
        persistState: "idle",
        persistError: "",
      });
      this.#versionSession.returnCurrent({
        currentExactVersionId: payload.currentExactVersionId || null,
        currentBasedOnVersionId: payload.currentBasedOnVersionId || undefined,
        restoredFromVersionId: payload.restoredFromVersionId || null,
      });
      this.#canvasPort.invalidateRenderAcks();
      await this.#verifyRendered(html, sourceSha256, activeContext);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      this.#auditPending = [];
      this.#auditInFlight.clear();
      this.#commentSession.setChangeEvents([]);
      this.#persistRecovery(null, activeContext);
      this.#emit({
        type: "document-authority-reloaded",
        context: activeContext,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      });
      return succeeded({
        html,
        sourceSha256,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      });
    } catch (cause) {
      if (this.#isCurrent(activeContext) && !externalAccepted) {
        this.#documentSession.publishAuthority({
          html: previousDocument.html,
          sourceSha256: previousDocument.sourceSha256,
          pendingWrite: previousPendingWrite,
          persistState: previousDocument.persistState,
          persistError: previousDocument.persistError,
        });
        this.#versionSession.restoreView(previousVersionView);
        this.#canvasPort.invalidateRenderAcks();
        try {
          await this.#verifyRendered(
            previousDocument.html,
            await this.#hashPort.sha256(previousDocument.html),
            activeContext,
          );
        } catch {
          // The transition stays fail-closed until the caller releases its view lock.
        }
      }
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const message = externalAccepted
        ? "外部 HTML 已被保留，但编辑画布未能安全显示该版本。当前项目已锁定，请重试读取或重新打开文件。"
        : this.#codecs.errorMessage(cause, "请稍后重试，源文件没有被覆盖。");
      if (externalAccepted) {
        // Once the user keeps the external source, the previous canvas is no
        // longer persistence authority.  A failed render must remain closed
        // until a later project read verifies the external bytes.
        this.#documentSession.setPersistence({ state: "failed", error: message });
      }
      this.#emit({
        type: "document-authority-reload-failed",
        context: activeContext,
        code: sourceErrorCode(cause, "SOURCE_RELOAD_REJECTED"),
        message,
        externalAccepted,
        fatal: externalAccepted,
      });
      return this.#outcomeFromCause(
        this.#nextOperationId("reload"),
        cause,
        "SOURCE_RELOAD_REJECTED",
        message,
      );
    }
  }

  async previewExternalSource({ context } = {}) {
    const activeContext = copyContext(context) || this.#projectSession.context;
    if (!activeContext) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    if (!this.#isCurrent(activeContext)) return stale(activeContext);
    if (typeof this.#bridgeClient.sourcePreview !== "function") {
      return blocked("SOURCE_PREVIEW_UNAVAILABLE", "当前运行时无法预览磁盘源文件。");
    }
    try {
      const payload = await this.#bridgeClient.sourcePreview(activeContext.sourcePath);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const html = String(payload.content || "");
      const sourceSha256 = String(payload.sha256 || "");
      if (!SHA256.test(sourceSha256) || await this.#hashPort.sha256(html) !== sourceSha256) {
        throw invalidAcknowledgement(
          "磁盘预览 HTML 与声明 Hash 不一致。",
          "INVALID_SOURCE_ACK",
        );
      }
      return succeeded({
        html,
        sourceSha256,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
        size: Number(payload.size || 0),
      });
    } catch (cause) {
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const message = this.#codecs.errorMessage(cause, "暂时无法预览磁盘上的源文件。");
      this.#emit({
        type: "document-external-source-preview-failed",
        context: activeContext,
        code: sourceErrorCode(cause, "SOURCE_PREVIEW_REJECTED"),
        message,
      });
      return this.#outcomeFromCause(
        this.#nextOperationId("preview"),
        cause,
        "SOURCE_PREVIEW_REJECTED",
        message,
      );
    }
  }

  async forceUnlockConflict({ context } = {}) {
    const activeContext = copyContext(context) || this.#projectSession.context;
    if (!activeContext) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    if (!this.#isCurrent(activeContext)) return stale(activeContext);
    const previousDocument = this.#documentSession.snapshot;
    const previousPendingWrite = this.#documentSession.pendingWrite;
    const previousVersionView = this.#versionSession.captureView();
    try {
      await this.#bridgeClient.resolveConflict({
        ...activeContext,
        action: "force-unlock",
      });
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const payload = await this.#bridgeClient.source(activeContext.sourcePath);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      this.#assertSourcePayload(payload, activeContext, "强制解锁后文件身份发生变化，已拒绝覆盖当前项目。");
      const html = String(payload.content || "");
      const sourceSha256 = String(payload.sha256 || "");
      if (!SHA256.test(sourceSha256) || await this.#hashPort.sha256(html) !== sourceSha256) {
        throw invalidAcknowledgement(
          "强制解锁后读取的源 HTML 与声明 Hash 不一致。",
          "INVALID_SOURCE_ACK",
        );
      }
      const editRevision = this.#documentSession.editRevision;
      this.#documentSession.publishAuthority({
        html,
        sourceSha256,
        pendingWrite: null,
        persistState: "idle",
        persistError: "",
        lastPersistedRevision: editRevision,
      });
      this.#versionSession.returnCurrent({
        currentExactVersionId: payload.currentExactVersionId || null,
        currentBasedOnVersionId: payload.currentBasedOnVersionId || undefined,
        restoredFromVersionId: payload.restoredFromVersionId || null,
      });
      this.#canvasPort.invalidateRenderAcks();
      await this.#verifyRendered(html, sourceSha256, activeContext);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      this.#auditPending = [];
      this.#auditInFlight.clear();
      this.#commentSession.setChangeEvents([]);
      this.#persistRecovery(null, activeContext);
      this.#emit({
        type: "document-conflict-force-unlocked",
        context: activeContext,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      });
      return succeeded({
        html,
        sourceSha256,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      });
    } catch (cause) {
      if (this.#isCurrent(activeContext)) {
        this.#documentSession.publishAuthority({
          html: previousDocument.html,
          sourceSha256: previousDocument.sourceSha256,
          pendingWrite: previousPendingWrite,
          persistState: previousDocument.persistState,
          persistError: previousDocument.persistError,
        });
        this.#versionSession.restoreView(previousVersionView);
        this.#canvasPort.invalidateRenderAcks();
      }
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const message = this.#codecs.errorMessage(cause, "强制解锁没有完成，项目仍保持冲突状态。");
      this.#emit({
        type: "document-conflict-force-unlock-failed",
        context: activeContext,
        code: sourceErrorCode(cause, "DOCUMENT_FORCE_UNLOCK_REJECTED"),
        message,
      });
      return this.#outcomeFromCause(
        this.#nextOperationId("unlock"),
        cause,
        "DOCUMENT_FORCE_UNLOCK_REJECTED",
        message,
      );
    }
  }

  async ensureCurrentCanvas({ context } = {}) {
    const activeContext = copyContext(context) || this.#projectSession.context;
    let expectedHtml = this.#documentSession.html;
    let expectedSha256 = await this.#hashPort.sha256(expectedHtml);
    const clean = Boolean(
      activeContext
      && this.#documentSession.persistState === "idle"
      && this.#documentSession.editRevision === this.#documentSession.lastPersistedRevision
      && !this.#documentSession.pendingWrite
      && !this.#documentSession.flushPromise,
    );
    try {
      if (
        activeContext
        && clean
        && this.#documentSession.sourceSha256
        && this.#documentSession.sourceSha256 !== expectedSha256
      ) {
        const payload = await this.#bridgeClient.source(activeContext.sourcePath);
        if (!this.#isCurrent(activeContext)) return stale(activeContext);
        this.#assertSourcePayload(payload, activeContext, "自动恢复时源文件身份发生变化。");
        const repairedHtml = String(payload.content || "");
        const repairedSha256 = String(payload.sha256 || "");
        if (
          !SHA256.test(repairedSha256)
          || await this.#hashPort.sha256(repairedHtml) !== repairedSha256
        ) {
          throw invalidAcknowledgement(
            "自动恢复读取到的源 HTML 与 Hash 不一致。",
            "INVALID_SOURCE_ACK",
          );
        }
        if (!this.#isCurrent(activeContext)) return stale(activeContext);
        this.#documentSession.publishAuthority({
          html: repairedHtml,
          sourceSha256: repairedSha256,
          pendingWrite: null,
          persistState: "idle",
          persistError: "",
        });
        this.#versionSession.updateAuthority({
          currentBasedOnVersionId: payload.currentBasedOnVersionId || undefined,
          currentExactVersionId: payload.currentExactVersionId || null,
          restoredFromVersionId: payload.restoredFromVersionId || null,
        });
        this.#canvasPort.invalidateRenderAcks();
        expectedHtml = repairedHtml;
        expectedSha256 = repairedSha256;
        this.#emit({
          type: "document-authority-repaired",
          context: activeContext,
          lastModifiedAt: String(payload.lastModifiedAt || ""),
        });
      }
      await this.#verifyRendered(expectedHtml, expectedSha256, activeContext || undefined);
      return succeeded({ html: expectedHtml, sourceSha256: expectedSha256 });
    } catch (cause) {
      if (activeContext && !this.#isCurrent(activeContext)) return stale(activeContext);
      return this.#outcomeFromCause(
        this.#nextOperationId("canvas"),
        cause,
        "DOCUMENT_CANVAS_AUTHORITY_REJECTED",
        this.#codecs.errorMessage(cause, "当前画布尚未完成自动恢复。"),
      );
    }
  }

  async observeExternalSourceChange({ sourcePath } = {}) {
    if (this.#disposed) {
      return blocked("DOCUMENT_WORKFLOW_DISPOSED", "文档持久化工作流已经停止。");
    }
    const liveContext = copyContext(this.#projectSession.context);
    if (!liveContext?.sourcePath) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    if (
      sourcePath
      && !this.#codecs.sameSourcePath(sourcePath, liveContext.sourcePath)
    ) {
      return succeeded({ ignored: true, reason: "stale-path" });
    }
    if (this.#documentSession.persistState === "conflict") {
      return succeeded({ alreadyConflict: true });
    }
    if (
      this.#documentSession.persistState === "writing"
      || this.#documentSession.persistState === "queued"
      || this.#documentSession.pendingWrite
      || this.#documentSession.flushPromise
      || this.hasHistoryAction
    ) {
      return succeeded({ deferred: true });
    }
    try {
      let diskSha256 = "";
      let lastModifiedAt = "";
      let size = 0;
      if (typeof this.#bridgeClient.sourceStat === "function") {
        const stat = await this.#bridgeClient.sourceStat(liveContext.sourcePath);
        diskSha256 = String(stat.sha256 || "");
        lastModifiedAt = String(stat.lastModifiedAt || "");
        size = Number(stat.size || 0);
        if (!SHA256.test(diskSha256)) {
          throw invalidAcknowledgement(
            "外部源 HTML 与声明 Hash 不一致。",
            "INVALID_SOURCE_ACK",
          );
        }
      } else {
        const payload = await this.#bridgeClient.source(liveContext.sourcePath);
        this.#assertSourcePayload(
          payload,
          liveContext,
          "核对外部源文件时文件身份发生变化，已拒绝覆盖当前项目。",
        );
        diskSha256 = String(payload.sha256 || "");
        lastModifiedAt = String(payload.lastModifiedAt || "");
        if (
          !SHA256.test(diskSha256)
          || await this.#hashPort.sha256(String(payload.content || "")) !== diskSha256
        ) {
          throw invalidAcknowledgement(
            "外部源 HTML 与声明 Hash 不一致。",
            "INVALID_SOURCE_ACK",
          );
        }
      }
      const current = copyContext(this.#projectSession.context);
      if (
        !current
        || !this.#codecs.sameSourcePath(current.sourcePath, liveContext.sourcePath)
      ) {
        return stale(liveContext);
      }
      if (diskSha256 === this.#documentSession.sourceSha256) {
        if (lastModifiedAt) {
          this.#emit({
            type: "document-boundary-reconciled",
            sourcePath: current.sourcePath,
            lastModifiedAt,
          });
        }
        return succeeded({
          unchanged: true,
          changed: false,
          sourceSha256: diskSha256,
          sha256: diskSha256,
          lastModifiedAt,
        });
      }
      const message = "源文件在磁盘上被其他程序修改了。您的编辑内容仍在，可先预览外部版本再决定。";
      this.#documentSession.setPersistence({
        state: "conflict",
        error: message,
      });
      this.#emit({
        type: "document-external-source-changed",
        context: current,
        sha256: diskSha256,
        lastModifiedAt,
        size,
      });
      return succeeded({
        conflict: true,
        changed: true,
        sourceSha256: diskSha256,
        sha256: diskSha256,
        lastModifiedAt,
      });
    } catch (cause) {
      const current = copyContext(this.#projectSession.context);
      if (
        current
        && sourcePath
        && !this.#codecs.sameSourcePath(sourcePath, current.sourcePath)
      ) {
        return stale(liveContext);
      }
      const code = sourceErrorCode(cause, "WORKING_COPY_UNAVAILABLE");
      const message = this.#codecs.errorMessage(
        cause,
        "当前工作文件暂时不可用，修改仍保留。",
      );
      if (current && this.#isCurrent(current)) {
        this.#emit({
          type: "document-persistence-failed",
          context: current,
          code,
          message,
          conflict: false,
          protocolError: false,
          recoveryWrite: this.#documentSession.pendingWrite,
          fatal: false,
        });
      }
      return this.#outcomeFromCause(
        this.#nextOperationId("source-observe"),
        cause,
        code,
        message,
      );
    }
  }

  async reconcileBoundary({
    frozenHtml,
    reportedSourceSha256 = null,
    cutoffRevision,
    identity,
    timeoutMs = 2_500,
  } = {}) {
    const boundaryIdentity = identity || this.#projectSession.snapshot;
    const sourcePath = String(boundaryIdentity?.sourcePath || "");
    if (!sourcePath) {
      return blocked("DOCUMENT_BOUNDARY_SOURCE_REQUIRED", "当前页面没有可核对的源文件。");
    }
    try {
      const result = await this.#documentSession.reconcilePersistedBoundary({
        frozenHtml: String(frozenHtml || ""),
        reportedSourceSha256,
        cutoffRevision,
        hashHtml: (html) => this.#hashPort.sha256(html),
        readSource: () => this.#bridgeClient.source(sourcePath, { timeoutMs }),
        isCurrent: () => {
          const current = this.#projectSession.snapshot;
          return Number(current.epoch) === Number(boundaryIdentity.epoch)
            && this.#codecs.sameSourcePath(current.sourcePath, boundaryIdentity.sourcePath)
            && String(current.projectId || "") === String(boundaryIdentity.projectId || "")
            && String(current.documentId || "") === String(boundaryIdentity.documentId || "")
            && Boolean(current.registered) === Boolean(boundaryIdentity.registered);
        },
        acceptsSource: (source) => Boolean(
          this.#codecs.sameSourcePath(
            String(source?.sourcePath || ""),
            boundaryIdentity.sourcePath,
          )
          && Boolean(source?.registered) === Boolean(boundaryIdentity.registered)
          && (
            !boundaryIdentity.registered
              ? !String(source?.projectId || "") && !String(source?.documentId || "")
              : String(source?.projectId || "") === String(boundaryIdentity.projectId || "")
                && String(source?.documentId || "") === String(boundaryIdentity.documentId || "")
          )
        ),
      });
      if (result.ready && result.lastModifiedAt) {
        this.#emit({
          type: "document-boundary-reconciled",
          sourcePath,
          lastModifiedAt: result.lastModifiedAt,
        });
      }
      return result.ready ? succeeded(result) : blocked(result.code, result.reason);
    } catch (cause) {
      return this.#outcomeFromCause(
        this.#nextOperationId("boundary"),
        cause,
        "DOCUMENT_BOUNDARY_REJECTED",
        this.#codecs.errorMessage(cause, "关闭前安全写入检查失败。"),
      );
    }
  }

  async recoverAutosave({ context, currentSourceSha256, serverRevision = 0 } = {}) {
    const activeContext = copyContext(context);
    if (!activeContext) {
      return blocked("DOCUMENT_CONTEXT_REQUIRED", "当前页面尚未完成项目身份初始化。");
    }
    const keys = this.#recoveryKeys(activeContext);
    let raw = null;
    let recoveredKey = "";
    for (const record of this.#recoveryStore.readRecords(keys)) {
      if (this.#codecs.isRecord(record?.value)) {
        raw = record.value;
        recoveredKey = String(record.key || "");
        break;
      }
    }
    if (
      !raw
      || String(raw.sourcePath || "") !== activeContext.sourcePath
      || String(raw.projectId || "") !== activeContext.projectId
      || String(raw.documentId || "") !== activeContext.documentId
      || typeof raw.html !== "string"
      || !/<html(?:\s|>)/iu.test(raw.html)
    ) return succeeded({ recovered: false });

    try {
      const recoveredHtml = raw.html;
      const targetSha256 = await this.#hashPort.sha256(recoveredHtml);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      if (targetSha256 === currentSourceSha256) {
        const reconciledRevision = Math.max(serverRevision, revision(raw.revision));
        this.#documentSession.update({
          editRevision: reconciledRevision,
          lastPersistedRevision: reconciledRevision,
          pendingWrite: null,
          persistState: "idle",
          persistError: "",
        });
        if (recoveredKey) this.#recoveryStore.remove(recoveredKey);
        return succeeded({ recovered: false, reconciled: true });
      }

      const nextRevision = Math.max(serverRevision, revision(raw.revision)) + 1;
      const recoveredEvents = this.#codecs.changesFromRecords(raw.changeEvents);
      const existingIds = new Set(
        this.#commentSession.changeEvents.map((event) => event.eventId),
      );
      const mergedEvents = [
        ...this.#commentSession.changeEvents,
        ...recoveredEvents.filter((event) => !existingIds.has(event.eventId)),
      ];
      const storedIdentity = this.#codecs.recoveryIdentityFromRecord(raw.recoveryIdentity);
      const canRebaseSafely = Boolean(
        identityMatches(storedIdentity, this.#recoveryIdentity, this.#codecs.sameSourcePath)
        && String(raw.expectedSourceSha256 || "") === String(currentSourceSha256 || ""),
      );
      const write = {
        ...activeContext,
        expectedSourceSha256: canRebaseSafely
          ? currentSourceSha256
          : String(raw.expectedSourceSha256 || currentSourceSha256 || ""),
        html: recoveredHtml,
        revision: nextRevision,
        events: recoveredEvents,
        historyOperations: this.#codecs.sourceHistoryOperationsFromRecord(
          raw.sourceHistoryOperations,
        ),
        recoveryIdentity: this.#recoveryIdentity,
      };
      this.#sourceHistorySession.restorePending(activeContext, write.historyOperations);
      this.#auditPending = recoveredEvents;
      this.#commentSession.setChangeEvents(mergedEvents);
      this.#documentSession.publishAuthority({
        html: recoveredHtml,
        sourceSha256: currentSourceSha256,
        editRevision: nextRevision,
        pendingWrite: write,
      });
      this.#versionSession.markSourceEdited();
      this.#canvasPort.invalidateRenderAcks();
      this.#persistRecovery(write, activeContext);

      if (canRebaseSafely) {
        this.#documentSession.setPersistence({ state: "queued", error: "" });
        this.#clearAutosaveTimer();
        this.#autosaveTimer = this.#scheduler.setTimeout(() => {
          void this.flush();
        }, 0);
        this.#emit({ type: "document-recovery-queued", context: activeContext });
        return succeeded({ recovered: true, queued: true });
      }
      await this.#verifyRendered(recoveredHtml, targetSha256, activeContext);
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      const frozen = await this.#freezeAuthority(
        "恢复记录已加载，但编辑画布尚未就绪。",
      );
      if (!frozen.ok) {
        const message = `恢复记录与当前项目、版本或源文件身份不一致。${frozen.reason}`;
        this.#documentSession.setPersistence({ state: "failed", error: message });
        return rejected("DOCUMENT_RECOVERY_BOUNDARY_FAILED", message);
      }
      this.#documentSession.setPersistence({
        state: "conflict",
        error: "恢复记录与当前项目、版本或源文件身份不一致，请比较后选择重新载入或导出当前编辑。",
      });
      return succeeded({ recovered: true, queued: false, conflict: true });
    } catch (cause) {
      if (!this.#isCurrent(activeContext)) return stale(activeContext);
      return this.#outcomeFromCause(
        this.#nextOperationId("recovery"),
        cause,
        "DOCUMENT_RECOVERY_REJECTED",
        this.#codecs.errorMessage(cause, "恢复记录无法安全加载。"),
      );
    }
  }

  adoptConflictCandidate({
    context,
    html,
    authoritativeSourceSha256,
    expectedSourceSha256,
    revision: candidateRevision,
    events = [],
  } = {}) {
    const activeContext = copyContext(context);
    if (!activeContext || !this.#isCurrent(activeContext)) {
      return activeContext ? stale(activeContext) : blocked(
        "DOCUMENT_CONTEXT_REQUIRED",
        "当前页面尚未完成项目身份初始化。",
      );
    }
    const write = {
      ...activeContext,
      expectedSourceSha256: String(expectedSourceSha256 || ""),
      html: String(html || ""),
      revision: Math.max(this.#documentSession.editRevision, revision(candidateRevision)),
      events: Array.isArray(events) ? [...events] : [],
      historyOperations: [],
      recoveryIdentity: this.#recoveryIdentity,
    };
    this.#auditPending = [...write.events];
    this.#documentSession.publishAuthority({
      html: write.html,
      sourceSha256: authoritativeSourceSha256 || null,
      editRevision: write.revision,
      pendingWrite: write,
    });
    this.#versionSession.markSourceEdited();
    this.#canvasPort.invalidateRenderAcks();
    this.#persistRecovery(write, activeContext);
    return succeeded({ write });
  }

  #writeContext(context) {
    const explicit = copyContext(context);
    if (explicit) return explicit;
    const active = copyContext(this.#projectSession.context);
    if (active) return active;
    return Object.freeze({
      epoch: this.#projectSession.epoch,
      projectId: this.#projectSession.projectId,
      documentId: this.#projectSession.documentId,
      sourcePath: String(this.#projectSession.sourcePath || ""),
    });
  }

  #isCurrent(context) {
    const normalized = copyContext(context);
    if (!normalized || this.#disposed) return false;
    if (normalized.projectId && normalized.documentId) {
      return this.#projectSession.matches(normalized);
    }
    return Number(this.#projectSession.epoch) === normalized.epoch
      && this.#codecs.sameSourcePath(
        this.#projectSession.sourcePath,
        normalized.sourcePath,
      );
  }

  #nextOperationId(kind) {
    this.#operationSequence += 1;
    return [
      String(kind),
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#operationSequence.toString(36),
    ].join("_");
  }

  #emit(event) {
    const frozen = Object.freeze(event);
    for (const listener of this.#listeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation observers cannot affect document authority.
      }
    }
  }

  #clearAutosaveTimer() {
    if (this.#autosaveTimer !== null) {
      this.#scheduler.clearTimeout(this.#autosaveTimer);
      this.#autosaveTimer = null;
    }
  }

  #scheduleAutosave({ immediate = false } = {}) {
    this.#clearAutosaveTimer();
    if (immediate) {
      void this.flush();
      return;
    }
    this.#autosaveTimer = this.#scheduler.setTimeout(() => {
      this.#autosaveTimer = null;
      void this.flush();
    }, AUTOSAVE_DELAY_MS);
  }

  #createWrite(context, html, nextRevision) {
    return {
      ...context,
      expectedSourceSha256: this.#documentSession.sourceSha256,
      html: String(html),
      revision: revision(nextRevision),
      events: [...this.#auditPending],
      historyOperations: this.#sourceHistorySession.pendingOperations,
      recoveryIdentity: this.#recoveryIdentity,
    };
  }

  #reconstructPendingWrite() {
    if (
      this.#documentSession.pendingWrite
      || !this.#projectSession.sourcePath
      || this.#documentSession.editRevision <= this.#documentSession.lastPersistedRevision
    ) return;
    const write = this.#createWrite(
      this.#writeContext(),
      this.#documentSession.html,
      this.#documentSession.editRevision,
    );
    this.#documentSession.setPendingWrite(write);
    this.#persistRecovery(write, write);
    this.#documentSession.setPersistence({ state: "queued", error: "" });
  }

  #recoveryKeys(context = {}) {
    const documentId = String(context?.documentId || this.#projectSession.documentId || "");
    const sourcePath = String(context?.sourcePath || this.#projectSession.sourcePath || "");
    return [
      documentId ? `html-ai-recovery:${documentId}` : "",
      sourcePath ? `html-ai-recovery:${sourcePath}` : "",
    ].filter(Boolean);
  }

  #persistRecovery(write, context) {
    const keys = this.#recoveryKeys(write || context);
    if (keys.length === 0) return false;
    if (!write) return this.#recoveryStore.remove(keys);
    return this.#recoveryStore.write(keys, {
      schemaVersion: "2.0.0",
      projectId: write.projectId,
      documentId: write.documentId,
      sourcePath: write.sourcePath,
      recoveryIdentity: write.recoveryIdentity,
      expectedSourceSha256: write.expectedSourceSha256,
      revision: write.revision,
      html: write.html,
      changeEvents: write.events.map(this.#codecs.persistedChangeEvent),
      sourceHistoryOperations: write.historyOperations,
    });
  }

  async #runFlush(cutoff) {
    while (this.#documentSession.pendingWrite) {
      const pendingWrite = this.#documentSession.takePendingWrite();
      if (!pendingWrite) break;
      let write = pendingWrite;
      if (!write.sourcePath) {
        this.#documentSession.setPendingWrite(write);
        return blocked("DOCUMENT_SOURCE_UNBOUND", "当前编辑尚未绑定本地 HTML，无法写回源文件。");
      }
      const operationId = this.#nextOperationId("autosave");
      const inFlightKeys = write.events.map(this.#codecs.auditEventKey);
      for (const key of inFlightKeys) this.#auditInFlight.add(key);
      let writeContext = copyContext(write);
      try {
        if (this.#isCurrent(writeContext)) {
          this.#documentSession.setPersistence({ state: "writing", error: "" });
        }
        if (!write.projectId || !write.documentId) {
          const registration = await this.#ensureRegistered({
            sourcePath: write.sourcePath,
            expectedSourceSha256: write.expectedSourceSha256,
            adoptCanonicalSource: false,
          });
          if (!registration || registration.status !== "succeeded") {
            return this.#settleRegistrationFailure({
              registration,
              write,
              writeContext,
            });
          }
          write = {
            ...write,
            ...registration.value,
            expectedSourceSha256: this.#documentSession.sourceSha256,
          };
          writeContext = registration.value;
          this.#updateQueuedWriteAfterRegistration(write);
          // Registration changes recovery identity before the durable write.
          // Persist that transition now so a crash in the subsequent POST has
          // a record the next registered workspace can safely resume.
          this.#persistRecovery(write, writeContext);
        }
        if (!this.#isCurrent(writeContext)) {
          this.#restoreWriteAfterFailure(write, writeContext);
          return stale(writeContext);
        }
        const payload = await this.#bridgeClient.autosave({
          projectId: write.projectId,
          documentId: write.documentId,
          sourcePath: write.sourcePath,
          html: write.html,
          expectedSourceSha256: write.expectedSourceSha256,
          editRevision: write.revision,
          changeEvents: write.events.map(this.#codecs.persistedChangeEvent),
          sourceHistoryOperations: write.historyOperations,
          projectRootPath: write.projectRootPath,
          targetKind: write.targetKind,
          workingCopyId: write.workingCopyId,
          versionId: write.versionId,
          exactSourcePath: write.exactSourcePath,
          sourceSha256: write.sourceSha256,
          sessionEpoch: write.sessionEpoch,
        });
        await this.#validateAutosaveAck(payload, write);
        const sourceSha256 = String(payload.sha256 || payload.currentHtmlSha256 || "");
        const persistedRevision = revision(payload.persistedRevision);
        if (!this.#sourceHistorySession.acknowledge(
          writeContext,
          write.historyOperations,
          payload.sourceHistory,
          sourceSha256,
        )) {
          this.#sourceHistorySession.activate(
            writeContext,
            sourceSha256,
            payload.sourceHistory,
          );
        }
        const acknowledgedContext = this.#acknowledgeWrite({
          write,
          writeContext,
          payload,
          sourceSha256,
          persistedRevision,
        });
        if (!this.#isCurrent(acknowledgedContext)) return stale(acknowledgedContext);
      } catch (cause) {
        return await this.#handleFlushFailure({
          cause,
          operationId,
          write,
          writeContext,
        });
      } finally {
        for (const key of inFlightKeys) this.#auditInFlight.delete(key);
      }
    }
    if (
      cutoff !== undefined
      && this.#documentSession.lastPersistedRevision < cutoff
    ) {
      return blocked(
        "DOCUMENT_FLUSH_CUTOFF_UNREACHED",
        "当前编辑尚未安全写入源 HTML。",
      );
    }
    return succeeded({ revision: this.#documentSession.lastPersistedRevision });
  }

  async #validateAutosaveAck(payload, write) {
    if (!this.#codecs.isRecord(payload) || payload.ok === false) {
      throw invalidAcknowledgement("无法把修改更新到源 HTML。", "INVALID_AUTOSAVE_ACK");
    }
    const hasExactHtml = typeof payload.content === "string" && payload.content === write.html;
    const declaredHash = String(payload.sha256 || payload.currentHtmlSha256 || "");
    const persistedRevision = Number(payload.persistedRevision);
    const persistedAt = String(payload.lastModifiedAt || "");
    const actualHash = hasExactHtml
      ? await this.#hashPort.sha256(write.html)
      : "";
    if (
      !hasExactHtml
      || !SHA256.test(declaredHash)
      || actualHash !== declaredHash
      || !Number.isSafeInteger(persistedRevision)
      || persistedRevision < write.revision
      || !persistedAt
      || (payload.skipped === true && declaredHash !== actualHash)
      || !this.#codecs.isRecord(payload.sourceHistory)
    ) {
      throw invalidAcknowledgement(
        "自动写回的确认内容与本次提交的原始字节不一致。",
        "INVALID_AUTOSAVE_ACK",
      );
    }
  }

  #acknowledgeWrite({ write, writeContext, payload, sourceSha256, persistedRevision }) {
    const queued = this.#documentSession.pendingWrite;
    let nextWrite = null;
    if (queued && sameContext(queued, write, this.#codecs.sameSourcePath)) {
      nextWrite = {
        ...queued,
        expectedSourceSha256: sourceSha256,
        recoveryIdentity: this.#codecs.recoveryIdentityFromRecord(payload.recoveryIdentity)
          || queued.recoveryIdentity,
        events: this.#codecs.removeAcknowledgedAuditEvents(queued.events, write.events),
        historyOperations: this.#sourceHistorySession.pendingOperations,
      };
    }
    if (!this.#isCurrent(writeContext)) {
      if (nextWrite) {
        this.#documentSession.setPendingWrite(nextWrite);
        this.#persistRecovery(nextWrite, writeContext);
      } else {
        this.#persistRecovery(null, writeContext);
      }
      return writeContext;
    }
    this.#recoveryIdentity = this.#codecs.recoveryIdentityFromRecord(payload.recoveryIdentity)
      || this.#recoveryIdentity;
    const writeCompletesCurrentDocument = Boolean(
      this.#documentSession.editRevision === write.revision
      && !this.#documentSession.pendingWrite,
    );
    const acknowledgedHtml = String(payload.content);
    this.#documentSession.update(writeCompletesCurrentDocument
      ? {
          html: acknowledgedHtml,
          sourceSha256,
          lastPersistedRevision: Math.max(
            this.#documentSession.lastPersistedRevision,
            persistedRevision,
          ),
        }
      : {
          sourceSha256,
          lastPersistedRevision: Math.max(
            this.#documentSession.lastPersistedRevision,
            persistedRevision,
          ),
        });
    if (writeCompletesCurrentDocument) {
      this.#rebindTargets(acknowledgedHtml);
      this.#versionSession.updateAuthority({
        currentExactVersionId: payload.currentExactVersionId,
      });
    }
    const rebound = this.#reconcileOpenTargetAfterAutosave({
      writeContext,
      payload,
      sourceSha256,
    });
    const acknowledgedContext = rebound.context;
    if (rebound.routingChanged) {
      const pendingHistory = this.#sourceHistorySession.pendingOperations;
      this.#sourceHistorySession.activate(
        acknowledgedContext,
        sourceSha256,
        payload.sourceHistory,
      );
      this.#sourceHistorySession.restorePending(
        acknowledgedContext,
        pendingHistory,
      );
    }
    if (nextWrite && rebound.targetRefreshed) {
      nextWrite = {
        ...nextWrite,
        epoch: acknowledgedContext.epoch,
        projectId: acknowledgedContext.projectId,
        documentId: acknowledgedContext.documentId,
        sourcePath: acknowledgedContext.sourcePath,
        projectRootPath: acknowledgedContext.projectRootPath,
        targetKind: acknowledgedContext.targetKind,
        workingCopyId: acknowledgedContext.workingCopyId,
        versionId: acknowledgedContext.versionId,
        exactSourcePath: acknowledgedContext.exactSourcePath,
        sourceSha256: acknowledgedContext.sourceSha256,
        sessionEpoch: acknowledgedContext.sessionEpoch,
        expectedSourceSha256: sourceSha256,
        historyOperations: this.#sourceHistorySession.pendingOperations,
      };
    }
    if (nextWrite) {
      this.#documentSession.setPendingWrite(nextWrite);
      this.#persistRecovery(nextWrite, acknowledgedContext);
      if (
        rebound.routingChanged
        && !this.#codecs.sameSourcePath(
          writeContext.sourcePath,
          acknowledgedContext.sourcePath,
        )
      ) {
        this.#recoveryStore.remove(`html-ai-recovery:${writeContext.sourcePath}`);
      }
    } else {
      this.#persistRecovery(null, writeContext);
      if (rebound.routingChanged) this.#persistRecovery(null, acknowledgedContext);
    }
    this.#auditPending = this.#codecs.removeAcknowledgedAuditEvents(
      this.#auditPending,
      write.events,
    );
    if (!this.#documentSession.pendingWrite) {
      this.#documentSession.setPersistence({ state: "idle", error: "" });
    }
    if (rebound.routingChanged) {
      this.#emit({
        type: "document-open-target-rebound",
        context: acknowledgedContext,
        previousContext: writeContext,
        activeDraft: this.#codecs.isRecord(payload.activeDraft)
          ? payload.activeDraft
          : null,
      });
    }
    this.#emit({
      type: "document-persisted",
      context: acknowledgedContext,
      revision: persistedRevision,
      sourceSha256,
      lastModifiedAt: String(payload.lastModifiedAt || ""),
    });
    return acknowledgedContext;
  }

  #reconcileOpenTargetAfterAutosave({ writeContext, payload, sourceSha256 }) {
    const rawTarget = this.#codecs.isRecord(payload?.openTarget)
      ? payload.openTarget
      : null;
    if (!rawTarget) {
      return {
        context: writeContext,
        routingChanged: false,
        targetRefreshed: false,
      };
    }
    if (
      String(rawTarget.projectId || "") !== writeContext.projectId
      || String(rawTarget.documentId || "") !== writeContext.documentId
      || !String(rawTarget.projectRootPath || "")
      || !String(rawTarget.targetKind || "")
    ) {
      return {
        context: writeContext,
        routingChanged: false,
        targetRefreshed: false,
      };
    }
    const target = {
      ...rawTarget,
      projectId: writeContext.projectId,
      documentId: writeContext.documentId,
      exactSourcePath: String(
        rawTarget.exactSourcePath || payload.sourcePath || "",
      ),
      sourceSha256,
    };
    if (!target.exactSourcePath) {
      return {
        context: writeContext,
        routingChanged: false,
        targetRefreshed: false,
      };
    }
    const next = this.#codecs.sameSourcePath(
      target.exactSourcePath,
      writeContext.sourcePath,
    )
      ? this.#projectSession.refreshOpenTarget?.(target)
      : this.#projectSession.adoptOpenTarget({
          previousSourcePath: writeContext.sourcePath,
          target,
        });
    const context = copyContext(next);
    if (!context || !this.#isCurrent(context)) {
      return {
        context: writeContext,
        routingChanged: false,
        targetRefreshed: false,
      };
    }
    return {
      context,
      routingChanged: !sameOpenRoute(
        writeContext,
        context,
        this.#codecs.sameSourcePath,
      ),
      targetRefreshed: !sameOpenTarget(
        writeContext,
        context,
        this.#codecs.sameSourcePath,
      ),
    };
  }

  #updateQueuedWriteAfterRegistration(write) {
    const queued = this.#documentSession.pendingWrite;
    if (!queued || !this.#codecs.sameSourcePath(queued.sourcePath, write.sourcePath)) return;
    this.#documentSession.setPendingWrite({
      ...queued,
      projectId: write.projectId,
      documentId: write.documentId,
      projectRootPath: write.projectRootPath,
      targetKind: write.targetKind,
      workingCopyId: write.workingCopyId,
      versionId: write.versionId,
      exactSourcePath: write.exactSourcePath,
      sourceSha256: write.sourceSha256,
      sessionEpoch: write.sessionEpoch,
      expectedSourceSha256: write.expectedSourceSha256,
    });
  }

  #restoreWriteAfterFailure(write, context) {
    const pending = this.#documentSession.pendingWrite;
    const recoveryWrite = pending
      && sameContext(pending, write, this.#codecs.sameSourcePath)
      && pending.revision > write.revision
      ? pending
      : write;
    if (
      this.#isCurrent(context)
      && (!pending || pending.revision < recoveryWrite.revision)
    ) {
      this.#documentSession.setPendingWrite(recoveryWrite);
    }
    this.#persistRecovery(recoveryWrite, context);
    return recoveryWrite;
  }

  #settleRegistrationFailure({ registration, write, writeContext }) {
    const outcome = registration || blocked(
      "PROJECT_REGISTRATION_UNAVAILABLE",
      "项目资料暂时无法建立，修改已保留在恢复记录中。",
    );
    const message = String(
      outcome.reason || "项目资料暂时无法建立，修改已保留在恢复记录中。",
    );
    const code = outcome.status === "unknown"
      ? "PROJECT_REGISTRATION_UNKNOWN"
      : String(outcome.code || "PROJECT_REGISTRATION_UNAVAILABLE");
    const recoveryWrite = this.#restoreWriteAfterFailure(write, writeContext);
    if (outcome.status !== "stale" && this.#isCurrent(writeContext)) {
      this.#documentSession.setPersistence({ state: "failed", error: message });
      this.#emit({
        type: "document-persistence-failed",
        context: writeContext,
        code,
        message,
        conflict: false,
        protocolError: false,
        recoveryWrite,
        fatal: false,
      });
    }
    return outcome;
  }

  async #handleFlushFailure({ cause, operationId, write, writeContext }) {
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      const reconciliation = await this.#reconcileUnknownAutosave({
        write,
        writeContext,
      });
      if (reconciliation) return reconciliation;
    }
    const message = this.#codecs.errorMessage(
      cause,
      "当前修改还没有写入源 HTML，请重试或导出当前编辑。",
    );
    const code = sourceErrorCode(cause, "DOCUMENT_AUTOSAVE_REJECTED");
    const conflict = (
      code === "SOURCE_CHANGED"
      || code === "SOURCE_HASH_CONFLICT"
      || code === "WORKING_COPY_CONFLICT"
      || String(cause?.message || "").includes("SOURCE_CHANGED")
    );
    const protocolError = code === "INVALID_AUTOSAVE_ACK" || cause?.code === "INVALID_AUTOSAVE_ACK";
    const recoveryWrite = this.#restoreWriteAfterFailure(write, writeContext);
    if (this.#isCurrent(writeContext)) {
      let boundaryFailure = "";
      if (conflict || protocolError) {
        this.#clearAutosaveTimer();
        const frozen = await this.#freezeAuthority(
          "编辑画布尚未就绪，已停止接受这次外部源码状态。",
        );
        if (!frozen.ok) boundaryFailure = frozen.reason;
      }
      const visibleMessage = boundaryFailure ? `${message} ${boundaryFailure}` : message;
      this.#documentSession.setPersistence({
        state: conflict ? "conflict" : "failed",
        error: visibleMessage,
      });
      this.#emit({
        type: "document-persistence-failed",
        context: writeContext,
        code,
        message: visibleMessage,
        conflict,
        protocolError,
        recoveryWrite,
        fatal: Boolean(boundaryFailure || protocolError),
      });
    }
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      return unknown(operationId, message);
    }
    return rejected(code, message);
  }

  async #reconcileUnknownAutosave({ write, writeContext }) {
    try {
      const authority = await this.#bridgeClient.workspace(write.sourcePath);
      if (!this.#isCurrent(writeContext)) return stale(writeContext);
      const runtime = this.#codecs.isRecord(authority.runtimeState)
        ? authority.runtimeState
        : {};
      const edit = this.#codecs.isRecord(runtime.edit) ? runtime.edit : {};
      const persistedRevision = revision(
        runtime.lastPersistedRevision
        || edit.lastPersistedRevision
        || authority.lastPersistedRevision,
      );
      const sourceSha256 = String(
        authority.currentHtmlSha256 || authority.sourceSha256 || "",
      );
      if (
        String(authority.projectId || "") !== writeContext.projectId
        || String(authority.documentId || "") !== writeContext.documentId
        || !this.#codecs.sameSourcePath(authority.sourcePath, writeContext.sourcePath)
        || !SHA256.test(sourceSha256)
        || persistedRevision < write.revision
        || !this.#codecs.isRecord(authority.sourceHistory)
      ) return null;
      const source = await this.#bridgeClient.source(write.sourcePath);
      if (!this.#isCurrent(writeContext)) return stale(writeContext);
      this.#assertSourcePayload(
        source,
        writeContext,
        "自动写回结果未知，读取到的源文件身份发生变化。",
      );
      const content = typeof source.content === "string" ? source.content : "";
      const declaredHash = String(source.sha256 || "");
      if (
        content !== write.html
        || declaredHash !== sourceSha256
        || await this.#hashPort.sha256(content) !== declaredHash
      ) return null;
      const payload = {
        content,
        sha256: sourceSha256,
        persistedRevision,
        lastModifiedAt: String(
          source.lastModifiedAt || authority.lastModifiedAt || "",
        ),
        sourceHistory: authority.sourceHistory,
        recoveryIdentity: authority.recoveryIdentity,
        currentExactVersionId: source.currentExactVersionId
          || authority.currentExactVersionId,
      };
      if (!payload.lastModifiedAt) return null;
      if (!this.#sourceHistorySession.acknowledge(
        writeContext,
        write.historyOperations,
        authority.sourceHistory,
        sourceSha256,
      )) {
        this.#sourceHistorySession.activate(
          writeContext,
          sourceSha256,
          authority.sourceHistory,
        );
      }
      this.#acknowledgeWrite({
        write,
        writeContext,
        payload,
        sourceSha256,
        persistedRevision,
      });
      return this.#isCurrent(writeContext)
        ? succeeded({ revision: persistedRevision, reconciled: true })
        : stale(writeContext);
    } catch {
      // An unknown mutation is never replayed merely because its proof query
      // failed.  The retained recovery record remains the next safe action.
      return null;
    }
  }

  #rebindTargets(html) {
    const targets = [
      ...this.#commentSession.comments.map((comment) => comment.target),
      ...this.#commentSession.changeEvents.map((event) => event.target),
      ...(this.#commentSession.composerTarget ? [this.#commentSession.composerTarget] : []),
    ];
    const rebound = this.#codecs.rebindTargetsPreservingGlobal(html, targets);
    const byId = new Map(rebound.map((target) => [target.id, target]));
    this.#commentSession.update({
      comments: this.#commentSession.comments.map((comment) => ({
        ...comment,
        target: byId.get(comment.target.id) || comment.target,
      })),
      changeEvents: this.#commentSession.changeEvents.map((event) => ({
        ...event,
        target: byId.get(event.target.id) || event.target,
      })),
    });
    if (this.#commentSession.composerTarget) {
      this.#commentSession.setComposerTarget(
        byId.get(this.#commentSession.composerTarget.id)
        || this.#commentSession.composerTarget,
      );
    }
  }

  async #runHistoryAction({ direction, context }) {
    const operationId = this.#nextOperationId("history");
    if (!context || !this.#isCurrent(context)) {
      return context ? stale(context) : blocked(
        "DOCUMENT_CONTEXT_REQUIRED",
        "当前页面尚未完成项目身份初始化。",
      );
    }
    const flush = await this.flush({ throughRevision: this.#documentSession.editRevision });
    if (!flush || flush.status !== "succeeded") return flush;
    if (!this.#isCurrent(context)) return stale(context);
    const action = this.#sourceHistorySession.createAction(context, direction);
    if (!action) {
      return blocked(
        "SOURCE_HISTORY_ACTION_UNAVAILABLE",
        "当前源码历史尚未完成写入，暂时不能撤销或重做。",
      );
    }
    this.#documentSession.setPersistence({ state: "writing", error: "" });
    try {
      const request = { ...context, ...action };
      let payload;
      try {
        payload = await this.#bridgeClient.sourceHistoryAction(request);
      } catch (cause) {
        if (
          !isBridgeRequestError(cause)
          || (cause.outcome !== "unknown" && cause.status < 500)
        ) throw cause;
        const authority = await this.#bridgeClient.workspace(context.sourcePath);
        const history = this.#codecs.isRecord(authority.sourceHistory)
          ? authority.sourceHistory
          : null;
        const capabilities = this.#codecs.isRecord(history?.capabilities)
          ? history.capabilities
          : null;
        const actionApplied = Array.isArray(history?.appliedActions)
          && history.appliedActions.some((entry) => (
            this.#codecs.isRecord(entry) && entry.actionId === action.actionId
          ));
        const actionStillEligible = (
          String(authority.projectId || "") === context.projectId
          && String(authority.documentId || "") === context.documentId
          && this.#codecs.sameSourcePath(authority.sourcePath, context.sourcePath)
          && String(authority.currentHtmlSha256 || "") === action.expectedSourceSha256
          && Number(capabilities?.revision) === action.expectedHistoryRevision
          && Number(capabilities?.cursor) === action.expectedHistoryCursor
        );
        if (!this.#isCurrent(context) || (!actionApplied && !actionStillEligible)) {
          throw invalidAcknowledgement(
            "无法确认上一次撤销或重做的结果，已停止重复操作。",
            "SOURCE_HISTORY_RECONCILIATION_CONFLICT",
          );
        }
        // The Bridge binds replay to actionId.  Authority either proves the
        // original action or proves its preconditions still hold.
        payload = await this.#bridgeClient.sourceHistoryAction(request);
      }
      const canonicalHtml = typeof payload.content === "string" ? payload.content : "";
      const sourceSha256 = String(
        payload.sha256 || payload.sourceSha256 || payload.currentHtmlSha256 || "",
      );
      const persistedRevision = Number(payload.persistedRevision || payload.lastPersistedRevision);
      if (
        !canonicalHtml
        || !SHA256.test(sourceSha256)
        || await this.#hashPort.sha256(canonicalHtml) !== sourceSha256
        || !Number.isSafeInteger(persistedRevision)
        || persistedRevision < this.#documentSession.lastPersistedRevision
        || !this.#codecs.isRecord(payload.sourceHistory)
      ) {
        throw invalidAcknowledgement(
          "撤销结果与持久化源码历史不一致。",
          "INVALID_SOURCE_HISTORY_ACK",
        );
      }
      if (!this.#isCurrent(context)) return stale(context);
      if (!this.#sourceHistorySession.replaceAuthority(
        context,
        payload.sourceHistory,
        sourceSha256,
      )) {
        this.#sourceHistorySession.activate(context, sourceSha256, payload.sourceHistory);
      }
      this.#adoptHistoryAuthority({ context, payload, canonicalHtml, sourceSha256, persistedRevision });
      return succeeded({
        direction,
        sourceSha256,
        persistedRevision,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      });
    } catch (cause) {
      if (!this.#isCurrent(context)) return stale(context);
      const message = this.#codecs.errorMessage(
        cause,
        direction === "undo"
          ? "这次撤销没有完成，源 HTML 保持不变。"
          : "这次重做没有完成，源 HTML 保持不变。",
      );
      this.#documentSession.setPersistence({ state: "failed", error: message });
      this.#emit({
        type: "document-history-failed",
        context,
        direction,
        message,
      });
      return this.#outcomeFromCause(
        operationId,
        cause,
        "SOURCE_HISTORY_ACTION_REJECTED",
        message,
      );
    }
  }

  #adoptHistoryAuthority({ context, payload, canonicalHtml, sourceSha256, persistedRevision }) {
    const rawTarget = this.#codecs.isRecord(payload.target)
      ? this.#codecs.selectionFromRecord(payload.target)
      : null;
    const rawTransition = this.#codecs.isRecord(payload.targetTransition)
      ? payload.targetTransition
      : null;
    const transition = {
      fromTarget: this.#codecs.isRecord(rawTransition?.fromTarget)
        ? this.#codecs.selectionFromRecord(rawTransition.fromTarget)
        : null,
      toTarget: this.#codecs.isRecord(rawTransition?.toTarget)
        ? this.#codecs.selectionFromRecord(rawTransition.toTarget)
        : null,
    };
    const targets = [
      ...this.#commentSession.comments.map((comment) => comment.target),
      ...this.#commentSession.changeEvents.map((event) => event.target),
      ...(this.#commentSession.composerTarget ? [this.#commentSession.composerTarget] : []),
      ...(rawTarget ? [rawTarget] : []),
    ];
    const rebound = transition.fromTarget && transition.toTarget
      ? this.#codecs.rebindTargetsAcrossHistoryPreservingGlobal(
          this.#documentSession.html,
          canonicalHtml,
          targets,
          transition,
        )
      : this.#codecs.rebindTargetsPreservingGlobal(canonicalHtml, targets);
    const byId = new Map(rebound.map((target) => [target.id, target]));
    this.#commentSession.update({
      comments: this.#commentSession.comments.map((comment) => ({
        ...comment,
        target: byId.get(comment.target.id) || {
          ...comment.target,
          resolution: "orphaned",
        },
      })),
      changeEvents: this.#commentSession.changeEvents.map((event) => ({
        ...event,
        target: byId.get(event.target.id) || {
          ...event.target,
          resolution: "orphaned",
        },
      })),
    });
    if (this.#commentSession.composerTarget) {
      this.#commentSession.setComposerTarget(
        byId.get(this.#commentSession.composerTarget.id) || {
          ...this.#commentSession.composerTarget,
          resolution: "orphaned",
        },
      );
    }
    const historyTarget = rawTarget ? byId.get(rawTarget.id) || rawTarget : null;
    this.#canvasPort.adoptHistorySource?.(
      canonicalHtml,
      historyTarget,
      this.#codecs.historyTextSelectionFromRecord(payload.selection),
    );
    this.#recoveryIdentity = this.#codecs.recoveryIdentityFromRecord(payload.recoveryIdentity)
      || this.#recoveryIdentity;
    this.#documentSession.update({
      html: canonicalHtml,
      sourceSha256,
      editRevision: Math.max(this.#documentSession.editRevision, persistedRevision),
      lastPersistedRevision: Math.max(
        this.#documentSession.lastPersistedRevision,
        persistedRevision,
      ),
      pendingWrite: null,
      persistState: "idle",
      persistError: "",
    });
    this.#versionSession.updateAuthority({
      currentExactVersionId: payload.currentExactVersionId,
    });
    this.#canvasPort.invalidateRenderAcks();
    this.#persistRecovery(null, context);
    this.#emit({
      type: "document-history-applied",
      context,
      lastModifiedAt: String(payload.lastModifiedAt || ""),
    });
  }

  #assertSourcePayload(payload, context, message) {
    if (
      !this.#codecs.isRecord(payload)
      || String(payload.projectId || "") !== context.projectId
      || String(payload.documentId || "") !== context.documentId
      || (
        payload.sourcePath
        && !this.#codecs.sameSourcePath(payload.sourcePath, context.sourcePath)
      )
    ) throw invalidAcknowledgement(message, "SOURCE_IDENTITY_MISMATCH");
  }

  async #verifyRendered(html, sourceSha256, context) {
    if (typeof this.#canvasPort.verifyRendered !== "function") return;
    await this.#canvasPort.verifyRendered(html, sourceSha256, context);
  }

  async #freezeAuthority(reason) {
    if (typeof this.#canvasPort.freeze !== "function") {
      return { ok: true, reason: "" };
    }
    try {
      const result = await this.#canvasPort.freeze(reason);
      return result && result.ok
        ? { ok: true, reason: "" }
        : { ok: false, reason: String(result?.reason || reason) };
    } catch (cause) {
      return {
        ok: false,
        reason: this.#codecs.errorMessage(cause, reason),
      };
    }
  }

  #outcomeFromCause(operationId, cause, fallbackCode, fallbackMessage) {
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      return unknown(operationId, fallbackMessage);
    }
    return rejected(sourceErrorCode(cause, fallbackCode), fallbackMessage);
  }
}
