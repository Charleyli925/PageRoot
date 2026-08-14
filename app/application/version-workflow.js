import { isBridgeRequestError } from "./bridge-client.js";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;

function succeeded(value) {
  return Object.freeze({ status: "succeeded", value: Object.freeze(value) });
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
  return Object.freeze({ status: "stale", identity: Object.freeze({ ...identity }) });
}

function errorCode(cause, fallback) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  if (cause && typeof cause === "object" && cause.code) return String(cause.code);
  return fallback;
}

function copyContext(context) {
  if (
    !context
    || !Number.isSafeInteger(Number(context.epoch))
    || !String(context.projectId || "")
    || !String(context.documentId || "")
    || !String(context.sourcePath || "")
  ) return null;
  const target = context.projectRootPath && context.targetKind
    ? {
      projectRootPath: String(context.projectRootPath),
      targetKind: String(context.targetKind),
      workingCopyId: context.workingCopyId ? String(context.workingCopyId) : null,
      versionId: context.versionId ? String(context.versionId) : null,
      exactSourcePath: String(context.exactSourcePath || context.sourcePath),
      sourceSha256: String(context.sourceSha256 || ""),
      sessionEpoch: Number(context.sessionEpoch ?? context.epoch),
    }
    : {};
  return Object.freeze({
    epoch: Number(context.epoch),
    projectId: String(context.projectId),
    documentId: String(context.documentId),
    sourcePath: String(context.sourcePath),
    ...target,
  });
}

function validTimestamp(value) {
  return Boolean(value) && !Number.isNaN(Date.parse(String(value)));
}

function sameRun(left, right, sameSourcePath) {
  return Boolean(
    left
    && right
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.requestId === right.requestId
    && left.attemptId === right.attemptId
    && sameSourcePath(left.sourcePath, right.sourcePath),
  );
}

function initialSnapshot() {
  return Object.freeze({
    navigation: Object.freeze({
      phase: "idle",
      operationId: null,
      generation: 0,
    }),
    review: Object.freeze({
      phase: "idle",
      operationId: null,
    }),
  });
}

function emptyDraftAuthority() {
  return Object.freeze({
    draftRevision: 0,
    comments: Object.freeze([]),
    changeEvents: Object.freeze([]),
    deletedCommentIds: Object.freeze([]),
    appliedOperationIds: Object.freeze([]),
  });
}

// VersionWorkflow is the PR-6 application boundary. It owns only operation
// identity, Bridge reads/mutations and cross-Session publication sequencing.
// VersionSession remains the immutable Version projection, and Workbench keeps
// review layout, animation and all other presentation state.
export class VersionWorkflow {
  #bridgeClient;
  #projectSession;
  #documentSession;
  #versionSession;
  #runSession;
  #projectWorkflow;
  #documentWorkflow;
  #commentWorkflow;
  #commentSession;
  #draftSession;
  #codecs;
  #hashPort;
  #canvasPort;
  #clock;
  #snapshot = initialSnapshot();
  #listeners = new Set();
  #eventListeners = new Set();
  #operationSequence = 0;
  #navigationGeneration = 0;
  #reviewGeneration = 0;
  #disposed = false;

