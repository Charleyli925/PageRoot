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
const BROWSER_PREVIEW_LOGO_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Cdefs%3E%3ClinearGradient id='g' x2='1' y2='1'%3E%3Cstop stop-color='%236550e8'/%3E%3Cstop offset='1' stop-color='%23d45df2'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='64' height='64' rx='15' fill='url(%23g)'/%3E%3Cpath d='M23 23 13 32l10 9M41 23l10 9-10 9M36 16 28 48' fill='none' stroke='white' stroke-width='5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E";

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
    __PAGEROOT_HYDRATION_STAGE__?: string;
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

type CommentDraft = {
  commentId: string;
  createdAt: string;
  updatedAt: string;
  target: HtmlCanvasSelection;
  text: string;
  attachments: CommentAttachment[];
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
  status: "observed" | "pending" | "waived";
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
type ToastDisposition =
  | "silent-recover"
  | "defer-and-resume"
  | "direct-action"
  | "user-choice"
  | "background-result"
  | "inform-in-place";
type ToastAction =
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
  | { id: "open-release"; label: string }
  | { id: "retry-draft-persist"; label: string }
  | { id: "review-project-rules"; label: string }
  | { id: "retry-submit"; label: string }
  | { id: "review-comment-drafts"; label: string };
type Toast = {
  title: string;
  message: string;
  tone: ToastTone;
  sticky?: boolean;
  dedupeKey?: string;
  disposition?: ToastDisposition;
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
type BackgroundProjectResult = {
  state: "processing" | "ready" | "no-change" | "error" | "conflict";
  label: string;
  updatedAt: number;
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
const BRIDGE_READ_RETRY_DELAY_MS = 180;
const PROJECT_RULES_AUTOSAVE_DELAY_MS = 700;

function waitFor(delayMs: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

async function withOneAutomaticRetry<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch {
    await waitFor(BRIDGE_READ_RETRY_DELAY_MS);
    return work();
  }
}

async function bridgeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = BRIDGE_STATE_READ_TIMEOUT_MS,
): Promise<Response> {
  const method = String(init.method || "GET").toUpperCase();
  const attemptCount = method === "GET" || method === "HEAD" ? 2 : 1;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attemptCount; attempt += 1) {
    const headers = new Headers(init.headers);
    if (bridgeAuthToken) headers.set("x-html-ai-bridge-token", bridgeAuthToken);
    const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
    const signal = timeoutSignal && init.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal || init.signal;
    try {
      const response = await fetch(input, { ...init, headers, signal });
      const transientStatus = response.status === 408
        || response.status === 425
        || response.status === 429
        || response.status >= 500;
      if (!transientStatus || attempt + 1 >= attemptCount) return response;
    } catch (cause) {
      lastError = cause;
      if (init.signal?.aborted || attempt + 1 >= attemptCount) throw cause;
    }
    await waitFor(BRIDGE_READ_RETRY_DELAY_MS * (attempt + 1));
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("本地项目资料暂时没有响应。");
}

function markProjectHydrationStage(stage: string): void {
  if (typeof window === "undefined") return;
  window.__PAGEROOT_HYDRATION_STAGE__ = stage;
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
  return target.selector.trim().toLowerCase() === "body"
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

function normalizeGlobalCommentTargets(comments: CommentItem[]): {
  comments: CommentItem[];
  changed: boolean;
} {
  let changed = false;
  const normalized = comments.map((comment) => {
    if (!isGlobalPageTarget(comment.target)) return comment;
    const target = exactGlobalPageTarget(comment.target);
    if (
      comment.target.tagName === target.tagName
      && comment.target.label === target.label
      && comment.target.text === target.text
      && comment.target.resolution === target.resolution
    ) return comment;
    changed = true;
    return { ...comment, target };
  });
  return { comments: changed ? normalized : comments, changed };
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

function unsafeCommentTargetsNotice(comments: CommentItem[]): NonNullable<Toast> {
  const count = comments.length;
  return {
    title: `${count} 条评论需要重新定位`,
    message: count === 1
      ? "请选择这条评论的新位置，评论和附件已保留。"
      : `将从第 1 条开始，完成后自动进入下一条。`,
    tone: "warning",
    sticky: true,
    disposition: "user-choice",
    dedupeKey: "unsafe-comment-targets",
    action: {
      id: "relink-target",
      label: count === 1 ? "选择新位置" : "开始重新定位",
      commentId: comments[0].commentId,
      resumeSubmission: true,
    },
  };
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

function scopeDifferenceKindLabel(kind: unknown): string {
  if (kind === "text") return "文字";
  if (kind === "attribute") return "元素属性";
  if (kind === "structure") return "页面结构";
  if (kind === "inline-style") return "局部样式";
  if (kind === "shared-css") return "共享样式";
  return "页面内容";
}

function compactScopePreview(value: unknown): string {
  const text = String(value || "").replace(/\s+/gu, " ").trim();
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

function scopeDecisionSummary(report: Record<string, unknown> | undefined): {
  message: string;
  examples: string[];
} {
  const differences = Array.isArray(report?.differences)
    ? report.differences.filter((item) => (
        isRecord(item)
        && item.allowed === false
        && item.material !== false
      ))
    : [];
  if (differences.length === 0) {
    return {
      message: "AI 结果包含评论范围外的变化。当前 HTML 尚未改变。",
      examples: [],
    };
  }
  const kinds = [...new Set(
    differences.map((item) => scopeDifferenceKindLabel(
      isRecord(item) ? item.kind : null,
    )),
  )];
  const examples = differences.slice(0, 3).map((item) => {
    if (!isRecord(item)) return "";
    const before = isRecord(item.before)
      ? compactScopePreview(item.before.preview)
      : "";
    const after = isRecord(item.after)
      ? compactScopePreview(item.after.preview)
      : "";
    const label = scopeDifferenceKindLabel(item.kind);
    if (before && after) return `${label}：“${before}” → “${after}”`;
    if (after) return `${label}：新增“${after}”`;
    if (before) return `${label}：移除“${before}”`;
    return `${label}发生了额外变化`;
  }).filter(Boolean);
  return {
    message: `AI 还修改了评论范围外的${kinds.join("、")}，共 ${differences.length} 处。当前 HTML 尚未改变。`,
    examples,
  };
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
  const selection: HtmlCanvasSelection = {
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
  return isGlobalPageTarget(selection)
    ? exactGlobalPageTarget(selection)
    : selection;
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
  if (status !== "observed" && status !== "pending" && status !== "waived") {
    return null;
  }
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
        : rawStatus === "awaiting-check-decision"
          ? "validating"
        : rawStatus === "version-created" || rawStatus === "completed"
          ? "complete"
          : rawStatus === "canceled"
            ? "cancelled"
            : rawStatus
  );
  const allowed: LifecycleState[] = [
    "editing", "submitting", "processing", "validating", "committing",
    "ready-to-open",
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

function isLockedLifecycle(state: LifecycleState | undefined): boolean {
  return Boolean(state && [
    "submitting",
    "processing",
    "validating",
    "committing",
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
  const commentDraftsRef = useRef<CommentDraft[]>([]);
  const attachmentUploadCountRef = useRef(0);
  const attachmentObjectUrlsRef = useRef<Map<string, string>>(new Map());
  const draftPendingRef = useRef<PendingDraft | null>(null);
  const draftRevisionRef = useRef(0);
  const draftPersistenceAuthorityRef = useRef<ProjectContext | null>(null);
  const draftRecoverySequenceRef = useRef(0);
  const draftFlushPromiseRef = useRef<Promise<boolean> | null>(null);
  const projectRegistrationPromiseRef =
    useRef<Promise<ProjectContext | null> | null>(null);
  const backgroundRunsRef = useRef<Map<string, ActiveRun>>(new Map());
  const backgroundProjectResultsRef =
    useRef<Map<string, BackgroundProjectResult>>(new Map());
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
  const cancellingRunsRef = useRef<Set<string>>(new Set());
  const resolvingRunsRef = useRef<Set<string>>(new Set());
  const statusPollBusyRef = useRef<Set<string>>(new Set());
  const toastRef = useRef<Toast>(null);
  const pendingReconcileBusyRef = useRef(false);
  const relinkingTargetRef = useRef<string | null>(null);
  const relinkSelectionArmedRef = useRef(false);
  const resumeSubmissionAfterRelinkRef = useRef(false);
  const pendingProjectOpenRef = useRef<{
    recentPath?: string;
    requestedAt: number;
  } | null>(null);
  const closePreparationRequestRef = useRef<string | null>(null);
  const closeFreezeRequestRef = useRef<string | null>(null);
  const abortedCloseRequestsRef = useRef<Set<string>>(new Set());
  const saveProjectRulesRef = useRef<() => Promise<boolean>>(async () => false);

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
  const [commentDrafts, setCommentDrafts] = useState<CommentDraft[]>([]);
  const [attachmentObjectUrls, setAttachmentObjectUrls] = useState<Record<string, string>>({});
  const [attachmentUploadCount, setAttachmentUploadCount] = useState(0);
  const [backgroundProjectResults, setBackgroundProjectResults] =
    useState<Map<string, BackgroundProjectResult>>(new Map());
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
  const [projectRulesSaveError, setProjectRulesSaveError] = useState("");
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
  const [resolvingConflict, setResolvingConflict] = useState(false);
  const [pendingReconcileBusy, setPendingReconcileBusy] = useState(false);
  const [relinkingTarget, setRelinkingTarget] = useState<string | null>(null);
  const [runtimeCapabilitiesReady, setRuntimeCapabilitiesReady] = useState(false);
  const [browserPreviewOnly, setBrowserPreviewOnly] = useState(false);
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
        action: { id: "open-release", label: "打开更新页面" },
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
    || browserPreviewOnly
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
  const currentComposerHasContent = Boolean(
    draftTarget
    && (draft.trim() || draftAttachments.length > 0),
  );
  const pendingSendItemCount = activeCommentCount
    + commentDrafts.length
    + (currentComposerHasContent ? 1 : 0);
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
    commentDraftsRef.current = commentDrafts;
  }, [commentDrafts]);
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
    attachmentUploadCountRef.current = attachmentUploadCount;
  }, [attachmentUploadCount]);
  useEffect(() => {
    projectLockedRef.current = projectLocked;
  }, [projectLocked]);
  useEffect(() => {
    const previewOnly = !window.htmlAIProjects;
    const frame = window.requestAnimationFrame(() => {
      setBrowserPreviewOnly(previewOnly);
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
    for (const key of backgroundProjectResultsRef.current.keys()) {
      if (sameLocalSourcePath(key, activeSourcePath)) {
        backgroundProjectResultsRef.current.delete(key);
      }
    }
    backgroundProjectResultsRef.current.set(activeSourcePath, result);
    setBackgroundProjectResults(new Map(backgroundProjectResultsRef.current));
  }, []);

  const clearBackgroundProjectResult = useCallback((activeSourcePath: string) => {
    let changed = false;
    for (const key of backgroundProjectResultsRef.current.keys()) {
      if (sameLocalSourcePath(key, activeSourcePath)) {
        backgroundProjectResultsRef.current.delete(key);
        changed = true;
      }
    }
    if (changed) {
      setBackgroundProjectResults(new Map(backgroundProjectResultsRef.current));
    }
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
            ...commentDraftsRef.current.map((savedDraft) => savedDraft.target),
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
        const reboundCommentDrafts = commentDraftsRef.current.map((savedDraft) => ({
          ...savedDraft,
          target: reboundById.get(savedDraft.target.id) || savedDraft.target,
        }));
        commentDraftsRef.current = reboundCommentDrafts;
        setCommentDrafts(reboundCommentDrafts);
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
      const registeredContext = {
        epoch,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        sourcePath: activeSource,
      };
      draftPersistenceAuthorityRef.current = registeredContext;
      return registeredContext;
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
      const savedCommentDrafts = commentDraftsRef.current;
      if (
        snapshot.comments.length === 0
        && snapshot.changeEvents.length === 0
        && deletedCommentIdsRef.current.size === 0
        && savedCommentDrafts.length === 0
        && !composerText.trim()
        && composerAttachments.length === 0
        && !composerTarget
      ) {
        for (const key of keys) window.localStorage.removeItem(key);
        return;
      }
      const serialized = JSON.stringify({
        schemaVersion: "3.1.0",
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
        commentDrafts: savedCommentDrafts.map((savedDraft) => ({
          commentId: savedDraft.commentId,
          createdAt: savedDraft.createdAt,
          updatedAt: savedDraft.updatedAt,
          text: savedDraft.text,
          target: persistedTargetRef(savedDraft.target),
          attachments: savedDraft.attachments.map(persistedAttachment),
        })),
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

  const normalizeCurrentGlobalComments = useCallback((): CommentItem[] => {
    const normalized = normalizeGlobalCommentTargets(
      commentsRef.current.filter(commentHasContent),
    );
    if (!normalized.changed) return normalized.comments;
    const normalizedById = new Map(
      normalized.comments.map((comment) => [comment.commentId, comment]),
    );
    const nextComments = commentsRef.current.map(
      (comment) => normalizedById.get(comment.commentId) || comment,
    );
    commentsRef.current = nextComments;
    setComments(nextComments);
    persistCurrentDraftRecovery(nextComments);
    return nextComments.filter(commentHasContent);
  }, [persistCurrentDraftRecovery]);

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
                  ...commentDraftsRef.current.map((savedDraft) => savedDraft.target),
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
              const reboundCommentDrafts = commentDraftsRef.current.map((savedDraft) => ({
                ...savedDraft,
                target: reboundById.get(savedDraft.target.id) || savedDraft.target,
              }));
              commentDraftsRef.current = reboundCommentDrafts;
              setComments(reboundComments);
              setChangeEvents(reboundEvents);
              setCommentDrafts(reboundCommentDrafts);
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
    markProjectHydrationStage("apply-start");
    const outgoingRun = activeRunRef.current;
    const outgoingSourcePath = sourcePathRef.current;
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
      } else if (isLockedLifecycle(outgoingRun.status)) {
        markBackgroundProjectResult(outgoingSourcePath, {
          state: "processing",
          label: "正在处理",
          updatedAt: Date.now(),
        });
      }
    }
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
    markProjectHydrationStage("apply-authority");
    projectLoadErrorRef.current = null;
    viewTransitioningRef.current = false;
    navigationOperationRef.current += 1;
    submissionPendingRef.current = false;
    draftPendingRef.current = null;
    draftRevisionRef.current = 0;
    draftPersistenceAuthorityRef.current = null;
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
    commentDraftsRef.current = [];
    setCommentDrafts([]);
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
    setCommentEditDraft("");
    setPendingDeleteCommentId(null);
    relinkingTargetRef.current = null;
    relinkSelectionArmedRef.current = false;
    resumeSubmissionAfterRelinkRef.current = false;
    pendingProjectOpenRef.current = null;
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
    setCanvasMode(
      typeof window !== "undefined" && !window.htmlAIProjects
        ? "preview"
        : "edit",
    );
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
    setProjectRulesSaveError("");
    setProjectRecordsPreparing(false);
    setProjectRecordsError("");
    pendingReconcileBusyRef.current = false;
    setPendingReconcileBusy(false);
    setGenerating(
      sameLocalSourcePath(submissionIntentRef.current?.sourcePath, project.sourcePath),
    );
    setCancelling(
      Boolean(backgroundRunKey && cancellingRunsRef.current.has(backgroundRunKey)),
    );
    setOpeningReadyVersion(
      Boolean(backgroundRunKey && activatingRunsRef.current.has(backgroundRunKey)),
    );
    setResolvingConflict(
      Boolean(backgroundRunKey && resolvingRunsRef.current.has(backgroundRunKey)),
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
      if (!opensLockedProject) editorRef.current?.unlockNow?.();
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
    commentDrafts: CommentDraft[];
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
        commentDrafts: [],
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
      commentDrafts: Array.isArray(latest.commentDrafts)
        ? latest.commentDrafts.flatMap((rawDraft) => {
            if (!isRecord(rawDraft) || !isRecord(rawDraft.target)) return [];
            const commentId = String(rawDraft.commentId || "");
            const target = selectionFromRecord(rawDraft.target);
            if (!/^comment_[A-Za-z0-9_-]+$/.test(commentId) || !target) return [];
            return [{
              commentId,
              createdAt: String(rawDraft.createdAt || new Date().toISOString()),
              updatedAt: String(rawDraft.updatedAt || rawDraft.createdAt || new Date().toISOString()),
              target,
              text: String(rawDraft.text || ""),
              attachments: Array.isArray(rawDraft.attachments)
                ? rawDraft.attachments
                    .map(attachmentFromRecord)
                    .filter((item): item is CommentAttachment => Boolean(item))
                : [],
            }];
          })
        : [],
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
      markProjectHydrationStage("workspace-request");
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
      markProjectHydrationStage("workspace-response");
      const payload = await readJsonResponse(response);
      markProjectHydrationStage("workspace-parsed");
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
        markProjectHydrationStage("source-request");
        const sourceUrl = new URL(`${BRIDGE_URL}/source`);
        sourceUrl.searchParams.set("sourcePath", activeSource);
        const sourceResponse = await bridgeFetch(
          sourceUrl,
          { cache: "no-store" },
          BRIDGE_STATE_READ_TIMEOUT_MS,
        );
        markProjectHydrationStage("source-response");
        const sourcePayload = await readJsonResponse(sourceResponse);
        markProjectHydrationStage("source-parsed");
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
        markProjectHydrationStage("source-hash");
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
        [
          ...recoveredDraft.comments.map((comment) => comment.target),
          ...recoveredDraft.commentDrafts.map((savedDraft) => savedDraft.target),
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
      const recoveredEvents = recoveredDraft.changeEvents;
      const recoveredCommentDrafts = recoveredDraft.commentDrafts.map((savedDraft) => ({
        ...savedDraft,
        target: recoveredTargetById.get(savedDraft.target.id) || {
          ...savedDraft.target,
          resolution: "orphaned" as const,
        },
      }));
      setComments(recoveredComments);
      commentsRef.current = recoveredComments;
      setCommentDrafts(recoveredCommentDrafts);
      commentDraftsRef.current = recoveredCommentDrafts;
      changeEventsRef.current = recoveredEvents;
      setChangeEvents(recoveredEvents);
      draftPersistenceAuthorityRef.current = {
        epoch,
        projectId: nextProjectId,
        documentId: nextDocumentId,
        sourcePath: activeSource,
      };
      composerDraftRef.current = recoveredDraft.composerDraft;
      composerCommentIdRef.current = recoveredDraft.composerCommentId;
      composerAttachmentsRef.current = recoveredDraft.composerAttachments;
      const recoveredComposerTarget = recoveredDraft.composerTarget
        ? recoveredTargetById.get(recoveredDraft.composerTarget.id)
          || { ...recoveredDraft.composerTarget, resolution: "orphaned" as const }
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
        markProjectHydrationStage("canvas-hash");
        const expectedCanvasHtml = htmlRef.current;
        const expectedCanvasHash = await browserSha256(expectedCanvasHtml);
        markProjectHydrationStage("canvas-verify");
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
      markProjectHydrationStage("ready");
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
        markProjectHydrationStage("failed");
      }
    } finally {
      // Every authorized hydration must release its own lock, including a
      // harmless early return while it still owns the current identity. A
      // newer project epoch remains solely responsible for its hydration.
      if (
        hydrationSourceTransitionAuthorized
        && projectHydratingRef.current
        && epoch === projectEpochRef.current
        && sameLocalSourcePath(sourcePathRef.current, activeSource)
      ) {
        projectHydratingRef.current = false;
        setProjectHydrating(false);
        markProjectHydrationStage("released");
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
    if (!targetIsOpen) return;
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
    const activeSource = sourcePathRef.current;
    if (!activeSource) {
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
            continue;
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
            continue;
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
        tone: targetStillOpen && failedNames.length > 0 ? "error" : "warning",
        sticky: targetStillOpen,
        disposition: targetStillOpen ? "direct-action" : "background-result",
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
    if (
      !sourcePath
      || !projectId
    ) return;
    const authority = draftPersistenceAuthorityRef.current;
    if (
      !authority
      || authority.epoch !== projectEpochRef.current
      || authority.projectId !== projectId
      || authority.documentId !== documentId
      || !sameLocalSourcePath(authority.sourcePath, sourcePath)
      || projectHydratingRef.current
      || projectHydrating
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
    if (projectLockedRef.current || projectLocked) return;
    void flushDraftPersistence(snapshot);
  }, [
    changeEvents,
    comments,
    commentDrafts,
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
    const authority = draftPersistenceAuthorityRef.current;
    if (
      !authority
      || authority.epoch !== projectEpochRef.current
      || authority.projectId !== projectId
      || authority.documentId !== documentId
      || !sameLocalSourcePath(authority.sourcePath, sourcePath)
      || projectHydratingRef.current
    ) return;
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

          if (attachmentUploadCountRef.current > 0) {
            await beforeDeadline((async () => {
              while (attachmentUploadCountRef.current > 0) {
                await new Promise<void>((resolve) => window.setTimeout(resolve, 40));
              }
            })(), "等待附件添加完成");
          }

          if (
            fileView?.path === "PROJECT.md"
            && !fileView.error
            && fileView.content !== fileView.savedContent
            && !await beforeDeadline(
              saveProjectRulesRef.current(),
              "等待项目规则保存",
            )
          ) {
            return { ready: false, reason: "项目规则还没有保存，请返回项目面板处理。" };
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
    fileView,
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
    const rememberProjectOpen = () => {
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
          replay((value) => resolveDeferred?.(value));
        },
        undefined,
        { onDiscard: () => resolveDeferred?.(false) },
      )) return deferredResult;
    }
    if (submissionIntentRef.current || submissionPendingRef.current) {
      rememberProjectOpen();
      return false;
    }
    if (attachmentUploadCountRef.current > 0) {
      rememberProjectOpen();
      return false;
    }
    if (
      fileView?.path === "PROJECT.md"
      && fileView.content !== fileView.savedContent
    ) {
      if (!await saveProjectRulesRef.current()) {
        rememberProjectOpen();
        setDrawer("files");
        return false;
      }
    }
    if (viewTransitioningRef.current) {
      rememberProjectOpen();
      return false;
    }
    if (projectLoadErrorRef.current) {
      draftPendingRef.current = null;
      return true;
    }
    if (flushPromiseRef.current && !await flushPromiseRef.current) {
      rememberProjectOpen();
      return false;
    }
    if (draftFlushPromiseRef.current && !await draftFlushPromiseRef.current) {
      rememberProjectOpen();
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
      editorRef.current?.showCommitBlocked(
        committed?.reason || "请点回文字完成输入，再切换项目。",
      );
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
        rememberProjectOpen();
        return false;
      }
    }
    if (
      editRevisionRef.current !== switchCutoffRevision
      || pendingWriteRef.current
      || flushPromiseRef.current
    ) {
      rememberProjectOpen();
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
      rememberProjectOpen();
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
        rememberProjectOpen();
        return false;
      }
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
    pendingProjectOpenRef.current = null;
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
        disposition: "direct-action",
        dedupeKey: "project-open-error",
        action: {
          id: "retry-project-open",
          label: recentPath ? "重新选择位置" : "重新选择",
        },
      });
    }
  }, [applyProject, prepareProjectSwitch, refreshRecents, refreshWorkspace]);

  useEffect(() => {
    const pending = pendingProjectOpenRef.current;
    if (!pending) return;
    const projectRulesUnsaved = Boolean(
      fileView?.path === "PROJECT.md"
      && fileView.content !== fileView.savedContent,
    );
    if (
      generating
      || submissionIntentRef.current
      || submissionPendingRef.current
      || attachmentUploadCount > 0
      || projectHydrating
      || viewTransitioning
      || projectRulesUnsaved
      || persistState !== "idle"
      || pendingWriteRef.current
      || flushPromiseRef.current
      || draftPendingRef.current
      || draftFlushPromiseRef.current
      || draftPersistError
      || editRevision > lastPersistedRevision
    ) return;
    pendingProjectOpenRef.current = null;
    void openProject(pending.recentPath);
  }, [
    draftPersistError,
    attachmentUploadCount,
    editRevision,
    fileView,
    generating,
    lastPersistedRevision,
    openProject,
    persistState,
    projectHydrating,
    viewTransitioning,
  ]);

  const showProjectInFolder = useCallback(async (requestedSourcePath?: string) => {
    const activeSourcePath = requestedSourcePath || sourcePathRef.current;
    const showInFolder = window.htmlAIProjects?.showInFolder;
    if (!activeSourcePath || !showInFolder) return;
    try {
      await withOneAutomaticRetry(() => showInFolder(activeSourcePath));
      setProjectMenuOpen(false);
    } catch (cause) {
      setToast({
        title: "无法在 Finder 中显示",
        message: productErrorMessage(
          cause,
          "源 HTML 可能已移动；当前项目仍保持打开，可以重试。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "show-project-in-folder-error",
      });
    }
  }, []);

  const showProjectRecordsInFolder = useCallback(async () => {
    const activeSourcePath = sourcePathRef.current;
    if (!activeSourcePath || !projectRecordsPath) return;
    try {
      await withOneAutomaticRetry(async () => {
        const response = await bridgeFetch(`${BRIDGE_URL}/open-folder`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ sourcePath: activeSourcePath }),
        });
        const payload = await readJsonResponse(response);
        if (!response.ok || payload.ok === false) {
          throw responseError(payload, "无法打开项目记录。");
        }
      });
    } catch (cause) {
      setToast({
        title: "项目记录暂时无法打开",
        message: productErrorMessage(
          cause,
          "项目记录仍保留在本地，可以重新尝试。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "show-project-records-error",
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
        disposition: "direct-action",
        dedupeKey: "browser-file-error",
        action: { id: "retry-project-open", label: "重新选择" },
      });
    }
  }, [applyProject, prepareProjectSwitch]);

  const handleCanvasChange = useCallback((nextHtml: string, mutation?: HtmlCanvasMutation): boolean => {
    if (
      (typeof window !== "undefined" && !window.htmlAIProjects)
      ||
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
      ...commentDraftsRef.current.map((savedDraft) => savedDraft.target),
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
      const nextCommentDrafts = commentDraftsRef.current.map((savedDraft) => ({
        ...savedDraft,
        target: refreshedTarget(savedDraft.target),
      }));
      commentDraftsRef.current = nextCommentDrafts;
      setCommentDrafts(nextCommentDrafts);
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
      editorRef.current?.showCommitBlocked(
        committed.reason
          || "请点回文字完成输入，再导出 HTML 副本。",
      );
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
    if (
      !fromDeferred
      && deferEditorCommand(
        "external-refresh",
        () => deferredEditorReplayRef.current.reloadCurrentSource?.(),
      )
    ) return;
    const hasUnwrittenLocalChanges = Boolean(
      editorRef.current?.hasPendingNativeEdit()
      || pendingWriteRef.current
      || flushPromiseRef.current
      || editRevisionRef.current > lastPersistedRevisionRef.current
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
    updateFocusedComment,
  ]);

  const cancelTargetRelink = useCallback(() => {
    const relinkingId = relinkingTargetRef.current;
    relinkingTargetRef.current = null;
    relinkSelectionArmedRef.current = false;
    resumeSubmissionAfterRelinkRef.current = false;
    setRelinkingTarget(null);
    if (relinkingId === "__composer") {
      window.requestAnimationFrame(() => {
        composerRef.current?.focus({ preventScroll: true });
      });
    }
  }, []);

  const clearCurrentComposer = useCallback(() => {
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
  }, [updateFocusedComment]);

  const stashCurrentComposerDraft = useCallback((): CommentDraft | null => {
    const target = draftTargetRef.current;
    const text = composerDraftRef.current;
    const attachments = composerAttachmentsRef.current;
    const commentId = composerCommentIdRef.current;
    if (
      !target
      || !commentId
      || (!text.trim() && attachments.length === 0)
    ) {
      clearCurrentComposer();
      persistCurrentDraftRecovery();
      return null;
    }
    const now = new Date().toISOString();
    const existing = commentDraftsRef.current.find(
      (savedDraft) => savedDraft.commentId === commentId,
    );
    const savedDraft: CommentDraft = {
      commentId,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      target,
      text,
      attachments: attachments.map(persistedAttachment),
    };
    const nextDrafts = [
      ...commentDraftsRef.current.filter(
        (current) => current.commentId !== commentId,
      ),
      savedDraft,
    ];
    commentDraftsRef.current = nextDrafts;
    setCommentDrafts(nextDrafts);
    clearCurrentComposer();
    persistCurrentDraftRecovery();
    return savedDraft;
  }, [clearCurrentComposer, persistCurrentDraftRecovery]);

  const restoreCommentDraft = useCallback((commentId: string) => {
    if (attachmentUploadCountRef.current > 0) return;
    if (
      draftTargetRef.current
      && composerCommentIdRef.current !== commentId
      && (
        composerDraftRef.current.trim()
        || composerAttachmentsRef.current.length > 0
      )
    ) {
      stashCurrentComposerDraft();
    }
    const savedDraft = commentDraftsRef.current.find(
      (current) => current.commentId === commentId,
    );
    if (!savedDraft) return;
    const nextDrafts = commentDraftsRef.current.filter(
      (current) => current.commentId !== commentId,
    );
    commentDraftsRef.current = nextDrafts;
    setCommentDrafts(nextDrafts);
    composerDraftRef.current = savedDraft.text;
    composerCommentIdRef.current = savedDraft.commentId;
    composerAttachmentsRef.current = savedDraft.attachments;
    draftTargetRef.current = savedDraft.target;
    setDraft(savedDraft.text);
    setDraftCommentId(savedDraft.commentId);
    setDraftAttachments(savedDraft.attachments);
    setDraftTarget(savedDraft.target);
    setSelection(savedDraft.target);
    setComposerOpen(true);
    updateFocusedComment(null);
    persistCurrentDraftRecovery();
    queueReviewPairReveal(savedDraft.target, "__composer");
    window.requestAnimationFrame(() => {
      composerRef.current?.focus({ preventScroll: true });
    });
  }, [
    persistCurrentDraftRecovery,
    queueReviewPairReveal,
    stashCurrentComposerDraft,
    updateFocusedComment,
  ]);

  const deleteCommentDraft = useCallback((commentId: string) => {
    const savedDraft = commentDraftsRef.current.find(
      (current) => current.commentId === commentId,
    );
    const nextDrafts = commentDraftsRef.current.filter(
      (current) => current.commentId !== commentId,
    );
    commentDraftsRef.current = nextDrafts;
    setCommentDrafts(nextDrafts);
    persistCurrentDraftRecovery();
    for (const attachment of savedDraft?.attachments ?? []) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
      void deleteAttachmentFile(attachment);
    }
  }, [
    deleteAttachmentFile,
    forgetAttachmentObjectUrl,
    persistCurrentDraftRecovery,
  ]);

  const openCommentComposer = useCallback((target: HtmlCanvasSelection) => {
    if (relinkingTargetRef.current && finishTargetRelink(target)) return;
    if (attachmentUploadCountRef.current > 0) return;
    if (
      projectLockedRef.current
      || projectHydratingRef.current
      || projectLoadErrorRef.current
      || viewTransitioningRef.current
      || persistStateRef.current === "conflict"
      || viewMode === "history"
    ) return;
    const savedDraft = commentDraftsRef.current.find(
      (current) => current.target.id === target.id,
    );
    if (savedDraft) {
      restoreCommentDraft(savedDraft.commentId);
      return;
    }
    const recoveredDraftTarget = draftTargetRef.current;
    if (
      recoveredDraftTarget
      && recoveredDraftTarget.id !== target.id
      && (
        composerDraftRef.current.trim()
        || composerAttachmentsRef.current.length > 0
      )
    ) stashCurrentComposerDraft();
    setSelection(target);
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
    restoreCommentDraft,
    stashCurrentComposerDraft,
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
    if (attachmentUploadCountRef.current > 0) return;
    stashCurrentComposerDraft();
  }, [stashCurrentComposerDraft]);

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
      return;
    }
    if (!draft.trim() && draftAttachments.length === 0) {
      composerRef.current?.focus();
      return;
    }
    if (attachmentUploadCount > 0) return;
    const now = new Date().toISOString();
    const commentId = draftCommentId || recordId("comment", commentCounter.current++);
    const commentTarget = independentCommentTarget(draftTarget, commentId);
    const remainingDrafts = commentDraftsRef.current.filter(
      (savedDraft) => savedDraft.commentId !== commentId,
    );
    commentDraftsRef.current = remainingDrafts;
    setCommentDrafts(remainingDrafts);
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

  const saveProjectRules = useCallback(async (): Promise<boolean> => {
    if (
      fileView?.path === "PROJECT.md"
      && !fileView.loading
      && !fileView.error
      && fileView.content === fileView.savedContent
    ) return true;
    if (
      !fileView
      || fileView.path !== "PROJECT.md"
      || fileView.loading
      || fileView.error
      || runInProgress
    ) return false;
    const context = captureProjectContext();
    if (!context) return false;
    const nextContent = fileView.content;
    setProjectRulesSaveError("");
    setProjectRulesSaving(true);
    const markRulesSaved = () => {
      setFileView((current) => current?.path === "PROJECT.md"
        ? { ...current, savedContent: nextContent }
        : current);
      setProjectRulesSaveError("");
    };
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
      if (!isCurrentProjectContext(context)) return false;
      markRulesSaved();
      return true;
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return false;
      try {
        const persisted = await readWorkspaceFile("PROJECT.md", context.sourcePath);
        if (!isCurrentProjectContext(context)) return false;
        if (persisted === nextContent) {
          markRulesSaved();
          return true;
        }
      } catch {
        // The original write error is the most useful local explanation.
      }
      setProjectRulesSaveError(productErrorMessage(
        cause,
        "项目规则暂时没有保存；内容仍保留在这里，可以再次保存。",
      ));
      return false;
    } finally {
      if (isCurrentProjectContext(context)) setProjectRulesSaving(false);
    }
  }, [
    captureProjectContext,
    fileView,
    isCurrentProjectContext,
    readWorkspaceFile,
    runInProgress,
  ]);

  useEffect(() => {
    if (
      fileView?.path !== "PROJECT.md"
      || fileView.loading
      || fileView.error
      || fileView.content === fileView.savedContent
      || projectRulesSaving
      || runInProgress
    ) return;
    const timer = window.setTimeout(() => {
      void saveProjectRules();
    }, PROJECT_RULES_AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [
    fileView,
    projectRulesSaving,
    runInProgress,
    saveProjectRules,
  ]);

  const closeFileView = useCallback(async (): Promise<boolean> => {
    if (
      fileView?.path === "PROJECT.md"
      && !fileView.error
      && fileView.content !== fileView.savedContent
      && !await saveProjectRules()
    ) return false;
    setFileView(null);
    return true;
  }, [fileView, saveProjectRules]);

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
    const revealRequestFolder = window.htmlAIProjects?.revealRequestFolder;
    if (!activeSourcePath || !requestPath || !revealRequestFolder) return;
    try {
      await withOneAutomaticRetry(() => revealRequestFolder({
        sourcePath: activeSourcePath,
        requestPath,
      }));
    } catch (cause) {
      setToast({
        title: "本轮文件暂时无法打开",
        message: productErrorMessage(
          cause,
          "本轮任务仍在处理面板中，可以重新尝试。",
        ),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: "reveal-request-folder",
      });
    }
  }, [activeRun?.requestPath]);

  const revealVersionInFinder = useCallback(async (version: Version) => {
    const activeSourcePath = sourcePathRef.current;
    const revealVersionFile = window.htmlAIProjects?.revealVersionFile;
    if (!activeSourcePath || !revealVersionFile) return;
    try {
      await withOneAutomaticRetry(() => revealVersionFile({
        sourcePath: activeSourcePath,
        versionId: version.id,
      }));
    } catch (cause) {
      setToast({
        title: "历史版本暂时无法在 Finder 中显示",
        message: productErrorMessage(cause, "请确认项目记录仍然完整后重试。"),
        tone: "warning",
        disposition: "background-result",
        dedupeKey: `reveal-version-file-${version.id}`,
      });
    }
  }, []);

  const generateRequest = useCallback(async (fromDeferred = false) => {
    if (submissionIntentRef.current) return;
    if (!sourcePathRef.current) {
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
    if (persistStateRef.current === "failed" || persistStateRef.current === "conflict") {
      return;
    }
    if (projectLockedRef.current) {
      setDrawer("handoff");
      return;
    }
    if (
      draftTargetRef.current
      && (
        composerDraftRef.current.trim()
        || composerAttachmentsRef.current.length > 0
      )
    ) {
      stashCurrentComposerDraft();
    }
    if (commentDraftsRef.current.length > 0) {
      setToast({
        title: `${commentDraftsRef.current.length} 条评论还没有完成`,
        message: "草稿和附件都已保留。确认、补充或删除后再发送本轮要求。",
        tone: "warning",
        sticky: true,
        disposition: "user-choice",
        dedupeKey: "unfinished-comment-drafts",
        action: { id: "review-comment-drafts", label: "查看未完成评论" },
      });
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
      composerRef.current?.focus();
      return;
    }
    const unsafeTargets = activeComments.filter(
      (comment) => !canLocateTarget(comment.target),
    );
    if (unsafeTargets.length > 0) {
      setToast(unsafeCommentTargetsNotice(unsafeTargets));
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
        disposition: "direct-action",
        dedupeKey: "project-registration",
        action: { id: "retry-submit", label: "重新建立并发送" },
      });
      releaseSubmissionIntent();
      return;
    }
    activeComments = normalizeCurrentGlobalComments();
    if (activeComments.length === 0) {
      composerRef.current?.focus();
      releaseSubmissionIntent();
      return;
    }
    const unsafeRegisteredTargets = activeComments.filter(
      (comment) => !canLocateTarget(comment.target),
    );
    if (unsafeRegisteredTargets.length > 0) {
      setToast(unsafeCommentTargetsNotice(unsafeRegisteredTargets));
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
      editorRef.current?.showCommitBlocked(
        frozen?.reason || "画布还没有形成可验证的 HTML 快照，本轮不会发送。",
      );
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
        activeRunRef.current = failedRun;
        setActiveRun(failedRun);
        setDrawer("handoff");
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
    normalizeCurrentGlobalComments,
    openProject,
    projectName,
    sendToQoderWork,
    stashCurrentComposerDraft,
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
            : rawState === "awaiting-check-decision"
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
    if (state === "ready-to-open") {
      const validationReview = validationReviewFromRecord(payload.validationReview);
      const nextRun: ActiveRun = {
        ...run,
        status: "ready-to-open",
        readyPayload: payload,
        ...(validationReview ? { validationReview } : {}),
        ...(isRecord(payload.scopeReport)
          ? { scopeReport: payload.scopeReport }
          : {}),
      };
      backgroundRunsRef.current.set(run.sourcePath, nextRun);
      if (isCurrentProject) {
        clearBackgroundProjectResult(run.sourcePath);
        setActiveRun(nextRun);
        setProjectLocked(true);
        projectLockedRef.current = true;
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
      if (isCurrentProject) {
        clearBackgroundProjectResult(run.sourcePath);
        projectLockedRef.current = false;
        setProjectLocked(false);
        editorRef.current?.unlockNow?.();
        const noChangeRun = { ...run, status: "no-change" as const };
        activeRunRef.current = noChangeRun;
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
    backgroundRunsRef.current.set(run.sourcePath, nextRun);
    if (isCurrentProject) {
      clearBackgroundProjectResult(run.sourcePath);
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
  }, [clearBackgroundProjectResult, markBackgroundProjectResult]);

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
            await processRunStatus(run, payload);
          } catch {
            // Temporary polling failures are recovered by the next automatic pass.
            // The workspace-level unavailable state remains the user-facing boundary.
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
        setDrawer("handoff");
        return;
      }
      projectLockedRef.current = false;
      setProjectLocked(false);
      editorRef.current?.unlockNow?.();
      activeRunRef.current = null;
      setActiveRun(null);
      setDrawer(null);
    } catch {
      if (!isCurrentProjectContext(context)) return;
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
      if (context) {
        const nextRun = {
          ...run,
          error: productErrorMessage(
            cause,
            "取消结果暂时无法确认。源页会继续在后台核对。",
          ),
        };
        backgroundRunsRef.current.set(run.sourcePath, nextRun);
        activeRunRef.current = nextRun;
        setActiveRun(nextRun);
      }
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
      const nextRun = {
        ...run,
        error: productErrorMessage(
          cause,
          "这次选择还没有记录，外部文件和 AI 候选都仍被保留。",
        ),
      };
      backgroundRunsRef.current.set(run.sourcePath, nextRun);
      if (context) {
        activeRunRef.current = nextRun;
        setActiveRun(nextRun);
        setDrawer("handoff");
      }
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
  const activeOpenedAiVersionNotice =
    sameLocalSourcePath(openedAiVersionNotice?.sourcePath, sourcePath)
      ? openedAiVersionNotice
      : null;
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
  const activeScopeDecision = activeRun?.validationReview?.softViolationCodes.length
    ? scopeDecisionSummary(activeRun.scopeReport)
    : null;
  const processPanelTitle = pendingRunOutcome
    ? "正在确认这次发送是否成功"
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
    ? "源页会在后台继续核对，不会重复发送同一轮要求"
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
    "committing",
    "ready-to-open",
    "complete",
    "no-change",
    "error",
  ];
  const validatedStates: LifecycleState[] = [
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
      detail: activeRun.validationReview?.softViolationCodes.length
          ? "已记录评论范围外的额外变化，未中断版本生成"
          : ["committing", "ready-to-open", "complete", "no-change"].includes(activeRun.status)
            ? "已通过"
            : "等待校验",
      state: ["committing", "ready-to-open", "complete", "no-change"].includes(activeRun.status)
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
  const savedDraftPanelHeight = commentDrafts.length > 0 && !composerOpen
    ? 58 + commentDrafts.length * 66
    : 0;
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
    const minimumTop = savedDraftPanelHeight > 0
      ? 92 + savedDraftPanelHeight + 20
      : 82;
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
    savedDraftPanelHeight,
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
    savedDraftPanelHeight + 136,
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
    } else if (action.id === "relink-target") {
      resumeSubmissionAfterRelinkRef.current = action.resumeSubmission === true;
      beginTargetRelink(action.commentId);
      setCanvasMode("edit");
      setDrawer(null);
    } else if (action.id === "relaunch-app") {
      void relaunchApp();
    } else if (action.id === "open-release") {
      void openLatestRelease();
    } else if (action.id === "retry-draft-persist") {
      void flushDraftPersistence();
    } else if (action.id === "review-project-rules") {
      setDrawer("files");
      if (fileView?.path !== "PROJECT.md") void viewFile("PROJECT.md");
    } else if (action.id === "review-comment-drafts") {
      const firstDraft = commentDraftsRef.current[0];
      if (firstDraft) {
        setCanvasMode("edit");
        setDrawer(null);
        restoreCommentDraft(firstDraft.commentId);
      }
    } else if (action.id === "retry-submit") {
      void generateRequest();
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
                <li>{version.validationReview?.softViolationCodes.length
                  ? "硬边界已通过，额外范围变化已记录"
                  : "版本与文件完整性已校验"}</li>
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
                  <p>{version.validationReview?.softViolationCodes.length
                    ? "不可忽略的硬边界已通过；评论范围外的额外变化已随版本记录。"
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
                {browserPreviewOnly
                  ? "操作不会保存"
                  : persistState === "idle"
                    ? "已安全保存"
                    : persistLabel}
              </span>
            </span>
          </div>
        </div>

        <nav className="header-actions" aria-label="画布模式、项目和版本操作">
          <div className="canvas-mode-switch" role="group" aria-label="画布模式">
            <button
              type="button"
              aria-pressed={canvasMode === "edit"}
              disabled={browserPreviewOnly || runInProgress || viewMode === "history"}
              title={browserPreviewOnly ? "浏览器预览为只读模式" : undefined}
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
            {!runtimeCapabilitiesReady ? (
              <div className="canvas-loading" role="status">正在识别运行环境…</div>
            ) : !browserPreviewOnly ? (
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
            ) : null}
          </div>
          {canvasMode === "preview" ? (
            <HtmlInteractionPreview
              html={interactionPreviewHtml}
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
            tabIndex={-1}
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
                    title={attachmentUploadCount > 0 ? "附件添加完成后可关闭" : "收起并保留草稿"}
                    disabled={attachmentUploadCount > 0}
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

            {!composerOpen && commentDrafts.length > 0 && !interactionLocked ? (
              <section
                className="draft-recovery-card rail-status-card saved-comment-drafts"
                aria-label={`${commentDrafts.length} 条未完成评论`}
              >
                <div className="saved-comment-drafts-heading">
                  <strong>{commentDrafts.length} 条未完成评论</strong>
                  <span>发送前需要确认</span>
                </div>
                <div className="saved-comment-drafts-list">
                  {commentDrafts.map((savedDraft) => (
                    <article
                      key={savedDraft.commentId}
                      data-resolution={savedDraft.target.resolution}
                    >
                      <span>
                        <strong>{insertionLabel(savedDraft.target)}</strong>
                        <small>
                          {savedDraft.text.trim()
                            ? savedDraft.text.trim().slice(0, 58)
                            : `${savedDraft.attachments.length} 个附件`}
                        </small>
                      </span>
                      <span className="saved-comment-draft-actions">
                        <button
                          className="resume-comment-button"
                          type="button"
                          onClick={() => restoreCommentDraft(savedDraft.commentId)}
                        >继续填写</button>
                        <button
                          type="button"
                          aria-label={`删除 ${insertionLabel(savedDraft.target)} 的未完成评论`}
                          onClick={() => deleteCommentDraft(savedDraft.commentId)}
                        >删除</button>
                      </span>
                    </article>
                  ))}
                </div>
              </section>
            ) : null}

            {visibleCommentItems.length === 0
              && !composerOpen
              && commentDrafts.length === 0 ? (
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
                      className="project-file-editor"
                      aria-label="项目长期规则"
                      aria-describedby="project-rules-help"
                      spellCheck={false}
                      disabled={fileView.loading || runInProgress}
                      value={fileView.content}
                      onChange={(event) => {
                        setProjectRulesSaveError("");
                        setFileView((current) => (
                          current?.path === "PROJECT.md"
                            ? { ...current, content: event.target.value }
                            : current
                        ));
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
                        onClick={() => {
                          setProjectRulesSaveError("");
                          setFileView((current) => (
                            current?.path === "PROJECT.md"
                              ? { ...current, content: current.savedContent }
                              : current
                          ));
                        }}
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
                        : persistState === "idle"
                          ? "已安全保存"
                          : persistLabel}
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
                              ) : step.state === "error" ? (
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
                    {activeRun.validationReview?.softViolationCodes.length
                      && activeRun.status === "ready-to-open" ? (
                      <section className="validation-decision" role="status">
                        <strong>已记录评论范围外的额外变化</strong>
                        <p>{activeScopeDecision?.message
                          || "这些变化没有触及不可忽略的文件、身份或脚本边界，因此没有中断版本生成。"}</p>
                        {activeScopeDecision?.examples.length ? (
                          <ul className="scope-change-preview">
                            {activeScopeDecision.examples.map((example) => (
                              <li key={example}>{example}</li>
                            ))}
                          </ul>
                        ) : null}
                      </section>
                    ) : null}
                    {activeRun.status === "awaiting-conflict-resolution" ? (
                      <section className="ai-conflict-panel" role="alert">
                        <strong>请选择哪份内容成为当前 HTML</strong>
                        <p>外部文件和 AI 候选都已保留，系统不会静默覆盖任一侧。</p>
                        {activeRun.error ? <small>{activeRun.error}</small> : null}
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
                    {pendingRunOutcome ? (
                      <section className="ai-conflict-panel" role="status">
                        <strong>正在确认这次发送是否成功</strong>
                        <p>
                          源页会在后台继续核对，不会重复发送同一轮要求。
                        </p>
                      </section>
                    ) : null}
                    {!pendingRunOutcome
                      && activeRun.status === "ready-to-open"
                      && activeRun.error ? (
                      <section className="validation-decision" role="status">
                        <strong>最新版仍已安全保留</strong>
                        <p>{activeRun.error} 可在下方再次打开，不需要重新生成。</p>
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
              <span className="processing-auto-status" role="status">
                {pendingReconcileBusy ? "正在自动确认发送结果…" : "等待下一次自动确认…"}
              </span>
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
