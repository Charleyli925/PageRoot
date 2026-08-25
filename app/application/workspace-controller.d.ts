import type { BridgeClient } from "./bridge-client.js";
import type {
  AttachmentBinaryPort,
  CommentWorkflowOutcome,
  CommentWorkflowSnapshot,
} from "./comment-workflow.js";
import type { CommentWorkflowCodecs } from "./comment-workflow-codecs.js";
import type {
  DocumentWorkflowCanvasPort,
  DocumentWorkflowOutcome,
  DocumentWorkflowRecoveryStore,
} from "./document-workflow.js";
import type { DocumentWorkflowCodecs } from "./document-workflow-codecs.js";
import type { CommentSession, CommentSessionSnapshot } from "./comment-session.js";
import type {
  ConversationContext,
  ConversationSession,
  ConversationSessionSnapshot,
} from "./conversation-session.js";
import type {
  DiscussionTurnContext,
  DiscussionTurnSession,
  DiscussionTurnSnapshot,
} from "./discussion-turn-session.js";
import type {
  DocumentSession,
  DocumentSessionSnapshot,
  PersistedBoundaryResult,
} from "./document-session.js";
import type { DraftSession } from "./draft-session.js";
import type {
  EditAuthorRuntimePort,
  EditAuthorRuntimeSnapshot,
} from "./edit-author-runtime-session.js";
import type {
  FirstEditGuideEligibilityInput,
  FirstEditGuidePort,
  FirstEditGuideSnapshot,
} from "./first-edit-guide-session.js";
import type {
  ProjectContext,
  ProjectSession,
  ProjectSessionSnapshot,
} from "./project-session.js";
import type {
  ProjectRulesPresentationPort,
  ProjectRulesScheduler,
  ProjectRulesWorkflowOutcome,
} from "./project-rules-workflow.js";
import type { ProjectRulesSnapshot } from "./project-rules-session.js";
import type { RecoveryStore } from "./recovery-store.js";
import type { RunSessionSnapshot } from "./run-session.js";
import type { SourceHistorySession } from "./source-history-session.js";
import type { VersionSession, VersionSessionSnapshot } from "./version-session.js";
import type {
  ProjectWorkflowConstruction,
  ProjectWorkflowEvent,
  ProjectWorkflowOutcome,
  ProjectWorkflowProject,
  ProjectWorkflowSnapshot,
} from "./project-workflow.js";
import type {
  RunWorkflowCodecs,
  RunWorkflowEvent,
  RunWorkflowOutcome,
  RunWorkflowSnapshot,
} from "./run-workflow.js";
import type {
  VersionWorkflowCanvasPort,
  VersionWorkflowCodecs,
  VersionWorkflowEvent,
  VersionWorkflowOutcome,
  VersionReviewCandidate,
  VersionWorkflowSnapshot,
} from "./version-workflow.js";

export type OperationIdentity = Readonly<{
  operationId: string;
  epoch: number;
  sourcePath: string;
  expectedSourceSha256: string | null;
}>;

export type RecoveryIntent = Readonly<{
  kind: string;
  operationId?: string;
}>;

export type CommandOutcome<T> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{
      status: "blocked";
      code: string;
      reason: string;
      recovery?: RecoveryIntent;
    }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{ status: "stale"; identity: OperationIdentity }>;

export type WorkspaceControllerSnapshot = Readonly<{
  registration: Readonly<{
    phase: "idle" | "registering";
    operationId: string | null;
    identity: OperationIdentity | null;
    outcome: CommandOutcome<ProjectContext> | null;
  }>;
  projectSession: ProjectSessionSnapshot | null;
  document: DocumentSessionSnapshot | null;
  commentSession: CommentSessionSnapshot | null;
  runSession: RunSessionSnapshot | null;
  versionSession: VersionSessionSnapshot | null;
  editRuntime: EditAuthorRuntimeSnapshot | null;
  firstEditGuide: FirstEditGuideSnapshot | null;
  comment: CommentWorkflowSnapshot | null;
  projectRules: ProjectRulesSnapshot | null;
  project: ProjectWorkflowSnapshot | null;
  run: RunWorkflowSnapshot | null;
  version: VersionWorkflowSnapshot | null;
  conversation: ConversationSessionSnapshot | null;
  discussionTurn: DiscussionTurnSnapshot | null;
}>;

