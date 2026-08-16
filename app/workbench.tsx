"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CSSProperties,
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
  HtmlCanvasEditRuntimeLoadOutcome,
  HtmlCanvasEditorHandle,
  HtmlCanvasMutation,
  HtmlCanvasSelection,
  HtmlCanvasSourceTransaction,
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
} from "./components/HtmlCanvasEditor";
import type { DesktopEditRuntimeApi } from "./components/desktop-edit-runtime-api";
import AboutPageRootDialog from "./components/AboutPageRootDialog";
import CancelAiRunDialog from "./components/CancelAiRunDialog";
import HtmlInteractionPreview, {
  type HtmlInteractionPreviewHandle,
} from "./components/HtmlInteractionPreview";
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
import { createCommentWorkflowCodecs } from "./application/comment-workflow-codecs.js";
import type { DocumentWorkflowOutcome } from "./application/document-workflow.js";
import { createDocumentWorkflowCodecs } from "./application/document-workflow-codecs.js";
import { createRunWorkflowCodecs } from "./application/run-workflow-codecs.js";
import { createWorkspaceControllerCodecs } from "./application/workspace-controller-codecs.js";
import type { CommentSessionSnapshot } from "./application/comment-session.js";
import type { DocumentSessionSnapshot } from "./application/document-session.js";
import { runLocalUserAction } from "./application/local-action-outcomes.js";
import {
  ReviewAnalysisCancelledError,
  ReviewAnalysisSession,
} from "./application/review-analysis-session.js";
import type { PageViewContext } from "./lib/page-view-context.js";
import type { ProjectSessionSnapshot } from "./application/project-session.js";
import type { RunOperationKind, RunSessionSnapshot } from "./application/run-session.js";
import type { VersionSessionSnapshot } from "./application/version-session.js";
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
  currentWorkingCopyPresentation,
  fileExtension,
  fileStem,
  folderFromSourcePath,
  formatProjectTimestamp,
  formatTime,
  localFileNameFromSourcePath,
  projectMarkdown,
  projectStatusProjection,
  safeVersionLabel,
  sameLocalSourcePath,
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
  CloseReadiness,
  CommentAttachment,
  CommentEditSession,
  CommentItem,
  DirectEditEvent,
  Drawer,
  HtmlProject,
  OtherTabCommentEntry,
  PersistState,
  PrepareCloseDetail,
  ProjectContext,
  RegisteredProject,
  RecentProject,
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

type CanvasRenderAck = Readonly<{
  generation: number;
  sha256: string;
}>;

type CanvasRenderAcks = Readonly<Record<CanvasMode, CanvasRenderAck | null>>;

