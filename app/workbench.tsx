"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import AttachmentLightbox from "./components/AttachmentLightbox";
import HtmlCanvasEditor from "./components/HtmlCanvasEditor";
import HtmlDisplaySurface from "./components/HtmlDisplaySurface";
import type {
  HtmlCanvasEditRuntimeLoadOutcome,
  HtmlCanvasEditorHandle,
  HtmlCanvasMutation,
  HtmlCanvasSelection,
  HtmlCanvasSourceTransaction,
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
} from "./components/HtmlCanvasEditor";
import type { DesktopEditRuntimeApi } from "./components/desktop-edit-runtime-api";
import type { DesktopUiPreferencesApi } from "./components/desktop-ui-preferences-api";
import AboutPageRootDialog, {
  type AboutOpenSource,
} from "./components/AboutPageRootDialog";
import { AgentDeliveryButton, type AgentDeliveryMode } from "./components/AgentDeliveryButton";
import CancelAiRunDialog from "./components/CancelAiRunDialog";
import FirstEditGuideCard from "./components/FirstEditGuideCard";
import HtmlInteractionPreview, {
  type HtmlInteractionPreviewHandle,
} from "./components/HtmlInteractionPreview";
import { useAiConversation } from "./workbench/use-ai-conversation";
import NoticeBar from "./components/NoticeBar";
import RestartUpdateDialog from "./components/RestartUpdateDialog";
import ExternalHtmlOpenDialog from "./workbench/ExternalHtmlOpenDialog";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_COMMENT_ATTACHMENTS,
  planAttachmentSelection,
} from "./lib/attachment-selection.js";
import {
  commentMarkerGroupKey,
} from "./lib/comment-virtualization.js";
import {
  auditEventKey,
  removeAcknowledgedAuditEvents,
} from "./lib/audit-events";
import { appendDirectEditEvent } from "./lib/direct-edit-events.js";
import {
  noticeAutoDismissMs,
  productErrorMessage,
  createNoticeDismissalMemory,
  nextPresentedNotice,
} from "./lib/notification-policy";
import {
  DEFAULT_PROJECT_HTML,
  WELCOME_PROJECT_NAME,
} from "./lib/sample-html";
import {
  canCloseDuringHydration,
  shouldRecoverEditorAfterCloseAbort,
} from "../desktop/close-recovery.mjs";
import {
  createRuntimeWorkspaceController,
  registrationContextFromOutcome,
} from "./application/workspace-controller.js";
import type {
  WorkspaceController,
  WorkspaceControllerSnapshot,
} from "./application/workspace-controller.js";
import type {
  NavigationControllerCapability,
  RunControllerCapability,
} from "./application/workspace-controller-capabilities.js";
import { createCommentWorkflowCodecs } from "./application/comment-workflow-codecs.js";
import type { DocumentWorkflowOutcome } from "./application/document-workflow.js";
import { createDocumentWorkflowCodecs } from "./application/document-workflow-codecs.js";
import { createRunWorkflowCodecs } from "./application/run-workflow-codecs.js";
import {
  INITIAL_QODER_AVAILABILITY,
  type QoderGuidanceKind,
} from "./domain/qoder-availability.js";
import { createWorkspaceControllerCodecs } from "./application/workspace-controller-codecs.js";
import { createBrowserFileTabIdentity } from "./application/browser-file-tab-identity.js";
import type { CommentSessionSnapshot } from "./application/comment-session.js";
import type { DocumentSessionSnapshot } from "./application/document-session.js";
import { runLocalUserAction } from "./application/local-action-outcomes.js";
import {
  ReviewAnalysisCancelledError,
  ReviewAnalysisSession,
} from "./application/review-analysis-session.js";
import type { PageViewContext } from "./lib/page-view-context.js";
import type { ProjectSessionSnapshot } from "./application/project-session.js";
import type { RunSessionSnapshot } from "./application/run-session.js";
import type { VersionSessionSnapshot } from "./application/version-session.js";
import {
  INITIAL_WORKBENCH_TABS_SNAPSHOT,
  type WorkbenchTabsSnapshot,
} from "./application/workbench-tabs-session.js";
import {
  INITIAL_DOCUMENT_SURFACE_CACHE_SNAPSHOT,
} from "./application/document-surface-cache-session.js";
import type { SourceHistoryDirection } from "./domain/source-history.js";
import {
  EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS,
} from "./domain/edit-runtime-contract.js";
import {
  BROWSER_RUNTIME_CAPABILITIES,
  resolveRuntimeCapabilities,
  type RuntimeCapabilities,
} from "./application/runtime-capabilities.js";
import {
  captureUsageEvent,
  countBucket,
  editPropertyGroup,
  noticeUsageCode,
  usageFingerprint,
} from "./application/usage-telemetry";
import {
  activeRunFromRecord,
  canonicalLifecycleState,
  isLockedLifecycleState,
  type ActiveRun,
  type LifecycleState,
} from "./domain/run-lifecycle.js";
import {
  browserSha256,
  copyText,
  downloadHtml,
  fileAsBase64,
  isImageFile,
} from "./workbench/browser-io";
import {
  attachmentFromRecord,
  canLocateTarget,
  canSaveCommentTarget,
  commentEditSessionHasChanges,
  commentHasContent,
  commentsFromRecords,
  formatFileSize,
  independentCommentTarget,
  insertionLabel,
  normalizeGlobalCommentTargets,
  persistedAttachment,
  persistedChangeEvent,
  persistedComment,
  persistedTargetRef,
  rebindTargetsAcrossHistoryPreservingGlobal,
  rebindTargetsPreservingGlobal,
  recordId,
  selectionFromRecord,
  uniqueTargets,
} from "./workbench/comment-model";
import {
  unsafeCommentTargetsNotice,
  unsafeRelinkComments,
} from "./workbench/comment-relink-model.js";
import {
  CommentRailContainer,
  type CommentRailCapability,
} from "./workbench/comment-rail-container";
import { createCommentCanvasPort } from "./workbench/comment-canvas-port";
import {
  type CommentRailContainerContext,
  type CommentRailHostActions,
} from "./workbench/comment-rail-contract";
import {
  sameWorkbenchRenderSnapshot,
} from "./workbench/workspace-render-snapshot.js";
import {
  WorkbenchFileHeaderView,
  WorkbenchHeaderToolbar,
} from "./workbench/file-header-view";
import {
  ProjectPanelContainer,
  WorkbenchGlobalSidebarContainer,
  WorkbenchStartPageContainer,
  type ProjectCatalogCapability,
  type ProjectPanelCapability,
  type ProjectPanelContext,
  type ProjectPanelHostActions,
} from "./workbench/project-panel-container";
import { createProjectPanelPort } from "./workbench/project-panel-port.js";
import {
  PreviewNavigationBanner,
} from "./workbench/presentation";
import { RunConversationOutlet } from "./workbench/run-conversation-outlet";
import AiReviewWorkspace from "./workbench/AiReviewWorkspace";
import WorkbenchDocumentSurfaceCache from "./workbench/WorkbenchDocumentSurfaceCache";
import ReviewAnalysisPrewarm, {
  prepareReviewAnalysis,
  preparedReviewByteSize,
  type PreparedReviewDocuments,
} from "./workbench/ReviewAnalysisPrewarm";
import {
  rememberActiveDocumentPresentation,
  readyVersionPublicationMatches,
  restoreCachedDocumentPresentation,
  useDocumentSurfaceHandoff,
} from "./workbench/document-surface-presentation";
import { markDocumentSurfacePrewarmed, markProjectApplied, markProjectHydrationStage, RendererStartupPerformance } from "./workbench/performance-timeline";
import type { ReviewDocuments } from "./workbench/review-document";
import { useRuntimeBridgeConnectionReady } from "./workbench/runtime-bridge-connection";
import { WorkbenchHeaderShell } from "./workbench/workbench-header-shell";
import { WorkbenchTabBarContainer } from "./workbench/workbench-navigation-container";
import {
  activeRunOperationKey,
  currentWorkingCopyPresentation,
  fileStem,
  formatProjectTimestamp,
  formatTime,
  localFileNameFromSourcePath,
  projectMarkdown,
  projectStatusProjection,
  safeVersionLabel,
  sameLocalSourcePath,
} from "./workbench/project-model";
import {
  authoritativeDraftRevision,
  draftAuthorityFromWorkspace,
  historyTextSelectionFromRecord,
  isRecord,
  ownsNativeTextHistory,
  recoveryIdentityFromRecord,
  sourceHistoryOperationsFromRecord,
} from "./workbench/record-model";
import {
  changesFromDraftRecords,
  versionsFromWorkspace,
} from "./workbench/version-model";
import type {
  ApplicationUpdateResult,
  CanvasMode,
  CloseAbortedDetail,
  CloseReadiness,
  CommentAttachment,
  CommentEditSession,
  CommentItem,
  DirectEditEvent,
  Drawer,
  HtmlProject,
  PersistState,
  PrepareCloseDetail,
  ProjectContext,
  RegisteredProject,
  StartupIssue,
  Toast,
  ToastAction,
  Version,
  WorkspaceIssue,
} from "./workbench/types";

const BROWSER_PREVIEW_LOGO_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%236550e8'/%3E%3Cstop offset='1' stop-color='%23d45df2'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='15' fill='url(%23g)'/%3E%3Cpath d='M23 23 13 32l10 9M41 23l10 9-10 9M36 16 28 48' fill='none' stroke='white' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
const PROJECT_REPOSITORY_URL = "https://github.com/Charleyli925/PageRoot";
const LATEST_RELEASE_PAGE_URL =
  "https://github.com/Charleyli925/PageRoot/releases/latest";

class DeferredEditorCommandDiscardedError extends Error {
  readonly reason: NativeDeferredCommandDiscardReason;

  constructor(reason: NativeDeferredCommandDiscardReason) {
    super(`Deferred editor command discarded: ${reason}`);
    this.name = "DeferredEditorCommandDiscardedError";
    this.reason = reason;
  }
}

type CanvasRenderAck = Readonly<{
  generation: number;
  sha256: string;
}>;

type CanvasRenderAcks = Readonly<Record<CanvasMode, CanvasRenderAck | null>>;

const INITIAL_RUN_SNAPSHOT: RunSessionSnapshot = {
  activeSourcePath: null,
  activeRun: null,
  activeHandoff: null,
  activeHandoffMayBeRunning: false,
  activeHandoffManaged: false,
  activeSubmission: null,
  submissionPending: false,
  activeLocked: false,
  operationKeys: [],
  recentOutcome: null,
  backgroundResults: [],
};
const INITIAL_EXTERNAL_FILE_OPEN_SNAPSHOT = {
  status: "idle" as const,
  activeRequestId: null,
  queuedRequestId: null,
  queuedRequestIds: [],
  deferredRequestId: null,
  deferredSequence: 0,
  confirmation: null,
  attention: null,
};
const INITIAL_PROJECT_APPLICATION_SNAPSHOT = {
  status: "idle",
  activeApplicationId: null,
  queuedApplicationId: null,
  deferredApplicationId: null,
  deferredSequence: 0,
};
const INITIAL_PROJECT_SESSION_SNAPSHOT: ProjectSessionSnapshot = {
  epoch: 0,
  sourcePath: null,
  projectId: "",
  documentId: "",
  registered: false,
};
const INITIAL_VERSION_SNAPSHOT: VersionSessionSnapshot<Version> = {
  versions: [],
  latestVersionId: null,
  currentBasedOnVersionId: null,
  currentExactVersionId: null,
  restoredFromVersionId: null,
  viewMode: "current",
  viewingVersionId: null,
};
const INITIAL_DOCUMENT_SNAPSHOT: DocumentSessionSnapshot = {
  html: DEFAULT_PROJECT_HTML,
  sourceSha256: null,
  canvasGeneration: 0,
  canvasAuthority: {
    status: "idle",
    generation: 0,
    renderedSha256: null,
    error: null,
  },
  editRevision: 0,
  lastPersistedRevision: 0,
  persistState: "idle",
  persistError: "",
  hasPendingWrite: false,
  isFlushing: false,
};
const EDIT_RUNTIME_PENDING_PHASES = new Set(["preparing", "ready", "running"]);
const INITIAL_COMMENT_SNAPSHOT: CommentSessionSnapshot<
  CommentItem,
  DirectEditEvent,
  CommentAttachment,
  HtmlCanvasSelection,
  CommentEditSession
> = {
  comments: [],
  changeEvents: [],
  deletedCommentIds: [],
  composerDraft: "",
  composerCommentId: null,
  composerAttachments: [],
  composerTarget: null,
  editSession: null,
};

type ReadyReviewSession = {
  operationKey: string;
  sessionId: string;
  documents: ReviewDocuments;
  beforeHtml: string;
  sourcePath: string;
  beforeLabel: string;
  afterLabel: string;
};

const WELCOME_PROJECT = {
  name: WELCOME_PROJECT_NAME,
  sourcePath: null as string | null,
};

function requiredWorkspaceController(
  controller: WorkspaceController | null,
): WorkspaceController {
  if (!controller) {
    throw new Error("项目资料初始化尚未就绪，请稍后重试。");
  }
  return controller;
}

type DocumentEditOutcome = DocumentWorkflowOutcome<{
  revision: number;
  queued: boolean;
}>;

function documentEditFailureReason(outcome: DocumentEditOutcome): string {
  if (outcome.status === "succeeded") return "";
  if (outcome.status === "stale") {
    return "当前项目已经切换，当前修改没有被接受。";
  }
  return outcome.reason;
}

