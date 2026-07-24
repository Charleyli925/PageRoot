"use client";

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
} from "react";
import { ArrowCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowCounterClockwise";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/csr/ChatCircleText";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { FileHtmlIcon } from "@phosphor-icons/react/dist/csr/FileHtml";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { ImageIcon } from "@phosphor-icons/react/dist/csr/Image";
import { LockKeyIcon } from "@phosphor-icons/react/dist/csr/LockKey";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { SealCheckIcon } from "@phosphor-icons/react/dist/csr/SealCheck";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { TriangleIcon } from "@phosphor-icons/react/dist/csr/Triangle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import type {
  HtmlCanvasCommentLayoutState,
  HtmlCanvasEditorHandle,
  HtmlCanvasMutation,
  HtmlCanvasSelection,
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
} from "./components/HtmlCanvasEditor";
import HtmlInteractionPreview from "./components/HtmlInteractionPreview";
import NoticeBar from "./components/NoticeBar";
import { rebindCanvasSelectionTargets } from "./lib/canvas-target-rebind.js";
import {
  MAX_COMMENT_ATTACHMENTS,
  planAttachmentSelection,
} from "./lib/attachment-selection.js";
import {
  commentMarkerGroupKey,
  COMMENT_VIRTUALIZATION_THRESHOLD,
  MAX_COMMENT_COUNT,
  virtualizedCommentIds,
} from "./lib/comment-virtualization.js";
import {
  auditEventKey,
  removeAcknowledgedAuditEvents,
} from "./lib/audit-events";
import { reduceDirectEditHistory } from "./lib/direct-edit-history.js";
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
import { versionAuditCollections } from "./lib/version-audit-records";
import {
  canCloseDuringHydration,
  shouldRecoverEditorAfterCloseAbort,
} from "../desktop/close-recovery.mjs";

const HtmlCanvasEditor = lazy(() => import("./components/HtmlCanvasEditor"));

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

type HtmlProject = {
  path: string;
  sourcePath: string;
  name: string;
  html: string;
  sha256: string;
  lastModifiedAt?: string;
};

type RecentProject = {
  path: string;
  sourcePath: string;
  name: string;
  lastOpenedAt: number;
};

type DesktopProjectsApi = {
  getActiveProject: () => Promise<HtmlProject | null>;
  openHtml: () => Promise<HtmlProject | null>;
  showInFolder?: (sourcePath: string) => Promise<{ sourcePath: string }>;
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

type QoderHandoffResult = {
  status: "copied";
  copied: boolean;
  opened: boolean;
  pasted: boolean;
  reason: string | null;
};

type QoderHandoffUiStatus = "copying" | "copied" | "failed";

type ProjectQoderHandoffState = {
  sourcePath: string;
  requestId: string;
  attemptId: string;
  status: QoderHandoffUiStatus;
};

type DesktopIntegrationsApi = {
  handoffToQoderWork: (payload: {
    message: string;
  }) => Promise<QoderHandoffResult>;
};

type ManualUpdateStatus =
  | "available"
  | "current"
  | "unsupported"
  | "unavailable";

type ManualUpdateResult = {
  status: ManualUpdateStatus;
  currentVersion: string;
  latestVersion: string | null;
  minimumMacOS: string | null;
  architecture: string;
  publishedAt: string | null;
};

type DesktopUpdatesApi = {
  getStatus: () => Promise<ManualUpdateResult | null>;
  onStatus: (
    listener: (result: ManualUpdateResult | null) => void,
  ) => () => void;
  openLatestRelease: () => Promise<{ opened: boolean }>;
};

declare global {
  interface Window {
    htmlAIProjects?: DesktopProjectsApi;
    htmlAIIntegrations?: DesktopIntegrationsApi;
    htmlAIUpdates?: DesktopUpdatesApi;
    htmlAIRuntime?: {
      bridgePort: string;
      bridgeAuthToken: string;
      appVersion: string;
    };
  }
}

type CommentAttachment = {
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

type CommentItem = {
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

type DirectEditEvent = {
  eventId: string;
  createdAt: string;
  kind: "text" | "style" | "reorder" | "structure";
  target: HtmlCanvasSelection;
  property?: string;
  before: unknown;
  after: unknown;
  baseVersionId: string | null;
  capturedRevision?: number;
  historyId?: string;
  undoesEventId?: string;
  inherited?: boolean;
  inheritedFromVersionId?: string;
};

type Version = {
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
};

type UserSupplementAttachment = {
  attachmentId: string;
  fileName: string;
  mediaType: string;
  relativePath?: string;
  sha256?: string;
};

type UserSupplementRecord = {
  recordId: string;
  action: "add" | "amend" | "retract";
  text: string;
  createdAt: string;
  referenceId?: string;
  evidenceState: "text-only" | "original-file" | "description-only";
  evidenceDescription?: string;
  attachments: UserSupplementAttachment[];
};

type ValidationReview = {
  status: "pending" | "waived";
  hardViolationCodes: string[];
  softViolationCodes: string[];
  waiver?: {
    reason?: string;
    decidedAt?: string;
  };
};

type LifecycleState =
  | "editing"
  | "submitting"
  | "processing"
  | "validating"
  | "committing"
  | "awaiting-check-decision"
  | "ready-to-open"
  | "awaiting-conflict-resolution"
  | "recovering-transaction"
  | "ready"
  | "no-change"
  | "complete"
  | "cancelled"
  | "error";

type ActiveRun = {
  projectId: string;
  documentId: string;
  requestId: string;
  attemptId: string;
  requestPath: string;
  attemptPath: string;
  handoffMessage: string;
  status: LifecycleState;
  sourcePath: string;
  baseSnapshotSha256: string;
  previousVersionId: string | null;
  basedOnVersionId: string | null;
  freezeCutoffRevision: number;
  candidateVersionId: string;
  candidateVersionLabel: string;
  submittedAt: string;
  summary?: string;
  commentCount?: number;
  changeEventCount?: number;
  error?: string;
  conflictId?: string;
  externalSourceSha256?: string;
  candidateOutputSha256?: string;
  conflictDetectedAt?: string;
  readyPayload?: Record<string, unknown>;
  validationReview?: ValidationReview;
  scopeReport?: Record<string, unknown>;
};

type PersistState = "idle" | "preview-dirty" | "queued" | "writing" | "failed" | "conflict";
type ViewMode = "current" | "history";
type CanvasMode = "edit" | "preview";
type Drawer = "files" | "history" | "handoff" | null;
type ToastTone = "success" | "info" | "warning" | "error";
type ToastAction =
  | { id: "retry-export"; label: string }
  | { id: "open-handoff"; label: string }
  | { id: "open-project"; label: string; sourcePath: string }
  | { id: "retry-project-open"; label: string; sourcePath?: string }
  | { id: "show-project"; label: string; sourcePath?: string }
  | { id: "show-project-records"; label: string }
  | { id: "reveal-request"; label: string }
  | { id: "reveal-version"; label: string; versionId: string }
  | { id: "retry-source-diff"; label: string }
  | { id: "retry-ai-diff"; label: string }
  | { id: "retry-reload"; label: string }
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
  | { id: "retry-attachment-preview"; label: string; attachment: CommentAttachment }
  | { id: "retry-attachment-download"; label: string; attachment: CommentAttachment }
  | { id: "relink-target"; label: string; commentId: string }
  | { id: "resume-draft"; label: string }
  | { id: "retry-reconcile"; label: string }
  | { id: "relaunch-app"; label: string }
  | { id: "retry-cancel"; label: string }
  | { id: "open-release"; label: string };
type Toast = {
  title: string;
  message: string;
  tone: ToastTone;
  sticky?: boolean;
  dedupeKey?: string;
  action?: ToastAction;
} | null;
type StartupIssue = {
  title: string;
  message: string;
};
type WorkspaceIssue = {
  title: string;
  message: string;
};
type OpenedAiVersionNotice = {
  sourcePath: string;
  fileName: string;
  versionLabel: string;
  generatedAt: string;
};
type WorkspaceFileView = {
  path: string;
  content: string;
  savedContent: string;
  loading: boolean;
  error?: string;
};
type PendingWrite = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string | null;
  expectedSourceSha256: string | null;
  html: string;
  revision: number;
  events: DirectEditEvent[];
  recoveryIdentity: RecoveryIdentity | null;
};
type RecoveryIdentity = {
  schemaVersion: "1.0.0";
  projectId: string;
  documentId: string;
  sourcePath: string;
  basedOnVersionId: string;
  sourceSha256: string;
  editRevision: number;
  token: string;
};
type ProjectContext = {
  epoch: number;
  projectId: string;
  documentId: string;
  sourcePath: string;
};
type PendingDraft = ProjectContext & {
  basedOnVersionId: string | null;
  expectedDraftRevision: number;
  comments: CommentItem[];
  changeEvents: DirectEditEvent[];
};
type UndoDraftFold = {
  event: DirectEditEvent;
  eventId: string;
  previousEvent: DirectEditEvent | null;
  previousPendingEvent: DirectEditEvent | null;
};
type RedoDraftFold = {
  undoFold: UndoDraftFold;
  undoAuditEvent: DirectEditEvent | null;
};
type CloseReadiness =
  | { ready: true }
  | { ready: false; reason: string };
type PrepareCloseDetail = {
  requestId: string;
  reason: string;
  deadlineAt: number;
  waitUntil: (readiness: Promise<CloseReadiness>) => void;
};
type CloseAbortedDetail = {
  requestId: string;
  reason: string;
};

const bridgePort =
  typeof window === "undefined"
    ? "4317"
    : window.htmlAIRuntime?.bridgePort
      || new URLSearchParams(window.location.search).get("bridgePort")
      || "4317";
const bridgeAuthToken =
  typeof window === "undefined"
    ? ""
    : window.htmlAIRuntime?.bridgeAuthToken
      || new URLSearchParams(window.location.search).get("bridgeAuthToken")
      || "";
const BRIDGE_URL = `http://127.0.0.1:${bridgePort}`;
const AUTOSAVE_DELAY_MS = 700;
const BRIDGE_STATE_READ_TIMEOUT_MS = 15_000;
const BRIDGE_WRITE_TIMEOUT_MS = 15_000;
const BRIDGE_REQUEST_TIMEOUT_MS = 60_000;
const BRIDGE_ATTACHMENT_TIMEOUT_MS = 30_000;

function bridgeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = BRIDGE_STATE_READ_TIMEOUT_MS,
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (bridgeAuthToken) headers.set("x-html-ai-bridge-token", bridgeAuthToken);
  const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
  const signal = timeoutSignal && init.signal
    ? AbortSignal.any([init.signal, timeoutSignal])
    : timeoutSignal || init.signal;
  return fetch(input, { ...init, headers, signal });
}

const WELCOME_PROJECT = {
  name: WELCOME_PROJECT_NAME,
  sourcePath: null as string | null,
};

function fileStem(name: string): string {
  return name.replace(/\.html?$/i, "") || "未命名页面";
}

function comparableLocalSourcePath(sourcePath: string | null | undefined): string {
  if (!sourcePath) return "";
  if (sourcePath === "/private/var" || sourcePath.startsWith("/private/var/")) {
    return sourcePath.slice("/private".length);
  }
  if (sourcePath === "/private/tmp" || sourcePath.startsWith("/private/tmp/")) {
    return sourcePath.slice("/private".length);
  }
  return sourcePath;
}

function sameLocalSourcePath(
  left: string | null | undefined,
  right: string | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && comparableLocalSourcePath(left) === comparableLocalSourcePath(right),
  );
}

function folderFromSourcePath(sourcePath: string | null): string {
  if (!sourcePath) return "尚未打开本地文件";
  const separatorIndex = Math.max(
    sourcePath.lastIndexOf("/"),
    sourcePath.lastIndexOf("\\"),
  );
  if (separatorIndex < 0) return sourcePath;
  return separatorIndex === 0 ? sourcePath.slice(0, 1) : sourcePath.slice(0, separatorIndex);
}

function safeVersionLabel(versionId: string): string {
  const match = versionId.match(/(\d+)$/);
  return match ? `版本 ${Number(match[1])}` : versionId;
}

function isGlobalPageTarget(target: HtmlCanvasSelection): boolean {
  return target.tagName === "body"
    && target.selector === "body"
    && target.level === "module";
}

function exactGlobalPageTarget(target: HtmlCanvasSelection): HtmlCanvasSelection {
  return {
    ...target,
    label: "整个页面",
    selector: "body",
    level: "module",
    tagName: "body",
    text: "",
    resolution: "exact",
  };
}

function rebindTargetsPreservingGlobal(
  nextHtml: string,
  targets: HtmlCanvasSelection[],
): HtmlCanvasSelection[] {
  const localTargets = targets.filter((target) => (
    !isGlobalPageTarget(target) && canLocateTarget(target)
  ));
  const reboundById = new Map(
    rebindCanvasSelectionTargets(nextHtml, localTargets)
      .map((target) => [target.id, target]),
  );
  return targets.map((target) => (
    isGlobalPageTarget(target)
      ? exactGlobalPageTarget(target)
      : canLocateTarget(target)
        ? reboundById.get(target.id) || target
        : target
  ));
}

function displayVersionLabel(ordinal: number): string {
  return Number.isSafeInteger(ordinal) && ordinal > 0
    ? `版本 ${ordinal}`
    : "下一版";
}

function fileNameFromSourcePath(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) || "新版本.html";
}

function activeRunOperationKey(run: Pick<
  ActiveRun,
  "sourcePath" | "requestId" | "attemptId"
>): string {
  return `${run.sourcePath}\n${run.requestId}\n${run.attemptId}`;
}

function workspaceFileLabel(relativePath: string): string {
  if (relativePath === "PROJECT.md") return "项目规则";
  if (relativePath === "runtime-state.json") return "运行状态";
  if (relativePath === "edit-audit.jsonl") return "编辑记录";
  if (relativePath.endsWith("/PROMPT.md")) return "本轮 Prompt";
  if (relativePath.endsWith("/change-request.json")) return "本轮修改要求";
  if (relativePath.endsWith("/input/AI_RULES.md")) return "本轮 AI 规则";
  return "项目记录";
}

function formatTime(value: unknown, includeSeconds = false): string {
  if (typeof value !== "string" || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(includeSeconds ? { second: "2-digit" } : {}),
    hour12: false,
  }).format(date);
}

