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
import type { CommentSession } from "./comment-session.js";
import type { DocumentSession, PersistedBoundaryResult } from "./document-session.js";
import type { DraftSession } from "./draft-session.js";
import type { ProjectContext, ProjectSession } from "./project-session.js";
import type { SourceHistorySession } from "./source-history-session.js";
import type { VersionSession } from "./version-session.js";
import type {
  ProjectWorkflowConstruction,
  ProjectWorkflowEvent,
  ProjectWorkflowOutcome,
  ProjectWorkflowProject,
  ProjectWorkflowSnapshot,
} from "./project-workflow.js";

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
  comment: CommentWorkflowSnapshot | null;
  project: ProjectWorkflowSnapshot | null;
}>;

export type WorkspaceEvent =
  | Readonly<{
      type: "registration-published";
      context: ProjectContext;
      projectRecordsPath: string | null;
      projectName: string | null;
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
  | ProjectWorkflowEvent;

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
    | "projectFile"
    | "openFolder"
    | "attachment"
    | "saveAttachment"
    | "deleteAttachment"
  >;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  commentSession: CommentSession;
  draftSession: DraftSession;
  versionSession: VersionSession;
  sourceHistorySession: SourceHistorySession;
  codecs: WorkspaceControllerCodecs;
  ports: Readonly<{
    hash: HashPort;
    recovery?: RecoveryPort;
    canvas?: CanvasAuthorityPort;
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
  projectWorkflow?: Pick<
    ProjectWorkflowConstruction,
    | "runSession"
    | "projectRulesSession"
    | "codecs"
    | "ports"
    | "policies"
    | "scheduler"
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

// Migration-only construction: the facade receives the Workbench's existing
// Session instances. It neither creates duplicate Session authority nor owns a
// global store; PR-7 removes this construction seam after aggregate wiring.
export class WorkspaceController {
  constructor(options: WorkspaceControllerConstruction);
  getSnapshot(): WorkspaceControllerSnapshot;
  subscribe(
    listener: (snapshot: WorkspaceControllerSnapshot) => void,
  ): () => void;
  subscribeEvents(listener: (event: WorkspaceEvent) => void): () => void;
  readonly projectHydrating: boolean;
  readonly projectLoadError: string | null;
  refreshProject(input?: Record<string, unknown>): Promise<ProjectWorkflowOutcome>;
  retryProjectHydration(): Promise<ProjectWorkflowOutcome>;
  prepareProjectSwitch(input?: {
    fromDeferred?: boolean;
  }): Promise<ProjectWorkflowOutcome>;
  openProject(input?: {
    kind?: "local" | "recent" | "startup";
    sourcePath?: string | null;
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
    sourcePath: string;
  }): ProjectWorkflowOutcome;
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
