import type { BridgeClient } from "./bridge-client.js";
import type { CommentWorkflow } from "./comment-workflow.js";
import type { CommentSession } from "./comment-session.js";
import type { DocumentWorkflow } from "./document-workflow.js";
import type { DocumentSession } from "./document-session.js";
import type { DraftSession } from "./draft-session.js";
import type { ProjectContext, ProjectSession } from "./project-session.js";
import type { ProjectWorkflow } from "./project-workflow.js";
import type { RunSession } from "./run-session.js";
import type { VersionSession } from "./version-session.js";

export type VersionWorkflowOutcome<T = Record<string, unknown>> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{ status: "blocked"; code: string; reason: string }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{ status: "stale"; identity: Readonly<Record<string, unknown>> }>;

export type VersionNavigationPhase = "idle" | "activating" | "opening" | "history" | "current";

export type VersionWorkflowSnapshot = Readonly<{
  navigation: Readonly<{
    phase: VersionNavigationPhase;
    operationId: string | null;
    generation: number;
  }>;
  review: Readonly<{
    phase: "idle" | "preparing";
    operationId: string | null;
  }>;
}>;

export type VersionWorkflowEvent = Readonly<{
  type: string;
  [key: string]: unknown;
}>;

export type VersionReviewCandidate = Readonly<{
  operationId: string;
  operationKey: string;
  projectId: string;
  documentId: string;
  requestId: string;
  attemptId: string;
  sourcePath: string;
  versionId: string;
  baseSnapshotSha256: string;
  content: string;
  sha256: string;
}>;

export type VersionReviewLease = Readonly<{
  operationKey: string;
  beforeHtml: string;
}>;

export type VersionWorkflowCodecs = Readonly<{
  isRecord(value: unknown): value is Record<string, unknown>;
  sameSourcePath(left: string | null | undefined, right: string | null | undefined): boolean;
  operationKey(run: Record<string, unknown>): string;
  errorMessage(cause: unknown, fallback: string): string;
}>;

export type VersionWorkflowCanvasPort = Readonly<{
  deferCommand?(
    kind: string,
    run: () => void,
    options?: Record<string, unknown>,
  ): boolean;
  fencePendingEdit?(input: Record<string, unknown>): {
    ok: boolean;
    reason?: string;
  } | undefined;
  freeze(reason: string): Readonly<{ ok: boolean; html?: string; reason?: string }>;
  verifyRendered(
    html: string,
    sha256: string,
    context?: ProjectContext,
  ): Promise<void>;
  invalidateRenderAcks(): void;
  unlock(): void;
  requestFrame?(callback: () => void): unknown;
  onNavigationChange?(transitioning: boolean): void;
}>;

export type VersionWorkflowConstruction = Readonly<{
  bridgeClient: Pick<
    BridgeClient,
    "versionFile"
      | "source"
      | "activateReadyVersion"
      | "continueEditingHistoryVersion"
      | "confirmEditingHistoryVersion"
  >;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  versionSession: VersionSession;
  runSession: RunSession;
  projectWorkflow: ProjectWorkflow;
  documentWorkflow: DocumentWorkflow;
  commentWorkflow: CommentWorkflow;
  commentSession: CommentSession;
  draftSession: DraftSession;
  codecs: VersionWorkflowCodecs;
  ports: Readonly<{
    hash: Readonly<{ sha256(html: string): Promise<string> }>;
    canvas: VersionWorkflowCanvasPort;
  }>;
  clock: Readonly<{ now(): number }>;
}>;

export class VersionWorkflow {
  constructor(options: VersionWorkflowConstruction);
  getSnapshot(): VersionWorkflowSnapshot;
  subscribe(listener: (snapshot: VersionWorkflowSnapshot) => void): () => void;
  subscribeEvents(listener: (event: Readonly<Record<string, unknown>>) => void): () => void;
  prepareReviewCandidate(input: {
    run?: Record<string, unknown> | null;
  }): Promise<VersionWorkflowOutcome<VersionReviewCandidate>>;
  activateReadyVersion(input: {
    run?: Record<string, unknown> | null;
    reviewLease?: VersionReviewLease | null;
    fromDeferred?: boolean;
  }): Promise<VersionWorkflowOutcome<Record<string, unknown>>>;
  openCommittedVersion(input: {
    run?: Record<string, unknown> | null;
    payload?: Record<string, unknown> | null;
    reviewLease?: VersionReviewLease | null;
    fromDeferred?: boolean;
  }): Promise<VersionWorkflowOutcome<Record<string, unknown>>>;
  viewHistory(input: {
    version?: Record<string, unknown> | null;
    context?: ProjectContext | null;
    deadlineAt?: number;
    fromDeferred?: boolean;
  }): Promise<VersionWorkflowOutcome<Record<string, unknown>>>;
  returnToCurrent(input?: {
    context?: ProjectContext | null;
    fromDeferred?: boolean;
  }): Promise<VersionWorkflowOutcome<Record<string, unknown>>>;
  continueEditingHistoryVersion(input?: {
    versionId?: string | null;
    context?: ProjectContext | null;
    fromDeferred?: boolean;
  }): Promise<VersionWorkflowOutcome<Record<string, unknown>>>;
  dispose(): void;
}