export type WorkspaceEvent =
  | Readonly<{
      type: "registration-published";
      context: ProjectContext;
      projectRecordsPath: string | null;
      projectName: string | null;
      imported?: boolean;
      canonicalSourceAdopted: boolean;
    }>
  | Readonly<{
      type: "draft-authority-rebound";
      context: ProjectContext;
    }>
  | Readonly<{
      type:
        | "document-direct-edit-recorded"
        | "document-edit-queued"
        | "document-persisted"
        | "document-open-target-rebound"
        | "document-persistence-failed"
        | "document-authority-reloaded"
        | "document-authority-reload-failed"
        | "document-authority-repaired"
        | "document-boundary-reconciled"
        | "document-recovery-queued"
        | "document-history-failed"
        | "document-history-applied";
      context?: ProjectContext;
      [key: string]: unknown;
    }>
  | Readonly<{
      type:
        | "comment-draft-persistence-failed"
        | "comment-draft-persisted"
        | "attachment-uploaded"
        | "attachment-cleanup-failed";
      context?: ProjectContext | null;
      [key: string]: unknown;
    }>
  | ProjectWorkflowEvent
  | RunWorkflowEvent
  | VersionWorkflowEvent;

export type RegistrationInput = Readonly<{
  sourcePath?: string;
  expectedSourceSha256?: string | null;
  adoptCanonicalSource?: boolean;
}>;

export type HashPort = Readonly<{
  sha256(html: string): Promise<string>;
}>;

export type RecoveryPort = Readonly<{
  replace(identity: unknown): void;
}>;

export type CanvasAuthorityPort = Readonly<{
  invalidateRenderAcks(): void;
}>;

export type ProjectSourceActivationPort = Readonly<{
  activateManagedWorkingCopy(input: Readonly<{
    previousSourcePath: string;
    nextSourcePath: string;
    expectedSha256: string;
    projectId: string;
    documentId: string;
    workingCopyId: string;
    versionId: string;
    projectRootPath: string;
  }>): Promise<Readonly<{
    sourcePath: string;
    sha256: string;
    html: string;
  }>>;
}>;

export type ClockPort = Readonly<{
  now(): number;
}>;

export type WorkspaceControllerCodecs = Readonly<{
  isRecord(value: unknown): value is Record<string, unknown>;
  sameSourcePath(left: string | null, right: string | null): boolean;
  draftAuthorityFromWorkspace(
    payload: Record<string, unknown>,
  ): Record<string, unknown>;
  authoritativeDraftRevision(draft: Record<string, unknown>): number;
  recoveryIdentityFromRecord(value: unknown): unknown;
  versionsFromWorkspace(payload: Record<string, unknown>): unknown[];
  rebindTargetsPreservingGlobal(
    html: string,
    targets: unknown[],
  ): unknown[];
}>;

