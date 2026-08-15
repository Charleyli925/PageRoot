"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { flushSync } from "react-dom";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_RUNTIME_FROZEN_ATTRIBUTE,
  EDIT_RUNTIME_HOST_ATTRIBUTE,
  EDIT_RUNTIME_RESULT_ATTRIBUTE,
  isEditRuntimeFrameToken,
  type EditRuntimeGrant,
} from "../domain/edit-runtime-contract.js";
import {
  createPagePresentationAction,
  type PagePresentationAction,
  type PageViewContext,
} from "../lib/page-view-context.js";
import {
  SOURCE_NODE_ATTRIBUTE,
  applyPatchPlan,
  buildSourceIndex,
  createInsertionPointTargetRef,
  createTargetRef,
  instrumentPreviewHtml,
  planSourcePatch,
  resolveTargetRef,
} from "../lib/source-patch-core.js";
import {
  editableIslandForTarget,
  isEditableIslandTarget,
  normalizeEditableTextFragmentHtml,
} from "../lib/editable-island.js";
import {
  sourceTargetRefForSelection,
} from "../lib/canvas-target-rebind.js";
import {
  buildSourceTextFragmentMap,
  buildSourceTextMap,
  sourceSegmentsToTextRange,
  textRangeToSourceSegments,
  type SourceTextMap,
} from "../lib/source-text-map.js";
import {
  NATIVE_EDIT_CHECKPOINT_DELAY_MS,
  IslandEditingController,
  nativeLogicalText,
  type NativeEditBaseline,
  type NativeEditCheckpointTrigger,
  type NativeEditSelection,
  type NativeEditSessionState,
} from "./IslandEditingController";
import {
  nativeLayoutFingerprint,
  sameNativeLayout,
  sameNativeTextStyle,
} from "./native-edit-runtime-preflight";
import { selectorForElement } from "./html-canvas-dom";
import {
  STYLE_PROPERTY_CONFIGS,
  TEXT_RANGE_EDITABLE_PROPERTIES,
  styleSourcesForElement,
  toHexColor,
  type EditableStyleProperty,
  type SelectedStyle,
} from "./html-canvas-style-inspector";
import {
  defaultGlobalCommentElement,
  deterministicOperationTargetUpdate,
  deterministicTargetUpdates,
  inferSelectionLevel,
  isModulePaddingHit,
  isPageRootElement,
  isPageRootSelection,
  readableLabel,
  selectionForElement,
  selectionFromRefreshedTarget,
  sourceMoveAvailability,
  trackedSourceTargetRefs,
  uniqueSelections,
  type MoveAvailability,
} from "./html-canvas-selection";
import type {
  ActiveTextRange,
  SourceElementValue,
  SourceIndexValue,
  SourceTargetRef,
} from "./html-canvas-internal-types";
import {
  activateContainingTab,
  applyPageViewContextToDocument,
  commentLayoutTargets,
  isRenderedCommentTarget,
  naturalDocumentContentHeight,
  sortedCommentLayoutTargetIds,
  tabAssociationForElement,
  tabAssociations,
} from "./html-canvas-page-view";
import {
  adoptCanonicalHistoryIslandInPlace,
  canonicalNativeHostPreview,
  mountNativeTextFragmentHost,
  nativeEditHostForElement,
  nativeTextFragmentForRange,
  refreshMountedPreviewSourceNodeIds,
  sourceTextNodeForDomText,
  sourceBackedPreviewElements,
  sourceTextParentsForSegments,
} from "./html-canvas-preview-sync";
import {
  activeTextRangeFromDocument,
  boundedHistorySelection,
  caretPointFromMouseEvent,
  findCanvasSelectionElement,
  findNativeActionTarget,
  historySelectionFromMutationValue,
  isCanvasRootElement,
  nativeTextRangeMatchesActivation,
  selectWordAtPoint,
  sourceHistoryDirectionForShortcut,
  type TextCaretPoint,
} from "./html-canvas-interaction";
import NoticeBar from "./NoticeBar";
import type {
  HtmlCanvasCommentedTarget,
  HtmlCanvasCommitResult,
  HtmlCanvasEditRuntimeLoadOutcome,
  HtmlCanvasEditorHandle,
  HtmlCanvasEditorProps,
  HtmlCanvasFreezeSnapshot,
  HtmlCanvasInteractionMode,
  HtmlCanvasMutation,
  HtmlCanvasSelection,
  HtmlCanvasSelectionLevel,
  HtmlCanvasSourceTransaction,
  HtmlCanvasTargetResolution,
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
  NativeDeferredCommandOptions,
} from "./HtmlCanvasEditor.types";
export type {
  HtmlCanvasCommentedTarget,
  HtmlCanvasCommentLayoutState,
  HtmlCanvasCommitResult,
  HtmlCanvasEditRuntimeLoadOutcome,
  HtmlCanvasEditorHandle,
  HtmlCanvasEditorProps,
  HtmlCanvasFingerprint,
  HtmlCanvasFreezeSnapshot,
  HtmlCanvasInteractionMode,
  HtmlCanvasMutation,
  HtmlCanvasSelection,
  HtmlCanvasSourceTransaction,
  HtmlCanvasTargetResolution,
  NativeDeferredCommandAuthority,
  NativeDeferredCommandDiscardReason,
  NativeDeferredCommandOptions,
} from "./HtmlCanvasEditor.types";
import {
  EDITOR_STYLE_ATTRIBUTE,
  FRAME_VERIFICATION_ATTRIBUTE,
  baseHrefFromSourcePath,
  disableExecutableMarkup,
  prepareCanvasFrameDocument,
  prepareVerifiedFrameDocument,
} from "./html-preview-sandbox.js";
import styles from "./HtmlCanvasEditor.module.css";

const GLOBAL_SELECTION_ATTRIBUTE = "data-html-canvas-global-selected";

const TEXT_FRAGMENT_STYLE_PROPERTIES = [
  "color",
  "direction",
  "font",
  "letterSpacing",
  "lineHeight",
  "overflowWrap",
  "textShadow",
  "textTransform",
  "whiteSpace",
  "wordBreak",
  "wordSpacing",
  "writingMode",
] as const;

function nativeTextFragmentStyleSignature(element: HTMLElement): string {
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (!style) return "";
  return TEXT_FRAGMENT_STYLE_PROPERTIES.map(
    (property) => `${property}:${style[property]}`,
  ).join(";");
}

function hasNativeTextFragmentPseudoContent(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  return (["::before", "::after"] as const).some((pseudo) => {
    const content = view.getComputedStyle(element, pseudo).content;
    return Boolean(
      content
      && content !== "none"
      && content !== "normal"
      && content !== "\"\""
    );
  });
}

function sourceTextNodeForFragmentReplacement(
  sourceIndex: SourceIndexValue,
  startOffset: number,
  rawValue: string,
) {
  if (!rawValue) return null;
  return [...sourceIndex.byNodeId.values()].find((node) => (
    node?.type === "text"
    && node.range.startOffset === startOffset
    && node.range.endOffset === startOffset + rawValue.length
  )) ?? null;
}

function activeRangeForTextFragmentTarget(
  parentElement: HTMLElement,
  sourceIndex: SourceIndexValue,
  target: HtmlCanvasSelection,
  textTargetRef: SourceTargetRef,
): ActiveTextRange | null {
  try {
    const resolution = resolveTargetRef(sourceIndex, textTargetRef);
    const sourceText = resolution.target;
    if (
      (
        resolution.resolution === "ambiguous"
        || resolution.resolution === "orphaned"
      )
      || sourceText?.type !== "text"
      || sourceText.parentId !== target.nodeId
    ) return null;
    const textNode = Array.from(parentElement.childNodes).find((node): node is Text => (
      node.nodeType === 3
      && sourceTextNodeForDomText(node as Text, sourceIndex)?.nodeId === sourceText.nodeId
    )) ?? null;
    if (!textNode || sourceText.value.length === 0) return null;
    return {
      target,
      segments: [{
        textNodeId: sourceText.nodeId,
        startOffset: 0,
        endOffset: sourceText.value.length,
      }],
      text: sourceText.value,
      styleElements: [parentElement],
      direction: "forward",
    };
  } catch {
    return null;
  }
}

const EDITOR_DOCUMENT_STYLES = `
  /*
   * The shared review stage owns page scrolling. A root-frame scrollbar changes
   * the authored viewport width and can feed a ResizeObserver back into Canvas
   * height; nested authored overflow containers remain untouched.
   */
  html:root,
  html:root > body {
    overflow-y: hidden !important;
  }

  ::selection {
    color: inherit !important;
    background: rgba(91, 75, 223, 0.2) !important;
  }

  [data-html-canvas-selected="part"] {
    outline: 3px solid #5b4bdf !important;
    outline-offset: 3px !important;
  }

  [data-html-canvas-selected="module"]:not([data-html-canvas-global-selected]) {
    outline: 3px solid #5b4bdf !important;
    outline-offset: 3px !important;
  }

  [data-html-canvas-global-selected] {
    min-height: 100vh !important;
    outline: 3px solid #5b4bdf !important;
    outline-offset: -3px !important;
  }

  [data-html-canvas-editing] {
    cursor: text !important;
    box-shadow: 0 0 0 5px rgba(91, 75, 223, 0.14) !important;
  }

  [data-html-canvas-native-editing] {
    -webkit-user-select: text !important;
    user-select: text !important;
    caret-color: currentColor !important;
  }

  html[data-html-canvas-locked] [contenteditable] {
    cursor: default !important;
    caret-color: transparent !important;
  }

  noscript {
    display: none !important;
  }

  html:not([data-html-canvas-locked]) iframe,
  html:not([data-html-canvas-locked]) audio,
  html:not([data-html-canvas-locked]) video,
  html:not([data-html-canvas-locked]) canvas,
  html:not([data-html-canvas-locked]) object,
  html:not([data-html-canvas-locked]) embed {
    pointer-events: none !important;
  }

  html:not([data-html-canvas-locked]) body,
  html:not([data-html-canvas-locked]) body * {
    -webkit-user-select: text !important;
    user-select: text !important;
  }

  [data-pageroot-edit-runtime-host] {
    cursor: default !important;
  }

  [data-pageroot-edit-runtime-host] * {
    pointer-events: none !important;
    -webkit-user-select: none !important;
    user-select: none !important;
  }

`;

const EMPTY_COMMENTED_TARGETS: readonly HtmlCanvasCommentedTarget[] = [];
const EMPTY_TRACKED_TARGETS: readonly HtmlCanvasSelection[] = [];

type OverlayPosition = {
  toolbarLeft: number;
  toolbarTop: number;
};

type InsertionPoint = {
  selection: HtmlCanvasSelection;
  anchorElement: HTMLElement;
  kind: "page-start" | "boundary";
  left: number;
  top: number;
  width: number;
};

type CommentMarker = {
  key: string;
  selection: HtmlCanvasSelection;
  count?: number;
  label?: string;
  placement?: "target-corner" | "tab-side";
  left: number;
  top: number;
};

type ActiveNativeEdit = {
  mode: "editable-island" | "text-fragment";
  rootElement: HTMLElement;
  selectionElement: HTMLElement;
  target: HtmlCanvasSelection;
  projection: SourceTextMap;
  rootTargetRef: SourceTargetRef;
  sourceInnerHtml: string;
  fragmentTargetRef: SourceTargetRef | null;
  releaseHost: (() => void) | null;
  session: IslandEditingController;
  selection: NativeEditSelection;
  lease: {
    sessionId: string;
    domGeneration: number;
    sourceRevision: string;
    hostId: string;
  };
};

type PendingNativeCommandCallback = {
  sequence: number;
  kind: string;
  authority: NativeDeferredCommandAuthority;
  session: IslandEditingController;
  lease: ActiveNativeEdit["lease"];
  run: () => void;
  onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
};

type RetainedNativeEditFocus = {
  session: IslandEditingController;
  lease: ActiveNativeEdit["lease"];
};

type NativeEditFenceBookmark = {
  fenceId: number;
  target: HtmlCanvasSelection;
  selection: NativeEditSelection;
  focus: boolean;
  toolbarVisible: boolean;
  fragmentTargetRef?: SourceTargetRef;
};

type PendingNativeEditResume = NativeEditFenceBookmark & {
  expectedFrameGeneration: number;
  sourceRevision: string;
};

type NativeFormatShortcut = "bold" | "italic" | "underline";

function nativeEditLeasesMatch(
  left: ActiveNativeEdit["lease"] | null,
  right: ActiveNativeEdit["lease"],
): boolean {
  return Boolean(
    left
    && left.sessionId === right.sessionId
    && left.domGeneration === right.domGeneration
    && left.sourceRevision === right.sourceRevision
    && left.hostId === right.hostId
  );
}

type NativeEditCommitResult = {
  ok: boolean;
  mutation: HtmlCanvasMutation | null;
  reason?: string;
  frameReloading?: boolean;
};

type FinishNativeEditingOptions = {
  replayQueuedUserCommand?: boolean;
};

type EditFeedback = {
  code: string;
  title: string;
  message: string;
  tone: "warning" | "error";
  sticky: boolean;
  recovery: "comment" | "reload" | "none";
};

type SourcePatchCommand = Parameters<typeof planSourcePatch>[0];
type SourcePatchPlan = NonNullable<ReturnType<typeof planSourcePatch>>;

type RuntimeFrameContext = {
  verificationToken: string;
  grant: EditRuntimeGrant;
  elementGeneration: number;
  settled: boolean;
};

function sameRuntimeGrant(
  left: EditRuntimeGrant | null | undefined,
  right: EditRuntimeGrant | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.sessionId === right.sessionId
    && left.executionId === right.executionId
    && left.sourceSha256 === right.sourceSha256
    && left.canvasGeneration === right.canvasGeneration,
  );
}

function isRuntimeFrameFrozenResult(
  value: unknown,
  frame: RuntimeFrameContext,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (
    result.state !== "frozen"
    || result.reason !== null
    || result.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
    || result.executionId !== frame.grant.executionId
    || result.sessionId !== frame.grant.sessionId
    || !Array.isArray(result.hostKeys)
    || result.hostKeys.length !== frame.grant.hosts.length
  ) return false;
  const expected = new Set(frame.grant.hosts.map((host) => host.key));
  const received = new Set<string>();
  for (const key of result.hostKeys) {
    if (typeof key !== "string" || !expected.has(key) || received.has(key)) return false;
    received.add(key);
  }
  return received.size === expected.size;
}

function hostHasAuthorPaint(element: Element | null): boolean {
  if (!element || element.nodeType !== 1) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "canvas" || tag === "svg") return true;
  return Boolean(element.querySelector("canvas, svg"));
}

function runtimeFrameKeepsAuthorPaint(
  documentNode: Document,
  frame: RuntimeFrameContext,
): boolean {
  if (
    documentNode.querySelectorAll("img[data-pageroot-edit-runtime-snapshot]").length > 0
    || documentNode.querySelectorAll('img[src^="data:image/png"]').length > 0
  ) {
    return false;
  }
  // Host discovery includes every source-empty unique binding, not only
  // charts. Unused empty hosts must not discard a frozen author canvas.
  return frame.grant.hosts.some((host) => {
    const element = documentNode.querySelector(
      `[${EDIT_RUNTIME_HOST_ATTRIBUTE}="${host.key}"]`,
    );
    return hostHasAuthorPaint(element);
  });
}