const EMPTY_PROJECT_RULES_SNAPSHOT = {
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
} as const;
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
const INITIAL_EXTERNAL_FILE_OPEN_SNAPSHOT = {
  status: "idle" as const,
  activeRequestId: null,
  queuedRequestId: null,
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
    return { ...frozen, ok: true as const, html: frozen.html };
  }, []);
  const fenceAndFreezeCurrentCanvasRef = useRef(fenceAndFreezeCurrentCanvas);
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
  const reviewAnalysisSessionRef = useRef(
    new ReviewAnalysisSession<PreparedReviewDocuments>({
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
  const relinkingTargetRef = useRef<string | null>(null);
  const relinkSelectionArmedRef = useRef(false);
  const resumeSubmissionAfterRelinkRef = useRef(false);
  const normalizeCurrentGlobalCommentsRef = useRef<() => CommentItem[]>(() => []);
  const projectRulesEditorRef = useRef<HTMLTextAreaElement | null>(null);
  const fileRenameInputRef = useRef<HTMLInputElement | null>(null);
  const openHtmlButtonRef = useRef<HTMLButtonElement | null>(null);
  const fileRenameEditingRef = useRef(false);
  const fileRenameBusyRef = useRef(false);
  const fileRenameErrorRef = useRef("");
  const automaticProjectRegistrationRef = useRef("");
  const projectRecordsPreparationRef = useRef("");

  const [workspaceControllerSnapshot, setWorkspaceControllerSnapshot] =
    useState<WorkspaceControllerSnapshot | null>(null);
  const [workspaceController, setWorkspaceController] =
    useState<WorkspaceController | null>(null);
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
  const [fileRenameEditing, setFileRenameEditing] = useState(false);
  const [fileRenameBusy, setFileRenameBusy] = useState(false);
  const [fileRenameDraft, setFileRenameDraft] = useState("");
  const [fileRenameError, setFileRenameError] = useState("");
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [recentProjectsError, setRecentProjectsError] = useState("");
  const [registeredProjects, setRegisteredProjects] = useState<RegisteredProject[]>([]);
  const [registeredProjectsError, setRegisteredProjectsError] = useState("");
  const [selection, setSelection] = useState<HtmlCanvasSelection | null>(null);
  const commentSnapshot = (
    workspaceControllerSnapshot?.commentSession as CommentSessionSnapshot<
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
    workspaceControllerSnapshot?.comment?.attachmentUploadCount ?? 0;
  const draftPersistError =
    workspaceControllerSnapshot?.comment?.draft.error ?? "";
  const runSnapshot = workspaceControllerSnapshot?.runSession
    ?? INITIAL_RUN_SNAPSHOT;
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
  const projectRulesSnapshot = workspaceControllerSnapshot?.projectRules
    ?? EMPTY_PROJECT_RULES_SNAPSHOT;
  const activeFileView = projectRulesSnapshot.open
    ? {
        path: projectRulesSnapshot.path,
        content: projectRulesSnapshot.content,
        savedContent: projectRulesSnapshot.savedContent,
        loading: projectRulesSnapshot.loading,
        ...(projectRulesSnapshot.error ? { error: projectRulesSnapshot.error } : {}),
      }
    : fileView?.path === "PROJECT.md" ? null : fileView;
  const projectRulesEditorGeneration = projectRulesSnapshot.editorGeneration;
  const projectRulesCompositionActive =
    projectRulesSnapshot.compositionActive;
  const projectRulesSaving = projectRulesSnapshot.saving;
  const projectRulesSaveError = projectRulesSnapshot.saveError;
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
  const versionTransitioning =
    (workspaceControllerSnapshot?.version?.navigation.phase || "idle") !== "idle";
  const renameTransitioning =
    workspaceControllerSnapshot?.project?.rename?.phase === "renaming";
  const viewTransitioning = sourceTransitioning || versionTransitioning || renameTransitioning;
  useEffect(() => {
    renameTransitioningRef.current = renameTransitioning;
  }, [renameTransitioning]);
  const invalidateCanvasRenderAcks = useCallback(() => {
    setCanvasRenderAcks({ edit: null, preview: null });
  }, []);
  useLayoutEffect(() => {
    const editRuntimeApi: DesktopEditRuntimeApi | undefined = window.htmlAIEditRuntime;
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
            // Retire the exact textarea that owns macOS marked text. A late
            // composition input from that detached control can no longer
            // overwrite the explicit restore result.
            window.requestAnimationFrame(() => {
              window.requestAnimationFrame(() => {
                settle();
                const editor = projectRulesEditorRef.current;
                editor?.focus({ preventScroll: true });
                editor?.setSelectionRange(editor.value.length, editor.value.length);
              });
            });
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
          setInterval: (callback: () => void, delayMs: number) => (
            window.setInterval(callback, delayMs)
          ),
          clearInterval: (handle: unknown) => window.clearInterval(handle as number),
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
    setWorkspaceControllerSnapshot(controller.getSnapshot());
    return () => {
      if (workspaceControllerRef.current === controller) {
        workspaceControllerRef.current = null;
      }
      setWorkspaceController((current) => current === controller ? null : current);
      controller.dispose();
    };
  }, [deferEditorCommand, invalidateCanvasRenderAcks, isViewTransitioning]);
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
  // Opening is not complete until the source has either proved its existing
  // v4 binding or been imported as a new V1. Keeping this in the same
  // hydration fence prevents comments, edits, renames, and native commands
  // from racing an automatic V4 registration on a just-opened HTML.
  const projectRegistrationPending = Boolean(
    workspaceController
    && sourcePath
    && (!projectId || !documentId)
    && !projectRecordsError,
  );
  const projectHydrating =
    workspaceControllerSnapshot?.project?.hydration.phase === "hydrating"
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
          ? `初始版本 V1 已保存为 ${fileName}。原文件已移入废纸篓。`
          : disposition === "trash-failed"
            ? "项目已导入。原文件未能删除，仍留在原来的位置。"
            : `初始版本 V1 已保存为 ${fileName}，与刚才选择的文件一致。原文件没有改动。`;
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
          setCanvasMode("edit");
          setDrawer("handoff");
        }
        return;
      }
      if (runEvent.type === "run-submission-uncertain") {
        if (runEvent.current) setDrawer("handoff");
        return;
      }
      if (runEvent.type === "run-submission-failed") {
        if (runEvent.current) setDrawer("handoff");
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
            action: { id: "open-handoff", label: "查看处理详情" },
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
            setDrawer("handoff");
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
                action: { id: "open-handoff", label: "查看详情" },
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
        sourcePath?: unknown;
        projects?: unknown;
        projectName?: unknown;
        projectRecordsPath?: unknown;
        lastModifiedAt?: unknown;
        showHandoff?: unknown;
        contentChanged?: unknown;
      }>;
      if (projectEvent.type === "project-hydration-stage") {
        markProjectHydrationStage(String(projectEvent.stage || ""));
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
        setStartupIssue(null);
        setProjectName(project.name);
        setProjectRecordsPath(null);
        setLastModifiedAt(project.lastModifiedAt || null);
        setSelection(null);
        setPageViewContext(null);
        reviewAnalysisSessionRef.current.clear();
        setComposerOpen(false);
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
        setEditingCommentId(null);
        commentEditResumePendingRef.current = null;
        setPendingDeleteCommentId(null);
        relinkingTargetRef.current = null;
        relinkSelectionArmedRef.current = false;
        resumeSubmissionAfterRelinkRef.current = false;
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
        setFileView(null);
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
        setEditingCommentId(null);
        setComposerOpen(false);
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
          setDrawer("handoff");
        }
        return;
      }
      if (projectEvent.type === "project-recents-loaded") {
        setRecentProjects(
          Array.isArray(projectEvent.projects)
            ? projectEvent.projects as RecentProject[]
            : [],
        );
        setRecentProjectsError("");
        return;
      }
      if (projectEvent.type === "project-recents-failed") {
        setRecentProjectsError(String(
          projectEvent.reason || "最近打开记录暂时无法读取。",
        ));
        return;
      }
      if (projectEvent.type === "project-catalog-loaded") {
        setRegisteredProjects(
          Array.isArray(projectEvent.projects)
            ? projectEvent.projects as RegisteredProject[]
            : [],
        );
        setRegisteredProjectsError("");
        return;
      }
      if (projectEvent.type === "project-catalog-failed") {
        setRegisteredProjectsError(String(
          projectEvent.reason || "项目目录暂时无法读取。",
        ));
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
        setToast({
          title: "暂不能切换到 QoderWork 中的 HTML",
          message: "当前画布仍在安全恢复；已保留当前 HTML。恢复后可手动重试打开。",
          tone: "warning",
          sticky: true,
          disposition: "direct-action",
          dedupeKey: "external-project-open-deferred",
          action: { id: "retry-external-project-open", label: "重试打开" },
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
  }, [setSourceViewTransitioning, workspaceController]);
  useEffect(() => () => reviewAnalysisSessionRef.current.dispose(), []);
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
    if (activeFileView?.path === "PROJECT.md") {
      captureUsageEvent(
        "module_viewed",
        { module: "project_rules" },
        projectId || undefined,
      );
    }
  }, [activeFileView?.path, projectId]);

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
        return true;
      }
      return false;
    };
    if (await waitForCurrentGeneration()) return;

    // A missing acknowledgement is a disposable-Canvas failure, not a user
    // conflict. Rebuild exactly once from the authoritative Document snapshot.
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
    workspaceControllerRef.current?.replaceCommentItems(nextComments);
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

  const refreshRecents = useCallback(async () => {
    if (!workspaceController) return;
    await workspaceController.refreshRecentProjects();
  }, [workspaceController]);

  const refreshRegisteredProjects = useCallback(async () => {
    if (!workspaceController) return;
    await workspaceController.refreshRegisteredProjects();
  }, [workspaceController]);

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
    if (!workspaceController || !window.htmlAIProjects) return;
    void workspaceController.openProject({ kind: "startup" });
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

  const openRegisteredProject = useCallback(async (registeredProjectId: string) => {
    if (!workspaceController) return;
    await workspaceController.openProject({
      kind: "registered",
      projectId: registeredProjectId,
    });
  }, [workspaceController]);

  const resumeDeferredProjectApplication = useCallback(() => (
    workspaceController?.resumeDeferredProjectApplication().status === "succeeded"
  ), [workspaceController]);

  const resumeDeferredExternalProject = useCallback(() => (
    workspaceController?.resumeDeferredExternalProject().status === "succeeded"
  ), [workspaceController]);

  useEffect(() => {
    if (!workspaceController) return undefined;
    const lifecycle = window.htmlAIAppLifecycle;
    if (!lifecycle?.onExternalOpenRequested) return undefined;
    return lifecycle.onExternalOpenRequested((request) => {
      workspaceController.acceptExternalProject(request);
    });
  }, [workspaceController]);

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

  const cancelFileRename = useCallback(() => {
    if (fileRenameBusyRef.current) return;
    fileRenameEditingRef.current = false;
    fileRenameErrorRef.current = "";
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
      || currentDocumentSessionSnapshot().hasPendingWrite
      || currentDocumentSessionSnapshot().isFlushing
      || workspaceController?.hasDocumentHistoryAction
      || currentDocumentSessionSnapshot().editRevision
        !== currentDocumentSessionSnapshot().lastPersistedRevision
    ) return;
    fileRenameEditingRef.current = true;
    fileRenameErrorRef.current = "";
    setFileRenameEditing(true);
    setFileRenameDraft(currentSourceFileStem);
    setFileRenameError("");
    window.requestAnimationFrame(() => {
      fileRenameInputRef.current?.focus();
      fileRenameInputRef.current?.select();
    });
  }, [
    canOfferFileRename,
    currentDocumentSessionSnapshot,
    currentSourceFileStem,
    workspaceController?.hasDocumentHistoryAction,
  ]);

  const commitFileRename = useCallback(async () => {
    if (!fileRenameEditingRef.current || fileRenameBusyRef.current) return;
    if (
      !workspaceController
      || !canOfferFileRename
    ) {
      fileRenameErrorRef.current = "当前状态还不能重命名，请等待文件安全保存。";
      setFileRenameError(fileRenameErrorRef.current);
      return;
    }

    fileRenameBusyRef.current = true;
    setFileRenameBusy(true);
    fileRenameErrorRef.current = "";
    setFileRenameError("");
    try {
      const controller = requiredWorkspaceController(workspaceController);
      const reconciled = await controller.observeExternalSourceChange({
        reason: "rename",
      });
      if (reconciled.status === "rejected" || reconciled.status === "unknown") {
        throw Object.assign(
          new Error(
            ("reason" in reconciled && reconciled.reason)
              || "当前工作文件暂时无法核对位置，PageRoot 没有切换路径。",
          ),
          { code: "code" in reconciled ? reconciled.code : undefined },
        );
      }
      if (reconciled.status === "blocked") {
        throw new Error(
          ("reason" in reconciled && reconciled.reason)
            || "当前状态还不能重命名，请等待文件安全保存。",
        );
      }
      if (reconciled.status === "succeeded" && typeof reconciled.value?.projectName === "string") {
        setProjectName(reconciled.value.projectName);
      }
      const outcome = await controller.renameProjectSource({ stem: fileRenameDraft });
      if (outcome.status !== "succeeded") {
        throw Object.assign(
          new Error(
            outcome.status === "unknown"
              ? "文件名已经修改，但项目状态还没有完成刷新。"
              : ("reason" in outcome && outcome.reason)
                || "文件名没有修改，请检查名称后重试。",
          ),
          { code: "code" in outcome ? outcome.code : undefined },
        );
      }
      if (outcome.value.projectName) setProjectName(outcome.value.projectName);
      setLastModifiedAt(outcome.value.lastModifiedAt || null);
      fileRenameEditingRef.current = false;
      fileRenameErrorRef.current = "";
      setFileRenameEditing(false);
      setFileRenameDraft("");
      setFileRenameError("");
    } catch (cause) {
      const message = productErrorMessage(
        cause,
        "文件名没有修改，请检查名称后重试。",
      );
      fileRenameErrorRef.current = message;
      setFileRenameError(message);
    } finally {
      fileRenameBusyRef.current = false;
      setFileRenameBusy(false);
    }
  }, [
    canOfferFileRename,
    fileRenameDraft,
    workspaceController,
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

  useEffect(() => {
    if (!fileRenameEditing || fileRenameBusy) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (!fileRenameErrorRef.current) return;
      const field = fileRenameInputRef.current?.closest(".window-file-rename-field");
      if (field instanceof Element && field.contains(event.target as Node)) return;
      cancelFileRename();
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [cancelFileRename, fileRenameBusy, fileRenameEditing]);

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
      workspaceController.acceptBrowserProject({
        operationId,
        project: { name: file.name, sourcePath: null, html: fileHtml },
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
    const currentComments = currentCommentSessionSnapshot();
    relinkingTargetRef.current = itemId;
    relinkSelectionArmedRef.current = false;
    setRelinkingTarget(itemId);
    setPendingDeleteCommentId(null);
    setEditingCommentId(null);
    if (!commentEditSessionHasChanges(currentComments.editSession)) {
      workspaceControllerRef.current?.setCommentEditSession(null);
      commentEditResumePendingRef.current = null;
    }
    editorRef.current?.clearSelection();
    setSelection(null);
    if (itemId !== "__composer") {
      updateFocusedComment(itemId);
      const comment = currentComments.comments.find(
        (item) => item.commentId === itemId,
      );
      if (comment) queueReviewPairReveal(comment.target, itemId);
    }
  }, [
    currentCommentSessionSnapshot,
    queueReviewPairReveal,
    updateFocusedComment,
  ]);

  const finishTargetRelink = useCallback((target: HtmlCanvasSelection): boolean => {
    const controller = workspaceControllerRef.current;
    const currentComments = currentCommentSessionSnapshot();
    const relinkingId = relinkingTargetRef.current;
    if (
      !relinkingId
      || !relinkSelectionArmedRef.current
      || !canSaveCommentTarget(target)
    ) return false;
    if (relinkingId === "__composer") {
      const currentTarget = currentComments.composerTarget;
      const nextTarget = currentTarget
        ? { ...target, id: currentTarget.id }
        : target;
      controller?.setCommentComposerTarget(nextTarget);
      setSelection(nextTarget);
      relinkingTargetRef.current = null;
      relinkSelectionArmedRef.current = false;
      setRelinkingTarget(null);
      setComposerOpen(true);
      queueReviewPairReveal(nextTarget, "__composer");
      requestComposerFocus();
      return true;
    }
    const current = currentComments.comments.find(
      (comment) => comment.commentId === relinkingId,
    );
    if (!current) {
      relinkingTargetRef.current = null;
      relinkSelectionArmedRef.current = false;
      setRelinkingTarget(null);
      return false;
    }
    const nextTarget = { ...target, id: current.target.id };
    const nextComments = currentComments.comments.map((comment) => (
      comment.commentId === relinkingId
        ? {
            ...comment,
            target: nextTarget,
            updatedAt: new Date().toISOString(),
          }
        : comment
    ));
    controller?.replaceCommentItems(nextComments);
    setSelection(nextTarget);
    relinkingTargetRef.current = null;
    relinkSelectionArmedRef.current = false;
    setRelinkingTarget(null);
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
    currentCommentSessionSnapshot,
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
    workspaceControllerRef.current?.clearCommentComposer();
    setComposerOpen(false);
    setPendingDeleteCommentId(null);
    updateFocusedComment(null);
  }, [updateFocusedComment]);

  const resumeCurrentComposer = useCallback(() => {
    const target = currentCommentSessionSnapshot().composerTarget;
    if (!target) return;
    if (!canSaveCommentTarget(target)) {
      beginTargetRelink("__composer");
      return;
    }
    const located = editorRef.current?.select(target, { showToolbar: false });
    const nextTarget = located || target;
    workspaceControllerRef.current?.setCommentComposerTarget(nextTarget);
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
    if (relinkingTargetRef.current && finishTargetRelink(target)) return;
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
      return;
    }
    const currentEdit = currentComments.editSession;
    if (currentEdit && commentEditSessionHasChanges(currentEdit)) {
      showUnfinishedCommentEditNotice(currentEdit);
      return;
    }
    if (currentEdit) {
      controller.setCommentEditSession(null);
      commentEditResumePendingRef.current = null;
      setEditingCommentId(null);
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
    setSelection(target);
    const resumesRecoveredDraft = currentComments.composerTarget?.id === target.id;
    if (!resumesRecoveredDraft) {
      const nextCommentId = recordId("comment", commentCounter.current++);
      controller.replaceCommentWorkingCopy({
        composerDraft: "",
        composerCommentId: nextCommentId,
        composerAttachments: [],
        composerTarget: target,
      });
    } else if (!currentComments.composerCommentId) {
      const nextCommentId = recordId("comment", commentCounter.current++);
      controller.replaceCommentWorkingCopy({
        composerCommentId: nextCommentId,
        composerTarget: target,
      });
    } else {
      controller.setCommentComposerTarget(target);
    }
    updateFocusedComment(null);
    setComposerOpen(true);
    queueReviewPairReveal(target, "__composer");
    requestComposerFocus();
  }, [
    attachmentUploadCount,
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
    if (attachmentUploadCount > 0) return;
    setPendingDeleteCommentId(null);
    const currentComments = currentCommentSessionSnapshot();
    if (
      currentComments.composerDraft.trim()
      || currentComments.composerAttachments.length > 0
    ) {
      setComposerOpen(false);
      updateFocusedComment(null);
      return;
    }
    clearCurrentComposer();
  }, [
    attachmentUploadCount,
    clearCurrentComposer,
    currentCommentSessionSnapshot,
    updateFocusedComment,
  ]);

  const discardCurrentComposer = useCallback(() => {
    if (attachmentUploadCount > 0) return;
    const outcome = workspaceController?.discardCommentComposer();
    if (outcome?.status !== "succeeded") return;
    if (relinkingTargetRef.current === "__composer") {
      relinkingTargetRef.current = null;
      relinkSelectionArmedRef.current = false;
      setRelinkingTarget(null);
    }
    composerFocusPendingRef.current = false;
    setComposerOpen(false);
    setPendingDeleteCommentId(null);
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
    forgetAttachmentObjectUrl,
    updateFocusedComment,
    workspaceController,
  ]);

  const addComment = useCallback(async () => {
    const currentRun = currentRunSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    const currentComments = currentCommentSessionSnapshot();
    if (
      currentRun.activeLocked
      || projectHydrating
      || projectLoadError
      || isViewTransitioning()
      || currentDocument.persistState === "conflict"
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
    const commentId = currentComments.composerCommentId
      || draftCommentId
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
    setComposerOpen(false);
    setPendingDeleteCommentId(null);
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
    draft,
    draftAttachments,
    draftCommentId,
    draftTarget,
    attachmentUploadCount,
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
    controller.setCommentEditSession(nextSession);
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
    setEditingCommentId(null);
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
      controller?.setCommentEditSession(null);
      commentEditResumePendingRef.current = null;
      setEditingCommentId(null);
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
    currentCommentSessionSnapshot,
    queueReviewCommentFocus,
  ]);

  const updateCommentEditDraft = useCallback((draftText: string) => {
    const current = currentCommentSessionSnapshot().editSession;
    if (!current) return;
    const nextSession = { ...current, draftText };
    workspaceControllerRef.current?.setCommentEditSession(nextSession);
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
    const outcome = workspaceController?.editComment({ commentId });
    if (outcome?.status !== "succeeded") return;
    commentEditResumePendingRef.current = null;
    setEditingCommentId(null);
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
    setPendingDeleteCommentId(null);
    if (editSession) {
      commentEditResumePendingRef.current = null;
      setEditingCommentId(null);
    }
    for (const attachment of attachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
    }
    if (deleted) {
      updateFocusedComment(null);
      queueReviewPairReveal(deleted.target, "");
    }
  }, [
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
      workspaceControllerRef.current?.setCommentEditSession(null);
      commentEditResumePendingRef.current = null;
      const frame = window.requestAnimationFrame(() => {
        setEditingCommentId(null);
      });
      return () => window.cancelAnimationFrame(frame);
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
      const frame = window.requestAnimationFrame(() => {
        cancelCommentEdit(false);
      });
      return () => window.cancelAnimationFrame(frame);
    }
    if (editingCommentId === session.commentId) {
      const frame = window.requestAnimationFrame(() => {
        setEditingCommentId(null);
      });
      return () => window.cancelAnimationFrame(frame);
    }
  }, [
    cancelCommentEdit,
    canvasMode,
    commentEditSession,
    commentTargetLayouts,
    currentCommentSessionSnapshot,
    editingCommentId,
    focusedCommentId,
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
    currentCommentSessionSnapshot,
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
    context: ProjectContext,
  ): Promise<string> => {
    const outcome = await requiredWorkspaceController(workspaceController)
      .readProjectFile({ context, relativePath });
    if (outcome.status === "succeeded") return outcome.value.content;
    if (outcome.status === "stale") {
      throw new Error("项目已切换，没有显示旧项目文件。");
    }
    throw new Error(outcome.reason);
  }, [workspaceController]);

  const viewFile = useCallback(async (path: string) => {
    const context = captureProjectContext();
    if (!context) return;
    if (path === "PROJECT.md") {
      await requiredWorkspaceController(workspaceController).openProjectRules({
        context,
      });
      return;
    }
    const closedRules = await requiredWorkspaceController(workspaceController)
      .closeProjectRules();
    if (closedRules.status !== "succeeded") return;
    setFileView({
      path,
      content: "正在读取…",
      savedContent: "正在读取…",
      loading: true,
    });
    try {
      const content = await readWorkspaceFile(path, context);
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
  }, [
    captureProjectContext,
    isCurrentProjectContext,
    readWorkspaceFile,
    workspaceController,
  ]);

  const beginProjectRulesComposition = useCallback((
    target: HTMLTextAreaElement,
  ) => {
    workspaceController?.beginProjectRulesComposition({
      target,
      baselineValue: target.value,
    });
  }, [workspaceController]);

  const finishProjectRulesComposition = useCallback((
    target: HTMLTextAreaElement,
  ) => {
    workspaceController?.finishProjectRulesComposition({ target });
  }, [workspaceController]);

  useEffect(() => {
    if (drawer === "files" && activeFileView?.path === "PROJECT.md") return;
    workspaceController?.leaveProjectRulesEditor();
  }, [activeFileView?.path, drawer, workspaceController]);

  const restoreProjectRules = useCallback(() => {
    workspaceController?.restoreProjectRules();
  }, [workspaceController]);

  const saveProjectRules = useCallback(async (): Promise<boolean> => {
    const outcome = await requiredWorkspaceController(workspaceController)
      .saveProjectRules();
    return outcome.status === "succeeded";
  }, [workspaceController]);

  const closeFileView = useCallback(async (): Promise<boolean> => {
    if (projectRulesSnapshot.open) {
      const outcome = await requiredWorkspaceController(workspaceController)
        .closeProjectRules();
      if (outcome.status !== "succeeded") return false;
    }
    setFileView(null);
    return true;
  }, [projectRulesSnapshot.open, workspaceController]);

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

  const revealVersionInFinder = useCallback(async (version: Pick<Version, "id">) => {
    const activeSourcePath = currentProjectSessionSnapshot().sourcePath;
    const revealVersionFile = window.htmlAIProjects?.revealVersionFile;
    if (!activeSourcePath || !revealVersionFile) return;
    await runLocalUserAction({
      kind: "reveal-version-file",
      invoke: () => revealVersionFile({
        sourcePath: activeSourcePath,
        versionId: version.id,
      }),
      onFailure: (cause: unknown) => setToast({
        title: "历史版本暂时无法在文件夹中打开",
        message: productErrorMessage(cause, "请确认项目记录仍然完整后重试。"),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: `reveal-version-file-${version.id}`,
      }),
    });
  }, [currentProjectSessionSnapshot]);

  const generateRequest = useCallback(async (fromDeferred = false) => {
    const currentRun = currentRunSessionSnapshot();
    const currentProject = currentProjectSessionSnapshot();
    const currentDocument = currentDocumentSessionSnapshot();
    const currentComments = currentCommentSessionSnapshot();
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
      setDrawer("handoff");
      return;
    }
    if (
      currentComments.composerTarget
      && (
        currentComments.composerDraft.trim()
        || currentComments.composerAttachments.length > 0
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
    const unfinishedEdit = currentComments.editSession;
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

    const outcome = await requiredWorkspaceController(workspaceController)
      .submitRequest({
        projectName,
        previousVersionId: latestVersionId,
        basedOnVersionId: currentBasedOnVersionId,
        deadlineAt: Date.now() + 60_000,
      });
    if (outcome.status === "succeeded" || outcome.status === "stale") return;
    if (outcome.status === "unknown") {
      setDrawer("handoff");
      return;
    }
    if (outcome.status === "blocked") {
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
        const unsafeTargets = currentCommentSessionSnapshot().comments.filter(
          (comment) => commentHasContent(comment) && !canLocateTarget(comment.target),
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
        setDrawer("handoff");
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
    }
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
  }, [
    currentBasedOnVersionId,
    currentCommentSessionSnapshot,
    currentDocumentSessionSnapshot,
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    deferEditorCommand,
    latestVersionId,
    openProject,
    isViewTransitioning,
    projectHydrating,
    projectLoadError,
    projectName,
    requestComposerFocus,
    showUnfinishedCommentEditNotice,
    viewMode,
    workspaceController,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.generateRequest = () => {
      void generateRequest(true);
    };
  }, [generateRequest]);

  const activateReadyResult = useCallback(async (
    { reviewed = false }: { reviewed?: boolean } = {},
  ) => {
    const run = activeRun;
    if (
      !run
      || !workspaceController
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || (
        run.candidateAssessment?.status === "attention"
        && !reviewed
      )
    ) return;
    const operationKey = activeRunOperationKey(run);
    setOpeningReadyVersion(true);
    try {
      const outcome = await requiredWorkspaceController(workspaceController)
        .activateReadyVersion({
          run,
          reviewLease: readyReviewSession?.operationKey === operationKey
            ? {
                operationKey: readyReviewSession.operationKey,
                beforeHtml: readyReviewSession.beforeHtml,
              }
            : null,
        });
      if (outcome.status !== "succeeded") {
        if (outcome.status !== "stale") {
          setDrawer("handoff");
          setToast({
            title: "最新版暂时无法打开",
            message: outcome.reason,
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
        refreshWarning?: string;
      };
      if (readyReviewSession?.operationKey === operationKey) {
        setDrawer(null);
        await new Promise<void>((resolve) => {
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => resolve());
          });
        });
        setReadyReviewSession(null);
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
      setSelection(null);
      setComposerOpen(false);
      commentEditResumePendingRef.current = null;
      setEditingCommentId(null);
      setPreviewAttachment(null);
      setHandoffPreviewOpen(false);
      setCanvasMode("edit");
      setDrawer(null);
      if (result.protocolViolation) {
        const warning = "内部 AI 的临时输出在最终化后又被修改；已提交版本本身未受影响。";
        setDrawer("handoff");
        setToast({
          title: `${result.candidateLabel} 已打开，但需要检查`,
          message: `${warning} 新版本内容已经核对一致；详情已保留在本轮处理记录中。`,
          tone: "warning",
          sticky: true,
          dedupeKey: "current-version-result",
          action: { id: "open-handoff", label: "查看处理详情" },
        });
      } else if (result.verificationWarning || result.refreshWarning) {
        setToast({
          title: `${result.candidateLabel} 已打开，但需要复核`,
          message: result.verificationWarning || result.refreshWarning || "",
          tone: "warning",
          sticky: true,
          disposition: "background-result",
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
    currentProjectSessionSnapshot,
    currentRunSessionSnapshot,
    readyReviewSession,
    workspaceController,
  ]);

  const reviewReadyResult = useCallback(async () => {
    const run = currentRunSessionSnapshot().activeRun;
    if (
      !run
      || !workspaceController
      || run.status !== "ready-to-open"
      || !run.readyPayload
      || reviewPreparing
    ) return;
    setReviewPreparing(true);
    try {
      const outcome = await requiredWorkspaceController(workspaceController)
        .prepareReviewCandidate({ run });
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
      const reviewComments = currentCommentSessionSnapshot().comments
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
        candidate.baseSnapshotSha256,
        candidate.sha256,
        candidate.sourcePath,
        externalBootstrap ? "external" : "inline",
        await browserSha256(commentsKey),
      ].join("\u0000");
      const preparedReview = await reviewAnalysisSessionRef.current.analyze({
        key: reviewCacheKey,
        compute: async ({ isCancelled }) => {
          const sessionId = `review-${Date.now().toString(36)}-${++reviewSessionSequenceRef.current}`;
          const documents = await buildReviewDocumentsAsync(frozenHtml, candidate.content, {
            sessionId,
            sourceSha256BySide: {
              before: candidate.baseSnapshotSha256,
              after: candidate.sha256,
            },
            sourcePath: candidate.sourcePath,
            externalBootstrap,
            comments: reviewComments,
          }, { isCancelled });
          return {
            operationKey,
            beforeHtml: frozenHtml,
            afterHtml: candidate.content,
            sourcePath: candidate.sourcePath,
            commentsKey,
            sessionId,
            documents,
          };
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
    currentCommentSessionSnapshot,
    currentRunSessionSnapshot,
    fenceAndFreezeCurrentCanvas,
    isCurrentProjectContext,
    reviewPreparing,
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
    if (!activeRun || !workspaceController) return false;
    const outcome = await requiredWorkspaceController(workspaceController).cancelRun({
      run: activeRun,
      agentMayBeRunning,
      reason,
    });
    return outcome.status === "succeeded";
  }, [activeRun, workspaceController]);

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
      || !workspaceController
    ) return;
    const outcome = await requiredWorkspaceController(workspaceController)
      .resolveRunConflict({ run: activeRun, action });
    if (outcome.status !== "succeeded") {
      if (outcome.status !== "stale") setDrawer("handoff");
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
    workspaceController,
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
    : fileRenameBusy
      ? "正在重命名…"
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
  const displayedVersions = currentWorkingCopy && currentWorkingCopyStatus
    ? versions.map((version) => (
      version.id === currentWorkingCopy.id
        ? { ...version, ...currentWorkingCopyStatus }
        : version
    ))
    : versions;
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
  const canRevealAiTask = Boolean(
    activeRun
    && activeRun.requestId !== "pending"
    && activeRun.requestPath
    && typeof window !== "undefined"
    && window.htmlAIProjects?.revealAiTask,
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
          : "等待 AI 返回结果";
  const processSummaryTitle = pendingRunOutcome
    ? "为避免重复任务，画布暂时保持只读"
    : activeRun?.status === "ready-to-open"
      ? "AI 改好了，先对照再决定用哪一版"
      : activeRun?.status === "no-change"
        ? "页面与评论可以继续编辑"
        : activeRun?.status === "error"
          ? "源 HTML 没有被覆盖"
          : "页面暂时只能看";
  const processSummaryDetail = pendingRunOutcome
    ? "源页会在后台继续核对，不会重复发送同一轮要求"
    : activeRun?.status === "no-change"
      ? "原评论和附件都已保留，调整要求后可以重新发送"
      : activeRun?.status === "error"
        ? "当前 HTML 没有被覆盖；返回编辑后仍可查看上轮处理"
        : activeRun?.status === "ready-to-open" && candidateNeedsReview
          ? "HTML 可以打开，但与上一版的共同特征较少，不会直接替换当前页面"
          : activeRun?.status === "ready-to-open"
            ? "不会直接替换当前页面。"
            : "你的评论还在，AI 改完也不会直接覆盖。";
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
    workspaceControllerRef.current?.dismissActiveRun();
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer(null);
    editorRef.current?.unlockNow?.();
  };
  const reopenRecentRunOutcome = () => {
    if (!workspaceControllerRef.current?.reopenRecentRunOutcome(sourcePath)) return;
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer("handoff");
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
        setDrawer("handoff");
        return;
      case "retry-history":
        void requestSourceHistoryAction(
          action.direction || lastHistoryDirectionRef.current,
        );
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
        {
          const currentComments = currentCommentSessionSnapshot();
        if (action.target.kind === "composer") {
          const target = currentComments.composerTarget;
          if (
            currentComments.composerCommentId === action.target.commentId
            && target
          ) {
            setComposerOpen(true);
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
        void workspaceController?.flushDraft();
        return;
      case "review-project-rules":
        setDrawer("files");
        if (activeFileView?.path !== "PROJECT.md") void viewFile("PROJECT.md");
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
      onRevealAiTask={() => void revealAiTaskInFinder()}
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
                    onBlur={() => {
                      if (fileRenameErrorRef.current) {
                        cancelFileRename();
                        return;
                      }
                      void commitFileRename();
                    }}
                    onChange={(event) => {
                      setFileRenameDraft(event.target.value);
                      if (fileRenameError) {
                        fileRenameErrorRef.current = "";
                        setFileRenameError("");
                      }
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
                  title="重命名文件"
                  onClick={beginFileRename}
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
                  ref={openHtmlButtonRef}
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
              {headerStatusFacts.length ? (
                <span className="file-version-label project-status-facts">
                  {headerStatusFacts.map((fact) => (
                    <span key={fact}>{fact}</span>
                  ))}
                </span>
              ) : null}
              {canOpenProjectRootInFolder ? (
                <button
                  className="window-file-folder-action"
                  type="button"
                  aria-label="在文件夹中打开当前项目文件夹"
                  title="在文件夹中打开当前项目文件夹"
                  onClick={() => void showProjectRecordsInFolder()}
                >
                  在文件夹中打开
                </button>
              ) : canShowCurrentFileInFolder ? (
                <button
                  className="window-file-folder-action"
                  type="button"
                  aria-label={`在文件夹中打开 ${currentSourceFileName}`}
                  title="在文件夹中打开当前文件"
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
                data-canvas-authority={canvasAuthority?.status}
                data-render-generation={visibleCanvasAck?.generation}
                data-rendered-sha256={visibleCanvasAck?.sha256 || undefined}
                role={canvasAuthority?.status === "failed" ? "button" : "status"}
                aria-live="polite"
                tabIndex={canvasAuthority?.status === "failed" ? 0 : undefined}
                onClick={canvasAuthority?.status === "failed" ? () => {
                  void workspaceController?.retryCanvasVerification({
                    context: captureProjectContext() || undefined,
                  });
                } : undefined}
                onKeyDown={canvasAuthority?.status === "failed" ? (event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    void workspaceController?.retryCanvasVerification({
                      context: captureProjectContext() || undefined,
                    });
                  }
                } : undefined}
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
              if (runInProgress || currentQoderHandoffStatus === "copied") {
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
                  ? "正在复制…"
                  : currentQoderHandoffStatus === "failed"
                    ? "复制失败，再试一次"
                    : currentQoderHandoffStatus === "copied" || runInProgress
                      ? "查看本轮"
                      : pendingSendItemCount === 0
                        ? "写评论后再发送"
                        : "发给 AI"}
            </span>
            {pendingSendItemCount > 0
              && !runInProgress
              && currentQoderHandoffStatus !== "copied"
              && currentQoderHandoffStatus !== "failed"
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
              editRuntimePreparing ? (
                <div className="canvas-loading" role="status">正在载入源码画布…</div>
              ) : (
              <Suspense fallback={(
                <div className="canvas-loading" role="status">正在载入源码画布…</div>
              )}>
                <HtmlCanvasEditor
                  key={`editor-authority-${canvasGeneration}`}
                  ref={editorRef}
                  html={html}
                  sourcePath={canvasSourcePath}
                  height={`${canvasDocumentHeight}px`}
                  onChange={handleCanvasChange}
                  onInteraction={() => {
                    if (relinkingTargetRef.current) {
                      relinkSelectionArmedRef.current = true;
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
                  void workspaceController?.retryProjectHydration();
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
                    workspaceControllerRef.current?.setCommentComposerDraft(
                      event.target.value,
                    );
                  }}
                  onPaste={(event) => {
                    const commentId = draftCommentId
                      || currentCommentSessionSnapshot().composerCommentId;
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
                  {displayedVersions.map((version) => (
                    <HistoryVersionItem
                      key={version.id}
                      version={version}
                      expanded={expandedVersionId === version.id}
                      current={version.id === latestVersionId}
                      editingBase={version.id === currentBasedOnVersionId}
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
            activeFileView ? (
              <div
                className="file-view"
                data-editable={
                  activeFileView.path === "PROJECT.md" && !activeFileView.error
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
                {activeFileView.error ? (
                  <section className="project-file-read-error" role="alert">
                    <span className="project-resource-icon">
                      <TriangleIcon aria-hidden="true" size={20} weight="duotone" />
                    </span>
                    <div>
                      <small>{workspaceFileLabel(activeFileView.path)}</small>
                      <strong>内容没有读取成功</strong>
                      <p>{activeFileView.error}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void viewFile(activeFileView.path)}
                    >重试读取</button>
                  </section>
                ) : activeFileView.path === "PROJECT.md" ? (
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
                        data-state={activeFileView.loading
                          ? "loading"
                          : runInProgress
                          ? "locked"
                          : projectRulesSaving
                            ? "loading"
                          : activeFileView.content === activeFileView.savedContent
                            ? "saved"
                            : "dirty"}
                      >
                        {activeFileView.loading
                          ? "正在读取"
                          : runInProgress
                          ? "处理中 · 只读"
                          : projectRulesSaving
                            ? "正在保存"
                          : activeFileView.content === activeFileView.savedContent
                            ? "已保存"
                            : "等待自动保存"}
                      </em>
                    </header>
                    <p className="project-file-note" id="project-rules-help">
                      {activeFileView.loading
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
                      disabled={activeFileView.loading || runInProgress}
                      value={activeFileView.content}
                      onCompositionStart={(event) => {
                        beginProjectRulesComposition(event.currentTarget);
                      }}
                      onCompositionEnd={(event) => {
                        finishProjectRulesComposition(event.currentTarget);
                      }}
                      onChange={(event) => {
                        workspaceController?.updateProjectRules({
                          content: event.target.value,
                        });
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
                          : activeFileView.content === activeFileView.savedContent
                          ? "当前内容已记录"
                          : "修改将在稍后自动保存"}
                      </small>
                      <button
                        type="button"
                        disabled={
                          activeFileView.loading
                          || projectRulesSaving
                          || runInProgress
                          || activeFileView.content === activeFileView.savedContent
                        }
                        onPointerDown={(event) => {
                          if (projectRulesCompositionActive) {
                            event.preventDefault();
                          }
                        }}
                        onMouseDown={(event) => {
                          if (projectRulesCompositionActive) {
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
                    <strong>{workspaceFileLabel(activeFileView.path)}</strong>
                    <pre>{activeFileView.content}</pre>
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
                    {canOpenProjectRootInFolder ? (
                      <button type="button" onClick={() => void showProjectRecordsInFolder()}>在文件夹中打开</button>
                    ) : sourcePath && typeof window !== "undefined" && window.htmlAIProjects?.showInFolder ? (
                      <button type="button" onClick={() => void showProjectInFolder()}>在文件夹中打开</button>
                    ) : null}
                    <button type="button" onClick={() => void exportCurrentHtml()}>
                      导出 HTML 副本
                    </button>
                  </div>
                </section>

                <section className="recent-files registered-projects">
                  <header>
                    <strong>所有项目</strong>
                    <small>{registeredProjects.length} 个已登记项目</small>
                  </header>
                  <div>
                    {registeredProjectsError ? (
                      <section className="recent-projects-error" role="status">
                        <span>{registeredProjectsError}</span>
                        <button type="button" onClick={() => void refreshRegisteredProjects()}>
                          重试读取
                        </button>
                      </section>
                    ) : null}
                    {registeredProjects.length ? registeredProjects.map((project) => (
                      <div
                        className="recent-file-item"
                        data-project-id={project.projectId}
                        key={project.projectId}
                      >
                        <button
                          className="recent-file-row"
                          type="button"
                          disabled={
                            attachmentUploadCount > 0
                            || project.availability !== "ready"
                          }
                          onClick={() => void openRegisteredProject(project.projectId)}
                        >
                          <FileHtmlIcon aria-hidden="true" size={19} weight="duotone" />
                          <span>
                            <strong>{project.projectName}</strong>
                            <small>{folderFromSourcePath(project.registeredProjectRootPath)}</small>
                          </span>
                          {project.lastOpenedAt ? (
                            <time dateTime={new Date(project.lastOpenedAt).toISOString()}>
                              {formatProjectTimestamp(project.lastOpenedAt)}
                            </time>
                          ) : null}
                          <em
                            className="recent-project-status"
                            data-state={project.availability}
                          >{
                            project.projectId === projectId
                              ? "当前"
                              : project.availability === "ready"
                                ? project.hasPendingCandidate
                                  ? "候选待审阅"
                                  : "可打开"
                                : project.availability === "unavailable"
                                  ? "暂不可用"
                                  : "需要修复"
                          }</em>
                          <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                        </button>
                      </div>
                    )) : !registeredProjectsError ? (
                      <span className="recent-projects-empty">还没有已登记项目</span>
                    ) : null}
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
                          ? "在文件夹中打开"
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
              canRevealAiTask={canRevealAiTask}
              onRevealAiTask={() => void revealAiTaskInFinder()}
              onRetrySubmission={() => {
                workspaceControllerRef.current?.dismissActiveRun();
                void generateRequest();
              }}
              onCancelRun={requestActiveRunEnd}
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
            canRevealAiTask={canRevealAiTask}
            onReviewReadyResult={() => void reviewReadyResult()}
            onActivateReadyResult={() => void activateReadyResult()}
            onSend={() => {
              if (!workspaceController) return;
              void workspaceController.copyRunHandoff({ run: activeRun });
            }}
            onCancel={requestActiveRunEnd}
            onResolveConflict={(choice) => void resolveAiConflict(choice)}
            onRevealAiTask={() => void revealAiTaskInFinder()}
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

      {openConfirmation ? (
        <ExternalHtmlOpenDialog
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
            workspaceController?.cancelExternalOpen({
              requestId: openConfirmation.requestId,
            });
            openHtmlButtonRef.current?.focus();
          }}
          onConfirm={(action) => {
            void workspaceController?.confirmExternalOpen({
              requestId: openConfirmation.requestId,
              action,
              deleteOriginal: openConfirmation.deleteOriginal === true,
            }).finally(() => {
              openHtmlButtonRef.current?.focus();
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
      {readyReviewOverlay}
    </>
  );
}