export default function Workbench() {
  const [globalSidebarOpen, setGlobalSidebarOpen] = useState(false);
  const editorRef = useRef<HtmlCanvasEditorHandle>(null);
  const interactionPreviewRef = useRef<HtmlInteractionPreviewHandle>(null);
  const previewToEditPendingRef = useRef(false);
  const pageViewDocumentKeyRef = useRef("");
  const deferredEditorReplayRef = useRef<{
    exportCurrentHtml?: () => void;
    reloadCurrentSource?: () => void;
    requestUserFlush?: () => void;
    requestSourceHistoryAction?: (
      direction: SourceHistoryDirection,
    ) => Promise<boolean>;
    generateRequest?: () => void;
    agentDeliveryMode: AgentDeliveryMode;
  }>({ agentDeliveryMode: "clipboard" });
  const deferEditorCommand = useCallback((
    kind: string,
    run: () => void,
    payload?: unknown,
    options?: {
      authority?: NativeDeferredCommandAuthority;
      onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
    },
  ) => Boolean(editorRef.current?.deferNativeCommand(
    kind,
    run,
    payload,
    options,
  )), []);
  const fenceAndFreezeCurrentCanvas = useCallback((missingReason: string) => {
    const editor = editorRef.current;
    if (!editor) {
      return { ok: false as const, reason: missingReason };
    }
    // freezeNow owns the complete source-authority fence: it checkpoints the source
    // transaction, retires Chromium's editing host, and only then locks input.
    const frozen = editor.freezeNow();
    if (!frozen.ok) {
      return {
        ok: false as const,
        reason: frozen.reason || "当前文字尚未安全收口。",
      };
    }
    if (editor.getSourceHtml() !== frozen.html) {
      return {
        ok: false as const,
        reason: "编辑画布的冻结快照与源码引擎不一致。",
      };
    }
    return { ...frozen, ok: true as const, html: frozen.html };
  }, []);
  const fenceAndFreezeCurrentCanvasRef = useRef(fenceAndFreezeCurrentCanvas);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [commentCanvasPort] = useState(createCommentCanvasPort);
  const [projectPanelPort] = useState(createProjectPanelPort);
  const reviewStageRef = useRef<HTMLDivElement>(null);
  const commentCounter = useRef(1);
  const commentEditResumePendingRef = useRef<string | null>(null);
  const pagePresentationScrollRequestRef = useRef(0);
  const [reviewAnalysisSession] = useState(
    () => new ReviewAnalysisSession<PreparedReviewDocuments>({
      estimateSize: preparedReviewByteSize,
    }),
  );
  const reviewSessionSequenceRef = useRef(0);
  const runtimeCapabilitiesRef =
    useRef<RuntimeCapabilities>(BROWSER_RUNTIME_CAPABILITIES);
  const workspaceControllerRef = useRef<WorkspaceController | null>(null);
  const verifyCanvasRenderedRef = useRef<(
    expectedHtml: string,
    expectedSha256: string,
    context?: ProjectContext,
  ) => Promise<void>>(async () => {
    throw new Error("画布核对尚未完成初始化。");
  });
  const sourceTransitioningRef = useRef(false);
  const renameTransitioningRef = useRef(false);
  const sourceTransitionOperationRef = useRef(0);
  const versionTransitioningRef = useRef(false);
  const attachmentObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const toastRef = useRef<Toast>(null);
  const noticeDismissalMemoryRef = useRef(createNoticeDismissalMemory());
  const previousPersistStateRef = useRef(new Map<string, PersistState>());
  const previousRunStateRef = useRef(
    new Map<string, LifecycleState | "none">(),
  );
  const interruptionPresenceRef = useRef(new Map<string, boolean>());
  const resumeSubmissionAfterRelinkRef = useRef(false);
  const normalizeCurrentGlobalCommentsRef = useRef<() => CommentItem[]>(() => []);
  const automaticProjectRegistrationRef = useRef("");
  const projectRecordsPreparationRef = useRef("");

  const [workspaceControllerSnapshot, setWorkspaceControllerSnapshotState] =
    useState<WorkspaceControllerSnapshot | null>(null);
  const [workspaceController, setWorkspaceController] =
    useState<WorkspaceController | null>(null);
  const runCapability = workspaceController
    ? workspaceController.runs as RunControllerCapability
    : null;
  const navigationCapability = workspaceController
    ? workspaceController.navigation as NavigationControllerCapability
    : null;
  const workbenchTabsSnapshot = workspaceControllerSnapshot?.workbenchTabs
    ?? INITIAL_WORKBENCH_TABS_SNAPSHOT;
  const documentSurfaceCacheSnapshot = workspaceControllerSnapshot?.documentSurfaceCache
    ?? INITIAL_DOCUMENT_SURFACE_CACHE_SNAPSHOT;
  const [importedCanvasBase, setImportedCanvasBase] = useState<{
    managedSourcePath: string;
    externalSourcePath: string;
  } | null>(null);
  const currentControllerSnapshot = useCallback(
    () => workspaceControllerRef.current?.getSnapshot() ?? null,
    [],
  );
  const currentProjectSessionSnapshot = useCallback(
    () => currentControllerSnapshot()?.projectSession
      ?? INITIAL_PROJECT_SESSION_SNAPSHOT,
    [currentControllerSnapshot],
  );
  const currentDocumentSessionSnapshot = useCallback(
    () => currentControllerSnapshot()?.document ?? INITIAL_DOCUMENT_SNAPSHOT,
    [currentControllerSnapshot],
  );
  const currentCommentSessionSnapshot = useCallback(
    () => (
      currentControllerSnapshot()?.commentSession as CommentSessionSnapshot<
        CommentItem,
        DirectEditEvent,
        CommentAttachment,
        HtmlCanvasSelection,
        CommentEditSession
      > | null
    ) ?? INITIAL_COMMENT_SNAPSHOT,
    [currentControllerSnapshot],
  );
  const currentRunSessionSnapshot = useCallback(
    () => currentControllerSnapshot()?.runSession ?? INITIAL_RUN_SNAPSHOT,
    [currentControllerSnapshot],
  );
  const documentSnapshot = workspaceControllerSnapshot?.document
    ?? INITIAL_DOCUMENT_SNAPSHOT;
  const externalFileOpenSnapshot =
    workspaceControllerSnapshot?.project?.externalOpen
    ?? INITIAL_EXTERNAL_FILE_OPEN_SNAPSHOT;
  const openConfirmation =
    workspaceControllerSnapshot?.project?.openConfirmation || null;
  const projectApplicationSnapshot =
    workspaceControllerSnapshot?.project?.projectApplication
    ?? INITIAL_PROJECT_APPLICATION_SNAPSHOT;
  const html = documentSnapshot.html;
  const sourceSha256 = documentSnapshot.sourceSha256;
  const canvasGeneration = documentSnapshot.canvasGeneration;
  const editRevision = documentSnapshot.editRevision;
  const lastPersistedRevision = documentSnapshot.lastPersistedRevision;
  const persistState = documentSnapshot.persistState;
  const persistError = documentSnapshot.persistError;
  const [projectName, setProjectName] = useState(WELCOME_PROJECT.name);
  const projectSnapshot = workspaceControllerSnapshot?.projectSession
    ?? INITIAL_PROJECT_SESSION_SNAPSHOT;
  const { sourcePath, projectId, documentId } = projectSnapshot;
  // The first durable import changes the ProjectSession source from the
  // caller-owned HTML to V1's managed Working Copy without replacing the live
  // DocumentSession canvas. Keep the selected external HTML as the preview
  // base for that imported Working Copy during this session, so authored
  // relative resources remain preview-only rather than being copied into or
  // managed by the v4 Project. A subsequent navigation uses its own source.
  const canvasSourcePath = (
    importedCanvasBase
    && sameLocalSourcePath(sourcePath, importedCanvasBase.managedSourcePath)
  )
    ? importedCanvasBase.externalSourcePath
    : sourcePath || undefined;
  const [projectRecordsPath, setProjectRecordsPath] =
    useState<string | null>(null);
  const [lastModifiedAt, setLastModifiedAt] = useState<string | null>(null);
  const commentCapabilitySnapshot = workspaceController
    ? (workspaceController.comments as CommentRailCapability).getSnapshot()
    : null;
  const commentSnapshot = (
    commentCapabilitySnapshot?.workingCopy
    ?? workspaceControllerSnapshot?.commentSession as CommentSessionSnapshot<
      CommentItem,
      DirectEditEvent,
      CommentAttachment,
      HtmlCanvasSelection,
      CommentEditSession
    > | null
  ) ?? INITIAL_COMMENT_SNAPSHOT;
  const draftTarget = commentSnapshot.composerTarget;
  const draft = commentSnapshot.composerDraft;
  const draftCommentId = commentSnapshot.composerCommentId;
  const draftAttachments = commentSnapshot.composerAttachments;
  const comments = commentSnapshot.comments;
  const changeEvents = commentSnapshot.changeEvents;
  const commentEditSession = commentSnapshot.editSession;
  const [attachmentObjectUrls, setAttachmentObjectUrls] = useState<Record<string, string>>({});
  const attachmentUploadCount =
    commentCapabilitySnapshot?.persistence?.attachmentUploadCount
    ?? workspaceControllerSnapshot?.comment?.attachmentUploadCount
    ?? 0;
  const draftPersistError =
    commentCapabilitySnapshot?.persistence?.draft.error
    ?? workspaceControllerSnapshot?.comment?.draft.error
    ?? "";
  const runSnapshot = workspaceControllerSnapshot?.runSession
    ?? INITIAL_RUN_SNAPSHOT;
  const agentCatalogSnapshot = workspaceControllerSnapshot?.run?.agentCatalog ?? null;
  const frozenAgentSelection = runSnapshot.activeRun?.agentDelivery?.selection
    ?? agentCatalogSnapshot?.selected
    ?? null;
  const frozenProvider = frozenAgentSelection
    ? agentCatalogSnapshot?.providers?.[frozenAgentSelection.providerId]
    : null;
  const agentPresentation = frozenProvider?.presentation ?? {
    displayName: frozenAgentSelection?.providerId || "Agent",
    agentName: frozenAgentSelection?.providerId || "Agent",
    logoSrc: null,
    settingsSupported: false,
    localReadDisclosure: undefined,
    restartLabel: `重新启动 ${frozenAgentSelection?.providerId || "Agent"}`,
    restartSupported: false,
    stopLabel: `停止 ${frozenAgentSelection?.providerId || "Agent"} 并继续编辑`,
    frozenPreviewDetail: `这是本轮冻结并交给 ${frozenAgentSelection?.providerId || "Agent"} 的只读内容`,
  };
  const sidebarAgentPresentation = {
    providerId: frozenAgentSelection?.providerId || "agent",
    displayName: agentPresentation.displayName || frozenAgentSelection?.providerId || "Agent",
    agentName: agentPresentation.agentName || agentPresentation.displayName
      || frozenAgentSelection?.providerId || "Agent",
    logoSrc: typeof agentPresentation.logoSrc === "string" ? agentPresentation.logoSrc : null,
  };
  const frozenModelId = frozenAgentSelection?.resolvedModelId
    || frozenAgentSelection?.requestedModelId
    || null;
  const agentModelDisplayName = frozenModelId
    ? `${agentPresentation.agentName || frozenAgentSelection?.providerId || "Agent"} · ${frozenModelId}`
    : agentPresentation.agentName || frozenAgentSelection?.providerId || null;
  const agentProviderChoices = Object.values(agentCatalogSnapshot?.providers ?? {}).map(
    (provider) => ({
      id: `${provider.providerId}:${provider.runtimeId}`,
      label: provider.presentation.agentName || provider.presentation.displayName,
      detail: typeof provider.presentation.localReadDisclosure === "string"
        ? provider.presentation.localReadDisclosure
        : null,
      selection: provider.selection,
    }),
  );
  const selectedAgentChoiceId = frozenAgentSelection
    ? `${frozenAgentSelection.providerId}:${frozenAgentSelection.runtimeId}`
    : null;
  const qoderAvailability = workspaceControllerSnapshot?.run?.qoderAvailability
    ?? INITIAL_QODER_AVAILABILITY;
  const aboutQoderAvailability = agentCatalogSnapshot?.providers?.qoder?.availability
    ?? INITIAL_QODER_AVAILABILITY;
  const [previewAttachment, setPreviewAttachment] = useState<CommentAttachment | null>(null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [handoffPreviewOpen, setHandoffPreviewOpen] = useState(false);
  const projectRulesSnapshot = workspaceControllerSnapshot?.projectRules ?? null;
  const [projectRecordsPreparing, setProjectRecordsPreparing] = useState(false);
  const [projectRecordsError, setProjectRecordsError] = useState("");
  const versionSnapshot = (
    workspaceControllerSnapshot?.versionSession as VersionSessionSnapshot<Version> | null
  ) ?? INITIAL_VERSION_SNAPSHOT;
  const versions = versionSnapshot.versions;
  const latestVersionId = versionSnapshot.latestVersionId;
  const currentBasedOnVersionId =
    versionSnapshot.currentBasedOnVersionId;
  const currentExactVersionId = versionSnapshot.currentExactVersionId;
  const viewMode = versionSnapshot.viewMode;
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("edit");
  // The AI conversation sidebar. All of its React state lives in this hook, so
  // the Workbench gains one hook call and no extra budget.
  // Declared before the conversation hook because the sidebar stays docked
  // through review: useAiConversation reads this to keep the thread alive.
  const [readyReviewSession, setReadyReviewSession] =
    useState<ReadyReviewSession | null>(null);

  // The decision bar acts through a ref: its handlers are defined further down,
  // and the conversation hook is composed before them.

  const generateRequestRef = useRef<
    ((mode: AgentDeliveryMode) => void) | null
  >(null);
  const openAgentSettingsRef = useRef<(() => void) | null>(null);
  const openAgentSettings = useCallback(() => {
    openAgentSettingsRef.current?.();
  }, []);
  const aiConversation = useAiConversation({
    controllerRef: workspaceControllerRef,
    conversation: workspaceControllerSnapshot?.conversation ?? null,
    qoderAvailability,
    agentModelDisplayName,
    agentActionName: agentPresentation.agentName || agentPresentation.displayName,
    agentSettingsName: agentPresentation.displayName || agentPresentation.agentName,
    agentSettingsSupported: agentPresentation.settingsSupported !== false,
    agentLocalReadDisclosure: typeof agentPresentation.localReadDisclosure === "string"
      ? agentPresentation.localReadDisclosure
      : null,
    agentPresentation: sidebarAgentPresentation,
    agentChoices: agentProviderChoices,
    selectedAgentChoiceId,
    // The header's mode comes from Request authority, not from a local guess.
    activeRun: runSnapshot.activeRun,
    activeHandoff: runSnapshot.activeHandoff,
    submissionPending: runSnapshot.submissionPending,
    // Review is the same workbench with a different Canvas: the thread stays
    // docked and read-only instead of disappearing and coming back.
    reviewing: Boolean(readyReviewSession),
    canvasMode,
    projectId: projectId ?? "",
    documentId: documentId ?? "",
    sourcePath: sourcePath ?? "",
    pendingCommentCount: comments.length,
    /*
     * The same submission the header button performs. One owner, two surfaces.
     *
     * Reached through a ref because generateRequest is declared far below this call.
     * Naming it directly here left React Compiler with a call to a function it had not
     * yet analysed, so it had to assume that call could mutate anything — and that
     * assumption cost every state setter in this component its stability, skipping
     * optimisation for the whole component.
     */
    onDeliverModification: (mode) => generateRequestRef.current?.(mode),
    onOpenAgentSettings: openAgentSettings,
  });
  const revealAiConversation = aiConversation.reveal;
  // The run-event effect reports a submitted round by opening the thread. It is
  // reached through a ref so that effect keeps its curated dependency list.
  const editRuntimeSnapshot = workspaceControllerSnapshot?.editRuntime ?? null;
  const editRuntimePhase = editRuntimeSnapshot?.phase || "static";
  const editRuntimePreparing = (
    canvasMode === "edit"
    && editRuntimeSnapshot?.phase === "preparing"
  );
  const editRuntimeRenderPending = (
    canvasMode === "edit"
    && ["preparing", "ready", "running"].includes(editRuntimePhase)
  );
  const editRuntimeGrant = (
    canvasMode === "edit"
    && ["ready", "running", "settled"].includes(editRuntimeSnapshot?.phase || "")
  ) ? editRuntimeSnapshot?.grant ?? null : null;
  useLayoutEffect(() => {
    const sourceSha256 = editRuntimeSnapshot?.sourceSha256;
    const runtimeCanvasGeneration = editRuntimeSnapshot?.canvasGeneration;
    if (
      !editRuntimePreparing
      || !sourceSha256
      || typeof runtimeCanvasGeneration !== "number"
      || !Number.isSafeInteger(runtimeCanvasGeneration)
    ) return;
    // This runs after the preparing snapshot has committed the loading surface
    // and retired any static editor. The Session alone still owns the one
    // attempt; Workbench only acknowledges that it is safe to start it.
    workspaceControllerRef.current?.startEditAuthorRuntimePreparation({
      sourceSha256,
      canvasGeneration: runtimeCanvasGeneration,
    });
  }, [
    editRuntimePreparing,
    editRuntimeSnapshot?.canvasGeneration,
    editRuntimeSnapshot?.sourcePath,
    editRuntimeSnapshot?.sourceSha256,
  ]);
  const [pageViewContext, setPageViewContext] =
    useState<PageViewContext | null>(null);
  const [interactivePreviewTransport, setInteractivePreviewTransport] =
    useState<RuntimeCapabilities["interactivePreview"]>(
      BROWSER_RUNTIME_CAPABILITIES.interactivePreview,
    );
  const viewingVersionId = versionSnapshot.viewingVersionId;
  const [canvasRenderAcks, setCanvasRenderAcks] = useState<CanvasRenderAcks>({
    edit: null,
    preview: null,
  });
  const [sourceTransitioning, setSourceTransitioning] = useState(false);
  const setSourceViewTransitioning = useCallback((transitioning: boolean) => {
    sourceTransitioningRef.current = transitioning;
    setSourceTransitioning(transitioning);
  }, []);
  const isViewTransitioning = useCallback(() => (
    sourceTransitioningRef.current
    || versionTransitioningRef.current
    || renameTransitioningRef.current
  ), []);
  const versionTransitioning = (workspaceControllerSnapshot?.version?.navigation.phase || "idle") !== "idle";
  const renameTransitioning =
    workspaceControllerSnapshot?.project?.rename?.phase === "renaming";
  const viewTransitioning = sourceTransitioning || versionTransitioning || renameTransitioning;
  const bridgeConnectionReady = useRuntimeBridgeConnectionReady();
  useEffect(() => {
    renameTransitioningRef.current = renameTransitioning;
  }, [renameTransitioning]);
  const invalidateCanvasRenderAcks = useCallback(() => {
    setCanvasRenderAcks({ edit: null, preview: null });
  }, []);
  useLayoutEffect(() => {
    if (!bridgeConnectionReady) return undefined;
    const editRuntimeApi: DesktopEditRuntimeApi | undefined = window.htmlAIEditRuntime;
    const uiPreferencesApi: DesktopUiPreferencesApi | undefined = window.htmlAIUiPreferences;
    const controller = createRuntimeWorkspaceController({
      initial: {
        documentHtml: DEFAULT_PROJECT_HTML,
        runSourcePath: WELCOME_PROJECT.sourcePath,
      },
      draftSession: {
        encodeComment: persistedComment,
        encodeChangeEvent: persistedChangeEvent,
      },
      codecs: createWorkspaceControllerCodecs({
        isRecord,
        sameSourcePath: sameLocalSourcePath,
        draftAuthorityFromWorkspace,
        authoritativeDraftRevision,
        recoveryIdentityFromRecord,
        versionsFromWorkspace,
        rebindTargetsPreservingGlobal,
      }),
      ports: {
        hash: { sha256: browserSha256 },
        canvas: { invalidateRenderAcks: invalidateCanvasRenderAcks },
        ...(window.htmlAIWorkbenchTabs ? {
          workbenchTabs: {
            get: () => window.htmlAIWorkbenchTabs!.get(),
            set: (value: Readonly<Record<string, unknown>>) => (
              window.htmlAIWorkbenchTabs!.set(value)
            ),
          },
        } : {}),
        ...(window.htmlAIAppLifecycle?.onExternalOpenRequested ? {
          navigation: {
            subscribeExternalOpen: (listener: (request: {
              requestId: string;
              sourcePath?: string;
            }) => void) => window.htmlAIAppLifecycle!.onExternalOpenRequested(listener),
            readInitialExternalOpen: () => (
              window.htmlAIAppLifecycle!.getInitialExternalOpen?.()
              ?? Promise.resolve(null)
            ),
          },
        } : {}),
        projectSource: {
          activateManagedWorkingCopy: async (input: {
            previousSourcePath: string;
            nextSourcePath: string;
            expectedSha256: string;
            projectId: string;
            documentId: string;
            workingCopyId: string;
            versionId: string;
            projectRootPath: string;
            operationId?: string;
          }) => {
            const activate = window.htmlAIProjects?.activateManagedWorkingCopy;
            if (!activate) {
              throw new Error("当前运行环境不能安全切换到托管工作文件。");
            }
            return activate(input);
          },
        },
        ...(editRuntimeApi ? {
          editRuntime: {
            prepare: (request) => editRuntimeApi.prepare(request),
            revoke: (sessionId) => editRuntimeApi.revoke(sessionId),
          },
        } : {}),
        ...(uiPreferencesApi ? {
          uiPreferences: {
            get: () => uiPreferencesApi.get(),
            record: (input) => uiPreferencesApi.record(input),
          },
        } : {}),
      },
      documentWorkflow: {
        codecs: createDocumentWorkflowCodecs({
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          persistedChangeEvent,
          recoveryIdentityFromRecord,
          sourceHistoryOperationsFromRecord,
          changesFromRecords: changesFromDraftRecords,
          historyTextSelectionFromRecord,
          selectionFromRecord,
          rebindTargetsPreservingGlobal,
          rebindTargetsAcrossHistoryPreservingGlobal,
          canLocateTarget,
          appendDirectEditEvent,
          auditEventKey,
          removeAcknowledgedAuditEvents,
          errorMessage: productErrorMessage,
        }),
        canvas: {
          verifyRendered: (expectedHtml, expectedSha256, context) => (
            verifyCanvasRenderedRef.current(
              expectedHtml,
              expectedSha256,
              context as ProjectContext | undefined,
            )
          ),
          freeze: (reason) => fenceAndFreezeCurrentCanvasRef.current(reason),
          adoptHistorySource: (nextHtml, target, textSelection) => {
            editorRef.current?.adoptHistorySource(
              nextHtml,
              target as HtmlCanvasSelection | null,
              textSelection as {
                anchor: number;
                focus: number;
                affinity: "left" | "right";
              } | null,
            );
          },
        },
      },
      commentWorkflow: {
        codecs: createCommentWorkflowCodecs({
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          persistedComment,
          persistedChangeEvent,
          persistedAttachment,
          persistedTargetRef,
          commentsFromRecords,
          changesFromDraftRecords,
          attachmentFromRecord,
          selectionFromRecord,
          independentCommentTarget,
          commentEditSessionHasChanges,
          errorMessage: productErrorMessage,
        }),
        attachmentBinary: {
          prepare: async (
            file: File,
            options: { includeDataBase64: boolean },
          ) => ({
            fileName: file.name || "附件",
            mediaType: file.type || "application/octet-stream",
            byteLength: file.size,
            kind: isImageFile(file) ? "image" : "file",
            ...(options.includeDataBase64
              ? { dataBase64: await fileAsBase64(file) }
              : {}),
            sourceFile: file,
          }),
        },
      },
      projectRulesWorkflow: {
        errorMessage: productErrorMessage,
        presentation: {
          restoreEditor: ({ settle }: { settle: () => void }) => {
            projectPanelPort.requestEditorRestore(settle);
          },
        },
        scheduler: {
          setTimeout: (callback: () => void, delayMs: number) => (
            window.setTimeout(callback, delayMs)
          ),
          clearTimeout: (handle: unknown) => window.clearTimeout(handle as number),
        },
      },
      projectWorkflow: {
        codecs: {
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          versionsFromWorkspace,
          draftAuthorityFromWorkspace,
          authoritativeDraftRevision,
          commentsFromRecords,
          changesFromDraftRecords,
          rebindTargetsPreservingGlobal,
          activeRunFromRecord,
          isLockedLifecycleState,
          commentEditSessionHasChanges,
          recoveryIdentityFromRecord,
          errorMessage: productErrorMessage,
        },
        ports: {
          hash: { sha256: browserSha256 },
          canvas: {
            invalidateRenderAcks: invalidateCanvasRenderAcks,
            isMounted: () => Boolean(editorRef.current),
            deferCommand: (
              kind: string,
              run: () => void,
              options?: {
                authority?: NativeDeferredCommandAuthority;
                onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
              },
            ) => deferEditorCommand(kind, run, undefined, options),
            fencePendingEdit: (options: Record<string, unknown>) => (
              editorRef.current?.fencePendingEdit(options)
            ),
            freeze: (reason?: string) => fenceAndFreezeCurrentCanvasRef.current(
              reason || "当前编辑画布尚未完成安全收口。",
            ),
            verifyRendered: (
              expectedHtml: string,
              expectedSha256: string,
              context?: ProjectContext,
            ) => verifyCanvasRenderedRef.current(
              expectedHtml,
              expectedSha256,
              context,
            ),
            showCommitBlocked: (reason: string) => (
              editorRef.current?.showCommitBlocked(reason)
            ),
            unlock: () => editorRef.current?.unlockNow?.(),
            clearSelection: () => editorRef.current?.clearSelection(),
            applyPageViewContext: (context: PageViewContext | null) => (
              editorRef.current?.applyPageViewContext(context)
            ),
            hasPendingNativeEdit: () => Boolean(
              editorRef.current?.hasPendingNativeEdit(),
            ),
            requestFrame: (callback: () => void) => (
              window.requestAnimationFrame(callback)
            ),
          },
          projectOpen: {
            mode: () => runtimeCapabilitiesRef.current.projectOpening,
            openLocal: async () => window.htmlAIProjects?.openHtml() ?? null,
            openRecent: async (sourcePath: string) => {
              const api = window.htmlAIProjects;
              if (!api) throw new Error("当前运行环境不能打开本地 HTML。");
              return api.openRecent(sourcePath);
            },
            getActive: async () => window.htmlAIProjects?.getActiveProject() ?? null,
            listRecent: async () => window.htmlAIProjects?.listRecentProjects() ?? [],
            listRegistered: async () => window.htmlAIProjects?.listRegisteredProjects?.() ?? [],
            readRegisteredProjection: async (registeredProjectId: string) => {
              const read = window.htmlAIProjects?.readRegisteredProjectProjection;
              if (!read) throw new Error("当前 PageRoot 版本缺少项目展示预热通道。");
              return read(registeredProjectId);
            },
            openRegistered: async (registeredProjectId: string) => {
              const open = window.htmlAIProjects?.openRegisteredProject;
              if (!open) throw new Error("当前 PageRoot 版本缺少项目目录打开通道。");
              return open(registeredProjectId);
            },
            acceptExternal: async (requestId: string) => {
              const accept = window.htmlAIProjects?.acceptExternalOpen;
              if (!accept) throw new Error("当前 PageRoot 版本缺少外部文件打开通道。");
              return accept(requestId);
            },
            ackExternal: async (requestId: string) => {
              const acknowledge = window.htmlAIProjects?.acknowledgeExternalOpen;
              if (!acknowledge) return { acknowledged: true, requestId };
              return acknowledge(requestId);
            },
            commitPrepared: async (payload: {
              requestId: string;
              action: "import-new" | "continue-current" | "open-managed";
              deleteOriginal?: boolean;
            }) => {
              const commit = window.htmlAIProjects?.commitPreparedHtmlOpen;
              if (!commit) throw new Error("当前 PageRoot 版本缺少导入确认通道。");
              return commit(payload);
            },
            cancelPrepared: async (requestId: string) => {
              const cancel = window.htmlAIProjects?.cancelPreparedHtmlOpen;
              if (!cancel) return { canceled: false };
              return cancel(requestId);
            },
            finalizePrepared: async (requestId: string) => {
              const finalize = window.htmlAIProjects?.finalizePreparedHtmlOpen;
              if (!finalize) return { disposition: "kept" as const };
              return finalize(requestId);
            },
            rollbackPrepared: async (requestId: string) => {
              const rollback = window.htmlAIProjects?.rollbackPreparedHtmlOpen;
              if (!rollback) return { rolledBack: false, project: null };
              return rollback(requestId);
            },
            activateGeneratedVersion: async (input: {
              previousSourcePath: string;
              nextSourcePath: string;
              expectedSha256: string;
              projectId: string;
              versionId: string;
            }) => {
              const activate = window.htmlAIProjects?.activateGeneratedVersion;
              if (!activate) throw new Error("当前运行环境不能安全切换生成版本。");
              return activate(input);
            },
            activateManagedWorkingCopy: async (input: {
              previousSourcePath: string;
              nextSourcePath: string;
              expectedSha256: string;
              projectId: string;
              documentId: string;
              workingCopyId: string;
              versionId: string;
              projectRootPath: string;
              operationId?: string;
            }) => {
              const activate = window.htmlAIProjects?.activateManagedWorkingCopy;
              if (!activate) {
                throw new Error("当前运行环境不能安全切换到托管工作文件。");
              }
              return activate(input);
            },
            renameSource: async (input: {
              operationId: string;
              sourcePath: string;
              stem: string;
              expectedSha256: string;
            }) => {
              const rename = window.htmlAIProjects?.renameHtml;
              if (!rename) throw new Error("当前运行环境不能安全修改 HTML 文件名。");
              return rename(input);
            },
            reconcileActiveManagedSource: async (input: {
              operationId?: string;
              previousSourcePath: string;
              expectedSourceSha256: string;
              projectId: string;
              documentId: string;
              workingCopyId: string;
              versionId: string;
              reason: "watch" | "rename" | "startup" | "safe-action";
              watcherGeneration?: number;
            }) => {
              const reconcile = window.htmlAIProjects?.reconcileActiveManagedSource;
              if (!reconcile) {
                throw new Error("当前运行环境不能安全核对工作文件位置。");
              }
              return reconcile(input);
            },
          },
          viewState: {
            isTransitioning: () => isViewTransitioning(),
          },
        },
        policies: {
          canCloseDuringHydration,
          shouldRecoverAfterCloseAbort: shouldRecoverEditorAfterCloseAbort,
        },
      },
      runWorkflow: {
        codecs: createRunWorkflowCodecs({
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          activeRunFromRecord,
          canonicalLifecycleState,
          commentHasContent,
          commentEditSessionHasChanges,
          canLocateTarget,
          persistedComment,
          persistedChangeEvent,
          persistedTargetRef,
          uniqueTargets,
          fileStem,
          projectMarkdown,
          operationKey: activeRunOperationKey,
          errorMessage: productErrorMessage,
        }),
        canvas: {
          fencePendingEdit: (options: Record<string, unknown>) => (
            editorRef.current?.fencePendingEdit(options)
          ),
          freeze: (reason: string) => fenceAndFreezeCurrentCanvasRef.current(reason),
          unlock: () => editorRef.current?.unlockNow?.(),
          normalizeComments: () => normalizeCurrentGlobalCommentsRef.current(),
        },
        handoff: {
          copy: async ({ message }: { message: string }) => {
            const integrations = window.htmlAIIntegrations;
            if (integrations?.handoffToQoderWork) {
              const result = await integrations.handoffToQoderWork({ message });
              if (result.status !== "copied" || result.copied !== true) {
                throw new Error("桌面应用没有确认剪贴板写入并读回成功。");
              }
              return result;
            }
            if (!navigator.clipboard?.readText) {
              throw new Error("当前环境无法读回剪贴板内容，不能确认交接成功。");
            }
            await copyText(message);
            if (await navigator.clipboard.readText() !== message) {
              throw new Error("剪贴板读回内容与交接内容不一致。");
            }
            return { status: "copied", copied: true };
          },
        },
        scheduler: {
          setTimeout: (callback: () => void, delayMs: number) => (
            window.setTimeout(callback, delayMs)
          ),
          clearTimeout: (handle: unknown) => window.clearTimeout(handle as number),
        },
      },
      versionWorkflow: {
        codecs: {
          isRecord,
          sameSourcePath: sameLocalSourcePath,
          operationKey: activeRunOperationKey,
          errorMessage: productErrorMessage,
        },
        canvas: {
          deferCommand: (
            kind: string,
            run: () => void,
            options?: {
              authority?: NativeDeferredCommandAuthority;
              onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
            },
          ) => deferEditorCommand(kind, run, undefined, options),
          fencePendingEdit: (options: Record<string, unknown>) => (
            editorRef.current?.fencePendingEdit(options)
          ),
          freeze: (reason: string) => fenceAndFreezeCurrentCanvasRef.current(reason),
          verifyRendered: (
            expectedHtml: string,
            expectedSha256: string,
            context?: ProjectContext,
          ) => verifyCanvasRenderedRef.current(expectedHtml, expectedSha256, context),
          invalidateRenderAcks: invalidateCanvasRenderAcks,
          unlock: () => editorRef.current?.unlockNow?.(),
          requestFrame: (callback: () => void) => window.requestAnimationFrame(callback),
          onNavigationChange: (transitioning: boolean) => {
            versionTransitioningRef.current = transitioning;
          },
        },
      },
      clock: { now: Date.now },
    });
    workspaceControllerRef.current = controller;
    setWorkspaceController(controller);
    setWorkspaceControllerSnapshotState(controller.getSnapshot());
    return () => {
      if (workspaceControllerRef.current === controller) {
        workspaceControllerRef.current = null;
      }
      setWorkspaceController((current) => current === controller ? null : current);
      controller.dispose();
    };
  }, [bridgeConnectionReady, deferEditorCommand, invalidateCanvasRenderAcks, isViewTransitioning, projectPanelPort]);
  const invalidateEditCanvasRenderAck = useCallback(() => {
    setCanvasRenderAcks((current) => (
      current.edit ? { ...current, edit: null } : current
    ));
  }, []);
  const acknowledgeCanvasRender = useCallback((
    surface: CanvasMode,
    generation: number,
    sha256: string | null,
  ): boolean => {
    if (generation !== currentDocumentSessionSnapshot().canvasGeneration) return false;
    if (surface === "edit") {
      if (!sha256) return false;
      return workspaceControllerRef.current?.acknowledgeEditCanvas({
        generation,
        renderedSha256: sha256,
      }) === true;
    }
    setCanvasRenderAcks((current) => ({
      ...current,
      preview: sha256 ? { generation, sha256 } : null,
    }));
    return true;
  }, [currentDocumentSessionSnapshot]);
  const renderedContentSha256 =
    canvasRenderAcks.edit?.generation === canvasGeneration
      ? canvasRenderAcks.edit.sha256
      : null;
  const handlePreviewReady = useCallback((sha256: string | null) => {
    acknowledgeCanvasRender("preview", canvasGeneration, sha256);
  }, [acknowledgeCanvasRender, canvasGeneration]);
  const activeRun = runSnapshot.activeRun;
  const recentRunOutcome = runSnapshot.recentOutcome;
  const projectLocked = runSnapshot.activeLocked;
  const generating = runSnapshot.activeSubmission?.phase === "preparing";
  // Opening is not complete until the source has either proved its existing
  // v4 binding or been imported as a new V1. Keep the whole open/application/
  // hydration interval behind one interaction fence: ProjectWorkflow may then
  // reuse its first canonical prepareSwitch instead of repeating the drain
  // after the trusted Desktop read returns.
  const projectRegistrationPending = Boolean(
    workspaceController
    && sourcePath
    && (!projectId || !documentId)
    && !projectRecordsError,
  );
  const projectHydrating =
    workspaceControllerSnapshot?.project?.hydration.phase === "hydrating"
    || workspaceControllerSnapshot?.project?.open.phase === "opening"
    || projectApplicationSnapshot.status !== "idle"
    || projectRegistrationPending;
  const projectLoadError =
    workspaceControllerSnapshot?.project?.hydration.phase === "failed"
      ? workspaceControllerSnapshot.project.hydration.error
      : projectRecordsError || null;
  const [startupIssue, setStartupIssue] = useState<StartupIssue | null>(null);
  const [workspaceIssue, setWorkspaceIssue] = useState<WorkspaceIssue | null>(null);
  const [cancelRunConfirmationKey, setCancelRunConfirmationKey] =
    useState<string | null>(null);
  const [reviewPreparing, setReviewPreparing] = useState(false);
  const [openingReadyVersion, setOpeningReadyVersion] = useState(false);
  // Comment ids a blocked send was parked on. The send stays pending exactly
  // while at least one of them is still unsafe, so the promise lapses by
  // derivation — re-proofs, external reloads and cancels need no effect.
  const [submissionRelinkPendingIds, setSubmissionRelinkPendingIds] =
    useState<readonly string[]>([]);
  const [runtimeCapabilitiesReady, setRuntimeCapabilitiesReady] = useState(false);
  const [browserPreviewOnly, setBrowserPreviewOnly] = useState(false);
  const agentHandoffState = runSnapshot.activeHandoff;
  const [updateResult, setUpdateResult] =
    useState<ApplicationUpdateResult | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [aboutOpenSource, setAboutOpenSource] = useState<AboutOpenSource>("default");
  const [restartUpdateOpen, setRestartUpdateOpen] = useState(false);
  const [applicationVersion, setApplicationVersion] = useState("");
  const [desktopUpdatesAvailable, setDesktopUpdatesAvailable] = useState(false);
  const [manualUpdateCheckPending, setManualUpdateCheckPending] = useState(false);
  const [manualUpdateCheckFailed, setManualUpdateCheckFailed] = useState(false);
  const [repositoryOpenFailed, setRepositoryOpenFailed] = useState(false);
  const [releaseNotesOpenFailed, setReleaseNotesOpenFailed] = useState(false);
  const [userNoticeOpenFailed, setUserNoticeOpenFailed] = useState(false);
  const promptedUpdateVersionRef = useRef<string | null>(null);
  const [toast, setToastState] = useState<Toast>(null);
  const setToast = useCallback((next: Toast) => {
    const memory = noticeDismissalMemoryRef.current;
    if (next === null) {
      memory.rememberDismissal(toastRef.current);
      setToastState(null);
      return;
    }
    const incoming = memory.withRepeatCount(next);
    setToastState((current) => nextPresentedNotice(current, incoming) as Toast);
  }, []);
  const [pausedNoticeIdentity, setPausedNoticeIdentity] =
    useState<string | null>(null);
  const noticeDeadlineRef = useRef<{
    identity: string;
    deadlineAt: number;
    remainingMs: number;
    paused: boolean;
  } | null>(null);
  const lastHistoryDirectionRef = useRef<"undo" | "redo">("undo");
  const [externalSourcePreview, setExternalSourcePreview] = useState<{
    html: string;
    sourceSha256: string;
    lastModifiedAt: string;
  } | null>(null);
  const noticeIdentity = toast
    ? `${toast.dedupeKey || ""}\n${toast.title}\n${toast.message}`
    : "";
  const noticeTimerPaused = Boolean(
    noticeIdentity && pausedNoticeIdentity === noticeIdentity,
  );
  useEffect(() => {
    if (!workspaceController) return undefined;
    const setWorkspaceControllerSnapshot = (
      snapshot: WorkspaceControllerSnapshot,
    ) => {
      setWorkspaceControllerSnapshotState((current) => (
        sameWorkbenchRenderSnapshot(current, snapshot) ? current : snapshot
      ));
    };
    const unsubscribeSnapshot = workspaceController.subscribe(
      setWorkspaceControllerSnapshot,
    );
    const unsubscribe = workspaceController.subscribeEvents((event) => {
      if (event.type === "registration-published") {
        const registrationEvent = event as Readonly<{
          context: ProjectContext;
          projectRecordsPath: string | null;
          projectName: string | null;
          imported?: boolean;
          workingCopyRecovered?: boolean;
        }>;
        if (!workspaceController.matchesCurrentProjectContext(registrationEvent.context)) return;
        setProjectRecordsPath(registrationEvent.projectRecordsPath);
        setProjectRecordsPreparing(false);
        setProjectRecordsError("");
        if (registrationEvent.projectName) setProjectName(registrationEvent.projectName);
        if (registrationEvent.workingCopyRecovered) {
          setToast({
            title: "文件已自动恢复",
            message: "已采用磁盘中的最新内容。",
            tone: "success",
            disposition: "background-result",
            dedupeKey: "working-copy-recovered",
          });
        }
        return;
      }
      if (event.type === "workbench-tabs-restore-missing") {
        const missingValue = (event as { missing?: unknown }).missing;
        const missing = Array.isArray(missingValue) ? missingValue : [];
        setGlobalSidebarOpen(true);
        setToast({
          title: missing.length === 1
            ? "无法恢复一个 HTML"
            : `无法恢复 ${missing.length} 个 HTML`,
          message: "项目可能已移动或删除。已保留可用标签，可从 Finder 重新打开。",
          tone: "warning",
          sticky: true,
          disposition: "background-result",
          dedupeKey: "workbench-restored-projects-missing",
          action: { id: "retry-project-open", label: "从 Finder 重新打开" },
        });
        return;
      }
      if (event.type === "workbench-tabs-persistence-failed") {
        setToast({
          title: "标签页状态未安全保存",
          message: String(event.reason || "当前窗口会保持开启，请重试后再关闭。"),
          tone: "error",
          sticky: true,
          disposition: "background-result",
          dedupeKey: "workbench-tabs-persistence-failed",
        });
        return;
      }
      if (event.type === "workbench-tabs-restore-failed") {
        const failure = event as { tabId?: unknown; committed?: unknown; reason?: unknown };
        if (failure.committed === true) {
          setToast({
            title: "HTML 已打开，但恢复未完成",
            message: String(
              failure.reason || "当前标签和 Controller 身份已对齐，请重试权威读取。",
            ),
            tone: "error",
            sticky: true,
            disposition: "direct-action",
            dedupeKey: `workbench-restore-settle-failed:${String(failure.tabId || "")}`,
            action: { id: "retry-project-hydration", label: "重试恢复" },
          });
        } else {
          setGlobalSidebarOpen(true);
          setToast({
            title: "无法恢复这个 HTML",
            message: String(
              failure.reason || "项目可能已移动或删除，请从 Finder 重新打开。",
            ),
            tone: "warning",
            sticky: true,
            disposition: "background-result",
            dedupeKey: `workbench-restore-failed:${String(failure.tabId || "")}`,
            action: { id: "retry-project-open", label: "从 Finder 重新打开" },
          });
        }
        return;
      }
      if (event.type === "external-open-completed") {
        const openEvent = event as Readonly<{
          imported?: boolean;
          disposition?: string;
          visibleV1FileName?: string;
          sourcePath?: string | null;
        }>;
        if (!openEvent.imported) return;
        const fileName = openEvent.visibleV1FileName || "项目内的 V1 文件";
        const disposition = openEvent.disposition || "kept";
        const message = disposition === "trashed"
          ? `已保存为${fileName}，原文件已移至废纸篓。`
          : disposition === "trash-failed"
            ? `已保存为${fileName}，原文件未能移至废纸篓，仍留在原来的位置。`
            : `已保存为${fileName}，原文件已保留。`;
        setToast({
          title: "已导入 PageRoot",
          message,
          tone: disposition === "trash-failed" ? "warning" : "success",
          disposition: "background-result",
          dedupeKey: "external-html-imported",
          ...(openEvent.sourcePath ? {
            action: {
              id: "reveal-imported-project" as const,
              label: "在文件夹中打开",
              sourcePath: openEvent.sourcePath,
            },
          } : {}),
        });
        return;
      }
      if (event.type === "external-open-ack-failed") {
        const ackEvent = event as Readonly<{
          requestId?: string;
          confirmation?: boolean;
          reason?: string;
        }>;
        if (!ackEvent.confirmation || !ackEvent.requestId) return;
        setToast({
          title: "HTML 已处理，等待 Finder 回执",
          message: ackEvent.reason || "回执暂时发送失败；重试只会发送回执，不会重复打开 HTML。",
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: `external-open-ack:${ackEvent.requestId}`,
          action: {
            id: "retry-external-project-open",
            label: "重试回执",
            requestId: ackEvent.requestId,
          },
        });
        return;
      }
      if (event.type === "external-open-canvas-failed") {
        const canvasEvent = event as Readonly<{ reason?: string }>;
        setToast({
          title: "画布确认失败",
          message: canvasEvent.reason || "当前画布尚未完成自动恢复。",
          tone: "error",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "canvas-verification-failed",
          action: {
            id: "retry-canvas-verification",
            label: "重试",
          },
        });
        return;
      }
      if (event.type === "version-refresh-warning") {
        const refreshEvent = event as Readonly<{
          context?: ProjectContext | null;
          candidateLabel?: string;
          reason?: string;
        }>;
        if (
          refreshEvent.context
          && !workspaceController.matchesCurrentProjectContext(refreshEvent.context)
        ) return;
        setToast({
          title: `${refreshEvent.candidateLabel || "新版本"} 已打开，但需要复核`,
          message: refreshEvent.reason || "项目资料尚未完成复核。",
          tone: "warning",
          sticky: true,
          disposition: "background-result",
          dedupeKey: "current-version-result",
        });
        return;
      }
      if (event.type === "version-activation-published") {
        const publication = event as Readonly<{ context?: ProjectContext | null; operationKey?: string; lastModifiedAt?: string }>;
        if (
          !publication.context
          || !workspaceController.matchesCurrentProjectContext(publication.context)
        ) return;
        const review = readyReviewSession;
        if (!review || review.operationKey === publication.operationKey) {
          setReadyReviewSession(null);
          performance.mark("pageroot:accept:overlay-closed");
        }
        setLastModifiedAt(publication.lastModifiedAt || null);
        commentCanvasPort.setSelection(null);
        commentEditResumePendingRef.current = null;
        commentCanvasPort.setEditingCommentId(null);
        setPreviewAttachment(null);
        setHandoffPreviewOpen(false);
        setCanvasMode("edit");
        setDrawer(null);
        performance.mark("pageroot:accept:ui-published");
        return;
      }
      if (event.type === "attachment-cleanup-failed") {
        const attachmentEvent = event as Readonly<{
          context?: ProjectContext | null;
          attachment?: CommentAttachment;
          outcome?: { reason?: unknown };
        }>;
        if (
          attachmentEvent.context
          && !workspaceController.matchesCurrentProjectContext(attachmentEvent.context)
        ) return;
        const fileName = attachmentEvent.attachment?.fileName || "附件";
        setToast({
          title: "附件已从评论中移除",
          message: `${fileName} 的项目副本暂时无法清理：${String(
            attachmentEvent.outcome?.reason || "请稍后重新打开项目核对。",
          )}`,
          tone: "warning",
          disposition: "background-result",
          dedupeKey: `attachment-cleanup-${attachmentEvent.attachment?.attachmentId || "unknown"}`,
        });
        return;
      }
      const runEvent = event as Readonly<{
        type: string;
        run?: ActiveRun | null;
        state?: LifecycleState;
        current?: boolean;
        previousState?: LifecycleState;
        agentMayBeRunning?: boolean;
        message?: string;
      }>;
      if (runEvent.type === "run-submission-started" || runEvent.type === "run-submitted") {
        if (runEvent.current) {
          setHandoffPreviewOpen(false);
          // Reported in the thread, not by a drawer over the page.
          setCanvasMode("preview");
          revealAiConversation();
          void workspaceControllerRef.current?.dismissFirstEditGuide();
        }
        return;
      }
      if (runEvent.type === "run-submission-uncertain") {
        if (runEvent.current) {
          void workspaceControllerRef.current?.dismissFirstEditGuide();
        }
        return;
      }
      if (runEvent.type === "run-submission-failed") {
        return;
      }
      if (runEvent.type === "run-handoff-failed") {
        if (runEvent.current && runEvent.run) {
          setToast({
            title: "交接内容还没有复制",
            message: runEvent.message || "这次任务还在，打开本轮后可以重新复制",
            tone: "error",
            sticky: true,
            dedupeKey: `qoder-handoff:${runEvent.run.sourcePath}`,
            action: { id: "open-handoff", label: "回到 AI 助手" },
          });
        }
        return;
      }
      if (runEvent.type === "run-agent-failed") {
        if (runEvent.current && runEvent.run) {
          // A refused *retry* is not a failed round. AGENT_RETRY_OUTPUT_PRESENT means
          // an earlier attempt already produced output, which the Bridge correctly
          // refuses to overwrite — but when that output is a usable candidate, the
          // failure copy ("请结束本轮后重新发送") tells the user to throw away the very
          // result the decision bar is asking them to accept. Both statements were on
          // screen at once and the user could not tell whether the round worked.
          if (runEvent.run.candidateVersionLabel) {
            setToast({
              title: "这一轮已经有结果了",
              message: "重复的发送已被忽略；先决定要不要采纳这一版。",
              tone: "success",
              dedupeKey: `qoder-agent:${runEvent.run.requestId}`,
            });
            return;
          }
          setToast({
            title: "Qoder CLI 没有完成本轮",
            message: runEvent.message
              || "本轮 Request 已保留，请查看处理详情选择安全的后续操作。",
            tone: "warning",
            sticky: true,
            disposition: "user-choice",
            dedupeKey: `qoder-agent:${runEvent.run.requestId}`,
            action: { id: "open-handoff", label: "回到 AI 助手" },
          });
        }
        return;
      }
      if (runEvent.type === "run-status") {
        const run = runEvent.run;
        const state = runEvent.state;
        if (runEvent.current) {
          if (state === "cancelled") {
            setHandoffPreviewOpen(false);
            setCanvasMode("edit");
            setDrawer(null);
          } else if (
            state === "ready-to-open"
            || state === "no-change"
            || state === "error"
            || state === "awaiting-conflict-resolution"
            || state === "recovering-transaction"
          ) {
            // A finished round is reported by the conversation: the sidebar moves to
            // "结果 · 等待决定" and its action bar carries the decision. Only the
            // Exceptional states stay in the same conversation when it is open;
            // background projects must never navigate the visible project.
            if (state === "ready-to-open" && toastRef.current?.dedupeKey === "ai-submit") {
              setToast(null);
            }
            if (state === "error" && run) {
              setToast({
                title: "AI 输出未通过安全校验",
                message: run.error || "提交的 HTML 不完整或格式错误。",
                tone: "error",
                sticky: true,
                disposition: "user-choice",
                dedupeKey: `ai-validation-error:${run.requestId}`,
                action: { id: "open-handoff", label: "回到 AI 助手" },
              });
            }
          }
        } else if (
          run
          && state === "ready-to-open"
          && runEvent.previousState !== "ready-to-open"
        ) {
          setToast({
            title: `${run.candidateVersionLabel} 可以打开了`,
            message: "切回项目确认后再打开，当前画布没有被替换。",
            tone: "success",
            disposition: "background-result",
            dedupeKey: `background-version:${run.sourcePath}`,
            action: { id: "open-project", label: "打开项目", sourcePath: run.sourcePath },
          });
        }
        return;
      }
      if (runEvent.type === "run-cancelled") {
        if (runEvent.current) {
          setHandoffPreviewOpen(false);
          setCanvasMode("edit");
          setDrawer(null);
        }
        if (runEvent.agentMayBeRunning && runEvent.run) {
          setToast({
            title: runEvent.current ? "本轮已结束，已恢复编辑" : "本轮已结束",
            message: "AI Agent 不会被自动停止；如仍在运行，请手动停止。",
            tone: "info",
            disposition: "background-result",
            dedupeKey: `ai-run-cancelled:${runEvent.run.sourcePath}`,
          });
        } else if (!runEvent.current && runEvent.run) {
          setToast({
            title: `${runEvent.run.candidateVersionLabel} 已取消`,
            message: "对应项目的评论仍然保留，迟到的完成信号不会被接纳。",
            tone: "success",
            dedupeKey: `background-version:${runEvent.run.sourcePath}`,
          });
        }
        return;
      }
      const projectEvent = event as Readonly<{
        type: string;
        project?: unknown;
        context?: ProjectContext;
        stage?: unknown;
        reason?: unknown;
        code?: unknown;
        kind?: unknown;
        operationId?: unknown;
        timing?: unknown;
        sourcePath?: unknown;
        projects?: unknown;
        projectName?: unknown;
        projectRecordsPath?: unknown;
        lastModifiedAt?: unknown;
        showHandoff?: unknown;
        contentChanged?: unknown;
        activeLocked?: unknown;
        epoch?: unknown;
        requestId?: unknown;
        ackPending?: unknown;
        tabId?: unknown;
        sourceSha256?: unknown;
        hot?: unknown;
      }>;
      if (projectEvent.type === "project-hydration-stage") {
        markProjectHydrationStage(String(projectEvent.stage || ""), projectEvent.operationId, projectEvent.timing);
        return;
      }
      if (projectEvent.type === "document-surface-prewarmed") {
        markDocumentSurfacePrewarmed(
          projectEvent.tabId,
          projectEvent.sourceSha256,
          projectEvent.hot,
        );
        return;
      }
      if (projectEvent.type === "project-browser-file-requested") {
        const input = fileInputRef.current;
        if (input) {
          input.dataset.projectOperationId = String(projectEvent.operationId || "");
          input.click();
        }
        return;
      }
      if (projectEvent.type === "project-applied") {
        const project = projectEvent.project as HtmlProject;
        markProjectApplied(projectEvent.operationId, projectEvent.epoch);
        setStartupIssue(null);
        setProjectName(project.name);
        setProjectRecordsPath(null);
        setLastModifiedAt(project.lastModifiedAt || null);
        commentCanvasPort.setSelection(null);
        restoreCachedDocumentPresentation({
          controller: workspaceController, project, setPageViewContext,
          setCanvasMode, stage: reviewStageRef.current,
        });
        // Exact identity keys let tab changes cancel work without purging cache.
        reviewAnalysisSession.cancel();
        commentCanvasPort.setComposerOpen(false);
        for (const url of attachmentObjectUrlsRef.current.values()) {
          try {
            URL.revokeObjectURL(url);
          } catch {
            // A retired preview URL cannot block the next project's authority.
          }
        }
        attachmentObjectUrlsRef.current.clear();
        setAttachmentObjectUrls({});
        setPreviewAttachment(null);
        commentEditResumePendingRef.current = null;
        resumeSubmissionAfterRelinkRef.current = false;
        commentCanvasPort.resetLayout();
        setCanvasMode(
          runtimeCapabilitiesRef.current.sourceEditing !== "enabled"
            ? "preview"
            : "edit",
        );
        setSourceViewTransitioning(false);
        setProjectRecordsPreparing(false);
        setProjectRecordsError("");
        setOpeningReadyVersion(Boolean(
          workspaceController.getSnapshot().runSession?.activeRun
          && workspaceController.getSnapshot().runSession?.operationKeys.some(
            ([kind, key]) => (
              kind === "activate"
              && key === activeRunOperationKey(
                workspaceController.getSnapshot().runSession?.activeRun as ActiveRun,
              )
            ),
          ),
        ));
        setDrawer(null);
        const reviewStage = reviewStageRef.current;
        if (reviewStage && typeof reviewStage.scrollTo === "function") {
          try {
            reviewStage.scrollTo({ top: 0 });
          } catch {
            // Scrolling is presentational and cannot own a project transition.
          }
        }
        return;
      }
      if (projectEvent.type === "project-draft-recovered") {
        commentEditResumePendingRef.current = null;
        commentCanvasPort.setEditingCommentId(null);
        commentCanvasPort.setComposerOpen(false);
        return;
      }
      if (projectEvent.type === "project-hydrated") {
        if (
          projectEvent.context
          && !workspaceController.matchesCurrentProjectContext(projectEvent.context)
        ) return;
        if (typeof projectEvent.projectName === "string" && projectEvent.projectName) {
          setProjectName(projectEvent.projectName);
        }
        setProjectRecordsPath(
          typeof projectEvent.projectRecordsPath === "string"
            ? projectEvent.projectRecordsPath
            : null,
        );
        setLastModifiedAt(
          typeof projectEvent.lastModifiedAt === "string"
            ? projectEvent.lastModifiedAt
            : null,
        );
        if (projectEvent.showHandoff) {
          setHandoffPreviewOpen(false);
          setCanvasMode("edit");
        }
        return;
      }
      if (projectEvent.type === "project-startup-failed") {
        setStartupIssue({
          title: "上次打开的 HTML 无法恢复",
          message: String(
            projectEvent.reason
            || "文件可能已移动、删除或损坏。源页没有打开其他内容来替代它。",
          ),
        });
        return;
      }
      if (projectEvent.type === "project-startup-ready") {
        setStartupIssue(null);
        return;
      }
      if (projectEvent.type === "project-application-deferred") {
        setToast({
          title: "当前 HTML 尚未完成安全切换",
          message: "已保留已接受的 HTML；当前画布恢复后可手动继续切换。",
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "project-application-deferred",
          action: { id: "retry-project-application", label: "继续切换" },
        });
        return;
      }
      if (projectEvent.type === "external-project-open-deferred") {
        const ackPending = projectEvent.ackPending === true;
        setToast({
          title: ackPending
            ? "HTML 已处理，等待 Finder 回执"
            : "暂不能切换到 QoderWork 中的 HTML",
          message: ackPending
            ? "回执暂时发送失败；重试只会发送回执，不会重复打开 HTML。"
            : "当前画布仍在安全恢复；已保留当前 HTML。恢复后可手动重试打开。",
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "external-project-open-deferred",
          action: {
            id: "retry-external-project-open",
            label: ackPending ? "重试回执" : "重试打开",
          },
        });
        return;
      }
      if (projectEvent.type === "external-project-open-unavailable") {
        setToast({
          title: "无法接收外部 HTML",
          message: String(projectEvent.reason || "当前 PageRoot 版本缺少外部文件打开通道。"),
          tone: "error",
          sticky: true,
          disposition: "background-result",
          dedupeKey: "external-project-open-unavailable",
        });
        return;
      }
      if (projectEvent.type === "project-open-failed") {
        const external = projectEvent.kind === "external";
        const message = String(
          projectEvent.reason || "文件暂时无法完成安全切换。",
        );
        setToast(external ? {
          title: "无法打开 QoderWork 中的 HTML",
          message,
          tone: "error",
          sticky: true,
          disposition: "background-result",
          dedupeKey: "external-project-open-error",
        } : {
          title: "无法打开这个 HTML",
          message,
          tone: "error",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "project-open-error",
            action: {
              id: "retry-project-open",
              label: projectEvent.kind === "recent" ? "重新选择位置" : "重新选择",
            },
        });
        return;
      }
      if (projectEvent.type === "project-close-reconciliation-blocked") {
        const reason = String(projectEvent.reason || "关闭核对期间当前项目已切换。");
        if (projectEvent.code === "source-integrity-failed") {
          setWorkspaceIssue({ title: "源文件需要重新核对", message: reason });
        } else {
          setToast({
            title: "当前页面仍保持开启",
            message: reason,
            tone: "info",
            disposition: "background-result",
            dedupeKey: "close-source-reconciliation",
          });
        }
        return;
      }
      if (projectEvent.type === "project-source-locator-failed") {
        const locatorCode = String(projectEvent.code || "");
        if (locatorCode === "MANAGED_PATH_AMBIGUOUS") {
          setToast({
            title: "无法确定工作文件",
            message: "检测到多个同等候选文件；修改仍保留，请先恢复唯一文件位置。",
            tone: "warning",
            sticky: true,
            disposition: "user-choice",
            dedupeKey: "managed-working-copy-ambiguous",
            action: { id: "retry-project-open", label: "重新选择文件" },
          });
          return;
        }
        if (
          locatorCode === "WORKING_COPY_UNAVAILABLE"
          || locatorCode === "REGISTERED_PROJECT_UNAVAILABLE"
        ) {
          setToast({
            title: "文件暂不可用",
            message: "当前工作文件暂时不可用，修改仍保留。",
            tone: "warning",
            sticky: true,
            disposition: "inform-in-place",
            dedupeKey: "working-copy-unavailable",
          });
          return;
        }
        if (locatorCode === "MANAGED_SOURCE_IDENTITY_MISMATCH") {
          setToast({
            title: "无法核对工作文件",
            message: "当前工作文件身份无法核对，PageRoot 没有切换路径。",
            tone: "warning",
            sticky: true,
            disposition: "inform-in-place",
            dedupeKey: "managed-source-identity-mismatch",
          });
          return;
        }
        return;
      }
      if (
        projectEvent.type === "project-source-renamed"
        || projectEvent.type === "project-source-relocated"
      ) {
        if (typeof projectEvent.projectName === "string" && projectEvent.projectName) {
          setProjectName(projectEvent.projectName);
        }
        if (typeof projectEvent.lastModifiedAt === "string") {
          setLastModifiedAt(projectEvent.lastModifiedAt);
        }
        if (
          projectEvent.type === "project-source-relocated"
          && projectEvent.contentChanged !== true
        ) {
          setToast({
            title: "文件名已与 Finder 同步",
            message: "已继续使用同一工作文件。",
            tone: "success",
            disposition: "background-result",
            dedupeKey: "finder-filename-synced",
          });
        }
        return;
      }
      const documentEvent = event as Readonly<{
        type: string;
        context?: ProjectContext;
        lastModifiedAt?: unknown;
        events?: unknown;
        mutation?: HtmlCanvasMutation;
        code?: unknown;
        message?: unknown;
        fatal?: unknown;
      }>;
      if (
        documentEvent.context
        && !workspaceController.matchesCurrentProjectContext(documentEvent.context)
      ) return;
      if (documentEvent.type === "document-direct-edit-recorded") {
        if (documentEvent.mutation) {
          captureUsageEvent("direct_edit_committed", {
            edit_kind: documentEvent.mutation.kind,
            property_group: documentEvent.mutation.kind === "text"
              ? "text"
              : editPropertyGroup(documentEvent.mutation.property),
          }, documentEvent.context?.projectId || undefined);
        }
      }
      if (documentEvent.type === "document-persistence-failed") {
        const persistenceCode = String(documentEvent.code || "");
        if (persistenceCode === "REGISTERED_PROJECT_UNAVAILABLE") {
          setToast({
            title: "项目暂不可用",
            message: "修改仍保留；放回原登记位置后自动恢复",
            tone: "warning",
            sticky: true,
            disposition: "inform-in-place",
            dedupeKey: "registered-project-unavailable",
          });
          return;
        }
        if (persistenceCode === "WORKING_COPY_UNAVAILABLE") {
          setToast({
            title: "文件暂不可用",
            message: "当前工作文件暂时不可用，修改仍保留。",
            tone: "warning",
            sticky: true,
            disposition: "inform-in-place",
            dedupeKey: "working-copy-unavailable",
          });
          return;
        }
        if (persistenceCode === "WORKING_COPY_CONFLICT") {
          setToast({
            title: "文件出现内容冲突",
            message: "磁盘文件与未保存修改都已保留；请先核对内容后再决定如何继续。",
            tone: "warning",
            sticky: true,
            disposition: "user-choice",
            dedupeKey: "working-copy-content-conflict",
            action: { id: "retry-project-open", label: "重新选择文件" },
          });
          return;
        }
        if (persistenceCode === "MANAGED_PATH_AMBIGUOUS") {
          setToast({
            title: "无法确定工作文件",
            message: "检测到多个同等候选文件；修改仍保留，请先恢复唯一文件位置。",
            tone: "warning",
            sticky: true,
            disposition: "user-choice",
            dedupeKey: "managed-working-copy-ambiguous",
            action: { id: "retry-project-open", label: "重新选择文件" },
          });
        }
      }
      if (documentEvent.type === "document-open-target-rebound") {
        setToast({
          title: "项目位置已自动恢复",
          message: "已核对项目身份并继续使用登记项目。",
          tone: "success",
          disposition: "background-result",
          dedupeKey: "registered-project-recovered",
        });
      }
      if (
        [
          "document-persisted",
          "document-authority-reloaded",
          "document-authority-repaired",
          "document-boundary-reconciled",
          "document-history-applied",
        ].includes(documentEvent.type)
        && typeof documentEvent.lastModifiedAt === "string"
        && documentEvent.lastModifiedAt
      ) {
        setLastModifiedAt(documentEvent.lastModifiedAt);
      }
      if (documentEvent.type === "document-recovery-queued") {
        setToast({
          title: "已恢复上次未写回的编辑",
          message: "工作台正在把异常退出前的内容安全更新到源 HTML。",
          tone: "info",
          dedupeKey: "autosave-recovery",
        });
      }
    });
    return () => {
      unsubscribe();
      unsubscribeSnapshot();
    };
  }, [
    commentCanvasPort,
    readyReviewSession,
    reviewAnalysisSession,
    revealAiConversation,
    setSourceViewTransitioning,
    workspaceController,
  ]);
  useEffect(() => () => reviewAnalysisSession.dispose(), [reviewAnalysisSession]);
  const reportInterruptionPresence = useCallback((
    interruptionCode: string,
    present: boolean,
    surface: "canvas" | "global" | "native" | "panel",
    resolvedResult: "dismissed" | "recovered" = "recovered",
    eventProjectId?: string,
    localScope?: string,
  ) => {
    const identity = `${localScope || eventProjectId || "global"}:${interruptionCode}`;
    const previous = interruptionPresenceRef.current.get(identity) || false;
    if (previous === present) return;
    interruptionPresenceRef.current.set(identity, present);
    captureUsageEvent("interruption_changed", {
      interruption_code: interruptionCode,
      phase: present ? "started" : "resolved",
      result: present ? "unknown" : resolvedResult,
      surface,
    }, eventProjectId);
  }, []);

  useEffect(() => {
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    if (!sourcePath) return;
    captureUsageEvent("project_context_opened", {
      registered: Boolean(projectId),
      view_mode: viewMode,
    }, projectId || undefined);
  }, [projectId, sourcePath, viewMode]);

  useEffect(() => {
    if (drawer) {
      captureUsageEvent("module_viewed", {
        module: drawer === "files" ? "project_files" : drawer,
      }, projectId || undefined);
    }
  }, [drawer, projectId]);

  useEffect(() => {
    captureUsageEvent("module_viewed", {
      module: canvasMode === "preview" ? "canvas_preview" : "canvas_edit",
    }, projectId || undefined);
  }, [canvasMode, projectId]);

  useEffect(() => {
    if (aboutOpen) {
      captureUsageEvent("module_viewed", { module: "about" }, projectId || undefined);
    }
  }, [aboutOpen, projectId]);

  useEffect(() => {
    const localScope = projectId || usageFingerprint(sourcePath || "unregistered");
    const previous = previousPersistStateRef.current.get(localScope);
    previousPersistStateRef.current.set(localScope, persistState);
    if (previous && previous !== persistState) {
      captureUsageEvent("source_persistence_changed", {
        from_state: previous,
        to_state: persistState,
      }, projectId || undefined);
    }
    reportInterruptionPresence(
      "source_conflict",
      persistState === "conflict",
      "canvas",
      "recovered",
      projectId || undefined,
      localScope,
    );
  }, [persistState, projectId, reportInterruptionPresence, sourcePath]);

  useEffect(() => {
    const nextState = activeRun?.status || "none";
    const eventProjectId = activeRun?.projectId || projectId || undefined;
    const localScope = eventProjectId || usageFingerprint(sourcePath || "unregistered");
    const previous = previousRunStateRef.current.get(localScope);
    previousRunStateRef.current.set(localScope, nextState);
    if (previous && previous !== nextState) {
      captureUsageEvent("ai_run_state_changed", {
        from_state: previous,
        to_state: nextState,
        comment_count: countBucket(activeRun?.commentCount || 0),
        edit_count: countBucket(activeRun?.changeEventCount || 0),
      }, eventProjectId);
    }
    reportInterruptionPresence(
      "ai_conflict_resolution",
      nextState === "awaiting-conflict-resolution",
      "panel",
      "recovered",
      eventProjectId,
      localScope,
    );
  }, [activeRun, projectId, reportInterruptionPresence, sourcePath]);

  useEffect(() => {
    reportInterruptionPresence(
      "workspace_unavailable",
      Boolean(workspaceIssue),
      "global",
    );
  }, [reportInterruptionPresence, workspaceIssue]);

  useEffect(() => {
    reportInterruptionPresence(
      "startup_recovery",
      Boolean(startupIssue),
      "global",
    );
  }, [reportInterruptionPresence, startupIssue]);

  useEffect(() => {
    reportInterruptionPresence(
      "project_load_failure",
      Boolean(projectLoadError),
      "canvas",
      "recovered",
      projectId || undefined,
      projectId || usageFingerprint(sourcePath || "unregistered"),
    );
  }, [
    projectId,
    projectLoadError,
    reportInterruptionPresence,
    sourcePath,
  ]);

  useEffect(() => {
    reportInterruptionPresence(
      "update_restart_confirmation",
      restartUpdateOpen,
      "panel",
      "dismissed",
    );
  }, [reportInterruptionPresence, restartUpdateOpen]);

  useEffect(() => {
    const updates = window.htmlAIUpdates;
    if (!updates) return undefined;
    let active = true;
    const receiveStatus = (result: ApplicationUpdateResult | null) => {
      if (active) setUpdateResult(result);
    };
    const unsubscribe = updates.onStatus(receiveStatus);
    queueMicrotask(() => {
      if (active) setDesktopUpdatesAvailable(true);
    });
    void updates.getStatus().then(receiveStatus).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setApplicationVersion(window.htmlAIRuntime?.appVersion || "");
    });
    return () => {
      active = false;
    };
  }, []);

  const relaunchApp = useCallback(async () => {
    try {
      await window.htmlAIAppLifecycle?.relaunch();
    } catch (cause) {
      setWorkspaceIssue({
        title: "本地项目资料暂时不可用",
        message: productErrorMessage(
          cause,
          "当前页面内容仍保留。可先导出当前编辑，再重新打开源页。",
        ),
      });
    }
  }, []);

  const openAboutPageRoot = useCallback((source: AboutOpenSource = "default") => {
    setManualUpdateCheckFailed(false);
    setRepositoryOpenFailed(false);
    setReleaseNotesOpenFailed(false);
    setUserNoticeOpenFailed(false);
    setAboutOpenSource(source);
    setAboutOpen(true);
  }, []);

  useEffect(() => {
    openAgentSettingsRef.current = () => openAboutPageRoot("agent-settings");
    return () => {
      openAgentSettingsRef.current = null;
    };
  }, [openAboutPageRoot]);

  useEffect(() => {
    const lifecycle = window.htmlAIAppLifecycle;
    if (!lifecycle?.onWorkspaceUnavailable) return undefined;
    return lifecycle.onWorkspaceUnavailable((issue) => {
      setWorkspaceIssue({
        title: issue.title || "本地项目资料暂时不可用",
        message: issue.message
          || "当前页面内容仍保留。可先导出当前编辑，再重新打开源页。",
      });
    });
  }, []);

  useEffect(() => {
    const lifecycle = window.htmlAIAppLifecycle;
    if (!lifecycle?.onAboutRequested) return undefined;
    return lifecycle.onAboutRequested(openAboutPageRoot);
  }, [openAboutPageRoot]);

  const checkForApplicationUpdates = useCallback(async () => {
    const updates = window.htmlAIUpdates;
    setManualUpdateCheckFailed(false);
    if (!updates) {
      setManualUpdateCheckFailed(true);
      return;
    }
    setManualUpdateCheckPending(true);
    try {
      const result = await updates.checkNow();
      setUpdateResult(result);
    } catch {
      setManualUpdateCheckFailed(true);
    } finally {
      setManualUpdateCheckPending(false);
    }
  }, []);

  const openProjectRepository = useCallback(async () => {
    setRepositoryOpenFailed(false);
    try {
      const updates = window.htmlAIUpdates;
      if (updates) {
        const result = await updates.openRepository();
        if (!result?.opened) throw new Error("GitHub repository did not open.");
        return;
      }
      window.open(PROJECT_REPOSITORY_URL, "_blank", "noopener,noreferrer");
    } catch {
      setRepositoryOpenFailed(true);
    }
  }, []);

  const openReleaseNotes = useCallback(async () => {
    setReleaseNotesOpenFailed(false);
    try {
      const updates = window.htmlAIUpdates;
      if (updates) {
        const result = await updates.openLatestRelease();
        if (!result?.opened) throw new Error("Release notes did not open.");
        return;
      }
      window.open(LATEST_RELEASE_PAGE_URL, "_blank", "noopener,noreferrer");
    } catch {
      setReleaseNotesOpenFailed(true);
    }
  }, []);

  const openUserNotice = useCallback(async () => {
    setUserNoticeOpenFailed(false);
    try {
      const result = await window.htmlAIAppLifecycle?.openUserNotice();
      if (!result?.opened) throw new Error("User notice did not open.");
    } catch {
      setUserNoticeOpenFailed(true);
    }
  }, []);

  const closeAboutPageRoot = useCallback(() => {
    setAboutOpen(false);
    setAboutOpenSource("default");
  }, []);

  const downloadAvailableUpdate = useCallback(async () => {
    try {
      const result = await window.htmlAIUpdates?.downloadAvailable();
      if (result) setUpdateResult(result);
    } catch {
      // The main-process controller publishes a bounded unavailable state.
    }
  }, []);

  const installDownloadedUpdate = useCallback(async (): Promise<boolean> => {
    try {
      const result = await window.htmlAIUpdates?.installDownloaded();
      if (!result?.installing) {
        throw new Error(result?.reason || "下载的更新尚未准备完成。");
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    const version = updateResult?.latestVersion;
    if (
      updateResult?.status !== "downloaded"
      || !version
      || promptedUpdateVersionRef.current === version
    ) {
      return;
    }
    promptedUpdateVersionRef.current = version;
    setRestartUpdateOpen(true);
  }, [updateResult]);

  const viewingVersion = useMemo(
    () => versions.find((version) => version.id === viewingVersionId) || null,
    [versions, viewingVersionId],
  );
  const runInProgress = projectLocked;
  const currentAgentHandoffStatus = (
    activeRun?.sourcePath
    && activeRun.requestId
    && sameLocalSourcePath(agentHandoffState?.sourcePath, activeRun.sourcePath)
    && agentHandoffState?.requestId === activeRun.requestId
    && agentHandoffState.attemptId === activeRun.attemptId
  )
    ? agentHandoffState.status
    : "idle";
  const currentAgentDeliveryState = currentAgentHandoffStatus === "idle" ? null : agentHandoffState;
  const currentAgentDeliveryMode =
    currentAgentDeliveryState?.mode || activeRun?.agentDelivery?.mode || "clipboard";
  const handoffCancellationNeedsConfirmation = Boolean(
    activeRun?.status === "processing"
    && runSnapshot.activeHandoffMayBeRunning
    && !runSnapshot.activeHandoffManaged,
  );
  const cancelRunConfirmationOpen = Boolean(
    cancelRunConfirmationKey
    && activeRun
    && activeRunOperationKey(activeRun) === cancelRunConfirmationKey
    && activeRun.status === "processing"
    && handoffCancellationNeedsConfirmation,
  );
  const updateActionVisible = Boolean(
    (
      updateResult?.status === "available"
      || updateResult?.status === "downloading"
      || updateResult?.status === "downloaded"
    )
    && updateResult.latestVersion,
  );
  const updateDownloaded = updateResult?.status === "downloaded";
  const updateDownloading = updateResult?.status === "downloading";
  const updateBadgeLabel = updateDownloaded ? "重启更新" : "New!";
  const currentSourceFileName =
    localFileNameFromSourcePath(sourcePath) || projectName;
  useEffect(() => {
    if (!workspaceController || !projectId || !documentId) return;
    const tabId = `document:${projectId}:${documentId}`;
    const projected = workspaceController.getSnapshot().workbenchTabs;
    if (!projected?.tabs.some((tab) => tab.tabId === tabId)) return;
    workspaceController.updateWorkbenchTabTitle(
      projectId,
      documentId,
      currentSourceFileName,
    );
    workspaceController.updateWorkbenchTabStatus(
      projectId,
      documentId,
      projectLoadError || persistState === "failed" || persistState === "conflict"
        ? "error"
        : readyReviewSession
          ? "review-ready"
          : runInProgress
            ? "processing"
            : "normal",
    );
  }, [
    currentSourceFileName,
    documentId,
    persistState,
    projectId,
    projectLoadError,
    projectName,
    readyReviewSession,
    runInProgress,
    workspaceController,
  ]);
  const interactionLocked = runInProgress
    || browserPreviewOnly
    || projectHydrating
    || Boolean(projectLoadError)
    || Boolean(workspaceIssue)
    || viewTransitioning
    || persistState === "conflict"
    || viewMode === "history";
  const firstEditGuideVisible =
    workspaceControllerSnapshot?.firstEditGuide?.visible === true;
  const isBuiltInWelcomePage = Boolean(
    projectId
    && workspaceControllerSnapshot?.firstEditGuide?.builtInWelcomeProjectId
    && projectId === workspaceControllerSnapshot.firstEditGuide.builtInWelcomeProjectId
  );
  useEffect(() => {
    workspaceController?.evaluateFirstEditGuide({
      desktop: runtimeCapabilitiesReady
        && runtimeCapabilitiesRef.current.projectOpening === "desktop-dialog",
      browserPreviewOnly,
      canvasMode,
      canvasVerified: Boolean(
        documentSnapshot.canvasAuthority?.status === "verified"
        && documentSnapshot.canvasAuthority.generation === canvasGeneration
        && documentSnapshot.canvasAuthority.renderedSha256 === sourceSha256
      ),
      viewMode,
      blockingOverlay: Boolean(
        openConfirmation
        || readyReviewSession
        || persistState === "conflict"
        || projectLoadError
        || workspaceIssue
      ),
      interactionLocked,
      runInProgress,
      projectId,
    });
  }, [
    browserPreviewOnly,
    canvasGeneration,
    canvasMode,
    documentSnapshot.canvasAuthority,
    interactionLocked,
    openConfirmation,
    persistState,
    projectId,
    projectLoadError,
    readyReviewSession,
    runInProgress,
    runtimeCapabilitiesReady,
    sourceSha256,
    viewMode,
    workspaceController,
    workspaceIssue,
  ]);

  const activeCommentItems = useMemo(
    () => comments.filter(commentHasContent),
    [comments],
  );
  const activeCommentCount = activeCommentItems.length;
  const unsafeRelinkCommentItems = useMemo(
    () => unsafeRelinkComments(activeCommentItems),
    [activeCommentItems],
  );
  const unsafeRelinkCommentIds = useMemo(
    () => new Set(unsafeRelinkCommentItems.map((comment) => comment.commentId)),
    [unsafeRelinkCommentItems],
  );
  // Derived, never healed inside an effect (React Compiler forbids the
  // cascading setState): pending means one of the parked comments is still
  // unsafe, so the send's resumption promise survives until the set drains.
  const submissionRelinkPending = submissionRelinkPendingIds.some(
    (commentId) => unsafeRelinkCommentIds.has(commentId),
  );
  const unfinishedEditedComment = commentEditSession
    ? activeCommentItems.find(
        (comment) => comment.commentId === commentEditSession.commentId,
      ) ?? null
    : null;
  const interactionPreviewHtml = useMemo(() => {
    if (externalSourcePreview?.html) return externalSourcePreview.html;
    if (!browserPreviewOnly || projectName !== WELCOME_PROJECT_NAME) return html;
    return html.replace(
      /(["'])(?:\.\/)?brand-logo\.png\1/iu,
      (_matched, quote: string) => `${quote}${BROWSER_PREVIEW_LOGO_PLACEHOLDER}${quote}`,
    );
  }, [
    browserPreviewOnly,
    externalSourcePreview,
    html,
    projectName,
  ]);
  const pageViewDocumentKey = [
    viewMode,
    sourcePath || documentId || projectId || "memory",
  ].join(":");
  const activePageViewContext = (
    pageViewContext?.documentKey === pageViewDocumentKey
  ) ? pageViewContext : null;
  const expectedCommentLayoutSourceSha256 = renderedContentSha256 || "";
  const otherTabCommentsContextKey = [
    canvasMode,
    pageViewDocumentKey,
    activePageViewContext?.generation ?? 0,
  ].join(":");
  const acceptPageViewContext = useCallback((
    nextContext: PageViewContext | null,
    documentKey: string,
  ): boolean => {
    if (
      pageViewDocumentKeyRef.current !== documentKey
      || (nextContext && nextContext.documentKey !== documentKey)
    ) return false;
    const stage = reviewStageRef.current;
    const scrollTop = stage?.scrollTop ?? 0;
    const requestId = ++pagePresentationScrollRequestRef.current;
    setPageViewContext(nextContext);
    window.requestAnimationFrame(() => {
      if (requestId !== pagePresentationScrollRequestRef.current) return;
      const currentStage = reviewStageRef.current;
      if (!currentStage) return;
      const maxTop = Math.max(
        0,
        currentStage.scrollHeight - currentStage.clientHeight,
      );
      currentStage.scrollTo({
        top: Math.min(scrollTop, maxTop),
        behavior: "auto",
      });
    });
    return true;
  }, []);
  const visibleCommentItems = useMemo(
    () => (
      viewMode === "history" && viewingVersion
        ? viewingVersion.comments.filter(commentHasContent)
        : activeCommentItems
    ),
    [activeCommentItems, viewMode, viewingVersion],
  );
  const hasCommentDraft = Boolean(
    viewMode === "current"
    && !interactionLocked
    && draftTarget
    && (draft.trim() || draftAttachments.length > 0),
  );
  const composerOpen = commentCanvasPort.getSnapshot().composerOpen;
  useEffect(() => {
    pageViewDocumentKeyRef.current = pageViewDocumentKey;
  }, [pageViewDocumentKey]);
  useEffect(() => {
    const capabilities = resolveRuntimeCapabilities({
      runtimeConfig: window.htmlAIRuntime,
    });
    runtimeCapabilitiesRef.current = capabilities;
    const previewOnly = capabilities.sourceEditing !== "enabled";
    const frame = window.requestAnimationFrame(() => {
      setBrowserPreviewOnly(previewOnly);
      setInteractivePreviewTransport(capabilities.interactivePreview);
      if (previewOnly) setCanvasMode("preview");
      setRuntimeCapabilitiesReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);
  useEffect(() => () => {
    for (const url of attachmentObjectUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    attachmentObjectUrlsRef.current.clear();
  }, []);

  const commentedTargets = useMemo(() => {
    const grouped = new Map<string, {
      target: HtmlCanvasSelection;
      layoutTargets: HtmlCanvasSelection[];
      count: number;
      label: string;
      showMarker?: boolean;
    }>();
    for (const comment of visibleCommentItems) {
      const markerKey = commentMarkerGroupKey(comment.target);
      const current = grouped.get(markerKey);
      if (current) {
        current.count += 1;
        current.layoutTargets.push(comment.target);
      }
      else {
        grouped.set(markerKey, {
          target: comment.target,
          layoutTargets: [comment.target],
          count: 1,
          label: insertionLabel(comment.target),
        });
      }
    }
    if ((hasCommentDraft || composerOpen) && draftTarget) {
      const markerKey = commentMarkerGroupKey(draftTarget);
      const current = grouped.get(markerKey);
      if (current) {
        if (!current.layoutTargets.some((target) => target.id === draftTarget.id)) {
          current.layoutTargets.push(draftTarget);
        }
      } else {
        grouped.set(markerKey, {
          target: draftTarget,
          layoutTargets: [draftTarget],
          count: 0,
          label: insertionLabel(draftTarget),
          showMarker: false,
        });
      }
    }
    return [...grouped.values()];
  }, [composerOpen, draftTarget, hasCommentDraft, visibleCommentItems]);

  const trackedAuditTargets = useMemo(() => {
    const byTargetId = new Map<string, HtmlCanvasSelection>();
    for (const event of changeEvents) {
      if (event.target.id) byTargetId.set(event.target.id, event.target);
    }
    return [...byTargetId.values()];
  }, [changeEvents]);

  const captureProjectContext = useCallback((): ProjectContext | null => {
    return workspaceControllerRef.current?.getCurrentProjectContext() ?? null;
  }, []);

  const isCurrentProjectContext = useCallback(
    (context: ProjectContext): boolean => (
      workspaceControllerRef.current?.matchesCurrentProjectContext(context) ?? false
    ),
    [],
  );

  const prepareProjectRecords = useCallback(async () => {
    const currentProject = currentProjectSessionSnapshot();
    const activeSource = currentProject.sourcePath;
    const epoch = currentProject.epoch;
    if (
      !workspaceController
      || !activeSource
      || (currentProject.projectId && currentProject.documentId)
    ) return;
    const preparationKey = `${epoch}\0${activeSource}`;
    projectRecordsPreparationRef.current = preparationKey;
    let registrationPublished = false;
    setProjectRecordsPreparing(true);
    setProjectRecordsError("");
    try {
      const registered = registrationContextFromOutcome(
        await requiredWorkspaceController(workspaceController).ensureRegistered(),
      );
      registrationPublished = Boolean(registered);
      if (
        registered
        && !sameLocalSourcePath(registered.sourcePath, activeSource)
      ) {
        setImportedCanvasBase({
          managedSourcePath: registered.sourcePath,
          externalSourcePath: activeSource,
        });
      }
      const settledProject = currentProjectSessionSnapshot();
      const hydrationPublishedBinding = Boolean(
        settledProject.projectId && settledProject.documentId,
      );
      if (
        !registered
        && !hydrationPublishedBinding
        && settledProject.epoch === epoch
        && sameLocalSourcePath(settledProject.sourcePath, activeSource)
      ) {
        throw new Error("项目资料没有完成初始化。");
      }
    } catch (cause) {
      if (
        currentProjectSessionSnapshot().epoch !== epoch
        || !sameLocalSourcePath(
          currentProjectSessionSnapshot().sourcePath,
          activeSource,
        )
      ) return;
      setProjectRecordsError(productErrorMessage(
        cause,
        "项目资料暂时无法建立；当前 HTML 和评论仍保留，可在这里重试。",
      ));
    } finally {
      const settledProject = currentProjectSessionSnapshot();
      const hasSettledProjectBinding = Boolean(
        settledProject.projectId && settledProject.documentId,
      );
      if (
        projectRecordsPreparationRef.current === preparationKey
        && (
          registrationPublished
          || hasSettledProjectBinding
          || (
            settledProject.epoch === epoch
            && sameLocalSourcePath(settledProject.sourcePath, activeSource)
          )
        )
      ) {
        setProjectRecordsPreparing(false);
      }
    }
  }, [currentProjectSessionSnapshot, workspaceController]);

  useEffect(() => {
    if (
      !workspaceController
      || !sourcePath
      || (projectId && documentId)
    ) return;
    const registrationKey = `${projectSnapshot.epoch}\0${sourcePath}`;
    if (automaticProjectRegistrationRef.current === registrationKey) return;
    automaticProjectRegistrationRef.current = registrationKey;
    void prepareProjectRecords();
  }, [
    documentId,
    prepareProjectRecords,
    projectId,
    projectSnapshot.epoch,
    sourcePath,
    workspaceController,
  ]);

  const verifyCanvasRendered = useCallback(async (
    expectedHtml: string,
    expectedSha256: string,
    context?: ProjectContext,
  ): Promise<void> => {
    performance.mark("pageroot:canvas:verify-start");
    let expectedGeneration = currentDocumentSessionSnapshot().canvasGeneration;
    const waitForCurrentGeneration = async (): Promise<boolean> => {
      let attemptLimit = 40;
      const runtimeAttemptLimit = Math.ceil(
        EDIT_AUTHOR_RUNTIME_VERIFICATION_DEADLINE_MS / 25,
      );
      for (let attempt = 0; attempt < attemptLimit; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        if (EDIT_RUNTIME_PENDING_PHASES.has(
          currentControllerSnapshot()?.editRuntime?.phase || "static",
        )) {
          // Main bounds preparation and the visible iframe settle independently.
          // A final one-shot author frame cannot acknowledge its source until
          // both serial phases settle; treating that permitted interval as a
          // failed static render would replace the iframe and execute again.
          attemptLimit = Math.max(attemptLimit, runtimeAttemptLimit);
        }
        if (context && !isCurrentProjectContext(context)) {
          throw new Error("项目已切换，停止核对旧项目画布。");
        }
        if (
          currentDocumentSessionSnapshot().canvasGeneration !== expectedGeneration
          || currentDocumentSessionSnapshot().html !== expectedHtml
        ) {
          throw new Error("画布核对期间当前文档已经切换。");
        }
        const renderedSource = editorRef.current?.getRenderedSourceHtml();
        if (renderedSource !== expectedHtml) continue;
        const renderedSha256 = await browserSha256(renderedSource);
        if (renderedSha256 !== expectedSha256) {
          throw new Error("画布已载入内容的 Hash 与源 HTML 不一致。");
        }
        acknowledgeCanvasRender("edit", expectedGeneration, renderedSha256);
        performance.mark("pageroot:canvas:verify-ack");
        return true;
      }
      return false;
    };
    if (await waitForCurrentGeneration()) return;

    // A missing acknowledgement is a disposable-Canvas failure, not a user
    // conflict. Rebuild exactly once from the authoritative Document snapshot.
    performance.mark("pageroot:canvas:verify-rebuild");
    expectedGeneration = requiredWorkspaceController(
      workspaceControllerRef.current,
    ).reloadDocumentCanvas().canvasGeneration;
    invalidateCanvasRenderAcks();
    if (await waitForCurrentGeneration()) return;
    throw new Error("画布没有在时限内确认载入目标 HTML。");
  }, [
    acknowledgeCanvasRender,
    currentControllerSnapshot,
    currentDocumentSessionSnapshot,
    invalidateCanvasRenderAcks,
    isCurrentProjectContext,
  ]);
  useEffect(() => {
    verifyCanvasRenderedRef.current = verifyCanvasRendered;
  }, [verifyCanvasRendered]);

  useEffect(() => {
    if (canvasMode !== "edit") return undefined;
    if (editRuntimeRenderPending) return undefined;
    let cancelled = false;
    const expectedHtml = html;
    const expectedGeneration = canvasGeneration;
    const verifyInitialRender = async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        if (cancelled) return;
        if (editorRef.current?.getRenderedSourceHtml() !== expectedHtml) continue;
        const renderedSha256 = await browserSha256(expectedHtml);
        if (
          !cancelled
          && currentDocumentSessionSnapshot().html === expectedHtml
          && currentDocumentSessionSnapshot().canvasGeneration === expectedGeneration
          && currentDocumentSessionSnapshot().sourceSha256 === renderedSha256
        ) {
          acknowledgeCanvasRender("edit", expectedGeneration, renderedSha256);
        }
        return;
      }
    };
    void verifyInitialRender();
    return () => {
      cancelled = true;
    };
  }, [
    acknowledgeCanvasRender,
    canvasGeneration,
    canvasMode,
    currentDocumentSessionSnapshot,
    editRuntimePhase,
    editRuntimeRenderPending,
    html,
    sourceSha256,
  ]);

  const clearAutosaveTimer = useCallback(() => {
    workspaceController?.clearDocumentAutosaveTimer();
  }, [workspaceController]);

  const normalizeCurrentGlobalComments = useCallback((): CommentItem[] => {
    const currentComments = currentCommentSessionSnapshot();
    const normalized = normalizeGlobalCommentTargets(
      currentComments.comments.filter(commentHasContent),
    );
    if (!normalized.changed) return normalized.comments;
    const normalizedById = new Map(
      normalized.comments.map((comment) => [comment.commentId, comment]),
    );
    const nextComments = currentComments.comments.map(
      (comment) => normalizedById.get(comment.commentId) || comment,
    );
    workspaceControllerRef.current?.applyCommentItems(nextComments);
    return nextComments.filter(commentHasContent);
  }, [currentCommentSessionSnapshot]);
  useEffect(() => {
    normalizeCurrentGlobalCommentsRef.current = normalizeCurrentGlobalComments;
  }, [normalizeCurrentGlobalComments]);

  // Workbench only creates CanvasChangeInput and delegates durable source
  // authority to the composed application Workflow.
  const flushAutosave = useCallback(async (throughRevision?: number): Promise<boolean> => {
    if (!workspaceController) return false;
    const outcome = await requiredWorkspaceController(workspaceController)
      .flushDocument({ throughRevision });
    return outcome.status === "succeeded";
  }, [workspaceController]);

  const enqueueAutosave = useCallback((
    nextHtml: string,
    mutation?: HtmlCanvasMutation,
    sourceTransaction?: HtmlCanvasSourceTransaction,
  ): DocumentEditOutcome => {
    if (!workspaceController) {
      return {
        status: "blocked",
        code: "DOCUMENT_WORKFLOW_UNAVAILABLE",
        reason: "项目资料初始化尚未就绪，当前修改没有被接受。",
      };
    }
    return requiredWorkspaceController(workspaceController)
      .enqueueDocumentEdit({
        html: nextHtml,
        mutation,
        sourceTransaction,
        context: workspaceControllerRef.current?.getCurrentProjectContext() || undefined,
      });
  }, [workspaceController]);

  const refreshWorkspace = useCallback(async (
    sourceOverride?: string | null,
    epochOverride?: number,
    fromDeferred = false,
    sourceTransitionToken?: number,
  ) => {
    if (!workspaceController) return;
    await workspaceController.refreshProject({
      sourcePath: sourceOverride,
      epoch: epochOverride,
      fromDeferred,
      sourceTransitionToken,
    });
  }, [workspaceController]);
  useEffect(() => {
    if (!toast) {
      noticeDeadlineRef.current = null;
      return;
    }
    const dismissAfter = noticeAutoDismissMs(toast);
    if (dismissAfter === null) {
      noticeDeadlineRef.current = null;
      return;
    }
    const now = Date.now();
    const existing = noticeDeadlineRef.current;
    const remaining = existing?.identity === noticeIdentity
      ? existing.paused
        ? existing.remainingMs
        : Math.max(0, existing.deadlineAt - now)
      : dismissAfter;
    if (noticeTimerPaused) {
      noticeDeadlineRef.current = {
        identity: noticeIdentity,
        deadlineAt: now + remaining,
        remainingMs: remaining,
        paused: true,
      };
      return;
    }
    noticeDeadlineRef.current = {
      identity: noticeIdentity,
      deadlineAt: now + remaining,
      remainingMs: remaining,
      paused: false,
    };
    const timeout = window.setTimeout(() => {
      captureUsageEvent("notification_interacted", {
        notice_code: noticeUsageCode(toast.dedupeKey),
        interaction: "auto-dismiss",
        surface: "global",
      }, currentProjectSessionSnapshot().projectId || undefined);
      setToast(null);
    }, remaining);
    return () => window.clearTimeout(timeout);
  }, [currentProjectSessionSnapshot, noticeIdentity, noticeTimerPaused, toast]);

  useEffect(() => {
    if (!drawer || previewAttachment) return;
    const closeDrawer = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setDrawer(null);
    };
    window.addEventListener("keydown", closeDrawer);
    return () => window.removeEventListener("keydown", closeDrawer);
  }, [drawer, previewAttachment]);

  const rememberAttachmentObjectUrl = useCallback((
    attachmentId: string,
    objectUrl: string,
  ) => {
    const previous = attachmentObjectUrlsRef.current.get(attachmentId);
    if (previous && previous !== objectUrl) URL.revokeObjectURL(previous);
    attachmentObjectUrlsRef.current.set(attachmentId, objectUrl);
    setAttachmentObjectUrls((current) => ({
      ...current,
      [attachmentId]: objectUrl,
    }));
  }, []);

  const forgetAttachmentObjectUrl = useCallback((attachmentId: string) => {
    const previous = attachmentObjectUrlsRef.current.get(attachmentId);
    if (previous) URL.revokeObjectURL(previous);
    attachmentObjectUrlsRef.current.delete(attachmentId);
    setAttachmentObjectUrls((current) => {
      if (!current[attachmentId]) return current;
      const next = { ...current };
      delete next[attachmentId];
      return next;
    });
  }, []);

  const attachmentBlob = useCallback(async (
    attachment: CommentAttachment,
  ): Promise<Blob> => {
    const outcome = await requiredWorkspaceController(workspaceController)
      .readAttachment({ attachment });
    if (outcome.status === "succeeded") return outcome.value;
    throw new Error(
      ("reason" in outcome && outcome.reason) || "附件暂时无法读取。",
    );
  }, [workspaceController]);

  const ensureAttachmentObjectUrl = useCallback(async (
    attachment: CommentAttachment,
  ): Promise<string> => {
    const existing = attachmentObjectUrlsRef.current.get(attachment.attachmentId);
    if (existing) return existing;
    const objectUrl = URL.createObjectURL(await attachmentBlob(attachment));
    rememberAttachmentObjectUrl(attachment.attachmentId, objectUrl);
    return objectUrl;
  }, [attachmentBlob, rememberAttachmentObjectUrl]);

  const removeComposerAttachment = useCallback((attachment: CommentAttachment) => {
    const outcome = workspaceController?.removeComposerAttachment({
      attachmentId: attachment.attachmentId,
    });
    if (outcome?.status !== "succeeded") return;
    forgetAttachmentObjectUrl(attachment.attachmentId);
  }, [forgetAttachmentObjectUrl, workspaceController]);

  const removeCommentAttachment = useCallback((
    commentId: string,
    attachment: CommentAttachment,
  ) => {
    const outcome = workspaceController?.removeCommentEditAttachment({
      commentId,
      attachmentId: attachment.attachmentId,
    });
    if (outcome?.status !== "succeeded") return;
    forgetAttachmentObjectUrl(attachment.attachmentId);
  }, [forgetAttachmentObjectUrl, workspaceController]);

  const uploadAttachments = useCallback(async (
    files: File[],
    target: { kind: "composer" | "comment"; commentId: string },
    source: "clipboard" | "file-picker",
  ) => {
    if (files.length === 0) return;
    const currentComments = currentCommentSessionSnapshot();
    const targetIsOpen = target.kind === "composer"
      ? currentComments.composerCommentId === target.commentId
      : (
          currentComments.editSession?.commentId === target.commentId
          && currentComments.comments.some(
            (comment) => comment.commentId === target.commentId,
          )
        );
    if (!targetIsOpen) return;
    const existingCount = target.kind === "composer"
      ? currentComments.composerAttachments.length
      : currentComments.editSession?.draftAttachments.length ?? 0;
    const attachmentPlan = planAttachmentSelection(files, existingCount);
    const selected = attachmentPlan.accepted;
    const issueNotes: string[] = [];
    const failedNames: string[] = [];
    let addedAttachmentCount = 0;
    const attachmentRecoveryAction = (needsRemoval: boolean): ToastAction => (
      needsRemoval
        ? {
            id: "review-comment-attachments",
            label: "查看附件",
            target,
          }
        : {
            id: "open-attachment-picker",
            label: "重新选择",
            target,
          }
    );
    for (const invalidFile of attachmentPlan.invalid) {
      const fileName = invalidFile?.name || "未命名文件";
      if (!invalidFile || !Number.isFinite(invalidFile.size) || invalidFile.size <= 0) {
        issueNotes.push(`${fileName} 是空文件`);
      } else if (invalidFile.size > MAX_ATTACHMENT_BYTES) {
        issueNotes.push(
          `${fileName} 为 ${(invalidFile.size / 1024 / 1024).toFixed(1)} MB，超过 25 MB`,
        );
      } else {
        issueNotes.push(`${fileName} 无法读取`);
      }
    }
    if (attachmentPlan.overLimit.length > 0) {
      issueNotes.push(
        `已达到每条评论 ${MAX_COMMENT_ATTACHMENTS} 个附件的上限，`
        + `${attachmentPlan.overLimit.length} 个未加入`,
      );
    }
    if (selected.length === 0 && issueNotes.length > 0) {
      const needsRemoval = attachmentPlan.overLimit.length > 0
        && attachmentPlan.available === 0;
      setToast({
        title: "附件没有加入",
        message: `${issueNotes.join("；")}。${
          needsRemoval
            ? "请先移除一个附件，再重新选择。"
            : "请选择其他文件。"
        }`,
        tone: "warning",
        sticky: true,
        disposition: "direct-action",
        dedupeKey: `attachment-batch-${target.commentId}`,
        action: attachmentRecoveryAction(needsRemoval),
      });
      return;
    }
    const uploadFiles = selected.map((originalFile) => (
      source === "clipboard" && !originalFile.name
        ? new File(
            [originalFile],
            `粘贴图片-${Date.now()}.${originalFile.type.split("/")[1] || "png"}`,
            { type: originalFile.type || "image/png" },
          )
        : originalFile
    ));
    const outcome = await requiredWorkspaceController(workspaceController)
      .uploadAttachments({
        files: uploadFiles,
        target,
        source,
        persistence: runtimeCapabilitiesRef.current.attachmentPersistence,
      });
    if (outcome.status !== "succeeded") {
      setToast({
        title: "附件尚未加入",
        message: (
          "reason" in outcome && outcome.reason
        ) || "项目资料暂时无法建立；附件没有丢失，请重试选择。",
        tone: "warning",
        disposition: "direct-action",
        dedupeKey: "submit-blocked",
        action: { id: "open-attachment-picker", label: "重新选择", target },
      });
      return;
    }
    const uploaded = outcome.value as {
      attachments: Array<{
        attachment: CommentAttachment;
        sourceFile?: File;
      }>;
      failures: Array<{ fileName: string; reason: string }>;
    };
    addedAttachmentCount = uploaded.attachments.length;
    for (const item of uploaded.attachments) {
      if (item.attachment.kind === "image" && item.sourceFile) {
        rememberAttachmentObjectUrl(
          item.attachment.attachmentId,
          URL.createObjectURL(item.sourceFile),
        );
      }
    }
    for (const failure of uploaded.failures) {
      failedNames.push(failure.fileName);
      if (failedNames.length === 1) issueNotes.push(failure.reason);
    }
    if (failedNames.length > 0) {
      issueNotes.push(`${failedNames.join("、")} 未加入评论`);
    }
    if (issueNotes.length > 0) {
      const settledComments = currentCommentSessionSnapshot();
      const targetStillOpen = target.kind === "composer"
        ? settledComments.composerCommentId === target.commentId
        : settledComments.editSession?.commentId === target.commentId;
      const currentAttachmentCount = target.kind === "composer"
        ? settledComments.composerAttachments.length
        : settledComments.editSession?.draftAttachments.length ?? 0;
      const needsRemoval = attachmentPlan.overLimit.length > 0
        && currentAttachmentCount >= MAX_COMMENT_ATTACHMENTS;
      const notice = {
        title: addedAttachmentCount > 0 ? "部分附件没有加入" : "附件没有加入",
        message: `${issueNotes.join("；")}。${
          addedAttachmentCount > 0
            ? needsRemoval
              ? "已加入的附件仍然保留；如需加入其余文件，请先移除一个附件。"
              : "已加入的附件仍然保留。"
            : targetStillOpen
              ? needsRemoval
                ? "请先移除一个附件，再重新选择。"
                : "请选择其他文件。"
              : "请重新打开评论后再选择附件。"
        }`,
        tone: targetStillOpen && failedNames.length > 0 ? "error" : "warning",
        sticky: targetStillOpen,
        dedupeKey: `attachment-batch-${target.commentId}`,
      } as const;
      if (targetStillOpen) {
        setToast({
          ...notice,
          disposition: "direct-action",
          action: attachmentRecoveryAction(needsRemoval),
        });
      } else {
        setToast({
          ...notice,
          disposition: "background-result",
        });
      }
    }
  }, [
    currentCommentSessionSnapshot,
    rememberAttachmentObjectUrl,
    workspaceController,
  ]);

  const openAttachmentPicker = useCallback((
    target: { kind: "composer" | "comment"; commentId: string },
    accept: "all" | "image" = "all",
  ) => {
    commentCanvasPort.requestAttachmentPicker(target, accept);
  }, [commentCanvasPort]);

  const pasteImages = useCallback((
    event: ClipboardEvent<HTMLTextAreaElement>,
    target: { kind: "composer" | "comment"; commentId: string },
  ) => {
    const files = [...event.clipboardData.items]
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((item): item is File => Boolean(item));
    if (files.length === 0) return;
    event.preventDefault();
    void uploadAttachments(files, target, "clipboard");
  }, [uploadAttachments]);

  const openAttachmentPreview = useCallback(async (
    attachment: CommentAttachment,
  ) => {
    if (attachment.kind !== "image") return;
    try {
      await ensureAttachmentObjectUrl(attachment);
      setPreviewAttachment(attachment);
    } catch (cause) {
      setToast({
        title: "图片暂时无法预览",
        message: productErrorMessage(
          cause,
          "附件仍保留在评论中，可以重新读取。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: `attachment-preview-${attachment.attachmentId}`,
      });
    }
  }, [ensureAttachmentObjectUrl]);

  const downloadAttachment = useCallback(async (
    attachment: CommentAttachment,
  ) => {
    try {
      const objectUrl = URL.createObjectURL(await attachmentBlob(attachment));
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = attachment.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
    } catch (cause) {
      setToast({
        title: "附件暂时无法打开",
        message: productErrorMessage(
          cause,
          "附件仍保留在评论中，可以重新下载。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: `attachment-download-${attachment.attachmentId}`,
      });
    }
  }, [attachmentBlob]);

  useEffect(() => {
    if (!workspaceController) return undefined;
    const subscribe = window.htmlAIProjects?.onSourceFileChanged;
    if (typeof subscribe !== "function") return undefined;
    return subscribe((payload) => {
      void workspaceController.observeExternalSourceChange({
        reason: "watch",
        previousSourcePath: payload.sourcePath,
        watcherGeneration: payload.watcherGeneration,
        sourceMissing: payload.sourceMissing,
      });
    });
  }, [workspaceController]);

  useEffect(() => {
    if (!workspaceController) return undefined;
    const handlePrepareClose = (event: Event) => {
      const detail = (event as CustomEvent<PrepareCloseDetail>).detail;
      if (!detail || typeof detail.waitUntil !== "function") return;
      // The desktop shell only accepts checks registered synchronously.
      detail.waitUntil(workspaceController.prepareClose({
        requestId: detail.requestId,
        deadlineAt: detail.deadlineAt,
      }) as Promise<CloseReadiness>);
    };
    window.addEventListener("html-ai:prepare-close", handlePrepareClose);
    return () => window.removeEventListener(
      "html-ai:prepare-close",
      handlePrepareClose,
    );
  }, [workspaceController]);

  useEffect(() => {
    if (!workspaceController) return undefined;
    const handleCloseAborted = (event: Event) => {
      const detail = (event as CustomEvent<CloseAbortedDetail>).detail;
      if (!detail || typeof detail.requestId !== "string") return;
      workspaceController.abortClose({ requestId: detail.requestId });
    };
    window.addEventListener("html-ai:close-aborted", handleCloseAborted);
    return () => window.removeEventListener(
      "html-ai:close-aborted",
      handleCloseAborted,
    );
  }, [workspaceController]);

  useEffect(() => {
    if (!workspaceController) return undefined;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        runtimeCapabilitiesRef.current.closeCoordination
        === "electron-handshake"
      ) return;
      if (!workspaceController.hasPendingDrain("close")) return;
      event.preventDefault();
      event.returnValue = "";
      void workspaceController.drainCloseFallback({
        deadlineAt: Date.now() + 3_000,
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [workspaceController]);
  const openProject = useCallback(async (recentPath?: string) => {
    if (!workspaceController) return;
    await workspaceController.openProject({
      kind: recentPath ? "recent" : "local",
      sourcePath: recentPath || null,
    });
  }, [workspaceController]);
  const presentWorkbenchTabOutcome = useCallback((outcome: unknown) => {
    if (!outcome || typeof outcome !== "object" || (outcome as { status?: string }).status === "succeeded") return;
    const result = outcome as { reason?: string; code?: string };
    setToast({
      title: result.code === "WORKBENCH_TAB_SWITCH_BUSY"
        ? "标签页正在切换"
        : "暂时无法完成标签页操作",
      message: result.reason || "请稍后重试。",
      tone: "warning",
      sticky: false,
      dedupeKey: `workbench-tab:${result.code || "rejected"}`,
    });
  }, [setToast]);
  const rememberWorkbenchTabPresentation = useCallback((
    tabs: WorkbenchTabsSnapshot,
  ) => {
    if (!workspaceController) return;
    const activeTabId = tabs.activeTabId;
    const cachedScrollTop = workspaceController.getSnapshot().documentSurfaceCache?.entries
      .find((entry) => entry.tabId === activeTabId)?.scrollTop;
    rememberActiveDocumentPresentation({ controller: workspaceController,
      tabs, canvasMode,
      pageViewContext: activePageViewContext,
      scrollTop: canvasMode === "edit"
        ? editorRef.current?.getScrollTop() || 0
        : cachedScrollTop ?? reviewStageRef.current?.scrollTop ?? 0 });
  }, [
    activePageViewContext,
    canvasMode,
    workspaceController,
  ]);
  const openRegisteredWorkbenchProject = useCallback((project: RegisteredProject) => {
    if (!navigationCapability || !project.documentId || project.availability !== "ready") return;
    void navigationCapability.commands.openRegisteredProject({
      projectId: project.projectId,
      documentId: project.documentId,
      title: project.projectName,
    }).then((outcome) => {
      presentWorkbenchTabOutcome(outcome);
    });
  }, [navigationCapability, presentWorkbenchTabOutcome]);

  const resumeDeferredProjectApplication = useCallback(() => (
    workspaceController?.resumeDeferredProjectApplication().status === "succeeded"
  ), [workspaceController]);

  const resumeDeferredExternalProject = useCallback(() => (
    workspaceController?.resumeDeferredExternalProject().status === "succeeded"
  ), [workspaceController]);

  useEffect(() => {
    workspaceController?.reconcileProjectTransitions();
  }, [
    attachmentUploadCount,
    commentSnapshot,
    documentSnapshot,
    draftPersistError,
    externalFileOpenSnapshot.status,
    externalFileOpenSnapshot.deferredSequence,
    projectApplicationSnapshot.status,
    projectApplicationSnapshot.deferredSequence,
    projectHydrating,
    projectLoadError,
    projectRulesSnapshot,
    projectSnapshot,
    runSnapshot,
    viewTransitioning,
    workbenchTabsSnapshot.revision,
    workspaceController,
  ]);
  useEffect(() => {
    if (
      externalFileOpenSnapshot.status !== "deferred"
      && toastRef.current?.dedupeKey === "external-project-open-deferred"
    ) {
      setToast(null);
    }
  }, [externalFileOpenSnapshot.status]);
  useEffect(() => {
    if (
      projectApplicationSnapshot.status !== "deferred"
      && toastRef.current?.dedupeKey === "project-application-deferred"
    ) {
      setToast(null);
    }
  }, [projectApplicationSnapshot.status]);

  const showProjectInFolder = useCallback(async (requestedSourcePath?: string) => {
    const activeSourcePath = requestedSourcePath
      || currentProjectSessionSnapshot().sourcePath;
    const showInFolder = window.htmlAIProjects?.showInFolder;
    if (!activeSourcePath || !showInFolder) return;
    await runLocalUserAction({
      kind: "show-source-in-folder",
      invoke: () => showInFolder(activeSourcePath),
      onFailure: (cause: unknown) => setToast({
        title: "无法在文件夹中打开",
        message: productErrorMessage(
          cause,
          "源 HTML 可能已移动；当前项目仍保持打开，可以重试。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "show-project-in-folder-error",
      }),
    });
  }, [currentProjectSessionSnapshot]);

  const openCurrentHtmlInDefaultBrowser = useCallback(async () => {
    const activeProject = currentProjectSessionSnapshot();
    const activeSourcePath = activeProject.sourcePath;
    const activeEpoch = activeProject.epoch;
    const openInDefaultBrowser = window.htmlAIProjects?.openInDefaultBrowser;
    if (!activeSourcePath || !openInDefaultBrowser) return;
    await runLocalUserAction({
      kind: "open-source-in-browser",
      invoke: async () => {
        // The browser reads the on-disk file, so this action is a source-authority
        // boundary: capture delivered native input and wait for its exact revision
        // to be acknowledged before asking the main process to launch the file.
        const committed = editorRef.current?.fencePendingEdit({
          resumeEditing: true,
          trigger: "save",
        });
        if (!committed || !committed.ok) {
          editorRef.current?.showCommitBlocked(
            committed?.reason
              || "请点回文字完成输入，再在默认浏览器中打开。",
          );
          return;
        }
        let launchRevision = currentDocumentSessionSnapshot().editRevision;
        if (
          committed.html !== currentDocumentSessionSnapshot().html
          || committed.pendingMutation
        ) {
          const enqueued = enqueueAutosave(
            committed.html,
            committed.pendingMutation || undefined,
          );
          if (enqueued.status !== "succeeded") {
            throw new Error(documentEditFailureReason(enqueued));
          }
          launchRevision = enqueued.value.revision;
        }
        const persisted = await flushAutosave(launchRevision);
        const settledProject = currentProjectSessionSnapshot();
        const settledDocument = currentDocumentSessionSnapshot();
        if (
          !persisted
          || activeEpoch !== settledProject.epoch
          || !sameLocalSourcePath(settledProject.sourcePath, activeSourcePath)
          || settledDocument.hasPendingWrite
          || settledDocument.isFlushing
          || workspaceController?.hasDocumentHistoryAction
          || settledDocument.persistState !== "idle"
          || settledDocument.lastPersistedRevision < launchRevision
        ) {
          throw new Error(
            "当前修改尚未安全写入源 HTML，因此没有打开浏览器。请稍后重试。",
          );
        }
        return openInDefaultBrowser(activeSourcePath);
      },
      onFailure: (cause: unknown) => setToast({
        title: "无法在默认浏览器中打开",
        message: productErrorMessage(
          cause,
          "请确认顶部显示“已同步更新”后重试；当前项目仍保持打开。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "open-project-in-default-browser-error",
      }),
    });
  }, [
    currentDocumentSessionSnapshot,
    currentProjectSessionSnapshot,
    enqueueAutosave,
    flushAutosave,
    workspaceController,
  ]);

  const showProjectRecordsInFolder = useCallback(async () => {
    const context = workspaceControllerRef.current?.getCurrentProjectContext();
    if (!context || !projectRecordsPath || !workspaceController) return;
    await runLocalUserAction({
      kind: "open-project-records",
      invoke: async () => {
        const outcome = await workspaceController.openProjectRecords({ context });
        if (outcome.status !== "succeeded") {
          throw new Error(
            outcome.status === "stale"
              ? "项目已切换，没有打开旧项目记录。"
              : outcome.reason,
          );
        }
      },
      onFailure: (cause: unknown) => setToast({
        title: "项目记录暂时无法打开",
        message: productErrorMessage(
          cause,
          "项目记录仍保留在本地，可以重新尝试。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "show-project-records-error",
      }),
    });
  }, [projectRecordsPath, workspaceController]);

  const handleBrowserFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    const operationId = event.currentTarget.dataset.projectOperationId || "";
    delete event.currentTarget.dataset.projectOperationId;
    event.currentTarget.value = "";
    if (!file || !workspaceController) return;
    try {
      // File.text() consumes the UTF-8 signature. Decode the original bytes
      // ourselves so an authored BOM remains part of the SourcePatch truth.
      const fileHtml = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(await file.arrayBuffer());
      const sourceSha256 = await browserSha256(fileHtml);
      const tabIdentity = await createBrowserFileTabIdentity({
        name: file.name,
        size: file.size,
        lastModified: file.lastModified,
        sourceSha256,
        sha256: browserSha256,
      });
      workspaceController.acceptBrowserProject({
        operationId,
        project: {
          ...tabIdentity,
          name: file.name,
          sourcePath: null,
          html: fileHtml,
          sha256: sourceSha256,
        },
      });
    } catch (cause) {
      const encodingUnsupported = cause instanceof TypeError;
      setToast({
        title: encodingUnsupported ? "文件编码不支持" : "文件无法打开",
        message: encodingUnsupported
          ? "原文件没有被修改。请先转换为 UTF-8，再重新选择。"
          : "请选择 .html 或 .htm 文件后重试。",
        tone: "warning",
        sticky: true,
        disposition: "direct-action",
        dedupeKey: "browser-file-error",
        action: { id: "retry-project-open", label: "重新选择" },
      });
    }
  }, [workspaceController]);

  const handleCanvasChange = useCallback((
    nextHtml: string,
    mutation?: HtmlCanvasMutation,
    sourceTransaction?: HtmlCanvasSourceTransaction,
  ): boolean => {
    const currentRun = currentRunSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    if (
      runtimeCapabilitiesRef.current.sourceEditing !== "enabled"
      ||
      currentRun.activeLocked
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || workspaceController?.hasDocumentHistoryAction
      || String(currentDocument.persistState) === "conflict"
      || viewMode === "history"
    ) return false;
    try {
      const enqueued = enqueueAutosave(nextHtml, mutation, sourceTransaction);
      if (enqueued.status !== "succeeded") {
        setToast({
          title: "这次编辑没有进入撤销历史",
          message: documentEditFailureReason(enqueued),
          tone: "warning",
          disposition: "background-result",
          dedupeKey: "source-history-record-failed",
        });
        return false;
      }
    } catch (cause) {
      setToast({
        title: "这次编辑没有进入撤销历史",
        message: productErrorMessage(
          cause,
          "源码历史与当前页面不一致，已停止接受这次修改。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "source-history-record-failed",
      });
      return false;
    }
    // enqueueDocumentEdit synchronously publishes its direct-edit audit event.
    // Re-read the Controller aggregate before reconciling targets so this
    // mutation cannot overwrite that new event with the pre-command snapshot.
    const settledComments = currentCommentSessionSnapshot();
    const activeTargets = [
      ...settledComments.comments.map((comment) => comment.target),
      ...settledComments.changeEvents.map((event) => event.target),
      ...(settledComments.composerTarget ? [settledComments.composerTarget] : []),
    ];
    if (activeTargets.length > 0) {
      const deterministicById = new Map(
        (mutation?.targetUpdates || []).map((target) => [target.id, target]),
      );
      const trackedTargetIds = new Set(mutation?.trackedTargetIds || []);
      const untrackedSafeTargets = activeTargets.filter((target) => (
        !trackedTargetIds.has(target.id)
        && canLocateTarget(target)
      ));
      const fallbackById = new Map(
        rebindTargetsPreservingGlobal(nextHtml, untrackedSafeTargets)
          .map((target) => [target.id, target]),
      );
      const refreshedTarget = (target: HtmlCanvasSelection): HtmlCanvasSelection => {
        const deterministic = deterministicById.get(target.id);
        if (deterministic) return deterministic;
        if (!canLocateTarget(target)) return target;
        if (trackedTargetIds.has(target.id)) {
          return { ...target, resolution: "orphaned" };
        }
        return fallbackById.get(target.id) || {
          ...target,
          resolution: "orphaned",
        };
      };
      const nextComments = settledComments.comments.map((comment) => ({
        ...comment,
        target: refreshedTarget(comment.target),
      }));
      const nextEvents = settledComments.changeEvents.map((event) => ({
        ...event,
        target: refreshedTarget(event.target),
      }));
      const currentDraftTarget = settledComments.composerTarget;
      workspaceController?.replaceCommentWorkingCopy({
        comments: nextComments,
        changeEvents: nextEvents,
        ...(currentDraftTarget
          ? { composerTarget: refreshedTarget(currentDraftTarget) }
          : {}),
      });
    }
    const renderGeneration = currentDocument.canvasGeneration;
    void browserSha256(nextHtml).then((renderedSha256) => {
      const settledDocument = currentDocumentSessionSnapshot();
      if (
        settledDocument.html === nextHtml
        && settledDocument.canvasGeneration === renderGeneration
        && editorRef.current?.getRenderedSourceHtml() === nextHtml
      ) {
        acknowledgeCanvasRender("edit", renderGeneration, renderedSha256);
      }
    });
    workspaceController?.clearCompletedRun();
    return true;
  }, [
    acknowledgeCanvasRender,
    currentCommentSessionSnapshot,
    currentDocumentSessionSnapshot,
    currentRunSessionSnapshot,
    enqueueAutosave,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    viewMode,
    workspaceController,
  ]);

  const exportCurrentHtml = useCallback(async (fromDeferred = false) => {
    if (isViewTransitioning()) return;
    if (
      !fromDeferred
      && deferEditorCommand(
        "export",
        () => deferredEditorReplayRef.current.exportCurrentHtml?.(),
      )
    ) return;
    // Export is a source-authority boundary, just like save/navigation. Do not
    // rely on the iframe focusout timer to race the button click: a freshly
    // delivered input may still be waiting for its normal debounce checkpoint.
    const committed = editorRef.current?.fencePendingEdit({
      resumeEditing: true,
      trigger: "export",
    });
    if (committed && !committed.ok) {
      editorRef.current?.showCommitBlocked(
        committed.reason
          || "请点回文字完成输入，再导出 HTML 副本。",
      );
      return;
    }
    const nextHtml = committed?.html
      || editorRef.current?.getSourceHtml()
      || currentDocumentSessionSnapshot().html;
    const api = window.htmlAIProjects;
    if (!api?.exportHtmlCopy) {
      downloadHtml(nextHtml, projectName);
      setToast({
        title: "已导出 HTML 副本",
        message: "导出不会改变当前项目或版本历史。",
        tone: "success",
        dedupeKey: "export",
      });
      return;
    }
    try {
      const result = await api.exportHtmlCopy({
        html: nextHtml,
        sourcePath: currentProjectSessionSnapshot().sourcePath,
        suggestedName: projectName,
      });
      if (result) {
        setToast({
          title: "已导出 HTML 副本",
          message: `已保存为 ${result.name}；当前项目和版本号没有变化。`,
          tone: "success",
          dedupeKey: "export",
        });
      }
    } catch (cause) {
      const reason = productErrorMessage(
        cause,
        "请选择另一个文件名或位置后重试。",
      );
      setToast({
        title: "副本没有导出",
        message: /没有被改动|保持不变|没有覆盖/.test(reason)
          ? reason
          : `${reason} 当前源 HTML 没有被改动。`,
        tone: "error",
        sticky: true,
        disposition: "direct-action",
        dedupeKey: "export",
        action: { id: "retry-export", label: "重新选择位置" },
      });
    }
  }, [
    currentDocumentSessionSnapshot,
    currentProjectSessionSnapshot,
    deferEditorCommand,
    isViewTransitioning,
    projectName,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.exportCurrentHtml = () => {
      void exportCurrentHtml(true);
    };
  }, [exportCurrentHtml]);

  // External document reload remains a narrow presentation host action. Version
  // activation/history navigation has its own operation owner in VersionWorkflow.
  const beginSourceTransition = useCallback((): number | null => {
    if (isViewTransitioning()) return null;
    const fenced = editorRef.current?.fencePendingEdit({
      resumeEditing: false,
      trigger: "project-switch",
    });
    if (!fenced || !fenced.ok) {
      editorRef.current?.showCommitBlocked(
        fenced?.reason || "请点回文字完成输入，再切换 HTML 视图。",
      );
      return null;
    }
    const frozen = editorRef.current?.freezeNow();
    if (!frozen || !frozen.ok) {
      editorRef.current?.showCommitBlocked(
        frozen?.reason || "请点回文字完成输入，再切换 HTML 视图。",
      );
      return null;
    }
    const operationId = sourceTransitionOperationRef.current + 1;
    sourceTransitionOperationRef.current = operationId;
    setSourceViewTransitioning(true);
    clearAutosaveTimer();
    return operationId;
  }, [clearAutosaveTimer, isViewTransitioning, setSourceViewTransitioning]);

  const finishSourceTransition = useCallback((operationId: number) => {
    if (sourceTransitionOperationRef.current !== operationId) return;
    setSourceViewTransitioning(false);
    window.requestAnimationFrame(() => {
      if (!projectLoadError) editorRef.current?.unlockNow?.();
    });
  }, [projectLoadError, setSourceViewTransitioning]);

  const reloadCurrentSource = useCallback(async ({
    skipConfirmation = false,
    fromDeferred = false,
    externalAuthorityAccepted = false,
  }: {
    skipConfirmation?: boolean;
    fromDeferred?: boolean;
    externalAuthorityAccepted?: boolean;
  } = {}) => {
    const context = captureProjectContext();
    if (!context || projectLoadError || !workspaceController) return;
    if (requiredWorkspaceController(workspaceController).hasDocumentHistoryAction) return;
    if (
      !fromDeferred
      && deferEditorCommand(
        "external-refresh",
        () => deferredEditorReplayRef.current.reloadCurrentSource?.(),
      )
    ) return;
    const hasUnwrittenLocalChanges = Boolean(
      editorRef.current?.hasPendingNativeEdit()
      || currentDocumentSessionSnapshot().hasPendingWrite
      || currentDocumentSessionSnapshot().isFlushing
      || currentDocumentSessionSnapshot().editRevision
        > currentDocumentSessionSnapshot().lastPersistedRevision
      || persistState === "failed"
      || persistState === "preview-dirty"
    );
    if (
      !skipConfirmation
      && persistState === "conflict"
      && !window.confirm("确定要用外部版本覆盖当前编辑吗？此操作不可撤销。")
    ) return;
    if (
      !skipConfirmation
      && persistState !== "conflict"
      && hasUnwrittenLocalChanges
      && !window.confirm("重新载入会舍弃尚未写回的当前编辑内容。建议先导出副本，仍要继续吗？")
    ) return;
    const operationId = beginSourceTransition();
    if (operationId === null) return;
    try {
      const outcome = await requiredWorkspaceController(workspaceController)
        .reloadDocumentAuthority({
          context,
          acceptExternalConflict: persistState === "conflict" && !externalAuthorityAccepted,
          externalAuthorityAccepted,
        });
      if (
        outcome.status === "stale"
        || sourceTransitionOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      if (outcome.status !== "succeeded") {
        throw new Error(outcome.reason);
      }
      const lastModified = String(outcome.value.lastModifiedAt || "");
      if (lastModified) setLastModifiedAt(lastModified);
      await refreshWorkspace(context.sourcePath, context.epoch);
      if (
        sourceTransitionOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      setToast({
        title: "已重新载入外部文件",
        message: "工作台现在显示磁盘上的最新内容。",
        tone: "success",
        dedupeKey: "source-reload",
      });
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      setToast({
        title: "重新载入失败",
        message: productErrorMessage(cause, "请稍后重试，源文件没有被覆盖。"),
        tone: "error",
        disposition: "background-result",
        dedupeKey: "source-reload",
      });
    } finally {
      finishSourceTransition(operationId);
    }
  }, [
    beginSourceTransition,
    captureProjectContext,
    currentDocumentSessionSnapshot,
    deferEditorCommand,
    finishSourceTransition,
    isCurrentProjectContext,
    persistState,
    projectLoadError,
    refreshWorkspace,
    workspaceController,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.reloadCurrentSource = () => {
      void reloadCurrentSource({ fromDeferred: true });
    };
  }, [reloadCurrentSource]);

  const previewExternalSource = useCallback(async () => {
    const context = captureProjectContext();
    if (!context || !workspaceController) return;
    const outcome = await requiredWorkspaceController(workspaceController)
      .previewExternalDocumentSource({ context });
    if (outcome.status !== "succeeded") {
      setToast({
        title: "无法预览外部版本",
        message: outcome.status === "stale"
          ? "当前项目已经切换。"
          : outcome.reason,
        tone: "error",
        sticky: true,
        disposition: "background-result",
        dedupeKey: "external-source-preview-failed",
      });
      return;
    }
    setExternalSourcePreview({
      html: String(outcome.value.html || ""),
      sourceSha256: String(outcome.value.sourceSha256 || ""),
      lastModifiedAt: String(outcome.value.lastModifiedAt || ""),
    });
    setHandoffPreviewOpen(false);
    setCanvasMode("preview");
  }, [captureProjectContext, workspaceController]);

  const returnToEditingFromExternalPreview = useCallback(() => {
    setExternalSourcePreview(null);
    setCanvasMode("edit");
  }, []);

  const externalPreviewIdentityRef = useRef("");
  useEffect(() => {
    const identity = `${projectId || ""}\0${documentId || ""}\0${sourcePath || ""}`;
    const previous = externalPreviewIdentityRef.current;
    externalPreviewIdentityRef.current = identity;
    if (!previous || previous === identity) return;
    const [previousProjectId, previousDocumentId, previousSourcePath] = previous.split("\0");
    if (
      (previousProjectId && projectId && previousProjectId !== projectId)
      || (previousDocumentId && documentId && previousDocumentId !== documentId)
      || (previousSourcePath && sourcePath && previousSourcePath !== sourcePath)
    ) {
      setExternalSourcePreview(null);
    }
  }, [documentId, projectId, sourcePath]);

  const forceUnlockCurrentSource = useCallback(async ({
    skipConfirmation = false,
  }: {
    skipConfirmation?: boolean;
  } = {}) => {
    const context = captureProjectContext();
    if (!context || !workspaceController) return;
    if (
      !skipConfirmation
      && !window.confirm("确定要用磁盘上的版本继续吗？未写入的编辑和未完成的 AI 结果都会丢弃，此操作不可撤销。")
    ) {
      return;
    }
    const operationId = beginSourceTransition();
    if (operationId === null) return;
    try {
      const outcome = await requiredWorkspaceController(workspaceController)
        .forceUnlockDocumentConflict({ context });
      if (
        outcome.status === "stale"
        || sourceTransitionOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      if (outcome.status !== "succeeded") {
        throw new Error(outcome.reason);
      }
      setExternalSourcePreview(null);
      const lastModified = String(outcome.value.lastModifiedAt || "");
      if (lastModified) setLastModifiedAt(lastModified);
      await refreshWorkspace(context.sourcePath, context.epoch);
      setCanvasMode("edit");
      setToast({
        title: "项目已解锁",
        message: "可以继续编辑，之后的修改会写回磁盘。",
        tone: "success",
        disposition: "background-result",
        dedupeKey: "source-force-unlock",
      });
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      setToast({
        title: "强制解锁失败",
        message: productErrorMessage(cause, "项目仍保持冲突状态，请先导出当前编辑后再试。"),
        tone: "error",
        sticky: true,
        disposition: "user-choice",
        dedupeKey: "source-force-unlock-failed",
        action: { id: "relaunch-app", label: "重新打开源页" },
      });
    } finally {
      finishSourceTransition(operationId);
    }
  }, [
    beginSourceTransition,
    captureProjectContext,
    finishSourceTransition,
    isCurrentProjectContext,
    refreshWorkspace,
    workspaceController,
  ]);

  const acceptExternalSourceFromPreview = useCallback(async () => {
    setExternalSourcePreview(null);
    if (persistState === "conflict") {
      await forceUnlockCurrentSource({ skipConfirmation: true });
      return;
    }
    await reloadCurrentSource({ skipConfirmation: true });
  }, [forceUnlockCurrentSource, persistState, reloadCurrentSource]);

  const requestUserFlush = useCallback((fromDeferred = false) => {
    if (interactionLocked) {
      if (runInProgress) {
        setCanvasMode("preview");
        revealAiConversation();
      }
      return;
    }
    if (
      !fromDeferred
      && deferEditorCommand(
        "save",
        () => deferredEditorReplayRef.current.requestUserFlush?.(),
      )
    ) return;
    const committed = editorRef.current?.fencePendingEdit({
      resumeEditing: true,
      trigger: "save",
    });
    if (!committed || !committed.ok) {
      editorRef.current?.showCommitBlocked(
        committed?.reason || "请点回文字完成输入，源页会继续自动保存。",
      );
      return;
    }
    void flushAutosave();
  }, [
    deferEditorCommand,
    flushAutosave,
    interactionLocked,
    revealAiConversation,
    runInProgress,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.requestUserFlush = () => requestUserFlush(true);
  }, [requestUserFlush]);

  const requestSourceHistoryAction = useCallback(async (
    direction: SourceHistoryDirection,
    fromDeferred = false,
  ): Promise<boolean> => {
    if (
      runtimeCapabilitiesRef.current.sourceEditing !== "enabled"
      || !currentProjectSessionSnapshot().sourcePath
      || currentRunSessionSnapshot().activeLocked
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || viewMode === "history"
      || currentDocumentSessionSnapshot().persistState === "conflict"
      || !workspaceController
    ) return false;
    if (!fromDeferred) {
      let resolveDeferred: ((value: boolean) => void) | null = null;
      const deferred = new Promise<boolean>((resolve) => {
        resolveDeferred = resolve;
      });
      if (deferEditorCommand(
        `source-history:${direction}`,
        () => {
          const replay = deferredEditorReplayRef.current.requestSourceHistoryAction;
          if (!replay) {
            resolveDeferred?.(false);
            return;
          }
          void replay(direction).then((value) => resolveDeferred?.(value));
        },
        undefined,
        { onDiscard: () => resolveDeferred?.(false) },
      )) return deferred;
    }
    const fenced = editorRef.current?.fencePendingEdit({
      resumeEditing: false,
      preserveForHistory: true,
      trigger: "fence",
    });
    if (!fenced || !fenced.ok) {
      editorRef.current?.showCommitBlocked(
        fenced?.reason || "请先完成当前文字输入，再撤销或重做。",
      );
      return false;
    }
    const context = captureProjectContext();
    if (!context) {
      editorRef.current?.cancelHistoryAction();
      return false;
    }
    lastHistoryDirectionRef.current = direction;
    const controller = requiredWorkspaceController(workspaceController);
    const outcome = await controller.performDocumentHistoryAction({ direction, context });
    if (outcome.status === "succeeded") return true;
    editorRef.current?.cancelHistoryAction({
      restore: outcome.status !== "stale",
    });
    if (outcome.status !== "stale") {
      setToast({
        title: direction === "undo" ? "撤销未完成" : "重做未完成",
        message: outcome.reason,
        tone: "warning",
        disposition: "user-choice",
        dedupeKey: `source-history-${direction}-failed`,
        action: { id: "retry-history", label: "再试一次", direction },
      });
    }
    return false;
  }, [
    captureProjectContext,
    currentDocumentSessionSnapshot,
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    deferEditorCommand,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    viewMode,
    workspaceController,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.requestSourceHistoryAction = (
      direction,
    ) => requestSourceHistoryAction(direction, true);
  }, [requestSourceHistoryAction]);

  useEffect(() => {
    const editApi = window.htmlAIEdit;
    if (!editApi) return undefined;
    return editApi.onHistoryRequested((direction) => {
      if (ownsNativeTextHistory(document.activeElement)) {
        void editApi.runNativeHistory(direction);
        return;
      }
      void requestSourceHistoryAction(direction);
    });
  }, [requestSourceHistoryAction]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "z" || (key === "y" && event.ctrlKey && !event.metaKey)) {
        const target = event.target as HTMLElement | null;
        if (ownsNativeTextHistory(target)) return;
        event.preventDefault();
        void requestSourceHistoryAction(
          key === "y" || event.shiftKey ? "redo" : "undo",
        );
        return;
      }
      if (event.key.toLowerCase() === "e" && event.shiftKey) {
        event.preventDefault();
        void exportCurrentHtml();
      } else if (event.key.toLowerCase() === "s" && !event.shiftKey) {
        event.preventDefault();
        requestUserFlush();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportCurrentHtml, requestSourceHistoryAction, requestUserFlush]);

  const updateFocusedComment = useCallback((commentId: string | null) => {
    commentCanvasPort.setFocusedCommentId(commentId);
  }, [commentCanvasPort]);

  const queueReviewPairReveal = useCallback((
    target: HtmlCanvasSelection,
    itemKey: string,
  ) => {
    commentCanvasPort.requestReveal(target, itemKey);
  }, [commentCanvasPort]);

  const requestComposerFocus = useCallback(() => {
    commentCanvasPort.requestComposerFocus();
  }, [commentCanvasPort]);

  const beginTargetRelink = useCallback((itemId: string) => {
    const currentComments = currentCommentSessionSnapshot();
    commentCanvasPort.beginRelink(itemId);
    if (!commentEditSessionHasChanges(currentComments.editSession)) {
      workspaceControllerRef.current?.clearCommentEdit();
      commentEditResumePendingRef.current = null;
    }
    editorRef.current?.clearSelection();
    commentCanvasPort.setSelection(null);
    if (itemId !== "__composer") {
      updateFocusedComment(itemId);
      const comment = currentComments.comments.find(
        (item) => item.commentId === itemId,
      );
      if (comment) queueReviewPairReveal(comment.target, itemId);
    }
  }, [
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewPairReveal,
    updateFocusedComment,
  ]);

  const finishTargetRelink = useCallback((target: HtmlCanvasSelection): boolean => {
    const controller = workspaceControllerRef.current;
    const currentComments = currentCommentSessionSnapshot();
    const presentation = commentCanvasPort.getSnapshot();
    const relinkingId = presentation.relinkingTarget;
    if (
      !relinkingId
      || !presentation.relinkSelectionArmed
      || !canSaveCommentTarget(target)
    ) return false;
    if (relinkingId === "__composer") {
      const currentTarget = currentComments.composerTarget;
      const nextTarget = currentTarget
        ? { ...target, id: currentTarget.id }
        : target;
      controller?.rebindCommentComposer(nextTarget);
      commentCanvasPort.setSelection(nextTarget);
      commentCanvasPort.clearRelink();
      commentCanvasPort.setComposerOpen(true);
      queueReviewPairReveal(nextTarget, "__composer");
      requestComposerFocus();
      return true;
    }
    const current = currentComments.comments.find(
      (comment) => comment.commentId === relinkingId,
    );
    if (!current) {
      commentCanvasPort.clearRelink();
      return false;
    }
    const rebound = controller?.rebindCommentTarget({
      commentId: relinkingId,
      target,
    });
    if (rebound?.status !== "succeeded") {
      return false;
    }
    const nextTarget = (rebound.value as {
      target: HtmlCanvasSelection;
    }).target;
    const nextComments = (rebound.value as {
      comments: CommentItem[];
    }).comments;
    commentCanvasPort.setSelection(nextTarget);
    commentCanvasPort.clearRelink();
    updateFocusedComment(relinkingId);
    queueReviewPairReveal(nextTarget, relinkingId);
    const remainingUnsafe = unsafeRelinkComments(nextComments);
    if (remainingUnsafe.length > 0) {
      // No toast here: the rail card shows the remaining count on its own
      // durable surface while the chain advances automatically.
      window.requestAnimationFrame(() => {
        beginTargetRelink(remainingUnsafe[0].commentId);
      });
    } else {
      setSubmissionRelinkPendingIds([]);
      if (resumeSubmissionAfterRelinkRef.current) {
        resumeSubmissionAfterRelinkRef.current = false;
        setToast(null);
        window.requestAnimationFrame(() => {
          deferredEditorReplayRef.current.generateRequest?.();
        });
      }
    }
    return true;
  }, [
    beginTargetRelink,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewPairReveal,
    requestComposerFocus,
    updateFocusedComment,
  ]);

  const cancelTargetRelink = useCallback(() => {
    const relinkingId = commentCanvasPort.getSnapshot().relinkingTarget;
    commentCanvasPort.clearRelink();
    resumeSubmissionAfterRelinkRef.current = false;
    setSubmissionRelinkPendingIds([]);
    if (relinkingId === "__composer") {
      requestComposerFocus();
    }
  }, [commentCanvasPort, requestComposerFocus]);

  // The durable relink entry on the comment rail. The surface is persistent,
  // so a click lost to a reflow window can simply be repeated (#281); the
  // toast only points here and never carries the action itself.
  const startUnsafeTargetRelink = useCallback(() => {
    if (unsafeRelinkCommentItems.length === 0) return;
    resumeSubmissionAfterRelinkRef.current = submissionRelinkPending;
    beginTargetRelink(unsafeRelinkCommentItems[0].commentId);
    setCanvasMode("edit");
    setDrawer(null);
  }, [beginTargetRelink, submissionRelinkPending, unsafeRelinkCommentItems]);

  const clearCurrentComposer = useCallback(() => {
    workspaceControllerRef.current?.cancelCommentComposer();
    commentCanvasPort.setComposerOpen(false);
    updateFocusedComment(null);
  }, [commentCanvasPort, updateFocusedComment]);

  const resumeCurrentComposer = useCallback(() => {
    const target = currentCommentSessionSnapshot().composerTarget;
    if (!target) return;
    if (!canSaveCommentTarget(target)) {
      beginTargetRelink("__composer");
      return;
    }
    const located = editorRef.current?.select(target, { showToolbar: false });
    const nextTarget = located || target;
    workspaceControllerRef.current?.rebindCommentComposer(nextTarget);
    commentCanvasPort.setSelection(nextTarget);
    updateFocusedComment(null);
    commentCanvasPort.setComposerOpen(true);
    queueReviewPairReveal(nextTarget, "__composer");
    if (toastRef.current?.dedupeKey === "unfinished-comment-draft") {
      setToast(null);
    }
    requestComposerFocus();
  }, [
    beginTargetRelink,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewPairReveal,
    requestComposerFocus,
    updateFocusedComment,
  ]);

  const showUnfinishedCommentEditNotice = useCallback((
    session: CommentEditSession,
  ) => {
    setToast({
      title: "上一条评论修改还未确认",
      message: "请先确认或取消这次修改，再新建或编辑其他评论。",
      tone: "warning",
      sticky: true,
      disposition: "direct-action",
      dedupeKey: "unfinished-comment-edit",
      action: {
        id: "resume-comment-edit",
        label: "继续修改",
        commentId: session.commentId,
      },
    });
  }, []);

  const openCommentComposer = useCallback((target: HtmlCanvasSelection) => {
    const controller = workspaceControllerRef.current;
    const currentRun = currentRunSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    const currentComments = currentCommentSessionSnapshot();
    if (!controller) return;
    if (commentCanvasPort.getSnapshot().relinkingTarget && finishTargetRelink(target)) return;
    if (attachmentUploadCount > 0) return;
    if (
      currentRun.activeLocked
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || currentDocument.persistState === "conflict"
      || viewMode === "history"
    ) return;
    if (!canSaveCommentTarget(target)) {
      if (!currentComments.composerTarget) {
        const nextCommentId = recordId("comment", commentCounter.current++);
        controller.beginCommentComposer({ target, commentId: nextCommentId });
      }
      beginTargetRelink("__composer");
      return;
    }
    const currentEdit = currentComments.editSession;
    if (currentEdit && commentEditSessionHasChanges(currentEdit)) {
      showUnfinishedCommentEditNotice(currentEdit);
      return;
    }
    if (currentEdit) {
      controller.clearCommentEdit();
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(null);
    }
    // Project identity starts at file open. Recheck here to serialize a
    // just-opened composer with any still-pending registration.
    void prepareProjectRecords();
    const recoveredDraftTarget = currentComments.composerTarget;
    if (
      recoveredDraftTarget
      && recoveredDraftTarget.id !== target.id
      && (
        currentComments.composerDraft.trim()
        || currentComments.composerAttachments.length > 0
      )
    ) {
      setToast({
        title: "上一条评论还未保存",
        message: "请先点击“评论”保存；保存后仍可修改，再为其他内容添加评论。",
        tone: "warning",
        sticky: true,
        disposition: "direct-action",
        dedupeKey: "unfinished-comment-draft",
        action: { id: "resume-draft", label: "继续填写" },
      });
      return;
    }
    commentCanvasPort.setSelection(target);
    const resumesRecoveredDraft = currentComments.composerTarget?.id === target.id;
    if (!resumesRecoveredDraft) {
      const nextCommentId = recordId("comment", commentCounter.current++);
      controller.beginCommentComposer({
        target,
        commentId: nextCommentId,
      });
    } else if (!currentComments.composerCommentId) {
      const nextCommentId = recordId("comment", commentCounter.current++);
      controller.beginCommentComposer({
        target,
        commentId: nextCommentId,
        resume: true,
      });
    } else {
      controller.rebindCommentComposer(target);
    }
    updateFocusedComment(null);
    commentCanvasPort.setComposerOpen(true);
    queueReviewPairReveal(target, "__composer");
    requestComposerFocus();
  }, [
    attachmentUploadCount,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    currentDocumentSessionSnapshot,
    currentRunSessionSnapshot,
    finishTargetRelink,
    isViewTransitioning,
    prepareProjectRecords,
    projectHydrating,
    projectLoadError,
    queueReviewPairReveal,
    requestComposerFocus,
    showUnfinishedCommentEditNotice,
    updateFocusedComment,
    viewMode,
    beginTargetRelink,
  ]);

  const openGlobalCommentComposer = useCallback(() => {
    if (interactionLocked) {
      if (runInProgress) {
        setCanvasMode("preview");
        revealAiConversation();
      }
      return;
    }
    setCanvasMode("edit");
    setDrawer(null);
    const globalTarget: HtmlCanvasSelection = {
      id: "target_global_page",
      label: "整个页面",
      selector: "body",
      level: "module",
      tagName: "body",
      text: "",
      resolution: "exact",
    };
    const wasRelinking = Boolean(commentCanvasPort.getSnapshot().relinkingTarget);
    editorRef.current?.clearSelection();
    commentCanvasPort.setSelection(null);
    if (wasRelinking) {
      commentCanvasPort.armRelinkSelection();
      finishTargetRelink(globalTarget);
      return;
    }
    openCommentComposer(globalTarget);
  }, [
    commentCanvasPort,
    finishTargetRelink,
    interactionLocked,
    openCommentComposer,
    revealAiConversation,
    runInProgress,
  ]);

  const closeCommentComposer = useCallback(() => {
    if (attachmentUploadCount > 0) return;
    const currentComments = currentCommentSessionSnapshot();
    if (
      currentComments.composerDraft.trim()
      || currentComments.composerAttachments.length > 0
    ) {
      commentCanvasPort.setComposerOpen(false);
      updateFocusedComment(null);
      return;
    }
    clearCurrentComposer();
  }, [
    attachmentUploadCount,
    clearCurrentComposer,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    updateFocusedComment,
  ]);

  const discardCurrentComposer = useCallback(() => {
    if (attachmentUploadCount > 0) return;
    const outcome = workspaceController?.discardCommentComposer();
    if (outcome?.status !== "succeeded") return;
    if (commentCanvasPort.getSnapshot().relinkingTarget === "__composer") {
      commentCanvasPort.clearRelink();
    }
    commentCanvasPort.setComposerOpen(false);
    updateFocusedComment(null);
    const discardedAttachments = (
      outcome.value as { attachments?: CommentAttachment[] }
    ).attachments ?? [];
    for (const attachment of discardedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
    }
    if (toastRef.current?.dedupeKey === "unfinished-comment-draft") {
      setToast(null);
    }
  }, [
    attachmentUploadCount,
    commentCanvasPort,
    forgetAttachmentObjectUrl,
    updateFocusedComment,
    workspaceController,
  ]);

  const addComment = useCallback(async () => {
    const currentRun = currentRunSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    const currentComments = currentCommentSessionSnapshot();
    const currentDraftTarget = currentComments.composerTarget;
    const currentDraft = currentComments.composerDraft;
    const currentDraftAttachments = currentComments.composerAttachments;
    const currentAttachmentUploadCount = workspaceController
      ?.comments.getSnapshot().persistence?.attachmentUploadCount ?? 0;
    if (
      currentRun.activeLocked
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || currentDocument.persistState === "conflict"
      || viewMode === "history"
    ) return;
    if (!currentDraftTarget) {
      editorRef.current?.clearSelection();
      return;
    }
    if (!canSaveCommentTarget(currentDraftTarget)) {
      beginTargetRelink("__composer");
      return;
    }
    if (!currentDraft.trim() && currentDraftAttachments.length === 0) {
      requestComposerFocus();
      return;
    }
    if (currentAttachmentUploadCount > 0) return;
    const commentId = currentComments.composerCommentId
      || recordId("comment", commentCounter.current++);
    const outcome = await requiredWorkspaceController(workspaceController)
      .commitComment({ commentId });
    if (outcome.status !== "succeeded") {
      if (outcome.status === "stale") return;
      setToast({
        title: "评论尚未保存",
        message: outcome.reason || "项目记录暂时无法建立；评论内容仍保留在输入框中。",
        tone: "warning",
        sticky: true,
        disposition: "direct-action",
        dedupeKey: "project-registration",
        action: { id: "resume-draft", label: "继续填写" },
      });
      requestComposerFocus();
      return;
    }
    const comment = (outcome.value as { comment: CommentItem }).comment;
    commentCanvasPort.setComposerOpen(false);
    if (toastRef.current?.dedupeKey === "unfinished-comment-draft") {
      setToast(null);
    }
    updateFocusedComment(comment.commentId);
    queueReviewPairReveal(comment.target, comment.commentId);
    captureUsageEvent("comment_saved", {
      target_level: comment.target.level === "insertion"
        ? "insertion"
        : comment.target.level === "part" ? "part" : "module",
      has_text: Boolean(comment.text),
      attachment_count: countBucket((comment.attachments ?? []).length),
      has_image: (comment.attachments ?? []).some((attachment) => attachment.kind === "image"),
      has_file: (comment.attachments ?? []).some((attachment) => attachment.kind === "file"),
    }, currentProjectSessionSnapshot().projectId || undefined);
  }, [
    currentCommentSessionSnapshot,
    currentDocumentSessionSnapshot,
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    queueReviewPairReveal,
    requestComposerFocus,
    updateFocusedComment,
    viewMode,
    workspaceController,
    beginTargetRelink,
    commentCanvasPort,
  ]);

  const queueReviewCommentFocus = useCallback((
    target: HtmlCanvasSelection,
    commentId: string,
  ) => {
    updateFocusedComment(commentId);
    queueReviewPairReveal(target, commentId);
  }, [queueReviewPairReveal, updateFocusedComment]);

  const beginCommentEdit = useCallback((
    comment: CommentItem,
    focusText = true,
  ): boolean => {
    const controller = workspaceControllerRef.current;
    const currentComments = currentCommentSessionSnapshot();
    if (!controller) return false;
    if (
      currentComments.composerTarget
      && (
        currentComments.composerDraft.trim()
        || currentComments.composerAttachments.length > 0
      )
    ) {
      setToast({
        title: "上一条评论还未保存",
        message: "请先保存或删除未保存评论，再修改已有评论。",
        tone: "warning",
        sticky: true,
        disposition: "direct-action",
        dedupeKey: "unfinished-comment-draft",
        action: { id: "resume-draft", label: "继续填写" },
      });
      return false;
    }
    if (currentComments.composerTarget) clearCurrentComposer();
    const currentSession = currentComments.editSession;
    if (
      currentSession
      && currentSession.commentId !== comment.commentId
      && commentEditSessionHasChanges(currentSession)
    ) {
      showUnfinishedCommentEditNotice(currentSession);
      return false;
    }
    const outcome = controller.beginCommentEdit({ commentId: comment.commentId });
    if (outcome.status !== "succeeded") return false;
    const nextSession = (outcome.value as { session: CommentEditSession }).session;
    // Move focus first. The presentation port is observed synchronously, so
    // publishing `editingCommentId` while the previously focused card is still
    // current can make the clean-edit guard retire this brand-new session.
    queueReviewCommentFocus(comment.target, comment.commentId);
    commentCanvasPort.setEditingCommentId(comment.commentId);
    if (focusText) {
      commentCanvasPort.requestCommentEditFocus(
        comment.commentId,
        !commentEditSessionHasChanges(nextSession),
      );
    }
    return true;
  }, [
    clearCurrentComposer,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewCommentFocus,
    showUnfinishedCommentEditNotice,
  ]);

  const cancelCommentEdit = useCallback((revealComment = true) => {
    if (attachmentUploadCount > 0) return;
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    const current = currentComments.comments.find(
      (comment) => comment.commentId === session?.commentId,
    );
    const outcome = workspaceController?.cancelCommentEdit({
      commentId: session?.commentId,
    });
    if (outcome?.status !== "succeeded") return;
    commentEditResumePendingRef.current = null;
    commentCanvasPort.setEditingCommentId(null);
    const stagedAttachments = (
      outcome.value as { stagedAttachments?: CommentAttachment[] }
    ).stagedAttachments ?? [];
    for (const attachment of stagedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
    }
    if (toastRef.current?.dedupeKey === "unfinished-comment-edit") {
      setToast(null);
    }
    if (revealComment && current) {
      queueReviewCommentFocus(current.target, current.commentId);
    }
  }, [
    attachmentUploadCount,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    forgetAttachmentObjectUrl,
    queueReviewCommentFocus,
    workspaceController,
  ]);

  const resumeCommentEdit = useCallback((commentId?: string) => {
    const controller = workspaceControllerRef.current;
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    if (!session || (commentId && session.commentId !== commentId)) return;
    const current = currentComments.comments.find(
      (comment) => comment.commentId === session.commentId,
    );
    if (!current) {
      controller?.clearCommentEdit();
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(null);
      return;
    }
    const located = editorRef.current?.select(
      current.target,
      { showToolbar: false },
    );
    const nextTarget = located || current.target;
    commentCanvasPort.setSelection(nextTarget);
    const targetLayouts = commentCanvasPort.getSnapshot().targetLayouts;
    const targetVisible = (
      current.target.tagName === "body"
      || targetLayouts[current.target.id]?.status === "visible"
    );
    commentEditResumePendingRef.current = targetVisible
      ? null
      : current.commentId;
    queueReviewCommentFocus(nextTarget, current.commentId);
    if (targetVisible) commentCanvasPort.setEditingCommentId(current.commentId);
    if (toastRef.current?.dedupeKey === "unfinished-comment-edit") {
      setToast(null);
    }
    if (targetVisible) {
      commentCanvasPort.requestCommentEditFocus(current.commentId);
    }
  }, [
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewCommentFocus,
  ]);

  const updateCommentEditDraft = useCallback((draftText: string) => {
    if (!currentCommentSessionSnapshot().editSession) return;
    workspaceControllerRef.current?.updateCommentEditDraft(draftText);
  }, [currentCommentSessionSnapshot]);

  const confirmCommentEdit = useCallback((commentId: string) => {
    const currentComments = currentCommentSessionSnapshot();
    const current = currentComments.comments.find((comment) => comment.commentId === commentId);
    const session = currentComments.editSession;
    if (!current || !session || session.commentId !== commentId) {
      cancelCommentEdit();
      return;
    }
    if (attachmentUploadCount > 0) return;
    const outcome = workspaceController?.confirmCommentEdit({ commentId });
    if (outcome?.status !== "succeeded") return;
    commentEditResumePendingRef.current = null;
    commentCanvasPort.setEditingCommentId(null);
    const removedAttachments = (
      outcome.value as { removedAttachments?: CommentAttachment[] }
    ).removedAttachments ?? [];
    for (const attachment of removedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
    }
    if (toastRef.current?.dedupeKey === "unfinished-comment-edit") {
      setToast(null);
    }
    queueReviewCommentFocus(current.target, current.commentId);
  }, [
    attachmentUploadCount,
    cancelCommentEdit,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    forgetAttachmentObjectUrl,
    queueReviewCommentFocus,
    workspaceController,
  ]);

  const deleteComment = useCallback((commentId: string) => {
    const outcome = workspaceController?.deleteComment({ commentId });
    if (outcome?.status !== "succeeded") return;
    const { deleted, editSession, attachments = [] } = outcome.value as {
      deleted?: CommentItem | null;
      editSession?: CommentEditSession | null;
      attachments?: CommentAttachment[];
    };
    if (editSession) {
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(null);
    }
    for (const attachment of attachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
    }
    if (deleted) {
      updateFocusedComment(null);
      queueReviewPairReveal(deleted.target, "");
    }
  }, [
    commentCanvasPort,
    forgetAttachmentObjectUrl,
    queueReviewPairReveal,
    updateFocusedComment,
    workspaceController,
  ]);

  useEffect(() => {
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    if (!session) return;
    const editedComment = currentComments.comments.find(
      (comment) => comment.commentId === session.commentId,
    );
    if (!editedComment) {
      workspaceControllerRef.current?.clearCommentEdit();
      commentEditResumePendingRef.current = null;
      const frame = window.requestAnimationFrame(() => {
        commentCanvasPort.setEditingCommentId(null);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    const targetStatus = commentCanvasPort.getSnapshot()
      .targetLayouts[editedComment.target.id]?.status;
    const presentation = commentCanvasPort.getSnapshot();
    const leftEditingContext = (
      canvasMode !== "edit"
      || targetStatus === "hidden"
      || (
        Boolean(presentation.focusedCommentId)
        && presentation.focusedCommentId !== session.commentId
      )
    );
    if (!leftEditingContext) return;
    if (!commentEditSessionHasChanges(session)) {
      const frame = window.requestAnimationFrame(() => {
        cancelCommentEdit(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (presentation.editingCommentId === session.commentId) {
      const frame = window.requestAnimationFrame(() => {
        commentCanvasPort.setEditingCommentId(null);
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [
    cancelCommentEdit,
    canvasMode,
    commentCanvasPort,
    commentEditSession,
    currentCommentSessionSnapshot,
  ]);

  useEffect(() => {
    const pendingId = commentEditResumePendingRef.current;
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    if (
      canvasMode !== "edit"
      || !pendingId
      || !session
      || session.commentId !== pendingId
    ) return;
    const current = currentComments.comments.find(
      (comment) => comment.commentId === pendingId,
    );
    if (!current) {
      commentEditResumePendingRef.current = null;
      return;
    }
    const targetVisible = (
      current.target.tagName === "body"
      || commentCanvasPort.getSnapshot().targetLayouts[current.target.id]?.status === "visible"
    );
    if (!targetVisible) return;
    commentEditResumePendingRef.current = null;
    commentCanvasPort.setEditingCommentId(current.commentId);
    queueReviewCommentFocus(current.target, current.commentId);
    commentCanvasPort.requestCommentEditFocus(current.commentId);
  }, [
    canvasMode,
    commentCanvasPort,
    commentEditSession,
    currentCommentSessionSnapshot,
    queueReviewCommentFocus,
  ]);

  useEffect(() => commentCanvasPort.subscribe(() => {
    if (canvasMode !== "edit") return;
    const currentComments = currentCommentSessionSnapshot();
    const session = currentComments.editSession;
    if (!session) return;
    const current = currentComments.comments.find(
      (comment) => comment.commentId === session.commentId,
    );
    if (!current) return;
    const presentation = commentCanvasPort.getSnapshot();
    const targetStatus = presentation.targetLayouts[current.target.id]?.status;
    const pendingId = commentEditResumePendingRef.current;
    if (
      pendingId === session.commentId
      && (current.target.tagName === "body" || targetStatus === "visible")
    ) {
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(current.commentId);
      queueReviewCommentFocus(current.target, current.commentId);
      commentCanvasPort.requestCommentEditFocus(current.commentId);
      return;
    }
    const leftFocusedComment = Boolean(
      presentation.focusedCommentId
      && presentation.focusedCommentId !== session.commentId
    );
    if (
      presentation.editingCommentId !== session.commentId
      || (targetStatus !== "hidden" && !leftFocusedComment)
    ) return;
    if (!commentEditSessionHasChanges(session)) {
      window.requestAnimationFrame(() => cancelCommentEdit(false));
    } else {
      window.requestAnimationFrame(() => commentCanvasPort.setEditingCommentId(null));
    }
  }), [
    cancelCommentEdit,
    canvasMode,
    commentCanvasPort,
    currentCommentSessionSnapshot,
    queueReviewCommentFocus,
  ]);

  const focusCommentTarget = useCallback((
    target: HtmlCanvasSelection,
    commentId: string,
  ) => {
    if (!canLocateTarget(target)) {
      commentCanvasPort.setSelection(target);
      updateFocusedComment(commentId);
      queueReviewPairReveal(target, commentId);
      return;
    }
    updateFocusedComment(commentId);
    const located = editorRef.current?.select(target, { showToolbar: false });
    const nextTarget = located || target;
    commentCanvasPort.setSelection(nextTarget);
    queueReviewPairReveal(nextTarget, commentId);
  }, [commentCanvasPort, queueReviewPairReveal, updateFocusedComment]);

  const handleCanvasSelection = useCallback((target: HtmlCanvasSelection | null) => {
    commentCanvasPort.resetRail();
    commentCanvasPort.setSelection(target);
    const currentComposerOpen = commentCanvasPort.getSnapshot().composerOpen;
    if (!target) {
      if (!currentComposerOpen) updateFocusedComment(null);
      return;
    }
    if (finishTargetRelink(target)) return;
    if (currentComposerOpen || viewMode === "history") return;
    const matchesTarget = (comment: CommentItem) => (
      comment.target.id === target.id
      || (
        comment.target.selector === target.selector
        && comment.target.level === target.level
      )
    );
    const currentFocusedId = commentCanvasPort.getSnapshot().focusedCommentId;
    const focusedMatch = visibleCommentItems.find(
      (comment) => comment.commentId === currentFocusedId && matchesTarget(comment),
    );
    const nextComment = focusedMatch || visibleCommentItems.find(matchesTarget);
    if (!nextComment || !canLocateTarget(nextComment.target)) {
      updateFocusedComment(null);
      return;
    }
    // A direct Canvas click already happened at the user's current viewport.
    // Highlight its paired comment without moving the shared Canvas/rail scroll.
    // Explicit navigation from a comment card still reveals its Canvas target.
    updateFocusedComment(nextComment.commentId);
  }, [
    commentCanvasPort,
    finishTargetRelink,
    updateFocusedComment,
    viewMode,
    visibleCommentItems,
  ]);

  const revealAiTaskInFinder = useCallback(async () => {
    const activeSourcePath = currentProjectSessionSnapshot().sourcePath;
    const revealAiTask = window.htmlAIProjects?.revealAiTask;
    if (!activeSourcePath || !revealAiTask) return;
    await runLocalUserAction({
      kind: "reveal-ai-task",
      invoke: () => revealAiTask({ sourcePath: activeSourcePath }),
      onFailure: (cause: unknown) => setToast({
        title: "AI任务暂时无法打开",
        message: productErrorMessage(
          cause,
          "本轮任务仍在处理面板中，可以重新尝试。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "reveal-ai-task",
      }),
    });
  }, [currentProjectSessionSnapshot]);

  const generateRequest = useCallback(async (
    deliveryMode: AgentDeliveryMode, fromDeferred = false,
  ) => {
    const presentRunSubmissionFailure = (outcome: { code: string; reason: string }) => {
      if (outcome.code === "RUN_SUBMISSION_COMMENT_DRAFT") {
        setToast({
          title: "还有一条评论未保存",
          message: "请先点击“评论”保存；保存后仍可修改，再发送本轮要求。",
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "unfinished-comment-draft",
          action: { id: "resume-draft", label: "继续填写" },
        });
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_COMMENT_EDIT") {
        const currentEdit = currentCommentSessionSnapshot().editSession;
        if (currentEdit) showUnfinishedCommentEditNotice(currentEdit);
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_COMMENTS_EMPTY") {
        requestComposerFocus();
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_TARGET_UNSAFE") {
        const unsafeTargets = unsafeRelinkComments(
          currentCommentSessionSnapshot().comments,
        );
        // A blocked send is only recoverable on the edit canvas; flip back so
        // the persistent rail card (the durable #281 entry) is on screen even
        // when the send was issued from the AI sidebar in preview mode.
        setCanvasMode("edit");
        setSubmissionRelinkPendingIds(
          unsafeTargets.map((comment) => comment.commentId),
        );
        setToast(unsafeCommentTargetsNotice(unsafeTargets));
        return;
      }
      if (
        outcome.code === "RUN_SUBMISSION_NATIVE_EDIT"
        || outcome.code === "RUN_SUBMISSION_FREEZE"
      ) {
        editorRef.current?.showCommitBlocked(outcome.reason);
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_LOCKED") {
        setCanvasMode("preview");
        revealAiConversation();
        void workspaceControllerRef.current?.dismissFirstEditGuide();
        return;
      }
      if (outcome.code === "RUN_SUBMISSION_DOCUMENT_EDIT") {
        setToast({
          title: "当前编辑没有进入撤销历史",
          message: outcome.reason,
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "source-history-record-failed",
          action: { id: "retry-submit", label: "重新发送" },
        });
        return;
      }
      if (
        deliveryMode === "managed-agent"
        && workspaceControllerRef.current
          ?.getSnapshot().run?.qoderAvailability.status !== "ready"
      ) return;
      const registrationFailure = outcome.code === "PROJECT_REGISTRATION_REJECTED"
        || outcome.code === "PROJECT_REGISTRATION_UNKNOWN"
        || outcome.code === "RUN_SUBMISSION_REGISTRATION_INVALID";
      setToast({
        title: registrationFailure ? "项目记录尚未建立" : "暂时无法发送本轮要求",
        message: outcome.reason,
        tone: registrationFailure ? "warning" : "error",
        sticky: true,
        disposition: "direct-action",
        dedupeKey: registrationFailure ? "project-registration" : "run-submission-failed",
        action: {
          id: "retry-submit",
          label: registrationFailure ? "重新建立并发送" : "重新发送",
        },
      });
    };
    if (!fromDeferred) deferredEditorReplayRef.current.agentDeliveryMode = deliveryMode;
    const currentRun = currentRunSessionSnapshot();
    const currentProject = currentProjectSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    if (currentRun.submissionPending) return;
    const submissionSourcePath = currentProject.sourcePath;
    if (!submissionSourcePath) {
      if (typeof window !== "undefined" && !window.htmlAIProjects) return;
      void openProject();
      return;
    }
    if (
      !workspaceController
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || viewMode === "history"
      || currentDocument.persistState === "failed"
      || currentDocument.persistState === "conflict"
    ) return;
    if (currentRun.activeLocked) {
      presentRunSubmissionFailure({ code: "RUN_SUBMISSION_LOCKED", reason: "当前项目正在处理上一轮要求。" });
      return;
    }
    const submissionPlan = workspaceController.planRunSubmission();
    if (
      submissionPlan.kind === "reject"
      && ["RUN_SUBMISSION_COMMENT_DRAFT", "RUN_SUBMISSION_COMMENT_EDIT"]
        .includes(submissionPlan.code)
    ) {
      presentRunSubmissionFailure(submissionPlan);
      return;
    }
    if (
      !fromDeferred
      && deferEditorCommand(
        "ai-handoff",
        () => deferredEditorReplayRef.current.generateRequest?.(),
      )
    ) return;

    const outcome = await requiredWorkspaceController(workspaceController)
      .submitRequest({
        projectName,
        previousVersionId: latestVersionId,
        basedOnVersionId: currentBasedOnVersionId,
        deadlineAt: Date.now() + 60_000,
        deliveryMode,
      });
    if (outcome.status === "succeeded" || outcome.status === "stale") return outcome;
    if (outcome.status === "unknown") {
      setCanvasMode("preview");
      revealAiConversation();
      void workspaceControllerRef.current?.dismissFirstEditGuide();
      return outcome;
    }
    presentRunSubmissionFailure(outcome);
    return outcome;
  }, [
    currentBasedOnVersionId,
    currentCommentSessionSnapshot,
    currentDocumentSessionSnapshot,
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    deferEditorCommand,
    latestVersionId,
    openProject,
    revealAiConversation,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    projectName,
    requestComposerFocus,
    setToast,
    showUnfinishedCommentEditNotice,
    viewMode,
    workspaceController,
  ]);
  const checkQoderUsability = useCallback(async () => (
    workspaceController?.checkQoderUsability() ?? null
  ), [workspaceController]);
  const copyQoderGuidance = useCallback(async (kind: QoderGuidanceKind) => (
    workspaceController?.copyQoderGuidance({ kind }) ?? null
  ), [workspaceController]);
  useEffect(() => {
    deferredEditorReplayRef.current.generateRequest = () => {
      void generateRequest(deferredEditorReplayRef.current.agentDeliveryMode, true);
    };
  }, [generateRequest]);

  // Published for the conversation, which is constructed above this declaration and
  // therefore cannot name it directly.
  useEffect(() => {
    generateRequestRef.current = (mode: AgentDeliveryMode) => {
      void generateRequest(mode);
    };
  }, [generateRequest]);

  const activateReadyResult = useCallback(async (
    { reviewed = false }: { reviewed?: boolean } = {},
  ) => {
    const run = activeRun;
    if (
      !run
      || !workspaceController
      || !runCapability
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || (
        run.candidateAssessment?.status === "attention"
        && !reviewed
      )
    ) return;
    const operationKey = activeRunOperationKey(run);
    performance.mark("pageroot:accept:start");
    setOpeningReadyVersion(true);
    try {
      const outcome = await runCapability.commands.activateReadyVersion({
          run,
          reviewLease: readyReviewSession?.operationKey === operationKey
            ? {
                operationKey: readyReviewSession.operationKey,
                beforeHtml: readyReviewSession.beforeHtml,
              }
            : null,
        });
      performance.mark("pageroot:accept:activated");
      if (outcome.status !== "succeeded") {
        if (outcome.status !== "stale") {
          const published = readyVersionPublicationMatches(workspaceController, run);
          if (!published) {
            setCanvasMode("preview");
            revealAiConversation();
          }
          setToast({
            title: published ? "新版本已提交，编辑画布仍在准备" : "最新版暂时无法打开",
            message: published ? `${outcome.reason} 已提交的 HTML 保持可见，完成恢复前不会开放编辑。`
              : outcome.reason,
            tone: outcome.status === "blocked" ? "warning" : "error",
            sticky: outcome.status !== "blocked",
            disposition: "background-result",
            dedupeKey: "activate-ready-version",
          });
        }
        return;
      }
      const result = outcome.value as {
        current: boolean;
        candidateLabel: string;
        protocolViolation: boolean;
        aiCompletedAt: string;
        committedSourcePath: string;
        lastModifiedAt: string;
        verificationWarning?: string;
      };
      if (readyReviewSession?.operationKey === operationKey) {
        // The canvas already acknowledged the verified Version bytes inside
        // activateReadyVersion, so the overlay teardown, drawer close and
        // mode switch below can land in one React commit: a single visual
        // cut instead of a multi-frame cascade.
        setDrawer(null);
        setReadyReviewSession(null);
        performance.mark("pageroot:accept:overlay-closed");
      }
      if (!result.current) {
        setToast({
          title: result.protocolViolation
            ? `${result.candidateLabel} 已生成，但需要检查`
            : `${result.candidateLabel} 已生成`,
          message: result.protocolViolation
            ? "新版本本身已经安全提交，但检测到内部 AI 在完成后又改动了临时输出；打开项目查看详情。"
            : `${result.aiCompletedAt ? `内部 AI 于 ${formatTime(result.aiCompletedAt, true)} 完成；` : ""}打开该项目后会核对并显示新版本。`,
          tone: result.protocolViolation ? "warning" : "success",
          sticky: result.protocolViolation,
          disposition: "background-result",
          dedupeKey: `background-version:${run.sourcePath}`,
          action: {
            id: "open-project",
            label: "打开项目",
            sourcePath: result.committedSourcePath,
          },
        });
        return;
      }
      setLastModifiedAt(result.lastModifiedAt || null);
      commentCanvasPort.setSelection(null);
      commentCanvasPort.setComposerOpen(false);
      commentEditResumePendingRef.current = null;
      commentCanvasPort.setEditingCommentId(null);
      setPreviewAttachment(null);
      setHandoffPreviewOpen(false);
      setCanvasMode("edit");
      setDrawer(null);
      performance.mark("pageroot:accept:ui-committed");
      if (result.protocolViolation) {
        const warning = "内部 AI 的临时输出在最终化后又被修改；已提交版本本身未受影响。";
        setToast({
          title: `${result.candidateLabel} 已打开，但需要检查`,
          message: `${warning} 新版本内容已经核对一致；详情已保留在本轮处理记录中。`,
          tone: "warning",
          sticky: true,
          dedupeKey: "current-version-result",
          action: { id: "open-handoff", label: "回到 AI 助手" },
        });
      } else if (result.verificationWarning) {
        setToast({
          title: `${result.candidateLabel} 已打开，但需要复核`,
          message: result.verificationWarning,
          tone: "warning",
          sticky: true,
          disposition: "background-result",
          dedupeKey: "current-version-result",
        });
      } else if (reviewed) {
        // Accepting from review closes the comparison and swaps the canvas back to
        // editing in one cut. Without a word the user cannot tell which version
        // they are now editing, so name it once, quietly, and let it dismiss
        // itself rather than raising a dialog.
        setToast({
          title: `已采纳 ${result.candidateLabel}`,
          message: "现在编辑的就是这一版；上一版仍保留在项目里。",
          tone: "success",
          dedupeKey: "current-version-result",
        });
      } else if (
        toastRef.current?.dedupeKey === "activate-ready-version"
        || toastRef.current?.dedupeKey === "current-version-result"
      ) {
        setToast(null);
      }
    } finally {
      const visibleRun = currentRunSessionSnapshot().activeRun;
      const currentProject = currentProjectSessionSnapshot();
      if (
        sameLocalSourcePath(currentProject.sourcePath, run.sourcePath)
        || (
          currentProject.projectId === run.projectId
          && currentProject.documentId === run.documentId
        )
        || (
          visibleRun?.requestId === run.requestId
          && visibleRun.attemptId === run.attemptId
        )
      ) {
        setOpeningReadyVersion(false);
      }
    }
  }, [
    activeRun,
    commentCanvasPort,
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    readyReviewSession,
    revealAiConversation,
    runCapability,
    workspaceController,
  ]);

  const reviewReadyResult = useCallback(async () => {
    const run = currentRunSessionSnapshot().activeRun;
    if (
      !run
      || !workspaceController
      || !runCapability
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || reviewPreparing
    ) return;
    setReviewPreparing(true);
    try {
      const outcome = await runCapability.commands.prepareReview({ run });
      if (outcome.status !== "succeeded") {
        if (outcome.status === "stale") return;
        throw new Error(outcome.reason);
      }
      const candidate = outcome.value;
      const operationKey = candidate.operationKey;
      const currentRun = currentRunSessionSnapshot().activeRun;
      if (
        !currentRun
        || currentRun.status !== "ready-to-open"
        || activeRunOperationKey(currentRun) !== operationKey
      ) return;
      const reviewContext = captureProjectContext();
      if (!reviewContext) {
        throw new Error("当前画布缺少可核对的项目身份，无法开始安全审阅。");
      }
      const frozen = fenceAndFreezeCurrentCanvas(
        "当前编辑画布尚未就绪，无法开始安全审阅。",
      );
      if (!frozen.ok) {
        throw new Error(frozen.reason || "当前编辑会话尚未安全收口。");
      }
      if (!isCurrentProjectContext(reviewContext)) {
        throw new DeferredEditorCommandDiscardedError("stale-session");
      }
      const frozenHtml = frozen.html;
      if (
        !candidate.baseSnapshotSha256
        || await browserSha256(frozenHtml) !== candidate.baseSnapshotSha256
      ) {
        throw new Error("当前冻结 HTML 已发生变化，无法开始安全对比。");
      }
      const externalBootstrap = Boolean(window.htmlAIPreview);
      const sessionId = `review-${Date.now().toString(36)}-${++reviewSessionSequenceRef.current}`;
      const beforeLabel = run.basedOnVersionId
        ? safeVersionLabel(run.basedOnVersionId)
        : "当前版本";
      const afterLabel = String(
        run.readyPayload.candidateDisplayVersionLabel
        || safeVersionLabel(run.candidateVersionId),
      );
      const preparedReview = await prepareReviewAnalysis({
        session: reviewAnalysisSession,
        candidate,
        beforeHtml: frozenHtml,
        comments: currentCommentSessionSnapshot().comments,
        externalBootstrap,
        sessionId,
        onShell: (documents) => {
          if (!isCurrentProjectContext(reviewContext)) return;
          setReadyReviewSession({ operationKey, sessionId, documents,
            beforeHtml: frozenHtml, sourcePath: candidate.sourcePath,
            beforeLabel, afterLabel });
          setDrawer(null);
          performance.mark("pageroot:review:shell-visible");
        },
      });
      const analyzedRun = currentRunSessionSnapshot().activeRun;
      if (
        !analyzedRun
        || analyzedRun.status !== "ready-to-open"
        || activeRunOperationKey(analyzedRun) !== operationKey
        || !isCurrentProjectContext(reviewContext)
      ) return;
      setReadyReviewSession({
        operationKey,
        sessionId: preparedReview.sessionId,
        documents: preparedReview.documents,
        beforeHtml: frozenHtml,
        sourcePath: preparedReview.sourcePath,
        beforeLabel,
        afterLabel,
      });
      setDrawer(null);
    } catch (cause) {
      if (cause instanceof ReviewAnalysisCancelledError) return;
      setToast({
        title: "暂时无法开始审阅",
        message: productErrorMessage(
          cause,
          "候选版本仍已安全保留，可以稍后重试。",
        ),
        tone: "error",
        sticky: true,
        dedupeKey: "ready-version-review",
      });
    } finally {
      setReviewPreparing(false);
    }
  }, [
    captureProjectContext,
    currentCommentSessionSnapshot,
    currentRunSessionSnapshot,
    fenceAndFreezeCurrentCanvas,
    isCurrentProjectContext,
    reviewAnalysisSession,
    reviewPreparing,
    runCapability,
    workspaceController,
  ]);

  useEffect(() => {
    if (!readyReviewSession) return;
    const currentRun = currentRunSessionSnapshot().activeRun;
    if (
      !currentRun
      || currentRun.status !== "ready-to-open"
      || activeRunOperationKey(currentRun) !== readyReviewSession.operationKey
    ) {
      if (openingReadyVersion) return;
      const frame = window.requestAnimationFrame(() => {
        setReadyReviewSession(null);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    return undefined;
  }, [
    activeRun,
    currentRunSessionSnapshot,
    openingReadyVersion,
    readyReviewSession,
  ]);

  const cancelActiveRun = useCallback(async ({
    agentMayBeRunning = false,
    reason,
  }: {
    agentMayBeRunning?: boolean;
    reason?: string;
  } = {}) => {
    if (!activeRun || !runCapability) return false;
    const outcome = await runCapability.commands.cancel({
      run: activeRun,
      agentMayBeRunning,
      reason,
    });
    return outcome.status === "succeeded";
  }, [activeRun, runCapability]);

  const requestActiveRunEnd = useCallback(() => {
    if (!activeRun) return;
    if (handoffCancellationNeedsConfirmation) {
      setCancelRunConfirmationKey(activeRunOperationKey(activeRun));
      return;
    }
    void cancelActiveRun();
  }, [
    activeRun,
    cancelActiveRun,
    handoffCancellationNeedsConfirmation,
  ]);

  const resolveAiConflict = useCallback(async (action: "adopt-ai" | "keep-external") => {
    if (
      !activeRun
      || activeRun.status !== "awaiting-conflict-resolution"
      || !runCapability
    ) return;
    const outcome = await runCapability.commands.resolveConflict({ run: activeRun, action });
    if (outcome.status !== "succeeded") {
      if (outcome.status !== "stale") {
        setCanvasMode("preview");
        revealAiConversation();
      }
      return;
    }
    const result = outcome.value as {
      current?: boolean;
      reloadCurrentSource?: boolean;
    };
    if (action === "keep-external") {
      if (result.reloadCurrentSource) {
        await reloadCurrentSource({
          skipConfirmation: true,
          externalAuthorityAccepted: true,
        });
      } else {
        setToast({
          title: "已保留外部 HTML",
          message: "对应项目的 AI 候选没有覆盖源文件；切回时会读取外部内容。",
          tone: "success",
          dedupeKey: `background-version:${activeRun.sourcePath}`,
        });
      }
    }
  }, [
    activeRun,
    reloadCurrentSource,
    revealAiConversation,
    runCapability,
  ]);

  const viewHistoryVersion = useCallback(async (version: Version) => {
    if (
      runInProgress
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || !workspaceController
    ) return;
    const context = captureProjectContext();
    if (!context) return;
    const outcome = await requiredWorkspaceController(workspaceController)
      .viewHistory({ version, context, deadlineAt: Date.now() + 15_000 });
    if (outcome.status === "succeeded") {
      setDrawer(null);
      editorRef.current?.clearSelection();
      return;
    }
    if (outcome.status === "stale") return;
    setToast({
      title: "无法打开这个历史版本",
      message: outcome.reason,
      tone: "error",
      disposition: "background-result",
      dedupeKey: "history-navigation",
    });
  }, [
    captureProjectContext,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    runInProgress,
    workspaceController,
  ]);

  const returnToCurrent = useCallback(async () => {
    if (isViewTransitioning() || projectLoadError || !workspaceController) return;
    const context = captureProjectContext();
    if (!context) return;
    const outcome = await requiredWorkspaceController(workspaceController)
      .returnToCurrent({ context });
    if (outcome.status === "succeeded") {
      const lastModifiedAt = String(outcome.value.lastModifiedAt || "");
      if (lastModifiedAt) setLastModifiedAt(lastModifiedAt);
      return;
    }
    if (outcome.status === "stale") return;
    setToast({
      title: "无法返回当前 HTML",
      message: outcome.reason,
      tone: "error",
      disposition: "background-result",
      dedupeKey: "history-navigation",
    });
  }, [
    captureProjectContext,
    isViewTransitioning,
    projectLoadError,
    workspaceController,
  ]);

  const continueEditingHistoryVersion = useCallback(async () => {
    if (
      viewMode !== "history"
      || !viewingVersionId
      || isViewTransitioning()
      || runInProgress
      || projectHydrating
      || projectLoadError
      || !workspaceController
    ) return;
    const context = captureProjectContext();
    if (!context) return;
    const outcome = await requiredWorkspaceController(workspaceController)
      .continueEditingHistoryVersion({
        versionId: viewingVersionId,
        context,
      });
    if (outcome.status === "succeeded") {
      const lastModifiedAt = String(outcome.value.lastModifiedAt || "");
      if (lastModifiedAt) setLastModifiedAt(lastModifiedAt);
      setDrawer(null);
      editorRef.current?.clearSelection();
      return;
    }
    if (outcome.status === "stale") return;
    setToast({
      title: "无法基于此版本继续编辑",
      message: outcome.reason,
      tone: "error",
      disposition: "background-result",
      dedupeKey: "history-continue-editing",
    });
  }, [
    captureProjectContext,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    runInProgress,
    viewMode,
    viewingVersionId,
    workspaceController,
  ]);

  const persistLabel = workspaceController?.hasDocumentHistoryAction
    ? "正在撤销或重做…"
    : persistState === "writing"
    ? "正在更新文件…"
    : persistState === "queued"
      ? "正在更新文件…"
      : persistState === "preview-dirty"
        ? "仅预览 · 修改尚未绑定本地文件"
      : persistState === "conflict"
        ? "检测到外部修改 · 未覆盖原文件"
        : persistState === "failed"
          ? "文件更新失败 · 尚未写入磁盘"
          : sourcePath
            ? `已同步更新${lastModifiedAt ? ` · ${formatProjectTimestamp(lastModifiedAt)}` : ""}`
            : browserPreviewOnly
              ? "浏览器预览 · 只读"
              : "内置介绍页 · 打开本地 HTML 后开始编辑";
  const canvasAuthority = documentSnapshot.canvasAuthority;
  const visibleCanvasAck = canvasMode === "preview"
    ? canvasRenderAcks.preview
    : (
      canvasAuthority?.status === "verified"
        ? {
          generation: canvasAuthority.generation,
          sha256: canvasAuthority.renderedSha256,
        }
        : null
    );
  const isSafelySaved = Boolean(
    sourcePath
    && sourceSha256
    && viewMode === "current"
    && persistState === "idle"
    && editRevision === lastPersistedRevision
    && !projectHydrating
    && !projectLoadError
    && !viewTransitioning
    && canvasAuthority?.status === "verified"
    && canvasAuthority.generation === canvasGeneration
    && canvasAuthority.renderedSha256 === sourceSha256
  );
  const safeSaveLabel = canvasAuthority?.status === "failed"
    ? "画布确认失败 · 重试"
    : isSafelySaved
      ? "已安全保存"
      : "正在确认当前画布…";
  const saveStatusLabel = browserPreviewOnly
    ? "操作不会保存"
    : persistState !== "idle"
        ? persistLabel
        : viewMode === "history"
          ? "历史版本 · 只读"
          : sourcePath
            ? safeSaveLabel
            : persistLabel;
  const currentWorkingCopy = versions.find(
    (version) => version.id === currentBasedOnVersionId,
  ) || null;
  const currentWorkingCopyStatus = currentWorkingCopy
    ? currentWorkingCopyPresentation({
      currentBasedOnVersionId,
      currentExactVersionId,
      persistState,
      persistedDiffersFromBase: currentWorkingCopy.differsFromBase === true,
      persistedSaveState: currentWorkingCopy.saveState,
    })
    : null;
  const projectStatus = projectStatusProjection({
    currentBasedOnVersionId,
    currentExactVersionId,
    latestVersionId,
    viewMode,
    viewingVersionId,
    persistState,
    hasLocalModifications: currentWorkingCopyStatus?.differsFromBase === true,
    candidate: activeRun
      ? {
        versionId: activeRun.candidateVersionId || null,
        status: activeRun.status,
      }
      : null,
  });
  const headerStatusFacts = browserPreviewOnly
    ? ["浏览器预览 · 只读"]
    : [...projectStatus.facts];
  const canShowCurrentFileInFolder = Boolean(
    sourcePath
    && typeof window !== "undefined"
    && window.htmlAIProjects?.showInFolder,
  );
  const canOpenProjectRootInFolder = Boolean(
    projectRecordsPath
    && workspaceController
    && typeof window !== "undefined",
  );
  const canOpenCurrentHtmlInDefaultBrowser = Boolean(
    sourcePath
    && typeof window !== "undefined"
    && window.htmlAIProjects?.openInDefaultBrowser,
  );
  const pendingRunOutcome = Boolean(
    activeRun?.requestId === "pending" && projectLocked,
  );
  const terminalRun = Boolean(
    activeRun && ["error", "no-change"].includes(activeRun.status) && !pendingRunOutcome,
  );
  const commentTargetIsLocatable = useCallback((target: HtmlCanvasSelection): boolean => {
    const layout = commentCanvasPort.getSnapshot().targetLayouts[target.id];
    const resolution = layout?.resolution ?? target.resolution;
    return layout?.status !== "missing"
      && (resolution === "exact" || resolution === "rebound");
  }, [commentCanvasPort]);
  const reopenRecentRunOutcome = () => {
    if (!runCapability?.commands.reopenRecentOutcome(sourcePath)) return;
    setHandoffPreviewOpen(false);
    setCanvasMode("preview");
    revealAiConversation();
  };
  const handleToastAction = (action: ToastAction) => {
    setToast(null);
    switch (action.id) {
      case "retry-canvas-verification":
        void workspaceControllerRef.current?.retryCanvasVerification({
          context: captureProjectContext() || undefined,
        });
        return;
      case "reveal-imported-project":
        void showProjectInFolder(action.sourcePath);
        return;
      case "retry-export":
        void exportCurrentHtml();
        return;
      case "open-handoff":
        setCanvasMode("preview");
        revealAiConversation();
        return;
      case "retry-history":
        void requestSourceHistoryAction(
          action.direction || lastHistoryDirectionRef.current,
        );
        return;
      case "open-project":
        void openProject(action.sourcePath);
        return;
      case "retry-project-open":
        if (!action.sourcePath && fileInputRef.current) {
          // Keep this click in the toast's user-activation turn. Navigation
          // admission may still be busy finishing the current HTML, and a
          // queued input.click() is ignored by Chromium.
          fileInputRef.current.click();
          return;
        }
        void openProject(action.sourcePath);
        return;
      case "retry-project-hydration":
        void workspaceController?.retryProjectHydration();
        return;
      case "retry-external-project-open":
        if (action.requestId) {
          void workspaceController?.retryExternalOpen({ requestId: action.requestId });
        } else {
          void resumeDeferredExternalProject();
        }
        return;
      case "retry-project-application":
        void resumeDeferredProjectApplication();
        return;
      case "open-attachment-picker":
        openAttachmentPicker(action.target, action.accept || "all");
        return;
      case "review-comment-attachments":
        {
          const currentComments = currentCommentSessionSnapshot();
        if (action.target.kind === "composer") {
          const target = currentComments.composerTarget;
          if (
            currentComments.composerCommentId === action.target.commentId
            && target
          ) {
            commentCanvasPort.setComposerOpen(true);
            queueReviewPairReveal(target, "__composer");
            requestComposerFocus();
          }
        } else {
          const comment = currentComments.comments.find(
            (item) => item.commentId === action.target.commentId,
          );
          if (comment) focusCommentTarget(comment.target, comment.commentId);
        }
        return;
        }
      case "relaunch-app":
        void relaunchApp();
        return;
      case "retry-draft-persist":
        void workspaceController?.flushDraft();
        return;
      case "review-project-rules":
        setDrawer("files");
        projectPanelPort.requestOpenRules();
        return;
      case "resume-draft":
        setCanvasMode("edit");
        setDrawer(null);
        resumeCurrentComposer();
        return;
      case "resume-comment-edit":
        setCanvasMode("edit");
        setDrawer(null);
        window.requestAnimationFrame(() => {
          resumeCommentEdit(action.commentId);
        });
        return;
      case "retry-submit":
        void generateRequest(deferredEditorReplayRef.current.agentDeliveryMode);
        return;
    }
  };

  // Same authority the process drawer used, reached from the conversation so the
  // decision no longer requires a panel over the page.
  const handleAiDecision = useCallback((actionId: string) => {
    if (actionId === "review") { void reviewReadyResult(); return; }
    if (actionId === "adopt") { void activateReadyResult(); return; }
    if (actionId === "adopt-ai" || actionId === "keep-external") {
      void resolveAiConflict(actionId);
      return;
    }
    if (actionId === "return-editing" || actionId === "dismiss") {
      workspaceControllerRef.current?.runs.commands.dismiss();
      setHandoffPreviewOpen(false);
      setCanvasMode("edit");
      setDrawer(null);
      editorRef.current?.unlockNow?.();
      return;
    }
    if (actionId === "recopy") {
      const controller = workspaceControllerRef.current?.runs;
      if (!controller || !activeRun) return;
      // Copying is invisible by nature: without a word the user cannot tell an
      // successful re-copy from a dead button.
      void (async () => {
        const outcome = await controller.commands.copyHandoff({ run: activeRun });
        setToast(outcome && outcome.status === "succeeded"
          ? {
            title: "本轮要求已复制",
            message: "粘贴给你的 AI；改完回到这里。",
            tone: "success",
            dedupeKey: "handoff-recopied",
          }
          : {
            title: "复制没有成功",
            // 「查看本轮」 no longer exists: the round lives in this conversation.
            message: "再试一次；本轮要求就在这条对话里。",
            tone: "warning",
            dedupeKey: "handoff-recopied",
          });
      })();
      return;
    }
    if (actionId === "cancel") requestActiveRunEnd();
  }, [
    activateReadyResult,
    activeRun,
    requestActiveRunEnd,
    resolveAiConflict,
    reviewReadyResult,
    setToast,
  ]);

  const aiAssistantEntry = (
    <AgentDeliveryButton
      status={currentAgentHandoffStatus}
      attention={Boolean(activeRun?.candidateVersionLabel) || runInProgress}
      disabled={generating || projectHydrating || Boolean(projectLoadError)
        || viewTransitioning || viewMode === "history" || browserPreviewOnly}
      onOpen={() => {
        // One meaning: show the conversation. It carries the stages, the Agent's
        // words and the decision, and it docks in preview or review.
        setDrawer(null);
        setHandoffPreviewOpen(false);
        setCanvasMode("preview");
        // Opening is navigation. New actions on this surface are modifications;
        // historical conversation messages remain readable above them.
        revealAiConversation();
      }}
    />
  );

  // The review compares immutable snapshots prepared against the
  // pre-promotion source identity. Accepting promotes the Working Copy to a
  // new path while this overlay is still visible; the live path would rebuild
  // both preview sessions (and retitle the header) mid-accept for nothing.
  const readyReviewOverlay = readyReviewSession ? (
    <AiReviewWorkspace
      embedded
      fileName={
        localFileNameFromSourcePath(readyReviewSession.sourcePath)
        || currentSourceFileName
      }
      beforeLabel={readyReviewSession.beforeLabel}
      afterLabel={readyReviewSession.afterLabel}
      sessionId={readyReviewSession.sessionId}
      documents={readyReviewSession.documents}
      sourcePath={readyReviewSession.sourcePath || undefined}
      accepting={openingReadyVersion}
      error={activeRun?.status === "ready-to-open" ? activeRun.error : undefined}
      notice={activeRun?.candidateAssessment?.status === "attention"
        ? "这个候选可以打开，但与上一版的共同特征较少。请重点核对整页内容，再决定是否接受。"
        : undefined}
      onAbout={openAboutPageRoot}
      onReturnBefore={() => {
        void (async () => {
          const restored = await cancelActiveRun({
            reason: "declined-ai-candidate-after-review",
          });
          if (!restored) return;
          setToast({
            title: `已返回 AI 修改前的${readyReviewSession.beforeLabel}`,
            message: `${readyReviewSession.afterLabel} 与本轮记录仍已保留；当前页面可直接继续编辑。`,
            tone: "success",
            dedupeKey: "ready-version-returned-before",
          });
        })();
      }}
      onAccept={() => {
        void activateReadyResult({
          reviewed: true,
        });
      }}
      onRevealAiTask={() => void revealAiTaskInFinder()}
      assistantEntry={aiAssistantEntry}
      sidebar={aiConversation.visible && runCapability ? (
        <RunConversationOutlet
          capability={runCapability}
          sidebarProps={{
            ...aiConversation.sidebarProps,
            onAction: handleAiDecision,
          }}
          reviewing
          deliveryMode={currentAgentDeliveryMode}
        />
      ) : null}
    />
  ) : null;
  const activeWorkbenchTab = workbenchTabsSnapshot.tabs.find(
    (tab) => tab.tabId === workbenchTabsSnapshot.activeTabId,
  ) || workbenchTabsSnapshot.tabs[0];
  const startPageActive = activeWorkbenchTab?.kind === "start"
    && typeof window !== "undefined"
    && Boolean(window.htmlAIProjects);
  const { visibleCachedSurface, retainPresentedTab, completeHandoff, updateVisibleScroll, markFirstScroll } = useDocumentSurfaceHandoff({ cache: documentSurfaceCacheSnapshot, tabs: workbenchTabsSnapshot, sourceSha256, renderedSourceSha256: canvasMode === "preview" && canvasRenderAcks.preview?.generation === canvasGeneration ? canvasRenderAcks.preview.sha256 : renderedContentSha256, canvasAuthority, canvasGeneration, controller: workspaceController });
  const retryProjectHydrationFromCommentRail = useCallback(() => {
    void workspaceController?.retryProjectHydration();
  }, [workspaceController]);
  const updateCommentDraftFromRail = useCallback((value: string) => {
    workspaceControllerRef.current?.updateCommentDraft(value);
  }, []);
  const pasteIntoCommentComposer = useCallback((event: ClipboardEvent<HTMLTextAreaElement>) => {
    const commentId = draftCommentId
      || currentCommentSessionSnapshot().composerCommentId;
    if (commentId) pasteImages(event, { kind: "composer", commentId });
  }, [currentCommentSessionSnapshot, draftCommentId, pasteImages]);
  const commentRailContext: CommentRailContainerContext = {
    reviewStageRef,
    canvasMode,
    viewMode,
    expectedCommentLayoutSourceSha256,
    activePageViewGeneration: activePageViewContext?.generation ?? 0,
    visibleCommentItems,
    activeCommentCount,
    changeEvents,
    interactionLocked,
    unfinishedEditedComment,
    unsafeRelinkCommentItems,
    projectLoadError,
    otherTabCommentsContextKey,
    attachmentObjectUrls,
  };
  const commentRailActions = useMemo<CommentRailHostActions>(() => ({
    openGlobalCommentComposer,
    resumeCurrentComposer,
    resumeCommentEdit,
    focusCommentTarget,
    startUnsafeTargetRelink,
    cancelTargetRelink,
    onRetryProjectHydration: retryProjectHydrationFromCommentRail,
    closeCommentComposer,
    beginTargetRelink,
    updateDraft: updateCommentDraftFromRail,
    onComposerPaste: pasteIntoCommentComposer,
    commit: addComment,
    ensureAttachmentObjectUrl,
    openAttachmentPreview,
    downloadAttachment,
    removeComposerAttachment,
    discardCurrentComposer,
    openAttachmentPicker,
    commentTargetIsLocatable,
    updateCommentEditDraft,
    cancelCommentEdit,
    confirmEdit: confirmCommentEdit,
    pasteImages,
    removeCommentAttachment,
    queueReviewCommentFocus,
    deleteComment,
    beginEdit: beginCommentEdit,
    uploadAttachments,
  }), [
    addComment,
    beginCommentEdit,
    beginTargetRelink,
    cancelCommentEdit,
    cancelTargetRelink,
    closeCommentComposer,
    commentTargetIsLocatable,
    confirmCommentEdit,
    deleteComment,
    discardCurrentComposer,
    downloadAttachment,
    ensureAttachmentObjectUrl,
    focusCommentTarget,
    openAttachmentPicker,
    openAttachmentPreview,
    openGlobalCommentComposer,
    pasteImages,
    pasteIntoCommentComposer,
    queueReviewCommentFocus,
    removeCommentAttachment,
    removeComposerAttachment,
    resumeCommentEdit,
    resumeCurrentComposer,
    retryProjectHydrationFromCommentRail,
    startUnsafeTargetRelink,
    updateCommentDraftFromRail,
    updateCommentEditDraft,
    uploadAttachments,
  ]);
  const projectPanelCapability = workspaceController
    ? workspaceController.projects as ProjectPanelCapability
    : null;
  const projectCatalogCapability = workspaceController
    ? workspaceController.projectCatalog as ProjectCatalogCapability
    : null;
  const projectPanelContext = useMemo<ProjectPanelContext>(() => ({
    projectName,
    browserPreviewOnly,
    saveStatusLabel,
    persistState,
    runInProgress,
    projectRecordsPreparing,
    projectRecordsError,
    projectHydrating,
    projectLoadError,
    workspaceIssue,
    viewTransitioning,
    canShowCurrentFileInFolder,
    attachmentObjectUrls,
  }), [
    attachmentObjectUrls,
    browserPreviewOnly,
    canShowCurrentFileInFolder,
    persistState,
    projectHydrating,
    projectLoadError,
    projectName,
    projectRecordsError,
    projectRecordsPreparing,
    runInProgress,
    saveStatusLabel,
    viewTransitioning,
    workspaceIssue,
  ]);
  const projectPanelActions = useMemo<ProjectPanelHostActions>(() => ({
    onShowInFolder: showProjectInFolder,
    onExport: exportCurrentHtml,
    onClose: () => setDrawer(null),
    prepareProjectRecords,
    ensureAttachmentObjectUrl,
    openAttachmentPreview,
    downloadAttachment,
    viewHistoryVersion,
    onRulesViewed: () => captureUsageEvent(
      "module_viewed",
      { module: "project_rules" },
      projectId || undefined,
    ),
  }), [
    downloadAttachment,
    ensureAttachmentObjectUrl,
    exportCurrentHtml,
    openAttachmentPreview,
    prepareProjectRecords,
    projectId,
    showProjectInFolder,
    viewHistoryVersion,
  ]);

  return (
    <>
      <RendererStartupPerformance />
      <ReviewAnalysisPrewarm
        session={reviewAnalysisSession}
        controller={workspaceController}
        activeRun={activeRun} projectId={projectId} documentId={documentId}
        sourceSha256={sourceSha256} editRevision={editRevision}
        lastPersistedRevision={lastPersistedRevision} persistState={persistState}
        html={html} comments={comments} projectHydrating={projectHydrating}
        projectLoadError={projectLoadError}
      />
      <main
        className="workbench"
        data-start-page={startPageActive ? "true" : undefined}
        data-left-sidebar={globalSidebarOpen ? "open" : "collapsed"}
        data-round-state={runInProgress ? "processing" : viewMode}
        data-canvas-mode={canvasMode}
        data-handoff-preview={runInProgress && handoffPreviewOpen ? "true" : undefined}
        data-project-state={
          projectLoadError
            ? "failed"
            : projectHydrating
              ? "hydrating"
              : sourcePath
                ? "ready"
                : "unbound"
        }
        aria-label="HTML AI 可视化编辑工作台"
      >
      {navigationCapability ? <WorkbenchTabBarContainer
        capability={navigationCapability}
        sidebarOpen={globalSidebarOpen}
        onToggleSidebar={() => {
          setGlobalSidebarOpen(true);
          void projectCatalogCapability?.commands.refreshRecents();
          void projectCatalogCapability?.commands.refreshRegistered();
        }}
        onBeforeSelect={rememberWorkbenchTabPresentation}
        onOutcome={presentWorkbenchTabOutcome}
      /> : null}
      {!startPageActive ? <WorkbenchHeaderShell>
        <WorkbenchFileHeaderView
          currentSourceFileName={currentSourceFileName}
          canOpenCurrentHtmlInDefaultBrowser={canOpenCurrentHtmlInDefaultBrowser}
          persistState={persistState}
          editRevision={editRevision}
          lastPersistedRevision={lastPersistedRevision}
          headerStatusFacts={headerStatusFacts}
          canOpenProjectRootInFolder={canOpenProjectRootInFolder}
          canShowCurrentFileInFolder={canShowCurrentFileInFolder}
          canvasGeneration={canvasGeneration}
          canvasAuthority={canvasAuthority}
          visibleCanvasAck={visibleCanvasAck}
          saveStatusLabel={saveStatusLabel}
          onOpenInDefaultBrowser={() => void openCurrentHtmlInDefaultBrowser()}
          onShowProjectRecordsInFolder={() => void showProjectRecordsInFolder()}
          onShowProjectInFolder={() => void showProjectInFolder()}
          onRetryCanvasVerification={() => {
            void workspaceController?.retryCanvasVerification({
              context: captureProjectContext() || undefined,
            });
          }}
        />

        <WorkbenchHeaderToolbar
          runInProgress={runInProgress}
          canvasMode={canvasMode}
          browserPreviewOnly={browserPreviewOnly}
          viewMode={viewMode}
          interactionLocked={interactionLocked}
          projectHydrating={projectHydrating}
          viewTransitioning={viewTransitioning}
          attachmentUploadCount={attachmentUploadCount}
          drawer={drawer}
          recentRunOutcome={recentRunOutcome}
          terminalRun={terminalRun}
          reviewActive={Boolean(readyReviewOverlay)}
          aiConversationVisible={aiConversation.visible}
          aiAssistantEntry={aiAssistantEntry}
          onSelectEdit={() => {
            if (externalSourcePreview) {
              returnToEditingFromExternalPreview();
              return;
            }
            if (canvasMode !== "preview") {
              setCanvasMode("edit");
              return;
            }
            if (previewToEditPendingRef.current) return;
            previewToEditPendingRef.current = true;
            const expectedDocumentKey = pageViewDocumentKeyRef.current;
            const captureContext = interactionPreviewRef.current
              ?.capturePageViewContext() ?? Promise.resolve(null);
            void captureContext
              .catch(() => null)
              .then((capturedContext) => {
                if (
                  pageViewDocumentKeyRef.current !== expectedDocumentKey
                  || isViewTransitioning()
                ) return;
                const nextContext = (
                  capturedContext?.documentKey === expectedDocumentKey
                ) ? capturedContext : null;
                setPageViewContext(nextContext);
                editorRef.current?.applyPageViewContext(nextContext);
                invalidateEditCanvasRenderAck();
                setCanvasMode("edit");
              })
              .finally(() => {
                previewToEditPendingRef.current = false;
              });
          }}
          onSelectPreview={() => {
            if (!browserPreviewOnly && interactionLocked) return;
            if (browserPreviewOnly) {
              setCanvasMode("preview");
              return;
            }
            const enterPreview = () => {
              const committed = editorRef.current?.fencePendingEdit({
                resumeEditing: false,
                trigger: "manual",
              });
              if (!committed || !committed.ok) {
                editorRef.current?.showCommitBlocked(
                  committed?.reason || "请点回文字完成输入，再进入预览。",
                );
                return;
              }
              editorRef.current?.clearSelection();
              setPageViewContext(null);
              editorRef.current?.applyPageViewContext(null);
              commentCanvasPort.setSelection(null);
              updateFocusedComment(null);
              setCanvasMode("preview");
            };
            if (deferEditorCommand("project-switch", enterPreview)) return;
            enterPreview();
          }}
          onToggleProjectPanel={() => {
            const openProjectPanel = () => {
              setDrawer((current) => (
                current === "files" ? null : "files"
              ));
            };
            if (deferEditorCommand("project-files", openProjectPanel)) return;
            openProjectPanel();
          }}
          reopenRecentRunOutcome={reopenRecentRunOutcome}
        />
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".html,.htm,text/html"
          onChange={(event) => void handleBrowserFile(event)}
        />
      </WorkbenchHeaderShell> : null}

      {startupIssue ? (
        <section className="startup-issue" role="alert">
          <div>
            <strong>{startupIssue.title}</strong>
            <span>{startupIssue.message}</span>
          </div>
          <button type="button" onClick={() => void openProject()}>
            选择其他 HTML
          </button>
          <button type="button" onClick={() => setStartupIssue(null)}>
            暂时关闭
          </button>
        </section>
      ) : null}

      {workspaceIssue ? (
        <section className="source-conflict-banner workspace-unavailable-banner" role="alert">
          <div>
            <strong>{workspaceIssue.title}</strong>
            <span>{workspaceIssue.message}</span>
          </div>
          <button type="button" onClick={() => void exportCurrentHtml()}>
            导出当前编辑
          </button>
          <button type="button" onClick={() => void relaunchApp()}>
            重新打开源页
          </button>
        </section>
      ) : null}

      {!workspaceIssue
      && !externalSourcePreview
      && (persistState === "conflict" || persistState === "failed") ? (
        <section className="source-conflict-banner" role="alert">
          <div>
            <strong>{persistState === "conflict" ? "源文件在磁盘上被其他程序修改了" : "当前修改还没有写入文件"}</strong>
            <span>{persistState === "conflict"
              ? (persistError || "您的编辑内容仍在，可先预览外部版本再决定。")
              : (persistError || "工作台保留了当前编辑内容，不会假装已经更新。")}</span>
          </div>
          <button type="button" onClick={() => void exportCurrentHtml()}>导出当前编辑</button>
          {persistState === "conflict" ? (
            <button type="button" onClick={() => void previewExternalSource()}>
              预览外部版本
            </button>
          ) : null}
          {persistState === "conflict" ? (
            <button
              type="button"
              className="destructive-action"
              onClick={() => {
                void forceUnlockCurrentSource();
              }}
            >
              采用磁盘版本
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                requestUserFlush();
              }}
            >重试更新文件</button>
          )}
        </section>
      ) : null}

      {!workspaceIssue
      && persistState !== "conflict"
      && persistState !== "failed"
      && draftPersistError ? (
        <section className="source-conflict-banner" role="alert">
          <div>
            <strong>评论还没有安全记录</strong>
            <span>{productErrorMessage(
              draftPersistError,
              "本轮评论暂时无法记录；当前内容仍保留在页面中。",
            )}</span>
          </div>
          <button type="button" onClick={() => void workspaceController?.flushDraft()}>
            重试记录评论
          </button>
        </section>
      ) : null}

      {externalSourcePreview ? (
        <PreviewNavigationBanner
          key={`external-${externalSourcePreview.sourceSha256}`}
          icon={<EyeIcon aria-hidden="true" size={18} weight="duotone" />}
          title="正在预览外部版本"
          detail="这是磁盘上被其他程序改过的源 HTML，尚未替换您的编辑。"
          secondaryActionLabel="接受此版本（丢弃我的编辑）"
          onSecondaryAction={() => {
            void acceptExternalSourceFromPreview();
          }}
          actionLabel="返回我的编辑"
          onAction={returnToEditingFromExternalPreview}
        />
      ) : runInProgress && handoffPreviewOpen ? (
        <PreviewNavigationBanner
          key={`handoff-${activeRun?.requestId || "pending"}-${activeRun?.attemptId || "pending"}`}
          className="sent-preview-banner"
          icon={<EyeIcon aria-hidden="true" size={18} weight="duotone" />}
          title="正在预览已发送 HTML"
          detail={currentAgentDeliveryMode === "managed-agent"
            ? agentPresentation.frozenPreviewDetail
            : currentAgentDeliveryMode === "clipboard"
              ? "这是本轮冻结并复制给 AI Agent 的只读内容"
              : "这是本轮冻结的 Agent 只读内容"}
          actionLabel="返回等待处理"
          onAction={() => {
            setHandoffPreviewOpen(false);
            setCanvasMode("preview");
            revealAiConversation();
          }}
        />
      ) : viewMode === "history" ? (
        <PreviewNavigationBanner
          key={`history-${viewingVersionId || "unknown"}`}
          icon={<ClockCounterClockwiseIcon aria-hidden="true" size={18} weight="duotone" />}
          title={<>正在浏览 {viewingVersion?.label || viewingVersionId}</>}
          detail={viewingVersion
            ? `只读 HTML 与 ${viewingVersion.comments.length} 条历史评论已在画布中展开`
            : "画布来自精确不可变版本文件"}
          secondaryActionLabel="基于此版本继续编辑"
          secondaryActionDisabled={
            viewTransitioning
            || runInProgress
            || projectHydrating
            || Boolean(projectLoadError)
          }
          onSecondaryAction={() => void continueEditingHistoryVersion()}
          actionLabel="回到当前版本"
          actionDisabled={viewTransitioning}
          onAction={() => void returnToCurrent()}
        />
      ) : null}

      {projectCatalogCapability ? <WorkbenchGlobalSidebarContainer
        capability={projectCatalogCapability}
        open={globalSidebarOpen}
        onToggle={() => {
          setGlobalSidebarOpen((open) => !open);
        }}
        onOpenLocal={() => void openProject()}
        onOpenRecent={(recentSourcePath) => void openProject(recentSourcePath)}
        onOpenRegistered={openRegisteredWorkbenchProject}
        onOpenCurrentProject={() => setDrawer("files")}
        updateActionVisible={updateActionVisible}
        updateDownloaded={updateDownloaded}
        updateDownloading={updateDownloading}
        updateResult={updateResult}
        updateBadgeLabel={updateBadgeLabel}
        onOpenAbout={openAboutPageRoot}
        onDownloadOrRestartUpdate={() => {
          if (updateDownloaded) {
            setRestartUpdateOpen(true);
          } else if (updateResult?.status === "available") {
            void downloadAvailableUpdate();
          }
        }}
      /> : null}
      <WorkbenchDocumentSurfaceCache
        snapshot={documentSurfaceCacheSnapshot} visibleTabId={visibleCachedSurface?.tabId || null}
        onVisibleReady={retainPresentedTab} onHandoffComplete={completeHandoff}
        onVisibleScroll={updateVisibleScroll}
        onFirstScroll={markFirstScroll}
        height="var(--comment-canvas-height, 760px)"
      />
      {startPageActive && projectCatalogCapability ? (
        <WorkbenchStartPageContainer
          capability={projectCatalogCapability}
          activeTabId={activeWorkbenchTab.tabId}
          onOpenLocal={() => void openProject()}
          onOpenRecent={(recentSourcePath) => void openProject(recentSourcePath)}
          onOpenSidebar={() => {
            setGlobalSidebarOpen(true);
          }}
        />
      ) : (
      <div
        id="workbench-content-outlet"
        role="tabpanel"
        aria-labelledby={`workbench-tab-${activeWorkbenchTab.tabId}`}
        ref={reviewStageRef}
        className="review-scroll-stage"
        data-review-active={readyReviewOverlay ? "true" : undefined}
      >
        {readyReviewOverlay}
        <section
          className="canvas-column"
          aria-label="页面画布"
          inert={readyReviewOverlay ? true : undefined}
          aria-hidden={readyReviewOverlay ? true : undefined}
        >
          <div
            className="canvas-edit-surface"
            hidden={canvasMode !== "edit"}
            aria-hidden={canvasMode !== "edit" || Boolean(visibleCachedSurface)}
            inert={visibleCachedSurface ? true : undefined}
          >
            {!runtimeCapabilitiesReady ? (
              <div className="canvas-loading" role="status">正在识别运行环境…</div>
            ) : !browserPreviewOnly ? (
              editRuntimePreparing ? (
                <HtmlDisplaySurface
                  html={html}
                  sourcePath={canvasSourcePath}
                  height="var(--comment-canvas-height, 760px)"
                />
              ) : (
                <HtmlCanvasEditor
                  key={`editor-authority-${canvasGeneration}`}
                  ref={editorRef}
                  html={html}
                  sourcePath={canvasSourcePath}
                  height="var(--comment-canvas-height, 760px)"
                  onChange={handleCanvasChange}
                  onInteraction={() => {
                    workspaceControllerRef.current?.deferDocumentSurfacePrewarm();
                    if (commentCanvasPort.getSnapshot().relinkingTarget) {
                      commentCanvasPort.armRelinkSelection();
                    }
                  }}
                  editRuntimeGrant={editRuntimeGrant}
                  onEditRuntimeLoadStart={(grant) => {
                    workspaceControllerRef.current?.beginEditAuthorRuntime({
                      sessionId: grant.sessionId,
                      sourceSha256: grant.sourceSha256,
                      canvasGeneration: grant.canvasGeneration,
                    });
                  }}
                  onEditRuntimeLoadOutcome={(grant, outcome: HtmlCanvasEditRuntimeLoadOutcome) => {
                    workspaceControllerRef.current?.settleEditAuthorRuntime({
                      sessionId: grant.sessionId,
                      sourceSha256: grant.sourceSha256,
                      canvasGeneration: grant.canvasGeneration,
                      outcome,
                    });
                  }}
                  onCommentLayout={commentCanvasPort.publishLayout}
                  onSelect={handleCanvasSelection}
                  onRequestComment={openCommentComposer}
                  onRequestFlush={requestUserFlush}
                  onRequestExport={() => {
                    void exportCurrentHtml();
                  }}
                  onRequestHistory={(direction) => {
                    void requestSourceHistoryAction(direction);
                  }}
                  onRequestReload={() => {
                    if (currentProjectSessionSnapshot().sourcePath) {
                      void reloadCurrentSource();
                    } else {
                      void openProject();
                    }
                  }}
                  reloadActionLabel={sourcePath ? "重新载入" : "重新选择"}
                  usageProjectId={projectId || undefined}
                  usageCapture={captureUsageEvent}
                  commentedTargets={commentedTargets}
                  trackedTargets={trackedAuditTargets}
                  pageViewContext={activePageViewContext}
                  pageViewDocumentKey={pageViewDocumentKey}
                  onPageViewContextChange={acceptPageViewContext}
                  initialScrollTop={visibleCachedSurface?.scrollTop}
                  locked={
                    runInProgress
                    || projectHydrating
                    || Boolean(projectLoadError)
                    || viewTransitioning
                    || persistState === "conflict"
                  }
                  readOnly={viewMode === "history"}
                  interactionMode={viewMode === "history"
                    ? "history"
                    : runInProgress || projectHydrating || workspaceIssue
                      ? "processing"
                      : "editing"}
                  enableReorder={!interactionLocked}
                  pointerCapabilityHoverEnabled={!isBuiltInWelcomePage}
                />
              )
            ) : null}
          </div>
          {canvasMode === "preview" ? (
            <HtmlInteractionPreview
              key={`preview-authority-${canvasGeneration}`}
              ref={interactionPreviewRef}
              html={interactionPreviewHtml}
              documentKey={pageViewDocumentKey}
              sourcePath={sourcePath || undefined}
              height="100%"
              comments={comments}
              transport={interactivePreviewTransport}
              onInteraction={() => workspaceControllerRef.current?.deferDocumentSurfacePrewarm()}
              onReady={handlePreviewReady}
              presentationCovered={Boolean(visibleCachedSurface)}
              initialScrollTop={visibleCachedSurface?.scrollTop}
              onScrollTopChange={(scrollTop) => {
                if (activeWorkbenchTab.kind === "document") {
                  updateVisibleScroll(activeWorkbenchTab.tabId, scrollTop);
                }
              }}
            />
          ) : null}
        </section>

        {aiConversation.visible && !readyReviewOverlay && runCapability ? (
          <aside className="ai-conversation-aside" aria-label="AI 助手侧栏">
            <RunConversationOutlet
              capability={runCapability}
              sidebarProps={{
                ...aiConversation.sidebarProps,
                onAction: handleAiDecision,
              }}
              reviewing={false}
              deliveryMode={currentAgentDeliveryMode}
            />
          </aside>
        ) : null}

        {canvasMode === "edit" && workspaceController ? (
          <CommentRailContainer
            capability={workspaceController.comments as CommentRailCapability}
            canvasPort={commentCanvasPort}
            context={commentRailContext}
            actions={commentRailActions}
          />
        ) : null}
      </div>
      )}

      {previewAttachment && attachmentObjectUrls[previewAttachment.attachmentId] ? (
        <AttachmentLightbox
          fileName={previewAttachment.fileName}
          sizeLabel={formatFileSize(previewAttachment.byteLength)}
          src={attachmentObjectUrls[previewAttachment.attachmentId]}
          onClose={() => setPreviewAttachment(null)}
        />
      ) : null}

      <div
        className={`drawer-overlay${drawer ? " show" : ""}`}
        data-drawer={drawer || undefined}
        aria-hidden="true"
        onClick={() => setDrawer(null)}
      />
      <aside
        className={`side-drawer${drawer ? " open" : ""}`}
        data-drawer={drawer || undefined}
        inert={!drawer}
        role="dialog"
        aria-label="当前项目"
      >
        {drawer === "files" && projectPanelCapability ? (
          <ProjectPanelContainer
            capability={projectPanelCapability}
            panelPort={projectPanelPort}
            context={projectPanelContext}
            actions={projectPanelActions}
          />
        ) : null}
      </aside>

      {openConfirmation ? (
        <ExternalHtmlOpenDialog key={openConfirmation.requestId}
          confirmation={openConfirmation}
          deleteOriginal={openConfirmation.deleteOriginal === true}
          busy={openConfirmation.busy === true}
          onDeleteOriginalChange={(next) => {
            workspaceController?.setExternalOpenDeleteOriginal({
              requestId: openConfirmation.requestId,
              deleteOriginal: next,
            });
          }}
          onCancel={() => {
            void workspaceController?.cancelExternalOpen({
              requestId: openConfirmation.requestId,
            });
          }}
          onConfirm={(action) => {
            void workspaceController?.confirmExternalOpen({
              requestId: openConfirmation.requestId,
              action,
              deleteOriginal: openConfirmation.deleteOriginal === true,
            });
          }}
        />
      ) : null}

      <CancelAiRunDialog
        open={cancelRunConfirmationOpen}
        onClose={() => setCancelRunConfirmationKey(null)}
        onConfirm={() => {
          const currentRun = currentRunSessionSnapshot().activeRun;
          const matchesConfirmation = Boolean(
            currentRun
            && cancelRunConfirmationKey
            && activeRunOperationKey(currentRun) === cancelRunConfirmationKey,
          );
          setCancelRunConfirmationKey(null);
          if (matchesConfirmation) {
            void cancelActiveRun({ agentMayBeRunning: true });
          }
        }}
      />

      <RestartUpdateDialog
        open={restartUpdateOpen && updateDownloaded}
        installing={updateResult?.status === "installing"}
        onClose={() => setRestartUpdateOpen(false)}
        onRestartNow={() => {
          setRestartUpdateOpen(false);
          void installDownloadedUpdate();
        }}
      />

      <AboutPageRootDialog
        open={aboutOpen}
        appVersion={applicationVersion}
        updateResult={updateResult}
        updatesAvailable={desktopUpdatesAvailable}
        manualCheckPending={manualUpdateCheckPending}
        manualCheckFailed={manualUpdateCheckFailed}
        repositoryOpenFailed={repositoryOpenFailed}
        releaseNotesOpenFailed={releaseNotesOpenFailed}
        userNoticeOpenFailed={userNoticeOpenFailed}
        qoderAvailability={aboutQoderAvailability}
        source={aboutOpenSource}
        onClose={closeAboutPageRoot}
        onCheckForUpdates={() => void checkForApplicationUpdates()}
        onDownloadUpdate={() => void downloadAvailableUpdate()}
        onRequestRestart={() => {
          setAboutOpen(false);
          setRestartUpdateOpen(true);
        }}
        onOpenReleaseNotes={() => void openReleaseNotes()}
        onOpenRepository={() => void openProjectRepository()}
        onOpenUserNotice={() => void openUserNotice()}
        onCheckQoderUsability={checkQoderUsability}
        onCopyQoderGuidance={copyQoderGuidance}
      />

      {toast ? (
        <NoticeBar
          className="toast"
          title={toast.title}
          message={toast.message}
          tone={toast.tone}
          actionLabel={toast.action?.label}
          dismissMs={noticeAutoDismissMs(toast)}
          paused={noticeTimerPaused}
          repeatCount={toast.repeatCount || 1}
          onAction={toast.action ? (() => {
            const action = toast.action;
            if (action) handleToastAction(action);
          }) : undefined}
          onDismiss={() => setToast(null)}
          usageCode={noticeUsageCode(toast.dedupeKey)}
          usageDisposition={toast.disposition || "inform-in-place"}
          usageSurface="global"
          usageProjectId={projectId || undefined}
          usageCapture={captureUsageEvent}
          onPauseChange={(paused) => {
            setPausedNoticeIdentity(paused ? noticeIdentity : null);
          }}
        />
      ) : null}
      </main>
      <FirstEditGuideCard
        visible={firstEditGuideVisible}
        onDismiss={() => {
          void workspaceControllerRef.current?.dismissFirstEditGuide();
        }}
      />
    </>
  );
}