function formatProjectTimestamp(value: unknown): string {
  if ((typeof value !== "string" && typeof value !== "number") || !value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  const startOfToday = Date.UTC(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfDate = Date.UTC(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const dayDifference = Math.round(
    (startOfToday - startOfDate) / (24 * 60 * 60 * 1000),
  );
  const time = new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
  if (dayDifference === 0) return `今天 ${time}`;
  if (dayDifference === 1) return `昨天 ${time}`;
  if (dayDifference === -1) return `明天 ${time}`;
  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日`;
  }
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`;
}

function shortHash(hash: string): string {
  return hash.replace(/^sha256:/, "").slice(0, 10);
}

function recordId(
  prefix: "comment" | "change" | "attachment",
  counter: number,
): string {
  return `${prefix}_${Date.now().toString(36)}_${String(counter).padStart(4, "0")}`;
}

function independentCommentTarget(
  target: HtmlCanvasSelection,
  commentId: string,
): HtmlCanvasSelection {
  const safeCommentId = commentId.replace(/[^A-Za-z0-9_-]/gu, "_")
    || "comment_unknown";
  return {
    ...target,
    id: `target_${safeCommentId}`,
  };
}

function persistedAttachment(attachment: CommentAttachment): CommentAttachment {
  return {
    attachmentId: attachment.attachmentId,
    kind: attachment.kind,
    fileName: attachment.fileName,
    mediaType: attachment.mediaType,
    byteLength: attachment.byteLength,
    sha256: attachment.sha256,
    relativePath: attachment.relativePath,
    ...(attachment.requestRelativePath
      ? { requestRelativePath: attachment.requestRelativePath }
      : {}),
    ...(attachment.source ? { source: attachment.source } : {}),
  };
}

function attachmentFromRecord(value: unknown): CommentAttachment | null {
  if (!isRecord(value)) return null;
  const attachmentId = String(value.attachmentId || "");
  const fileName = String(value.fileName || "");
  const relativePath = String(value.relativePath || "");
  const sha256 = String(value.sha256 || "");
  const byteLength = Number(value.byteLength || 0);
  if (
    !/^attachment_[A-Za-z0-9_-]+$/.test(attachmentId)
    || !fileName
    || !relativePath
    || !/^sha256:[a-f0-9]{64}$/.test(sha256)
    || !Number.isSafeInteger(byteLength)
    || byteLength <= 0
  ) return null;
  return {
    attachmentId,
    kind: value.kind === "image" ? "image" : "file",
    fileName,
    mediaType: String(value.mediaType || "application/octet-stream"),
    byteLength,
    sha256,
    relativePath,
    ...(value.requestRelativePath
      ? { requestRelativePath: String(value.requestRelativePath) }
      : {}),
    ...(value.source === "clipboard" || value.source === "file-picker"
      ? { source: value.source }
      : {}),
  };
}

function commentHasContent(comment: Pick<CommentItem, "text" | "attachments">): boolean {
  return Boolean(comment.text.trim() || comment.attachments?.length);
}

function formatFileSize(byteLength: number): string {
  if (byteLength < 1024) return `${byteLength} B`;
  if (byteLength < 1024 * 1024) return `${Math.ceil(byteLength / 1024)} KB`;
  return `${(byteLength / (1024 * 1024)).toFixed(byteLength < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function fileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("无法读取附件。"));
    reader.onload = () => {
      const result = String(reader.result || "");
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("附件读取结果无效。"));
      else resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(file);
  });
}

function isImageFile(file: File): boolean {
  return file.type.startsWith("image/")
    || /\.(?:avif|bmp|gif|heic|heif|jpe?g|png|svg|webp)$/i.test(file.name);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function recoveryIdentityFromRecord(value: unknown): RecoveryIdentity | null {
  if (!isRecord(value)) return null;
  const identity = {
    schemaVersion: String(value.schemaVersion || ""),
    projectId: String(value.projectId || ""),
    documentId: String(value.documentId || ""),
    sourcePath: String(value.sourcePath || ""),
    basedOnVersionId: String(value.basedOnVersionId || ""),
    sourceSha256: String(value.sourceSha256 || ""),
    editRevision: Number(value.editRevision),
    token: String(value.token || ""),
  };
  if (
    identity.schemaVersion !== "1.0.0"
    || !identity.projectId
    || !identity.documentId
    || !identity.sourcePath
    || !identity.basedOnVersionId
    || !/^sha256:[a-f0-9]{64}$/u.test(identity.sourceSha256)
    || !Number.isSafeInteger(identity.editRevision)
    || identity.editRevision < 0
    || !/^sha256:[a-f0-9]{64}$/u.test(identity.token)
  ) return null;
  return identity as RecoveryIdentity;
}

function selectionFromRecord(raw: unknown): HtmlCanvasSelection {
  const item = isRecord(raw) ? raw : {};
  const selector = String(
    item.selector
    || "",
  );
  const levelValue = String(item.level || "part");
  const resolutionValue = String(item.resolution || "");
  const resolution = (
    ["exact", "rebound", "ambiguous", "orphaned"].includes(resolutionValue)
      ? resolutionValue
      : "orphaned"
  ) as HtmlCanvasSelection["resolution"];
  return {
    id: String(item.targetId || ""),
    label: String(item.label || selector || "页面内容"),
    selector,
    level: levelValue === "module"
      ? "module"
      : levelValue === "insertion" || levelValue === "insertion-point"
        ? "insertion"
        : "part",
    tagName: isRecord(item.fingerprint)
      ? String(item.fingerprint.tagName || "")
      : levelValue === "insertion" || levelValue === "insertion-point"
        ? "insertion"
        : "",
    text: String(item.textQuote || ""),
    resolution,
    ...(item.textQuote ? { textQuote: String(item.textQuote) } : {}),
    ...(isRecord(item.sourceAnchor)
      ? {
          sourceAnchor: {
            startOffset: Number(item.sourceAnchor.startOffset || 0),
            endOffset: Number(item.sourceAnchor.endOffset || 0),
            sourceSha256: String(item.sourceAnchor.sourceSha256 || ""),
          },
        }
      : {}),
    ...(isRecord(item.fingerprint)
      ? {
          fingerprint: {
            tagName: String(item.fingerprint.tagName || ""),
            stableAttributes: isRecord(item.fingerprint.stableAttributes)
              ? Object.fromEntries(
                  Object.entries(item.fingerprint.stableAttributes).map(([key, value]) => [
                    key,
                    String(value),
                  ]),
                )
              : {},
            ancestorFingerprint: Array.isArray(item.fingerprint.ancestorFingerprint)
              ? item.fingerprint.ancestorFingerprint.map(String)
              : [],
            ...(item.fingerprint.textPrefix
              ? { textPrefix: String(item.fingerprint.textPrefix) }
              : {}),
            ...(item.fingerprint.textSuffix
              ? { textSuffix: String(item.fingerprint.textSuffix) }
              : {}),
          },
        }
      : {}),
  };
}

type PersistedTargetRef = {
  targetId: string;
  label: string;
  level: "module" | "subregion" | "insertion-point";
  selector: string;
  textQuote?: string;
  sourceAnchor?: HtmlCanvasSelection["sourceAnchor"];
  fingerprint?: HtmlCanvasSelection["fingerprint"];
  resolution: HtmlCanvasSelection["resolution"];
};

function persistedTargetRef(target: HtmlCanvasSelection): PersistedTargetRef {
  return {
    targetId: target.id,
    label: target.level === "insertion"
      ? (
          target.label.includes("添加内容")
            ? target.label
            : `${target.label.replace(/[。；;，,\s]+$/u, "")}添加内容`
        )
      : target.label,
    level: target.level === "part"
      ? "subregion"
      : target.level === "insertion"
        ? "insertion-point"
        : "module",
    selector: target.selector,
    ...(target.textQuote !== undefined ? { textQuote: target.textQuote } : {}),
    ...(target.sourceAnchor ? { sourceAnchor: { ...target.sourceAnchor } } : {}),
    ...(target.fingerprint
      ? {
          fingerprint: {
            ...target.fingerprint,
            stableAttributes: { ...target.fingerprint.stableAttributes },
            ancestorFingerprint: [...target.fingerprint.ancestorFingerprint],
          },
        }
      : {}),
    resolution: target.resolution,
  };
}

function persistedComment(comment: CommentItem) {
  return {
    ...comment,
    ...(comment.attachments?.length
      ? { attachments: comment.attachments.map(persistedAttachment) }
      : {}),
    target: persistedTargetRef(comment.target),
  };
}

function persistedChangeEvent(event: DirectEditEvent) {
  return {
    ...event,
    target: persistedTargetRef(event.target),
  };
}

function commentsFromRecords(raw: unknown): CommentItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const createdAt = String(value.createdAt || "");
    const commentId = String(
      value.commentId || value.id || `comment_unknown_${index + 1}`,
    );
    return [{
      commentId,
      createdAt,
      updatedAt: String(value.updatedAt || createdAt),
      target: independentCommentTarget(
        selectionFromRecord(value.target || value),
        commentId,
      ),
      text: String(value.text || ""),
      ...(Array.isArray(value.attachments)
        ? {
            attachments: value.attachments
              .map(attachmentFromRecord)
              .filter((item): item is CommentAttachment => Boolean(item)),
          }
        : {}),
      baseVersionId: value.baseVersionId ? String(value.baseVersionId) : null,
      ...(value.requestId ? { requestId: String(value.requestId) } : {}),
      ...(value.attemptId ? { attemptId: String(value.attemptId) } : {}),
      ...(value.resultVersionId ? { resultVersionId: String(value.resultVersionId) } : {}),
    }];
  });
}

function changesFromRecords(raw: unknown): DirectEditEvent[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value, index) => {
    if (!isRecord(value)) return [];
    const kind = String(value.kind || "");
    if (!["text", "style", "reorder", "structure"].includes(kind)) return [];
    return [{
      eventId: String(value.eventId || value.id || `change_unknown_${index + 1}`),
      createdAt: String(value.createdAt || ""),
      kind: kind as DirectEditEvent["kind"],
      target: selectionFromRecord(value.target || value),
      ...(value.property ? { property: String(value.property) } : {}),
      before: value.before,
      after: value.after,
      baseVersionId: value.baseVersionId || value.basedOnVersionId
        ? String(value.baseVersionId || value.basedOnVersionId)
        : null,
      ...(Number.isFinite(Number(value.capturedRevision ?? value.revision))
        ? {
            capturedRevision: Number(
              value.capturedRevision ?? value.revision,
            ),
          }
        : {}),
      ...(value.historyId ? { historyId: String(value.historyId) } : {}),
      ...(value.undoesEventId ? { undoesEventId: String(value.undoesEventId) } : {}),
      ...(value.inherited === true ? { inherited: true } : {}),
      ...(value.inheritedFromVersionId
        ? { inheritedFromVersionId: String(value.inheritedFromVersionId) }
        : {}),
    }];
  });
}

function supplementsFromRecords(raw: unknown): UserSupplementRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    if (!isRecord(value)) return [];
    const action = String(value.action || "");
    const evidenceState = String(value.evidenceState || "text-only");
    if (!(["add", "amend", "retract"] as const).includes(
      action as "add" | "amend" | "retract",
    )) return [];
    if (!(["text-only", "original-file", "description-only"] as const).includes(
      evidenceState as "text-only" | "original-file" | "description-only",
    )) return [];
    const attachments = Array.isArray(value.attachments)
      ? value.attachments.flatMap((attachment) => {
          if (!isRecord(attachment)) return [];
          return [{
            attachmentId: String(attachment.attachmentId || ""),
            fileName: String(attachment.fileName || "附件"),
            mediaType: String(attachment.mediaType || "application/octet-stream"),
            ...(attachment.relativePath
              ? { relativePath: String(attachment.relativePath) }
              : {}),
            ...(attachment.sha256 ? { sha256: String(attachment.sha256) } : {}),
          }];
        })
      : [];
    const refersTo = Array.isArray(value.refersTo)
      ? value.refersTo.map(String).filter(Boolean)
      : [];
    return [{
      recordId: String(value.recordId || ""),
      action: action as UserSupplementRecord["action"],
      text: String(value.userText || ""),
      createdAt: String(value.recordedAt || ""),
      ...(refersTo[0] ? { referenceId: refersTo[0] } : {}),
      evidenceState: evidenceState as UserSupplementRecord["evidenceState"],
      ...(value.evidenceDescription
        ? { evidenceDescription: String(value.evidenceDescription) }
        : {}),
      attachments,
    }];
  });
}

function validationReviewFromRecord(raw: unknown): ValidationReview | null {
  if (!isRecord(raw)) return null;
  const status = String(raw.status || "");
  if (status !== "pending" && status !== "waived") return null;
  const waiver = isRecord(raw.waiver) ? raw.waiver : null;
  return {
    status,
    hardViolationCodes: Array.isArray(raw.hardViolationCodes)
      ? raw.hardViolationCodes.map(String)
      : [],
    softViolationCodes: Array.isArray(raw.softViolationCodes)
      ? raw.softViolationCodes.map(String)
      : [],
    ...(waiver
      ? {
          waiver: {
            ...(waiver.reason ? { reason: String(waiver.reason) } : {}),
            ...(waiver.decidedAt ? { decidedAt: String(waiver.decidedAt) } : {}),
          },
        }
      : {}),
  };
}

function versionsFromWorkspace(payload: Record<string, unknown>): Version[] {
  if (!Array.isArray(payload.versions)) return [];
  return payload.versions.flatMap((raw) => {
    if (!isRecord(raw)) return [];
    if (!isRecord(raw.manifest) || raw.manifest.schemaVersion !== "3.0.0") return [];
    const manifest = raw.manifest;
    const id = String(manifest.versionId || "");
    if (!id) return [];
    const sourceType = String(manifest.sourceType || "");
    if (sourceType !== "initial" && sourceType !== "internal-ai") return [];
    const auditCollections = versionAuditCollections(raw);
    return [{
      id,
      ordinal: Number(manifest.versionOrdinal),
      label: displayVersionLabel(Number(manifest.versionOrdinal)),
      summary: String(manifest.summary),
      generatedAt: String(manifest.generatedAt),
      source: (
        sourceType === "internal-ai" ? "内部 AI" : "初始页面"
      ) as Version["source"],
      contentSha256: String(manifest.contentSha256 || raw.contentSha256 || ""),
      previousVersionId: manifest.previousVersionId ? String(manifest.previousVersionId) : null,
      basedOnVersionId: manifest.basedOnVersionId ? String(manifest.basedOnVersionId) : null,
      requestId: manifest.requestId ? String(manifest.requestId) : null,
      attemptId: manifest.attemptId ? String(manifest.attemptId) : null,
      committed: raw.committed !== false,
      comments: commentsFromRecords(auditCollections.comments).map((comment) => ({
        ...comment,
        ...(manifest.requestId && !comment.requestId
          ? { requestId: String(manifest.requestId) }
          : {}),
        ...(manifest.attemptId && !comment.attemptId
          ? { attemptId: String(manifest.attemptId) }
          : {}),
        resultVersionId: id,
      })),
      directEdits: changesFromRecords(auditCollections.editEvents),
      supplements: supplementsFromRecords(raw.supplements),
      validationReview: validationReviewFromRecord(raw.validationReview),
    }];
  }).sort((a, b) => b.ordinal - a.ordinal);
}

function activeRunFromRecord(raw: unknown): ActiveRun | null {
  if (!isRecord(raw)) return null;
  const conflict = isRecord(raw.conflict) ? raw.conflict : raw;
  const requestId = String(raw.requestId || "");
  if (!requestId) return null;
  const rawStatus = String(raw.status || raw.lifecycleState || "processing");
  const statusValue = (
    rawStatus === "waiting" || rawStatus === "ready"
      ? "processing"
      : rawStatus === "importing" || rawStatus === "result-ready"
        ? "validating"
        : rawStatus === "version-created" || rawStatus === "completed"
          ? "complete"
          : rawStatus === "canceled"
            ? "cancelled"
            : rawStatus
  );
  const allowed: LifecycleState[] = [
    "editing", "submitting", "processing", "validating", "committing",
    "awaiting-check-decision", "ready-to-open",
    "awaiting-conflict-resolution", "recovering-transaction", "ready",
    "no-change", "complete", "cancelled", "error",
  ];
  return {
    projectId: String(raw.projectId || ""),
    documentId: String(raw.documentId || ""),
    requestId,
    attemptId: String(raw.attemptId || "attempt_001"),
    requestPath: String(raw.requestPath || ""),
    attemptPath: String(raw.attemptPath || ""),
    handoffMessage: String(raw.handoffMessage || ""),
    status: allowed.includes(statusValue as LifecycleState)
      ? statusValue as LifecycleState
      : "processing",
    sourcePath: String(raw.sourcePath || ""),
    baseSnapshotSha256: String(raw.baseSnapshotSha256 || raw.sourceSha256 || ""),
    previousVersionId: raw.previousVersionId ? String(raw.previousVersionId) : null,
    basedOnVersionId: raw.basedOnVersionId ? String(raw.basedOnVersionId) : null,
    freezeCutoffRevision: Number(raw.freezeCutoffRevision || 0),
    candidateVersionId: String(raw.candidateVersionId || ""),
    candidateVersionLabel: String(
      raw.candidateDisplayVersionLabel
      || (
        Number.isSafeInteger(Number(raw.candidateVersionOrdinal))
        && Number(raw.candidateVersionOrdinal) > 0
          ? displayVersionLabel(Number(raw.candidateVersionOrdinal))
          : null
      )
      || raw.candidateVersionLabel
      || (raw.candidateVersionId ? safeVersionLabel(String(raw.candidateVersionId)) : "下一版"),
    ),
    submittedAt: String(raw.submittedAt || ""),
    ...(raw.summary ? { summary: String(raw.summary) } : {}),
    ...(Number.isFinite(Number(raw.commentCount)) ? { commentCount: Number(raw.commentCount) } : {}),
    ...(Number.isFinite(Number(raw.changeEventCount))
      ? { changeEventCount: Number(raw.changeEventCount) }
      : {}),
    ...(raw.error
      ? { error: isRecord(raw.error) ? String(raw.error.message || "") : String(raw.error) }
      : {}),
    ...(raw.conflictId || conflict.conflictId
      ? { conflictId: String(raw.conflictId || conflict.conflictId) }
      : {}),
    ...(conflict.externalSourceSha256
      ? { externalSourceSha256: String(conflict.externalSourceSha256) }
      : {}),
    ...(conflict.candidateOutputSha256 || conflict.candidateSha256
      ? {
          candidateOutputSha256: String(
            conflict.candidateOutputSha256 || conflict.candidateSha256,
          ),
        }
      : {}),
    ...(conflict.detectedAt
      ? { conflictDetectedAt: String(conflict.detectedAt) }
      : {}),
  };
}

async function readJsonResponse(response: Response): Promise<Record<string, unknown>> {
  const payload = await response.json().catch(() => ({}));
  return isRecord(payload) ? payload : {};
}

function responseError(payload: Record<string, unknown>, fallback: string): Error & { code?: string } {
  const raw = isRecord(payload.error) ? payload.error : {};
  const error = new Error(String(raw.message || payload.message || fallback)) as Error & { code?: string };
  error.code = String(raw.code || payload.code || "");
  return error;
}

async function copyText(value: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to a temporary textarea when clipboard permission is unavailable.
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  try {
    textarea.select();
    if (!document.execCommand("copy")) {
      throw new Error("浏览器没有确认剪贴板写入成功。");
    }
  } finally {
    textarea.remove();
  }
}

async function browserSha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${[...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function projectMarkdown(name: string): string {
  return `# ${fileStem(name)}\n\n- 入口文件：${name}\n- 默认延续当前页面的视觉语言、组件样式和响应式行为。\n- 在这里补充页面用途、长期风格和需要跨轮次持续遵循的约束。\n`;
}

function downloadHtml(html: string, name: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.endsWith(".html") || name.endsWith(".htm") ? name : `${name}.html`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function uniqueTargets(comments: CommentItem[]): HtmlCanvasSelection[] {
  const seen = new Set<string>();
  return comments.flatMap((comment) => {
    if (seen.has(comment.target.id)) return [];
    seen.add(comment.target.id);
    return [comment.target];
  });
}

function insertionLabel(target: HtmlCanvasSelection): string {
  const label = persistedTargetRef(target).label;
  return target.level === "insertion" ? `添加位置：${label}` : label;
}

function targetResolutionLabel(resolution: HtmlCanvasSelection["resolution"]): string {
  if (resolution === "exact") return "精确定位";
  if (resolution === "rebound") return "已唯一重绑";
  if (resolution === "ambiguous") return "多个候选，已阻止定位";
  return "目标已失联";
}

function canLocateTarget(target: HtmlCanvasSelection): boolean {
  return target.resolution === "exact" || target.resolution === "rebound";
}

function changeKindLabel(event: DirectEditEvent): string {
  if (event.kind === "text") return "文字修改";
  if (event.kind === "reorder") return "位置移动";
  if (event.kind === "structure") return "结构调整";
  const labels: Record<string, string> = {
    fontSize: "字号",
    color: "文字颜色",
    backgroundColor: "模块填充",
    fontWeight: "加粗",
    fontStyle: "斜体",
    padding: "内边距",
    margin: "外间距",
    lineHeight: "行距",
  };
  return labels[event.property || ""] || "样式调整";
}

function compactHistoryText(value: unknown): string {
  if (value === null || value === undefined || value === "") return "未设置";
  const text = String(value).replace(/\s+/g, " ").trim();
  return text.length > 72 ? `${text.slice(0, 72)}…` : text;
}

function recordValueScalar(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.sourceValue !== null && value.sourceValue !== undefined && value.sourceValue !== "") {
    return value.sourceValue;
  }
  if (value.computedValue !== null && value.computedValue !== undefined && value.computedValue !== "") {
    return value.computedValue;
  }
  return value.value ?? value.index ?? value.toIndex ?? value.fromIndex ?? null;
}

function friendlyStyleValue(property: string | undefined, value: unknown): string {
  const scalar = recordValueScalar(value);
  const normalized = String(scalar ?? "").trim().toLowerCase();
  if (!normalized) return "未设置";
  if (property === "fontWeight") {
    const numeric = Number.parseInt(normalized, 10);
    if (normalized === "bold" || Number.isFinite(numeric) && numeric >= 600) return "加粗";
    if (normalized === "normal" || Number.isFinite(numeric) && numeric < 600) return "常规";
  }
  if (property === "fontStyle") {
    if (normalized === "italic" || normalized === "oblique") return "斜体";
    if (normalized === "normal") return "常规";
  }
  if (property === "backgroundColor" && ["transparent", "rgba(0, 0, 0, 0)"].includes(normalized)) {
    return "透明";
  }
  return compactHistoryText(scalar);
}

function historyRecordValue(
  event: DirectEditEvent,
  value: unknown,
): string {
  if (event.kind === "reorder" && isRecord(value)) {
    const index = Number(value.index ?? value.toIndex ?? value.fromIndex);
    return Number.isFinite(index) ? `第 ${index + 1} 位` : "原位置";
  }
  if (event.kind === "text") {
    const text = compactHistoryText(value);
    return text === "未设置" ? text : `“${text}”`;
  }
  if (event.kind === "style") return friendlyStyleValue(event.property, value);
  return compactHistoryText(recordValueScalar(value));
}

function summarizeChangeEvents(events: DirectEditEvent[]): DirectEditEvent[] {
  const summaries = new Map<string, DirectEditEvent>();
  for (const event of events) {
    const key = [
      event.target.id || event.target.selector,
      event.kind,
      event.property || "",
    ].join("::");
    const existing = summaries.get(key);
    summaries.set(key, existing
      ? {
          ...event,
          eventId: existing.eventId,
          before: existing.before,
          createdAt: event.createdAt,
        }
      : event);
  }
  return [...summaries.values()];
}

function compactLineDiff(workbenchHtml: string, externalHtml: string): string {
  const localLines = workbenchHtml.split(/\r?\n/);
  const externalLines = externalHtml.split(/\r?\n/);
  let start = 0;
  while (
    start < localLines.length
    && start < externalLines.length
    && localLines[start] === externalLines[start]
  ) start += 1;
  let localEnd = localLines.length - 1;
  let externalEnd = externalLines.length - 1;
  while (
    localEnd >= start
    && externalEnd >= start
    && localLines[localEnd] === externalLines[externalEnd]
  ) {
    localEnd -= 1;
    externalEnd -= 1;
  }
  const contextStart = Math.max(0, start - 3);
  const contextEnd = Math.min(
    Math.max(localEnd, externalEnd) + 4,
    Math.max(localLines.length, externalLines.length),
  );
  const lines = [
    "# 当前工作台编辑（尚未覆盖外部文件）",
    ...localLines.slice(contextStart, Math.min(contextEnd, localLines.length)).map((line, index) =>
      `${contextStart + index < start || contextStart + index > localEnd ? " " : "-"} ${line}`
    ),
    "",
    "# 磁盘上的外部文件",
    ...externalLines.slice(contextStart, Math.min(contextEnd, externalLines.length)).map((line, index) =>
      `${contextStart + index < start || contextStart + index > externalEnd ? " " : "+"} ${line}`
    ),
  ];
  if (contextEnd < Math.max(localLines.length, externalLines.length)) {
    lines.push("", "… 仅显示首个变化区域附近内容；导出当前编辑可保留完整工作台版本。");
  }
  return lines.join("\n");
}

function isLockedLifecycle(state: LifecycleState | undefined): boolean {
  return Boolean(state && [
    "submitting",
    "processing",
    "validating",
    "committing",
    "awaiting-check-decision",
    "ready-to-open",
    "awaiting-conflict-resolution",
    "recovering-transaction",
  ].includes(state));
}

function noticeReducer(current: Toast, next: Toast): Toast {
  if (!shouldPresentNotice(next)) return current;
  return shouldReplaceNotice(current, next) ? next : current;
}

function CommentAttachmentStrip({
  attachments,
  objectUrls,
  editable = false,
  onEnsurePreview,
  onPreview,
  onDownload,
  onRemove,
}: {
  attachments?: CommentAttachment[];
  objectUrls: Record<string, string>;
  editable?: boolean;
  onEnsurePreview?: (
    attachment: CommentAttachment,
  ) => Promise<string> | void;
  onPreview: (attachment: CommentAttachment) => void;
  onDownload: (attachment: CommentAttachment) => void;
  onRemove?: (attachment: CommentAttachment) => void;
}) {
  useEffect(() => {
    if (!onEnsurePreview) return;
    for (const attachment of attachments ?? []) {
      if (
        attachment.kind !== "image"
        || objectUrls[attachment.attachmentId]
      ) continue;
      void Promise.resolve(onEnsurePreview(attachment)).catch(() => {});
    }
  }, [attachments, objectUrls, onEnsurePreview]);

  if (!attachments?.length) return null;
  return (
    <div className="comment-attachments" aria-label={`${attachments.length} 个附件`}>
      {attachments.map((attachment) => (
        attachment.kind === "image" ? (
          <div className="image-attachment" key={attachment.attachmentId}>
            <button
              className="image-attachment-preview"
              type="button"
              title={`预览 ${attachment.fileName}`}
              aria-label={`预览图片 ${attachment.fileName}`}
              onClick={(event) => {
                event.stopPropagation();
                onPreview(attachment);
              }}
            >
              {objectUrls[attachment.attachmentId] ? (
                // Blob URLs are project-local attachment previews and cannot use next/image.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={objectUrls[attachment.attachmentId]}
                  alt={attachment.fileName}
                />
              ) : (
                <span className="attachment-loading">读取中…</span>
              )}
              <span className="image-attachment-name">{attachment.fileName}</span>
            </button>
            {editable && onRemove ? (
              <button
                className="remove-attachment-button"
                type="button"
                title="移除图片"
                aria-label={`移除图片 ${attachment.fileName}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(attachment);
                }}
              >
                <XIcon aria-hidden="true" size={11} weight="bold" />
              </button>
            ) : null}
          </div>
        ) : (
          <div className="file-attachment" key={attachment.attachmentId}>
            <button
              className="file-attachment-open"
              type="button"
              title={`下载 ${attachment.fileName}`}
              onClick={(event) => {
                event.stopPropagation();
                onDownload(attachment);
              }}
            >
              <FileIcon aria-hidden="true" size={15} weight="regular" />
              <span>
                <strong>{attachment.fileName}</strong>
                <small>{formatFileSize(attachment.byteLength)}</small>
              </span>
            </button>
            {editable && onRemove ? (
              <button
                className="remove-file-attachment-button"
                type="button"
                title="移除文件"
                aria-label={`移除文件 ${attachment.fileName}`}
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(attachment);
                }}
              >
                <XIcon aria-hidden="true" size={11} weight="bold" />
              </button>
            ) : null}
          </div>
        )
      ))}
    </div>
  );
}

export default function Workbench() {
  const editorRef = useRef<HtmlCanvasEditorHandle>(null);
  const deferredEditorReplayRef = useRef<{
    refreshWorkspace?: (
      sourceOverride: string | null | undefined,
      epochOverride: number | undefined,
      sourceTransitionToken: number | undefined,
      resolve: () => void,
    ) => void;
    prepareProjectSwitch?: (resolve: (value: boolean) => void) => void;
    exportCurrentHtml?: () => void;
    reloadCurrentSource?: () => void;
    requestUserFlush?: () => void;
    generateRequest?: () => void;
    openCommittedVersion?: (
      run: ActiveRun,
      payload: Record<string, unknown>,
      resolve: () => void,
      reject: (reason: unknown) => void,
    ) => void;
    viewHistoryVersion?: (version: Version) => void;
    returnToCurrent?: () => void;
    restoreVersion?: (version: Version) => void;
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
    // freezeNow owns the complete History Fence: it checkpoints the source
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
  const commentEditRef = useRef<HTMLTextAreaElement>(null);
  const commentsPanelRef = useRef<HTMLElement>(null);
  const reviewStageRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const projectSwitcherRef = useRef<HTMLButtonElement>(null);
  const commentCounter = useRef(1);
  const changeCounter = useRef(1);
  const attachmentCounter = useRef(1);
  const focusedCommentIdRef = useRef<string | null>(null);
  const reviewRevealRequestRef = useRef(0);
  const projectEpochRef = useRef(0);
  const projectOpenRequestRef = useRef(0);
  const htmlRef = useRef(DEFAULT_PROJECT_HTML);
  const sourcePathRef = useRef<string | null>(null);
  const sourceShaRef = useRef<string | null>(null);
  const recoveryIdentityRef = useRef<RecoveryIdentity | null>(null);
  const projectIdRef = useRef("");
  const documentIdRef = useRef("");
  const projectLockedRef = useRef(false);
  const projectHydratingRef = useRef(false);
  const projectLoadErrorRef = useRef<string | null>(null);
  const viewTransitioningRef = useRef(false);
  const navigationOperationRef = useRef(0);
  const submissionPendingRef = useRef(false);
  const editRevisionRef = useRef(0);
  const lastPersistedRevisionRef = useRef(0);
  const persistStateRef = useRef<PersistState>("idle");
  const pendingWriteRef = useRef<PendingWrite | null>(null);
  const flushPromiseRef = useRef<Promise<boolean> | null>(null);
  const autosaveTimerRef = useRef<number | null>(null);
  const changeEventsRef = useRef<DirectEditEvent[]>([]);
  const auditPendingRef = useRef<DirectEditEvent[]>([]);
  const auditInFlightKeysRef = useRef<Set<string>>(new Set());
  const undoDraftFoldsRef = useRef<Map<string, UndoDraftFold>>(new Map());
  const redoDraftFoldsRef = useRef<Map<string, RedoDraftFold>>(new Map());
  const commentsRef = useRef<CommentItem[]>([]);
  const deletedCommentIdsRef = useRef<Set<string>>(new Set());
  const composerDraftRef = useRef("");
  const composerCommentIdRef = useRef<string | null>(null);
  const composerAttachmentsRef = useRef<CommentAttachment[]>([]);
  const draftTargetRef = useRef<HtmlCanvasSelection | null>(null);
  const attachmentObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const draftPendingRef = useRef<PendingDraft | null>(null);
  const draftRevisionRef = useRef(0);
  const draftRecoverySequenceRef = useRef(0);
  const draftFlushPromiseRef = useRef<Promise<boolean> | null>(null);
  const projectRegistrationPromiseRef =
    useRef<Promise<ProjectContext | null> | null>(null);
  const backgroundRunsRef = useRef<Map<string, ActiveRun>>(new Map());
  const qoderHandoffStatesRef =
    useRef<Map<string, ProjectQoderHandoffState>>(new Map());
  const activeRunRef = useRef<ActiveRun | null>(null);
  const submissionIntentRef = useRef<{
    token: number;
    epoch: number;
    sourcePath: string;
  } | null>(null);
  const submissionIntentCounterRef = useRef(0);
  const activatingRunsRef = useRef<Set<string>>(new Set());
  const waivingRunsRef = useRef<Set<string>>(new Set());
  const cancellingRunsRef = useRef<Set<string>>(new Set());
  const resolvingRunsRef = useRef<Set<string>>(new Set());
  const statusPollBusyRef = useRef<Set<string>>(new Set());
  const toastRef = useRef<Toast>(null);
  const pendingReconcileBusyRef = useRef(false);
  const relinkingTargetRef = useRef<string | null>(null);
  const relinkSelectionArmedRef = useRef(false);
  const closePreparationRequestRef = useRef<string | null>(null);
  const closeFreezeRequestRef = useRef<string | null>(null);
  const abortedCloseRequestsRef = useRef<Set<string>>(new Set());

  const [html, setHtml] = useState(DEFAULT_PROJECT_HTML);
  const [projectName, setProjectName] = useState(WELCOME_PROJECT.name);
  const [sourcePath, setSourcePath] = useState<string | null>(WELCOME_PROJECT.sourcePath);
  const [sourceSha256, setSourceSha256] = useState<string | null>(null);
  const [projectId, setProjectId] = useState("");
  const [documentId, setDocumentId] = useState("");
  const [projectRecordsPath, setProjectRecordsPath] =
    useState<string | null>(null);
  const [editRevision, setEditRevision] = useState(0);
  const [lastPersistedRevision, setLastPersistedRevision] = useState(0);
  const [persistState, setPersistState] = useState<PersistState>("idle");
  const [persistError, setPersistError] = useState("");
  const [lastModifiedAt, setLastModifiedAt] = useState<string | null>(null);
  const [, setProjectMenuOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
  const [recentProjectsError, setRecentProjectsError] = useState("");
  const [selection, setSelection] = useState<HtmlCanvasSelection | null>(null);
  const [draftTarget, setDraftTarget] = useState<HtmlCanvasSelection | null>(null);
  const [draft, setDraft] = useState("");
  const [draftCommentId, setDraftCommentId] = useState<string | null>(null);
  const [draftAttachments, setDraftAttachments] = useState<CommentAttachment[]>([]);
  const [attachmentObjectUrls, setAttachmentObjectUrls] = useState<Record<string, string>>({});
  const [attachmentUploadCount, setAttachmentUploadCount] = useState(0);
  const [previewAttachment, setPreviewAttachment] = useState<CommentAttachment | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [comments, setComments] = useState<CommentItem[]>([]);
  const [changeEvents, setChangeEvents] = useState<DirectEditEvent[]>([]);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [expandedVersionId, setExpandedVersionId] = useState<string | null>(null);
  const [editingCommentId, setEditingCommentId] = useState<string | null>(null);
  const [commentEditDraft, setCommentEditDraft] = useState("");
  const [pendingDeleteCommentId, setPendingDeleteCommentId] = useState<string | null>(null);
  const [handoffPreviewOpen, setHandoffPreviewOpen] = useState(false);
  const [commentRailHeight, setCommentRailHeight] = useState(0);
  const [commentCardHeights, setCommentCardHeights] = useState<Record<string, number>>({});
  const [commentTargetTops, setCommentTargetTops] = useState<Record<string, number>>({});
  const [commentViewport, setCommentViewport] = useState({ top: 0, height: 800 });
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [fileView, setFileView] = useState<WorkspaceFileView | null>(null);
  const [projectRulesSaving, setProjectRulesSaving] = useState(false);
  const [projectRecordsPreparing, setProjectRecordsPreparing] = useState(false);
  const [projectRecordsError, setProjectRecordsError] = useState("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [latestVersionId, setLatestVersionId] = useState<string | null>(null);
  const [currentBasedOnVersionId, setCurrentBasedOnVersionId] = useState<string | null>(null);
  const [, setCurrentExactVersionId] = useState<string | null>(null);
  const [restoredFromVersionId, setRestoredFromVersionId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("current");
  const [canvasMode, setCanvasMode] = useState<CanvasMode>("edit");
  const [viewingVersionId, setViewingVersionId] = useState<string | null>(null);
  const [preserveEditorHistory, setPreserveEditorHistory] = useState(false);
  const [renderedContentSha256, setRenderedContentSha256] = useState<string | null>(null);
  const [, setBridgeConnected] = useState<boolean | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [projectLocked, setProjectLocked] = useState(false);
  const [projectHydrating, setProjectHydrating] = useState(false);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [startupIssue, setStartupIssue] = useState<StartupIssue | null>(null);
  const [workspaceIssue, setWorkspaceIssue] = useState<WorkspaceIssue | null>(null);
  const [viewTransitioning, setViewTransitioning] = useState(false);
  const [draftPersistError, setDraftPersistError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [openingReadyVersion, setOpeningReadyVersion] = useState(false);
  const [waivingValidation, setWaivingValidation] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [pendingReconcileBusy, setPendingReconcileBusy] = useState(false);
  const [pendingReconcileError, setPendingReconcileError] = useState("");
  const [runStatusError, setRunStatusError] = useState("");
  const [relinkingTarget, setRelinkingTarget] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [qoderHandoffState, setQoderHandoffState] =
    useState<ProjectQoderHandoffState | null>(null);
  const [updateResult, setUpdateResult] =
    useState<ManualUpdateResult | null>(null);
  const [openedAiVersionNotice, setOpenedAiVersionNotice] =
    useState<OpenedAiVersionNotice | null>(null);
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
    toastRef.current = toast;
  }, [toast]);

  useEffect(() => {
    const updates = window.htmlAIUpdates;
    if (!updates) return undefined;
    let active = true;
    const receiveStatus = (result: ManualUpdateResult | null) => {
      if (active) setUpdateResult(result);
    };
    const unsubscribe = updates.onStatus(receiveStatus);
    void updates.getStatus().then(receiveStatus).catch(() => undefined);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  const relaunchApp = useCallback(async () => {
    try {
      const result = await window.htmlAIAppLifecycle?.relaunch();
      if (!result?.relaunched) {
        setToast({
          title: "源页还没有重新打开",
          message: "请先按页面提示导出或处理未写入内容，再重试。",
          tone: "warning",
          sticky: true,
          dedupeKey: "relaunch-app",
          action: { id: "relaunch-app", label: "重试" },
        });
      }
    } catch (cause) {
      setToast({
        title: "源页还没有重新打开",
        message: productErrorMessage(
          cause,
          "当前窗口内容仍保留；请先导出当前编辑，再重试。",
        ),
        tone: "warning",
        sticky: true,
        dedupeKey: "relaunch-app",
        action: { id: "relaunch-app", label: "重试" },
      });
    }
  }, []);

  useEffect(() => {
    const lifecycle = window.htmlAIAppLifecycle;
    if (!lifecycle?.onWorkspaceUnavailable) return undefined;
    return lifecycle.onWorkspaceUnavailable((issue) => {
      setBridgeConnected(false);
      setWorkspaceIssue({
        title: issue.title || "本地项目资料暂时不可用",
        message: issue.message
          || "当前页面内容仍保留。可先导出当前编辑，再重新打开源页。",
      });
    });
  }, []);

  const openLatestRelease = useCallback(async () => {
    try {
      const result = await window.htmlAIUpdates?.openLatestRelease();
      if (!result?.opened) throw new Error("GitHub 更新页面没有打开。");
    } catch {
      setToast({
        title: "更新页面没有打开",
        message: "当前内容不受影响；可以重新打开 PageRoot 发布页。",
        tone: "warning",
        dedupeKey: "latest-release",
        action: { id: "open-release", label: "重新打开" },
      });
    }
  }, []);

  const latestVersion = useMemo(
    () => versions.find((version) => version.id === latestVersionId) || null,
    [latestVersionId, versions],
  );
  const viewingVersion = useMemo(
    () => versions.find((version) => version.id === viewingVersionId) || null,
    [versions, viewingVersionId],
  );
  const runInProgress = projectLocked || isLockedLifecycle(activeRun?.status);
  const currentQoderHandoffStatus = (
    activeRun?.sourcePath
    && activeRun.requestId
    && sameLocalSourcePath(qoderHandoffState?.sourcePath, activeRun.sourcePath)
    && qoderHandoffState?.requestId === activeRun.requestId
    && qoderHandoffState.attemptId === activeRun.attemptId
  )
    ? qoderHandoffState.status
    : "idle";
  const updateAvailable = Boolean(
    updateResult?.status === "available"
    && updateResult.latestVersion,
  );
  const interactionLocked = runInProgress
    || projectHydrating
    || Boolean(projectLoadError)
    || Boolean(workspaceIssue)
    || viewTransitioning
    || persistState === "conflict"
    || viewMode === "history";

  const activeCommentItems = useMemo(
    () => comments.filter(commentHasContent),
    [comments],
  );
  const activeCommentCount = activeCommentItems.length;
  const visibleCommentItems = useMemo(
    () => (
      viewMode === "history" && viewingVersion
        ? viewingVersion.comments.filter(commentHasContent)
        : activeCommentItems
    ),
    [activeCommentItems, viewMode, viewingVersion],
  );
  const commentViewportBucket = Math.floor(commentViewport.top / 600);
  useEffect(() => {
    htmlRef.current = html;
  }, [html]);
  useEffect(() => {
    sourcePathRef.current = sourcePath;
  }, [sourcePath]);
  useEffect(() => {
    sourceShaRef.current = sourceSha256;
  }, [sourceSha256]);
  useEffect(() => {
    activeRunRef.current = activeRun;
  }, [activeRun]);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);
  useEffect(() => {
    documentIdRef.current = documentId;
  }, [documentId]);
  useEffect(() => {
    changeEventsRef.current = changeEvents;
  }, [changeEvents]);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);
  useEffect(() => {
    focusedCommentIdRef.current = focusedCommentId;
  }, [focusedCommentId]);
  useEffect(() => {
    composerDraftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    composerCommentIdRef.current = draftCommentId;
  }, [draftCommentId]);
  useEffect(() => {
    composerAttachmentsRef.current = draftAttachments;
  }, [draftAttachments]);
  useEffect(() => {
    draftTargetRef.current = draftTarget;
  }, [draftTarget]);
  useEffect(() => {
    projectLockedRef.current = projectLocked;
  }, [projectLocked]);
  useEffect(() => () => {
    for (const url of attachmentObjectUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    attachmentObjectUrlsRef.current.clear();
  }, []);

  const handleCommentLayout = useCallback((layout: HtmlCanvasCommentLayoutState) => {
    setCommentRailHeight((current) => (
      Math.abs(current - layout.scrollHeight) > 1 ? layout.scrollHeight : current
    ));
    const nextTops = Object.fromEntries(
      layout.targets.map((target) => [target.targetId, target.top]),
    );
    setCommentTargetTops((current) => {
      const currentEntries = Object.entries(current);
      const nextEntries = Object.entries(nextTops);
      if (
        currentEntries.length === nextEntries.length
        && nextEntries.every(([targetId, top]) => current[targetId] === top)
      ) return current;
      return nextTops;
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
    const root = commentsPanelRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const nodes = [...root.querySelectorAll<HTMLElement>("[data-comment-measure]")];
    const update = () => {
      const measured = Object.fromEntries(nodes.map((node) => [
        String(node.dataset.commentMeasure),
        Math.ceil(node.getBoundingClientRect().height),
      ]));
      const activeKeys = new Set([
        ...visibleCommentItems.map((comment) => comment.commentId),
        ...(composerOpen ? ["__composer"] : []),
      ]);
      setCommentCardHeights((current) => {
        const next = Object.fromEntries(
          Object.entries({ ...current, ...measured })
            .filter(([key]) => activeKeys.has(key)),
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
    nodes.forEach((node) => observer.observe(node));
    update();
    return () => observer.disconnect();
  }, [
    attachmentObjectUrls,
    composerOpen,
    draftAttachments,
    editingCommentId,
    commentViewport.height,
    commentViewportBucket,
    visibleCommentItems,
  ]);

  const commentedTargets = useMemo(() => {
    const grouped = new Map<string, {
      target: HtmlCanvasSelection;
      count: number;
      label: string;
    }>();
    for (const comment of visibleCommentItems) {
      const markerKey = commentMarkerGroupKey(comment.target);
      const current = grouped.get(markerKey);
      if (current) current.count += 1;
      else {
        grouped.set(markerKey, {
          target: comment.target,
          count: 1,
          label: insertionLabel(comment.target),
        });
      }
    }
    return [...grouped.values()];
  }, [visibleCommentItems]);

  const trackedAuditTargets = useMemo(() => {
    const byTargetId = new Map<string, HtmlCanvasSelection>();
    for (const event of changeEvents) {
      if (event.target.id) byTargetId.set(event.target.id, event.target);
    }
    return [...byTargetId.values()];
  }, [changeEvents]);

  const captureProjectContext = useCallback((): ProjectContext | null => {
    const activeSource = sourcePathRef.current;
    if (!activeSource) return null;
    return {
      epoch: projectEpochRef.current,
      projectId: projectIdRef.current,
      documentId: documentIdRef.current,
      sourcePath: activeSource,
    };
  }, []);

  const isCurrentProjectContext = useCallback((context: ProjectContext): boolean => (
    projectEpochRef.current === context.epoch
    && sameLocalSourcePath(sourcePathRef.current, context.sourcePath)
    && (!context.projectId || projectIdRef.current === context.projectId)
  ), []);

  const ensureProjectRegistered = useCallback(async (
    sourceOverride?: string,
    expectedHashOverride?: string | null,
    adoptCanonicalSource = true,
  ): Promise<ProjectContext | null> => {
    const activeSource = sourceOverride || sourcePathRef.current;
    const expectedSourceSha256 =
      expectedHashOverride || sourceShaRef.current;
    if (!activeSource || !expectedSourceSha256) return null;
    if (projectIdRef.current && documentIdRef.current) {
      return {
        epoch: projectEpochRef.current,
        projectId: projectIdRef.current,
        documentId: documentIdRef.current,
        sourcePath: activeSource,
      };
    }
    if (projectRegistrationPromiseRef.current) {
      return projectRegistrationPromiseRef.current;
    }
    const epoch = projectEpochRef.current;
    const registration = (async () => {
      const response = await bridgeFetch(`${BRIDGE_URL}/project/ensure`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourcePath: activeSource,
          expectedSourceSha256,
        }),
      }, BRIDGE_WRITE_TIMEOUT_MS);
      const payload = await readJsonResponse(response);
      if (!response.ok || payload.ok === false) {
        throw responseError(payload, "无法建立项目记录。");
      }
      if (
        epoch !== projectEpochRef.current
        || !sameLocalSourcePath(sourcePathRef.current, activeSource)
      ) return null;
      const nextProjectId = String(payload.projectId || "");
      const nextDocumentId = String(payload.documentId || "");
      const nextSourceSha256 = String(
        payload.currentHtmlSha256 || payload.sourceSha256 || "",
      );
      const canonicalSource =
        typeof payload.content === "string" ? payload.content : "";
      if (
        !nextProjectId
        || !nextDocumentId
        || !/^sha256:[a-f0-9]{64}$/.test(nextSourceSha256)
        || (
          canonicalSource
          && await browserSha256(canonicalSource) !== nextSourceSha256
        )
      ) {
        throw new Error("项目记录已建立，但返回的身份或源文件校验不完整。");
      }
      const projectRecord = isRecord(payload.project) ? payload.project : {};
      const paths = isRecord(payload.paths) ? payload.paths : {};
      projectIdRef.current = nextProjectId;
      documentIdRef.current = nextDocumentId;
      sourceShaRef.current = nextSourceSha256;
      recoveryIdentityRef.current =
        recoveryIdentityFromRecord(payload.recoveryIdentity);
      setProjectId(nextProjectId);
      setDocumentId(nextDocumentId);
      setSourceSha256(nextSourceSha256);
      setProjectRecordsPath(
        String(paths.projectRecords || payload.projectRoot || "") || null,
      );
      if (projectRecord.name) setProjectName(String(projectRecord.name));
      setVersions(versionsFromWorkspace(payload));
      setLatestVersionId(
        payload.latestVersionId ? String(payload.latestVersionId) : null,
      );
      setCurrentBasedOnVersionId(
        payload.currentBasedOnVersionId
          ? String(payload.currentBasedOnVersionId)
          : null,
      );
      setCurrentExactVersionId(
        payload.currentExactVersionId
          ? String(payload.currentExactVersionId)
          : null,
      );
      if (
        adoptCanonicalSource
        && canonicalSource
        && editRevisionRef.current === lastPersistedRevisionRef.current
        && !pendingWriteRef.current
      ) {
        const reboundTargets = rebindTargetsPreservingGlobal(
          canonicalSource,
          [
            ...commentsRef.current.map((comment) => comment.target),
            ...(draftTargetRef.current ? [draftTargetRef.current] : []),
          ],
        );
        const reboundById = new Map(
          reboundTargets.map((target) => [target.id, target]),
        );
        const reboundComments = commentsRef.current.map((comment) => ({
          ...comment,
          target: reboundById.get(comment.target.id) || comment.target,
        }));
        commentsRef.current = reboundComments;
        setComments(reboundComments);
        if (draftTargetRef.current) {
          const reboundDraftTarget =
            reboundById.get(draftTargetRef.current.id)
            || draftTargetRef.current;
          draftTargetRef.current = reboundDraftTarget;
          setDraftTarget(reboundDraftTarget);
        }
        htmlRef.current = canonicalSource;
        setHtml(canonicalSource);
        setRenderedContentSha256(null);
      }
      return {
        epoch,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        sourcePath: activeSource,
      };
    })();
    projectRegistrationPromiseRef.current = registration;
    try {
      return await registration;
    } finally {
      if (projectRegistrationPromiseRef.current === registration) {
        projectRegistrationPromiseRef.current = null;
      }
    }
  }, []);

  const prepareProjectRecords = useCallback(async () => {
    const activeSource = sourcePathRef.current;
    const epoch = projectEpochRef.current;
    if (
      !activeSource
      || (projectIdRef.current && documentIdRef.current)
      || projectRegistrationPromiseRef.current
    ) return;
    setProjectRecordsPreparing(true);
    setProjectRecordsError("");
    try {
      const registered = await ensureProjectRegistered();
      if (
        !registered
        && projectEpochRef.current === epoch
        && sameLocalSourcePath(sourcePathRef.current, activeSource)
      ) {
        throw new Error("项目资料没有完成初始化。");
      }
    } catch (cause) {
      if (
        projectEpochRef.current !== epoch
        || !sameLocalSourcePath(sourcePathRef.current, activeSource)
      ) return;
      setProjectRecordsError(productErrorMessage(
        cause,
        "项目资料暂时无法建立；当前 HTML 和评论仍保留，可在这里重试。",
      ));
    } finally {
      if (
        projectEpochRef.current === epoch
        && sameLocalSourcePath(sourcePathRef.current, activeSource)
      ) {
        setProjectRecordsPreparing(false);
      }
    }
  }, [ensureProjectRegistered]);

  const verifyCanvasRendered = useCallback(async (
    expectedHtml: string,
    expectedSha256: string,
    context?: ProjectContext,
  ): Promise<void> => {
    for (let attempt = 0; attempt < 80; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
      if (context && !isCurrentProjectContext(context)) {
        throw new Error("项目已切换，停止核对旧项目画布。");
      }
      const renderedSource = editorRef.current?.getRenderedSourceHtml();
      if (renderedSource !== expectedHtml) continue;
      const renderedSha256 = await browserSha256(renderedSource);
      if (renderedSha256 !== expectedSha256) {
        throw new Error("画布已载入内容的 Hash 与源 HTML 不一致。");
      }
      if (!context || isCurrentProjectContext(context)) {
        setRenderedContentSha256(renderedSha256);
      }
      return;
    }
    throw new Error("画布没有在时限内确认载入目标 HTML。");
  }, [isCurrentProjectContext]);

  useEffect(() => {
    let cancelled = false;
    const expectedHtml = html;
    const verifyInitialRender = async () => {
      for (let attempt = 0; attempt < 40; attempt += 1) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 25));
        if (cancelled) return;
        if (editorRef.current?.getRenderedSourceHtml() !== expectedHtml) continue;
        const renderedSha256 = await browserSha256(expectedHtml);
        if (!cancelled && htmlRef.current === expectedHtml) {
          setRenderedContentSha256(renderedSha256);
        }
        return;
      }
    };
    void verifyInitialRender();
    return () => {
      cancelled = true;
    };
  }, [html]);

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
      || documentIdRef.current
      || write?.sourcePath
      || context?.sourcePath
      || sourcePathRef.current
      || "unbound";
    const key = `html-ai-recovery:${keyPart}`;
    try {
      if (!write) {
        window.localStorage.removeItem(key);
        return;
      }
      window.localStorage.setItem(key, JSON.stringify({
        schemaVersion: "2.0.0",
        projectId: write.projectId,
        documentId: write.documentId,
        sourcePath: write.sourcePath,
        recoveryIdentity: write.recoveryIdentity,
        expectedSourceSha256: write.expectedSourceSha256,
        revision: write.revision,
        html: write.html,
        changeEvents: write.events.map(persistedChangeEvent),
      }));
    } catch {
      // A full localStorage quota must never make the actual source write look successful.
    }
  }, []);

  const persistDraftRecovery = useCallback((
    snapshot: PendingDraft | null,
    context?: Partial<ProjectContext>,
  ) => {
    const documentKeyPart = snapshot?.documentId
      || context?.documentId
      || documentIdRef.current;
    const sourceKeyPart = snapshot?.sourcePath
      || context?.sourcePath
      || sourcePathRef.current;
    const keys = [
      documentKeyPart ? `html-ai-draft-recovery:${documentKeyPart}` : "",
      sourceKeyPart ? `html-ai-draft-recovery:${sourceKeyPart}` : "",
    ].filter(Boolean);
    try {
      if (!snapshot) {
        for (const key of keys) window.localStorage.removeItem(key);
        return;
      }
      const composerText = composerDraftRef.current;
      const composerTarget = draftTargetRef.current;
      const composerAttachments = composerAttachmentsRef.current;
      if (
        snapshot.comments.length === 0
        && snapshot.changeEvents.length === 0
        && deletedCommentIdsRef.current.size === 0
        && !composerText.trim()
        && composerAttachments.length === 0
        && !composerTarget
      ) {
        for (const key of keys) window.localStorage.removeItem(key);
        return;
      }
      const serialized = JSON.stringify({
        schemaVersion: "3.0.0",
        projectId: snapshot.projectId,
        documentId: snapshot.documentId,
        sourcePath: snapshot.sourcePath,
        basedOnVersionId: snapshot.basedOnVersionId,
        baseDraftRevision: snapshot.expectedDraftRevision,
        localSequence: ++draftRecoverySequenceRef.current,
        comments: snapshot.comments.map(persistedComment),
        changeEvents: snapshot.changeEvents.map(persistedChangeEvent),
        deletedCommentIds: [...deletedCommentIdsRef.current],
        composerDraft: composerText,
        composerCommentId: composerCommentIdRef.current,
        composerAttachments: composerAttachments.map(persistedAttachment),
        composerTarget: composerTarget ? persistedTargetRef(composerTarget) : null,
      });
      for (const key of keys) window.localStorage.setItem(key, serialized);
    } catch {
      // The Bridge remains authoritative after acknowledgement; this is only a crash fallback.
    }
  }, []);

  const persistCurrentDraftRecovery = useCallback((
    nextComments = commentsRef.current,
    nextEvents = changeEventsRef.current,
  ) => {
    const context = captureProjectContext();
    if (!context) return;
    persistDraftRecovery({
      ...context,
      basedOnVersionId: currentBasedOnVersionId,
      expectedDraftRevision: draftRevisionRef.current,
      comments: [...nextComments],
      changeEvents: [...nextEvents],
    });
  }, [captureProjectContext, currentBasedOnVersionId, persistDraftRecovery]);

  const flushAutosave = useCallback(async (throughRevision?: number): Promise<boolean> => {
    clearAutosaveTimer();
    if (flushPromiseRef.current) {
      const previous = await flushPromiseRef.current;
      if (!previous) return false;
      if (
        throughRevision !== undefined
        && lastPersistedRevisionRef.current >= throughRevision
      ) return true;
      if (
        !pendingWriteRef.current
        && editRevisionRef.current <= lastPersistedRevisionRef.current
      ) return true;
    }
    if (
      !pendingWriteRef.current
      && sourcePathRef.current
      && editRevisionRef.current > lastPersistedRevisionRef.current
    ) {
      const reconstructedWrite: PendingWrite = {
        epoch: projectEpochRef.current,
        projectId: projectIdRef.current,
        documentId: documentIdRef.current,
        sourcePath: sourcePathRef.current,
        expectedSourceSha256: sourceShaRef.current,
        html: htmlRef.current,
        revision: editRevisionRef.current,
        events: [...auditPendingRef.current],
        recoveryIdentity: recoveryIdentityRef.current,
      };
      pendingWriteRef.current = reconstructedWrite;
      persistRecoveryLog(reconstructedWrite);
      persistStateRef.current = "queued";
      setPersistState("queued");
      setPersistError("");
    }
    if (!sourcePathRef.current && !pendingWriteRef.current?.sourcePath) return false;
    if (
      throughRevision !== undefined
      && lastPersistedRevisionRef.current >= throughRevision
      && (!pendingWriteRef.current || pendingWriteRef.current.revision > throughRevision)
    ) {
      return true;
    }

    const run = async () => {
      while (pendingWriteRef.current) {
        let write = pendingWriteRef.current;
        if (!write.sourcePath) return false;
        if (throughRevision !== undefined && write.revision > throughRevision) break;
        const inFlightAuditKeys = write.events.map(auditEventKey);
        pendingWriteRef.current = null;
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
          persistStateRef.current = "writing";
          setPersistState("writing");
          setPersistError("");
        }
        try {
          if (!write.projectId || !write.documentId) {
            const registered = await ensureProjectRegistered(
              write.sourcePath,
              write.expectedSourceSha256,
              false,
            );
            if (!registered) {
              throw new Error("项目已切换，原项目的修改已保留在恢复记录中。");
            }
            write = {
              ...write,
              projectId: registered.projectId,
              documentId: registered.documentId,
              expectedSourceSha256: sourceShaRef.current,
            };
            const queuedAfterRegistration =
              pendingWriteRef.current as PendingWrite | null;
            if (
              queuedAfterRegistration
              && queuedAfterRegistration.epoch === write.epoch
              && sameLocalSourcePath(queuedAfterRegistration.sourcePath, write.sourcePath)
            ) {
              pendingWriteRef.current = {
                ...queuedAfterRegistration,
                projectId: registered.projectId,
                documentId: registered.documentId,
                expectedSourceSha256: sourceShaRef.current,
              };
            }
          }
          if (!write.sourcePath) return false;
          writeContext = {
            epoch: write.epoch,
            projectId: write.projectId,
            documentId: write.documentId,
            sourcePath: write.sourcePath,
          };
          const response = await bridgeFetch(`${BRIDGE_URL}/autosave`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId: write.projectId,
              documentId: write.documentId,
              sourcePath: write.sourcePath,
              html: write.html,
              expectedSourceSha256: write.expectedSourceSha256,
              editRevision: write.revision,
              changeEvents: write.events.map(persistedChangeEvent),
            }),
          }, BRIDGE_WRITE_TIMEOUT_MS);
          const payload = await readJsonResponse(response);
          if (!response.ok || payload.ok === false) {
            throw responseError(payload, "无法把修改更新到源 HTML。");
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
          const queuedWrite = pendingWriteRef.current as PendingWrite | null;
          if (
            queuedWrite
            && queuedWrite.epoch === write.epoch
            && queuedWrite.projectId === write.projectId
            && queuedWrite.documentId === write.documentId
            && sameLocalSourcePath(queuedWrite.sourcePath, write.sourcePath)
          ) {
            pendingWriteRef.current = {
              ...queuedWrite,
              expectedSourceSha256: nextHash,
              recoveryIdentity:
                recoveryIdentityFromRecord(payload.recoveryIdentity)
                || queuedWrite.recoveryIdentity,
              events: removeAcknowledgedAuditEvents(queuedWrite.events, write.events),
            };
            persistRecoveryLog(pendingWriteRef.current, writeContext);
          } else {
            persistRecoveryLog(null, writeContext);
          }
          if (isCurrentProjectContext(writeContext)) {
            sourceShaRef.current = nextHash;
            recoveryIdentityRef.current =
              recoveryIdentityFromRecord(payload.recoveryIdentity)
              || recoveryIdentityRef.current;
            lastPersistedRevisionRef.current = Math.max(
              lastPersistedRevisionRef.current,
              persistedRevision,
            );
            setSourceSha256(nextHash);
            setLastPersistedRevision(lastPersistedRevisionRef.current);
            setLastModifiedAt(persistedAt);
            if (
              editRevisionRef.current === write.revision
              && !pendingWriteRef.current
            ) {
              const reboundTargets = rebindTargetsPreservingGlobal(
                acknowledgedHtml,
                [
                  ...commentsRef.current.map((comment) => comment.target),
                  ...changeEventsRef.current.map((event) => event.target),
                  ...(draftTargetRef.current ? [draftTargetRef.current] : []),
                ],
              );
              const reboundById = new Map(
                reboundTargets.map((target) => [target.id, target]),
              );
              const reboundComments = commentsRef.current.map((comment) => ({
                ...comment,
                target: reboundById.get(comment.target.id) || comment.target,
              }));
              const reboundEvents = changeEventsRef.current.map((event) => ({
                ...event,
                target: reboundById.get(event.target.id) || event.target,
              }));
              commentsRef.current = reboundComments;
              changeEventsRef.current = reboundEvents;
              setComments(reboundComments);
              setChangeEvents(reboundEvents);
              if (draftTargetRef.current) {
                const reboundDraftTarget =
                  reboundById.get(draftTargetRef.current.id)
                  || draftTargetRef.current;
                draftTargetRef.current = reboundDraftTarget;
                setDraftTarget(reboundDraftTarget);
              }
              htmlRef.current = acknowledgedHtml;
              setHtml(acknowledgedHtml);
              setRenderedContentSha256(nextHash);
              setCurrentExactVersionId(
                payload.currentExactVersionId
                  ? String(payload.currentExactVersionId)
                  : null,
              );
            }
            setBridgeConnected(true);
            auditPendingRef.current = removeAcknowledgedAuditEvents(
              auditPendingRef.current,
              write.events,
            );
            if (!pendingWriteRef.current) {
              persistStateRef.current = "idle";
              setPersistState("idle");
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
          const pendingAfterFailure = pendingWriteRef.current as PendingWrite | null;
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
            pendingWriteRef.current = recoveryWrite;
          }
          persistRecoveryLog(recoveryWrite, writeContext);
          if (isCurrentProjectContext(writeContext)) {
            if (boundaryFailure) {
              const failClosedMessage = `${visibleError} ${boundaryFailure}`;
              persistStateRef.current = "failed";
              setPersistState("failed");
              projectLoadErrorRef.current = failClosedMessage;
              setProjectLoadError(failClosedMessage);
              setPersistError(failClosedMessage);
            } else if (conflict) {
              // The current native draft is now part of recoveryWrite and the
              // editing host is frozen; only now may the conflict lock appear.
              persistStateRef.current = "conflict";
              setPersistState("conflict");
              setPersistError(visibleError);
            } else if (protocolError) {
              const failClosedMessage = `${visibleError} 源文件已进入待复核状态，不会采用服务端返回的不同内容。`;
              persistStateRef.current = "failed";
              setPersistState("failed");
              projectLoadErrorRef.current = failClosedMessage;
              setProjectLoadError(failClosedMessage);
              setPersistError(failClosedMessage);
            } else {
              persistStateRef.current = "failed";
              setPersistState("failed");
              setPersistError(visibleError);
            }
            setBridgeConnected(error.message.includes("fetch") ? false : true);
          }
          return false;
        } finally {
          for (const key of inFlightAuditKeys) {
            auditInFlightKeysRef.current.delete(key);
          }
        }
      }
      return throughRevision === undefined
        || lastPersistedRevisionRef.current >= throughRevision;
    };

    const promise = run();
    flushPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (flushPromiseRef.current === promise) flushPromiseRef.current = null;
    }
  }, [
    clearAutosaveTimer,
    ensureProjectRegistered,
    fenceAndFreezeCurrentCanvas,
    isCurrentProjectContext,
    persistRecoveryLog,
  ]);

  const enqueueAutosave = useCallback((
    nextHtml: string,
    mutation?: HtmlCanvasMutation,
  ): number => {
    if (persistStateRef.current === "conflict") {
      return editRevisionRef.current;
    }
    const nextRevision = editRevisionRef.current + 1;
    editRevisionRef.current = nextRevision;
    setEditRevision(nextRevision);
    htmlRef.current = nextHtml;
    setHtml(nextHtml);
    setCurrentExactVersionId(null);
    setRenderedContentSha256(null);

    if (mutation) {
      const history = reduceDirectEditHistory({
        mutation,
        capturedRevision: nextRevision,
        createdAt: new Date().toISOString(),
        baseVersionId: currentBasedOnVersionId,
        events: changeEventsRef.current,
        pendingEvents: auditPendingRef.current,
        undoFolds: undoDraftFoldsRef.current,
        redoFolds: redoDraftFoldsRef.current,
        inFlightKeys: auditInFlightKeysRef.current,
        nextEventId: () => recordId("change", changeCounter.current++),
      });
      changeEventsRef.current = history.events;
      auditPendingRef.current = history.pendingEvents;
      undoDraftFoldsRef.current = history.undoFolds;
      redoDraftFoldsRef.current = history.redoFolds;
      setChangeEvents(history.events);
      persistCurrentDraftRecovery(commentsRef.current, history.events);
    }

    if (!sourcePathRef.current) {
      pendingWriteRef.current = null;
      persistStateRef.current = "preview-dirty";
      setPersistState("preview-dirty");
      setPersistError("");
      clearAutosaveTimer();
      return nextRevision;
    }

    const write: PendingWrite = {
      epoch: projectEpochRef.current,
      projectId: projectIdRef.current,
      documentId: documentIdRef.current,
      sourcePath: sourcePathRef.current,
      expectedSourceSha256: sourceShaRef.current,
      html: nextHtml,
      revision: nextRevision,
      events: [...auditPendingRef.current],
      recoveryIdentity: recoveryIdentityRef.current,
    };
    pendingWriteRef.current = write;
    persistRecoveryLog(write);
    persistStateRef.current = "queued";
    setPersistState("queued");
    setPersistError("");
    clearAutosaveTimer();
    if (sourcePathRef.current) {
      autosaveTimerRef.current = window.setTimeout(() => {
        void flushAutosave();
      }, AUTOSAVE_DELAY_MS);
    }
    return nextRevision;
  }, [
    clearAutosaveTimer,
    currentBasedOnVersionId,
    flushAutosave,
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
    const backgroundRun = project.sourcePath
      ? backgroundRunsRef.current.get(project.sourcePath)
        || [...backgroundRunsRef.current.values()].find(
          (run) => sameLocalSourcePath(run.sourcePath, project.sourcePath),
        )
        || null
      : null;
    const backgroundRunKey = backgroundRun
      ? activeRunOperationKey(backgroundRun)
      : "";
    const projectQoderHandoff = project.sourcePath
      ? qoderHandoffStatesRef.current.get(project.sourcePath)
        || [...qoderHandoffStatesRef.current.values()].find(
          (state) => sameLocalSourcePath(state.sourcePath, project.sourcePath),
        )
        || null
      : null;
    const opensLockedProject = isLockedLifecycle(backgroundRun?.status);
    projectEpochRef.current += 1;
    clearAutosaveTimer();
    pendingWriteRef.current = null;
    auditPendingRef.current = [];
    undoDraftFoldsRef.current.clear();
    redoDraftFoldsRef.current.clear();
    editRevisionRef.current = 0;
    lastPersistedRevisionRef.current = 0;
    sourcePathRef.current = project.sourcePath || null;
    sourceShaRef.current = project.sha256 || null;
    recoveryIdentityRef.current = null;
    projectRegistrationPromiseRef.current = null;
    projectIdRef.current = "";
    documentIdRef.current = "";
    projectLockedRef.current = opensLockedProject;
    projectHydratingRef.current = Boolean(project.sourcePath);
    projectLoadErrorRef.current = null;
    viewTransitioningRef.current = false;
    navigationOperationRef.current += 1;
    submissionPendingRef.current = false;
    draftPendingRef.current = null;
    draftRevisionRef.current = 0;
    htmlRef.current = project.html;
    setProjectName(project.name);
    setOpenedAiVersionNotice(null);
    setSourcePath(project.sourcePath || null);
    setSourceSha256(project.sha256 || null);
    setHtml(project.html);
    setProjectId("");
    setDocumentId("");
    setProjectRecordsPath(null);
    setEditRevision(0);
    setLastPersistedRevision(0);
    persistStateRef.current = "idle";
    setPersistState("idle");
    setPersistError("");
    setLastModifiedAt(project.lastModifiedAt || null);
    setSelection(null);
    setComposerOpen(false);
    setDraftTarget(null);
    setDraft("");
    setDraftCommentId(null);
    setDraftAttachments([]);
    setComments([]);
    commentsRef.current = [];
    deletedCommentIdsRef.current.clear();
    composerDraftRef.current = "";
    composerCommentIdRef.current = null;
    composerAttachmentsRef.current = [];
    draftTargetRef.current = null;
    for (const url of attachmentObjectUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    attachmentObjectUrlsRef.current.clear();
    setAttachmentObjectUrls({});
    setAttachmentUploadCount(0);
    setPreviewAttachment(null);
    setEditingCommentId(null);
    setCommentEditDraft("");
    setPendingDeleteCommentId(null);
    relinkingTargetRef.current = null;
    relinkSelectionArmedRef.current = false;
    setRelinkingTarget(null);
    setCommentCardHeights({});
    setCommentRailHeight(0);
    setCommentTargetTops({});
    focusedCommentIdRef.current = null;
    setFocusedCommentId(null);
    reviewRevealRequestRef.current += 1;
    changeEventsRef.current = [];
    setChangeEvents([]);
    setVersions([]);
    setLatestVersionId(null);
    setCurrentBasedOnVersionId(null);
    setCurrentExactVersionId(null);
    setRestoredFromVersionId(null);
    setViewMode("current");
    setCanvasMode("edit");
    setViewingVersionId(null);
    setPreserveEditorHistory(false);
    setRenderedContentSha256(null);
    activeRunRef.current = backgroundRun;
    setActiveRun(backgroundRun);
    setQoderHandoffState(projectQoderHandoff);
    setProjectLocked(opensLockedProject);
    setProjectHydrating(Boolean(project.sourcePath));
    setProjectLoadError(null);
    setViewTransitioning(false);
    setDraftPersistError("");
    setProjectMenuOpen(false);
    setProjectRulesSaving(false);
    setProjectRecordsPreparing(false);
    setProjectRecordsError("");
    pendingReconcileBusyRef.current = false;
    setPendingReconcileBusy(false);
    setPendingReconcileError("");
    setRunStatusError("");
    setRestoring(null);
    setGenerating(
      sameLocalSourcePath(submissionIntentRef.current?.sourcePath, project.sourcePath),
    );
    setCancelling(
      Boolean(backgroundRunKey && cancellingRunsRef.current.has(backgroundRunKey)),
    );
    setOpeningReadyVersion(
      Boolean(backgroundRunKey && activatingRunsRef.current.has(backgroundRunKey)),
    );
    setWaivingValidation(
      Boolean(backgroundRunKey && waivingRunsRef.current.has(backgroundRunKey)),
    );
    setResolvingConflict(
      Boolean(backgroundRunKey && resolvingRunsRef.current.has(backgroundRunKey)),
    );
    setDrawer(null);
    setFileView(null);
    reviewStageRef.current?.scrollTo({ top: 0 });
    if (!opensLockedProject) editorRef.current?.unlockNow?.();
    editorRef.current?.clearSelection();
  }, [clearAutosaveTimer]);

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

  const adoptGeneratedSourcePath = useCallback(async ({
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
  }): Promise<ProjectContext | null> => {
    if (!nextSourcePath || nextSourcePath === previousSourcePath) {
      return sameLocalSourcePath(sourcePathRef.current, nextSourcePath)
        ? {
            epoch: projectEpochRef.current,
            projectId: nextProjectId,
            documentId: nextDocumentId,
            sourcePath: nextSourcePath,
          }
        : null;
    }

    const updatesCurrentProject =
      (
        Boolean(nextProjectId)
        && Boolean(projectIdRef.current)
        && projectIdRef.current === nextProjectId
      )
      || sameLocalSourcePath(sourcePathRef.current, previousSourcePath)
      || sameLocalSourcePath(sourcePathRef.current, nextSourcePath);
    const api = window.htmlAIProjects;
    if (api?.activateGeneratedVersion) {
      await api.activateGeneratedVersion({
        previousSourcePath,
        nextSourcePath,
        expectedSha256,
        projectId: nextProjectId,
        versionId,
      });
      await refreshRecents();
    }
    if (!updatesCurrentProject) return null;

    if (sourcePathRef.current !== nextSourcePath) {
      const trackedRun = backgroundRunsRef.current.get(previousSourcePath)
        || [...backgroundRunsRef.current.values()].find(
          (run) => (
            run.projectId === nextProjectId
            || sameLocalSourcePath(run.sourcePath, previousSourcePath)
          ),
        );
      for (const [trackedPath, run] of backgroundRunsRef.current) {
        if (
          run.projectId === nextProjectId
          || sameLocalSourcePath(trackedPath, previousSourcePath)
        ) {
          backgroundRunsRef.current.delete(trackedPath);
        }
      }
      if (trackedRun) {
        backgroundRunsRef.current.set(nextSourcePath, {
          ...trackedRun,
          sourcePath: nextSourcePath,
        });
      }
      const trackedHandoff = qoderHandoffStatesRef.current.get(previousSourcePath)
        || [...qoderHandoffStatesRef.current.values()].find(
          (state) => sameLocalSourcePath(state.sourcePath, previousSourcePath),
        );
      for (const [trackedPath] of qoderHandoffStatesRef.current) {
        if (sameLocalSourcePath(trackedPath, previousSourcePath)) {
          qoderHandoffStatesRef.current.delete(trackedPath);
        }
      }
      if (trackedHandoff) {
        qoderHandoffStatesRef.current.set(nextSourcePath, {
          ...trackedHandoff,
          sourcePath: nextSourcePath,
        });
      }
      projectEpochRef.current += 1;
      sourcePathRef.current = nextSourcePath;
      sourceShaRef.current = expectedSha256;
      recoveryIdentityRef.current = null;
      pendingWriteRef.current = null;
      draftPendingRef.current = null;
      setSourcePath(nextSourcePath);
      setSourceSha256(expectedSha256);
    }
    return {
      epoch: projectEpochRef.current,
      projectId: nextProjectId,
      documentId: nextDocumentId,
      sourcePath: nextSourcePath,
    };
  }, [refreshRecents]);

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
    try {
      for (const key of keys) {
        const serialized = window.localStorage.getItem(key);
        if (!serialized) continue;
        const parsed = JSON.parse(serialized);
        if (isRecord(parsed)) {
          raw = parsed;
          recoveredKey = key;
          break;
        }
      }
    } catch {
      return false;
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
      editRevisionRef.current = reconciledRevision;
      lastPersistedRevisionRef.current = reconciledRevision;
      pendingWriteRef.current = null;
      setEditRevision(reconciledRevision);
      setLastPersistedRevision(reconciledRevision);
      persistStateRef.current = "idle";
      setPersistState("idle");
      setPersistError("");
      window.localStorage.removeItem(recoveredKey);
      return false;
    }

    const revision = Math.max(
      serverRevision,
      Number.isSafeInteger(Number(raw.revision)) ? Number(raw.revision) : 0,
    ) + 1;
    const recoveredEvents = changesFromRecords(raw.changeEvents);
    const existingIds = new Set(changeEventsRef.current.map((event) => event.eventId));
    const mergedEvents = [
      ...changeEventsRef.current,
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
      recoveryIdentity: currentRecoveryIdentity,
    };
    editRevisionRef.current = revision;
    pendingWriteRef.current = job;
    auditPendingRef.current = recoveredEvents;
    changeEventsRef.current = mergedEvents;
    htmlRef.current = recoveredHtml;
    setEditRevision(revision);
    setHtml(recoveredHtml);
    setChangeEvents(mergedEvents);
    setCurrentExactVersionId(null);
    setRenderedContentSha256(null);
    persistRecoveryLog(job);

    if (canRebaseSafely) {
      persistStateRef.current = "queued";
      setPersistState("queued");
      setPersistError("");
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
        persistStateRef.current = "failed";
        setPersistState("failed");
        setPersistError(failClosedMessage);
        throw new Error(failClosedMessage);
      }
      persistStateRef.current = "conflict";
      setPersistState("conflict");
      setPersistError(
        "恢复记录与当前项目、版本或源文件身份不一致，请比较后选择重新载入或导出当前编辑。",
      );
    }
    return true;
  }, [
    clearAutosaveTimer,
    fenceAndFreezeCurrentCanvas,
    flushAutosave,
    isCurrentProjectContext,
    persistRecoveryLog,
    verifyCanvasRendered,
  ]);

  const recoverDraftLog = useCallback((
    context: ProjectContext,
    serverComments: CommentItem[],
    serverEvents: DirectEditEvent[],
    serverDraftRevision: number,
    serverBasedOnVersionId: string | null,
  ): {
    comments: CommentItem[];
    changeEvents: DirectEditEvent[];
    composerDraft: string;
    composerCommentId: string | null;
    composerAttachments: CommentAttachment[];
    composerTarget: HtmlCanvasSelection | null;
  } => {
    const keys = [
      `html-ai-draft-recovery:${context.documentId}`,
      `html-ai-draft-recovery:${context.sourcePath}`,
    ];
    let latest: Record<string, unknown> | null = null;
    try {
      for (const key of keys) {
        const serialized = window.localStorage.getItem(key);
        if (!serialized) continue;
        const parsed = JSON.parse(serialized);
        if (
          !isRecord(parsed)
          || String(parsed.sourcePath || "") !== context.sourcePath
          || (parsed.documentId && String(parsed.documentId) !== context.documentId)
          || String(parsed.projectId || "") !== context.projectId
          || String(parsed.documentId || "") !== context.documentId
          || Number(parsed.baseDraftRevision) !== serverDraftRevision
          || String(parsed.basedOnVersionId || "")
            !== String(serverBasedOnVersionId || "")
        ) continue;
        if (
          !latest
          || Number(parsed.localSequence || 0) > Number(latest.localSequence || 0)
        ) latest = parsed;
      }
    } catch {
      latest = null;
    }
    if (!latest) {
      return {
        comments: serverComments,
        changeEvents: serverEvents,
        composerDraft: "",
        composerCommentId: null,
        composerAttachments: [],
        composerTarget: null,
      };
    }
    const localComments = Array.isArray(latest.comments)
      ? commentsFromRecords(latest.comments)
      : [];
    const deletedCommentIds = new Set(
      Array.isArray(latest.deletedCommentIds)
        ? latest.deletedCommentIds.map((value) => String(value))
        : [],
    );
    deletedCommentIdsRef.current = deletedCommentIds;
    const commentsById = new Map(
      serverComments.map((comment) => [comment.commentId, comment]),
    );
    for (const comment of localComments) {
      const serverComment = commentsById.get(comment.commentId);
      if (
        !serverComment
        || String(comment.updatedAt || comment.createdAt)
          >= String(serverComment.updatedAt || serverComment.createdAt)
      ) {
        commentsById.set(comment.commentId, comment);
      }
    }
    for (const commentId of deletedCommentIds) commentsById.delete(commentId);
    const eventsById = new Map(
      serverEvents.map((event) => [event.eventId, event]),
    );
    for (const event of Array.isArray(latest.changeEvents)
      ? changesFromRecords(latest.changeEvents)
      : []) {
      eventsById.set(event.eventId, event);
    }
    return {
      comments: [...commentsById.values()],
      changeEvents: [...eventsById.values()],
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
    };
  }, []);

  const refreshWorkspace = useCallback(async (
    sourceOverride?: string | null,
    epochOverride?: number,
    fromDeferred = false,
    sourceTransitionToken?: number,
  ) => {
    if (!fromDeferred) {
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
    let activeSource = sourceOverride === undefined ? sourcePathRef.current : sourceOverride;
    if (!activeSource) {
      setBridgeConnected(null);
      return;
    }
    let epoch = epochOverride ?? projectEpochRef.current;
    const hydrationSourceTransitionAuthorized =
      sourceTransitionToken !== undefined
      && sourceTransitionToken === epoch
      && sourceTransitionToken === projectEpochRef.current
      && projectHydratingRef.current;
    let sourceBoundaryFrozen = false;
    let mustAdoptAuthoritativeSource = hydrationSourceTransitionAuthorized;
    let recoveredAutosaveConflict = false;
    try {
      if (projectHydratingRef.current && !hydrationSourceTransitionAuthorized) {
        throw new Error("这次项目读取缺少与当前项目一致的源码切换令牌。");
      }
      const url = new URL(`${BRIDGE_URL}/workspace`);
      url.searchParams.set("sourcePath", activeSource);
      const response = await bridgeFetch(
        url,
        { cache: "no-store" },
        BRIDGE_STATE_READ_TIMEOUT_MS,
      );
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "本地项目记录不可用。");
      if (
        epoch !== projectEpochRef.current
        || !sameLocalSourcePath(sourcePathRef.current, activeSource)
      ) return;

      const nextProjectId = String(payload.projectId || "");
      const nextDocumentId = String(payload.documentId || "");
      const canonicalSourcePath = String(
        payload.sourcePath
        || (isRecord(payload.current) ? payload.current.path : "")
        || activeSource,
      );
      if (canonicalSourcePath !== activeSource) {
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
        const adoptedContext = await adoptGeneratedSourcePath({
          previousSourcePath: activeSource,
          nextSourcePath: canonicalSourcePath,
          expectedSha256,
          nextProjectId,
          nextDocumentId,
          versionId,
        });
        if (!adoptedContext) return;
        activeSource = adoptedContext.sourcePath;
        epoch = adoptedContext.epoch;
        mustAdoptAuthoritativeSource = true;
      }
      if (
        epoch !== projectEpochRef.current
        || !sameLocalSourcePath(sourcePathRef.current, activeSource)
      ) return;
      recoveryIdentityRef.current =
        recoveryIdentityFromRecord(payload.recoveryIdentity);
      projectIdRef.current = nextProjectId;
      documentIdRef.current = nextDocumentId;
      setProjectId(nextProjectId);
      setDocumentId(nextDocumentId);
      setVersions(versionsFromWorkspace(payload));
      setLatestVersionId(payload.latestVersionId ? String(payload.latestVersionId) : null);
      setCurrentBasedOnVersionId(
        payload.currentBasedOnVersionId ? String(payload.currentBasedOnVersionId) : null,
      );
      setCurrentExactVersionId(
        payload.currentExactVersionId ? String(payload.currentExactVersionId) : null,
      );
      const projectRecord = isRecord(payload.project) ? payload.project : {};
      const workspacePaths = isRecord(payload.paths) ? payload.paths : {};
      if (projectRecord.name) setProjectName(String(projectRecord.name));
      setProjectRecordsPath(
        String(
          workspacePaths.projectRecords
          || payload.projectRoot
          || "",
        ) || null,
      );
      setRestoredFromVersionId(
        payload.restoredFromVersionId
          ? String(payload.restoredFromVersionId)
          : projectRecord.restoredFromVersionId
            ? String(projectRecord.restoredFromVersionId)
            : null,
      );
      const workspaceHash = String(payload.currentHtmlSha256 || "");
      let authoritativeSourceHash = workspaceHash;
      if (mustAdoptAuthoritativeSource) {
        const sourceUrl = new URL(`${BRIDGE_URL}/source`);
        sourceUrl.searchParams.set("sourcePath", activeSource);
        const sourceResponse = await bridgeFetch(
          sourceUrl,
          { cache: "no-store" },
          BRIDGE_STATE_READ_TIMEOUT_MS,
        );
        const sourcePayload = await readJsonResponse(sourceResponse);
        if (!sourceResponse.ok) {
          throw responseError(sourcePayload, "无法核对打开项目的最新源 HTML。");
        }
        if (
          String(sourcePayload.projectId || "") !== nextProjectId
          || String(sourcePayload.documentId || "") !== nextDocumentId
        ) {
          throw new Error("读取期间源文件身份发生变化，已保持只读；请重新打开该文件。");
        }
        const authoritativeHtml = String(sourcePayload.content || "");
        authoritativeSourceHash = String(sourcePayload.sha256 || "");
        if (
          !authoritativeSourceHash
          || await browserSha256(authoritativeHtml) !== authoritativeSourceHash
        ) {
          throw new Error("源 HTML 内容与服务端 Hash 不一致，已拒绝开放编辑。");
        }
        htmlRef.current = authoritativeHtml;
        sourceShaRef.current = authoritativeSourceHash;
        setHtml(authoritativeHtml);
        setSourceSha256(authoritativeSourceHash);
        setRenderedContentSha256(null);
        setLastModifiedAt(String(sourcePayload.lastModifiedAt || payload.lastModifiedAt || ""));
        setCurrentBasedOnVersionId(
          sourcePayload.currentBasedOnVersionId
            ? String(sourcePayload.currentBasedOnVersionId)
            : payload.currentBasedOnVersionId
              ? String(payload.currentBasedOnVersionId)
              : null,
        );
        setCurrentExactVersionId(
          sourcePayload.currentExactVersionId
            ? String(sourcePayload.currentExactVersionId)
            : null,
        );
        setRestoredFromVersionId(
          sourcePayload.restoredFromVersionId
            ? String(sourcePayload.restoredFromVersionId)
            : payload.restoredFromVersionId
              ? String(payload.restoredFromVersionId)
              : null,
        );
      } else if (workspaceHash) {
        sourceShaRef.current = workspaceHash;
        setSourceSha256(workspaceHash);
      }
      if (!mustAdoptAuthoritativeSource && payload.lastModifiedAt) {
        setLastModifiedAt(String(payload.lastModifiedAt));
      }

      const runtime = isRecord(payload.runtimeState) ? payload.runtimeState : {};
      const runtimeConflict = isRecord(runtime.conflict) ? runtime.conflict : null;
      const edit = isRecord(runtime.edit) ? runtime.edit : {};
      const serverRevision = Number(runtime.editRevision || edit.editRevision || 0);
      const serverPersistedRevision = Number(
        runtime.lastPersistedRevision
        || edit.lastPersistedRevision
        || serverRevision,
      );
      editRevisionRef.current = Math.max(editRevisionRef.current, serverRevision);
      lastPersistedRevisionRef.current = Math.max(
        lastPersistedRevisionRef.current,
        serverPersistedRevision,
      );
      setEditRevision(editRevisionRef.current);
      setLastPersistedRevision(lastPersistedRevisionRef.current);

      const draftRecord = isRecord(runtime.draft)
        ? runtime.draft
        : isRecord(payload.activeDraft)
          ? payload.activeDraft
          : {};
      const serverDraftRevision = Number(draftRecord.draftRevision || 0);
      draftRevisionRef.current =
        Number.isSafeInteger(serverDraftRevision) && serverDraftRevision >= 0
          ? serverDraftRevision
          : 0;
      const recoveredDraft = recoverDraftLog(
        {
          epoch,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          sourcePath: activeSource,
        },
        commentsFromRecords(draftRecord.comments),
        changesFromRecords(draftRecord.changeEvents),
        draftRevisionRef.current,
        payload.currentBasedOnVersionId
          ? String(payload.currentBasedOnVersionId)
          : null,
      );
      const recoveredCommentTargets = rebindTargetsPreservingGlobal(
        htmlRef.current,
        recoveredDraft.comments.map((comment) => comment.target),
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
      const recoveredEvents = recoveredDraft.changeEvents;
      setComments(recoveredComments);
      commentsRef.current = recoveredComments;
      changeEventsRef.current = recoveredEvents;
      setChangeEvents(recoveredEvents);
      composerDraftRef.current = recoveredDraft.composerDraft;
      composerCommentIdRef.current = recoveredDraft.composerCommentId;
      composerAttachmentsRef.current = recoveredDraft.composerAttachments;
      const recoveredComposerTarget = recoveredDraft.composerTarget
        ? recoveredTargetById.get(recoveredDraft.composerTarget.id)
          || rebindTargetsPreservingGlobal(
            htmlRef.current,
            [recoveredDraft.composerTarget],
          )[0]
        : null;
      draftTargetRef.current = recoveredComposerTarget;
      setDraft(recoveredDraft.composerDraft);
      setDraftCommentId(recoveredDraft.composerCommentId);
      setDraftAttachments(recoveredDraft.composerAttachments);
      setDraftTarget(recoveredComposerTarget);
      setComposerOpen(false);

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
      if (recoveredRun && isLockedLifecycle(recoveredRun.status)) {
        setActiveRun(recoveredRun);
        setProjectLocked(true);
        projectLockedRef.current = true;
        backgroundRunsRef.current.set(activeSource, recoveredRun);
      } else {
        setActiveRun(null);
        backgroundRunsRef.current.delete(activeSource);
        setProjectLocked(false);
        projectLockedRef.current = false;
        if (!sourceBoundaryFrozen && !projectHydratingRef.current) {
          editorRef.current?.unlockNow?.();
        }
      }
      if (hydrationSourceTransitionAuthorized && authoritativeSourceHash) {
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
          const conflictUrl = new URL(`${BRIDGE_URL}/conflict-candidate`);
          conflictUrl.searchParams.set("sourcePath", activeSource);
          const conflictResponse = await bridgeFetch(
            conflictUrl,
            { cache: "no-store" },
            BRIDGE_STATE_READ_TIMEOUT_MS,
          );
          const conflictPayload = await readJsonResponse(conflictResponse);
          if (conflictResponse.ok && typeof conflictPayload.content === "string") {
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
              recoveryIdentity: recoveryIdentityRef.current,
            };
            pendingWriteRef.current = conflictWrite;
            editRevisionRef.current = revision;
            htmlRef.current = candidateHtml;
            setEditRevision(revision);
            setHtml(candidateHtml);
            setCurrentExactVersionId(null);
            setRenderedContentSha256(null);
            persistRecoveryLog(conflictWrite, context);
          }
          recoveredAutosaveConflict = true;
        }
      }
      if (mustAdoptAuthoritativeSource) {
        const expectedCanvasHtml = htmlRef.current;
        const expectedCanvasHash = await browserSha256(expectedCanvasHtml);
        await verifyCanvasRendered(expectedCanvasHtml, expectedCanvasHash, {
          epoch,
          projectId: nextProjectId,
          documentId: nextDocumentId,
          sourcePath: activeSource,
        });
        if (
          epoch !== projectEpochRef.current
          || !sameLocalSourcePath(sourcePathRef.current, activeSource)
        ) return;
      }
      if (recoveredAutosaveConflict) {
        const frozen = fenceAndFreezeCurrentCanvas(
          "冲突候选已恢复，但编辑画布尚未就绪。",
        );
        if (!frozen.ok) {
          throw new Error(frozen.reason || "无法冻结已恢复的冲突候选。");
        }
        persistStateRef.current = "conflict";
        setPersistState("conflict");
        setPersistError(
          "源 HTML 在自动写回前被外部修改。工作台候选和外部文件均已保留，请比较后重新载入或导出当前编辑。",
        );
      }
      projectHydratingRef.current = false;
      projectLoadErrorRef.current = null;
      setProjectHydrating(false);
      setProjectLoadError(null);
      setBridgeConnected(true);
      if (sourceBoundaryFrozen && !recoveredAutosaveConflict && !projectLockedRef.current) {
        window.requestAnimationFrame(() => editorRef.current?.unlockNow?.());
      }
    } catch (cause) {
      if (epoch === projectEpochRef.current) {
        const message = productErrorMessage(
          cause,
          "项目状态读取超时，请重试；源文件没有被改动。",
        );
        projectHydratingRef.current = false;
        projectLoadErrorRef.current = message;
        setProjectHydrating(false);
        setProjectLoadError(message);
        setRenderedContentSha256(null);
        setBridgeConnected(false);
      }
    }
  }, [
    adoptGeneratedSourcePath,
    deferEditorCommand,
    fenceAndFreezeCurrentCanvas,
    isCurrentProjectContext,
    persistRecoveryLog,
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
      const url = new URL(`${BRIDGE_URL}/workspace`);
      url.searchParams.set("sourcePath", recentSourcePath);
      const response = await bridgeFetch(url, { cache: "no-store" });
      const payload = await readJsonResponse(response);
      if (!response.ok) return;
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
      if (recoveredRun && isLockedLifecycle(recoveredRun.status)) {
        backgroundRunsRef.current.set(recentSourcePath, recoveredRun);
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
        setBridgeConnected(null);
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
            const epoch = projectEpochRef.current;
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
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        projectMenuRef.current?.contains(target)
        || projectSwitcherRef.current?.contains(target)
      ) return;
      setProjectMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setProjectMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    if (noticeTimerPaused) return;
    const dismissAfter = noticeAutoDismissMs(toast);
    if (dismissAfter === null) return;
    const timeout = window.setTimeout(() => setToast(null), dismissAfter);
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

  const flushDraftPersistence = useCallback(async (
    snapshot?: PendingDraft,
  ): Promise<boolean> => {
    if (snapshot) draftPendingRef.current = snapshot;
    if (draftFlushPromiseRef.current) {
      const previous = await draftFlushPromiseRef.current;
      if (!previous) return false;
      if (!draftPendingRef.current) return true;
    }
    const run = async () => {
      while (draftPendingRef.current) {
        const write = draftPendingRef.current;
        draftPendingRef.current = null;
        if (!write.projectId || !write.documentId) {
          persistDraftRecovery(write);
          continue;
        }
        try {
          const response = await bridgeFetch(`${BRIDGE_URL}/draft`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              projectId: write.projectId,
              documentId: write.documentId,
              sourcePath: write.sourcePath,
              expectedDraftRevision: write.expectedDraftRevision,
              basedOnVersionId: write.basedOnVersionId,
              comments: write.comments.map(persistedComment),
              changeEvents: write.changeEvents.map(persistedChangeEvent),
            }),
          });
          const payload = await readJsonResponse(response);
          if (!response.ok) throw responseError(payload, "本轮评论暂时无法记录。");
          if (isCurrentProjectContext(write)) {
            const activeDraft = isRecord(payload.activeDraft)
              ? payload.activeDraft
              : {};
            const acknowledgedDraftRevision = Number(activeDraft.draftRevision);
            if (
              !Number.isSafeInteger(acknowledgedDraftRevision)
              || acknowledgedDraftRevision <= write.expectedDraftRevision
            ) {
              throw new Error("草稿保存返回了不完整或过期的 revision。");
            }
            draftRevisionRef.current = acknowledgedDraftRevision;
            const queuedDraft = draftPendingRef.current as PendingDraft | null;
            if (queuedDraft) {
              draftPendingRef.current = {
                ...queuedDraft,
                expectedDraftRevision: acknowledgedDraftRevision,
              };
            }
            setDraftPersistError("");
            setBridgeConnected(true);
            if (!draftPendingRef.current) {
              deletedCommentIdsRef.current.clear();
              persistDraftRecovery({
                ...write,
                expectedDraftRevision: acknowledgedDraftRevision,
              });
            }
          }
        } catch (cause) {
          if (isCurrentProjectContext(write) && !projectLockedRef.current) {
            draftPendingRef.current = write;
            setDraftPersistError(
              productErrorMessage(cause, "本轮评论暂时无法记录，请重试。"),
            );
            setBridgeConnected(false);
          }
          return false;
        }
      }
      return true;
    };
    const promise = run();
    draftFlushPromiseRef.current = promise;
    try {
      return await promise;
    } finally {
      if (draftFlushPromiseRef.current === promise) draftFlushPromiseRef.current = null;
    }
  }, [isCurrentProjectContext, persistDraftRecovery]);

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
    const activeSource = sourcePathRef.current;
    if (!activeSource) throw new Error("当前评论还没有绑定本地项目。");
    const url = new URL(`${BRIDGE_URL}/attachment`);
    url.searchParams.set("sourcePath", activeSource);
    url.searchParams.set("relativePath", attachment.relativePath);
    const response = await bridgeFetch(url, { cache: "no-store" });
    if (!response.ok) {
      const payload = await readJsonResponse(response);
      throw responseError(payload, "无法读取评论附件。");
    }
    return new Blob([await response.arrayBuffer()], {
      type: attachment.mediaType || "application/octet-stream",
    });
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
  ) => {
    const activeSource = sourcePathRef.current;
    if (!activeSource) return;
    try {
      const response = await bridgeFetch(`${BRIDGE_URL}/attachment/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: projectIdRef.current,
          documentId: documentIdRef.current,
          sourcePath: activeSource,
          relativePath: attachment.relativePath,
        }),
      });
      if (!response.ok) {
        const payload = await readJsonResponse(response);
        throw responseError(payload, "无法删除评论附件。");
      }
    } catch (cause) {
      setToast({
        title: "附件已从评论移除",
        message: productErrorMessage(cause, "项目中的附件副本暂时无法清理。"),
        tone: "warning",
        dedupeKey: `attachment-cleanup-${attachment.attachmentId}`,
      });
    }
  }, []);

  const removeComposerAttachment = useCallback((attachment: CommentAttachment) => {
    const next = composerAttachmentsRef.current.filter(
      (item) => item.attachmentId !== attachment.attachmentId,
    );
    composerAttachmentsRef.current = next;
    setDraftAttachments(next);
    forgetAttachmentObjectUrl(attachment.attachmentId);
    persistCurrentDraftRecovery();
    void deleteAttachmentFile(attachment);
  }, [deleteAttachmentFile, forgetAttachmentObjectUrl, persistCurrentDraftRecovery]);

  const removeCommentAttachment = useCallback((
    commentId: string,
    attachment: CommentAttachment,
  ) => {
    const nextComments = commentsRef.current.map((comment) => (
      comment.commentId === commentId
        ? {
            ...comment,
            attachments: (comment.attachments ?? []).filter(
              (item) => item.attachmentId !== attachment.attachmentId,
            ),
            updatedAt: new Date().toISOString(),
          }
        : comment
    ));
    commentsRef.current = nextComments;
    setComments(nextComments);
    forgetAttachmentObjectUrl(attachment.attachmentId);
    persistCurrentDraftRecovery(nextComments);
    void deleteAttachmentFile(attachment);
  }, [deleteAttachmentFile, forgetAttachmentObjectUrl, persistCurrentDraftRecovery]);

  const uploadAttachments = useCallback(async (
    files: File[],
    target: { kind: "composer" | "comment"; commentId: string },
    source: "clipboard" | "file-picker",
  ) => {
    if (files.length === 0) return;
    const targetIsOpen = target.kind === "composer"
      ? composerCommentIdRef.current === target.commentId
      : commentsRef.current.some((comment) => comment.commentId === target.commentId);
    if (!targetIsOpen) {
      setToast({
        title: "附件没有加入",
        message: "这条评论已经关闭。请重新打开评论后再选择附件。",
        tone: "warning",
        sticky: true,
        dedupeKey: `attachment-target-closed-${target.commentId}`,
      });
      return;
    }
    const existingCount = target.kind === "composer"
      ? composerAttachmentsRef.current.length
      : commentsRef.current.find((comment) => comment.commentId === target.commentId)
          ?.attachments?.length ?? 0;
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
    if (attachmentPlan.invalid.length === 1) {
      const invalidFile = attachmentPlan.invalid[0];
      issueNotes.push(`${invalidFile.name || "未命名文件"} 为空或超过 25 MB`);
    } else if (attachmentPlan.invalid.length > 1) {
      issueNotes.push(`${attachmentPlan.invalid.length} 个文件为空或超过 25 MB`);
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
        dedupeKey: `attachment-batch-${target.commentId}`,
        action: attachmentRecoveryAction(needsRemoval),
      });
      return;
    }
    const activeSource = sourcePathRef.current;
    if (!activeSource) {
      if (typeof window !== "undefined" && !window.htmlAIProjects) {
        const previewAttachments = selected.map((file) => {
          const attachmentId = recordId("attachment", attachmentCounter.current++);
          const attachment: CommentAttachment = {
            attachmentId,
            kind: isImageFile(file) ? "image" : "file",
            fileName: file.name || "附件",
            mediaType: file.type || "application/octet-stream",
            byteLength: file.size,
            sha256: `preview:${attachmentId}`,
            relativePath: `preview/${attachmentId}/${file.name || "attachment"}`,
            source,
          };
          if (attachment.kind === "image") {
            rememberAttachmentObjectUrl(attachmentId, URL.createObjectURL(file));
          }
          return attachment;
        });
        if (previewAttachments.length > 0 && target.kind === "composer") {
          const next = [...composerAttachmentsRef.current, ...previewAttachments];
          composerAttachmentsRef.current = next;
          setDraftAttachments(next);
          addedAttachmentCount = previewAttachments.length;
        } else if (previewAttachments.length > 0) {
          const nextComments = commentsRef.current.map((comment) => (
            comment.commentId === target.commentId
              ? {
                  ...comment,
                  attachments: [...(comment.attachments ?? []), ...previewAttachments],
                  updatedAt: new Date().toISOString(),
                }
              : comment
          ));
          commentsRef.current = nextComments;
          setComments(nextComments);
          addedAttachmentCount = previewAttachments.length;
        }
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
              dedupeKey: `attachment-batch-${target.commentId}`,
            action: attachmentRecoveryAction(needsRemoval),
          });
        }
        return;
      }
      setToast({
        title: "请先打开本地 HTML",
        message: "附件需要保存在当前项目记录中；打开 HTML 后即可添加。",
        tone: "warning",
        dedupeKey: "submit-blocked",
        action: { id: "retry-project-open", label: "打开本地 HTML" },
      });
      return;
    }
    try {
      const registered = await ensureProjectRegistered(activeSource);
      if (!registered) throw new Error("当前项目已经切换，请重试。");
    } catch (cause) {
      setToast({
        title: "附件尚未加入",
        message: productErrorMessage(
          cause,
          "项目资料暂时无法建立；附件没有丢失，请重试选择。",
        ),
        tone: "warning",
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
      setAttachmentUploadCount((count) => count + 1);
      try {
        const attachmentId = recordId("attachment", attachmentCounter.current++);
        const response = await bridgeFetch(`${BRIDGE_URL}/attachment`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: projectIdRef.current,
            documentId: documentIdRef.current,
            sourcePath: activeSource,
            commentId: target.commentId,
            attachmentId,
            fileName: file.name || "附件",
            mediaType: file.type || "application/octet-stream",
            byteLength: file.size,
            kind: isImageFile(file) ? "image" : "file",
            source,
            dataBase64: await fileAsBase64(file),
          }),
        }, BRIDGE_ATTACHMENT_TIMEOUT_MS);
        const payload = await readJsonResponse(response);
        if (!response.ok) throw responseError(payload, "无法添加评论附件。");
        const attachment = attachmentFromRecord(
          isRecord(payload.attachment) ? payload.attachment : null,
        );
        if (!attachment) throw new Error("附件已写入，但返回的记录不完整。");
        if (target.kind === "composer") {
          if (composerCommentIdRef.current !== target.commentId) {
            void deleteAttachmentFile(attachment);
            throw new Error("这条评论已经关闭。请重新打开评论后再选择附件。");
          }
          if (attachment.kind === "image") {
            rememberAttachmentObjectUrl(
              attachment.attachmentId,
              URL.createObjectURL(file),
            );
          }
          const next = [...composerAttachmentsRef.current, attachment];
          composerAttachmentsRef.current = next;
          setDraftAttachments(next);
          persistCurrentDraftRecovery();
          addedAttachmentCount += 1;
        } else {
          if (!commentsRef.current.some((comment) => comment.commentId === target.commentId)) {
            void deleteAttachmentFile(attachment);
            throw new Error("这条评论已经关闭。请重新打开评论后再选择附件。");
          }
          if (attachment.kind === "image") {
            rememberAttachmentObjectUrl(
              attachment.attachmentId,
              URL.createObjectURL(file),
            );
          }
          const nextComments = commentsRef.current.map((comment) => (
            comment.commentId === target.commentId
              ? {
                  ...comment,
                  attachments: [...(comment.attachments ?? []), attachment],
                  updatedAt: new Date().toISOString(),
                }
              : comment
          ));
          commentsRef.current = nextComments;
          setComments(nextComments);
          persistCurrentDraftRecovery(nextComments);
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
        setAttachmentUploadCount((count) => Math.max(0, count - 1));
      }
    }
    if (failedNames.length > 0) {
      issueNotes.push(`${failedNames.join("、")} 未加入评论`);
    }
    if (issueNotes.length > 0) {
      const targetStillOpen = target.kind === "composer"
        ? composerCommentIdRef.current === target.commentId
        : commentsRef.current.some((comment) => comment.commentId === target.commentId);
      const currentAttachmentCount = target.kind === "composer"
        ? composerAttachmentsRef.current.length
        : commentsRef.current.find((comment) => comment.commentId === target.commentId)
            ?.attachments?.length ?? 0;
      const needsRemoval = attachmentPlan.overLimit.length > 0
        && currentAttachmentCount >= MAX_COMMENT_ATTACHMENTS;
      setToast({
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
        tone: failedNames.length > 0 ? "error" : "warning",
        sticky: true,
        dedupeKey: `attachment-batch-${target.commentId}`,
        ...(targetStillOpen ? {
          action: attachmentRecoveryAction(needsRemoval),
        } : {}),
      });
    }
  }, [
    deleteAttachmentFile,
    ensureProjectRegistered,
    persistCurrentDraftRecovery,
    rememberAttachmentObjectUrl,
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
        dedupeKey: `attachment-preview-${attachment.attachmentId}`,
        action: {
          id: "retry-attachment-preview",
          label: "重新预览",
          attachment,
        },
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
        dedupeKey: `attachment-download-${attachment.attachmentId}`,
        action: {
          id: "retry-attachment-download",
          label: "重新下载",
          attachment,
        },
      });
    }
  }, [attachmentBlob]);

  useEffect(() => {
    if (
      !sourcePath
      || !projectId
    ) return;
    const snapshot: PendingDraft = {
      epoch: projectEpochRef.current,
      projectId,
      documentId,
      sourcePath,
      basedOnVersionId: currentBasedOnVersionId,
      expectedDraftRevision: draftRevisionRef.current,
      comments,
      changeEvents,
    };
    persistDraftRecovery(snapshot);
    if (projectLockedRef.current || projectLocked || projectHydrating) return;
    void flushDraftPersistence(snapshot);
  }, [
    changeEvents,
    comments,
    currentBasedOnVersionId,
    documentId,
    flushDraftPersistence,
    persistDraftRecovery,
    projectHydrating,
    projectId,
    projectLocked,
    sourcePath,
  ]);

  useEffect(() => {
    if (!sourcePath || !projectId) return;
    persistDraftRecovery({
      epoch: projectEpochRef.current,
      projectId,
      documentId,
      sourcePath,
      basedOnVersionId: currentBasedOnVersionId,
      expectedDraftRevision: draftRevisionRef.current,
      comments: [...commentsRef.current],
      changeEvents: [...changeEventsRef.current],
    });
  }, [
    currentBasedOnVersionId,
    documentId,
    draft,
    draftAttachments,
    draftCommentId,
    draftTarget,
    persistDraftRecovery,
    projectId,
    sourcePath,
  ]);

  useEffect(() => {
    const handlePrepareClose = (event: Event) => {
      const detail = (event as CustomEvent<PrepareCloseDetail>).detail;
      if (!detail || typeof detail.waitUntil !== "function") return;

      const prepare = async (): Promise<CloseReadiness> => {
        let imposedEditorFreeze = false;
        let frozenSourceSha256: string | null = null;
        let ready = false;
        closePreparationRequestRef.current = detail.requestId;
        const beforeDeadline = async <T,>(work: Promise<T>, label: string): Promise<T> => {
          const remaining = Math.max(0, detail.deadlineAt - Date.now() - 250);
          if (remaining === 0) throw new Error(`${label}超时。`);
          let timer = 0;
          try {
            return await Promise.race([
              work,
              new Promise<T>((_resolve, reject) => {
                timer = window.setTimeout(() => reject(new Error(`${label}超时。`)), remaining);
              }),
            ]);
          } finally {
            if (timer) window.clearTimeout(timer);
          }
        };

        try {
          if (projectHydratingRef.current) {
            if (canCloseDuringHydration({
              projectHydrating: true,
              viewTransitioning: viewTransitioningRef.current,
              submissionPending: submissionPendingRef.current,
              persistState: persistStateRef.current,
              pendingWrite: Boolean(pendingWriteRef.current),
              flushInProgress: Boolean(flushPromiseRef.current),
              draftPending: Boolean(draftPendingRef.current),
              draftFlushInProgress: Boolean(draftFlushPromiseRef.current),
              editRevision: editRevisionRef.current,
              lastPersistedRevision: lastPersistedRevisionRef.current,
            })) {
              ready = true;
              return { ready: true };
            }
            return { ready: false, reason: "项目状态尚未读取完成，已取消关闭以避免覆盖未知编辑状态。" };
          }
          if (viewTransitioningRef.current) {
            return { ready: false, reason: "正在核对历史或当前 HTML，请等待本次切换完成后再关闭。" };
          }
          if (projectLoadErrorRef.current) {
            if (pendingWriteRef.current || flushPromiseRef.current) {
              return { ready: false, reason: "项目读取失败且仍有待恢复的 HTML 修改，请先重试读取或导出副本。" };
            }
            return { ready: true };
          }

          if (submissionIntentRef.current) {
            await beforeDeadline((async () => {
              while (submissionIntentRef.current) {
                await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
              }
            })(), "等待本轮提交准备结束");
          }

          if (submissionPendingRef.current) {
            await beforeDeadline((async () => {
              while (submissionPendingRef.current) {
                await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
              }
            })(), "等待冻结任务安全写入");
          }

          if (viewMode !== "history" && !projectLockedRef.current) {
            const frozen = editorRef.current?.freezeNow();
            if (!frozen) {
              return { ready: false, reason: "编辑画布尚未就绪，已取消关闭以避免丢失文字草稿。" };
            }
            if (!frozen.ok) {
              return {
                ready: false,
                reason: frozen.reason || "当前文字草稿无法安全提交，已取消关闭。",
              };
            }
            imposedEditorFreeze = true;
            frozenSourceSha256 = frozen.sourceSha256;
            closeFreezeRequestRef.current = detail.requestId;
            if (
              frozen.html !== htmlRef.current
              && (Boolean(sourcePathRef.current) || Boolean(frozen.pendingMutation))
            ) {
              enqueueAutosave(frozen.html, frozen.pendingMutation || undefined);
            }
          }

          if (!sourcePathRef.current && editRevisionRef.current > 0) {
            return { ready: false, reason: "当前编辑尚未绑定本地 HTML，请先导出或打开本地文件。" };
          }
          if (persistState === "conflict") {
            return { ready: false, reason: "当前 HTML 与外部文件存在冲突，请先选择保留哪一份。" };
          }

          const cutoffRevision = editRevisionRef.current;
          if (pendingWriteRef.current || flushPromiseRef.current || cutoffRevision > lastPersistedRevisionRef.current) {
            const autosaveOk = await beforeDeadline(
              flushAutosave(cutoffRevision),
              "等待当前 HTML 写回",
            );
            if (!autosaveOk || pendingWriteRef.current || flushPromiseRef.current) {
              return { ready: false, reason: "当前 HTML 仍有修改尚未安全写回源文件。" };
            }
          }
          if (
            imposedEditorFreeze
            && sourcePathRef.current
            && (
              lastPersistedRevisionRef.current !== cutoffRevision
              || !frozenSourceSha256
              || sourceShaRef.current !== frozenSourceSha256
            )
          ) {
            return { ready: false, reason: "关闭前冻结的 HTML 与已写回源文件不一致。" };
          }

          const context = captureProjectContext();
          if (context) {
            const snapshot: PendingDraft = {
              ...context,
              basedOnVersionId: currentBasedOnVersionId,
              expectedDraftRevision: draftRevisionRef.current,
              comments: [...commentsRef.current],
              changeEvents: [...changeEventsRef.current],
            };
            persistDraftRecovery(snapshot);
            if (!projectLockedRef.current) {
              const draftOk = await beforeDeadline(
                flushDraftPersistence(snapshot),
                "等待评论记录写入",
              );
              if (!draftOk || draftPendingRef.current || draftFlushPromiseRef.current) {
                return { ready: false, reason: "本轮评论或编辑审计仍未安全记录。" };
              }
            }
          }

          if (submissionIntentRef.current || submissionPendingRef.current) {
            return { ready: false, reason: "内部 AI 的冻结 Request 尚未安全建立。" };
          }
          if (abortedCloseRequestsRef.current.has(detail.requestId)) {
            return { ready: false, reason: "桌面外壳已取消本次关闭。" };
          }
          ready = true;
          return { ready: true };
        } catch (cause) {
          return {
            ready: false,
            reason: cause instanceof Error ? cause.message : "关闭前安全写入检查失败。",
          };
        } finally {
          if (closePreparationRequestRef.current === detail.requestId) {
            closePreparationRequestRef.current = null;
          }
          if (!ready && imposedEditorFreeze && !projectLockedRef.current) {
            if (closeFreezeRequestRef.current === detail.requestId) {
              closeFreezeRequestRef.current = null;
            }
            editorRef.current?.unlockNow?.();
          }
          abortedCloseRequestsRef.current.delete(detail.requestId);
        }
      };

      // The desktop shell only accepts checks registered synchronously during dispatch.
      detail.waitUntil(prepare());
    };

    window.addEventListener("html-ai:prepare-close", handlePrepareClose);
    return () => window.removeEventListener("html-ai:prepare-close", handlePrepareClose);
  }, [
    captureProjectContext,
    currentBasedOnVersionId,
    enqueueAutosave,
    flushAutosave,
    flushDraftPersistence,
    persistDraftRecovery,
    persistState,
    viewMode,
  ]);

  useEffect(() => {
    const handleCloseAborted = (event: Event) => {
      const detail = (event as CustomEvent<CloseAbortedDetail>).detail;
      if (!detail || typeof detail.requestId !== "string") return;
      abortedCloseRequestsRef.current.add(detail.requestId);

      // An in-flight readiness check owns its freeze and will release it in
      // `finally`; waiting avoids unlocking while a write is still draining.
      if (closePreparationRequestRef.current === detail.requestId) return;
      if (closeFreezeRequestRef.current !== detail.requestId) return;

      const mayRecover = shouldRecoverEditorAfterCloseAbort({
        approvedRequestId: closeFreezeRequestRef.current,
        abortedRequestId: detail.requestId,
        imposedEditorFreeze: true,
        projectLocked: projectLockedRef.current,
        projectHydrating: projectHydratingRef.current,
        projectLoadError: Boolean(projectLoadErrorRef.current),
        viewTransitioning: viewTransitioningRef.current,
        submissionPending: submissionPendingRef.current,
        persistState: persistStateRef.current,
        pendingWrite: Boolean(pendingWriteRef.current),
        flushInProgress: Boolean(flushPromiseRef.current),
        draftPending: Boolean(draftPendingRef.current),
        draftFlushInProgress: Boolean(draftFlushPromiseRef.current),
        draftPersistError: Boolean(draftPersistError),
        editRevision: editRevisionRef.current,
        lastPersistedRevision: lastPersistedRevisionRef.current,
      });

      if (mayRecover) {
        closeFreezeRequestRef.current = null;
        abortedCloseRequestsRef.current.delete(detail.requestId);
        editorRef.current?.unlockNow?.();
        return;
      }
    };

    window.addEventListener("html-ai:close-aborted", handleCloseAborted);
    return () => window.removeEventListener("html-ai:close-aborted", handleCloseAborted);
  }, [draftPersistError]);

  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      const hasPendingNativeEdit =
        editorRef.current?.hasPendingNativeEdit() ?? false;
      const hasUnacknowledgedSourceRevision =
        editRevisionRef.current > lastPersistedRevisionRef.current;
      if (
        !pendingWriteRef.current
        && !draftPendingRef.current
        && !hasPendingNativeEdit
        && !hasUnacknowledgedSourceRevision
        && !draftPersistError
        && persistState !== "failed"
        && persistState !== "conflict"
        && persistState !== "preview-dirty"
      ) return;
      event.preventDefault();
      event.returnValue = "";
      if (pendingWriteRef.current && persistState !== "conflict") {
        void flushAutosave();
      }
      if (draftPendingRef.current) void flushDraftPersistence();
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [draftPersistError, flushAutosave, flushDraftPersistence, persistState]);

  const prepareProjectSwitch = useCallback(async (
    fromDeferred = false,
    retrySourcePath?: string,
  ): Promise<boolean> => {
    const retryOpenAction: ToastAction = {
      id: "retry-project-open",
      label: "继续打开",
      ...(retrySourcePath ? { sourcePath: retrySourcePath } : {}),
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
          replay((value) => resolveDeferred?.(value));
        },
        undefined,
        { onDiscard: () => resolveDeferred?.(false) },
      )) return deferredResult;
    }
    if (submissionIntentRef.current || submissionPendingRef.current) {
      setToast({
        title: "正在准备本轮任务",
        message: "当前项目完成冻结与记录后即可切换，请稍候。",
        tone: "info",
        dedupeKey: "project-switch-blocked",
        action: retryOpenAction,
      });
      return false;
    }
    if (
      fileView?.path === "PROJECT.md"
      && fileView.content !== fileView.savedContent
    ) {
      setToast({
        title: "项目规则还有未保存修改",
        message: "请先保存规则或还原修改，再切换项目。",
        tone: "warning",
        dedupeKey: "project-rules-unsaved",
        action: retryOpenAction,
      });
      return false;
    }
    if (viewTransitioningRef.current) {
      setToast({
        title: "正在核对当前画布",
        message: "本次历史或源文件切换完成后即可打开其他项目。",
        tone: "info",
        dedupeKey: "project-switch-blocked",
        action: retryOpenAction,
      });
      return false;
    }
    if (projectLoadErrorRef.current) {
      draftPendingRef.current = null;
      return true;
    }
    if (flushPromiseRef.current && !await flushPromiseRef.current) {
      setToast({
        title: "当前修改还没有安全写入",
        message: "工作台已保留编辑内容；处理保存问题后可继续打开其他项目。",
        tone: "warning",
        sticky: true,
        dedupeKey: "project-switch-persist-blocked",
        action: { id: "retry-export", label: "导出当前编辑" },
      });
      return false;
    }
    if (draftFlushPromiseRef.current && !await draftFlushPromiseRef.current) {
      setToast({
        title: "评论还没有安全记录",
        message: "评论仍保留在当前页面；记录成功后可继续打开其他项目。",
        tone: "warning",
        sticky: true,
        dedupeKey: "project-switch-persist-blocked",
        action: retryOpenAction,
      });
      return false;
    }
    if (projectLockedRef.current) return true;
    const shouldCommitCurrentCanvas = viewMode !== "history";
    const committed = shouldCommitCurrentCanvas
      ? editorRef.current?.fencePendingEdit({
          resumeEditing: false,
          trigger: "project-switch",
        })
      : null;
    if (shouldCommitCurrentCanvas && (!committed || !committed.ok)) {
      setToast({
        title: "当前文字还没有提交",
        message: committed?.reason || "编辑画布尚未就绪，请稍后再切换项目。",
        tone: "warning",
        sticky: true,
        dedupeKey: "project-switch-commit-blocked",
        action: retryOpenAction,
      });
      return false;
    }
    const switchCutoffRevision = editRevisionRef.current;
    if (
      pendingWriteRef.current
      || flushPromiseRef.current
      || switchCutoffRevision > lastPersistedRevisionRef.current
    ) {
      const ok = await flushAutosave(switchCutoffRevision);
      if (
        !ok
        || lastPersistedRevisionRef.current < switchCutoffRevision
        || (
          Boolean(sourcePathRef.current)
          && committed
          && sourceShaRef.current !== committed.sourceSha256
        )
      ) {
        setToast({
          title: "当前 HTML 还没有更新成功",
          message: "请先解决文件冲突或导出当前编辑内容，再切换项目。",
          tone: "warning",
          sticky: true,
          dedupeKey: "project-switch-persist-blocked",
          action: { id: "retry-export", label: "导出当前编辑" },
        });
        return false;
      }
    }
    if (
      editRevisionRef.current !== switchCutoffRevision
      || pendingWriteRef.current
      || flushPromiseRef.current
    ) {
      setToast({
        title: "检测到新的画布修改",
        message: "已保留刚刚发生的新编辑；确认保存后可继续打开目标项目。",
        tone: "info",
        dedupeKey: "project-switch-new-edit",
        action: retryOpenAction,
      });
      return false;
    }
    if (
      sourcePathRef.current
      && committed
      && (
        lastPersistedRevisionRef.current !== switchCutoffRevision
        || sourceShaRef.current !== committed.sourceSha256
      )
    ) {
      setToast({
        title: "当前 HTML 还没有更新成功",
        message: "画布提交结果与已写回的源文件不一致，本次不切换项目。",
        tone: "warning",
        sticky: true,
        dedupeKey: "project-switch-persist-blocked",
        action: { id: "retry-export", label: "导出当前编辑" },
      });
      return false;
    }
    const context = captureProjectContext();
    if (context) {
      const draftOk = await flushDraftPersistence({
        ...context,
        basedOnVersionId: currentBasedOnVersionId,
        expectedDraftRevision: draftRevisionRef.current,
        comments,
        changeEvents,
      });
      if (!draftOk) {
        setToast({
          title: "本轮评论还没有记录成功",
          message: "为避免评论丢失，当前项目暂不切换；请稍后重试。",
          tone: "error",
          sticky: true,
          dedupeKey: "comment-persist-error",
          action: retryOpenAction,
        });
        return false;
      }
    }
    if (!sourcePathRef.current && editRevisionRef.current > 0) {
      return window.confirm("这个浏览器预览尚未绑定本地 HTML。切换后当前修改不会保留，仍要继续吗？");
    }
    return true;
  }, [
    deferEditorCommand,
    captureProjectContext,
    changeEvents,
    comments,
    currentBasedOnVersionId,
    flushAutosave,
    flushDraftPersistence,
    fileView,
    viewMode,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.prepareProjectSwitch = (resolve) => {
      void prepareProjectSwitch(true).then(resolve, () => resolve(false));
    };
  }, [prepareProjectSwitch]);

  const openProject = useCallback(async (recentPath?: string) => {
    if (!await prepareProjectSwitch(false, recentPath)) return;
    setProjectMenuOpen(false);
    const openRequest = projectOpenRequestRef.current + 1;
    projectOpenRequestRef.current = openRequest;
    const api = window.htmlAIProjects;
    if (!api) {
      fileInputRef.current?.click();
      return;
    }
    try {
      const project = recentPath
        ? await api.openRecent(recentPath)
        : await api.openHtml();
      if (!project || openRequest !== projectOpenRequestRef.current) return;
      setStartupIssue(null);
      applyProject(project);
      const epoch = projectEpochRef.current;
      await Promise.all([
        refreshRecents(),
        refreshWorkspace(project.sourcePath, epoch, false, epoch),
      ]);
    } catch (cause) {
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
        dedupeKey: "project-open-error",
        action: {
          id: "retry-project-open",
          label: recentPath ? "重新选择位置" : "重新选择",
        },
      });
    }
  }, [applyProject, prepareProjectSwitch, refreshRecents, refreshWorkspace]);

  const showProjectInFolder = useCallback(async (requestedSourcePath?: string) => {
    const activeSourcePath = requestedSourcePath || sourcePathRef.current;
    const api = window.htmlAIProjects;
    if (!activeSourcePath || !api?.showInFolder) return;
    try {
      await api.showInFolder(activeSourcePath);
      setProjectMenuOpen(false);
    } catch (cause) {
      setToast({
        title: "无法在 Finder 中显示",
        message: productErrorMessage(
          cause,
          "源 HTML 可能已移动；当前项目仍保持打开，可以重试。",
        ),
        tone: "warning",
        dedupeKey: "show-project-in-folder-error",
        action: {
          id: "show-project",
          label: "重试",
          sourcePath: activeSourcePath,
        },
      });
    }
  }, []);

  const showProjectRecordsInFolder = useCallback(async () => {
    const activeSourcePath = sourcePathRef.current;
    if (!activeSourcePath || !projectRecordsPath) return;
    try {
      const response = await bridgeFetch(`${BRIDGE_URL}/open-folder`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourcePath: activeSourcePath }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok || payload.ok === false) {
        throw responseError(payload, "无法打开项目记录。");
      }
    } catch (cause) {
      setToast({
        title: "项目记录暂时无法打开",
        message: productErrorMessage(
          cause,
          "项目记录仍保留在本地，可以重新尝试。",
        ),
        tone: "warning",
        dedupeKey: "show-project-records-error",
        action: { id: "show-project-records", label: "重试" },
      });
    }
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
        dedupeKey: "browser-file-error",
        action: { id: "retry-project-open", label: "重新选择" },
      });
    }
  }, [applyProject, prepareProjectSwitch]);

  const handleCanvasChange = useCallback((nextHtml: string, mutation?: HtmlCanvasMutation): boolean => {
    if (
      projectLockedRef.current
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
      || persistStateRef.current === "conflict"
      || viewMode === "history"
    ) return false;
    setOpenedAiVersionNotice(null);
    const activeTargets = [
      ...commentsRef.current.map((comment) => comment.target),
      ...changeEventsRef.current.map((event) => event.target),
      ...(draftTargetRef.current ? [draftTargetRef.current] : []),
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
      const nextComments = commentsRef.current.map((comment) => ({
        ...comment,
        target: refreshedTarget(comment.target),
      }));
      commentsRef.current = nextComments;
      setComments(nextComments);
      const nextEvents = changeEventsRef.current.map((event) => ({
        ...event,
        target: refreshedTarget(event.target),
      }));
      changeEventsRef.current = nextEvents;
      setChangeEvents(nextEvents);
      const currentDraftTarget = draftTargetRef.current;
      if (currentDraftTarget) {
        const nextDraftTarget = refreshedTarget(currentDraftTarget);
        draftTargetRef.current = nextDraftTarget;
        setDraftTarget(nextDraftTarget);
      }
    }
    enqueueAutosave(nextHtml, mutation);
    void browserSha256(nextHtml).then((renderedSha256) => {
      if (htmlRef.current === nextHtml) setRenderedContentSha256(renderedSha256);
    });
    setActiveRun((run) => run?.status === "complete" ? null : run);
    return true;
  }, [enqueueAutosave, viewMode]);

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
      setToast({
        title: "副本没有导出",
        message: committed.reason
          ? `${committed.reason} 当前源 HTML 没有被改动。`
          : "这次文字还没有完整写入，请重新点选后再试。当前源 HTML 没有被改动。",
        tone: "error",
        sticky: true,
        dedupeKey: "export",
      });
      return;
    }
    const nextHtml = committed?.html
      || editorRef.current?.getSourceHtml()
      || htmlRef.current;
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
        sourcePath: sourcePathRef.current,
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
        setToast({
          title: "当前文字还没有提交",
          message: fenced?.reason || "编辑画布尚未就绪，请稍后再切换 HTML 视图。",
          tone: "warning",
          dedupeKey: "navigation-commit-blocked",
        });
        return null;
      }
      const frozen = editorRef.current?.freezeNow();
      if (!frozen || !frozen.ok) {
        setToast({
          title: "当前文字还没有提交",
          message: frozen?.reason || "编辑画布尚未就绪，请稍后再切换 HTML 视图。",
          tone: "warning",
          dedupeKey: "navigation-commit-blocked",
        });
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
    if (
      !skipConfirmation
      && !window.confirm("重新载入会舍弃尚未写回的当前编辑内容。建议先导出副本，仍要继续吗？")
    ) return;
    if (
      !fromDeferred
      && deferEditorCommand(
        "external-refresh",
        () => deferredEditorReplayRef.current.reloadCurrentSource?.(),
      )
    ) return;
    const operationId = beginNavigationOperation();
    if (operationId === null) return;
    const previousHtml = htmlRef.current;
    const previousViewMode = viewMode;
    const previousViewingVersionId = viewingVersionId;
    const previousPreserveHistory = preserveEditorHistory;
    let externalAccepted = false;
    try {
      if (persistState === "conflict") {
        const resolveResponse = await bridgeFetch(`${BRIDGE_URL}/conflict/resolve`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            projectId: context.projectId,
            documentId: context.documentId,
            sourcePath: context.sourcePath,
            action: "keep-external",
          }),
        });
        const resolvePayload = await readJsonResponse(resolveResponse);
        const resolveError = responseError(resolvePayload, "无法解除源文件冲突。");
        if (!resolveResponse.ok && resolveError.code !== "CONFLICT_NOT_FOUND") {
          throw resolveError;
        }
        externalAccepted = resolveResponse.ok;
        if (
          navigationOperationRef.current !== operationId
          || !isCurrentProjectContext(context)
        ) return;
      }
      const url = new URL(`${BRIDGE_URL}/source`);
      url.searchParams.set("sourcePath", context.sourcePath);
      const response = await bridgeFetch(url, { cache: "no-store" });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "无法重新读取源 HTML。");
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
      htmlRef.current = content;
      setHtml(content);
      setRenderedContentSha256(null);
      await verifyCanvasRendered(content, hash, context);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      pendingWriteRef.current = null;
      auditPendingRef.current = [];
      undoDraftFoldsRef.current.clear();
      redoDraftFoldsRef.current.clear();
      changeEventsRef.current = [];
      setChangeEvents([]);
      persistRecoveryLog(null, context);
      sourceShaRef.current = hash;
      setSourceSha256(hash);
      setLastModifiedAt(String(payload.lastModifiedAt || ""));
      persistStateRef.current = "idle";
      setPersistState("idle");
      setPersistError("");
      setCurrentExactVersionId(payload.currentExactVersionId ? String(payload.currentExactVersionId) : null);
      setCurrentBasedOnVersionId(
        payload.currentBasedOnVersionId
          ? String(payload.currentBasedOnVersionId)
          : currentBasedOnVersionId,
      );
      setRestoredFromVersionId(
        payload.restoredFromVersionId
          ? String(payload.restoredFromVersionId)
          : null,
      );
      setViewMode("current");
      setViewingVersionId(null);
      setPreserveEditorHistory(false);
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
          htmlRef.current = previousHtml;
          setHtml(previousHtml);
          setViewMode(previousViewMode);
          setViewingVersionId(previousViewingVersionId);
          setPreserveEditorHistory(previousPreserveHistory);
          setRenderedContentSha256(null);
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
        sticky: true,
        dedupeKey: "source-reload",
        action: { id: "retry-reload", label: "重新载入" },
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
    isCurrentProjectContext,
    persistRecoveryLog,
    persistState,
    preserveEditorHistory,
    refreshWorkspace,
    verifyCanvasRendered,
    viewingVersionId,
    viewMode,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.reloadCurrentSource = () => {
      void reloadCurrentSource(true, true);
    };
  }, [reloadCurrentSource]);

  const viewSourceConflictDiff = useCallback(async () => {
    const context = captureProjectContext();
    if (!context) return;
    const localHtml = htmlRef.current;
    try {
      const url = new URL(`${BRIDGE_URL}/source`);
      url.searchParams.set("sourcePath", context.sourcePath);
      const response = await bridgeFetch(url, { cache: "no-store" });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "无法读取外部文件。");
      if (!isCurrentProjectContext(context)) return;
      const diff = compactLineDiff(localHtml, String(payload.content || ""));
      setFileView({
        path: "源文件冲突对比",
        content: diff,
        savedContent: diff,
        loading: false,
      });
      setDrawer("files");
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      setToast({
        title: "暂时无法查看差异",
        message: productErrorMessage(cause, "外部文件没有被覆盖，请稍后重试。"),
        tone: "warning",
        dedupeKey: "source-diff",
        action: { id: "retry-source-diff", label: "重新比较" },
      });
    }
  }, [captureProjectContext, isCurrentProjectContext]);

  const viewAiConflictDiff = useCallback(async () => {
    const run = activeRun;
    const context = captureProjectContext();
    if (
      !run
      || run.status !== "awaiting-conflict-resolution"
      || !context
      || context.sourcePath !== run.sourcePath
    ) return;
    try {
      const candidateUrl = new URL(`${BRIDGE_URL}/conflict-candidate`);
      candidateUrl.searchParams.set("sourcePath", context.sourcePath);
      const sourceUrl = new URL(`${BRIDGE_URL}/source`);
      sourceUrl.searchParams.set("sourcePath", context.sourcePath);
      const [candidateResponse, sourceResponse] = await Promise.all([
        bridgeFetch(candidateUrl, { cache: "no-store" }),
        bridgeFetch(sourceUrl, { cache: "no-store" }),
      ]);
      const [candidatePayload, sourcePayload] = await Promise.all([
        readJsonResponse(candidateResponse),
        readJsonResponse(sourceResponse),
      ]);
      if (!candidateResponse.ok) {
        throw responseError(candidatePayload, "无法读取 AI 候选内容。");
      }
      if (!sourceResponse.ok) {
        throw responseError(sourcePayload, "无法读取外部源 HTML。");
      }
      if (!isCurrentProjectContext(context)) return;
      const candidate = String(candidatePayload.content || "");
      const external = String(sourcePayload.content || "");
      const candidateHash = String(
        candidatePayload.sha256
        || candidatePayload.candidateOutputSha256
        || "",
      );
      const externalHash = String(sourcePayload.sha256 || "");
      if (
        String(candidatePayload.projectId || "") !== context.projectId
        || String(candidatePayload.documentId || "") !== context.documentId
        || await browserSha256(candidate) !== candidateHash
        || await browserSha256(external) !== externalHash
        || (run.candidateOutputSha256 && candidateHash !== run.candidateOutputSha256)
        || (run.externalSourceSha256 && externalHash !== run.externalSourceSha256)
      ) {
        throw new Error("AI 候选或外部 HTML 的身份与冲突记录不一致。");
      }
      const diff = [
        `外部 HTML ${shortHash(externalHash)}  ↔  AI 候选 ${shortHash(candidateHash)}`,
        "",
        compactLineDiff(external, candidate),
      ].join("\n");
      setFileView({
        path: "外部 HTML 与 AI 候选对比",
        content: diff,
        savedContent: diff,
        loading: false,
      });
      setDrawer("files");
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      setToast({
        title: "暂时无法比较两份内容",
        message: productErrorMessage(cause, "两份文件都仍被安全保留，请稍后重试。"),
        tone: "warning",
        dedupeKey: "ai-conflict-diff",
        action: { id: "retry-ai-diff", label: "重新比较" },
      });
    }
  }, [activeRun, captureProjectContext, isCurrentProjectContext]);

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
      setToast({
        title: "当前文字还没有保存",
        message: committed?.reason || "编辑画布尚未就绪，请稍后再重试保存。",
        tone: "warning",
        dedupeKey: "user-flush-commit-blocked",
      });
      return;
    }
    void flushAutosave();
  }, [deferEditorCommand, flushAutosave, interactionLocked, runInProgress]);
  useEffect(() => {
    deferredEditorReplayRef.current.requestUserFlush = () => requestUserFlush(true);
  }, [requestUserFlush]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === "e" && event.shiftKey) {
        event.preventDefault();
        void exportCurrentHtml();
      } else if (event.key.toLowerCase() === "s" && !event.shiftKey) {
        event.preventDefault();
        requestUserFlush();
      }
      if (
        event.key.toLowerCase() === "z"
        && viewMode === "current"
        && !interactionLocked
      ) {
        const target = event.target as HTMLElement | null;
        if (
          target?.isContentEditable
          || target?.closest("input, textarea, select, [contenteditable='true']")
        ) return;
        event.preventDefault();
        if (event.shiftKey) editorRef.current?.redo?.();
        else editorRef.current?.undo?.();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [exportCurrentHtml, interactionLocked, requestUserFlush, viewMode]);

  const updateFocusedComment = useCallback((commentId: string | null) => {
    focusedCommentIdRef.current = commentId;
    setFocusedCommentId(commentId);
  }, []);

  const queueReviewPairReveal = useCallback((
    target: HtmlCanvasSelection,
    itemKey: string,
  ) => {
    const requestId = ++reviewRevealRequestRef.current;
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (requestId !== reviewRevealRequestRef.current) return;
        const stage = reviewStageRef.current;
        const rail = commentsPanelRef.current;
        if (!stage || !rail) return;
        const item = [...rail.querySelectorAll<HTMLElement>("[data-comment-measure]")]
          .find((node) => node.dataset.commentMeasure === itemKey);
        const targetTop = target.tagName === "body"
          ? 82
          : commentTargetTops[target.id] ?? target.boundingBox?.y ?? 82;
        const itemTop = item?.offsetTop ?? targetTop;
        const desiredTop = Math.max(0, Math.min(targetTop, itemTop) - 92);
        const maxTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        stage.scrollTo({
          top: Math.min(desiredTop, maxTop),
          behavior: reduceMotion ? "auto" : "smooth",
        });
      });
    });
  }, [commentTargetTops]);

  const finishTargetRelink = useCallback((target: HtmlCanvasSelection): boolean => {
    const relinkingId = relinkingTargetRef.current;
    if (
      !relinkingId
      || !relinkSelectionArmedRef.current
      || !canLocateTarget(target)
    ) return false;
    if (relinkingId === "__composer") {
      const currentTarget = draftTargetRef.current;
      const nextTarget = currentTarget
        ? { ...target, id: currentTarget.id }
        : target;
      draftTargetRef.current = nextTarget;
      setDraftTarget(nextTarget);
      setSelection(nextTarget);
      relinkingTargetRef.current = null;
      relinkSelectionArmedRef.current = false;
      setRelinkingTarget(null);
      setComposerOpen(true);
      persistCurrentDraftRecovery();
      queueReviewPairReveal(nextTarget, "__composer");
      window.requestAnimationFrame(() => {
        composerRef.current?.focus({ preventScroll: true });
      });
      return true;
    }
    const current = commentsRef.current.find(
      (comment) => comment.commentId === relinkingId,
    );
    if (!current) {
      relinkingTargetRef.current = null;
      relinkSelectionArmedRef.current = false;
      setRelinkingTarget(null);
      return false;
    }
    const nextTarget = { ...target, id: current.target.id };
    const nextComments = commentsRef.current.map((comment) => (
      comment.commentId === relinkingId
        ? {
            ...comment,
            target: nextTarget,
            updatedAt: new Date().toISOString(),
          }
        : comment
    ));
    commentsRef.current = nextComments;
    setComments(nextComments);
    setSelection(nextTarget);
    relinkingTargetRef.current = null;
    relinkSelectionArmedRef.current = false;
    setRelinkingTarget(null);
    persistCurrentDraftRecovery(nextComments);
    updateFocusedComment(relinkingId);
    queueReviewPairReveal(nextTarget, relinkingId);
    return true;
  }, [
    persistCurrentDraftRecovery,
    queueReviewPairReveal,
    updateFocusedComment,
  ]);

  const beginTargetRelink = useCallback((itemId: string) => {
    relinkingTargetRef.current = itemId;
    relinkSelectionArmedRef.current = false;
    setRelinkingTarget(itemId);
    setPendingDeleteCommentId(null);
    setEditingCommentId(null);
    setCommentEditDraft("");
    editorRef.current?.clearSelection();
    setSelection(null);
    if (itemId !== "__composer") {
      updateFocusedComment(itemId);
      const comment = commentsRef.current.find(
        (item) => item.commentId === itemId,
      );
      if (comment) queueReviewPairReveal(comment.target, itemId);
    }
  }, [queueReviewPairReveal, updateFocusedComment]);

  const cancelTargetRelink = useCallback(() => {
    const relinkingId = relinkingTargetRef.current;
    relinkingTargetRef.current = null;
    relinkSelectionArmedRef.current = false;
    setRelinkingTarget(null);
    if (relinkingId === "__composer") {
      window.requestAnimationFrame(() => {
        composerRef.current?.focus({ preventScroll: true });
      });
    }
  }, []);

  const openCommentComposer = useCallback((target: HtmlCanvasSelection) => {
    if (relinkingTargetRef.current && finishTargetRelink(target)) return;
    if (
      projectLockedRef.current
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
      || persistStateRef.current === "conflict"
      || viewMode === "history"
    ) return;
    setSelection(target);
    const recoveredDraftTarget = draftTargetRef.current;
    if (
      recoveredDraftTarget
      && recoveredDraftTarget.id !== target.id
      && (
        composerDraftRef.current.trim()
        || composerAttachmentsRef.current.length > 0
      )
    ) {
      setToast({
        title: "还有一条未发送评论",
        message: "请先继续或放弃右侧保留的评论草稿，再为其他内容写评论。",
        tone: "info",
        dedupeKey: "unfinished-comment-draft",
        action: { id: "resume-draft", label: "继续填写" },
      });
      return;
    }
    const resumesRecoveredDraft = draftTargetRef.current?.id === target.id;
    if (!resumesRecoveredDraft) {
      composerDraftRef.current = "";
      composerAttachmentsRef.current = [];
      const nextCommentId = recordId("comment", commentCounter.current++);
      composerCommentIdRef.current = nextCommentId;
      setDraft("");
      setDraftCommentId(nextCommentId);
      setDraftAttachments([]);
    } else if (!composerCommentIdRef.current) {
      const nextCommentId = recordId("comment", commentCounter.current++);
      composerCommentIdRef.current = nextCommentId;
      setDraftCommentId(nextCommentId);
    }
    draftTargetRef.current = target;
    updateFocusedComment(null);
    setComposerOpen(true);
    setDraftTarget(target);
    queueReviewPairReveal(target, "__composer");
    window.requestAnimationFrame(() => {
      composerRef.current?.focus({ preventScroll: true });
    });
  }, [
    finishTargetRelink,
    queueReviewPairReveal,
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
    setProjectMenuOpen(false);
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
    const abandonedAttachments = [...composerAttachmentsRef.current];
    composerDraftRef.current = "";
    composerCommentIdRef.current = null;
    composerAttachmentsRef.current = [];
    draftTargetRef.current = null;
    setDraft("");
    setDraftCommentId(null);
    setDraftAttachments([]);
    setDraftTarget(null);
    setComposerOpen(false);
    updateFocusedComment(null);
    persistCurrentDraftRecovery();
    for (const attachment of abandonedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
      void deleteAttachmentFile(attachment);
    }
  }, [
    deleteAttachmentFile,
    forgetAttachmentObjectUrl,
    persistCurrentDraftRecovery,
    updateFocusedComment,
  ]);

  const addComment = useCallback(() => {
    if (
      projectLockedRef.current
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
      || persistStateRef.current === "conflict"
      || viewMode === "history"
    ) return;
    if (!draftTarget) {
      editorRef.current?.clearSelection();
      return;
    }
    if (!canLocateTarget(draftTarget)) {
      setToast({
        title: "评论目标无法安全定位",
        message: "评论内容和附件仍保留；重新选择画布位置后即可继续。",
        tone: "warning",
        dedupeKey: `unsafe-comment-target-${draftTarget.id}`,
        action: {
          id: "relink-target",
          label: "重新选择目标",
          commentId: "__composer",
        },
      });
      return;
    }
    if (!draft.trim() && draftAttachments.length === 0) {
      composerRef.current?.focus();
      return;
    }
    if (commentsRef.current.filter(commentHasContent).length >= MAX_COMMENT_COUNT) {
      setToast({
        title: "本轮评论已达上限",
        message: `每轮最多保留 ${MAX_COMMENT_COUNT} 条评论。请先合并或删除重复要求，再继续添加。`,
        tone: "warning",
        sticky: true,
        dedupeKey: "comment-count-limit",
      });
      return;
    }
    if (attachmentUploadCount > 0) return;
    const now = new Date().toISOString();
    const commentId = draftCommentId || recordId("comment", commentCounter.current++);
    const commentTarget = independentCommentTarget(draftTarget, commentId);
    const nextComments = [...commentsRef.current, {
      commentId,
      createdAt: now,
      updatedAt: now,
      target: commentTarget,
      text: draft.trim(),
      ...(draftAttachments.length > 0
        ? { attachments: draftAttachments.map(persistedAttachment) }
        : {}),
      baseVersionId: currentBasedOnVersionId,
    }];
    deletedCommentIdsRef.current.delete(nextComments.at(-1)?.commentId || "");
    commentsRef.current = nextComments;
    composerDraftRef.current = "";
    composerCommentIdRef.current = null;
    composerAttachmentsRef.current = [];
    draftTargetRef.current = null;
    setComments(nextComments);
    setOpenedAiVersionNotice(null);
    setDraft("");
    setDraftCommentId(null);
    setDraftAttachments([]);
    setDraftTarget(null);
    setComposerOpen(false);
    updateFocusedComment(commentId);
    persistCurrentDraftRecovery(nextComments);
    queueReviewPairReveal(commentTarget, commentId);
  }, [
    currentBasedOnVersionId,
    draft,
    draftAttachments,
    draftCommentId,
    draftTarget,
    attachmentUploadCount,
    persistCurrentDraftRecovery,
    queueReviewPairReveal,
    updateFocusedComment,
    viewMode,
  ]);

  const queueReviewCommentFocus = useCallback((
    target: HtmlCanvasSelection,
    commentId: string,
  ) => {
    updateFocusedComment(commentId);
    queueReviewPairReveal(target, commentId);
  }, [queueReviewPairReveal, updateFocusedComment]);

  const beginCommentEdit = useCallback((comment: CommentItem) => {
    setPendingDeleteCommentId(null);
    setCommentEditDraft(comment.text);
    setEditingCommentId(comment.commentId);
    queueReviewCommentFocus(comment.target, comment.commentId);
    window.requestAnimationFrame(() => {
      commentEditRef.current?.focus({ preventScroll: true });
      commentEditRef.current?.select();
    });
  }, [queueReviewCommentFocus]);

  const cancelCommentEdit = useCallback(() => {
    const current = commentsRef.current.find(
      (comment) => comment.commentId === editingCommentId,
    );
    setCommentEditDraft("");
    setEditingCommentId(null);
    if (current) queueReviewCommentFocus(current.target, current.commentId);
  }, [editingCommentId, queueReviewCommentFocus]);

  const confirmCommentEdit = useCallback((commentId: string) => {
    const current = commentsRef.current.find((comment) => comment.commentId === commentId);
    if (!current) {
      cancelCommentEdit();
      return;
    }
    const nextText = commentEditDraft.trim();
    if (!nextText && !(current.attachments?.length)) return;
    const nextComments = commentsRef.current.map((comment) => (
      comment.commentId === commentId
        ? { ...comment, text: nextText, updatedAt: new Date().toISOString() }
        : comment
    ));
    commentsRef.current = nextComments;
    setComments(nextComments);
    setCommentEditDraft("");
    setEditingCommentId(null);
    persistCurrentDraftRecovery(nextComments);
    queueReviewCommentFocus(current.target, current.commentId);
  }, [
    cancelCommentEdit,
    commentEditDraft,
    persistCurrentDraftRecovery,
    queueReviewCommentFocus,
  ]);

  const deleteComment = useCallback((commentId: string) => {
    const deleted = commentsRef.current.find((item) => item.commentId === commentId);
    deletedCommentIdsRef.current.add(commentId);
    const nextComments = commentsRef.current.filter(
      (item) => item.commentId !== commentId,
    );
    commentsRef.current = nextComments;
    setComments(nextComments);
    setPendingDeleteCommentId(null);
    if (editingCommentId === commentId) {
      setEditingCommentId(null);
      setCommentEditDraft("");
    }
    persistCurrentDraftRecovery(nextComments);
    for (const attachment of deleted?.attachments ?? []) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
      void deleteAttachmentFile(attachment);
    }
    if (deleted) {
      updateFocusedComment(null);
      queueReviewPairReveal(deleted.target, "");
    }
  }, [
    deleteAttachmentFile,
    editingCommentId,
    forgetAttachmentObjectUrl,
    persistCurrentDraftRecovery,
    queueReviewPairReveal,
    updateFocusedComment,
  ]);

  const focusCommentTarget = useCallback((
    target: HtmlCanvasSelection,
    commentId: string,
  ) => {
    if (!canLocateTarget(target)) {
      setSelection(target);
      setToast({
        title: target.resolution === "ambiguous" ? "目标存在多个候选" : "原目标已不存在",
        message: "评论和附件仍保留；重新选择画布位置即可继续。",
        tone: "warning",
        dedupeKey: `unsafe-target-${target.id}`,
        action: {
          id: "relink-target",
          label: "重新选择目标",
          commentId,
        },
      });
      return;
    }
    updateFocusedComment(commentId);
    const located = editorRef.current?.select(target, { showToolbar: false });
    const nextTarget = located || target;
    setSelection(nextTarget);
    queueReviewPairReveal(nextTarget, commentId);
  }, [queueReviewPairReveal, updateFocusedComment]);

  const handleCanvasSelection = useCallback((target: HtmlCanvasSelection | null) => {
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
    queueReviewCommentFocus(nextComment.target, nextComment.commentId);
  }, [
    composerOpen,
    finishTargetRelink,
    queueReviewCommentFocus,
    updateFocusedComment,
    viewMode,
    visibleCommentItems,
  ]);

  const readWorkspaceFile = useCallback(async (
    relativePath: string,
    projectSourcePath: string,
  ): Promise<string> => {
    const url = new URL(`${BRIDGE_URL}/file`);
    url.searchParams.set("path", relativePath);
    url.searchParams.set("sourcePath", projectSourcePath);
    const response = await bridgeFetch(url, { cache: "no-store" });
    const payload = await readJsonResponse(response);
    if (!response.ok) throw responseError(payload, "无法读取项目文件。");
    return String(payload.content || "");
  }, []);

  const viewFile = useCallback(async (path: string) => {
    const context = captureProjectContext();
    if (!context) return;
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

  const closeFileView = useCallback((): boolean => {
    if (
      fileView?.path === "PROJECT.md"
      && !fileView.error
      && fileView.content !== fileView.savedContent
    ) {
      setToast({
        title: "项目规则还有未保存修改",
        message: "请先保存规则，或使用“还原修改”放弃本次编辑。",
        tone: "warning",
        dedupeKey: "project-rules-unsaved",
      });
      return false;
    }
    setFileView(null);
    return true;
  }, [fileView]);

  const saveProjectRules = useCallback(async () => {
    if (
      !fileView
      || fileView.path !== "PROJECT.md"
      || fileView.loading
      || fileView.error
      || runInProgress
    ) return;
    const context = captureProjectContext();
    if (!context) return;
    const nextContent = fileView.content;
    setProjectRulesSaving(true);
    try {
      const response = await bridgeFetch(`${BRIDGE_URL}/project-file`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sourcePath: context.sourcePath,
          projectId: context.projectId,
          content: nextContent,
        }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "无法更新 PROJECT.md。");
      if (!isCurrentProjectContext(context)) return;
      setFileView((current) => current?.path === "PROJECT.md"
        ? { ...current, savedContent: nextContent }
        : current);
      setToast({
        title: "项目规则已更新",
        message: "下一次 AI 修改开始时，会暂时锁定这份规则。",
        tone: "success",
        dedupeKey: "project-rules",
      });
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      setToast({
        title: "项目规则未更新",
        message: productErrorMessage(cause, "请确认本地项目记录正在运行后重试。"),
        tone: "error",
        sticky: true,
        dedupeKey: "project-rules",
      });
    } finally {
      if (isCurrentProjectContext(context)) setProjectRulesSaving(false);
    }
  }, [captureProjectContext, fileView, isCurrentProjectContext, runInProgress]);

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
      const previousState = qoderHandoffStatesRef.current.get(run.sourcePath);
      if (
        status !== "copying"
        && previousState
        && (
          previousState.requestId !== run.requestId
          || previousState.attemptId !== run.attemptId
        )
      ) return;
      const nextState: ProjectQoderHandoffState = {
        sourcePath: run.sourcePath,
        requestId: run.requestId,
        attemptId: run.attemptId,
        status,
      };
      qoderHandoffStatesRef.current.set(run.sourcePath, nextState);
      const visibleRun = activeRunRef.current;
      if (
        sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
        && visibleRun?.requestId === run.requestId
        && visibleRun.attemptId === run.attemptId
      ) {
        setQoderHandoffState(nextState);
      }
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
      const visibleRun = activeRunRef.current;
      if (
        sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
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
    const activeSourcePath = sourcePathRef.current;
    const requestPath = activeRun?.requestPath;
    const api = window.htmlAIProjects;
    if (!activeSourcePath || !requestPath || !api?.revealRequestFolder) return;
    try {
      await api.revealRequestFolder({
        sourcePath: activeSourcePath,
        requestPath,
      });
    } catch (cause) {
      setToast({
        title: "本轮文件暂时无法打开",
        message: productErrorMessage(
          cause,
          "本轮任务仍在处理面板中，可以重新尝试。",
        ),
        tone: "warning",
        dedupeKey: "reveal-request-folder",
        action: { id: "reveal-request", label: "重试" },
      });
    }
  }, [activeRun?.requestPath]);

  const revealVersionInFinder = useCallback(async (version: Version) => {
    const activeSourcePath = sourcePathRef.current;
    const api = window.htmlAIProjects;
    if (!activeSourcePath || !api?.revealVersionFile) return;
    try {
      await api.revealVersionFile({
        sourcePath: activeSourcePath,
        versionId: version.id,
      });
    } catch (cause) {
      setToast({
        title: "历史版本暂时无法在 Finder 中显示",
        message: productErrorMessage(cause, "请确认项目记录仍然完整后重试。"),
        tone: "warning",
        dedupeKey: `reveal-version-file-${version.id}`,
        action: {
          id: "reveal-version",
          label: "重试",
          versionId: version.id,
        },
      });
    }
  }, []);

  const startPreviewHandoff = useCallback(() => {
    const activeComments = commentsRef.current.filter(commentHasContent);
    if (activeComments.length === 0) {
      composerRef.current?.focus();
      return;
    }
    const submittedAt = new Date().toISOString();
    const previewRun: ActiveRun = {
      projectId: "preview-project",
      documentId: "preview-document",
      requestId: "preview-request",
      attemptId: "attempt_001",
      requestPath: "",
      attemptPath: "",
      handoffMessage: "源页交互预览：本轮要求已复制。",
      status: "processing",
      sourcePath: "preview://welcome",
      baseSnapshotSha256: `sha256:${"0".repeat(64)}`,
      previousVersionId: latestVersionId,
      basedOnVersionId: currentBasedOnVersionId,
      freezeCutoffRevision: editRevisionRef.current,
      candidateVersionId: "preview-version-2",
      candidateVersionLabel: "版本 2",
      submittedAt,
      summary: activeComments.map((comment) => comment.text).filter(Boolean).join("；"),
      commentCount: activeComments.length,
      changeEventCount: changeEventsRef.current.length,
    };
    projectLockedRef.current = true;
    setProjectLocked(true);
    activeRunRef.current = previewRun;
    setActiveRun(previewRun);
    const previewQoderState: ProjectQoderHandoffState = {
      sourcePath: previewRun.sourcePath,
      requestId: previewRun.requestId,
      attemptId: previewRun.attemptId,
      status: "copied",
    };
    qoderHandoffStatesRef.current.set(previewRun.sourcePath, previewQoderState);
    setQoderHandoffState(previewQoderState);
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer("handoff");
  }, [currentBasedOnVersionId, latestVersionId]);

  const generateRequest = useCallback(async (fromDeferred = false) => {
    if (submissionIntentRef.current) return;
    if (!sourcePathRef.current) {
      if (typeof window !== "undefined" && !window.htmlAIProjects) {
        startPreviewHandoff();
        return;
      }
      setToast({
        title: "请先打开本地 HTML",
        message: "浏览器预览没有绑定源文件，暂时不能交给内部 AI。",
        tone: "warning",
        dedupeKey: "submit-blocked",
      });
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
    if (persistStateRef.current === "failed" || persistStateRef.current === "conflict") {
      return;
    }
    if (projectLockedRef.current) {
      setDrawer("handoff");
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
      setToast({
        title: "本轮没有提交",
        message: committed?.reason || "编辑画布尚未就绪，请稍后重试。",
        tone: "warning",
        sticky: true,
        dedupeKey: "ai-submit-commit-blocked",
      });
      return;
    }
    let activeComments = commentsRef.current.filter(commentHasContent);
    if (activeComments.length === 0) {
      composerRef.current?.focus();
      return;
    }
    const unsafeTargets = activeComments.filter(
      (comment) => !canLocateTarget(comment.target),
    );
    if (unsafeTargets.length > 0) {
      setToast({
        title: "请重新选择失联的评论目标",
        message: `有 ${unsafeTargets.length} 条要求的位置已变化。评论和附件仍保留；重新关联后即可发送。`,
        tone: "warning",
        sticky: true,
        dedupeKey: "unsafe-comment-targets",
        action: {
          id: "relink-target",
          label: "处理第一条",
          commentId: unsafeTargets[0].commentId,
        },
      });
      return;
    }

    const submissionIntent = {
      token: ++submissionIntentCounterRef.current,
      epoch: projectEpochRef.current,
      sourcePath: sourcePathRef.current,
    };
    submissionIntentRef.current = submissionIntent;
    setGenerating(true);
    const releaseSubmissionIntent = () => {
      if (submissionIntentRef.current?.token === submissionIntent.token) {
        submissionIntentRef.current = null;
      }
      if (sameLocalSourcePath(sourcePathRef.current, submissionIntent.sourcePath)) {
        setGenerating(false);
      }
    };

    try {
      const registered = await ensureProjectRegistered();
      if (!registered) throw new Error("当前项目已经切换，请重试。");
      if (
        submissionIntentRef.current?.token !== submissionIntent.token
        || projectEpochRef.current !== submissionIntent.epoch
        || !sameLocalSourcePath(sourcePathRef.current, submissionIntent.sourcePath)
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
        dedupeKey: "project-registration",
      });
      releaseSubmissionIntent();
      return;
    }
    activeComments = commentsRef.current.filter(commentHasContent);
    if (activeComments.length === 0) {
      composerRef.current?.focus();
      releaseSubmissionIntent();
      return;
    }
    const unsafeRegisteredTargets = activeComments.filter(
      (comment) => !canLocateTarget(comment.target),
    );
    if (unsafeRegisteredTargets.length > 0) {
      setToast({
        title: "请重新选择失联的评论目标",
        message: `有 ${unsafeRegisteredTargets.length} 条要求的位置已变化。评论和附件仍保留；重新关联后即可发送。`,
        tone: "warning",
        sticky: true,
        dedupeKey: "unsafe-comment-targets",
        action: {
          id: "relink-target",
          label: "处理第一条",
          commentId: unsafeRegisteredTargets[0].commentId,
        },
      });
      releaseSubmissionIntent();
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
      setToast({
        title: "本轮没有冻结",
        message: frozen?.reason || "画布没有返回可验证的 HTML 快照，本轮不会发送。",
        tone: "warning",
        sticky: true,
        dedupeKey: "ai-submit-freeze-blocked",
      });
      releaseSubmissionIntent();
      return;
    }
    projectLockedRef.current = true;
    submissionPendingRef.current = true;
    setProjectLocked(true);
    const capturedHtml = frozen.html;
    if (capturedHtml !== htmlRef.current) {
      enqueueAutosave(capturedHtml, frozen.pendingMutation || undefined);
    }
    const freezeCutoffRevision = editRevisionRef.current;
    const submissionContext = {
      epoch: projectEpochRef.current,
      projectId: projectIdRef.current,
      documentId: documentIdRef.current,
      sourcePath: sourcePathRef.current,
      projectName,
      comments: activeComments.map((comment) => ({ ...comment })),
      changeEvents: changeEventsRef.current.map((event) => ({ ...event })),
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
    activeRunRef.current = pendingRun;
    setActiveRun(pendingRun);
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer("handoff");

    let requestDispatched = false;
    let durableRun: ActiveRun | null = null;
    let confirmedNoRun = false;
    try {
      const flushed = await flushAutosave(freezeCutoffRevision);
      if (
        !flushed
        || lastPersistedRevisionRef.current !== freezeCutoffRevision
        || editRevisionRef.current !== freezeCutoffRevision
      ) {
        throw new Error("冻结前的最后一次修改尚未安全写入源 HTML。");
      }
      const persistedSourceSha256 = sourceShaRef.current;
      if (
        persistedSourceSha256 !== frozen.sourceSha256
        || !isCurrentProjectContext(submissionContext)
      ) {
        throw new Error("冻结 HTML 的 Hash 与已写回源文件不一致。");
      }
      const persistedComments = commentsRef.current.filter(commentHasContent);
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
      submissionContext.changeEvents = changeEventsRef.current.map(
        (event) => ({ ...event }),
      );
      const draftFlushed = await flushDraftPersistence({
        epoch: submissionContext.epoch,
        projectId: submissionContext.projectId,
        documentId: submissionContext.documentId,
        sourcePath: submissionContext.sourcePath,
        basedOnVersionId: currentBasedOnVersionId,
        expectedDraftRevision: draftRevisionRef.current,
        comments: submissionContext.comments,
        changeEvents: submissionContext.changeEvents,
      });
      if (!draftFlushed || !isCurrentProjectContext(submissionContext)) {
        throw new Error("冻结边界内的最新评论与修改审计尚未安全记录。");
      }
      const targets = uniqueTargets(submissionContext.comments);
      requestDispatched = true;
      const response = await bridgeFetch(`${BRIDGE_URL}/request`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: submissionContext.projectId,
          documentId: submissionContext.documentId,
          projectName: fileStem(submissionContext.projectName),
          projectMd: projectMarkdown(submissionContext.projectName),
          sourcePath: submissionContext.sourcePath,
          expectedSourceSha256: persistedSourceSha256,
          freezeCutoffRevision,
          lastPersistedRevision: lastPersistedRevisionRef.current,
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
        }),
      }, BRIDGE_REQUEST_TIMEOUT_MS);
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "无法建立本轮内部 AI 任务。");
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
      submissionPendingRef.current = false;
      backgroundRunsRef.current.set(run.sourcePath, run);
      if (isCurrentProjectContext(submissionContext)) {
        activeRunRef.current = run;
        setActiveRun(run);
        setBridgeConnected(true);
        setDrawer("handoff");
      }
    } catch (cause) {
      if (requestDispatched) {
        try {
          const workspaceUrl = new URL(`${BRIDGE_URL}/workspace`);
          workspaceUrl.searchParams.set("sourcePath", submissionContext.sourcePath);
          const reconcileResponse = await bridgeFetch(workspaceUrl, { cache: "no-store" });
          const reconcilePayload = await readJsonResponse(reconcileResponse);
          if (reconcileResponse.ok) {
            durableRun = activeRunFromRecord(
              (isRecord(reconcilePayload.runtimeState)
                ? reconcilePayload.runtimeState.activeRun
                : null)
              || reconcilePayload.activeRun,
            );
            if (durableRun) {
              backgroundRunsRef.current.set(submissionContext.sourcePath, durableRun);
              if (isCurrentProjectContext(submissionContext)) {
                activeRunRef.current = durableRun;
                setActiveRun(durableRun);
              }
            } else if (isCurrentProjectContext(submissionContext)) {
              confirmedNoRun = true;
              projectLockedRef.current = false;
              setProjectLocked(false);
              activeRunRef.current = null;
              setActiveRun(null);
              editorRef.current?.unlockNow?.();
            }
          }
        } catch {
          // Unknown POST outcome is intentionally kept locked until workspace
          // reconciliation succeeds; unlocking here could split client/server state.
        }
      } else if (isCurrentProjectContext(submissionContext)) {
        projectLockedRef.current = false;
        setProjectLocked(false);
        editorRef.current?.unlockNow?.();
        activeRunRef.current = null;
        setActiveRun(null);
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
        activeRunRef.current = unknownRun;
        setActiveRun(unknownRun);
      }
      if (!durableRun && requestDispatched && !confirmedNoRun) {
        setToast({
          title: "正在确认本轮任务状态",
          message: "当前项目会保持只读，确认任务是否建立后再恢复编辑。",
          tone: "warning",
          sticky: true,
          dedupeKey: "ai-submit",
          action: { id: "retry-reconcile", label: "立即核对" },
        });
      } else if (!durableRun) {
        setToast({
          title: "本轮没有提交",
          message: productErrorMessage(cause, "页面和评论已经恢复编辑，请检查后重试。"),
          tone: "error",
          sticky: true,
          dedupeKey: "ai-submit",
        });
      }
    } finally {
      submissionPendingRef.current = false;
      releaseSubmissionIntent();
    }
    if (durableRun?.handoffMessage) {
      await sendToQoderWork(durableRun.handoffMessage, durableRun);
    }
  }, [
    deferEditorCommand,
    enqueueAutosave,
    ensureProjectRegistered,
    flushAutosave,
    flushDraftPersistence,
    isCurrentProjectContext,
    latestVersionId,
    currentBasedOnVersionId,
    projectName,
    sendToQoderWork,
    startPreviewHandoff,
    viewMode,
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
    const affectsCurrentCanvas = Boolean(sourcePathRef.current)
      && projectIdRef.current === run.projectId;
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
    const versionUrl = new URL(`${BRIDGE_URL}/version-file`);
    versionUrl.searchParams.set("sourcePath", run.sourcePath);
    versionUrl.searchParams.set("versionId", versionId);
    const sourceUrl = new URL(`${BRIDGE_URL}/source`);
    sourceUrl.searchParams.set("sourcePath", run.sourcePath);
    const [versionResponse, sourceResponse] = await Promise.all([
      bridgeFetch(versionUrl, { cache: "no-store" }),
      bridgeFetch(sourceUrl, { cache: "no-store" }),
    ]);
    const [versionPayload, sourcePayload] = await Promise.all([
      readJsonResponse(versionResponse),
      readJsonResponse(sourceResponse),
    ]);
    if (!versionResponse.ok) throw responseError(versionPayload, "已提交版本的不可变文件缺失。");
    if (!sourceResponse.ok) throw responseError(sourcePayload, "无法核对当前源 HTML。");
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
      projectIdRef.current === run.projectId
      && Boolean(sourcePathRef.current)
      && (
        sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
        || sameLocalSourcePath(sourcePathRef.current, committedSourcePath)
      );
    if (transitionAffectsCurrentCanvas) {
      const transitionContext = captureProjectContext();
      if (!transitionContext) {
        throw new Error("新版本已生成，但当前画布缺少可核对的项目身份。");
      }
      const frozen = fenceAndFreezeCurrentCanvas(
        "新版本已生成，但当前编辑画布尚未就绪。",
      );
      if (!frozen.ok) {
        throw new Error(frozen.reason || "新版本已生成，但当前编辑会话尚未安全收口。");
      }
      if (!isCurrentProjectContext(transitionContext)) {
        throw new DeferredEditorCommandDiscardedError("stale-session");
      }
      // Recovery is cleared only after the live Canvas has crossed the Fence.
      persistRecoveryLog(null, transitionContext);
    }
    const adoptedContext = await adoptGeneratedSourcePath({
      previousSourcePath: run.sourcePath,
      nextSourcePath: committedSourcePath,
      expectedSha256: sourceHash,
      nextProjectId: run.projectId,
      nextDocumentId: run.documentId,
      versionId,
    });
    if (!adoptedContext) {
      setToast({
        title: protocolViolation
          ? `${candidateLabel} 已生成，但需要检查`
          : `${candidateLabel} 已生成`,
        message: protocolViolation
          ? "新版本本身已经安全提交，但检测到内部 AI 在完成后又改动了临时输出；打开项目查看详情。"
          : `${aiCompletedAt ? `内部 AI 于 ${formatTime(aiCompletedAt, true)} 完成；` : ""}打开该项目后会核对并显示新版本。`,
        tone: protocolViolation ? "warning" : "success",
        sticky: protocolViolation,
        dedupeKey: `background-version:${run.sourcePath}`,
        action: {
          id: "open-project",
          label: "打开项目",
          sourcePath: committedSourcePath,
        },
      });
      return;
    }
    htmlRef.current = content;
    sourceShaRef.current = sourceHash;
    pendingWriteRef.current = null;
    auditPendingRef.current = [];
    undoDraftFoldsRef.current.clear();
    redoDraftFoldsRef.current.clear();
    setHtml(content);
    setSourceSha256(sourceHash);
    setRenderedContentSha256(null);
    await verifyCanvasRendered(content, versionHash, adoptedContext);
    if (!isCurrentProjectContext(adoptedContext)) return;
    setLatestVersionId(versionId);
    setCurrentBasedOnVersionId(versionId);
    setCurrentExactVersionId(versionId);
    setRestoredFromVersionId(null);
    setViewMode("current");
    setViewingVersionId(null);
    setPreserveEditorHistory(false);
    setLastModifiedAt(sourceLastModifiedAt);
    persistStateRef.current = "idle";
    setPersistState("idle");
    setPersistError("");
    persistDraftRecovery(null, adoptedContext);
    commentsRef.current = [];
    composerDraftRef.current = "";
    composerCommentIdRef.current = null;
    composerAttachmentsRef.current = [];
    draftTargetRef.current = null;
    draftPendingRef.current = null;
    setComments([]);
    changeEventsRef.current = [];
    setChangeEvents([]);
    setSelection(null);
    setComposerOpen(false);
    setDraftTarget(null);
    setDraft("");
    setDraftCommentId(null);
    setDraftAttachments([]);
    setPreviewAttachment(null);
    viewTransitioningRef.current = true;
    setViewTransitioning(true);
    const completedRun: ActiveRun = {
      ...run,
      sourcePath: committedSourcePath,
      candidateVersionLabel: candidateLabel,
      status: protocolViolation ? "error" : "complete",
    };
    activeRunRef.current = completedRun;
    setActiveRun(completedRun);
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer(null);
    persistRecoveryLog(null, adoptedContext);
    await refreshWorkspace(committedSourcePath, adoptedContext.epoch);
    if (!isCurrentProjectContext(adoptedContext)) return;
    if (projectLoadErrorRef.current) {
      throw new Error(`新版本已精确打开，但项目状态复核失败：${projectLoadErrorRef.current}`);
    }
    setProjectLocked(false);
    projectLockedRef.current = false;
    viewTransitioningRef.current = false;
    setViewTransitioning(false);
    window.requestAnimationFrame(() => editorRef.current?.unlockNow?.());
    setOpenedAiVersionNotice({
      sourcePath: committedSourcePath,
      fileName: fileNameFromSourcePath(committedSourcePath),
      versionLabel: candidateLabel,
      generatedAt: versionGeneratedAt,
    });
    if (protocolViolation) {
      const warning = "内部 AI 的临时输出在最终化后又被修改；已提交版本本身未受影响。";
      const warningRun: ActiveRun = {
        ...run,
        sourcePath: committedSourcePath,
        candidateVersionLabel: candidateLabel,
        status: "error",
        error: warning,
      };
      activeRunRef.current = warningRun;
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
    adoptGeneratedSourcePath,
    captureProjectContext,
    deferEditorCommand,
    fenceAndFreezeCurrentCanvas,
    isCurrentProjectContext,
    persistDraftRecovery,
    persistRecoveryLog,
    refreshWorkspace,
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

  const activateReadyResult = useCallback(async () => {
    const run = activeRun;
    if (
      !run
      || run.status !== "ready-to-open"
      || !run.readyPayload
    ) return;
    const operationKey = activeRunOperationKey(run);
    if (activatingRunsRef.current.has(operationKey)) return;
    activatingRunsRef.current.add(operationKey);
    setOpeningReadyVersion(true);
    const clearedRun = { ...run, error: undefined };
    activeRunRef.current = clearedRun;
    setActiveRun(clearedRun);
    try {
      const response = await bridgeFetch(`${BRIDGE_URL}/ready-version/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: run.sourcePath,
          projectId: run.projectId,
          documentId: run.documentId,
          requestId: run.requestId,
          attemptId: run.attemptId,
          versionId: run.candidateVersionId,
        }),
      });
      const activatedPayload = await readJsonResponse(response);
      if (!response.ok) {
        throw responseError(activatedPayload, "最新版暂时无法打开。");
      }
      const mergedPayload = {
        ...run.readyPayload,
        ...activatedPayload,
        completion: run.readyPayload.completion,
        outcome: run.readyPayload.outcome,
        version: activatedPayload.version || run.readyPayload.version,
      };
      await openCommittedVersion(run, mergedPayload);
      for (const [trackedPath, tracked] of backgroundRunsRef.current) {
        if (
          tracked.requestId === run.requestId
          && tracked.attemptId === run.attemptId
        ) backgroundRunsRef.current.delete(trackedPath);
      }
    } catch (cause) {
      if (isDeferredEditorCommandDiscardedError(cause)) return;
      const error = productErrorMessage(cause, "最新版暂时无法打开。");
      const nextRun = { ...run, status: "ready-to-open" as const, error };
      backgroundRunsRef.current.set(run.sourcePath, nextRun);
      const visibleRun = activeRunRef.current;
      if (
        sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
        && visibleRun?.requestId === run.requestId
        && visibleRun.attemptId === run.attemptId
      ) {
        activeRunRef.current = nextRun;
        setActiveRun(nextRun);
        setDrawer("handoff");
        setToast({
          title: "最新版暂时无法打开",
          message: error,
          tone: "error",
          sticky: true,
          dedupeKey: "activate-ready-version",
        });
      }
    } finally {
      activatingRunsRef.current.delete(operationKey);
      const visibleRun = activeRunRef.current;
      if (
        sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
        || (
          visibleRun?.requestId === run.requestId
          && visibleRun.attemptId === run.attemptId
        )
      ) {
        setOpeningReadyVersion(false);
      }
    }
  }, [activeRun, openCommittedVersion]);

  const waiveCurrentValidation = useCallback(async () => {
    const run = activeRun;
    const review = run?.validationReview;
    if (
      !run
      || run.status !== "awaiting-check-decision"
      || !review
    ) return;
    const operationKey = activeRunOperationKey(run);
    if (waivingRunsRef.current.has(operationKey)) return;
    waivingRunsRef.current.add(operationKey);
    setWaivingValidation(true);
    try {
      const response = await bridgeFetch(`${BRIDGE_URL}/validation/waive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sourcePath: run.sourcePath,
          projectId: run.projectId,
          documentId: run.documentId,
          requestId: run.requestId,
          attemptId: run.attemptId,
          violationCodes: review.softViolationCodes,
        }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw responseError(payload, "无法记录本次校验决定。");
      }
      const nextRun = {
        ...run,
        status: "validating" as const,
        validationReview: validationReviewFromRecord(payload.validationReview)
          || review,
        error: undefined,
      };
      backgroundRunsRef.current.set(run.sourcePath, nextRun);
      const visibleRun = activeRunRef.current;
      if (
        sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
        && visibleRun?.requestId === run.requestId
        && visibleRun.attemptId === run.attemptId
      ) {
        activeRunRef.current = nextRun;
        setActiveRun(nextRun);
      }
    } catch (cause) {
      const nextRun = {
        ...run,
        error: productErrorMessage(cause, "无法记录本次校验决定。"),
      };
      backgroundRunsRef.current.set(run.sourcePath, nextRun);
      const visibleRun = activeRunRef.current;
      if (
        sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
        && visibleRun?.requestId === run.requestId
        && visibleRun.attemptId === run.attemptId
      ) {
        activeRunRef.current = nextRun;
        setActiveRun(nextRun);
      }
    } finally {
      waivingRunsRef.current.delete(operationKey);
      const visibleRun = activeRunRef.current;
      if (
        sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
        && visibleRun?.requestId === run.requestId
        && visibleRun.attemptId === run.attemptId
      ) {
        setWaivingValidation(false);
      }
    }
  }, [activeRun]);

  const processRunStatus = useCallback(async (
    run: ActiveRun,
    payload: Record<string, unknown>,
  ) => {
    const trackedRun = backgroundRunsRef.current.get(run.sourcePath);
    if (
      !trackedRun
      || trackedRun.requestId !== run.requestId
      || trackedRun.attemptId !== run.attemptId
    ) return;
    const deleteTrackedRun = () => {
      for (const [trackedPath, current] of backgroundRunsRef.current) {
        if (
          current.requestId === run.requestId
          && current.attemptId === run.attemptId
        ) {
          backgroundRunsRef.current.delete(trackedPath);
        }
      }
    };
    const rawState = String(payload.status || payload.lifecycleState || "processing");
    const legacyReadyResult = Boolean(payload.versionId) && [
      "version-created",
      "completed",
      "complete",
      "ready",
    ].includes(rawState);
    const state = (
      legacyReadyResult
        ? "ready-to-open"
        : rawState === "waiting" || rawState === "ready"
          ? "processing"
          : rawState === "importing" || rawState === "result-ready"
            ? "validating"
            : rawState === "canceled"
              ? "cancelled"
              : rawState
    ) as LifecycleState;
    const isCurrentProject = (
      (
        Boolean(run.projectId)
        && Boolean(projectIdRef.current)
        && run.projectId === projectIdRef.current
      )
      || sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
    );
    const previousBackgroundState = backgroundRunsRef.current.get(run.sourcePath)?.status;
    if (state === "awaiting-check-decision") {
      const validationReview = validationReviewFromRecord(payload.validationReview);
      const nextRun: ActiveRun = {
        ...run,
        status: "awaiting-check-decision",
        ...(validationReview ? { validationReview } : {}),
        ...(isRecord(payload.scopeReport)
          ? { scopeReport: payload.scopeReport }
          : {}),
      };
      backgroundRunsRef.current.set(run.sourcePath, nextRun);
      if (isCurrentProject) {
        setActiveRun(nextRun);
        setProjectLocked(true);
        projectLockedRef.current = true;
        setDrawer("handoff");
      }
      return;
    }
    if (state === "ready-to-open") {
      const validationReview = validationReviewFromRecord(payload.validationReview);
      const nextRun: ActiveRun = {
        ...run,
        status: "ready-to-open",
        readyPayload: payload,
        ...(validationReview ? { validationReview } : {}),
      };
      backgroundRunsRef.current.set(run.sourcePath, nextRun);
      if (isCurrentProject) {
        setActiveRun(nextRun);
        setProjectLocked(true);
        projectLockedRef.current = true;
        setDrawer("handoff");
        if (toastRef.current?.dedupeKey === "ai-submit") setToast(null);
      } else if (previousBackgroundState !== "ready-to-open") {
        setToast({
          title: `${run.candidateVersionLabel} 可以打开了`,
          message: "切回项目确认后再打开，当前画布没有被替换。",
          tone: "success",
          sticky: true,
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
      if (isCurrentProject) {
        projectLockedRef.current = false;
        setProjectLocked(false);
        editorRef.current?.unlockNow?.();
        const noChangeRun = { ...run, status: "no-change" as const };
        activeRunRef.current = noChangeRun;
        setActiveRun(noChangeRun);
        setDrawer("handoff");
      } else {
        setToast({
          title: `${run.sourcePath.split(/[\\/]/).at(-1)} 没有生成新版本`,
          message: "没有产生可采用的变化；切回项目后可调整原评论并重试。",
          tone: "info",
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
    if (state === "cancelled") {
      deleteTrackedRun();
      if (isCurrentProject) {
        projectLockedRef.current = false;
        setProjectLocked(false);
        editorRef.current?.unlockNow?.();
        setActiveRun(null);
        setDrawer(null);
      }
      return;
    }
    if (state === "error") {
      deleteTrackedRun();
      if (isCurrentProject) {
        projectLockedRef.current = false;
        setProjectLocked(false);
        editorRef.current?.unlockNow?.();
        const error = isRecord(payload.error)
          ? String(payload.error.message || "完成校验失败")
          : String(payload.error || "完成校验失败");
        const errorRun = { ...run, status: "error" as const, error };
        activeRunRef.current = errorRun;
        setActiveRun(errorRun);
        setDrawer("handoff");
      } else {
        setToast({
          title: `${run.sourcePath.split(/[\\/]/).at(-1)} 需要处理`,
          message: "切回该项目可查看完整错误，源 HTML 没有被覆盖。",
          tone: "error",
          sticky: true,
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
    const nextRun = activeRunFromRecord(
      isRecord(payload.activeRun)
        ? { ...payload.activeRun, ...(isRecord(payload.conflict) ? { conflict: payload.conflict } : {}) }
        : { ...run, ...payload, status: state },
    )
      || { ...run, status: state };
    backgroundRunsRef.current.set(run.sourcePath, nextRun);
    if (isCurrentProject) {
      setActiveRun(nextRun);
      setProjectLocked(isLockedLifecycle(nextRun.status));
      projectLockedRef.current = isLockedLifecycle(nextRun.status);
      if (nextRun.status === "awaiting-conflict-resolution"
        || nextRun.status === "recovering-transaction") {
        setDrawer("handoff");
      }
    } else if (
      nextRun.status === "awaiting-conflict-resolution"
      && previousBackgroundState !== nextRun.status
    ) {
      setToast({
        title: `${run.sourcePath.split(/[\\/]/).at(-1)} 需要处理冲突`,
        message: "AI 候选和外部文件都已保留；切回该项目后选择采用哪一份。",
        tone: "warning",
        sticky: true,
        dedupeKey: `background-version:${run.sourcePath}`,
        action: {
          id: "open-project",
          label: "打开项目",
          sourcePath: run.sourcePath,
        },
      });
    }
  }, []);

  useEffect(() => {
    const poll = async () => {
      if (backgroundRunsRef.current.size === 0) return;
      await Promise.allSettled(
        [...backgroundRunsRef.current.values()].map(async (run) => {
          if (!run.requestId || run.requestId === "pending") return;
          const operationKey = activeRunOperationKey(run);
          if (statusPollBusyRef.current.has(operationKey)) return;
          statusPollBusyRef.current.add(operationKey);
          try {
            const url = new URL(`${BRIDGE_URL}/status`);
            url.searchParams.set("sourcePath", run.sourcePath);
            url.searchParams.set("projectId", run.projectId);
            url.searchParams.set("requestId", run.requestId);
            url.searchParams.set("attemptId", run.attemptId);
            const response = await bridgeFetch(url, { cache: "no-store" });
            const payload = await readJsonResponse(response);
            if (!response.ok) throw responseError(payload, "无法读取本轮状态。");
            if (sameLocalSourcePath(sourcePathRef.current, run.sourcePath)) {
              setRunStatusError("");
            }
            await processRunStatus(run, payload);
          } catch (cause) {
            if (sameLocalSourcePath(sourcePathRef.current, run.sourcePath)) {
              setRunStatusError(productErrorMessage(
                cause,
                "本轮状态暂时没有响应。源页会继续自动重试，也可以取消本轮或重新打开。",
              ));
            }
          } finally {
            statusPollBusyRef.current.delete(operationKey);
          }
        }),
      );
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1600);
    return () => window.clearInterval(timer);
  }, [processRunStatus]);

  const reconcilePendingRun = useCallback(async (): Promise<void> => {
    const pendingRun = activeRunRef.current;
    if (
      pendingReconcileBusyRef.current
      || submissionPendingRef.current
      || !projectLockedRef.current
      || pendingRun?.requestId !== "pending"
      || !sourcePathRef.current
    ) return;
    const context = captureProjectContext();
    if (!context) return;
    pendingReconcileBusyRef.current = true;
    setPendingReconcileBusy(true);
    setPendingReconcileError("");
    try {
      const url = new URL(`${BRIDGE_URL}/workspace`);
      url.searchParams.set("sourcePath", context.sourcePath);
      const response = await bridgeFetch(url, { cache: "no-store" });
      const payload = await readJsonResponse(response);
      if (!response.ok) {
        throw responseError(payload, "暂时无法核对本轮任务状态。");
      }
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
        backgroundRunsRef.current.set(context.sourcePath, recoveredRun);
        activeRunRef.current = recoveredRun;
        setActiveRun(recoveredRun);
        setProjectLocked(isLockedLifecycle(recoveredRun.status));
        projectLockedRef.current = isLockedLifecycle(recoveredRun.status);
        setBridgeConnected(true);
        setPendingReconcileError("");
        setDrawer("handoff");
        return;
      }
      projectLockedRef.current = false;
      setProjectLocked(false);
      editorRef.current?.unlockNow?.();
      activeRunRef.current = null;
      setActiveRun(null);
      setDrawer(null);
      setPendingReconcileError("");
      setToast({
        title: "页面已恢复编辑",
        message: "已确认本轮任务没有建立；原评论和当前内容仍在。",
        tone: "info",
        dedupeKey: "ai-submit",
      });
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      const message = productErrorMessage(
        cause,
        "本地项目资料暂时没有响应。当前页面保持只读，可以重试核对或重新打开源页。",
      );
      setPendingReconcileError(message);
      setToast({
        title: "还无法确认本轮任务状态",
        message,
        tone: "warning",
        sticky: true,
        dedupeKey: "ai-submit",
        action: { id: "retry-reconcile", label: "重新核对" },
      });
    } finally {
      pendingReconcileBusyRef.current = false;
      if (isCurrentProjectContext(context)) setPendingReconcileBusy(false);
    }
  }, [captureProjectContext, isCurrentProjectContext]);

  useEffect(() => {
    if (
      generating
      || submissionPendingRef.current
      || !projectLocked
      || activeRun?.requestId !== "pending"
      || !sourcePath
    ) return;
    void reconcilePendingRun();
    const timer = window.setInterval(() => void reconcilePendingRun(), 4_000);
    return () => {
      window.clearInterval(timer);
    };
  }, [
    activeRun?.requestId,
    generating,
    projectLocked,
    reconcilePendingRun,
    sourcePath,
  ]);

  const cancelActiveRun = useCallback(async () => {
    if (!activeRun || !activeRun.requestId || activeRun.requestId === "pending") return;
    const run = { ...activeRun };
    const operationKey = activeRunOperationKey(run);
    if (cancellingRunsRef.current.has(operationKey)) return;
    if (run.sourcePath === "preview://welcome") {
      projectLockedRef.current = false;
      setProjectLocked(false);
      editorRef.current?.unlockNow?.();
      activeRunRef.current = null;
      setActiveRun(null);
      setQoderHandoffState(null);
      setHandoffPreviewOpen(false);
      setCanvasMode("edit");
      setDrawer(null);
      return;
    }
    cancellingRunsRef.current.add(operationKey);
    const context = (
      (
        Boolean(run.projectId)
        && Boolean(projectIdRef.current)
        && run.projectId === projectIdRef.current
      )
      || sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
    )
      ? captureProjectContext()
      : null;
    setCancelling(true);
    try {
      const response = await bridgeFetch(`${BRIDGE_URL}/active-run/cancel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: run.projectId,
          sourcePath: run.sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
        }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "无法取消本轮。");
      const tracked = backgroundRunsRef.current.get(run.sourcePath);
      if (
        tracked?.requestId === run.requestId
        && tracked.attemptId === run.attemptId
      ) backgroundRunsRef.current.delete(run.sourcePath);
      if (context && isCurrentProjectContext(context)) {
        projectLockedRef.current = false;
        setProjectLocked(false);
        editorRef.current?.unlockNow?.();
        activeRunRef.current = null;
        setActiveRun(null);
        setHandoffPreviewOpen(false);
        setCanvasMode("edit");
        setDrawer(null);
      } else {
        setToast({
          title: `${run.candidateVersionLabel} 已取消`,
          message: "对应项目的评论仍然保留，迟到的完成信号不会被接纳。",
          tone: "success",
          dedupeKey: `background-version:${run.sourcePath}`,
        });
      }
    } catch (cause) {
      if (context && !isCurrentProjectContext(context)) return;
      setToast({
        title: "暂时无法取消",
        message: productErrorMessage(cause, "请稍后重试，当前项目会继续保持锁定。"),
        tone: "warning",
        sticky: true,
        dedupeKey: "cancel-run",
        action: { id: "retry-cancel", label: "重试取消" },
      });
    } finally {
      cancellingRunsRef.current.delete(operationKey);
      if (context && isCurrentProjectContext(context)) {
        setCancelling(false);
      }
    }
  }, [
    activeRun,
    captureProjectContext,
    isCurrentProjectContext,
  ]);

  const resolveAiConflict = useCallback(async (action: "adopt-ai" | "keep-external") => {
    if (!activeRun || activeRun.status !== "awaiting-conflict-resolution") return;
    const run = { ...activeRun };
    const operationKey = activeRunOperationKey(run);
    if (resolvingRunsRef.current.has(operationKey)) return;
    resolvingRunsRef.current.add(operationKey);
    const context = (
      (
        Boolean(run.projectId)
        && Boolean(projectIdRef.current)
        && run.projectId === projectIdRef.current
      )
      || sameLocalSourcePath(sourcePathRef.current, run.sourcePath)
    )
      ? captureProjectContext()
      : null;
    setResolvingConflict(true);
    try {
      const response = await bridgeFetch(`${BRIDGE_URL}/conflict/resolve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: run.projectId,
          sourcePath: run.sourcePath,
          requestId: run.requestId,
          attemptId: run.attemptId,
          conflictId: run.conflictId,
          action,
        }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "无法处理外部文件冲突。");
      if (action === "keep-external") {
        const tracked = backgroundRunsRef.current.get(run.sourcePath);
        if (
          tracked?.requestId === run.requestId
          && tracked.attemptId === run.attemptId
        ) backgroundRunsRef.current.delete(run.sourcePath);
        if (context && isCurrentProjectContext(context)) {
          projectLockedRef.current = false;
          setProjectLocked(false);
          editorRef.current?.unlockNow?.();
          setActiveRun(null);
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
        backgroundRunsRef.current.set(nextRun.sourcePath, nextRun);
        if (context && isCurrentProjectContext(context)) setActiveRun(nextRun);
      }
    } catch (cause) {
      if (context && !isCurrentProjectContext(context)) return;
      setToast({
        title: "冲突仍未解决",
        message: productErrorMessage(cause, "源文件没有被覆盖，请稍后重试。"),
        tone: "warning",
        sticky: true,
        dedupeKey: "ai-conflict",
        action: { id: "open-handoff", label: "返回冲突处理" },
      });
    } finally {
      resolvingRunsRef.current.delete(operationKey);
      if (context && isCurrentProjectContext(context)) {
        setResolvingConflict(false);
      }
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
    const previousHtml = htmlRef.current;
    const previousViewMode = viewMode;
    const previousViewingVersionId = viewingVersionId;
    const previousPreserveHistory = preserveEditorHistory;
    try {
      if (viewMode === "current") {
        if ((pendingWriteRef.current || flushPromiseRef.current) && !await flushAutosave()) {
          throw new Error("当前编辑尚未写回，不能切换到历史视图。");
        }
        if (
          navigationOperationRef.current !== operationId
          || !isCurrentProjectContext(context)
        ) return;
        const draftOk = await flushDraftPersistence({
          ...context,
          basedOnVersionId: currentBasedOnVersionId,
          expectedDraftRevision: draftRevisionRef.current,
          comments: [...commentsRef.current],
          changeEvents: [...changeEventsRef.current],
        });
        if (!draftOk) throw new Error("本轮评论尚未安全记录，不能切换到历史视图。");
      }
      const url = new URL(`${BRIDGE_URL}/version-file`);
      url.searchParams.set("sourcePath", context.sourcePath);
      url.searchParams.set("versionId", version.id);
      const response = await bridgeFetch(url, { cache: "no-store" });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "无法读取这份不可变版本。");
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
      htmlRef.current = content;
      setHtml(content);
      setPreserveEditorHistory(true);
      setRenderedContentSha256(null);
      await verifyCanvasRendered(content, hash, context);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      setViewMode("history");
      setViewingVersionId(version.id);
      setDrawer(null);
      editorRef.current?.clearSelection();
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      if (navigationOperationRef.current === operationId) {
        htmlRef.current = previousHtml;
        setHtml(previousHtml);
        setViewMode(previousViewMode);
        setViewingVersionId(previousViewingVersionId);
        setPreserveEditorHistory(true);
        setRenderedContentSha256(null);
        try {
          await verifyCanvasRendered(
            previousHtml,
            await browserSha256(previousHtml),
            context,
          );
        } catch {
          // Keep the prior view state; the error message below explains the failed transition.
        }
        window.requestAnimationFrame(() => {
          if (navigationOperationRef.current === operationId) {
            setPreserveEditorHistory(previousPreserveHistory);
          }
        });
      }
      setToast({
        title: "无法打开这个历史版本",
        message: productErrorMessage(cause, "历史版本没有打开，也不会回退读取当前文件。"),
        tone: "error",
        sticky: true,
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
    flushAutosave,
    flushDraftPersistence,
    isCurrentProjectContext,
    preserveEditorHistory,
    runInProgress,
    verifyCanvasRendered,
    viewingVersionId,
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
    const previousHtml = htmlRef.current;
    const previousViewMode = viewMode;
    const previousViewingVersionId = viewingVersionId;
    const previousPreserveHistory = preserveEditorHistory;
    try {
      const url = new URL(`${BRIDGE_URL}/source`);
      url.searchParams.set("sourcePath", context.sourcePath);
      const response = await bridgeFetch(url, { cache: "no-store" });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "无法读取当前源 HTML。");
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
      htmlRef.current = content;
      setPreserveEditorHistory(true);
      setHtml(content);
      setRenderedContentSha256(null);
      await verifyCanvasRendered(content, hash, context);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      sourceShaRef.current = hash;
      setSourceSha256(hash);
      setLastModifiedAt(String(payload.lastModifiedAt || ""));
      setCurrentBasedOnVersionId(
        payload.currentBasedOnVersionId
          ? String(payload.currentBasedOnVersionId)
          : currentBasedOnVersionId,
      );
      setCurrentExactVersionId(payload.currentExactVersionId ? String(payload.currentExactVersionId) : null);
      setRestoredFromVersionId(
        payload.restoredFromVersionId
          ? String(payload.restoredFromVersionId)
          : restoredFromVersionId,
      );
      setViewMode("current");
      setViewingVersionId(null);
      window.requestAnimationFrame(() => {
        if (navigationOperationRef.current === operationId) {
          setPreserveEditorHistory(false);
        }
      });
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      if (navigationOperationRef.current === operationId) {
        htmlRef.current = previousHtml;
        setHtml(previousHtml);
        setViewMode(previousViewMode);
        setViewingVersionId(previousViewingVersionId);
        setPreserveEditorHistory(previousPreserveHistory);
        setRenderedContentSha256(null);
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
        message: productErrorMessage(cause, "请确认源文件仍然存在后重试。"),
        tone: "error",
        sticky: true,
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
    isCurrentProjectContext,
    preserveEditorHistory,
    restoredFromVersionId,
    verifyCanvasRendered,
    viewingVersionId,
    viewMode,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.returnToCurrent = () => {
      void returnToCurrent(true);
    };
  }, [returnToCurrent]);

  const restoreVersion = useCallback(async (
    version: Version,
    fromDeferred = false,
  ) => {
    if (
      runInProgress
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
    ) return;
    const context = captureProjectContext();
    if (!context) return;
    if (
      !fromDeferred
      && !window.confirm(`用 ${version.label} 的内容替换当前 HTML？这不会创建新版本，当前评论会保留。`)
    ) return;
    if (
      !fromDeferred
      && deferEditorCommand(
        "project-switch",
        () => deferredEditorReplayRef.current.restoreVersion?.(version),
      )
    ) return;
    const operationId = beginNavigationOperation();
    if (operationId === null) return;
    const previousHtml = htmlRef.current;
    const previousViewMode = viewMode;
    const previousViewingVersionId = viewingVersionId;
    const previousPreserveHistory = preserveEditorHistory;
    let sourceWasReplaced = false;
    let committedContent = "";
    let committedHash = "";
    setRestoring(version.id);
    try {
      if (viewMode === "current") {
        if ((pendingWriteRef.current || flushPromiseRef.current) && !await flushAutosave()) {
          throw new Error("当前编辑尚未写回，不能执行历史替换。");
        }
      }
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      const draftOk = await flushDraftPersistence({
        ...context,
        basedOnVersionId: currentBasedOnVersionId,
        expectedDraftRevision: draftRevisionRef.current,
        comments: [...commentsRef.current],
        changeEvents: [...changeEventsRef.current],
      });
      if (!draftOk) {
        throw new Error("本轮评论尚未安全记录，不能执行历史替换。");
      }
      const expectedSourceSha256 = sourceShaRef.current;
      if (!expectedSourceSha256) {
        throw new Error("当前源 HTML 缺少可验证的 Hash，不能执行历史替换。");
      }
      const response = await bridgeFetch(`${BRIDGE_URL}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          projectId: context.projectId,
          documentId: context.documentId,
          sourcePath: context.sourcePath,
          versionId: version.id,
          expectedSourceSha256,
        }),
      });
      const payload = await readJsonResponse(response);
      if (!response.ok) throw responseError(payload, "无法替换当前 HTML。");
      sourceWasReplaced = true;
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      if (
        String(payload.projectId || "") !== context.projectId
        || String(payload.documentId || "") !== context.documentId
      ) throw new Error("历史替换返回的项目身份不一致。");
      const content = String(payload.content || "");
      const hash = String(payload.sha256 || payload.currentHtmlSha256 || "");
      if (!hash || await browserSha256(content) !== hash) {
        throw new Error("历史替换结果与声明 Hash 不一致。");
      }
      committedContent = content;
      committedHash = hash;
      htmlRef.current = content;
      setHtml(content);
      setRenderedContentSha256(null);
      await verifyCanvasRendered(content, hash, context);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      sourceShaRef.current = hash;
      pendingWriteRef.current = null;
      auditPendingRef.current = [];
      undoDraftFoldsRef.current.clear();
      redoDraftFoldsRef.current.clear();
      changeEventsRef.current = [];
      setChangeEvents([]);
      setSourceSha256(hash);
      setLastModifiedAt(String(payload.lastModifiedAt || ""));
      setCurrentBasedOnVersionId(version.id);
      setCurrentExactVersionId(version.id);
      setRestoredFromVersionId(version.id);
      setViewMode("current");
      setViewingVersionId(null);
      setPreserveEditorHistory(false);
      persistStateRef.current = "idle";
      setPersistState("idle");
      setPersistError("");
      persistRecoveryLog(null, context);
      await refreshWorkspace(context.sourcePath, context.epoch);
      if (
        navigationOperationRef.current !== operationId
        || !isCurrentProjectContext(context)
      ) return;
      setToast({
        title: `当前 HTML 已基于 ${version.label}`,
        message: `版本历史仍以 ${latestVersion?.label || "现有最新版"} 为最新；下一次有效 AI 返回会继续递增。`,
        tone: "success",
        dedupeKey: "history-restore",
      });
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      if (navigationOperationRef.current === operationId) {
        if (sourceWasReplaced) {
          if (committedContent) {
            htmlRef.current = committedContent;
            sourceShaRef.current = committedHash;
            setHtml(committedContent);
            setSourceSha256(committedHash);
            setRenderedContentSha256(null);
          }
          const message = cause instanceof Error
            ? cause.message
            : "源文件已替换，但画布核对未完成。";
          projectLoadErrorRef.current = message;
          setProjectLoadError(message);
        } else {
          htmlRef.current = previousHtml;
          setHtml(previousHtml);
          setViewMode(previousViewMode);
          setViewingVersionId(previousViewingVersionId);
          setPreserveEditorHistory(previousPreserveHistory);
          setRenderedContentSha256(null);
          try {
            await verifyCanvasRendered(
              previousHtml,
              await browserSha256(previousHtml),
              context,
            );
          } catch {
            // The previous view remains authoritative.
          }
        }
      }
      setToast({
        title: "历史内容没有替换",
        message: productErrorMessage(cause, "操作没有提交到当前画布，请检查后重试。"),
        tone: "error",
        sticky: true,
        dedupeKey: "history-restore",
      });
    } finally {
      if (navigationOperationRef.current === operationId) setRestoring(null);
      finishNavigationOperation(operationId);
    }
  }, [
    beginNavigationOperation,
    captureProjectContext,
    deferEditorCommand,
    finishNavigationOperation,
    flushAutosave,
    flushDraftPersistence,
    isCurrentProjectContext,
    latestVersion,
    persistRecoveryLog,
    refreshWorkspace,
    runInProgress,
    currentBasedOnVersionId,
    verifyCanvasRendered,
    viewingVersionId,
    viewMode,
    preserveEditorHistory,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.restoreVersion = (version) => {
      void restoreVersion(version, true);
    };
  }, [restoreVersion]);

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
            : "内置介绍页 · 打开本地 HTML 后开始编辑";
  const activeOpenedAiVersionNotice =
    sameLocalSourcePath(openedAiVersionNotice?.sourcePath, sourcePath)
      ? openedAiVersionNotice
      : null;
  const visibleRecentProjects = recentProjects
    .filter((project) => !sameLocalSourcePath(project.sourcePath, sourcePath))
    .slice(0, 3);
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
  const processPanelTitle = pendingRunOutcome
    ? "正在核对任务是否建立"
    : activeRun?.status === "ready-to-open"
      ? "修改结果已通过检查"
      : activeRun?.status === "no-change"
        ? "这次没有产生有效变化"
        : activeRun?.status === "error"
          ? "本轮需要处理后再试"
          : "等待 QoderWork 返回修改结果";
  const processSummaryTitle = pendingRunOutcome
    ? "为避免重复任务，画布暂时保持只读"
    : activeRun?.status === "ready-to-open"
      ? "新版本已保留，等待你确认打开"
      : activeRun?.status === "no-change"
        ? "页面与评论可以继续编辑"
        : activeRun?.status === "error"
          ? "源 HTML 没有被覆盖"
          : "画布已锁定，仅可浏览";
  const processSummaryDetail = pendingRunOutcome
    ? "可立即重新核对；若本地服务没有恢复，也可以重新打开源页"
    : activeRun?.status === "no-change"
      ? "原评论和附件都已保留，调整要求后可以重新发送"
      : activeRun?.status === "error"
        ? "错误详情保留在本轮记录中，返回编辑后可调整并重试"
        : "原始评论和本地内容均已冻结，返回结果不会覆盖它们";
  const processStatusLabel = pendingRunOutcome
    ? "正在等待修改结果"
    : activeRun?.status === "ready-to-open"
      ? "等待确认打开"
      : activeRun?.status === "no-change"
        ? "没有新版本"
        : activeRun?.status === "error"
          ? "需要处理"
          : "正在等待修改结果";
  const returnedStates: LifecycleState[] = [
    "validating",
    "awaiting-check-decision",
    "committing",
    "ready-to-open",
    "complete",
    "no-change",
    "error",
  ];
  const validatedStates: LifecycleState[] = [
    "awaiting-check-decision",
    "committing",
    "ready-to-open",
    "complete",
    "no-change",
  ];
  const processSteps = activeRun ? [
    {
      key: "frozen",
      label: "本轮要求已冻结",
      detail: "原始评论和本地编辑不会再被覆盖",
      state: activeRun.requestId !== "pending" && activeRun.status !== "submitting"
        ? "done"
        : "current",
    },
    {
      key: "copied",
      label: currentQoderHandoffStatus === "failed"
        ? "交接内容尚未复制"
        : "交接内容已写入剪贴板",
      detail: currentQoderHandoffStatus === "copied"
        ? "仅确认剪贴板写入成功，不代表 Qoder 已收到"
        : currentQoderHandoffStatus === "failed"
          ? "Request 已安全保留，可在下方重新复制"
          : currentQoderHandoffStatus === "copying"
            ? "正在写入并核对剪贴板"
            : "等待复制本轮要求",
      state: currentQoderHandoffStatus === "copied"
        ? "done"
        : currentQoderHandoffStatus === "failed"
          ? "error"
          : "current",
    },
    {
      key: "returned",
      label: "已检测到 AI 返回结果",
      detail: returnedStates.includes(activeRun.status)
        ? "完整 HTML 和完成记录已经出现"
        : "等待 AI 写回受控文件",
      state: returnedStates.includes(activeRun.status) ? "done" : "pending",
    },
    {
      key: "integrity",
      label: "版本与文件完整性",
      detail: activeRun.status === "error"
        ? activeRun.error || "硬校验未通过"
        : activeRun.status === "no-change"
          ? "结果已核对，没有可采用的内容变化"
        : validatedStates.includes(activeRun.status)
          ? "不可忽略的安全校验已通过"
          : "等待返回结果",
      state: activeRun.status === "error"
        ? "error"
        : validatedStates.includes(activeRun.status)
          ? "done"
          : returnedStates.includes(activeRun.status)
            ? "current"
            : "pending",
    },
    {
      key: "scope",
      label: "范围与质量校验",
      detail: activeRun.status === "awaiting-check-decision"
        ? "发现可忽略的范围问题，需要你决定"
        : activeRun.validationReview?.status === "waived"
          ? "已按你的决定记录并继续"
          : ["committing", "ready-to-open", "complete", "no-change"].includes(activeRun.status)
            ? "已通过"
            : "等待校验",
      state: activeRun.status === "awaiting-check-decision"
        ? "attention"
        : ["committing", "ready-to-open", "complete", "no-change"].includes(activeRun.status)
          ? "done"
          : activeRun.status === "validating"
            ? "current"
            : "pending",
    },
    {
      key: "version",
      label: "新版本已安全保存",
      detail: activeRun.status === "no-change"
        ? "没有创建新版本，当前 HTML 保持不变"
        : ["ready-to-open", "complete"].includes(activeRun.status)
          ? `${activeRun.candidateVersionLabel} 已保留，旧版未被覆盖`
        : "等待版本提交",
      state: ["ready-to-open", "complete", "no-change"].includes(activeRun.status)
        ? "done"
        : activeRun.status === "committing"
          ? "current"
          : "pending",
    },
    {
      key: "open",
      label: "打开最新版",
      detail: activeRun.status === "ready-to-open"
        ? "由你确认后才替换左侧画布"
        : activeRun.status === "complete"
          ? "左侧已经打开最新版"
          : activeRun.status === "no-change"
            ? "无需打开新版本，可直接返回编辑"
          : "等待前序步骤完成",
      state: ["complete", "no-change"].includes(activeRun.status)
        ? "done"
        : activeRun.status === "ready-to-open"
          ? "current"
          : "pending",
    },
  ] as const : [];
  const draftTargetScope = !draftTarget
    ? "尚未选择"
    : draftTarget.tagName === "body"
      ? "全局评论"
      : draftTarget.level === "module"
      ? "整个模块"
      : draftTarget.level === "insertion"
        ? "添加位置"
        : "页面内容";
  const sortedVisibleCommentItems = useMemo(() => (
    visibleCommentItems
      .map((comment, index) => ({
        comment,
        index,
        targetTop: comment.target.tagName === "body"
          ? 82
          : commentTargetTops[comment.target.id]
            ?? comment.target.boundingBox?.y
            ?? Number.MAX_SAFE_INTEGER,
      }))
      .sort((left, right) => (
        left.targetTop - right.targetTop
        || left.comment.createdAt.localeCompare(right.comment.createdAt)
        || left.index - right.index
      ))
      .map(({ comment }) => comment)
  ), [commentTargetTops, visibleCommentItems]);
  const commentRailLayout = useMemo(() => {
    const items: Array<{
      key: string;
      targetTop: number;
      fallbackHeight: number;
      order: number;
    }> = sortedVisibleCommentItems.map((comment, index) => {
      const imageCount = (comment.attachments ?? []).filter(
        (attachment) => attachment.kind === "image",
      ).length;
      const fileCount = (comment.attachments ?? []).length - imageCount;
      const textLines = Math.max(1, Math.ceil((comment.text.length || 18) / 25));
      const imageRows = Math.ceil(imageCount / 3);
      return {
        key: comment.commentId,
        targetTop: comment.target.tagName === "body"
          ? 82
          : Math.max(
              82,
              commentTargetTops[comment.target.id]
                ?? comment.target.boundingBox?.y
                ?? commentRailHeight
                ?? 82,
            ),
        fallbackHeight: 104 + textLines * 19 + imageRows * 78 + fileCount * 48,
        order: index + 1,
      };
    });
    if (composerOpen && draftTarget) {
      items.push({
        key: "__composer",
        targetTop: draftTarget.tagName === "body"
          ? 82
          : Math.max(
              82,
              commentTargetTops[draftTarget.id]
                ?? draftTarget.boundingBox?.y
                ?? 82,
            ),
        fallbackHeight: 276,
        order: 0,
      });
    }
    items.sort((left, right) => (
      left.targetTop - right.targetTop || left.order - right.order
    ));
    const positions: Record<string, number> = {};
    const minimumTop = 82;
    const itemGap = 20;
    const itemHeight = (item: (typeof items)[number]) => (
      commentCardHeights[item.key] || item.fallbackHeight
    );
    const focusKey = composerOpen && draftTarget ? "__composer" : focusedCommentId;
    const focusIndex = focusKey
      ? items.findIndex((item) => item.key === focusKey)
      : -1;

    if (focusIndex >= 0) {
      const focusedItem = items[focusIndex];
      const focusedTop = Math.max(minimumTop, focusedItem.targetTop);
      positions[focusedItem.key] = focusedTop;

      let upperCursor = focusedTop;
      const deferredItems: typeof items = [];
      for (let index = focusIndex - 1; index >= 0; index -= 1) {
        const item = items[index];
        const availableTop = upperCursor - itemHeight(item) - itemGap;
        if (availableTop < minimumTop) {
          deferredItems.unshift(item);
          continue;
        }
        const top = Math.min(Math.max(minimumTop, item.targetTop), availableTop);
        positions[item.key] = top;
        upperCursor = top;
      }

      let lowerCursor = focusedTop + itemHeight(focusedItem) + itemGap;
      for (const item of [...deferredItems, ...items.slice(focusIndex + 1)]) {
        const top = Math.max(lowerCursor, item.targetTop);
        positions[item.key] = top;
        lowerCursor = top + itemHeight(item) + itemGap;
      }
    } else {
      let cursor = minimumTop;
      for (const item of items) {
        const top = Math.max(cursor, item.targetTop);
        positions[item.key] = top;
        cursor = top + itemHeight(item) + itemGap;
      }
    }
    const bottom = items.reduce((maximum, item) => (
      Math.max(
        maximum,
        (positions[item.key] ?? minimumTop) + itemHeight(item) + itemGap,
      )
    ), minimumTop);
    const heights = Object.fromEntries(
      items.map((item) => [item.key, itemHeight(item)]),
    );
    return {
      positions,
      heights,
      bottom,
      composerTop: positions.__composer ?? 82,
    };
  }, [
    commentCardHeights,
    commentRailHeight,
    commentTargetTops,
    composerOpen,
    draftTarget,
    focusedCommentId,
    sortedVisibleCommentItems,
  ]);
  const visibleCommentPositions = commentRailLayout.positions;
  const renderedCommentIds = useMemo(() => virtualizedCommentIds({
    ids: sortedVisibleCommentItems.map((comment) => comment.commentId),
    positions: commentRailLayout.positions,
    heights: commentRailLayout.heights,
    viewportTop: commentViewport.top,
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
  const commentRailContentHeight = Math.max(
    commentRailHeight,
    commentRailLayout.bottom + 24,
    720,
  );
  const canvasDocumentHeight = Math.max(
    760,
    Math.ceil(commentRailHeight || 0),
  );
  const returnToEditingFromTerminalRun = (adjustRequirements: boolean) => {
    const completedRun = activeRunRef.current;
    if (completedRun?.sourcePath) {
      qoderHandoffStatesRef.current.delete(completedRun.sourcePath);
    }
    activeRunRef.current = null;
    setActiveRun(null);
    setQoderHandoffState(null);
    setHandoffPreviewOpen(false);
    setCanvasMode("edit");
    setDrawer(null);
    setProjectLocked(false);
    projectLockedRef.current = false;
    editorRef.current?.unlockNow?.();
    if (!adjustRequirements) return;
    const firstComment = commentsRef.current.find(commentHasContent);
    window.requestAnimationFrame(() => {
      if (!firstComment) {
        openGlobalCommentComposer();
      } else if (!canLocateTarget(firstComment.target)) {
        beginTargetRelink(firstComment.commentId);
      } else {
        beginCommentEdit(firstComment);
      }
    });
  };
  const handleToastAction = () => {
    const action = toast?.action;
    if (!action) return;
    setToast(null);
    if (action.id === "retry-export") {
      void exportCurrentHtml();
    } else if (action.id === "open-handoff") {
      setDrawer("handoff");
    } else if (action.id === "open-project") {
      void openProject(action.sourcePath);
    } else if (action.id === "retry-project-open") {
      void openProject(action.sourcePath);
    } else if (action.id === "show-project") {
      void showProjectInFolder(action.sourcePath);
    } else if (action.id === "show-project-records") {
      void showProjectRecordsInFolder();
    } else if (action.id === "reveal-request") {
      void revealActiveRunInFinder();
    } else if (action.id === "reveal-version") {
      const version = versions.find((item) => item.id === action.versionId);
      if (version) void revealVersionInFinder(version);
    } else if (action.id === "retry-source-diff") {
      void viewSourceConflictDiff();
    } else if (action.id === "retry-ai-diff") {
      void viewAiConflictDiff();
    } else if (action.id === "retry-reload") {
      void reloadCurrentSource(true);
    } else if (action.id === "open-attachment-picker") {
      openAttachmentPicker(action.target, action.accept || "all");
    } else if (action.id === "review-comment-attachments") {
      if (action.target.kind === "composer") {
        const target = draftTargetRef.current;
        if (
          composerCommentIdRef.current === action.target.commentId
          && target
        ) {
          setComposerOpen(true);
          queueReviewPairReveal(target, "__composer");
          window.requestAnimationFrame(() => {
            composerRef.current?.focus({ preventScroll: true });
          });
        }
      } else {
        const comment = commentsRef.current.find(
          (item) => item.commentId === action.target.commentId,
        );
        if (comment) focusCommentTarget(comment.target, comment.commentId);
      }
    } else if (action.id === "retry-attachment-preview") {
      void openAttachmentPreview(action.attachment);
    } else if (action.id === "retry-attachment-download") {
      void downloadAttachment(action.attachment);
    } else if (action.id === "relink-target") {
      beginTargetRelink(action.commentId);
      setCanvasMode("edit");
      setDrawer(null);
    } else if (action.id === "resume-draft") {
      const target = draftTargetRef.current;
      if (!target) return;
      if (!canLocateTarget(target)) {
        beginTargetRelink("__composer");
        return;
      }
      const located = editorRef.current?.select(target, { showToolbar: false });
      const nextTarget = located || target;
      draftTargetRef.current = nextTarget;
      setSelection(nextTarget);
      setDraftTarget(nextTarget);
      setComposerOpen(true);
      queueReviewPairReveal(nextTarget, "__composer");
      window.requestAnimationFrame(() => composerRef.current?.focus({ preventScroll: true }));
    } else if (action.id === "retry-reconcile") {
      setDrawer("handoff");
      void reconcilePendingRun();
    } else if (action.id === "relaunch-app") {
      void relaunchApp();
    } else if (action.id === "retry-cancel") {
      void cancelActiveRun();
    } else if (action.id === "open-release") {
      void openLatestRelease();
    }
  };
  const renderHistoryItem = (version: Version) => {
    const expanded = expandedVersionId === version.id;
    const attachmentCount = version.comments.reduce(
      (count, comment) => count + (comment.attachments?.length ?? 0),
      0,
    );
    return (
      <article
        className="history-item version-entry"
        data-current={version.id === latestVersionId ? "true" : undefined}
        key={version.id}
      >
        <button
          className="version-row"
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpandedVersionId(expanded ? null : version.id)}
        >
          <span className="version-index">V{version.ordinal}</span>
          <span>
            <strong>{version.label}</strong>
            <small>
              {version.ordinal === 1 ? "原始导入" : `${version.comments.length} 条评论 · 已安全保留`}
            </small>
          </span>
          <time dateTime={version.generatedAt}>{formatTime(version.generatedAt)}</time>
          <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
        </button>
        {expanded ? (
          <section className="version-inline-detail" aria-label={`${version.label} 详情`}>
            <header>
              <span>{viewingVersionId === version.id ? "当前浏览" : "只读备份"}</span>
              <small>{formatTime(version.generatedAt, true)} 保存</small>
            </header>
            <div className="version-summary-facts">
              <div><strong>{version.comments.length}</strong><span>条评论</span></div>
              <div><strong>{attachmentCount}</strong><span>个附件</span></div>
              <div><strong>网页</strong><span>画布类型</span></div>
            </div>
            <div className="version-change-summary">
              <strong>这个版本包含</strong>
              <ul>
                <li>{version.summary || "完整 HTML 内容与页面结构"}</li>
                <li>评论、图片与附件的完整保留</li>
                <li>{version.validationReview?.status === "waived" ? "安全校验通过，范围提示已记录" : "版本与文件完整性已校验"}</li>
              </ul>
            </div>
            {version.comments.length > 0
              || version.directEdits.length > 0
              || version.supplements.length > 0
              || version.validationReview ? (
              <details className="history-records">
                <summary>查看本版修改来源与校验</summary>
                <section className="history-source-group">
                  <header><strong>源页原始评论</strong><span>{version.comments.length}</span></header>
                  {version.comments.map((comment) => (
                    <article className="history-record" key={comment.commentId}>
                      <div>
                        <strong>{insertionLabel(comment.target)}</strong>
                        <span
                          className="target-resolution"
                          data-resolution={comment.target.resolution}
                        >{targetResolutionLabel(comment.target.resolution)}</span>
                        <time dateTime={comment.updatedAt || comment.createdAt}>
                          {formatTime(comment.updatedAt || comment.createdAt, true)}
                        </time>
                      </div>
                      {comment.text ? <p>{comment.text}</p> : null}
                      <CommentAttachmentStrip
                        attachments={comment.attachments}
                        objectUrls={attachmentObjectUrls}
                        onEnsurePreview={ensureAttachmentObjectUrl}
                        onPreview={(attachment) => void openAttachmentPreview(attachment)}
                        onDownload={(attachment) => void downloadAttachment(attachment)}
                      />
                    </article>
                  ))}
                  {version.comments.length === 0 ? <small>本版没有源页评论。</small> : null}
                </section>
                <section className="history-source-group">
                  <header><strong>内部 AI 对话补充</strong><span>{version.supplements.length}</span></header>
                  {version.supplements.map((supplement) => (
                    <article className="history-record" key={supplement.recordId}>
                      <div>
                        <strong>
                          {supplement.action === "add"
                            ? "新增要求"
                            : supplement.action === "amend"
                              ? "补充修改"
                              : "撤回要求"}
                        </strong>
                        <time dateTime={supplement.createdAt}>
                          {formatTime(supplement.createdAt, true)}
                        </time>
                      </div>
                      <p>{supplement.text}</p>
                      {supplement.attachments.length > 0 ? (
                        <small>
                          已归档原件：
                          {supplement.attachments.map((item) => item.fileName).join("、")}
                        </small>
                      ) : supplement.evidenceState === "description-only" ? (
                        <small>原件未归档 · {supplement.evidenceDescription}</small>
                      ) : null}
                    </article>
                  ))}
                  {version.supplements.length === 0 ? <small>本版没有内部 AI 对话补充。</small> : null}
                </section>
                <section className="history-source-group">
                  <header>
                    <strong>本地编辑</strong>
                    <span>{summarizeChangeEvents(version.directEdits).length}</span>
                  </header>
                  {summarizeChangeEvents(version.directEdits).map((event) => (
                    <article
                      className="history-record history-change-record"
                      key={event.eventId}
                    >
                      <div>
                        <strong>
                          {changeKindLabel(event)} · {insertionLabel(event.target)}
                        </strong>
                        <time dateTime={event.createdAt}>
                          {formatTime(event.createdAt, true)}
                        </time>
                      </div>
                      <div className="history-change-values">
                        <span>
                          <small>修改前</small>
                          <del>{historyRecordValue(event, event.before)}</del>
                        </span>
                        <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                        <span>
                          <small>修改后</small>
                          <ins>{historyRecordValue(event, event.after)}</ins>
                        </span>
                      </div>
                    </article>
                  ))}
                  {version.directEdits.length === 0 ? <small>本版没有本地编辑。</small> : null}
                </section>
                <section className="history-source-group">
                  <header><strong>AI 结果与校验</strong><span>已归档</span></header>
                  <p>{version.validationReview?.status === "waived"
                    ? "硬校验通过；软校验由用户选择忽略，决定与原因已记录。"
                    : "版本与文件内容已经校验并保存。"}</p>
                </section>
              </details>
            ) : null}
            <div className="version-detail-actions">
              <button
                className="view-version-button"
                type="button"
                disabled={
                  runInProgress
                  || projectHydrating
                  || Boolean(projectLoadError)
                  || Boolean(workspaceIssue)
                  || viewTransitioning
                }
                onClick={() => void viewHistoryVersion(version)}
              >
                <EyeIcon aria-hidden="true" size={15} weight="bold" />
                在画布中查看
              </button>
              {typeof window !== "undefined" && window.htmlAIProjects?.revealVersionFile ? (
                <button type="button" onClick={() => void revealVersionInFinder(version)}>
                  Finder
                </button>
              ) : null}
              <button
                type="button"
                disabled={
                  runInProgress
                  || projectHydrating
                  || Boolean(projectLoadError)
                  || viewTransitioning
                  || restoring !== null
                }
                onClick={() => void restoreVersion(version)}
              >{restoring === version.id ? "正在切换…" : "设为当前 HTML"}</button>
            </div>
          </section>
        ) : null}
      </article>
    );
  };

  return (
    <main
      className="workbench"
      data-round-state={runInProgress ? "processing" : viewMode}
      data-canvas-mode={canvasMode}
      aria-label="HTML AI 可视化编辑工作台"
    >
      <header className="workbench-header">
        <div className="window-file">
          <div className="window-file-copy">
            <strong
              title={activeOpenedAiVersionNotice?.fileName || projectName}
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {activeOpenedAiVersionNotice?.fileName || projectName}
            </strong>
            <span className="file-meta">
              <span>
                {viewMode === "history"
                  ? `${viewingVersion?.label || "历史版本"} · 只读`
                  : activeRun?.candidateVersionLabel && runInProgress
                    ? `${activeRun.candidateVersionLabel} · 本轮处理中`
                    : currentBasedOnVersionId
                      ? safeVersionLabel(currentBasedOnVersionId)
                      : latestVersion?.label || "版本 1"}
              </span>
              <span
                className="save-status"
                data-persist-state={persistState}
                data-edit-revision={editRevision}
                data-persisted-revision={lastPersistedRevision}
                data-rendered-sha256={renderedContentSha256 || undefined}
                role="status"
                aria-live="polite"
              >
                <span aria-hidden="true" />
                {persistState === "idle" ? "已安全保存" : persistLabel}
              </span>
            </span>
          </div>
        </div>

        <nav className="header-actions" aria-label="画布模式、项目和版本操作">
          <div className="canvas-mode-switch" role="group" aria-label="画布模式">
            <button
              type="button"
              aria-pressed={canvasMode === "edit"}
              disabled={runInProgress || viewMode === "history"}
              onClick={() => {
                setCanvasMode("edit");
                setProjectMenuOpen(false);
              }}
            >
              <PencilSimpleIcon aria-hidden="true" size={16} weight="bold" />
              编辑
            </button>
            <button
              type="button"
              aria-pressed={canvasMode === "preview"}
              disabled={interactionLocked}
              title={interactionLocked ? "当前状态只能使用编辑画布" : "运行页面自身的脚本和交互"}
              onClick={() => {
                if (interactionLocked) return;
                const enterPreview = () => {
                  const committed = editorRef.current?.fencePendingEdit({
                    resumeEditing: false,
                    trigger: "manual",
                  });
                  if (!committed || !committed.ok) {
                    setToast({
                      title: "当前文字还没有提交",
                      message: committed?.reason || "编辑画布尚未就绪，请稍后再进入预览。",
                      tone: "warning",
                      dedupeKey: "preview-commit-blocked",
                    });
                    return;
                  }
                  editorRef.current?.clearSelection();
                  setSelection(null);
                  updateFocusedComment(null);
                  setProjectMenuOpen(false);
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
            disabled={projectHydrating || viewTransitioning}
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
          <div className="header-send-cluster">
            {updateAvailable ? (
              <button
                className="header-update-badge"
                type="button"
                aria-label={`发现 PageRoot ${updateResult?.latestVersion || "新版本"}，打开 GitHub 更新页面`}
                title={`PageRoot ${updateResult?.latestVersion || "新版本"} 可用`}
                onClick={() => void openLatestRelease()}
              >
                Update
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
                  activeCommentCount === 0
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
                ? <small>{activeCommentCount}</small>
                : null}
            </button>
          </div>
        </nav>
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
      </header>

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
          <button type="button" onClick={() => void viewSourceConflictDiff()}>查看差异</button>
          <button type="button" onClick={() => void exportCurrentHtml()}>导出当前编辑</button>
          <button type="button" onClick={() => void reloadCurrentSource()}>重新载入外部文件</button>
        </section>
      ) : null}

      {runInProgress && handoffPreviewOpen ? (
        <section className="history-view-banner sent-preview-banner" role="status">
          <div>
            <EyeIcon aria-hidden="true" size={18} weight="duotone" />
            <span>
              <strong>正在预览已发送 HTML</strong>
              <small>这是本轮冻结并复制给 Qoder 的只读内容</small>
            </span>
          </div>
          <button
            type="button"
            onClick={() => {
              setHandoffPreviewOpen(false);
              setCanvasMode("edit");
              setDrawer("handoff");
            }}
          >
            <ArrowCounterClockwiseIcon aria-hidden="true" size={15} weight="bold" />
            返回等待处理
          </button>
        </section>
      ) : viewMode === "history" ? (
        <section className="history-view-banner" role="status">
          <div>
            <ClockCounterClockwiseIcon aria-hidden="true" size={18} weight="duotone" />
            <span>
              <strong>正在浏览 {viewingVersion?.label || viewingVersionId}</strong>
              <small>
                {viewingVersion
                  ? `只读 HTML 与 ${viewingVersion.comments.length} 条历史评论已在画布中展开`
                  : "画布来自精确不可变版本文件"}
              </small>
            </span>
          </div>
          <button
            type="button"
            disabled={viewTransitioning}
            onClick={() => void returnToCurrent()}
          >
            <ArrowCounterClockwiseIcon aria-hidden="true" size={15} weight="bold" />
            回到当前版本
          </button>
        </section>
      ) : null}

      <div ref={reviewStageRef} className="review-scroll-stage">
        <section className="canvas-column" aria-label="页面画布">
          <div
            className="canvas-edit-surface"
            hidden={canvasMode !== "edit"}
            aria-hidden={canvasMode !== "edit"}
          >
            <Suspense fallback={(
              <div className="canvas-loading" role="status">正在载入源码画布…</div>
            )}>
              <HtmlCanvasEditor
                ref={editorRef}
                html={html}
                sourcePath={sourcePath || undefined}
                height={`${canvasDocumentHeight}px`}
                onChange={handleCanvasChange}
                onInteraction={() => {
                  setProjectMenuOpen(false);
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
                onRequestReload={() => {
                  if (sourcePathRef.current) {
                    void reloadCurrentSource();
                  } else {
                    void openProject();
                  }
                }}
                reloadActionLabel={sourcePath ? "重新载入" : "重新选择"}
                commentedTargets={commentedTargets}
                trackedTargets={trackedAuditTargets}
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
                preserveUndoHistory={preserveEditorHistory}
              />
            </Suspense>
          </div>
          {canvasMode === "preview" ? (
            <HtmlInteractionPreview
              html={html}
              sourcePath={sourcePath || undefined}
              height="100%"
              onInteraction={() => setProjectMenuOpen(false)}
            />
          ) : null}
        </section>

        {canvasMode === "edit" ? (
          <aside
            ref={commentsPanelRef}
            className="comments-panel comment-rail"
            aria-label={viewMode === "history" ? "历史版本评论" : "本轮评论"}
          >
          <div
            className="comment-rail-content"
            style={{ minHeight: `${commentRailContentHeight}px` }}
          >
            <header className="comments-header comment-rail-header">
              <div>
                <h1>评论 <span>{visibleCommentItems.length}</span></h1>
                <small>{viewMode === "history"
                  ? "历史版本 · 只读"
                  : visibleCommentItems.length > COMMENT_VIRTUALIZATION_THRESHOLD
                    ? `与正文同步滚动 · 当前加载 ${renderedVisibleCommentItems.length} 条`
                    : "与正文同步滚动"}</small>
                <span className="round-record-counts sr-only">
                  {activeCommentCount} 条评论 · {changeEvents.length} 项直接编辑记录
                </span>
              </div>
            </header>
            <span className="sr-only" role="status" aria-live="polite">
              {composerOpen
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
                  const activeSource = sourcePathRef.current;
                  if (!activeSource) return;
                  projectHydratingRef.current = true;
                  projectLoadErrorRef.current = null;
                  setProjectHydrating(true);
                  setProjectLoadError(null);
                  const hydrationEpoch = projectEpochRef.current;
                  void refreshWorkspace(activeSource, hydrationEpoch, false, hydrationEpoch);
                }}>重试读取</button>
              </section>
            ) : composerOpen && draftTarget && !interactionLocked ? (
              <section
                className="comment-composer rail-comment-composer"
                aria-label="添加评论"
                data-comment-measure="__composer"
                data-focused="true"
                style={{ top: `${composerTop}px` }}
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
                    title="关闭"
                    onClick={closeCommentComposer}
                  >
                    <XIcon aria-hidden="true" size={15} weight="bold" />
                  </button>
                </header>
                <label htmlFor="round-comment-draft">评论内容</label>
                {!canLocateTarget(draftTarget) ? (
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
                  disabled={!draftTarget || !canLocateTarget(draftTarget) || interactionLocked}
                  placeholder={draftTarget.tagName === "body"
                    ? "输入对整个页面的修改要求…"
                    : "输入对这部分内容的修改要求…"}
                  onChange={(event) => {
                    composerDraftRef.current = event.target.value;
                    setDraft(event.target.value);
                    persistCurrentDraftRecovery();
                  }}
                  onPaste={(event) => {
                    const commentId = draftCommentId || composerCommentIdRef.current;
                    if (commentId) pasteImages(event, { kind: "composer", commentId });
                  }}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      addComment();
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
                    {attachmentUploadCount > 0 ? <small>正在添加附件…</small> : null}
                  </div>
                  <button
                    className="add-comment-button"
                    type="button"
                    disabled={
                      !canLocateTarget(draftTarget)
                      || (!draft.trim() && draftAttachments.length === 0)
                      || attachmentUploadCount > 0
                      || interactionLocked
                    }
                    onClick={(event) => {
                      event.currentTarget.blur();
                      addComment();
                    }}
                  >
                    <ChatCircleTextIcon aria-hidden="true" size={15} weight="bold" />
                    评论
                  </button>
                </footer>
              </section>
            ) : draftTarget && (draft.trim() || draftAttachments.length > 0) && !interactionLocked ? (
              <section
                className="draft-recovery-card rail-status-card"
                aria-label="未发送评论"
              >
                <div><strong>有一条未发送评论</strong><span>{insertionLabel(draftTarget)}</span></div>
                <button
                  className="resume-comment-button"
                  type="button"
                  onClick={() => {
                    if (!canLocateTarget(draftTarget)) {
                      beginTargetRelink("__composer");
                      return;
                    }
                    const located = editorRef.current?.select(draftTarget, { showToolbar: false });
                    setSelection(located || draftTarget);
                    setDraftTarget(located || draftTarget);
                    draftTargetRef.current = located || draftTarget;
                    updateFocusedComment(null);
                    setComposerOpen(true);
                    queueReviewPairReveal(located || draftTarget, "__composer");
                    window.requestAnimationFrame(() => {
                      composerRef.current?.focus({ preventScroll: true });
                    });
                  }}
                >{canLocateTarget(draftTarget) ? "继续填写" : "重新选择目标"}</button>
              </section>
            ) : null}

            {visibleCommentItems.length === 0 && !composerOpen ? (
              <div className="comments-empty">
                <ChatCircleTextIcon aria-hidden="true" size={24} weight="duotone" />
                <strong>评论会显示在这里</strong>
                <span>可以评论整个页面、模块或其中的小区块。</span>
              </div>
            ) : renderedVisibleCommentItems.map((comment) => {
              const index = sortedVisibleCommentItems.findIndex(
                (item) => item.commentId === comment.commentId,
              );
              const editable = viewMode === "current" && !interactionLocked;
              const editing = editingCommentId === comment.commentId;
              const deleting = pendingDeleteCommentId === comment.commentId;
              const quote = comment.target.textQuote || comment.target.text;
              return (
                <article
                  className="comment-card"
                  data-comment-measure={comment.commentId}
                  data-selected={selection?.selector === comment.target.selector ? "true" : "false"}
                  data-focused={focusedCommentId === comment.commentId ? "true" : undefined}
                  data-resolution={comment.target.resolution}
                  data-editing={editing ? "true" : undefined}
                  role="group"
                  aria-current={focusedCommentId === comment.commentId ? "location" : undefined}
                  tabIndex={editable && canLocateTarget(comment.target) ? 0 : -1}
                  aria-label={`${insertionLabel(comment.target)}：${comment.text}`}
                  style={{ top: `${visibleCommentPositions[comment.commentId] ?? 82}px` }}
                  onClick={() => {
                    if (!editing && !deleting && editable && canLocateTarget(comment.target)) {
                      focusCommentTarget(comment.target, comment.commentId);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (
                      event.target === event.currentTarget
                      && !editing
                      && !deleting
                      && editable
                      && canLocateTarget(comment.target)
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
                  {quote ? <q>{quote.length > 96 ? `${quote.slice(0, 96)}…` : quote}</q> : null}
                  {!canLocateTarget(comment.target) && editable ? (
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
                      onChange={(event) => setCommentEditDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Escape") {
                          event.preventDefault();
                          cancelCommentEdit();
                        } else if (
                          (event.metaKey || event.ctrlKey)
                          && event.key === "Enter"
                        ) {
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
                    attachments={comment.attachments}
                    objectUrls={attachmentObjectUrls}
                    editable={editable}
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
                        <span>{comment.attachments?.length
                          ? `${comment.attachments.length} 个附件`
                          : "可添加附件"}</span>
                        <div className="comment-card-tools">
                          <button
                            className="comment-tool-button"
                            type="button"
                            aria-label="添加附件"
                            title="添加附件"
                            onClick={(event) => {
                              event.stopPropagation();
                              openAttachmentPicker(
                                { kind: "comment", commentId: comment.commentId },
                                "all",
                              );
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
                              openAttachmentPicker(
                                { kind: "comment", commentId: comment.commentId },
                                "image",
                              );
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
                                disabled={!commentEditDraft.trim() && !(comment.attachments?.length)}
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

            {draftPersistError ? (
              <section className="comment-persist-error rail-persist-error" role="alert">
                <div>
                  <strong>评论还没有安全记录</strong>
                  <span>{productErrorMessage(
                    draftPersistError,
                    "本轮评论暂时无法记录；当前内容仍保留在页面中。",
                  )}</span>
                </div>
                <button type="button" onClick={() => void flushDraftPersistence()}>重试记录</button>
              </section>
            ) : null}
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
          <header className="drawer-header processing-header">
            <div className="processing-title">
              <span className="processing-brand">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="./qoder-logo.png" alt="" />
              </span>
              <span>
                <small>本轮处理</small>
                <strong>{processPanelTitle}</strong>
              </span>
            </div>
            <div className="processing-header-actions">
              <span className="round-version">{activeRun?.candidateVersionLabel || "下一版"}</span>
              <button
                className="drawer-close-button"
                type="button"
                aria-label="关闭处理面板"
                title="关闭面板，任务会继续运行"
                onClick={() => setDrawer(null)}
              >
                <XIcon aria-hidden="true" size={18} weight="bold" />
              </button>
            </div>
          </header>
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
                onClick={() => {
                  if (!closeFileView()) return;
                  setDrawer("files");
                }}
              >当前项目</button>
              <button
                type="button"
                data-active={drawer === "history" ? "true" : "false"}
                onClick={() => {
                  if (!closeFileView()) return;
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
                <div className="version-list">{versions.map(renderHistoryItem)}</div>
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
                          : fileView.content === fileView.savedContent
                            ? "saved"
                            : "dirty"}
                      >
                        {fileView.loading
                          ? "正在读取"
                          : runInProgress
                          ? "处理中 · 只读"
                          : fileView.content === fileView.savedContent
                            ? "已保存"
                            : "有未保存修改"}
                      </em>
                    </header>
                    <p className="project-file-note" id="project-rules-help">
                      {fileView.loading
                        ? "正在读取项目规则。内容核对完成前暂不接受编辑。"
                        : runInProgress
                        ? "本轮已经使用冻结时的规则。AI 处理完成前这里保持只读，不会把临时修改追加入本轮。"
                        : "每次发送至 Qoder 时，源页都会把这份规则与本轮要求一起交接。保存只影响后续任务，不会修改当前 HTML。"}
                    </p>
                    <textarea
                      className="project-file-editor"
                      aria-label="项目长期规则"
                      aria-describedby="project-rules-help"
                      spellCheck={false}
                      disabled={fileView.loading || runInProgress}
                      value={fileView.content}
                      onChange={(event) => setFileView((current) => (
                        current?.path === "PROJECT.md"
                          ? { ...current, content: event.target.value }
                          : current
                      ))}
                    />
                    <div className="project-file-actions">
                      <small>
                        {fileView.content === fileView.savedContent
                          ? "当前内容已记录"
                          : "离开前请保存或还原修改"}
                      </small>
                      <button
                        type="button"
                        disabled={
                          fileView.loading
                          || projectRulesSaving
                          || runInProgress
                          || fileView.content === fileView.savedContent
                        }
                        onClick={() => setFileView((current) => (
                          current?.path === "PROJECT.md"
                            ? { ...current, content: current.savedContent }
                            : current
                        ))}
                      >还原修改</button>
                      <button
                        className="drawer-primary"
                        type="button"
                        disabled={
                          projectRulesSaving
                          || fileView.loading
                          || runInProgress
                          || !fileView.content.trim()
                          || fileView.content === fileView.savedContent
                        }
                        onClick={() => void saveProjectRules()}
                      >{projectRulesSaving ? "保存中…" : "保存规则"}</button>
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
                      {persistState === "idle" ? "已安全保存" : persistLabel}
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
                    {visibleRecentProjects.length ? visibleRecentProjects.map((project) => (
                      <div className="recent-file-item" key={project.path}>
                        <button
                          className="recent-file-row"
                          type="button"
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
                    )) : !recentProjectsError ? (
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
            <div className="handoff-panel">
              {activeRun ? (
                <>
                  <div className="processing-summary-bar">
                    <div>
                      {terminalRun ? (
                        <TriangleIcon aria-hidden="true" size={19} weight="duotone" />
                      ) : (
                        <LockKeyIcon aria-hidden="true" size={19} weight="duotone" />
                      )}
                      <span>
                        <strong>{processSummaryTitle}</strong>
                        <small>{processSummaryDetail}</small>
                      </span>
                    </div>
                    <span className="status-chip">
                      <span aria-hidden="true" />
                      {processStatusLabel}
                    </span>
                  </div>

                  <div className="processing-content">
                    <section
                      className="handoff-process-board timeline-panel"
                      data-status={activeRun.status}
                      aria-live="polite"
                    >
                      <header>
                        <span>本轮流程</span>
                        <strong>
                          {processSteps.length} 个步骤 · 已完成 {processSteps.filter((step) => step.state === "done").length} 个
                        </strong>
                      </header>
                      <ol>
                        {processSteps.map((step) => (
                          <li key={step.key} data-state={step.state}>
                            <span className="process-step-icon" aria-hidden="true">
                              {step.state === "done" ? (
                                <CheckCircleIcon size={20} weight="fill" />
                              ) : step.state === "attention" || step.state === "error" ? (
                                <TriangleIcon size={18} weight="fill" />
                              ) : (
                                <ClockCounterClockwiseIcon size={19} weight="duotone" />
                              )}
                            </span>
                            <span>
                              <strong>{step.label}</strong>
                              <small>{step.detail}</small>
                            </span>
                          </li>
                        ))}
                      </ol>
                    </section>

                    <section className="round-detail-panel" aria-label="本轮记录">
                      <header>
                        <div>
                          <span>本轮记录</span>
                          <strong>{activeCommentCount} 条评论</strong>
                        </div>
                        <SealCheckIcon aria-hidden="true" size={24} weight="duotone" />
                      </header>
                      <div className="round-facts">
                        <div><span>基于版本</span><strong>{runBasisLabel}</strong></div>
                        <div><span>目标版本</span><strong>{activeRun.candidateVersionLabel}</strong></div>
                        <div><span>提交时间</span><strong>{runSubmittedLabel}</strong></div>
                      </div>
                      <div className="round-comment-list">
                        {activeCommentItems.map((comment, index) => (
                          <article key={comment.commentId}>
                            <span>{index + 1}</span>
                            <div>
                              <strong>{insertionLabel(comment.target)}</strong>
                              {comment.target.textQuote || comment.target.text ? (
                                <q>{comment.target.textQuote || comment.target.text}</q>
                              ) : null}
                              <p>{comment.text || "已添加参考附件"}</p>
                              {comment.attachments?.length ? (
                                <small>
                                  <PaperclipIcon aria-hidden="true" size={12} weight="bold" />
                                  {comment.attachments.length} 个附件
                                </small>
                              ) : null}
                            </div>
                          </article>
                        ))}
                      </div>
                      {activeRun.requestPath
                        && typeof window !== "undefined"
                        && window.htmlAIProjects?.revealRequestFolder ? (
                        <button
                          className="handoff-folder-link finder-link"
                          type="button"
                          onClick={() => void revealActiveRunInFinder()}
                        >
                          <FolderOpenIcon aria-hidden="true" size={18} weight="duotone" />
                          <span>在 Finder 中查看本轮文件</span>
                          <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                        </button>
                      ) : null}
                    </section>
                  </div>

                  <div className="processing-decisions">
                    {activeRun.status === "awaiting-check-decision" ? (
                      <section className="validation-decision" role="alert">
                        <strong>有一项范围校验需要你决定</strong>
                        <p>{activeRun.validationReview?.softViolationCodes.length
                          ? `范围提示：${activeRun.validationReview.softViolationCodes.join("、")}`
                          : "检测到超出原评论范围的修改。"}</p>
                        {activeRun.error ? <small>{activeRun.error}</small> : null}
                        <button
                          type="button"
                          disabled={waivingValidation}
                          onClick={() => void waiveCurrentValidation()}
                        >{waivingValidation ? "正在记录决定…" : "无视本校验，继续"}</button>
                      </section>
                    ) : null}
                    {activeRun.status === "awaiting-conflict-resolution" ? (
                      <section className="ai-conflict-panel" role="alert">
                        <strong>请选择哪份内容成为当前 HTML</strong>
                        <p>外部文件和 AI 候选都已保留，系统不会静默覆盖任一侧。</p>
                        <button
                          type="button"
                          disabled={resolvingConflict}
                          onClick={() => void viewAiConflictDiff()}
                        >比较两份内容</button>
                        <button
                          type="button"
                          disabled={resolvingConflict}
                          onClick={() => void resolveAiConflict("adopt-ai")}
                        >{resolvingConflict ? "正在处理…" : "采用 AI 候选"}</button>
                        <button
                          type="button"
                          disabled={resolvingConflict}
                          onClick={() => void resolveAiConflict("keep-external")}
                        >保留外部内容</button>
                      </section>
                    ) : null}
                    {activeRun.status === "recovering-transaction" ? (
                      <section className="ai-conflict-panel" role="status">
                        <strong>正在恢复尚未保存完成的修改</strong>
                        <p>恢复完成前页面保持只读，评论和修改记录不会丢失。</p>
                      </section>
                    ) : null}
                    {runStatusError && !pendingRunOutcome ? (
                      <section className="ai-conflict-panel" role="status">
                        <strong>本轮状态暂时没有更新</strong>
                        <p>{runStatusError}</p>
                        <button type="button" onClick={() => void relaunchApp()}>
                          重新打开源页
                        </button>
                      </section>
                    ) : null}
                    {pendingRunOutcome ? (
                      <section className="ai-conflict-panel" role="alert">
                        <strong>需要确认任务是否已经建立</strong>
                        <p>
                          {pendingReconcileError
                            || activeRun.error
                            || "源页会自动继续核对，不会重复发送同一轮要求。"}
                        </p>
                        <button
                          type="button"
                          disabled={pendingReconcileBusy}
                          onClick={() => void reconcilePendingRun()}
                        >{pendingReconcileBusy ? "正在核对…" : "立即重新核对"}</button>
                        <button
                          type="button"
                          onClick={() => void relaunchApp()}
                        >重新打开源页</button>
                      </section>
                    ) : null}
                    {!pendingRunOutcome && activeRun.status === "no-change" ? (
                      <section className="validation-decision" role="status">
                        <strong>这次没有可采用的变化</strong>
                        <p>没有创建新版本。原评论、附件和当前 HTML 都已保留。</p>
                      </section>
                    ) : null}
                    {!pendingRunOutcome && activeRun.status === "error" ? (
                      <section className="validation-decision" role="alert">
                        <strong>本轮没有改动当前 HTML</strong>
                        <p>{activeRun.error || "结果没有通过安全检查。"}</p>
                      </section>
                    ) : null}
                  </div>
                </>
              ) : (
                <div className="drawer-empty">发送评论后，这里会显示处理进度和本轮记录。</div>
              )}
            </div>
          ) : null}
        </div>
        {drawer === "handoff" && activeRun ? (
          <footer className="processing-footer">
            {activeRun.status === "ready-to-open" ? (
              <button
                className="primary-action"
                type="button"
                disabled={openingReadyVersion || !activeRun.readyPayload}
                onClick={() => void activateReadyResult()}
              >
                <FileHtmlIcon aria-hidden="true" size={18} weight="duotone" />
                {openingReadyVersion ? "正在打开并核对…" : "打开最新版"}
              </button>
            ) : pendingRunOutcome ? (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  disabled={pendingReconcileBusy}
                  onClick={() => void reconcilePendingRun()}
                >
                  <ArrowCounterClockwiseIcon aria-hidden="true" size={17} weight="bold" />
                  {pendingReconcileBusy ? "正在核对…" : "重新核对任务状态"}
                </button>
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => void relaunchApp()}
                >
                  <ArrowCounterClockwiseIcon aria-hidden="true" size={17} weight="bold" />
                  重新打开源页
                </button>
              </>
            ) : terminalRun ? (
              <>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => returnToEditingFromTerminalRun(false)}
                >
                  <ArrowCounterClockwiseIcon aria-hidden="true" size={17} weight="bold" />
                  返回编辑
                </button>
                <button
                  className="primary-action"
                  type="button"
                  onClick={() => returnToEditingFromTerminalRun(true)}
                >
                  <PencilSimpleIcon aria-hidden="true" size={17} weight="bold" />
                  调整要求后重试
                </button>
              </>
            ) : (
              <>
                <button
                  className="cancel-action"
                  type="button"
                  disabled={cancelling || activeRun.requestId === "pending"}
                  onClick={() => void cancelActiveRun()}
                >
                  <ArrowCounterClockwiseIcon aria-hidden="true" size={17} weight="bold" />
                  {cancelling ? "正在恢复编辑…" : "取消发送，继续编辑"}
                </button>
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => {
                    setHandoffPreviewOpen(true);
                    setCanvasMode("preview");
                    setDrawer(null);
                  }}
                >
                  <EyeIcon aria-hidden="true" size={17} weight="bold" />
                  预览已发送 HTML
                </button>
                <button
                  className="primary-action"
                  type="button"
                  disabled={
                    !activeRun.handoffMessage
                    || currentQoderHandoffStatus === "copying"
                  }
                  onClick={() => void sendToQoderWork(
                    activeRun.handoffMessage,
                    activeRun,
                  )}
                >
                  <CopyIcon aria-hidden="true" size={18} weight="bold" />
                  {currentQoderHandoffStatus === "copying"
                    ? "正在复制并核对…"
                    : currentQoderHandoffStatus === "failed"
                      ? "重新复制本轮要求"
                      : "再次复制本轮要求"}
                </button>
              </>
            )}
          </footer>
        ) : null}
      </aside>

      {toast ? (
        <NoticeBar
          className="toast"
          title={toast.title}
          message={toast.message}
          tone={toast.tone}
          actionLabel={toast.action?.label}
          onAction={toast.action ? handleToastAction : undefined}
          onDismiss={() => setToast(null)}
          onPauseChange={(paused) => {
            setPausedNoticeIdentity(paused ? noticeIdentity : null);
          }}
        />
      ) : null}
    </main>
  );
}