export type WorkspaceControllerConstruction = Readonly<{
  bridgeClient: Pick<
    BridgeClient,
    | "ensureProject"
    | "workspace"
    | "autosave"
    | "source"
    | "sourceHistoryAction"
    | "resolveConflict"
    | "conflictCandidate"
    | "sourcePreview"
    | "sourceStat"
    | "projectFile"
    | "openFolder"
    | "attachment"
    | "saveAttachment"
    | "deleteAttachment"
    | "createRequest"
    | "status"
    | "cancelActiveRun"
    | "versionFile"
    | "activateReadyVersion"
    | "updateProjectFile"
  >;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  commentSession: CommentSession;
  draftSession: DraftSession;
  versionSession: VersionSession;
  sourceHistorySession: SourceHistorySession;
  conversationSession?: ConversationSession | null;
  discussionTurnSession?: DiscussionTurnSession | null;
  codecs: WorkspaceControllerCodecs;
  ports: Readonly<{
    hash: HashPort;
    recovery?: RecoveryPort;
    canvas?: CanvasAuthorityPort;
    projectSource?: ProjectSourceActivationPort;
    editRuntime?: EditAuthorRuntimePort;
    uiPreferences?: FirstEditGuidePort;
  }>;
  documentWorkflow?: Readonly<{
    codecs: DocumentWorkflowCodecs;
    recoveryStore: DocumentWorkflowRecoveryStore;
    canvas?: Omit<DocumentWorkflowCanvasPort, "invalidateRenderAcks">;
    scheduler?: Readonly<{
      setTimeout(callback: () => void, delayMs: number): unknown;
      clearTimeout(handle: unknown): void;
    }>;
  }>;
  commentWorkflow?: Readonly<{
    runSession: import("./run-session.js").RunSession;
    codecs: CommentWorkflowCodecs;
    recoveryStore: import("./recovery-store.js").RecoveryStore;
    attachmentBinary: AttachmentBinaryPort;
  }>;
  projectRulesWorkflow?: Readonly<{
    runSession: import("./run-session.js").RunSession;
    errorMessage?: (cause: unknown, fallback: string) => string;
    presentation?: ProjectRulesPresentationPort;
    scheduler?: ProjectRulesScheduler;
  }>;
  projectWorkflow?: Pick<
    ProjectWorkflowConstruction,
    | "runSession"
    | "codecs"
    | "ports"
    | "policies"
    | "scheduler"
  >;
  runWorkflow?: Readonly<{
    runSession: import("./run-session.js").RunSession;
    codecs: RunWorkflowCodecs;
    canvas: Readonly<{
      fencePendingEdit?(input: Record<string, unknown>): {
        ok: boolean;
        reason?: string;
      } | undefined;
      freeze(reason: string): Record<string, unknown>;
      unlock(): void;
      normalizeComments?(): unknown[];
    }>;
    handoff: Readonly<{
      copy(input: {
        message: string;
        run: import("../domain/run-lifecycle.js").ActiveRun | null;
        purpose?: string;
      }): Promise<{ status: string; copied: boolean }>;
    }>;
    scheduler?: Readonly<{
      setInterval(callback: () => void, delayMs: number): unknown;
      clearInterval(handle: unknown): void;
    }>;
  }>;
  versionWorkflow?: Readonly<{
    runSession: import("./run-session.js").RunSession;
    codecs: VersionWorkflowCodecs;
    canvas: VersionWorkflowCanvasPort;
  }>;
  clock: ClockPort;
}>;

export type RuntimeWorkspaceControllerConstruction = Readonly<{
  initial?: Readonly<{
    documentHtml?: string;
    runSourcePath?: string | null;
  }>;
  draftSession?: Readonly<{
    encodeComment?: (value: never) => unknown;
    encodeChangeEvent?: (value: never) => unknown;
  }>;
  codecs: WorkspaceControllerCodecs;
  ports: WorkspaceControllerConstruction["ports"];
  recoveryStore?: RecoveryStore;
  documentWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["documentWorkflow"]>,
    "recoveryStore"
  > & Partial<Pick<
    NonNullable<WorkspaceControllerConstruction["documentWorkflow"]>,
    "recoveryStore"
  >>;
  commentWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["commentWorkflow"]>,
    "runSession" | "recoveryStore"
  > & Partial<Pick<
    NonNullable<WorkspaceControllerConstruction["commentWorkflow"]>,
    "recoveryStore"
  >>;
  projectRulesWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["projectRulesWorkflow"]>,
    "runSession"
  >;
  projectWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["projectWorkflow"]>,
    "runSession" | "ports"
  > & Readonly<{
    ports: Omit<ProjectWorkflowConstruction["ports"], "recentRuns">;
  }>;
  runWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["runWorkflow"]>,
    "runSession"
  >;
  versionWorkflow: Omit<
    NonNullable<WorkspaceControllerConstruction["versionWorkflow"]>,
    "runSession"
  >;
  clock: ClockPort;
}>;

export class WorkspaceRegistrationError extends Error {
  readonly code: string;
  readonly operationId?: string;
}

export function registrationContextFromOutcome(
  outcome: CommandOutcome<ProjectContext>,
): ProjectContext | null;

export function createRuntimeWorkspaceController(
  options: RuntimeWorkspaceControllerConstruction,
): WorkspaceController;

