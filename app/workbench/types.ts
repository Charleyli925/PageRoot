import type { HtmlCanvasSelection } from "../components/HtmlCanvasEditor";
import type { DraftSnapshot } from "../application/draft-session.js";
import type { RuntimeCapabilities } from "../application/runtime-capabilities.js";
import type { SourceHistoryDirection, SourceHistoryEntry } from "../domain/source-history.js";
import type {
  CandidateAssessment,
  ValidationReview,
} from "../domain/run-lifecycle.js";

export type HtmlProject = {
  path: string;
  sourcePath: string;
  name: string;
  html: string;
  sha256: string;
  lastModifiedAt?: string;
};

export type RecentProject = {
  path: string;
  sourcePath: string;
  name: string;
  lastOpenedAt: number;
};

export type DesktopProjectsApi = {
  getActiveProject: () => Promise<HtmlProject | null>;
  openHtml: () => Promise<HtmlProject | null>;
  showInFolder?: (sourcePath: string) => Promise<{ sourcePath: string }>;
  openInDefaultBrowser?: (
    sourcePath: string,
  ) => Promise<{ sourcePath: string }>;
  renameHtml?: (payload: {
    operationId: string;
    sourcePath: string;
    stem: string;
    expectedSha256: string;
  }) => Promise<HtmlProject & {
    operationId: string;
    previousSourcePath: string;
    fileName: string;
    stem: string;
    extension: string;
    renamed: boolean;
    replayed: boolean;
    workspaceRelinked: boolean;
  }>;
  revealRequestFolder?: (payload: {
    sourcePath: string;
    requestPath: string;
  }) => Promise<{ requestPath: string }>;
  revealVersionFile?: (payload: {
    sourcePath: string;
    versionId: string;
  }) => Promise<{ versionPath: string }>;
  activateGeneratedVersion?: (payload: {
    previousSourcePath: string;
    nextSourcePath: string;
    expectedSha256: string;
    projectId: string;
    versionId: string;
  }) => Promise<HtmlProject & {
    previousSourcePath: string;
    versionId: string;
  }>;
  exportHtmlCopy?: (payload: {
    html: string;
    sourcePath?: string | null;
    suggestedName?: string;
  }) => Promise<{ path: string; name: string } | null>;
  readHtml?: (sourcePath: string) => Promise<HtmlProject>;
  listRecentProjects: () => Promise<RecentProject[]>;
  openRecent: (sourcePath: string) => Promise<HtmlProject>;
  forgetRecent?: (sourcePath: string) => Promise<{ sourcePath: string }>;
};

export type QoderHandoffResult = {
  status: "copied";
  copied: boolean;
  opened: boolean;
  pasted: boolean;
  reason: string | null;
};

export type QoderHandoffUiStatus = "copying" | "copied" | "failed";

export type ProjectQoderHandoffState = {
  sourcePath: string;
  requestId: string;
  attemptId: string;
  status: QoderHandoffUiStatus;
};

export type DesktopIntegrationsApi = {
  handoffToQoderWork: (payload: {
    message: string;
  }) => Promise<QoderHandoffResult>;
};

export type ApplicationUpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "current"
  | "unsupported"
  | "unavailable";

export type ApplicationUpdateResult = {
  status: ApplicationUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  architecture: string;
  downloadPercent: number | null;
  publishedAt: string | null;
};

export type DesktopUpdatesApi = {
  getStatus: () => Promise<ApplicationUpdateResult | null>;
  checkNow: () => Promise<ApplicationUpdateResult>;
  downloadAvailable: () => Promise<ApplicationUpdateResult>;
  onStatus: (
    listener: (result: ApplicationUpdateResult | null) => void,
  ) => () => void;
  installDownloaded: () => Promise<{
    installing: boolean;
    reason: "not-ready" | "close-blocked" | null;
  }>;
  openLatestRelease: () => Promise<{ opened: boolean }>;
  openRepository: () => Promise<{ opened: boolean }>;
};

declare global {
  interface Window {
    htmlAIProjects?: DesktopProjectsApi;
    htmlAIIntegrations?: DesktopIntegrationsApi;
    htmlAIUpdates?: DesktopUpdatesApi;
    htmlAIEdit?: {
      onHistoryRequested: (
        listener: (direction: SourceHistoryDirection) => void,
      ) => () => void;
      runNativeHistory: (
        direction: SourceHistoryDirection,
      ) => Promise<{ applied: boolean }>;
    };
    htmlAIRuntime?: {
      bridgePort: string;
      bridgeAuthToken: string;
      appVersion: string;
      capabilities?: RuntimeCapabilities;
    };
    __PAGEROOT_HYDRATION_STAGE__?: string;
  }
}

export type CommentAttachment = {
  attachmentId: string;
  kind: "image" | "file";
  fileName: string;
  mediaType: string;
  byteLength: number;
  sha256: string;
  relativePath: string;
  requestRelativePath?: string;
  source?: "clipboard" | "file-picker";
};

export type CommentItem = {
  commentId: string;
  createdAt: string;
  updatedAt: string;
  target: HtmlCanvasSelection;
  text: string;
  attachments?: CommentAttachment[];
  baseVersionId: string | null;
  requestId?: string;
  attemptId?: string;
  resultVersionId?: string;
};