const HtmlCanvasEditor = forwardRef<HtmlCanvasEditorHandle, HtmlCanvasEditorProps>(function HtmlCanvasEditor(
  {
    html,
    onChange,
    onSelect,
    onInteraction,
    editRuntimeGrant = null,
    onEditRuntimeLoadStart,
    onEditRuntimeLoadOutcome,
    onCommentLayout,
    onRequestComment,
    onReady,
    onRequestFlush,
    onRequestExport,
    onRequestHistory,
    onRequestReload,
    reloadActionLabel = "重新载入",
    onEditBlocked,
    usageProjectId,
    usageCapture,
    baseHref,
    sourcePath,
    className,
    iframeTitle = "HTML 可视化编辑画布",
    height = 720,
    readOnly = false,
    interactionMode = "editing",
    locked = false,
    enableReorder = true,
    commentedTargets = EMPTY_COMMENTED_TARGETS,
    trackedTargets = EMPTY_TRACKED_TARGETS,
    pageViewContext = null,
    pageViewDocumentKey = "",
    onPageViewContextChange,
  },
  forwardedRef,
) {
  const resolvedBaseHref = baseHref || baseHrefFromSourcePath(sourcePath);
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const spacingMenuRef = useRef<HTMLDetailsElement>(null);
  const selectedElementRef = useRef<HTMLElement | null>(null);
  const selectedSourceSelectionRef = useRef<HtmlCanvasSelection | null>(null);
  const activeTextRangeRef = useRef<ActiveTextRange | null>(null);
  const activeNativeEditRef = useRef<ActiveNativeEdit | null>(null);
  const pendingNativeCommandCallbackRef = useRef<PendingNativeCommandCallback | null>(null);
  const scheduledNativeCommandCallbackRef = useRef<PendingNativeCommandCallback | null>(null);
  const deferNativeCommandRef = useRef<(
    kind: string,
    run: () => void,
    payload?: unknown,
    options?: NativeDeferredCommandOptions,
  ) => boolean>(() => false);
  const drainPendingNativeCommandRef = useRef<(
    session: IslandEditingController,
  ) => void>(() => undefined);
  const nativeEditCheckpointTimerRef = useRef<number | null>(null);
  const nativeEditCheckpointRef = useRef<() => void>(() => undefined);
  const finishNativeEditingRef = useRef<(
    shouldApply: boolean,
    trigger?: NativeEditCheckpointTrigger,
    options?: FinishNativeEditingOptions,
  ) => NativeEditCommitResult>(() => ({
    ok: false,
    mutation: null,
    reason: "文字编辑会话尚未准备完成。",
  }));
  const nativeEditSessionSequenceRef = useRef(0);
  const nativeDomGenerationRef = useRef(0);
  const nativeSessionNeedsCanonicalFenceRef = useRef(false);
  const nativeEditFenceSequenceRef = useRef(0);
  const currentNativeEditLeaseRef = useRef<ActiveNativeEdit["lease"] | null>(null);
  const pendingNativeEditResumeRef = useRef<PendingNativeEditResume | null>(null);
  const pendingHistoryBookmarkRef = useRef<NativeEditFenceBookmark | null>(null);
  const pendingHistoryCanonicalFenceRef = useRef(false);
  const fencedDocumentCleanupRef = useRef<() => void>(() => undefined);
  const installFencedDocumentGuardRef = useRef<(documentNode: Document) => void>(
    () => undefined,
  );
  const queueNativeFenceReloadRef = useRef<(
    source: string,
    bookmark: NativeEditFenceBookmark | null,
    target: HtmlCanvasSelection | null,
    selection?: NativeEditSelection,
  ) => void>(() => undefined);
  const applyNativeFormatShortcutRef = useRef<(
    shortcut: NativeFormatShortcut,
  ) => boolean>(() => false);
  const restartCanonicalNativeEditRef = useRef<(
    active: ActiveNativeEdit,
    target: HtmlCanvasSelection,
    selection: NativeEditSelection,
    previousIndex: SourceIndexValue,
    nextIndex: SourceIndexValue,
  ) => boolean>(() => false);
  const nativeEditFinishingRef = useRef(false);
  const nativeEditNeedsReloadRef = useRef(false);
  const retainNativeEditFocusRef = useRef<RetainedNativeEditFocus | null>(null);
  const blockedOuterCompositionGestureRef = useRef(false);
  const insertionPointsRef = useRef<InsertionPoint[]>([]);
  const cleanupFrameRef = useRef<() => void>(() => undefined);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const frameInitializedRef = useRef(false);
  const lastEmittedHtmlRef = useRef<string | null>(null);
  const pendingHtmlEchoesRef = useRef<string[]>([]);
  const renderedSourceHtmlRef = useRef<string | null>(null);
  const frameSourceHtmlRef = useRef(html);
  const sourceIndexRef = useRef<SourceIndexValue | null>(null);
  const pendingSelectionRef = useRef<HtmlCanvasSelection | null>(null);
  const pendingToolbarVisibleRef = useRef(false);
  const pendingFrameRestoreEpochRef = useRef(0);
  const toolbarVisibleRef = useRef(false);
  const pendingFrameViewportRef = useRef<{ left: number; top: number } | null>(null);
  const expectedFrameHtmlRef = useRef<string | null>(null);
  const expectedFrameTokenRef = useRef<string | null>(null);
  const frameLoadGenerationRef = useRef(0);
  const runtimeFrameRef = useRef<RuntimeFrameContext | null>(null);
  const runtimeAttemptedRef = useRef(false);
  const imperativeLockRef = useRef(false);
  const lastPropRef = useRef({ html, baseHref: resolvedBaseHref });
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  const onInteractionRef = useRef(onInteraction);
  const onEditRuntimeLoadStartRef = useRef(onEditRuntimeLoadStart);
  const onEditRuntimeLoadOutcomeRef = useRef(onEditRuntimeLoadOutcome);
  const onCommentLayoutRef = useRef(onCommentLayout);
  const onRequestCommentRef = useRef(onRequestComment);
  const onRequestFlushRef = useRef(onRequestFlush);
  const onRequestExportRef = useRef(onRequestExport);
  const onRequestHistoryRef = useRef(onRequestHistory);
  const onEditBlockedRef = useRef(onEditBlocked);
  const readOnlyRef = useRef(readOnly);
  const lockedRef = useRef(locked);
  const enableReorderRef = useRef(enableReorder);
  const commentedTargetsRef = useRef(commentedTargets);
  const trackedTargetsRef = useRef(trackedTargets);
  const pageViewContextRef = useRef<PageViewContext | null>(pageViewContext);
  const lastPageViewContextPropRef = useRef<PageViewContext | null>(pageViewContext);
  const appliedPageViewContextRef = useRef<PageViewContext | null>(null);
  const pageViewDocumentKeyRef = useRef(pageViewDocumentKey);
  const onPageViewContextChangeRef = useRef(onPageViewContextChange);
  const controlledMode = locked ? "processing" : interactionMode;
  const controlledInteractionLocked = controlledMode !== "editing";
  const [imperativeLocked, setImperativeLocked] = useState(false);
  const interactionLocked = controlledInteractionLocked || imperativeLocked;
  const renderedMode: HtmlCanvasInteractionMode =
    controlledMode === "history"
      ? "history"
      : interactionLocked
        ? "processing"
        : "editing";

  onChangeRef.current = onChange;
  onSelectRef.current = onSelect;
  onInteractionRef.current = onInteraction;
  onEditRuntimeLoadStartRef.current = onEditRuntimeLoadStart;
  onEditRuntimeLoadOutcomeRef.current = onEditRuntimeLoadOutcome;
  onCommentLayoutRef.current = onCommentLayout;
  onRequestCommentRef.current = onRequestComment;
  onRequestFlushRef.current = onRequestFlush;
  onRequestExportRef.current = onRequestExport;
  onRequestHistoryRef.current = onRequestHistory;
  onEditBlockedRef.current = onEditBlocked;
  readOnlyRef.current = readOnly || controlledInteractionLocked || imperativeLockRef.current;
  lockedRef.current = controlledInteractionLocked || imperativeLockRef.current;
  enableReorderRef.current = enableReorder && !lockedRef.current;
  commentedTargetsRef.current = commentedTargets;
  trackedTargetsRef.current = trackedTargets;
  if (lastPageViewContextPropRef.current !== pageViewContext) {
    lastPageViewContextPropRef.current = pageViewContext;
    pageViewContextRef.current = pageViewContext;
  }
  pageViewDocumentKeyRef.current = pageViewDocumentKey;
  onPageViewContextChangeRef.current = onPageViewContextChange;

  // Keep the server and hydration value deterministic, then normalize through DOMParser after mount.
  const [frameRender, setFrameRender] = useState(() => ({
    html: disableExecutableMarkup(html),
    elementGeneration: 0,
    runtime: false,
  }));
  const [selection, setSelection] = useState<HtmlCanvasSelection | null>(null);
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition | null>(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [hasTextRange, setHasTextRange] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<SelectedStyle>({
    fontSize: 16,
    color: "#202124",
    backgroundColor: "#ffffff",
    padding: 0,
    margin: 0,
    lineHeight: 24,
    isBold: false,
    isItalic: false,
    isUnderline: false,
    sources: [],
  });
  const [moveAvailability, setMoveAvailability] = useState<MoveAvailability>({ up: false, down: false });
  const [isEditing, setIsEditing] = useState(false);
  const [, setInsertionPoints] = useState<InsertionPoint[]>([]);
  const [commentMarkers, setCommentMarkers] = useState<CommentMarker[]>([]);
  const [, setSelectedInsertionId] = useState<string | null>(null);
  const [editFeedback, setEditFeedback] = useState<EditFeedback | null>(null);
  const [editFeedbackPaused, setEditFeedbackPaused] = useState(false);
  const [spacingMenuOpen, setSpacingMenuOpen] = useState(false);

  toolbarVisibleRef.current = toolbarVisible;

  useEffect(() => {
    const documentNode = containerRef.current?.ownerDocument;
    if (!documentNode) return undefined;
    const closeOutsideSpacingMenu = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node) || spacingMenuRef.current?.contains(target)) return;
      setSpacingMenuOpen(false);
    };
    documentNode.addEventListener("pointerdown", closeOutsideSpacingMenu, true);
    return () => {
      documentNode.removeEventListener("pointerdown", closeOutsideSpacingMenu, true);
    };
  }, []);

  useEffect(() => {
    const documentNode = containerRef.current?.ownerDocument;
    if (!documentNode) return undefined;
    const preserveCompositionFocus = (event: Event) => {
      const activeNativeEdit = activeNativeEditRef.current;
      if (!activeNativeEdit?.session.isComposing()) return;
      blockedOuterCompositionGestureRef.current = true;
      // Prevent only the focus-moving pointer default. The click must still
      // reach its real save/export/style handler so that handler can
      // enqueue one explicit latest-wins command.
      event.preventDefault();
    };
    const releaseGestureToken = () => {
      blockedOuterCompositionGestureRef.current = false;
    };

    documentNode.addEventListener("pointerdown", preserveCompositionFocus, true);
    documentNode.addEventListener("mousedown", preserveCompositionFocus, true);
    documentNode.addEventListener("click", releaseGestureToken, true);
    documentNode.addEventListener("pointercancel", releaseGestureToken, true);
    return () => {
      blockedOuterCompositionGestureRef.current = false;
      documentNode.removeEventListener("pointerdown", preserveCompositionFocus, true);
      documentNode.removeEventListener("mousedown", preserveCompositionFocus, true);
      documentNode.removeEventListener("click", releaseGestureToken, true);
      documentNode.removeEventListener("pointercancel", releaseGestureToken, true);
    };
  }, []);

  useEffect(() => {
    setEditFeedbackPaused(false);
  }, [editFeedback?.title, editFeedback?.message]);

  useEffect(() => {
    if (!editFeedback || editFeedback.sticky || editFeedbackPaused) return undefined;
    const timer = window.setTimeout(() => {
      setEditFeedback((current) => current === editFeedback ? null : current);
    }, 5_000);
    return () => window.clearTimeout(timer);
  }, [editFeedback, editFeedbackPaused]);

  const loadFrameSource = useCallback((
    source: string,
    options: {
      preserveViewport?: boolean;
      immediate?: boolean;
      forceStatic?: boolean;
    } = {},
  ) => {
    const frameView = iframeRef.current?.contentWindow;
    pendingFrameViewportRef.current = options.preserveViewport && frameView
      ? { left: frameView.scrollX, top: frameView.scrollY }
      : null;
    // Retire the old document's canvas handlers before advancing any source,
    // token, or generation authority. A non-immediate React remount may not
    // commit until the current task ends; without this cut the old DOM could
    // briefly dispatch against the next source map (or keep listeners forever
    // if the replacement document never reaches load).
    cleanupFrameRef.current();
    const retiringRuntimeFrame = runtimeFrameRef.current;
    runtimeFrameRef.current = null;
    if (retiringRuntimeFrame && !retiringRuntimeFrame.settled) {
      onEditRuntimeLoadOutcomeRef.current?.(retiringRuntimeFrame.grant, "failed");
    }
    pendingFrameRestoreEpochRef.current += 1;
    frameLoadGenerationRef.current += 1;
    const nextFrameGeneration = frameLoadGenerationRef.current;
    nativeDomGenerationRef.current += 1;
    nativeSessionNeedsCanonicalFenceRef.current = false;
    nativeEditNeedsReloadRef.current = false;
    currentNativeEditLeaseRef.current = null;
    const randomPart = globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const token = `frame_${frameLoadGenerationRef.current}_${randomPart}`;
    let instrumentedSource = source;
    try {
      const sourceIndex = buildSourceIndex(source);
      sourceIndexRef.current = sourceIndex;
      instrumentedSource = instrumentPreviewHtml(sourceIndex, {
        attributeName: SOURCE_NODE_ATTRIBUTE,
      }).html;
      setEditFeedback(null);
    } catch (cause) {
      sourceIndexRef.current = null;
      void cause;
      const message = "页面仍可正常浏览。请重新载入后再试，或添加评论说明要改什么。";
      setEditFeedback({
        code: "canvas_c01_source_map",
        title: "暂时不能直接编辑这个页面",
        message,
        tone: "error",
        sticky: true,
        recovery: "reload",
      });
      onEditBlockedRef.current?.(message);
    }
    const sourceIndex = sourceIndexRef.current;
    const runtimeGrant = options.forceStatic ? null : editRuntimeGrant;
    let runtimeFrame: RuntimeFrameContext | null = null;
    let verificationToken = token;
    let prepared: string | null = null;
    if (runtimeGrant && !runtimeAttemptedRef.current) {
      // One component lifetime corresponds to one canvas generation. Once a
      // final frame has been considered, autosave/comment/source echoes can
      // only rebuild the normal static canvas; they never execute again.
      runtimeAttemptedRef.current = true;
      if (
        sourceIndex?.source === source
        && sourceIndex.sourceSha256 === runtimeGrant.sourceSha256
      ) {
        const runtimeToken = `edit-runtime-frame-${runtimeGrant.executionId}`;
        if (isEditRuntimeFrameToken(runtimeToken)) {
          const runtimeDocument = prepareCanvasFrameDocument(
            instrumentedSource,
            runtimeToken,
            {
              mode: "one-shot-runtime",
              sessionId: runtimeGrant.sessionId,
              executionId: runtimeGrant.executionId,
              hosts: runtimeGrant.hosts,
              baseUrl: resolvedBaseHref,
              editorStyles: EDITOR_DOCUMENT_STYLES,
            },
          );
          if (runtimeDocument) {
            prepared = runtimeDocument;
            verificationToken = runtimeToken;
            runtimeFrame = {
              grant: runtimeGrant,
              verificationToken: runtimeToken,
              elementGeneration: nextFrameGeneration,
              settled: false,
            };
          }
        }
      }
      if (!runtimeFrame) {
        onEditRuntimeLoadOutcomeRef.current?.(runtimeGrant, "rejected");
      }
    }
    if (!prepared) {
      prepared = prepareCanvasFrameDocument(instrumentedSource, token, {
        mode: "static",
        baseUrl: resolvedBaseHref,
        editorStyles: EDITOR_DOCUMENT_STYLES,
      }) || prepareVerifiedFrameDocument(instrumentedSource, token, {
        baseUrl: resolvedBaseHref,
        editorStyles: EDITOR_DOCUMENT_STYLES,
      });
    }
    frameSourceHtmlRef.current = source;
    expectedFrameTokenRef.current = verificationToken;
    expectedFrameHtmlRef.current = prepared;
    renderedSourceHtmlRef.current = null;
    containerRef.current?.setAttribute("data-render-verified", "false");
    containerRef.current?.removeAttribute("data-runtime-bootstrap-count");
    runtimeFrameRef.current = runtimeFrame;
    if (runtimeFrame) {
      onEditRuntimeLoadStartRef.current?.(runtimeFrame.grant);
    }
    const replaceFrameElement = () => {
      setFrameRender({
        html: prepared,
        elementGeneration: nextFrameGeneration,
        runtime: Boolean(runtimeFrame),
      });
    };
    if (options.immediate) {
      // A source-authority fence must retire the browsing context itself. Chromium can
      // accept a rapid srcdoc assignment without navigating the existing
      // iframe, which leaves its contenteditable mutation manager alive. A keyed
      // remount guarantees a fresh Document and therefore a fresh native edit
      // edit state before Selection is restored.
      flushSync(replaceFrameElement);
    } else {
      replaceFrameElement();
    }
  }, [editRuntimeGrant, resolvedBaseHref]);

  const fallBackToStaticRuntimeFrame = useCallback((
    frame: RuntimeFrameContext,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
  ): boolean => {
    const current = runtimeFrameRef.current;
    if (
      !current
      || current.settled
      || current.elementGeneration !== frame.elementGeneration
      || !sameRuntimeGrant(current.grant, frame.grant)
    ) return false;
    current.settled = true;
    runtimeFrameRef.current = null;
    // A rejected or timed-out program never replaces this iframe with another
    // executable document. The same authoritative source resumes as static.
    loadFrameSource(frameSourceHtmlRef.current, {
      preserveViewport: true,
      immediate: true,
      forceStatic: true,
    });
    onEditRuntimeLoadOutcomeRef.current?.(frame.grant, outcome);
    return true;
  }, [loadFrameSource]);

  useEffect(() => {
    if (
      !frameInitializedRef.current
      || !editRuntimeGrant
      || runtimeAttemptedRef.current
    ) return;
    // A grant that arrives after the static frame has mounted is intentionally
    // not promoted. Settling it here closes the protocol session without a
    // hidden probe, background preparation, or iframe replacement.
    runtimeAttemptedRef.current = true;
    onEditRuntimeLoadOutcomeRef.current?.(editRuntimeGrant, "rejected");
  }, [editRuntimeGrant]);

  const updateSelectedStyle = useCallback(() => {
    const element = selectedElementRef.current;
    const activeStyleElements = (
      activeTextRangeRef.current?.styleElements
      ?? activeNativeEditRef.current?.session.getStyleElementsForSelection()
      ?? []
    ).filter((candidate) => candidate.isConnected);
    const styleElement = activeStyleElements[0] ?? element;
    const view = styleElement?.ownerDocument.defaultView;
    if (!element || !styleElement || !view) return;
    const computedStyle = view.getComputedStyle(styleElement);
    const rangeComputedStyles = activeStyleElements.length > 0
      ? activeStyleElements.map((candidate) => view.getComputedStyle(candidate))
      : [computedStyle];
    const styleIsBold = (candidate: CSSStyleDeclaration) => (
      candidate.fontWeight === "bold" || Number.parseInt(candidate.fontWeight, 10) >= 600
    );
    const styleIsItalic = (candidate: CSSStyleDeclaration) => (
      candidate.fontStyle === "italic" || candidate.fontStyle === "oblique"
    );
    const styleIsUnderline = (candidate: CSSStyleDeclaration) => (
      candidate.textDecorationLine.split(/\s+/u).includes("underline")
    );
    setSelectedStyle({
      fontSize: Math.max(1, Math.round(Number.parseFloat(computedStyle.fontSize) || 16)),
      color: toHexColor(computedStyle.color, "#202124"),
      backgroundColor: toHexColor(computedStyle.backgroundColor, "#ffffff"),
      padding: Math.round(Number.parseFloat(computedStyle.paddingTop) || 0),
      margin: Math.round(Number.parseFloat(computedStyle.marginTop) || 0),
      lineHeight: Math.max(
        1,
        Math.round(Number.parseFloat(computedStyle.lineHeight) || Number.parseFloat(computedStyle.fontSize) * 1.5),
      ),
      isBold: rangeComputedStyles.every(styleIsBold),
      isItalic: rangeComputedStyles.every(styleIsItalic),
      isUnderline: rangeComputedStyles.every(styleIsUnderline),
      sources: styleSourcesForElement(styleElement),
    });
  }, []);

  const updateMoveAvailability = useCallback(() => {
    const element = selectedElementRef.current;
    if (!element) {
      setMoveAvailability(sourceMoveAvailability(
        sourceIndexRef.current,
        selectedSourceSelectionRef.current,
      ));
      return;
    }
    const parent = element?.parentElement;
    const isSafeParent = parent && !["HTML", "HEAD"].includes(parent.tagName);
    const isSafeElement = element && !["BODY", "HTML"].includes(element.tagName);
    setMoveAvailability({
      up: Boolean(
        enableReorderRef.current
        && isSafeParent
        && isSafeElement
        && element.previousElementSibling
      ),
      down: Boolean(
        enableReorderRef.current
        && isSafeParent
        && isSafeElement
        && element.nextElementSibling
      ),
    });
  }, []);

  const updateOverlayPosition = useCallback(() => {
    const container = containerRef.current;
    const iframe = iframeRef.current;
    const documentNode = iframe?.contentDocument;
    const element = selectedElementRef.current;
    const sourceSha256 = sourceIndexRef.current?.sourceSha256 ?? "";
    const viewContextGeneration =
      appliedPageViewContextRef.current?.generation ?? 0;
    const layoutTargets = commentLayoutTargets(commentedTargetsRef.current);
    const targetIds = sortedCommentLayoutTargetIds(layoutTargets);
    const textEditing = Boolean(
      activeNativeEditRef.current
      || pendingNativeEditResumeRef.current,
    );
    if (!container || !iframe || !documentNode?.body) {
      onCommentLayoutRef.current?.({
        sourceSha256,
        viewContextGeneration,
        ready: false,
        textEditing,
        targetIds,
        scrollTop: 0,
        contentHeight: 0,
        clientHeight: 0,
        targets: [],
      });
      setOverlayPosition(null);
      setInsertionPoints([]);
      setCommentMarkers([]);
      insertionPointsRef.current = [];
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const iframeRect = iframe.getBoundingClientRect();
    const frameOffsetLeft = iframeRect.left - containerRect.left;
    const frameOffsetTop = iframeRect.top - containerRect.top;
    const frameHeight = iframe.clientHeight;
    const frameWidth = iframe.clientWidth;
    const scrollingElement = documentNode.scrollingElement || documentNode.documentElement;
    const frameView = documentNode.defaultView;
    const scrollTop = Math.max(
      0,
      Number(frameView?.scrollY || scrollingElement.scrollTop || 0),
    );
    const measurementReady = Boolean(
      sourceSha256
      && renderedSourceHtmlRef.current === frameSourceHtmlRef.current
      && container.getClientRects().length > 0
      && iframe.getClientRects().length > 0
      && frameHeight > 0
      && frameWidth > 0
    );
    if (!measurementReady) {
      onCommentLayoutRef.current?.({
        sourceSha256,
        viewContextGeneration,
        ready: false,
        textEditing,
        targetIds,
        scrollTop,
        contentHeight: naturalDocumentContentHeight(documentNode, frameHeight),
        clientHeight: frameHeight,
        targets: [],
      });
      setOverlayPosition(null);
      setInsertionPoints([]);
      setCommentMarkers([]);
      insertionPointsRef.current = [];
      return;
    }
    const commentTabAssociations = tabAssociations(documentNode);
    const commentLayouts = layoutTargets.map((target) => {
      const missing = (resolution: HtmlCanvasTargetResolution) => ({
        targetId: target.id,
        status: "missing" as const,
        resolution,
      });
      try {
        let targetElement: HTMLElement | null = null;
        let targetResolution: HtmlCanvasTargetResolution = target.resolution;
        if (isPageRootSelection(target)) {
          targetElement = defaultGlobalCommentElement(documentNode);
          targetResolution = "exact";
        } else {
          const sourceIndex = sourceIndexRef.current;
          const resolution = sourceIndex
            ? resolveTargetRef(sourceIndex, sourceTargetRefForSelection(target))
            : null;
          targetResolution = (
            resolution?.resolution ?? "orphaned"
          ) as HtmlCanvasTargetResolution;
          if (resolution?.target?.type !== "element") return missing(targetResolution);
          const escapedNodeId = String(resolution.target.nodeId)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
          targetElement = documentNode.querySelector<HTMLElement>(
            `[${SOURCE_NODE_ATTRIBUTE}="${escapedNodeId}"]`,
          );
        }
        if (!targetElement) return missing(targetResolution);
        const targetRect = targetElement.getBoundingClientRect();
        const visible = isRenderedCommentTarget(targetElement);
        const tabAssociation = tabAssociationForElement(
          targetElement,
          commentTabAssociations,
        );
        if (!visible) {
          return tabAssociation
            ? {
                targetId: target.id,
                status: "hidden" as const,
                resolution: targetResolution,
                tabGroupKey: tabAssociation.key,
                tabGroupLabel: tabAssociation.label,
              }
            : {
                targetId: target.id,
                status: "hidden" as const,
                resolution: targetResolution,
              };
        }
        const top = targetRect.top + scrollTop;
        if (!Number.isFinite(top) || !Number.isFinite(targetRect.height)) {
          return missing(targetResolution);
        }
        return {
          targetId: target.id,
          status: "visible" as const,
          resolution: targetResolution,
          top: Math.max(0, top),
          height: Math.max(0, targetRect.height),
          ...(tabAssociation
            ? {
                tabGroupKey: tabAssociation.key,
                tabGroupLabel: tabAssociation.label,
              }
            : {}),
        };
      } catch {
        return missing("orphaned");
      }
    });
    const commentLayoutsByTargetId = new Map(
      commentLayouts.map((layout) => [layout.targetId, layout]),
    );
    onCommentLayoutRef.current?.({
      sourceSha256,
      viewContextGeneration,
      ready: true,
      textEditing,
      targetIds,
      scrollTop,
      contentHeight: naturalDocumentContentHeight(documentNode, frameHeight),
      clientHeight: frameHeight,
      targets: commentLayouts,
    });

    if (lockedRef.current) {
      setOverlayPosition(null);
      setInsertionPoints([]);
      setCommentMarkers([]);
      insertionPointsRef.current = [];
      return;
    }

    if (element?.isConnected) {
      const elementRect = element.getBoundingClientRect();
      const isVisible = elementRect.bottom >= 0 && elementRect.top <= frameHeight;
      if (isVisible) {
        const elementLeft = frameOffsetLeft + elementRect.left;
        const elementTop = frameOffsetTop + elementRect.top;
        const toolbarWidth = toolbarRef.current?.offsetWidth
          || Math.min(700, Math.max(120, containerRect.width - 16));
        const toolbarHeight = toolbarRef.current?.offsetHeight || 42;
        const maxToolbarLeft = Math.max(8, containerRect.width - toolbarWidth - 8);
        const aboveTop = elementTop - toolbarHeight - 10;
        const toolbarTop = aboveTop >= 8
          ? aboveTop
          : elementTop + elementRect.height + 10;
        setOverlayPosition({
          toolbarLeft: Math.max(8, Math.min(maxToolbarLeft, elementLeft)),
          toolbarTop: Math.max(8, toolbarTop),
        });
      } else {
        setOverlayPosition(null);
      }
    } else {
      setOverlayPosition(null);
    }

    const moduleParents = new Set<HTMLElement>();
    documentNode.body.querySelectorAll<HTMLElement>("*").forEach((candidate) => {
      if (inferSelectionLevel(candidate) === "module" && candidate.parentElement) {
        moduleParents.add(candidate.parentElement);
      }
    });

    const dedupedInsertionPoints = new Map<string, InsertionPoint>();
    moduleParents.forEach((parent) => {
      const children = Array.from(parent.children).filter(
        (child): child is HTMLElement => child instanceof documentNode.defaultView!.HTMLElement,
      );
      const parentSelector = selectorForElement(parent);
      const sourceIndex = sourceIndexRef.current;
      const parentNodeId = parent.getAttribute(SOURCE_NODE_ATTRIBUTE);

      const addBoundary = (
        moduleElement: HTMLElement,
        beforeSibling: HTMLElement | null,
        boundaryTop: number,
        label: string,
      ) => {
        const beforeSiblingNodeId = beforeSibling?.getAttribute(SOURCE_NODE_ATTRIBUTE) || null;
        let insertionTargetRef: ReturnType<typeof createInsertionPointTargetRef> | null = null;
        if (sourceIndex && parentNodeId && (!beforeSibling || beforeSiblingNodeId)) {
          try {
            insertionTargetRef = createInsertionPointTargetRef(sourceIndex, {
              parentId: parentNodeId,
              beforeSiblingId: beforeSiblingNodeId,
              label,
            });
          } catch {
            insertionTargetRef = null;
          }
        }
        const moduleRect = moduleElement.getBoundingClientRect();
        const adjacentRect = beforeSibling && inferSelectionLevel(beforeSibling) === "module"
          ? beforeSibling.getBoundingClientRect()
          : null;
        const leftInFrame = Math.max(
          8,
          adjacentRect ? Math.min(moduleRect.left, adjacentRect.left) : moduleRect.left,
        );
        const rightInFrame = Math.min(
          frameWidth - 8,
          adjacentRect ? Math.max(moduleRect.right, adjacentRect.right) : moduleRect.right,
        );
        const fallbackBoundary = beforeSiblingNodeId || `end_${parentSelector}`;
        const fallbackTargetId = `target_insertion_${encodeURIComponent(parentSelector)}_${encodeURIComponent(fallbackBoundary)}`;
        const selectionValue: HtmlCanvasSelection = {
          id: insertionTargetRef?.targetId || fallbackTargetId,
          label,
          selector: insertionTargetRef?.selector || parentSelector,
          level: "insertion",
          tagName: "insertion",
          text: "",
          resolution: insertionTargetRef ? "exact" : "orphaned",
          ...(insertionTargetRef?.sourceAnchor
            ? { sourceAnchor: insertionTargetRef.sourceAnchor }
            : {}),
          ...(insertionTargetRef?.fingerprint
            ? { fingerprint: insertionTargetRef.fingerprint }
            : {}),
        };
        const point: InsertionPoint = {
          selection: selectionValue,
          anchorElement: beforeSibling || moduleElement,
          kind: "boundary",
          left: frameOffsetLeft + leftInFrame,
          top: frameOffsetTop + boundaryTop,
          width: Math.max(120, rightInFrame - leftInFrame),
        };
        const boundaryKey = insertionTargetRef?.sourceAnchor
          ? `${insertionTargetRef.selector}:${insertionTargetRef.sourceAnchor.startOffset}`
          : fallbackTargetId;
        if (!dedupedInsertionPoints.has(boundaryKey)) {
          dedupedInsertionPoints.set(boundaryKey, point);
        }
      };

      children.forEach((moduleElement, childIndex) => {
        if (inferSelectionLevel(moduleElement) !== "module") return;
        const moduleRect = moduleElement.getBoundingClientRect();
        const previousElement = children[childIndex - 1] || null;
        const nextElement = children[childIndex + 1] || null;
        const previousModuleRect = previousElement && inferSelectionLevel(previousElement) === "module"
          ? previousElement.getBoundingClientRect()
          : null;
        const beforeTop = previousModuleRect && moduleRect.top >= previousModuleRect.bottom - 3
          ? previousModuleRect.bottom + (moduleRect.top - previousModuleRect.bottom) / 2
          : moduleRect.top;
        const beforeLabel = previousElement && inferSelectionLevel(previousElement) === "module"
          ? `在「${readableLabel(previousElement)}」与「${readableLabel(moduleElement)}」之间`
          : `在「${readableLabel(moduleElement)}」之前`;
        addBoundary(moduleElement, moduleElement, beforeTop, beforeLabel);

        // Consecutive modules share one boundary: the next module's "before"
        // point is also this module's "after" point.
        if (nextElement && inferSelectionLevel(nextElement) === "module") return;
        addBoundary(
          moduleElement,
          nextElement,
          moduleRect.bottom,
          `在「${readableLabel(moduleElement)}」之后`,
        );
      });
    });

    const sourceDistinctInsertionPoints = [...dedupedInsertionPoints.values()].sort(
      (left, right) => left.top - right.top || left.left - right.left,
    );
    const allInsertionPoints = sourceDistinctInsertionPoints.filter((point, pointIndex, points) => (
      !points.slice(0, pointIndex).some((existing) => {
        if (Math.abs(existing.top - point.top) > 3) return false;
        const overlap = Math.min(existing.left + existing.width, point.left + point.width)
          - Math.max(existing.left, point.left);
        return overlap >= Math.min(existing.width, point.width) * 0.8;
      })
    ));
    const pageStartPoint = allInsertionPoints[0];
    if (pageStartPoint) {
      pageStartPoint.kind = "page-start";
      pageStartPoint.selection = {
        ...pageStartPoint.selection,
        label: "在页面顶部添加内容建议",
      };
    }
    const nextInsertionPoints = allInsertionPoints.flatMap((point) => {
      const topInFrame = point.top - frameOffsetTop;
      if (topInFrame < -12 || topInFrame > frameHeight + 12) return [];
      return [{
        ...point,
        // The first/last boundary must remain fully visible inside the clipped editor.
        top: frameOffsetTop + Math.max(20, Math.min(frameHeight - 20, topInFrame)),
      }];
    });
    insertionPointsRef.current = allInsertionPoints;
    setInsertionPoints(nextInsertionPoints);

    const nextCommentMarkers: CommentMarker[] = [];
    commentedTargetsRef.current.forEach((rawTarget, targetIndex) => {
      if (rawTarget.showMarker === false) return;
      const target = rawTarget.target;
      if (commentLayoutsByTargetId.get(target.id)?.status !== "visible") return;
      let targetElement: HTMLElement | null = null;
      try {
        const sourceIndex = sourceIndexRef.current;
        const resolution = sourceIndex
          ? resolveTargetRef(sourceIndex, sourceTargetRefForSelection(target))
          : null;
        if (resolution?.target?.type === "element") {
          const escapedNodeId = String(resolution.target.nodeId)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"');
          targetElement = documentNode.querySelector<HTMLElement>(
            `[${SOURCE_NODE_ATTRIBUTE}="${escapedNodeId}"]`,
          );
        }
      } catch {
        targetElement = null;
      }
      if (!targetElement) return;
      const targetRect = targetElement.getBoundingClientRect();
      if (targetRect.bottom < 0 || targetRect.top > frameHeight) return;
      const isGlobalPageTarget = isPageRootElement(targetElement)
        && target.level === "module";
      const tabControl = commentTabAssociations.find((association) => (
        association.control === targetElement
        || association.control.contains(targetElement)
      ))?.control ?? null;
      const markerAnchorRect = tabControl?.getBoundingClientRect() ?? targetRect;
      nextCommentMarkers.push({
        key: target.id || `${target.selector}:${targetIndex}`,
        selection: selectionForElement(targetElement, sourceIndexRef.current, target),
        count: rawTarget.count,
        label: rawTarget.label,
        placement: tabControl ? "tab-side" : "target-corner",
        left: isGlobalPageTarget
          ? Math.max(18, Math.min(containerRect.width - 28, frameOffsetLeft + 18))
          : tabControl
            ? Math.max(
                18,
                Math.min(
                  containerRect.width - 28,
                  frameOffsetLeft + markerAnchorRect.right + 10,
                ),
              )
            : Math.max(
                18,
                Math.min(
                  containerRect.width - 28,
                  frameOffsetLeft + targetRect.right - 12,
                ),
              ),
        top: isGlobalPageTarget
          ? Math.max(18, Math.min(containerRect.height - 18, frameOffsetTop + 18))
          : tabControl
            ? Math.max(
                18,
                Math.min(
                  containerRect.height - 18,
                  frameOffsetTop + markerAnchorRect.top - 4,
                ),
              )
            : Math.max(
                18,
                Math.min(
                  containerRect.height - 18,
                  frameOffsetTop + targetRect.top - 10,
                ),
              ),
      });
    });
    setCommentMarkers(nextCommentMarkers);
  }, []);

  const observeSelectedElement = useCallback(
    (element: HTMLElement) => {
      resizeObserverRef.current?.disconnect();
      const ResizeObserverConstructor = element.ownerDocument.defaultView?.ResizeObserver;
      if (!ResizeObserverConstructor) return;
      const observer = new ResizeObserverConstructor(() => updateOverlayPosition());
      observer.observe(element);
      resizeObserverRef.current = observer;
    },
    [updateOverlayPosition],
  );

  const synchronizeStablePreview = useCallback((
    previousIndex: SourceIndexValue,
    result: ReturnType<typeof applyPatchPlan>,
    plan: SourcePatchPlan,
    originalMutation: HtmlCanvasMutation,
    appliedMutation: HtmlCanvasMutation,
  ): boolean => {
    if (
      originalMutation.kind !== "style"
      && originalMutation.kind !== "text"
      && originalMutation.kind !== "reorder"
    ) return false;
    const iframe = iframeRef.current;
    const documentNode = iframe?.contentDocument;
    const LiveHTMLElement = documentNode?.defaultView?.HTMLElement;
    if (!iframe || !documentNode?.documentElement || !LiveHTMLElement) return false;

    try {
      const isTextRangeStyle = plan.type === "set-text-range-style";
      const mutationBefore = originalMutation.before;
      const preservesTextRange = isTextRangeStyle || (
        originalMutation.kind === "style"
        && mutationBefore !== null
        && typeof mutationBefore === "object"
        && "segments" in mutationBefore
        && Array.isArray(mutationBefore.segments)
      );
      const instrumentedNext = instrumentPreviewHtml(result.sourceIndex, {
        attributeName: SOURCE_NODE_ATTRIBUTE,
      }).html;
      const detachedDocument = new DOMParser().parseFromString(instrumentedNext, "text/html");
      const liveNodes = sourceBackedPreviewElements(documentNode);
      const detachedNodes = sourceBackedPreviewElements(detachedDocument);
      const previousElements = previousIndex.elements as SourceElementValue[];
      const nextElements = result.sourceIndex.elements as SourceElementValue[];
      if (
        liveNodes.length !== previousElements.length
        || detachedNodes.length !== nextElements.length
        || (!isTextRangeStyle && previousElements.length !== nextElements.length)
      ) return false;

      for (let index = 0; index < liveNodes.length; index += 1) {
        if (
          liveNodes[index].getAttribute(SOURCE_NODE_ATTRIBUTE) !== previousElements[index].nodeId
          || liveNodes[index].tagName.toLowerCase() !== previousElements[index].tagName
        ) return false;
      }
      for (let index = 0; index < detachedNodes.length; index += 1) {
        if (
          detachedNodes[index].getAttribute(SOURCE_NODE_ATTRIBUTE) !== nextElements[index].nodeId
          || detachedNodes[index].tagName.toLowerCase() !== nextElements[index].tagName
        ) return false;
      }

      const previousTargetRef = plan.targetRefs.find(
        (target: SourceTargetRef) => target.targetId === originalMutation.target.id,
      ) || plan.targetRefs[0];
      if (!previousTargetRef) return false;
      const previousTarget = resolveTargetRef(previousIndex, previousTargetRef).target;
      const nextTarget = resolveTargetRef(
        result.sourceIndex,
        sourceTargetRefForSelection(appliedMutation.target),
      ).target;
      if (
        previousTarget?.type !== "element"
        || nextTarget?.type !== "element"
      ) return false;
      const previousTargetIndex = previousElements.findIndex(
        (element) => element.nodeId === previousTarget.nodeId,
      );
      const nextTargetIndex = nextElements.findIndex(
        (element) => element.nodeId === nextTarget.nodeId,
      );
      if (
        previousTargetIndex < 0
        || nextTargetIndex < 0
        || (
          originalMutation.kind !== "reorder"
          && previousTargetIndex !== nextTargetIndex
        )
      ) return false;

      const liveTarget = isTextRangeStyle
        ? liveNodes.find((node) => (
            node.getAttribute(SOURCE_NODE_ATTRIBUTE) === previousTarget.nodeId
          ))
        : liveNodes[previousTargetIndex];
      const detachedTarget = isTextRangeStyle
        ? detachedNodes.find((node) => (
            node.getAttribute(SOURCE_NODE_ATTRIBUTE) === nextTarget.nodeId
          ))
        : detachedNodes[nextTargetIndex];
      if (!(liveTarget instanceof LiveHTMLElement)) return false;
      if (!detachedTarget) return false;

      let selectedRangeElements: HTMLElement[] = [];

      if (originalMutation.kind === "reorder") {
        const liveParent = liveTarget.parentNode;
        if (
          !liveParent
          || previousTarget.parentId !== nextTarget.parentId
          || !("children" in liveParent)
        ) return false;
        const sourceBackedSiblings = Array.from(liveParent.children).filter(
          (element): element is Element => (
            element instanceof documentNode.defaultView!.Element
            && element.hasAttribute(SOURCE_NODE_ATTRIBUTE)
          ),
        );
        const nextParent = nextTarget.parentId
          ? result.sourceIndex.byNodeId.get(nextTarget.parentId)
          : null;
        const nextSiblingIndex = nextParent?.type === "element"
          ? nextParent.childElementIds.indexOf(nextTarget.nodeId)
          : -1;
        if (
          nextSiblingIndex < 0
          || sourceBackedSiblings.length !== nextParent?.childElementIds.length
          || !sourceBackedSiblings.includes(liveTarget)
        ) return false;
        const siblingsWithoutTarget = sourceBackedSiblings.filter(
          (element) => element !== liveTarget,
        );
        liveParent.insertBefore(
          liveTarget,
          siblingsWithoutTarget[nextSiblingIndex] || null,
        );
      } else if (originalMutation.kind === "style") {
        if (isTextRangeStyle) {
          liveTarget.replaceChildren(
            ...Array.from(detachedTarget.childNodes).map((node) => (
              documentNode.importNode(node, true)
            )),
          );
          const openingPatches = plan.patches.filter(
            (patch: { kind?: string }) => patch.kind === "text-range-style-open",
          );
          const insertedSpanNodeIds = openingPatches.flatMap((openingPatch) => {
            const shiftedStartOffset = openingPatch.startOffset + plan.patches.reduce(
              (total: number, patch: { startOffset: number; before: string; after: string }) => (
                patch.startOffset < openingPatch.startOffset
                  ? total + patch.after.length - patch.before.length
                  : total
              ),
              0,
            );
            const insertedSpan = nextElements.find((element) => (
              element.tagName === "span"
              && element.startTagRange.startOffset === shiftedStartOffset
            ));
            return insertedSpan ? [insertedSpan.nodeId] : [];
          });
          selectedRangeElements = insertedSpanNodeIds.flatMap((nodeId) => {
            const escapedNodeId = nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
            const selectedSpan = liveTarget.querySelector<HTMLElement>(
              `[${SOURCE_NODE_ATTRIBUTE}="${escapedNodeId}"]`,
            );
            return selectedSpan ? [selectedSpan] : [];
          });
          if (selectedRangeElements.length !== openingPatches.length) return false;
          const coalescedElementId = (
            plan.metadata as { coalescedTextRangeElementId?: string }
          ).coalescedTextRangeElementId;
          if (openingPatches.length === 0 && coalescedElementId) {
            const previousStyleElementIndex = previousElements.findIndex(
              (element) => element.nodeId === coalescedElementId,
            );
            const nextStyleElementId = previousStyleElementIndex >= 0
              ? nextElements[previousStyleElementIndex]?.nodeId
              : null;
            if (!nextStyleElementId) return false;
            const escapedStyleElementId = nextStyleElementId
              .replace(/\\/g, "\\\\")
              .replace(/"/g, '\\"');
            const selectedStyleElement = liveTarget.querySelector<HTMLElement>(
              `[${SOURCE_NODE_ATTRIBUTE}="${escapedStyleElementId}"]`,
            );
            if (!selectedStyleElement) return false;
            selectedRangeElements = [selectedStyleElement];
          }
        } else {
          const nextStyle = detachedTarget.getAttribute("style");
          if (nextStyle === null) liveTarget.removeAttribute("style");
          else liveTarget.setAttribute("style", nextStyle);
        }
      } else {
        // Legacy direct-text patches may update one exact Text node only.
        // Assigning element.textContent here would flatten semantic children
        // such as <strong>/<em> and destroy otherwise untouched source shape.
        const liveTextNodes = Array.from(liveTarget.childNodes).filter(
          (node): node is Text => node.nodeType === node.TEXT_NODE,
        );
        const detachedTextNodes = Array.from(detachedTarget.childNodes).filter(
          (node): node is Text => node.nodeType === node.TEXT_NODE,
        );
        if (
          liveTarget.children.length > 0
          || detachedTarget.children.length > 0
          || liveTarget.childNodes.length !== 1
          || detachedTarget.childNodes.length !== 1
          || liveTextNodes.length !== 1
          || detachedTextNodes.length !== 1
        ) return false;
        liveTextNodes[0].data = detachedTextNodes[0].data;
      }

      const stableNodes = sourceBackedPreviewElements(documentNode);
      if (
        stableNodes.length !== nextElements.length
        || stableNodes.some(
          (node, index) => node.tagName.toLowerCase() !== nextElements[index].tagName,
        )
      ) return false;

      // Direct patches refresh the mounted preview and every ephemeral source
      // identity in place. The DOM remains a preview only; it is never
      // serialized back into the user's source.
      stableNodes.forEach((node, index) => {
        node.setAttribute(SOURCE_NODE_ATTRIBUTE, nextElements[index].nodeId);
      });
      sourceIndexRef.current = result.sourceIndex;
      frameSourceHtmlRef.current = result.html;
      renderedSourceHtmlRef.current = result.html;
      containerRef.current?.setAttribute("data-render-verified", "true");
      pendingFrameRestoreEpochRef.current += 1;
      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;

      const stableSelection = selectionForElement(
        liveTarget,
        result.sourceIndex,
        appliedMutation.target,
        appliedMutation.target.resolution,
      );
      selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
      selectedElementRef.current = liveTarget;
      liveTarget.setAttribute("data-html-canvas-selected", stableSelection.level);
      selectedSourceSelectionRef.current = stableSelection;
      setSelection(stableSelection);
      setToolbarVisible(true);
      setSelectedInsertionId(null);
      onSelectRef.current?.(stableSelection);
      if (preservesTextRange && !isTextRangeStyle) {
        selectedRangeElements = [liveTarget];
      }
      if (preservesTextRange && selectedRangeElements.length > 0) {
        const selectedDomRange = documentNode.createRange();
        const firstSelected = selectedRangeElements[0];
        const lastSelected = selectedRangeElements[selectedRangeElements.length - 1];
        selectedDomRange.setStart(firstSelected, 0);
        selectedDomRange.setEnd(lastSelected, lastSelected.childNodes.length);
        const domSelection = documentNode.getSelection();
        domSelection?.removeAllRanges();
        domSelection?.addRange(selectedDomRange);
        const refreshedTextRange = activeTextRangeFromDocument(
          documentNode,
          result.sourceIndex,
        );
        activeTextRangeRef.current = refreshedTextRange
          ? { ...refreshedTextRange, target: stableSelection }
          : null;
        setHasTextRange(Boolean(activeTextRangeRef.current));
      } else {
        activeTextRangeRef.current = null;
        setHasTextRange(false);
      }
      updateSelectedStyle();
      updateMoveAvailability();
      observeSelectedElement(liveTarget);
      requestAnimationFrame(updateOverlayPosition);
      return true;
    } catch {
      return false;
    }
  }, [
    observeSelectedElement,
    updateMoveAvailability,
    updateOverlayPosition,
    updateSelectedStyle,
  ]);

  const reportBlockedEdit = useCallback((cause: unknown) => {
    const rawDetail = cause instanceof Error
      ? cause.message
      : String(cause || "");
    containerRef.current?.setAttribute(
      "data-edit-block-detail",
      rawDetail.slice(0, 240),
    );
    let title = "这处内容暂时不能直接编辑";
    let message = "页面内容没有改变。你仍可以选择文字，或添加评论说明要怎么改。";
    let code = "canvas_c02_edit_blocked";
    if (/两种样式的边界|文字属于哪一侧|样式内一个字的位置/iu.test(rawDetail)) {
      code = "canvas_c03_style_boundary";
      title = "请把光标移入文字内部";
      message = "这里正好是两种文字样式的边界，直接输入可能跑到错误一侧。请把光标移到样式内一个字的位置后输入，或添加评论。";
    } else if (/空的排版元素|输入可能跑到错误位置/iu.test(rawDetail)) {
      code = "canvas_c04_empty_formatting";
      title = "这里暂时不能直接改字";
      message = "这段文字旁有一个空的排版元素，直接输入可能跑到错误位置。你仍可以选中文字，或添加评论交给 AI 处理。";
    } else if (
      /复杂网页结构|暂不支持直接改字|source structure|structural command/iu.test(rawDetail)
    ) {
      code = "canvas_c05_complex_structure";
      title = "这里暂时不能直接改字";
      message = "这段内容里有需要保留的网页结构。你仍可以选中文字，或添加评论交给 AI 处理。";
    } else if (/transform|zoom|多栏|flex|grid|布局|盒子|光标错位|间距变化/iu.test(rawDetail)) {
      code = "canvas_c06_special_layout";
      title = "这里暂时不能直接改字";
      message = "这段文字的排版比较特殊。你仍可以选中文字调整样式，或添加评论交给 AI 处理。";
    } else if (/图片|图标|嵌入组件|结构边界|删除键|退格/iu.test(rawDetail)) {
      code = "canvas_c09_structure_delete";
      title = "这处内容不能这样删除";
      message = "请只修改文字，或添加评论说明要删除的图片、图标或组件。";
    } else if (/输入法|输入事件|输入过程中|浏览器没有完成这次输入|候选/iu.test(rawDetail)) {
      code = "canvas_c10_ime_incomplete";
      title = "已恢复输入前的文字";
      message = "输入法没有完整确认这次输入。请点回文字后重新输入；如果仍然失败，可以选中文字添加评论。";
    } else if (/源码地图|源码节点|目标|定位|映射|漂移|唯一静态文字/iu.test(rawDetail)) {
      code = "canvas_c11_target_drift";
      title = "请重新选择这段文字";
      message = "页面内容可能刚刚发生了变化。请再点一次要修改的文字，或添加评论。";
    }
    setEditFeedback({
      code,
      title,
      message,
      tone: "warning",
      sticky: false,
      recovery: "comment",
    });
    onEditBlockedRef.current?.(message);
  }, []);

  const applySourceCommand = useCallback((
    command: SourcePatchCommand,
    mutation: HtmlCanvasMutation,
    options: {
      validateResult?: (result: ReturnType<typeof applyPatchPlan>) => void;
      islandTextCommit?: {
        selection: NativeEditSelection;
        deferPreviewReconcile?: boolean;
      };
    } = {},
  ): ReturnType<typeof applyPatchPlan> | null => {
    const sourceIndex = sourceIndexRef.current;
    const currentSource = frameSourceHtmlRef.current;
    const blockedDetailAtCommandStart = containerRef.current?.getAttribute(
      "data-edit-block-detail",
    );
    if (!sourceIndex || sourceIndex.source !== currentSource) {
      reportBlockedEdit(new Error("源码地图已过期，请等待画布重新载入后重试。"));
      return null;
    }
    if (
      mutation.target.resolution === "ambiguous"
      || mutation.target.resolution === "orphaned"
    ) {
      reportBlockedEdit(new Error(
        mutation.target.resolution === "ambiguous"
          ? "目标存在多个候选，无法唯一定位。"
          : "目标已不存在，无法定位。",
      ));
      return null;
    }

    try {
      const forwardPlan = planSourcePatch(command, sourceIndex) as SourcePatchPlan;
      const ambientTargets = uniqueSelections([
        ...commentedTargetsRef.current.map((entry) => entry.target),
        ...trackedTargetsRef.current,
      ]);
      const originalTargets = uniqueSelections([
        mutation.target,
        ...ambientTargets,
      ]);
      const trackedTargetRefs = trackedSourceTargetRefs(
        ambientTargets,
        forwardPlan.targetRefs,
      );
      const result = applyPatchPlan(
        forwardPlan,
        currentSource,
        { trackedTargetRefs },
      );
      if (result.html === currentSource) return null;
      options.validateResult?.(result);
      const targetUpdates = deterministicTargetUpdates(result, originalTargets);
      const targetUpdatesById = new Map(
        targetUpdates.map((target) => [target.id, target]),
      );
      const operationTargetUpdate = deterministicOperationTargetUpdate(
        result,
        mutation.target,
      );
      const appliedMutation: HtmlCanvasMutation = {
        ...mutation,
        target: operationTargetUpdate
          || targetUpdatesById.get(mutation.target.id)
          || {
            ...mutation.target,
            resolution: "orphaned",
          },
        targetUpdates,
        trackedTargetIds: [
          ...new Set([
            ...forwardPlan.targetRefs.map(
              (target: SourceTargetRef) => target.targetId,
            ),
            ...trackedTargetRefs.map((target) => target.targetId),
          ]),
        ],
      };
      const previousLastEmittedHtml = lastEmittedHtmlRef.current;
      // Publish the echo token before calling the controlled parent. A host
      // using flushSync may reflect the new `html` prop during this callback;
      // the prop effect must recognize that value as our own accepted patch
      // instead of replacing the live V2 editing document.
      lastEmittedHtmlRef.current = result.html;
      pendingHtmlEchoesRef.current.push(result.html);
      if (pendingHtmlEchoesRef.current.length > 16) {
        pendingHtmlEchoesRef.current.splice(
          0,
          pendingHtmlEchoesRef.current.length - 16,
        );
      }
      const beforeHistorySelection = historySelectionFromMutationValue(
        mutation.before,
      );
      const afterHistorySelection = historySelectionFromMutationValue(
        mutation.after,
      );
      const sourceTransaction: HtmlCanvasSourceTransaction = {
        kind: appliedMutation.kind,
        ...(appliedMutation.property
          ? { property: appliedMutation.property }
          : {}),
        beforeSourceSha256: result.previousSourceSha256,
        afterSourceSha256: result.sourceSha256,
        forwardPatches: result.patches.map((patch) => ({ ...patch })),
        reversePatches: result.inversePlan.patches.map((patch) => ({ ...patch })),
        beforeTarget: mutation.target,
        afterTarget: appliedMutation.target,
        ...(beforeHistorySelection
          ? { beforeSelection: beforeHistorySelection }
          : {}),
        ...(afterHistorySelection
          ? { afterSelection: afterHistorySelection }
          : {}),
      };
      if (!onChangeRef.current(
        result.html,
        appliedMutation,
        sourceTransaction,
      )) {
        lastEmittedHtmlRef.current = previousLastEmittedHtml;
        pendingHtmlEchoesRef.current.pop();
        reportBlockedEdit(new Error("宿主状态已锁定，本次画布修改未被接受。"));
        return null;
      }
      if (!blockedDetailAtCommandStart) setEditFeedback(null);
      const activeNativeEdit = activeNativeEditRef.current;
      if (
        activeNativeEdit
        && options.islandTextCommit
        && (
          (
            activeNativeEdit.mode === "editable-island"
            && forwardPlan.type === "replace-editable-island"
          )
          || (
            activeNativeEdit.mode === "text-fragment"
            && forwardPlan.type === "update-direct-text-node"
          )
        )
        && activeNativeEdit.target.id === mutation.target.id
      ) {
        const refreshedRootRef = result.refreshedTargetRefs.find(
          (targetRef: SourceTargetRef) => (
            targetRef.targetId === activeNativeEdit.rootTargetRef.targetId
          ),
        );
        if (!refreshedRootRef || refreshedRootRef.resolution !== "exact") {
          throw new Error("V2 可编辑岛提交后无法精确重绑源码目标。");
        }
        const forwardMetadata = forwardPlan.metadata as {
          nextFragmentHtml?: unknown;
        };
        const nextFragmentHtml = activeNativeEdit.mode === "text-fragment"
          ? String(forwardMetadata.nextFragmentHtml ?? "")
          : null;
        const fragmentPatch = activeNativeEdit.mode === "text-fragment"
          ? result.patches.find((patch) => patch.kind === "direct-text-node")
          : null;
        const refreshedFragmentNode = activeNativeEdit.mode === "text-fragment"
          && fragmentPatch
          ? sourceTextNodeForFragmentReplacement(
              result.sourceIndex,
              fragmentPatch.startOffset,
              nextFragmentHtml ?? "",
            )
          : null;
        const refreshedFragmentRef = refreshedFragmentNode
          && activeNativeEdit.fragmentTargetRef
          ? createTargetRef(result.sourceIndex, refreshedFragmentNode, {
              level: "text",
              targetId: activeNativeEdit.fragmentTargetRef.targetId,
              label: activeNativeEdit.fragmentTargetRef.label,
            }) as SourceTargetRef
          : null;
        const refreshedIsland = activeNativeEdit.mode === "editable-island"
          ? editableIslandForTarget(result.sourceIndex, refreshedRootRef)
          : null;
        const refreshedProjection = refreshedIsland
          ? buildSourceTextMap(
              result.sourceIndex,
              refreshedRootRef,
              { allowEmpty: true, ignoreComments: true },
            )
          : refreshedFragmentRef
            ? buildSourceTextFragmentMap(
                result.sourceIndex,
                refreshedFragmentRef,
              )
            : null;
        const nextLease = {
          ...activeNativeEdit.lease,
          sourceRevision: result.sourceSha256,
        };
        const refreshedMountedSourceIds = refreshMountedPreviewSourceNodeIds(
          activeNativeEdit.rootElement.ownerDocument,
          sourceIndex,
          result.sourceIndex,
          {
            session: activeNativeEdit.session,
            excludeRoot: activeNativeEdit.rootElement,
          },
        );
        if (refreshedIsland) {
          activeNativeEdit.session.runExpectedMutation(() => {
            activeNativeEdit.rootElement
              .querySelectorAll(`[${SOURCE_NODE_ATTRIBUTE}]`)
              .forEach((element) => element.removeAttribute(SOURCE_NODE_ATTRIBUTE));
            activeNativeEdit.rootElement.setAttribute(
              SOURCE_NODE_ATTRIBUTE,
              refreshedIsland.element.nodeId,
            );
          });
        }
        sourceIndexRef.current = result.sourceIndex;
        frameSourceHtmlRef.current = result.html;
        activeNativeEdit.rootTargetRef = refreshedRootRef;
        activeNativeEdit.fragmentTargetRef = refreshedFragmentRef;
        activeNativeEdit.target = appliedMutation.target;
        selectedSourceSelectionRef.current = appliedMutation.target;
        setSelection(appliedMutation.target);
        onSelectRef.current?.(appliedMutation.target);
        if (!refreshedProjection) {
          nativeEditNeedsReloadRef.current = true;
          renderedSourceHtmlRef.current = null;
          containerRef.current?.setAttribute(
            "data-native-commit-path",
            "v2-text-fragment-empty-fence",
          );
          containerRef.current?.setAttribute("data-render-verified", "true");
          return result;
        }
        const nextSourceInnerHtml = refreshedIsland?.innerHtml
          ?? nextFragmentHtml
          ?? "";
        const rebased = activeNativeEdit.session.applyExternalIslandBaseline({
          revision: result.sourceSha256,
          text: refreshedProjection.text,
          innerHtml: nextSourceInnerHtml,
          selection: options.islandTextCommit.selection,
        }, {
          preserveLiveSelection: true,
          lease: nextLease,
        });
        if (!rebased) {
          throw new Error("V2 可编辑岛已写入源码，但实时编辑会话无法推进到新版本。");
        }
        activeNativeEdit.projection = refreshedProjection;
        activeNativeEdit.sourceInnerHtml = nextSourceInnerHtml;
        activeNativeEdit.selection = options.islandTextCommit.selection;
        nativeEditNeedsReloadRef.current = !refreshedMountedSourceIds;
        renderedSourceHtmlRef.current = refreshedMountedSourceIds
          ? result.html
          : null;
        containerRef.current?.setAttribute(
          "data-native-commit-path",
          !refreshedMountedSourceIds
            ? activeNativeEdit.mode === "text-fragment"
              ? "v2-text-fragment-fence-deferred"
              : "v2-island-fence-deferred"
            : options.islandTextCommit.deferPreviewReconcile
              ? activeNativeEdit.mode === "text-fragment"
                ? "v2-text-fragment-fence-deferred"
                : "v2-island-fence-deferred"
              : activeNativeEdit.mode === "text-fragment"
                ? "v2-text-fragment-preserved"
                : "v2-island-preserved",
        );
        containerRef.current?.setAttribute("data-render-verified", "true");
        return result;
      }
      if (activeNativeEdit) {
        throw new Error(
          "V2 文字会话只能提交当前受控文字命令。",
        );
      }
      const previewStayedMounted = synchronizeStablePreview(
        sourceIndex,
        result,
        forwardPlan,
        mutation,
        appliedMutation,
      );
      if (!previewStayedMounted) {
        renderedSourceHtmlRef.current = null;
        pendingSelectionRef.current = appliedMutation.target;
        pendingToolbarVisibleRef.current = toolbarVisibleRef.current;
        selectedSourceSelectionRef.current = appliedMutation.target;
        selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
        selectedElementRef.current = null;
        resizeObserverRef.current?.disconnect();
        if (mutation.kind !== "reorder") setOverlayPosition(null);
        setMoveAvailability(
          mutation.kind === "reorder"
            ? sourceMoveAvailability(result.sourceIndex, appliedMutation.target)
            : { up: false, down: false },
        );
        loadFrameSource(result.html, { preserveViewport: true });
      }
      return result;
    } catch (cause) {
      reportBlockedEdit(cause);
      return null;
    }
  }, [
    loadFrameSource,
    reportBlockedEdit,
    synchronizeStablePreview,
  ]);

  const clearNativeEditCheckpointTimer = useCallback(() => {
    const timer = nativeEditCheckpointTimerRef.current;
    if (timer !== null) window.clearTimeout(timer);
    nativeEditCheckpointTimerRef.current = null;
  }, []);

  const discardNativeCommandCallback = useCallback((
    callback: PendingNativeCommandCallback | null,
    reason: NativeDeferredCommandDiscardReason,
  ) => {
    if (!callback?.onDiscard) return;
    try {
      callback.onDiscard(reason);
    } catch {
      // Cancellation notification is bookkeeping only. It must never revive a
      // stale command or interrupt the source-authority session teardown.
    }
  }, []);

  const discardPendingNativeCommands = useCallback((
    reason: NativeDeferredCommandDiscardReason,
  ) => {
    const pending = pendingNativeCommandCallbackRef.current;
    const scheduled = scheduledNativeCommandCallbackRef.current;
    pendingNativeCommandCallbackRef.current = null;
    scheduledNativeCommandCallbackRef.current = null;
    discardNativeCommandCallback(pending, reason);
    if (scheduled && scheduled !== pending) {
      discardNativeCommandCallback(scheduled, reason);
    }
  }, [discardNativeCommandCallback]);

  const takeReplayableNativeCommandForCompletedSession = useCallback((
    active: ActiveNativeEdit,
  ): PendingNativeCommandCallback | null => {
    const pending = pendingNativeCommandCallbackRef.current;
    const scheduled = scheduledNativeCommandCallbackRef.current;
    const callback = pending ?? scheduled;
    if (
      !callback
      || callback.authority !== "user-explicit"
      || callback.session !== active.session
      || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, callback.lease)
      || !nativeEditLeasesMatch(active.lease, callback.lease)
    ) return null;
    if (callback === pending) {
      const command = active.session.takePendingCommand();
      if (
        !command
        || command.sequence !== callback.sequence
        || command.kind !== callback.kind
      ) return null;
      pendingNativeCommandCallbackRef.current = null;
    } else {
      scheduledNativeCommandCallbackRef.current = null;
    }
    return callback;
  }, []);

  const deferNativeCommand = useCallback((
    kind: string,
    run: () => void,
    payload?: unknown,
    options: NativeDeferredCommandOptions = {},
  ): boolean => {
    const active = activeNativeEditRef.current;
    if (!active) return false;
    const authority = options.authority ?? "user-explicit";
    const incumbent = pendingNativeCommandCallbackRef.current
      ?? scheduledNativeCommandCallbackRef.current;
    if (authority === "system" && incumbent?.authority === "user-explicit") {
      try {
        options.onDiscard?.("blocked-by-user-command");
      } catch {
        // A lower-priority system callback is already fully discarded.
      }
      return true;
    }
    const queued = active.session.queuePendingCommand({
      kind,
      authority,
      payload,
    });
    if (!queued.queued) return false;
    discardPendingNativeCommands("superseded");
    pendingNativeCommandCallbackRef.current = {
      sequence: queued.sequence,
      kind,
      authority,
      session: active.session,
      lease: { ...active.lease },
      run,
      onDiscard: options.onDiscard,
    };
    return true;
  }, [discardPendingNativeCommands]);
  deferNativeCommandRef.current = deferNativeCommand;

  drainPendingNativeCommandRef.current = (session) => {
    const active = activeNativeEditRef.current;
    const pending = pendingNativeCommandCallbackRef.current;
    if (
      !active
      || !pending
      || active.session !== session
      || pending.session !== session
      || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, pending.lease)
      || !nativeEditLeasesMatch(active.lease, pending.lease)
    ) {
      if (pending?.session === session) {
        pendingNativeCommandCallbackRef.current = null;
        discardNativeCommandCallback(pending, "stale-session");
      }
      return;
    }
    const command = session.takePendingCommand();
    if (!command || command.sequence !== pending.sequence || command.kind !== pending.kind) {
      if (command) {
        pendingNativeCommandCallbackRef.current = null;
        discardNativeCommandCallback(pending, "stale-session");
      }
      return;
    }
    pendingNativeCommandCallbackRef.current = null;
    scheduledNativeCommandCallbackRef.current = pending;
    window.queueMicrotask(() => {
      const current = activeNativeEditRef.current;
      if (
        scheduledNativeCommandCallbackRef.current !== pending
        || !current
        || current.session !== session
        || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, pending.lease)
      ) {
        if (scheduledNativeCommandCallbackRef.current === pending) {
          scheduledNativeCommandCallbackRef.current = null;
          discardNativeCommandCallback(pending, "stale-session");
        }
        return;
      }
      scheduledNativeCommandCallbackRef.current = null;
      pending.run();
    });
  };

  const refreshNativeEditRangeState = useCallback((
    active: ActiveNativeEdit,
    nextSelection: NativeEditSelection,
  ) => {
    active.selection = nextSelection;
    const startOffset = Math.min(nextSelection.anchor, nextSelection.focus);
    const endOffset = Math.max(nextSelection.anchor, nextSelection.focus);
    if (startOffset === endOffset) {
      activeTextRangeRef.current = null;
      setHasTextRange(false);
      updateSelectedStyle();
      return;
    }
    try {
      const segments = textRangeToSourceSegments(
        active.projection,
        startOffset,
        endOffset,
      );
      activeTextRangeRef.current = {
        target: active.target,
        segments,
        text: active.projection.text.slice(startOffset, endOffset),
        styleElements: active.session.getStyleElementsForSelection(),
        direction: nextSelection.anchor <= nextSelection.focus
          ? "forward"
          : "backward",
      };
      setHasTextRange(true);
    } catch {
      activeTextRangeRef.current = null;
      setHasTextRange(false);
    }
    updateSelectedStyle();
  }, [updateSelectedStyle]);

  const reloadCommittedNativeEditFromSource = useCallback((
    active: ActiveNativeEdit,
    source: string,
    selection: NativeEditSelection,
  ) => {
    clearNativeEditCheckpointTimer();
    const target = active.target;
    const rootElement = active.rootElement;
    const documentNode = rootElement.ownerDocument;
    currentNativeEditLeaseRef.current = null;
    activeNativeEditRef.current = null;
    discardPendingNativeCommands("session-ended");
    retainNativeEditFocusRef.current = null;
    installFencedDocumentGuardRef.current(documentNode);
    rootElement.removeAttribute("data-html-canvas-editing");
    active.session.fenceDispose();
    active.releaseHost?.();
    nativeEditNeedsReloadRef.current = false;
    activeTextRangeRef.current = null;
    setIsEditing(false);
    setHasTextRange(false);
    documentNode.getSelection()?.removeAllRanges();
    queueNativeFenceReloadRef.current(
      source,
      {
        fenceId: nativeEditFenceSequenceRef.current,
        target,
        selection,
        focus: true,
        toolbarVisible: true,
        ...(active.fragmentTargetRef
          ? { fragmentTargetRef: active.fragmentTargetRef }
          : {}),
      },
      target,
      selection,
    );
  }, [clearNativeEditCheckpointTimer, discardPendingNativeCommands]);

  const restoreRejectedNativeCheckpoint = useCallback((
    active: ActiveNativeEdit,
    selection: NativeEditSelection,
  ) => {
    if (activeNativeEditRef.current !== active) return;
    const sourceIndex = sourceIndexRef.current;
    active.session.rollback();
    if (
      sourceIndex
      && sourceIndex.source === frameSourceHtmlRef.current
      && restartCanonicalNativeEditRef.current(
        active,
        active.target,
        selection,
        sourceIndex,
        sourceIndex,
      )
    ) return;
    if (activeNativeEditRef.current === active) {
      reloadCommittedNativeEditFromSource(
        active,
        frameSourceHtmlRef.current,
        selection,
      );
    }
  }, [reloadCommittedNativeEditFromSource]);

  const checkpointNativeEdit = useCallback((
    trigger: NativeEditCheckpointTrigger = "automatic",
    options: { deferPreviewReconcile?: boolean } = {},
  ): NativeEditCommitResult => {
    const active = activeNativeEditRef.current;
    if (!active) return { ok: true, mutation: null };
    clearNativeEditCheckpointTimer();
    const captured = active.session.captureCheckpoint(trigger);
    if (!captured.ok) {
      const reason = captured.reason === "composing"
        ? "中文输入法正在组词，请先完成当前输入。"
        : captured.reason === "dom-drift"
          ? "这次输入没有完整完成，已恢复到上一次安全内容；请重新点选后再试。"
          : "文字编辑会话尚未准备完成。";
      reportBlockedEdit(new Error(reason));
      return { ok: false, mutation: null, reason };
    }
    refreshNativeEditRangeState(active, captured.selection);
    if (!captured.checkpoint) return { ok: true, mutation: null };

    const sourceIndex = sourceIndexRef.current;
    if (
      !sourceIndex
      || sourceIndex.sourceSha256 !== active.projection.sourceSha256
      || sourceIndex.source !== frameSourceHtmlRef.current
    ) {
      const reason = "文字编辑期间源码地图发生变化，已恢复当前源码，本次没有写入。";
      reloadCommittedNativeEditFromSource(
        active,
        frameSourceHtmlRef.current,
        captured.selection,
      );
      reportBlockedEdit(new Error(reason));
      return { ok: false, mutation: null, reason };
    }

    let sourceCommitted = false;
    try {
      const {
        previousInnerHtml,
        nextInnerHtml,
        previousText,
        nextText,
        beforeSelection,
        selection: nextSelection,
      } = captured.checkpoint;
      const mutation: HtmlCanvasMutation = {
        kind: "text",
        target: active.target,
        property: active.mode === "text-fragment"
          ? "textFragmentHtml"
          : "editableIslandHtml",
        before: {
          innerHtml: previousInnerHtml,
          text: previousText,
          selection: beforeSelection,
        },
        after: {
          innerHtml: nextInnerHtml,
          text: nextText,
          selection: nextSelection,
          inputType: captured.checkpoint.inputType,
        },
      };
      let validatedSourceInnerHtml: string | null = null;
      let validationSucceeded = false;
      if (active.mode === "text-fragment" && !active.fragmentTargetRef) {
        throw new Error("V2 文字草稿无法安全写入当前可编辑岛。");
      }
      const command = active.mode === "text-fragment"
        ? {
            type: "update-direct-text-node" as const,
            targetRef: active.rootTargetRef,
            textTargetRef: active.fragmentTargetRef!,
            beforeFragmentHtml: previousInnerHtml,
            nextFragmentHtml: nextInnerHtml,
            expectedSourceSha256: active.projection.sourceSha256,
          }
        : {
            type: "replace-editable-island" as const,
            targetRef: active.rootTargetRef,
            beforeInnerHtml: previousInnerHtml,
            nextInnerHtml,
            expectedSourceSha256: active.projection.sourceSha256,
          };
      const result = applySourceCommand(command, mutation, {
        islandTextCommit: {
          selection: nextSelection,
          deferPreviewReconcile: options.deferPreviewReconcile,
        },
        validateResult: (candidate) => {
          const operationTargetRef = candidate.refreshedTargetRefs.find(
            (targetRef: SourceTargetRef) => (
              targetRef.targetId === active.rootTargetRef.targetId
            ),
          );
          if (!operationTargetRef || operationTargetRef.resolution !== "exact") {
            throw new Error("V2 可编辑岛无法在 Patch 后精确重绑。");
          }
          if (active.mode === "editable-island") {
            const projection = buildSourceTextMap(
              candidate.sourceIndex,
              operationTargetRef,
              { allowEmpty: true, ignoreComments: true },
            );
            const island = editableIslandForTarget(
              candidate.sourceIndex,
              operationTargetRef,
            );
            if (
              island.innerHtml !== nextInnerHtml
              || projection.text !== nextText
            ) {
              throw new Error("V2 可编辑岛源码结果与当前草稿不一致。");
            }
            validatedSourceInnerHtml = island.innerHtml;
            validationSucceeded = true;
            return;
          }
          const fragmentPatch = candidate.patches.find(
            (patch) => patch.kind === "direct-text-node",
          );
          if (!fragmentPatch) {
            throw new Error("V2 可编辑岛源码结果与当前草稿不一致。");
          }
          const nextTextNode = sourceTextNodeForFragmentReplacement(
            candidate.sourceIndex,
            fragmentPatch.startOffset,
            nextInnerHtml,
          );
          if (!nextTextNode) {
            if (nextInnerHtml !== "" || nextText !== "") {
              throw new Error("V2 可编辑岛源码结果与当前草稿不一致。");
            }
            validatedSourceInnerHtml = "";
            validationSucceeded = true;
            return;
          }
          const refreshedFragmentRef = createTargetRef(
            candidate.sourceIndex,
            nextTextNode,
            { level: "text" },
          ) as SourceTargetRef;
          const projection = buildSourceTextFragmentMap(
            candidate.sourceIndex,
            refreshedFragmentRef,
          );
          if (projection.text !== nextText) {
            throw new Error("V2 可编辑岛源码结果与当前草稿不一致。");
          }
          validatedSourceInnerHtml = nextInnerHtml;
          validationSucceeded = true;
        },
      });
      if (!result || !validationSucceeded || validatedSourceInnerHtml === null) {
        const reason = "V2 文字草稿无法安全写入当前可编辑岛。";
        restoreRejectedNativeCheckpoint(active, beforeSelection);
        return { ok: false, mutation: null, reason };
      }
      sourceCommitted = true;
      if (
        active.mode === "text-fragment"
        && validatedSourceInnerHtml === ""
      ) {
        // The source patch deliberately removes the direct Text node. There
        // is therefore no fragment projection to rebase or resume after the
        // canonical frame reload. Retire the transient host without running a
        // second checkpoint; its committed mutation is returned below.
        const retired = finishNativeEditingRef.current(false, trigger, {
          replayQueuedUserCommand: true,
        });
        if (!retired.ok) {
          throw new Error(
            retired.reason || "文字片段删除后无法安全结束编辑会话。",
          );
        }
        containerRef.current?.setAttribute(
          "data-native-commit-path",
          "v2-text-fragment-empty-finished",
        );
        return {
          ok: true,
          mutation,
          ...(retired.frameReloading ? { frameReloading: true } : {}),
        };
      }
      const currentActive = activeNativeEditRef.current;
      if (
        !currentActive
        || currentActive.session !== active.session
        || currentActive.projection.sourceSha256 !== result.sourceSha256
        || currentActive.sourceInnerHtml !== validatedSourceInnerHtml
      ) {
        containerRef.current?.setAttribute(
          "data-native-commit-path",
          active.mode === "text-fragment"
            ? "v2-text-fragment-checkpoint-reload"
            : "v2-island-checkpoint-reload",
        );
        if (activeNativeEditRef.current === active) {
          reloadCommittedNativeEditFromSource(active, result.html, nextSelection);
        }
        return { ok: true, mutation, frameReloading: true };
      }
      containerRef.current?.setAttribute(
        "data-native-commit-path",
        options.deferPreviewReconcile
          ? active.mode === "text-fragment"
            ? "v2-text-fragment-checkpoint-fence"
            : "v2-island-checkpoint-fence"
          : active.mode === "text-fragment"
            ? "v2-text-fragment-checkpoint-preserved"
            : "v2-island-checkpoint-preserved",
      );
      refreshNativeEditRangeState(currentActive, nextSelection);
      return { ok: true, mutation };
    } catch (cause) {
      if (!sourceCommitted) {
        restoreRejectedNativeCheckpoint(active, captured.checkpoint.beforeSelection);
      }
      reportBlockedEdit(cause);
      return {
        ok: false,
        mutation: null,
        reason: cause instanceof Error ? cause.message : "文字检查点失败。",
      };
    }
  }, [
    applySourceCommand,
    clearNativeEditCheckpointTimer,
    refreshNativeEditRangeState,
    reloadCommittedNativeEditFromSource,
    reportBlockedEdit,
    restoreRejectedNativeCheckpoint,
  ]);

  nativeEditCheckpointRef.current = () => {
    checkpointNativeEdit();
  };

  const finishNativeEditing = useCallback((
    shouldApply: boolean,
    trigger: NativeEditCheckpointTrigger = "manual",
    { replayQueuedUserCommand = false }: FinishNativeEditingOptions = {},
  ): NativeEditCommitResult => {
    const active = activeNativeEditRef.current;
    if (!active) return { ok: true, mutation: null };
    if (nativeEditFinishingRef.current) {
      return { ok: false, mutation: null, reason: "文字编辑正在提交。" };
    }
    nativeEditFinishingRef.current = true;
    clearNativeEditCheckpointTimer();
    try {
      const committed = shouldApply
        ? checkpointNativeEdit(trigger)
        : { ok: true, mutation: null };
      if (!committed.ok) return committed;
      const completedUserCommand = replayQueuedUserCommand
        ? takeReplayableNativeCommandForCompletedSession(active)
        : null;
      const replayCompletedUserCommand = () => {
        if (!completedUserCommand) return;
        scheduledNativeCommandCallbackRef.current = completedUserCommand;
        window.queueMicrotask(() => {
          if (scheduledNativeCommandCallbackRef.current !== completedUserCommand) return;
          scheduledNativeCommandCallbackRef.current = null;
          completedUserCommand.run();
        });
      };
      const source = frameSourceHtmlRef.current;
      const target = active.target;
      const rootElement = active.rootElement;
      const selectionElement = active.selectionElement;
      const frameReloadRequired = (
        nativeEditNeedsReloadRef.current
        || !rootElement.isConnected
        || renderedSourceHtmlRef.current !== source
      );
      currentNativeEditLeaseRef.current = null;
      activeNativeEditRef.current = null;
      discardPendingNativeCommands("session-ended");
      retainNativeEditFocusRef.current = null;
      rootElement.removeAttribute("data-html-canvas-editing");
      active.session.dispose();
      active.releaseHost?.();
      nativeEditNeedsReloadRef.current = false;
      activeTextRangeRef.current = null;
      setIsEditing(false);
      setHasTextRange(false);
      rootElement.ownerDocument.getSelection()?.removeAllRanges();
      if (frameReloadRequired) {
        // An explicit finish never resumes native editing after the new frame
        // is connected. This is essential when a direct-text fragment was
        // deleted: its source target no longer exists to restore.
        pendingNativeEditResumeRef.current = null;
        selectedElementRef.current = null;
        pendingSelectionRef.current = target;
        pendingToolbarVisibleRef.current = true;
        renderedSourceHtmlRef.current = null;
        loadFrameSource(source, { preserveViewport: true });
        replayCompletedUserCommand();
        return { ...committed, frameReloading: true };
      }

      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;
      pendingFrameRestoreEpochRef.current += 1;
      if (active.mode === "editable-island") {
        selectedElementRef.current = rootElement;
      } else {
        selectedElementRef.current = selectionElement;
      }
      selectedSourceSelectionRef.current = target;
      selectionElement.setAttribute("data-html-canvas-selected", target.level);
      renderedSourceHtmlRef.current = source;
      containerRef.current?.setAttribute("data-render-verified", "true");
      setSelection(target);
      setToolbarVisible(true);
      setSelectedInsertionId(null);
      onSelectRef.current?.(target);
      updateSelectedStyle();
      updateMoveAvailability();
      observeSelectedElement(selectionElement);
      requestAnimationFrame(updateOverlayPosition);
      replayCompletedUserCommand();
      return { ...committed, frameReloading: false };
    } finally {
      nativeEditFinishingRef.current = false;
    }
  }, [
    checkpointNativeEdit,
    clearNativeEditCheckpointTimer,
    discardPendingNativeCommands,
    loadFrameSource,
    observeSelectedElement,
    takeReplayableNativeCommandForCompletedSession,
    updateMoveAvailability,
    updateOverlayPosition,
    updateSelectedStyle,
  ]);
  finishNativeEditingRef.current = finishNativeEditing;

  const resetSelection = useCallback((
    commitPendingEdit: boolean,
    fromQueuedCommand = false,
  ) => {
    if (
      commitPendingEdit
      && !fromQueuedCommand
      && deferNativeCommandRef.current(
        "target-switch",
        () => resetSelection(commitPendingEdit, true),
      )
    ) return;
    const committed = finishNativeEditing(commitPendingEdit, "manual");
    if (!committed.ok) return;
    pendingFrameRestoreEpochRef.current += 1;
    pendingNativeEditResumeRef.current = null;
    pendingSelectionRef.current = null;
    pendingToolbarVisibleRef.current = false;
    selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
    selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
    selectedElementRef.current = null;
    selectedSourceSelectionRef.current = null;
    activeTextRangeRef.current = null;
    resizeObserverRef.current?.disconnect();
    setSelection(null);
    setToolbarVisible(false);
    setHasTextRange(false);
    setSelectedInsertionId(null);
    setOverlayPosition(null);
    setSpacingMenuOpen(false);
    setMoveAvailability({ up: false, down: false });
    onSelectRef.current?.(null);
  }, [finishNativeEditing]);

  const clearSelection = useCallback(() => {
    resetSelection(true);
  }, [resetSelection]);

  useEffect(() => {
    const container = containerRef.current;
    const documentNode = container?.ownerDocument;
    if (!container || !documentNode) return undefined;
    const clearOnOutsidePointer = (event: PointerEvent) => {
      if (!selectedElementRef.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (toolbarRef.current?.contains(target)) return;
      const targetElement = target instanceof Element ? target : target.parentElement;
      if (targetElement?.closest('[data-html-canvas-preserve-selection="true"]')) return;
      clearSelection();
    };
    documentNode.addEventListener("pointerdown", clearOnOutsidePointer, true);
    return () => documentNode.removeEventListener("pointerdown", clearOnOutsidePointer, true);
  }, [clearSelection]);

  const selectElement = useCallback(
    (
      element: HTMLElement,
      levelOverride?: HtmlCanvasSelectionLevel,
      options: {
        preserveTextSelection?: boolean;
        showToolbar?: boolean;
        fromQueuedCommand?: boolean;
      } = {},
    ): HtmlCanvasSelection => {
      pendingFrameRestoreEpochRef.current += 1;
      const activeNativeEdit = activeNativeEditRef.current;
      if (activeNativeEdit && !activeNativeEdit.rootElement.contains(element)) {
        if (
          !options.fromQueuedCommand
          && deferNativeCommandRef.current(
            "target-switch",
            () => selectElement(element, levelOverride, {
              ...options,
              fromQueuedCommand: true,
            }),
            { targetId: element.getAttribute(SOURCE_NODE_ATTRIBUTE) },
          )
        ) return activeNativeEdit.target;
        const requestedTarget = selectionForElement(
          element,
          sourceIndexRef.current,
          undefined,
          undefined,
          levelOverride,
        );
        const committed = finishNativeEditing(true, "manual");
        if (!committed.ok) return activeNativeEdit.target;
        if (committed.frameReloading) {
          pendingSelectionRef.current = requestedTarget;
          pendingToolbarVisibleRef.current = options.showToolbar ?? true;
          return requestedTarget;
        }
      }
      selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
      selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
      const nextSelection = selectionForElement(
        element,
        sourceIndexRef.current,
        undefined,
        undefined,
        levelOverride,
      );
      selectedElementRef.current = element;
      setSpacingMenuOpen(false);
      setSelectedInsertionId(null);
      if (!options.preserveTextSelection) {
        activeTextRangeRef.current = null;
        setHasTextRange(false);
        element.ownerDocument.getSelection()?.removeAllRanges();
      }
      element.setAttribute("data-html-canvas-selected", nextSelection.level);
      const isGlobalPage = isPageRootElement(element) && nextSelection.level === "module";
      element.toggleAttribute(GLOBAL_SELECTION_ATTRIBUTE, isGlobalPage);
      selectedSourceSelectionRef.current = nextSelection;
      setSelection(nextSelection);
      setToolbarVisible(options.showToolbar ?? true);
      onSelectRef.current?.(nextSelection);
      updateSelectedStyle();
      updateMoveAvailability();
      observeSelectedElement(element);
      if (isGlobalPage) {
        const scrollingElement = element.ownerDocument.scrollingElement;
        if (scrollingElement) scrollingElement.scrollTop = 0;
        element.ownerDocument.documentElement.scrollTop = 0;
        element.ownerDocument.body.scrollTop = 0;
        element.ownerDocument.defaultView?.scrollTo({
          top: 0,
          left: 0,
          behavior: "auto",
        });
      }
      requestAnimationFrame(updateOverlayPosition);
      return nextSelection;
    },
    [finishNativeEditing, observeSelectedElement, updateMoveAvailability, updateOverlayPosition, updateSelectedStyle],
  );

  const requestCommentForTarget = useCallback((target: HtmlCanvasSelection): boolean => {
    if (target.resolution !== "exact") {
      setEditFeedback({
        code: "canvas_c13_comment_target_not_exact",
        title: "请选择可定位的源码元素",
        message: "这部分内容由页面运行时生成，无法对应到源码。请重新选择可定位的折线、文字、数据点或其他源码元素。",
        tone: "warning",
        sticky: false,
        recovery: "none",
      });
      return false;
    }
    onRequestCommentRef.current?.(target);
    return true;
  }, []);

  const requestGlobalComment = useCallback(() => {
    if (lockedRef.current) return;
    const documentNode = iframeRef.current?.contentDocument;
    if (!documentNode) return;
    const globalElement = defaultGlobalCommentElement(documentNode);
    if (!globalElement) return;
    const target = selectElement(globalElement, "module");
    requestCommentForTarget(target);
  }, [requestCommentForTarget, selectElement]);

  const startEditing = useCallback((
    caretPoint?: TextCaretPoint,
    restoredSelection?: NativeEditSelection,
  ): boolean => {
    containerRef.current?.setAttribute("data-native-start-status", "starting");
    containerRef.current?.removeAttribute("data-native-host-mode");
    containerRef.current?.removeAttribute("data-native-event-delivery-mode");
    if (readOnlyRef.current) {
      containerRef.current?.setAttribute("data-native-start-status", "read-only");
      return false;
    }
    const existing = activeNativeEditRef.current;
    if (existing) {
      existing.session.focusAtPoint(caretPoint);
      containerRef.current?.setAttribute("data-native-start-status", "existing");
      return true;
    }
    const sourceIndex = sourceIndexRef.current;
    const selectedElement = selectedElementRef.current;
    if (!sourceIndex || !selectedElement) {
      containerRef.current?.setAttribute(
        "data-native-start-status",
        `missing:${sourceIndex ? "" : "source"}:${selectedElement ? "" : "selection"}`,
      );
      return false;
    }
    if (selectedElement.closest(`[${EDIT_RUNTIME_HOST_ATTRIBUTE}]`)) {
      containerRef.current?.setAttribute("data-native-start-status", "runtime-display-only");
      return false;
    }
    const priorRange = activeTextRangeRef.current;
    const islandHostElement = nativeEditHostForElement(selectedElement, sourceIndex);
    const fragmentCandidate = islandHostElement
      ? null
      : nativeTextFragmentForRange(priorRange, sourceIndex);
    if (!islandHostElement && !fragmentCandidate) {
      let blockedCause: Error = new Error(
        "这段可见内容不是当前源码中的唯一静态文字，无法安全进入原位编辑。",
      );
      const selectedNodeId = selectedElement.getAttribute(SOURCE_NODE_ATTRIBUTE);
      const selectedSourceNode = selectedNodeId
        ? sourceIndex.byNodeId.get(selectedNodeId)
        : null;
      if (selectedSourceNode?.type === "element") {
        try {
          const selectedTargetRef = createTargetRef(
            sourceIndex,
            selectedSourceNode,
            { level: "subregion" },
          ) as SourceTargetRef;
          const islandCapability = isEditableIslandTarget(
            sourceIndex,
            selectedTargetRef,
          );
          if (!islandCapability.editable) {
            containerRef.current?.setAttribute(
              "data-native-start-status",
              `island:${islandCapability.code}`,
            );
            containerRef.current?.setAttribute(
              "data-native-capability-detail",
              `${islandCapability.code}:${JSON.stringify(
                islandCapability.details,
              )}`.slice(0, 2400),
            );
            blockedCause = new Error(
              islandCapability.message
              || "这处内容包含不能由文字编辑器改写的网页结构。",
            );
          }
        } catch {
          // The existing no-host path below remains the fail-closed fallback.
        }
      }
      containerRef.current?.setAttribute(
        "data-native-start-status",
        containerRef.current.getAttribute("data-native-start-status") || "no-host",
      );
      reportBlockedEdit(blockedCause);
      return false;
    }
    const mode: ActiveNativeEdit["mode"] = fragmentCandidate
      ? "text-fragment"
      : "editable-island";
    const selectionElement = fragmentCandidate?.parentElement
      ?? islandHostElement!;
    const target = selectElement(selectionElement, "part", {
      preserveTextSelection: Boolean(priorRange),
      showToolbar: true,
    });
    let mountedFragment: ReturnType<typeof mountNativeTextFragmentHost> = null;
    let createdSession: IslandEditingController | null = null;
    try {
      const rootTargetRef = sourceTargetRefForSelection(target);
      const fragmentTargetRef = fragmentCandidate?.textTargetRef ?? null;
      const projection = fragmentTargetRef
        ? buildSourceTextFragmentMap(sourceIndex, fragmentTargetRef)
        : buildSourceTextMap(
            sourceIndex,
            rootTargetRef,
            { allowEmpty: true, ignoreComments: true },
          );
      const activationLogicalRange = priorRange
        ? sourceSegmentsToTextRange(projection, priorRange.segments)
        : null;
      let sourceInnerHtml = fragmentCandidate?.sourceInnerHtml ?? "";
      if (mode === "editable-island") {
        const islandCapability = isEditableIslandTarget(
          sourceIndex,
          rootTargetRef,
        );
        if (!islandCapability.editable) {
          containerRef.current?.setAttribute(
            "data-native-start-status",
            `island:${islandCapability.code}`,
          );
          containerRef.current?.setAttribute(
            "data-native-capability-detail",
            `${islandCapability.code}:${JSON.stringify(
              islandCapability.details,
            )}`.slice(0, 2400),
          );
          reportBlockedEdit(new Error(
            islandCapability.message
            || "这处内容包含不能由文字编辑器改写的网页结构。",
          ));
          return false;
        }
        sourceInnerHtml = islandCapability.island.innerHtml;
      }
      const liveText = fragmentCandidate
        ? fragmentCandidate.textNode.data
        : nativeLogicalText(islandHostElement!);
      if (liveText !== projection.text) {
        containerRef.current?.setAttribute("data-native-start-status", "text-mismatch");
        reportBlockedEdit(new Error(
          "画布文字与源码节点已经漂移，已阻止直接编辑。",
        ));
        return false;
      }
      const layoutElement = fragmentCandidate?.parentElement
        ?? islandHostElement!;
      const layoutBeforeEditing = nativeLayoutFingerprint(layoutElement);
      const fragmentStyleBefore = fragmentCandidate
        ? nativeTextFragmentStyleSignature(fragmentCandidate.parentElement)
        : null;
      let initialSelection = boundedHistorySelection(
        restoredSelection,
        projection.text,
      );
      if (!initialSelection && priorRange && activationLogicalRange) {
        initialSelection = {
          anchor: priorRange.direction === "backward"
            ? activationLogicalRange.endOffset
            : activationLogicalRange.startOffset,
          focus: priorRange.direction === "backward"
            ? activationLogicalRange.startOffset
            : activationLogicalRange.endOffset,
          affinity: "right",
        };
      }
      const baseline: NativeEditBaseline = {
        revision: projection.sourceSha256,
        text: projection.text,
        ...(initialSelection ? { selection: initialSelection } : {}),
      };
      if (fragmentCandidate) {
        mountedFragment = mountNativeTextFragmentHost(fragmentCandidate.textNode);
        if (!mountedFragment) {
          throw new Error(
            "这段可见内容不是当前源码中的唯一静态文字，无法安全进入原位编辑。",
          );
        }
      }
      const hostElement = mountedFragment?.hostElement ?? islandHostElement!;
      nativeEditSessionSequenceRef.current += 1;
      // Entering contenteditable gives Chromium a document-local mutation
      // owner even when the user later blurs before typing. Keep that
      // generation marked until a canonical frame replacement cuts it off.
      nativeSessionNeedsCanonicalFenceRef.current = true;
      const lease: ActiveNativeEdit["lease"] = {
        sessionId: `native_${nativeEditSessionSequenceRef.current.toString(36)}`,
        domGeneration: nativeDomGenerationRef.current,
        sourceRevision: projection.sourceSha256,
        hostId: fragmentTargetRef?.targetId ?? rootTargetRef.targetId,
      };
      currentNativeEditLeaseRef.current = lease;
      const handleSessionState = (state: NativeEditSessionState) => {
        const active = activeNativeEditRef.current;
        if (
          !active
          || active.session !== session
          || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, active.lease)
        ) return;
        refreshNativeEditRangeState(active, state.selection);
        clearNativeEditCheckpointTimer();
        if (state.dirty && !state.composing) {
          const scheduledLease = { ...active.lease };
          nativeEditCheckpointTimerRef.current = window.setTimeout(() => {
            nativeEditCheckpointTimerRef.current = null;
            if (!nativeEditLeasesMatch(currentNativeEditLeaseRef.current, scheduledLease)) return;
            nativeEditCheckpointRef.current();
          }, state.requiresCanonicalReconcile
            ? 0
            : NATIVE_EDIT_CHECKPOINT_DELAY_MS);
        }
      };
      const session = new IslandEditingController({
        hostElement,
        baseline,
        sourceInnerHtml,
        ...(mode === "text-fragment"
          ? { normalizeInnerHtml: normalizeEditableTextFragmentHtml }
          : {}),
        lease: {
          stamp: lease,
          isCurrent: (stamp) => nativeEditLeasesMatch(
            currentNativeEditLeaseRef.current,
            stamp,
          ),
          advance: (expected, next) => {
            const active = activeNativeEditRef.current;
            if (
              !active
              || active.session !== session
              || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, expected)
              || !nativeEditLeasesMatch(active.lease, expected)
            ) return false;
            const advancedLease = { ...next };
            active.lease = advancedLease;
            currentNativeEditLeaseRef.current = advancedLease;
            return true;
          },
        },
        ariaLabel: `编辑${target.label}`,
        onStateChange: handleSessionState,
        onPendingCommandReady: () => {
          drainPendingNativeCommandRef.current(session);
        },
        // V2 does not use blur as a commit boundary. Explicit target switches,
        // Escape, save/export and mode changes own that lifecycle; transient
        // iframe or toolbar focus movement must not retire the text island.
        onBlur: () => undefined,
        onEscape: () => finishNativeEditing(true, "manual"),
        onError: reportBlockedEdit,
      });
      createdSession = session;
      const layoutAfterEditing = nativeLayoutFingerprint(layoutElement);
      const fragmentStyleStable = !fragmentCandidate || (
        nativeTextFragmentStyleSignature(hostElement) === fragmentStyleBefore
        && !hasNativeTextFragmentPseudoContent(hostElement)
      );
      if (
        !sameNativeLayout(layoutBeforeEditing, layoutAfterEditing)
        || !sameNativeTextStyle(layoutBeforeEditing, layoutAfterEditing)
        || !fragmentStyleStable
      ) {
        session.dispose();
        mountedFragment?.release();
        currentNativeEditLeaseRef.current = null;
        containerRef.current?.setAttribute(
          "data-native-start-status",
          "island:layout-changed",
        );
        reportBlockedEdit(new Error(
          "这个页面为可编辑状态设置了会改变排版的 CSS，已阻止直接编辑以免画面跳动。",
        ));
        return false;
      }
      const active: ActiveNativeEdit = {
        mode,
        rootElement: hostElement,
        selectionElement,
        target,
        projection,
        rootTargetRef,
        sourceInnerHtml,
        fragmentTargetRef,
        releaseHost: mountedFragment?.release ?? null,
        session,
        lease,
        selection: initialSelection ?? {
          anchor: projection.textLength,
          focus: projection.textLength,
          affinity: "right",
        },
      };
      activeNativeEditRef.current = active;
      retainNativeEditFocusRef.current = null;
      containerRef.current?.removeAttribute("data-edit-block-detail");
      containerRef.current?.removeAttribute("data-native-capability-detail");
      containerRef.current?.setAttribute(
        "data-native-host-mode",
        mode === "text-fragment"
          ? "v2-text-fragment"
          : "v2-editable-island",
      );
      containerRef.current?.setAttribute(
        "data-native-event-delivery-mode",
        mode === "text-fragment"
          ? "native-text-fragment"
          : "native-editable-island",
      );
      hostElement.setAttribute("data-html-canvas-editing", "true");
      activeTextRangeRef.current = priorRange
        ? { ...priorRange, target }
        : null;
      setIsEditing(true);
      setHasTextRange(Boolean(priorRange));
      setToolbarVisible(true);
      refreshNativeEditRangeState(active, active.selection);
      // Establish the native focus/caret before startEditing returns. Deferring
      // this to the next animation frame lets a fast mouse drag, keyboard
      // command, or test-set Selection win briefly and then get overwritten by
      // the stale activation point. Only overlay measurement needs a frame.
      if (initialSelection) session.focusSelection();
      else if (caretPoint) session.focusAtPoint(caretPoint);
      else session.focusSelection();
      requestAnimationFrame(() => {
        if (
          activeNativeEditRef.current?.session !== session
          || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, lease)
        ) return;
        updateOverlayPosition();
      });
      containerRef.current?.setAttribute("data-native-start-status", "started");
      return true;
    } catch (cause) {
      createdSession?.dispose();
      mountedFragment?.release();
      containerRef.current?.setAttribute(
        "data-native-start-status",
        `error:${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 500),
      );
      currentNativeEditLeaseRef.current = null;
      reportBlockedEdit(cause);
      return false;
    }
  }, [
    clearNativeEditCheckpointTimer,
    finishNativeEditing,
    refreshNativeEditRangeState,
    reportBlockedEdit,
    selectElement,
    updateOverlayPosition,
  ]);

  restartCanonicalNativeEditRef.current = (
    active,
    target,
    logicalSelection,
    previousIndex,
    nextIndex,
  ) => {
    if (
      active.mode !== "editable-island"
      ||
      activeNativeEditRef.current !== active
      || !target.nodeId
      || !active.rootElement.isConnected
    ) return false;
    const canonicalTarget = canonicalNativeHostPreview(
      active.rootElement,
      target.nodeId,
      nextIndex,
    );
    const parentNode = active.rootElement.parentNode;
    if (!canonicalTarget || !parentNode) return false;
    const nextRoot = active.rootElement.ownerDocument.importNode(
      canonicalTarget,
      true,
    );
    if (!(nextRoot instanceof active.rootElement.ownerDocument.defaultView!.HTMLElement)) {
      return false;
    }
    if (!refreshMountedPreviewSourceNodeIds(
      active.rootElement.ownerDocument,
      previousIndex,
      nextIndex,
      {
        session: active.session,
        excludeRoot: active.rootElement,
      },
    )) return false;

    clearNativeEditCheckpointTimer();
    currentNativeEditLeaseRef.current = null;
    activeNativeEditRef.current = null;
    discardPendingNativeCommands("session-ended");
    retainNativeEditFocusRef.current = null;
    // Retire the old lease and all native listeners before removing the
    // focused host. replaceChild can synchronously dispatch focusout/blur;
    // those events must not enqueue work against the new canonical island.
    active.session.fenceDispose();
    active.releaseHost?.();
    active.rootElement.removeAttribute("data-html-canvas-editing");
    active.rootElement.ownerDocument.getSelection()?.removeAllRanges();
    nativeDomGenerationRef.current += 1;
    parentNode.replaceChild(nextRoot, active.rootElement);

    nativeEditNeedsReloadRef.current = false;
    selectedElementRef.current = nextRoot;
    selectedSourceSelectionRef.current = target;
    activeTextRangeRef.current = null;
    setIsEditing(false);
    setHasTextRange(false);
    selectElement(nextRoot, "part", {
      preserveTextSelection: true,
      showToolbar: true,
    });
    return startEditing(undefined, logicalSelection);
  };

  const moveSelected = useCallback(
    (direction: "up" | "down"): boolean => {
      if (activeNativeEditRef.current) {
        if (deferNativeCommandRef.current(
          "target-switch",
          () => {
            const committed = finishNativeEditing(true, "manual");
            if (committed.ok) window.queueMicrotask(() => moveSelected(direction));
          },
          { direction },
        )) return true;
        const committed = finishNativeEditing(true, "manual");
        if (!committed.ok || committed.frameReloading) return false;
      }
      const element = selectedElementRef.current;
      if (
        readOnlyRef.current ||
        !enableReorderRef.current
      ) {
        return false;
      }

      const sourceIndex = sourceIndexRef.current;
      const logicalSelection = element?.isConnected
        ? selectionForElement(
          element,
          sourceIndex,
          selectedSourceSelectionRef.current ?? undefined,
        )
        : selectedSourceSelectionRef.current;
      if (!sourceIndex || !logicalSelection) return false;
      if (
        logicalSelection.level === "insertion"
        || logicalSelection.resolution === "ambiguous"
        || logicalSelection.resolution === "orphaned"
      ) {
        reportBlockedEdit(new Error("选中内容在画布刷新期间无法安全定位。"));
        return false;
      }

      let resolution: ReturnType<typeof resolveTargetRef>;
      try {
        resolution = resolveTargetRef(
          sourceIndex,
          sourceTargetRefForSelection(logicalSelection),
        );
      } catch (cause) {
        reportBlockedEdit(cause);
        return false;
      }
      const sourceElement = resolution.target;
      const sourceParent = sourceElement?.type === "element" && sourceElement.parentId
        ? sourceIndex.byNodeId.get(sourceElement.parentId)
        : null;
      if (
        !sourceElement
        || sourceElement.type !== "element"
        || sourceParent?.type !== "element"
        || ["body", "html"].includes(sourceElement.tagName)
        || ["html", "head"].includes(sourceParent.tagName)
      ) {
        reportBlockedEdit(new Error("无法确认同级内容的源码顺序。"));
        return false;
      }

      const beforeIndex = sourceParent.childElementIds.indexOf(sourceElement.nodeId);
      const nextIndex = beforeIndex + (direction === "up" ? -1 : 1);
      const siblingId = sourceParent.childElementIds[nextIndex];
      const sourceSibling = siblingId ? sourceIndex.byNodeId.get(siblingId) : null;
      if (
        beforeIndex < 0
        || sourceSibling?.type !== "element"
      ) {
        setMoveAvailability(sourceMoveAvailability(sourceIndex, logicalSelection));
        return false;
      }

      const refreshedTargetRef = createTargetRef(sourceIndex, sourceElement, {
        targetId: logicalSelection.id,
        label: logicalSelection.label,
        level: logicalSelection.level === "module" ? "module" : "subregion",
      }) as SourceTargetRef;
      const targetBeforeMove = selectionFromRefreshedTarget(
        logicalSelection,
        refreshedTargetRef,
        sourceElement.nodeId,
      );
      selectedSourceSelectionRef.current = targetBeforeMove;
      const nextSelection: HtmlCanvasSelection = {
        ...targetBeforeMove,
        resolution: "rebound",
      };
      const mutation: HtmlCanvasMutation = {
        kind: "reorder",
        target: nextSelection,
        property: "siblingIndex",
        before: {
          parentSelector: sourceParent.selector,
          index: beforeIndex,
          elementSelector: targetBeforeMove.selector,
          elementTargetId: targetBeforeMove.id,
        },
        after: {
          parentSelector: sourceParent.selector,
          index: nextIndex,
          elementSelector: targetBeforeMove.selector,
          elementTargetId: targetBeforeMove.id,
        },
      };
      return Boolean(applySourceCommand({
        type: "reorder-sibling",
        targetRef: sourceTargetRefForSelection(targetBeforeMove),
        toIndex: nextIndex,
        beforeOrder: [...sourceParent.childElementIds],
        expectedSourceSha256: sourceIndex?.sourceSha256 || "",
      }, mutation));
    },
    [applySourceCommand, finishNativeEditing, reportBlockedEdit],
  );

  const selectInsertionPoint = useCallback(
    (
      point: InsertionPoint,
      requestComment = false,
      fromQueuedCommand = false,
    ): HtmlCanvasSelection => {
      pendingFrameRestoreEpochRef.current += 1;
      if (lockedRef.current) return point.selection;
      if (
        !fromQueuedCommand
        && deferNativeCommandRef.current(
          "target-switch",
          () => selectInsertionPoint(point, requestComment, true),
          { targetId: point.selection.id },
        )
      ) return activeNativeEditRef.current?.target ?? point.selection;
      const committed = finishNativeEditing(true, "manual");
      if (!committed.ok) return activeNativeEditRef.current?.target ?? point.selection;
      selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
      selectedElementRef.current = null;
      selectedSourceSelectionRef.current = null;
      activeTextRangeRef.current = null;
      resizeObserverRef.current?.disconnect();
      setOverlayPosition(null);
      setToolbarVisible(false);
      setHasTextRange(false);
      setMoveAvailability({ up: false, down: false });
      setSelectedInsertionId(point.selection.id);
      setSelection(point.selection);
      onSelectRef.current?.(point.selection);
      requestAnimationFrame(updateOverlayPosition);
      if (requestComment) requestCommentForTarget(point.selection);
      return point.selection;
    },
    [finishNativeEditing, requestCommentForTarget, updateOverlayPosition],
  );

  const selectTarget = useCallback(
    (
      target: HtmlCanvasSelection,
      options: { reveal?: boolean; showToolbar?: boolean } = {},
    ): HtmlCanvasSelection | null => {
      pendingFrameRestoreEpochRef.current += 1;
      if (lockedRef.current) return null;
      const documentNode = iframeRef.current?.contentDocument;
      const sourceIndex = sourceIndexRef.current;
      if (!documentNode || !sourceIndex) return null;
      activeTextRangeRef.current = null;
      setHasTextRange(false);
      setToolbarVisible(Boolean(options.showToolbar));
      try {
        const resolution = resolveTargetRef(
          sourceIndex,
          sourceTargetRefForSelection(target),
        );
        if (target.level === "insertion") {
          selectedSourceSelectionRef.current = null;
          if (!resolution.target || resolution.target.type !== "insertion-point") {
            const unresolved = {
              ...target,
              resolution: resolution.resolution as HtmlCanvasTargetResolution,
            };
            setSelection(unresolved);
            onSelectRef.current?.(unresolved);
            return unresolved;
          }
          const insertionPoint = insertionPointsRef.current.find(
            (point) => (
              point.selection.sourceAnchor?.startOffset === resolution.target.offset
            ),
          );
          if (!insertionPoint) {
            return { ...target, resolution: "orphaned" };
          }
          return selectInsertionPoint({
            ...insertionPoint,
            selection: {
              ...insertionPoint.selection,
              id: target.id,
              resolution: resolution.resolution as HtmlCanvasTargetResolution,
            },
          });
        }
        if (!resolution.target || resolution.target.type !== "element") {
          const unresolved = {
            ...target,
            resolution: resolution.resolution as HtmlCanvasTargetResolution,
          };
          selectedSourceSelectionRef.current = unresolved;
          setSelection(unresolved);
          onSelectRef.current?.(unresolved);
          return unresolved;
        }
        const nodeId = String(resolution.target.nodeId);
        const escapedNodeId = nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        const element = documentNode.querySelector<HTMLElement>(
          `[${SOURCE_NODE_ATTRIBUTE}="${escapedNodeId}"]`,
        );
        if (!element) return {
          ...target,
          resolution: "orphaned",
        };
        if (
          options.reveal !== false
          && !isRenderedCommentTarget(element)
        ) {
          activateContainingTab(element);
        }
        const selectedValue = selectionForElement(
          element,
          sourceIndex,
          target,
          resolution.resolution as HtmlCanvasTargetResolution,
        );
        selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
        selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
        selectedElementRef.current = element;
        selectedSourceSelectionRef.current = selectedValue;
        element.setAttribute("data-html-canvas-selected", selectedValue.level);
        const isGlobalPage = isPageRootElement(element) && selectedValue.level === "module";
        element.toggleAttribute(GLOBAL_SELECTION_ATTRIBUTE, isGlobalPage);
        setSpacingMenuOpen(false);
        setSelection(selectedValue);
        setSelectedInsertionId(null);
        onSelectRef.current?.(selectedValue);
        updateSelectedStyle();
        updateMoveAvailability();
        observeSelectedElement(element);
        if (options.reveal !== false) {
          if (isGlobalPage) {
            const scrollingElement = documentNode.scrollingElement;
            if (scrollingElement) scrollingElement.scrollTop = 0;
            documentNode.documentElement.scrollTop = 0;
            documentNode.body.scrollTop = 0;
            documentNode.defaultView?.scrollTo({
              top: 0,
              left: 0,
              behavior: "auto",
            });
          } else {
            element.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
          }
        }
        requestAnimationFrame(updateOverlayPosition);
        return selectedValue;
      } catch (cause) {
        reportBlockedEdit(cause);
        return {
          ...target,
          resolution: "orphaned",
        };
      }
    },
    [
      observeSelectedElement,
      reportBlockedEdit,
      selectInsertionPoint,
      updateMoveAvailability,
      updateOverlayPosition,
      updateSelectedStyle,
    ],
  );

  const captureTextRange = useCallback((): ActiveTextRange | null => {
    if (activeNativeEditRef.current) return activeTextRangeRef.current;
    const documentNode = iframeRef.current?.contentDocument;
    const activeRange = documentNode
      ? activeTextRangeFromDocument(documentNode, sourceIndexRef.current)
      : null;
    if (!documentNode || !activeRange?.target.nodeId) return null;
    const escapedNodeId = activeRange.target.nodeId
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    const targetElement = documentNode.querySelector<HTMLElement>(
      `[${SOURCE_NODE_ATTRIBUTE}="${escapedNodeId}"]`,
    );
    if (!targetElement) return null;
    activeTextRangeRef.current = activeRange;
    setHasTextRange(true);
    const selectedValue = selectElement(targetElement, "part", {
      preserveTextSelection: true,
      showToolbar: true,
    });
    activeTextRangeRef.current = {
      ...activeRange,
      target: selectedValue,
    };
    updateSelectedStyle();
    return activeTextRangeRef.current;
  }, [selectElement, updateSelectedStyle]);

  const installFencedDocumentGuard = useCallback((documentNode: Document) => {
    fencedDocumentCleanupRef.current();
    const stopLateNativeDelivery = (event: Event) => {
      if (event.cancelable) event.preventDefault();
      event.stopImmediatePropagation();
    };
    const eventTypes = [
      "beforeinput",
      "input",
      "compositionstart",
      "compositionupdate",
      "compositionend",
    ] as const;
    eventTypes.forEach((eventType) => {
      documentNode.addEventListener(eventType, stopLateNativeDelivery, true);
    });
    fencedDocumentCleanupRef.current = () => {
      eventTypes.forEach((eventType) => {
        documentNode.removeEventListener(eventType, stopLateNativeDelivery, true);
      });
      fencedDocumentCleanupRef.current = () => undefined;
    };
  }, []);
  installFencedDocumentGuardRef.current = installFencedDocumentGuard;

  const detachNativeEditForFence = useCallback((): NativeEditFenceBookmark | null => {
    const active = activeNativeEditRef.current;
    if (!active) return null;
    const documentNode = active.rootElement.ownerDocument;
    const activeElement = documentNode.activeElement;
    const currentTarget = active.selectionElement.isConnected
      && !nativeEditNeedsReloadRef.current
      ? selectionForElement(
          active.selectionElement,
          sourceIndexRef.current,
          active.target,
          undefined,
          "part",
        )
      : active.target;
    active.target = currentTarget;
    const liveSourceNodeId = active.selectionElement.getAttribute(SOURCE_NODE_ATTRIBUTE);
    containerRef.current?.setAttribute(
      "data-native-fence-target",
      `${liveSourceNodeId ?? "none"}:${
        liveSourceNodeId && sourceIndexRef.current?.byNodeId.has(liveSourceNodeId)
          ? "mapped"
          : "missing"
      }:${currentTarget.resolution}`,
    );
    nativeEditFenceSequenceRef.current += 1;
    const bookmark: NativeEditFenceBookmark = {
      fenceId: nativeEditFenceSequenceRef.current,
      target: currentTarget,
      selection: active.session.getSelection(),
      focus: Boolean(
        activeElement === active.rootElement
        || (activeElement && active.rootElement.contains(activeElement)),
      ),
      toolbarVisible: toolbarVisibleRef.current,
      ...(active.fragmentTargetRef
        ? { fragmentTargetRef: active.fragmentTargetRef }
        : {}),
    };
    clearNativeEditCheckpointTimer();
    currentNativeEditLeaseRef.current = null;
    activeNativeEditRef.current = null;
    discardPendingNativeCommands("session-ended");
    retainNativeEditFocusRef.current = null;
    installFencedDocumentGuard(documentNode);
    active.rootElement.removeAttribute("data-html-canvas-editing");
    active.session.fenceDispose();
    active.releaseHost?.();
    documentNode.getSelection()?.removeAllRanges();
    activeTextRangeRef.current = null;
    setIsEditing(false);
    setHasTextRange(false);
    return bookmark;
  }, [
    clearNativeEditCheckpointTimer,
    discardPendingNativeCommands,
    installFencedDocumentGuard,
  ]);

  const queueNativeFenceReload = useCallback((
    source: string,
    bookmark: NativeEditFenceBookmark | null,
    target: HtmlCanvasSelection | null,
    selection?: NativeEditSelection,
  ) => {
    nativeEditFenceSequenceRef.current += 1;
    const fenceId = nativeEditFenceSequenceRef.current;
    const expectedFrameGeneration = frameLoadGenerationRef.current + 1;
    const sourceRevision = (() => {
      try {
        return buildSourceIndex(source).sourceSha256;
      } catch {
        return "";
      }
    })();
    pendingSelectionRef.current = target;
    pendingToolbarVisibleRef.current = target
      ? bookmark?.toolbarVisible ?? toolbarVisibleRef.current
      : false;
    pendingNativeEditResumeRef.current = bookmark && target
      ? {
          ...bookmark,
          fenceId,
          target,
          selection: selection ?? bookmark.selection,
          focus: true,
          expectedFrameGeneration,
          sourceRevision,
        }
      : null;
    containerRef.current?.setAttribute(
      "data-native-fence-resume",
      `queued:${target?.id ?? "none"}:${target?.resolution ?? "none"}:${expectedFrameGeneration}`,
    );
    selectedSourceSelectionRef.current = target;
    selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
    selectedElementRef.current = null;
    resizeObserverRef.current?.disconnect();
    renderedSourceHtmlRef.current = null;
    loadFrameSource(source, { preserveViewport: true, immediate: true });
    containerRef.current?.setAttribute(
      "data-native-fence-resume",
      `loaded:${frameLoadGenerationRef.current}:${expectedFrameTokenRef.current
        && iframeRef.current?.srcdoc.includes(expectedFrameTokenRef.current)
        ? "current"
        : "stale"}`,
    );
  }, [loadFrameSource]);
  queueNativeFenceReloadRef.current = queueNativeFenceReload;

  const checkpointPendingEdit = useCallback((): HtmlCanvasCommitResult => {
    const committed = checkpointNativeEdit("manual");
    const sourceIndex = sourceIndexRef.current;
    return {
      ok: committed.ok,
      html: frameSourceHtmlRef.current,
      sourceSha256: sourceIndex?.sourceSha256 || "",
      pendingMutation: committed.mutation,
      ...(committed.reason ? { reason: committed.reason } : {}),
    };
  }, [checkpointNativeEdit]);

  const fencePendingEdit = useCallback((
    options: {
      resumeEditing?: boolean;
      preserveForHistory?: boolean;
      trigger?: NativeEditCheckpointTrigger;
    } = {},
  ): HtmlCanvasCommitResult => {
    const resumeEditing = options.resumeEditing ?? true;
    const preserveForHistory = options.preserveForHistory ?? false;
    const committed = checkpointNativeEdit(options.trigger ?? "fence", {
      deferPreviewReconcile: true,
    });
    const sourceIndex = sourceIndexRef.current;
    if (!committed.ok) {
      return {
        ok: false,
        html: frameSourceHtmlRef.current,
        sourceSha256: sourceIndex?.sourceSha256 || "",
        pendingMutation: null,
        ...(committed.reason ? { reason: committed.reason } : {}),
      };
    }

    const runtimeFrame = runtimeFrameRef.current;
    const retainsSettledRuntimeFrame = Boolean(
      resumeEditing
      && !preserveForHistory
      && activeNativeEditRef.current
      && runtimeFrame?.settled
      && runtimeFrame.elementGeneration === frameLoadGenerationRef.current
      && !nativeEditNeedsReloadRef.current
      && renderedSourceHtmlRef.current === frameSourceHtmlRef.current,
    );
    if (retainsSettledRuntimeFrame && runtimeFrame) {
      // A checkpoint has already rebased this active island against the exact
      // new source. Keep the frozen runtime DOM while editing resumes;
      // replacing this settled one-shot frame would discard the real Canvas/SVG
      // and cannot execute the author program a second time.
      pendingHistoryBookmarkRef.current = null;
      pendingHistoryCanonicalFenceRef.current = false;
      containerRef.current?.setAttribute(
        "data-native-fence-resume",
        `retained-runtime:${runtimeFrame.elementGeneration}`,
      );
      return {
        ok: true,
        html: frameSourceHtmlRef.current,
        sourceSha256: sourceIndexRef.current?.sourceSha256 || "",
        pendingMutation: committed.mutation,
      };
    }

    const bookmark = detachNativeEditForFence();
    const needsCanonicalFence = Boolean(bookmark)
      || nativeSessionNeedsCanonicalFenceRef.current;
    pendingHistoryBookmarkRef.current = preserveForHistory
      ? bookmark
      : null;
    pendingHistoryCanonicalFenceRef.current = preserveForHistory
      ? needsCanonicalFence
      : false;
    if (needsCanonicalFence && !preserveForHistory) {
      const target = resumeEditing
        ? bookmark?.target ?? selectedSourceSelectionRef.current
        : null;
      queueNativeFenceReload(
        frameSourceHtmlRef.current,
        resumeEditing ? bookmark : null,
        target,
        bookmark?.selection,
      );
    } else if (!resumeEditing && !preserveForHistory) {
      pendingFrameRestoreEpochRef.current += 1;
      pendingNativeEditResumeRef.current = null;
      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;
    }
    return {
      ok: true,
      html: frameSourceHtmlRef.current,
      sourceSha256: sourceIndexRef.current?.sourceSha256 || "",
      pendingMutation: committed.mutation,
    };
  }, [checkpointNativeEdit, detachNativeEditForFence, queueNativeFenceReload]);

  const commitPendingEdit = useCallback((): HtmlCanvasCommitResult => (
    fencePendingEdit({ resumeEditing: false })
  ), [fencePendingEdit]);

  const adoptEditableIslandHistoryInPlace = useCallback((
    source: string,
    bookmark: NativeEditFenceBookmark | null,
    target: HtmlCanvasSelection | null,
    logicalSelection?: NativeEditSelection,
  ): boolean => {
    const iframe = iframeRef.current;
    const documentNode = iframe?.contentDocument;
    const frameView = iframe?.contentWindow;
    const rootElement = selectedElementRef.current;
    const previousIndex = sourceIndexRef.current;
    const previousSource = frameSourceHtmlRef.current;
    if (
      !bookmark
      || !target
      || activeNativeEditRef.current
      || !iframe
      || !documentNode?.documentElement
      || !frameView
      || !rootElement?.isConnected
      || rootElement.ownerDocument !== documentNode
      || !previousIndex
      || previousIndex.source !== previousSource
      || renderedSourceHtmlRef.current !== previousSource
      || containerRef.current?.getAttribute("data-render-verified") !== "true"
    ) return false;

    const viewport = {
      left: frameView.scrollX,
      top: frameView.scrollY,
    };
    try {
      const previousTargetRef = sourceTargetRefForSelection(bookmark.target);
      const nextTargetRef = sourceTargetRefForSelection(target);
      const nextIndex = buildSourceIndex(source);
      if (!adoptCanonicalHistoryIslandInPlace({
        rootElement,
        previousIndex,
        nextIndex,
        previousTargetRef,
        nextTargetRef,
      })) return false;

      // The Bridge-validated bytes remain authoritative. This only advances
      // the disposable mounted projection after proving that every byte
      // outside the active editable island is unchanged.
      sourceIndexRef.current = nextIndex;
      frameSourceHtmlRef.current = source;
      renderedSourceHtmlRef.current = source;
      pendingFrameRestoreEpochRef.current += 1;
      pendingNativeEditResumeRef.current = null;
      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;
      nativeDomGenerationRef.current += 1;
      nativeEditNeedsReloadRef.current = false;
      fencedDocumentCleanupRef.current();
      applyPageViewContextToDocument(
        documentNode,
        source,
        pageViewContextRef.current,
        appliedPageViewContextRef.current,
      );
      appliedPageViewContextRef.current = pageViewContextRef.current;
      const restoredTarget = selectTarget(target, {
        reveal: false,
        showToolbar: bookmark.toolbarVisible,
      });
      if (
        !restoredTarget
        || restoredTarget.resolution === "ambiguous"
        || restoredTarget.resolution === "orphaned"
        || selectedElementRef.current !== rootElement
        || !startEditing(undefined, logicalSelection ?? bookmark.selection)
      ) throw new Error("历史文字结果无法在当前画布恢复编辑目标。");

      frameView.scrollTo({
        left: viewport.left,
        top: viewport.top,
        behavior: "auto",
      });
      containerRef.current?.setAttribute(
        "data-history-adopt-path",
        "editable-island-in-place",
      );
      containerRef.current?.setAttribute("data-render-verified", "true");
      requestAnimationFrame(updateOverlayPosition);
      return true;
    } catch {
      containerRef.current?.setAttribute(
        "data-history-adopt-path",
        "frame-reload-fallback",
      );
      return false;
    }
  }, [selectTarget, startEditing, updateOverlayPosition]);

  const adoptHistorySource = useCallback((
    source: string,
    target: HtmlCanvasSelection | null,
    selection?: NativeEditSelection | null,
  ): boolean => {
    if (activeNativeEditRef.current) detachNativeEditForFence();
    const bookmark = pendingHistoryBookmarkRef.current;
    pendingHistoryBookmarkRef.current = null;
    pendingHistoryCanonicalFenceRef.current = false;
    nativeSessionNeedsCanonicalFenceRef.current = false;
    lastEmittedHtmlRef.current = source;
    pendingHtmlEchoesRef.current = [];
    const resumeTarget = bookmark
      ? target ?? bookmark.target
      : target;
    if (adoptEditableIslandHistoryInPlace(
      source,
      bookmark,
      resumeTarget,
      selection ?? bookmark?.selection,
    )) return true;
    containerRef.current?.setAttribute(
      "data-history-adopt-path",
      "frame-reload-fallback",
    );
    queueNativeFenceReload(
      source,
      bookmark,
      resumeTarget,
      selection ?? bookmark?.selection,
    );
    return true;
  }, [
    adoptEditableIslandHistoryInPlace,
    detachNativeEditForFence,
    queueNativeFenceReload,
  ]);

  const cancelHistoryAction = useCallback((
    options: { restore?: boolean } = {},
  ): boolean => {
    const bookmark = pendingHistoryBookmarkRef.current;
    const needsCanonicalFence = pendingHistoryCanonicalFenceRef.current;
    pendingHistoryBookmarkRef.current = null;
    pendingHistoryCanonicalFenceRef.current = false;
    if (!bookmark && !needsCanonicalFence) return false;
    if (options.restore === false) return true;
    nativeSessionNeedsCanonicalFenceRef.current = false;
    queueNativeFenceReload(
      frameSourceHtmlRef.current,
      bookmark,
      bookmark?.target ?? selectedSourceSelectionRef.current,
      bookmark?.selection,
    );
    return true;
  }, [queueNativeFenceReload]);

  const freezeNow = useCallback((): HtmlCanvasFreezeSnapshot => {
    const committed = commitPendingEdit();
    if (!committed.ok) return committed;
    const frozenHtml = committed.html;
    lastEmittedHtmlRef.current = frozenHtml;
    imperativeLockRef.current = true;
    lockedRef.current = true;
    readOnlyRef.current = true;
    enableReorderRef.current = false;
    iframeRef.current?.contentDocument?.documentElement.setAttribute(
      "data-html-canvas-locked",
      "",
    );
    selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
    selectedElementRef.current = null;
    selectedSourceSelectionRef.current = null;
    resizeObserverRef.current?.disconnect();
    setSelection(null);
    setSelectedInsertionId(null);
    setOverlayPosition(null);
    setInsertionPoints([]);
    setCommentMarkers([]);
    setMoveAvailability({ up: false, down: false });
    setImperativeLocked(true);
    onSelectRef.current?.(null);
    return {
      ok: true,
      html: frozenHtml,
      sourceSha256: committed.sourceSha256,
      pendingMutation: committed.pendingMutation,
    };
  }, [commitPendingEdit]);

  const unlockNow = useCallback((): boolean => {
    imperativeLockRef.current = false;
    setImperativeLocked(false);
    if (controlledInteractionLocked) return false;
    lockedRef.current = false;
    readOnlyRef.current = readOnly;
    enableReorderRef.current = enableReorder;
    iframeRef.current?.contentDocument?.documentElement.removeAttribute(
      "data-html-canvas-locked",
    );
    requestAnimationFrame(updateOverlayPosition);
    return true;
  }, [controlledInteractionLocked, enableReorder, readOnly, updateOverlayPosition]);

  const showCommitBlocked = useCallback((reason?: string) => {
    setEditFeedback({
      code: "canvas_c12_edit_in_progress",
      title: "当前文字还在处理中",
      message: reason
        || "请点回文字完成输入；已输入的内容仍保留在画布中。",
      tone: "warning",
      sticky: false,
      recovery: "none",
    });
  }, []);

  const applyPageViewContextNow = useCallback((
    nextContext: PageViewContext | null,
  ): boolean => {
    pageViewContextRef.current = nextContext;
    const documentNode = iframeRef.current?.contentDocument;
    if (!documentNode?.documentElement) return false;
    applyPageViewContextToDocument(
      documentNode,
      frameSourceHtmlRef.current,
      nextContext,
      appliedPageViewContextRef.current,
    );
    appliedPageViewContextRef.current = nextContext;
    requestAnimationFrame(updateOverlayPosition);
    return true;
  }, [updateOverlayPosition]);

  const resolvePagePresentationAction = useCallback((
    target: HtmlCanvasSelection | null,
  ): PagePresentationAction | null => {
    const documentKey = pageViewDocumentKeyRef.current;
    const sourceIndex = sourceIndexRef.current;
    if (
      !target
      || target.level === "insertion"
      || !documentKey
      || !onPageViewContextChangeRef.current
      || lockedRef.current
      || readOnlyRef.current
      || !sourceIndex
      || sourceIndex.source !== frameSourceHtmlRef.current
    ) return null;
    return createPagePresentationAction({
      html: frameSourceHtmlRef.current,
      sourceIndex,
      documentKey,
      generation: frameLoadGenerationRef.current,
      currentContext: pageViewContextRef.current,
      targetRef: sourceTargetRefForSelection(target),
    });
  }, []);

  const executePagePresentationAction = useCallback((
    target: HtmlCanvasSelection,
    options: { selectTargetAfter?: boolean } = {},
  ): boolean => {
    const perform = (): boolean => {
      if (lockedRef.current || readOnlyRef.current) return false;
      let frameReloading = false;
      if (activeNativeEditRef.current) {
        const committed = finishNativeEditing(true, "manual");
        if (!committed.ok) return false;
        frameReloading = Boolean(committed.frameReloading);
      }
      const action = resolvePagePresentationAction(target);
      if (!action) return false;
      if (options.selectTargetAfter) {
        if (frameReloading) {
          pendingSelectionRef.current = target;
          pendingToolbarVisibleRef.current = true;
        } else {
          selectTarget(target, { reveal: false, showToolbar: true });
        }
      }
      if (action.isCurrent) {
        requestAnimationFrame(updateOverlayPosition);
        return true;
      }
      const documentKey = pageViewDocumentKeyRef.current;
      let accepted = false;
      try {
        accepted = onPageViewContextChangeRef.current?.(
          action.nextContext,
          documentKey,
        ) === true;
      } catch {
        accepted = false;
      }
      if (!accepted) return false;
      applyPageViewContextNow(action.nextContext);
      return true;
    };
    if (
      deferNativeCommandRef.current(
        "presentation-action",
        () => {
          perform();
        },
        { targetId: target.id },
      )
    ) return true;
    return perform();
  }, [
    applyPageViewContextNow,
    finishNativeEditing,
    resolvePagePresentationAction,
    selectTarget,
    updateOverlayPosition,
  ]);

  const api = useMemo<HtmlCanvasEditorHandle>(
    () => ({
      getSourceHtml: () => frameSourceHtmlRef.current,
      getRenderedSourceHtml: () => renderedSourceHtmlRef.current,
      checkpointPendingEdit,
      fencePendingEdit,
      commitPendingEdit,
      freezeNow,
      unlockNow,
      showCommitBlocked,
      hasPendingNativeEdit: () => Boolean(
        activeNativeEditRef.current?.session.isDirty()
        || activeNativeEditRef.current?.session.hasPendingDraft()
        || activeNativeEditRef.current?.session.isComposing()
      ),
      clearSelection,
      select: selectTarget,
      startEditing,
      moveSelected,
      adoptHistorySource,
      cancelHistoryAction,
      deferNativeCommand,
      applyPageViewContext: applyPageViewContextNow,
    }),
    [
      applyPageViewContextNow,
      clearSelection,
      checkpointPendingEdit,
      fencePendingEdit,
      commitPendingEdit,
      deferNativeCommand,
      freezeNow,
      moveSelected,
      adoptHistorySource,
      cancelHistoryAction,
      selectTarget,
      showCommitBlocked,
      startEditing,
      unlockNow,
    ],
  );

  useImperativeHandle(forwardedRef, () => api, [api]);

  useEffect(() => {
    applyPageViewContextNow(pageViewContext);
  }, [applyPageViewContextNow, pageViewContext]);

  useEffect(() => {
    onReady?.(api);
    return () => onReady?.(null);
  }, [api, onReady]);

  useEffect(() => {
    if (!frameInitializedRef.current) {
      frameInitializedRef.current = true;
      loadFrameSource(html);
      lastPropRef.current = { html, baseHref: resolvedBaseHref };
      return;
    }

    const previous = lastPropRef.current;
    if (previous.html === html && previous.baseHref === resolvedBaseHref) return;
    lastPropRef.current = { html, baseHref: resolvedBaseHref };

    const echoIndex = pendingHtmlEchoesRef.current.indexOf(html);
    if (echoIndex >= 0 && previous.baseHref === resolvedBaseHref) {
      pendingHtmlEchoesRef.current.splice(0, echoIndex + 1);
      lastEmittedHtmlRef.current = html;
      return;
    }
    if (html === lastEmittedHtmlRef.current && previous.baseHref === resolvedBaseHref) return;
    if (activeNativeEditRef.current) detachNativeEditForFence();
    pendingNativeEditResumeRef.current = null;
    pendingHistoryBookmarkRef.current = null;
    pendingHistoryCanonicalFenceRef.current = false;
    resetSelection(false);
    lastEmittedHtmlRef.current = null;
    pendingHtmlEchoesRef.current = [];
    loadFrameSource(html);
  }, [
    detachNativeEditForFence,
    html,
    loadFrameSource,
    resetSelection,
    resolvedBaseHref,
  ]);

  useEffect(() => {
    const handleWindowResize = () => updateOverlayPosition();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [updateOverlayPosition]);

  useEffect(() => {
    requestAnimationFrame(updateOverlayPosition);
  }, [commentedTargets, updateOverlayPosition]);

  const selectedTargetId = selection?.id ?? null;
  const hasOverlayPosition = overlayPosition !== null;
  useEffect(() => {
    if (!selectedTargetId || !hasOverlayPosition) return;
    requestAnimationFrame(updateOverlayPosition);
  }, [hasOverlayPosition, selectedTargetId, updateOverlayPosition]);

  useEffect(() => {
    const documentNode = iframeRef.current?.contentDocument;
    if (!controlledInteractionLocked && imperativeLockRef.current) {
      unlockNow();
      return;
    }
    const shouldLock = controlledInteractionLocked || imperativeLockRef.current;
    lockedRef.current = shouldLock;
    readOnlyRef.current = readOnly || shouldLock;
    enableReorderRef.current = enableReorder && !shouldLock;
    // During a frame navigation Chromium can expose a transient Document before
    // its root element exists. Lock synchronization must not abort the React
    // tree while that provisional document is being replaced.
    documentNode?.documentElement?.toggleAttribute("data-html-canvas-locked", shouldLock);
    if (shouldLock) clearSelection();
    requestAnimationFrame(updateOverlayPosition);
  }, [
    clearSelection,
    controlledInteractionLocked,
    enableReorder,
    readOnly,
    unlockNow,
    updateOverlayPosition,
  ]);

  useEffect(() => {
    return () => {
      clearNativeEditCheckpointTimer();
      currentNativeEditLeaseRef.current = null;
      const activeNativeEdit = activeNativeEditRef.current;
      activeNativeEdit?.rootElement.removeAttribute("data-html-canvas-editing");
      activeNativeEdit?.session.fenceDispose();
      activeNativeEdit?.releaseHost?.();
      activeNativeEditRef.current = null;
      discardPendingNativeCommands("unmounted");
      retainNativeEditFocusRef.current = null;
      pendingNativeEditResumeRef.current = null;
      pendingHistoryBookmarkRef.current = null;
      pendingHistoryCanonicalFenceRef.current = false;
      const runtimeFrame = runtimeFrameRef.current;
      runtimeFrameRef.current = null;
      if (runtimeFrame && !runtimeFrame.settled) {
        onEditRuntimeLoadOutcomeRef.current?.(runtimeFrame.grant, "failed");
      }
      fencedDocumentCleanupRef.current();
      cleanupFrameRef.current();
      resizeObserverRef.current?.disconnect();
    };
  }, [clearNativeEditCheckpointTimer, discardPendingNativeCommands]);

  const connectFrame = useCallback((
    iframe: HTMLIFrameElement,
    connectedFrameGeneration: number,
  ): boolean => {
    if (
      iframe !== iframeRef.current
      || connectedFrameGeneration !== frameLoadGenerationRef.current
    ) return false;
    cleanupFrameRef.current();
    const documentNode = iframe.contentDocument;
    const expectedFrameHtml = expectedFrameHtmlRef.current;
    const expectedToken = expectedFrameTokenRef.current;
    if (!documentNode?.documentElement || !expectedFrameHtml || !expectedToken) {
      renderedSourceHtmlRef.current = null;
      containerRef.current?.setAttribute("data-render-verified", "false");
      return false;
    }
    const marker = documentNode.head.querySelector<HTMLMetaElement>(
      `meta[${FRAME_VERIFICATION_ATTRIBUTE}]`,
    );
    if (
      iframe.srcdoc !== expectedFrameHtml
      || marker?.getAttribute(FRAME_VERIFICATION_ATTRIBUTE) !== expectedToken
      || marker.getAttribute("content") !== expectedToken
    ) {
      renderedSourceHtmlRef.current = null;
      containerRef.current?.setAttribute("data-render-verified", "false");
      return false;
    }
    const runtimeFrame = runtimeFrameRef.current;
    if (runtimeFrame?.elementGeneration === connectedFrameGeneration) {
      if (runtimeFrame.verificationToken !== expectedToken) {
        fallBackToStaticRuntimeFrame(runtimeFrame, "rejected");
        return false;
      }
      const root = documentNode.documentElement;
      const rawResult = root.getAttribute(EDIT_RUNTIME_RESULT_ATTRIBUTE);
      const frozen = root.getAttribute(EDIT_RUNTIME_FROZEN_ATTRIBUTE) === "true";
      if (!frozen) {
        if (rawResult) {
          try {
            const result = JSON.parse(rawResult) as { state?: unknown };
            if (result.state === "rejected") {
              fallBackToStaticRuntimeFrame(runtimeFrame, "rejected");
              return false;
            }
            if (result.state === "failed") {
              fallBackToStaticRuntimeFrame(runtimeFrame, "failed");
              return false;
            }
          } catch {
            fallBackToStaticRuntimeFrame(runtimeFrame, "rejected");
            return false;
          }
        }
        return false;
      }
      let result: unknown = null;
      try {
        result = rawResult ? JSON.parse(rawResult) : null;
      } catch {
        fallBackToStaticRuntimeFrame(runtimeFrame, "rejected");
        return false;
      }
      if (!isRuntimeFrameFrozenResult(result, runtimeFrame)) {
        fallBackToStaticRuntimeFrame(runtimeFrame, "rejected");
        return false;
      }
      if (!runtimeFrameKeepsAuthorPaint(documentNode, runtimeFrame)) {
        fallBackToStaticRuntimeFrame(runtimeFrame, "rejected");
        return false;
      }
      if (!runtimeFrame.settled) {
        runtimeFrame.settled = true;
        containerRef.current?.setAttribute(
          "data-runtime-bootstrap-count",
          String(documentNode.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length),
        );
        onEditRuntimeLoadOutcomeRef.current?.(runtimeFrame.grant, "ready");
      }
    }
    renderedSourceHtmlRef.current = frameSourceHtmlRef.current;
    containerRef.current?.setAttribute("data-render-verified", "true");
    fencedDocumentCleanupRef.current();

    let editorStyle = documentNode.head.querySelector<HTMLStyleElement>(`style[${EDITOR_STYLE_ATTRIBUTE}]`);
    if (!editorStyle) {
      editorStyle = documentNode.createElement("style");
      editorStyle.setAttribute(EDITOR_STYLE_ATTRIBUTE, "true");
      editorStyle.textContent = EDITOR_DOCUMENT_STYLES;
      documentNode.head.appendChild(editorStyle);
    }
    documentNode.documentElement.toggleAttribute("data-html-canvas-locked", lockedRef.current);
    applyPageViewContextToDocument(
      documentNode,
      frameSourceHtmlRef.current,
      pageViewContextRef.current,
      null,
    );
    appliedPageViewContextRef.current = pageViewContextRef.current;
    const handleClick = (event: MouseEvent) => {
      if (isCanvasRootElement(event.target)) {
        if (!lockedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          clearSelection();
        }
        return;
      }
      // Authored controls remain selectable/editable content in the Canvas,
      // never live navigation or form controls. Suppress their browser action
      // before the active-edit fast path so a second click cannot navigate the
      // iframe away from the verified source document.
      const nativeActionTarget = findNativeActionTarget(event.target);
      if (nativeActionTarget) event.preventDefault();
      const target = findCanvasSelectionElement(event.target);
      if (!target) return;
      if (lockedRef.current) {
        if (target.closest(
          "a, button, form, input, select, summary, textarea, [contenteditable], [role=\"tab\"], [aria-expanded][aria-controls]",
        )) {
          event.preventDefault();
        }
        return;
      }
      const targetSelection = selectionForElement(
        target,
        sourceIndexRef.current,
      );
      if (
        event.altKey
        && resolvePagePresentationAction(targetSelection)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail === 1) {
          executePagePresentationAction(targetSelection, {
            selectTargetAfter: true,
          });
        }
        return;
      }
      if (isModulePaddingHit(target, event)) {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
        return;
      }
      const selectedElement = selectedElementRef.current;
      if (
        selectedElement
        && event.target instanceof Node
        && !selectedElement.contains(event.target)
      ) {
        event.preventDefault();
        event.stopPropagation();
        clearSelection();
        return;
      }
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) return;
      const activeEdit = activeNativeEditRef.current;
      if (activeEdit?.mode === "text-fragment") {
        const committed = finishNativeEditing(true, "manual");
        if (!committed.ok || committed.frameReloading) return;
      }
      if (captureTextRange()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectElement(target);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      if (findNativeActionTarget(event.target)) event.preventDefault();
      const target = findCanvasSelectionElement(event.target);
      if (!target) return;
      if (target.hasAttribute(EDIT_RUNTIME_HOST_ATTRIBUTE)) {
        event.preventDefault();
        event.stopPropagation();
        if (!lockedRef.current) selectElement(target);
        return;
      }
      if (
        event.altKey
        && resolvePagePresentationAction(selectionForElement(
          target,
          sourceIndexRef.current,
        ))
      ) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) return;
      const activeEdit = activeNativeEditRef.current;
      if (activeEdit?.mode === "text-fragment") {
        const committed = finishNativeEditing(true, "manual");
        if (!committed.ok || committed.frameReloading) return;
      }
      const caretPoint = caretPointFromMouseEvent(event);
      const nativeSelection = documentNode.getSelection();
      let nativeRange = nativeSelection
        && nativeSelection.rangeCount === 1
        && !nativeSelection.isCollapsed
        && Boolean(nativeSelection.toString().trim())
        ? nativeSelection.getRangeAt(0).cloneRange()
        : null;
      if (
        nativeRange
        && !nativeTextRangeMatchesActivation(nativeRange, target, caretPoint)
      ) {
        nativeRange = null;
        nativeSelection?.removeAllRanges();
      }
      if (!nativeRange) {
        nativeRange = selectWordAtPoint(
          documentNode,
          target,
          caretPoint,
        );
      }
      setSpacingMenuOpen(false);
      if (lockedRef.current) return;
      if (
        nativeRange
        && nativeRange.startContainer.isConnected
        && nativeRange.endContainer.isConnected
      ) {
        // Preserve Chromium's real double-click word range before changing
        // selection chrome or enabling contenteditable. Source mapping then
        // converts the exact forward/backward browser range to logical offsets.
        const selection = documentNode.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(nativeRange);
      }
      const capturedRange = nativeRange ? captureTextRange() : null;
      if (!capturedRange) {
        containerRef.current?.setAttribute(
          "data-native-start-status",
          "direct-text-hit-required",
        );
        selectElement(target, undefined, {
          preserveTextSelection: Boolean(nativeRange),
        });
      }
      const editingStarted = capturedRange
        ? startEditing()
        : nativeRange
          ? startEditing(caretPoint)
          : false;
      if (editingStarted) {
        // Cancel the remaining dblclick default only after the native range has
        // been captured and the authored host owns focus. This avoids erasing
        // the browser's word Selection before the edit session exists.
        event.preventDefault();
        event.stopPropagation();
      }
      if (
        !editingStarted
        && nativeRange
        && nativeRange.startContainer.isConnected
        && nativeRange.endContainer.isConnected
      ) {
        const restoredSelection = documentNode.getSelection();
        restoredSelection?.removeAllRanges();
        restoredSelection?.addRange(nativeRange);
        captureTextRange();
        // The browser's post-dblclick default can collapse the range again on
        // dedicated/fallback surfaces (notably <pre><code>). Once PageRoot has
        // restored the exact authored word range, keep it as the stable
        // selection/comment target.
        event.preventDefault();
        event.stopPropagation();
      }
    };

    let disabledButtonPointer:
      | { target: Element; timeStamp: number; x: number; y: number }
      | null = null;
    const handleDisabledButtonPointerDown = (event: PointerEvent) => {
      const eventElement = event.target as Element | null;
      const disabledButton = eventElement?.closest?.("button:disabled");
      if (!disabledButton) {
        disabledButtonPointer = null;
        return;
      }
      const previous = disabledButtonPointer;
      const isSecondPress = Boolean(
        previous
        && previous.target === disabledButton
        && event.timeStamp - previous.timeStamp <= 600
        && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 6,
      );
      disabledButtonPointer = isSecondPress
        ? null
        : {
            target: disabledButton,
            timeStamp: event.timeStamp,
            x: event.clientX,
            y: event.clientY,
          };
      if (!isSecondPress) return;
      // Chromium intentionally suppresses click/dblclick for disabled form
      // controls. In the Canvas the authored label is still page text, so the
      // second pointer press must enter the same V2 island path explicitly.
      handleDoubleClick(event);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey)
        && event.shiftKey
        && event.key.toLowerCase() === "e"
      ) {
        event.preventDefault();
        event.stopPropagation();
        onRequestExportRef.current?.();
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopPropagation();
        const save = () => {
          if (!lockedRef.current) {
            if (!fencePendingEdit({
              resumeEditing: true,
              trigger: "save",
            }).ok) return;
          }
          onRequestFlushRef.current?.();
        };
        if (deferNativeCommandRef.current("save", save)) return;
        save();
        return;
      }
      const activeNativeEdit = activeNativeEditRef.current;
      if (activeNativeEdit?.rootElement.contains(event.target as Node)) {
        const formatShortcut = (
          (event.metaKey || event.ctrlKey)
          && !event.altKey
        )
          ? ({
              b: "bold",
              i: "italic",
              u: "underline",
            } as const)[event.key.toLowerCase() as "b" | "i" | "u"]
          : null;
        if (formatShortcut) {
          event.preventDefault();
          event.stopPropagation();
          applyNativeFormatShortcutRef.current(formatShortcut);
          return;
        }
        const historyDirection = sourceHistoryDirectionForShortcut(event);
        if (historyDirection) {
          event.preventDefault();
          event.stopPropagation();
          onRequestHistoryRef.current?.(historyDirection);
          return;
        }
        if (event.key === "Escape") {
          const compositionWasActive = activeNativeEdit.session.isComposing();
          if (activeNativeEdit.session.consumeCompositionEscape()) {
            // This listener runs in document capture before the authored host.
            // Let a live IME keep the native default, but stop PageRoot from
            // interpreting either the live or trailing Escape as session exit.
            if (!compositionWasActive) event.preventDefault();
            event.stopPropagation();
            return;
          }
          event.preventDefault();
          finishNativeEditing(true);
        }
        return;
      }
      if (
        (event.key === "Enter" || event.key === " ")
        && findNativeActionTarget(event.target)
      ) {
        event.preventDefault();
      }
      if (lockedRef.current) return;
      const historyDirection = sourceHistoryDirectionForShortcut(event);
      if (historyDirection) {
        event.preventDefault();
        event.stopPropagation();
        onRequestHistoryRef.current?.(historyDirection);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
        return;
      }
      if (
        event.key === "Enter"
        && selectedElementRef.current
        && !selectedElementRef.current.hasAttribute(EDIT_RUNTIME_HOST_ATTRIBUTE)
      ) {
        event.preventDefault();
        startEditing();
        return;
      }
      if (event.altKey && event.key === "ArrowUp") {
        event.preventDefault();
        moveSelected("up");
      }
      if (event.altKey && event.key === "ArrowDown") {
        event.preventDefault();
        moveSelected("down");
      }
    };

    const handleBeforeInput = (event: InputEvent) => {
      const eventElement = event.target instanceof documentNode.defaultView!.Element
        ? event.target
        : null;
      const insideNativeEdit = Boolean(
        activeNativeEditRef.current?.rootElement.contains(event.target as Node),
      );
      if (
        lockedRef.current
        || (
          !insideNativeEdit
          && Boolean(eventElement?.closest("[contenteditable]"))
        )
      ) event.preventDefault();
    };

    const handleMouseDown = (event: MouseEvent) => {
      onInteractionRef.current?.();
      setSpacingMenuOpen(false);
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) {
        return;
      }
      activeTextRangeRef.current = null;
      setHasTextRange(false);
      const nativeActionTarget = findNativeActionTarget(event.target);
      if (nativeActionTarget && ["INPUT", "SELECT", "TEXTAREA"].includes(nativeActionTarget.tagName)) {
        event.preventDefault();
      }
    };

    const handleMouseUp = () => {
      if (!lockedRef.current) captureTextRange();
    };

    const handleSubmit = (event: SubmitEvent) => {
      event.preventDefault();
      event.stopPropagation();
    };

    const handleLockedTransfer = (event: ClipboardEvent | DragEvent) => {
      if (lockedRef.current) event.preventDefault();
    };

    const handleScroll = () => updateOverlayPosition();
    const LayoutResizeObserver = documentNode.defaultView?.ResizeObserver;
    const layoutObserver = LayoutResizeObserver
      ? new LayoutResizeObserver(() => updateOverlayPosition())
      : null;
    if (documentNode.body) layoutObserver?.observe(documentNode.body);
    documentNode.addEventListener("click", handleClick, true);
    documentNode.addEventListener("mousedown", handleMouseDown, true);
    documentNode.addEventListener("mouseup", handleMouseUp, true);
    documentNode.addEventListener(
      "pointerdown",
      handleDisabledButtonPointerDown,
      true,
    );
    documentNode.addEventListener("dblclick", handleDoubleClick, true);
    documentNode.addEventListener("beforeinput", handleBeforeInput, true);
    documentNode.addEventListener("paste", handleLockedTransfer, true);
    documentNode.addEventListener("drop", handleLockedTransfer, true);
    documentNode.addEventListener("submit", handleSubmit, true);
    documentNode.addEventListener("keydown", handleKeyDown, true);
    documentNode.addEventListener("scroll", handleScroll, true);

    cleanupFrameRef.current = () => {
      documentNode.removeEventListener("click", handleClick, true);
      documentNode.removeEventListener("mousedown", handleMouseDown, true);
      documentNode.removeEventListener("mouseup", handleMouseUp, true);
      documentNode.removeEventListener(
        "pointerdown",
        handleDisabledButtonPointerDown,
        true,
      );
      documentNode.removeEventListener("dblclick", handleDoubleClick, true);
      documentNode.removeEventListener("beforeinput", handleBeforeInput, true);
      documentNode.removeEventListener("paste", handleLockedTransfer, true);
      documentNode.removeEventListener("drop", handleLockedTransfer, true);
      documentNode.removeEventListener("submit", handleSubmit, true);
      documentNode.removeEventListener("keydown", handleKeyDown, true);
      documentNode.removeEventListener("scroll", handleScroll, true);
      layoutObserver?.disconnect();
    };
    const pendingSelection = pendingSelectionRef.current;
    const pendingToolbarVisible = pendingToolbarVisibleRef.current;
    const pendingViewport = pendingFrameViewportRef.current;
    const pendingNativeResume = pendingNativeEditResumeRef.current;
    const pendingRestoreEpoch = pendingFrameRestoreEpochRef.current;
    containerRef.current?.setAttribute(
      "data-native-fence-resume",
      `connected:${connectedFrameGeneration}:${pendingSelection?.id ?? "none"}:${pendingNativeResume?.fenceId ?? "none"}`,
    );
    pendingSelectionRef.current = null;
    pendingToolbarVisibleRef.current = false;
    pendingFrameViewportRef.current = null;
    requestAnimationFrame(() => {
      if (
        iframe.contentDocument !== documentNode
        || frameLoadGenerationRef.current !== connectedFrameGeneration
        || expectedFrameTokenRef.current !== expectedToken
        || pendingFrameRestoreEpochRef.current !== pendingRestoreEpoch
      ) {
        if (
          pendingNativeResume
          && pendingNativeEditResumeRef.current?.fenceId === pendingNativeResume.fenceId
        ) pendingNativeEditResumeRef.current = null;
        containerRef.current?.setAttribute(
          "data-native-fence-resume",
          `stale-frame:${[
            iframe.contentDocument === documentNode ? null : "document",
            frameLoadGenerationRef.current === connectedFrameGeneration ? null : "generation",
            expectedFrameTokenRef.current === expectedToken ? null : "token",
            pendingFrameRestoreEpochRef.current === pendingRestoreEpoch ? null : "restore",
          ].filter(Boolean).join(",")}`,
        );
        return;
      }
      if (pendingViewport) {
        documentNode.defaultView?.scrollTo({
          left: pendingViewport.left,
          top: pendingViewport.top,
          behavior: "auto",
        });
      }
      if (pendingSelection && !lockedRef.current) {
        const restoredTarget = selectTarget(pendingSelection, {
          reveal: false,
          showToolbar: pendingToolbarVisible,
        });
        containerRef.current?.setAttribute(
          "data-native-fence-resume",
          `selected:${restoredTarget?.id ?? "none"}:${[
            pendingNativeResume ? null : "no-resume",
            pendingNativeResume?.expectedFrameGeneration === connectedFrameGeneration
              ? null
              : "generation",
            pendingNativeResume?.sourceRevision === sourceIndexRef.current?.sourceSha256
              ? null
              : "revision",
            pendingNativeEditResumeRef.current?.fenceId === pendingNativeResume?.fenceId
              ? null
              : "fence",
          ].filter(Boolean).join(",")}`,
        );
        if (
          pendingNativeResume
          && pendingNativeResume.expectedFrameGeneration === connectedFrameGeneration
          && pendingNativeResume.sourceRevision === sourceIndexRef.current?.sourceSha256
          && pendingNativeEditResumeRef.current?.fenceId === pendingNativeResume.fenceId
        ) {
          pendingNativeEditResumeRef.current = null;
          if (
            pendingNativeResume.fragmentTargetRef
            && restoredTarget
            && selectedElementRef.current
            && sourceIndexRef.current
          ) {
            const restoredFragmentRange = activeRangeForTextFragmentTarget(
              selectedElementRef.current,
              sourceIndexRef.current,
              restoredTarget,
              pendingNativeResume.fragmentTargetRef,
            );
            activeTextRangeRef.current = restoredFragmentRange;
            setHasTextRange(Boolean(restoredFragmentRange));
          }
          const resumed = startEditing(undefined, pendingNativeResume.selection);
          containerRef.current?.setAttribute(
            "data-native-fence-resume",
            resumed
              ? "resumed"
              : `resume-failed:${restoredTarget?.resolution ?? "none"}:${
                  selectedElementRef.current ? "selected" : "missing"
                }`,
          );
        }
      } else {
        if (
          pendingNativeResume
          && pendingNativeEditResumeRef.current?.fenceId === pendingNativeResume.fenceId
        ) pendingNativeEditResumeRef.current = null;
        updateOverlayPosition();
      }
    });
    return true;
  }, [
    captureTextRange,
    clearSelection,
    executePagePresentationAction,
    fencePendingEdit,
    finishNativeEditing,
    moveSelected,
    resolvePagePresentationAction,
    selectElement,
    selectTarget,
    startEditing,
    updateOverlayPosition,
    fallBackToStaticRuntimeFrame,
  ]);

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    const connectedFrameGeneration = frameRender.elementGeneration;
    let animationFrame = 0;
    let attempts = 0;
    const startedAt = performance.now();
    const connectParsedFrame = () => {
      if (
        iframe !== iframeRef.current
        || connectedFrameGeneration !== frameLoadGenerationRef.current
      ) return;
      const documentNode = iframe.contentDocument;
      const expectedFrameHtml = expectedFrameHtmlRef.current;
      const expectedToken = expectedFrameTokenRef.current;
      const marker = documentNode?.head?.querySelector<HTMLMetaElement>(
        `meta[${FRAME_VERIFICATION_ATTRIBUTE}]`,
      );
      if (
        documentNode?.documentElement
        && expectedFrameHtml
        && expectedToken
        && iframe.srcdoc === expectedFrameHtml
        && marker?.getAttribute(FRAME_VERIFICATION_ATTRIBUTE) === expectedToken
        && marker.getAttribute("content") === expectedToken
      ) {
        // Static documents connect after parsing; a direct runtime connects
        // only after the bootstrap has reported a valid frozen audit result.
        if (connectFrame(iframe, connectedFrameGeneration)) return;
      }
      const runtimeFrame = runtimeFrameRef.current;
      if (
        runtimeFrame?.elementGeneration === connectedFrameGeneration
        && !runtimeFrame.settled
        && performance.now() - startedAt >= EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs
      ) {
        fallBackToStaticRuntimeFrame(runtimeFrame, "failed");
        return;
      }
      attempts += 1;
      const retryLimit = runtimeFrame?.elementGeneration === connectedFrameGeneration
        && !runtimeFrame.settled
        ? Math.ceil(EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs / 16) + 30
        : 120;
      if (attempts < retryLimit) {
        animationFrame = requestAnimationFrame(connectParsedFrame);
      }
    };
    animationFrame = requestAnimationFrame(connectParsedFrame);
    return () => cancelAnimationFrame(animationFrame);
  }, [
    connectFrame,
    fallBackToStaticRuntimeFrame,
    frameRender.elementGeneration,
    frameRender.html,
  ]);

  const applyInlineStyle = useCallback(
    (
      property: EditableStyleProperty,
      value: string,
      fromQueuedCommand = false,
    ) => {
      let element = selectedElementRef.current;
      if (readOnlyRef.current || !element) return;
      let view = element.ownerDocument.defaultView;
      const config = STYLE_PROPERTY_CONFIGS.find((entry) => entry.property === property);
      if (!config) return;
      const sourceInfo = selectedStyle.sources.find((entry) => entry.property === property);
      let activeNativeEdit = activeNativeEditRef.current;
      if (
        activeNativeEdit
        && !fromQueuedCommand
        && deferNativeCommandRef.current(
          "format",
          () => applyInlineStyle(property, value, true),
          { selection: activeNativeEdit.session.getSelection(), property, value },
        )
      ) return;
      if (activeNativeEdit) {
        const checkpoint = checkpointNativeEdit("style");
        if (!checkpoint.ok) return;
        activeNativeEdit = activeNativeEditRef.current;
        if (!activeNativeEdit) return;
        element = selectedElementRef.current;
        if (
          !element
          || !element.isConnected
          || element !== activeNativeEdit.selectionElement
        ) {
          reportBlockedEdit(new Error(
            "格式提交后的文字宿主没有精确重绑，已停止继续修改。",
          ));
          return;
        }
        view = element.ownerDocument.defaultView;
        refreshNativeEditRangeState(
          activeNativeEdit,
          activeNativeEdit.session.getSelection(),
        );
      }
      const activeRange = activeTextRangeRef.current;
      if (
        activeNativeEdit
        && TEXT_RANGE_EDITABLE_PROPERTIES.has(property)
        && !activeRange
      ) {
        reportBlockedEdit(new Error("请先在编辑中的文字里选择具体范围，再修改文字格式。"));
        return;
      }
      if (
        activeNativeEdit?.mode === "text-fragment"
        && activeRange
        && TEXT_RANGE_EDITABLE_PROPERTIES.has(property)
      ) {
        // A bare-text fragment deliberately accepts text only. Inline-style
        // controller commands would add a <span> inside that fragment, which
        // its normalizer correctly rejects. Finish the transient native host
        // first, then let the guarded source-range patch below own the wrapper.
        // Keep the captured range: finishNativeEditing clears the live range
        // as part of retiring the fragment session.
        const committed = finishNativeEditing(true, "style");
        if (!committed.ok || committed.frameReloading) return;
        activeNativeEdit = null;
        element = selectedElementRef.current;
        if (!element || !element.isConnected) {
          reportBlockedEdit(new Error(
            "文字片段提交后的宿主没有精确重绑，已停止继续修改。",
          ));
          return;
        }
        view = element.ownerDocument.defaultView;
      }
      if (
        activeNativeEdit
        && activeRange
        && TEXT_RANGE_EDITABLE_PROPERTIES.has(property)
      ) {
        if (!activeNativeEdit.session.applyInlineStyle(
          config.cssProperty,
          value,
          Boolean(sourceInfo?.important),
        )) {
          reportBlockedEdit(new Error("当前选区无法安全应用这个文字格式。"));
          return;
        }
        checkpointNativeEdit("style");
        return;
      }
      if (
        activeNativeEdit
        && !(activeRange && TEXT_RANGE_EDITABLE_PROPERTIES.has(property))
      ) {
        const committed = finishNativeEditing(true, "style");
        if (!committed.ok) return;
      }
      if (activeRange && TEXT_RANGE_EDITABLE_PROPERTIES.has(property)) {
        const sourceIndex = sourceIndexRef.current;
        if (!sourceIndex) return;
        const command = {
          type: "set-text-range-style" as const,
          targetRef: sourceTargetRefForSelection(activeRange.target),
          segments: activeRange.segments,
          property: config.cssProperty,
          value,
          ...(sourceInfo?.important ? { important: true } : {}),
          expectedSourceSha256: sourceIndex.sourceSha256,
        };
        try {
          const previewPlan = planSourcePatch(command, sourceIndex);
          if (!previewPlan) throw new Error("无法为当前文字格式生成安全 Patch。");
          const createsRangeWrapper = previewPlan.patches.some(
            (patch: { kind?: string }) => patch.kind === "text-range-style-open",
          );
          const sourceTextParents = createsRangeWrapper
            ? sourceTextParentsForSegments(element, activeRange.segments, sourceIndex)
            : [];
          if (createsRangeWrapper && !sourceTextParents) {
            reportBlockedEdit(new Error(
              "当前文字的布局节点与源码映射不完整，本次格式修改已阻止。",
            ));
            return;
          }
          const hasFlexOrGridTextParent = sourceTextParents?.some((parent) => (
            ["flex", "inline-flex", "grid", "inline-grid"].includes(
              parent.ownerDocument.defaultView?.getComputedStyle(parent).display || "",
            )
          ));
          if (
            createsRangeWrapper
            && hasFlexOrGridTextParent
          ) {
            reportBlockedEdit(new Error(
              "选区的直接文字容器使用 flex/grid，新包装会改变间距；本次格式修改已阻止。请选择已有的完整样式片段。",
            ));
            return;
          }
          if (createsRangeWrapper && property === "backgroundColor") {
            reportBlockedEdit(new Error(
              "局部填充色需要新增可见盒子，可能改变原页间距；本次修改已阻止。选中已有完整样式片段时仍可修改。",
            ));
            return;
          }
        } catch (cause) {
          reportBlockedEdit(cause);
          return;
        }
        const mutation: HtmlCanvasMutation = {
          kind: "style",
          target: activeRange.target,
          property,
          before: {
            text: activeRange.text,
            segments: activeRange.segments,
          },
          after: {
            text: activeRange.text,
            property: config.cssProperty,
            value,
            priority: sourceInfo?.important ? "important" : null,
          },
        };
        applySourceCommand(command, mutation, {
          validateResult: (candidate) => {
            const expectedTargetId = activeNativeEdit?.rootTargetRef.targetId
              ?? activeRange.target.id;
            const operationTargetRef = candidate.refreshedTargetRefs.find(
              (targetRef: SourceTargetRef) => targetRef.targetId === expectedTargetId,
            );
            if (!operationTargetRef || operationTargetRef.resolution !== "exact") {
              throw new Error("文字宿主无法在格式 Patch 后精确重绑，已停止提交。");
            }
            buildSourceTextMap(
              candidate.sourceIndex,
              operationTargetRef,
              { allowEmpty: true },
            );
          },
        });
        return;
      }
      const target = selectionForElement(element, sourceIndexRef.current);
      const sourceValue = element.style.getPropertyValue(config.cssProperty);
      const computedValue =
        view?.getComputedStyle(element).getPropertyValue(config.cssProperty).trim()
        || "";
      const mutation: HtmlCanvasMutation = {
        kind: "style",
        target,
        property,
        before: {
          sourceValue: sourceValue || null,
          computedValue,
          priority: element.style.getPropertyPriority(config.cssProperty) || null,
          provenance: sourceInfo
            ? {
                kind: sourceInfo.kind,
                selector: sourceInfo.selector,
                source: sourceInfo.source,
                mediaCondition: sourceInfo.mediaCondition,
                sharedImpactCount: sourceInfo.sharedImpactCount,
              }
            : null,
        },
        after: {
          sourceValue: value,
          computedValue: value,
          priority: sourceInfo?.important ? "important" : null,
          provenance: {
            kind: "inline",
            selector: "style attribute",
            source: "direct canvas edit",
            mediaCondition: "",
            sharedImpactCount: 1,
          },
        },
      };
      applySourceCommand({
        type: "set-inline-style",
        targetRef: sourceTargetRefForSelection(target),
        property: config.cssProperty,
        value,
        ...(sourceInfo?.important ? { important: true } : {}),
        expectedSourceSha256: sourceIndexRef.current?.sourceSha256 || "",
      }, mutation);
    },
    [
      applySourceCommand,
      checkpointNativeEdit,
      finishNativeEditing,
      refreshNativeEditRangeState,
      reportBlockedEdit,
      selectedStyle.sources,
    ],
  );

  const applyNativeFormatShortcut = useCallback((
    shortcut: NativeFormatShortcut,
  ): boolean => {
    const active = activeNativeEditRef.current;
    if (!active) return false;
    const nativeSelection = active.session.getSelection();
    refreshNativeEditRangeState(active, nativeSelection);
    const activeRange = activeTextRangeRef.current;
    if (!activeRange) {
      reportBlockedEdit(new Error("请先选中要修改的文字，再使用格式快捷键。"));
      return true;
    }
    const view = active.rootElement.ownerDocument.defaultView;
    const styleElements = activeRange.styleElements.length > 0
      ? activeRange.styleElements
      : [active.rootElement];
    const computedStyles = styleElements.map((element) => (
      view!.getComputedStyle(element)
    ));
    if (shortcut === "bold") {
      const enabled = computedStyles.every((style) => (
        style.fontWeight === "bold"
        || Number.parseInt(style.fontWeight, 10) >= 600
      ));
      applyInlineStyle("fontWeight", enabled ? "normal" : "700");
      return true;
    }
    if (shortcut === "italic") {
      const enabled = computedStyles.every((style) => (
        style.fontStyle === "italic" || style.fontStyle === "oblique"
      ));
      applyInlineStyle("fontStyle", enabled ? "normal" : "italic");
      return true;
    }
    const enabled = computedStyles.every((style) => (
      style.textDecorationLine.split(/\s+/u).includes("underline")
    ));
    applyInlineStyle("textDecorationLine", enabled ? "none" : "underline");
    return true;
  }, [
    applyInlineStyle,
    refreshNativeEditRangeState,
    reportBlockedEdit,
  ]);
  applyNativeFormatShortcutRef.current = applyNativeFormatShortcut;

  const handleToolbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const historyDirection = sourceHistoryDirectionForShortcut(event);
    if (historyDirection) {
      event.preventDefault();
      event.stopPropagation();
      onRequestHistoryRef.current?.(historyDirection);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      if (spacingMenuOpen) {
        setSpacingMenuOpen(false);
        return;
      }
      if (activeNativeEditRef.current) {
        finishNativeEditing(true);
        return;
      }
      iframeRef.current?.focus();
      clearSelection();
    }
  };

  const editorHeight = typeof height === "number" ? `${height}px` : height;
  const containerStyle = { "--html-canvas-height": editorHeight } as CSSProperties;
  const toolbarStyle = overlayPosition
    ? ({ left: overlayPosition.toolbarLeft, top: overlayPosition.toolbarTop } satisfies CSSProperties)
    : undefined;
  const selectedNativeEditHost = selectedElementRef.current && sourceIndexRef.current
    ? nativeEditHostForElement(selectedElementRef.current, sourceIndexRef.current)
    : null;
  const selectedNativeTextFragment = !selectedNativeEditHost && sourceIndexRef.current
    ? nativeTextFragmentForRange(activeTextRangeRef.current, sourceIndexRef.current)
    : null;
  const selectedNativeEditAvailable = Boolean(
    activeNativeEditRef.current
    || selectedNativeEditHost
    || selectedNativeTextFragment,
  );
  const selectedPagePresentationAction = (
    !readOnly
    && !interactionLocked
    && selection
  ) ? resolvePagePresentationAction(selection) : null;
  const textFormatRequiresSelection = isEditing && !hasTextRange;
  const handleEditFeedbackAction = useCallback(() => {
    const recovery = editFeedback?.recovery;
    setEditFeedback(null);
    setEditFeedbackPaused(false);
    if (recovery === "reload") {
      onRequestReload?.();
      return;
    }
    if (recovery !== "comment") return;
    const target = selectedSourceSelectionRef.current;
    if (target) {
      requestCommentForTarget(target);
    } else {
      requestGlobalComment();
    }
  }, [
    editFeedback?.recovery,
    onRequestReload,
    requestCommentForTarget,
    requestGlobalComment,
  ]);
  const editFeedbackActionAvailable = editFeedback?.recovery === "reload"
    ? Boolean(onRequestReload)
    : editFeedback?.recovery === "comment" && Boolean(onRequestComment);

  return (
    <div
      ref={containerRef}
      className={[styles.editor, className].filter(Boolean).join(" ")}
      style={containerStyle}
      data-testid="html-canvas-editor"
      data-locked={interactionLocked ? "true" : undefined}
      data-interaction-mode={renderedMode}
      aria-readonly={readOnly || interactionLocked}
    >
      <iframe
        key={frameRender.elementGeneration}
        ref={iframeRef}
        data-frame-generation={frameRender.elementGeneration}
        className={styles.frame}
        title={
          renderedMode === "history"
            ? `${iframeTitle}（正在查看历史版本，只读）`
            : interactionLocked
              ? `${iframeTitle}（本轮已锁定，仅可浏览）`
              : iframeTitle
        }
        srcDoc={frameRender.html}
        sandbox={frameRender.runtime
          ? "allow-same-origin allow-scripts"
          : "allow-same-origin"}
        onLoad={(event) => connectFrame(
          event.currentTarget,
          frameRender.elementGeneration,
        )}
      />

      {editFeedback && !interactionLocked ? (
        <NoticeBar
          placement="viewport"
          title={editFeedback.title}
          message={editFeedback.message}
          tone={editFeedback.tone}
          actionLabel={editFeedback.recovery === "reload"
            ? reloadActionLabel
            : editFeedback.recovery === "comment"
              ? "添加评论"
              : undefined}
          onAction={editFeedbackActionAvailable ? handleEditFeedbackAction : undefined}
          onDismiss={() => setEditFeedback(null)}
          onPauseChange={setEditFeedbackPaused}
          dismissLabel="关闭修改提示"
          usageCode={editFeedback.code}
          usageDisposition={editFeedback.recovery === "none"
            ? "inform-in-place"
            : "direct-action"}
          usageSurface="canvas"
          usageProjectId={usageProjectId}
          usageCapture={usageCapture}
        />
      ) : null}

      {interactionLocked ? (
        <div
          className={styles.lockNotice}
          data-mode={renderedMode}
          role="status"
          aria-label={
            renderedMode === "history"
              ? "正在查看历史版本，只读"
              : "本轮已锁定，仅可滚动浏览"
          }
        >
          <span className={styles.lockGlyph} aria-hidden="true"><span /></span>
          <span>
            {renderedMode === "history"
              ? "正在查看历史版本 · 只读"
              : "本轮已锁定 · 仅可浏览"}
          </span>
        </div>
      ) : null}

      {!interactionLocked ? commentMarkers.map((marker) => (
        <button
          key={marker.key}
          type="button"
          className={styles.commentMarker}
          data-global={isPageRootSelection(marker.selection) ? "true" : undefined}
          data-placement={marker.placement}
          style={{ left: marker.left, top: marker.top }}
          aria-label={marker.count && marker.count > 1
            ? `${marker.label || marker.selection.label}已有${marker.count}条评论`
            : marker.label || `${marker.selection.label}已有1条评论`}
          title={`查看${marker.label || marker.selection.label}的${marker.count || 1}条评论`}
          onClick={() => {
            if (lockedRef.current) return;
            // The marker was clicked at the user's current Canvas position.
            // Keep that viewport stable; navigation from the comment rail can
            // still opt into revealing the paired target.
            selectTarget(marker.selection, { reveal: false, showToolbar: true });
          }}
        >
          <span className={styles.commentGlyph} aria-hidden="true">
            评{marker.count || 1}
          </span>
        </button>
      )) : null}

      {!interactionLocked
      && toolbarVisible
      && selection
      && !isPageRootSelection(selection)
      && overlayPosition ? (
        <div
          ref={toolbarRef}
          className={styles.toolbar}
          data-selection-level={selection.level}
          data-text-range={hasTextRange ? "true" : undefined}
          data-text-editing={isEditing ? "true" : undefined}
          style={toolbarStyle}
          role="toolbar"
          aria-label={`编辑${selection.label}`}
          onKeyDown={handleToolbarKeyDown}
          onPointerDownCapture={(event) => {
            const activeNativeEdit = activeNativeEditRef.current;
            if (!activeNativeEdit) return;
            if (activeNativeEdit.session.isComposing()) {
              // Moving focus from the authored iframe to this outer toolbar
              // makes Chromium/macOS end the live IME composition and expose
              // its intermediate pinyin as ordinary DOM text. Keep the native
              // editor focused while allowing the button click to enqueue its
              // explicit command.
              event.preventDefault();
              return;
            }
            retainNativeEditFocusRef.current = {
              session: activeNativeEdit.session,
              lease: { ...activeNativeEdit.lease },
            };
          }}
          onMouseDownCapture={(event) => {
            if (activeNativeEditRef.current?.session.isComposing()) {
              // The focus default is attached to mousedown in Chromium. Keep
              // this fallback even when pointerdown compatibility changes.
              event.preventDefault();
            }
          }}
        >
          {selectedPagePresentationAction ? (
            <button
              type="button"
              className={`${styles.toolButton} ${styles.presentationToolButton}`}
              data-presentation-kind={selectedPagePresentationAction.kind}
              data-current={selectedPagePresentationAction.isCurrent ? "true" : undefined}
              aria-label={selectedPagePresentationAction.label}
              aria-pressed={
                selectedPagePresentationAction.kind === "activate-tab"
                  ? selectedPagePresentationAction.isCurrent
                  : undefined
              }
              title={
                selectedPagePresentationAction.isCurrent
                  ? "当前页签"
                  : "快捷操作：按住 ⌥ 并单击页面中的这个控件"
              }
              onClick={() => {
                executePagePresentationAction(selection);
              }}
            >
              {selectedPagePresentationAction.label}
            </button>
          ) : null}

          <button
            type="button"
            className={styles.commentToolButton}
            aria-label={`给${selection.label}留评论`}
            onClick={() => {
              if (lockedRef.current) return;
              const openComment = () => {
                if (activeNativeEditRef.current) {
                  const committed = finishNativeEditing(true, "manual");
                  if (!committed.ok) return;
                }
                requestCommentForTarget(selection);
              };
              if (deferNativeCommandRef.current("comment", openComment)) return;
              openComment();
            }}
          >
            评论
          </button>

          {!readOnly && selection.level === "part" ? (
            <>
              <button
                type="button"
                className={styles.toolButton}
                aria-pressed={isEditing}
                disabled={!selectedNativeEditAvailable}
                title={!selectedNativeEditAvailable
                  ? "这段内容不是当前源码中的唯一静态文字"
                  : "像文档一样在原位置编辑文字"}
                onClick={() => {
                  startEditing();
                }}
              >
                {isEditing ? "编辑中" : "编辑"}
              </button>

              <div className={styles.formatGroup} aria-label="文字格式">
                <button
                  type="button"
                  className={styles.formatButton}
                  aria-pressed={selectedStyle.isBold}
                  disabled={textFormatRequiresSelection}
                  title={textFormatRequiresSelection ? "请先选中要修改的文字" : "加粗"}
                  onClick={() => applyInlineStyle("fontWeight", selectedStyle.isBold ? "normal" : "700")}
                >
                  加粗
                </button>
                <button
                  type="button"
                  className={styles.formatButton}
                  aria-pressed={selectedStyle.isItalic}
                  disabled={textFormatRequiresSelection}
                  title={textFormatRequiresSelection ? "请先选中要修改的文字" : "斜体"}
                  onClick={() => applyInlineStyle("fontStyle", selectedStyle.isItalic ? "normal" : "italic")}
                >
                  斜体
                </button>
                <button
                  type="button"
                  className={styles.formatButton}
                  aria-pressed={selectedStyle.isUnderline}
                  disabled={textFormatRequiresSelection}
                  title={textFormatRequiresSelection ? "请先选中要修改的文字" : "下划线"}
                  onClick={() => applyInlineStyle(
                    "textDecorationLine",
                    selectedStyle.isUnderline ? "none" : "underline",
                  )}
                >
                  下划线
                </button>
              </div>

              <label className={styles.field}>
                <span>字号</span>
                <input
                  className={styles.numberInput}
                  type="number"
                  min="8"
                  max="120"
                  step="1"
                  value={selectedStyle.fontSize}
                  disabled={textFormatRequiresSelection}
                  aria-label="字号（像素）"
                  onChange={(event) => {
                    const value = Math.max(8, Math.min(120, Number(event.currentTarget.value)));
                    if (Number.isFinite(value)) applyInlineStyle("fontSize", `${value}px`);
                  }}
                />
              </label>

              <label className={styles.colorField} title="文字颜色">
                <span>字色</span>
                <input
                  type="color"
                  value={selectedStyle.color}
                  disabled={textFormatRequiresSelection}
                  aria-label="文字颜色"
                  onChange={(event) => applyInlineStyle("color", event.currentTarget.value)}
                />
              </label>

              <label
                className={styles.colorField}
                title="元素填充色"
              >
                <span>填充</span>
                <input
                  type="color"
                  value={selectedStyle.backgroundColor}
                  disabled={textFormatRequiresSelection}
                  aria-label="元素填充色"
                  onChange={(event) => applyInlineStyle("backgroundColor", event.currentTarget.value)}
                />
              </label>

              <details
                ref={spacingMenuRef}
                className={styles.spacingMenu}
                open={spacingMenuOpen}
              >
                <summary
                  aria-expanded={spacingMenuOpen}
                  onClick={(event) => {
                    event.preventDefault();
                    setSpacingMenuOpen((open) => !open);
                  }}
                >间距</summary>
                <div className={styles.spacingPanel} aria-label="元素间距">
                  <label className={styles.field}>
                    <span>内边距</span>
                    <input
                      className={styles.numberInput}
                      type="number"
                      min="0"
                      max="240"
                      step="1"
                      value={selectedStyle.padding}
                      aria-label="内边距（像素）"
                      onChange={(event) => {
                        const value = Math.max(0, Math.min(240, Number(event.currentTarget.value)));
                        if (Number.isFinite(value)) applyInlineStyle("padding", `${value}px`);
                      }}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>外间距</span>
                    <input
                      className={styles.numberInput}
                      type="number"
                      min="-120"
                      max="240"
                      step="1"
                      value={selectedStyle.margin}
                      aria-label="外间距（像素）"
                      onChange={(event) => {
                        const value = Math.max(-120, Math.min(240, Number(event.currentTarget.value)));
                        if (Number.isFinite(value)) applyInlineStyle("margin", `${value}px`);
                      }}
                    />
                  </label>
                  <label className={styles.field}>
                    <span>行距</span>
                    <input
                      className={styles.numberInput}
                      type="number"
                      min="8"
                      max="240"
                      step="1"
                      value={selectedStyle.lineHeight}
                      aria-label="行距（像素）"
                      onChange={(event) => {
                        const value = Math.max(8, Math.min(240, Number(event.currentTarget.value)));
                        if (Number.isFinite(value)) applyInlineStyle("lineHeight", `${value}px`);
                      }}
                    />
                  </label>
                </div>
              </details>

              {enableReorder ? (
                <div className={styles.moveGroup} aria-label="移动选中内容">
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="上移"
                    title="上移（Option + ↑）"
                    disabled={!moveAvailability.up}
                    onClick={() => moveSelected("up")}
                  >
                    上移
                  </button>
                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="下移"
                    title="下移（Option + ↓）"
                    disabled={!moveAvailability.down}
                    onClick={() => moveSelected("down")}
                  >
                    下移
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
});

export default HtmlCanvasEditor;
