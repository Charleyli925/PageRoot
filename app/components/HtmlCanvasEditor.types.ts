import type { PageViewContext } from "../lib/page-view-context.js";
import type { RuntimeVisualProjection } from "../domain/runtime-visual-projection.js";
import type {
  NativeEditCheckpointTrigger,
  NativeEditSelection,
} from "./native-edit-types";
import type { NoticeUsageCapture } from "./NoticeBar";

export type HtmlCanvasSelectionLevel = "module" | "part" | "insertion";
export type HtmlCanvasTargetResolution =
  | "exact"
  | "rebound"
  | "ambiguous"
  | "orphaned";

export type HtmlCanvasFingerprint = {
  tagName: string;
  stableAttributes: Record<string, string>;
  ancestorFingerprint: string[];
  textPrefix?: string;
  textSuffix?: string;
};

export type HtmlCanvasSelection = {
  id: string;
  /** Ephemeral preview identity. It is never written to the user's source HTML. */
  nodeId?: string;
  label: string;
  selector: string;
  level: HtmlCanvasSelectionLevel;
  tagName: string;
  text: string;
  resolution: HtmlCanvasTargetResolution;
  textQuote?: string;
  sourceAnchor?: {
    startOffset: number;
    endOffset: number;
    sourceSha256: string;
  };
  fingerprint?: HtmlCanvasFingerprint;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

export type HtmlCanvasMutation = {
  kind: "text" | "style" | "reorder" | "structure";
  target: HtmlCanvasSelection;
  property?: string;
  before: unknown;
  after: unknown;
  /** Ephemeral post-patch refs for host state; never persisted as audit payload. */
  targetUpdates?: HtmlCanvasSelection[];
  /** Every input targetId covered by the deterministic patch refresh. */
  trackedTargetIds?: string[];
};

export type HtmlCanvasSourceTransaction = {
  kind: HtmlCanvasMutation["kind"];
  property?: string;
  beforeSourceSha256: string;
  afterSourceSha256: string;
  forwardPatches: Array<{
    startOffset: number;
    endOffset: number;
    before: string;
    after: string;
    kind: string;
  }>;
  reversePatches: Array<{
    startOffset: number;
    endOffset: number;
    before: string;
    after: string;
    kind: string;
  }>;
  beforeTarget: HtmlCanvasSelection;
  afterTarget: HtmlCanvasSelection;
  beforeSelection?: NativeEditSelection;
  afterSelection?: NativeEditSelection;
};

export type HtmlCanvasInteractionMode = "editing" | "processing" | "history";

export type HtmlCanvasFreezeSnapshot = {
  ok: boolean;
  html: string;
  sourceSha256: string;
  pendingMutation: HtmlCanvasMutation | null;
  reason?: string;
};

export type HtmlCanvasCommitResult = {
  ok: boolean;
  html: string;
  sourceSha256: string;
  pendingMutation: HtmlCanvasMutation | null;
  reason?: string;
};

export type NativeDeferredCommandAuthority = "user-explicit" | "system";

export type NativeDeferredCommandDiscardReason =
  | "superseded"
  | "blocked-by-user-command"
  | "stale-session"
  | "session-ended"
  | "unmounted";

export type NativeDeferredCommandOptions = {
  /** System work may wait for IME settling, but can never authorize fallback text. */
  authority?: NativeDeferredCommandAuthority;
  /** Always called if a queued callback will never execute. */
  onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
};

export type HtmlCanvasCommentedTarget = {
  target: HtmlCanvasSelection;
  /**
   * Every persisted comment keeps an independent target id even when several
   * comments share one canvas marker. Layout reporting must retain those ids so
   * the rail can position and group each card independently.
   */
  layoutTargets?: readonly HtmlCanvasSelection[];
  count?: number;
  label?: string;
  /** Report target layout without rendering a saved-comment marker. */
  showMarker?: boolean;
};

export type HtmlCanvasCommentLayoutState = {
  sourceSha256: string;
  viewContextGeneration: number;
  ready: boolean;
  textEditing: boolean;
  targetIds: string[];
  scrollTop: number;
  contentHeight: number;
  clientHeight: number;
  targets: Array<{
    targetId: string;
    status: "visible" | "hidden" | "missing";
    resolution: HtmlCanvasTargetResolution;
    top?: number;
    height?: number;
    tabGroupKey?: string;
    tabGroupLabel?: string;
  }>;
};

export type HtmlCanvasEditorHandle = {
  /** Returns the exact source string held by the single SourcePatchEngine. */
  getSourceHtml: () => string;
  /** Exact source string whose sanitized representation has finished loading in the iframe. */
  getRenderedSourceHtml: () => string | null;
  /** Commits delivered native input while keeping the live editing session active. */
  checkpointPendingEdit: () => HtmlCanvasCommitResult;
  /** Retires the editable DOM, reloads canonical source, and optionally resumes editing. */
  fencePendingEdit: (options?: {
    resumeEditing?: boolean;
    /** Keeps the active target/caret bookmark for the pending history result. */
    preserveForHistory?: boolean;
    trigger?: NativeEditCheckpointTrigger;
  }) => HtmlCanvasCommitResult;
  commitPendingEdit: () => HtmlCanvasCommitResult;
  /** Captures pending text and synchronously blocks every mutation entrypoint. */
  freezeNow: () => HtmlCanvasFreezeSnapshot;
  /** Releases an imperative freeze when the controlled mode is editing. */
  unlockNow: () => boolean;
  /** Keeps a failed commit explanation beside the canvas instead of escalating it globally. */
  showCommitBlocked: (reason?: string) => void;
  /** True while source-uncommitted native text or marked text still exists. */
  hasPendingNativeEdit: () => boolean;
  clearSelection: () => void;
  select: (
    target: HtmlCanvasSelection,
    options?: { reveal?: boolean; showToolbar?: boolean },
  ) => HtmlCanvasSelection | null;
  startEditing: () => boolean;
  moveSelected: (direction: "up" | "down") => boolean;
  /** Adopts one Bridge-validated history result without serializing preview DOM. */
  adoptHistorySource: (
    source: string,
    target: HtmlCanvasSelection | null,
    selection?: NativeEditSelection | null,
  ) => boolean;
  /** Restores the pre-action target/caret when a history request fails or becomes ineligible. */
  cancelHistoryAction: (options?: { restore?: boolean }) => boolean;
  /** Defers one explicit user command until the current native composition is stable/cancelled. */
  deferNativeCommand: (
    kind: string,
    run: () => void,
    payload?: unknown,
    options?: NativeDeferredCommandOptions,
  ) => boolean;
  /** Applies disposable source-backed presentation state without changing source bytes. */
  applyPageViewContext: (context: PageViewContext | null) => boolean;
};

export type HtmlCanvasEditorProps = {
  /** A complete document or an HTML fragment. Fragments are normalized to a complete document. */
  html: string;
  /** Called with the exact next source produced by SourcePatchEngine. */
  onChange: (
    nextSourceHtml: string,
    mutation?: HtmlCanvasMutation,
    transaction?: HtmlCanvasSourceTransaction,
  ) => boolean;
  /** Called when an element is selected or the selection is cleared. */
  onSelect?: (selection: HtmlCanvasSelection | null) => void;
  /** Notifies the host about any pointer interaction inside the isolated iframe. */
  onInteraction?: () => void;
  /** Mirrors the authored page scroll coordinate into the host comment rail. */
  onCommentLayout?: (state: HtmlCanvasCommentLayoutState) => void;
  /** Opens the host product's comment composer for the current selection. */
  onRequestComment?: (selection: HtmlCanvasSelection) => void;
  /** Callback alternative to using a ref. Receives null when the editor unmounts. */
  onReady?: (api: HtmlCanvasEditorHandle | null) => void;
  /** Handles Cmd/Ctrl+S inside the iframe without exposing the browser's native Save dialog. */
  onRequestFlush?: () => void;
  /** Handles Shift+Cmd/Ctrl+E inside the iframe using the host product's source-safe export path. */
  onRequestExport?: () => void;
  /** Routes canvas-owned undo/redo shortcuts to the persistent source history owner. */
  onRequestHistory?: (direction: "undo" | "redo") => void;
  /** Reloads the current source after the editor cannot build a safe source map. */
  onRequestReload?: () => void;
  /** Labels the source-map recovery action when the host must ask for the file again. */
  reloadActionLabel?: string;
  /** Reports a fail-closed edit whose source target could not be patched safely. */
  onEditBlocked?: (message: string) => void;
  /** Project identity is used only by the main process to derive a local pseudonymous key. */
  usageProjectId?: string;
  usageCapture?: NoticeUsageCapture;
  /** Optional base URL for relative assets. The injected base element is not included in serialized output. */
  baseHref?: string;
  /** Absolute path or file URL of the source HTML. Used to derive baseHref when baseHref is absent. */
  sourcePath?: string;
  className?: string;
  iframeTitle?: string;
  height?: number | string;
  /** Soft read-only mode: blocks direct HTML mutations while selection and comments remain available. */
  readOnly?: boolean;
  /** Explicit interaction state. Processing and history are both strongly read-only. */
  interactionMode?: HtmlCanvasInteractionMode;
  /** Strong round lock: the canvas becomes browse-only and hides every selection-based action. */
  locked?: boolean;
  /** Reordering is limited to safe element siblings and can be disabled by the host. */
  enableReorder?: boolean;
  /** CSS selectors that already have comments and should receive a compact canvas marker. */
  commentedTargets?: readonly HtmlCanvasCommentedTarget[];
  /** Non-visual audit targets that must retain identity through later source patches. */
  trackedTargets?: readonly HtmlCanvasSelection[];
  /** Disposable source-backed presentation state for the current document. */
  pageViewContext?: PageViewContext | null;
  /** Read-only runtime bitmap projection; never enters source or edit history. */
  runtimeVisualProjection?: RuntimeVisualProjection | null;
  /** Reports the inert edit frame viewport used to request a matching projection. */
  onRuntimeVisualViewport?: (viewport: {
    width: number;
    height: number;
  }) => void;
  /** Stable host-owned identity for disposable presentation state. */
  pageViewDocumentKey?: string;
  /** Accepts source-backed presentation state without treating it as an HTML edit. */
  onPageViewContextChange?: (
    context: PageViewContext | null,
    documentKey: string,
  ) => boolean;
};