export type CommentEditSession = {
  commentId: string;
  baselineText: string;
  baselineAttachments: CommentAttachment[];
  draftText: string;
  draftAttachments: CommentAttachment[];
};

export type OtherTabCommentEntry =
  | {
      kind: "saved";
      key: string;
      target: HtmlCanvasSelection;
      comment: CommentItem;
      previewText: string;
    }
  | {
      kind: "draft";
      key: "__composer";
      target: HtmlCanvasSelection;
      previewText: string;
    };

export type DirectEditEvent = {
  eventId: string;
  createdAt: string;
  kind: "text" | "style" | "reorder" | "structure";
  target: HtmlCanvasSelection;
  property?: string;
  before: unknown;
  after: unknown;
  baseVersionId: string | null;
  capturedRevision?: number;
  inherited?: boolean;
  inheritedFromVersionId?: string;
};

export type Version = {
  id: string;
  ordinal: number;
  label: string;
  summary: string;
  generatedAt: string;
  source: "初始页面" | "内部 AI";
  contentSha256: string;
  previousVersionId: string | null;
  basedOnVersionId: string | null;
  requestId: string | null;
  attemptId: string | null;
  committed: boolean;
  comments: CommentItem[];
  directEdits: DirectEditEvent[];
  supplements: UserSupplementRecord[];
  validationReview: ValidationReview | null;
  candidateAssessment: CandidateAssessment | null;
};

export type UserSupplementAttachment = {
  attachmentId: string;
  fileName: string;
  mediaType: string;
  relativePath?: string;
  sha256?: string;
};

export type UserSupplementRecord = {
  recordId: string;
  action: "add" | "amend" | "retract";
  text: string;
  createdAt: string;
  referenceId?: string;
  evidenceState: "text-only" | "original-file" | "description-only";
  evidenceDescription?: string;
  attachments: UserSupplementAttachment[];
};

export type PersistState = "idle" | "preview-dirty" | "queued" | "writing" | "failed" | "conflict";
export type ViewMode = "current" | "history";
export type CanvasMode = "edit" | "preview";
export type Drawer = "files" | "history" | "handoff" | null;
export type ToastTone = "success" | "info" | "warning" | "error";
export type ToastDisposition =
  | "silent-recover"
  | "defer-and-resume"
  | "direct-action"
  | "user-choice"
  | "background-result"
  | "inform-in-place";
export type ToastAction =
  | { id: "retry-export"; label: string }
  | { id: "open-handoff"; label: string }
  | { id: "open-project"; label: string; sourcePath: string }
  | { id: "retry-project-open"; label: string; sourcePath?: string }
  | {
      id: "open-attachment-picker";
      label: string;
      target: { kind: "composer" | "comment"; commentId: string };
      accept?: "all" | "image";
    }
  | {
      id: "review-comment-attachments";
      label: string;
      target: { kind: "composer" | "comment"; commentId: string };
    }
  | {
      id: "relink-target";
      label: string;
      commentId: string;
      resumeSubmission?: boolean;
    }
  | { id: "relaunch-app"; label: string }
  | { id: "retry-draft-persist"; label: string }
  | { id: "review-project-rules"; label: string }
  | { id: "retry-submit"; label: string }
  | { id: "resume-draft"; label: string }
  | { id: "resume-comment-edit"; label: string; commentId: string };
export type Toast = {
  title: string;
  message: string;
  tone: ToastTone;
  sticky?: boolean;
  dedupeKey?: string;
  disposition?: ToastDisposition;
  action?: ToastAction;
} | null;
export type StartupIssue = {
  title: string;
  message: string;
};
export type WorkspaceIssue = {
  title: string;
  message: string;
};
export type OpenedAiVersionNotice = {
  sourcePath: string;
  fileName: string;
  versionLabel: string;
  generatedAt: string;
};
export type WorkspaceFileView = {
  path: string;
  content: string;
  savedContent: string;
  loading: boolean;
  error?: string;
};
export type PendingWrite = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string | null;
  expectedSourceSha256: string | null;
  html: string;
  revision: number;
  events: DirectEditEvent[];
  historyOperations: SourceHistoryEntry[];
  recoveryIdentity: RecoveryIdentity | null;
};
export type RecoveryIdentity = {
  schemaVersion: "1.0.0";
  projectId: string;
  documentId: string;
  sourcePath: string;
  basedOnVersionId: string;
  sourceSha256: string;
  editRevision: number;
  token: string;
};
export type ProjectContext = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
};
export type PendingDraft = DraftSnapshot<CommentItem, DirectEditEvent>;
export type BackgroundProjectResult = {
  state: "processing" | "ready" | "no-change" | "error" | "conflict";
  label: string;
  updatedAt: number;
};
export type CloseReadiness =
  | { ready: true }
  | { ready: false; reason: string };
export type PrepareCloseDetail = {
  requestId: string;
  reason: string;
  deadlineAt: number;
  waitUntil: (readiness: Promise<CloseReadiness>) => void;
};
export type CloseAbortedDetail = {
  requestId: string;
  reason: string;
};
export type CloseLifecycle = {
  preparingRequestId: string | null;
  frozenRequestId: string | null;
  abortedRequestIds: Set<string>;
};
