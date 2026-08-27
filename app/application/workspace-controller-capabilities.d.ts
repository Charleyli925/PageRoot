import type { ConversationContext, ConversationSessionSnapshot } from "./conversation-session.js";
import type {
  DocumentSessionSnapshot,
} from "./document-session.js";
import type {
  DocumentSurfaceCacheEntry,
  DocumentSurfaceCacheSnapshot,
} from "./document-surface-cache-session.js";
import type { CommentSessionSnapshot } from "./comment-session.js";
import type { CommentWorkflowSnapshot } from "./comment-workflow.js";
import type { EditAuthorRuntimeSnapshot } from "./edit-author-runtime-session.js";
import type { FirstEditGuideSnapshot } from "./first-edit-guide-session.js";
import type { ProjectRulesSnapshot } from "./project-rules-session.js";
import type { ProjectContext, ProjectSessionSnapshot } from "./project-session.js";
import type { ProjectWorkflowSnapshot } from "./project-workflow.js";
import type { RunSessionSnapshot } from "./run-session.js";
import type { RunWorkflowOutcome, RunWorkflowSnapshot } from "./run-workflow.js";
import type { RunSubmitPlan } from "./run/submit-plan.js";
import type { VersionSessionSnapshot } from "./version-session.js";
import type {
  VersionReviewCandidate,
  VersionWorkflowOutcome,
  VersionWorkflowSnapshot,
} from "./version-workflow.js";
import type { WorkbenchNavigationSnapshot } from "./workbench-navigation-session.js";
import type { WorkbenchTabsPersistenceSnapshot } from "./workbench-tabs-persistence-coordinator.js";
import type { WorkbenchTabsSnapshot } from "./workbench-tabs-session.js";
import type { ActiveRun } from "../domain/run-lifecycle.js";
import type { AgentSelection } from "../domain/agent-provider-state.js";

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
  workbenchTabs: WorkbenchTabsSnapshot | null;
  documentSurfaceCache: DocumentSurfaceCacheSnapshot | null;
  workbenchTabsReady: boolean;
  workbenchNavigation: WorkbenchNavigationSnapshot | null;
  workbenchTabsPersistence: WorkbenchTabsPersistenceSnapshot | null;
}>;

export interface WorkspaceSnapshotReader {
  getSnapshot(): WorkspaceControllerSnapshot;
}

export interface ConversationControllerCapability {
  openConversation(context: ConversationContext | null): Promise<unknown>;
  closeConversation(): void;
}

export interface AgentSelectionControllerCapability {
  selectAgent(selection: AgentSelection): AgentSelection;
  checkAgentUsability(): Promise<RunWorkflowOutcome>;
}

export interface ReviewPreparationControllerCapability extends WorkspaceSnapshotReader {
  prepareReviewCandidate(input: {
    run?: ActiveRun | null;
  }): Promise<VersionWorkflowOutcome<VersionReviewCandidate>>;
}

export interface RunSubmissionControllerCapability {
  planRunSubmission(): RunSubmitPlan;
}

export interface DocumentSurfaceControllerCapability extends WorkspaceSnapshotReader {
  updateDocumentSurfacePresentation(
    tabId: string,
    presentation?: Readonly<Record<string, unknown>>,
  ): DocumentSurfaceCacheEntry | null;
}

export interface NavigationWorkflowControllerCapability extends WorkspaceSnapshotReader {
  subscribe(
    listener: (snapshot: WorkspaceControllerSnapshot) => void,
  ): () => void;
}

export interface AiConversationControllerCapability
  extends ConversationControllerCapability, AgentSelectionControllerCapability {}
