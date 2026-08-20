import type { BridgeClient } from "./bridge-client.js";
import type { CommentSession } from "./comment-session.js";
import type { DocumentSession } from "./document-session.js";
import type { ProjectSession } from "./project-session.js";
import type { RunSession } from "./run-session.js";
import type { VersionSession } from "./version-session.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";

export type RunWorkflowOutcome<T = unknown> =
  | Readonly<{ status: "succeeded"; value: T }>
  | Readonly<{ status: "blocked"; code: string; reason: string }>
  | Readonly<{ status: "rejected"; code: string; reason: string }>
  | Readonly<{ status: "unknown"; operationId: string; reason: string }>
  | Readonly<{ status: "stale"; identity: Record<string, unknown> }>;

export type RunWorkflowCodecs = Readonly<{
  isRecord(value: unknown): value is Record<string, unknown>;
  sameSourcePath(left: string | null | undefined, right: string | null | undefined): boolean;
  activeRunFromRecord(value: unknown): ActiveRun | null;
  canonicalLifecycleState(value: unknown, options?: Record<string, unknown>): ActiveRun["status"];
  commentHasContent(value: unknown): boolean;
  commentEditSessionHasChanges(value: unknown): boolean;
  canLocateTarget(value: unknown): boolean;
  persistedComment(value: unknown): unknown;
  persistedChangeEvent(value: unknown): unknown;
  persistedTargetRef(value: unknown): unknown;
  uniqueTargets(value: unknown[]): unknown[];
  fileStem(value: string): string;
  projectMarkdown(value: string): string;
  operationKey(run: Pick<ActiveRun, "sourcePath" | "requestId" | "attemptId">): string;
  errorMessage(cause: unknown, fallback: string): string;
}>;

export type RunWorkflowSnapshot = Readonly<{
  polling: boolean;
  pendingReconciliations: ReadonlyArray<string>;
}>;

export type RunWorkflowEvent = Readonly<{
  type: string;
  run?: ActiveRun | null;
  current?: boolean;
  [key: string]: unknown;
}>;

export type RunWorkflowConstruction = Readonly<{
  bridgeClient: Pick<
    BridgeClient,
    | "createRequest"
    | "workspace"
    | "status"
    | "preflightAgent"
    | "startAgent"
    | "cancelActiveRun"
    | "resolveConflict"
  >;
  ensureRegistered(input?: Record<string, unknown>): Promise<RunWorkflowOutcome>;
  projectSession: ProjectSession;
  documentSession: DocumentSession;
  commentSession: CommentSession;
  versionSession: VersionSession<unknown>;
  runSession: RunSession;
  documentWorkflow: Readonly<{
    enqueueEdit(input: Record<string, unknown>): RunWorkflowOutcome;
  }>;
  drain(input: { boundary: string; deadlineAt: number }): Promise<Readonly<{
    ok: boolean;
    reason?: string;
  }>>;
  codecs: RunWorkflowCodecs;
  ports: Readonly<{
    canvas: Readonly<{
      fencePendingEdit?(input: Record<string, unknown>): { ok: boolean; reason?: string } | undefined;
      freeze(reason: string): Record<string, unknown>;
      unlock(): void;
      normalizeComments?(): unknown[];
    }>;
    handoff: Readonly<{
      copy(input: { message: string; run: ActiveRun }): Promise<{
        status: "copied" | string;
        copied: boolean;
      }>;
    }>;
    hash: Readonly<{ sha256(html: string): Promise<string> }>;
  }>;
  scheduler?: Readonly<{
    setInterval(callback: () => void, delayMs: number): unknown;
    clearInterval(handle: unknown): void;
  }>;
  clock: Readonly<{ now(): number }>;
}>;

export class RunWorkflow {
  constructor(options: RunWorkflowConstruction);
  getSnapshot(): RunWorkflowSnapshot;
  subscribe(listener: (snapshot: RunWorkflowSnapshot) => void): () => void;
  subscribeEvents(listener: (event: RunWorkflowEvent) => void): () => void;
  dispose(): void;
  syncPolling(): void;
  startPolling(): void;
  stopPolling(): void;
  pollNow(input?: { generation?: number }): Promise<RunWorkflowOutcome>;
  submit(input?: {
    projectName?: string;
    previousVersionId?: string | null;
    basedOnVersionId?: string | null;
    deadlineAt?: number;
    deliveryMode?: "clipboard" | "qoder-acp";
  }): Promise<RunWorkflowOutcome<{ run: ActiveRun }>>;
  reconcileSubmission(input?: {
    sourcePath?: string | null;
    generation?: number;
  }): Promise<RunWorkflowOutcome<{ run: ActiveRun | null }>>;
  copyHandoff(input?: { run?: ActiveRun | null }): Promise<RunWorkflowOutcome<{ run: ActiveRun }>>;
  startAgent(input?: {
    run?: ActiveRun | null;
    preflightId?: string | null;
  }): Promise<RunWorkflowOutcome<{ run: ActiveRun; agentSession: Record<string, unknown> }>>;
  cancel(input?: {
    run?: ActiveRun | null;
    agentMayBeRunning?: boolean;
    reason?: string;
  }): Promise<RunWorkflowOutcome<{ run: ActiveRun; current: boolean }>>;
  resolveConflict(input: {
    run?: ActiveRun | null;
    action: "adopt-ai" | "keep-external";
  }): Promise<RunWorkflowOutcome>;
  hydrateRecentRuns(input?: {
    projects?: Array<{ sourcePath?: string | null }>;
    activeSourcePath?: string | null;
  }): Promise<RunWorkflowOutcome<{ recovered: number; attempted: number }>>;
}
