import type { BridgeClient } from "./bridge-client.js";
import type { CommentWorkflow } from "./comment-workflow.js";
import type { CommentSession } from "./comment-session.js";
import type { DocumentSession } from "./document-session.js";
import type { DraftSession } from "./draft-session.js";
import type { ProjectContext, ProjectSession } from "./project-session.js";
import type { ProjectRulesSession } from "./project-rules-session.js";
import type { RunSession } from "./run-session.js";
import type { VersionSession } from "./version-session.js";
import type { ExternalFileOpenSnapshot } from "./external-file-open-session.js";
import type { ProjectApplicationSnapshot } from "./project-application-session.js";

export type ProjectWorkflowOutcome<T = Record<string, unknown>> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{ status: "blocked"; code: string; reason: string }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{ status: "stale"; identity: Readonly<Record<string, unknown>> }>;

export type ProjectWorkflowProject = Readonly<{
  name: string;
  sourcePath: string | null;
  html: string;
  sha256?: string | null;
  lastModifiedAt?: string;
  path?: string;
}>;

export type ProjectHydrationSnapshot = Readonly<{
  phase: "idle" | "hydrating" | "failed";
  generation: number;
  epoch: number;
  sourcePath: string | null;
  error: string | null;
}>;

export type ProjectWorkflowSnapshot = Readonly<{
  hydration: ProjectHydrationSnapshot;
  switch: Readonly<{
    phase: "idle" | "preparing";
    operationId: string | null;
  }>;
  rename: Readonly<{
    phase: "idle" | "renaming";
    operationId: string | null;
  }>;
  open: Readonly<{
    phase: "idle" | "opening" | "deferred";
    operationId: string | null;
    pendingKind: string | null;
  }>;
  close: Readonly<{
    phase: "idle" | "preparing" | "ready";
    requestId: string | null;
  }>;
  externalOpen: ExternalFileOpenSnapshot;
  projectApplication: ProjectApplicationSnapshot;
}>;

export type ProjectWorkflowEvent = Readonly<{
  type: string;
  [key: string]: unknown;
}>;

export type PreparedGeneratedSourceTransition = Readonly<{
  previousSourcePath: string;
  nextSourcePath: string;
  projectId: string;
  documentId: string;
  updatesCurrentProject: boolean;
  activatedProject: ProjectWorkflowProject | null;
}>;

export type ProjectWorkflowConstruction = Readonly<{
  bridgeClient: Pick<
    BridgeClient,
    "workspace" | "source" | "conflictCandidate" | "projectFile" | "openFolder"
  >;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  commentSession: CommentSession;
  draftSession: DraftSession;
  versionSession: VersionSession;
  commentWorkflow: CommentWorkflow;
  runSession: RunSession;
  projectRulesSession: ProjectRulesSession;
  codecs: object;
  ports: Readonly<{
    hash: object;
    canvas: object;
    projectOpen: object;
    legacy: object;
  }>;
  policies: object;
  scheduler?: Readonly<{
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  }>;
}>;

export class ProjectWorkflow {
  constructor(options: Readonly<Record<string, unknown>>);
  getSnapshot(): ProjectWorkflowSnapshot;
  subscribe(listener: (snapshot: ProjectWorkflowSnapshot) => void): () => void;
  readonly projectHydrating: boolean;
  readonly projectLoadError: string | null;
  reportLoadFailure(message: string): void;
  refreshWorkspace(input?: Record<string, unknown>): Promise<ProjectWorkflowOutcome>;
  retryHydration(): Promise<ProjectWorkflowOutcome>;
  prepareSwitch(input?: { fromDeferred?: boolean }): Promise<ProjectWorkflowOutcome>;
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
  reconcileDeferred(): void;
  prepareClose(input: {
    requestId: string;
    deadlineAt: number;
  }): Promise<Readonly<{
    ready: boolean;
    reason?: string;
    presentation?: "in-app" | "native";
  }>>;
  abortClose(input: { requestId: string }): void;
  hasPending(boundary: string): boolean;
  inspectDrain(boundary: string): ReadonlyArray<Record<string, unknown>>;
  drain(boundary: string, input: { deadlineAt: number }): Promise<Readonly<{
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
  refreshRecents(): Promise<ProjectWorkflowOutcome<{ projects: unknown[] }>>;
  renameSource(input: {
    stem: string;
    deadlineAt?: number;
  }): Promise<ProjectWorkflowOutcome<{
    context: ProjectContext;
    sourcePath: string;
    projectName?: string;
    lastModifiedAt?: string | null;
    unchanged?: boolean;
  }>>;
  prepareGeneratedSourceTransition(input: {
    previousSourcePath: string;
    nextSourcePath: string;
    expectedSha256: string;
    nextProjectId: string;
    nextDocumentId: string;
    versionId: string;
  }): Promise<PreparedGeneratedSourceTransition>;
  commitGeneratedSourceTransition(input: {
    prepared: PreparedGeneratedSourceTransition;
    html: string;
    sourceSha256: string;
    publishVersion(): void;
  }): ProjectContext | null;
  dispose(): void;
}