  constructor({
    bridgeClient,
    projectSession,
    documentSession,
    versionSession,
    runSession,
    projectWorkflow,
    documentWorkflow,
    commentWorkflow,
    commentSession,
    draftSession,
    codecs,
    ports = {},
    clock,
  } = {}) {
    if (
      !bridgeClient
      || typeof bridgeClient.versionFile !== "function"
      || typeof bridgeClient.source !== "function"
      || typeof bridgeClient.activateReadyVersion !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires its Version Bridge methods.");
    }
    if (!projectSession || typeof projectSession.matches !== "function") {
      throw new TypeError("VersionWorkflow requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.publishAuthority !== "function") {
      throw new TypeError("VersionWorkflow requires DocumentSession injection.");
    }
    if (
      !versionSession
      || typeof versionSession.captureSnapshot !== "function"
      || typeof versionSession.restoreSnapshot !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires VersionSession snapshot authority.");
    }
    if (
      !runSession
      || typeof runSession.beginOperation !== "function"
      || typeof runSession.endOperation !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires RunSession injection.");
    }
    if (
      !projectWorkflow
      || typeof projectWorkflow.prepareGeneratedSourceTransition !== "function"
      || typeof projectWorkflow.commitGeneratedSourceTransition !== "function"
      || typeof projectWorkflow.drain !== "function"
      || typeof projectWorkflow.refreshWorkspace !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires ProjectWorkflow publication authority.");
    }
    if (
      !documentWorkflow
      || typeof documentWorkflow.clearRecovery !== "function"
      || typeof documentWorkflow.clearAudit !== "function"
    ) {
      throw new TypeError("VersionWorkflow requires DocumentWorkflow composition.");
    }
    if (!commentWorkflow || typeof commentWorkflow.resetForProjectTransition !== "function") {
      throw new TypeError("VersionWorkflow requires CommentWorkflow composition.");
    }
    if (!commentSession || typeof commentSession.reset !== "function") {
      throw new TypeError("VersionWorkflow requires CommentSession injection.");
    }
    if (!draftSession || typeof draftSession.replaceAuthority !== "function") {
      throw new TypeError("VersionWorkflow requires DraftSession injection.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("VersionWorkflow requires a HashPort.");
    }
    if (!ports.canvas || typeof ports.canvas.freeze !== "function") {
      throw new TypeError("VersionWorkflow requires a CanvasAuthorityPort.");
    }
    if (typeof ports.canvas.verifyRendered !== "function") {
      throw new TypeError("VersionWorkflow CanvasAuthorityPort must verify rendered bytes.");
    }
    if (typeof ports.canvas.invalidateRenderAcks !== "function") {
      throw new TypeError("VersionWorkflow CanvasAuthorityPort must invalidate render acknowledgements.");
    }
    if (typeof ports.canvas.unlock !== "function") {
      throw new TypeError("VersionWorkflow CanvasAuthorityPort must unlock the Canvas.");
    }
    for (const method of [
      "isRecord",
      "sameSourcePath",
      "operationKey",
      "errorMessage",
    ]) {
      if (typeof codecs?.[method] !== "function") {
        throw new TypeError(`VersionWorkflow codec ${method} is required.`);
      }
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("VersionWorkflow requires a ClockPort.");
    }

    this.#bridgeClient = bridgeClient;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#versionSession = versionSession;
    this.#runSession = runSession;
    this.#projectWorkflow = projectWorkflow;
    this.#documentWorkflow = documentWorkflow;
    this.#commentWorkflow = commentWorkflow;
    this.#commentSession = commentSession;
    this.#draftSession = draftSession;
    this.#codecs = codecs;
    this.#hashPort = ports.hash;
    this.#canvasPort = {
      deferCommand: ports.canvas.deferCommand || null,
      fencePendingEdit: ports.canvas.fencePendingEdit || (() => ({ ok: true })),
      freeze: ports.canvas.freeze,
      verifyRendered: ports.canvas.verifyRendered,
      invalidateRenderAcks: ports.canvas.invalidateRenderAcks,
      unlock: ports.canvas.unlock,
      requestFrame: ports.canvas.requestFrame || null,
      onNavigationChange: ports.canvas.onNavigationChange || (() => {}),
    };
    this.#clock = clock;
  }

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("VersionWorkflow listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("VersionWorkflow event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  dispose() {
    this.#disposed = true;
    this.#navigationGeneration += 1;
    this.#reviewGeneration += 1;
    this.#canvasPort.onNavigationChange(false);
    this.#listeners.clear();
    this.#eventListeners.clear();
  }

  async prepareReviewCandidate({ run } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    const ready = this.#readyRun(run);
    if (!ready) {
      return blocked("VERSION_REVIEW_PRECONDITION", "当前没有可安全审阅的候选版本。");
    }
    if (!SHA256.test(String(ready.baseSnapshotSha256 || ""))) {
      return rejected(
        "VERSION_REVIEW_BASE_HASH_INVALID",
        "当前候选缺少可核验的冻结源文件 Hash。",
      );
    }
    const operationId = this.#nextOperationId("review");
    const generation = ++this.#reviewGeneration;
    this.#setReview("preparing", operationId);
    try {
      const payload = await this.#bridgeClient.versionFile(
        ready.sourcePath,
        ready.candidateVersionId,
      );
      if (
        this.#disposed
        || generation !== this.#reviewGeneration
        || !this.#isCurrentReadyRun(ready)
      ) return stale(this.#runIdentity(ready));

      this.#assertVersionFileIdentity(payload, ready, ready.candidateVersionId);
      const content = String(payload.content || "");
      const sha256 = String(payload.sha256 || payload.contentSha256 || "");
      const expectedSha256 = this.#candidateHash(ready, sha256);
      if (
        !content
        || !SHA256.test(sha256)
        || sha256 !== expectedSha256
        || await this.#hashPort.sha256(content) !== sha256
      ) {
        throw new Error("审阅候选与已校验版本的内容 Hash 不一致。");
      }
      if (
        this.#disposed
        || generation !== this.#reviewGeneration
        || !this.#isCurrentReadyRun(ready)
      ) return stale(this.#runIdentity(ready));

      const candidate = Object.freeze({
        operationId,
        operationKey: this.#codecs.operationKey(ready),
        projectId: ready.projectId,
        documentId: ready.documentId,
        requestId: ready.requestId,
        attemptId: ready.attemptId,
        sourcePath: ready.sourcePath,
        versionId: ready.candidateVersionId,
        baseSnapshotSha256: ready.baseSnapshotSha256,
        content,
        sha256,
      });
      this.#emitEvent({ type: "version-review-candidate-prepared", candidate });
      return succeeded(candidate);
    } catch (cause) {
      return this.#outcomeFromCause(
        operationId,
        cause,
        "VERSION_REVIEW_CANDIDATE_REJECTED",
        "候选版本仍已安全保留，可以稍后重试。",
      );
    } finally {
      if (generation === this.#reviewGeneration) this.#setReview("idle", null);
    }
  }

  async activateReadyVersion({
    run,
    reviewLease = null,
    fromDeferred = false,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    const ready = this.#readyRun(run);
    if (!ready) {
      return blocked("VERSION_ACTIVATION_PRECONDITION", "当前没有可确认打开的候选版本。");
    }
    try {
      // Validate the persisted ready record before the explicit mutation. A
      // malformed late poll result must never be allowed to activate a Version
      // merely because the Bridge would later return authoritative bytes.
      this.#committedPayload(ready, ready.readyPayload);
    } catch (cause) {
      return this.#outcomeFromCause(
        this.#nextOperationId("activation-validation"),
        cause,
        "VERSION_ACTIVATION_PAYLOAD_INVALID",
        "当前候选的完成资料不完整，不能打开。",
      );
    }
    if (this.#projectWorkflow.projectHydrating) {
      return blocked(
        "VERSION_ACTIVATION_PROJECT_UNAVAILABLE",
        "项目状态仍在读取，不能打开候选版本。",
      );
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "external-refresh",
        () => this.activateReadyVersion({
          run: ready,
          reviewLease,
          fromDeferred: true,
        }),
        { authority: "system" },
      );
      if (deferred) return deferred;
    }
    const operationKey = this.#codecs.operationKey(ready);
    if (!this.#runSession.beginOperation("activate", operationKey)) {
      return blocked("VERSION_ACTIVATION_BUSY", "当前候选版本正在打开，请等待当前操作完成。");
    }
    const operation = this.#beginNavigation("activating", this.#projectSession.context);
    if (!operation) {
      this.#runSession.endOperation("activate", operationKey);
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    this.#runSession.setActiveRun({ ...ready, error: undefined });
    try {
      const activatedPayload = await this.#bridgeClient.activateReadyVersion({
        ...this.#projectSession.context,
        sourcePath: ready.sourcePath,
        projectId: ready.projectId,
        documentId: ready.documentId,
        requestId: ready.requestId,
        attemptId: ready.attemptId,
        versionId: ready.candidateVersionId,
      });
      if (!this.#isCurrentReadyRun(ready)) return stale(this.#runIdentity(ready));
      const opened = await this.#openCommittedVersion({
        run: ready,
        payload: {
          ...ready.readyPayload,
          ...activatedPayload,
          completion: ready.readyPayload.completion,
          outcome: ready.readyPayload.outcome,
          version: activatedPayload.version || ready.readyPayload.version,
        },
        reviewLease,
        operation,
      });
      if (opened.status !== "succeeded") return opened;

      const completed = this.#settleActivatedRun(ready, opened.value);
      const value = {
        ...opened.value,
        completedRun: completed,
      };
      this.#emitEvent({ type: "version-activated", ...value });
      return succeeded(value);
    } catch (cause) {
      const reason = this.#codecs.errorMessage(cause, "最新版暂时无法打开。");
      if (this.#runMatches(this.#runSession.activeRun, ready)) {
        this.#runSession.trackRun({
          ...ready,
          status: "ready-to-open",
          error: reason,
        });
      }
      return this.#outcomeFromCause(
        operation.operationId,
        cause,
        "VERSION_ACTIVATION_REJECTED",
        reason,
      );
    } finally {
      this.#runSession.endOperation("activate", operationKey);
      this.#finishNavigation(operation);
    }
  }

  async openCommittedVersion({
    run,
    payload,
    reviewLease = null,
    fromDeferred = false,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    if (!run || !this.#codecs.isRecord(payload)) {
      return blocked("VERSION_OPEN_PRECONDITION", "完成结果缺少可校验的版本资料。");
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "external-refresh",
        () => this.openCommittedVersion({
          run,
          payload,
          reviewLease,
          fromDeferred: true,
        }),
        { authority: "system" },
      );
      if (deferred) return deferred;
    }
    const operation = this.#beginNavigation("opening", this.#projectSession.context);
    if (!operation) {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    try {
      return await this.#openCommittedVersion({
        run,
        payload,
        reviewLease,
        operation,
      });
    } catch (cause) {
      return this.#outcomeFromCause(
        operation.operationId,
        cause,
        "VERSION_OPEN_REJECTED",
        "已生成的版本暂时无法安全打开。",
      );
    } finally {
      this.#finishNavigation(operation);
    }
  }

  async viewHistory({
    version,
    context = this.#projectSession.context,
    deadlineAt = this.#clock.now() + 15_000,
    fromDeferred = false,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    const current = copyContext(context);
    if (!current || !this.#projectSession.matches(current)) {
      return stale(current || {});
    }
    if (!version?.id) {
      return blocked("VERSION_HISTORY_PRECONDITION", "当前历史版本缺少可验证的版本 ID。");
    }
    if (this.#projectWorkflow.projectHydrating || this.#projectWorkflow.projectLoadError) {
      return blocked("VERSION_HISTORY_PROJECT_UNAVAILABLE", "项目状态尚未准备完成，不能切换历史视图。");
    }
    if (this.#runSession.activeLocked) {
      return blocked("VERSION_HISTORY_RUN_LOCKED", "当前 AI 处理尚未完成，不能切换历史视图。");
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "project-switch",
        () => this.viewHistory({ version, context: current, deadlineAt, fromDeferred: true }),
      );
      if (deferred) return deferred;
    }
    const operation = this.#beginNavigation("history", current);
    if (!operation) {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    let previous = this.#captureNavigationSnapshot(current);
    try {
      const frozen = this.#freezeCurrentCanvas(
        "当前编辑画布尚未完成安全收口，无法打开历史版本。",
        "project-switch",
      );
      if (!frozen.ok) return blocked("VERSION_HISTORY_CANVAS_FENCE", frozen.reason);
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      if (previous.version.viewMode === "current") {
        const drained = await this.#projectWorkflow.drain("history", { deadlineAt });
        // A drain can advance durable Document authority before a later
        // obligation rejects. Rollback must retain that settled projection in
        // either case rather than restoring a stale pending write.
        previous = this.#captureNavigationSnapshot(current);
        if (!drained.ok) {
          throw new Error(drained.reason || "当前编辑没有完成安全收口。");
        }
      }
      const payload = await this.#bridgeClient.versionFile(current.sourcePath, String(version.id));
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      this.#assertVersionFileIdentity(payload, current, String(version.id));
      const content = String(payload.content || "");
      const sha256 = String(payload.sha256 || payload.contentSha256 || "");
      if (
        (version.contentSha256 && sha256 !== String(version.contentSha256))
        || !SHA256.test(sha256)
        || await this.#hashPort.sha256(content) !== sha256
      ) {
        throw new Error("历史文件内容与声明 Hash 不一致，已拒绝打开。");
      }
      this.#documentSession.publishAuthority({
        html: content,
        sourceSha256: previous.document.sourceSha256,
      });
      this.#versionSession.enterHistory(String(version.id));
      this.#canvasPort.invalidateRenderAcks();
      await this.#canvasPort.verifyRendered(content, sha256, current);
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      const value = { context: current, versionId: String(version.id), content, sha256 };
      this.#emitEvent({ type: "version-history-viewed", ...value });
      return succeeded(value);
    } catch (cause) {
      const rollback = await this.#rollbackNavigation(operation, previous);
      return rejected(
        errorCode(cause, "VERSION_HISTORY_REJECTED"),
        this.#codecs.errorMessage(
          cause,
          rollback ? "历史版本没有打开；原来的画布仍保持不变。" : "历史版本没有打开。",
        ),
      );
    } finally {
      this.#finishNavigation(operation);
    }
  }

  async returnToCurrent({
    context = this.#projectSession.context,
    fromDeferred = false,
  } = {}) {
    if (this.#disposed) {
      return blocked("VERSION_WORKFLOW_DISPOSED", "版本工作流已经停止。");
    }
    const current = copyContext(context);
    if (!current || !this.#projectSession.matches(current)) {
      return stale(current || {});
    }
    if (this.#projectWorkflow.projectLoadError) {
      return blocked("VERSION_CURRENT_PROJECT_UNAVAILABLE", "项目状态尚未准备完成，不能返回当前 HTML。");
    }
    if (!fromDeferred) {
      const deferred = this.#deferCanvasCommand(
        "project-switch",
        () => this.returnToCurrent({ context: current, fromDeferred: true }),
      );
      if (deferred) return deferred;
    }
    const operation = this.#beginNavigation("current", current);
    if (!operation) {
      return blocked("VERSION_NAVIGATION_BUSY", "当前 HTML 视图正在切换，请稍后重试。");
    }
    const previous = this.#captureNavigationSnapshot(current);
    try {
      const frozen = this.#freezeCurrentCanvas(
        "当前编辑画布尚未完成安全收口，无法返回当前 HTML。",
        "project-switch",
      );
      if (!frozen.ok) return blocked("VERSION_CURRENT_CANVAS_FENCE", frozen.reason);
      const payload = await this.#bridgeClient.source(current.sourcePath);
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      this.#assertSourceIdentity(payload, current);
      const content = String(payload.content || "");
      const sha256 = String(payload.sha256 || payload.sourceSha256 || "");
      if (!SHA256.test(sha256) || await this.#hashPort.sha256(content) !== sha256) {
        throw new Error("当前源 HTML 与声明 Hash 不一致。");
      }
      this.#documentSession.publishAuthority({ html: content, sourceSha256: sha256 });
      this.#versionSession.returnCurrent({
        currentBasedOnVersionId:
          payload.currentBasedOnVersionId || previous.version.currentBasedOnVersionId,
        currentExactVersionId: payload.currentExactVersionId || null,
        restoredFromVersionId:
          payload.restoredFromVersionId || previous.version.restoredFromVersionId,
      });
      this.#canvasPort.invalidateRenderAcks();
      await this.#canvasPort.verifyRendered(content, sha256, current);
      if (!this.#isNavigationCurrent(operation)) return stale(current);
      const value = {
        context: current,
        content,
        sha256,
        lastModifiedAt: String(payload.lastModifiedAt || ""),
      };
      this.#emitEvent({ type: "version-current-returned", ...value });
      return succeeded(value);
    } catch (cause) {
      const rollback = await this.#rollbackNavigation(operation, previous);
      return rejected(
        errorCode(cause, "VERSION_CURRENT_REJECTED"),
        this.#codecs.errorMessage(
          cause,
          rollback
            ? "当前画布仍停留在原来的历史版本；源文件没有被改动。"
            : "当前源 HTML 没有被改动。",
        ),
      );
    } finally {
      this.#finishNavigation(operation);
    }
  }

  async #openCommittedVersion({ run, payload, reviewLease, operation }) {
    const completion = this.#committedPayload(run, payload);
    const committedSourcePath = String(
      payload.sourcePath
      || payload.currentPath
      || payload.workingCopyPath
      || run.sourcePath,
    );
    const [versionPayload, sourcePayload] = await Promise.all([
      this.#bridgeClient.versionFile(committedSourcePath, completion.versionId),
      this.#bridgeClient.source(committedSourcePath),
    ]);
    if (!this.#isNavigationCurrent(operation)) return stale(this.#runIdentity(run));
    this.#assertVersionFileIdentity(versionPayload, run, completion.versionId);
    this.#assertSourceIdentity(sourcePayload, run, { allowSourceTransition: true });
    const versionSha256 = String(versionPayload.sha256 || versionPayload.contentSha256 || "");
    const sourceSha256 = String(sourcePayload.sha256 || sourcePayload.sourceSha256 || "");
    const content = String(versionPayload.content || "");
    const sourceContent = String(sourcePayload.content || "");
    const resolvedCommittedSourcePath = String(
      sourcePayload.sourcePath
      || committedSourcePath,
    );
    const lastModifiedAt = String(sourcePayload.lastModifiedAt || "");
    if (
      versionSha256 !== completion.expectedSha256
      || sourceSha256 !== completion.expectedSha256
      || !SHA256.test(versionSha256)
      || content !== sourceContent
      || await this.#hashPort.sha256(content) !== versionSha256
      || await this.#hashPort.sha256(sourceContent) !== sourceSha256
    ) {
      throw new Error("版本快照、源 HTML 与完成记录的 Hash 不一致，已停止打开。");
    }
    if (!validTimestamp(lastModifiedAt)) {
      throw new Error("当前源 HTML 缺少独立的最后修改时间，已停止打开。");
    }

    const activeContext = this.#projectSession.context;
    const affectsCurrentCanvas = Boolean(
      activeContext
      && activeContext.projectId === run.projectId
      && (
        this.#codecs.sameSourcePath(activeContext.sourcePath, run.sourcePath)
        || this.#codecs.sameSourcePath(activeContext.sourcePath, resolvedCommittedSourcePath)
      ),
    );
    if (affectsCurrentCanvas) {
      const alreadyFencedForReview = Boolean(
        reviewLease
        && reviewLease.operationKey === this.#codecs.operationKey(run)
        && reviewLease.beforeHtml === this.#documentSession.html,
      );
      if (!alreadyFencedForReview) {
        const frozen = this.#freezeCurrentCanvas(
          "新版本已生成，但当前编辑画布尚未就绪。",
          "external-refresh",
        );
        if (!frozen.ok) throw new Error(frozen.reason);
      }
      if (!this.#projectSession.matches(activeContext)) {
        return stale(activeContext);
      }
      this.#documentWorkflow.clearRecovery(activeContext);
    }

    const prepared = await this.#projectWorkflow.prepareGeneratedSourceTransition({
      previousSourcePath: run.sourcePath,
      nextSourcePath: resolvedCommittedSourcePath,
      expectedSha256: sourceSha256,
      nextProjectId: run.projectId,
      nextDocumentId: run.documentId,
      versionId: completion.versionId,
      openTarget: payload.openTarget || null,
    });
    if (!this.#isNavigationCurrent(operation)) return stale(this.#runIdentity(run));
    if (!prepared.updatesCurrentProject) {
      return succeeded({
        current: false,
        context: null,
        versionId: completion.versionId,
        candidateLabel: completion.candidateLabel,
        protocolViolation: completion.protocolViolation,
        aiCompletedAt: completion.aiCompletedAt,
        committedSourcePath: resolvedCommittedSourcePath,
        lastModifiedAt,
      });
    }
    const context = this.#projectWorkflow.commitGeneratedSourceTransition({
      prepared,
      html: content,
      sourceSha256,
      publishVersion: () => this.#versionSession.adoptCommitted(completion.versionId),
    });
    if (!context || !this.#projectSession.matches(context)) return stale(this.#runIdentity(run));

    await this.#canvasPort.verifyRendered(content, versionSha256, context);
    if (!this.#projectSession.matches(context)) return stale(context);

    this.#documentWorkflow.clearAudit();
    this.#documentSession.setPersistence({ state: "idle", error: "" });

    this.#commentWorkflow.resetForProjectTransition();
    this.#commentSession.reset();
    this.#draftSession.replaceAuthority(context, 0, emptyDraftAuthority());
    this.#commentWorkflow.queueDraft();
    this.#documentWorkflow.clearRecovery(context);

    let refreshWarning = "";
    try {
      const refreshed = await this.#projectWorkflow.refreshWorkspace({
        sourcePath: resolvedCommittedSourcePath,
        epoch: context.epoch,
      });
      if (refreshed.status !== "succeeded" && refreshed.status !== "stale") {
        refreshWarning = refreshed.reason || "新版本已打开，但项目资料尚未完成复核。";
      }
    } catch (cause) {
      refreshWarning = this.#codecs.errorMessage(
        cause,
        "新版本已打开，但项目资料尚未完成复核。",
      );
    }

    return succeeded({
      current: true,
      context,
      versionId: completion.versionId,
      candidateLabel: completion.candidateLabel,
      protocolViolation: completion.protocolViolation,
      aiCompletedAt: completion.aiCompletedAt,
      committedSourcePath: resolvedCommittedSourcePath,
      lastModifiedAt,
      refreshWarning,
    });
  }

  #committedPayload(run, payload) {
    const version = this.#codecs.isRecord(payload.version) ? payload.version : {};
    const outcome = this.#codecs.isRecord(payload.outcome) ? payload.outcome : {};
    const completion = this.#codecs.isRecord(payload.completion) ? payload.completion : {};
    const declaredCompletionTimes = [
      completion.completedAt,
      outcome.completedAt,
      payload.completedAt,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const declaredVersionTimes = [
      version.generatedAt,
      outcome.generatedAt,
      payload.generatedAt,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const aiCompletedAt = String(declaredCompletionTimes[0] || "");
    const versionGeneratedAt = String(declaredVersionTimes[0] || "");
    if (!validTimestamp(aiCompletedAt) || !validTimestamp(versionGeneratedAt)) {
      throw new Error("完成结果缺少可审计的 AI 完成时间或版本生成时间。");
    }
    if (
      declaredCompletionTimes.some((value) => String(value) !== aiCompletedAt)
      || declaredVersionTimes.some((value) => String(value) !== versionGeneratedAt)
    ) {
      throw new Error("完成记录与版本记录的时间戳不一致，已拒绝打开。");
    }
    const declaredVersionIds = [
      payload.versionId,
      version.versionId,
      version.id,
      outcome.versionId,
      completion.versionId,
      run.candidateVersionId,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const versionId = String(declaredVersionIds[0] || "");
    const declaredContentHashes = [
      payload.contentSha256,
      version.contentSha256,
      outcome.contentSha256,
    ].filter((value) => value !== undefined && value !== null && value !== "");
    const expectedSha256 = String(
      declaredContentHashes[0]
      || payload.sourceSha256
      || payload.currentHtmlSha256
      || "",
    );
    if (!versionId || !SHA256.test(expectedSha256)) {
      throw new Error("完成结果缺少版本 ID 或内容 Hash。");
    }
    if (
      declaredVersionIds.some((value) => String(value) !== versionId)
      || declaredContentHashes.some((value) => String(value) !== expectedSha256)
    ) {
      throw new Error("完成记录与候选版本的 ID 或内容 Hash 不一致，已拒绝打开。");
    }
    for (const [field, expected] of [
      ["projectId", run.projectId],
      ["documentId", run.documentId],
      ["requestId", run.requestId],
      ["attemptId", run.attemptId],
    ]) {
      const declared = [payload[field], version[field], outcome[field], completion[field]]
        .filter((value) => value !== undefined && value !== null && value !== "");
      if (declared.some((value) => String(value) !== expected)) {
        throw new Error(`完成结果的 ${field} 与当前冻结任务不一致，已拒绝打开。`);
      }
    }
    if (run.candidateVersionId && versionId !== run.candidateVersionId) {
      throw new Error("完成结果的版本 ID 与系统预留候选版本不一致，已拒绝打开。");
    }
    return Object.freeze({
      versionId,
      expectedSha256,
      candidateLabel: String(payload.candidateDisplayVersionLabel || run.candidateVersionLabel),
      aiCompletedAt,
      protocolViolation: Boolean(payload.protocolViolation || outcome.protocolViolation),
    });
  }

  #candidateHash(run, fallback) {
    const payload = this.#codecs.isRecord(run.readyPayload) ? run.readyPayload : {};
    const version = this.#codecs.isRecord(payload.version) ? payload.version : {};
    return String(payload.contentSha256 || version.contentSha256 || fallback || "");
  }

  #assertVersionFileIdentity(payload, owner, expectedVersionId) {
    const projectId = String(owner.projectId || "");
    const documentId = String(owner.documentId || "");
    if (
      String(payload?.projectId || "") !== projectId
      || String(payload?.documentId || "") !== documentId
      || String(payload?.versionId || "") !== String(expectedVersionId || "")
    ) {
      throw new Error("版本文件的项目、文档或版本身份与当前操作不一致。");
    }
  }

  #assertSourceIdentity(payload, owner, { allowSourceTransition = false } = {}) {
    if (
      String(payload?.projectId || "") !== String(owner.projectId || "")
      || String(payload?.documentId || "") !== String(owner.documentId || "")
      || (!allowSourceTransition && (
        payload?.sourcePath
        && !this.#codecs.sameSourcePath(payload.sourcePath, owner.sourcePath)
      ))
    ) {
      throw new Error("当前源 HTML 的项目身份发生变化，已拒绝切换视图。");
    }
  }

  #settleActivatedRun(run, value) {
    const warning = value.protocolViolation
      ? "内部 AI 的临时输出在最终化后又被修改；已提交版本本身未受影响。"
      : "";
    const completed = {
      ...run,
      sourcePath: value.committedSourcePath,
      candidateVersionLabel: value.candidateLabel,
      status: value.protocolViolation ? "error" : "complete",
      completionObserved: true,
      ...(warning ? { error: warning } : {}),
    };
    this.#runSession.setActiveRun(completed);
    this.#runSession.removeRun(run, { clearActive: false });
    this.#runSession.clearActiveHandoff();
    return Object.freeze(completed);
  }

  #captureNavigationSnapshot(context) {
    return Object.freeze({
      context,
      document: Object.freeze({ ...this.#documentSession.snapshot }),
      pendingWrite: this.#documentSession.pendingWrite,
      version: this.#versionSession.captureSnapshot(),
    });
  }

  async #rollbackNavigation(operation, previous) {
    if (!this.#isNavigationCurrent(operation)) return false;
    this.#documentSession.publishAuthority({
      html: previous.document.html,
      sourceSha256: previous.document.sourceSha256,
      editRevision: previous.document.editRevision,
      lastPersistedRevision: previous.document.lastPersistedRevision,
      persistState: previous.document.persistState,
      persistError: previous.document.persistError,
      pendingWrite: previous.pendingWrite,
    });
    this.#versionSession.restoreSnapshot(previous.version);
    this.#canvasPort.invalidateRenderAcks();
    try {
      const sha256 = await this.#hashPort.sha256(previous.document.html);
      await this.#canvasPort.verifyRendered(previous.document.html, sha256, previous.context);
      return this.#isNavigationCurrent(operation);
    } catch {
      return false;
    }
  }

  #freezeCurrentCanvas(reason, trigger) {
    const fenced = this.#canvasPort.fencePendingEdit({
      resumeEditing: false,
      trigger,
    });
    if (!fenced || !fenced.ok) {
      return {
        ok: false,
        reason: fenced?.reason || "请点回文字完成输入，再切换 HTML 视图。",
      };
    }
    const frozen = this.#canvasPort.freeze(reason);
    if (!frozen || !frozen.ok) {
      return {
        ok: false,
        reason: frozen?.reason || "当前编辑画布尚未完成安全收口。",
      };
    }
    if (frozen.html !== this.#documentSession.html) {
      return { ok: false, reason: "编辑画布的冻结快照与当前源 HTML 不一致。" };
    }
    return { ok: true, html: frozen.html };
  }

  #beginNavigation(phase, context) {
    if (this.#snapshot.navigation.phase !== "idle") return null;
    const operation = Object.freeze({
      operationId: this.#nextOperationId("navigation"),
      generation: ++this.#navigationGeneration,
      context: copyContext(context),
    });
    this.#setNavigation(phase, operation.operationId, operation.generation);
    return operation;
  }

  #finishNavigation(operation) {
    if (
      this.#snapshot.navigation.operationId !== operation.operationId
      || operation.generation !== this.#navigationGeneration
    ) return;
    this.#setNavigation("idle", null, operation.generation);
    if (!this.#runSession.activeLocked) {
      const unlock = () => this.#canvasPort.unlock();
      if (typeof this.#canvasPort.requestFrame === "function") {
        this.#canvasPort.requestFrame(unlock);
      } else {
        unlock();
      }
    }
  }

  #isNavigationCurrent(operation) {
    return Boolean(
      !this.#disposed
      && operation
      && operation.generation === this.#navigationGeneration
      && this.#snapshot.navigation.operationId === operation.operationId
      && (!operation.context || this.#projectSession.matches(operation.context)),
    );
  }

  #deferCanvasCommand(kind, run, options = {}) {
    if (typeof this.#canvasPort.deferCommand !== "function") return null;
    let resolveDeferred;
    const outcome = new Promise((resolve) => {
      resolveDeferred = resolve;
    });
    const deferred = this.#canvasPort.deferCommand(
      kind,
      () => {
        Promise.resolve(run()).then(
          resolveDeferred,
          (cause) => resolveDeferred(rejected(
            "VERSION_DEFERRED_COMMAND_REJECTED",
            this.#codecs.errorMessage(cause, "延后的版本操作失败。"),
          )),
        );
      },
      {
        ...options,
        onDiscard: () => resolveDeferred(blocked(
          "VERSION_DEFERRED_COMMAND_DISCARDED",
          "当前项目已经变化，延后的版本操作没有执行。",
        )),
      },
    );
    return deferred ? outcome : null;
  }

  #readyRun(run) {
    if (
      !run
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || !run.candidateVersionId
      || !this.#isCurrentReadyRun(run)
    ) return null;
    return run;
  }

  #isCurrentReadyRun(run) {
    return Boolean(
      this.#runMatches(this.#runSession.activeRun, run)
      && this.#runSession.activeRun?.status === "ready-to-open",
    );
  }

  #runMatches(left, right) {
    return sameRun(left, right, this.#codecs.sameSourcePath);
  }

  #runIdentity(run) {
    return Object.freeze({
      projectId: String(run?.projectId || ""),
      documentId: String(run?.documentId || ""),
      requestId: String(run?.requestId || ""),
      attemptId: String(run?.attemptId || ""),
      sourcePath: String(run?.sourcePath || ""),
    });
  }

  #nextOperationId(kind) {
    this.#operationSequence += 1;
    return [
      "version",
      String(kind),
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#operationSequence.toString(36),
    ].join("_");
  }

  #setNavigation(phase, operationId, generation = this.#navigationGeneration) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      navigation: Object.freeze({
        phase,
        operationId: operationId ? String(operationId) : null,
        generation,
      }),
    });
    this.#canvasPort.onNavigationChange(phase !== "idle");
    this.#publishSnapshot();
  }

  #setReview(phase, operationId) {
    this.#snapshot = Object.freeze({
      ...this.#snapshot,
      review: Object.freeze({
        phase,
        operationId: operationId ? String(operationId) : null,
      }),
    });
    this.#publishSnapshot();
  }

  #publishSnapshot() {
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation subscribers cannot alter Version authority.
      }
    }
  }

  #emitEvent(event) {
    const frozen = Object.freeze({ ...event });
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation listeners cannot alter Version authority.
      }
    }
  }

  #outcomeFromCause(operationId, cause, fallbackCode, fallbackReason) {
    const reason = this.#codecs.errorMessage(cause, fallbackReason);
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      return unknown(operationId, reason);
    }
    return rejected(errorCode(cause, fallbackCode), reason);
  }
}
