"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
  type SetStateAction,
} from "react";
import { ArrowSquareOutIcon } from "@phosphor-icons/react/dist/csr/ArrowSquareOut";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/csr/ChatCircleText";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { TriangleIcon } from "@phosphor-icons/react/dist/csr/Triangle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import type {
  HtmlCanvasCommentLayoutState,
  HtmlCanvasEditorHandle,
  HtmlCanvasMutation,
  HtmlCanvasSelection,
  HtmlCanvasSourceTransaction,
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
} from "./components/HtmlCanvasEditor";
import AboutPageRootDialog from "./components/AboutPageRootDialog";
import CancelAiRunDialog from "./components/CancelAiRunDialog";
import HtmlInteractionPreview, {
  type HtmlInteractionPreviewHandle,
} from "./components/HtmlInteractionPreview";
import NoticeBar from "./components/NoticeBar";
import RestartUpdateDialog from "./components/RestartUpdateDialog";
import {
  MAX_ATTACHMENT_BYTES,
  MAX_COMMENT_ATTACHMENTS,
  planAttachmentSelection,
} from "./lib/attachment-selection.js";
import {
  commentMarkerGroupKey,
  COMMENT_VIRTUALIZATION_THRESHOLD,
  virtualizedCommentIds,
} from "./lib/comment-virtualization.js";
import {
  computeAlignedRailOffset,
  computeCommentRailMinimumOffset,
  layoutCommentRailItems,
  routeCommentRailWheel,
  shouldSubmitCommentOnEnter,
  stabilizeCommentTargetLayouts,
} from "./lib/comment-rail-layout.js";
import {
  auditEventKey,
  removeAcknowledgedAuditEvents,
} from "./lib/audit-events";
import { appendDirectEditEvent } from "./lib/direct-edit-events.js";
import {
  noticeAutoDismissMs,
  productErrorMessage,
  shouldPresentNotice,
  shouldReplaceNotice,
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
  createRuntimeBridgeClient,
  isBridgeRequestError,
} from "./application/bridge-client.js";
import {
  WorkspaceController,
  registrationContextFromOutcome,
} from "./application/workspace-controller.js";
import { createWorkspaceControllerCodecs } from "./application/workspace-controller-codecs.js";
import {
  CommentSession,
  type CommentSessionSnapshot,
} from "./application/comment-session.js";
import {
  DraftSession,
  type DraftSessionEvent,
} from "./application/draft-session.js";
import {
  DocumentSession,
  type DocumentSessionSnapshot,
} from "./application/document-session.js";
import { DrainCoordinator } from "./application/drain-coordinator.js";
import { runLocalUserAction } from "./application/local-action-outcomes.js";
import {
  ExternalFileOpenSession,
  type ExternalFileOpenRequest,
  type ExternalFileOpenSnapshot,
} from "./application/external-file-open-session.js";
import {
  ProjectApplicationSession,
  type ProjectApplication,
  type ProjectApplicationSnapshot,
} from "./application/project-application-session.js";
import {
  ReviewAnalysisCancelledError,
  ReviewAnalysisSession,
} from "./application/review-analysis-session.js";
import type { PageViewContext } from "./lib/page-view-context.js";
import {
  ProjectRulesSession,
  type ProjectRulesSnapshot,
} from "./application/project-rules-session.js";
import {
  ProjectSession,
  type ProjectSessionSnapshot,
} from "./application/project-session.js";
import {
  RunSession,
  type RunOperationKind,
  type RunSessionSnapshot,
} from "./application/run-session.js";
import { createBrowserRecoveryStore } from "./application/recovery-store.js";
import { SourceHistorySession } from "./application/source-history-session.js";
import {
  VersionSession,
  type VersionSessionSnapshot,
} from "./application/version-session.js";
import type { SourceHistoryDirection } from "./domain/source-history.js";
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
  createDraftOperationId,
  isDraftOperationId,
  rebaseDraftMutation,
} from "./domain/draft-aggregate.js";
import {
  activeRunFromRecord,
  candidateAssessmentFromRecord,
  canonicalLifecycleState,
  deriveRunProgressSteps,
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
  unsafeCommentTargetsNotice,
} from "./workbench/comment-model";
import {
  CommentAttachmentStrip,
  HistoryVersionItem,
  PreviewNavigationBanner,
} from "./workbench/presentation";
import {
  HandoffDrawerHeader,
  HandoffFooter,
  HandoffPanel,
} from "./workbench/handoff-view";
import AiReviewWorkspace from "./workbench/AiReviewWorkspace";
import {
  buildReviewDocumentsAsync,
  type ReviewDocuments,
} from "./workbench/review-document";
import {
  WorkbenchHeaderActions,
  WorkbenchHeaderShell,
} from "./workbench/workbench-header-shell";
import {
  activeRunOperationKey,
  fileExtension,
  fileStem,
  folderFromSourcePath,
  formatProjectTimestamp,
  formatTime,
  localFileNameFromSourcePath,
  projectMarkdown,
  safeVersionLabel,
  sameLocalSourcePath,
  sourceRenameOperationId,
  workspaceFileLabel,
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
  BackgroundProjectResult,
  CanvasMode,
  CloseAbortedDetail,
  CloseLifecycle,
  CloseReadiness,
  CommentAttachment,
  CommentEditSession,
  CommentItem,
  DirectEditEvent,
  DesktopProjectsApi,
  Drawer,
  HtmlProject,
  OtherTabCommentEntry,
  PendingDraft,
  PendingWrite,
  PersistState,
  PrepareCloseDetail,
  ProjectContext,
  ProjectQoderHandoffState,
  QoderHandoffUiStatus,
  RecentProject,
  RecoveryIdentity,
  StartupIssue,
  Toast,
  ToastAction,
  Version,
  WorkspaceFileView,
  WorkspaceIssue,
} from "./workbench/types";

const HtmlCanvasEditor = lazy(() => import("./components/HtmlCanvasEditor"));
const BROWSER_PREVIEW_LOGO_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%236550e8'/%3E%3Cstop offset='1' stop-color='%23d45df2'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='15' fill='url(%23g)'/%3E%3Cpath d='M23 23 13 32l10 9M41 23l10 9-10 9M36 16 28 48' fill='none' stroke='white' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";
const PROJECT_REPOSITORY_URL = "https://github.com/Charleyli925/PageRoot";

class DeferredEditorCommandDiscardedError extends Error {
  readonly reason: NativeDeferredCommandDiscardReason;

  constructor(reason: NativeDeferredCommandDiscardReason) {
    super(`Deferred editor command discarded: ${reason}`);
    this.name = "DeferredEditorCommandDiscardedError";
    this.reason = reason;
  }
}

function isDeferredEditorCommandDiscardedError(
  value: unknown,
): value is DeferredEditorCommandDiscardedError {
  return value instanceof DeferredEditorCommandDiscardedError;
}

type CanvasRenderAck = Readonly<{
  generation: number;
  sha256: string;
}>;

type CanvasRenderAcks = Readonly<Record<CanvasMode, CanvasRenderAck | null>>;

type PreparedGeneratedSourceTransition = Readonly<{
  previousSourcePath: string;
  nextSourcePath: string;
  projectId: string;
  documentId: string;
  updatesCurrentProject: boolean;
  activatedProject: HtmlProject | null;
}>;

type ProjectSwitchOptions = Readonly<{
  retrySourcePath?: string;
  onDeferred?: () => void;
}>;

type AcceptedProjectApplication = Readonly<{
  project: HtmlProject;
  onFailure: (cause: unknown) => void;
}>;

const AUTOSAVE_DELAY_MS = 700;
const bridgeClient = createRuntimeBridgeClient();
const recoveryStore = createBrowserRecoveryStore();
const PROJECT_RULES_AUTOSAVE_DELAY_MS = 700;
const INITIAL_PROJECT_RULES_SNAPSHOT: ProjectRulesSnapshot = {
  open: false,
  path: "PROJECT.md",
  content: "",
  savedContent: "",
  loading: false,
  error: "",
  saving: false,
  saveError: "",
  compositionActive: false,
  editorGeneration: 0,
};
const INITIAL_RUN_SNAPSHOT: RunSessionSnapshot = {
  activeSourcePath: null,
  activeRun: null,
  activeHandoff: null,
  activeHandoffMayBeRunning: false,
  activeSubmission: null,
  submissionPending: false,
  activeLocked: false,
  operationKeys: [],
  recentOutcome: null,
  backgroundResults: [],
};
const INITIAL_EXTERNAL_FILE_OPEN_SNAPSHOT: ExternalFileOpenSnapshot = {
  status: "idle",
  activeRequestId: null,
  queuedRequestId: null,
  deferredRequestId: null,
  deferredSequence: 0,
};
const INITIAL_PROJECT_APPLICATION_SNAPSHOT: ProjectApplicationSnapshot = {
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
  editRevision: 0,
  lastPersistedRevision: 0,
  persistState: "idle",
  persistError: "",
};
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
  beforeLabel: string;
  afterLabel: string;
};

type PreparedReviewDocuments = {
  operationKey: string;
  beforeHtml: string;
  afterHtml: string;
  sourcePath: string;
  commentsKey: string;
  sessionId: string;
  documents: ReviewDocuments;
};

function preparedReviewByteSize(prepared: PreparedReviewDocuments): number {
  return 2 * (
    prepared.beforeHtml.length
    + prepared.afterHtml.length
    + prepared.commentsKey.length
    + prepared.documents.before.length
    + prepared.documents.after.length
    + prepared.documents.bootstrapJavaScript.before.length
    + prepared.documents.bootstrapJavaScript.after.length
    + prepared.documents.bootstrapFallbackJavaScript.before.length
    + prepared.documents.bootstrapFallbackJavaScript.after.length
    + JSON.stringify(prepared.documents.commentTargets).length
  );
}

function waitFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

async function waitUntilResolved(predicate: () => boolean): Promise<void> {
  while (!predicate()) await waitFor(40);
}

function commentMeasurementKey(
  itemKey: string,
  layoutState: unknown,
): string {
  const text = JSON.stringify(layoutState);
  let hash = 2_166_136_261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `${itemKey}::${text.length}-${(hash >>> 0).toString(36)}`;
}

function markProjectHydrationStage(stage: string): void {
  if (typeof window === "undefined") return;
  window.__PAGEROOT_HYDRATION_STAGE__ = stage;
}

const WELCOME_PROJECT = {
  name: WELCOME_PROJECT_NAME,
  sourcePath: null as string | null,
};

function noticeReducer(current: Toast, next: Toast): Toast {
  if (!shouldPresentNotice(next)) return current;
  return shouldReplaceNotice(current, next) ? next : current;
}

export default function Workbench() {
  const editorRef = useRef<HtmlCanvasEditorHandle>(null);
  const interactionPreviewRef = useRef<HtmlInteractionPreviewHandle>(null);
  const previewToEditPendingRef = useRef(false);
  const pageViewDocumentKeyRef = useRef("");
  const deferredEditorReplayRef = useRef<{
    refreshWorkspace?: (
      sourceOverride: string | null | undefined,
      epochOverride: number | undefined,
      sourceTransitionToken: number | undefined,
      resolve: () => void,
    ) => void;
    prepareProjectSwitch?: (
      resolve: (value: boolean) => void,
      options?: ProjectSwitchOptions,
    ) => void;
    exportCurrentHtml?: () => void;
    reloadCurrentSource?: () => void;
    requestUserFlush?: () => void;
    requestSourceHistoryAction?: (
      direction: SourceHistoryDirection,
    ) => Promise<boolean>;
    generateRequest?: () => void;
    openCommittedVersion?: (
      run: ActiveRun,
      payload: Record<string, unknown>,
      resolve: () => void,
      reject: (reason: unknown) => void,
    ) => void;
    viewHistoryVersion?: (version: Version) => void;
    returnToCurrent?: () => void;
  }>({});
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
    return { ok: true as const, html: frozen.html };
  }, []);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const attachmentInputTargetRef = useRef<{
    kind: "composer" | "comment";
    commentId: string;
  } | null>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const composerFocusPendingRef = useRef(false);
  const commentEditRef = useRef<HTMLTextAreaElement>(null);
  const commentsPanelRef = useRef<HTMLElement>(null);
  const commentsHeaderRef = useRef<HTMLElement>(null);
  const reviewStageRef = useRef<HTMLDivElement>(null);
  const commentCounter = useRef(1);
  const changeCounter = useRef(1);
  const attachmentCounter = useRef(1);
  const focusedCommentIdRef = useRef<string | null>(null);
  const commentEditResumePendingRef = useRef<string | null>(null);
  const commentRailOffsetRef = useRef(0);
  const commentRailMinimumOffsetRef = useRef(0);
  const reviewRevealRequestRef = useRef(0);
  const reviewRevealPendingRef = useRef<{
    target: HtmlCanvasSelection;
    itemKey: string;
  } | null>(null);
  const pagePresentationScrollRequestRef = useRef(0);
  const projectOpenRequestRef = useRef(0);
  const reviewAnalysisSessionRef = useRef(
    new ReviewAnalysisSession<PreparedReviewDocuments>({
      estimateSize: preparedReviewByteSize,
    }),
  );
  const reviewSessionSequenceRef = useRef(0);
  const projectSessionRef = useRef(new ProjectSession());
  const drainCoordinatorRef = useRef(new DrainCoordinator());
  const externalFileOpenSessionRef = useRef(new ExternalFileOpenSession());
  const projectApplicationSessionRef =
    useRef(new ProjectApplicationSession<AcceptedProjectApplication>());
  const projectApplicationCounterRef = useRef(0);
  const runtimeCapabilitiesRef =
    useRef<RuntimeCapabilities>(BROWSER_RUNTIME_CAPABILITIES);
  const draftSessionRef = useRef(new DraftSession<CommentItem, DirectEditEvent>({
    bridgeClient,
    encodeComment: persistedComment,
    encodeChangeEvent: persistedChangeEvent,
  }));
  const sourceHistorySessionRef = useRef(new SourceHistorySession());
  const versionSessionRef = useRef(new VersionSession<Version>());
  const documentSessionRef = useRef(new DocumentSession<PendingWrite>({
    html: DEFAULT_PROJECT_HTML,
  }));
  const commentSessionRef = useRef(new CommentSession<
    CommentItem,
    DirectEditEvent,
    CommentAttachment,
    HtmlCanvasSelection,
    CommentEditSession
  >());
  const projectRulesSessionRef = useRef(new ProjectRulesSession({
    bridgeClient,
    errorMessage: productErrorMessage,
  }));
  const recoveryIdentityRef = useRef<RecoveryIdentity | null>(null);
  const projectHydratingRef = useRef(false);
  const projectLoadErrorRef = useRef<string | null>(null);
  const viewTransitioningRef = useRef(false);
  const navigationOperationRef = useRef(0);
  const historyActionPromiseRef = useRef<Promise<boolean> | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const auditPendingRef = useRef<DirectEditEvent[]>([]);
  const auditInFlightKeysRef = useRef<Set<string>>(new Set());
  const attachmentUploadCountRef = useRef(0);
  const attachmentObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const draftRecoverySequenceRef = useRef(0);
  const draftRecoveryOperationIdRef = useRef<string | null>(null);
  const workspaceControllerRef = useRef<WorkspaceController | null>(null);
  const runSessionRef = useRef(new RunSession({
    sourcePath: WELCOME_PROJECT.sourcePath,
  }));
  const toastRef = useRef<Toast>(null);
  const previousPersistStateRef = useRef(new Map<string, PersistState>());
  const previousRunStateRef = useRef(
    new Map<string, LifecycleState | "none">(),
  );
  const interruptionPresenceRef = useRef(new Map<string, boolean>());
  const relinkingTargetRef = useRef<string | null>(null);
  const relinkSelectionArmedRef = useRef(false);
  const resumeSubmissionAfterRelinkRef = useRef(false);
  const pendingProjectOpenRef = useRef<{
    recentPath?: string;
    requestedAt: number;
  } | null>(null);
  const closeLifecycleRef = useRef<CloseLifecycle>({
    preparingRequestId: null,
    frozenRequestId: null,
    abortedRequestIds: new Set(),
  });
  const saveProjectRulesRef = useRef<() => Promise<boolean>>(async () => false);
  const projectRulesEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRenameInputRef = useRef<HTMLInputElement | null>(null);
  const fileRenameEditingRef = useRef(false);
  const fileRenameBusyRef = useRef(false);

  const [documentSnapshot, setDocumentSnapshot] =
    useState<DocumentSessionSnapshot>(INITIAL_DOCUMENT_SNAPSHOT);
  const [externalFileOpenSnapshot, setExternalFileOpenSnapshot] =
    useState<ExternalFileOpenSnapshot>(INITIAL_EXTERNAL_FILE_OPEN_SNAPSHOT);
  const [projectApplicationSnapshot, setProjectApplicationSnapshot] =
    useState<ProjectApplicationSnapshot>(INITIAL_PROJECT_APPLICATION_SNAPSHOT);
  const html = documentSnapshot.html;
  const sourceSha256 = documentSnapshot.sourceSha256;
  const canvasGeneration = documentSnapshot.canvasGeneration;
  const editRevision = documentSnapshot.editRevision;
  const lastPersistedRevision = documentSnapshot.lastPersistedRevision;
  const persistState = documentSnapshot.persistState;
  const persistError = documentSnapshot.persistError;
  const [projectName, setProjectName] = useState(WELCOME_PROJECT.name);
  const [projectSnapshot, setProjectSnapshot] =
    useState<ProjectSessionSnapshot>(INITIAL_PROJECT_SESSION_SNAPSHOT);
  const { sourcePath, projectId, documentId } = projectSnapshot;
  const [projectRecordsPath, setProjectRecordsPath] =
    useState<string | null>(null);
  const [lastModifiedAt, setLastModifiedAt] = useState<string | null>(null);
  const [fileRenameEditing, setFileRenameEditing] = useState(false);
  const [fileRenameBusy, setFileRenameBusy] = useState(false);
  const [fileRenameDraft, setFileRenameDraft] = useState("");
  const [fileRenameError, setFileRenameError] = useState("");
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [recentProjectsError, setRecentProjectsError] = useState("");
  const [selection, setSelection] = useState<HtmlCanvasSelection | null>(null);
  const [commentSnapshot, setCommentSnapshot] = useState(
    INITIAL_COMMENT_SNAPSHOT,
  );
  const draftTarget = commentSnapshot.composerTarget;
  const draft = commentSnapshot.composerDraft;
  const draftCommentId = commentSnapshot.composerCommentId;
  const draftAttachments = commentSnapshot.composerAttachments;
  const comments = commentSnapshot.comments;
  const changeEvents = commentSnapshot.changeEvents;
  const commentEditSession = commentSnapshot.editSession;
  const [attachmentObjectUrls, setAttachmentObjectUrls] = useState<Record<string, string>>({});
  const [attachmentUploadCount, setAttachmentUploadCount] = useState(0);
  const [runSnapshot, setRunSnapshot] = useState<RunSessionSnapshot>(
    INITIAL_RUN_SNAPSHOT,
  );
  const backgroundProjectResults = useMemo(
    () => new Map<string, BackgroundProjectResult>(
      runSnapshot.backgroundResults,
    ),
    [runSnapshot.backgroundResults],
  );
  const [previewAttachment, setPreviewAttachment] = useState<CommentAttachment | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null);
  const [handoffPreviewOpen, setHandoffPreviewOpen] = useState(false);
  const [commentRailHeight, setCommentRailHeight] = useState(0);
  const [commentCardHeights, setCommentCardHeights] = useState<Record<string, number>>({});
  const [commentTargetLayouts, setCommentTargetLayouts] = useState<
    Record<string, HtmlCanvasCommentLayoutState["targets"][number]>
  >({});
  const [commentLayoutAuthority, setCommentLayoutAuthority] = useState({
    sourceSha256: "",
    viewContextGeneration: -1,
    targetIdsKey: "",
    ready: false,
    textEditing: false,
  });
  const [commentHeaderHeight, setCommentHeaderHeight] = useState(62);
  const [expandedOtherTabCommentsKey, setExpandedOtherTabCommentsKey] = useState("");
  const [commentViewport, setCommentViewport] = useState({ top: 0, height: 800 });
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [commentRailOffset, setCommentRailOffset] = useState(0);
  const [commentRailFollowsFocus, setCommentRailFollowsFocus] = useState(false);
  const [fileView, setFileView] = useState<WorkspaceFileView | null>(null);
  const [projectRulesSnapshot, setProjectRulesSnapshot] =
    useState<ProjectRulesSnapshot>(INITIAL_PROJECT_RULES_SNAPSHOT);
  const projectRulesEditorGeneration = projectRulesSnapshot.editorGeneration;
  const projectRulesCompositionActive =
    projectRulesSnapshot.compositionActive;
  const projectRulesSaving = projectRulesSnapshot.saving;
  const projectRulesSaveError = projectRulesSnapshot.saveError;
  const [projectRecordsPreparing, setProjectRecordsPreparing] = useState(false);
  const [projectRecordsError, setProjectRecordsError] = useState("");
  const [versionSnapshot, setVersionSnapshot] =
    useState<VersionSessionSnapshot<Version>>(INITIAL_VERSION_SNAPSHOT);
  const versions = versionSnapshot.versions;
  const latestVersionId = versionSnapshot.latestVersionId;
  const currentBasedOnVersionId =
    versionSnapshot.currentBasedOnVersionId;
  const restoredFromVersionId = versionSnapshot.restoredFromVersionId;
  const viewMode = versionSnapshot.viewMode;
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("edit");
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
  const invalidateCanvasRenderAcks = useCallback(() => {
    setCanvasRenderAcks({ edit: null, preview: null });
  }, []);
  if (!workspaceControllerRef.current) {
    workspaceControllerRef.current = new WorkspaceController({
      bridgeClient,
      projectSession: projectSessionRef.current,
      documentSession: documentSessionRef.current,
      commentSession: commentSessionRef.current,
      draftSession: draftSessionRef.current,
      versionSession: versionSessionRef.current,
      sourceHistorySession: sourceHistorySessionRef.current,
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
        recovery: {
          replace: (identity) => {
            recoveryIdentityRef.current = identity as RecoveryIdentity | null;
          },
        },
        canvas: { invalidateRenderAcks: invalidateCanvasRenderAcks },
      },
      clock: { now: () => Date.now() },
    });
  }
  const workspaceController = workspaceControllerRef.current;
  useEffect(() => {
    const unsubscribe = workspaceController.subscribeEvents((event) => {
      if (event.type !== "registration-published") return;
      if (!projectSessionRef.current.matches(event.context)) return;
      setProjectRecordsPath(event.projectRecordsPath);
      if (event.projectName) setProjectName(event.projectName);
    });
    return () => {
      unsubscribe();
    };
  }, [workspaceController]);
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
    if (generation !== documentSessionRef.current.canvasGeneration) return false;
    setCanvasRenderAcks((current) => ({
      ...current,
      [surface]: sha256 ? { generation, sha256 } : null,
    }));
    return true;
  }, []);
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
  const submissionPending = runSnapshot.submissionPending;
  const generating = runSnapshot.activeSubmission?.phase === "preparing";
  const activeRunOperation = activeRun ? activeRunOperationKey(activeRun) : "";
  const isActiveRunOperationBusy = (kind: RunOperationKind) => (
    runSnapshot.operationKeys.some(([operation, key]) => (
      operation === kind && key === activeRunOperation
    ))
  );
  const cancelling = isActiveRunOperationBusy("cancel");
  const resolvingConflict = isActiveRunOperationBusy("resolve");
  const pendingReconcileBusy = Boolean(
    activeRun?.requestId === "pending"
    && isActiveRunOperationBusy("poll"),
  );
  const setActiveRun = useCallback((
    next: SetStateAction<ActiveRun | null>,
  ) => {
    const session = runSessionRef.current;
    session.setActiveRun(
      typeof next === "function" ? next(session.activeRun) : next,
    );
  }, []);
  const [projectHydrating, setProjectHydrating] = useState(false);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [startupIssue, setStartupIssue] = useState<StartupIssue | null>(null);
  const [workspaceIssue, setWorkspaceIssue] = useState<WorkspaceIssue | null>(null);
  const [viewTransitioning, setViewTransitioning] = useState(false);
  const [draftPersistError, setDraftPersistError] = useState("");
  const [cancelRunConfirmationKey, setCancelRunConfirmationKey] =
    useState<string | null>(null);
  const [reviewPreparing, setReviewPreparing] = useState(false);
  const [readyReviewSession, setReadyReviewSession] =
    useState<ReadyReviewSession | null>(null);
  const [openingReadyVersion, setOpeningReadyVersion] = useState(false);
  const [relinkingTarget, setRelinkingTarget] = useState<string | null>(null);
  const [runtimeCapabilitiesReady, setRuntimeCapabilitiesReady] = useState(false);
  const [browserPreviewOnly, setBrowserPreviewOnly] = useState(false);
  const qoderHandoffState = runSnapshot.activeHandoff;
  const [updateResult, setUpdateResult] =
    useState<ApplicationUpdateResult | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [restartUpdateOpen, setRestartUpdateOpen] = useState(false);
  const [applicationVersion, setApplicationVersion] = useState("");
  const [desktopUpdatesAvailable, setDesktopUpdatesAvailable] = useState(false);
  const [manualUpdateCheckPending, setManualUpdateCheckPending] = useState(false);
  const [manualUpdateCheckFailed, setManualUpdateCheckFailed] = useState(false);
  const [repositoryOpenFailed, setRepositoryOpenFailed] = useState(false);
  const [userNoticeOpenFailed, setUserNoticeOpenFailed] = useState(false);
  const promptedUpdateVersionRef = useRef<string | null>(null);
  const [toast, setToast] = useReducer(noticeReducer, null);
  const [pausedNoticeIdentity, setPausedNoticeIdentity] =
    useState<string | null>(null);
  const noticeIdentity = toast
    ? `${toast.dedupeKey || ""}\n${toast.title}\n${toast.message}`
    : "";
  const noticeTimerPaused = Boolean(
    noticeIdentity && pausedNoticeIdentity === noticeIdentity,
  );
  useEffect(() => {
    const session = projectSessionRef.current;
    session.setObserver(setProjectSnapshot);
    setProjectSnapshot(session.snapshot);
    return () => session.setObserver(null);
  }, []);
  useEffect(() => () => reviewAnalysisSessionRef.current.dispose(), []);
  useEffect(() => {
    const session = externalFileOpenSessionRef.current;
    // Deferred external opens are owned by the session. Publishing its
    // snapshot makes the normal safe-switch retry effect react to a newly
    // deferred request even when no ordinary persistence state has changed.
    session.setObserver(setExternalFileOpenSnapshot);
    setExternalFileOpenSnapshot(session.snapshot);
    return () => session.dispose();
  }, []);
  useEffect(() => {
    const session = projectApplicationSessionRef.current;
    session.setObserver(setProjectApplicationSnapshot);
    setProjectApplicationSnapshot(session.snapshot);
    return () => session.dispose();
  }, []);
  useEffect(() => {
    const session = projectRulesSessionRef.current;
    session.setObserver((snapshot) => {
      setProjectRulesSnapshot(snapshot);
      setFileView((current) => {
        if (snapshot.open) {
          return {
            path: snapshot.path,
            content: snapshot.content,
            savedContent: snapshot.savedContent,
            loading: snapshot.loading,
            ...(snapshot.error ? { error: snapshot.error } : {}),
          };
        }
        return current?.path === "PROJECT.md" ? null : current;
      });
    });
    return () => session.setObserver(null);
  }, []);
  useEffect(() => {
    const session = runSessionRef.current;
    session.setObserver(setRunSnapshot);
    return () => session.setObserver(null);
  }, []);
  useEffect(() => {
    const session = versionSessionRef.current;
    session.setObserver(setVersionSnapshot);
    return () => session.setObserver(null);
  }, []);
  useEffect(() => {
    const session = documentSessionRef.current;
    session.setObserver(setDocumentSnapshot);
    return () => session.setObserver(null);
  }, []);
  useEffect(() => {
    const session = commentSessionRef.current;
    session.setObserver(setCommentSnapshot);
    return () => session.setObserver(null);
  }, []);
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
    if (fileView?.path === "PROJECT.md") {
      captureUsageEvent(
        "module_viewed",
        { module: "project_rules" },
        projectId || undefined,
      );
    }
  }, [fileView?.path, projectId]);

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

  const openAboutPageRoot = useCallback(() => {
    setManualUpdateCheckFailed(false);
    setRepositoryOpenFailed(false);
    setUserNoticeOpenFailed(false);
    setAboutOpen(true);
  }, []);

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

  const latestVersion = useMemo(
    () => versions.find((version) => version.id === latestVersionId) || null,
    [latestVersionId, versions],
  );
  const viewingVersion = useMemo(
    () => versions.find((version) => version.id === viewingVersionId) || null,
    [versions, viewingVersionId],
  );
  const runInProgress = projectLocked;
  const currentQoderHandoffStatus = (
    activeRun?.sourcePath
    && activeRun.requestId
    && sameLocalSourcePath(qoderHandoffState?.sourcePath, activeRun.sourcePath)
    && qoderHandoffState?.requestId === activeRun.requestId
    && qoderHandoffState.attemptId === activeRun.attemptId
  )
    ? qoderHandoffState.status
    : "idle";
  const handoffCancellationNeedsConfirmation = Boolean(
    activeRun?.status === "processing"
    && runSnapshot.activeHandoffMayBeRunning,
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
  const updateBadgeLabel = updateDownloaded ? "New! 重启更新" : "New!";
  const currentSourceFileName =
    localFileNameFromSourcePath(sourcePath) || projectName;
  const currentSourceFileExtension = fileExtension(currentSourceFileName);
  const currentSourceFileStem = fileStem(currentSourceFileName);
  const canOfferFileRename = Boolean(
    sourcePath
    && sourceSha256
    && typeof window !== "undefined"
    && window.htmlAIProjects?.renameHtml
    && runtimeCapabilitiesReady
    && !browserPreviewOnly
    && !runInProgress
    && !projectHydrating
    && !projectLoadError
    && !workspaceIssue
    && !viewTransitioning
    && viewMode === "current"
    && persistState === "idle"
    && editRevision === lastPersistedRevision
  );
  const interactionLocked = runInProgress
    || browserPreviewOnly
    || projectHydrating
    || Boolean(projectLoadError)
    || Boolean(workspaceIssue)
    || viewTransitioning
    || fileRenameEditing
    || fileRenameBusy
    || persistState === "conflict"
    || viewMode === "history";

  const activeCommentItems = useMemo(
    () => comments.filter(commentHasContent),
    [comments],
  );
  const activeCommentCount = activeCommentItems.length;
  const commentEditDraft = commentEditSession?.draftText ?? "";
  const commentEditAttachments = commentEditSession?.draftAttachments ?? [];
  const unfinishedEditedComment = commentEditSession
    ? activeCommentItems.find(
        (comment) => comment.commentId === commentEditSession.commentId,
      ) ?? null
    : null;
  const hasUnsavedCommentEdit = Boolean(
    viewMode === "current"
    && unfinishedEditedComment
    && commentEditSessionHasChanges(commentEditSession),
  );
  const pendingSendItemCount = activeCommentCount;
  const interactionPreviewHtml = useMemo(() => {
    if (!browserPreviewOnly || projectName !== WELCOME_PROJECT_NAME) return html;
    return html.replace(
      /(["'])(?:\.\/)?brand-logo\.png\1/iu,
      (_matched, quote: string) => `${quote}${BROWSER_PREVIEW_LOGO_PLACEHOLDER}${quote}`,
    );
  }, [
    browserPreviewOnly,
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
  const otherTabCommentsOpen = (
    expandedOtherTabCommentsKey === otherTabCommentsContextKey
  );
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
  const expectedCommentLayoutTargetIds = useMemo(() => [...new Set([
    ...visibleCommentItems.map((comment) => comment.target.id),
    ...(
      (hasCommentDraft || composerOpen) && draftTarget
        ? [draftTarget.id]
        : []
    ),
  ])].sort(), [
    composerOpen,
    draftTarget,
    hasCommentDraft,
    visibleCommentItems,
  ]);
  const expectedCommentLayoutTargetIdsKey =
    expectedCommentLayoutTargetIds.join("\u0000");
  const commentLayoutReady = Boolean(
    canvasMode === "edit"
    && commentLayoutAuthority.ready
    && (
      commentLayoutAuthority.textEditing
      || !expectedCommentLayoutSourceSha256
      || commentLayoutAuthority.sourceSha256
        === expectedCommentLayoutSourceSha256
    )
    && commentLayoutAuthority.viewContextGeneration
      === (activePageViewContext?.generation ?? 0)
    && commentLayoutAuthority.targetIdsKey
      === expectedCommentLayoutTargetIdsKey
    && expectedCommentLayoutTargetIds.every(
      (targetId) => Boolean(commentTargetLayouts[targetId]),
    )
  );
  const draftTargetLayout = draftTarget
    ? commentTargetLayouts[draftTarget.id]
    : undefined;
  const draftTargetInOtherTab = Boolean(
    draftTarget?.tagName !== "body"
    && draftTargetLayout?.status === "hidden"
    && draftTargetLayout.tabGroupKey,
  );
  const draftInOtherTab = hasCommentDraft && draftTargetInOtherTab;
  const draftTargetInCurrentTab = Boolean(
    draftTarget && !draftTargetInOtherTab,
  );
  const draftInCurrentTab = hasCommentDraft && draftTargetInCurrentTab;
  const composerInCurrentTab = composerOpen && draftTargetInCurrentTab;
  const commentTargetTops = useMemo(() => Object.fromEntries(
    Object.entries(commentTargetLayouts)
      .filter(([, layout]) => (
        layout.status === "visible"
        && Number.isFinite(layout.top)
      ))
      .map(([targetId, layout]) => [targetId, layout.top as number]),
  ), [commentTargetLayouts]);
  const otherTabCommentItems = useMemo(() => visibleCommentItems.filter(
    (comment) => {
      const layout = commentTargetLayouts[comment.target.id];
      return Boolean(
        comment.target.tagName !== "body"
        && layout?.status === "hidden"
        && layout.tabGroupKey
      );
    },
  ), [commentTargetLayouts, visibleCommentItems]);
  const otherTabCommentIds = useMemo(
    () => new Set(otherTabCommentItems.map((comment) => comment.commentId)),
    [otherTabCommentItems],
  );
  const railCommentItems = useMemo(
    () => visibleCommentItems.filter(
      (comment) => !otherTabCommentIds.has(comment.commentId),
    ),
    [otherTabCommentIds, visibleCommentItems],
  );
  const otherTabCommentGroups = useMemo(() => {
    const grouped = new Map<string, {
      key: string;
      label: string;
      entries: OtherTabCommentEntry[];
    }>();
    const appendEntry = (
      key: string,
      label: string,
      entry: OtherTabCommentEntry,
    ) => {
      const current = grouped.get(key);
      if (current) current.entries.push(entry);
      else grouped.set(key, { key, label, entries: [entry] });
    };
    for (const comment of otherTabCommentItems) {
      const layout = commentTargetLayouts[comment.target.id];
      const key = layout?.tabGroupKey || comment.target.id;
      appendEntry(
        key,
        layout?.tabGroupLabel || "其他标签页",
        {
          kind: "saved",
          key: comment.commentId,
          target: comment.target,
          comment,
          previewText: comment.text.trim()
            || `已添加 ${(comment.attachments ?? []).length} 个附件`,
        },
      );
    }
    if (draftInOtherTab && draftTarget && draftTargetLayout?.tabGroupKey) {
      appendEntry(
        draftTargetLayout.tabGroupKey,
        draftTargetLayout.tabGroupLabel || "其他标签页",
        {
          kind: "draft",
          key: "__composer",
          target: draftTarget,
          previewText: draft.trim()
            || `已添加 ${draftAttachments.length} 个附件`,
        },
      );
    }
    return [...grouped.values()].map((group) => ({
      ...group,
      entries: [...group.entries].sort((left, right) => {
        const sameTarget = (
          commentMarkerGroupKey(left.target)
          === commentMarkerGroupKey(right.target)
        );
        if (sameTarget) {
          if (left.kind !== right.kind) return left.kind === "saved" ? -1 : 1;
          if (left.kind === "saved" && right.kind === "saved") {
            return left.comment.createdAt.localeCompare(right.comment.createdAt);
          }
          return 0;
        }
        const position = (
          (left.target.sourceAnchor?.startOffset ?? Number.MAX_SAFE_INTEGER)
          - (right.target.sourceAnchor?.startOffset ?? Number.MAX_SAFE_INTEGER)
        );
        if (position !== 0) return position;
        if (left.kind !== right.kind) return left.kind === "saved" ? -1 : 1;
        if (left.kind === "saved" && right.kind === "saved") {
          return left.comment.createdAt.localeCompare(right.comment.createdAt);
        }
        return 0;
      }),
    }));
  }, [
    commentTargetLayouts,
    draft,
    draftAttachments.length,
    draftInOtherTab,
    draftTarget,
    draftTargetLayout,
    otherTabCommentItems,
  ]);
  const otherTabCommentEntryCount = (
    otherTabCommentItems.length + (draftInOtherTab ? 1 : 0)
  );
  const commentRailMinimumTop = Math.max(82, 14 + commentHeaderHeight + 16);
  const commentViewportBucket = Math.floor(commentViewport.top / 600);
  useEffect(() => {
    pageViewDocumentKeyRef.current = pageViewDocumentKey;
  }, [pageViewDocumentKey]);
  useEffect(() => {
    focusedCommentIdRef.current = focusedCommentId;
  }, [focusedCommentId]);
  useEffect(() => {
    commentRailOffsetRef.current = commentRailOffset;
  }, [commentRailOffset]);
  useEffect(() => {
    attachmentUploadCountRef.current = attachmentUploadCount;
  }, [attachmentUploadCount]);
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

  const markBackgroundProjectResult = useCallback((
    activeSourcePath: string,
    result: BackgroundProjectResult,
  ) => {
    runSessionRef.current.markResult(activeSourcePath, result);
  }, []);

  const clearBackgroundProjectResult = useCallback((activeSourcePath: string) => {
    runSessionRef.current.clearResult(activeSourcePath);
  }, []);

  const handleCommentLayout = useCallback((layout: HtmlCanvasCommentLayoutState) => {
    const targetIdsKey = layout.targetIds.join("\u0000");
    setCommentLayoutAuthority((current) => {
      const next = (
        layout.textEditing
        && !layout.ready
        && current.ready
      )
        ? { ...current, textEditing: true }
        : {
            sourceSha256: layout.sourceSha256,
            viewContextGeneration: layout.viewContextGeneration,
            targetIdsKey,
            ready: layout.ready,
            textEditing: layout.textEditing,
          };
      return (
        current.sourceSha256 === next.sourceSha256
        && current.viewContextGeneration === next.viewContextGeneration
        && current.targetIdsKey === next.targetIdsKey
        && current.ready === next.ready
        && current.textEditing === next.textEditing
      ) ? current : next;
    });
    if (!layout.ready) return;
    setCommentRailHeight((current) => (
      Math.abs(current - layout.contentHeight) > 1 ? layout.contentHeight : current
    ));
    const measuredLayouts = Object.fromEntries(
      layout.targets.map((target) => [target.targetId, target]),
    );
    setCommentTargetLayouts((current) => {
      // A keyed Canvas source replacement can briefly report no geometry.
      // Retain only the current target set's last proven layouts until the
      // replacement frame reports authoritative coordinates; project
      // transitions clear this cache explicitly.
      const measuredOrRetainedLayouts = Object.fromEntries(
        layout.targetIds.flatMap((targetId) => {
          const next = measuredLayouts[targetId] || current[targetId];
          return next ? [[targetId, next]] : [];
        }),
      );
      const nextLayouts = stabilizeCommentTargetLayouts({
        previous: current,
        next: measuredOrRetainedLayouts,
        textEditing: layout.textEditing,
      });
      const currentEntries = Object.entries(current);
      const nextEntries = Object.entries(nextLayouts);
      if (
        currentEntries.length === nextEntries.length
        && nextEntries.every(([targetId, next]) => {
          const previous = current[targetId];
          return previous?.top === next.top
            && previous?.height === next.height
            && previous?.status === next.status
            && previous?.resolution === next.resolution
            && previous?.tabGroupKey === next.tabGroupKey
            && previous?.tabGroupLabel === next.tabGroupLabel;
        })
      ) return current;
      return nextLayouts;
    });
  }, []);

  useEffect(() => {
    const stage = reviewStageRef.current;
    if (!stage) return undefined;
    let frame = 0;
    const updateViewport = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        const next = {
          top: Math.max(0, stage.scrollTop),
          height: Math.max(1, stage.clientHeight),
        };
        setCommentViewport((current) => (
          current.top === next.top && current.height === next.height
            ? current
            : next
        ));
      });
    };
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(updateViewport);
    observer?.observe(stage);
    stage.addEventListener("scroll", updateViewport, { passive: true });
    updateViewport();
    return () => {
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      stage.removeEventListener("scroll", updateViewport);
    };
  }, []);

  useEffect(() => {
    const header = commentsHeaderRef.current;
    if (!header || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const next = Math.ceil(header.getBoundingClientRect().height);
      setCommentHeaderHeight((current) => (
        next > 0 && next !== current ? next : current
      ));
    };
    const observer = new ResizeObserver(update);
    observer.observe(header);
    update();
    return () => observer.disconnect();
  }, [canvasMode]);

  useLayoutEffect(() => {
    const root = commentsPanelRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const update = () => {
      const nodes = [
        ...root.querySelectorAll<HTMLElement>("[data-comment-measure]"),
      ];
      const measured = Object.fromEntries(nodes.map((node) => [
        String(
          node.dataset.commentMeasureKey
          || commentMeasurementKey(
            String(node.dataset.commentMeasure),
            { compatibility: true },
          )
        ),
        Math.ceil(node.getBoundingClientRect().height),
      ]));
      const activeKeys = new Set([
        ...railCommentItems.map((comment) => comment.commentId),
        ...(composerInCurrentTab ? ["__composer"] : []),
        ...(
          draftInCurrentTab
          && !composerOpen
            ? ["__draft_recovery"]
            : []
        ),
      ]);
      setCommentCardHeights((current) => {
        const next = Object.fromEntries(
          Object.entries({ ...current, ...measured })
            .filter(([key]) => activeKeys.has(key.split("::", 1)[0])),
        );
        const entries = Object.entries(next);
        if (
          Object.keys(current).length === entries.length
          && entries.every(([key, height]) => current[key] === height)
        ) return current;
        return next;
      });
    };
    const observer = new ResizeObserver(update);
    const observed = new Set<HTMLElement>();
    const refreshObservedNodes = () => {
      const nodes = new Set([
        ...root.querySelectorAll<HTMLElement>("[data-comment-measure]"),
      ]);
      for (const node of observed) {
        if (nodes.has(node)) continue;
        observer.unobserve(node);
        observed.delete(node);
      }
      for (const node of nodes) {
        if (observed.has(node)) continue;
        observed.add(node);
        observer.observe(node);
      }
      update();
    };
    const mutationObserver = typeof MutationObserver === "undefined"
      ? null
      : new MutationObserver(refreshObservedNodes);
    mutationObserver?.observe(root, {
      attributes: true,
      attributeFilter: ["data-comment-measure-key"],
      childList: true,
      subtree: true,
    });
    refreshObservedNodes();
    return () => {
      mutationObserver?.disconnect();
      observer.disconnect();
    };
  }, [
    attachmentObjectUrls,
    composerInCurrentTab,
    composerOpen,
    draft,
    draftAttachments,
    draftInCurrentTab,
    draftTarget,
    editingCommentId,
    pendingDeleteCommentId,
    relinkingTarget,
    commentViewport.height,
    commentViewportBucket,
    railCommentItems,
  ]);

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
    return projectSessionRef.current.context;
  }, []);

  const isCurrentProjectContext = useCallback(
    (context: ProjectContext): boolean => (
      projectSessionRef.current.matches(context)
    ),
    [],
  );

  const prepareProjectRecords = useCallback(async () => {
    const activeSource = projectSessionRef.current.sourcePath;
    const epoch = projectSessionRef.current.epoch;
    if (
      !activeSource
      || (projectSessionRef.current.projectId && projectSessionRef.current.documentId)
      || workspaceController.getSnapshot().registration.phase === "registering"
    ) return;
    setProjectRecordsPreparing(true);
    setProjectRecordsError("");
    try {
      const registered = registrationContextFromOutcome(
        await workspaceController.ensureRegistered(),
      );
      if (
        !registered
        && projectSessionRef.current.epoch === epoch
        && sameLocalSourcePath(projectSessionRef.current.sourcePath, activeSource)
      ) {
        throw new Error("项目资料没有完成初始化。");
      }
    } catch (cause) {
      if (
        projectSessionRef.current.epoch !== epoch
        || !sameLocalSourcePath(projectSessionRef.current.sourcePath, activeSource)
      ) return;
      setProjectRecordsError(productErrorMessage(
        cause,
        "项目资料暂时无法建立；当前 HTML 和评论仍保留，可在这里重试。",
      ));
    } finally {
      if (
        projectSessionRef.current.epoch === epoch
        && sameLocalSourcePath(projectSessionRef.current.sourcePath, activeSource)
      ) {
        setProjectRecordsPreparing(false);
      }
    }
  }, [workspaceController]);

  const verifyCanvasRendered = useCallback(async (
    expectedHtml: string,
    expectedSha256: string,
    context?: ProjectContext,
  ): Promise<void> => {
    let expectedGeneration = documentSessionRef.current.canvasGeneration;
    const waitForCurrentGeneration = async (): Promise<boolean> => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        if (context && !isCurrentProjectContext(context)) {
          throw new Error("项目已切换，停止核对旧项目画布。");
        }
        if (
          documentSessionRef.current.canvasGeneration !== expectedGeneration
          || documentSessionRef.current.html !== expectedHtml
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
        return true;
      }
      return false;
    };
    if (await waitForCurrentGeneration()) return;

    // A missing acknowledgement is a disposable-Canvas failure, not a user
    // conflict. Rebuild exactly once from the authoritative Document snapshot.
    expectedGeneration = documentSessionRef.current.reloadCanvas().canvasGeneration;
    invalidateCanvasRenderAcks();
    if (await waitForCurrentGeneration()) return;
    throw new Error("画布没有在时限内确认载入目标 HTML。");
  }, [
    acknowledgeCanvasRender,
    invalidateCanvasRenderAcks,
    isCurrentProjectContext,
  ]);

  useEffect(() => {
    if (canvasMode !== "edit") return undefined;
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
          && documentSessionRef.current.html === expectedHtml
          && documentSessionRef.current.canvasGeneration === expectedGeneration
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
  }, [acknowledgeCanvasRender, canvasGeneration, canvasMode, html]);

  const clearAutosaveTimer = useCallback(() => {
    if (autosaveTimerRef.current !== null) {
      window.clearTimeout(autosaveTimerRef.current);
      autosaveTimerRef.current = null;
    }
  }, []);

  const persistRecoveryLog = useCallback((
    write: PendingWrite | null,
    context?: Partial<ProjectContext>,
  ) => {
    const keyPart = write?.documentId
      || context?.documentId
      || projectSessionRef.current.documentId
      || write?.sourcePath
      || context?.sourcePath
      || projectSessionRef.current.sourcePath
      || "unbound";
    const key = `html-ai-recovery:${keyPart}`;
    if (!write) {
      recoveryStore.remove(key);
      return;
    }
    // A full browser-storage quota must never make the actual source write
    // look successful; the store reports failure without changing write state.
    recoveryStore.write(key, {
      schemaVersion: "2.0.0",
      projectId: write.projectId,
      documentId: write.documentId,
      sourcePath: write.sourcePath,
      recoveryIdentity: write.recoveryIdentity,
      expectedSourceSha256: write.expectedSourceSha256,
      revision: write.revision,
      html: write.html,
      changeEvents: write.events.map(persistedChangeEvent),
      sourceHistoryOperations: write.historyOperations,
    });
  }, []);

  const persistDraftRecovery = useCallback((
    snapshot: PendingDraft | null,
    context?: Partial<ProjectContext>,
  ) => {
    const documentKeyPart = snapshot?.documentId
      || context?.documentId
      || projectSessionRef.current.documentId;
    const sourceKeyPart = snapshot?.sourcePath
      || context?.sourcePath
      || projectSessionRef.current.sourcePath;
    const keys = [
      documentKeyPart ? `html-ai-draft-recovery:${documentKeyPart}` : "",
      sourceKeyPart ? `html-ai-draft-recovery:${sourceKeyPart}` : "",
    ].filter(Boolean);
    if (!snapshot) {
      recoveryStore.remove(keys);
      return;
    }
      const composerText = commentSessionRef.current.composerDraft;
      const composerTarget = commentSessionRef.current.composerTarget;
      const composerAttachments = commentSessionRef.current.composerAttachments;
      const commentEdit = commentEditSessionHasChanges(
        commentSessionRef.current.editSession,
      )
        ? commentSessionRef.current.editSession
        : null;
      if (
        snapshot.comments.length === 0
        && snapshot.changeEvents.length === 0
        && snapshot.deletedCommentIds.length === 0
        && !composerText.trim()
        && composerAttachments.length === 0
        && !composerTarget
        && !commentEdit
      ) {
        recoveryStore.remove(keys);
        return;
      }
      recoveryStore.write(keys, {
        schemaVersion: "3.2.0",
        projectId: snapshot.projectId,
        documentId: snapshot.documentId,
        sourcePath: snapshot.sourcePath,
        basedOnVersionId: snapshot.basedOnVersionId,
        baseDraftRevision: snapshot.expectedDraftRevision,
        operationId: snapshot.operationId,
        localSequence: ++draftRecoverySequenceRef.current,
        comments: snapshot.comments.map(persistedComment),
        changeEvents: snapshot.changeEvents.map(persistedChangeEvent),
        deletedCommentIds: snapshot.deletedCommentIds,
        composerDraft: composerText,
        composerCommentId: commentSessionRef.current.composerCommentId,
        composerAttachments: composerAttachments.map(persistedAttachment),
        composerTarget: composerTarget ? persistedTargetRef(composerTarget) : null,
        commentEdit: commentEdit
          ? {
              commentId: commentEdit.commentId,
              draftText: commentEdit.draftText,
              draftAttachments: commentEdit.draftAttachments.map(
                persistedAttachment,
              ),
            }
          : null,
      });
    // The Bridge remains authoritative after acknowledgement; this is only a
    // crash fallback and storage failure cannot downgrade the Bridge result.
  }, []);

  const persistCurrentDraftRecovery = useCallback((
    nextComments = commentSessionRef.current.comments,
    nextEvents = commentSessionRef.current.changeEvents,
  ) => {
    const context = captureProjectContext();
    if (!context) return;
    const snapshot = draftSessionRef.current.createSnapshot({
      context,
      basedOnVersionId:
        versionSessionRef.current.snapshot.currentBasedOnVersionId,
      comments: nextComments,
      changeEvents: nextEvents,
      deletedCommentIds: commentSessionRef.current.deletedCommentIds,
      operationId: draftRecoveryOperationIdRef.current || undefined,
    });
    if (snapshot) persistDraftRecovery(snapshot);
  }, [captureProjectContext, persistDraftRecovery]);

  const normalizeCurrentGlobalComments = useCallback((): CommentItem[] => {
    const normalized = normalizeGlobalCommentTargets(
      commentSessionRef.current.comments.filter(commentHasContent),
    );
    if (!normalized.changed) return normalized.comments;
    const normalizedById = new Map(
      normalized.comments.map((comment) => [comment.commentId, comment]),
    );
    const nextComments = commentSessionRef.current.comments.map(
      (comment) => normalizedById.get(comment.commentId) || comment,
    );
    commentSessionRef.current.setComments(nextComments);
    persistCurrentDraftRecovery(nextComments);
    return nextComments.filter(commentHasContent);
  }, [persistCurrentDraftRecovery]);

  const flushAutosave = useCallback(async (throughRevision?: number): Promise<boolean> => {
    clearAutosaveTimer();
    if (documentSessionRef.current.flushPromise) {
      const previous = await documentSessionRef.current.flushPromise;
      if (!previous) return false;
      if (
        throughRevision !== undefined
        && documentSessionRef.current.lastPersistedRevision >= throughRevision
      ) return true;
      if (
        !documentSessionRef.current.pendingWrite
        && documentSessionRef.current.editRevision <= documentSessionRef.current.lastPersistedRevision
      ) return true;
    }
    if (
      !documentSessionRef.current.pendingWrite
      && projectSessionRef.current.sourcePath
      && documentSessionRef.current.editRevision > documentSessionRef.current.lastPersistedRevision
    ) {
      const reconstructedWrite: PendingWrite = {
        epoch: projectSessionRef.current.epoch,
        projectId: projectSessionRef.current.projectId,
        documentId: projectSessionRef.current.documentId,
        sourcePath: projectSessionRef.current.sourcePath,
        expectedSourceSha256: documentSessionRef.current.sourceSha256,
        html: documentSessionRef.current.html,
        revision: documentSessionRef.current.editRevision,
        events: [...auditPendingRef.current],
        historyOperations: sourceHistorySessionRef.current.pendingOperations,
        recoveryIdentity: recoveryIdentityRef.current,
      };
      documentSessionRef.current.setPendingWrite(reconstructedWrite);
      persistRecoveryLog(reconstructedWrite);
      documentSessionRef.current.setPersistence({
        state: "queued",
        error: "",
      });
    }
    if (!projectSessionRef.current.sourcePath && !documentSessionRef.current.pendingWrite?.sourcePath) return false;
    if (
      throughRevision !== undefined
      && documentSessionRef.current.lastPersistedRevision >= throughRevision
      && (!documentSessionRef.current.pendingWrite || documentSessionRef.current.pendingWrite.revision > throughRevision)
    ) {
      return true;
    }

    const run = async () => {
      while (documentSessionRef.current.pendingWrite) {
        const pendingWrite = documentSessionRef.current.takePendingWrite();
        if (!pendingWrite) break;
        let write = pendingWrite;
        if (!write.sourcePath) return false;
        if (throughRevision !== undefined && write.revision > throughRevision) break;
        const inFlightAuditKeys = write.events.map(auditEventKey);
        for (const key of inFlightAuditKeys) {
          auditInFlightKeysRef.current.add(key);
        }
        let writeContext: ProjectContext = {
          epoch: write.epoch,
          projectId: write.projectId,
          documentId: write.documentId,
          sourcePath: write.sourcePath,
        };
        if (isCurrentProjectContext(writeContext)) {
          documentSessionRef.current.setPersistence({
            state: "writing",
            error: "",
          });
        }
        try {
          if (!write.projectId || !write.documentId) {
            const registered = registrationContextFromOutcome(
              await workspaceController.ensureRegistered({
                sourcePath: write.sourcePath,
                expectedSourceSha256: write.expectedSourceSha256,
                adoptCanonicalSource: false,
              }),
            );
            if (!registered) {
              throw new Error("项目已切换，原项目的修改已保留在恢复记录中。");
            }
            write = {
              ...write,
              projectId: registered.projectId,
              documentId: registered.documentId,
              expectedSourceSha256: documentSessionRef.current.sourceSha256,
            };
            const queuedAfterRegistration =
              documentSessionRef.current.pendingWrite as PendingWrite | null;
            if (
              queuedAfterRegistration
              && queuedAfterRegistration.epoch === write.epoch
              && sameLocalSourcePath(queuedAfterRegistration.sourcePath, write.sourcePath)
            ) {
              documentSessionRef.current.setPendingWrite({
                ...queuedAfterRegistration,
                projectId: registered.projectId,
                documentId: registered.documentId,
                expectedSourceSha256: documentSessionRef.current.sourceSha256,
              });
            }
          }
          if (!write.sourcePath) return false;
          writeContext = {
            epoch: write.epoch,
            projectId: write.projectId,
            documentId: write.documentId,
            sourcePath: write.sourcePath,
          };
          const payload = await bridgeClient.autosave({
            projectId: write.projectId,
            documentId: write.documentId,
            sourcePath: write.sourcePath,
            html: write.html,
            expectedSourceSha256: write.expectedSourceSha256,
            editRevision: write.revision,
            changeEvents: write.events.map(persistedChangeEvent),
            sourceHistoryOperations: write.historyOperations,
          });
          if (payload.ok === false) {
            throw new Error("无法把修改更新到源 HTML。");
          }
          const hasExactAcknowledgedHtml =
            typeof payload.content === "string"
            && payload.content === write.html;
          const acknowledgedHtml = hasExactAcknowledgedHtml
            ? payload.content as string
            : write.html;
          const targetSha256 = await browserSha256(write.html);
          const nextHash = String(payload.sha256 || payload.currentHtmlSha256 || "");
          const persistedRevision = Number(payload.persistedRevision);
          const persistedAt = String(payload.lastModifiedAt || "");
          if (
            !hasExactAcknowledgedHtml
            || !/^sha256:[a-f0-9]{64}$/.test(nextHash)
            || nextHash !== targetSha256
            || !Number.isSafeInteger(persistedRevision)
            || persistedRevision < write.revision
            || !persistedAt
            || (payload.skipped === true && nextHash !== targetSha256)
          ) {
            const invalidAck = new Error(
              "自动写回的确认内容与本次提交的原始字节不一致。",
            ) as Error & { code?: string };
            invalidAck.code = "INVALID_AUTOSAVE_ACK";
            throw invalidAck;
          }
          if (!isRecord(payload.sourceHistory)) {
            const invalidHistoryAck = new Error(
              "自动写回缺少与源码一致的持久化撤销历史。",
            ) as Error & { code?: string };
            invalidHistoryAck.code = "INVALID_AUTOSAVE_ACK";
            throw invalidHistoryAck;
          }
          if (!sourceHistorySessionRef.current.acknowledge(
            writeContext,
            write.historyOperations,
            payload.sourceHistory,
            nextHash,
          )) {
            sourceHistorySessionRef.current.activate(
              writeContext,
              nextHash,
              payload.sourceHistory,
            );
          }
          const queuedWrite = documentSessionRef.current.pendingWrite as PendingWrite | null;
          if (
            queuedWrite
            && queuedWrite.epoch === write.epoch
            && queuedWrite.projectId === write.projectId
            && queuedWrite.documentId === write.documentId
            && sameLocalSourcePath(queuedWrite.sourcePath, write.sourcePath)
          ) {
            documentSessionRef.current.setPendingWrite({
              ...queuedWrite,
              expectedSourceSha256: nextHash,
              recoveryIdentity:
                recoveryIdentityFromRecord(payload.recoveryIdentity)
                || queuedWrite.recoveryIdentity,
              events: removeAcknowledgedAuditEvents(queuedWrite.events, write.events),
              historyOperations:
                sourceHistorySessionRef.current.pendingOperations,
            });
            persistRecoveryLog(documentSessionRef.current.pendingWrite, writeContext);
          } else {
            persistRecoveryLog(null, writeContext);
          }
          if (isCurrentProjectContext(writeContext)) {
            recoveryIdentityRef.current =
              recoveryIdentityFromRecord(payload.recoveryIdentity)
              || recoveryIdentityRef.current;
            const writeCompletesCurrentDocument = Boolean(
              documentSessionRef.current.editRevision === write.revision
              && !documentSessionRef.current.pendingWrite
            );
            const persistedDocumentRevision = Math.max(
              documentSessionRef.current.lastPersistedRevision,
              persistedRevision,
            );
            documentSessionRef.current.update(writeCompletesCurrentDocument
              ? {
                  html: acknowledgedHtml,
                  sourceSha256: nextHash,
                  lastPersistedRevision: persistedDocumentRevision,
                }
              : {
                  sourceSha256: nextHash,
                  lastPersistedRevision: persistedDocumentRevision,
                });
            setLastModifiedAt(persistedAt);
            if (writeCompletesCurrentDocument) {
              const reboundTargets = rebindTargetsPreservingGlobal(
                acknowledgedHtml,
                [
                  ...commentSessionRef.current.comments.map((comment) => comment.target),
                  ...commentSessionRef.current.changeEvents.map((event) => event.target),
                  ...(commentSessionRef.current.composerTarget ? [commentSessionRef.current.composerTarget] : []),
                ],
              );
              const reboundById = new Map(
                reboundTargets.map((target) => [target.id, target]),
              );
              const reboundComments = commentSessionRef.current.comments.map((comment) => ({
                ...comment,
                target: reboundById.get(comment.target.id) || comment.target,
              }));
              const reboundEvents = commentSessionRef.current.changeEvents.map((event) => ({
                ...event,
                target: reboundById.get(event.target.id) || event.target,
              }));
              commentSessionRef.current.update({
                comments: reboundComments,
                changeEvents: reboundEvents,
              });
              if (commentSessionRef.current.composerTarget) {
                const reboundDraftTarget =
                  reboundById.get(commentSessionRef.current.composerTarget.id)
                  || commentSessionRef.current.composerTarget;
                commentSessionRef.current.setComposerTarget(reboundDraftTarget);
              }
              versionSessionRef.current.updateAuthority({
                currentExactVersionId: payload.currentExactVersionId,
              });
            }
            auditPendingRef.current = removeAcknowledgedAuditEvents(
              auditPendingRef.current,
              write.events,
            );
            if (!documentSessionRef.current.pendingWrite) {
              documentSessionRef.current.setPersistence({
                state: "idle",
                error: "",
              });
            }
          }
        } catch (cause) {
          const error = cause as Error & { code?: string };
          const visibleError = productErrorMessage(
            error,
            "当前修改还没有写入源 HTML，请重试或导出当前编辑。",
          );
          const conflict = error.code === "SOURCE_CHANGED"
            || error.message.includes("SOURCE_CHANGED");
          const protocolError = error.code === "INVALID_AUTOSAVE_ACK";
          let boundaryFailure = "";
          if (
            isCurrentProjectContext(writeContext)
            && (conflict || protocolError)
          ) {
            const frozen = fenceAndFreezeCurrentCanvas(
              "编辑画布尚未就绪，已停止接受这次外部源码状态。",
            );
            if (!frozen.ok) boundaryFailure = frozen.reason;
            clearAutosaveTimer();
          }
          const pendingAfterFailure = documentSessionRef.current.pendingWrite as PendingWrite | null;
          const recoveryWrite = pendingAfterFailure
            && pendingAfterFailure.epoch === write.epoch
            && pendingAfterFailure.projectId === write.projectId
            && pendingAfterFailure.documentId === write.documentId
            && sameLocalSourcePath(pendingAfterFailure.sourcePath, write.sourcePath)
            && pendingAfterFailure.revision > write.revision
            ? pendingAfterFailure
            : write;
          if (
            isCurrentProjectContext(writeContext)
            && (
              !pendingAfterFailure
              || (
                pendingAfterFailure.epoch === recoveryWrite.epoch
                && sameLocalSourcePath(
                  pendingAfterFailure.sourcePath,
                  recoveryWrite.sourcePath,
                )
                && pendingAfterFailure.revision < recoveryWrite.revision
              )
            )
          ) {
            documentSessionRef.current.setPendingWrite(recoveryWrite);
          }
          persistRecoveryLog(recoveryWrite, writeContext);
          if (isCurrentProjectContext(writeContext)) {
            if (boundaryFailure) {
              const failClosedMessage = `${visibleError} ${boundaryFailure}`;
              projectLoadErrorRef.current = failClosedMessage;
              setProjectLoadError(failClosedMessage);
              documentSessionRef.current.setPersistence({
                state: "failed",
                error: failClosedMessage,
              });
            } else if (conflict) {
              // The current native draft is now part of recoveryWrite and the
              // editing host is frozen; only now may the conflict lock appear.
              documentSessionRef.current.setPersistence({
                state: "conflict",
                error: visibleError,
              });
            } else if (protocolError) {
              const failClosedMessage = `${visibleError} 源文件已进入待复核状态，不会采用服务端返回的不同内容。`;
              projectLoadErrorRef.current = failClosedMessage;
              setProjectLoadError(failClosedMessage);
              documentSessionRef.current.setPersistence({
                state: "failed",
                error: failClosedMessage,
              });
            } else {
              documentSessionRef.current.setPersistence({
                state: "failed",
                error: visibleError,
              });
            }
          }
          return false;
        } finally {
          for (const key of inFlightAuditKeys) {
            auditInFlightKeysRef.current.delete(key);
          }
        }
      }
      return throughRevision === undefined
        || documentSessionRef.current.lastPersistedRevision >= throughRevision;
    };

    const promise = run();
    documentSessionRef.current.setFlushPromise(promise);
    try {
      return await promise;
    } finally {
      documentSessionRef.current.clearFlushPromise(promise);
    }
  }, [
    clearAutosaveTimer,
    fenceAndFreezeCurrentCanvas,
    isCurrentProjectContext,
    persistRecoveryLog,
    workspaceController,
  ]);

  const enqueueAutosave = useCallback((
    nextHtml: string,
    mutation?: HtmlCanvasMutation,
    sourceTransaction?: HtmlCanvasSourceTransaction,
  ): number => {
    if (documentSessionRef.current.persistState === "conflict") {
      return documentSessionRef.current.editRevision;
    }
    const nextRevision = documentSessionRef.current.editRevision + 1;
    if (sourceTransaction && projectSessionRef.current.sourcePath) {
      sourceHistorySessionRef.current.record(
        {
          epoch: projectSessionRef.current.epoch,
          projectId: projectSessionRef.current.projectId,
          documentId: projectSessionRef.current.documentId,
          sourcePath: projectSessionRef.current.sourcePath,
        },
        sourceTransaction,
        nextRevision,
      );
    }
    documentSessionRef.current.beginEdit(nextHtml);
    versionSessionRef.current.markSourceEdited();
    invalidateCanvasRenderAcks();

    if (mutation) {
      const nextEvents = appendDirectEditEvent({
        mutation,
        revision: nextRevision,
        createdAt: new Date().toISOString(),
        basedOnVersionId:
          versionSessionRef.current.snapshot.currentBasedOnVersionId,
        events: commentSessionRef.current.changeEvents,
        pendingEvents: auditPendingRef.current,
        inFlightKeys: auditInFlightKeysRef.current,
        nextEventId: () => recordId("change", changeCounter.current++),
      });
      commentSessionRef.current.setChangeEvents(nextEvents.events);
      auditPendingRef.current = nextEvents.pendingEvents;
      persistCurrentDraftRecovery(commentSessionRef.current.comments, nextEvents.events);
      captureUsageEvent("direct_edit_committed", {
        edit_kind: mutation.kind,
        property_group: mutation.kind === "text"
          ? "text"
          : editPropertyGroup(mutation.property),
      }, projectSessionRef.current.projectId || undefined);
    }

    if (!projectSessionRef.current.sourcePath) {
      documentSessionRef.current.update({
        pendingWrite: null,
        persistState: "preview-dirty",
        persistError: "",
      });
      clearAutosaveTimer();
      return nextRevision;
    }

    const write: PendingWrite = {
      epoch: projectSessionRef.current.epoch,
      projectId: projectSessionRef.current.projectId,
      documentId: projectSessionRef.current.documentId,
      sourcePath: projectSessionRef.current.sourcePath,
      expectedSourceSha256: documentSessionRef.current.sourceSha256,
      html: nextHtml,
      revision: nextRevision,
      events: [...auditPendingRef.current],
      historyOperations: sourceHistorySessionRef.current.pendingOperations,
      recoveryIdentity: recoveryIdentityRef.current,
    };
    documentSessionRef.current.setPendingWrite(write);
    persistRecoveryLog(write);
    documentSessionRef.current.setPersistence({
      state: "queued",
      error: "",
    });
    clearAutosaveTimer();
    if (projectSessionRef.current.sourcePath) {
      autosaveTimerRef.current = window.setTimeout(() => {
        void flushAutosave();
      }, AUTOSAVE_DELAY_MS);
    }
    return nextRevision;
  }, [
    clearAutosaveTimer,
    flushAutosave,
    invalidateCanvasRenderAcks,
    persistCurrentDraftRecovery,
    persistRecoveryLog,
  ]);

  const applyProject = useCallback((project: HtmlProject | {
    name: string;
    sourcePath: string | null;
    html: string;
    sha256?: string | null;
    lastModifiedAt?: string;
  }) => {
    markProjectHydrationStage("apply-start");
    const outgoingRun = runSessionRef.current.activeRun;
    const outgoingSourcePath = projectSessionRef.current.sourcePath;
    if (
      outgoingRun
      && outgoingSourcePath
      && !sameLocalSourcePath(outgoingSourcePath, project.sourcePath)
    ) {
      if (outgoingRun.status === "ready-to-open") {
        markBackgroundProjectResult(outgoingSourcePath, {
          state: "ready",
          label: "新版本可查看",
          updatedAt: Date.now(),
        });
      } else if (outgoingRun.status === "awaiting-conflict-resolution") {
        markBackgroundProjectResult(outgoingSourcePath, {
          state: "conflict",
          label: "需要处理",
          updatedAt: Date.now(),
        });
      } else if (isLockedLifecycleState(outgoingRun.status)) {
        markBackgroundProjectResult(outgoingSourcePath, {
          state: "processing",
          label: "正在处理",
          updatedAt: Date.now(),
        });
      }
    }
    projectSessionRef.current.openLocator(project.sourcePath || null);
    runSessionRef.current.activate(project.sourcePath || null);
    clearAutosaveTimer();
    documentSessionRef.current.reset({
      html: project.html,
      sourceSha256: project.sha256 || null,
    });
    auditPendingRef.current = [];
    recoveryIdentityRef.current = null;
    projectHydratingRef.current = Boolean(project.sourcePath);
    markProjectHydrationStage("apply-authority");
    projectLoadErrorRef.current = null;
    viewTransitioningRef.current = false;
    navigationOperationRef.current += 1;
    draftSessionRef.current.deactivate();
    sourceHistorySessionRef.current.deactivate();
    projectRulesSessionRef.current.close();
    draftRecoveryOperationIdRef.current = null;
    setProjectName(project.name);
    setProjectRecordsPath(null);
    setLastModifiedAt(project.lastModifiedAt || null);
    setSelection(null);
    setPageViewContext(null);
    reviewAnalysisSessionRef.current.clear();
    editorRef.current?.applyPageViewContext(null);
    setComposerOpen(false);
    commentSessionRef.current.reset();
    for (const url of attachmentObjectUrlsRef.current.values()) {
      try {
        URL.revokeObjectURL(url);
      } catch {
        // A retired preview URL must not block the next project's authority.
      }
    }
    attachmentObjectUrlsRef.current.clear();
    setAttachmentObjectUrls({});
    attachmentUploadCountRef.current = 0;
    setAttachmentUploadCount(0);
    setPreviewAttachment(null);
    setEditingCommentId(null);
    commentEditResumePendingRef.current = null;
    setPendingDeleteCommentId(null);
    relinkingTargetRef.current = null;
    relinkSelectionArmedRef.current = false;
    resumeSubmissionAfterRelinkRef.current = false;
    pendingProjectOpenRef.current = null;
    setRelinkingTarget(null);
    setCommentCardHeights({});
    setCommentRailHeight(0);
    commentRailOffsetRef.current = 0;
    setCommentRailOffset(0);
    setCommentRailFollowsFocus(false);
    setCommentTargetLayouts({});
    setCommentLayoutAuthority({
      sourceSha256: "",
      viewContextGeneration: -1,
      targetIdsKey: "",
      ready: false,
      textEditing: false,
    });
    focusedCommentIdRef.current = null;
    setFocusedCommentId(null);
    reviewRevealRequestRef.current += 1;
    versionSessionRef.current.reset();
    setCanvasMode(
      runtimeCapabilitiesRef.current.sourceEditing !== "enabled"
        ? "preview"
        : "edit",
    );
    invalidateCanvasRenderAcks();
    setProjectHydrating(Boolean(project.sourcePath));
    setProjectLoadError(null);
    setViewTransitioning(false);
    setDraftPersistError("");
    setProjectRecordsPreparing(false);
    setProjectRecordsError("");
    setOpeningReadyVersion(
      Boolean(
        runSessionRef.current.activeRun
        && runSessionRef.current.isOperationBusy(
          "activate",
          activeRunOperationKey(runSessionRef.current.activeRun),
        ),
      ),
    );
    setDrawer(null);
    setFileView(null);
    if (project.sourcePath) clearBackgroundProjectResult(project.sourcePath);
    markProjectHydrationStage("apply-ui-cleanup");
    const reviewStage = reviewStageRef.current;
    if (reviewStage && typeof reviewStage.scrollTo === "function") {
      try {
        reviewStage.scrollTo({ top: 0 });
      } catch {
        // Scrolling is presentational and cannot own a project transition.
      }
    }
    try {
      if (!runSessionRef.current.activeLocked) editorRef.current?.unlockNow?.();
    } catch {
      // The outgoing lazy editor may be between ref cleanup and DOM teardown.
    }
    try {
      editorRef.current?.clearSelection();
    } catch {
      // The incoming source load will independently retire the old selection.
    }
    markProjectHydrationStage("apply-complete");
  }, [
    clearAutosaveTimer,
    clearBackgroundProjectResult,
    invalidateCanvasRenderAcks,
    markBackgroundProjectResult,
  ]);

  const refreshRecents = useCallback(async () => {
    const api = window.htmlAIProjects;
    if (!api) return;
    try {
      setRecentProjects(await api.listRecentProjects());
      setRecentProjectsError("");
    } catch (cause) {
      setRecentProjectsError(productErrorMessage(
        cause,
        "最近打开记录暂时无法读取。",
      ));
    }
  }, []);

  const forgetRecentProject = useCallback(async (recentSourcePath: string) => {
    const api = window.htmlAIProjects;
    if (!api?.forgetRecent) return;
    try {
      await api.forgetRecent(recentSourcePath);
      setRecentProjects((current) => current.filter(
        (project) => project.sourcePath !== recentSourcePath,
      ));
      setRecentProjectsError("");
    } catch (cause) {
      setRecentProjectsError(productErrorMessage(
        cause,
        "这条最近打开记录暂时无法移除，可以重试。",
      ));
    }
  }, []);

  const prepareGeneratedSourceTransition = useCallback(async ({
    previousSourcePath,
    nextSourcePath,
    expectedSha256,
    nextProjectId,
    nextDocumentId,
    versionId,
  }: {
    previousSourcePath: string;
    nextSourcePath: string;
    expectedSha256: string;
    nextProjectId: string;
    nextDocumentId: string;
    versionId: string;
  }): Promise<PreparedGeneratedSourceTransition> => {
    const updatesCurrentProject =
      (
        Boolean(nextProjectId)
        && Boolean(projectSessionRef.current.projectId)
        && projectSessionRef.current.projectId === nextProjectId
      )
      || sameLocalSourcePath(projectSessionRef.current.sourcePath, previousSourcePath)
      || sameLocalSourcePath(projectSessionRef.current.sourcePath, nextSourcePath);
    if (!nextSourcePath || sameLocalSourcePath(nextSourcePath, previousSourcePath)) {
      return Object.freeze({
        previousSourcePath,
        nextSourcePath,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        updatesCurrentProject,
        activatedProject: null,
      });
    }

    const api = window.htmlAIProjects;
    if (!api?.activateGeneratedVersion) {
      throw new Error("当前运行环境不能安全切换到生成的新版本文件。");
    }
    const activatedProject = await api.activateGeneratedVersion({
      previousSourcePath,
      nextSourcePath,
      expectedSha256,
      projectId: nextProjectId,
      versionId,
    });
    if (
      !sameLocalSourcePath(activatedProject.sourcePath, nextSourcePath)
      || activatedProject.sha256 !== expectedSha256
      || await browserSha256(activatedProject.html) !== expectedSha256
    ) {
      throw new Error("生成版本的路径、HTML 与 Hash 没有形成完整一致的候选。");
    }
    void refreshRecents();
    return Object.freeze({
      previousSourcePath,
      nextSourcePath,
      projectId: nextProjectId,
      documentId: nextDocumentId,
      updatesCurrentProject,
      activatedProject,
    });
  }, [refreshRecents]);

  const commitGeneratedSourceTransition = useCallback(({
    prepared,
    html: nextHtml,
    sourceSha256: nextSourceSha256,
    publishVersion,
  }: {
    prepared: PreparedGeneratedSourceTransition;
    html: string;
    sourceSha256: string;
    publishVersion: () => void;
  }): ProjectContext | null => {
    if (!prepared.updatesCurrentProject) return null;
    const changesSourcePath = !sameLocalSourcePath(
      projectSessionRef.current.sourcePath,
      prepared.nextSourcePath,
    );
    if (changesSourcePath) {
      runSessionRef.current.rebaseSource({
        previousSourcePath: prepared.previousSourcePath,
        sourcePath: prepared.nextSourcePath,
        projectId: prepared.projectId,
      });
    }
    const transition = changesSourcePath
      ? projectSessionRef.current.transitionSource({
          previousSourcePath: prepared.previousSourcePath,
          sourcePath: prepared.nextSourcePath,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
        })
      : projectSessionRef.current.context
        || projectSessionRef.current.register({
          epoch: projectSessionRef.current.epoch,
          projectId: prepared.projectId,
          documentId: prepared.documentId,
          sourcePath: prepared.nextSourcePath,
        });
    if (!transition) return null;
    const context = projectSessionRef.current.context;
    if (!context) return null;

    // No asynchronous boundary is permitted here. React observes the new
    // project, complete Document tuple, Version authority and Canvas generation
    // in one renderer commit instead of rendering any partial combination.
    documentSessionRef.current.publishAuthority({
      html: nextHtml,
      sourceSha256: nextSourceSha256,
      pendingWrite: null,
    });
    publishVersion();
    invalidateCanvasRenderAcks();
    if (changesSourcePath) {
      recoveryIdentityRef.current = null;
      draftSessionRef.current.deactivate();
      sourceHistorySessionRef.current.deactivate();
      draftRecoveryOperationIdRef.current = null;
    }
    return context;
  }, [invalidateCanvasRenderAcks]);

  const recoverAutosaveLog = useCallback(async (
    context: ProjectContext,
    currentSourceSha256: string,
    serverRevision: number,
  ): Promise<boolean> => {
    const keys = [
      `html-ai-recovery:${context.documentId}`,
      `html-ai-recovery:${context.sourcePath}`,
    ];
    let raw: Record<string, unknown> | null = null;
    let recoveredKey = "";
    for (const record of recoveryStore.readRecords(keys)) {
      if (isRecord(record.value)) {
        raw = record.value;
        recoveredKey = record.key;
        break;
      }
    }
    if (
      !raw
      || String(raw.sourcePath || "") !== context.sourcePath
      || String(raw.projectId || "") !== context.projectId
      || String(raw.documentId || "") !== context.documentId
      || typeof raw.html !== "string"
      || !/<html(?:\s|>)/i.test(raw.html)
    ) return false;

    const recoveredHtml = raw.html;
    const targetSha256 = await browserSha256(recoveredHtml);
    if (!isCurrentProjectContext(context)) return false;
    if (targetSha256 === currentSourceSha256) {
      const recoveredRevision = Number.isSafeInteger(Number(raw.revision))
        ? Number(raw.revision)
        : 0;
      const reconciledRevision = Math.max(serverRevision, recoveredRevision);
      documentSessionRef.current.update({
        editRevision: reconciledRevision,
        lastPersistedRevision: reconciledRevision,
        pendingWrite: null,
        persistState: "idle",
        persistError: "",
      });
      recoveryStore.remove(recoveredKey);
      return false;
    }

    const revision = Math.max(
      serverRevision,
      Number.isSafeInteger(Number(raw.revision)) ? Number(raw.revision) : 0,
    ) + 1;
    const recoveredEvents = changesFromDraftRecords(raw.changeEvents);
    const existingIds = new Set(commentSessionRef.current.changeEvents.map((event) => event.eventId));
    const mergedEvents = [
      ...commentSessionRef.current.changeEvents,
      ...recoveredEvents.filter((event) => !existingIds.has(event.eventId)),
    ];
    const recoveredExpectedSha256 = String(raw.expectedSourceSha256 || "");
    const storedRecoveryIdentity = recoveryIdentityFromRecord(raw.recoveryIdentity);
    const currentRecoveryIdentity = recoveryIdentityRef.current;
    const recoveryIdentityMatches = Boolean(
      storedRecoveryIdentity
      && currentRecoveryIdentity
      && storedRecoveryIdentity.token === currentRecoveryIdentity.token
      && storedRecoveryIdentity.projectId === context.projectId
      && storedRecoveryIdentity.documentId === context.documentId
      && sameLocalSourcePath(storedRecoveryIdentity.sourcePath, context.sourcePath)
      && storedRecoveryIdentity.basedOnVersionId
        === currentRecoveryIdentity.basedOnVersionId
      && storedRecoveryIdentity.sourceSha256 === currentSourceSha256
      && storedRecoveryIdentity.editRevision === serverRevision
    );
    const canRebaseSafely =
      recoveryIdentityMatches
      && recoveredExpectedSha256 === currentSourceSha256;
    const job: PendingWrite = {
      ...context,
      expectedSourceSha256: canRebaseSafely
        ? currentSourceSha256
        : recoveredExpectedSha256 || currentSourceSha256,
      html: recoveredHtml,
      revision,
      events: recoveredEvents,
      historyOperations: sourceHistoryOperationsFromRecord(
        raw.sourceHistoryOperations,
      ),
      recoveryIdentity: currentRecoveryIdentity,
    };
    sourceHistorySessionRef.current.restorePending(
      context,
      job.historyOperations,
    );
    auditPendingRef.current = recoveredEvents;
    commentSessionRef.current.setChangeEvents(mergedEvents);
    documentSessionRef.current.publishAuthority({
      html: recoveredHtml,
      sourceSha256: currentSourceSha256,
      editRevision: revision,
      pendingWrite: job,
    });
    versionSessionRef.current.markSourceEdited();
    invalidateCanvasRenderAcks();
    persistRecoveryLog(job);

    if (canRebaseSafely) {
      documentSessionRef.current.setPersistence({
        state: "queued",
        error: "",
      });
      clearAutosaveTimer();
      autosaveTimerRef.current = window.setTimeout(() => {
        void flushAutosave();
      }, 0);
      setToast({
        title: "已恢复上次未写回的编辑",
        message: "工作台正在把异常退出前的内容安全更新到源 HTML。",
        tone: "info",
        dedupeKey: "autosave-recovery",
      });
    } else {
      await verifyCanvasRendered(recoveredHtml, targetSha256, context);
      if (!isCurrentProjectContext(context)) return false;
      const frozen = fenceAndFreezeCurrentCanvas(
        "恢复记录已加载，但编辑画布尚未就绪。",
      );
      if (!frozen.ok) {
        const failClosedMessage = `恢复记录与当前项目、版本或源文件身份不一致。${frozen.reason}`;
        documentSessionRef.current.setPersistence({
          state: "failed",
          error: failClosedMessage,
        });
        throw new Error(failClosedMessage);
      }
      documentSessionRef.current.setPersistence({
        state: "conflict",
        error: "恢复记录与当前项目、版本或源文件身份不一致，请比较后选择重新载入或导出当前编辑。",
      });
    }
    return true;
  }, [
    clearAutosaveTimer,
    fenceAndFreezeCurrentCanvas,
    flushAutosave,
    invalidateCanvasRenderAcks,
    isCurrentProjectContext,
    persistRecoveryLog,
    verifyCanvasRendered,
  ]);

  const recoverDraftLog = useCallback((
    context: ProjectContext,
    serverComments: CommentItem[],
    serverEvents: DirectEditEvent[],
    serverDraftRevision: number,
    serverDeletedCommentIds: string[],
    serverAppliedOperationIds: string[],
    serverBasedOnVersionId: string | null,
  ): {
    comments: CommentItem[];
    changeEvents: DirectEditEvent[];
    composerDraft: string;
    composerCommentId: string | null;
    composerAttachments: CommentAttachment[];
    composerTarget: HtmlCanvasSelection | null;
    commentEdit: {
      commentId: string;
      draftText: string;
      draftAttachments: CommentAttachment[];
    } | null;
  } => {
    const keys = [
      `html-ai-draft-recovery:${context.documentId}`,
      `html-ai-draft-recovery:${context.sourcePath}`,
    ];
    let latest: Record<string, unknown> | null = null;
    for (const { value: parsed } of recoveryStore.readRecords(keys)) {
        if (
          !isRecord(parsed)
          || String(parsed.sourcePath || "") !== context.sourcePath
          || (parsed.documentId && String(parsed.documentId) !== context.documentId)
          || String(parsed.projectId || "") !== context.projectId
          || String(parsed.documentId || "") !== context.documentId
          || String(parsed.basedOnVersionId || "")
            !== String(serverBasedOnVersionId || "")
        ) continue;
        if (
          !latest
          || Number(parsed.localSequence || 0) > Number(latest.localSequence || 0)
        ) latest = parsed;
    }
    if (!latest) {
      draftRecoveryOperationIdRef.current = null;
      return {
        comments: serverComments,
        changeEvents: serverEvents,
        composerDraft: "",
        composerCommentId: null,
        composerAttachments: [],
        composerTarget: null,
        commentEdit: null,
      };
    }
    const localComments = Array.isArray(latest.comments)
      ? commentsFromRecords(latest.comments)
      : [];
    const recoveredOperationId = isDraftOperationId(latest.operationId)
      ? String(latest.operationId)
      : createDraftOperationId();
    const operationAlreadyApplied =
      serverAppliedOperationIds.includes(recoveredOperationId);
    const localDeletedCommentIds = new Set(
      Array.isArray(latest.deletedCommentIds)
        ? latest.deletedCommentIds.map((value) => String(value))
        : [],
    );
    const rebased = rebaseDraftMutation({
      operationId: recoveredOperationId,
      expectedDraftRevision: Number(latest.baseDraftRevision || 0),
      comments: operationAlreadyApplied ? serverComments : localComments,
      changeEvents: Array.isArray(latest.changeEvents)
        ? (
            operationAlreadyApplied
              ? serverEvents
              : changesFromDraftRecords(latest.changeEvents)
          )
        : serverEvents,
      deletedCommentIds: operationAlreadyApplied
        ? serverDeletedCommentIds
        : [...localDeletedCommentIds],
    }, {
      draftRevision: serverDraftRevision,
      comments: serverComments,
      changeEvents: serverEvents,
      deletedCommentIds: serverDeletedCommentIds,
    });
    commentSessionRef.current.replaceDeletedCommentIds(
      operationAlreadyApplied ? [] : rebased.deletedCommentIds,
    );
    draftRecoveryOperationIdRef.current = operationAlreadyApplied
      ? null
      : recoveredOperationId;
    return {
      comments: rebased.comments,
      changeEvents: rebased.changeEvents,
      composerDraft: typeof latest.composerDraft === "string"
        ? latest.composerDraft
        : "",
      composerCommentId: /^comment_[A-Za-z0-9_-]+$/.test(
        String(latest.composerCommentId || ""),
      )
        ? String(latest.composerCommentId)
        : null,
      composerAttachments: Array.isArray(latest.composerAttachments)
        ? latest.composerAttachments
            .map(attachmentFromRecord)
            .filter((item): item is CommentAttachment => Boolean(item))
        : [],
      composerTarget: isRecord(latest.composerTarget)
        ? selectionFromRecord(latest.composerTarget)
        : null,
      commentEdit: isRecord(latest.commentEdit)
        && /^comment_[A-Za-z0-9_-]+$/.test(
          String(latest.commentEdit.commentId || ""),
        )
        ? {
            commentId: String(latest.commentEdit.commentId),
            draftText: String(latest.commentEdit.draftText || ""),
            draftAttachments: Array.isArray(
              latest.commentEdit.draftAttachments,
            )
              ? latest.commentEdit.draftAttachments
                  .map(attachmentFromRecord)
                  .filter(
                    (item): item is CommentAttachment => Boolean(item),
                  )
              : [],
          }
        : null,
    };
  }, []);

  const refreshWorkspace = useCallback(async (
    sourceOverride?: string | null,
    epochOverride?: number,
    fromDeferred = false,
    sourceTransitionToken?: number,
  ) => {
    // An authorized project hydration already owns the source transition. It
    // must not wait behind a stale native-edit queue from the previous Canvas,
    // otherwise the new project can remain locked forever with no gesture able
    // to drain that queue.
    if (!fromDeferred && sourceTransitionToken === undefined) {
      let resolveDeferred: (() => void) | null = null;
      const deferredResult = new Promise<void>((resolve) => {
        resolveDeferred = resolve;
      });
      if (deferEditorCommand(
        "external-refresh",
        () => {
          const replay = deferredEditorReplayRef.current.refreshWorkspace;
          if (!replay) {
            resolveDeferred?.();
            return;
          }
          replay(
            sourceOverride,
            epochOverride,
            sourceTransitionToken,
            () => resolveDeferred?.(),
          );
        },
        undefined,
        {
          authority: "system",
          onDiscard: () => resolveDeferred?.(),
        },
      )) return deferredResult;
    }
    let activeSource = sourceOverride === undefined ? projectSessionRef.current.sourcePath : sourceOverride;
    if (!activeSource) {
      return;
    }
    let epoch = epochOverride ?? projectSessionRef.current.epoch;
    const workspaceQueryTicket = projectSessionRef.current.beginQuery(
      "workspace",
      { sourcePath: activeSource },
    );
    const workspaceQueryIsCurrent = () => (
      projectSessionRef.current.isQueryCurrent(workspaceQueryTicket)
      && epoch === projectSessionRef.current.epoch
      && sameLocalSourcePath(projectSessionRef.current.sourcePath, activeSource)
    );
    const hydrationSourceTransitionAuthorized =
      sourceTransitionToken !== undefined
      && sourceTransitionToken === epoch
      && sourceTransitionToken === projectSessionRef.current.epoch
      && projectHydratingRef.current;
    let sourceBoundaryFrozen = false;
    let mustAdoptAuthoritativeSource = hydrationSourceTransitionAuthorized;
    let recoveredAutosaveConflict = false;
    try {
      markProjectHydrationStage("workspace-request");
      if (projectHydratingRef.current && !hydrationSourceTransitionAuthorized) {
        throw new Error("这次项目读取缺少与当前项目一致的源码切换令牌。");
      }
      const payload = await bridgeClient.workspace(activeSource);
      markProjectHydrationStage("workspace-response");
      markProjectHydrationStage("workspace-parsed");
      if (!workspaceQueryIsCurrent()) return;

      const nextProjectId = String(payload.projectId || "");
      const nextDocumentId = String(payload.documentId || "");
      const canonicalSourcePath = String(
        payload.sourcePath
        || (isRecord(payload.current) ? payload.current.path : "")
        || activeSource,
      );
      const workspaceHash = String(payload.currentHtmlSha256 || "");
      if (workspaceHash && !/^sha256:[a-f0-9]{64}$/.test(workspaceHash)) {
        throw new Error("项目状态返回的源 HTML Hash 无效。");
      }
      let preparedTransition: PreparedGeneratedSourceTransition | null = null;
      if (!sameLocalSourcePath(canonicalSourcePath, activeSource)) {
        if (!mustAdoptAuthoritativeSource) {
          const frozen = fenceAndFreezeCurrentCanvas(
            "项目状态包含新的源文件，但当前编辑画布尚未就绪。",
          );
          if (!frozen.ok) {
            throw new Error(frozen.reason || "无法在安全收口当前编辑后切换源文件。");
          }
          sourceBoundaryFrozen = true;
        }
        const expectedSha256 = String(payload.currentHtmlSha256 || "");
        const versionId = String(
          payload.currentExactVersionId
          || payload.latestVersionId
          || "",
        );
        if (
          !nextProjectId
          || !nextDocumentId
          || !expectedSha256
          || !versionId
        ) {
          throw new Error("项目已经生成新文件，但缺少切换当前文件所需的完整身份。");
        }
        preparedTransition = await prepareGeneratedSourceTransition({
          previousSourcePath: activeSource,
          nextSourcePath: canonicalSourcePath,
          expectedSha256,
          nextProjectId,
          nextDocumentId,
          versionId,
        });
        if (!preparedTransition.updatesCurrentProject) return;
        if (!workspaceQueryIsCurrent()) return;
        mustAdoptAuthoritativeSource = true;
      }

      const projectRecord = isRecord(payload.project) ? payload.project : {};
      const workspacePaths = isRecord(payload.paths) ? payload.paths : {};
      const currentDocument = documentSessionRef.current.snapshot;
      const currentHtmlSha256 = await browserSha256(currentDocument.html);
      if (!workspaceQueryIsCurrent()) return;
      const currentDocumentClean = Boolean(
        currentDocument.persistState === "idle"
        && currentDocument.editRevision === currentDocument.lastPersistedRevision
        && !documentSessionRef.current.pendingWrite
        && !documentSessionRef.current.flushPromise
      );
      const cleanProjectionMismatch = Boolean(
        currentDocumentClean
        && workspaceHash
        && currentHtmlSha256 !== workspaceHash
      );
      let authoritativeHtml = currentDocument.html;
      let authoritativeSourceHash = currentDocument.sourceSha256 || workspaceHash;
      let authoritativeLastModifiedAt = String(payload.lastModifiedAt || "");
      let sourceAuthorityPayload: Record<string, unknown> | null = null;

      if (preparedTransition?.activatedProject) {
        authoritativeHtml = preparedTransition.activatedProject.html;
        authoritativeSourceHash = preparedTransition.activatedProject.sha256;
        authoritativeLastModifiedAt = String(
          preparedTransition.activatedProject.lastModifiedAt
          || payload.lastModifiedAt
          || "",
        );
      } else if (
        mustAdoptAuthoritativeSource
        || cleanProjectionMismatch
      ) {
        mustAdoptAuthoritativeSource = true;
        markProjectHydrationStage("source-request");
        const sourcePayload = await bridgeClient.source(canonicalSourcePath);
        markProjectHydrationStage("source-response");
        markProjectHydrationStage("source-parsed");
        if (!workspaceQueryIsCurrent()) return;
        if (
          String(sourcePayload.projectId || "") !== nextProjectId
          || String(sourcePayload.documentId || "") !== nextDocumentId
        ) {
          throw new Error("读取期间源文件身份发生变化，已保持只读；请重新打开该文件。");
        }
        authoritativeHtml = String(sourcePayload.content || "");
        authoritativeSourceHash = String(sourcePayload.sha256 || "");
        markProjectHydrationStage("source-hash");
        if (
          !authoritativeSourceHash
          || await browserSha256(authoritativeHtml) !== authoritativeSourceHash
          || (workspaceHash && authoritativeSourceHash !== workspaceHash)
        ) {
          throw new Error("源 HTML 内容与服务端 Hash 不一致，已拒绝开放编辑。");
        }
        if (!workspaceQueryIsCurrent()) return;
        sourceAuthorityPayload = sourcePayload;
        authoritativeLastModifiedAt = String(
          sourcePayload.lastModifiedAt || payload.lastModifiedAt || "",
        );
      } else if (currentDocumentClean && workspaceHash) {
        // Publish the complete tuple even when only metadata needed repair.
        authoritativeSourceHash = workspaceHash;
      } else if (
        workspaceHash
        && currentDocument.sourceSha256
        && workspaceHash !== currentDocument.sourceSha256
      ) {
        throw new Error("本地编辑期间源文件身份发生变化，已停止刷新以保留当前内容。");
      }
      if (!authoritativeSourceHash) {
        throw new Error("项目状态缺少当前源 HTML Hash。");
      }

      if (!workspaceQueryIsCurrent()) return;
      const publishVersionAuthority = () => {
        versionSessionRef.current.hydrate({
          versions: versionsFromWorkspace(payload),
          latestVersionId: payload.latestVersionId,
          currentBasedOnVersionId:
            sourceAuthorityPayload?.currentBasedOnVersionId
            || payload.currentBasedOnVersionId,
          currentExactVersionId:
            sourceAuthorityPayload?.currentExactVersionId
            || payload.currentExactVersionId,
          restoredFromVersionId:
            sourceAuthorityPayload?.restoredFromVersionId
            || payload.restoredFromVersionId
            || projectRecord.restoredFromVersionId,
        });
      };
      let registeredContext: ProjectContext | null = null;
      if (preparedTransition) {
        registeredContext = commitGeneratedSourceTransition({
          prepared: preparedTransition,
          html: authoritativeHtml,
          sourceSha256: authoritativeSourceHash,
          publishVersion: publishVersionAuthority,
        });
      } else {
        registeredContext = projectSessionRef.current.register({
          epoch,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          sourcePath: activeSource,
        });
        if (!registeredContext) return;
        if (
          mustAdoptAuthoritativeSource
          || authoritativeHtml !== currentDocument.html
        ) {
          documentSessionRef.current.publishAuthority({
            html: authoritativeHtml,
            sourceSha256: authoritativeSourceHash,
          });
          invalidateCanvasRenderAcks();
        } else {
          documentSessionRef.current.update({
            html: authoritativeHtml,
            sourceSha256: authoritativeSourceHash,
          });
        }
        publishVersionAuthority();
      }
      if (!registeredContext) return;
      activeSource = registeredContext.sourcePath;
      epoch = registeredContext.epoch;
      recoveryIdentityRef.current =
        recoveryIdentityFromRecord(payload.recoveryIdentity);
      if (projectRecord.displayName) {
        setProjectName(String(projectRecord.displayName));
      }
      setProjectRecordsPath(
        String(
          workspacePaths.projectRecords
          || payload.projectRoot
          || "",
        ) || null,
      );
      setLastModifiedAt(authoritativeLastModifiedAt);

      const runtime = isRecord(payload.runtimeState) ? payload.runtimeState : {};
      const runtimeConflict = isRecord(runtime.conflict) ? runtime.conflict : null;
      const edit = isRecord(runtime.edit) ? runtime.edit : {};
      const serverRevision = Number(runtime.editRevision || edit.editRevision || 0);
      const serverPersistedRevision = Number(
        runtime.lastPersistedRevision
        || edit.lastPersistedRevision
        || serverRevision,
      );
      documentSessionRef.current.update({
        editRevision: Math.max(
          documentSessionRef.current.editRevision,
          serverRevision,
        ),
        lastPersistedRevision: Math.max(
          documentSessionRef.current.lastPersistedRevision,
          serverPersistedRevision,
        ),
      });

      const draftRecord = draftAuthorityFromWorkspace(payload);
      const serverDraftRevision = authoritativeDraftRevision(draftRecord);
      let recoveredEvents = commentSessionRef.current.changeEvents;
      const draftContext = registeredContext;
      if (
        nextProjectId
        && nextDocumentId
        && authoritativeSourceHash
        && isRecord(payload.sourceHistory)
      ) {
        sourceHistorySessionRef.current.activate(
          draftContext,
          authoritativeSourceHash,
          payload.sourceHistory,
          { preservePending: Boolean(documentSessionRef.current.pendingWrite) },
        );
      }
      const draftSession = draftSessionRef.current;
      const canApplyDraftAuthority = !draftSession.isActive(draftContext)
        || serverDraftRevision >= draftSession.revision;
      if (canApplyDraftAuthority) {
        draftSession.activate(draftContext, serverDraftRevision, draftRecord);
        const recoveredDraft = recoverDraftLog(draftContext,
        commentsFromRecords(draftRecord.comments),
        changesFromDraftRecords(draftRecord.changeEvents),
        draftSession.revision,
        Array.isArray(draftRecord.deletedCommentIds)
          ? draftRecord.deletedCommentIds.map((value) => String(value))
          : [],
        Array.isArray(draftRecord.appliedOperationIds)
          ? draftRecord.appliedOperationIds.map((value) => String(value))
          : [],
        payload.currentBasedOnVersionId
          ? String(payload.currentBasedOnVersionId)
          : null);
        const recoveredCommentTargets = rebindTargetsPreservingGlobal(
          documentSessionRef.current.html,
          [
            ...recoveredDraft.comments.map((comment) => comment.target),
            ...(recoveredDraft.composerTarget ? [recoveredDraft.composerTarget] : []),
          ],
        );
        const recoveredTargetById = new Map(
          recoveredCommentTargets.map((target) => [target.id, target]),
        );
        const recoveredComments = recoveredDraft.comments.map((comment) => ({
          ...comment,
          target: recoveredTargetById.get(comment.target.id) || {
            ...comment.target,
            resolution: "orphaned" as const,
          },
        }));
        recoveredEvents = recoveredDraft.changeEvents;
        const recoveredEditComment = recoveredDraft.commentEdit
          ? recoveredComments.find(
              (comment) => (
                comment.commentId === recoveredDraft.commentEdit?.commentId
              ),
            ) ?? null
          : null;
        const recoveredEditSession = (
          recoveredDraft.commentEdit
          && recoveredEditComment
        )
          ? {
              commentId: recoveredEditComment.commentId,
              baselineText: recoveredEditComment.text,
              baselineAttachments: [
                ...(recoveredEditComment.attachments ?? []),
              ],
              draftText: recoveredDraft.commentEdit.draftText,
              draftAttachments: [
                ...recoveredDraft.commentEdit.draftAttachments,
              ],
            }
          : null;
        const nextRecoveredEditSession = (
          commentEditSessionHasChanges(recoveredEditSession)
            ? recoveredEditSession
            : null
        );
        commentEditResumePendingRef.current = null;
        setEditingCommentId(null);
        const recoveredComposerTarget = recoveredDraft.composerTarget
          ? recoveredTargetById.get(recoveredDraft.composerTarget.id)
            || { ...recoveredDraft.composerTarget, resolution: "orphaned" as const }
          : null;
        commentSessionRef.current.update({
          comments: recoveredComments,
          changeEvents: recoveredEvents,
          composerDraft: recoveredDraft.composerDraft,
          composerCommentId: recoveredDraft.composerCommentId,
          composerAttachments: recoveredDraft.composerAttachments,
          composerTarget: recoveredComposerTarget,
          editSession: nextRecoveredEditSession,
        });
        setComposerOpen(false);
      }

      const recoveredRunRecord = isRecord(runtime.activeRun)
        ? runtime.activeRun
        : isRecord(payload.activeRun)
          ? payload.activeRun
          : null;
      const recoveredRun = activeRunFromRecord(
        recoveredRunRecord
          ? { ...recoveredRunRecord, ...(runtimeConflict ? { conflict: runtimeConflict } : {}) }
          : null,
      );
      const recoveredOutcome = activeRunFromRecord(payload.recentRunOutcome);
      if (recoveredOutcome) {
        runSessionRef.current.rememberOutcome(recoveredOutcome);
      } else if (!recoveredRun) {
        runSessionRef.current.forgetOutcome(activeSource);
      }
      if (recoveredRun && isLockedLifecycleState(recoveredRun.status)) {
        runSessionRef.current.trackRun(recoveredRun, { recovered: true });
        if (projectHydratingRef.current) {
          setHandoffPreviewOpen(false);
          setCanvasMode("edit");
          setDrawer("handoff");
        }
      } else {
        const trackedRun = runSessionRef.current.runForSource(activeSource);
        if (trackedRun) runSessionRef.current.removeRun(trackedRun);
        else {
          const visibleTerminal = runSessionRef.current.activeRun;
          const keepVisibleTerminal = Boolean(
            recoveredOutcome
            && visibleTerminal
            && ["error", "no-change"].includes(visibleTerminal.status)
            && visibleTerminal.requestId === recoveredOutcome.requestId
            && visibleTerminal.attemptId === recoveredOutcome.attemptId,
          );
          if (!keepVisibleTerminal) runSessionRef.current.clearActiveRun();
        }
        if (!sourceBoundaryFrozen && !projectHydratingRef.current) {
          editorRef.current?.unlockNow?.();
        }
      }
      if (hydrationSourceTransitionAuthorized && authoritativeSourceHash) {
        markProjectHydrationStage("recovery");
        const context: ProjectContext = {
          epoch,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          sourcePath: activeSource,
        };
        const recoveredLocally = await recoverAutosaveLog(
          context,
          authoritativeSourceHash,
          serverRevision,
        );
        if (!isCurrentProjectContext(context)) return;
        if (
          !recoveredLocally
          && runtimeConflict
          && String(runtimeConflict.type || "") === "autosave-source"
        ) {
          const conflictPayload = await bridgeClient
            .conflictCandidate(activeSource)
            .catch((): Record<string, unknown> => ({}));
          if (
            isCurrentProjectContext(registeredContext)
            && typeof conflictPayload.content === "string"
          ) {
            const candidateHtml = conflictPayload.content;
            const candidateHash = await browserSha256(candidateHtml);
            if (
              candidateHash !== String(conflictPayload.sha256 || "")
              || !isCurrentProjectContext(context)
            ) {
              throw new Error("恢复候选的内容 Hash 与冲突记录不一致。");
            }
            const revision = Math.max(
              serverRevision,
              Number(conflictPayload.editRevision || runtimeConflict.editRevision || 0),
            );
            const conflictWrite: PendingWrite = {
              ...context,
              expectedSourceSha256: String(
                conflictPayload.expectedSourceSha256
                || runtimeConflict.expectedSourceSha256
                || "",
              ),
              html: candidateHtml,
              revision,
              events: recoveredEvents,
              historyOperations: [],
              recoveryIdentity: recoveryIdentityRef.current,
            };
            documentSessionRef.current.publishAuthority({
              html: candidateHtml,
              sourceSha256: authoritativeSourceHash,
              editRevision: revision,
              pendingWrite: conflictWrite,
            });
            versionSessionRef.current.markSourceEdited();
            invalidateCanvasRenderAcks();
            persistRecoveryLog(conflictWrite, context);
          }
          recoveredAutosaveConflict = true;
        }
      }
      if (mustAdoptAuthoritativeSource) {
        markProjectHydrationStage("canvas-hash");
        const expectedCanvasHtml = documentSessionRef.current.html;
        const expectedCanvasHash = await browserSha256(expectedCanvasHtml);
        markProjectHydrationStage("canvas-verify");
        await verifyCanvasRendered(expectedCanvasHtml, expectedCanvasHash, {
          epoch,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          sourcePath: activeSource,
        });
        if (
          epoch !== projectSessionRef.current.epoch
          || !sameLocalSourcePath(projectSessionRef.current.sourcePath, activeSource)
        ) return;
      }
      if (recoveredAutosaveConflict) {
        const frozen = fenceAndFreezeCurrentCanvas(
          "冲突候选已恢复，但编辑画布尚未就绪。",
        );
        if (!frozen.ok) {
          throw new Error(frozen.reason || "无法冻结已恢复的冲突候选。");
        }
        documentSessionRef.current.setPersistence({
          state: "conflict",
          error: "源 HTML 在自动写回前被外部修改。工作台候选和外部文件均已保留，请比较后重新载入或导出当前编辑。",
        });
      }
      projectHydratingRef.current = false;
      projectLoadErrorRef.current = null;
      setProjectHydrating(false);
      setProjectLoadError(null);
      markProjectHydrationStage("ready");
      if (
        sourceBoundaryFrozen
        && !recoveredAutosaveConflict
        && !runSessionRef.current.activeLocked
      ) {
        window.requestAnimationFrame(() => editorRef.current?.unlockNow?.());
      }
    } catch (cause) {
      if (epoch === projectSessionRef.current.epoch) {
        const message = productErrorMessage(
          cause,
          "项目状态暂时无法读取，请重试；源文件没有被改动。",
        );
        projectHydratingRef.current = false;
        projectLoadErrorRef.current = message;
        setProjectHydrating(false);
        setProjectLoadError(message);
        invalidateCanvasRenderAcks();
        markProjectHydrationStage("failed");
      }
    } finally {
      // Every authorized hydration must release its own lock, including a
      // harmless early return while it still owns the current identity. A
      // newer project epoch remains solely responsible for its hydration.
      if (
        hydrationSourceTransitionAuthorized
        && projectHydratingRef.current
        && epoch === projectSessionRef.current.epoch
        && sameLocalSourcePath(projectSessionRef.current.sourcePath, activeSource)
      ) {
        projectHydratingRef.current = false;
        setProjectHydrating(false);
        markProjectHydrationStage("released");
      }
    }
  }, [
    commitGeneratedSourceTransition,
    deferEditorCommand,
    fenceAndFreezeCurrentCanvas,
    invalidateCanvasRenderAcks,
    isCurrentProjectContext,
    persistRecoveryLog,
    prepareGeneratedSourceTransition,
    recoverAutosaveLog,
    recoverDraftLog,
    verifyCanvasRendered,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.refreshWorkspace = (
      sourceOverride,
      epochOverride,
      sourceTransitionToken,
      resolve,
    ) => {
      void refreshWorkspace(
        sourceOverride,
        epochOverride,
        true,
        sourceTransitionToken,
      ).then(resolve, resolve);
    };
  }, [refreshWorkspace]);

  const hydrateRecentProjectRuns = useCallback(async (
    projects: RecentProject[],
    activeSourcePath: string | null,
  ) => {
    const sourcePaths = [...new Set(
      projects
        .map((project) => project.sourcePath)
        .filter((value) => value && !sameLocalSourcePath(value, activeSourcePath)),
    )];
    await Promise.allSettled(sourcePaths.map(async (recentSourcePath) => {
      const payload = await bridgeClient.workspace(recentSourcePath);
      const runtime = isRecord(payload.runtimeState) ? payload.runtimeState : {};
      const runtimeConflict = isRecord(runtime.conflict) ? runtime.conflict : null;
      const recoveredRunRecord = isRecord(runtime.activeRun)
        ? runtime.activeRun
        : isRecord(payload.activeRun)
          ? payload.activeRun
          : null;
      const recoveredRun = activeRunFromRecord(
        recoveredRunRecord
          ? { ...recoveredRunRecord, ...(runtimeConflict ? { conflict: runtimeConflict } : {}) }
          : null,
      );
      const recoveredOutcome = activeRunFromRecord(payload.recentRunOutcome);
      if (recoveredOutcome) {
        runSessionRef.current.rememberOutcome(recoveredOutcome);
      }
      if (recoveredRun && isLockedLifecycleState(recoveredRun.status)) {
        runSessionRef.current.trackRun(recoveredRun, {
          activate: "never",
          recovered: true,
        });
      }
    }));
  }, []);

  useEffect(() => {
    let cancelled = false;
    const startupOpenRequest = projectOpenRequestRef.current;
    const api = window.htmlAIProjects;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (!api) {
        return;
      }
      void Promise.allSettled([api.getActiveProject(), api.listRecentProjects()])
        .then(async ([activeResult, recentResult]) => {
          if (
            cancelled
            || startupOpenRequest !== projectOpenRequestRef.current
          ) return;
          const recent = recentResult.status === "fulfilled"
            ? recentResult.value
            : [];
          setRecentProjects(recent);
          setRecentProjectsError(
            recentResult.status === "rejected"
              ? productErrorMessage(
                  recentResult.reason,
                  "最近打开记录暂时无法读取。",
                )
              : "",
          );
          const active = activeResult.status === "fulfilled"
            ? activeResult.value
            : null;
          if (activeResult.status === "rejected") {
            setStartupIssue({
              title: "上次打开的 HTML 无法恢复",
              message: productErrorMessage(
                activeResult.reason,
                "文件可能已移动、删除或损坏。源页没有打开其他内容来替代它。",
              ),
            });
          } else {
            setStartupIssue(null);
          }
          void hydrateRecentProjectRuns(recent, active?.sourcePath || null);
          if (active) {
            applyProject(active);
            const epoch = projectSessionRef.current.epoch;
            await refreshWorkspace(active.sourcePath, epoch, false, epoch);
            await refreshRecents();
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyProject, hydrateRecentProjectRuns, refreshRecents, refreshWorkspace]);

  useEffect(() => {
    if (!toast) return;
    if (noticeTimerPaused) return;
    const dismissAfter = noticeAutoDismissMs(toast);
    if (dismissAfter === null) return;
    const timeout = window.setTimeout(() => {
      captureUsageEvent("notification_interacted", {
        notice_code: noticeUsageCode(toast.dedupeKey),
        interaction: "auto-dismiss",
        surface: "global",
      }, projectSessionRef.current.projectId || undefined);
      setToast(null);
    }, dismissAfter);
    return () => window.clearTimeout(timeout);
  }, [noticeTimerPaused, toast]);

  useEffect(() => {
    if (!previewAttachment) return;
    const closePreview = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewAttachment(null);
    };
    document.addEventListener("keydown", closePreview);
    return () => document.removeEventListener("keydown", closePreview);
  }, [previewAttachment]);

  useEffect(() => {
    if (!drawer || previewAttachment) return;
    const closeDrawer = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) setDrawer(null);
    };
    window.addEventListener("keydown", closeDrawer);
    return () => window.removeEventListener("keydown", closeDrawer);
  }, [drawer, previewAttachment]);

  const handleDraftSessionEvent = useCallback((
    event: DraftSessionEvent<CommentItem, DirectEditEvent>,
  ) => {
    if (event.type === "failed") {
      if (!isCurrentProjectContext(event.write)) return;
      setDraftPersistError(productErrorMessage(
        event.error,
        "本轮评论自动恢复后仍无法记录，请稍后重试。",
      ));
      return;
    }
    if (event.type !== "acknowledged") return;
    if (!isCurrentProjectContext(event.write)) return;

    const acknowledgedComments = commentsFromRecords(
      event.authoritative.comments,
    );
    const acknowledgedEvents = changesFromDraftRecords(
      event.authoritative.changeEvents,
    );
    const sessionState = draftSessionRef.current.inspect();
    setDraftPersistError("");
    if (!sessionState.pending) {
      if (event.rebaseCount > 0) {
        commentSessionRef.current.update({
          comments: acknowledgedComments,
          changeEvents: acknowledgedEvents,
          deletedCommentIds: [],
        });
      } else {
        commentSessionRef.current.clearDeletedCommentIds();
      }
      persistDraftRecovery({
        ...event.write,
        expectedDraftRevision: event.authoritative.draftRevision,
        comments: acknowledgedComments,
        changeEvents: acknowledgedEvents,
        deletedCommentIds: [],
      });
    }
  }, [isCurrentProjectContext, persistDraftRecovery]);

  useEffect(() => {
    const session = draftSessionRef.current;
    session.setObserver(handleDraftSessionEvent);
    return () => session.setObserver(null);
  }, [handleDraftSessionEvent]);

  const flushDraftPersistence = useCallback(async (
    snapshot?: PendingDraft,
  ): Promise<boolean> => draftSessionRef.current.drain(snapshot), []);

  useEffect(() => {
    const coordinator = drainCoordinatorRef.current;
    coordinator.replace("external-file-open", {
      label: "等待外部 HTML 打开完成",
      inspect: (boundary) => (
        boundary === "close"
        && externalFileOpenSessionRef.current.snapshot.status !== "idle"
      )
        ? {
            state: "pending",
            reason: "外部 HTML 正在读取或等待安全切换。",
          }
        : { state: "resolved" },
      drain: () => waitUntilResolved(
        () => externalFileOpenSessionRef.current.snapshot.status === "idle",
      ),
    });
    coordinator.replace("project-application", {
      label: "等待已接收的 HTML 切换完成",
      inspect: (boundary) => (
        boundary === "close"
        && projectApplicationSessionRef.current.snapshot.status !== "idle"
      )
        ? {
            state: "pending",
            reason: "已接收的 HTML 仍在完成安全切换。",
          }
        : { state: "resolved" },
      drain: () => waitUntilResolved(
        () => projectApplicationSessionRef.current.snapshot.status === "idle",
      ),
    });
    coordinator.replace("project-hydration", {
      label: "等待项目读取完成",
      inspect: (boundary) => (
        boundary === "switch" && projectHydratingRef.current
      )
        ? {
            state: "pending",
            reason: "当前项目仍在读取，不能开始新的项目切换。",
          }
        : { state: "resolved" },
    });
    coordinator.replace("view-transition", {
      label: "等待页面切换完成",
      inspect: (boundary) => (
        viewTransitioningRef.current && boundary !== "history"
      )
        ? {
            state: "blocked",
            reason: "正在核对历史或当前 HTML，请等待本次切换完成后再继续。",
          }
        : { state: "resolved" },
    });
    coordinator.replace("submission", {
      label: "等待本轮提交准备结束",
      inspect: (boundary) => (
        boundary !== "submit"
        && runSessionRef.current.submissionPending
          ? { state: "pending", reason: "内部 AI 的冻结 Request 尚未安全建立。" }
          : { state: "resolved" }
      ),
      drain: () => waitUntilResolved(
        () => !runSessionRef.current.submissionPending,
      ),
    });
    coordinator.replace("attachments", {
      label: "等待附件添加完成",
      inspect: () => attachmentUploadCountRef.current > 0
        ? { state: "pending", reason: "评论附件仍在写入项目记录。" }
        : { state: "resolved" },
      drain: () => waitUntilResolved(
        () => attachmentUploadCountRef.current === 0,
      ),
    });
    coordinator.replace("project-rules", {
      label: "等待项目规则保存",
      inspect: () => projectRulesSessionRef.current.inspect({
        locked: runSessionRef.current.activeLocked,
      }),
      drain: () => saveProjectRulesRef.current(),
    });
    coordinator.replace("source", {
      label: "等待当前 HTML 写回",
      inspect: (boundary) => {
        if (
          runSessionRef.current.activeLocked
          && boundary !== "submit"
        ) return { state: "resolved" };
        if (!projectSessionRef.current.sourcePath && documentSessionRef.current.editRevision > 0) {
          return {
            state: "blocked",
            reason: "当前编辑尚未绑定本地 HTML，请先导出或打开本地文件。",
          };
        }
        if (documentSessionRef.current.persistState === "conflict") {
          return {
            state: "blocked",
            reason: "当前 HTML 与外部文件存在冲突，请先选择保留哪一份。",
          };
        }
        if (documentSessionRef.current.persistState === "failed") {
          return {
            state: "blocked",
            reason: documentSessionRef.current.persistError
              || "当前 HTML 尚未安全写回，请先处理保存失败。",
          };
        }
        if (
          documentSessionRef.current.pendingWrite
          || documentSessionRef.current.flushPromise
          || historyActionPromiseRef.current
          || documentSessionRef.current.editRevision > documentSessionRef.current.lastPersistedRevision
        ) {
          return {
            state: "pending",
            reason: "当前 HTML 仍有修改尚未安全写回源文件。",
          };
        }
        return { state: "resolved" };
      },
      drain: async () => {
        if (
          historyActionPromiseRef.current
          && !await historyActionPromiseRef.current
        ) return false;
        return flushAutosave(documentSessionRef.current.editRevision);
      },
    });
    coordinator.replace("draft", {
      label: "等待评论记录写入",
      alwaysDrain: true,
      inspect: (boundary) => {
        const hasLocalDraftMaterial = Boolean(
          commentSessionRef.current.comments.length > 0
          || commentSessionRef.current.changeEvents.length > 0
          || commentSessionRef.current.deletedCommentIds.size > 0
          || commentSessionRef.current.composerDraft.trim()
          || commentSessionRef.current.composerAttachments.length > 0
          || commentSessionRef.current.composerTarget
          || commentEditSessionHasChanges(commentSessionRef.current.editSession)
        );
        if (
          (runSessionRef.current.activeLocked && boundary !== "submit")
          || projectLoadErrorRef.current
        ) return { state: "resolved" };
        if (!captureProjectContext()) {
          return hasLocalDraftMaterial
            ? {
                state: "pending",
                reason: "正在为本轮评论建立唯一项目身份。",
              }
            : { state: "resolved" };
        }
        const draftState = draftSessionRef.current.inspect();
        if (!draftState.active) {
          return {
            state: "pending",
            reason: "正在重新核对本轮评论的项目身份。",
          };
        }
        if (
          draftState.pending
          || draftState.writing
          || draftState.error
        ) {
          return {
            state: "pending",
            reason: "本轮评论或编辑审计仍未安全记录。",
          };
        }
        return { state: "resolved" };
      },
      drain: async ({ boundary }) => {
        const hasLocalDraftMaterial = Boolean(
          commentSessionRef.current.comments.length > 0
          || commentSessionRef.current.changeEvents.length > 0
          || commentSessionRef.current.deletedCommentIds.size > 0
          || commentSessionRef.current.composerDraft.trim()
          || commentSessionRef.current.composerAttachments.length > 0
          || commentSessionRef.current.composerTarget
          || commentEditSessionHasChanges(commentSessionRef.current.editSession)
        );
        let context = captureProjectContext();
        if (
          (runSessionRef.current.activeLocked && boundary !== "submit")
          || projectLoadErrorRef.current
        ) return true;
        if (!context && !hasLocalDraftMaterial) return true;
        if (!context) {
          context = registrationContextFromOutcome(
            await workspaceController.ensureRegistered(),
          );
          if (!context) {
            throw new Error("无法为本轮评论建立唯一项目身份。");
          }
        } else if (!draftSessionRef.current.isActive(context)) {
          context = registrationContextFromOutcome(
            await workspaceController.ensureRegistered({
              sourcePath: context.sourcePath,
              expectedSourceSha256: documentSessionRef.current.sourceSha256,
              adoptCanonicalSource: false,
            }),
          );
          if (!context || !draftSessionRef.current.isActive(context)) {
            throw new Error("无法恢复本轮评论的项目身份。");
          }
        }
        const snapshot = draftSessionRef.current.createSnapshot({
          context,
          basedOnVersionId:
            versionSessionRef.current.snapshot.currentBasedOnVersionId,
          comments: commentSessionRef.current.comments,
          changeEvents: commentSessionRef.current.changeEvents,
          deletedCommentIds: commentSessionRef.current.deletedCommentIds,
          operationId: draftRecoveryOperationIdRef.current || undefined,
        });
        if (!snapshot) {
          const activeContext = draftSessionRef.current.context;
          const mismatches = [
            activeContext?.epoch !== context.epoch ? "project-epoch" : "",
            activeContext?.projectId !== context.projectId ? "project-id" : "",
            activeContext?.documentId !== context.documentId ? "document-id" : "",
            activeContext?.sourcePath !== context.sourcePath ? "source-path" : "",
          ].filter(Boolean);
          throw new Error(
            `评论会话与当前项目身份不一致（${mismatches.join(", ") || "inactive"}）。`,
          );
        }
        draftRecoveryOperationIdRef.current = null;
        persistDraftRecovery(snapshot);
        const persisted = await flushDraftPersistence(snapshot);
        if (!persisted) {
          throw draftSessionRef.current.lastError
            || new Error("本轮评论或编辑审计没有完成安全记录。");
        }
        return true;
      },
    });
    coordinator.replace("native-edit", {
      label: "等待当前文字输入收口",
      inspect: () => editorRef.current?.hasPendingNativeEdit()
        ? {
            state: "pending",
            reason: "当前文字尚未完成输入，不能离开编辑画布。",
          }
        : { state: "resolved" },
    });
  }, [
    captureProjectContext,
    flushAutosave,
    flushDraftPersistence,
    persistDraftRecovery,
    workspaceController,
  ]);

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
    const activeSource = projectSessionRef.current.sourcePath;
    if (!activeSource) throw new Error("当前评论还没有绑定本地项目。");
    return bridgeClient.attachment(activeSource, attachment.relativePath);
  }, []);

  const ensureAttachmentObjectUrl = useCallback(async (
    attachment: CommentAttachment,
  ): Promise<string> => {
    const existing = attachmentObjectUrlsRef.current.get(attachment.attachmentId);
    if (existing) return existing;
    const objectUrl = URL.createObjectURL(await attachmentBlob(attachment));
    rememberAttachmentObjectUrl(attachment.attachmentId, objectUrl);
    return objectUrl;
  }, [attachmentBlob, rememberAttachmentObjectUrl]);

  const deleteAttachmentFile = useCallback(async (
    attachment: CommentAttachment,
    context: ProjectContext | null = captureProjectContext(),
  ) => {
    if (!context) return;
    try {
      await bridgeClient.deleteAttachment({
        projectId: context.projectId,
        documentId: context.documentId,
        sourcePath: context.sourcePath,
        relativePath: attachment.relativePath,
      });
    } catch (cause) {
      setToast({
        title: "附件已从评论移除",
        message: productErrorMessage(cause, "项目中的附件副本暂时无法清理。"),
        tone: "warning",
        dedupeKey: `attachment-cleanup-${attachment.attachmentId}`,
      });
    }
  }, [captureProjectContext]);

  const removeComposerAttachment = useCallback((attachment: CommentAttachment) => {
    const next = commentSessionRef.current.composerAttachments.filter(
      (item) => item.attachmentId !== attachment.attachmentId,
    );
    commentSessionRef.current.setComposerAttachments(next);
    forgetAttachmentObjectUrl(attachment.attachmentId);
    persistCurrentDraftRecovery();
    void deleteAttachmentFile(attachment);
  }, [deleteAttachmentFile, forgetAttachmentObjectUrl, persistCurrentDraftRecovery]);

  const removeCommentAttachment = useCallback((
    commentId: string,
    attachment: CommentAttachment,
  ) => {
    const current = commentSessionRef.current.editSession;
    if (!current || current.commentId !== commentId) return;
    const wasSavedBeforeEdit = current.baselineAttachments.some(
      (item) => item.attachmentId === attachment.attachmentId,
    );
    const nextSession = {
      ...current,
      draftAttachments: current.draftAttachments.filter(
        (item) => item.attachmentId !== attachment.attachmentId,
      ),
    };
    commentSessionRef.current.setEditSession(nextSession);
    forgetAttachmentObjectUrl(attachment.attachmentId);
    persistCurrentDraftRecovery();
    if (!wasSavedBeforeEdit) {
      void deleteAttachmentFile(attachment);
    }
  }, [
    deleteAttachmentFile,
    forgetAttachmentObjectUrl,
    persistCurrentDraftRecovery,
  ]);

  const uploadAttachments = useCallback(async (
    files: File[],
    target: { kind: "composer" | "comment"; commentId: string },
    source: "clipboard" | "file-picker",
  ) => {
    if (files.length === 0) return;
    const targetIsOpen = target.kind === "composer"
      ? commentSessionRef.current.composerCommentId === target.commentId
      : (
          commentSessionRef.current.editSession?.commentId === target.commentId
          && commentSessionRef.current.comments.some(
            (comment) => comment.commentId === target.commentId,
          )
        );
    if (!targetIsOpen) return;
    const existingCount = target.kind === "composer"
      ? commentSessionRef.current.composerAttachments.length
      : commentSessionRef.current.editSession?.draftAttachments.length ?? 0;
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
    const attachmentPersistence =
      runtimeCapabilitiesRef.current.attachmentPersistence;
    if (attachmentPersistence === "memory") {
      const memoryAttachments = selected.map((file) => {
        const attachmentId = recordId("attachment", attachmentCounter.current++);
        const attachment: CommentAttachment = {
          attachmentId,
          kind: isImageFile(file) ? "image" : "file",
          fileName: file.name || "附件",
          mediaType: file.type || "application/octet-stream",
          byteLength: file.size,
          sha256: `memory:${attachmentId}`,
          relativePath: `memory/${attachmentId}/${file.name || "attachment"}`,
          source,
        };
        if (attachment.kind === "image") {
          rememberAttachmentObjectUrl(attachmentId, URL.createObjectURL(file));
        }
        return attachment;
      });
      if (target.kind === "composer") {
        const next = [...commentSessionRef.current.composerAttachments, ...memoryAttachments];
        commentSessionRef.current.setComposerAttachments(next);
      } else {
        const current = commentSessionRef.current.editSession;
        if (!current || current.commentId !== target.commentId) return;
        const nextSession = {
          ...current,
          draftAttachments: [
            ...current.draftAttachments,
            ...memoryAttachments,
          ],
        };
        commentSessionRef.current.setEditSession(nextSession);
        persistCurrentDraftRecovery();
      }
      addedAttachmentCount = memoryAttachments.length;
      if (issueNotes.length > 0) {
        const needsRemoval = attachmentPlan.overLimit.length > 0
          && existingCount + addedAttachmentCount >= MAX_COMMENT_ATTACHMENTS;
        setToast({
          title: addedAttachmentCount > 0
            ? "部分附件没有加入"
            : "附件没有加入",
          message: `${issueNotes.join("；")}。${
            addedAttachmentCount > 0
              ? needsRemoval
                ? "已加入的附件仍然保留；如需加入其余文件，请先移除一个附件。"
                : "已加入的附件仍然保留。"
              : needsRemoval
                ? "请先移除一个附件，再重新选择。"
                : "请选择其他文件。"
          }`,
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: `attachment-batch-${target.commentId}`,
          action: attachmentRecoveryAction(needsRemoval),
        });
      }
      return;
    }
    if (attachmentPersistence !== "bridge") return;
    const activeSource = projectSessionRef.current.sourcePath;
    if (!activeSource) {
      setToast({
        title: "请先打开本地 HTML",
        message: "附件需要保存在当前项目记录中；打开 HTML 后即可添加。",
        tone: "warning",
        disposition: "direct-action",
        dedupeKey: "submit-blocked",
        action: { id: "retry-project-open", label: "打开本地 HTML" },
      });
      return;
    }
    let attachmentContext: ProjectContext;
    try {
      const registered = registrationContextFromOutcome(
        await workspaceController.ensureRegistered({ sourcePath: activeSource }),
      );
      if (!registered) throw new Error("当前项目已经切换，请重试。");
      attachmentContext = registered;
    } catch (cause) {
      setToast({
        title: "附件尚未加入",
        message: productErrorMessage(
          cause,
          "项目资料暂时无法建立；附件没有丢失，请重试选择。",
        ),
        tone: "warning",
        disposition: "direct-action",
        dedupeKey: "submit-blocked",
        action: {
          id: "open-attachment-picker",
          label: "重新选择",
          target,
        },
      });
      return;
    }
    for (const originalFile of selected) {
      const file = source === "clipboard" && !originalFile.name
        ? new File(
            [originalFile],
            `粘贴图片-${Date.now()}.${originalFile.type.split("/")[1] || "png"}`,
            { type: originalFile.type || "image/png" },
          )
        : originalFile;
      attachmentUploadCountRef.current += 1;
      setAttachmentUploadCount(attachmentUploadCountRef.current);
      try {
        const attachmentId = recordId("attachment", attachmentCounter.current++);
        const payload = await bridgeClient.saveAttachment({
          projectId: attachmentContext.projectId,
          documentId: attachmentContext.documentId,
          sourcePath: attachmentContext.sourcePath,
          commentId: target.commentId,
          attachmentId,
          fileName: file.name || "附件",
          mediaType: file.type || "application/octet-stream",
          byteLength: file.size,
          kind: isImageFile(file) ? "image" : "file",
          source,
          dataBase64: await fileAsBase64(file),
        });
        const attachment = attachmentFromRecord(
          isRecord(payload.attachment) ? payload.attachment : null,
        );
        if (!attachment) throw new Error("附件已写入，但返回的记录不完整。");
        if (target.kind === "composer") {
          if (commentSessionRef.current.composerCommentId !== target.commentId) {
            void deleteAttachmentFile(attachment, attachmentContext);
            continue;
          }
          if (attachment.kind === "image") {
            rememberAttachmentObjectUrl(
              attachment.attachmentId,
              URL.createObjectURL(file),
            );
          }
          const next = [...commentSessionRef.current.composerAttachments, attachment];
          commentSessionRef.current.setComposerAttachments(next);
          persistCurrentDraftRecovery();
          addedAttachmentCount += 1;
        } else {
          const current = commentSessionRef.current.editSession;
          if (
            !current
            || current.commentId !== target.commentId
            || !commentSessionRef.current.comments.some(
              (comment) => comment.commentId === target.commentId,
            )
          ) {
            void deleteAttachmentFile(attachment, attachmentContext);
            continue;
          }
          if (attachment.kind === "image") {
            rememberAttachmentObjectUrl(
              attachment.attachmentId,
              URL.createObjectURL(file),
            );
          }
          const nextSession = {
            ...current,
            draftAttachments: [...current.draftAttachments, attachment],
          };
          commentSessionRef.current.setEditSession(nextSession);
          persistCurrentDraftRecovery();
          addedAttachmentCount += 1;
        }
      } catch (cause) {
        failedNames.push(file.name || "未命名文件");
        if (failedNames.length === 1) {
          issueNotes.push(productErrorMessage(
            cause,
            "本地项目资料暂时没有响应。",
          ));
        }
      } finally {
        attachmentUploadCountRef.current = Math.max(
          0,
          attachmentUploadCountRef.current - 1,
        );
        setAttachmentUploadCount(attachmentUploadCountRef.current);
      }
    }
    if (failedNames.length > 0) {
      issueNotes.push(`${failedNames.join("、")} 未加入评论`);
    }
    if (issueNotes.length > 0) {
      const targetStillOpen = target.kind === "composer"
        ? commentSessionRef.current.composerCommentId === target.commentId
        : commentSessionRef.current.editSession?.commentId === target.commentId;
      const currentAttachmentCount = target.kind === "composer"
        ? commentSessionRef.current.composerAttachments.length
        : commentSessionRef.current.editSession?.draftAttachments.length ?? 0;
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
    deleteAttachmentFile,
    persistCurrentDraftRecovery,
    rememberAttachmentObjectUrl,
    workspaceController,
  ]);

  const openAttachmentPicker = useCallback((
    target: { kind: "composer" | "comment"; commentId: string },
    accept: "all" | "image" = "all",
  ) => {
    attachmentInputTargetRef.current = target;
    const input = attachmentInputRef.current;
    if (!input) return;
    input.accept = accept === "image" ? "image/*" : "";
    input.value = "";
    try {
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
    } catch {
      input.click();
    }
  }, []);

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
    const draftSession = draftSessionRef.current;
    const context = draftSession.context;
    if (
      !context
      || !draftSession.isActive(context)
      || projectHydratingRef.current
      || projectHydrating
    ) return;
    // CommentSession is the synchronous owner of the complete working copy.
    // An acknowledgement observer can adopt a rebased aggregate after this
    // React effect was scheduled, so mixing render-captured fields with the
    // live tombstones could otherwise enqueue a stale partial replacement.
    const workingCopy = commentSessionRef.current;
    const snapshot = draftSession.createSnapshot({
      context,
      basedOnVersionId:
        versionSessionRef.current.snapshot.currentBasedOnVersionId,
      comments: workingCopy.comments,
      changeEvents: workingCopy.changeEvents,
      deletedCommentIds: workingCopy.deletedCommentIds,
      operationId: draftRecoveryOperationIdRef.current || undefined,
    });
    if (!snapshot) return;
    draftRecoveryOperationIdRef.current = null;
    persistDraftRecovery(snapshot);
    if (runSessionRef.current.activeLocked) return;
    void flushDraftPersistence(snapshot);
  }, [
    changeEvents,
    comments,
    currentBasedOnVersionId,
    flushDraftPersistence,
    persistDraftRecovery,
    projectHydrating,
    projectLocked,
    projectSnapshot,
  ]);

  useEffect(() => {
    const draftSession = draftSessionRef.current;
    const context = draftSession.context;
    if (
      !context
      || !draftSession.isActive(context)
      || projectHydratingRef.current
    ) return;
    const snapshot = draftSession.createSnapshot({
      context,
      basedOnVersionId:
        versionSessionRef.current.snapshot.currentBasedOnVersionId,
      comments: commentSessionRef.current.comments,
      changeEvents: commentSessionRef.current.changeEvents,
      deletedCommentIds: commentSessionRef.current.deletedCommentIds,
      operationId: draftRecoveryOperationIdRef.current || undefined,
    });
    if (snapshot) persistDraftRecovery(snapshot);
  }, [
    currentBasedOnVersionId,
    draft,
    draftAttachments,
    draftCommentId,
    draftTarget,
    persistDraftRecovery,
    projectSnapshot,
  ]);

  useEffect(() => {
    const handlePrepareClose = (event: Event) => {
      const detail = (event as CustomEvent<PrepareCloseDetail>).detail;
      if (!detail || typeof detail.waitUntil !== "function") return;

      const prepare = async (): Promise<CloseReadiness> => {
        let imposedEditorFreeze = false;
        let frozenHtml: string | null = null;
        let frozenSourceSha256: string | null = null;
        let ready = false;
        const closeLifecycle = closeLifecycleRef.current;
        const inAppBlock = (reason: string): CloseReadiness => ({
          ready: false,
          reason,
          presentation: "in-app",
        });
        const projectOpenInFlight = () => (
          externalFileOpenSessionRef.current.snapshot.status !== "idle"
          || projectApplicationSessionRef.current.snapshot.status !== "idle"
        );
        const drainProjectOpenSessions = async (): Promise<CloseReadiness | null> => {
          while (projectOpenInFlight()) {
            const projectOpenDrain = await drainCoordinatorRef.current.drain(
              "close",
              { deadlineAt: detail.deadlineAt - 250 },
            );
            if (!projectOpenDrain.ok) return inAppBlock(projectOpenDrain.reason);
          }
          return null;
        };
        closeLifecycle.preparingRequestId = detail.requestId;

        try {
          // An external request may mutate durable active-project authority
          // before a hydration or load-error fast path would normally decide
          // that this close is clean. Drain those owners before either fast
          // path, then fail closed if a new request races that observation.
          const projectOpenBlock = await drainProjectOpenSessions();
          if (projectOpenBlock) return projectOpenBlock;
          if (projectHydratingRef.current) {
            if (projectOpenInFlight()) {
              return inAppBlock("外部 HTML 切换仍未安全完成，已取消关闭。");
            }
            const draftState = draftSessionRef.current.inspect();
            if (canCloseDuringHydration({
              projectHydrating: true,
              viewTransitioning: viewTransitioningRef.current,
              submissionPending: runSessionRef.current.submissionPending,
              persistState: documentSessionRef.current.persistState,
              pendingWrite: Boolean(documentSessionRef.current.pendingWrite),
              flushInProgress: Boolean(documentSessionRef.current.flushPromise),
              draftPending: draftState.pending,
              draftFlushInProgress: draftState.writing,
              editRevision: documentSessionRef.current.editRevision,
              lastPersistedRevision: documentSessionRef.current.lastPersistedRevision,
            })) {
              ready = true;
              return { ready: true };
            }
            return inAppBlock("项目状态尚未读取完成，已取消关闭以避免覆盖未知编辑状态。");
          }
          if (projectLoadErrorRef.current) {
            if (projectOpenInFlight()) {
              return inAppBlock("外部 HTML 切换仍未安全完成，已取消关闭。");
            }
            if (
              documentSessionRef.current.pendingWrite
              || documentSessionRef.current.flushPromise
              || historyActionPromiseRef.current
            ) {
              return inAppBlock("项目读取失败且仍有待恢复的 HTML 修改，请先重试读取或导出副本。");
            }
            ready = true;
            return { ready: true };
          }
          if (
            historyActionPromiseRef.current
            && !await historyActionPromiseRef.current
          ) {
            return inAppBlock("当前撤销或重做没有安全完成，已取消关闭。");
          }

          if (viewMode !== "history" && !runSessionRef.current.activeLocked) {
            const frozen = editorRef.current?.freezeNow();
            if (!frozen) {
              return inAppBlock("编辑画布尚未就绪，已取消关闭以避免丢失文字草稿。");
            }
            if (!frozen.ok) {
              return inAppBlock(
                frozen.reason || "当前文字草稿无法安全提交，已取消关闭。",
              );
            }
            imposedEditorFreeze = true;
            frozenHtml = frozen.html;
            frozenSourceSha256 = frozen.sourceSha256;
            closeLifecycle.frozenRequestId = detail.requestId;
            if (
              frozen.html !== documentSessionRef.current.html
              && (Boolean(projectSessionRef.current.sourcePath) || Boolean(frozen.pendingMutation))
            ) {
              enqueueAutosave(frozen.html, frozen.pendingMutation || undefined);
            }
          }

          const cutoffRevision = documentSessionRef.current.editRevision;
          const drained = await drainCoordinatorRef.current.drain("close", {
            deadlineAt: detail.deadlineAt - 250,
          });
          if (!drained.ok) {
            return inAppBlock(drained.reason);
          }
          if (
            imposedEditorFreeze
            && projectSessionRef.current.sourcePath
            && frozenHtml !== null
          ) {
            const boundaryIdentity: ProjectSessionSnapshot =
              projectSessionRef.current.snapshot;
            const identityIsCurrent = () => {
              const current = projectSessionRef.current.snapshot;
              return current.epoch === boundaryIdentity.epoch
                && sameLocalSourcePath(
                  current.sourcePath,
                  boundaryIdentity.sourcePath,
                )
                && current.projectId === boundaryIdentity.projectId
                && current.documentId === boundaryIdentity.documentId
                && current.registered === boundaryIdentity.registered;
            };
            const sourceResult = await documentSessionRef.current
              .reconcilePersistedBoundary({
                frozenHtml,
                reportedSourceSha256: frozenSourceSha256,
                cutoffRevision,
                hashHtml: browserSha256,
                readSource: () => bridgeClient.source(
                  boundaryIdentity.sourcePath || "",
                  { timeoutMs: 2_500 },
                ),
                isCurrent: identityIsCurrent,
                acceptsSource: (source) => Boolean(
                  sameLocalSourcePath(
                    String(source.sourcePath || ""),
                    boundaryIdentity.sourcePath,
                  )
                  && source.registered === boundaryIdentity.registered
                  && (
                    !boundaryIdentity.registered
                      ? !String(source.projectId || "")
                        && !String(source.documentId || "")
                      : (
                        String(source.projectId || "") === boundaryIdentity.projectId
                        && String(source.documentId || "") === boundaryIdentity.documentId
                      )
                  )
                ),
              });
            if (!sourceResult.ready) {
              if (sourceResult.code === "source-integrity-failed") {
                setWorkspaceIssue({
                  title: "源文件需要重新核对",
                  message: sourceResult.reason,
                });
              } else if (!sourceResult.confirmed) {
                setToast({
                  title: "当前页面仍保持开启",
                  message: sourceResult.reason,
                  tone: "info",
                  disposition: "background-result",
                  dedupeKey: "close-source-reconciliation",
                });
              }
              return inAppBlock(sourceResult.reason);
            }
            if (sourceResult.lastModifiedAt) {
              setLastModifiedAt(sourceResult.lastModifiedAt);
            }
          }

          if (closeLifecycle.abortedRequestIds.has(detail.requestId)) {
            return inAppBlock("桌面外壳已取消本次关闭。");
          }
          ready = true;
          return { ready: true };
        } catch (cause) {
          return {
            ready: false,
            reason: cause instanceof Error ? cause.message : "关闭前安全写入检查失败。",
            presentation: "native",
          };
        } finally {
          if (closeLifecycle.preparingRequestId === detail.requestId) {
            closeLifecycle.preparingRequestId = null;
          }
          if (
            !ready
            && imposedEditorFreeze
            && !runSessionRef.current.activeLocked
          ) {
            if (closeLifecycle.frozenRequestId === detail.requestId) {
              closeLifecycle.frozenRequestId = null;
            }
            editorRef.current?.unlockNow?.();
          }
          closeLifecycle.abortedRequestIds.delete(detail.requestId);
        }
      };

      // The desktop shell only accepts checks registered synchronously during dispatch.
      detail.waitUntil(prepare());
    };

    window.addEventListener("html-ai:prepare-close", handlePrepareClose);
    return () => window.removeEventListener("html-ai:prepare-close", handlePrepareClose);
  }, [
    enqueueAutosave,
    viewMode,
  ]);

  useEffect(() => {
    const handleCloseAborted = (event: Event) => {
      const detail = (event as CustomEvent<CloseAbortedDetail>).detail;
      if (!detail || typeof detail.requestId !== "string") return;
      const closeLifecycle = closeLifecycleRef.current;
      closeLifecycle.abortedRequestIds.add(detail.requestId);

      // An in-flight readiness check owns its freeze and will release it in
      // `finally`; waiting avoids unlocking while a write is still draining.
      if (closeLifecycle.preparingRequestId === detail.requestId) return;
      if (closeLifecycle.frozenRequestId !== detail.requestId) return;

      const draftState = draftSessionRef.current.inspect();
      const mayRecover = shouldRecoverEditorAfterCloseAbort({
        approvedRequestId: closeLifecycle.frozenRequestId,
        abortedRequestId: detail.requestId,
        imposedEditorFreeze: true,
        projectLocked: runSessionRef.current.activeLocked,
        projectHydrating: projectHydratingRef.current,
        projectLoadError: Boolean(projectLoadErrorRef.current),
        viewTransitioning: viewTransitioningRef.current,
        submissionPending: runSessionRef.current.submissionPending,
        persistState: documentSessionRef.current.persistState,
        pendingWrite: Boolean(documentSessionRef.current.pendingWrite),
        flushInProgress: Boolean(documentSessionRef.current.flushPromise),
        draftPending: draftState.pending,
        draftFlushInProgress: draftState.writing,
        draftPersistError: Boolean(draftState.error),
        editRevision: documentSessionRef.current.editRevision,
        lastPersistedRevision: documentSessionRef.current.lastPersistedRevision,
      });

      if (mayRecover) {
        closeLifecycle.frozenRequestId = null;
        closeLifecycle.abortedRequestIds.delete(detail.requestId);
        editorRef.current?.unlockNow?.();
        return;
      }
    };

    window.addEventListener("html-ai:close-aborted", handleCloseAborted);
    return () => window.removeEventListener("html-ai:close-aborted", handleCloseAborted);
  }, []);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        runtimeCapabilitiesRef.current.closeCoordination
        === "electron-handshake"
      ) return;
      if (!drainCoordinatorRef.current.hasPending("close")) return;
      event.preventDefault();
      event.returnValue = "";
      void drainCoordinatorRef.current.drain("close", {
        deadlineAt: Date.now() + 3_000,
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, []);

  const ensureCurrentDocumentCanvas = useCallback(async (): Promise<void> => {
    const context = captureProjectContext();
    let expectedHtml = documentSessionRef.current.html;
    let expectedSha256 = await browserSha256(expectedHtml);
    const persistedProjectionIsClean = Boolean(
      context
      && documentSessionRef.current.persistState === "idle"
      && documentSessionRef.current.editRevision
        === documentSessionRef.current.lastPersistedRevision
      && !documentSessionRef.current.pendingWrite
      && !documentSessionRef.current.flushPromise
    );
    if (
      context
      && persistedProjectionIsClean
      && documentSessionRef.current.sourceSha256
      && documentSessionRef.current.sourceSha256 !== expectedSha256
    ) {
      const sourcePayload = await bridgeClient.source(context.sourcePath);
      if (!isCurrentProjectContext(context)) {
        throw new DeferredEditorCommandDiscardedError("stale-session");
      }
      if (
        String(sourcePayload.projectId || "") !== context.projectId
        || String(sourcePayload.documentId || "") !== context.documentId
      ) {
        throw new Error("自动恢复时源文件身份发生变化。");
      }
      const repairedHtml = String(sourcePayload.content || "");
      const repairedSha256 = String(sourcePayload.sha256 || "");
      if (
        !/^sha256:[a-f0-9]{64}$/.test(repairedSha256)
        || await browserSha256(repairedHtml) !== repairedSha256
      ) {
        throw new Error("自动恢复读取到的源 HTML 与 Hash 不一致。");
      }
      if (!isCurrentProjectContext(context)) {
        throw new DeferredEditorCommandDiscardedError("stale-session");
      }
      documentSessionRef.current.publishAuthority({
        html: repairedHtml,
        sourceSha256: repairedSha256,
        pendingWrite: null,
        persistState: "idle",
        persistError: "",
      });
      versionSessionRef.current.updateAuthority({
        currentBasedOnVersionId:
          sourcePayload.currentBasedOnVersionId || undefined,
        currentExactVersionId: sourcePayload.currentExactVersionId || null,
        restoredFromVersionId: sourcePayload.restoredFromVersionId || null,
      });
      setLastModifiedAt(String(sourcePayload.lastModifiedAt || ""));
      invalidateCanvasRenderAcks();
      expectedHtml = repairedHtml;
      expectedSha256 = repairedSha256;
    }
    await verifyCanvasRendered(expectedHtml, expectedSha256, context || undefined);
  }, [
    captureProjectContext,
    invalidateCanvasRenderAcks,
    isCurrentProjectContext,
    verifyCanvasRendered,
  ]);

  const prepareProjectSwitch = useCallback(async (
    fromDeferred = false,
    {
      retrySourcePath,
      onDeferred,
    }: ProjectSwitchOptions = {},
  ): Promise<boolean> => {
    const rememberProjectOpen = () => {
      if (onDeferred) {
        onDeferred();
        return;
      }
      pendingProjectOpenRef.current = {
        ...(retrySourcePath ? { recentPath: retrySourcePath } : {}),
        requestedAt: Date.now(),
      };
    };
    if (!fromDeferred) {
      let resolveDeferred: ((value: boolean) => void) | null = null;
      const deferredResult = new Promise<boolean>((resolve) => {
        resolveDeferred = resolve;
      });
      if (deferEditorCommand(
        "project-switch",
        () => {
          const replay = deferredEditorReplayRef.current.prepareProjectSwitch;
          if (!replay) {
            resolveDeferred?.(false);
            return;
          }
          replay((value) => resolveDeferred?.(value), {
            retrySourcePath,
            onDeferred,
          });
        },
        undefined,
        { onDiscard: () => resolveDeferred?.(false) },
      )) return deferredResult;
    }
    const hardBlocker = drainCoordinatorRef.current
      .inspect("switch")
      .find((status) => status.state === "blocked");
    if (hardBlocker) {
      rememberProjectOpen();
      return false;
    }
    if (projectLoadErrorRef.current) {
      draftSessionRef.current.deactivate();
      sourceHistorySessionRef.current.deactivate();
      return true;
    }
    if (runSessionRef.current.activeLocked) {
      const drained = await drainCoordinatorRef.current.drain("switch", {
        deadlineAt: Date.now() + 15_000,
      });
      if (!drained.ok) rememberProjectOpen();
      return drained.ok;
    }
    if (
      historyActionPromiseRef.current
      && !await historyActionPromiseRef.current
    ) {
      rememberProjectOpen();
      return false;
    }
    const shouldCommitCurrentCanvas = viewMode !== "history";
    let committed = shouldCommitCurrentCanvas
      ? editorRef.current?.fencePendingEdit({
          resumeEditing: false,
          trigger: "project-switch",
        })
      : null;
    if (shouldCommitCurrentCanvas && (!committed || !committed.ok)) {
      editorRef.current?.showCommitBlocked(
        committed?.reason || "请点回文字完成输入，再切换项目。",
      );
      return false;
    }
    const switchCutoffRevision = documentSessionRef.current.editRevision;
    const drained = await drainCoordinatorRef.current.drain("switch", {
      deadlineAt: Date.now() + 15_000,
    });
    if (!drained.ok) {
      rememberProjectOpen();
      return false;
    }
    if (
      documentSessionRef.current.editRevision !== switchCutoffRevision
      || documentSessionRef.current.pendingWrite
      || documentSessionRef.current.flushPromise
      || historyActionPromiseRef.current
    ) {
      rememberProjectOpen();
      return false;
    }
    if (shouldCommitCurrentCanvas) {
      try {
        await ensureCurrentDocumentCanvas();
      } catch (cause) {
        setToast({
          title: "当前画布尚未完成自动恢复",
          message: productErrorMessage(
            cause,
            "工作台已保留当前文件，没有切换项目；画布会继续保持锁定以避免内容错配。",
          ),
          tone: "error",
          disposition: "background-result",
          dedupeKey: "canvas-authority-recovery",
        });
        return false;
      }
      committed = editorRef.current?.fencePendingEdit({
        resumeEditing: false,
        trigger: "project-switch",
      });
      if (!committed || !committed.ok) return false;
    }
    if (
      projectSessionRef.current.sourcePath
      && committed
      && (
        documentSessionRef.current.lastPersistedRevision !== switchCutoffRevision
        || documentSessionRef.current.sourceSha256 !== committed.sourceSha256
      )
    ) {
      rememberProjectOpen();
      return false;
    }
    return true;
  }, [
    deferEditorCommand,
    ensureCurrentDocumentCanvas,
    viewMode,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.prepareProjectSwitch = (resolve, options) => {
      void prepareProjectSwitch(true, options).then(resolve, () => resolve(false));
    };
  }, [prepareProjectSwitch]);

  const applyAcceptedProject = useCallback(async (
    application: ProjectApplication<AcceptedProjectApplication>,
  ): Promise<"complete" | "deferred"> => {
    const { project, onFailure } = application.value;
    // The main-process FIFO owns durable activation, but it cannot prevent an
    // earlier result from reaching the renderer while a later result is still
    // reading. Re-open the complete renderer switch boundary for every
    // accepted result, then take one synchronous final fence before publish.
    if (!await prepareProjectSwitch(false, { onDeferred: () => {} })) {
      return "deferred";
    }
    let canvasFrozen = false;
    let appliedProject = false;
    if (
      projectSessionRef.current.sourcePath
      && !projectLoadErrorRef.current
      && viewMode !== "history"
    ) {
      const freezeCutoffRevision = documentSessionRef.current.editRevision;
      const frozen = fenceAndFreezeCurrentCanvas(
        "当前编辑画布尚未完成安全收口，暂不能切换 HTML。",
      );
      if (!frozen.ok) {
        editorRef.current?.showCommitBlocked(frozen.reason);
        return "deferred";
      }
      canvasFrozen = true;
      if (
        documentSessionRef.current.editRevision !== freezeCutoffRevision
        || documentSessionRef.current.pendingWrite
        || documentSessionRef.current.flushPromise
      ) {
        // freezeNow() can receive native input after the final drain. Release
        // it to normal persistence and keep this already-accepted result in
        // the renderer FIFO for a later, safe application.
        editorRef.current?.unlockNow?.();
        return "deferred";
      }
    }
    try {
      setStartupIssue(null);
      applyProject(project);
      appliedProject = true;
      const epoch = projectSessionRef.current.epoch;
      await Promise.all([
        refreshRecents(),
        refreshWorkspace(project.sourcePath, epoch, false, epoch),
      ]);
    } catch (cause) {
      try {
        onFailure(cause);
      } catch {
        // Failure presentation cannot strand later accepted project results.
      }
    } finally {
      if (canvasFrozen && !appliedProject) {
        editorRef.current?.unlockNow?.();
      }
    }
    return "complete";
  }, [
    applyProject,
    fenceAndFreezeCurrentCanvas,
    prepareProjectSwitch,
    refreshRecents,
    refreshWorkspace,
    viewMode,
  ]);

  const enqueueAcceptedProject = useCallback((
    project: HtmlProject,
    onFailure: (cause: unknown) => void,
  ) => projectApplicationSessionRef.current.enqueue({
    applicationId: `project-application-${++projectApplicationCounterRef.current}`,
    value: { project, onFailure },
  }, applyAcceptedProject), [applyAcceptedProject]);

  const openProject = useCallback(async (recentPath?: string) => {
    if (!await prepareProjectSwitch(false, { retrySourcePath: recentPath })) return;
    pendingProjectOpenRef.current = null;
    const openRequest = projectOpenRequestRef.current + 1;
    projectOpenRequestRef.current = openRequest;
    const orderedByMainProcess = (
      runtimeCapabilitiesRef.current.projectOpening === "desktop-dialog"
    );
    if (
      runtimeCapabilitiesRef.current.projectOpening === "browser-file"
      && !recentPath
    ) {
      fileInputRef.current?.click();
      return;
    }
    const api = window.htmlAIProjects;
    if (!api) return;
    const reportOpenFailure = (cause: unknown) => {
      if (openRequest !== projectOpenRequestRef.current) return;
      if (recentPath) void refreshRecents();
      setToast({
        title: "无法打开这个 HTML",
        message: productErrorMessage(
          cause,
          recentPath
            ? "文件可能已移动；可重新选择当前位置，或在最近打开列表中移除旧记录。"
            : "文件可能已移动或暂时不可读；可重新选择。",
        ),
        tone: "error",
        sticky: true,
        disposition: "direct-action",
        dedupeKey: "project-open-error",
        action: {
          id: "retry-project-open",
          label: recentPath ? "重新选择位置" : "重新选择",
        },
      });
    };
    try {
      const project = recentPath
        ? await api.openRecent(recentPath)
        : await api.openHtml();
      if (
        !project
        || (!orderedByMainProcess && openRequest !== projectOpenRequestRef.current)
      ) return;
      // Desktop project opens are complete FIFO transitions in the main
      // process. A successful earlier result remains canonical until a later
      // request succeeds; the browser file input has no such main-process
      // authority and still needs its renderer request fence.
      if (!enqueueAcceptedProject(project, reportOpenFailure)) {
        reportOpenFailure(new Error("无法安排当前 HTML 的安全切换。"));
      }
    } catch (cause) {
      reportOpenFailure(cause);
    }
  }, [enqueueAcceptedProject, prepareProjectSwitch, refreshRecents]);

  const openExternalProject = useCallback(async (
    request: ExternalFileOpenRequest,
    { isSuperseded }: { isSuperseded: () => boolean },
  ): Promise<"complete" | "deferred"> => {
    if (isSuperseded()) return "complete";
    if (!await prepareProjectSwitch(false, { onDeferred: () => {} })) {
      return "deferred";
    }
    if (isSuperseded()) return "complete";

    // prepareProjectSwitch() closes the current edit and persistence drain, but
    // the external main-process read can still take time. Take an imperative
    // fence immediately before that awaited boundary so post-cutoff native
    // input cannot be reset when the accepted project is applied below.
    let canvasFrozen = false;
    if (
      projectSessionRef.current.sourcePath
      && !projectLoadErrorRef.current
      && viewMode !== "history"
    ) {
      const freezeCutoffRevision = documentSessionRef.current.editRevision;
      const frozen = fenceAndFreezeCurrentCanvas(
        "当前编辑画布尚未完成安全收口，暂不能切换 QoderWork 中的 HTML。",
      );
      if (!frozen.ok) return "deferred";
      canvasFrozen = true;
      if (
        documentSessionRef.current.editRevision !== freezeCutoffRevision
        || documentSessionRef.current.pendingWrite
        || documentSessionRef.current.flushPromise
      ) {
        // freezeNow() captured a native input delivered after the prior switch
        // drain. Do not start external activation; return this exact edit to
        // normal persistence and retry the switch only after it is safe.
        editorRef.current?.unlockNow?.();
        return "deferred";
      }
    }

    pendingProjectOpenRef.current = null;
    const openRequest = projectOpenRequestRef.current + 1;
    projectOpenRequestRef.current = openRequest;
    const acceptExternalOpen = window.htmlAIProjects?.acceptExternalOpen;
    try {
      if (!acceptExternalOpen) {
        if (!isSuperseded()) {
          setToast({
            title: "无法接收外部 HTML",
            message: "当前 PageRoot 版本缺少外部文件打开通道，请重新安装最新版本。",
            tone: "error",
            sticky: true,
            disposition: "background-result",
            dedupeKey: "external-project-open-unavailable",
          });
        }
        return "complete";
      }
      const project = await acceptExternalOpen(request.requestId);
      // Main-process project opens are serialized as whole transitions. Keep
      // every accepted result in renderer FIFO too: B may have to wait for a
      // final Canvas fence after A has already published, and a failed later
      // successor must never erase A's successful application.
      if (!enqueueAcceptedProject(project, (cause) => {
        if (isSuperseded() || openRequest !== projectOpenRequestRef.current) return;
        setToast({
          title: "无法打开 QoderWork 中的 HTML",
          message: productErrorMessage(
            cause,
            "文件可能已移动、暂时不可读，或不是完整的 HTML 页面；当前项目仍保持打开。",
          ),
          tone: "error",
          sticky: true,
          disposition: "background-result",
          dedupeKey: "external-project-open-error",
        });
      })) {
        throw new Error("无法安排外部 HTML 的安全切换。");
      }
    } catch (cause) {
      if (isSuperseded() || openRequest !== projectOpenRequestRef.current) {
        return "complete";
      }
      setToast({
        title: "无法打开 QoderWork 中的 HTML",
        message: productErrorMessage(
          cause,
          "文件可能已移动、暂时不可读，或不是完整的 HTML 页面；当前项目仍保持打开。",
        ),
        tone: "error",
        sticky: true,
        disposition: "background-result",
        dedupeKey: "external-project-open-error",
      });
    } finally {
      // A newer external request inherits this fence. Any final failure leaves
      // the current source untouched. Accepted results take their own final
      // fence inside ProjectApplicationSession, so this pre-read fence can be
      // released once no newer external request inherits it.
      if (canvasFrozen && !isSuperseded()) {
        editorRef.current?.unlockNow?.();
      }
    }
    return "complete";
  }, [
    enqueueAcceptedProject,
    fenceAndFreezeCurrentCanvas,
    prepareProjectSwitch,
    viewMode,
  ]);

  const resumeDeferredProjectApplication = useCallback(() => {
    const session = projectApplicationSessionRef.current;
    if (session.snapshot.status !== "deferred") return false;
    return session.resume(applyAcceptedProject);
  }, [applyAcceptedProject]);

  const resumeDeferredExternalProject = useCallback(() => {
    const session = externalFileOpenSessionRef.current;
    if (session.snapshot.status !== "deferred") return false;
    return session.resume(openExternalProject);
  }, [openExternalProject]);

  useEffect(() => {
    const lifecycle = window.htmlAIAppLifecycle;
    if (!lifecycle?.onExternalOpenRequested) return undefined;
    return lifecycle.onExternalOpenRequested((request) => {
      const accepted = externalFileOpenSessionRef.current.enqueue(
        request,
        openExternalProject,
      );
      if (accepted) pendingProjectOpenRef.current = null;
    });
  }, [openExternalProject]);

  useEffect(() => {
    const pending = pendingProjectOpenRef.current;
    const projectApplicationDeferred =
      projectApplicationSnapshot.status === "deferred";
    const externalOpenDeferred = externalFileOpenSnapshot.status === "deferred";
    if (
      !pending
      && !projectApplicationDeferred
      && !externalOpenDeferred
    ) return;
    const switchBlocked = drainCoordinatorRef.current
      .inspect("switch")
      .some((status) => status.state !== "resolved");
    // Accepted results own the earlier renderer FIFO position, so they resume
    // before a still-unaccepted external request or a picker retry.
    if (projectApplicationDeferred) {
      const retry = projectApplicationSessionRef.current
        .reconcileDeferredSwitch({
          switchBlocked,
          execute: applyAcceptedProject,
        });
      if (retry === "action-required") {
        setToast({
          title: "当前 HTML 尚未完成安全切换",
          message: "已保留已接受的 HTML；当前画布恢复后可手动继续切换。",
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "project-application-deferred",
          action: { id: "retry-project-application", label: "继续切换" },
        });
      }
      return;
    }
    if (externalOpenDeferred) {
      const retry = externalFileOpenSessionRef.current
        .reconcileDeferredSwitch({
          switchBlocked,
          execute: openExternalProject,
        });
      if (retry === "action-required") {
        setToast({
          title: "暂不能切换到 QoderWork 中的 HTML",
          message: "当前画布仍在安全恢复；已保留当前 HTML。恢复后可手动重试打开。",
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "external-project-open-deferred",
          action: { id: "retry-external-project-open", label: "重试打开" },
        });
      }
      return;
    }
    if (!pending || switchBlocked) return;
    pendingProjectOpenRef.current = null;
    void openProject(pending.recentPath);
  }, [
    applyAcceptedProject,
    attachmentUploadCount,
    commentSnapshot,
    documentSnapshot,
    draftPersistError,
    externalFileOpenSnapshot.status,
    externalFileOpenSnapshot.deferredSequence,
    openExternalProject,
    openProject,
    projectApplicationSnapshot.status,
    projectApplicationSnapshot.deferredSequence,
    projectHydrating,
    projectLoadError,
    projectRulesSnapshot,
    projectSnapshot,
    runSnapshot,
    viewTransitioning,
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
    const activeSourcePath = requestedSourcePath || projectSessionRef.current.sourcePath;
    const showInFolder = window.htmlAIProjects?.showInFolder;
    if (!activeSourcePath || !showInFolder) return;
    await runLocalUserAction({
      kind: "show-source-in-folder",
      invoke: () => showInFolder(activeSourcePath),
      onFailure: (cause: unknown) => setToast({
        title: "无法在 Finder 中显示",
        message: productErrorMessage(
          cause,
          "源 HTML 可能已移动；当前项目仍保持打开，可以重试。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "show-project-in-folder-error",
      }),
    });
  }, []);

  const openCurrentHtmlInDefaultBrowser = useCallback(async () => {
    const activeSourcePath = projectSessionRef.current.sourcePath;
    const activeEpoch = projectSessionRef.current.epoch;
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
        let launchRevision = documentSessionRef.current.editRevision;
        if (
          committed.html !== documentSessionRef.current.html
          || committed.pendingMutation
        ) {
          launchRevision = enqueueAutosave(
            committed.html,
            committed.pendingMutation || undefined,
          );
        }
        const persisted = await flushAutosave(launchRevision);
        if (
          !persisted
          || activeEpoch !== projectSessionRef.current.epoch
          || !sameLocalSourcePath(projectSessionRef.current.sourcePath, activeSourcePath)
          || documentSessionRef.current.pendingWrite
          || documentSessionRef.current.flushPromise
          || historyActionPromiseRef.current
          || documentSessionRef.current.persistState !== "idle"
          || documentSessionRef.current.lastPersistedRevision < launchRevision
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
  }, [enqueueAutosave, flushAutosave]);

  const cancelFileRename = useCallback(() => {
    if (fileRenameBusyRef.current) return;
    fileRenameEditingRef.current = false;
    setFileRenameEditing(false);
    setFileRenameError("");
    setFileRenameDraft("");
  }, []);

  const beginFileRename = useCallback(() => {
    if (
      !canOfferFileRename
      || fileRenameEditingRef.current
      || fileRenameBusyRef.current
      || editorRef.current?.hasPendingNativeEdit()
      || documentSessionRef.current.pendingWrite
      || documentSessionRef.current.flushPromise
      || historyActionPromiseRef.current
      || documentSessionRef.current.editRevision !== documentSessionRef.current.lastPersistedRevision
    ) return;
    fileRenameEditingRef.current = true;
    setFileRenameEditing(true);
    setFileRenameDraft(currentSourceFileStem);
    setFileRenameError("");
    window.requestAnimationFrame(() => {
      fileRenameInputRef.current?.focus();
      fileRenameInputRef.current?.select();
    });
  }, [canOfferFileRename, currentSourceFileStem]);

  const commitFileRename = useCallback(async () => {
    if (!fileRenameEditingRef.current || fileRenameBusyRef.current) return;
    const api = window.htmlAIProjects;
    const renameFile = api?.renameHtml;
    const previousSourcePath = projectSessionRef.current.sourcePath;
    const previousEpoch = projectSessionRef.current.epoch;
    const previousProjectId = projectSessionRef.current.projectId;
    const previousDocumentId = projectSessionRef.current.documentId;
    const extension = fileExtension(
      localFileNameFromSourcePath(previousSourcePath),
    );
    let requestedStem = fileRenameDraft.normalize("NFC").trim();
    if (
      extension
      && requestedStem.toLowerCase().endsWith(extension.toLowerCase())
    ) {
      requestedStem = requestedStem.slice(0, -extension.length).trim();
    }
    if (
      !renameFile
      || !previousSourcePath
      || !documentSessionRef.current.sourceSha256
      || viewMode !== "current"
      || runInProgress
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || workspaceIssue
    ) {
      setFileRenameError("当前状态还不能重命名，请等待文件安全保存。");
      return;
    }
    if (requestedStem === currentSourceFileStem) {
      cancelFileRename();
      return;
    }

    fileRenameBusyRef.current = true;
    setFileRenameBusy(true);
    setFileRenameError("");
    let transitionOwnsCanvas = false;
    let renameCommitted = false;
    try {
      const committed = editorRef.current?.fencePendingEdit({
        resumeEditing: true,
        trigger: "project-switch",
      });
      if (!committed || !committed.ok) {
        throw new Error(
          committed?.reason || "请先完成当前文字输入，再修改文件名。",
        );
      }
      if (
        committed.html !== documentSessionRef.current.html
        || committed.pendingMutation
      ) {
        enqueueAutosave(
          committed.html,
          committed.pendingMutation || undefined,
        );
      }
      const drained = await drainCoordinatorRef.current.drain("switch", {
        deadlineAt: Date.now() + 15_000,
      });
      if (!drained.ok) throw new Error(drained.reason);
      if (
        previousEpoch !== projectSessionRef.current.epoch
        || !sameLocalSourcePath(projectSessionRef.current.sourcePath, previousSourcePath)
        || documentSessionRef.current.pendingWrite
        || documentSessionRef.current.flushPromise
        || historyActionPromiseRef.current
        || documentSessionRef.current.persistState !== "idle"
        || documentSessionRef.current.editRevision !== documentSessionRef.current.lastPersistedRevision
      ) {
        throw new Error("文件状态刚刚发生变化，请等到“已安全保存”后重试。");
      }

      const frozen = editorRef.current?.freezeNow();
      if (!frozen || !frozen.ok) {
        throw new Error(
          frozen?.reason || "编辑画布尚未完成安全收口。",
        );
      }
      if (
        frozen.html !== documentSessionRef.current.html
        || frozen.pendingMutation
      ) {
        enqueueAutosave(
          frozen.html,
          frozen.pendingMutation || undefined,
        );
        throw new Error("刚刚还有文字输入，源页正在安全保存，请稍后再试。");
      }
      transitionOwnsCanvas = true;
      viewTransitioningRef.current = true;
      setViewTransitioning(true);

      const expectedSha256 = documentSessionRef.current.sourceSha256;
      const operationId = sourceRenameOperationId();
      let result: Awaited<ReturnType<NonNullable<DesktopProjectsApi["renameHtml"]>>>;
      try {
        result = await renameFile({
          operationId,
          sourcePath: previousSourcePath,
          stem: requestedStem,
          expectedSha256,
        });
      } catch (cause) {
        const active = await api?.getActiveProject().catch(() => null);
        const expectedFileName = `${requestedStem}${extension}`;
        if (
          !active
          || active.sha256 !== expectedSha256
          || localFileNameFromSourcePath(active.sourcePath).normalize("NFC")
            !== expectedFileName.normalize("NFC")
        ) throw cause;
        result = {
          ...active,
          operationId,
          previousSourcePath,
          fileName: expectedFileName,
          stem: requestedStem,
          extension,
          renamed: true,
          replayed: true,
          workspaceRelinked: false,
        };
      }
      if (
        result.operationId !== operationId
        || !sameLocalSourcePath(
          result.previousSourcePath,
          previousSourcePath,
        )
        || result.sha256 !== expectedSha256
        || !result.sourcePath
      ) {
        throw new Error("重命名结果与当前文件身份不一致。");
      }
      renameCommitted = true;
      const nextSourcePath = result.sourcePath;

      runSessionRef.current.rebaseSource({
        previousSourcePath,
        sourcePath: nextSourcePath,
        projectId: previousProjectId,
      });

      const transitionedProject = projectSessionRef.current.transitionSource({
        previousSourcePath,
        sourcePath: nextSourcePath,
        projectId: previousProjectId,
        documentId: previousDocumentId,
      });
      if (!transitionedProject) {
        throw new Error("文件已重命名，但当前项目身份已经变化。");
      }
      documentSessionRef.current.publishAuthority({
        html: documentSessionRef.current.html,
        sourceSha256: result.sha256,
        pendingWrite: null,
      });
      recoveryIdentityRef.current = null;
      draftRecoveryOperationIdRef.current = null;
      draftSessionRef.current.deactivate();
      sourceHistorySessionRef.current.deactivate();
      recoveryStore.remove([
        `html-ai-recovery:${previousSourcePath}`,
        `html-ai-draft-recovery:${previousSourcePath}`,
      ]);
      setProjectName(result.stem || requestedStem);
      setLastModifiedAt(result.lastModifiedAt || null);
      await Promise.all([
        refreshRecents(),
        refreshWorkspace(
          nextSourcePath,
          projectSessionRef.current.epoch,
          true,
        ),
      ]);
      persistCurrentDraftRecovery();
      fileRenameEditingRef.current = false;
      setFileRenameEditing(false);
      setFileRenameDraft("");
      setFileRenameError("");
    } catch (cause) {
      setFileRenameError(productErrorMessage(
        cause,
        renameCommitted
          ? "文件名已经修改，但项目状态还没有完成刷新。"
          : "文件名没有修改，请检查名称后重试。",
      ));
      window.requestAnimationFrame(() => {
        fileRenameInputRef.current?.focus();
        fileRenameInputRef.current?.select();
      });
    } finally {
      if (transitionOwnsCanvas) {
        viewTransitioningRef.current = false;
        setViewTransitioning(false);
        window.requestAnimationFrame(() => editorRef.current?.unlockNow?.());
      }
      fileRenameBusyRef.current = false;
      setFileRenameBusy(false);
    }
  }, [
    cancelFileRename,
    currentSourceFileStem,
    enqueueAutosave,
    fileRenameDraft,
    persistCurrentDraftRecovery,
    refreshRecents,
    refreshWorkspace,
    runInProgress,
    viewMode,
    workspaceIssue,
  ]);

  useEffect(() => {
    if (
      fileRenameEditing
      && !fileRenameBusy
      && !canOfferFileRename
    ) cancelFileRename();
  }, [
    canOfferFileRename,
    cancelFileRename,
    fileRenameBusy,
    fileRenameEditing,
  ]);

  const showProjectRecordsInFolder = useCallback(async () => {
    const activeSourcePath = projectSessionRef.current.sourcePath;
    if (!activeSourcePath || !projectRecordsPath) return;
    await runLocalUserAction({
      kind: "open-project-records",
      invoke: async () => {
        const payload = await bridgeClient.openFolder({
          sourcePath: activeSourcePath,
        });
        if (payload.ok === false) throw new Error("无法打开项目记录。");
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
  }, [projectRecordsPath]);

  const handleBrowserFile = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";
    if (!file) return;
    if (!await prepareProjectSwitch()) return;
    const openRequest = projectOpenRequestRef.current + 1;
    projectOpenRequestRef.current = openRequest;
    try {
      // File.text() consumes the UTF-8 signature. Decode the original bytes
      // ourselves so an authored BOM remains part of the SourcePatch truth.
      const fileHtml = new TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(await file.arrayBuffer());
      if (openRequest !== projectOpenRequestRef.current) return;
      applyProject({ name: file.name, sourcePath: null, html: fileHtml });
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
  }, [applyProject, prepareProjectSwitch]);

  const handleCanvasChange = useCallback((
    nextHtml: string,
    mutation?: HtmlCanvasMutation,
    sourceTransaction?: HtmlCanvasSourceTransaction,
  ): boolean => {
    if (
      runtimeCapabilitiesRef.current.sourceEditing !== "enabled"
      ||
      runSessionRef.current.activeLocked
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
      || historyActionPromiseRef.current
      || String(documentSessionRef.current.persistState) === "conflict"
      || viewMode === "history"
    ) return false;
    try {
      enqueueAutosave(nextHtml, mutation, sourceTransaction);
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
    const activeTargets = [
      ...commentSessionRef.current.comments.map((comment) => comment.target),
      ...commentSessionRef.current.changeEvents.map((event) => event.target),
      ...(commentSessionRef.current.composerTarget ? [commentSessionRef.current.composerTarget] : []),
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
      const nextComments = commentSessionRef.current.comments.map((comment) => ({
        ...comment,
        target: refreshedTarget(comment.target),
      }));
      const nextEvents = commentSessionRef.current.changeEvents.map((event) => ({
        ...event,
        target: refreshedTarget(event.target),
      }));
      const currentDraftTarget = commentSessionRef.current.composerTarget;
      commentSessionRef.current.update({
        comments: nextComments,
        changeEvents: nextEvents,
        ...(currentDraftTarget
          ? { composerTarget: refreshedTarget(currentDraftTarget) }
          : {}),
      });
    }
    const renderGeneration = documentSessionRef.current.canvasGeneration;
    void browserSha256(nextHtml).then((renderedSha256) => {
      if (
        documentSessionRef.current.html === nextHtml
        && documentSessionRef.current.canvasGeneration === renderGeneration
        && editorRef.current?.getRenderedSourceHtml() === nextHtml
      ) {
        acknowledgeCanvasRender("edit", renderGeneration, renderedSha256);
      }
    });
    setActiveRun((run) => run?.status === "complete" ? null : run);
    return true;
  }, [acknowledgeCanvasRender, enqueueAutosave, setActiveRun, viewMode]);

  const exportCurrentHtml = useCallback(async (fromDeferred = false) => {
    if (viewTransitioningRef.current) return;
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
      || documentSessionRef.current.html;
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
        sourcePath: projectSessionRef.current.sourcePath,
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
  }, [deferEditorCommand, projectName]);
  useEffect(() => {
    deferredEditorReplayRef.current.exportCurrentHtml = () => {
      void exportCurrentHtml(true);
    };
  }, [exportCurrentHtml]);

  const beginNavigationOperation = useCallback((allowSupersede = false): number | null => {
    if (viewTransitioningRef.current && !allowSupersede) return null;
    const wasAlreadyTransitioning = viewTransitioningRef.current;
    const operationId = navigationOperationRef.current + 1;
    if (!wasAlreadyTransitioning) {
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
    }
    navigationOperationRef.current = operationId;
    viewTransitioningRef.current = true;
    setViewTransitioning(true);
    clearAutosaveTimer();
    return operationId;
  }, [clearAutosaveTimer]);

  const finishNavigationOperation = useCallback((operationId: number) => {
    if (navigationOperationRef.current !== operationId) return;
    viewTransitioningRef.current = false;
    setViewTransitioning(false);
    window.requestAnimationFrame(() => editorRef.current?.unlockNow?.());
  }, []);

  const reloadCurrentSource = useCallback(async (
    skipConfirmation = false,
    fromDeferred = false,
  ) => {
    const context = captureProjectContext();
    if (!context || projectLoadErrorRef.current) return;
    if (historyActionPromiseRef.current) return;
    if (
      !fromDeferred
      && deferEditorCommand(
        "external-refresh",
        () => deferredEditorReplayRef.current.reloadCurrentSource?.(),
      )
    ) return;
    const hasUnwrittenLocalChanges = Boolean(
      editorRef.current?.hasPendingNativeEdit()
      || documentSessionRef.current.pendingWrite
      || documentSessionRef.current.flushPromise
      || documentSessionRef.current.editRevision > documentSessionRef.current.lastPersistedRevision
      || persistState === "failed"
      || persistState === "preview-dirty"
    );
    if (
      !skipConfirmation
      && persistState !== "conflict"
      && hasUnwrittenLocalChanges
      && !window.confirm("重新载入会舍弃尚未写回的当前编辑内容。建议先导出副本，仍要继续吗？")
    ) return;
    const operationId = beginNavigationOperation();
    if (operationId === null) return;
    const previousDocument = documentSessionRef.current.snapshot;
    const previousHtml = previousDocument.html;
    const previousPendingWrite = documentSessionRef.current.pendingWrite;
    const previousVersionView = versionSessionRef.current.captureView();
    let externalAccepted = false;
    try {
      if (persistState === "conflict") {
        try {
          await bridgeClient.resolveConflict({
            projectId: context.projectId,
            documentId: context.documentId,
            sourcePath: context.sourcePath,
            action: "keep-external",
          });
          externalAccepted = true;
        } catch (cause) {
          if (
            !isBridgeRequestError(cause)
            || cause.code !== "CONFLICT_NOT_FOUND"
          ) throw cause;
        }
        if (
          navigationOperationRef.current !== operationId
          || !isCurrentProjectContext(context)
        ) return;
      }
      const payload = await bridgeClient.source(context.sourcePath);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      if (
        String(payload.projectId || "") !== context.projectId
        || String(payload.documentId || "") !== context.documentId
      ) {
        throw new Error("重新读取时文件身份发生变化，已拒绝覆盖当前项目。");
      }
      const content = String(payload.content || "");
      const hash = String(payload.sha256 || "");
      if (!hash || await browserSha256(content) !== hash) {
        throw new Error("重新读取的源 HTML 与声明 Hash 不一致。");
      }
      documentSessionRef.current.publishAuthority({
        html: content,
        sourceSha256: hash,
      });
      versionSessionRef.current.returnCurrent({
        currentExactVersionId: payload.currentExactVersionId || null,
        currentBasedOnVersionId:
          payload.currentBasedOnVersionId || currentBasedOnVersionId,
        restoredFromVersionId: payload.restoredFromVersionId || null,
      });
      invalidateCanvasRenderAcks();
      await verifyCanvasRendered(content, hash, context);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      auditPendingRef.current = [];
      commentSessionRef.current.setChangeEvents([]);
      persistRecoveryLog(null, context);
      documentSessionRef.current.update({
        pendingWrite: null,
        persistState: "idle",
        persistError: "",
      });
      setLastModifiedAt(String(payload.lastModifiedAt || ""));
      await refreshWorkspace(context.sourcePath, context.epoch);
      if (
        navigationOperationRef.current !== operationId
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
      if (navigationOperationRef.current === operationId) {
        if (!externalAccepted) {
          documentSessionRef.current.publishAuthority({
            html: previousHtml,
            sourceSha256: previousDocument.sourceSha256,
            pendingWrite: previousPendingWrite,
            persistState: previousDocument.persistState,
            persistError: previousDocument.persistError,
          });
          versionSessionRef.current.restoreView(previousVersionView);
          invalidateCanvasRenderAcks();
          try {
            await verifyCanvasRendered(
              previousHtml,
              await browserSha256(previousHtml),
              context,
            );
          } catch {
            // The transition remains fail-closed until its lock is released below.
          }
        } else {
          const message = productErrorMessage(
            cause,
            "外部版本已被接受，但重新读取失败。",
          );
          projectLoadErrorRef.current = message;
          setProjectLoadError(message);
        }
      }
      setToast({
        title: "重新载入失败",
        message: productErrorMessage(cause, "请稍后重试，源文件没有被覆盖。"),
        tone: "error",
        disposition: "background-result",
        dedupeKey: "source-reload",
      });
    } finally {
      finishNavigationOperation(operationId);
    }
  }, [
    beginNavigationOperation,
    captureProjectContext,
    currentBasedOnVersionId,
    deferEditorCommand,
    finishNavigationOperation,
    invalidateCanvasRenderAcks,
    isCurrentProjectContext,
    persistRecoveryLog,
    persistState,
    refreshWorkspace,
    verifyCanvasRendered,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.reloadCurrentSource = () => {
      void reloadCurrentSource(false, true);
    };
  }, [reloadCurrentSource]);

  const requestUserFlush = useCallback((fromDeferred = false) => {
    if (interactionLocked) {
      if (runInProgress) setDrawer("handoff");
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
  }, [deferEditorCommand, flushAutosave, interactionLocked, runInProgress]);
  useEffect(() => {
    deferredEditorReplayRef.current.requestUserFlush = () => requestUserFlush(true);
  }, [requestUserFlush]);

  const requestSourceHistoryAction = useCallback(async (
    direction: SourceHistoryDirection,
    fromDeferred = false,
  ): Promise<boolean> => {
    if (
      runtimeCapabilitiesRef.current.sourceEditing !== "enabled"
      || !projectSessionRef.current.sourcePath
      || runSessionRef.current.activeLocked
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
      || viewMode === "history"
      || documentSessionRef.current.persistState === "conflict"
    ) return false;
    if (!fromDeferred) {
      let resolveDeferred: ((value: boolean) => void) | null = null;
      const deferred = new Promise<boolean>((resolve) => {
        resolveDeferred = resolve;
      });
      if (deferEditorCommand(
        `source-history:${direction}`,
        () => {
          const replay =
            deferredEditorReplayRef.current.requestSourceHistoryAction;
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
    if (historyActionPromiseRef.current) {
      return historyActionPromiseRef.current;
    }

    const run = async (): Promise<boolean> => {
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
      if (!await flushAutosave(documentSessionRef.current.editRevision)) {
        editorRef.current?.cancelHistoryAction();
        setToast({
          title: direction === "undo" ? "暂时不能撤销" : "暂时不能重做",
          message: "当前修改还没有安全写入源 HTML，本次操作未执行；保存状态区会保留具体原因。",
          tone: "warning",
          disposition: "background-result",
          dedupeKey: "source-history-flush-blocked",
        });
        return false;
      }
      const context = captureProjectContext();
      if (!context) {
        editorRef.current?.cancelHistoryAction();
        return false;
      }
      const action = sourceHistorySessionRef.current.createAction(
        context,
        direction,
      );
      if (!action) {
        editorRef.current?.cancelHistoryAction();
        return false;
      }
      const requestBody = {
        ...context,
        ...action,
      };
      documentSessionRef.current.setPersistence({
        state: "writing",
        error: "",
      });

      let payload: Record<string, unknown>;
      try {
        payload = await bridgeClient.sourceHistoryAction(requestBody);
      } catch (cause) {
        if (
          !isBridgeRequestError(cause)
          || (cause.outcome !== "unknown" && cause.status < 500)
        ) {
          throw cause;
        }
        const authority = await bridgeClient.workspace(context.sourcePath);
        const authoritativeHistory = isRecord(authority.sourceHistory)
          ? authority.sourceHistory
          : null;
        const authoritativeCapabilities = isRecord(
          authoritativeHistory?.capabilities,
        )
          ? authoritativeHistory.capabilities
          : null;
        const actionApplied = Array.isArray(
          authoritativeHistory?.appliedActions,
        ) && authoritativeHistory.appliedActions.some((entry) => (
          isRecord(entry) && entry.actionId === action.actionId
        ));
        const actionStillEligible = (
          authority.projectId === context.projectId
          && authority.documentId === context.documentId
          && authority.sourcePath === context.sourcePath
          && authority.currentHtmlSha256 === action.expectedSourceSha256
          && Number(authoritativeCapabilities?.revision)
            === action.expectedHistoryRevision
          && Number(authoritativeCapabilities?.cursor)
            === action.expectedHistoryCursor
        );
        if (
          !isCurrentProjectContext(context)
          || (!actionApplied && !actionStillEligible)
        ) {
          const conflict = new Error(
            "无法确认上一次撤销或重做的结果，已停止重复操作。",
          ) as Error & { code?: string };
          conflict.code = "SOURCE_HISTORY_RECONCILIATION_CONFLICT";
          throw conflict;
        }
        // Querying workspace authority either confirms the original action or
        // proves that its original preconditions still hold. The same stable
        // actionId can now be replayed once without double-applying a patch.
        payload = await bridgeClient.sourceHistoryAction(requestBody);
      }
      const canonicalHtml =
        typeof payload.content === "string" ? payload.content : "";
      const nextSourceSha256 = String(
        payload.sha256
        || payload.sourceSha256
        || payload.currentHtmlSha256
        || "",
      );
      const persistedRevision = Number(
        payload.persistedRevision
        || payload.lastPersistedRevision,
      );
      if (
        !canonicalHtml
        || !/^sha256:[a-f0-9]{64}$/.test(nextSourceSha256)
        || await browserSha256(canonicalHtml) !== nextSourceSha256
        || !Number.isSafeInteger(persistedRevision)
        || persistedRevision < documentSessionRef.current.lastPersistedRevision
        || !isRecord(payload.sourceHistory)
      ) {
        const invalid = new Error(
          "撤销结果与持久化源码历史不一致。",
        ) as Error & { code?: string };
        invalid.code = "INVALID_SOURCE_HISTORY_ACK";
        throw invalid;
      }
      if (!isCurrentProjectContext(context)) {
        editorRef.current?.cancelHistoryAction({ restore: false });
        return false;
      }
      if (!sourceHistorySessionRef.current.replaceAuthority(
        context,
        payload.sourceHistory,
        nextSourceSha256,
      )) {
        sourceHistorySessionRef.current.activate(
          context,
          nextSourceSha256,
          payload.sourceHistory,
        );
      }

      const rawHistoryTarget = isRecord(payload.target)
        ? selectionFromRecord(payload.target)
        : null;
      const rawTransition = isRecord(payload.targetTransition)
        ? payload.targetTransition
        : null;
      const historyTransition = {
        fromTarget: isRecord(rawTransition?.fromTarget)
          ? selectionFromRecord(rawTransition.fromTarget)
          : null,
        toTarget: isRecord(rawTransition?.toTarget)
          ? selectionFromRecord(rawTransition.toTarget)
          : null,
      };
      const historyTextSelection = historyTextSelectionFromRecord(
        payload.selection,
      );
      const targets = [
        ...commentSessionRef.current.comments.map((comment) => comment.target),
        ...commentSessionRef.current.changeEvents.map((event) => event.target),
        ...(commentSessionRef.current.composerTarget ? [commentSessionRef.current.composerTarget] : []),
        ...(rawHistoryTarget ? [rawHistoryTarget] : []),
      ];
      const reboundTargets = historyTransition.fromTarget
        && historyTransition.toTarget
        ? rebindTargetsAcrossHistoryPreservingGlobal(
            documentSessionRef.current.html,
            canonicalHtml,
            targets,
            historyTransition,
          )
        : rebindTargetsPreservingGlobal(canonicalHtml, targets);
      const reboundById = new Map(
        reboundTargets.map((target) => [target.id, target]),
      );
      const nextComments = commentSessionRef.current.comments.map((comment) => ({
        ...comment,
        target: reboundById.get(comment.target.id) || {
          ...comment.target,
          resolution: "orphaned" as const,
        },
      }));
      const nextEvents = commentSessionRef.current.changeEvents.map((event) => ({
        ...event,
        target: reboundById.get(event.target.id) || {
          ...event.target,
          resolution: "orphaned" as const,
        },
      }));
      commentSessionRef.current.update({
        comments: nextComments,
        changeEvents: nextEvents,
      });
      if (commentSessionRef.current.composerTarget) {
        const nextDraftTarget =
          reboundById.get(commentSessionRef.current.composerTarget.id)
          || { ...commentSessionRef.current.composerTarget, resolution: "orphaned" as const };
        commentSessionRef.current.setComposerTarget(nextDraftTarget);
      }
      const nextHistoryTarget = rawHistoryTarget
        ? reboundById.get(rawHistoryTarget.id) || rawHistoryTarget
        : null;
      editorRef.current?.adoptHistorySource(
        canonicalHtml,
        nextHistoryTarget,
        historyTextSelection,
      );
      recoveryIdentityRef.current =
        recoveryIdentityFromRecord(payload.recoveryIdentity)
        || recoveryIdentityRef.current;
      // Source history already performs canonical Canvas adoption (mounted
      // island when proven safe, otherwise a fresh frame) and restores the
      // active target/caret. Publish the complete Document tuple without
      // advancing the project/version Canvas generation.
      documentSessionRef.current.update({
        html: canonicalHtml,
        sourceSha256: nextSourceSha256,
        editRevision: Math.max(
          documentSessionRef.current.editRevision,
          persistedRevision,
        ),
        lastPersistedRevision: Math.max(
          documentSessionRef.current.lastPersistedRevision,
          persistedRevision,
        ),
        pendingWrite: null,
      });
      setLastModifiedAt(String(payload.lastModifiedAt || ""));
      versionSessionRef.current.updateAuthority({
        currentExactVersionId: payload.currentExactVersionId,
      });
      invalidateCanvasRenderAcks();
      persistRecoveryLog(null, context);
      documentSessionRef.current.setPersistence({
        state: "idle",
        error: "",
      });
      return true;
    };

    const promise = run().catch((cause) => {
      editorRef.current?.cancelHistoryAction();
      const message = productErrorMessage(
        cause,
        direction === "undo"
          ? "这次撤销没有完成，源 HTML 保持不变。"
          : "这次重做没有完成，源 HTML 保持不变。",
      );
      documentSessionRef.current.setPersistence({
        state: "failed",
        error: message,
      });
      setToast({
        title: direction === "undo" ? "撤销未完成" : "重做未完成",
        message,
        tone: "warning",
        disposition: "background-result",
        dedupeKey: `source-history-${direction}-failed`,
      });
      return false;
    });
    historyActionPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (historyActionPromiseRef.current === promise) {
        historyActionPromiseRef.current = null;
      }
    }
  }, [
    captureProjectContext,
    deferEditorCommand,
    flushAutosave,
    invalidateCanvasRenderAcks,
    isCurrentProjectContext,
    persistRecoveryLog,
    viewMode,
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
    focusedCommentIdRef.current = commentId;
    setFocusedCommentId(commentId);
  }, []);

  const queueReviewPairReveal = useCallback((
    target: HtmlCanvasSelection,
    itemKey: string,
  ) => {
    reviewRevealPendingRef.current = { target, itemKey };
    const requestId = ++reviewRevealRequestRef.current;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (requestId !== reviewRevealRequestRef.current) return;
        const stage = reviewStageRef.current;
        const rail = commentsPanelRef.current;
        if (!stage || !rail) return;
        if (!itemKey) {
          commentRailOffsetRef.current = 0;
          setCommentRailFollowsFocus(false);
          setCommentRailOffset(0);
          reviewRevealPendingRef.current = null;
          return;
        }
        const item = [...rail.querySelectorAll<HTMLElement>("[data-comment-measure]")]
          .find((node) => node.dataset.commentMeasure === itemKey);
        const targetTop = target.tagName === "body"
          ? commentRailMinimumTop
          : commentTargetTops[target.id];
        if (!Number.isFinite(targetTop)) return;
        if (!item) return;
        const safeTargetTop = Math.max(
          commentRailMinimumTop,
          targetTop as number,
        );
        const itemTop = item?.offsetTop ?? safeTargetTop;
        const nextRailOffset = computeAlignedRailOffset({
          targetTop: safeTargetTop,
          cardTop: itemTop,
          minimumTop: commentRailMinimumTop,
        });
        commentRailOffsetRef.current = nextRailOffset;
        setCommentRailFollowsFocus(true);
        setCommentRailOffset(nextRailOffset);
        const desiredTop = Math.max(
          0,
          safeTargetTop - commentRailMinimumTop - 10,
        );
        const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        stage.scrollTo({
          top: Math.min(desiredTop, maxTop),
          behavior: reduceMotion ? "auto" : "smooth",
        });
        if (requestId === reviewRevealRequestRef.current) {
          reviewRevealPendingRef.current = null;
        }
      });
    });
  }, [commentRailMinimumTop, commentTargetTops]);

  const requestComposerFocus = useCallback(() => {
    composerFocusPendingRef.current = true;
    const composer = composerRef.current;
    if (!composer || composer.disabled) return;
    composerFocusPendingRef.current = false;
    composer.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (canvasMode !== "edit") return undefined;
    const rail = commentsPanelRef.current;
    if (!rail) return undefined;
    const handleWheel = (event: WheelEvent) => {
      const stage = reviewStageRef.current;
      if (!stage) return;
      event.preventDefault();
      event.stopPropagation();
      const currentRailOffset = commentRailOffsetRef.current;
      const routed = routeCommentRailWheel({
        pageScrollTop: stage.scrollTop,
        pageMaxScrollTop: Math.max(
          0,
          stage.scrollHeight - stage.clientHeight,
        ),
        railOffset: currentRailOffset,
        railMinOffset: commentRailMinimumOffsetRef.current,
        deltaY: event.deltaY,
      });
      if (Math.abs(routed.railOffset - currentRailOffset) > 0.01) {
        commentRailOffsetRef.current = routed.railOffset;
        setCommentRailFollowsFocus(false);
        setCommentRailOffset(routed.railOffset);
      }
      if (Math.abs(routed.pageScrollTop - stage.scrollTop) > 0.01) {
        stage.scrollTop = routed.pageScrollTop;
      }
    };
    rail.addEventListener("wheel", handleWheel, { passive: false });
    return () => rail.removeEventListener("wheel", handleWheel);
  }, [canvasMode]);

  useEffect(() => {
    if (
      canvasMode === "edit"
      && (focusedCommentId || composerOpen || editingCommentId)
    ) return undefined;
    const frame = window.requestAnimationFrame(() => {
      commentRailOffsetRef.current = 0;
      setCommentRailFollowsFocus(false);
      setCommentRailOffset(0);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [canvasMode, composerOpen, editingCommentId, focusedCommentId]);

  const beginTargetRelink = useCallback((itemId: string) => {
    relinkingTargetRef.current = itemId;
    relinkSelectionArmedRef.current = false;
    setRelinkingTarget(itemId);
    setPendingDeleteCommentId(null);
    setEditingCommentId(null);
    if (!commentEditSessionHasChanges(commentSessionRef.current.editSession)) {
      commentSessionRef.current.setEditSession(null);
      commentEditResumePendingRef.current = null;
    }
    editorRef.current?.clearSelection();
    setSelection(null);
    if (itemId !== "__composer") {
      updateFocusedComment(itemId);
      const comment = commentSessionRef.current.comments.find(
        (item) => item.commentId === itemId,
      );
      if (comment) queueReviewPairReveal(comment.target, itemId);
    }
  }, [queueReviewPairReveal, updateFocusedComment]);

  const finishTargetRelink = useCallback((target: HtmlCanvasSelection): boolean => {
    const relinkingId = relinkingTargetRef.current;
    if (
      !relinkingId
      || !relinkSelectionArmedRef.current
      || !canSaveCommentTarget(target)
    ) return false;
    if (relinkingId === "__composer") {
      const currentTarget = commentSessionRef.current.composerTarget;
      const nextTarget = currentTarget
        ? { ...target, id: currentTarget.id }
        : target;
      commentSessionRef.current.setComposerTarget(nextTarget);
      setSelection(nextTarget);
      relinkingTargetRef.current = null;
      relinkSelectionArmedRef.current = false;
      setRelinkingTarget(null);
      setComposerOpen(true);
      persistCurrentDraftRecovery();
      queueReviewPairReveal(nextTarget, "__composer");
      requestComposerFocus();
      return true;
    }
    const current = commentSessionRef.current.comments.find(
      (comment) => comment.commentId === relinkingId,
    );
    if (!current) {
      relinkingTargetRef.current = null;
      relinkSelectionArmedRef.current = false;
      setRelinkingTarget(null);
      return false;
    }
    const nextTarget = { ...target, id: current.target.id };
    const nextComments = commentSessionRef.current.comments.map((comment) => (
      comment.commentId === relinkingId
        ? {
            ...comment,
            target: nextTarget,
            updatedAt: new Date().toISOString(),
          }
        : comment
    ));
    commentSessionRef.current.setComments(nextComments);
    setSelection(nextTarget);
    relinkingTargetRef.current = null;
    relinkSelectionArmedRef.current = false;
    setRelinkingTarget(null);
    persistCurrentDraftRecovery(nextComments);
    updateFocusedComment(relinkingId);
    queueReviewPairReveal(nextTarget, relinkingId);
    const remainingUnsafe = nextComments.filter(
      (comment) => commentHasContent(comment) && !canLocateTarget(comment.target),
    );
    if (remainingUnsafe.length > 0) {
      setToast(unsafeCommentTargetsNotice(remainingUnsafe));
      window.requestAnimationFrame(() => {
        beginTargetRelink(remainingUnsafe[0].commentId);
      });
    } else if (resumeSubmissionAfterRelinkRef.current) {
      resumeSubmissionAfterRelinkRef.current = false;
      setToast(null);
      window.requestAnimationFrame(() => {
        deferredEditorReplayRef.current.generateRequest?.();
      });
    }
    return true;
  }, [
    beginTargetRelink,
    persistCurrentDraftRecovery,
    queueReviewPairReveal,
    requestComposerFocus,
    updateFocusedComment,
  ]);

  const cancelTargetRelink = useCallback(() => {
    const relinkingId = relinkingTargetRef.current;
    relinkingTargetRef.current = null;
    relinkSelectionArmedRef.current = false;
    resumeSubmissionAfterRelinkRef.current = false;
    setRelinkingTarget(null);
    if (relinkingId === "__composer") {
      requestComposerFocus();
    }
  }, [requestComposerFocus]);

  const clearCurrentComposer = useCallback(() => {
    composerFocusPendingRef.current = false;
    commentSessionRef.current.clearComposer();
    setComposerOpen(false);
    setPendingDeleteCommentId(null);
    updateFocusedComment(null);
  }, [updateFocusedComment]);

  const resumeCurrentComposer = useCallback(() => {
    const target = commentSessionRef.current.composerTarget;
    if (!target) return;
    if (!canSaveCommentTarget(target)) {
      beginTargetRelink("__composer");
      return;
    }
    const located = editorRef.current?.select(target, { showToolbar: false });
    const nextTarget = located || target;
    commentSessionRef.current.setComposerTarget(nextTarget);
    setSelection(nextTarget);
    updateFocusedComment(null);
    setPendingDeleteCommentId(null);
    setComposerOpen(true);
    queueReviewPairReveal(nextTarget, "__composer");
    if (toastRef.current?.dedupeKey === "unfinished-comment-draft") {
      setToast(null);
    }
    requestComposerFocus();
  }, [
    beginTargetRelink,
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
    if (relinkingTargetRef.current && finishTargetRelink(target)) return;
    if (attachmentUploadCountRef.current > 0) return;
    if (
      runSessionRef.current.activeLocked
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
      || documentSessionRef.current.persistState === "conflict"
      || viewMode === "history"
    ) return;
    if (!canSaveCommentTarget(target)) {
      return;
    }
    const currentEdit = commentSessionRef.current.editSession;
    if (currentEdit && commentEditSessionHasChanges(currentEdit)) {
      showUnfinishedCommentEditNotice(currentEdit);
      return;
    }
    if (currentEdit) {
      commentSessionRef.current.setEditSession(null);
      commentEditResumePendingRef.current = null;
      setEditingCommentId(null);
    }
    // Opening a composer is the first durable project action for a lazily
    // registered HTML. Start identity creation before accepting text so crash
    // recovery and the Bridge draft share one authority.
    void prepareProjectRecords();
    const recoveredDraftTarget = commentSessionRef.current.composerTarget;
    if (
      recoveredDraftTarget
      && recoveredDraftTarget.id !== target.id
      && (
        commentSessionRef.current.composerDraft.trim()
        || commentSessionRef.current.composerAttachments.length > 0
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
    setSelection(target);
    const resumesRecoveredDraft = commentSessionRef.current.composerTarget?.id === target.id;
    if (!resumesRecoveredDraft) {
      const nextCommentId = recordId("comment", commentCounter.current++);
      commentSessionRef.current.update({
        composerDraft: "",
        composerCommentId: nextCommentId,
        composerAttachments: [],
        composerTarget: target,
      });
    } else if (!commentSessionRef.current.composerCommentId) {
      const nextCommentId = recordId("comment", commentCounter.current++);
      commentSessionRef.current.update({
        composerCommentId: nextCommentId,
        composerTarget: target,
      });
    } else {
      commentSessionRef.current.setComposerTarget(target);
    }
    updateFocusedComment(null);
    setComposerOpen(true);
    queueReviewPairReveal(target, "__composer");
    requestComposerFocus();
  }, [
    finishTargetRelink,
    prepareProjectRecords,
    queueReviewPairReveal,
    requestComposerFocus,
    showUnfinishedCommentEditNotice,
    updateFocusedComment,
    viewMode,
  ]);

  const openGlobalCommentComposer = useCallback(() => {
    if (interactionLocked) {
      if (runInProgress) setDrawer("handoff");
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
    const wasRelinking = Boolean(relinkingTargetRef.current);
    editorRef.current?.clearSelection();
    setSelection(null);
    if (wasRelinking) {
      relinkSelectionArmedRef.current = true;
      finishTargetRelink(globalTarget);
      return;
    }
    openCommentComposer(globalTarget);
  }, [
    finishTargetRelink,
    interactionLocked,
    openCommentComposer,
    runInProgress,
  ]);

  const closeCommentComposer = useCallback(() => {
    if (attachmentUploadCountRef.current > 0) return;
    setPendingDeleteCommentId(null);
    if (
      commentSessionRef.current.composerDraft.trim()
      || commentSessionRef.current.composerAttachments.length > 0
    ) {
      setComposerOpen(false);
      updateFocusedComment(null);
      persistCurrentDraftRecovery();
      return;
    }
    clearCurrentComposer();
    persistCurrentDraftRecovery();
  }, [
    clearCurrentComposer,
    persistCurrentDraftRecovery,
    updateFocusedComment,
  ]);

  const discardCurrentComposer = useCallback(() => {
    if (attachmentUploadCountRef.current > 0) return;
    const discardedCommentId = commentSessionRef.current.composerCommentId;
    const discardedAttachments = [...commentSessionRef.current.composerAttachments];
    if (relinkingTargetRef.current === "__composer") {
      relinkingTargetRef.current = null;
      relinkSelectionArmedRef.current = false;
      setRelinkingTarget(null);
    }
    if (discardedCommentId) {
      commentSessionRef.current.markDeleted(discardedCommentId);
    }
    clearCurrentComposer();
    persistCurrentDraftRecovery();
    for (const attachment of discardedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
      void deleteAttachmentFile(attachment);
    }
    if (toastRef.current?.dedupeKey === "unfinished-comment-draft") {
      setToast(null);
    }
  }, [
    clearCurrentComposer,
    deleteAttachmentFile,
    forgetAttachmentObjectUrl,
    persistCurrentDraftRecovery,
  ]);

  const addComment = useCallback(async () => {
    if (
      runSessionRef.current.activeLocked
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
      || documentSessionRef.current.persistState === "conflict"
      || viewMode === "history"
    ) return;
    if (!draftTarget) {
      editorRef.current?.clearSelection();
      return;
    }
    if (!canSaveCommentTarget(draftTarget)) {
      return;
    }
    if (!draft.trim() && draftAttachments.length === 0) {
      requestComposerFocus();
      return;
    }
    if (attachmentUploadCount > 0) return;
    const commentEpoch = projectSessionRef.current.epoch;
    const requestedTargetId = draftTarget.id;
    if (projectSessionRef.current.sourcePath) {
      try {
        const registered = registrationContextFromOutcome(
          await workspaceController.ensureRegistered(),
        );
        if (!registered) throw new Error("当前项目已经切换，请重试。");
      } catch (cause) {
        if (commentEpoch !== projectSessionRef.current.epoch) return;
        setToast({
          title: "评论尚未保存",
          message: productErrorMessage(
            cause,
            "项目记录暂时无法建立；评论内容仍保留在输入框中。",
          ),
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "project-registration",
          action: { id: "resume-draft", label: "继续填写" },
        });
        requestComposerFocus();
        return;
      }
    }
    const currentTarget = commentSessionRef.current.composerTarget;
    if (
      commentEpoch !== projectSessionRef.current.epoch
      || runSessionRef.current.activeLocked
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
      || String(documentSessionRef.current.persistState) === "conflict"
      || !currentTarget
      || currentTarget.id !== requestedTargetId
      || !canSaveCommentTarget(currentTarget)
    ) return;
    const currentText = commentSessionRef.current.composerDraft.trim();
    const currentAttachments = [...commentSessionRef.current.composerAttachments];
    if (!currentText && currentAttachments.length === 0) {
      requestComposerFocus();
      return;
    }
    const now = new Date().toISOString();
    const commentId = commentSessionRef.current.composerCommentId
      || draftCommentId
      || recordId("comment", commentCounter.current++);
    const commentTarget = independentCommentTarget(currentTarget, commentId);
    const nextComments = [...commentSessionRef.current.comments, {
      commentId,
      createdAt: now,
      updatedAt: now,
      target: commentTarget,
      text: currentText,
      ...(currentAttachments.length > 0
        ? { attachments: currentAttachments.map(persistedAttachment) }
        : {}),
      baseVersionId: currentBasedOnVersionId,
    }];
    const nextDeletedCommentIds = commentSessionRef.current.deletedCommentIds;
    nextDeletedCommentIds.delete(nextComments.at(-1)?.commentId || "");
    commentSessionRef.current.update({
      comments: nextComments,
      deletedCommentIds: nextDeletedCommentIds,
      composerDraft: "",
      composerCommentId: null,
      composerAttachments: [],
      composerTarget: null,
    });
    setComposerOpen(false);
    setPendingDeleteCommentId(null);
    if (toastRef.current?.dedupeKey === "unfinished-comment-draft") {
      setToast(null);
    }
    updateFocusedComment(commentId);
    persistCurrentDraftRecovery(nextComments);
    queueReviewPairReveal(commentTarget, commentId);
    captureUsageEvent("comment_saved", {
      target_level: commentTarget.level === "insertion"
        ? "insertion"
        : commentTarget.level === "part" ? "part" : "module",
      has_text: Boolean(currentText),
      attachment_count: countBucket(currentAttachments.length),
      has_image: currentAttachments.some((attachment) => attachment.kind === "image"),
      has_file: currentAttachments.some((attachment) => attachment.kind === "file"),
    }, projectSessionRef.current.projectId || undefined);
  }, [
    currentBasedOnVersionId,
    draft,
    draftAttachments,
    draftCommentId,
    draftTarget,
    attachmentUploadCount,
    persistCurrentDraftRecovery,
    queueReviewPairReveal,
    requestComposerFocus,
    updateFocusedComment,
    viewMode,
    workspaceController,
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
    if (
      commentSessionRef.current.composerTarget
      && (
        commentSessionRef.current.composerDraft.trim()
        || commentSessionRef.current.composerAttachments.length > 0
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
    if (commentSessionRef.current.composerTarget) clearCurrentComposer();
    const currentSession = commentSessionRef.current.editSession;
    if (
      currentSession
      && currentSession.commentId !== comment.commentId
      && commentEditSessionHasChanges(currentSession)
    ) {
      showUnfinishedCommentEditNotice(currentSession);
      return false;
    }
    const nextSession = (
      currentSession?.commentId === comment.commentId
        ? currentSession
        : {
            commentId: comment.commentId,
            baselineText: comment.text,
            baselineAttachments: [...(comment.attachments ?? [])],
            draftText: comment.text,
            draftAttachments: [...(comment.attachments ?? [])],
          }
    );
    commentSessionRef.current.setEditSession(nextSession);
    setPendingDeleteCommentId(null);
    setEditingCommentId(comment.commentId);
    queueReviewCommentFocus(comment.target, comment.commentId);
    if (focusText) {
      window.requestAnimationFrame(() => {
        commentEditRef.current?.focus({ preventScroll: true });
        if (!commentEditSessionHasChanges(nextSession)) {
          commentEditRef.current?.select();
        }
      });
    }
    return true;
  }, [
    clearCurrentComposer,
    queueReviewCommentFocus,
    showUnfinishedCommentEditNotice,
  ]);

  const cancelCommentEdit = useCallback((revealComment = true) => {
    if (attachmentUploadCountRef.current > 0) return;
    const session = commentSessionRef.current.editSession;
    const current = commentSessionRef.current.comments.find(
      (comment) => comment.commentId === session?.commentId,
    );
    const baselineIds = new Set(
      session?.baselineAttachments.map(
        (attachment) => attachment.attachmentId,
      ) ?? [],
    );
    const stagedAttachments = session?.draftAttachments.filter(
      (attachment) => !baselineIds.has(attachment.attachmentId),
    ) ?? [];
    commentSessionRef.current.setEditSession(null);
    commentEditResumePendingRef.current = null;
    setEditingCommentId(null);
    persistCurrentDraftRecovery();
    for (const attachment of stagedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
      void deleteAttachmentFile(attachment);
    }
    if (toastRef.current?.dedupeKey === "unfinished-comment-edit") {
      setToast(null);
    }
    if (revealComment && current) {
      queueReviewCommentFocus(current.target, current.commentId);
    }
  }, [
    deleteAttachmentFile,
    forgetAttachmentObjectUrl,
    persistCurrentDraftRecovery,
    queueReviewCommentFocus,
  ]);

  const resumeCommentEdit = useCallback((commentId?: string) => {
    const session = commentSessionRef.current.editSession;
    if (!session || (commentId && session.commentId !== commentId)) return;
    const current = commentSessionRef.current.comments.find(
      (comment) => comment.commentId === session.commentId,
    );
    if (!current) {
      commentSessionRef.current.setEditSession(null);
      commentEditResumePendingRef.current = null;
      setEditingCommentId(null);
      persistCurrentDraftRecovery();
      return;
    }
    const located = editorRef.current?.select(
      current.target,
      { showToolbar: false },
    );
    const nextTarget = located || current.target;
    setSelection(nextTarget);
    const targetVisible = (
      current.target.tagName === "body"
      || commentTargetLayouts[current.target.id]?.status === "visible"
    );
    commentEditResumePendingRef.current = targetVisible
      ? null
      : current.commentId;
    if (targetVisible) setEditingCommentId(current.commentId);
    queueReviewCommentFocus(nextTarget, current.commentId);
    if (toastRef.current?.dedupeKey === "unfinished-comment-edit") {
      setToast(null);
    }
    if (targetVisible) {
      window.requestAnimationFrame(() => {
        commentEditRef.current?.focus({ preventScroll: true });
      });
    }
  }, [
    commentTargetLayouts,
    persistCurrentDraftRecovery,
    queueReviewCommentFocus,
  ]);

  const updateCommentEditDraft = useCallback((draftText: string) => {
    const current = commentSessionRef.current.editSession;
    if (!current) return;
    const nextSession = { ...current, draftText };
    commentSessionRef.current.setEditSession(nextSession);
    persistCurrentDraftRecovery();
  }, [persistCurrentDraftRecovery]);

  const confirmCommentEdit = useCallback((commentId: string) => {
    const current = commentSessionRef.current.comments.find((comment) => comment.commentId === commentId);
    const session = commentSessionRef.current.editSession;
    if (!current || !session || session.commentId !== commentId) {
      cancelCommentEdit();
      return;
    }
    if (attachmentUploadCountRef.current > 0) return;
    const nextText = session.draftText.trim();
    const nextAttachments = session.draftAttachments.map(persistedAttachment);
    if (!nextText && nextAttachments.length === 0) return;
    const nextComments = commentSessionRef.current.comments.map((comment) => (
      comment.commentId === commentId
        ? {
            ...comment,
            text: nextText,
            ...(nextAttachments.length > 0
              ? { attachments: nextAttachments }
              : { attachments: undefined }),
            updatedAt: new Date().toISOString(),
          }
        : comment
    ));
    const nextAttachmentIds = new Set(
      nextAttachments.map((attachment) => attachment.attachmentId),
    );
    const removedAttachments = session.baselineAttachments.filter(
      (attachment) => !nextAttachmentIds.has(attachment.attachmentId),
    );
    commentSessionRef.current.update({
      comments: nextComments,
      editSession: null,
    });
    commentEditResumePendingRef.current = null;
    setEditingCommentId(null);
    persistCurrentDraftRecovery(nextComments);
    for (const attachment of removedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
      void deleteAttachmentFile(attachment);
    }
    if (toastRef.current?.dedupeKey === "unfinished-comment-edit") {
      setToast(null);
    }
    queueReviewCommentFocus(current.target, current.commentId);
  }, [
    cancelCommentEdit,
    deleteAttachmentFile,
    forgetAttachmentObjectUrl,
    persistCurrentDraftRecovery,
    queueReviewCommentFocus,
  ]);

  const deleteComment = useCallback((commentId: string) => {
    const deleted = commentSessionRef.current.comments.find((item) => item.commentId === commentId);
    const editSession = commentSessionRef.current.editSession?.commentId === commentId
      ? commentSessionRef.current.editSession
      : null;
    const nextComments = commentSessionRef.current.comments.filter(
      (item) => item.commentId !== commentId,
    );
    commentSessionRef.current.update({
      comments: nextComments,
      deletedCommentIds: [
        ...commentSessionRef.current.deletedCommentIds,
        commentId,
      ],
      ...(editSession ? { editSession: null } : {}),
    });
    setPendingDeleteCommentId(null);
    if (editSession) {
      commentEditResumePendingRef.current = null;
      setEditingCommentId(null);
    }
    persistCurrentDraftRecovery(nextComments);
    const attachmentsToDelete = new Map(
      [
        ...(deleted?.attachments ?? []),
        ...(editSession?.draftAttachments ?? []),
      ].map((attachment) => [attachment.attachmentId, attachment]),
    );
    for (const attachment of attachmentsToDelete.values()) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
      void deleteAttachmentFile(attachment);
    }
    if (deleted) {
      updateFocusedComment(null);
      queueReviewPairReveal(deleted.target, "");
    }
  }, [
    deleteAttachmentFile,
    forgetAttachmentObjectUrl,
    persistCurrentDraftRecovery,
    queueReviewPairReveal,
    updateFocusedComment,
  ]);

  useEffect(() => {
    const session = commentSessionRef.current.editSession;
    if (!session) return;
    const editedComment = commentSessionRef.current.comments.find(
      (comment) => comment.commentId === session.commentId,
    );
    if (!editedComment) {
      commentSessionRef.current.setEditSession(null);
      commentEditResumePendingRef.current = null;
      setEditingCommentId(null);
      return;
    }
    const targetStatus = commentTargetLayouts[editedComment.target.id]?.status;
    const leftEditingContext = (
      canvasMode !== "edit"
      || targetStatus === "hidden"
      || (
        Boolean(focusedCommentId)
        && focusedCommentId !== session.commentId
      )
    );
    if (!leftEditingContext) return;
    if (!commentEditSessionHasChanges(session)) {
      cancelCommentEdit(false);
      return;
    }
    if (editingCommentId === session.commentId) {
      setEditingCommentId(null);
    }
  }, [
    cancelCommentEdit,
    canvasMode,
    commentEditSession,
    commentTargetLayouts,
    editingCommentId,
    focusedCommentId,
  ]);

  useEffect(() => {
    const pendingId = commentEditResumePendingRef.current;
    const session = commentSessionRef.current.editSession;
    if (
      canvasMode !== "edit"
      || !pendingId
      || !session
      || session.commentId !== pendingId
    ) return;
    const current = commentSessionRef.current.comments.find(
      (comment) => comment.commentId === pendingId,
    );
    if (!current) {
      commentEditResumePendingRef.current = null;
      return;
    }
    const targetVisible = (
      current.target.tagName === "body"
      || commentTargetLayouts[current.target.id]?.status === "visible"
    );
    if (!targetVisible) return;
    commentEditResumePendingRef.current = null;
    setEditingCommentId(current.commentId);
    queueReviewCommentFocus(current.target, current.commentId);
    window.requestAnimationFrame(() => {
      commentEditRef.current?.focus({ preventScroll: true });
    });
  }, [
    canvasMode,
    commentEditSession,
    commentTargetLayouts,
    queueReviewCommentFocus,
  ]);

  const focusCommentTarget = useCallback((
    target: HtmlCanvasSelection,
    commentId: string,
  ) => {
    if (!canLocateTarget(target)) {
      setSelection(target);
      updateFocusedComment(commentId);
      queueReviewPairReveal(target, commentId);
      return;
    }
    updateFocusedComment(commentId);
    const located = editorRef.current?.select(target, { showToolbar: false });
    const nextTarget = located || target;
    setSelection(nextTarget);
    queueReviewPairReveal(nextTarget, commentId);
  }, [queueReviewPairReveal, updateFocusedComment]);

  const handleCanvasSelection = useCallback((target: HtmlCanvasSelection | null) => {
    commentRailOffsetRef.current = 0;
    setCommentRailFollowsFocus(false);
    setCommentRailOffset(0);
    setSelection(target);
    if (!target) {
      if (!composerOpen) updateFocusedComment(null);
      return;
    }
    if (finishTargetRelink(target)) return;
    if (composerOpen || viewMode === "history") return;
    const matchesTarget = (comment: CommentItem) => (
      comment.target.id === target.id
      || (
        comment.target.selector === target.selector
        && comment.target.level === target.level
      )
    );
    const currentFocusedId = focusedCommentIdRef.current;
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
    composerOpen,
    finishTargetRelink,
    updateFocusedComment,
    viewMode,
    visibleCommentItems,
  ]);

  const readWorkspaceFile = useCallback(async (
    relativePath: string,
    projectSourcePath: string,
  ): Promise<string> => {
    const payload = await bridgeClient.projectFile(
      projectSourcePath,
      relativePath,
    );
    return String(payload.content || "");
  }, []);

  const viewFile = useCallback(async (path: string) => {
    const context = captureProjectContext();
    if (!context) return;
    if (path === "PROJECT.md") {
      await projectRulesSessionRef.current.open(context);
      return;
    }
    projectRulesSessionRef.current.close();
    setFileView({
      path,
      content: "正在读取…",
      savedContent: "正在读取…",
      loading: true,
    });
    try {
      const content = await readWorkspaceFile(path, context.sourcePath);
      if (!isCurrentProjectContext(context)) return;
      setFileView({ path, content, savedContent: content, loading: false });
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      setFileView({
        path,
        content: "",
        savedContent: "",
        loading: false,
        error: productErrorMessage(
          cause,
          "项目文件暂时无法读取；未显示任何可编辑的替代内容。",
        ),
      });
    }
  }, [captureProjectContext, isCurrentProjectContext, readWorkspaceFile]);

  const beginProjectRulesComposition = useCallback((
    target: HTMLTextAreaElement,
  ) => {
    projectRulesSessionRef.current.beginComposition(target, target.value);
  }, []);

  const finishProjectRulesComposition = useCallback((
    target: HTMLTextAreaElement,
  ) => {
    projectRulesSessionRef.current.finishComposition(target);
  }, []);

  useEffect(() => {
    if (drawer === "files" && fileView?.path === "PROJECT.md") return;
    projectRulesSessionRef.current.leaveEditor();
  }, [drawer, fileView?.path]);

  const restoreProjectRules = useCallback(() => {
    const restoreEpoch = projectRulesSessionRef.current.restore();
    // Retire the exact textarea that owns macOS marked text. A late
    // composition input from that detached control can no longer overwrite
    // the explicit restore result.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        projectRulesSessionRef.current.settleRestore(restoreEpoch);
        const editor = projectRulesEditorRef.current;
        editor?.focus({ preventScroll: true });
        editor?.setSelectionRange(editor.value.length, editor.value.length);
      });
    });
  }, []);

  const saveProjectRules = useCallback(async (): Promise<boolean> => {
    return projectRulesSessionRef.current.save({ locked: runInProgress });
  }, [runInProgress]);

  useEffect(() => {
    if (
      !projectRulesSnapshot.open
      || projectRulesSnapshot.loading
      || projectRulesSnapshot.error
      || projectRulesSnapshot.content === projectRulesSnapshot.savedContent
      || projectRulesSaving
      || projectRulesCompositionActive
      || runInProgress
    ) return;
    const timer = window.setTimeout(() => {
      void saveProjectRules();
    }, PROJECT_RULES_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    projectRulesSnapshot,
    projectRulesCompositionActive,
    projectRulesSaving,
    runInProgress,
    saveProjectRules,
  ]);

  const closeFileView = useCallback(async (): Promise<boolean> => {
    if (
      projectRulesSnapshot.open
      && !projectRulesSnapshot.error
      && projectRulesSnapshot.content !== projectRulesSnapshot.savedContent
      && !await saveProjectRules()
    ) return false;
    projectRulesSessionRef.current.close();
    setFileView(null);
    return true;
  }, [projectRulesSnapshot, saveProjectRules]);

  useEffect(() => {
    saveProjectRulesRef.current = saveProjectRules;
  }, [saveProjectRules]);

  const sendToQoderWork = useCallback(async (
    handoffMessage: string,
    run: Pick<ActiveRun, "sourcePath" | "requestId" | "attemptId">,
  ) => {
    if (
      !handoffMessage.trim()
      || !run.sourcePath
      || !run.requestId
      || run.requestId === "pending"
    ) return;

    const publishStatus = (status: QoderHandoffUiStatus) => {
      const nextState: ProjectQoderHandoffState = {
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        status,
      };
      runSessionRef.current.publishHandoff(nextState);
    };
    publishStatus("copying");

    try {
      const integrations = window.htmlAIIntegrations;
      if (integrations?.handoffToQoderWork) {
        const result = await integrations.handoffToQoderWork({ message: handoffMessage });
        if (result.status !== "copied" || result.copied !== true) {
          throw new Error("桌面应用没有确认剪贴板写入成功。");
        }
      } else {
        await copyText(handoffMessage);
      }
      publishStatus("copied");
    } catch (cause) {
      publishStatus("failed");
      const visibleRun = runSessionRef.current.activeRun;
      if (
        sameLocalSourcePath(projectSessionRef.current.sourcePath, run.sourcePath)
        && visibleRun?.requestId === run.requestId
        && visibleRun.attemptId === run.attemptId
      ) {
        setToast({
          title: "交接内容还没有复制",
          message: productErrorMessage(
            cause,
            "本轮 Request 已保留；请打开处理详情后重试复制。",
          ),
          tone: "error",
          sticky: true,
          dedupeKey: `qoder-handoff:${run.sourcePath}`,
          action: { id: "open-handoff", label: "查看处理详情" },
        });
      }
    }
  }, []);

  const revealActiveRunInFinder = useCallback(async () => {
    const activeSourcePath = projectSessionRef.current.sourcePath;
    const requestPath = activeRun?.requestPath;
    const revealRequestFolder = window.htmlAIProjects?.revealRequestFolder;
    if (!activeSourcePath || !requestPath || !revealRequestFolder) return;
    await runLocalUserAction({
      kind: "reveal-request-folder",
      invoke: () => revealRequestFolder({
        sourcePath: activeSourcePath,
        requestPath,
      }),
      onFailure: (cause: unknown) => setToast({
        title: "本轮文件暂时无法打开",
        message: productErrorMessage(
          cause,
          "本轮任务仍在处理面板中，可以重新尝试。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "reveal-request-folder",
      }),
    });
  }, [activeRun?.requestPath]);

  const revealVersionInFinder = useCallback(async (version: Pick<Version, "id">) => {
    const activeSourcePath = projectSessionRef.current.sourcePath;
    const revealVersionFile = window.htmlAIProjects?.revealVersionFile;
    if (!activeSourcePath || !revealVersionFile) return;
    await runLocalUserAction({
      kind: "reveal-version-file",
      invoke: () => revealVersionFile({
        sourcePath: activeSourcePath,
        versionId: version.id,
      }),
      onFailure: (cause: unknown) => setToast({
        title: "历史版本暂时无法在 Finder 中显示",
        message: productErrorMessage(cause, "请确认项目记录仍然完整后重试。"),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: `reveal-version-file-${version.id}`,
      }),
    });
  }, []);

  const generateRequest = useCallback(async (fromDeferred = false) => {
    if (runSessionRef.current.submissionPending) return;
    const submissionSourcePath = projectSessionRef.current.sourcePath;
    if (!submissionSourcePath) {
      if (typeof window !== "undefined" && !window.htmlAIProjects) return;
      void openProject();
      return;
    }
    if (
      projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
    ) {
      return;
    }
    if (viewMode === "history") {
      return;
    }
    if (documentSessionRef.current.persistState === "failed" || documentSessionRef.current.persistState === "conflict") {
      return;
    }
    if (runSessionRef.current.activeLocked) {
      setDrawer("handoff");
      return;
    }
    if (
      commentSessionRef.current.composerTarget
      && (
        commentSessionRef.current.composerDraft.trim()
        || commentSessionRef.current.composerAttachments.length > 0
      )
    ) {
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
    const unfinishedEdit = commentSessionRef.current.editSession;
    if (unfinishedEdit && commentEditSessionHasChanges(unfinishedEdit)) {
      showUnfinishedCommentEditNotice(unfinishedEdit);
      return;
    }
    if (
      !fromDeferred
      && deferEditorCommand(
        "ai-handoff",
        () => deferredEditorReplayRef.current.generateRequest?.(),
      )
    ) return;

    // Commit the native DOM editing session while the project is still unlocked. The
    // SourcePatchEngine callback synchronously refreshes comment and audit
    // targets, so the Request cannot retain pre-edit TargetRefs.
    const committed = editorRef.current?.fencePendingEdit({
      resumeEditing: false,
      trigger: "ai",
    });
    if (!committed || !committed.ok) {
      editorRef.current?.showCommitBlocked(
        committed?.reason || "请点回文字完成输入，再发送本轮要求。",
      );
      return;
    }
    let activeComments = normalizeCurrentGlobalComments();
    if (activeComments.length === 0) {
      requestComposerFocus();
      return;
    }
    const unsafeTargets = activeComments.filter(
      (comment) => !canLocateTarget(comment.target),
    );
    if (unsafeTargets.length > 0) {
      setToast(unsafeCommentTargetsNotice(unsafeTargets));
      return;
    }

    const submissionEpoch = projectSessionRef.current.epoch;
    const submission = runSessionRef.current.beginSubmission({
      sourcePath: submissionSourcePath,
    });
    if (!submission) return;
    const releaseSubmission = () => {
      runSessionRef.current.releaseSubmission(submission);
    };

    try {
      const registered = registrationContextFromOutcome(
        await workspaceController.ensureRegistered(),
      );
      if (!registered) throw new Error("当前项目已经切换，请重试。");
      if (
        projectSessionRef.current.epoch !== submissionEpoch
        || !sameLocalSourcePath(projectSessionRef.current.sourcePath, submission.sourcePath)
      ) {
        throw new Error("当前项目已经切换，请重试。");
      }
    } catch (cause) {
      setToast({
        title: "项目记录尚未建立",
        message: productErrorMessage(
          cause,
          "请确认源 HTML 没有被外部修改后重试。",
        ),
        tone: "warning",
        sticky: true,
        disposition: "direct-action",
        dedupeKey: "project-registration",
        action: { id: "retry-submit", label: "重新建立并发送" },
      });
      releaseSubmission();
      return;
    }
    activeComments = normalizeCurrentGlobalComments();
    if (activeComments.length === 0) {
      requestComposerFocus();
      releaseSubmission();
      return;
    }
    const unsafeRegisteredTargets = activeComments.filter(
      (comment) => !canLocateTarget(comment.target),
    );
    if (unsafeRegisteredTargets.length > 0) {
      setToast(unsafeCommentTargetsNotice(unsafeRegisteredTargets));
      releaseSubmission();
      return;
    }

    // This synchronous section is the freeze boundary. No await is allowed before
    // the ref and the editor's native event guards are both locked.
    const frozen = editorRef.current?.freezeNow();
    if (
      !frozen
      || !frozen.ok
      || !/^sha256:[a-f0-9]{64}$/u.test(frozen.sourceSha256)
    ) {
      if (frozen?.ok) editorRef.current?.unlockNow();
      editorRef.current?.showCommitBlocked(
        frozen?.reason || "画布还没有形成可验证的 HTML 快照，本轮不会发送。",
      );
      releaseSubmission();
      return;
    }
    if (!runSessionRef.current.freezeSubmission(submission)) {
      editorRef.current?.unlockNow?.();
      releaseSubmission();
      return;
    }
    const capturedHtml = frozen.html;
    if (capturedHtml !== documentSessionRef.current.html) {
      enqueueAutosave(capturedHtml, frozen.pendingMutation || undefined);
    }
    const freezeCutoffRevision = documentSessionRef.current.editRevision;
    const submissionContext = {
      epoch: submissionEpoch,
      projectId: projectSessionRef.current.projectId,
      documentId: projectSessionRef.current.documentId,
      sourcePath: submission.sourcePath,
      projectName,
      comments: activeComments.map((comment) => ({ ...comment })),
      changeEvents: commentSessionRef.current.changeEvents.map((event) => ({ ...event })),
    };
    const pendingRun: ActiveRun = {
      projectId: submissionContext.projectId,
      documentId: submissionContext.documentId,
      requestId: "pending",
      attemptId: "attempt_001",
      requestPath: "",
      attemptPath: "",
      handoffMessage: "",
      status: "submitting",
      sourcePath: submissionContext.sourcePath,
      baseSnapshotSha256: frozen.sourceSha256,
      previousVersionId: latestVersionId,
      basedOnVersionId: currentBasedOnVersionId,
      freezeCutoffRevision,
      candidateVersionId: "",
      candidateVersionLabel: "下一版",
      submittedAt: new Date().toISOString(),
      summary: activeComments.map((comment) => (
        comment.text.trim()
        || `参考附件：${(comment.attachments ?? []).map((item) => item.fileName).join("、")}`
      )).join("；").slice(0, 5000),
      commentCount: activeComments.length,
      changeEventCount: submissionContext.changeEvents.length,
    };
    runSessionRef.current.forgetOutcome(submissionContext.sourcePath);
    setActiveRun(pendingRun);
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer("handoff");

    let requestDispatched = false;
    let durableRun: ActiveRun | null = null;
    let confirmedNoRun = false;
    let submissionUncertain = false;
    try {
      const drained = await drainCoordinatorRef.current.drain("submit", {
        deadlineAt: Date.now() + 60_000,
      });
      if (
        !drained.ok
        || documentSessionRef.current.lastPersistedRevision !== freezeCutoffRevision
        || documentSessionRef.current.editRevision !== freezeCutoffRevision
      ) {
        throw new Error(
          drained.ok
            ? "冻结前的最后一次修改尚未安全写入源 HTML。"
            : drained.reason,
        );
      }
      const persistedSourceSha256 = documentSessionRef.current.sourceSha256;
      if (
        persistedSourceSha256 !== frozen.sourceSha256
        || !isCurrentProjectContext(submissionContext)
      ) {
        throw new Error("冻结 HTML 的 Hash 与已写回源文件不一致。");
      }
      const persistedComments = commentSessionRef.current.comments.filter(commentHasContent);
      const unsafePersistedTargets = persistedComments.filter(
        (comment) => (
          !canLocateTarget(comment.target)
          || (
            comment.target.sourceAnchor
            && comment.target.sourceAnchor.sourceSha256
              !== persistedSourceSha256
          )
        ),
      );
      if (
        persistedComments.length !== submissionContext.comments.length
        || unsafePersistedTargets.length > 0
      ) {
        throw new Error("最新评论目标与已保存的源 HTML 不一致，请重新选择后再提交。");
      }
      submissionContext.comments = persistedComments.map(
        (comment) => ({ ...comment }),
      );
      submissionContext.changeEvents = commentSessionRef.current.changeEvents.map(
        (event) => ({ ...event }),
      );
      if (!isCurrentProjectContext(submissionContext)) {
        throw new Error("冻结边界内的最新评论与修改审计尚未安全记录。");
      }
      const targets = uniqueTargets(submissionContext.comments);
      requestDispatched = true;
      const payload = await bridgeClient.createRequest({
        projectId: submissionContext.projectId,
        documentId: submissionContext.documentId,
        projectName: fileStem(submissionContext.projectName),
        projectMd: projectMarkdown(submissionContext.projectName),
        sourcePath: submissionContext.sourcePath,
        expectedSourceSha256: persistedSourceSha256,
        freezeCutoffRevision,
        lastPersistedRevision: documentSessionRef.current.lastPersistedRevision,
        summary: submissionContext.comments.map((comment) => (
          comment.text.trim()
          || `参考附件：${(comment.attachments ?? []).map((item) => item.fileName).join("、")}`
        )).join("；").slice(0, 5000),
        targets: targets.map(persistedTargetRef),
        instructions: submissionContext.comments.map((comment) => ({
          instructionId: `instruction_${comment.commentId.replace(/^comment_/, "")}`,
          text: comment.text.trim() || "请结合本条评论所附附件完成修改。",
          targetRefs: [comment.target.id],
          attachmentRefs: (comment.attachments ?? []).map(
            (attachment) => attachment.attachmentId,
          ),
        })),
        comments: submissionContext.comments.map(persistedComment),
        changeEvents: submissionContext.changeEvents.map(persistedChangeEvent),
      });
      const run = activeRunFromRecord(
        isRecord(payload.activeRun)
          ? {
              ...payload.activeRun,
              candidateDisplayVersionLabel:
                payload.candidateDisplayVersionLabel,
            }
          : payload,
      );
      if (!run) throw new Error("任务已创建，但缺少可验证的 Request 身份。");
      durableRun = run;
      runSessionRef.current.trackRun(run);
      if (isCurrentProjectContext(submissionContext)) {
        setDrawer("handoff");
      }
    } catch (cause) {
      if (requestDispatched) {
        try {
          const reconcilePayload = await bridgeClient.workspace(
            submissionContext.sourcePath,
          );
          durableRun = activeRunFromRecord(
            (isRecord(reconcilePayload.runtimeState)
              ? reconcilePayload.runtimeState.activeRun
              : null)
            || reconcilePayload.activeRun,
          );
          if (durableRun) {
            runSessionRef.current.trackRun(durableRun);
          } else if (isCurrentProjectContext(submissionContext)) {
            confirmedNoRun = true;
            runSessionRef.current.clearActiveRun();
            editorRef.current?.unlockNow?.();
          }
        } catch {
          // Unknown POST outcome is intentionally kept locked until workspace
          // reconciliation succeeds; unlocking here could split client/server state.
        }
      } else if (isCurrentProjectContext(submissionContext)) {
        editorRef.current?.unlockNow?.();
        runSessionRef.current.clearActiveRun();
      }
      if (
        !durableRun
        && requestDispatched
        && !confirmedNoRun
        && isCurrentProjectContext(submissionContext)
      ) {
        const unknownRun = {
          ...pendingRun,
          status: "error",
          error: "本轮任务状态暂时无法确认。当前项目保持只读，避免重复建立任务。",
        } as ActiveRun;
        setActiveRun(unknownRun);
        submissionUncertain = runSessionRef.current
          .markSubmissionUncertain(submission);
      }
      if (!durableRun && requestDispatched && !confirmedNoRun) {
        setDrawer("handoff");
      } else if (!durableRun) {
        const failedRun: ActiveRun = {
          ...pendingRun,
          status: "error",
          error: productErrorMessage(
            cause,
            "这次发送没有成功。页面和评论仍然保留。",
          ),
        };
        setActiveRun(failedRun);
        setDrawer("handoff");
      }
    } finally {
      if (!submissionUncertain) releaseSubmission();
    }
    if (durableRun?.handoffMessage) {
      await sendToQoderWork(durableRun.handoffMessage, durableRun);
    }
  }, [
    deferEditorCommand,
    enqueueAutosave,
    isCurrentProjectContext,
    latestVersionId,
    currentBasedOnVersionId,
    normalizeCurrentGlobalComments,
    openProject,
    projectName,
    requestComposerFocus,
    sendToQoderWork,
    setActiveRun,
    showUnfinishedCommentEditNotice,
    viewMode,
    workspaceController,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.generateRequest = () => {
      void generateRequest(true);
    };
  }, [generateRequest]);

  const openCommittedVersion = useCallback(async (
    run: ActiveRun,
    payload: Record<string, unknown>,
    fromDeferred = false,
  ) => {
    const affectsCurrentCanvas = Boolean(projectSessionRef.current.sourcePath)
      && projectSessionRef.current.projectId === run.projectId;
    if (!fromDeferred && affectsCurrentCanvas) {
      let resolveDeferred: (() => void) | null = null;
      let rejectDeferred: ((reason: unknown) => void) | null = null;
      const deferredResult = new Promise<void>((resolve, reject) => {
        resolveDeferred = resolve;
        rejectDeferred = reject;
      });
      if (deferEditorCommand(
        "external-refresh",
        () => {
          const replay = deferredEditorReplayRef.current.openCommittedVersion;
          if (!replay) {
            rejectDeferred?.(
              new DeferredEditorCommandDiscardedError("stale-session"),
            );
            return;
          }
          replay(
            run,
            payload,
            () => resolveDeferred?.(),
            (reason) => rejectDeferred?.(reason),
          );
        },
        undefined,
        {
          authority: "system",
          onDiscard: (reason) => rejectDeferred?.(
            new DeferredEditorCommandDiscardedError(reason),
          ),
        },
      )) return deferredResult;
    }
    const versionRecord = isRecord(payload.version) ? payload.version : {};
    const outcomeRecord = isRecord(payload.outcome) ? payload.outcome : {};
    const completionRecord = isRecord(payload.completion) ? payload.completion : {};
    const candidateLabel = String(
      payload.candidateDisplayVersionLabel
      || run.candidateVersionLabel,
    );
    const aiCompletedAt = String(
      completionRecord.completedAt
      || "",
    );
    const versionGeneratedAt = String(
      versionRecord.generatedAt
      || "",
    );
    if (
      !aiCompletedAt
      || Number.isNaN(Date.parse(aiCompletedAt))
      || !versionGeneratedAt
      || Number.isNaN(Date.parse(versionGeneratedAt))
    ) {
      throw new Error("完成结果缺少可审计的 AI 完成时间或版本生成时间。");
    }
    const protocolViolation = Boolean(
      payload.protocolViolation || outcomeRecord.protocolViolation,
    );
    const versionId = String(
      payload.versionId
      || versionRecord.versionId
      || run.candidateVersionId
      || "",
    );
    const expectedHash = String(
      payload.contentSha256
      || versionRecord.contentSha256
      || payload.sourceSha256
      || payload.currentHtmlSha256
      || "",
    );
    if (!versionId || !expectedHash) throw new Error("完成结果缺少版本 ID 或内容 Hash。");
    const identities: Array<[string, string, unknown[]]> = [
      ["projectId", run.projectId, [payload.projectId, versionRecord.projectId, outcomeRecord.projectId]],
      ["documentId", run.documentId, [payload.documentId, versionRecord.documentId, outcomeRecord.documentId]],
      ["requestId", run.requestId, [payload.requestId, versionRecord.requestId, outcomeRecord.requestId]],
      ["attemptId", run.attemptId, [payload.attemptId, versionRecord.attemptId, outcomeRecord.attemptId]],
    ];
    for (const [field, expected, values] of identities) {
      const declared = values.filter((value) => value !== undefined && value !== null && value !== "");
      if (declared.some((value) => String(value) !== expected)) {
        throw new Error(`完成结果的 ${field} 与当前冻结任务不一致，已拒绝打开。`);
      }
    }
    if (run.candidateVersionId && versionId !== run.candidateVersionId) {
      throw new Error("完成结果的版本 ID 与系统预留候选版本不一致，已拒绝打开。");
    }
    const [versionPayload, sourcePayload] = await Promise.all([
      bridgeClient.versionFile(run.sourcePath, versionId),
      bridgeClient.source(run.sourcePath),
    ]);
    const versionHash = String(versionPayload.sha256 || "");
    const sourceHash = String(sourcePayload.sha256 || "");
    const content = String(versionPayload.content || "");
    const sourceContent = String(sourcePayload.content || "");
    const sourceLastModifiedAt = String(sourcePayload.lastModifiedAt || "");
    const committedSourcePath = String(
      sourcePayload.sourcePath
      || payload.currentPath
      || payload.workingCopyPath
      || payload.sourcePath
      || run.sourcePath,
    );
    if (versionHash !== expectedHash || sourceHash !== expectedHash) {
      throw new Error("版本快照、源 HTML 与完成记录的 Hash 不一致，已停止打开。");
    }
    if (
      content !== sourceContent
      || await browserSha256(content) !== versionHash
      || await browserSha256(sourceContent) !== sourceHash
    ) {
      throw new Error("版本快照或源 HTML 的实际内容与声明 Hash 不一致，已停止打开。");
    }
    if (!sourceLastModifiedAt || Number.isNaN(Date.parse(sourceLastModifiedAt))) {
      throw new Error("当前源 HTML 缺少独立的最后修改时间，已停止打开。");
    }
    const transitionAffectsCurrentCanvas =
      projectSessionRef.current.projectId === run.projectId
      && Boolean(projectSessionRef.current.sourcePath)
      && (
        sameLocalSourcePath(projectSessionRef.current.sourcePath, run.sourcePath)
        || sameLocalSourcePath(projectSessionRef.current.sourcePath, committedSourcePath)
      );
    if (transitionAffectsCurrentCanvas) {
      const transitionContext = captureProjectContext();
      if (!transitionContext) {
        throw new Error("新版本已生成，但当前画布缺少可核对的项目身份。");
      }
      const alreadyFencedForReview = Boolean(
        readyReviewSession
        && readyReviewSession.operationKey === activeRunOperationKey(run)
        && readyReviewSession.beforeHtml === documentSessionRef.current.html,
      );
      if (!alreadyFencedForReview) {
        const frozen = fenceAndFreezeCurrentCanvas(
          "新版本已生成，但当前编辑画布尚未就绪。",
        );
        if (!frozen.ok) {
          throw new Error(frozen.reason || "新版本已生成，但当前编辑会话尚未安全收口。");
        }
      }
      if (!isCurrentProjectContext(transitionContext)) {
        throw new DeferredEditorCommandDiscardedError("stale-session");
      }
      // Recovery is cleared only after the live Canvas has crossed the Fence.
      persistRecoveryLog(null, transitionContext);
    }
    const preparedTransition = await prepareGeneratedSourceTransition({
      previousSourcePath: run.sourcePath,
      nextSourcePath: committedSourcePath,
      expectedSha256: sourceHash,
      nextProjectId: run.projectId,
      nextDocumentId: run.documentId,
      versionId,
    });
    if (!preparedTransition.updatesCurrentProject) {
      setToast({
        title: protocolViolation
          ? `${candidateLabel} 已生成，但需要检查`
          : `${candidateLabel} 已生成`,
        message: protocolViolation
          ? "新版本本身已经安全提交，但检测到内部 AI 在完成后又改动了临时输出；打开项目查看详情。"
          : `${aiCompletedAt ? `内部 AI 于 ${formatTime(aiCompletedAt, true)} 完成；` : ""}打开该项目后会核对并显示新版本。`,
        tone: protocolViolation ? "warning" : "success",
        sticky: protocolViolation,
        disposition: "background-result",
        dedupeKey: `background-version:${run.sourcePath}`,
        action: {
          id: "open-project",
          label: "打开项目",
          sourcePath: committedSourcePath,
        },
      });
      return;
    }
    const adoptedContext = commitGeneratedSourceTransition({
      prepared: preparedTransition,
      html: content,
      sourceSha256: sourceHash,
      publishVersion: () => versionSessionRef.current.adoptCommitted(versionId),
    });
    if (!adoptedContext) {
      throw new DeferredEditorCommandDiscardedError("stale-session");
    }
    auditPendingRef.current = [];
    documentSessionRef.current.setPersistence({
      state: "idle",
      error: "",
    });
    await verifyCanvasRendered(content, versionHash, adoptedContext);
    if (!isCurrentProjectContext(adoptedContext)) return;
    setLastModifiedAt(sourceLastModifiedAt);
    persistDraftRecovery(null, adoptedContext);
    commentSessionRef.current.reset();
    draftSessionRef.current.replaceAuthority(adoptedContext, 0, {
      draftRevision: 0,
      comments: [],
      changeEvents: [],
      deletedCommentIds: [],
      appliedOperationIds: [],
    });
    draftRecoveryOperationIdRef.current = null;
    setSelection(null);
    setComposerOpen(false);
    commentEditResumePendingRef.current = null;
    setEditingCommentId(null);
    setPreviewAttachment(null);
    viewTransitioningRef.current = true;
    setViewTransitioning(true);
    const completedRun: ActiveRun = {
      ...run,
      sourcePath: committedSourcePath,
      candidateVersionLabel: candidateLabel,
      status: protocolViolation ? "error" : "complete",
      completionObserved: true,
    };
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer(null);
    persistRecoveryLog(null, adoptedContext);
    await refreshWorkspace(committedSourcePath, adoptedContext.epoch);
    if (!isCurrentProjectContext(adoptedContext)) return;
    if (projectLoadErrorRef.current) {
      throw new Error(`新版本已精确打开，但项目状态复核失败：${projectLoadErrorRef.current}`);
    }
    setActiveRun(completedRun);
    setDrawer(null);
    viewTransitioningRef.current = false;
    setViewTransitioning(false);
    window.requestAnimationFrame(() => editorRef.current?.unlockNow?.());
    if (protocolViolation) {
      const warning = "内部 AI 的临时输出在最终化后又被修改；已提交版本本身未受影响。";
      const warningRun: ActiveRun = {
        ...run,
        sourcePath: committedSourcePath,
        candidateVersionLabel: candidateLabel,
        status: "error",
        error: warning,
        completionObserved: true,
      };
      setActiveRun(warningRun);
      setDrawer("handoff");
      setToast({
        title: `${candidateLabel} 已打开，但需要检查`,
        message: `${warning} 新版本内容已经核对一致；详情已保留在本轮处理记录中。`,
        tone: "warning",
        sticky: true,
        dedupeKey: "current-version-result",
        action: { id: "open-handoff", label: "查看处理详情" },
      });
    } else {
      if (
        toastRef.current?.dedupeKey === "activate-ready-version"
        || toastRef.current?.dedupeKey === "current-version-result"
      ) {
        setToast(null);
      }
    }
  }, [
    captureProjectContext,
    commitGeneratedSourceTransition,
    deferEditorCommand,
    fenceAndFreezeCurrentCanvas,
    isCurrentProjectContext,
    persistDraftRecovery,
    persistRecoveryLog,
    prepareGeneratedSourceTransition,
    refreshWorkspace,
    readyReviewSession,
    setActiveRun,
    verifyCanvasRendered,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.openCommittedVersion = (
      run,
      payload,
      resolve,
      reject,
    ) => {
      void openCommittedVersion(run, payload, true).then(resolve, reject);
    };
  }, [openCommittedVersion]);

  const activateReadyResult = useCallback(async (
    { reviewed = false }: { reviewed?: boolean } = {},
  ) => {
    const run = activeRun;
    if (
      !run
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || (
        run.candidateAssessment?.status === "attention"
        && !reviewed
      )
    ) return;
    const operationKey = activeRunOperationKey(run);
    if (!runSessionRef.current.beginOperation("activate", operationKey)) return;
    setOpeningReadyVersion(true);
    const clearedRun = { ...run, error: undefined };
    setActiveRun(clearedRun);
    try {
      const activatedPayload = await bridgeClient.activateReadyVersion({
        sourcePath: run.sourcePath,
        projectId: run.projectId,
        documentId: run.documentId,
        requestId: run.requestId,
        attemptId: run.attemptId,
        versionId: run.candidateVersionId,
      });
      const mergedPayload = {
        ...run.readyPayload,
        ...activatedPayload,
        completion: run.readyPayload.completion,
        outcome: run.readyPayload.outcome,
        version: activatedPayload.version || run.readyPayload.version,
      };
      await openCommittedVersion(run, mergedPayload);
      if (readyReviewSession?.operationKey === operationKey) {
        setDrawer(null);
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve());
          });
        });
        setReadyReviewSession(null);
      }
      runSessionRef.current.removeRun(run, { clearActive: false });
      runSessionRef.current.clearActiveHandoff();
    } catch (cause) {
      if (isDeferredEditorCommandDiscardedError(cause)) return;
      const error = productErrorMessage(cause, "最新版暂时无法打开。");
      const nextRun = { ...run, status: "ready-to-open" as const, error };
      runSessionRef.current.trackRun(nextRun);
      const visibleRun = runSessionRef.current.activeRun;
      if (
        sameLocalSourcePath(projectSessionRef.current.sourcePath, run.sourcePath)
        && visibleRun?.requestId === run.requestId
        && visibleRun.attemptId === run.attemptId
      ) {
        setDrawer("handoff");
      }
    } finally {
      runSessionRef.current.endOperation("activate", operationKey);
      const visibleRun = runSessionRef.current.activeRun;
      if (
        sameLocalSourcePath(projectSessionRef.current.sourcePath, run.sourcePath)
        || (
          projectSessionRef.current.projectId === run.projectId
          && projectSessionRef.current.documentId === run.documentId
        )
        || (
          visibleRun?.requestId === run.requestId
          && visibleRun.attemptId === run.attemptId
        )
      ) {
        setOpeningReadyVersion(false);
      }
    }
  }, [activeRun, openCommittedVersion, readyReviewSession, setActiveRun]);

  const reviewReadyResult = useCallback(async () => {
    const run = runSessionRef.current.activeRun;
    if (
      !run
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || reviewPreparing
    ) return;
    const operationKey = activeRunOperationKey(run);
    setReviewPreparing(true);
    try {
      const payload = await bridgeClient.versionFile(
        run.sourcePath,
        run.candidateVersionId,
      );
      const currentRun = runSessionRef.current.activeRun;
      if (
        !currentRun
        || currentRun.status !== "ready-to-open"
        || activeRunOperationKey(currentRun) !== operationKey
      ) return;
      const declaredIdentities: Array<[string, string, unknown]> = [
        ["projectId", run.projectId, payload.projectId],
        ["documentId", run.documentId, payload.documentId],
        ["versionId", run.candidateVersionId, payload.versionId],
      ];
      for (const [field, expected, actual] of declaredIdentities) {
        if (String(actual || "") !== expected) {
          throw new Error(`审阅版本的 ${field} 与当前冻结任务不一致。`);
        }
      }
      const candidateHtml = String(payload.content || "");
      const candidateHash = String(payload.sha256 || payload.contentSha256 || "");
      const expectedCandidateHash = String(
        run.readyPayload.contentSha256
        || (isRecord(run.readyPayload.version)
          ? run.readyPayload.version.contentSha256
          : "")
        || candidateHash,
      );
      if (
        !candidateHtml
        || !candidateHash
        || candidateHash !== expectedCandidateHash
        || await browserSha256(candidateHtml) !== candidateHash
      ) {
        throw new Error("审阅候选与已校验版本的内容 Hash 不一致。");
      }
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
        !run.baseSnapshotSha256
        || await browserSha256(frozenHtml) !== run.baseSnapshotSha256
      ) {
        throw new Error("当前冻结 HTML 已发生变化，无法开始安全对比。");
      }
      const reviewComments = commentSessionRef.current.comments
        .filter(commentHasContent)
        .map((comment) => ({
            ...comment,
            target: {
              ...comment.target,
              ...(comment.target.sourceAnchor
                ? { sourceAnchor: { ...comment.target.sourceAnchor } }
                : {}),
              ...(comment.target.fingerprint
                ? {
                    fingerprint: {
                      ...comment.target.fingerprint,
                      stableAttributes: {
                        ...comment.target.fingerprint.stableAttributes,
                      },
                      ancestorFingerprint: [
                        ...comment.target.fingerprint.ancestorFingerprint,
                      ],
                    },
                  }
                : {}),
              ...(comment.target.boundingBox
                ? { boundingBox: { ...comment.target.boundingBox } }
                : {}),
            },
            ...(comment.attachments?.length
              ? { attachments: comment.attachments.map((item) => ({ ...item })) }
              : {}),
          }));
      const commentsKey = JSON.stringify(reviewComments);
      const externalBootstrap = Boolean(window.htmlAIPreview);
      const reviewCacheKey = [
        operationKey,
        run.baseSnapshotSha256,
        candidateHash,
        run.sourcePath,
        externalBootstrap ? "external" : "inline",
        await browserSha256(commentsKey),
      ].join("\u0000");
      const preparedReview = await reviewAnalysisSessionRef.current.analyze({
        key: reviewCacheKey,
        compute: async ({ isCancelled }) => {
          const sessionId = `review-${Date.now().toString(36)}-${++reviewSessionSequenceRef.current}`;
          const documents = await buildReviewDocumentsAsync(frozenHtml, candidateHtml, {
            sessionId,
            sourceSha256BySide: {
              before: run.baseSnapshotSha256,
              after: candidateHash,
            },
            sourcePath: run.sourcePath,
            externalBootstrap,
            comments: reviewComments,
          }, { isCancelled });
          return {
            operationKey,
            beforeHtml: frozenHtml,
            afterHtml: candidateHtml,
            sourcePath: run.sourcePath,
            commentsKey,
            sessionId,
            documents,
          };
        },
      });
      const analyzedRun = runSessionRef.current.activeRun;
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
        beforeLabel: run.basedOnVersionId
          ? safeVersionLabel(run.basedOnVersionId)
          : "当前版本",
        afterLabel: String(
          run.readyPayload.candidateDisplayVersionLabel
          || safeVersionLabel(run.candidateVersionId),
        ),
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
    fenceAndFreezeCurrentCanvas,
    isCurrentProjectContext,
    reviewPreparing,
  ]);

  useEffect(() => {
    if (!readyReviewSession) return;
    const currentRun = runSessionRef.current.activeRun;
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
  }, [activeRun, openingReadyVersion, readyReviewSession]);

  const processRunStatus = useCallback(async (
    run: ActiveRun,
    payload: Record<string, unknown>,
  ) => {
    const trackedRun = runSessionRef.current.runForSource(run.sourcePath);
    if (
      !trackedRun
      || trackedRun.requestId !== run.requestId
      || trackedRun.attemptId !== run.attemptId
    ) return;
    const deleteTrackedRun = () => {
      runSessionRef.current.removeRun(run);
    };
    const rawState = String(payload.status || payload.lifecycleState || "processing");
    const state = canonicalLifecycleState(rawState, {
      readyVersion: Boolean(payload.versionId),
    });
    const isCurrentProject = (
      (
        Boolean(run.projectId)
        && Boolean(projectSessionRef.current.projectId)
        && run.projectId === projectSessionRef.current.projectId
      )
      || sameLocalSourcePath(projectSessionRef.current.sourcePath, run.sourcePath)
    );
    const previousBackgroundState =
      runSessionRef.current.runForSource(run.sourcePath)?.status;
    if (state === "ready-to-open") {
      const candidateAssessment = candidateAssessmentFromRecord(
        payload.candidateAssessment,
      );
      const nextRun: ActiveRun = {
        ...run,
        status: "ready-to-open",
        readyPayload: payload,
        ...(candidateAssessment ? { candidateAssessment } : {}),
        completionObserved: true,
      };
      runSessionRef.current.trackRun(nextRun, {
        activate: isCurrentProject ? "always" : "never",
      });
      if (isCurrentProject) {
        clearBackgroundProjectResult(run.sourcePath);
        setDrawer("handoff");
        if (toastRef.current?.dedupeKey === "ai-submit") setToast(null);
      } else if (previousBackgroundState !== "ready-to-open") {
        markBackgroundProjectResult(run.sourcePath, {
          state: "ready",
          label: "新版本可查看",
          updatedAt: Date.now(),
        });
        setToast({
          title: `${run.candidateVersionLabel} 可以打开了`,
          message: "切回项目确认后再打开，当前画布没有被替换。",
          tone: "success",
          disposition: "background-result",
          dedupeKey: `background-version:${run.sourcePath}`,
          action: {
            id: "open-project",
            label: "打开项目",
            sourcePath: run.sourcePath,
          },
        });
      }
      return;
    }
    if (state === "no-change") {
      deleteTrackedRun();
      const noChangeRun = activeRunFromRecord({
        ...run,
        ...payload,
        status: "no-change",
      }) || { ...run, status: "no-change" as const, completionObserved: true };
      runSessionRef.current.rememberOutcome(noChangeRun);
      if (isCurrentProject) {
        clearBackgroundProjectResult(run.sourcePath);
        editorRef.current?.unlockNow?.();
        setActiveRun(noChangeRun);
        setDrawer("handoff");
      } else {
        markBackgroundProjectResult(run.sourcePath, {
          state: "no-change",
          label: "已完成 · 无变化",
          updatedAt: Date.now(),
        });
      }
      return;
    }
    if (state === "cancelled") {
      deleteTrackedRun();
      if (isCurrentProject) {
        clearBackgroundProjectResult(run.sourcePath);
        editorRef.current?.unlockNow?.();
        runSessionRef.current.clearActiveRun();
        setDrawer(null);
      }
      return;
    }
    if (state === "error") {
      deleteTrackedRun();
      const errorRun = activeRunFromRecord({
        ...run,
        ...payload,
        status: "error",
      }) || {
        ...run,
        status: "error" as const,
        error: "返回的 HTML 无法安全采用，当前页面没有被覆盖。",
        completionObserved: payload.completionObserved === true,
      };
      runSessionRef.current.rememberOutcome(errorRun);
      if (isCurrentProject) {
        editorRef.current?.unlockNow?.();
        setActiveRun(errorRun);
        setDrawer("handoff");
      } else {
        markBackgroundProjectResult(run.sourcePath, {
          state: "error",
          label: "需要处理",
          updatedAt: Date.now(),
        });
      }
      return;
    }
    const nextRun = activeRunFromRecord(
      isRecord(payload.activeRun)
        ? { ...payload.activeRun, ...(isRecord(payload.conflict) ? { conflict: payload.conflict } : {}) }
        : { ...run, ...payload, status: state },
    )
      || { ...run, status: state };
    runSessionRef.current.trackRun(nextRun, {
      activate: isCurrentProject ? "always" : "never",
    });
    if (isCurrentProject) {
      clearBackgroundProjectResult(run.sourcePath);
      if (nextRun.status === "awaiting-conflict-resolution"
        || nextRun.status === "recovering-transaction") {
        setDrawer("handoff");
      }
    } else if (
      nextRun.status === "awaiting-conflict-resolution"
      && previousBackgroundState !== nextRun.status
    ) {
      markBackgroundProjectResult(run.sourcePath, {
        state: "conflict",
        label: "需要处理",
        updatedAt: Date.now(),
      });
    } else if (!isCurrentProject) {
      markBackgroundProjectResult(run.sourcePath, {
        state: "processing",
        label: "正在处理",
        updatedAt: Date.now(),
      });
    }
  }, [
    clearBackgroundProjectResult,
    markBackgroundProjectResult,
    setActiveRun,
  ]);

  useEffect(() => {
    const poll = async () => {
      const runs = runSessionRef.current.runs;
      if (runs.length === 0) return;
      await Promise.allSettled(
        runs.map(async (run) => {
          if (!run.requestId || run.requestId === "pending") return;
          const operationKey = activeRunOperationKey(run);
          if (!runSessionRef.current.beginOperation("poll", operationKey)) {
            return;
          }
          try {
            const payload = await bridgeClient.status(
              run.sourcePath,
              run.requestId,
              run.attemptId,
            );
            await processRunStatus(run, payload);
          } catch {
            // Temporary polling failures are recovered by the next automatic pass.
            // The workspace-level unavailable state remains the user-facing boundary.
          } finally {
            runSessionRef.current.endOperation("poll", operationKey);
          }
        }),
      );
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1600);
    return () => window.clearInterval(timer);
  }, [processRunStatus]);

  const reconcilePendingRun = useCallback(async (): Promise<void> => {
    const pendingRun = runSessionRef.current.activeRun;
    if (
      runSessionRef.current.submissionPending
      || !runSessionRef.current.activeLocked
      || pendingRun?.requestId !== "pending"
      || !projectSessionRef.current.sourcePath
    ) return;
    const context = captureProjectContext();
    if (!context) return;
    const operationKey = activeRunOperationKey(pendingRun);
    if (!runSessionRef.current.beginOperation("poll", operationKey)) return;
    try {
      const payload = await bridgeClient.workspace(context.sourcePath);
      if (!isCurrentProjectContext(context)) return;
      const runtime = isRecord(payload.runtimeState) ? payload.runtimeState : {};
      const runtimeConflict = isRecord(runtime.conflict) ? runtime.conflict : null;
      const recoveredRunRecord = isRecord(runtime.activeRun)
        ? runtime.activeRun
        : isRecord(payload.activeRun)
          ? payload.activeRun
          : null;
      const recoveredRun = activeRunFromRecord(
        recoveredRunRecord
          ? { ...recoveredRunRecord, ...(runtimeConflict ? { conflict: runtimeConflict } : {}) }
          : null,
      );
      if (recoveredRun) {
        runSessionRef.current.trackRun(recoveredRun, {
          activate: "always",
          recovered: true,
        });
        runSessionRef.current.clearActiveSubmission();
        setDrawer("handoff");
        return;
      }
      const recoveredOutcome = activeRunFromRecord(payload.recentRunOutcome);
      if (recoveredOutcome) {
        runSessionRef.current.rememberOutcome(recoveredOutcome);
        runSessionRef.current.setActiveRun(recoveredOutcome);
        runSessionRef.current.clearActiveSubmission();
        editorRef.current?.unlockNow?.();
        setDrawer("handoff");
        return;
      }
      runSessionRef.current.clearActiveSubmission();
      editorRef.current?.unlockNow?.();
      runSessionRef.current.clearActiveRun();
      setDrawer(null);
    } catch {
      if (!isCurrentProjectContext(context)) return;
    } finally {
      runSessionRef.current.endOperation("poll", operationKey);
    }
  }, [captureProjectContext, isCurrentProjectContext]);

  useEffect(() => {
    if (
      generating
      || submissionPending
      || !projectLocked
      || activeRun?.requestId !== "pending"
      || !sourcePath
    ) return;
    const initialReconcile = window.setTimeout(
      () => void reconcilePendingRun(),
      0,
    );
    const timer = window.setInterval(() => void reconcilePendingRun(), 4_000);
    return () => {
      window.clearTimeout(initialReconcile);
      window.clearInterval(timer);
    };
  }, [
    activeRun?.requestId,
    generating,
    projectLocked,
    reconcilePendingRun,
    sourcePath,
    submissionPending,
  ]);

  const cancelActiveRun = useCallback(async ({
    agentMayBeRunning = false,
    reason,
  }: {
    agentMayBeRunning?: boolean;
    reason?: string;
  } = {}) => {
    if (!activeRun || !activeRun.requestId || activeRun.requestId === "pending") return false;
    const run = { ...activeRun };
    const operationKey = activeRunOperationKey(run);
    if (!runSessionRef.current.beginOperation("cancel", operationKey)) return false;
    const showAgentReminder = (title: string) => {
      if (!agentMayBeRunning) return;
      setToast({
        title,
        message: "AI Agent 不会被自动停止；如仍在运行，请手动停止。",
        tone: "info",
        disposition: "background-result",
        dedupeKey: `ai-run-cancelled:${run.sourcePath}`,
      });
    };
    if (run.sourcePath === "preview://welcome") {
      editorRef.current?.unlockNow?.();
      runSessionRef.current.clearActiveRun();
      runSessionRef.current.clearActiveHandoff();
      setHandoffPreviewOpen(false);
      setCanvasMode("edit");
      setDrawer(null);
      showAgentReminder("本轮已结束，已恢复编辑");
      runSessionRef.current.endOperation("cancel", operationKey);
      return true;
    }
    const context = (
      (
        Boolean(run.projectId)
        && Boolean(projectSessionRef.current.projectId)
        && run.projectId === projectSessionRef.current.projectId
      )
      || sameLocalSourcePath(projectSessionRef.current.sourcePath, run.sourcePath)
    )
      ? captureProjectContext()
      : null;
    try {
      await bridgeClient.cancelActiveRun({
        projectId: run.projectId,
        documentId: run.documentId,
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        reason: reason || (agentMayBeRunning
          ? "cancelled-by-user-after-agent-handoff"
          : "cancelled-by-user"),
      });
      if (runSessionRef.current.hasRun(run)) {
        runSessionRef.current.removeRun(run);
      }
      if (context && isCurrentProjectContext(context)) {
        editorRef.current?.unlockNow?.();
        runSessionRef.current.clearActiveRun();
        setHandoffPreviewOpen(false);
        setCanvasMode("edit");
        setDrawer(null);
        showAgentReminder("本轮已结束，已恢复编辑");
      } else {
        if (agentMayBeRunning) {
          showAgentReminder("本轮已结束");
        } else {
          setToast({
            title: `${run.candidateVersionLabel} 已取消`,
            message: "对应项目的评论仍然保留，迟到的完成信号不会被接纳。",
            tone: "success",
            dedupeKey: `background-version:${run.sourcePath}`,
          });
        }
      }
      return true;
    } catch (cause) {
      if (context && !isCurrentProjectContext(context)) return false;
      if (context) {
        const nextRun = {
          ...run,
          error: productErrorMessage(
            cause,
            "取消结果暂时无法确认。源页会继续在后台核对。",
          ),
        };
        runSessionRef.current.trackRun(nextRun, { activate: "always" });
      }
      return false;
    } finally {
      runSessionRef.current.endOperation("cancel", operationKey);
    }
  }, [
    activeRun,
    captureProjectContext,
    isCurrentProjectContext,
  ]);

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
    if (!activeRun || activeRun.status !== "awaiting-conflict-resolution") return;
    const run = { ...activeRun };
    const operationKey = activeRunOperationKey(run);
    if (!runSessionRef.current.beginOperation("resolve", operationKey)) return;
    const context = (
      (
        Boolean(run.projectId)
        && Boolean(projectSessionRef.current.projectId)
        && run.projectId === projectSessionRef.current.projectId
      )
      || sameLocalSourcePath(projectSessionRef.current.sourcePath, run.sourcePath)
    )
      ? captureProjectContext()
      : null;
    try {
      const payload = await bridgeClient.resolveConflict({
        projectId: run.projectId,
        documentId: run.documentId,
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        conflictId: run.conflictId,
        action,
      });
      if (action === "keep-external") {
        if (runSessionRef.current.hasRun(run)) {
          runSessionRef.current.removeRun(run);
        }
        if (context && isCurrentProjectContext(context)) {
          editorRef.current?.unlockNow?.();
          runSessionRef.current.clearActiveRun();
          await reloadCurrentSource(true);
        } else {
          setToast({
            title: "已保留外部 HTML",
            message: "对应项目的 AI 候选没有覆盖源文件；切回时会读取外部内容。",
            tone: "success",
            dedupeKey: `background-version:${run.sourcePath}`,
          });
        }
      } else {
        const nextRun = activeRunFromRecord(
          isRecord(payload.activeRun)
            ? { ...payload.activeRun, ...(isRecord(payload.conflict) ? { conflict: payload.conflict } : {}) }
            : payload,
        ) || {
          ...run,
          status: "committing" as LifecycleState,
        };
        runSessionRef.current.trackRun(nextRun, {
          activate:
            context && isCurrentProjectContext(context) ? "always" : "never",
        });
      }
    } catch (cause) {
      if (context && !isCurrentProjectContext(context)) return;
      const nextRun = {
        ...run,
        error: productErrorMessage(
          cause,
          "这次选择还没有记录，外部文件和 AI 候选都仍被保留。",
        ),
      };
      runSessionRef.current.trackRun(nextRun, {
        activate: context ? "always" : "never",
      });
      if (context) {
        setDrawer("handoff");
      }
    } finally {
      runSessionRef.current.endOperation("resolve", operationKey);
    }
  }, [
    activeRun,
    captureProjectContext,
    isCurrentProjectContext,
    reloadCurrentSource,
  ]);

  const viewHistoryVersion = useCallback(async (
    version: Version,
    fromDeferred = false,
  ) => {
    if (
      runInProgress
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
    ) return;
    if (
      !fromDeferred
      && deferEditorCommand(
        "project-switch",
        () => deferredEditorReplayRef.current.viewHistoryVersion?.(version),
      )
    ) return;
    const context = captureProjectContext();
    if (!context) return;
    const operationId = beginNavigationOperation();
    if (operationId === null) return;
    const previousDocument = documentSessionRef.current.snapshot;
    const previousHtml = previousDocument.html;
    const previousVersionView = versionSessionRef.current.captureView();
    try {
      if (viewMode === "current") {
        const drained = await drainCoordinatorRef.current.drain("history", {
          deadlineAt: Date.now() + 15_000,
        });
        if (!drained.ok) throw new Error(drained.reason);
      }
      const payload = await bridgeClient.versionFile(
        context.sourcePath,
        version.id,
      );
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      const hash = String(payload.sha256 || "");
      const content = String(payload.content || "");
      if (version.contentSha256 && hash !== version.contentSha256) {
        throw new Error("历史文件 Hash 与版本记录不一致，已拒绝打开。");
      }
      if (!hash || await browserSha256(content) !== hash) {
        throw new Error("历史文件内容与声明 Hash 不一致，已拒绝打开。");
      }
      documentSessionRef.current.publishAuthority({
        html: content,
        sourceSha256: previousDocument.sourceSha256,
      });
      versionSessionRef.current.enterHistory(version.id);
      invalidateCanvasRenderAcks();
      await verifyCanvasRendered(content, hash, context);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      setDrawer(null);
      editorRef.current?.clearSelection();
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      if (navigationOperationRef.current === operationId) {
        documentSessionRef.current.publishAuthority({
          html: previousHtml,
          sourceSha256: previousDocument.sourceSha256,
        });
        versionSessionRef.current.restoreView(previousVersionView);
        invalidateCanvasRenderAcks();
        try {
          await verifyCanvasRendered(
            previousHtml,
            await browserSha256(previousHtml),
            context,
          );
        } catch {
          // Keep the prior view state; the error message below explains the failed transition.
        }
      }
      setToast({
        title: "无法打开这个历史版本",
        message: productErrorMessage(
          cause,
          "历史版本没有打开；原来的画布仍保持不变。",
        ),
        tone: "error",
        disposition: "background-result",
        dedupeKey: "history-navigation",
      });
    } finally {
      finishNavigationOperation(operationId);
    }
  }, [
    beginNavigationOperation,
    captureProjectContext,
    deferEditorCommand,
    finishNavigationOperation,
    invalidateCanvasRenderAcks,
    isCurrentProjectContext,
    runInProgress,
    verifyCanvasRendered,
    viewMode,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.viewHistoryVersion = (version) => {
      void viewHistoryVersion(version, true);
    };
  }, [viewHistoryVersion]);

  const returnToCurrent = useCallback(async (fromDeferred = false) => {
    if (viewTransitioningRef.current || projectLoadErrorRef.current) return;
    if (
      !fromDeferred
      && deferEditorCommand(
        "project-switch",
        () => deferredEditorReplayRef.current.returnToCurrent?.(),
      )
    ) return;
    const context = captureProjectContext();
    if (!context) return;
    const operationId = beginNavigationOperation();
    if (operationId === null) return;
    const previousDocument = documentSessionRef.current.snapshot;
    const previousHtml = previousDocument.html;
    const previousVersionView = versionSessionRef.current.captureView();
    try {
      const payload = await bridgeClient.source(context.sourcePath);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      if (
        String(payload.projectId || "") !== context.projectId
        || String(payload.documentId || "") !== context.documentId
      ) {
        throw new Error("当前源 HTML 的项目身份发生变化，已拒绝切换视图。");
      }
      const content = String(payload.content || "");
      const hash = String(payload.sha256 || "");
      if (!hash || await browserSha256(content) !== hash) {
        throw new Error("当前源 HTML 与声明 Hash 不一致。");
      }
      documentSessionRef.current.publishAuthority({
        html: content,
        sourceSha256: hash,
      });
      versionSessionRef.current.returnCurrent({
        currentBasedOnVersionId:
          payload.currentBasedOnVersionId || currentBasedOnVersionId,
        currentExactVersionId: payload.currentExactVersionId || null,
        restoredFromVersionId:
          payload.restoredFromVersionId || restoredFromVersionId,
      });
      invalidateCanvasRenderAcks();
      await verifyCanvasRendered(content, hash, context);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      setLastModifiedAt(String(payload.lastModifiedAt || ""));
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      if (navigationOperationRef.current === operationId) {
        documentSessionRef.current.publishAuthority({
          html: previousHtml,
          sourceSha256: previousDocument.sourceSha256,
        });
        versionSessionRef.current.restoreView(previousVersionView);
        invalidateCanvasRenderAcks();
        try {
          await verifyCanvasRendered(
            previousHtml,
            await browserSha256(previousHtml),
            context,
          );
        } catch {
          // The prior immutable history view remains the committed UI state.
        }
      }
      setToast({
        title: "无法返回当前 HTML",
        message: productErrorMessage(
          cause,
          "当前画布仍停留在原来的历史版本；源文件没有被改动。",
        ),
        tone: "error",
        disposition: "background-result",
        dedupeKey: "history-navigation",
      });
    } finally {
      finishNavigationOperation(operationId);
    }
  }, [
    beginNavigationOperation,
    captureProjectContext,
    currentBasedOnVersionId,
    deferEditorCommand,
    finishNavigationOperation,
    invalidateCanvasRenderAcks,
    isCurrentProjectContext,
    restoredFromVersionId,
    verifyCanvasRendered,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.returnToCurrent = () => {
      void returnToCurrent(true);
    };
  }, [returnToCurrent]);

  const persistLabel = persistState === "writing"
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
  const visibleCanvasAck = canvasMode === "preview"
    ? canvasRenderAcks.preview
    : canvasRenderAcks.edit;
  const isSafelySaved = Boolean(
    sourcePath
    && sourceSha256
    && viewMode === "current"
    && persistState === "idle"
    && editRevision === lastPersistedRevision
    && !projectHydrating
    && !projectLoadError
    && !viewTransitioning
    && visibleCanvasAck?.generation === canvasGeneration
    && visibleCanvasAck.sha256 === sourceSha256
  );
  const safeSaveLabel = isSafelySaved
    ? "已安全保存"
    : "正在确认当前画布…";
  const saveStatusLabel = browserPreviewOnly
    ? "操作不会保存"
    : fileRenameBusy
      ? "正在重命名…"
      : persistState !== "idle"
        ? persistLabel
        : viewMode === "history"
          ? "历史版本 · 只读"
          : sourcePath
            ? safeSaveLabel
            : persistLabel;
  const canShowCurrentFileInFolder = Boolean(
    sourcePath
    && typeof window !== "undefined"
    && window.htmlAIProjects?.showInFolder,
  );
  const canOpenCurrentHtmlInDefaultBrowser = Boolean(
    sourcePath
    && typeof window !== "undefined"
    && window.htmlAIProjects?.openInDefaultBrowser,
  );
  const visibleRecentProjects = recentProjects
    .filter((project) => !sameLocalSourcePath(project.sourcePath, sourcePath))
    .slice(0, 3);
  const recentProjectStatus = (projectSourcePath: string): BackgroundProjectResult | null => {
    const recorded = [...backgroundProjectResults.entries()].find(
      ([key]) => sameLocalSourcePath(key, projectSourcePath),
    )?.[1];
    return recorded || null;
  };
  const runBasisLabel = activeRun?.basedOnVersionId
    ? safeVersionLabel(activeRun.basedOnVersionId)
    : currentBasedOnVersionId
      ? safeVersionLabel(currentBasedOnVersionId)
      : "初始内容";
  const runSubmittedLabel = activeRun?.submittedAt
    ? formatTime(activeRun.submittedAt, true)
    : "正在提交";
  const pendingRunOutcome = Boolean(
    activeRun?.requestId === "pending" && projectLocked,
  );
  const terminalRun = Boolean(
    activeRun && ["error", "no-change"].includes(activeRun.status) && !pendingRunOutcome,
  );
  const handoffCopyFailed = Boolean(
    activeRun
    && currentQoderHandoffStatus === "failed"
    && ["submitting", "processing", "ready"].includes(activeRun.status),
  );
  const checkingRun = Boolean(
    activeRun
    && ["validating", "committing", "recovering-transaction"].includes(activeRun.status),
  );
  const candidateNeedsReview =
    activeRun?.candidateAssessment?.status === "attention";
  const processPanelTitle = pendingRunOutcome
    ? "正在确认这次发送是否成功"
    : activeRun?.status === "ready-to-open"
      ? candidateNeedsReview
        ? "页面变化较大，请先审阅"
        : "修改结果已完成检查"
      : activeRun?.status === "no-change"
        ? "这次没有产生有效变化"
        : activeRun?.status === "error"
          ? "返回的 HTML 无法使用"
          : "等待 QoderWork 返回修改结果";
  const processSummaryTitle = pendingRunOutcome
    ? "为避免重复任务，画布暂时保持只读"
    : activeRun?.status === "ready-to-open"
      ? candidateNeedsReview
        ? "候选版本已保留，等待你对比确认"
        : "新版本已保留，等待你确认打开"
      : activeRun?.status === "no-change"
        ? "页面与评论可以继续编辑"
        : activeRun?.status === "error"
          ? "源 HTML 没有被覆盖"
          : "画布已锁定，仅可浏览";
  const processSummaryDetail = pendingRunOutcome
    ? "源页会在后台继续核对，不会重复发送同一轮要求"
    : activeRun?.status === "no-change"
      ? "原评论和附件都已保留，调整要求后可以重新发送"
      : activeRun?.status === "error"
        ? "当前 HTML 没有被覆盖；返回编辑后仍可查看上轮处理"
        : candidateNeedsReview
          ? "HTML 可以打开，但与上一版的共同特征较少，不会直接替换当前页面"
        : "原始评论和本地内容均已冻结，返回结果不会覆盖它们";
  const processStatusLabel = pendingRunOutcome
    ? "正在等待修改结果"
    : activeRun?.status === "ready-to-open"
      ? candidateNeedsReview ? "请先审阅" : "等待确认打开"
      : activeRun?.status === "no-change"
        ? "没有新版本"
        : activeRun?.status === "error"
          ? "需要处理"
          : "正在等待修改结果";
  const processSteps = deriveRunProgressSteps(
    activeRun,
    currentQoderHandoffStatus,
  );
  const draftTargetScope = !draftTarget
    ? "尚未选择"
    : draftTarget.tagName === "body"
      ? "全局评论"
      : draftTarget.level === "module"
      ? "整个模块"
      : draftTarget.level === "insertion"
        ? "添加位置"
        : "页面内容";
  const hasCollapsedCommentDraft = Boolean(
    draftInCurrentTab
    && draftTarget
    && !composerOpen
  );
  const commentTargetIsLocatable = useCallback((target: HtmlCanvasSelection): boolean => {
    const layout = commentTargetLayouts[target.id];
    const resolution = layout?.resolution ?? target.resolution;
    return layout?.status !== "missing"
      && (resolution === "exact" || resolution === "rebound");
  }, [commentTargetLayouts]);
  const draftTargetCanSave = Boolean(
    draftTarget
    && commentTargetLayouts[draftTarget.id]?.status !== "missing"
    && (commentTargetLayouts[draftTarget.id]?.resolution ?? draftTarget.resolution)
      === "exact"
  );
  const commentRailTargetTops = useMemo(() => {
    if (!commentLayoutReady) return {};
    const targets = [
      ...railCommentItems.map((comment) => comment.target),
      ...(
        (composerInCurrentTab || hasCollapsedCommentDraft) && draftTarget
          ? [draftTarget]
          : []
      ),
    ];
    const measuredGroupTops = new Map<string, number>();
    for (const target of targets) {
      const layout = commentTargetLayouts[target.id];
      const measuredTop = (
        target.tagName === "body"
        || layout?.status === "missing"
      )
        ? commentRailMinimumTop
        : commentTargetTops[target.id];
      if (!Number.isFinite(measuredTop)) continue;
      const groupKey = commentMarkerGroupKey(target);
      measuredGroupTops.set(
        groupKey,
        Math.min(
          measuredGroupTops.get(groupKey) ?? Number.MAX_SAFE_INTEGER,
          measuredTop as number,
        ),
      );
    }
    return Object.fromEntries(targets.flatMap((target) => {
      const top = measuredGroupTops.get(commentMarkerGroupKey(target));
      return Number.isFinite(top) ? [[target.id, top as number]] : [];
    }));
  }, [
    commentLayoutReady,
    commentRailMinimumTop,
    commentTargetLayouts,
    commentTargetTops,
    composerInCurrentTab,
    draftTarget,
    hasCollapsedCommentDraft,
    railCommentItems,
  ]);
  const sortedVisibleCommentItems = useMemo(() => {
    if (!commentLayoutReady) return [];
    return railCommentItems
      .flatMap((comment, index) => {
        const targetTop = comment.target.tagName === "body"
          ? commentRailMinimumTop
          : commentRailTargetTops[comment.target.id];
        if (!Number.isFinite(targetTop)) return [];
        return [{
          comment,
          index,
          scopeRank: comment.target.tagName === "body" ? 0 : 1,
          targetTop: targetTop as number,
        }];
      })
      .sort((left, right) => (
        left.scopeRank - right.scopeRank
        || left.targetTop - right.targetTop
        || left.comment.createdAt.localeCompare(right.comment.createdAt)
        || left.index - right.index
      ))
      .map(({ comment }) => comment);
  }, [
    commentLayoutReady,
    commentRailMinimumTop,
    commentRailTargetTops,
    railCommentItems,
  ]);
  const commentMeasurementKeys = useMemo(() => Object.fromEntries(
    sortedVisibleCommentItems.map((comment) => {
      const layout = commentTargetLayouts[comment.target.id];
      const resolution = layout?.resolution ?? comment.target.resolution;
      const locatable = layout?.status !== "missing"
        && (resolution === "exact" || resolution === "rebound");
      return [comment.commentId, commentMeasurementKey(comment.commentId, {
        resolution,
        locatable,
        editable: viewMode === "current" && !interactionLocked,
        editing: editingCommentId === comment.commentId,
        deleting: pendingDeleteCommentId === comment.commentId,
        relinking: relinkingTarget === comment.commentId,
        text: comment.text,
        attachments: (comment.attachments ?? []).map((attachment) => ({
          id: attachment.attachmentId,
          kind: attachment.kind,
          bytes: attachment.byteLength,
        })),
      })];
    }),
  ), [
    commentTargetLayouts,
    editingCommentId,
    interactionLocked,
    pendingDeleteCommentId,
    relinkingTarget,
    sortedVisibleCommentItems,
    viewMode,
  ]);
  const composerMeasurementKey = useMemo(() => commentMeasurementKey(
    "__composer",
    {
      canSave: draftTargetCanSave,
      deleting: pendingDeleteCommentId === "__composer",
      relinking: relinkingTarget === "__composer",
      text: draft,
      attachments: draftAttachments.map((attachment) => ({
        id: attachment.attachmentId,
        kind: attachment.kind,
        bytes: attachment.byteLength,
      })),
      uploading: attachmentUploadCount > 0,
    },
  ), [
    attachmentUploadCount,
    draft,
    draftAttachments,
    draftTargetCanSave,
    pendingDeleteCommentId,
    relinkingTarget,
  ]);
  const draftRecoveryMeasurementKey = useMemo(() => commentMeasurementKey(
    "__draft_recovery",
    {
      text: draft,
      attachments: draftAttachments.length,
    },
  ), [draft, draftAttachments.length]);
  const commentRailLayout = useMemo(() => {
    const items: Array<{
      key: string;
      measurementKey: string;
      targetTop: number;
      fallbackHeight: number;
      order: number;
      scopeRank: number;
    }> = sortedVisibleCommentItems.map((comment, index) => {
      const imageCount = (comment.attachments ?? []).filter(
        (attachment) => attachment.kind === "image",
      ).length;
      const fileCount = (comment.attachments ?? []).length - imageCount;
      const textLines = Math.max(1, Math.ceil((comment.text.length || 18) / 25));
      const imageRows = Math.ceil(imageCount / 3);
      return {
        key: comment.commentId,
        measurementKey: commentMeasurementKeys[comment.commentId],
        targetTop: comment.target.tagName === "body"
          ? commentRailMinimumTop
          : commentRailTargetTops[comment.target.id],
        fallbackHeight:
          104
          + textLines * 19
          + imageRows * 78
          + fileCount * 48
          + (!commentTargetIsLocatable(comment.target) && viewMode === "current" ? 70 : 0)
          + (editingCommentId === comment.commentId ? 92 : 0)
          + (pendingDeleteCommentId === comment.commentId ? 46 : 0),
        order: index + 1,
        scopeRank: comment.target.tagName === "body" ? 0 : 1,
      };
    });
    const draftTargetTop = draftTarget?.tagName === "body"
      ? commentRailMinimumTop
      : draftTarget
        ? commentRailTargetTops[draftTarget.id]
        : undefined;
    if (
      composerInCurrentTab
      && draftTarget
      && Number.isFinite(draftTargetTop)
    ) {
      items.push({
        key: "__composer",
        measurementKey: composerMeasurementKey,
        targetTop: draftTargetTop as number,
        fallbackHeight:
          276
          + (!draftTargetCanSave ? 70 : 0)
          + (pendingDeleteCommentId === "__composer" ? 46 : 0),
        order: Number.MAX_SAFE_INTEGER,
        scopeRank: draftTarget.tagName === "body" ? 0 : 1,
      });
    }
    if (
      hasCollapsedCommentDraft
      && draftTarget
      && Number.isFinite(draftTargetTop)
    ) {
      items.push({
        key: "__draft_recovery",
        measurementKey: draftRecoveryMeasurementKey,
        targetTop: draftTargetTop as number,
        fallbackHeight: 142,
        order: Number.MAX_SAFE_INTEGER,
        scopeRank: draftTarget.tagName === "body" ? 0 : 1,
      });
    }
    const layout = layoutCommentRailItems({
      minimumTop: commentRailMinimumTop,
      gap: 20,
      items: items.map((item) => ({
        key: item.key,
        targetTop: item.targetTop,
        height:
          commentCardHeights[item.measurementKey]
          || item.fallbackHeight,
        order: item.order,
        scopeRank: item.scopeRank,
      })),
    });
    return {
      ...layout,
      composerTop: layout.positions.__composer,
      draftRecoveryTop: layout.positions.__draft_recovery,
    };
  }, [
    commentCardHeights,
    commentMeasurementKeys,
    commentRailMinimumTop,
    commentRailTargetTops,
    commentTargetIsLocatable,
    composerMeasurementKey,
    composerInCurrentTab,
    draftRecoveryMeasurementKey,
    draftTarget,
    draftTargetCanSave,
    editingCommentId,
    hasCollapsedCommentDraft,
    pendingDeleteCommentId,
    sortedVisibleCommentItems,
    viewMode,
  ]);
  const visibleCommentPositions = commentRailLayout.positions;
  const renderedCommentIds = useMemo(() => virtualizedCommentIds({
    ids: sortedVisibleCommentItems.map((comment) => comment.commentId),
    positions: commentRailLayout.positions,
    heights: commentRailLayout.heights,
    viewportTop: Math.max(0, commentViewport.top - commentRailOffset),
    viewportHeight: commentViewport.height,
    forcedIds: [
      focusedCommentId,
      editingCommentId,
      pendingDeleteCommentId,
    ].filter((value): value is string => Boolean(value)),
  }), [
    commentRailLayout.heights,
    commentRailLayout.positions,
    commentViewport.height,
    commentViewport.top,
    commentRailOffset,
    editingCommentId,
    focusedCommentId,
    pendingDeleteCommentId,
    sortedVisibleCommentItems,
  ]);
  const renderedVisibleCommentItems = useMemo(
    () => sortedVisibleCommentItems.filter(
      (comment) => renderedCommentIds.has(comment.commentId),
    ),
    [renderedCommentIds, sortedVisibleCommentItems],
  );
  const composerTop = commentRailLayout.composerTop;
  const draftRecoveryTop = commentRailLayout.draftRecoveryTop;
  useLayoutEffect(() => {
    if (
      !composerFocusPendingRef.current
      || !composerInCurrentTab
      || !commentLayoutReady
      || !Number.isFinite(composerTop)
      || interactionLocked
    ) return;
    requestComposerFocus();
  }, [
    commentLayoutReady,
    composerInCurrentTab,
    composerTop,
    interactionLocked,
    requestComposerFocus,
  ]);
  useEffect(() => {
    if (!commentLayoutReady) return;
    const pending = reviewRevealPendingRef.current;
    if (!pending) return;
    queueReviewPairReveal(pending.target, pending.itemKey);
  }, [
    commentLayoutReady,
    commentTargetTops,
    composerTop,
    draftRecoveryTop,
    queueReviewPairReveal,
    renderedVisibleCommentItems,
  ]);
  const canvasDocumentHeight = Math.max(
    760,
    Math.ceil(commentRailHeight || 0),
  );
  const commentRailContentHeight = Math.max(
    canvasDocumentHeight,
    commentRailLayout.bottom + 24,
  );
  const commentRailMinimumOffset = computeCommentRailMinimumOffset({
    contentBottom: commentRailLayout.bottom + 14,
    viewportBottom: canvasDocumentHeight - 14,
  });
  useLayoutEffect(() => {
    commentRailMinimumOffsetRef.current = commentRailMinimumOffset;
    const currentOffset = commentRailOffsetRef.current;
    if (
      commentRailFollowsFocus
      || currentOffset >= commentRailMinimumOffset
    ) return;
    commentRailOffsetRef.current = commentRailMinimumOffset;
    setCommentRailOffset(commentRailMinimumOffset);
  }, [commentRailFollowsFocus, commentRailMinimumOffset]);
  const returnToEditingFromTerminalRun = () => {
    const completedRun = runSessionRef.current.activeRun;
    if (completedRun?.sourcePath) {
      runSessionRef.current.rememberOutcome(completedRun);
      runSessionRef.current.clearHandoff(completedRun.sourcePath);
    }
    runSessionRef.current.clearActiveRun();
    runSessionRef.current.clearActiveHandoff();
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer(null);
    editorRef.current?.unlockNow?.();
  };
  const reopenRecentRunOutcome = () => {
    const outcome = runSessionRef.current.outcomeForSource(sourcePath);
    if (!outcome) return;
    runSessionRef.current.setActiveRun(outcome);
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer("handoff");
  };
  const handleToastAction = (action: ToastAction) => {
    setToast(null);
    switch (action.id) {
      case "retry-export":
        void exportCurrentHtml();
        return;
      case "open-handoff":
        setDrawer("handoff");
        return;
      case "open-project":
      case "retry-project-open":
        void openProject(action.sourcePath);
        return;
      case "retry-external-project-open":
        void resumeDeferredExternalProject();
        return;
      case "retry-project-application":
        void resumeDeferredProjectApplication();
        return;
      case "open-attachment-picker":
        openAttachmentPicker(action.target, action.accept || "all");
        return;
      case "review-comment-attachments":
        if (action.target.kind === "composer") {
          const target = commentSessionRef.current.composerTarget;
          if (
            commentSessionRef.current.composerCommentId === action.target.commentId
            && target
          ) {
            setComposerOpen(true);
            queueReviewPairReveal(target, "__composer");
            requestComposerFocus();
          }
        } else {
          const comment = commentSessionRef.current.comments.find(
            (item) => item.commentId === action.target.commentId,
          );
          if (comment) focusCommentTarget(comment.target, comment.commentId);
        }
        return;
      case "relink-target":
        resumeSubmissionAfterRelinkRef.current = action.resumeSubmission === true;
        beginTargetRelink(action.commentId);
        setCanvasMode("edit");
        setDrawer(null);
        return;
      case "relaunch-app":
        void relaunchApp();
        return;
      case "retry-draft-persist":
        void flushDraftPersistence();
        return;
      case "review-project-rules":
        setDrawer("files");
        if (fileView?.path !== "PROJECT.md") void viewFile("PROJECT.md");
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
        void generateRequest();
        return;
    }
  };

  const readyReviewOverlay = readyReviewSession ? (
    <AiReviewWorkspace
      fileName={currentSourceFileName}
      beforeLabel={readyReviewSession.beforeLabel}
      afterLabel={readyReviewSession.afterLabel}
      sessionId={readyReviewSession.sessionId}
      documents={readyReviewSession.documents}
      sourcePath={sourcePath || undefined}
      accepting={openingReadyVersion}
      error={activeRun?.status === "ready-to-open" ? activeRun.error : undefined}
      notice={activeRun?.candidateAssessment?.status === "attention"
        ? "这个候选可以打开，但与上一版的共同特征较少。请重点核对整页内容，再决定是否接受。"
        : undefined}
      onExit={() => {
        setReadyReviewSession(null);
        setDrawer("handoff");
      }}
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
      onRevealCandidateHtml={() => {
        const candidateVersionId = activeRun?.candidateVersionId;
        if (candidateVersionId) {
          void revealVersionInFinder({ id: candidateVersionId });
        }
      }}
    />
  ) : null;

  return (
    <>
      <main
        className="workbench"
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
        inert={readyReviewSession ? true : undefined}
      >
      <WorkbenchHeaderShell
        data-file-renaming={fileRenameEditing ? "true" : undefined}
      >
        <div className="window-file">
          <span
            className="window-file-icon-cluster"
            data-update-visible={updateActionVisible ? "true" : undefined}
            data-update-downloaded={updateDownloaded ? "true" : undefined}
          >
            <button
              className="window-file-icon window-file-about-button"
              type="button"
              aria-label="关于源页"
              title="关于源页"
              onClick={openAboutPageRoot}
            >
              <FileHtmlIcon aria-hidden="true" size={20} weight="duotone" />
            </button>
            {updateActionVisible ? (
              <button
                className="header-update-badge window-file-update-badge"
                type="button"
                data-update-downloaded={updateDownloaded ? "true" : undefined}
                aria-label={updateDownloaded
                  ? `PageRoot ${updateResult?.latestVersion || "新版本"} 已下载，重启更新`
                  : updateDownloading
                    ? `正在下载 PageRoot ${updateResult?.latestVersion || "新版本"}`
                    : `发现 PageRoot ${updateResult?.latestVersion || "新版本"}，下载更新`}
                title={updateDownloaded
                  ? `重启更新 PageRoot ${updateResult?.latestVersion || "新版本"}`
                  : updateDownloading
                    ? `正在下载 PageRoot ${updateResult?.latestVersion || "新版本"}`
                    : `下载 PageRoot ${updateResult?.latestVersion || "新版本"}`}
                disabled={updateDownloading}
                onClick={() => {
                  if (updateDownloaded) {
                    setRestartUpdateOpen(true);
                  } else if (updateResult?.status === "available") {
                    void downloadAvailableUpdate();
                  }
                }}
              >
                <span>{updateBadgeLabel}</span>
              </button>
            ) : null}
          </span>
          <div className="window-file-copy">
            <div
              className="window-file-title-row"
              data-renaming={fileRenameEditing ? "true" : undefined}
              role={fileRenameEditing ? undefined : "status"}
              aria-live={fileRenameEditing ? undefined : "polite"}
              aria-atomic={fileRenameEditing ? undefined : "true"}
            >
              {fileRenameEditing ? (
                <label className="window-file-rename-field">
                  <span className="sr-only">文件名（不含后缀）</span>
                  <input
                    ref={fileRenameInputRef}
                    aria-label="文件名（不含后缀）"
                    aria-invalid={fileRenameError ? "true" : undefined}
                    aria-describedby={fileRenameError
                      ? "window-file-rename-error"
                      : undefined}
                    autoComplete="off"
                    disabled={fileRenameBusy}
                    maxLength={180}
                    spellCheck={false}
                    value={fileRenameDraft}
                    onBlur={() => void commitFileRename()}
                    onChange={(event) => {
                      setFileRenameDraft(event.target.value);
                      if (fileRenameError) setFileRenameError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitFileRename();
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        cancelFileRename();
                      }
                    }}
                  />
                  <span aria-hidden="true">{currentSourceFileExtension}</span>
                </label>
              ) : canOfferFileRename ? (
                <button
                  className="window-file-title-action"
                  type="button"
                  aria-label={`重命名文件 ${currentSourceFileStem}`}
                  title="双击重命名文件"
                  onDoubleClick={beginFileRename}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === "F2") {
                      event.preventDefault();
                      beginFileRename();
                    }
                  }}
                >
                  <strong>{currentSourceFileStem}</strong>
                  <PencilSimpleIcon
                    className="window-file-rename-icon"
                    aria-hidden="true"
                    size={13}
                    weight="bold"
                  />
                </button>
              ) : (
                <strong title={currentSourceFileName}>
                  {currentSourceFileStem}
                </strong>
              )}
              <span className="window-file-quick-actions">
                <button
                  className="window-file-quick-action"
                  type="button"
                  data-tooltip="打开本地HTML"
                  aria-label="打开新的本地 HTML"
                  disabled={fileRenameEditing || fileRenameBusy}
                  onClick={() => void openProject()}
                >
                  <PlusIcon aria-hidden="true" size={16} weight="bold" />
                </button>
                <button
                  className="window-file-quick-action"
                  type="button"
                  data-tooltip="在默认浏览器中打开"
                  aria-label={`在默认浏览器中打开 ${currentSourceFileName}`}
                  disabled={
                    !canOpenCurrentHtmlInDefaultBrowser
                    || fileRenameEditing
                    || fileRenameBusy
                    || persistState !== "idle"
                    || editRevision !== lastPersistedRevision
                  }
                  onClick={() => void openCurrentHtmlInDefaultBrowser()}
                >
                  <ArrowSquareOutIcon
                    aria-hidden="true"
                    size={16}
                    weight="bold"
                  />
                </button>
              </span>
              {fileRenameError ? (
                <span
                  id="window-file-rename-error"
                  className="window-file-rename-error"
                  role="alert"
                >
                  {fileRenameError}
                </span>
              ) : null}
            </div>
            <span className="file-meta">
              <span className="file-version-label">
                {browserPreviewOnly
                  ? "浏览器预览 · 只读"
                  : viewMode === "history"
                  ? `${viewingVersion?.label || "历史版本"} · 只读`
                  : activeRun?.candidateVersionLabel && runInProgress
                    ? `${activeRun.candidateVersionLabel} · 本轮处理中`
                    : currentBasedOnVersionId
                      ? safeVersionLabel(currentBasedOnVersionId)
                      : latestVersion?.label || "版本 1"}
              </span>
              {canShowCurrentFileInFolder ? (
                <button
                  className="window-file-folder-action"
                  type="button"
                  aria-label={`在文件夹中打开 ${currentSourceFileName}`}
                  title="在 Finder 中显示当前文件"
                  onClick={() => void showProjectInFolder()}
                >
                  在文件夹中打开
                </button>
              ) : null}
              <span
                className="save-status"
                data-persist-state={persistState}
                data-file-renaming={fileRenameBusy ? "true" : undefined}
                data-edit-revision={editRevision}
                data-persisted-revision={lastPersistedRevision}
                data-canvas-generation={canvasGeneration}
                data-render-generation={visibleCanvasAck?.generation}
                data-rendered-sha256={visibleCanvasAck?.sha256 || undefined}
                role="status"
                aria-live="polite"
              >
                <span aria-hidden="true" />
                {saveStatusLabel}
              </span>
            </span>
          </div>
        </div>

        <WorkbenchHeaderActions aria-label="画布模式、项目和版本操作">
          <div className="canvas-mode-switch" role="group" aria-label="画布模式">
            <button
              type="button"
              aria-pressed={canvasMode === "edit"}
              disabled={browserPreviewOnly || runInProgress || viewMode === "history"}
              title={browserPreviewOnly ? "浏览器预览为只读模式" : undefined}
              onClick={() => {
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
                      || viewTransitioningRef.current
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
            >
              <PencilSimpleIcon aria-hidden="true" size={16} weight="bold" />
              编辑
            </button>
            <button
              type="button"
              aria-pressed={canvasMode === "preview"}
              disabled={!browserPreviewOnly && interactionLocked}
              title={browserPreviewOnly
                ? "只读运行页面自身的脚本和交互；操作不会保存"
                : interactionLocked
                  ? "当前状态只能使用编辑画布"
                  : "运行页面自身的脚本和交互"}
              onClick={() => {
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
                  setSelection(null);
                  updateFocusedComment(null);
                  setCanvasMode("preview");
                };
                if (deferEditorCommand("project-switch", enterPreview)) return;
                enterPreview();
              }}
            >
              <EyeIcon aria-hidden="true" size={16} weight="bold" />
              预览
            </button>
          </div>
          <button
            className="project-button"
            type="button"
            aria-expanded={drawer === "files" || drawer === "history"}
            disabled={projectHydrating || viewTransitioning || attachmentUploadCount > 0}
            onClick={() => {
              const openProjectPanel = () => {
                setDrawer((current) => (
                  current === "files" || current === "history" ? null : "files"
                ));
              };
              if (deferEditorCommand("project-files", openProjectPanel)) return;
              openProjectPanel();
            }}
          >
            <FolderOpenIcon aria-hidden="true" size={18} weight="duotone" />
            项目
          </button>
          <button
            className="global-comment-button"
            type="button"
            aria-expanded={composerOpen && draftTarget?.tagName === "body"}
            disabled={interactionLocked || canvasMode !== "edit"}
            onClick={openGlobalCommentComposer}
          >
            <ChatCircleTextIcon aria-hidden="true" size={18} weight="duotone" />
            全局评论
          </button>
          {recentRunOutcome && !runInProgress && !terminalRun ? (
            <button
              className="recent-run-button"
              type="button"
              aria-expanded={drawer === "handoff"}
              onClick={reopenRecentRunOutcome}
            >
              <ClockCounterClockwiseIcon
                aria-hidden="true"
                size={18}
                weight="duotone"
              />
              上轮处理
            </button>
          ) : null}
          <button
            className="header-send-button"
            type="button"
            data-handoff-status={currentQoderHandoffStatus}
            data-copied={currentQoderHandoffStatus === "copied" ? "true" : undefined}
            disabled={
              generating
              || projectHydrating
              || Boolean(projectLoadError)
              || viewTransitioning
              || viewMode === "history"
              || (!runInProgress && (
                pendingSendItemCount === 0
                || interactionLocked
                || persistState === "failed"
                || Boolean(draftPersistError)
              ))
            }
            onClick={() => {
              if (runInProgress) {
                setHandoffPreviewOpen(false);
                setCanvasMode("edit");
                setDrawer("handoff");
              } else {
                void generateRequest();
              }
            }}
          >
            {currentQoderHandoffStatus === "copied" ? (
              <CheckCircleIcon aria-hidden="true" size={18} weight="fill" />
            ) : (
              <PaperPlaneTiltIcon aria-hidden="true" size={18} weight="fill" />
            )}
            <span>
              {generating
                ? "正在准备…"
                : currentQoderHandoffStatus === "copying"
                  ? "正在复制交接内容…"
                  : currentQoderHandoffStatus === "copied"
                    ? "本轮要求已复制"
                    : currentQoderHandoffStatus === "failed"
                      ? "复制失败 · 查看"
                      : "发送至 Qoder"}
            </span>
            {!runInProgress && currentQoderHandoffStatus !== "copied"
              ? <small>{pendingSendItemCount}</small>
              : null}
          </button>
        </WorkbenchHeaderActions>
        <input
          ref={fileInputRef}
          className="sr-only"
          type="file"
          accept=".html,.htm,text/html"
          onChange={(event) => void handleBrowserFile(event)}
        />
        <input
          ref={attachmentInputRef}
          className="sr-only"
          type="file"
          multiple
          onChange={(event) => {
            const target = attachmentInputTargetRef.current;
            const files = [...(event.target.files ?? [])];
            event.target.value = "";
            if (target) void uploadAttachments(files, target, "file-picker");
          }}
        />
      </WorkbenchHeaderShell>

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

      {!workspaceIssue && (persistState === "conflict" || persistState === "failed") ? (
        <section className="source-conflict-banner" role="alert">
          <div>
            <strong>{persistState === "conflict" ? "源 HTML 已被外部修改" : "当前修改还没有写入文件"}</strong>
            <span>{persistError || "工作台保留了当前编辑内容，不会假装已经更新。"}</span>
          </div>
          <button type="button" onClick={() => void exportCurrentHtml()}>导出当前编辑</button>
          <button
            type="button"
            onClick={() => {
              if (persistState === "conflict") void reloadCurrentSource();
              else requestUserFlush();
            }}
          >{persistState === "conflict" ? "重新载入外部文件" : "重试更新文件"}</button>
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
          <button type="button" onClick={() => void flushDraftPersistence()}>
            重试记录评论
          </button>
        </section>
      ) : null}

      {runInProgress && handoffPreviewOpen ? (
        <PreviewNavigationBanner
          key={`handoff-${activeRun?.requestId || "pending"}-${activeRun?.attemptId || "pending"}`}
          className="sent-preview-banner"
          icon={<EyeIcon aria-hidden="true" size={18} weight="duotone" />}
          title="正在预览已发送 HTML"
          detail="这是本轮冻结并复制给 Qoder 的只读内容"
          actionLabel="返回等待处理"
          onAction={() => {
            setHandoffPreviewOpen(false);
            setCanvasMode("edit");
            setDrawer("handoff");
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
          actionLabel="回到当前版本"
          actionDisabled={viewTransitioning}
          onAction={() => void returnToCurrent()}
        />
      ) : null}

      <div ref={reviewStageRef} className="review-scroll-stage">
        <section className="canvas-column" aria-label="页面画布">
          <div
            className="canvas-edit-surface"
            hidden={canvasMode !== "edit"}
            aria-hidden={canvasMode !== "edit"}
          >
            {!runtimeCapabilitiesReady ? (
              <div className="canvas-loading" role="status">正在识别运行环境…</div>
            ) : !browserPreviewOnly ? (
              <Suspense fallback={(
                <div className="canvas-loading" role="status">正在载入源码画布…</div>
              )}>
                <HtmlCanvasEditor
                  key={`editor-authority-${canvasGeneration}`}
                  ref={editorRef}
                  html={html}
                  sourcePath={sourcePath || undefined}
                  height={`${canvasDocumentHeight}px`}
                  onChange={handleCanvasChange}
                  onInteraction={() => {
                    if (relinkingTargetRef.current) {
                      relinkSelectionArmedRef.current = true;
                    }
                  }}
                  onCommentLayout={handleCommentLayout}
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
                    if (projectSessionRef.current.sourcePath) {
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
                />
              </Suspense>
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
              transport={interactivePreviewTransport}
              onReady={handlePreviewReady}
            />
          ) : null}
        </section>

        {canvasMode === "edit" ? (
          <aside
            ref={commentsPanelRef}
            className="comments-panel comment-rail"
            aria-label={viewMode === "history" ? "历史版本评论" : "本轮评论"}
            aria-busy={!commentLayoutReady}
            data-layout-ready={commentLayoutReady ? "true" : "false"}
            data-layout-generation={commentLayoutAuthority.viewContextGeneration}
            data-layout-text-editing={
              commentLayoutAuthority.textEditing ? "true" : undefined
            }
            data-rail-min-offset={commentRailMinimumOffset}
            data-rail-following={commentRailFollowsFocus ? "true" : "false"}
            style={{
              "--comment-rail-height": `${canvasDocumentHeight}px`,
            } as CSSProperties}
            tabIndex={-1}
          >
          <div
            className="comment-rail-content"
            style={{
              minHeight: `${commentRailContentHeight}px`,
              "--comment-rail-offset": `${commentRailOffset}px`,
            } as CSSProperties}
          >
            <header
              ref={commentsHeaderRef}
              className="comments-header comment-rail-header"
              data-has-header-actions={
                commentLayoutReady
                && (
                  draftInCurrentTab
                  || hasUnsavedCommentEdit
                  || otherTabCommentEntryCount > 0
                )
                  ? "true"
                  : undefined
              }
              data-other-tabs-open={
                commentLayoutReady && otherTabCommentsOpen
                  ? "true"
                  : undefined
              }
            >
              <div className="comment-rail-header-main">
                <h1>评论 <span>{visibleCommentItems.length}</span></h1>
                <div className="comment-rail-header-actions">
                  {viewMode === "history" ? (
                    <small>历史版本 · 只读</small>
                  ) : !draftInCurrentTab
                    && !hasUnsavedCommentEdit
                    && otherTabCommentEntryCount === 0 ? (
                    <small>
                      {visibleCommentItems.length > COMMENT_VIRTUALIZATION_THRESHOLD
                        ? `当前加载 ${renderedVisibleCommentItems.length} 条`
                        : "与正文同步滚动"}
                    </small>
                  ) : null}
                  {commentLayoutReady && draftInCurrentTab ? (
                    <button
                      className="comment-header-action unsaved-comment-shortcut"
                      type="button"
                      data-html-canvas-preserve-selection="true"
                      aria-label="有一条未保存评论"
                      onClick={resumeCurrentComposer}
                    >
                      <span>有一条未保存评论</span>
                      <CaretRightIcon aria-hidden="true" size={12} weight="bold" />
                    </button>
                  ) : null}
                  {commentLayoutReady
                  && hasUnsavedCommentEdit
                  && unfinishedEditedComment ? (
                    <button
                      className="comment-header-action unsaved-comment-edit-shortcut"
                      type="button"
                      data-html-canvas-preserve-selection="true"
                      aria-label="有一条未保存修改"
                      onClick={() => resumeCommentEdit(
                        unfinishedEditedComment.commentId,
                      )}
                    >
                      <span>有一条未保存修改</span>
                      <CaretRightIcon aria-hidden="true" size={12} weight="bold" />
                    </button>
                  ) : null}
                  {commentLayoutReady && otherTabCommentEntryCount > 0 ? (
                    <button
                      className="comment-header-action other-tab-comments-toggle"
                      type="button"
                      data-html-canvas-preserve-selection="true"
                      aria-expanded={otherTabCommentsOpen}
                      aria-controls="other-tab-comment-groups"
                      onClick={() => setExpandedOtherTabCommentsKey((current) => (
                        current === otherTabCommentsContextKey
                          ? ""
                          : otherTabCommentsContextKey
                      ))}
                    >
                      <span>其他标签页评论 {otherTabCommentEntryCount}</span>
                      <CaretRightIcon aria-hidden="true" size={12} weight="bold" />
                    </button>
                  ) : null}
                </div>
                <span className="round-record-counts sr-only">
                  {activeCommentCount} 条评论 · {changeEvents.length} 项直接编辑记录
                </span>
              </div>
              {commentLayoutReady
              && otherTabCommentsOpen
              && otherTabCommentGroups.length > 0 ? (
                <div
                  id="other-tab-comment-groups"
                  className="other-tab-comment-groups"
                  role="region"
                  aria-label="其他标签页评论"
                >
                  {otherTabCommentGroups.map((group) => (
                    <section
                      className="other-tab-comment-group"
                      aria-label={`${group.label}的评论`}
                      key={group.key}
                    >
                      <div className="other-tab-comment-group-header">
                        <strong>{group.label}</strong>
                      </div>
                      <div className="other-tab-comment-list">
                        {group.entries.map((entry) => {
                          if (entry.kind === "draft") {
                            return (
                              <button
                                className="comment-card other-tab-comment-card draft-comment-card"
                                type="button"
                                data-html-canvas-preserve-selection="true"
                                aria-label={`${group.label}：未保存评论：${insertionLabel(entry.target)}：${entry.previewText}`}
                                key={entry.key}
                                onClick={() => {
                                  setExpandedOtherTabCommentsKey("");
                                  window.requestAnimationFrame(resumeCurrentComposer);
                                }}
                              >
                                <span className="comment-card-header">
                                  <span className="comment-target">
                                    {insertionLabel(entry.target)}
                                  </span>
                                  <span className="unsaved-comment-status">未保存</span>
                                </span>
                                <span className="other-tab-comment-card-body">
                                  {entry.previewText}
                                </span>
                              </button>
                            );
                          }
                          return (
                            <button
                              className="comment-card other-tab-comment-card"
                              type="button"
                              data-html-canvas-preserve-selection="true"
                              aria-label={`${group.label}：${insertionLabel(entry.target)}：${entry.previewText}`}
                              key={entry.key}
                              onClick={() => {
                                setExpandedOtherTabCommentsKey("");
                                setComposerOpen(false);
                                setPendingDeleteCommentId(null);
                                window.requestAnimationFrame(() => {
                                  focusCommentTarget(
                                    entry.target,
                                    entry.comment.commentId,
                                  );
                                });
                              }}
                            >
                              <span className="comment-card-header">
                                <span className="comment-target">
                                  {insertionLabel(entry.target)}
                                </span>
                                <time
                                  dateTime={
                                    entry.comment.updatedAt
                                    || entry.comment.createdAt
                                  }
                                >
                                  {formatTime(
                                    entry.comment.updatedAt
                                    || entry.comment.createdAt,
                                    true,
                                  )}
                                </time>
                              </span>
                              <span className="other-tab-comment-card-body">
                                {entry.previewText}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </section>
                  ))}
                </div>
              ) : null}
            </header>
            <span className="sr-only" role="status" aria-live="polite">
              {composerInCurrentTab && Number.isFinite(composerTop)
                ? "评论输入框已与画布目标同时定位"
                : focusedCommentId
                  ? "评论与画布目标已同时定位"
                  : ""}
            </span>

            {projectLoadError ? (
              <section className="round-lock-card rail-status-card" aria-label="项目读取失败">
                <strong>当前项目暂不可编辑</strong>
                <span>{projectLoadError}</span>
                <button type="button" onClick={() => {
                  const activeSource = projectSessionRef.current.sourcePath;
                  if (!activeSource) return;
                  projectHydratingRef.current = true;
                  projectLoadErrorRef.current = null;
                  setProjectHydrating(true);
                  setProjectLoadError(null);
                  const hydrationEpoch = projectSessionRef.current.epoch;
                  void refreshWorkspace(activeSource, hydrationEpoch, false, hydrationEpoch);
                }}>重试读取</button>
              </section>
            ) : !commentLayoutReady ? null
            : composerInCurrentTab
              && draftTarget
              && Number.isFinite(composerTop)
              && !interactionLocked ? (
              <section
                className="comment-composer rail-comment-composer"
                aria-label="添加评论"
                data-html-canvas-preserve-selection="true"
                data-comment-measure="__composer"
                data-comment-measure-key={composerMeasurementKey}
                data-focused="true"
                style={{ top: `${composerTop as number}px` }}
              >
                <header>
                  <div className="composer-target" data-empty={!draftTarget ? "true" : "false"}>
                    <strong>{draftTargetScope}</strong>
                    <span>“{insertionLabel(draftTarget)}”</span>
                  </div>
                  <button
                    className="comment-tool-button"
                    type="button"
                    aria-label="关闭评论编辑器"
                    title={attachmentUploadCount > 0 ? "附件添加完成后可关闭" : "收起并保留草稿"}
                    disabled={attachmentUploadCount > 0}
                    onClick={closeCommentComposer}
                  >
                    <XIcon aria-hidden="true" size={15} weight="bold" />
                  </button>
                </header>
                <label htmlFor="round-comment-draft">评论内容</label>
                {!draftTargetCanSave ? (
                  <div className="comment-target-recovery" role="status">
                    <span>
                      <strong>原位置已变化</strong>
                      <small>草稿和附件仍保留，请在画布中选择新的位置。</small>
                    </span>
                    <button
                      type="button"
                      onClick={() => beginTargetRelink("__composer")}
                    >{relinkingTarget === "__composer" ? "正在等待选择…" : "重新选择目标"}</button>
                    {relinkingTarget === "__composer" ? (
                      <button type="button" onClick={cancelTargetRelink}>取消</button>
                    ) : null}
                  </div>
                ) : null}
                <textarea
                  id="round-comment-draft"
                  ref={composerRef}
                  value={draft}
                  disabled={!draftTargetCanSave || interactionLocked}
                  placeholder={draftTarget.tagName === "body"
                    ? "输入对整个页面的修改要求…"
                    : "输入对这部分内容的修改要求…"}
                  onChange={(event) => {
                    commentSessionRef.current.setComposerDraft(
                      event.target.value,
                    );
                    persistCurrentDraftRecovery();
                  }}
                  onPaste={(event) => {
                    const commentId = draftCommentId || commentSessionRef.current.composerCommentId;
                    if (commentId) pasteImages(event, { kind: "composer", commentId });
                  }}
                  onKeyDown={(event) => {
                    if (shouldSubmitCommentOnEnter({
                      key: event.key,
                      shiftKey: event.shiftKey,
                      isComposing: event.nativeEvent.isComposing,
                    })) {
                      event.preventDefault();
                      void addComment();
                    }
                  }}
                />
                <CommentAttachmentStrip
                  attachments={draftAttachments}
                  objectUrls={attachmentObjectUrls}
                  editable={!interactionLocked}
                  onEnsurePreview={ensureAttachmentObjectUrl}
                  onPreview={(attachment) => void openAttachmentPreview(attachment)}
                  onDownload={(attachment) => void downloadAttachment(attachment)}
                  onRemove={removeComposerAttachment}
                />
                {pendingDeleteCommentId === "__composer" ? (
                  <footer className="comment-delete-confirm composer-delete-confirm" role="alert">
                    <span>删除这条未保存评论？</span>
                    <div>
                      <button
                        type="button"
                        onClick={() => setPendingDeleteCommentId(null)}
                      >取消</button>
                      <button
                        className="confirm-delete"
                        type="button"
                        onClick={discardCurrentComposer}
                      >删除</button>
                    </div>
                  </footer>
                ) : (
                  <footer className="composer-actions">
                    <div className="composer-footer-tools">
                      <button
                        className="comment-tool-button"
                        type="button"
                        aria-label="添加附件"
                        title="添加附件"
                        disabled={interactionLocked || !draftCommentId}
                        onClick={() => {
                          if (draftCommentId) {
                            openAttachmentPicker(
                              { kind: "composer", commentId: draftCommentId },
                              "all",
                            );
                          }
                        }}
                      >
                        <PaperclipIcon aria-hidden="true" size={15} weight="bold" />
                      </button>
                      <button
                        className="comment-tool-button"
                        type="button"
                        aria-label="添加图片"
                        title="添加图片"
                        disabled={interactionLocked || !draftCommentId}
                        onClick={() => {
                          if (draftCommentId) {
                            openAttachmentPicker(
                              { kind: "composer", commentId: draftCommentId },
                              "image",
                            );
                          }
                        }}
                      >
                        <ImageIcon aria-hidden="true" size={15} weight="bold" />
                      </button>
                      <button
                        className="comment-tool-button danger"
                        type="button"
                        aria-label="删除未保存评论"
                        title="删除未保存评论"
                        disabled={
                          interactionLocked
                          || attachmentUploadCount > 0
                          || (!draft.trim() && draftAttachments.length === 0)
                        }
                        onClick={() => setPendingDeleteCommentId("__composer")}
                      >
                        <TrashIcon aria-hidden="true" size={15} weight="bold" />
                      </button>
                      {attachmentUploadCount > 0 ? <small>正在添加附件…</small> : null}
                    </div>
                    <button
                      className="add-comment-button"
                      type="button"
                      disabled={
                        !draftTargetCanSave
                        || (!draft.trim() && draftAttachments.length === 0)
                        || attachmentUploadCount > 0
                        || interactionLocked
                      }
                      onClick={(event) => {
                        event.currentTarget.blur();
                        void addComment();
                      }}
                    >
                      <ChatCircleTextIcon aria-hidden="true" size={15} weight="bold" />
                      评论
                    </button>
                  </footer>
                )}
              </section>
            ) : hasCollapsedCommentDraft
              && draftTarget
              && draftRecoveryTop !== undefined ? (
              <button
                className="comment-card draft-comment-card"
                type="button"
                data-html-canvas-preserve-selection="true"
                aria-label={`未保存评论：${insertionLabel(draftTarget)}：${draft.trim() || `已添加 ${draftAttachments.length} 个附件`}`}
                data-comment-measure="__draft_recovery"
                data-comment-measure-key={draftRecoveryMeasurementKey}
                style={{ top: `${draftRecoveryTop}px` }}
                onClick={resumeCurrentComposer}
              >
                <span className="comment-card-header">
                  <span className="comment-target">
                    {insertionLabel(draftTarget)}
                  </span>
                  <span className="unsaved-comment-status">未保存</span>
                </span>
                <span className="other-tab-comment-card-body">
                  {draft.trim() || `已添加 ${draftAttachments.length} 个附件`}
                </span>
              </button>
            ) : null}

            {(commentLayoutReady || expectedCommentLayoutTargetIds.length === 0)
            && sortedVisibleCommentItems.length === 0
            && !composerInCurrentTab
            && !hasCollapsedCommentDraft ? (
              <div
                className="comments-empty"
                style={{ top: `${commentRailMinimumTop}px` }}
              >
                <ChatCircleTextIcon aria-hidden="true" size={24} weight="duotone" />
                <strong>{otherTabCommentEntryCount > 0
                  ? "这个标签页还没有评论"
                  : "评论会显示在这里"}</strong>
                <span>{otherTabCommentEntryCount > 0
                  ? "其他标签页的评论可从顶部展开。"
                  : "可以评论整个页面、模块或其中的小区块。"}</span>
              </div>
            ) : renderedVisibleCommentItems.map((comment) => {
              const index = sortedVisibleCommentItems.findIndex(
                (item) => item.commentId === comment.commentId,
              );
              const editable = viewMode === "current" && !interactionLocked;
              const editing = (
                editingCommentId === comment.commentId
                && commentEditSession?.commentId === comment.commentId
              );
              const activeEditSession = (
                editing
                && commentEditSession?.commentId === comment.commentId
              )
                ? commentEditSession
                : null;
              const shownAttachments = activeEditSession
                ? activeEditSession.draftAttachments
                : comment.attachments;
              const deleting = pendingDeleteCommentId === comment.commentId;
              const targetLayout = commentTargetLayouts[comment.target.id];
              const targetResolution =
                targetLayout?.resolution ?? comment.target.resolution;
              const targetLocatable = commentTargetIsLocatable(comment.target);
              return (
                <article
                  className="comment-card"
                  data-html-canvas-preserve-selection="true"
                  data-comment-measure={comment.commentId}
                  data-comment-measure-key={commentMeasurementKeys[comment.commentId]}
                  data-selected={selection?.selector === comment.target.selector ? "true" : "false"}
                  data-focused={focusedCommentId === comment.commentId ? "true" : undefined}
                  data-resolution={targetResolution}
                  data-editing={editing ? "true" : undefined}
                  role="group"
                  aria-current={focusedCommentId === comment.commentId ? "location" : undefined}
                  tabIndex={editable && targetLocatable ? 0 : -1}
                  aria-label={`${insertionLabel(comment.target)}：${comment.text}`}
                  style={{
                    top: `${visibleCommentPositions[comment.commentId]}px`,
                  }}
                  onClick={() => {
                    if (!editing && !deleting && editable && targetLocatable) {
                      focusCommentTarget(comment.target, comment.commentId);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget
                      && !editing
                      && !deleting
                      && editable
                      && targetLocatable
                      && (event.key === "Enter" || event.key === " ")
                    ) {
                      event.preventDefault();
                      focusCommentTarget(comment.target, comment.commentId);
                    }
                  }}
                  key={comment.commentId}
                >
                  <header className="comment-card-header">
                    <span className="comment-target">{insertionLabel(comment.target)}</span>
                    <time dateTime={comment.updatedAt || comment.createdAt}>
                      {formatTime(comment.updatedAt || comment.createdAt, true)}
                    </time>
                  </header>
                  {!targetLocatable && editable ? (
                    <div
                      className="comment-target-recovery"
                      role="status"
                      onClick={(event) => event.stopPropagation()}
                    >
                      <span>
                        <strong>原位置已变化</strong>
                        <small>评论和附件仍保留，重新关联后即可发送。</small>
                      </span>
                      <button
                        type="button"
                        onClick={() => beginTargetRelink(comment.commentId)}
                      >{relinkingTarget === comment.commentId
                        ? "正在等待选择…"
                        : "重新选择目标"}</button>
                      {relinkingTarget === comment.commentId ? (
                        <button type="button" onClick={cancelTargetRelink}>取消</button>
                      ) : null}
                    </div>
                  ) : null}
                  {editing ? (
                    <textarea
                      ref={commentEditRef}
                      className="comment-edit-textarea"
                      aria-label={`编辑评论 ${index + 1}`}
                      value={commentEditDraft}
                      onClick={(event) => event.stopPropagation()}
                      onChange={(event) => updateCommentEditDraft(
                        event.target.value,
                      )}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelCommentEdit();
                        } else if (shouldSubmitCommentOnEnter({
                          key: event.key,
                          shiftKey: event.shiftKey,
                          isComposing: event.nativeEvent.isComposing,
                        })) {
                          event.preventDefault();
                          confirmCommentEdit(comment.commentId);
                        }
                      }}
                      onPaste={(event) => pasteImages(event, {
                        kind: "comment",
                        commentId: comment.commentId,
                      })}
                    />
                  ) : <p>{comment.text || "已添加参考附件"}</p>}
                  <CommentAttachmentStrip
                    attachments={shownAttachments}
                    objectUrls={attachmentObjectUrls}
                    editable={editable && editing}
                    onEnsurePreview={ensureAttachmentObjectUrl}
                    onPreview={(attachment) => void openAttachmentPreview(attachment)}
                    onDownload={(attachment) => void downloadAttachment(attachment)}
                    onRemove={(attachment) => removeCommentAttachment(
                      comment.commentId,
                      attachment,
                    )}
                  />
                  {editable ? (
                    deleting ? (
                      <footer
                        className="comment-delete-confirm"
                        role="alert"
                        onClick={(event) => event.stopPropagation()}
                      >
                        <span>删除这条评论？</span>
                        <div>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.currentTarget.blur();
                              setPendingDeleteCommentId(null);
                              queueReviewCommentFocus(comment.target, comment.commentId);
                            }}
                          >取消</button>
                          <button
                            className="confirm-delete"
                            type="button"
                            onClick={(event) => {
                              event.currentTarget.blur();
                              deleteComment(comment.commentId);
                            }}
                          >删除</button>
                        </div>
                      </footer>
                    ) : (
                      <footer className="comment-card-footer">
                        {shownAttachments?.length ? (
                          <span>{shownAttachments.length} 个附件</span>
                        ) : null}
                        <div className="comment-card-tools">
                          <button
                            className="comment-tool-button"
                            type="button"
                            aria-label="添加附件"
                            title="添加附件"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (beginCommentEdit(comment, false)) {
                                window.requestAnimationFrame(() => {
                                  openAttachmentPicker(
                                    {
                                      kind: "comment",
                                      commentId: comment.commentId,
                                    },
                                    "all",
                                  );
                                });
                              }
                            }}
                          >
                            <PaperclipIcon aria-hidden="true" size={15} weight="bold" />
                          </button>
                          <button
                            className="comment-tool-button"
                            type="button"
                            aria-label="添加图片"
                            title="添加图片"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (beginCommentEdit(comment, false)) {
                                window.requestAnimationFrame(() => {
                                  openAttachmentPicker(
                                    {
                                      kind: "comment",
                                      commentId: comment.commentId,
                                    },
                                    "image",
                                  );
                                });
                              }
                            }}
                          >
                            <ImageIcon aria-hidden="true" size={15} weight="bold" />
                          </button>
                          {editing ? (
                            <>
                              <button
                                className="comment-tool-button cancel-edit"
                                type="button"
                                aria-label="取消编辑"
                                title="取消编辑"
                                disabled={attachmentUploadCount > 0}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  event.currentTarget.blur();
                                  cancelCommentEdit();
                                }}
                              >
                                <XIcon aria-hidden="true" size={15} weight="bold" />
                              </button>
                              <button
                                className="comment-tool-button confirm-edit"
                                type="button"
                                aria-label="确认修改"
                                title="确认修改"
                                disabled={
                                  attachmentUploadCount > 0
                                  || (
                                    !commentEditDraft.trim()
                                    && commentEditAttachments.length === 0
                                  )
                                }
                                onClick={(event) => {
                                  event.stopPropagation();
                                  event.currentTarget.blur();
                                  confirmCommentEdit(comment.commentId);
                                }}
                              >
                                <CheckCircleIcon aria-hidden="true" size={16} weight="fill" />
                              </button>
                            </>
                          ) : (
                            <button
                              className="comment-tool-button"
                              type="button"
                              aria-label="编辑评论"
                              title="编辑评论"
                              onClick={(event) => {
                                event.stopPropagation();
                                beginCommentEdit(comment);
                              }}
                            >
                              <PencilSimpleIcon aria-hidden="true" size={15} weight="bold" />
                            </button>
                          )}
                          <button
                            className="comment-tool-button danger"
                            type="button"
                            aria-label="删除评论"
                            title="删除评论"
                            disabled={attachmentUploadCount > 0}
                            onClick={(event) => {
                              event.stopPropagation();
                              event.currentTarget.blur();
                              setPendingDeleteCommentId(comment.commentId);
                              queueReviewCommentFocus(comment.target, comment.commentId);
                            }}
                          >
                            <TrashIcon aria-hidden="true" size={15} weight="bold" />
                          </button>
                        </div>
                      </footer>
                    )
                  ) : null}
                </article>
              );
            })}

          </div>
          </aside>
        ) : null}
      </div>

      {previewAttachment && attachmentObjectUrls[previewAttachment.attachmentId] ? (
        <div
          className="attachment-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={`预览图片 ${previewAttachment.fileName}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPreviewAttachment(null);
          }}
        >
          <div className="attachment-lightbox-content">
            <div className="attachment-lightbox-header">
              <span>
                <strong>{previewAttachment.fileName}</strong>
                <small>{formatFileSize(previewAttachment.byteLength)}</small>
              </span>
              <button
                type="button"
                aria-label="关闭图片预览"
                onClick={() => setPreviewAttachment(null)}
              >
                <XIcon aria-hidden="true" size={18} weight="bold" />
              </button>
            </div>
            {/* Blob URLs are project-local attachment previews and cannot use next/image. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={attachmentObjectUrls[previewAttachment.attachmentId]}
              alt={previewAttachment.fileName}
            />
          </div>
        </div>
      ) : null}

      <div
        className={`drawer-overlay${drawer ? " show" : ""}`}
        data-drawer={drawer || undefined}
        aria-hidden="true"
        onClick={() => {
          if (drawer !== "handoff") setDrawer(null);
        }}
      />
      <aside
        className={`side-drawer${drawer ? " open" : ""}`}
        data-drawer={drawer || undefined}
        inert={!drawer}
        role="dialog"
        aria-label={drawer === "history" ? "版本历史" : drawer === "files" ? "项目文件" : "本轮处理"}
      >
        {drawer === "handoff" ? (
          <HandoffDrawerHeader
            panelTitle={processPanelTitle}
            candidateVersionLabel={activeRun?.candidateVersionLabel}
          />
        ) : drawer ? (
          <>
            <header className="drawer-header project-panel-header">
              <div className="project-panel-title">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="./brand-logo.png" alt="" />
                <span>
                  <small>源页工作区</small>
                  <strong>项目与版本</strong>
                </span>
              </div>
              <button
                className="drawer-close-button"
                type="button"
                aria-label="关闭项目面板"
                title="关闭"
                onClick={() => setDrawer(null)}
              >
                <XIcon aria-hidden="true" size={18} weight="bold" />
              </button>
            </header>
            <nav className="project-tabs" aria-label="项目信息">
              <button
                type="button"
                data-active={drawer === "files" ? "true" : "false"}
                onClick={async () => {
                  if (!await closeFileView()) return;
                  setDrawer("files");
                }}
              >当前项目</button>
              <button
                type="button"
                data-active={drawer === "history" ? "true" : "false"}
                onClick={async () => {
                  if (!await closeFileView()) return;
                  setDrawer("history");
                }}
              >版本历史</button>
            </nav>
          </>
        ) : null}
        <div className="drawer-body">
          {drawer === "history" ? (
            <div className="history-list version-panel-body">
              <header className="version-panel-heading">
                <ClockCounterClockwiseIcon aria-hidden="true" size={22} weight="duotone" />
                <span>
                  <small>版本历史</small>
                  <strong>安全保留每一次修改</strong>
                </span>
              </header>
              {versions.length === 0 ? (
                <div className="drawer-empty">首次编辑或发送给 AI 后，会建立版本 1。</div>
              ) : (
                <div className="version-list">
                  {versions.map((version) => (
                    <HistoryVersionItem
                      key={version.id}
                      version={version}
                      expanded={expandedVersionId === version.id}
                      current={version.id === latestVersionId}
                      viewing={viewingVersionId === version.id}
                      viewDisabled={
                        runInProgress
                        || projectHydrating
                        || Boolean(projectLoadError)
                        || Boolean(workspaceIssue)
                        || viewTransitioning
                      }
                      attachmentObjectUrls={attachmentObjectUrls}
                      onToggle={() => setExpandedVersionId(
                        expandedVersionId === version.id ? null : version.id,
                      )}
                      onView={() => void viewHistoryVersion(version)}
                      onReveal={
                        typeof window !== "undefined"
                        && window.htmlAIProjects?.revealVersionFile
                          ? () => void revealVersionInFinder(version)
                          : undefined
                      }
                      onEnsureAttachmentPreview={ensureAttachmentObjectUrl}
                      onPreviewAttachment={(attachment) => {
                        void openAttachmentPreview(attachment);
                      }}
                      onDownloadAttachment={(attachment) => {
                        void downloadAttachment(attachment);
                      }}
                    />
                  ))}
                </div>
              )}
              <p className="version-note">
                在画布中查看不会覆盖当前 HTML；历史内容与当时的评论都保持只读。
              </p>
            </div>
          ) : null}

          {drawer === "files" ? (
            fileView ? (
              <div
                className="file-view"
                data-editable={
                  fileView.path === "PROJECT.md" && !fileView.error
                    ? "true"
                    : "false"
                }
              >
                <button
                  className="project-file-back"
                  type="button"
                  onClick={() => void closeFileView()}
                >
                  <CaretRightIcon aria-hidden="true" size={13} weight="bold" />
                  返回项目
                </button>
                {fileView.error ? (
                  <section className="project-file-read-error" role="alert">
                    <span className="project-resource-icon">
                      <TriangleIcon aria-hidden="true" size={20} weight="duotone" />
                    </span>
                    <div>
                      <small>{workspaceFileLabel(fileView.path)}</small>
                      <strong>内容没有读取成功</strong>
                      <p>{fileView.error}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void viewFile(fileView.path)}
                    >重试读取</button>
                  </section>
                ) : fileView.path === "PROJECT.md" ? (
                  <>
                    <header className="project-rules-heading">
                      <span className="project-resource-icon">
                        <FileIcon aria-hidden="true" size={20} weight="duotone" />
                      </span>
                      <span>
                        <small>项目长期规则</small>
                        <strong>管理 AI 修改规则</strong>
                      </span>
                      <em
                        data-state={fileView.loading
                          ? "loading"
                          : runInProgress
                          ? "locked"
                          : projectRulesSaving
                            ? "loading"
                          : fileView.content === fileView.savedContent
                            ? "saved"
                            : "dirty"}
                      >
                        {fileView.loading
                          ? "正在读取"
                          : runInProgress
                          ? "处理中 · 只读"
                          : projectRulesSaving
                            ? "正在保存"
                          : fileView.content === fileView.savedContent
                            ? "已保存"
                            : "等待自动保存"}
                      </em>
                    </header>
                    <p className="project-file-note" id="project-rules-help">
                      {fileView.loading
                        ? "正在读取项目规则。内容核对完成前暂不接受编辑。"
                        : runInProgress
                        ? "本轮已经使用冻结时的规则。AI 处理完成前这里保持只读，不会把临时修改追加入本轮。"
                        : "修改会自动保存。每次发送至 Qoder 时，源页都会把这份规则与本轮要求一起交接；规则只影响后续任务，不会修改当前 HTML。"}
                    </p>
                    <textarea
                      key={projectRulesEditorGeneration}
                      ref={projectRulesEditorRef}
                      className="project-file-editor"
                      aria-label="项目长期规则"
                      aria-describedby="project-rules-help"
                      spellCheck={false}
                      disabled={fileView.loading || runInProgress}
                      value={fileView.content}
                      onCompositionStart={(event) => {
                        beginProjectRulesComposition(event.currentTarget);
                      }}
                      onCompositionEnd={(event) => {
                        finishProjectRulesComposition(event.currentTarget);
                      }}
                      onChange={(event) => {
                        projectRulesSessionRef.current.updateContent(
                          event.target.value,
                        );
                      }}
                    />
                    {projectRulesSaveError ? (
                      <p className="project-file-save-error" role="status">
                        {projectRulesSaveError}
                      </p>
                    ) : null}
                    <div className="project-file-actions">
                      <small>
                        {projectRulesSaving
                          ? "正在自动保存"
                          : fileView.content === fileView.savedContent
                          ? "当前内容已记录"
                          : "修改将在稍后自动保存"}
                      </small>
                      <button
                        type="button"
                        disabled={
                          fileView.loading
                          || projectRulesSaving
                          || runInProgress
                          || fileView.content === fileView.savedContent
                        }
                        onPointerDown={(event) => {
                          if (projectRulesSessionRef.current.compositionActive) {
                            event.preventDefault();
                          }
                        }}
                        onMouseDown={(event) => {
                          if (projectRulesSessionRef.current.compositionActive) {
                            event.preventDefault();
                          }
                        }}
                        onClick={restoreProjectRules}
                      >还原修改</button>
                      {projectRulesSaveError ? (
                        <button
                          className="drawer-primary"
                          type="button"
                          disabled={projectRulesSaving || runInProgress}
                          onClick={() => void saveProjectRules()}
                        >再次保存</button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <>
                    <strong>{workspaceFileLabel(fileView.path)}</strong>
                    <pre>{fileView.content}</pre>
                  </>
                )}
              </div>
            ) : (
              <div className="files-panel project-panel-body">
                <section className="current-project-card">
                  <span className="project-file-icon">
                    <FileHtmlIcon aria-hidden="true" size={22} weight="duotone" />
                  </span>
                  <span>
                    <small>当前文件</small>
                    <strong>{projectName}</strong>
                    <em>
                      <span aria-hidden="true" />
                      {browserPreviewOnly
                        ? "只读预览 · 操作不会保存"
                        : saveStatusLabel}
                    </em>
                  </span>
                  <div className="current-project-actions">
                    {sourcePath && typeof window !== "undefined" && window.htmlAIProjects?.showInFolder ? (
                      <button type="button" onClick={() => void showProjectInFolder()}>Finder</button>
                    ) : null}
                    <button type="button" onClick={() => void exportCurrentHtml()}>
                      导出 HTML 副本
                    </button>
                  </div>
                </section>

                <section className="recent-files">
                  <header>
                    <strong>最近打开</strong>
                    <small>{visibleRecentProjects.length} 个文件</small>
                  </header>
                  <div>
                    {recentProjectsError ? (
                      <section className="recent-projects-error" role="status">
                        <span>{recentProjectsError}</span>
                        <button type="button" onClick={() => void refreshRecents()}>
                          重试读取
                        </button>
                      </section>
                    ) : null}
                    {visibleRecentProjects.length ? visibleRecentProjects.map((project) => {
                      const projectStatus = recentProjectStatus(project.sourcePath);
                      return (
                      <div className="recent-file-item" key={project.path}>
                        <button
                          className="recent-file-row"
                          type="button"
                          disabled={attachmentUploadCount > 0}
                          onClick={() => void openProject(project.sourcePath)}
                        >
                          <FileHtmlIcon aria-hidden="true" size={19} weight="duotone" />
                          <span>
                            <strong>{project.name}</strong>
                            <small>{folderFromSourcePath(project.sourcePath)}</small>
                          </span>
                          <time dateTime={new Date(project.lastOpenedAt).toISOString()}>
                            {formatProjectTimestamp(project.lastOpenedAt)}
                          </time>
                          {projectStatus ? (
                            <em
                              className="recent-project-status"
                              data-state={projectStatus.state}
                            >{projectStatus.label}</em>
                          ) : null}
                          <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                        </button>
                        {typeof window !== "undefined" && window.htmlAIProjects?.forgetRecent ? (
                          <button
                            className="recent-file-remove"
                            type="button"
                            aria-label={`从最近打开中移除 ${project.name}`}
                            title="移除这条记录"
                            onClick={() => void forgetRecentProject(project.sourcePath)}
                          >
                            <XIcon aria-hidden="true" size={14} weight="bold" />
                          </button>
                        ) : null}
                      </div>
                      );
                    }) : !recentProjectsError ? (
                      <span className="recent-projects-empty">还没有最近打开的文件</span>
                    ) : null}
                  </div>
                </section>

                <button className="open-local-button" type="button" onClick={() => void openProject()}>
                  <span><PlusIcon aria-hidden="true" size={19} weight="bold" /></span>
                  <span>
                    <strong>打开本地 HTML</strong>
                    <small>选择已有的 .html 或 .htm 文件</small>
                  </span>
                  <CaretRightIcon aria-hidden="true" size={15} weight="bold" />
                </button>

                <details
                  className="project-advanced"
                  onToggle={(event) => {
                    if (event.currentTarget.open) void prepareProjectRecords();
                  }}
                >
                  <summary>
                    <span>
                      <strong>项目资料</strong>
                      <small>长期规则与每轮处理记录</small>
                    </span>
                    <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                  </summary>
                  <div className="project-resource-list">
                    {projectRecordsError ? (
                      <section className="project-resource-error" role="alert">
                        <div>
                          <strong>项目资料还没有建立</strong>
                          <span>{projectRecordsError}</span>
                        </div>
                        <button
                          type="button"
                          disabled={projectRecordsPreparing}
                          onClick={() => void prepareProjectRecords()}
                        >{projectRecordsPreparing ? "正在重试…" : "重试建立"}</button>
                      </section>
                    ) : null}
                    <button
                      className="project-resource-row project-rule-card"
                      type="button"
                      disabled={!projectId || projectRecordsPreparing || Boolean(projectRecordsError)}
                      onClick={() => void viewFile("PROJECT.md")}
                    >
                      <span className="project-resource-icon">
                        <FileIcon aria-hidden="true" size={18} weight="duotone" />
                      </span>
                      <span className="project-resource-copy">
                        <strong>项目长期规则</strong>
                        <small>
                          {projectId
                            ? "以后每次 AI 修改都会读取"
                            : projectRecordsPreparing
                              ? "正在准备可编辑的项目资料"
                              : "打开后会自动建立项目资料"}
                        </small>
                      </span>
                      <span
                        className="project-resource-meta"
                        data-state={runInProgress ? "locked" : "ready"}
                      >
                        {runInProgress
                          ? "处理中 · 只读"
                          : projectId
                            ? "可编辑"
                            : projectRecordsPreparing
                              ? "准备中"
                              : "待建立"}
                      </span>
                      <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                    </button>
                    <button
                      className="project-resource-row"
                      type="button"
                      disabled={
                        !projectRecordsPath
                        || projectRecordsPreparing
                        || Boolean(projectRecordsError)
                      }
                      onClick={() => void showProjectRecordsInFolder()}
                    >
                      <span className="project-resource-icon">
                        <FolderOpenIcon aria-hidden="true" size={18} weight="duotone" />
                      </span>
                      <span className="project-resource-copy">
                        <strong>项目记录文件夹</strong>
                        <small>
                          {projectRecordsPath
                            ? "查看每轮要求、AI 返回与历史文件"
                            : projectRecordsPreparing
                              ? "正在建立本地记录文件夹"
                              : "打开后会自动建立记录文件夹"}
                        </small>
                      </span>
                      <span className="project-resource-meta">
                        {projectRecordsPath
                          ? "Finder"
                          : projectRecordsPreparing
                            ? "准备中"
                            : "待建立"}
                      </span>
                      <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                    </button>
                  </div>
                </details>
              </div>
            )
          ) : null}

          {drawer === "handoff" ? (
            <HandoffPanel
              activeRun={activeRun}
              terminalRun={terminalRun}
              processSummaryTitle={processSummaryTitle}
              processSummaryDetail={processSummaryDetail}
              processStatusLabel={processStatusLabel}
              processSteps={processSteps}
              activeCommentCount={activeCommentCount}
              activeCommentItems={activeCommentItems}
              runBasisLabel={runBasisLabel}
              runSubmittedLabel={runSubmittedLabel}
              pendingRunOutcome={pendingRunOutcome}
              canRevealRequestFolder={Boolean(
                typeof window !== "undefined"
                && window.htmlAIProjects?.revealRequestFolder,
              )}
              onRevealRequestFolder={() => void revealActiveRunInFinder()}
            />
          ) : null}
        </div>
        {drawer === "handoff" && activeRun ? (
          <HandoffFooter
            activeRun={activeRun}
            reviewPreparing={reviewPreparing}
            openingReadyVersion={openingReadyVersion}
            pendingRunOutcome={pendingRunOutcome}
            pendingReconcileBusy={pendingReconcileBusy}
            handoffCopyFailed={handoffCopyFailed}
            currentQoderHandoffStatus={currentQoderHandoffStatus}
            cancelling={cancelling}
            resolvingConflict={resolvingConflict}
            checkingRun={checkingRun}
            terminalRun={terminalRun}
            canRevealRequestFolder={Boolean(
              typeof window !== "undefined"
              && window.htmlAIProjects?.revealRequestFolder,
            )}
            onReviewReadyResult={() => void reviewReadyResult()}
            onActivateReadyResult={() => void activateReadyResult()}
            onSend={() => void sendToQoderWork(
              activeRun.handoffMessage,
              activeRun,
            )}
            onCancel={requestActiveRunEnd}
            onResolveConflict={(choice) => void resolveAiConflict(choice)}
            onRevealRequestFolder={() => void revealActiveRunInFinder()}
            onReturnToEditing={returnToEditingFromTerminalRun}
            onRequestEnd={requestActiveRunEnd}
            onPreviewSentHtml={() => {
              setHandoffPreviewOpen(true);
              setCanvasMode("preview");
              setDrawer(null);
            }}
          />
        ) : null}
      </aside>

      <CancelAiRunDialog
        open={cancelRunConfirmationOpen}
        onClose={() => setCancelRunConfirmationKey(null)}
        onConfirm={() => {
          const currentRun = runSessionRef.current.activeRun;
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
        userNoticeOpenFailed={userNoticeOpenFailed}
        onClose={closeAboutPageRoot}
        onCheckForUpdates={() => void checkForApplicationUpdates()}
        onDownloadUpdate={() => void downloadAvailableUpdate()}
        onRequestRestart={() => {
          setAboutOpen(false);
          setRestartUpdateOpen(true);
        }}
        onOpenRepository={() => void openProjectRepository()}
        onOpenUserNotice={() => void openUserNotice()}
      />

      {toast ? (
        <NoticeBar
          className="toast"
          title={toast.title}
          message={toast.message}
          tone={toast.tone}
          actionLabel={toast.action?.label}
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
      {readyReviewOverlay}
    </>
  );
}
