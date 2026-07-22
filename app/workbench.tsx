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
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { ChatCircleTextIcon } from "@phosphor-icons/react/dist/csr/ChatCircleText";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CopyIcon } from "@phosphor-icons/react/dist/csr/Copy";
import { FileIcon } from "@phosphor-icons/react/dist/csr/File";
import { FileTextIcon } from "@phosphor-icons/react/dist/csr/FileText";
import { FolderOpenIcon } from "@phosphor-icons/react/dist/csr/FolderOpen";
import { PaperclipIcon } from "@phosphor-icons/react/dist/csr/Paperclip";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import { TriangleIcon } from "@phosphor-icons/react/dist/csr/Triangle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";

import type {
  HtmlCanvasEditorHandle,
  HtmlCanvasMutation,
  HtmlCanvasSelection,
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
} from "./components/HtmlCanvasEditor";
import HtmlInteractionPreview from "./components/HtmlInteractionPreview";
import { rebindCanvasSelectionTargets } from "./lib/canvas-target-rebind.js";
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
import { DEFAULT_PROJECT_HTML } from "./lib/sample-html";
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
};

type QoderHandoffResult = {
  status: "copied";
  copied: boolean;
  opened: boolean;
  pasted: boolean;
  reason: string | null;
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
  openProjectRepository: () => Promise<{ opened: boolean }>;
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

function bridgeFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs = 0,
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
  name: "欢迎来到源页.html",
  sourcePath: null as string | null,
};

