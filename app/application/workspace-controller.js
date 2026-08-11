import { isBridgeRequestError } from "./bridge-client.js";
import { CommentWorkflow } from "./comment-workflow.js";
import { DocumentWorkflow } from "./document-workflow.js";
import { DrainCoordinator } from "./drain-coordinator.js";
import { ExternalFileOpenSession } from "./external-file-open-session.js";
import { ProjectApplicationSession } from "./project-application-session.js";
import { ProjectRulesSession } from "./project-rules-session.js";
import { ProjectRulesWorkflow } from "./project-rules-workflow.js";
import { ProjectWorkflow } from "./project-workflow.js";
import { RunWorkflow } from "./run-workflow.js";
import { VersionWorkflow } from "./version-workflow.js";
import { createWorkspaceControllerCodecs } from "./workspace-controller-codecs.js";

function copyLocator({
  operationId,
  epoch,
  sourcePath,
  expectedSourceSha256,
} = {}) {
  return Object.freeze({
    operationId: String(operationId || ""),
    epoch: Number.isSafeInteger(Number(epoch)) ? Number(epoch) : 0,
    sourcePath: String(sourcePath || ""),
    expectedSourceSha256: expectedSourceSha256
      ? String(expectedSourceSha256)
      : null,
  });
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

function stale(identity) {
  return Object.freeze({ status: "stale", identity });
}

function registrationSnapshot({
  phase = "idle",
  operationId = null,
  identity = null,
  outcome = null,
} = {}) {
  return Object.freeze({
    registration: Object.freeze({
      phase,
      operationId: operationId ? String(operationId) : null,
      identity: identity ? copyLocator(identity) : null,
      outcome,
    }),
  });
}

function registrationErrorCode(cause) {
  if (isBridgeRequestError(cause) && cause.code) return cause.code;
  return "PROJECT_REGISTRATION_REJECTED";
}

export class WorkspaceRegistrationError extends Error {
  constructor(outcome) {
    super(outcome.reason);
    this.name = "WorkspaceRegistrationError";
    this.code = outcome.status === "unknown"
      ? "PROJECT_REGISTRATION_UNKNOWN"
      : outcome.code;
    if (outcome.status === "unknown") {
      this.operationId = outcome.operationId;
    }
  }
}

// Workbench presentation callbacks still consume a ProjectContext while the
// migration is in progress. The conversion remains a pure Outcome mapping: all
// registration IO, single-flight and Session publication live in the facade.
export function registrationContextFromOutcome(outcome) {
  if (outcome?.status === "succeeded") return outcome.value;
  if (outcome?.status === "blocked" || outcome?.status === "stale") return null;
  if (outcome?.status === "rejected" || outcome?.status === "unknown") {
    throw new WorkspaceRegistrationError(outcome);
  }
  throw new WorkspaceRegistrationError(rejected(
    "PROJECT_REGISTRATION_INVALID_OUTCOME",
    "项目资料初始化返回了无效结果。",
  ));
}

export class WorkspaceController {
  #bridgeClient;
  #projectSession;
  #documentSession;
  #commentSession;
  #draftSession;
  #versionSession;
  #sourceHistorySession;
  #codecs;
  #hashPort;
  #recoveryPort;
  #canvasPort;
  #clock;
  #drainCoordinator = new DrainCoordinator();
  #documentWorkflow = null;
  #documentWorkflowUnsubscribe = null;
  #commentWorkflow = null;
  #commentWorkflowUnsubscribe = null;
  #projectRulesWorkflow = null;
  #projectRulesWorkflowUnsubscribe = null;
  #projectWorkflow = null;
  #projectWorkflowUnsubscribe = null;
  #runWorkflow = null;
  #runWorkflowUnsubscribe = null;
  #versionWorkflow = null;
  #versionWorkflowUnsubscribe = null;
  #runSessionUnsubscribe = null;
  #registration = registrationSnapshot().registration;
  #projectSnapshot = null;
  #projectRulesSnapshot = null;
  #runSnapshot = null;
  #versionSnapshot = null;
  #snapshot = Object.freeze({
    registration: this.#registration,
    comment: null,
    projectRules: null,
    project: null,
    run: null,
    version: null,
  });
  #listeners = new Set();
  #eventListeners = new Set();
  #registrationPromise = null;
  #registrationSequence = 0;
  #disposed = false;

  constructor({
    bridgeClient,
    projectSession,
    documentSession,
    commentSession,
    draftSession,
    versionSession,
    sourceHistorySession,
    codecs,
    ports = {},
    documentWorkflow = null,
    commentWorkflow = null,
    projectRulesWorkflow = null,
    projectWorkflow = null,
    runWorkflow = null,
    versionWorkflow = null,
    clock,
  } = {}) {
    if (!bridgeClient || typeof bridgeClient.ensureProject !== "function") {
      throw new TypeError("WorkspaceController requires a Bridge client.");
    }
    if (!projectSession || typeof projectSession.register !== "function") {
      throw new TypeError("WorkspaceController requires ProjectSession injection.");
    }
    if (!documentSession || typeof documentSession.update !== "function") {
      throw new TypeError("WorkspaceController requires DocumentSession injection.");
    }
    if (!commentSession || typeof commentSession.setComments !== "function") {
      throw new TypeError("WorkspaceController requires CommentSession injection.");
    }
    if (!draftSession || typeof draftSession.replaceAuthority !== "function") {
      throw new TypeError("WorkspaceController requires DraftSession injection.");
    }
    if (!versionSession || typeof versionSession.hydrate !== "function") {
      throw new TypeError("WorkspaceController requires VersionSession injection.");
    }
    if (!sourceHistorySession || typeof sourceHistorySession.activate !== "function") {
      throw new TypeError("WorkspaceController requires SourceHistorySession injection.");
    }
    if (!ports.hash || typeof ports.hash.sha256 !== "function") {
      throw new TypeError("WorkspaceController requires a HashPort.");
    }
    if (!clock || typeof clock.now !== "function") {
      throw new TypeError("WorkspaceController requires a ClockPort.");
    }
    if (
      projectRulesWorkflow
      && projectWorkflow
      && projectRulesWorkflow.runSession !== projectWorkflow.runSession
    ) {
      throw new TypeError(
        "WorkspaceController ProjectRulesWorkflow and ProjectWorkflow require one RunSession.",
      );
    }

    this.#bridgeClient = bridgeClient;
    this.#projectSession = projectSession;
    this.#documentSession = documentSession;
    this.#commentSession = commentSession;
    this.#draftSession = draftSession;
    this.#versionSession = versionSession;
    this.#sourceHistorySession = sourceHistorySession;
    this.#codecs = createWorkspaceControllerCodecs(codecs);
    this.#hashPort = ports.hash;
    this.#recoveryPort = ports.recovery || { replace: () => {} };
    this.#canvasPort = ports.canvas || { invalidateRenderAcks: () => {} };
    if (typeof this.#recoveryPort.replace !== "function") {
      throw new TypeError("WorkspaceController RecoveryPort must provide replace.");
    }
    if (typeof this.#canvasPort.invalidateRenderAcks !== "function") {
      throw new TypeError(
        "WorkspaceController CanvasAuthorityPort must provide invalidateRenderAcks.",
      );
    }
    this.#clock = clock;
    if (documentWorkflow) {
      this.#documentWorkflow = new DocumentWorkflow({
        bridgeClient,
        ensureRegistered: (input) => this.ensureRegistered(input),
        projectSession,
        documentSession,
        commentSession,
        versionSession,
        sourceHistorySession,
        codecs: documentWorkflow.codecs,
        ports: {
          hash: this.#hashPort,
          recoveryStore: documentWorkflow.recoveryStore,
          canvas: {
            invalidateRenderAcks: this.#canvasPort.invalidateRenderAcks,
            verifyRendered: documentWorkflow.canvas?.verifyRendered,
            freeze: documentWorkflow.canvas?.freeze,
            adoptHistorySource: documentWorkflow.canvas?.adoptHistorySource,
          },
        },
        scheduler: documentWorkflow.scheduler,
        clock,
      });
      this.#documentWorkflowUnsubscribe = this.#documentWorkflow.subscribeEvents(
        (event) => {
          if (
            event?.fatal
            && [
              "document-persistence-failed",
              "document-authority-reload-failed",
            ].includes(event.type)
          ) {
            this.#projectWorkflow?.reportLoadFailure(event.message);
          }
          this.#emitEvent(event);
        },
      );
    }
    if (commentWorkflow) {
      this.#commentWorkflow = new CommentWorkflow({
        bridgeClient,
        ensureRegistered: (input) => this.ensureRegistered(input),
        projectSession,
        documentSession,
        commentSession,
        draftSession,
        versionSession,
        runSession: commentWorkflow.runSession,
        codecs: commentWorkflow.codecs,
        ports: {
          recoveryStore: commentWorkflow.recoveryStore,
          attachmentBinary: commentWorkflow.attachmentBinary,
        },
        clock,
      });
      this.#commentWorkflowUnsubscribe = this.#commentWorkflow.subscribe(
        () => this.#publishAggregateSnapshot(),
      );
      this.#commentWorkflow.subscribeEvents((event) => this.#emitEvent(event));
    }
    if (projectRulesWorkflow) {
      this.#projectRulesWorkflow = new ProjectRulesWorkflow({
        bridgeClient,
        projectSession,
        runSession: projectWorkflow?.runSession || projectRulesWorkflow.runSession,
        projectRulesSession: new ProjectRulesSession(),
        errorMessage: projectRulesWorkflow.errorMessage,
        ports: {
          presentation: projectRulesWorkflow.presentation,
        },
        scheduler: projectRulesWorkflow.scheduler,
        clock,
      });
      this.#projectRulesWorkflowUnsubscribe = this.#projectRulesWorkflow.subscribe(
        (snapshot) => {
          this.#projectRulesSnapshot = snapshot;
          this.#publishAggregateSnapshot();
        },
      );
    }
    if (projectWorkflow) {
      if (!this.#documentWorkflow) {
        throw new TypeError("WorkspaceController ProjectWorkflow requires DocumentWorkflow.");
      }
      if (!this.#commentWorkflow) {
        throw new TypeError("WorkspaceController ProjectWorkflow requires CommentWorkflow.");
      }
      if (!this.#projectRulesWorkflow) {
        throw new TypeError("WorkspaceController ProjectWorkflow requires ProjectRulesWorkflow.");
      }
      const legacy = projectWorkflow.ports?.legacy || {};
      this.#projectWorkflow = new ProjectWorkflow({
        bridgeClient,
        ensureRegistered: (input) => this.ensureRegistered(input),
        projectSession,
        documentSession,
        commentSession,
        draftSession,
        versionSession,
        commentWorkflow: this.#commentWorkflow,
        runSession: projectWorkflow.runSession,
        projectRulesWorkflow: this.#projectRulesWorkflow,
        externalFileOpenSession: new ExternalFileOpenSession(),
        projectApplicationSession: new ProjectApplicationSession(),
        documentWorkflow: this.#documentWorkflow,
        drainCoordinator: this.#drainCoordinator,
        codecs: projectWorkflow.codecs,
        ports: {
          ...projectWorkflow.ports,
          legacy: {
            ...legacy,
            hydrateRecentRuns: (projects, activeSourcePath) => (
              this.#runWorkflow
                ? this.#runWorkflow.hydrateRecentRuns({ projects, activeSourcePath })
                : legacy.hydrateRecentRuns?.(projects, activeSourcePath)
            ),
            emit: (event) => this.#emitEvent(event),
          },
        },
        policies: projectWorkflow.policies,
        scheduler: projectWorkflow.scheduler,
        clock,
      });
      this.#projectWorkflowUnsubscribe = this.#projectWorkflow.subscribe(
        (snapshot) => {
          this.#projectSnapshot = snapshot;
          this.#publishAggregateSnapshot();
        },
      );
    }
    if (runWorkflow) {
      if (!this.#documentWorkflow || !this.#projectWorkflow) {
        throw new TypeError(
          "WorkspaceController RunWorkflow requires DocumentWorkflow and ProjectWorkflow.",
        );
      }
      this.#runWorkflow = new RunWorkflow({
        bridgeClient,
        ensureRegistered: (input) => this.ensureRegistered(input),
        projectSession,
        documentSession,
        commentSession,
        versionSession,
        runSession: runWorkflow.runSession,
        documentWorkflow: this.#documentWorkflow,
        drain: ({ boundary, deadlineAt }) => this.#projectWorkflow.drain(
          boundary,
          { deadlineAt },
        ),
        codecs: runWorkflow.codecs,
        ports: {
          canvas: runWorkflow.canvas,
          handoff: runWorkflow.handoff,
          hash: this.#hashPort,
        },
        scheduler: runWorkflow.scheduler,
        clock,
      });
      this.#runWorkflowUnsubscribe = this.#runWorkflow.subscribe((snapshot) => {
        this.#runSnapshot = snapshot;
        this.#publishAggregateSnapshot();
      });
      this.#runWorkflow.subscribeEvents((event) => this.#emitEvent(event));
      this.#runSessionUnsubscribe = runWorkflow.runSession.subscribe(() => {
        this.#runWorkflow?.syncPolling();
        this.#publishAggregateSnapshot();
      });
      this.#runWorkflow.syncPolling();
    }
    if (versionWorkflow) {
      if (!this.#documentWorkflow || !this.#commentWorkflow || !this.#projectWorkflow) {
        throw new TypeError(
          "WorkspaceController VersionWorkflow requires Document, Comment and Project workflows.",
        );
      }
      this.#versionWorkflow = new VersionWorkflow({
        bridgeClient,
        projectSession,
        documentSession,
        versionSession,
        runSession: versionWorkflow.runSession,
        projectWorkflow: this.#projectWorkflow,
        documentWorkflow: this.#documentWorkflow,
        commentWorkflow: this.#commentWorkflow,
        commentSession,
        draftSession,
        codecs: versionWorkflow.codecs,
        ports: {
          hash: this.#hashPort,
          canvas: versionWorkflow.canvas,
        },
        clock,
      });
      this.#versionWorkflowUnsubscribe = this.#versionWorkflow.subscribe((snapshot) => {
        this.#versionSnapshot = snapshot;
        this.#publishAggregateSnapshot();
      });
      this.#versionWorkflow.subscribeEvents((event) => this.#emitEvent(event));
    }
  }

  getSnapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("WorkspaceController listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => {
      this.#listeners.delete(listener);
    };
  }

  subscribeEvents(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("WorkspaceController event listener must be a function.");
    }
    this.#eventListeners.add(listener);
    return () => {
      this.#eventListeners.delete(listener);
    };
  }

  dispose() {
    this.#disposed = true;
    this.#versionWorkflowUnsubscribe?.();
    this.#versionWorkflowUnsubscribe = null;
    this.#versionWorkflow?.dispose();
    this.#versionWorkflow = null;
    this.#runSessionUnsubscribe?.();
    this.#runSessionUnsubscribe = null;
    this.#runWorkflowUnsubscribe?.();
    this.#runWorkflowUnsubscribe = null;
    this.#runWorkflow?.dispose();
    this.#runWorkflow = null;
    this.#projectWorkflowUnsubscribe?.();
    this.#projectWorkflowUnsubscribe = null;
    this.#projectWorkflow?.dispose();
    this.#projectWorkflow = null;
    this.#projectRulesWorkflowUnsubscribe?.();
    this.#projectRulesWorkflowUnsubscribe = null;
    this.#projectRulesWorkflow?.dispose();
    this.#projectRulesWorkflow = null;
    this.#commentWorkflowUnsubscribe?.();
    this.#commentWorkflowUnsubscribe = null;
    this.#commentWorkflow?.dispose();
    this.#commentWorkflow = null;
    this.#documentWorkflowUnsubscribe?.();
    this.#documentWorkflowUnsubscribe = null;
    this.#documentWorkflow?.dispose();
    this.#documentWorkflow = null;
    this.#listeners.clear();
    this.#eventListeners.clear();
  }

  get hasDocumentHistoryAction() {
    return Boolean(this.#documentWorkflow?.hasHistoryAction);
  }

  get projectHydrating() {
    return Boolean(this.#projectWorkflow?.projectHydrating);
  }

  get projectLoadError() {
    return this.#projectWorkflow?.projectLoadError || null;
  }

  refreshProject(input) {
    return this.#requireProjectWorkflow().refreshWorkspace(input);
  }

  retryProjectHydration() {
    return this.#requireProjectWorkflow().retryHydration();
  }

  prepareProjectSwitch(input) {
    return this.#requireProjectWorkflow().prepareSwitch(input);
  }

  openProject(input) {
    return this.#requireProjectWorkflow().openProject(input);
  }

  acceptProject(project, input) {
    return this.#requireProjectWorkflow().acceptProject(project, input);
  }

  acceptBrowserProject(input) {
    return this.#requireProjectWorkflow().acceptBrowserProject(input);
  }

  acceptExternalProject(input) {
    return this.#requireProjectWorkflow().acceptExternalProject(input);
  }

  resumeDeferredExternalProject() {
    return this.#requireProjectWorkflow().resumeDeferredExternalProject();
  }

  resumeDeferredProjectApplication() {
    return this.#requireProjectWorkflow().resumeDeferredProjectApplication();
  }

  reconcileProjectTransitions() {
    return this.#requireProjectWorkflow().reconcileDeferred();
  }

  prepareClose(input) {
    return this.#requireProjectWorkflow().prepareClose(input);
  }

  abortClose(input) {
    return this.#requireProjectWorkflow().abortClose(input);
  }

  hasPendingDrain(boundary) {
    return this.#requireProjectWorkflow().hasPending(boundary);
  }

  inspectDrain(boundary) {
    return this.#requireProjectWorkflow().inspectDrain(boundary);
  }

  drainBoundary(boundary, input) {
    return this.#requireProjectWorkflow().drain(boundary, input);
  }

  drainCloseFallback(input) {
    return this.#requireProjectWorkflow().drainCloseFallback(input);
  }

  readProjectFile(input) {
    return this.#requireProjectWorkflow().readProjectFile(input);
  }

  openProjectRecords(input) {
    return this.#requireProjectWorkflow().openProjectRecords(input);
  }

  refreshRecentProjects() {
    return this.#requireProjectWorkflow().refreshRecents();
  }

  openProjectRules(input) {
    return this.#requireProjectRulesWorkflow().open(input);
  }

  updateProjectRules(input) {
    return this.#requireProjectRulesWorkflow().updateContent(input);
  }

  beginProjectRulesComposition(input) {
    return this.#requireProjectRulesWorkflow().beginComposition(input);
  }

  finishProjectRulesComposition(input) {
    return this.#requireProjectRulesWorkflow().finishComposition(input);
  }

  leaveProjectRulesEditor() {
    return this.#requireProjectRulesWorkflow().leaveEditor();
  }

  restoreProjectRules() {
    return this.#requireProjectRulesWorkflow().restore();
  }

  saveProjectRules() {
    return this.#requireProjectRulesWorkflow().save();
  }

  closeProjectRules() {
    return this.#requireProjectRulesWorkflow().close();
  }

  renameProjectSource(input) {
    return this.#requireProjectWorkflow().renameSource(input);
  }

  submitRequest(input) {
    return this.#requireRunWorkflow().submit(input);
  }

  reconcileRunSubmission(input) {
    return this.#requireRunWorkflow().reconcileSubmission(input);
  }

  pollRuns(input) {
    return this.#requireRunWorkflow().pollNow(input);
  }

  copyRunHandoff(input) {
    return this.#requireRunWorkflow().copyHandoff(input);
  }

  cancelRun(input) {
    return this.#requireRunWorkflow().cancel(input);
  }

  resolveRunConflict(input) {
    return this.#requireRunWorkflow().resolveConflict(input);
  }

  prepareReviewCandidate(input) {
    return this.#requireVersionWorkflow().prepareReviewCandidate(input);
  }

  activateReadyVersion(input) {
    return this.#requireVersionWorkflow().activateReadyVersion(input);
  }

  openCommittedVersion(input) {
    return this.#requireVersionWorkflow().openCommittedVersion(input);
  }

  viewHistory(input) {
    return this.#requireVersionWorkflow().viewHistory(input);
  }

  returnToCurrent(input) {
    return this.#requireVersionWorkflow().returnToCurrent(input);
  }

  enqueueDocumentEdit(input) {
    return this.#requireDocumentWorkflow().enqueueEdit(input);
  }

  flushDocument(input) {
    return this.#requireDocumentWorkflow().flush(input);
  }

  performDocumentHistoryAction(input) {
    return this.#requireDocumentWorkflow().performHistoryAction(input);
  }

  reloadDocumentAuthority(input) {
    return this.#requireDocumentWorkflow().reloadAuthority(input);
  }

  ensureDocumentCanvas(input) {
    return this.#requireDocumentWorkflow().ensureCurrentCanvas(input);
  }

  reconcileDocumentBoundary(input) {
    return this.#requireDocumentWorkflow().reconcileBoundary(input);
  }

  recoverDocumentAutosave(input) {
    return this.#requireDocumentWorkflow().recoverAutosave(input);
  }

  adoptDocumentConflictCandidate(input) {
    return this.#requireDocumentWorkflow().adoptConflictCandidate(input);
  }

  resetDocumentWorkflow(input) {
    return this.#requireDocumentWorkflow().resetForProjectTransition(input);
  }

  clearDocumentRecovery(context) {
    return this.#requireDocumentWorkflow().clearRecovery(context);
  }

  clearDocumentAutosaveTimer() {
    return this.#requireDocumentWorkflow().clearAutosaveTimer();
  }

  clearDocumentAudit() {
    return this.#requireDocumentWorkflow().clearAudit();
  }

  replaceDocumentRecoveryIdentity(identity) {
    return this.#requireDocumentWorkflow().replaceRecoveryIdentity(identity);
  }

  activateDocumentSourceHistory(input) {
    return this.#requireDocumentWorkflow().activateSourceHistory(input);
  }

  waitForDocumentHistoryAction() {
    return this.#requireDocumentWorkflow().waitForHistoryAction();
  }

  queueDraft() {
    return this.#requireCommentWorkflow().queueDraft();
  }

  flushDraft(input) {
    return this.#requireCommentWorkflow().flushDraft(input);
  }

  commitComment(input) {
    return this.#requireCommentWorkflow().commitComment(input);
  }

  editComment(input) {
    return this.#requireCommentWorkflow().editComment(input);
  }

  deleteComment(input) {
    return this.#requireCommentWorkflow().deleteComment(input);
  }

  discardCommentComposer() {
    return this.#requireCommentWorkflow().discardComposer();
  }

  cancelCommentEdit(input) {
    return this.#requireCommentWorkflow().cancelCommentEdit(input);
  }

  removeComposerAttachment(input) {
    return this.#requireCommentWorkflow().removeComposerAttachment(input);
  }

  removeCommentEditAttachment(input) {
    return this.#requireCommentWorkflow().removeEditAttachment(input);
  }

  uploadAttachments(input) {
    return this.#requireCommentWorkflow().uploadAttachments(input);
  }

  readAttachment(input) {
    return this.#requireCommentWorkflow().readAttachment(input);
  }

  deleteAttachment(input) {
    return this.#requireCommentWorkflow().deleteAttachment(input);
  }

  resetCommentWorkflow() {
    return this.#requireCommentWorkflow().resetForProjectTransition();
  }

  #requireDocumentWorkflow() {
    if (!this.#documentWorkflow) {
      throw new Error("文档持久化工作流尚未完成组合。");
    }
    return this.#documentWorkflow;
  }

  #requireProjectWorkflow() {
    if (!this.#projectWorkflow) {
      throw new Error("项目切换工作流尚未完成组合。");
    }
    return this.#projectWorkflow;
  }

  #requireProjectRulesWorkflow() {
    if (!this.#projectRulesWorkflow) {
      throw new Error("项目规则工作流尚未完成组合。");
    }
    return this.#projectRulesWorkflow;
  }

  #requireCommentWorkflow() {
    if (!this.#commentWorkflow) {
      throw new Error("评论工作流尚未完成组合。");
    }
    return this.#commentWorkflow;
  }

  #requireRunWorkflow() {
    if (!this.#runWorkflow) {
      throw new Error("任务运行工作流尚未完成组合。");
    }
    return this.#runWorkflow;
  }

  #requireVersionWorkflow() {
    if (!this.#versionWorkflow) {
      throw new Error("版本工作流尚未完成组合。");
    }
    return this.#versionWorkflow;
  }

  ensureRegistered({
    sourcePath,
    expectedSourceSha256,
    adoptCanonicalSource = true,
  } = {}) {
    if (this.#disposed) {
      return Promise.resolve(blocked(
        "WORKSPACE_CONTROLLER_DISPOSED",
        "项目资料初始化已停止。",
      ));
    }
    const activeSource = sourcePath || this.#projectSession.sourcePath;
    const expectedHash = expectedSourceSha256 || this.#documentSession.sourceSha256;
    if (!activeSource || !expectedHash) {
      return Promise.resolve(blocked(
        "PROJECT_REGISTRATION_PRECONDITION",
        "当前页面缺少可验证的源文件身份。",
      ));
    }
    if (this.#registrationPromise) {
      const inFlight = this.#snapshot.registration.identity;
      if (
        inFlight
        && inFlight.epoch === this.#projectSession.epoch
        && this.#codecs.sameSourcePath(inFlight.sourcePath, activeSource)
      ) {
        return this.#registrationPromise;
      }
      // A source switch retires the older operation. Do not force the new
      // project to await a result that can only become stale.
      this.#registrationPromise = null;
    }

    const existingContext = this.#projectSession.context;
    if (existingContext && this.#draftSession.isActive(existingContext)) {
      return Promise.resolve(succeeded(existingContext));
    }

    const operationId = this.#nextOperationId();
    const identity = copyLocator({
      operationId,
      epoch: existingContext?.epoch ?? this.#projectSession.epoch,
      sourcePath: activeSource,
      expectedSourceSha256: expectedHash,
    });
    this.#publishSnapshot({
      phase: "registering",
      operationId,
      identity,
    });
    const registration = existingContext
      ? this.#restoreDraftAuthority({ existingContext, activeSource, identity })
      : this.#createRegistration({
          activeSource,
          expectedHash,
          adoptCanonicalSource,
          identity,
        });
    this.#registrationPromise = registration;
    registration.then(
      (outcome) => this.#settleRegistration(registration, outcome),
      (cause) => this.#settleRegistration(
        registration,
        rejected(registrationErrorCode(cause), String(cause?.message || cause)),
      ),
    );
    return registration;
  }

  #nextOperationId() {
    this.#registrationSequence += 1;
    return [
      "registration",
      Math.max(0, Number(this.#clock.now()) || 0).toString(36),
      this.#registrationSequence.toString(36),
    ].join("_");
  }

  #publishSnapshot({ phase, operationId = null, identity = null, outcome = null }) {
    this.#registration = registrationSnapshot({
      phase,
      operationId,
      identity,
      outcome,
    }).registration;
    this.#publishAggregateSnapshot();
  }

  #publishAggregateSnapshot() {
    this.#snapshot = Object.freeze({
      registration: this.#registration,
      comment: this.#commentWorkflow?.getSnapshot() || null,
      projectRules: this.#projectRulesSnapshot,
      project: this.#projectSnapshot,
      run: this.#runSnapshot,
      version: this.#versionSnapshot,
    });
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // Presentation listeners cannot affect application authority.
      }
    }
  }

  #emitEvent(event) {
    const frozen = Object.freeze(event);
    for (const listener of this.#eventListeners) {
      try {
        listener(frozen);
      } catch {
        // Presentation listeners cannot affect application authority.
      }
    }
  }

  #isCurrentLocator(identity) {
    return Boolean(
      !this.#disposed
      && this.#projectSession.epoch === identity.epoch
      && this.#codecs.sameSourcePath(
        this.#projectSession.sourcePath,
        identity.sourcePath,
      )
      && this.#documentSession.sourceSha256 === identity.expectedSourceSha256,
    );
  }

  #outcomeFromCause(identity, cause) {
    if (isBridgeRequestError(cause) && cause.outcome === "unknown") {
      return unknown(identity.operationId, String(cause.message || "项目资料初始化结果未知。"));
    }
    return rejected(
      registrationErrorCode(cause),
      String(cause?.message || "项目资料暂时无法建立。"),
    );
  }

  async #restoreDraftAuthority({ existingContext, activeSource, identity }) {
    try {
      const payload = await this.#bridgeClient.workspace(activeSource);
      if (
        !this.#isCurrentLocator(identity)
        || !this.#projectSession.matches(existingContext)
      ) return stale(identity);
      if (
        String(payload.projectId || "") !== existingContext.projectId
        || String(payload.documentId || "") !== existingContext.documentId
        || !this.#codecs.sameSourcePath(
          String(payload.sourcePath || activeSource),
          activeSource,
        )
      ) {
        return rejected(
          "PROJECT_REGISTRATION_IDENTITY_MISMATCH",
          "项目记录的身份与当前页面不一致，已停止恢复评论会话。",
        );
      }
      const authoritativeDraft = this.#codecs.draftAuthorityFromWorkspace(payload);
      this.#draftSession.replaceAuthority(
        existingContext,
        this.#codecs.authoritativeDraftRevision(authoritativeDraft),
        authoritativeDraft,
      );
      this.#commentWorkflow?.reconcileAuthority();
      this.#emitEvent({
        type: "draft-authority-rebound",
        context: existingContext,
      });
      return succeeded(existingContext);
    } catch (cause) {
      return this.#outcomeFromCause(identity, cause);
    }
  }

  async #createRegistration({
    activeSource,
    expectedHash,
    adoptCanonicalSource,
    identity,
  }) {
    try {
      const payload = await this.#bridgeClient.ensureProject({
        sourcePath: activeSource,
        expectedSourceSha256: expectedHash,
      });
      if (payload.ok === false) {
        return rejected(
          "PROJECT_REGISTRATION_REJECTED",
          "无法建立项目记录。",
        );
      }
      if (!this.#isCurrentLocator(identity)) return stale(identity);

      const nextProjectId = String(payload.projectId || "");
      const nextDocumentId = String(payload.documentId || "");
      const nextSourceSha256 = String(
        payload.currentHtmlSha256 || payload.sourceSha256 || "",
      );
      const canonicalSource =
        typeof payload.content === "string" ? payload.content : "";
      const hasCanonicalSource = typeof payload.content === "string";
      if (
        !nextProjectId
        || !nextDocumentId
        || !/^sha256:[a-f0-9]{64}$/u.test(nextSourceSha256)
        || (
          hasCanonicalSource
          && await this.#hashPort.sha256(canonicalSource) !== nextSourceSha256
        )
      ) {
        return rejected(
          "PROJECT_REGISTRATION_PAYLOAD_INVALID",
          "项目记录已建立，但返回的身份或源文件校验不完整。",
        );
      }

      const currentDocument = this.#documentSession.snapshot;
      const currentHtmlSha256 = await this.#hashPort.sha256(currentDocument.html);
      if (!this.#isCurrentLocator(identity)) return stale(identity);
      const currentDocumentClean = Boolean(
        currentDocument.editRevision === currentDocument.lastPersistedRevision
        && !this.#documentSession.pendingWrite
        && !this.#documentSession.flushPromise,
      );
      const mustRepairCleanProjection = Boolean(
        currentDocumentClean && currentHtmlSha256 !== nextSourceSha256,
      );
      if (mustRepairCleanProjection && !hasCanonicalSource) {
        return rejected(
          "PROJECT_REGISTRATION_CANONICAL_SOURCE_MISSING",
          "项目记录与当前画布不一致，且缺少可自动恢复的完整源 HTML。",
        );
      }
      const shouldAdoptCanonicalSource = Boolean(
        hasCanonicalSource
        && currentDocumentClean
        && (adoptCanonicalSource || mustRepairCleanProjection),
      );
      const nextDocumentHtml = shouldAdoptCanonicalSource
        ? canonicalSource
        : currentDocument.html;
      const projectRecord = this.#codecs.isRecord(payload.project)
        ? payload.project
        : {};
      const paths = this.#codecs.isRecord(payload.paths) ? payload.paths : {};
      if (this.#projectSession.context) return stale(identity);
      const registeredContext = this.#projectSession.register({
        epoch: identity.epoch,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        sourcePath: activeSource,
      });
      if (!registeredContext) return stale(identity);

      const recoveryIdentity = this.#codecs.recoveryIdentityFromRecord(
        payload.recoveryIdentity,
      );
      this.#recoveryPort.replace(recoveryIdentity);
      this.#documentWorkflow?.replaceRecoveryIdentity(recoveryIdentity);
      if (shouldAdoptCanonicalSource) {
        this.#documentSession.publishAuthority({
          html: nextDocumentHtml,
          sourceSha256: nextSourceSha256,
        });
        this.#canvasPort.invalidateRenderAcks();
      } else {
        this.#documentSession.update({
          html: nextDocumentHtml,
          sourceSha256: nextSourceSha256,
        });
      }
      this.#versionSession.hydrate({
        versions: this.#codecs.versionsFromWorkspace(payload),
        latestVersionId: payload.latestVersionId,
        currentBasedOnVersionId: payload.currentBasedOnVersionId,
        currentExactVersionId: payload.currentExactVersionId,
      });
      if (shouldAdoptCanonicalSource) {
        const reboundTargets = this.#codecs.rebindTargetsPreservingGlobal(
          canonicalSource,
          [
            ...this.#commentSession.comments.map((comment) => comment.target),
            ...(
              this.#commentSession.composerTarget
                ? [this.#commentSession.composerTarget]
                : []
            ),
          ],
        );
        const reboundById = new Map(
          reboundTargets.map((target) => [target.id, target]),
        );
        this.#commentSession.setComments(
          this.#commentSession.comments.map((comment) => ({
            ...comment,
            target: reboundById.get(comment.target.id) || comment.target,
          })),
        );
        if (this.#commentSession.composerTarget) {
          this.#commentSession.setComposerTarget(
            reboundById.get(this.#commentSession.composerTarget.id)
              || this.#commentSession.composerTarget,
          );
        }
      }
      const authoritativeDraft = this.#codecs.draftAuthorityFromWorkspace(payload);
      this.#draftSession.replaceAuthority(
        registeredContext,
        this.#codecs.authoritativeDraftRevision(authoritativeDraft),
        authoritativeDraft,
      );
      this.#commentWorkflow?.reconcileAuthority();
      if (this.#codecs.isRecord(payload.sourceHistory)) {
        this.#sourceHistorySession.activate(
          registeredContext,
          nextSourceSha256,
          payload.sourceHistory,
          { preservePending: true },
        );
      }
      this.#emitEvent({
        type: "registration-published",
        context: registeredContext,
        projectRecordsPath: String(
          paths.projectRecords || payload.projectRoot || "",
        ) || null,
        projectName: projectRecord.displayName
          ? String(projectRecord.displayName)
          : null,
        canonicalSourceAdopted: shouldAdoptCanonicalSource,
      });
      return succeeded(registeredContext);
    } catch (cause) {
      return this.#outcomeFromCause(identity, cause);
    }
  }

  #settleRegistration(registration, outcome) {
    if (this.#registrationPromise !== registration) return;
    this.#registrationPromise = null;
    this.#publishSnapshot({
      phase: "idle",
      outcome,
      identity: outcome.status === "stale"
        ? outcome.identity
        : this.#snapshot.registration.identity,
    });
  }
}
