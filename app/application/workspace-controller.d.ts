import type { BridgeClient } from "./bridge-client.js";
import type { CommentSession } from "./comment-session.js";
import type { DocumentSession } from "./document-session.js";
import type { DraftSession } from "./draft-session.js";
import type { ProjectContext, ProjectSession } from "./project-session.js";
import type { SourceHistorySession } from "./source-history-session.js";
import type { VersionSession } from "./version-session.js";

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
    }>;

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
  bridgeClient: Pick<BridgeClient, "ensureProject" | "workspace">;
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
  ensureRegistered(
    input?: RegistrationInput,
  ): Promise<CommandOutcome<ProjectContext>>;
  dispose(): void;
}