function fileStem(name: string): string {
  return name.replace(/\.html?$/i, "") || "未命名页面";
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

function displayVersionLabel(ordinal: number): string {
  return Number.isSafeInteger(ordinal) && ordinal > 0
    ? `版本 ${ordinal}`
    : "下一版";
}

function fileNameFromSourcePath(sourcePath: string): string {
  return sourcePath.split(/[\\/]/).at(-1) || "新版本.html";
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
    return [{
      commentId: String(value.commentId || value.id || `comment_unknown_${index + 1}`),
      createdAt,
      updatedAt: String(value.updatedAt || createdAt),
      target: selectionFromRecord(value.target || value),
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
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const projectSwitcherRef = useRef<HTMLButtonElement>(null);
  const commentCounter = useRef(1);
  const changeCounter = useRef(1);
  const attachmentCounter = useRef(1);
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
  const statusPollBusyRef = useRef(false);
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
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [recentProjects, setRecentProjects] = useState<RecentProject[]>([]);
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
  const [fileView, setFileView] = useState<WorkspaceFileView | null>(null);
  const [projectRulesSaving, setProjectRulesSaving] = useState(false);
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
  const [bridgeConnected, setBridgeConnected] = useState<boolean | null>(null);
  const [activeRun, setActiveRun] = useState<ActiveRun | null>(null);
  const [projectLocked, setProjectLocked] = useState(false);
  const [projectHydrating, setProjectHydrating] = useState(false);
  const [projectLoadError, setProjectLoadError] = useState<string | null>(null);
  const [startupIssue, setStartupIssue] = useState<StartupIssue | null>(null);
  const [viewTransitioning, setViewTransitioning] = useState(false);
  const [draftPersistError, setDraftPersistError] = useState("");
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [openingReadyVersion, setOpeningReadyVersion] = useState(false);
  const [waivingValidation, setWaivingValidation] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [qoderHandoffState, setQoderHandoffState] = useState<{
    requestId: string;
    status: QoderHandoffResult["status"];
  } | null>(null);
  const [updateResult, setUpdateResult] = useState<ManualUpdateResult | null>(null);
  const [openedAiVersionNotice, setOpenedAiVersionNotice] =
    useState<OpenedAiVersionNotice | null>(null);
  const [toast, setToast] = useReducer(noticeReducer, null);

  const openProjectRepository = useCallback(async () => {
    try {
      const result = await window.htmlAIUpdates?.openProjectRepository();
      if (!result?.opened) throw new Error("GitHub 项目页没有打开。");
    } catch {
      setToast({
        title: "GitHub 项目页没有打开",
        message: "请确认当前网络可以访问 GitHub 后重试。",
        tone: "warning",
        dedupeKey: "project-repository",
      });
    }
  }, []);

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
    activeRun?.requestId
    && qoderHandoffState?.requestId === activeRun.requestId
  )
    ? qoderHandoffState.status
    : "idle";
  const interactionLocked = runInProgress
    || projectHydrating
    || Boolean(projectLoadError)
    || viewTransitioning
    || persistState === "conflict"
    || viewMode === "history";

  const activeCommentItems = useMemo(
    () => comments.filter(commentHasContent),
    [comments],
  );
  const activeCommentCount = activeCommentItems.length;
  const summarizedChangeEvents = useMemo(
    () => summarizeChangeEvents(changeEvents),
    [changeEvents],
  );
  const unsafeHandoffTargets = useMemo(
    () => activeCommentItems.filter(
      (comment) => commentHasContent(comment) && !canLocateTarget(comment.target),
    ),
    [activeCommentItems],
  );
  const hasUnsafeHandoffTargets = unsafeHandoffTargets.length > 0;

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

  const commentedTargets = useMemo(() => {
    const grouped = new Map<string, {
      target: HtmlCanvasSelection;
      count: number;
      label: string;
    }>();
    for (const comment of activeCommentItems) {
      const current = grouped.get(comment.target.id);
      if (current) current.count += 1;
      else {
        grouped.set(comment.target.id, {
          target: comment.target,
          count: 1,
          label: insertionLabel(comment.target),
        });
      }
    }
    return [...grouped.values()];
  }, [activeCommentItems]);

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
    && sourcePathRef.current === context.sourcePath
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
        || sourcePathRef.current !== activeSource
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
        const reboundTargets = rebindCanvasSelectionTargets(
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
      if (!pendingWriteRef.current) return true;
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
            if (!registered) return false;
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
              && queuedAfterRegistration.sourcePath === write.sourcePath
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
            && queuedWrite.sourcePath === write.sourcePath
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
              const reboundTargets = rebindCanvasSelectionTargets(
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
            && pendingAfterFailure.sourcePath === write.sourcePath
            && pendingAfterFailure.revision > write.revision
            ? pendingAfterFailure
            : write;
          if (!pendingAfterFailure || pendingAfterFailure.revision < recoveryWrite.revision) {
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
      ? backgroundRunsRef.current.get(project.sourcePath) || null
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
    setActiveRun(backgroundRun);
    setProjectLocked(opensLockedProject);
    setProjectHydrating(Boolean(project.sourcePath));
    setProjectLoadError(null);
    setViewTransitioning(false);
    setDraftPersistError("");
    setProjectMenuOpen(false);
    setProjectRulesSaving(false);
    setRestoring(null);
    setCancelling(false);
    setDrawer(null);
    setFileView(null);
    if (!opensLockedProject) editorRef.current?.unlockNow?.();
    editorRef.current?.clearSelection();
  }, [clearAutosaveTimer]);

  const refreshRecents = useCallback(async () => {
    const api = window.htmlAIProjects;
    if (!api) return;
    try {
      setRecentProjects(await api.listRecentProjects());
    } catch {
      setRecentProjects([]);
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
      return sourcePathRef.current === nextSourcePath
        ? {
            epoch: projectEpochRef.current,
            projectId: nextProjectId,
            documentId: nextDocumentId,
            sourcePath: nextSourcePath,
          }
        : null;
    }

    const updatesCurrentProject =
      sourcePathRef.current === previousSourcePath
      || sourcePathRef.current === nextSourcePath;
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
      const trackedRun = backgroundRunsRef.current.get(previousSourcePath);
      backgroundRunsRef.current.delete(previousSourcePath);
      if (trackedRun) {
        backgroundRunsRef.current.set(nextSourcePath, {
          ...trackedRun,
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
      && storedRecoveryIdentity.sourcePath === context.sourcePath
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
      if (epoch !== projectEpochRef.current || sourcePathRef.current !== activeSource) return;

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
      if (epoch !== projectEpochRef.current || sourcePathRef.current !== activeSource) return;
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
      const recoveredCommentTargets = rebindCanvasSelectionTargets(
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
          || rebindCanvasSelectionTargets(
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
        if (epoch !== projectEpochRef.current || sourcePathRef.current !== activeSource) return;
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
        .filter((value) => value && value !== activeSourcePath),
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
          }
        });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [applyProject, hydrateRecentProjectRuns, refreshWorkspace]);

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
    const dismissAfter = noticeAutoDismissMs(toast);
    if (dismissAfter === null) return;
    const timeout = window.setTimeout(() => setToast(null), dismissAfter);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  useEffect(() => {
    if (!previewAttachment) return;
    const closePreview = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPreviewAttachment(null);
    };
    document.addEventListener("keydown", closePreview);
    return () => document.removeEventListener("keydown", closePreview);
  }, [previewAttachment]);

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
    const activeSource = sourcePathRef.current;
    if (!activeSource || files.length === 0) return;
    try {
      const registered = await ensureProjectRegistered(activeSource);
      if (!registered) throw new Error("当前项目已经切换，请重试。");
    } catch (cause) {
      setToast({
        title: "附件尚未加入",
        message: productErrorMessage(cause, "项目记录暂时无法建立。"),
        tone: "warning",
        dedupeKey: "attachment-project-registration",
      });
      return;
    }
    const existingCount = target.kind === "composer"
      ? composerAttachmentsRef.current.length
      : commentsRef.current.find((comment) => comment.commentId === target.commentId)
          ?.attachments?.length ?? 0;
    const available = Math.max(0, 10 - existingCount);
    const selected = files.slice(0, available);
    if (selected.length < files.length) {
      setToast({
        title: "每条评论最多添加 10 个附件",
        message: `已保留前 ${available} 个，其余文件没有加入。`,
        tone: "info",
        dedupeKey: `attachment-limit-${target.commentId}`,
      });
    }
    for (const originalFile of selected) {
      const file = source === "clipboard" && !originalFile.name
        ? new File(
            [originalFile],
            `粘贴图片-${Date.now()}.${originalFile.type.split("/")[1] || "png"}`,
            { type: originalFile.type || "image/png" },
          )
        : originalFile;
      if (file.size <= 0 || file.size > 25 * 1024 * 1024) {
        setToast({
          title: "这个附件没有加入",
          message: `${file.name || "未命名文件"} 需要小于 25 MB 且不能是空文件。`,
          tone: "warning",
          dedupeKey: `attachment-size-${target.commentId}-${file.name}`,
        });
        continue;
      }
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
        });
        const payload = await readJsonResponse(response);
        if (!response.ok) throw responseError(payload, "无法添加评论附件。");
        const attachment = attachmentFromRecord(
          isRecord(payload.attachment) ? payload.attachment : null,
        );
        if (!attachment) throw new Error("附件已写入，但返回的记录不完整。");
        if (attachment.kind === "image") {
          rememberAttachmentObjectUrl(
            attachment.attachmentId,
            URL.createObjectURL(file),
          );
        }
        if (target.kind === "composer") {
          if (composerCommentIdRef.current !== target.commentId) {
            void deleteAttachmentFile(attachment);
            continue;
          }
          const next = [...composerAttachmentsRef.current, attachment];
          composerAttachmentsRef.current = next;
          setDraftAttachments(next);
          persistCurrentDraftRecovery();
        } else {
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
        }
      } catch (cause) {
        setToast({
          title: "附件添加失败",
          message: productErrorMessage(cause, `${file.name || "文件"} 没有加入评论。`),
          tone: "error",
          dedupeKey: `attachment-upload-${target.commentId}-${file.name}`,
        });
      } finally {
        setAttachmentUploadCount((count) => Math.max(0, count - 1));
      }
    }
  }, [
    deleteAttachmentFile,
    ensureProjectRegistered,
    persistCurrentDraftRecovery,
    rememberAttachmentObjectUrl,
  ]);

  const openAttachmentPicker = useCallback((
    target: { kind: "composer" | "comment"; commentId: string },
  ) => {
    attachmentInputTargetRef.current = target;
    attachmentInputRef.current?.click();
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
        message: productErrorMessage(cause, "附件仍保留在项目记录中。"),
        tone: "warning",
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
        message: productErrorMessage(cause, "附件仍保留在项目记录中。"),
        tone: "warning",
        dedupeKey: `attachment-download-${attachment.attachmentId}`,
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
    if (projectLocked || projectHydrating) return;
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

          if (submissionPendingRef.current) {
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
  ): Promise<boolean> => {
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
    if (submissionPendingRef.current) {
      setToast({
        title: "正在建立冻结任务",
        message: "Request 持久化完成后即可切换项目，请稍候。",
        tone: "info",
        dedupeKey: "project-switch-blocked",
      });
      return false;
    }
    if (viewTransitioningRef.current) {
      setToast({
        title: "正在核对当前画布",
        message: "本次历史或源文件切换完成后即可打开其他项目。",
        tone: "info",
        dedupeKey: "project-switch-blocked",
      });
      return false;
    }
    if (projectLoadErrorRef.current) {
      draftPendingRef.current = null;
      return true;
    }
    if (flushPromiseRef.current && !await flushPromiseRef.current) return false;
    if (draftFlushPromiseRef.current && !await draftFlushPromiseRef.current) return false;
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
        message: "已保留最新编辑，本次不切换项目；请再试一次。",
        tone: "info",
        dedupeKey: "project-switch-new-edit",
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
    viewMode,
  ]);
  useEffect(() => {
    deferredEditorReplayRef.current.prepareProjectSwitch = (resolve) => {
      void prepareProjectSwitch(true).then(resolve, () => resolve(false));
    };
  }, [prepareProjectSwitch]);

  const openProject = useCallback(async (recentPath?: string) => {
    if (!await prepareProjectSwitch()) return;
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
      setToast({
        title: "无法打开这个 HTML",
        message: productErrorMessage(cause, "请检查文件是否仍然存在或具有读取权限。"),
        tone: "error",
        sticky: true,
        dedupeKey: "project-open-error",
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
        message: productErrorMessage(cause, "请检查源 HTML 是否仍在原来的位置。"),
        tone: "warning",
        dedupeKey: "show-project-in-folder-error",
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
        message: productErrorMessage(cause, "请稍后重试。"),
        tone: "warning",
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
      setToast({
        title: "无法读取文件",
        message: cause instanceof TypeError
          ? "这个 HTML 不是 UTF-8 编码。为了不损坏原文件，请先转换为 UTF-8 后再打开。"
          : "请选择普通的 .html 或 .htm 文件。",
        tone: "warning",
        dedupeKey: "browser-file-error",
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
        rebindCanvasSelectionTargets(nextHtml, untrackedSafeTargets)
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
      setFileView({ path: "源文件冲突对比", content: diff, savedContent: diff });
      setDrawer("files");
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      setToast({
        title: "暂时无法查看差异",
        message: productErrorMessage(cause, "外部文件没有被覆盖，请稍后重试。"),
        tone: "warning",
        dedupeKey: "source-diff",
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
      });
      setDrawer("files");
    } catch (cause) {
      if (!isCurrentProjectContext(context)) return;
      setToast({
        title: "暂时无法比较两份内容",
        message: productErrorMessage(cause, "两份文件都仍被安全保留，请稍后重试。"),
        tone: "warning",
        dedupeKey: "ai-conflict-diff",
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
      if (event.key.toLowerCase() === "s" && !event.shiftKey) {
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
  }, [interactionLocked, requestUserFlush, viewMode]);

  const openCommentComposer = useCallback((target: HtmlCanvasSelection) => {
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
    setComposerOpen(true);
    setDraftTarget(target);
    window.requestAnimationFrame(() => {
      composerRef.current?.focus();
      composerRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [viewMode]);

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
    persistCurrentDraftRecovery();
    for (const attachment of abandonedAttachments) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
      void deleteAttachmentFile(attachment);
    }
  }, [deleteAttachmentFile, forgetAttachmentObjectUrl, persistCurrentDraftRecovery]);

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
        message: "请在画布中重新选择目标；工作台不会猜测多个候选或已删除的位置。",
        tone: "warning",
        dedupeKey: `unsafe-comment-target-${draftTarget.id}`,
      });
      return;
    }
    if (!draft.trim() && draftAttachments.length === 0) {
      composerRef.current?.focus();
      return;
    }
    if (attachmentUploadCount > 0) return;
    const now = new Date().toISOString();
    const commentId = draftCommentId || recordId("comment", commentCounter.current++);
    const nextComments = [...commentsRef.current, {
      commentId,
      createdAt: now,
      updatedAt: now,
      target: draftTarget,
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
    persistCurrentDraftRecovery(nextComments);
  }, [
    currentBasedOnVersionId,
    draft,
    draftAttachments,
    draftCommentId,
    draftTarget,
    attachmentUploadCount,
    persistCurrentDraftRecovery,
    viewMode,
  ]);

  const deleteComment = useCallback((commentId: string) => {
    const deleted = commentsRef.current.find((item) => item.commentId === commentId);
    deletedCommentIdsRef.current.add(commentId);
    const nextComments = commentsRef.current.filter(
      (item) => item.commentId !== commentId,
    );
    commentsRef.current = nextComments;
    setComments(nextComments);
    persistCurrentDraftRecovery(nextComments);
    for (const attachment of deleted?.attachments ?? []) {
      forgetAttachmentObjectUrl(attachment.attachmentId);
      void deleteAttachmentFile(attachment);
    }
  }, [deleteAttachmentFile, forgetAttachmentObjectUrl, persistCurrentDraftRecovery]);

  const focusCommentTarget = useCallback((target: HtmlCanvasSelection) => {
    if (!canLocateTarget(target)) {
      setSelection(target);
      setToast({
        title: target.resolution === "ambiguous" ? "目标存在多个候选" : "原目标已不存在",
        message: "工作台不会猜测或定位到相似元素。请在画布中重新选择目标后再添加评论。",
        tone: "warning",
        dedupeKey: `unsafe-target-${target.id}`,
      });
      return;
    }
    const located = editorRef.current?.select(target, { showToolbar: false });
    setSelection(located || target);
  }, []);

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
    setFileView({ path, content: "正在读取…", savedContent: "正在读取…" });
    try {
      const content = await readWorkspaceFile(path, context.sourcePath);
      if (!isCurrentProjectContext(context)) return;
      setFileView({ path, content, savedContent: content });
    } catch {
      if (!isCurrentProjectContext(context)) return;
      const content = "文件尚未生成，或本地项目记录暂时不可用。";
      setFileView({ path, content, savedContent: content });
    }
  }, [captureProjectContext, isCurrentProjectContext, readWorkspaceFile]);

  const saveProjectRules = useCallback(async () => {
    if (!fileView || fileView.path !== "PROJECT.md" || runInProgress) return;
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
    requestId: string,
  ) => {
    if (!handoffMessage.trim() || !requestId || requestId === "pending") return;

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
      setQoderHandoffState({ requestId, status: "copied" });
    } catch (cause) {
      setToast({
        title: "暂时无法复制交接内容",
        message: productErrorMessage(cause, "请在正式桌面应用中重试。"),
        tone: "warning",
        dedupeKey: "qoder-handoff",
      });
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
        message: productErrorMessage(cause, "请稍后重试。"),
        tone: "warning",
        dedupeKey: "reveal-request-folder",
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
      });
    }
  }, []);

  const generateRequest = useCallback(async (fromDeferred = false) => {
    if (!sourcePathRef.current) {
      setToast({
        title: "请先打开本地 HTML",
        message: "浏览器预览没有绑定源文件，暂时不能交给内部 AI。",
        tone: "info",
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
        message: `有 ${unsafeTargets.length} 条要求无法唯一定位到当前源码。请删除这些要求，在画布中重新选择目标后再添加；本轮尚未锁定或提交。`,
        tone: "warning",
        sticky: true,
        dedupeKey: "unsafe-comment-targets",
      });
      return;
    }

    try {
      const registered = await ensureProjectRegistered();
      if (!registered) throw new Error("当前项目已经切换，请重试。");
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
      return;
    }
    activeComments = commentsRef.current.filter(commentHasContent);
    if (activeComments.length === 0) {
      composerRef.current?.focus();
      return;
    }
    const unsafeRegisteredTargets = activeComments.filter(
      (comment) => !canLocateTarget(comment.target),
    );
    if (unsafeRegisteredTargets.length > 0) {
      setToast({
        title: "请重新选择失联的评论目标",
        message: `有 ${unsafeRegisteredTargets.length} 条要求无法唯一定位到当前源码。请删除这些要求，在画布中重新选择目标后再添加；本轮尚未锁定或提交。`,
        tone: "warning",
        sticky: true,
        dedupeKey: "unsafe-comment-targets",
      });
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
      return;
    }
    projectLockedRef.current = true;
    submissionPendingRef.current = true;
    setProjectLocked(true);
    setGenerating(true);
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
    setActiveRun(pendingRun);
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
      });
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
        setActiveRun(run);
        setBridgeConnected(true);
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
              if (isCurrentProjectContext(submissionContext)) setActiveRun(durableRun);
            } else if (isCurrentProjectContext(submissionContext)) {
              confirmedNoRun = true;
              projectLockedRef.current = false;
              setProjectLocked(false);
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
        setActiveRun(null);
      }
      if (
        !durableRun
        && requestDispatched
        && !confirmedNoRun
        && isCurrentProjectContext(submissionContext)
      ) {
        setActiveRun({
          ...pendingRun,
          status: "error",
          error: "本轮任务状态暂时无法确认。当前项目保持锁定；重新打开项目后会继续核对。",
        });
      }
      if (!durableRun && requestDispatched && !confirmedNoRun) {
        setToast({
          title: "正在确认本轮任务状态",
          message: "当前项目会保持只读，确认任务是否建立后再恢复编辑。",
          tone: "warning",
          sticky: true,
          dedupeKey: "ai-submit",
          action: { id: "open-handoff", label: "查看处理详情" },
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
      setGenerating(false);
    }
    if (durableRun?.handoffMessage) {
      await sendToQoderWork(durableRun.handoffMessage, durableRun.requestId);
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
        sourcePathRef.current === run.sourcePath
        || sourcePathRef.current === committedSourcePath
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
    setActiveRun({
      ...run,
      sourcePath: committedSourcePath,
      candidateVersionLabel: candidateLabel,
      status: protocolViolation ? "error" : "complete",
    });
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
      setActiveRun({
        ...run,
        sourcePath: committedSourcePath,
        candidateVersionLabel: candidateLabel,
        status: "error",
        error: warning,
      });
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
      setToast(null);
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
      || openingReadyVersion
    ) return;
    setOpeningReadyVersion(true);
    setActiveRun({ ...run, error: undefined });
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
      setActiveRun(nextRun);
      setDrawer("handoff");
    } finally {
      setOpeningReadyVersion(false);
    }
  }, [activeRun, openCommittedVersion, openingReadyVersion]);

  const waiveCurrentValidation = useCallback(async () => {
    const run = activeRun;
    const review = run?.validationReview;
    if (
      !run
      || run.status !== "awaiting-check-decision"
      || !review
      || waivingValidation
    ) return;
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
      setActiveRun(nextRun);
    } catch (cause) {
      setActiveRun({
        ...run,
        error: productErrorMessage(cause, "无法记录本次校验决定。"),
      });
    } finally {
      setWaivingValidation(false);
    }
  }, [activeRun, waivingValidation]);

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
    const isCurrentProject = sourcePathRef.current === run.sourcePath;
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
        setToast(null);
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
        setActiveRun({ ...run, status: "no-change" });
        setDrawer(null);
        setToast({
          title: "这次没有生成新版本",
          message: `${run.candidateVersionLabel} 未创建；评论与候选号都已保留，可调整要求后重试。`,
          tone: "info",
          dedupeKey: "current-version-result",
        });
      } else {
        setToast({
          title: `${run.sourcePath.split(/[\\/]/).at(-1)} 没有生成新版本`,
          message: "内部 AI 没有产生有效变化；切回项目后评论仍在。",
          tone: "info",
          dedupeKey: `background-version:${run.sourcePath}`,
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
        setActiveRun({ ...run, status: "error", error });
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
      if (statusPollBusyRef.current || backgroundRunsRef.current.size === 0) return;
      statusPollBusyRef.current = true;
      try {
        for (const run of [...backgroundRunsRef.current.values()]) {
          if (!run.requestId || run.requestId === "pending") continue;
          const url = new URL(`${BRIDGE_URL}/status`);
          url.searchParams.set("sourcePath", run.sourcePath);
          url.searchParams.set("projectId", run.projectId);
          url.searchParams.set("requestId", run.requestId);
          url.searchParams.set("attemptId", run.attemptId);
          try {
            const response = await bridgeFetch(url, { cache: "no-store" });
            const payload = await readJsonResponse(response);
            if (!response.ok) throw responseError(payload, "无法读取本轮状态。");
            await processRunStatus(run, payload);
          } catch {
            // Bridge restarts are expected; runtime-state remains the source of truth.
          }
        }
      } finally {
        statusPollBusyRef.current = false;
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 1600);
    return () => window.clearInterval(timer);
  }, [processRunStatus]);

  useEffect(() => {
    if (
      !projectLocked
      || activeRun?.requestId !== "pending"
      || !sourcePath
    ) return;
    const context = captureProjectContext();
    if (!context) return;
    let disposed = false;
    let checking = false;
    const reconcile = async () => {
      if (disposed || checking) return;
      checking = true;
      try {
        const url = new URL(`${BRIDGE_URL}/workspace`);
        url.searchParams.set("sourcePath", context.sourcePath);
        const response = await bridgeFetch(url, { cache: "no-store" });
        const payload = await readJsonResponse(response);
        if (!response.ok || disposed || !isCurrentProjectContext(context)) return;
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
          setActiveRun(recoveredRun);
          setProjectLocked(isLockedLifecycle(recoveredRun.status));
          projectLockedRef.current = isLockedLifecycle(recoveredRun.status);
          setBridgeConnected(true);
          return;
        }
        projectLockedRef.current = false;
        setProjectLocked(false);
        editorRef.current?.unlockNow?.();
        setActiveRun(null);
        setDrawer(null);
        setToast({
          title: "本轮任务未建立",
          message: "已确认没有活动任务；页面和评论已经恢复编辑。",
          tone: "info",
          dedupeKey: "ai-submit",
        });
      } finally {
        checking = false;
      }
    };
    void reconcile();
    const timer = window.setInterval(() => void reconcile(), 1600);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [
    activeRun?.requestId,
    captureProjectContext,
    isCurrentProjectContext,
    projectLocked,
    sourcePath,
  ]);

  const cancelActiveRun = useCallback(async () => {
    if (!activeRun || cancelling || !activeRun.requestId || activeRun.requestId === "pending") return;
    const run = { ...activeRun };
    const context = sourcePathRef.current === run.sourcePath
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
        setActiveRun(null);
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
      setCancelling(false);
    }
  }, [
    activeRun,
    cancelling,
    captureProjectContext,
    isCurrentProjectContext,
  ]);

  const resolveAiConflict = useCallback(async (action: "adopt-ai" | "keep-external") => {
    if (!activeRun || activeRun.status !== "awaiting-conflict-resolution") return;
    const run = { ...activeRun };
    const context = sourcePathRef.current === run.sourcePath
      ? captureProjectContext()
      : null;
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
    openedAiVersionNotice?.sourcePath === sourcePath
      ? openedAiVersionNotice
      : null;
  const currentProjectFolder = folderFromSourcePath(sourcePath);
  const visibleRecentProjects = recentProjects
    .filter((project) => project.sourcePath !== sourcePath)
    .slice(0, 3);
  const candidateLabel = activeRun?.candidateVersionLabel || "下一版";
  const runBasisLabel = activeRun?.basedOnVersionId
    ? safeVersionLabel(activeRun.basedOnVersionId)
    : currentBasedOnVersionId
      ? safeVersionLabel(currentBasedOnVersionId)
      : "初始内容";
  const runSubmittedLabel = activeRun?.submittedAt
    ? formatTime(activeRun.submittedAt, true)
    : "正在提交";
  const runStatus = activeRun?.status === "submitting"
    ? "正在准备本轮修改…"
    : activeRun?.status === "awaiting-check-decision"
      ? "有一项范围校验需要你决定"
    : activeRun?.status === "ready-to-open"
      ? "最新版已通过检查，等待你打开"
    : activeRun?.status === "validating"
      ? "正在检查修改结果…"
      : activeRun?.status === "committing"
        ? "正在保存修改结果…"
        : activeRun?.status === "awaiting-conflict-resolution"
          ? "修改已完成，但源 HTML 同时被外部更新"
          : activeRun?.status === "recovering-transaction"
            ? "正在恢复尚未保存完成的修改…"
            : activeRun?.status === "error"
              ? activeRun.error || "本轮处理遇到问题"
              : activeRun?.status === "no-change"
                ? "本轮没有检测到有效变化"
                : "等待 QoderWork 返回修改结果";
  const returnedStates: LifecycleState[] = [
    "validating",
    "awaiting-check-decision",
    "committing",
    "ready-to-open",
    "complete",
    "error",
  ];
  const validatedStates: LifecycleState[] = [
    "awaiting-check-decision",
    "committing",
    "ready-to-open",
    "complete",
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
      label: "已复制给内部 AI",
      detail: currentQoderHandoffStatus === "copied"
        ? "仅确认已写入剪贴板，不代表 AI 已收到"
        : "等待复制到剪贴板",
      state: currentQoderHandoffStatus === "copied" ? "done" : "current",
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
      label: "身份、Hash 与文件完整性",
      detail: activeRun.status === "error"
        ? activeRun.error || "硬校验未通过"
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
          : ["committing", "ready-to-open", "complete"].includes(activeRun.status)
            ? "已通过"
            : "等待校验",
      state: activeRun.status === "awaiting-check-decision"
        ? "attention"
        : ["committing", "ready-to-open", "complete"].includes(activeRun.status)
          ? "done"
          : activeRun.status === "validating"
            ? "current"
            : "pending",
    },
    {
      key: "version",
      label: "新版本已安全保存",
      detail: ["ready-to-open", "complete"].includes(activeRun.status)
        ? `${activeRun.candidateVersionLabel} 已保留，旧版未被覆盖`
        : "等待版本提交",
      state: ["ready-to-open", "complete"].includes(activeRun.status)
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
          : "等待前序步骤完成",
      state: activeRun.status === "complete"
        ? "done"
        : activeRun.status === "ready-to-open"
          ? "current"
          : "pending",
    },
  ] as const : [];
  const activeSupplementRecords = supplementsFromRecords(
    isRecord(activeRun?.readyPayload?.supplement)
      ? activeRun?.readyPayload?.supplement.records
      : activeRun?.readyPayload?.supplements,
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
  const toastToneLabel = toast
    ? {
        success: "操作已完成",
        info: "提示",
        warning: "需要关注",
        error: "需要处理",
      }[toast.tone]
    : "";
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
    } else if (action.id === "retry-cancel") {
      void cancelActiveRun();
    }
  };
  const renderHistoryItem = (version: Version) => (
    <article
      className="history-item"
      key={version.id}
    >
      <div className="history-item-heading">
        <div>
          <strong>
            {version.label}
            {version.ordinal === 1 ? " · 初始基线" : " · AI 返回版本"}
          </strong>
          <span>{version.summary}</span>
          <small>
            {version.source} · 生成于 {formatTime(version.generatedAt)}
            {version.basedOnVersionId ? ` · 基于 ${safeVersionLabel(version.basedOnVersionId)}` : ""}
          </small>
        </div>
      </div>
      <div className="history-item-actions">
        <button
          type="button"
          disabled={
            runInProgress
            || projectHydrating
            || Boolean(projectLoadError)
            || viewTransitioning
          }
          onClick={() => void viewHistoryVersion(version)}
        >只读查看</button>
        {typeof window !== "undefined"
          && window.htmlAIProjects?.revealVersionFile ? (
          <button
            type="button"
            onClick={() => void revealVersionInFinder(version)}
          >在 Finder 中显示</button>
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
        >{restoring === version.id ? "替换中…" : "替换当前 HTML"}</button>
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
                  <strong>{comment.target.label || comment.target.selector}</strong>
                  <span
                    className="target-resolution"
                    data-resolution={comment.target.resolution}
                  >{targetResolutionLabel(comment.target.resolution)}</span>
                  <time dateTime={comment.createdAt}>{formatTime(comment.createdAt, true)}</time>
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
                  <strong>{supplement.action === "add" ? "新增要求" : supplement.action === "amend" ? "补充修改" : "撤回要求"}</strong>
                  <time dateTime={supplement.createdAt}>{formatTime(supplement.createdAt, true)}</time>
                </div>
                <p>{supplement.text}</p>
                {supplement.attachments.length > 0 ? (
                  <small>已归档原件：{supplement.attachments.map((item) => item.fileName).join("、")}</small>
                ) : supplement.evidenceState === "description-only" ? (
                  <small>原件未归档 · {supplement.evidenceDescription}</small>
                ) : null}
              </article>
            ))}
            {version.supplements.length === 0 ? <small>本版没有内部 AI 对话补充。</small> : null}
          </section>
          <section className="history-source-group">
            <header><strong>本地编辑</strong><span>{summarizeChangeEvents(version.directEdits).length}</span></header>
            {summarizeChangeEvents(version.directEdits).map((event) => (
              <article className="history-record history-change-record" key={event.eventId}>
                <div>
                  <strong>{changeKindLabel(event)} · {event.target.label || event.target.selector}</strong>
                  <time dateTime={event.createdAt}>{formatTime(event.createdAt, true)}</time>
                </div>
                <div className="history-change-values">
                  <span><small>修改前</small><del>{historyRecordValue(event, event.before)}</del></span>
                  <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                  <span><small>修改后</small><ins>{historyRecordValue(event, event.after)}</ins></span>
                </div>
              </article>
            ))}
            {version.directEdits.length === 0 ? <small>本版没有本地编辑。</small> : null}
          </section>
          <section className="history-source-group">
            <header><strong>AI 结果与校验</strong><span>已归档</span></header>
            <p>{version.validationReview?.status === "waived"
              ? "硬校验通过；软校验由用户选择忽略，决定与原因已记录。"
              : "版本身份、内容 Hash 与不可变文件已经校验并提交。"}</p>
          </section>
        </details>
      ) : null}
    </article>
  );

  return (
    <main
      className="workbench"
      data-round-state={runInProgress ? "processing" : viewMode}
      data-canvas-mode={canvasMode}
      aria-label="HTML AI 可视化编辑工作台"
    >
      <header className="workbench-header">
        <div className="project-area">
          <div className="brand-lockup">
            <button
              className="brand"
              type="button"
              aria-label={
                updateResult?.status === "available" && updateResult.latestVersion
                  ? `打开源页 GitHub 项目页，发现新版本 ${updateResult.latestVersion}`
                  : "打开源页 GitHub 项目页"
              }
              title="打开源页 GitHub 项目页"
              onClick={() => void openProjectRepository()}
            >
              {/* A plain image keeps the shared renderer compatible with Electron file URLs. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="./brand-logo.png" alt="" />
              {updateResult?.status === "available" ? (
                <span className="update-badge" aria-hidden="true">new!</span>
              ) : null}
            </button>
          </div>
          <div
            className="project-summary"
            data-ai-file-opened={activeOpenedAiVersionNotice ? "true" : undefined}
          >
            <button
              ref={projectSwitcherRef}
              className="project-switcher"
              type="button"
              aria-label={
                activeOpenedAiVersionNotice
                  ? `QoderWork 返回的新文件已打开：${activeOpenedAiVersionNotice.fileName}。切换或打开本地 HTML`
                  : `当前项目：${projectName}。切换或打开本地 HTML`
              }
              aria-expanded={projectMenuOpen}
              data-ai-file-opened={activeOpenedAiVersionNotice ? "true" : undefined}
              onClick={() => setProjectMenuOpen((value) => !value)}
            >
              <span
                className="project-state-label"
                role={activeOpenedAiVersionNotice ? "status" : undefined}
                aria-live={activeOpenedAiVersionNotice ? "polite" : undefined}
                aria-atomic={activeOpenedAiVersionNotice ? "true" : undefined}
              >
                {activeOpenedAiVersionNotice ? (
                  <>
                    <CheckCircleIcon aria-hidden="true" size={17} weight="fill" />
                    <span>QoderWork 返回的新文件已打开</span>
                  </>
                ) : "当前项目"}
              </span>
              <strong title={activeOpenedAiVersionNotice?.fileName || projectName}>
                {activeOpenedAiVersionNotice?.fileName || projectName}
              </strong>
              <CaretDownIcon aria-hidden="true" size={18} weight="bold" />
              <span
                className="save-indicator"
                data-dirty={persistState !== "idle" ? "true" : "false"}
                data-persist-state={persistState}
                data-edit-revision={editRevision}
                data-persisted-revision={lastPersistedRevision}
                data-rendered-sha256={renderedContentSha256 || undefined}
                role={activeOpenedAiVersionNotice ? undefined : "status"}
                aria-live={activeOpenedAiVersionNotice ? "off" : "polite"}
              >
                {viewMode === "history"
                  ? `只读查看 ${viewingVersion?.label || viewingVersionId}`
                  : activeOpenedAiVersionNotice && persistState === "idle"
                    ? `原文件已保留 · ${formatTime(activeOpenedAiVersionNotice.generatedAt, true)}`
                    : persistLabel}
              </span>
            </button>
          </div>
          <div
            ref={projectMenuRef}
            className="project-menu"
            data-open={projectMenuOpen ? "true" : "false"}
            role="dialog"
            aria-label="项目菜单"
            inert={!projectMenuOpen}
          >
            <TriangleIcon
              className="project-menu-pointer"
              aria-hidden="true"
              size={24}
              weight="fill"
            />
            <span className="project-menu-heading">当前项目</span>
            <div className="project-menu-file current-project-file">
              <FileTextIcon
                className="project-file-icon"
                aria-hidden="true"
                size={25}
                weight="fill"
              />
              <strong>{projectName}</strong>
              <small title={sourcePath || undefined}>{currentProjectFolder}</small>
              {lastModifiedAt ? (
                <time dateTime={lastModifiedAt}>
                  {formatProjectTimestamp(lastModifiedAt)}
                </time>
              ) : null}
              {sourcePath
                && typeof window !== "undefined"
                && window.htmlAIProjects?.showInFolder ? (
                <button
                  className="project-file-finder"
                  type="button"
                  onClick={() => void showProjectInFolder()}
                >在 Finder 中显示</button>
              ) : null}
            </div>
            <div className="recent-projects">
              <span>最近打开</span>
              {visibleRecentProjects.length > 0 ? visibleRecentProjects.map((project) => (
                <div className="project-menu-file recent-project-file" key={project.path}>
                  <FileTextIcon
                    className="project-file-icon"
                    aria-hidden="true"
                    size={23}
                    weight="fill"
                  />
                  <button
                    className="project-file-open"
                    type="button"
                    onClick={() => void openProject(project.sourcePath)}
                    aria-label={`打开 ${project.name}`}
                  />
                  <strong>{project.name}</strong>
                  <small>{project.sourcePath}</small>
                  <time dateTime={new Date(project.lastOpenedAt).toISOString()}>
                    {formatProjectTimestamp(project.lastOpenedAt)}
                  </time>
                  {typeof window !== "undefined"
                    && window.htmlAIProjects?.showInFolder ? (
                    <button
                      className="project-file-finder"
                      type="button"
                      onClick={() => void showProjectInFolder(project.sourcePath)}
                    >在 Finder 中显示</button>
                  ) : null}
                </div>
              )) : <small className="recent-projects-empty">还没有最近打开的文件</small>}
            </div>
            <div className="project-menu-actions">
              <button type="button" onClick={() => void openProject()}>
                <PlusIcon aria-hidden="true" size={21} weight="regular" />
                <span>
                  <strong>打开本地 HTML…</strong>
                  <small>选择已有的 .html 或 .htm 文件</small>
                </span>
                <CaretRightIcon aria-hidden="true" size={18} weight="bold" />
              </button>
            </div>
          </div>
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
        </div>

        <nav className="header-actions" aria-label="画布模式、项目和版本操作">
          <div className="canvas-mode-switch" role="group" aria-label="画布模式">
            <button
              type="button"
              aria-pressed={canvasMode === "edit"}
              onClick={() => {
                setCanvasMode("edit");
                setProjectMenuOpen(false);
              }}
            >编辑</button>
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
                  setProjectMenuOpen(false);
                  setCanvasMode("preview");
                };
                if (deferEditorCommand("project-switch", enterPreview)) return;
                enterPreview();
              }}
            >预览</button>
          </div>
          <span className="header-divider" aria-hidden="true" />
          <button type="button" disabled={
            projectHydrating || viewTransitioning || Boolean(projectLoadError)
          } onClick={() => {
            const openProjectFiles = () => {
              setFileView(null);
              setDrawer("files");
            };
            if (deferEditorCommand("project-files", openProjectFiles)) return;
            openProjectFiles();
          }}>项目文件</button>
          <button
            type="button"
            disabled={
              projectHydrating || viewTransitioning || Boolean(projectLoadError)
            }
            onClick={() => {
              const openVersionHistory = () => {
                setCanvasMode("edit");
                setDrawer("history");
              };
              if (deferEditorCommand("version-history", openVersionHistory)) return;
              openVersionHistory();
            }}
          >
            版本历史
          </button>
          <span className="header-divider" aria-hidden="true" />
          <button
            type="button"
            disabled={projectHydrating || viewTransitioning}
            onClick={() => void exportCurrentHtml()}
          >导出 HTML 副本</button>
        </nav>
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

      {persistState === "conflict" || persistState === "failed" ? (
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

      {viewMode === "history" ? (
        <section className="history-view-banner" role="status">
          <div>
            <strong>只读查看 {viewingVersion?.label || viewingVersionId}</strong>
            <span>
              {viewingVersion
                ? `${formatTime(viewingVersion.generatedAt)} 生成 · 当前项目：${currentBasedOnVersionId ? `基于 ${safeVersionLabel(currentBasedOnVersionId)}${restoredFromVersionId ? "（从历史恢复）" : ""}` : "初始内容"}`
                : "画布来自精确不可变版本文件"}
            </span>
          </div>
          <button
            type="button"
            disabled={viewTransitioning}
            onClick={() => void returnToCurrent()}
          >返回当前 HTML</button>
          {viewingVersion ? (
            <button
              type="button"
              disabled={viewTransitioning || restoring !== null}
              onClick={() => void restoreVersion(viewingVersion)}
            >
              用此版本替换当前 HTML
            </button>
          ) : null}
        </section>
      ) : null}

      <section className="canvas-column" aria-label="页面画布">
        <div
          className="canvas-edit-surface"
          hidden={canvasMode !== "edit"}
          aria-hidden={canvasMode !== "edit"}
        >
          <div className="canvas-edit-status" role="status">
            本地文本编辑会直接修改源文件并保存
          </div>
          <Suspense fallback={(
            <div className="canvas-loading" role="status">正在载入源码画布…</div>
          )}>
            <HtmlCanvasEditor
              ref={editorRef}
              html={html}
              sourcePath={sourcePath || undefined}
              height="calc(100vh - 56px)"
              onChange={handleCanvasChange}
              onInteraction={() => setProjectMenuOpen(false)}
              onSelect={(target) => {
                setSelection(target);
              }}
              onRequestComment={openCommentComposer}
              onRequestFlush={requestUserFlush}
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
                : runInProgress || projectHydrating
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
            height="calc(100vh - 56px)"
            onInteraction={() => setProjectMenuOpen(false)}
          />
        ) : null}
      </section>

      {canvasMode === "edit" ? (
      <aside className="comments-panel" aria-label="本轮要求">
        <header className="comments-header">
          <div>
            <span>{projectLoadError ? "读取失败" : projectHydrating || viewTransitioning ? "正在读取" : viewMode === "history" ? "历史只读" : runInProgress ? candidateLabel : "当前 HTML"}</span>
            <h1>{projectLoadError
              ? "当前项目暂不可编辑"
              : projectHydrating || viewTransitioning
              ? "正在核对项目状态"
              : viewMode === "history"
              ? "返回当前 HTML 后继续编辑"
              : runInProgress
                ? "等待 QoderWork 完成修改"
                : "选中内容，写下怎么改"}</h1>
            <small className="round-record-counts">
              {runInProgress
                ? `${activeRun?.commentCount ?? activeCommentCount} 条评论 · ${activeRun?.changeEventCount ?? changeEvents.length} 项直接编辑记录`
                : `${activeCommentCount} 条评论 · ${changeEvents.length} 项直接编辑记录`}
              </small>
            </div>
        </header>

        {projectLoadError ? (
          <section className="round-lock-card" aria-label="项目读取失败">
            <strong>没有用未知状态覆盖源文件</strong>
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
        ) : projectHydrating || viewTransitioning ? (
          <section className="round-lock-card" aria-label="正在读取项目状态">
            <strong>确认源文件与运行态后开放编辑</strong>
            <span>这能避免用过期编辑状态覆盖磁盘上的新内容。</span>
          </section>
        ) : runInProgress ? (
          <section className="round-lock-card" aria-label="当前项目已锁定">
            <strong>{runStatus}</strong>
            <span>
              基于 {runBasisLabel} · {runSubmittedLabel} 提交 · {activeRun?.commentCount ?? activeCommentCount} 条要求
            </span>
            <small>当前项目已锁定；完成前不会清除评论，可继续打开其他项目。</small>
          </section>
        ) : viewMode === "history" ? (
          <section className="round-lock-card" aria-label="历史版本只读">
            <strong>历史版本不会接受编辑或评论</strong>
            <span>返回当前 HTML 后，尚未提交的评论仍会保留。</span>
          </section>
        ) : composerOpen && draftTarget ? (
          <section className="comment-composer" aria-label="添加评论">
            <div className="composer-target" data-empty={!draftTarget ? "true" : "false"}>
              <span>{draftTargetScope}</span>
              <strong>{draftTarget ? insertionLabel(draftTarget) : "先在画布中点一下要修改的内容"}</strong>
            </div>
            <textarea
              ref={composerRef}
              value={draft}
              disabled={!draftTarget || !canLocateTarget(draftTarget) || interactionLocked}
              aria-label="本轮修改评论"
              placeholder={
                draftTarget?.level === "insertion"
                  ? "例如：在这里增加一个风险提示模块。"
                  : draftTarget
                    ? "例如：把标题改得更简洁，保持当前风格。"
                    : "选择内容后在这里输入评论"
              }
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
                if (event.key === "Enter" && !event.shiftKey) {
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
            <div className="composer-actions">
              <button
                className="attachment-trigger"
                type="button"
                title="从本机添加，文件只会保存到当前项目"
                disabled={interactionLocked || !draftCommentId}
                onClick={() => {
                  if (draftCommentId) {
                    openAttachmentPicker({ kind: "composer", commentId: draftCommentId });
                  }
                }}
              >
                <PaperclipIcon aria-hidden="true" size={14} weight="regular" />
                <span>{attachmentUploadCount > 0 ? "正在添加…" : "添加图片或文件"}</span>
              </button>
              <div>
                <button
                  className="cancel-comment-button"
                  type="button"
                  onClick={closeCommentComposer}
                >取消</button>
                <button
                  className="add-comment-button"
                  type="button"
                  disabled={
                    !canLocateTarget(draftTarget)
                    || (!draft.trim() && draftAttachments.length === 0)
                    || attachmentUploadCount > 0
                    || interactionLocked
                  }
                  onClick={addComment}
                >发送评论</button>
              </div>
            </div>
          </section>
        ) : draftTarget && (draft.trim() || draftAttachments.length > 0) ? (
          <section className="draft-recovery-card" aria-label="未发送评论">
            <div>
              <strong>有一条未发送评论</strong>
              <span>{insertionLabel(draftTarget)}</span>
            </div>
            {draft.trim() ? <p>{draft}</p> : null}
            <CommentAttachmentStrip
              attachments={draftAttachments}
              objectUrls={attachmentObjectUrls}
              onEnsurePreview={ensureAttachmentObjectUrl}
              onPreview={(attachment) => void openAttachmentPreview(attachment)}
              onDownload={(attachment) => void downloadAttachment(attachment)}
            />
            <div>
              <button
                type="button"
                onClick={closeCommentComposer}
              >放弃</button>
              <button
                className="resume-comment-button"
                type="button"
                onClick={() => {
                  const located = editorRef.current?.select(draftTarget, { showToolbar: false });
                  setSelection(located || draftTarget);
                  setDraftTarget(located || draftTarget);
                  draftTargetRef.current = located || draftTarget;
                  setComposerOpen(true);
                  window.requestAnimationFrame(() => composerRef.current?.focus());
                }}
              >继续填写</button>
            </div>
          </section>
        ) : null}

        <div className="comment-list" aria-label="已添加的评论">
          {comments.length === 0 ? (
            <div className="comments-empty">
              <strong>评论会显示在这里</strong>
              <span>可以评论整个模块或其中的小区块。</span>
            </div>
          ) : comments.map((comment, index) => (
            <article
              className="comment-card"
              data-selected={selection?.selector === comment.target.selector ? "true" : "false"}
              data-resolution={comment.target.resolution}
              role="group"
              tabIndex={!interactionLocked && canLocateTarget(comment.target) ? 0 : -1}
              aria-label={canLocateTarget(comment.target)
                ? `在画布中定位：${insertionLabel(comment.target)}`
                : undefined}
              onClick={() => {
                if (!interactionLocked && canLocateTarget(comment.target)) {
                  focusCommentTarget(comment.target);
                }
              }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (
                  !interactionLocked
                  && canLocateTarget(comment.target)
                  && (event.key === "Enter" || event.key === " ")
                ) {
                  event.preventDefault();
                  focusCommentTarget(comment.target);
                }
              }}
              key={comment.commentId}
            >
              <div className="comment-card-header">
                <div className="comment-target-label">
                  <span>{index + 1}</span>
                  <strong>{insertionLabel(comment.target)}</strong>
                </div>
                <div className="comment-card-actions">
                  <button
                    className="comment-action delete-comment"
                    type="button"
                    disabled={interactionLocked}
                    onClick={(event) => {
                      event.stopPropagation();
                      deleteComment(comment.commentId);
                    }}
                  >删除</button>
                </div>
              </div>
              <textarea
                aria-label={`评论 ${index + 1}`}
                value={comment.text}
                disabled={interactionLocked}
                onClick={(event) => {
                  event.stopPropagation();
                  if (!interactionLocked && canLocateTarget(comment.target)) {
                    focusCommentTarget(comment.target);
                  }
                }}
                onChange={(event) => {
                  const nextComments = commentsRef.current.map((item) => (
                    item.commentId === comment.commentId
                      ? { ...item, text: event.target.value, updatedAt: new Date().toISOString() }
                      : item
                  ));
                  commentsRef.current = nextComments;
                  setComments(nextComments);
                  persistCurrentDraftRecovery(nextComments);
                }}
                onPaste={(event) => pasteImages(event, {
                  kind: "comment",
                  commentId: comment.commentId,
                })}
                onBlur={() => {
                  if (!commentHasContent(comment)) deleteComment(comment.commentId);
                }}
              />
              <CommentAttachmentStrip
                attachments={comment.attachments}
                objectUrls={attachmentObjectUrls}
                editable={!interactionLocked}
                onEnsurePreview={ensureAttachmentObjectUrl}
                onPreview={(attachment) => void openAttachmentPreview(attachment)}
                onDownload={(attachment) => void downloadAttachment(attachment)}
                onRemove={(attachment) => removeCommentAttachment(
                  comment.commentId,
                  attachment,
                )}
              />
              <button
                className="comment-add-attachment"
                type="button"
                title="从本机添加，文件只会保存到当前项目"
                disabled={interactionLocked}
                onClick={(event) => {
                  event.stopPropagation();
                  openAttachmentPicker({
                    kind: "comment",
                    commentId: comment.commentId,
                  });
                }}
              >
                <PaperclipIcon aria-hidden="true" size={13} weight="regular" />
                <span>添加图片或文件</span>
              </button>
            </article>
          ))}
        </div>

        <footer className="comments-footer">
          {draftPersistError ? (
            <section className="comment-persist-error" role="alert" aria-atomic="true">
              <div>
                <strong>评论还没有安全记录</strong>
                <span>{productErrorMessage(
                  draftPersistError,
                  "本轮评论暂时无法记录；当前内容仍保留在页面中。",
                )}</span>
              </div>
              <button
                type="button"
                onClick={() => void flushDraftPersistence()}
              >重试记录</button>
            </section>
          ) : null}
          <button
            className="handoff-button"
            type="button"
            disabled={
              generating
              || projectHydrating
              || Boolean(projectLoadError)
              || viewTransitioning
              || viewMode === "history"
              || (!runInProgress && (
                activeCommentCount === 0
                || hasUnsafeHandoffTargets
                || interactionLocked
                || persistState === "failed"
                || Boolean(draftPersistError)
              ))
            }
            onClick={() => {
              if (!runInProgress) {
                void generateRequest();
                return;
              }
              setDrawer("handoff");
            }}
          >
            {generating ? "正在冻结当前 HTML…" : runInProgress ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="./qoder-logo.png" alt="" />
                <span>{
                  currentQoderHandoffStatus === "copied"
                    ? "已复制，可粘贴至 QoderWork"
                    : "查看本轮处理"
                }</span>
              </>
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="./qoder-logo.png" alt="" />
                <span>一键发送至 QoderWork</span>
              </>
            )}
          </button>
          <span
            role="status"
            data-tone={!runInProgress && hasUnsafeHandoffTargets ? "warning" : "default"}
          >{projectHydrating
            ? "正在核对项目身份、源文件与编辑状态"
            : runInProgress
            ? <>如有任何建议和问题，请钉钉联系<strong>竺可</strong>。</>
            : bridgeConnected === false
              ? "本地项目记录未连接"
              : hasUnsafeHandoffTargets
                ? `${unsafeHandoffTargets.length} 条要求的目标已失联或不唯一 · 请在画布重新选择后重新添加`
              : (
                <>如有任何建议和问题，请钉钉联系<strong>竺可</strong>。</>
              )}</span>
        </footer>
      </aside>
      ) : null}

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
        onClick={() => setDrawer(null)}
      />
      <aside
        className={`side-drawer${drawer ? " open" : ""}`}
        data-drawer={drawer || undefined}
        inert={!drawer}
        aria-label={drawer === "history" ? "版本历史" : drawer === "files" ? "项目文件" : "本轮处理"}
      >
        <header className="drawer-header">
          <div>
            <strong>{drawer === "history" ? "版本历史" : drawer === "files" ? "项目文件" : "本轮处理"}</strong>
            <span>{drawer === "history"
              ? "当前 HTML 可编辑；历史版本保持只读"
              : drawer === "files"
                ? "当前页面与项目记录的位置"
                : activeRun
                  ? "查看进度、评论和修改记录"
                  : "发送评论后在这里查看进度"}</span>
          </div>
          <button type="button" onClick={() => setDrawer(null)}>关闭</button>
        </header>
        <div className="drawer-body">
          {drawer === "history" ? (
            <div className="history-list">
              <section className="current-work-history" aria-label="当前 HTML 修改记录">
                <header>
                  <div>
                    <strong>当前 HTML</strong>
                    <span>正在编辑并自动写回源文件的工作内容</span>
                  </div>
                  <b>工作中</b>
                </header>
                <p>
                  本地编辑不会自动生成新版本；发送至 QoderWork 并成功完成后，
                  这些记录会随新版本归档。
                </p>
                <strong className="current-work-counts">
                  {activeCommentCount} 条评论 · {summarizedChangeEvents.length} 项修改
                </strong>
                {activeCommentCount > 0 || changeEvents.length > 0 ? (
                  <details className="history-records">
                    <summary>查看本次修改</summary>
                    {activeCommentItems.map((comment) => (
                      <article className="history-record" key={comment.commentId}>
                        <div>
                          <strong>评论 · {comment.target.label || comment.target.selector}</strong>
                          <time dateTime={comment.createdAt}>{formatTime(comment.createdAt, true)}</time>
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
                    {summarizedChangeEvents.map((event) => (
                      <article className="history-record history-change-record" key={event.eventId}>
                        <div>
                          <strong>{changeKindLabel(event)} · {event.target.label || event.target.selector}</strong>
                          <time dateTime={event.createdAt}>{formatTime(event.createdAt, true)}</time>
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
                    {changeEvents.length > 0 ? (
                      <small className="history-audit-note">
                        已将 {changeEvents.length} 条底层记录整理为 {summarizedChangeEvents.length} 项用户可读变更；完整审计仍保存在项目记录中。
                      </small>
                    ) : null}
                  </details>
                ) : (
                  <span className="history-no-records">当前还没有评论或直接编辑记录。</span>
                )}
              </section>
              <div className="history-section-heading">
                <strong>历史基线与 AI 版本</strong>
                <span>只读、不随当前 HTML 的本地编辑变化</span>
              </div>
              {versions.length === 0 ? (
                <div className="drawer-empty">首次编辑或发送给 AI 后，会建立版本 1。</div>
              ) : (
                versions.map(renderHistoryItem)
              )}
            </div>
          ) : null}

          {drawer === "files" ? (
            fileView ? (
              <div className="file-view" data-editable={fileView.path === "PROJECT.md" ? "true" : "false"}>
                <button type="button" onClick={() => setFileView(null)}>返回文件</button>
                <strong>{workspaceFileLabel(fileView.path)}</strong>
                {fileView.path === "PROJECT.md" ? (
                  <>
                    <p className="project-file-note">
                      {runInProgress
                        ? "AI 正在处理，项目规则暂时只读。"
                        : "用于以后每次 AI 修改。"}
                    </p>
                    <textarea
                      className="project-file-editor"
                      aria-label="项目长期规则"
                      spellCheck={false}
                      disabled={runInProgress}
                      value={fileView.content}
                      onChange={(event) => setFileView((current) => (
                        current?.path === "PROJECT.md"
                          ? { ...current, content: event.target.value }
                          : current
                      ))}
                    />
                    <div className="project-file-actions">
                      <button
                        type="button"
                        disabled={projectRulesSaving || runInProgress || fileView.content === fileView.savedContent}
                        onClick={() => setFileView((current) => (
                          current?.path === "PROJECT.md"
                            ? { ...current, content: current.savedContent }
                            : current
                        ))}
                      >取消修改</button>
                      <button
                        className="drawer-primary"
                        type="button"
                        disabled={
                          projectRulesSaving
                          || runInProgress
                          || !fileView.content.trim()
                          || fileView.content === fileView.savedContent
                        }
                        onClick={() => void saveProjectRules()}
                      >{projectRulesSaving ? "更新中…" : "更新项目规则"}</button>
                    </div>
                  </>
                ) : <pre>{fileView.content}</pre>}
              </div>
            ) : (
              <div className="files-panel">
                <section className="project-locations" aria-label="文件位置">
                  <article className="project-location-card">
                    <div>
                      <FileTextIcon aria-hidden="true" size={18} weight="duotone" />
                      <strong>当前 HTML</strong>
                      {sourcePath
                        && typeof window !== "undefined"
                        && window.htmlAIProjects?.showInFolder ? (
                        <button
                          type="button"
                          aria-label="在 Finder 中显示当前 HTML"
                          onClick={() => void showProjectInFolder()}
                        >
                          <FolderOpenIcon aria-hidden="true" size={15} weight="bold" />
                          显示
                        </button>
                      ) : null}
                    </div>
                    <span className="project-location-path" title={sourcePath || undefined}>
                      {sourcePath || "尚未打开本地文件"}
                    </span>
                  </article>
                  <article
                    className="project-location-card"
                    data-empty={projectRecordsPath ? "false" : "true"}
                  >
                    <div>
                      <FolderOpenIcon aria-hidden="true" size={18} weight="duotone" />
                      <strong>项目记录</strong>
                      {projectRecordsPath ? (
                        <button
                          type="button"
                          aria-label="在 Finder 中打开项目记录"
                          onClick={() => void showProjectRecordsInFolder()}
                        >
                          <FolderOpenIcon aria-hidden="true" size={15} weight="bold" />
                          打开
                        </button>
                      ) : null}
                    </div>
                    <span
                      className="project-location-path"
                      title={projectRecordsPath || undefined}
                    >
                      {projectRecordsPath || "首次编辑或发送给 AI 后创建"}
                    </span>
                  </article>
                </section>
                <p className="project-storage-note">
                  {projectRecordsPath
                    ? "AI 完成后，新 HTML 和历史记录都保存在项目记录中。"
                    : "仅打开不会改动源文件。"}
                </p>
                <button
                  className="project-rule-card"
                  type="button"
                  disabled={!projectId}
                  onClick={() => void viewFile("PROJECT.md")}
                >
                  <strong>项目规则</strong>
                  <span>{projectId ? "用于以后每次 AI 修改" : "建立项目记录后可用"}</span>
                </button>
                {projectId ? (
                  <details className="technical-files">
                    <summary>技术记录</summary>
                    <div>
                      <button type="button" onClick={() => void viewFile("runtime-state.json")}>
                        <strong>运行状态</strong><span>仅查看</span>
                      </button>
                      <button type="button" onClick={() => void viewFile("edit-audit.jsonl")}>
                        <strong>编辑记录</strong><span>仅查看</span>
                      </button>
                      {activeRun?.requestId && activeRun.requestId !== "pending" ? (
                        <>
                          <button type="button" onClick={() => void viewFile(`requests/${activeRun.requestId}/PROMPT.md`)}>
                            <strong>本轮 Prompt</strong><span>仅查看</span>
                          </button>
                          <button type="button" onClick={() => void viewFile(`requests/${activeRun.requestId}/change-request.json`)}>
                            <strong>本轮修改要求</strong><span>仅查看</span>
                          </button>
                          <button type="button" onClick={() => void viewFile(`requests/${activeRun.requestId}/input/AI_RULES.md`)}>
                            <strong>本轮 AI 规则</strong><span>仅查看</span>
                          </button>
                        </>
                      ) : null}
                    </div>
                  </details>
                ) : null}
              </div>
            )
          ) : null}

          {drawer === "handoff" ? (
            <div className="handoff-panel">
              {activeRun ? (
                <>
                  <section
                    className="handoff-process-board"
                    data-status={activeRun.status}
                    aria-live="polite"
                  >
                    <header>
                      <div>
                        <span>本轮流程</span>
                        <strong>{runStatus}</strong>
                      </div>
                      <small>{activeRun.candidateVersionLabel}</small>
                    </header>
                    <ol>
                      {processSteps.map((step) => (
                        <li key={step.key} data-state={step.state}>
                          <span className="process-step-icon" aria-hidden="true">
                            {step.state === "done" ? (
                              <CheckCircleIcon size={19} weight="fill" />
                            ) : step.state === "attention" || step.state === "error" ? (
                              <TriangleIcon size={17} weight="fill" />
                            ) : (
                              <ClockCounterClockwiseIcon size={18} weight="duotone" />
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
                  {activeRun.status === "awaiting-check-decision" ? (
                    <section className="validation-decision" role="alert">
                      <strong>这不是安全错误，可以由你决定继续</strong>
                      <p>
                        {activeRun.validationReview?.softViolationCodes.length
                          ? `范围提示：${activeRun.validationReview.softViolationCodes.join("、")}`
                          : "检测到超出原评论范围的修改。"}
                      </p>
                      {activeRun.error ? <small>{activeRun.error}</small> : null}
                      <button
                        type="button"
                        disabled={waivingValidation}
                        onClick={() => void waiveCurrentValidation()}
                      >{waivingValidation ? "正在记录决定…" : "无视本校验，继续"}</button>
                    </section>
                  ) : null}
                  {activeRun.status === "ready-to-open" ? (
                    <section className="ready-version-action" role="status">
                      <div>
                        <strong>{activeRun.candidateVersionLabel} 已准备好</strong>
                        <span>当前左侧仍是旧版；点击后才会切换。</span>
                        {activeRun.error ? <small>{activeRun.error}</small> : null}
                      </div>
                      <button
                        className="drawer-primary"
                        type="button"
                        disabled={openingReadyVersion || !activeRun.readyPayload}
                        onClick={() => void activateReadyResult()}
                      >{openingReadyVersion
                        ? "正在打开并核对…"
                        : activeRun.readyPayload
                          ? "打开 Qoder 返回的最新版"
                          : "正在恢复最新版…"}</button>
                    </section>
                  ) : null}
                  {activeRun.status === "awaiting-conflict-resolution" ? (
                    <section className="ai-conflict-panel" role="alert">
                      <strong>请选择哪份内容成为当前 HTML</strong>
                      <p>外部文件和 AI 候选都已保留。系统不会静默覆盖任一侧。</p>
                      <button type="button" onClick={() => void viewAiConflictDiff()}>
                        比较两份内容
                      </button>
                      <button type="button" onClick={() => void resolveAiConflict("adopt-ai")}>采用 AI 候选</button>
                      <button type="button" onClick={() => void resolveAiConflict("keep-external")}>保留外部内容</button>
                    </section>
                  ) : null}
                  {activeRun.status === "recovering-transaction" ? (
                    <section className="ai-conflict-panel" role="status">
                      <strong>正在恢复尚未保存完成的修改</strong>
                      <p>恢复完成前页面会保持只读，评论和修改记录不会丢失。</p>
                    </section>
                  ) : null}
                  {runInProgress && [
                    "submitting",
                    "processing",
                  ].includes(activeRun.status) ? (
                    <div className="handoff-actions">
                      <button
                        className="drawer-primary"
                        type="button"
                        disabled={!activeRun.handoffMessage}
                        onClick={() => void sendToQoderWork(
                          activeRun.handoffMessage,
                          activeRun.requestId,
                        )}
                      >
                        <CopyIcon aria-hidden="true" size={15} weight="bold" />
                        <span>再次复制评论</span>
                      </button>
                      <button
                        className="cancel-run-button"
                        type="button"
                        disabled={cancelling}
                        onClick={() => void cancelActiveRun()}
                      >{cancelling ? "正在恢复编辑…" : "先不发送，继续编辑评论"}</button>
                    </div>
                  ) : null}
                  {activeRun.requestPath
                    && typeof window !== "undefined"
                    && window.htmlAIProjects?.revealRequestFolder ? (
                    <button
                      className="handoff-folder-link"
                      type="button"
                      onClick={() => void revealActiveRunInFinder()}
                    >
                      <FolderOpenIcon aria-hidden="true" size={18} weight="duotone" />
                      <span>在 Finder 中查看本轮文件</span>
                      <CaretRightIcon aria-hidden="true" size={14} weight="bold" />
                    </button>
                  ) : null}

                  <section className="handoff-history" aria-label="本轮评论和修改记录">
                    <header>
                      <div>
                        <strong>本轮记录</strong>
                        <span>原始要求、内部 AI 补充与本地编辑</span>
                      </div>
                      <small>{activeCommentCount + summarizedChangeEvents.length + activeSupplementRecords.length} 项</small>
                    </header>
                    <details
                      className="handoff-history-group"
                      aria-label="本轮评论"
                    >
                      <summary className="handoff-history-heading">
                        <ChatCircleTextIcon aria-hidden="true" size={17} weight="duotone" />
                        <strong>源页原始评论</strong>
                        <span>{activeCommentCount}</span>
                      </summary>
                      {activeCommentItems.length > 0 ? activeCommentItems.map((comment) => (
                        <article className="handoff-history-item" key={comment.commentId}>
                          <div>
                            <strong>{insertionLabel(comment.target)}</strong>
                            <time dateTime={comment.createdAt}>{formatTime(comment.createdAt, true)}</time>
                          </div>
                          <p>{comment.text || "已添加参考附件"}</p>
                          <CommentAttachmentStrip
                            attachments={comment.attachments}
                            objectUrls={attachmentObjectUrls}
                            onEnsurePreview={ensureAttachmentObjectUrl}
                            onPreview={(attachment) => void openAttachmentPreview(attachment)}
                            onDownload={(attachment) => void downloadAttachment(attachment)}
                          />
                        </article>
                      )) : (
                        <span className="handoff-history-empty">本轮没有评论。</span>
                      )}
                    </details>
                    <details
                      className="handoff-history-group"
                      aria-label="本轮页面修改"
                    >
                      <summary className="handoff-history-heading">
                        <ClockCounterClockwiseIcon aria-hidden="true" size={17} weight="duotone" />
                        <strong>本地编辑</strong>
                        <span>{summarizedChangeEvents.length}</span>
                      </summary>
                      {summarizedChangeEvents.length > 0 ? summarizedChangeEvents.map((event) => (
                        <article className="handoff-history-item handoff-change-item" key={event.eventId}>
                          <div>
                            <strong>{changeKindLabel(event)} · {event.target.label || event.target.selector}</strong>
                            <time dateTime={event.createdAt}>{formatTime(event.createdAt, true)}</time>
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
                      )) : (
                        <span className="handoff-history-empty">本轮没有直接修改页面。</span>
                      )}
                    </details>
                    {activeSupplementRecords.length > 0 ? (
                      <details
                        className="handoff-history-group"
                        aria-label="内部 AI 对话补充"
                      >
                        <summary className="handoff-history-heading">
                          <ChatCircleTextIcon aria-hidden="true" size={17} weight="duotone" />
                          <strong>内部 AI 对话补充</strong>
                          <span>{activeSupplementRecords.length}</span>
                        </summary>
                        {activeSupplementRecords.map((supplement) => (
                          <article className="handoff-history-item" key={supplement.recordId}>
                            <div>
                              <strong>{supplement.action === "add" ? "新增要求" : supplement.action === "amend" ? "补充修改" : "撤回要求"}</strong>
                              <time dateTime={supplement.createdAt}>{formatTime(supplement.createdAt, true)}</time>
                            </div>
                            <p>{supplement.text}</p>
                            {supplement.attachments.length > 0 ? (
                              <small>{supplement.attachments.map((item) => item.fileName).join("、")}</small>
                            ) : supplement.evidenceState === "description-only" ? (
                              <small>原件未归档 · {supplement.evidenceDescription}</small>
                            ) : null}
                          </article>
                        ))}
                      </details>
                    ) : null}
                    <details
                      className="handoff-history-group"
                      aria-label="AI 结果与校验"
                    >
                      <summary className="handoff-history-heading">
                        <CheckCircleIcon aria-hidden="true" size={17} weight="duotone" />
                        <strong>AI 结果与校验</strong>
                        <span>{activeRun.status === "ready-to-open" || activeRun.status === "complete" ? "已通过" : "进行中"}</span>
                      </summary>
                      <article className="handoff-history-item">
                        <p>{activeRun.validationReview?.status === "waived"
                          ? "硬校验已通过；软校验已按用户决定记录并继续。"
                          : activeRun.status === "ready-to-open" || activeRun.status === "complete"
                            ? "身份、Hash、完整 HTML、冻结输入与版本完整性均已通过。"
                            : "校验结果会在这里持续更新。"}</p>
                      </article>
                    </details>
                  </section>
                </>
              ) : (
                <div className="drawer-empty">发送评论后，这里会显示处理进度和本轮记录。</div>
              )}
            </div>
          ) : null}
        </div>
      </aside>

      <div
        className={`toast${toast ? " show" : ""}`}
        data-tone={toast?.tone || "info"}
        role={toast?.tone === "error" ? "alert" : "status"}
        aria-live={toast?.tone === "error" ? "assertive" : "polite"}
        aria-atomic="true"
      >
        <span className="toast-accent" aria-hidden="true" />
        <div className="toast-copy">
          <small>{toastToneLabel}</small>
          <strong>{toast?.title}</strong>
          <span>{toast?.message}</span>
        </div>
        <div className="toast-actions">
          {toast?.action ? (
            <button
              className="toast-action"
              type="button"
              onClick={handleToastAction}
            >{toast.action.label}</button>
          ) : null}
          <button
            className="toast-close"
            type="button"
            aria-label="关闭提醒"
            onClick={() => setToast(null)}
          >关闭</button>
        </div>
      </div>
    </main>
  );
}