// The class retains injected construction for isolated Application tests. The
// production renderer must use createRuntimeWorkspaceController instead.
export class WorkspaceController {
  constructor(options: WorkspaceControllerConstruction);
  getSnapshot(): WorkspaceControllerSnapshot;
  openConversation(
    context: ConversationContext | null,
  ): Promise<unknown>;
  closeConversation(context?: ConversationContext | null): boolean;
  updateConversationDraftText(text: string): void;
  updateConversationDraftIntent(intent: string): void;
  updateConversationDraftAgentSelection(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
    modelDisplayName?: string | null,
  ): void;
  flushConversationDraft(): Promise<void>;
  startDiscussionTurn(
    context: DiscussionTurnContext | null,
    options?: {
      question?: string;
      conversationId?: string | null;
      expectedSourceSha256?: string | null;
    },
  ): Promise<unknown>;
  cancelDiscussionTurn(): Promise<DiscussionTurnSnapshot | null>;
  drainDiscussionTurn(): Promise<void>;
  closeDiscussionTurn(): void;
  subscribe(
    listener: (snapshot: WorkspaceControllerSnapshot) => void,
  ): () => void;
  subscribeEvents(listener: (event: WorkspaceEvent) => void): () => void;
  readonly projectHydrating: boolean;
  readonly projectLoadError: string | null;
  startEditAuthorRuntimePreparation(input: {
    sourceSha256: string;
    canvasGeneration: number;
  }): boolean;
  beginEditAuthorRuntime(input: {
    sessionId: string;
    sourceSha256: string;
    canvasGeneration: number;
  }): boolean;
  settleEditAuthorRuntime(input: {
    sessionId: string;
    sourceSha256: string;
    canvasGeneration: number;
    outcome: "ready" | "rejected" | "failed";
  }): boolean;
  evaluateFirstEditGuide(input: FirstEditGuideEligibilityInput): FirstEditGuideSnapshot | null;
  dismissFirstEditGuide(): Promise<FirstEditGuideSnapshot | null>;
  getCurrentProjectContext(): ProjectContext | null;
  matchesCurrentProjectContext(context: ProjectContext): boolean;
  reloadDocumentCanvas(): DocumentSessionSnapshot;
  replaceCommentWorkingCopy(
    input: Record<string, unknown>,
  ): CommentSessionSnapshot;
  replaceCommentItems(comments: unknown[]): CommentSessionSnapshot;
  setCommentComposerTarget(target: unknown): CommentSessionSnapshot;
  setCommentComposerDraft(draft: string): CommentSessionSnapshot;
  setCommentEditSession(session: unknown): CommentSessionSnapshot;
  clearCommentComposer(): CommentSessionSnapshot;
  clearCompletedRun(): boolean;
  dismissActiveRun(): import("../domain/run-lifecycle.js").ActiveRun | null;
  reopenRecentRunOutcome(sourcePath: string | null | undefined): boolean;
  refreshProject(input?: Record<string, unknown>): Promise<ProjectWorkflowOutcome>;
  retryProjectHydration(): Promise<ProjectWorkflowOutcome>;
  prepareProjectSwitch(input?: {
    fromDeferred?: boolean;
  }): Promise<ProjectWorkflowOutcome>;
  openProject(input?: {
    kind?: "local" | "recent" | "registered" | "startup";
    sourcePath?: string | null;
    projectId?: string | null;
    fromDeferred?: boolean;
  }): Promise<ProjectWorkflowOutcome>;
  acceptProject(
    project: ProjectWorkflowProject,
    input?: { kind?: string; operationId?: string; sourcePath?: string | null },
  ): ProjectWorkflowOutcome;
  acceptBrowserProject(input: {
    operationId?: string;
    project: ProjectWorkflowProject;
  }): ProjectWorkflowOutcome;
  acceptExternalProject(input: {
    requestId: string;
    sourcePath?: string;
  }): ProjectWorkflowOutcome;
  confirmExternalOpen(input?: {
    requestId?: string;
    action?: string;
    deleteOriginal?: boolean;
  }): Promise<ProjectWorkflowOutcome>;
  cancelExternalOpen(input?: { requestId?: string }): ProjectWorkflowOutcome;
  setExternalOpenDeleteOriginal(input?: {
    requestId?: string;
    deleteOriginal?: boolean;
  }): ProjectWorkflowOutcome;
  retryExternalOpen(input?: { requestId?: string }): Promise<ProjectWorkflowOutcome>;
  acknowledgeEditCanvas(input?: {
    generation?: number;
    renderedSha256?: string | null;
  }): boolean;
  retryCanvasVerification(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome>;
  resumeDeferredExternalProject(): ProjectWorkflowOutcome;
  resumeDeferredProjectApplication(): ProjectWorkflowOutcome;
  reconcileProjectTransitions(): void;
  prepareClose(input: {
    requestId: string;
    deadlineAt: number;
  }): Promise<Readonly<{
    ready: boolean;
    reason?: string;
    presentation?: "in-app" | "native";
  }>>;
  abortClose(input: { requestId: string }): void;
  hasPendingDrain(boundary: string): boolean;
  inspectDrain(boundary: string): ReadonlyArray<Record<string, unknown>>;
  drainBoundary(boundary: string, input: { deadlineAt: number }): Promise<Readonly<{
    ok: boolean;
    obligation?: string;
    reason?: string;
  }>>;
  drainCloseFallback(input?: { deadlineAt?: number }): Promise<Readonly<{
    ok: boolean;
    obligation?: string;
    reason?: string;
  }>>;
  readProjectFile(input?: {
    context?: ProjectContext;
    relativePath?: string;
  }): Promise<ProjectWorkflowOutcome<{ content: string }>>;
  openProjectRecords(input?: {
    context?: ProjectContext;
  }): Promise<ProjectWorkflowOutcome<{ opened: boolean }>>;
  refreshRecentProjects(): Promise<ProjectWorkflowOutcome<{ projects: unknown[] }>>;
  refreshRegisteredProjects(): Promise<ProjectWorkflowOutcome<{ projects: unknown[] }>>;
  openProjectRules(input: {
    context: ProjectContext;
  }): Promise<ProjectRulesWorkflowOutcome<{
    opened: boolean;
    reused?: boolean;
  }>>;
  updateProjectRules(input: { content: string }): ProjectRulesWorkflowOutcome<{
    updated: boolean;
  }>;
  beginProjectRulesComposition(input: {
    target: unknown;
    baselineValue: string;
  }): number | null;
  finishProjectRulesComposition(input: { target: unknown }): boolean;
  leaveProjectRulesEditor(): boolean;
  restoreProjectRules(): ProjectRulesWorkflowOutcome<{
    restored: boolean;
    editorGeneration: number;
  }>;
  saveProjectRules(): Promise<ProjectRulesWorkflowOutcome<{
    saved: boolean;
    reconciled?: boolean;
  }>>;
  closeProjectRules(): Promise<ProjectRulesWorkflowOutcome<{ closed: boolean }>>;
  renameProjectSource(input: {
    stem: string;
    deadlineAt?: number;
  }): Promise<ProjectWorkflowOutcome<{
    context: ProjectContext;
    sourcePath: string;
    projectName?: string;
    lastModifiedAt?: string | null;
    unchanged?: boolean;
  }>>;
  observeExternalSourceChange(input?: {
    reason?: "watch" | "rename" | "startup" | "safe-action";
    watcherGeneration?: number;
    previousSourcePath?: string | null;
    sourceMissing?: boolean;
  }): Promise<ProjectWorkflowOutcome>;
  submitRequest(input?: {
    projectName?: string;
    previousVersionId?: string | null;
    basedOnVersionId?: string | null;
    deadlineAt?: number;
    deliveryMode?: "clipboard" | "managed-agent" | string;
  }): Promise<RunWorkflowOutcome>;
  refreshQoderAvailability(): Promise<RunWorkflowOutcome>;
  checkQoderUsability(): Promise<RunWorkflowOutcome>;
  copyQoderGuidance(input: {
    kind: import("../domain/agent-provider-state.js").AgentProviderGuidanceKind;
  }): Promise<RunWorkflowOutcome>;
  refreshAgentAvailability(): Promise<RunWorkflowOutcome>;
  refreshAgentCatalog(): Promise<RunWorkflowOutcome>;
  selectAgent(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
  ): import("../domain/agent-provider-state.js").AgentSelection;
  restoreAgentSelection(
    selection: import("../domain/agent-provider-state.js").AgentSelection,
  ): import("../domain/agent-provider-state.js").AgentSelection;
  checkAgentUsability(options?: { purpose?: "discussion" | "execution" }): Promise<RunWorkflowOutcome>;
  authenticateAgent(): Promise<RunWorkflowOutcome>;
  copyAgentGuidance(input: {
    kind: import("../domain/agent-provider-state.js").AgentProviderGuidanceKind;
  }): Promise<RunWorkflowOutcome>;
  reconcileRunSubmission(input?: {
    sourcePath?: string | null;
    generation?: number;
  }): Promise<RunWorkflowOutcome>;
  pollRuns(input?: { generation?: number }): Promise<RunWorkflowOutcome>;
  copyRunHandoff(input?: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
  }): Promise<RunWorkflowOutcome>;
  startRunAgent(input?: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
    preflightId?: string | null;
  }): Promise<RunWorkflowOutcome>;
  cancelRun(input?: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
    agentMayBeRunning?: boolean;
    reason?: string;
  }): Promise<RunWorkflowOutcome>;
  resolveRunConflict(input: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
    action: "adopt-ai" | "keep-external";
  }): Promise<RunWorkflowOutcome>;
  prepareReviewCandidate(input: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
  }): Promise<VersionWorkflowOutcome<VersionReviewCandidate>>;
  activateReadyVersion(input: {
    run?: import("../domain/run-lifecycle.js").ActiveRun | null;
    reviewLease?: Readonly<{ operationKey: string; beforeHtml: string }> | null;
  }): Promise<VersionWorkflowOutcome>;
  openCommittedVersion(input: Record<string, unknown>): Promise<VersionWorkflowOutcome>;
  viewHistory(input: Record<string, unknown>): Promise<VersionWorkflowOutcome>;
  returnToCurrent(input?: Record<string, unknown>): Promise<VersionWorkflowOutcome>;
  continueEditingHistoryVersion(input?: Record<string, unknown>): Promise<VersionWorkflowOutcome>;
  ensureRegistered(
    input?: RegistrationInput,
  ): Promise<CommandOutcome<ProjectContext>>;
  readonly hasDocumentHistoryAction: boolean;
  enqueueDocumentEdit(input: Record<string, unknown>): DocumentWorkflowOutcome<{
    revision: number;
    queued: boolean;
  }>;
  flushDocument(input?: { throughRevision?: number }): Promise<DocumentWorkflowOutcome<{
    revision: number;
    idle?: boolean;
  }>>;
  performDocumentHistoryAction(input: {
    direction: "undo" | "redo";
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  reloadDocumentAuthority(input?: {
    context?: ProjectContext;
    acceptExternalConflict?: boolean;
    externalAuthorityAccepted?: boolean;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  previewExternalDocumentSource(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  forceUnlockDocumentConflict(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  ensureDocumentCanvas(input?: {
    context?: ProjectContext;
  }): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  reconcileDocumentBoundary(input: Record<string, unknown>): Promise<DocumentWorkflowOutcome<PersistedBoundaryResult>>;
  recoverDocumentAutosave(input: Record<string, unknown>): Promise<DocumentWorkflowOutcome<Record<string, unknown>>>;
  adoptDocumentConflictCandidate(input: Record<string, unknown>): DocumentWorkflowOutcome<Record<string, unknown>>;
  resetDocumentWorkflow(input?: Record<string, unknown>): void;
  clearDocumentRecovery(context?: Partial<ProjectContext>): void;
  clearDocumentAutosaveTimer(): void;
  clearDocumentAudit(): void;
  replaceDocumentRecoveryIdentity(identity: unknown): unknown;
  activateDocumentSourceHistory(input: {
    context: ProjectContext;
    sourceSha256: string;
    history: unknown;
    preservePending?: boolean;
  }): DocumentWorkflowOutcome<{ active: boolean }>;
  waitForDocumentHistoryAction(): Promise<DocumentWorkflowOutcome<{ idle: boolean }>>;
  queueDraft(): CommentWorkflowOutcome;
  flushDraft(input?: Record<string, unknown>): Promise<CommentWorkflowOutcome>;
  commitComment(input?: { commentId?: string }): Promise<CommentWorkflowOutcome>;
  editComment(input: { commentId: string }): CommentWorkflowOutcome;
  deleteComment(input: { commentId: string }): CommentWorkflowOutcome;
  discardCommentComposer(): CommentWorkflowOutcome;
  cancelCommentEdit(input?: { commentId?: string }): CommentWorkflowOutcome;
  removeComposerAttachment(input: { attachmentId: string }): CommentWorkflowOutcome;
  removeCommentEditAttachment(input: {
    commentId: string;
    attachmentId: string;
  }): CommentWorkflowOutcome;
  uploadAttachments(input: Record<string, unknown>): Promise<CommentWorkflowOutcome>;
  readAttachment(input: Record<string, unknown>): Promise<CommentWorkflowOutcome<Blob>>;
  deleteAttachment(input: Record<string, unknown>): Promise<CommentWorkflowOutcome>;
  resetCommentWorkflow(): void;
  dispose(): void;
}
