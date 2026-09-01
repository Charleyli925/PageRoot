"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
  editRuntimeProgramIdentity,
  editRuntimeRegistrationProperty,
  isEditRuntimeFrameToken,
} from "../domain/edit-runtime-contract.js";
import { createSourceOperationId } from "../domain/source-history.js";
import {
  createPagePresentationAction,
  type PagePresentationAction,
  type PageViewContext,
} from "../lib/page-view-context.js";
import {
  PAGEROOT_ELEMENT_ID_ATTRIBUTE,
  isValidPagerootElementId,
} from "../../shared/pageroot-element-identity.mjs";
import {
  SOURCE_NODE_ATTRIBUTE,
  applyPatchPlan,
  buildSourceIndex,
  createTargetRef,
  instrumentPreviewHtml,
  planSemanticOperationPatch,
  planSourcePatch,
  resolveTargetRef,
} from "../lib/source-patch-core.js";
import {
  editableIslandDraftHtml,
  editableIslandForTarget,
  isEditableIslandTarget,
  normalizeEditableTextFragmentHtml,
} from "../lib/editable-island.js";
import {
  sourceTargetRefForSelection,
} from "../lib/canvas-target-rebind.js";
import {
  applySemanticOperation,
  createSemanticDocumentState,
  createSemanticElementPrecondition,
  type SemanticOperation,
} from "../lib/semantic-operation-kernel.js";
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
} from "./native-layout-fingerprint";
import {
  readComputedEditableStyle,
  STYLE_PROPERTY_CONFIGS,
  TEXT_RANGE_EDITABLE_PROPERTIES,
  type EditableStyleProperty,
  type SelectedStyle,
} from "./html-canvas-computed-style";
import {
  deterministicOperationTargetUpdate,
  deterministicTargetUpdates,
  isPageRootElement,
  isPageRootSelection,
  selectionForElement,
  selectionFromRefreshedTarget,
  sourceMoveAvailability,
  trackedSourceTargetRefs,
  uniqueSelections,
  type MoveAvailability,
} from "./html-canvas-selection";
import {
  insertStructureCommand,
  selectedStructureCommand,
  type SelectedStructureAction,
  type StructureDestination,
} from "./html-canvas-structure-commands";
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
  tabAssociations,
} from "./html-canvas-page-view";
import {
  clampRuntimeScroll,
  frameDocumentMatchesExpected,
  runtimeAnchorScrollTop,
  runtimePositionWithinTolerance,
  sameRuntimeGrant,
  type RuntimeFrameContext,
  type RuntimeHandoffLayoutFingerprint,
  type RuntimeViewportSnapshot,
} from "./html-canvas-frame";
import { useCanvasPresentationScroll } from "./html-canvas-presentation-scroll";
import {
  NativeDeferredCommandQueue,
  nativeEditLeasesMatch,
} from "./html-canvas-native-commands";
import {
  layoutCommentMarkers,
  layoutInsertionPoints,
  measureCommentTargetLayouts,
  type InsertionPoint,
} from "./html-canvas-comment-layout";
import {
  adoptCanonicalHistoryIslandInPlace,
  canonicalNativeHostPreview,
  mountNativeTextFragmentHost,
  remountNativeHostFromSource,
  nativeEditHostForElement,
  nativeTextFragmentForRange,
  nativeTextFragmentForElement,
  refreshMountedPreviewSourceNodeIds,
  sourceTextNodeForDomText,
  sourceBackedPreviewElements,
  alignPreviewSourceSurface,
  sourceTextParentsForSegments,
} from "./html-canvas-preview-sync";
import { usePreviewResourceBase } from "./use-preview-resource-base";
import {
  activeTextRangeFromDocument,
  boundedHistorySelection,
  caretPointFromMouseEvent,
  findDedicatedSourceSurfaceAtPoint,
  findNativeActionTarget,
  historySelectionFromMutationValue,
  identifyingTextRangeAtPoint,
  directTextNodeAtPoint,
  sourceHistoryDirectionForShortcut,
  textLocatorForActiveRange,
  type TextCaretPoint,
} from "./html-canvas-interaction";
import {
  canvasVisualTargetElement,
  canvasPointerCapabilityFromProof,
  createCanvasTargetIdentityScope,
  resolveCanvasTarget,
  type CanvasTargetIdentityScope,
  type ResolvedCanvasTarget,
} from "./html-canvas-pointer-capability";
import {
  clipCanvasTargetRectToViewport,
  createCanvasCapabilityHoverController,
  layoutCanvasHoverChrome,
  placeCanvasHoverHint,
  type CanvasCapabilityHoverSnapshot,
} from "./html-canvas-capability-hover";
import {
  HtmlCanvasSelectionChrome,
  type HtmlCanvasCommentMarker,
  type HtmlCanvasEditFeedback,
} from "./html-canvas-selection-chrome";
import {
  deriveCapabilityHoverState,
  deriveSelectionOverlay,
  stabilizeSelectionChromeProjection,
  type SelectionChromeActions,
  type SelectionChromeModel,
  type SelectionChromeProjection,
} from "./html-canvas-selection-chrome-contract";
import type {
  HtmlCanvasCommentLayoutState,
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
  HtmlCanvasTextLocator,
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

function reconcileAllocatedLineBreakIds(
  hostElement: HTMLElement,
  previousSourceInnerHtml: string,
  nextSourceInnerHtml: string,
) {
  const liveDraft = editableIslandDraftHtml(hostElement.innerHTML, {
    baselineInnerHtml: previousSourceInnerHtml,
  });
  const sourceDraft = editableIslandDraftHtml(nextSourceInnerHtml, {
    baselineInnerHtml: previousSourceInnerHtml,
  });
  if (liveDraft !== sourceDraft) {
    throw new Error("实时编辑 DOM 与已保存的源码换行结构不一致。");
  }
  const document = hostElement.ownerDocument;
  const previousTemplate = document.createElement("template");
  const nextTemplate = document.createElement("template");
  previousTemplate.innerHTML = previousSourceInnerHtml;
  nextTemplate.innerHTML = nextSourceInnerHtml;
  const previousIds = new Set(Array.from(
    previousTemplate.content.querySelectorAll(`[${PAGEROOT_ELEMENT_ID_ATTRIBUTE}]`),
  ).map((element) => element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE)));
  const liveElements = Array.from(hostElement.querySelectorAll("*"));
  const sourceElements = Array.from(nextTemplate.content.querySelectorAll("*"));
  if (liveElements.length !== sourceElements.length) {
    throw new Error("实时编辑 DOM 与已保存的源码元素数量不一致。");
  }
  const assignments: Array<{ element: Element; elementId: string }> = [];
  const assignedIds = new Set<string>();
  for (let index = 0; index < sourceElements.length; index += 1) {
    const liveElement = liveElements[index];
    const sourceElement = sourceElements[index];
    if (liveElement.localName !== sourceElement.localName) {
      throw new Error("实时编辑 DOM 与已保存的源码元素顺序不一致。");
    }
    const liveId = liveElement.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    const sourceId = sourceElement.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    if (liveId === sourceId) continue;
    if (
      liveId !== null
      || sourceElement.localName !== "br"
      || typeof sourceId !== "string"
      || !isValidPagerootElementId(sourceId)
      || previousIds.has(sourceId)
      || assignedIds.has(sourceId)
    ) {
      throw new Error("已保存的源码身份无法安全同步到实时换行节点。");
    }
    assignedIds.add(sourceId);
    assignments.push({ element: liveElement, elementId: sourceId });
  }
  for (const assignment of assignments) {
    assignment.element.setAttribute(
      PAGEROOT_ELEMENT_ID_ATTRIBUTE,
      assignment.elementId,
    );
  }
}

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
    background: rgba(90, 85, 223, 0.2) !important;
  }

  [data-html-canvas-global-selected] {
    min-height: 100vh !important;
  }

  [data-html-canvas-editing] {
    cursor: text !important;
    outline: none !important;
  }

  [data-html-canvas-native-editing] {
    -webkit-user-select: text !important;
    user-select: text !important;
    caret-color: currentColor !important;
    outline: none !important;
  }

  html[data-html-canvas-locked] [contenteditable] {
    cursor: default !important;
    caret-color: transparent !important;
  }

  html[data-html-canvas-pointer="text"],
  html[data-html-canvas-pointer="text"] body,
  html[data-html-canvas-pointer="text"] body * {
    cursor: text !important;
  }

  html[data-html-canvas-pointer="pointer"],
  html[data-html-canvas-pointer="pointer"] body,
  html[data-html-canvas-pointer="pointer"] body * {
    cursor: pointer !important;
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

type RuntimeSourceElements = {
  elementGeneration: number;
  executionId: string;
  elements: WeakSet<HTMLElement>;
  markerSourceNodeIds: WeakMap<HTMLElement, string>;
  pagerootIds: WeakMap<HTMLElement, string>;
};

type RuntimeCandidateRender = {
  html: string;
  elementGeneration: number;
  runtime: boolean;
};

type RuntimeActiveFrameSnapshot = {
  render: RuntimeCandidateRender;
  cleanupFrame: () => void;
  runtimeFrame: RuntimeFrameContext | null;
  runtimeSourceElements: RuntimeSourceElements | null;
  runtimeSourceRegistrationCleanup: () => void;
  frameGeneration: number;
  nativeDomGeneration: number;
  sourceIndex: SourceIndexValue | null;
  frameSourceHtml: string;
  frameWrittenHtml: string | null;
  expectedFrameHtml: string | null;
  expectedFrameToken: string | null;
  renderedSourceHtml: string | null;
  appliedPageViewContext: PageViewContext | null;
  activeFrameConnectionPending: boolean;
  runtimeNeedsRerender: boolean;
  pendingFrameViewport: { left: number; top: number } | null;
  pendingSharedViewport: {
    element: HTMLElement;
    left: number;
    top: number;
  } | null;
  pendingFrameRestoreEpoch: number;
  nativeSessionNeedsCanonicalFence: boolean;
  nativeEditNeedsReload: boolean;
  pendingNativeEditResume: PendingNativeEditResume | null;
  selectedElement: HTMLElement | null;
  selectedSourceSelection: HtmlCanvasSelection | null;
  activeTextRange: ActiveTextRange | null;
  toolbarVisible: boolean;
  runtimeGeneratedSelection: boolean;
  connectedFrame: {
    iframe: HTMLIFrameElement;
    generation: number;
  } | null;
};

type RuntimeCandidate = {
  source: string;
  sourceIndex: SourceIndexValue | null;
  prepared: string;
  verificationToken: string;
  render: RuntimeCandidateRender;
  runtimeFrame: RuntimeFrameContext | null;
  sourceElements: RuntimeSourceElements | null;
  registrationCleanup: () => void;
  loaded: boolean;
  outcomeReported: boolean;
  previousPendingSelection: HtmlCanvasSelection | null;
  previousPendingToolbarVisible: boolean;
  viewportSnapshot: RuntimeViewportSnapshot;
  sharedViewportElement: HTMLElement | null;
  handoffScrollState: RuntimeHandoffScrollState;
  refreshViewportSnapshot: (
    channel: RuntimeHandoffScrollChannel,
    iframe?: HTMLIFrameElement | null,
  ) => void;
  markProgrammaticScroll: (
    channel: RuntimeHandoffScrollChannel,
    left: number,
    top: number,
  ) => void;
  handoffScrollCleanup: () => void;
  previousActive: RuntimeActiveFrameSnapshot;
};

type RuntimeHandoffScrollChannel = "frame" | "shared";
type RuntimeProgrammaticScrollSuppression = {
  epoch: number;
  left: number;
  top: number;
};
type RuntimeHandoffScrollChannelState = {
  epoch: number;
  programmaticScrollEpoch: number;
  userIntentEpoch: number;
  userIntentPending: boolean;
  pointerDragging: boolean;
  programmaticScrollSuppression: RuntimeProgrammaticScrollSuppression | null;
};
type RuntimeHandoffScrollState = {
  frame: RuntimeHandoffScrollChannelState;
  shared: RuntimeHandoffScrollChannelState;
};

function createRuntimeHandoffScrollChannelState(): RuntimeHandoffScrollChannelState {
  return {
    epoch: 0,
    programmaticScrollEpoch: 0,
    userIntentEpoch: 0,
    userIntentPending: false,
    pointerDragging: false,
    programmaticScrollSuppression: null,
  };
}

function createRuntimeHandoffScrollState(): RuntimeHandoffScrollState {
  return {
    frame: createRuntimeHandoffScrollChannelState(),
    shared: createRuntimeHandoffScrollChannelState(),
  };
}

function isRuntimeScrollKey(event: KeyboardEvent): boolean {
  if (event.altKey || event.ctrlKey || event.metaKey) return false;
  return [
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    "ArrowUp",
    "End",
    "Home",
    "PageDown",
    "PageUp",
    " ",
    "Spacebar",
  ].includes(event.key);
}

function documentScrollbarPointerDown(
  documentNode: Document,
  event: PointerEvent,
): boolean {
  const view = documentNode.defaultView;
  const scrollingElement = documentNode.scrollingElement
    || documentNode.documentElement;
  if (!view || !scrollingElement) return false;
  const verticalScrollbarWidth = Math.max(
    12,
    view.innerWidth - scrollingElement.clientWidth,
  );
  const horizontalScrollbarHeight = Math.max(
    12,
    view.innerHeight - scrollingElement.clientHeight,
  );
  const vertical = scrollingElement.scrollHeight > scrollingElement.clientHeight + 1
    && event.clientX >= view.innerWidth - verticalScrollbarWidth;
  const horizontal = scrollingElement.scrollWidth > scrollingElement.clientWidth + 1
    && event.clientY >= view.innerHeight - horizontalScrollbarHeight;
  return vertical || horizontal;
}

function sharedScrollbarPointerDown(
  element: HTMLElement,
  event: PointerEvent,
): boolean {
  const rect = element.getBoundingClientRect();
  const verticalScrollbarWidth = Math.max(12, element.offsetWidth - element.clientWidth);
  const horizontalScrollbarHeight = Math.max(12, element.offsetHeight - element.clientHeight);
  const vertical = element.scrollHeight > element.clientHeight + 1
    && event.clientX >= rect.right - verticalScrollbarWidth
    && event.clientX <= rect.right
    && event.clientY >= rect.top
    && event.clientY <= rect.bottom;
  const horizontal = element.scrollWidth > element.clientWidth + 1
    && event.clientY >= rect.bottom - horizontalScrollbarHeight
    && event.clientX >= rect.left
    && event.clientX <= rect.right;
  return vertical || horizontal;
}

function nullableRuntimePositionWithinTolerance(
  actual: number | null,
  expected: number | null,
): boolean {
  if (actual === null || expected === null) return actual === expected;
  return runtimePositionWithinTolerance(actual, expected);
}

function sameRuntimeHandoffNativeSelection(
  actual: RuntimeViewportSnapshot["nativeSelection"],
  expected: RuntimeViewportSnapshot["nativeSelection"],
): boolean {
  if (!actual || !expected) return actual === expected;
  return actual.affinity === expected.affinity
    && runtimePositionWithinTolerance(actual.anchor, expected.anchor)
    && runtimePositionWithinTolerance(actual.focus, expected.focus);
}

function runtimeHandoffLayoutFingerprintWithinTolerance(
  actual: RuntimeHandoffLayoutFingerprint,
  expected: RuntimeHandoffLayoutFingerprint,
): boolean {
  if (
    actual.viewportAnchorStableId !== expected.viewportAnchorStableId
    || actual.selectedStableId !== expected.selectedStableId
    || !sameRuntimeHandoffNativeSelection(actual.nativeSelection, expected.nativeSelection)
  ) return false;
  const numericFields: Array<keyof RuntimeHandoffLayoutFingerprint> = [
    "iframeWidth",
    "iframeHeight",
    "documentClientWidth",
    "documentClientHeight",
    "documentScrollWidth",
    "documentScrollHeight",
    "sharedClientWidth",
    "sharedClientHeight",
    "sharedScrollWidth",
    "sharedScrollHeight",
    "iframeScrollX",
    "iframeScrollY",
    "sharedScrollLeft",
    "sharedScrollTop",
    "viewportAnchorOffsetY",
    "viewportAnchorSharedOffsetY",
    "caretOffsetY",
  ];
  return numericFields.every((field) => nullableRuntimePositionWithinTolerance(
    actual[field] as number | null,
    expected[field] as number | null,
  ));
}

function attachRuntimeHandoffScrollListeners({
  candidate,
  iframe,
  sharedScrollElement,
  includeShared,
  onFrameScroll,
  onSharedScroll,
}: {
  candidate: RuntimeCandidate;
  iframe: HTMLIFrameElement | null;
  sharedScrollElement: HTMLElement | null;
  includeShared: boolean;
  onFrameScroll?: () => void;
  onSharedScroll?: () => void;
}): () => void {
  const frameDocument = iframe?.contentDocument;
  const sharedDocument = sharedScrollElement?.ownerDocument;
  const cleanups: Array<() => void> = [];
  const stateFor = (channel: RuntimeHandoffScrollChannel) => (
    candidate.handoffScrollState[channel]
  );
  const schedulePendingIntentExpiry = (
    channel: RuntimeHandoffScrollChannel,
    epoch: number,
    sourceFrame: HTMLIFrameElement | null,
  ) => {
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const state = stateFor(channel);
        if (
          state.userIntentPending
          && state.userIntentEpoch === epoch
        ) {
          state.userIntentPending = false;
          candidate.refreshViewportSnapshot(channel, sourceFrame);
        }
      });
    });
  };
  const markUserIntent = (
    channel: RuntimeHandoffScrollChannel,
    sourceFrame: HTMLIFrameElement | null,
  ) => {
    const state = stateFor(channel);
    state.epoch += 1;
    state.userIntentEpoch = state.epoch;
    state.userIntentPending = true;
    state.programmaticScrollSuppression = null;
    candidate.refreshViewportSnapshot(channel, sourceFrame);
    schedulePendingIntentExpiry(channel, state.userIntentEpoch, sourceFrame);
  };
  const handleScroll = (
    channel: RuntimeHandoffScrollChannel,
    sourceFrame: HTMLIFrameElement | null,
    onScroll?: () => void,
  ) => {
    const state = stateFor(channel);
    if (state.programmaticScrollSuppression) {
      const currentPosition = channel === "frame"
        ? {
            left: sourceFrame?.contentWindow?.scrollX ?? 0,
            top: sourceFrame?.contentWindow?.scrollY ?? 0,
          }
        : {
            left: sharedScrollElement?.scrollLeft ?? 0,
            top: sharedScrollElement?.scrollTop ?? 0,
          };
      const suppression = state.programmaticScrollSuppression;
      if (
        runtimePositionWithinTolerance(currentPosition.left, suppression.left)
        && runtimePositionWithinTolerance(currentPosition.top, suppression.top)
      ) {
        state.programmaticScrollSuppression = null;
        onScroll?.();
        return;
      }
      // A scroll sample that does not land at the programmatic target cannot
      // be consumed by this epoch. Let the normal intent channels classify it.
      state.programmaticScrollSuppression = null;
    }
    if (state.userIntentPending || state.pointerDragging) {
      // Keep the gesture alive until two rAFs after its latest scroll sample.
      // Native scrollbar drags do not consistently emit pointermove, so the
      // active drag flag and the scroll itself both renew the user epoch.
      markUserIntent(channel, sourceFrame);
    }
    // An unclassified scroll is not evidence of user intent. It may have been
    // caused by a focus/reflow operation, so leave the handoff target unchanged
    // and let the positioning loop restore it.
    onScroll?.();
  };
  const markProgrammaticScroll = (
    channel: RuntimeHandoffScrollChannel,
    left: number,
    top: number,
  ) => {
    const state = stateFor(channel);
    state.epoch += 1;
    state.programmaticScrollEpoch = state.epoch;
    state.programmaticScrollSuppression = {
      epoch: state.programmaticScrollEpoch,
      left,
      top,
    };
    const suppressionEpoch = state.programmaticScrollEpoch;
    window.requestAnimationFrame(() => {
      if (
        state.programmaticScrollSuppression?.epoch === suppressionEpoch
        && state.programmaticScrollEpoch === suppressionEpoch
      ) state.programmaticScrollSuppression = null;
    });
  };

  // The positioning loop calls this through the candidate state. Keeping the
  // epoch marker on the same state as the intent listeners means a trusted
  // scroll event generated by scrollTo() cannot be mistaken for input.
  candidate.markProgrammaticScroll = markProgrammaticScroll;

  if (frameDocument) {
    const frameScroll = () => handleScroll("frame", iframe, onFrameScroll);
    const frameIntent = () => {
      markUserIntent("frame", iframe);
      if (includeShared && sharedScrollElement) markUserIntent("shared", iframe);
    };
    const framePointerDown = (event: Event) => {
      const pointer = event as PointerEvent;
      if (documentScrollbarPointerDown(frameDocument, pointer)) {
        stateFor("frame").pointerDragging = true;
        markUserIntent("frame", iframe);
      }
    };
    const framePointerMove = (event: Event) => {
      const pointer = event as PointerEvent;
      if (
        pointer.buttons !== 0
        && (
          stateFor("frame").pointerDragging
          || documentScrollbarPointerDown(frameDocument, pointer)
        )
      ) {
        stateFor("frame").pointerDragging = true;
        markUserIntent("frame", iframe);
      }
    };
    const framePointerEnd = () => {
      stateFor("frame").pointerDragging = false;
    };
    const frameKeyDown = (event: Event) => {
      if (isRuntimeScrollKey(event as KeyboardEvent)) {
        markUserIntent("frame", iframe);
        if (includeShared && sharedScrollElement) markUserIntent("shared", iframe);
      }
    };
    frameDocument.addEventListener("scroll", frameScroll, true);
    frameDocument.addEventListener("wheel", frameIntent, { capture: true, passive: true });
    frameDocument.addEventListener("touchmove", frameIntent, { capture: true, passive: true });
    frameDocument.addEventListener("pointerdown", framePointerDown, true);
    frameDocument.addEventListener("pointermove", framePointerMove, true);
    frameDocument.addEventListener("pointerup", framePointerEnd, true);
    frameDocument.addEventListener("pointercancel", framePointerEnd, true);
    frameDocument.addEventListener("keydown", frameKeyDown, true);
    cleanups.push(() => {
      frameDocument.removeEventListener("scroll", frameScroll, true);
      frameDocument.removeEventListener("wheel", frameIntent, true);
      frameDocument.removeEventListener("touchmove", frameIntent, true);
      frameDocument.removeEventListener("pointerdown", framePointerDown, true);
      frameDocument.removeEventListener("pointermove", framePointerMove, true);
      frameDocument.removeEventListener("pointerup", framePointerEnd, true);
      frameDocument.removeEventListener("pointercancel", framePointerEnd, true);
      frameDocument.removeEventListener("keydown", frameKeyDown, true);
      stateFor("frame").pointerDragging = false;
    });
  }

  if (includeShared && sharedScrollElement) {
    const sharedScroll = () => handleScroll("shared", iframe, onSharedScroll);
    const sharedIntent = () => markUserIntent("shared", iframe);
    const sharedDocumentIntent = (event: Event) => {
      const target = event.target;
      if (
        target === sharedScrollElement
        || (target instanceof Node && sharedScrollElement.contains(target))
      ) markUserIntent("shared", iframe);
    };
    const sharedPointerDown = (event: Event) => {
      const pointer = event as PointerEvent;
      if (sharedScrollbarPointerDown(sharedScrollElement, pointer)) {
        stateFor("shared").pointerDragging = true;
        markUserIntent("shared", iframe);
      }
    };
    const sharedPointerMove = (event: Event) => {
      const pointer = event as PointerEvent;
      if (
        pointer.buttons !== 0
        && (
          stateFor("shared").pointerDragging
          || sharedScrollbarPointerDown(sharedScrollElement, pointer)
        )
      ) {
        stateFor("shared").pointerDragging = true;
        markUserIntent("shared", iframe);
      }
    };
    const sharedPointerEnd = () => {
      stateFor("shared").pointerDragging = false;
    };
    const sharedKeyDown = (event: Event) => {
      const keyEvent = event as KeyboardEvent;
      if (isRuntimeScrollKey(keyEvent)) {
        markUserIntent("shared", iframe);
      }
    };
    sharedScrollElement.addEventListener("scroll", sharedScroll);
    sharedScrollElement.addEventListener("wheel", sharedIntent, { capture: true, passive: true });
    sharedScrollElement.addEventListener("touchmove", sharedIntent, { capture: true, passive: true });
    sharedScrollElement.addEventListener("pointerdown", sharedPointerDown, true);
    sharedScrollElement.addEventListener("pointermove", sharedPointerMove, true);
    sharedScrollElement.addEventListener("pointerup", sharedPointerEnd, true);
    sharedScrollElement.addEventListener("pointercancel", sharedPointerEnd, true);
    sharedDocument?.addEventListener("pointerdown", sharedPointerDown, true);
    sharedDocument?.addEventListener("pointermove", sharedPointerMove, true);
    sharedDocument?.addEventListener("pointerup", sharedPointerEnd, true);
    sharedDocument?.addEventListener("pointercancel", sharedPointerEnd, true);
    sharedDocument?.addEventListener("wheel", sharedDocumentIntent, { capture: true, passive: true });
    sharedDocument?.addEventListener("touchmove", sharedDocumentIntent, { capture: true, passive: true });
    sharedDocument?.addEventListener("keydown", sharedKeyDown, true);
    cleanups.push(() => {
      sharedScrollElement.removeEventListener("scroll", sharedScroll);
      sharedScrollElement.removeEventListener("wheel", sharedIntent, true);
      sharedScrollElement.removeEventListener("touchmove", sharedIntent, true);
      sharedScrollElement.removeEventListener("pointerdown", sharedPointerDown, true);
      sharedScrollElement.removeEventListener("pointermove", sharedPointerMove, true);
      sharedScrollElement.removeEventListener("pointerup", sharedPointerEnd, true);
      sharedScrollElement.removeEventListener("pointercancel", sharedPointerEnd, true);
      sharedDocument?.removeEventListener("pointerdown", sharedPointerDown, true);
      sharedDocument?.removeEventListener("pointermove", sharedPointerMove, true);
      sharedDocument?.removeEventListener("pointerup", sharedPointerEnd, true);
      sharedDocument?.removeEventListener("pointercancel", sharedPointerEnd, true);
      sharedDocument?.removeEventListener("wheel", sharedDocumentIntent, true);
      sharedDocument?.removeEventListener("touchmove", sharedDocumentIntent, true);
      sharedDocument?.removeEventListener("keydown", sharedKeyDown, true);
      stateFor("shared").pointerDragging = false;
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

function runtimeSourceElementForStableId(
  documentNode: Document,
  sourceIndex: SourceIndexValue | null,
  stableId: string | null | undefined,
): Element | null {
  if (!sourceIndex || !stableId || !isValidPagerootElementId(stableId)) return null;
  const sourceEntry = sourceIndex.byPagerootId.get(stableId);
  if (!sourceEntry || sourceEntry.type !== "element") return null;
  const matches = Array.from(documentNode.querySelectorAll<HTMLElement>(
    `[${SOURCE_NODE_ATTRIBUTE}]`,
  )).filter((element) => (
    element.getAttribute(SOURCE_NODE_ATTRIBUTE) === sourceEntry.nodeId
    && element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE) === stableId
  ));
  return matches.length === 1 ? matches[0] : null;
}

function runtimeStableIdForElement(
  element: Element | null,
  sourceIndex: SourceIndexValue | null,
): string | null {
  const stableId = element?.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
  const sourceNodeId = element?.getAttribute(SOURCE_NODE_ATTRIBUTE);
  const sourceEntry = sourceNodeId
    ? sourceIndex?.byNodeId.get(sourceNodeId)
    : null;
  if (
    !stableId
    || !isValidPagerootElementId(stableId)
    || sourceEntry?.type !== "element"
    || sourceEntry.pagerootId !== stableId
  ) return null;
  return stableId;
}

function runtimeAnchorOffsetIsClamped({
  currentScrollTop,
  currentAnchorOffsetY,
  desiredAnchorOffsetY,
  maximumScrollTop,
}: {
  currentScrollTop: number;
  currentAnchorOffsetY: number;
  desiredAnchorOffsetY: number;
  maximumScrollTop: number;
}): boolean {
  const idealScrollTop = currentScrollTop + currentAnchorOffsetY - desiredAnchorOffsetY;
  return !runtimePositionWithinTolerance(
    idealScrollTop,
    clampRuntimeScroll(idealScrollTop, maximumScrollTop),
  );
}

function runtimeCaretOffsetY(
  documentNode: Document,
  rootElement: Element | null,
): number | null {
  const selection = documentNode.getSelection();
  const focusNode = selection?.focusNode;
  if (
    !selection
    || !focusNode
    || !rootElement
    || (focusNode !== rootElement && !rootElement.contains(focusNode))
  ) return null;
  try {
    const range = documentNode.createRange();
    range.setStart(focusNode, selection.focusOffset);
    range.collapse(true);
    const rect = range.getClientRects()[0] || range.getBoundingClientRect();
    return Number.isFinite(rect.top) ? rect.top : null;
  } catch {
    return null;
  }
}

function captureRuntimeViewportSnapshot({
  iframe,
  sharedScrollElement,
  sourceIndex,
  selectedElement,
  selectedSourceSelection,
  nativeSelection,
  caretOffsetYOverride,
}: {
  iframe: HTMLIFrameElement | null;
  sharedScrollElement: HTMLElement | null;
  sourceIndex: SourceIndexValue | null;
  selectedElement: Element | null;
  selectedSourceSelection: HtmlCanvasSelection | null;
  nativeSelection: RuntimeViewportSnapshot["nativeSelection"];
  caretOffsetYOverride?: number | null;
}): RuntimeViewportSnapshot {
  const documentNode = iframe?.contentDocument;
  const frameView = iframe?.contentWindow;
  const frameScrollX = Number(frameView?.scrollX || 0);
  const frameScrollY = Number(frameView?.scrollY || 0);
  const selectedStableId = (
    isValidPagerootElementId(selectedSourceSelection?.elementId)
      ? selectedSourceSelection?.elementId
      : runtimeStableIdForElement(selectedElement, sourceIndex)
  ) || null;
  const measuredCaretOffsetY = documentNode
    ? runtimeCaretOffsetY(documentNode, selectedElement)
    : null;
  const caretOffsetY = typeof caretOffsetYOverride === "number"
    ? caretOffsetYOverride
    : measuredCaretOffsetY;
  const frameHeight = iframe?.clientHeight || 0;
  const preferredAnchor = (
    documentNode && selectedStableId
      ? runtimeSourceElementForStableId(documentNode, sourceIndex, selectedStableId)
      : null
  ) || (
    selectedElement && runtimeStableIdForElement(selectedElement, sourceIndex)
      ? selectedElement
      : null
  );
  const anchorCandidates = documentNode && sourceIndex
    ? Array.from(documentNode.querySelectorAll<HTMLElement>(
      `[${SOURCE_NODE_ATTRIBUTE}]`,
    )).filter((element) => (
      runtimeStableIdForElement(element, sourceIndex)
      && element.getBoundingClientRect().bottom > 0
      && element.getBoundingClientRect().top < frameHeight
    ))
    : [];
  const anchorElement = preferredAnchor
    || anchorCandidates.sort((left, right) => (
      Math.abs(left.getBoundingClientRect().top)
      - Math.abs(right.getBoundingClientRect().top)
    ))[0]
    || null;
  const viewportAnchorStableId = runtimeStableIdForElement(anchorElement, sourceIndex);
  const anchorRect = anchorElement?.getBoundingClientRect();
  const viewportAnchorOffsetY = viewportAnchorStableId
    ? anchorRect?.top ?? null
    : null;
  const iframeRect = iframe?.getBoundingClientRect();
  const sharedRect = sharedScrollElement?.getBoundingClientRect();
  const viewportAnchorSharedOffsetY = viewportAnchorStableId
    && anchorRect
    && iframeRect
    && sharedRect
    ? iframeRect.top - sharedRect.top + anchorRect.top
    : null;
  return {
    iframeScrollX: Number.isFinite(frameScrollX) ? frameScrollX : 0,
    iframeScrollY: Number.isFinite(frameScrollY) ? frameScrollY : 0,
    sharedScrollLeft: sharedScrollElement?.scrollLeft || 0,
    sharedScrollTop: sharedScrollElement?.scrollTop || 0,
    viewportAnchorStableId,
    viewportAnchorOffsetY: Number.isFinite(Number(viewportAnchorOffsetY))
      ? Number(viewportAnchorOffsetY)
      : null,
    viewportAnchorSharedOffsetY: Number.isFinite(Number(viewportAnchorSharedOffsetY))
      ? Number(viewportAnchorSharedOffsetY)
      : null,
    selectedStableId,
    nativeSelection: nativeSelection
      ? { ...nativeSelection }
      : null,
    caretOffsetY,
  };
}

function runtimeTextNodeForSourceId(
  documentNode: Document,
  sourceIndex: SourceIndexValue,
  textNodeId: string,
): Text | null {
  const sourceText = sourceIndex.byNodeId.get(textNodeId);
  if (sourceText?.type !== "text" || !sourceText.parentId) return null;
  const sourceParent = sourceIndex.byNodeId.get(sourceText.parentId);
  if (sourceParent?.type !== "element") return null;
  const escapedParentId = sourceParent.nodeId
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  const parentElement = documentNode.querySelector<HTMLElement>(
    `[${SOURCE_NODE_ATTRIBUTE}="${escapedParentId}"]`,
  );
  const childIndex = sourceParent.childIds.indexOf(textNodeId);
  const candidate = childIndex >= 0
    ? parentElement?.childNodes[childIndex]
    : null;
  return candidate?.nodeType === 3
    && sourceTextNodeForDomText(candidate as Text, sourceIndex)?.nodeId === textNodeId
    ? candidate as Text
    : null;
}

function restoreRuntimeTextSelection(
  documentNode: Document,
  sourceIndex: SourceIndexValue,
  previousRange: ActiveTextRange,
  target: HtmlCanvasSelection,
): ActiveTextRange | null {
  const firstSegment = previousRange.segments[0];
  const lastSegment = previousRange.segments.at(-1);
  if (!firstSegment || !lastSegment) return null;
  const startNode = runtimeTextNodeForSourceId(
    documentNode,
    sourceIndex,
    firstSegment.textNodeId,
  );
  const endNode = runtimeTextNodeForSourceId(
    documentNode,
    sourceIndex,
    lastSegment.textNodeId,
  );
  if (!startNode || !endNode) return null;
  try {
    const range = documentNode.createRange();
    range.setStart(startNode, firstSegment.startOffset);
    range.setEnd(endNode, lastSegment.endOffset);
    const selection = documentNode.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    const restored = activeTextRangeFromDocument(documentNode, sourceIndex);
    return restored ? { ...restored, target } : null;
  } catch {
    return null;
  }
}

function canvasTargetOutlineStyle(
  container: HTMLElement | null,
  iframe: HTMLIFrameElement | null,
  element: HTMLElement | null,
  global = false,
): ReturnType<typeof layoutCanvasHoverChrome>["outline"] | undefined {
  if (!container || !iframe || !element?.isConnected) return undefined;
  const containerRect = container.getBoundingClientRect();
  const iframeRect = iframe.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const targetRect = global
    ? {
      left: 0,
      top: 0,
      width: iframe.clientWidth,
      height: iframe.clientHeight,
    }
    : clipCanvasTargetRectToViewport({
      left: elementRect.left,
      top: elementRect.top,
      width: elementRect.width,
      height: elementRect.height,
    }, {
      width: iframe.clientWidth,
      height: iframe.clientHeight,
    });
  if (!targetRect) return undefined;
  const chrome = layoutCanvasHoverChrome({
    left: iframeRect.left - containerRect.left + targetRect.left,
    top: iframeRect.top - containerRect.top + targetRect.top,
    width: targetRect.width,
    height: targetRect.height,
  });
  return chrome.outline;
}

type ActiveNativeEdit = {
  mode: "editable-island" | "text-fragment";
  rootElement: HTMLElement;
  selectionElement: HTMLElement;
  target: HtmlCanvasSelection;
  projection: SourceTextMap;
  rootTargetRef: SourceTargetRef;
  sourceInnerHtml: string;
  fragmentTargetRef: SourceTargetRef | null;
  fragmentTextNodeId: string | null;
  liveNodeId: string | null;
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

type RetainedNativeEditFocus = {
  session: IslandEditingController;
  lease: ActiveNativeEdit["lease"];
  targetId: string;
  selection: NativeEditSelection;
  textRange: ActiveTextRange | null;
};

function cloneActiveTextRange(
  range: ActiveTextRange | null,
  target?: HtmlCanvasSelection,
): ActiveTextRange | null {
  if (!range) return null;
  return {
    ...range,
    target: target ?? range.target,
    segments: range.segments.map((segment) => ({ ...segment })),
    styleElements: [...range.styleElements],
  };
}

type NativeEditFenceBookmark = {
  fenceId: number;
  target: HtmlCanvasSelection;
  selection: NativeEditSelection;
  focus: boolean;
  toolbarVisible: boolean;
  caretOffsetY?: number | null;
  fragmentTargetRef?: SourceTargetRef;
};

type PendingNativeEditResume = NativeEditFenceBookmark & {
  expectedFrameGeneration: number;
  sourceRevision: string;
};

type NativeFormatShortcut = "bold" | "italic" | "underline";

type NativeEditCommitResult = {
  ok: boolean;
  mutation: HtmlCanvasMutation | null;
  reason?: string;
  frameReloading?: boolean;
};

type FinishNativeEditingOptions = {
  replayQueuedUserCommand?: boolean;
  resumeAfterRuntimeHandoff?: boolean;
};


type SourcePatchCommand = Parameters<typeof planSourcePatch>[0];
type DirectSemanticCommand = {
  type: "direct-semantic-operation";
  operation: SemanticOperation;
};
type CanvasSourceCommand = SourcePatchCommand | DirectSemanticCommand;
type SourcePatchPlan = NonNullable<ReturnType<typeof planSourcePatch>>;
type InlineStylePriority = "" | "important";
type InlineStyleFacts = {
  inlineValue: string | null;
  inlinePriority: InlineStylePriority;
  computedValue: string;
};
type InlineStyleOverride = {
  priority: InlineStylePriority;
  computedValue: string;
};
type PagePresentationActionCache = {
  target: HtmlCanvasSelection;
  sourceIndex: ReturnType<typeof buildSourceIndex>;
  sourceHtml: string;
  documentKey: string;
  generation: number;
  currentContext: PageViewContext | null;
  action: PagePresentationAction | null;
};

function semanticOperationForSourceCommand(
  command: SourcePatchCommand,
  forwardPlan: SourcePatchPlan,
  sourceIndex: SourceIndexValue,
  mutation: HtmlCanvasMutation,
  baseRevision: number,
): SemanticOperation | null {
  const targetRef = "targetRef" in command ? command.targetRef : null;
  const resolution = targetRef ? resolveTargetRef(sourceIndex, targetRef) : null;
  const sourceTarget = resolution?.target;
  if (sourceTarget?.type !== "element" || !sourceTarget.pagerootId) {
    return null;
  }
  const target = createSemanticElementPrecondition(sourceIndex, sourceTarget.pagerootId);
  const envelope = {
    schemaVersion: 1 as const,
    operationId: createSourceOperationId(),
    baseRevision,
    expectedSourceSha256: sourceIndex.sourceSha256,
  };
  if (command.type === "replace-editable-island") {
    const after = mutation.after as { text?: unknown } | null;
    const metadata = forwardPlan.metadata as {
      nextInnerHtml?: unknown;
      createdPagerootIds?: unknown;
    };
    const createdPagerootIds = Array.isArray(metadata.createdPagerootIds)
      ? metadata.createdPagerootIds.map(String)
      : [];
    return {
      ...envelope,
      type: "setText",
      target,
      text: String(after?.text ?? ""),
      contentHtml: String(metadata.nextInnerHtml ?? ""),
      ...(createdPagerootIds.length > 0 ? { createdPagerootIds } : {}),
    };
  }
  if (command.type === "update-direct-text-node") {
    const textResolution = resolveTargetRef(sourceIndex, command.textTargetRef);
    if (textResolution.target?.type !== "text") {
      throw new Error("语义文字范围无法定位到精确源码文本节点。");
    }
    const map = buildSourceTextMap(sourceIndex, sourceTarget.nodeId, { allowEmpty: true });
    const run = map.runs.find((candidate) => (
      candidate.kind === "text"
      && candidate.textNodeId === textResolution.target?.nodeId
    ));
    if (!run || run.kind !== "text") {
      throw new Error("语义文字范围不属于当前稳定源码元素。");
    }
    const after = mutation.after as { text?: unknown } | null;
    return {
      ...envelope,
      type: "replaceTextRange",
      target,
      range: {
        startOffset: run.textStart,
        endOffset: run.textEnd,
        quote: run.text,
      },
      text: String(after?.text ?? ""),
    };
  }
  if (command.type === "set-inline-style") {
    return {
      ...envelope,
      type: "setStyle",
      target,
      property: command.property,
      value: command.value,
      important: command.important === true,
    };
  }
  if (command.type === "set-text-range-style") {
    const map = buildSourceTextMap(sourceIndex, sourceTarget.nodeId, { allowEmpty: true });
    const range = sourceSegmentsToTextRange(map, command.segments);
    const metadata = forwardPlan.metadata as { createdPagerootIds?: unknown };
    const createdPagerootIds = Array.isArray(metadata.createdPagerootIds)
      ? metadata.createdPagerootIds.map(String)
      : [];
    return {
      ...envelope,
      type: "setStyle",
      target,
      property: command.property,
      value: command.value,
      important: command.important === true,
      range: {
        ...range,
        quote: map.text.slice(range.startOffset, range.endOffset),
      },
      ...(createdPagerootIds.length > 0 ? { createdPagerootIds } : {}),
    };
  }
  if (command.type === "reorder-sibling") {
    const parent = sourceTarget.parentId
      ? sourceIndex.byNodeId.get(sourceTarget.parentId)
      : null;
    if (parent?.type !== "element" || !parent.pagerootId) {
      throw new Error("语义排序需要稳定源码父元素。");
    }
    const withoutTarget = parent.childElementIds.filter(
      (nodeId: string) => nodeId !== sourceTarget.nodeId,
    );
    const toIndex = Number(command.toIndex);
    if (!Number.isSafeInteger(toIndex) || toIndex < 0 || toIndex > withoutTarget.length) {
      throw new Error("语义排序目标位置无效。");
    }
    const beforeNode = withoutTarget[toIndex]
      ? sourceIndex.byNodeId.get(withoutTarget[toIndex])
      : null;
    return {
      ...envelope,
      type: "moveElement",
      target,
      parent: createSemanticElementPrecondition(sourceIndex, parent.pagerootId),
      before: beforeNode?.type === "element" && beforeNode.pagerootId
        ? createSemanticElementPrecondition(sourceIndex, beforeNode.pagerootId)
        : null,
    };
  }
  throw new Error(`当前 SourcePatch 类型尚未接入语义操作：${command.type}`);
}

function computedCssValue(element: HTMLElement, cssProperty: string): string {
  return element.ownerDocument.defaultView
    ?.getComputedStyle(element)
    .getPropertyValue(cssProperty)
    .trim() || "";
}

function inlineStyleFacts(element: HTMLElement, cssProperty: string): InlineStyleFacts {
  const inlineValue = element.style.getPropertyValue(cssProperty).trim();
  const priority = element.style.getPropertyPriority(cssProperty);
  return {
    inlineValue: inlineValue || null,
    inlinePriority: priority === "important" ? "important" : "",
    computedValue: computedCssValue(element, cssProperty),
  };
}

function restoreStyleAttribute(element: HTMLElement, styleAttribute: string | null): void {
  if (styleAttribute === null) element.removeAttribute("style");
  else element.setAttribute("style", styleAttribute);
}

function runInlineStyleMutation<T>(
  activeNativeEdit: Pick<ActiveNativeEdit, "session"> | null,
  operation: () => T,
): T | undefined {
  return activeNativeEdit
    ? activeNativeEdit.session.runExpectedMutation(operation)
    : operation();
}

function expectedInlineComputedValue(
  element: HTMLElement,
  cssProperty: string,
  value: string,
  activeNativeEdit: Pick<ActiveNativeEdit, "session"> | null,
): string | null {
  return runInlineStyleMutation(activeNativeEdit, () => {
    const previousStyle = element.getAttribute("style");
    try {
      // Resolve the requested value on the real target so structural selectors
      // such as :last-child remain unchanged during the browser comparison.
      // Inline !important is only a temporary canonicalization step; the exact
      // original style attribute is restored before normal/important trials.
      element.style.setProperty(cssProperty, value, "important");
      if (value.trim() && !element.style.getPropertyValue(cssProperty).trim()) return null;
      return computedCssValue(element, cssProperty) || null;
    } finally {
      restoreStyleAttribute(element, previousStyle);
    }
  }) ?? null;
}

function verifyInlineStyleOverride(
  element: HTMLElement,
  cssProperty: string,
  value: string,
  activeNativeEdit: Pick<ActiveNativeEdit, "session"> | null,
): InlineStyleOverride | null {
  const expectedValue = expectedInlineComputedValue(
    element,
    cssProperty,
    value,
    activeNativeEdit,
  );
  if (expectedValue === null) return null;

  const tryPriority = (priority: InlineStylePriority): string | null => (
    runInlineStyleMutation(activeNativeEdit, () => {
      const previousStyle = element.getAttribute("style");
      try {
        element.style.setProperty(cssProperty, value, priority);
        if (value.trim() && !element.style.getPropertyValue(cssProperty).trim()) {
          return null;
        }
        const actualValue = computedCssValue(element, cssProperty);
        return actualValue === expectedValue ? actualValue : null;
      } finally {
        restoreStyleAttribute(element, previousStyle);
      }
    }) ?? null
  );

  const ordinaryValue = tryPriority("");
  if (ordinaryValue !== null) return { priority: "", computedValue: ordinaryValue };
  const importantValue = tryPriority("important");
  if (importantValue !== null) {
    return { priority: "important", computedValue: importantValue };
  }
  return null;
}

function verifyInlineStyleOverrideForTargets(
  elements: readonly HTMLElement[],
  cssProperty: string,
  value: string,
  activeNativeEdit: Pick<ActiveNativeEdit, "session"> | null,
): InlineStyleOverride | null {
  let resolved: InlineStyleOverride | null = null;
  for (const element of elements) {
    const candidate = verifyInlineStyleOverride(
      element,
      cssProperty,
      value,
      activeNativeEdit,
    );
    if (!candidate) return null;
    resolved = resolved && resolved.priority === "important"
      ? resolved
      : candidate.priority === "important"
        ? candidate
        : resolved || candidate;
  }
  return resolved;
}

const HtmlCanvasEditor = forwardRef<HtmlCanvasEditorHandle, HtmlCanvasEditorProps>(function HtmlCanvasEditor(
  {
    html,
    semanticRevision = 0,
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
    initialScrollTop,
    pointerCapabilityHoverEnabled = true,
  },
  forwardedRef,
) {
  const documentBaseHref = baseHref || baseHrefFromSourcePath(sourcePath);
  const { resourceBase: previewResourceBase, ready: previewAssetsReady } = usePreviewResourceBase(
    html,
    sourcePath,
    Boolean(baseHref),
  );
  const staticAssetBaseHref = previewResourceBase || documentBaseHref;
  const containerRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hoverHintMeasureRef = useRef<HTMLDivElement>(null);
  const selectionChromeProjectionRef = useRef<SelectionChromeProjection | null>(null);
  const pagePresentationActionCacheRef = useRef<PagePresentationActionCache | null>(null);
  const frameWrittenHtmlRef = useRef<string | null>(null);
  const connectFrameRef = useRef<(
    iframe: HTMLIFrameElement,
    connectedFrameGeneration: number,
  ) => boolean>(() => false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const spacingMenuRef = useRef<HTMLDetailsElement>(null);
  const selectedElementRef = useRef<HTMLElement | null>(null);
  const runtimeGeneratedSelectionRef = useRef(false);
  const selectedSourceSelectionRef = useRef<HtmlCanvasSelection | null>(null);
  const activeTextRangeRef = useRef<ActiveTextRange | null>(null);
  const activeNativeEditRef = useRef<ActiveNativeEdit | null>(null);
  const nativeCommandQueueRef = useRef(new NativeDeferredCommandQueue());
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
  const canvasTargetIdentityScopeRef = useRef<CanvasTargetIdentityScope>(
    createCanvasTargetIdentityScope(0),
  );
  const canvasTargetIdentityScopeForGeneration = useCallback((generation: number) => {
    const normalizedGeneration = Number.isSafeInteger(Number(generation))
      ? Math.max(0, Number(generation))
      : 0;
    const current = canvasTargetIdentityScopeRef.current;
    if (current.generation === normalizedGeneration) return current;
    const next = createCanvasTargetIdentityScope(normalizedGeneration);
    canvasTargetIdentityScopeRef.current = next;
    return next;
  }, []);
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
  const connectedFrameRef = useRef<{
    iframe: HTMLIFrameElement;
    generation: number;
  } | null>(null);
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
  const pointerCapabilityHoverEnabledRef = useRef(pointerCapabilityHoverEnabled);
  const hoverControllerRef = useRef<ReturnType<typeof createCanvasCapabilityHoverController> | null>(null);
  const hoverHintPointerInsideRef = useRef(false);
  const pendingFrameViewportRef = useRef<{ left: number; top: number } | null>(null);
  const pendingSharedViewportRef = useRef<{
    element: HTMLElement;
    left: number;
    top: number;
  } | null>(null);
  const lastValidCommentLayoutRef = useRef<HtmlCanvasCommentLayoutState | null>(null);
  const expectedFrameHtmlRef = useRef<string | null>(null);
  const expectedFrameTokenRef = useRef<string | null>(null);
  const frameLoadGenerationRef = useRef(0);
  const frameGenerationSequenceRef = useRef(0);
  const activeFrameConnectionPendingRef = useRef(false);
  const runtimeFrameRef = useRef<RuntimeFrameContext | null>(null);
  const runtimeReadyReportedRef = useRef(new WeakSet<RuntimeFrameContext>());
  const runtimeSourceElementsRef = useRef<RuntimeSourceElements | null>(null);
  const runtimeSourceRegistrationCleanupRef = useRef<() => void>(() => undefined);
  const runtimeNeedsRerenderRef = useRef(false);
  const runtimeCandidateRef = useRef<RuntimeCandidate | null>(null);
  const runtimeCandidateIframeRef = useRef<HTMLIFrameElement | null>(null);
  const runtimePromotionRef = useRef<RuntimeCandidate | null>(null);
  const runtimeRetiringCleanupFrameRef = useRef<number | null>(null);
  const runtimeRetiringGenerationRef = useRef<number | null>(null);
  const finalizeRuntimePromotionRef = useRef<(candidate: RuntimeCandidate) => void>(
    () => undefined,
  );
  const rollbackRuntimePromotionRef = useRef<(
    candidate: RuntimeCandidate,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
  ) => boolean>(() => false);
  const failActiveRuntimeFrameRef = useRef<(
    frame: RuntimeFrameContext,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
  ) => boolean>(() => false);
  const failRuntimeCandidateActivationRef = useRef<(
    candidate: RuntimeCandidate,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
  ) => boolean>(() => false);
  const cancelRuntimeCandidateRef = useRef<(outcome?: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">) => void>(
    () => undefined,
  );
  const startRuntimeCandidateRef = useRef<(source: string, options?: { runtimeFallback?: boolean }) => boolean>(
    () => false,
  );
  const connectRuntimeCandidateRef = useRef<(
    iframe: HTMLIFrameElement,
    generation: number,
  ) => boolean>(() => false);
  const imperativeLockRef = useRef(false);
  const lastPropRef = useRef({ html, baseHref: documentBaseHref });
  const semanticRevisionRef = useRef(semanticRevision);
  const lastSemanticRevisionPropRef = useRef(semanticRevision);
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
  if (lastSemanticRevisionPropRef.current !== semanticRevision) {
    lastSemanticRevisionPropRef.current = semanticRevision;
    semanticRevisionRef.current = semanticRevision;
  }
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
  pointerCapabilityHoverEnabledRef.current = pointerCapabilityHoverEnabled;

  const currentRuntimeSourceProof = useCallback(() => {
    const runtimeFrame = runtimeFrameRef.current;
    if (
      !runtimeFrame?.settled
      || runtimeFrame.elementGeneration !== frameLoadGenerationRef.current
    ) return null;
    const registered = runtimeSourceElementsRef.current;
    return (element: HTMLElement) => {
      const registeredMarkerId = registered?.markerSourceNodeIds.get(element);
      const registeredPagerootId = registered?.pagerootIds.get(element);
      const liveSourceNodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE);
      const liveSourceEntry = liveSourceNodeId
        ? sourceIndexRef.current?.byNodeId.get(liveSourceNodeId)
        : null;
      return Boolean(
        registered
        && registered.elementGeneration === runtimeFrame.elementGeneration
        && registered.executionId === runtimeFrame.grant.executionId
        && registered.elements.has(element)
        && registeredMarkerId
        && registeredMarkerId === element.getAttribute(
          EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE,
        )
        && registeredPagerootId
        && registeredPagerootId === element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE)
        && liveSourceEntry?.type === "element"
        && liveSourceEntry.pagerootId === registeredPagerootId
      );
    };
  }, []);

  const selectedElementHasSourceMutationAuthority = useCallback(() => {
    const element = selectedElementRef.current;
    if (
      !element?.isConnected
      || runtimeGeneratedSelectionRef.current
    ) return false;
    if (!runtimeFrameRef.current) return true;
    return Boolean(currentRuntimeSourceProof()?.(element));
  }, [currentRuntimeSourceProof]);

  // Keep the server and hydration value deterministic, then normalize through DOMParser after mount.
  const [frameRender, setFrameRender] = useState(() => ({
    html: disableExecutableMarkup(html),
    elementGeneration: 0,
    runtime: false,
  }));
  const { getScrollTop, restoreInitialScroll, scrollToTop } = useCanvasPresentationScroll({
    iframeRef,
    frameGeneration: frameRender.elementGeneration,
    initialScrollTop,
  });
  const [canvasTransitionActive, setCanvasTransitionActive] = useState(false);
  const [runtimeCandidateRender, setRuntimeCandidateRender] = useState<RuntimeCandidateRender | null>(null);
  const [runtimeRetiringRender, setRuntimeRetiringRender] = useState<RuntimeCandidateRender | null>(null);
  const [selection, setSelection] = useState<HtmlCanvasSelection | null>(null);
  const [runtimeGeneratedSelection, setRuntimeGeneratedSelection] = useState(false);
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition | null>(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [hoverChrome, setHoverChrome] = useState<CanvasCapabilityHoverSnapshot>({
    cursor: "default",
    outline: false,
    hint: false,
    capability: null,
  });
  const [hoverHintMeasurement, setHoverHintMeasurement] = useState<{
    copy: string;
    width: number;
  } | null>(null);
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
  });
  const [moveAvailability, setMoveAvailability] = useState<MoveAvailability>({ up: false, down: false });
  const [isEditing, setIsEditing] = useState(false);
  const [, setInsertionPoints] = useState<InsertionPoint[]>([]);
  const [commentMarkers, setCommentMarkers] = useState<HtmlCanvasCommentMarker[]>([]);
  const [, setSelectedInsertionId] = useState<string | null>(null);
  const [editFeedback, setEditFeedback] = useState<HtmlCanvasEditFeedback | null>(null);
  const [editFeedbackPaused, setEditFeedbackPaused] = useState(false);
  const [spacingMenuOpen, setSpacingMenuOpen] = useState(false);

  toolbarVisibleRef.current = toolbarVisible;

  useEffect(() => {
    const controller = createCanvasCapabilityHoverController({
      onChange: setHoverChrome,
    });
    hoverControllerRef.current = controller;
    return () => {
      controller.dispose();
      hoverControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (pointerCapabilityHoverEnabled) return;
    hoverControllerRef.current?.hide();
  }, [pointerCapabilityHoverEnabled]);

  useEffect(() => {
    // contentDocument can be alive while documentElement is null: that is the
    // iframe navigation window, where the old document is detached and the next
    // one has not parsed its root element yet. Touching the root there throws
    // during commit and unmounts the whole tree, so the effect simply waits for
    // the next run, which the cursor/hover state change already schedules.
    const rootElement = iframeRef.current?.contentDocument?.documentElement;
    if (!rootElement) return;
    if (!pointerCapabilityHoverEnabled || hoverChrome.cursor === "default") {
      rootElement.removeAttribute("data-html-canvas-pointer");
      return;
    }
    rootElement.setAttribute(
      "data-html-canvas-pointer",
      hoverChrome.cursor,
    );
  }, [hoverChrome.cursor, pointerCapabilityHoverEnabled]);

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
      forceRuntimeHandoff?: boolean;
      reuseDocument?: boolean;
    } = {},
  ) => {
    const promotedCandidate = runtimePromotionRef.current;
    if (promotedCandidate) {
      // A newer authoritative source update may arrive during the final handoff
      // frame. Roll back the not-yet-settled promotion before starting that load
      // so the retiring document remains the only live active context.
      rollbackRuntimePromotionRef.current(promotedCandidate, "failed");
    }
    const currentRuntime = runtimeFrameRef.current;
    const runtimeIsCurrent = Boolean(
      currentRuntime?.settled
      && currentRuntime.elementGeneration === frameLoadGenerationRef.current,
    );
    if (
      runtimeIsCurrent
      && !activeNativeEditRef.current
      && !options.immediate
      && !options.forceStatic
      // A native editable-island commit has already advanced the source
      // authority in place, but the disposable Runtime document still needs
      // to be rebuilt. Treat that explicit rerender request like a source
      // change so Enter and copy share the same visible handoff path.
      && (
        source !== frameSourceHtmlRef.current
        || runtimeNeedsRerenderRef.current
        || options.forceRuntimeHandoff
      )
      && startRuntimeCandidateRef.current(source)
    ) return;
    cancelRuntimeCandidateRef.current();
    performance.mark("pageroot:canvas:load-start");
    const frameView = iframeRef.current?.contentWindow;
    pendingFrameViewportRef.current = options.preserveViewport && frameView
      ? { left: frameView.scrollX, top: frameView.scrollY }
      : null;
    const sharedScrollElement = containerRef.current?.closest<HTMLElement>(
      ".review-scroll-stage",
    ) ?? null;
    pendingSharedViewportRef.current = options.preserveViewport && sharedScrollElement
      ? {
          element: sharedScrollElement,
          left: sharedScrollElement.scrollLeft,
          top: sharedScrollElement.scrollTop,
        }
      : null;
    runtimeSourceRegistrationCleanupRef.current();
    runtimeSourceRegistrationCleanupRef.current = () => undefined;
    runtimeSourceElementsRef.current = null;
    // A frame load invalidates every DOM reference. Keep only the logical
    // selection snapshot for the existing selectTarget() rebind path.
    selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
    selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
    selectedElementRef.current = null;
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;
    const reuseCandidate = Boolean(options.reuseDocument)
      && !options.immediate
      && !options.forceStatic
      && Boolean(iframeRef.current?.contentDocument?.documentElement);
    // Retire the old document's canvas handlers before advancing any source,
    // token, or generation authority. A non-immediate React remount may not
    // commit until the current task ends; without this cut the old DOM could
    // briefly dispatch against the next source map (or keep listeners forever
    // if the replacement document never reaches load).
    hoverControllerRef.current?.hide();
    cleanupFrameRef.current();
    connectedFrameRef.current = null;
    const retiringRuntimeFrame = runtimeFrameRef.current;
    runtimeFrameRef.current = null;
    if (retiringRuntimeFrame && !retiringRuntimeFrame.settled) {
      onEditRuntimeLoadOutcomeRef.current?.(retiringRuntimeFrame.grant, "failed");
    }
    pendingFrameRestoreEpochRef.current += 1;
    if (!reuseCandidate) {
      frameLoadGenerationRef.current += 1;
    }
    const nextFrameGeneration = frameLoadGenerationRef.current;
    frameGenerationSequenceRef.current = Math.max(
      frameGenerationSequenceRef.current,
      nextFrameGeneration,
    );
    nativeDomGenerationRef.current += 1;
    nativeSessionNeedsCanonicalFenceRef.current = false;
    nativeEditNeedsReloadRef.current = false;
    currentNativeEditLeaseRef.current = null;
    retainNativeEditFocusRef.current = null;
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
    performance.mark("pageroot:canvas:instrumented");
    const sourceIndex = sourceIndexRef.current;
    const runtimeGrant = options.forceStatic || reuseCandidate ? null : editRuntimeGrant;
    let runtimeFrame: RuntimeFrameContext | null = null;
    let verificationToken = token;
    let prepared: string | null = null;
    if (runtimeGrant) {
      if (
        sourceIndex?.source === source
        && editRuntimeProgramIdentity(source) === runtimeGrant.programIdentity
      ) {
        const runtimeToken = `edit-runtime-frame-${runtimeGrant.executionId}`;
        if (isEditRuntimeFrameToken(runtimeToken)) {
          const runtimeDocument = prepareCanvasFrameDocument(
            instrumentedSource,
            runtimeToken,
            {
              mode: "disposable-runtime",
              sessionId: runtimeGrant.sessionId,
              executionId: runtimeGrant.executionId,
              documentBasePath: runtimeGrant.documentBasePath,
              baseUrl: documentBaseHref,
              editorStyles: EDITOR_DOCUMENT_STYLES,
            },
          );
          if (runtimeDocument) {
            prepared = runtimeDocument;
            verificationToken = runtimeToken;
            runtimeNeedsRerenderRef.current = false;
            runtimeFrame = {
              grant: runtimeGrant,
              verificationToken: runtimeToken,
              elementGeneration: nextFrameGeneration,
              activation: "pending",
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
        baseUrl: staticAssetBaseHref,
        editorStyles: EDITOR_DOCUMENT_STYLES,
      }) || prepareVerifiedFrameDocument(instrumentedSource, token, {
        baseUrl: staticAssetBaseHref,
        editorStyles: EDITOR_DOCUMENT_STYLES,
      });
    }
    frameSourceHtmlRef.current = source;
    expectedFrameTokenRef.current = verificationToken;
    expectedFrameHtmlRef.current = prepared;
    renderedSourceHtmlRef.current = null;
    containerRef.current?.removeAttribute("data-runtime-bootstrap-count");
    runtimeFrameRef.current = runtimeFrame;
    if (runtimeFrame) {
      const registrationProperty = editRuntimeRegistrationProperty(
        runtimeFrame.grant.executionId,
      );
      if (registrationProperty) {
        const parentGlobals = window as unknown as Record<string, unknown>;
        const openRegistration = (
          sourceWindow: unknown,
          identity: {
            sessionId?: unknown;
            executionId?: unknown;
            frameToken?: unknown;
          } | null,
        ) => {
          const current = runtimeFrameRef.current;
          const iframe = iframeRef.current;
          if (
            !current
            || current.elementGeneration !== runtimeFrame.elementGeneration
            || identity?.sessionId !== runtimeFrame.grant.sessionId
            || current.grant.executionId !== runtimeFrame.grant.executionId
            || identity?.executionId !== runtimeFrame.grant.executionId
            || identity?.frameToken !== runtimeFrame.verificationToken
            || sourceWindow !== iframe?.contentWindow
          ) return null;
          if (parentGlobals[registrationProperty] === openRegistration) {
            delete parentGlobals[registrationProperty];
          }
          runtimeSourceRegistrationCleanupRef.current = () => undefined;
          const elements = new WeakSet<HTMLElement>();
          const elementsBySourceNodeId = new Map<string, HTMLElement>();
          const sourceNodeIdByElement = new WeakMap<HTMLElement, string>();
          const pagerootIdByElement = new WeakMap<HTMLElement, string>();
          const conflictedSourceNodeIds = new Set<string>();
          runtimeSourceElementsRef.current = {
            elementGeneration: runtimeFrame.elementGeneration,
            executionId: runtimeFrame.grant.executionId,
            elements,
            markerSourceNodeIds: sourceNodeIdByElement,
            pagerootIds: pagerootIdByElement,
          };
          const registerProved = (candidates: unknown) => {
            const active = runtimeFrameRef.current;
            const activeIframe = iframeRef.current;
            if (
              !Array.isArray(candidates)
              || !activeIframe
              || active?.elementGeneration !== runtimeFrame.elementGeneration
              || active.grant.executionId !== runtimeFrame.grant.executionId
              || sourceWindow !== activeIframe?.contentWindow
            ) return false;
            const sourceIndex = sourceIndexRef.current;
            for (const value of candidates) {
              const element = value as HTMLElement;
              if (
                element?.nodeType !== 1
                || typeof element.getAttribute !== "function"
                || element.ownerDocument !== activeIframe.contentDocument
              ) continue;
              const sourceNodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE);
              const sourceEntry = sourceNodeId
                ? sourceIndex?.byNodeId.get(sourceNodeId)
                : null;
              const pagerootId = sourceEntry?.type === "element"
                ? sourceEntry.pagerootId
                : null;
              if (
                sourceNodeId
                && pagerootId
                && element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE) === pagerootId
                && element.getAttribute(EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE) === sourceNodeId
              ) {
                if (conflictedSourceNodeIds.has(sourceNodeId)) continue;
                const existing = elementsBySourceNodeId.get(sourceNodeId);
                if (existing && existing !== element) {
                  elements.delete(existing);
                  elementsBySourceNodeId.delete(sourceNodeId);
                  conflictedSourceNodeIds.add(sourceNodeId);
                  continue;
                }
                elementsBySourceNodeId.set(sourceNodeId, element);
                sourceNodeIdByElement.set(element, sourceNodeId);
                pagerootIdByElement.set(element, pagerootId);
                elements.add(element);
              }
            }
            return true;
          };
          const reportActivationOutcome = (outcome: unknown) => {
            const active = runtimeFrameRef.current;
            const activeIframe = iframeRef.current;
            if (
              active !== runtimeFrame
              || active.activation !== "pending"
              || sourceWindow !== activeIframe?.contentWindow
            ) return false;
            if (outcome === "activation-ready") {
              active.activation = "ready";
              return true;
            }
            if (outcome !== "activation-failed") return false;
            active.activation = "failed";
            queueMicrotask(() => {
              failActiveRuntimeFrameRef.current(active, "failed");
            });
            return true;
          };
          return { registerProved, reportActivationOutcome };
        };
        Object.defineProperty(parentGlobals, registrationProperty, {
          configurable: true,
          enumerable: false,
          writable: false,
          value: openRegistration,
        });
        runtimeSourceRegistrationCleanupRef.current = () => {
          if (parentGlobals[registrationProperty] === openRegistration) {
            delete parentGlobals[registrationProperty];
          }
        };
      }
      onEditRuntimeLoadStartRef.current?.(runtimeFrame.grant);
    }
    const iframe = iframeRef.current;
    if (reuseCandidate && iframe && prepared && !runtimeFrame) {
      try {
        containerRef.current?.setAttribute("data-canvas-transition", "true");
        setCanvasTransitionActive(true);
        const documentNode = iframe.contentDocument;
        if (!documentNode) throw new Error("missing content document");
        documentNode.open();
        documentNode.write(prepared);
        documentNode.close();
        frameWrittenHtmlRef.current = prepared;
        connectFrameRef.current(iframe, nextFrameGeneration);
        window.requestAnimationFrame(() => {
          containerRef.current?.removeAttribute("data-canvas-transition");
          setCanvasTransitionActive(false);
        });
        return;
      } catch {
        containerRef.current?.removeAttribute("data-canvas-transition");
        setCanvasTransitionActive(false);
        frameWrittenHtmlRef.current = null;
        frameLoadGenerationRef.current += 1;
      }
    }
    frameWrittenHtmlRef.current = null;
    containerRef.current?.setAttribute("data-render-verified", "false");
    const remountGeneration = frameLoadGenerationRef.current;
    const replaceFrameElement = () => {
      setFrameRender({
        html: prepared,
        elementGeneration: remountGeneration,
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
  }, [documentBaseHref, editRuntimeGrant, staticAssetBaseHref]);

  const clearRuntimeRetiringFrame = useCallback(() => {
    const cleanupFrame = runtimeRetiringCleanupFrameRef.current;
    if (cleanupFrame !== null) window.cancelAnimationFrame(cleanupFrame);
    runtimeRetiringCleanupFrameRef.current = null;
    runtimeRetiringGenerationRef.current = null;
    setRuntimeRetiringRender(null);
  }, []);

  const scheduleRuntimeRetiringFrameRemoval = useCallback((generation: number) => {
    const cleanupFrame = runtimeRetiringCleanupFrameRef.current;
    if (cleanupFrame !== null) window.cancelAnimationFrame(cleanupFrame);
    runtimeRetiringGenerationRef.current = generation;
    runtimeRetiringCleanupFrameRef.current = window.requestAnimationFrame(() => {
      runtimeRetiringCleanupFrameRef.current = null;
      if (runtimeRetiringGenerationRef.current !== generation) return;
      runtimeRetiringGenerationRef.current = null;
      setRuntimeRetiringRender(null);
      if (containerRef.current?.getAttribute("data-runtime-handoff") === "active") {
        containerRef.current.removeAttribute("data-runtime-handoff");
      }
    });
  }, []);

  const cancelRuntimeCandidate = useCallback((
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready"> = "failed",
  ) => {
    const candidate = runtimeCandidateRef.current;
    if (!candidate) return;
    candidate.handoffScrollCleanup();
    candidate.handoffScrollCleanup = () => undefined;
    candidate.registrationCleanup();
    if (candidate.runtimeFrame && !candidate.outcomeReported) {
      candidate.outcomeReported = true;
      onEditRuntimeLoadOutcomeRef.current?.(candidate.runtimeFrame.grant, outcome);
    }
    pendingSelectionRef.current = candidate.previousPendingSelection;
    pendingToolbarVisibleRef.current = candidate.previousPendingToolbarVisible;
    // A candidate that is cancelled before it reaches active is not a valid
    // internal checkpoint continuation. Do not let its stale resume request
    // turn the previous frame back into a contenteditable surface.
    pendingNativeEditResumeRef.current = null;
    runtimeCandidateRef.current = null;
    runtimeCandidateIframeRef.current = null;
    setRuntimeCandidateRender(null);
    containerRef.current?.removeAttribute("data-runtime-handoff");
  }, []);
  cancelRuntimeCandidateRef.current = cancelRuntimeCandidate;

  const startRuntimeCandidate = useCallback((
    source: string,
    options: { runtimeFallback?: boolean } = {},
  ): boolean => {
    const currentRuntime = runtimeFrameRef.current;
    if (
      activeNativeEditRef.current
      || !currentRuntime?.settled
      || currentRuntime.elementGeneration !== frameLoadGenerationRef.current
    ) return false;

    if (runtimeRetiringGenerationRef.current !== null) {
      clearRuntimeRetiringFrame();
    }
    cancelRuntimeCandidateRef.current();
    const previousPendingSelection = pendingSelectionRef.current;
    const previousPendingToolbarVisible = pendingToolbarVisibleRef.current;
    const previousPendingNativeEditResume = pendingNativeEditResumeRef.current;
    const currentFrame = iframeRef.current;
    const activeEditForViewport = activeNativeEditRef.current as ActiveNativeEdit | null;
    const sharedScrollElement = containerRef.current?.closest<HTMLElement>(
      ".review-scroll-stage",
    ) ?? null;
    const previousSelectedElement = selectedElementRef.current;
    const previousSelectedSourceSelection = selectedSourceSelectionRef.current;
    const previousActiveTextRange = cloneActiveTextRange(activeTextRangeRef.current);
    const viewportSnapshot = captureRuntimeViewportSnapshot({
      iframe: currentFrame,
      sharedScrollElement,
      sourceIndex: sourceIndexRef.current,
      selectedElement: activeEditForViewport?.selectionElement
        ?? previousSelectedElement,
      selectedSourceSelection: previousSelectedSourceSelection,
      nativeSelection: activeEditForViewport?.selection
        ?? retainNativeEditFocusRef.current?.selection
        ?? previousPendingNativeEditResume?.selection
        ?? null,
      caretOffsetYOverride: previousPendingNativeEditResume?.caretOffsetY,
    });
    if (!pendingSelectionRef.current && selectedSourceSelectionRef.current) {
      pendingSelectionRef.current = selectedSourceSelectionRef.current;
    }
    pendingToolbarVisibleRef.current = Boolean(
      pendingSelectionRef.current && toolbarVisibleRef.current,
    );
    containerRef.current?.setAttribute("data-runtime-handoff", "preparing");

    const candidateGeneration = Math.max(
      frameLoadGenerationRef.current + 1,
      frameGenerationSequenceRef.current + 1,
    );
    frameGenerationSequenceRef.current = candidateGeneration;
    let sourceIndex: SourceIndexValue | null = null;
    let instrumentedSource = source;
    let sourceMapFailed = false;
    try {
      sourceIndex = buildSourceIndex(source);
      instrumentedSource = instrumentPreviewHtml(sourceIndex, {
        attributeName: SOURCE_NODE_ATTRIBUTE,
      }).html;
    } catch (cause) {
      setEditFeedback({
        code: "canvas_c01_source_map",
        title: "暂时不能直接编辑这个页面",
        message: "页面仍可正常浏览。请重新载入后再试，或添加评论说明要改什么。",
        tone: "error",
        sticky: true,
        recovery: "reload",
      });
      onEditBlockedRef.current?.(
        cause instanceof Error ? cause.message : String(cause),
      );
      sourceMapFailed = true;
    }
    if (sourceMapFailed) {
      pendingSelectionRef.current = previousPendingSelection;
      pendingToolbarVisibleRef.current = previousPendingToolbarVisible;
      containerRef.current?.removeAttribute("data-runtime-handoff");
      return true;
    }

    const runtimeGrant = options.runtimeFallback ? null : editRuntimeGrant;
    let runtimeFrame: RuntimeFrameContext | null = null;
    let verificationToken = `frame_${candidateGeneration}_${
      globalThis.crypto?.randomUUID?.()
      ?? `${Date.now()}_${Math.random().toString(36).slice(2)}`
    }`;
    let prepared: string | null = null;
    if (
      runtimeGrant
      && sourceIndex?.source === source
      && editRuntimeProgramIdentity(source) === runtimeGrant.programIdentity
    ) {
      const runtimeToken = `edit-runtime-frame-${runtimeGrant.executionId}`;
      if (isEditRuntimeFrameToken(runtimeToken)) {
        prepared = prepareCanvasFrameDocument(
          instrumentedSource,
          runtimeToken,
          {
            mode: "disposable-runtime",
            sessionId: runtimeGrant.sessionId,
            executionId: runtimeGrant.executionId,
            documentBasePath: runtimeGrant.documentBasePath,
            baseUrl: documentBaseHref,
            editorStyles: EDITOR_DOCUMENT_STYLES,
          },
        );
        if (prepared) {
          verificationToken = runtimeToken;
          runtimeFrame = {
            grant: runtimeGrant,
            verificationToken: runtimeToken,
            elementGeneration: candidateGeneration,
            activation: "pending",
            settled: false,
          };
        }
      }
    }
    if (runtimeGrant && !runtimeFrame) {
      onEditRuntimeLoadOutcomeRef.current?.(runtimeGrant, "rejected");
    }
    if (!prepared) {
      prepared = prepareCanvasFrameDocument(instrumentedSource, verificationToken, {
        mode: "static",
        baseUrl: staticAssetBaseHref,
        editorStyles: EDITOR_DOCUMENT_STYLES,
      }) || prepareVerifiedFrameDocument(instrumentedSource, verificationToken, {
        baseUrl: staticAssetBaseHref,
        editorStyles: EDITOR_DOCUMENT_STYLES,
      });
    }
    if (!prepared) {
      pendingSelectionRef.current = previousPendingSelection;
      pendingToolbarVisibleRef.current = previousPendingToolbarVisible;
      containerRef.current?.removeAttribute("data-runtime-handoff");
      setEditFeedback({
        code: "canvas_c01_source_map",
        title: "页面预览没有完成",
        message: "当前画布仍保持上一帧完整内容，请重新载入后再试。",
        tone: "error",
        sticky: true,
        recovery: "reload",
      });
      return true;
    }

    if (pendingNativeEditResumeRef.current) {
      pendingNativeEditResumeRef.current = {
        ...pendingNativeEditResumeRef.current,
        expectedFrameGeneration: candidateGeneration,
        sourceRevision: sourceIndex?.sourceSha256
          ?? pendingNativeEditResumeRef.current.sourceRevision,
      };
    }

    const candidate: RuntimeCandidate = {
      source,
      sourceIndex,
      prepared,
      verificationToken,
      render: {
        html: prepared,
        elementGeneration: candidateGeneration,
        runtime: Boolean(runtimeFrame),
      },
      runtimeFrame,
      sourceElements: null,
      registrationCleanup: () => undefined,
      loaded: false,
      outcomeReported: false,
      previousPendingSelection,
      previousPendingToolbarVisible,
      viewportSnapshot,
      sharedViewportElement: sharedScrollElement,
      handoffScrollState: createRuntimeHandoffScrollState(),
      refreshViewportSnapshot: () => undefined,
      markProgrammaticScroll: () => undefined,
      handoffScrollCleanup: () => undefined,
      previousActive: {
        render: frameRender,
        cleanupFrame: cleanupFrameRef.current,
        runtimeFrame: runtimeFrameRef.current,
        runtimeSourceElements: runtimeSourceElementsRef.current,
        runtimeSourceRegistrationCleanup: runtimeSourceRegistrationCleanupRef.current,
        frameGeneration: frameLoadGenerationRef.current,
        nativeDomGeneration: nativeDomGenerationRef.current,
        sourceIndex: sourceIndexRef.current,
        frameSourceHtml: frameSourceHtmlRef.current,
        frameWrittenHtml: frameWrittenHtmlRef.current,
        expectedFrameHtml: expectedFrameHtmlRef.current,
        expectedFrameToken: expectedFrameTokenRef.current,
        renderedSourceHtml: renderedSourceHtmlRef.current,
        appliedPageViewContext: appliedPageViewContextRef.current,
        activeFrameConnectionPending: activeFrameConnectionPendingRef.current,
        runtimeNeedsRerender: runtimeNeedsRerenderRef.current,
        pendingFrameViewport: pendingFrameViewportRef.current,
        pendingSharedViewport: pendingSharedViewportRef.current,
        pendingFrameRestoreEpoch: pendingFrameRestoreEpochRef.current,
        nativeSessionNeedsCanonicalFence: nativeSessionNeedsCanonicalFenceRef.current,
        nativeEditNeedsReload: nativeEditNeedsReloadRef.current,
        pendingNativeEditResume: previousPendingNativeEditResume,
        selectedElement: previousSelectedElement,
        selectedSourceSelection: previousSelectedSourceSelection,
        activeTextRange: previousActiveTextRange,
        toolbarVisible: toolbarVisibleRef.current,
        runtimeGeneratedSelection: runtimeGeneratedSelectionRef.current,
        connectedFrame: connectedFrameRef.current,
      },
    };
    candidate.refreshViewportSnapshot = (channel, sourceFrame = currentFrame) => {
      const sourceDocument = sourceFrame?.contentDocument;
      if (!sourceDocument) return;
      const sourceIsPreviousActive = sourceFrame === currentFrame;
      const sourceIndexForSnapshot = sourceIsPreviousActive
        ? candidate.previousActive.sourceIndex
        : candidate.sourceIndex;
      const selectedElementForSnapshot = sourceIsPreviousActive
        ? candidate.previousActive.selectedElement ?? selectedElementRef.current
        : selectedElementRef.current;
      const selectedSourceSelectionForSnapshot = (
        sourceIsPreviousActive
          ? candidate.previousActive.selectedSourceSelection
          : selectedSourceSelectionRef.current
      ) ?? selectedSourceSelectionRef.current;
      const latest = captureRuntimeViewportSnapshot({
        iframe: sourceFrame,
        sharedScrollElement: candidate.sharedViewportElement,
        sourceIndex: sourceIndexForSnapshot,
        selectedElement: selectedElementForSnapshot,
        selectedSourceSelection: selectedSourceSelectionForSnapshot,
        nativeSelection: candidate.viewportSnapshot.nativeSelection,
        caretOffsetYOverride: candidate.viewportSnapshot.caretOffsetY,
      });
      const previous = candidate.viewportSnapshot;
      const anchorStableId = latest.viewportAnchorStableId
        || previous.viewportAnchorStableId;
      if (channel === "frame") {
        Object.assign(previous, {
          iframeScrollX: latest.iframeScrollX,
          iframeScrollY: latest.iframeScrollY,
          viewportAnchorStableId: anchorStableId,
          viewportAnchorOffsetY: latest.viewportAnchorOffsetY,
          viewportAnchorSharedOffsetY: latest.viewportAnchorSharedOffsetY,
        });
      } else {
        Object.assign(previous, {
          sharedScrollLeft: latest.sharedScrollLeft,
          sharedScrollTop: latest.sharedScrollTop,
          viewportAnchorStableId: anchorStableId,
          viewportAnchorSharedOffsetY: latest.viewportAnchorSharedOffsetY,
        });
      }
      if (latest.selectedStableId) previous.selectedStableId = latest.selectedStableId;
    };
    candidate.handoffScrollCleanup = attachRuntimeHandoffScrollListeners({
      candidate,
      iframe: currentFrame,
      sharedScrollElement,
      includeShared: true,
    });
    if (runtimeFrame) {
      const registrationProperty = editRuntimeRegistrationProperty(
        runtimeFrame.grant.executionId,
      );
      if (registrationProperty) {
        const parentGlobals = window as unknown as Record<string, unknown>;
        const openRegistration = (
          sourceWindow: unknown,
          identity: {
            sessionId?: unknown;
            executionId?: unknown;
            frameToken?: unknown;
          } | null,
        ) => {
          const activeCandidate = runtimeCandidateRef.current;
          const iframe = runtimeCandidateIframeRef.current;
          if (
            activeCandidate !== candidate
            || identity?.sessionId !== runtimeFrame.grant.sessionId
            || identity?.executionId !== runtimeFrame.grant.executionId
            || identity?.frameToken !== runtimeFrame.verificationToken
            || sourceWindow !== iframe?.contentWindow
          ) return null;
          if (parentGlobals[registrationProperty] === openRegistration) {
            delete parentGlobals[registrationProperty];
          }
          const elements = new WeakSet<HTMLElement>();
          const elementsBySourceNodeId = new Map<string, HTMLElement>();
          const sourceNodeIdByElement = new WeakMap<HTMLElement, string>();
          const pagerootIdByElement = new WeakMap<HTMLElement, string>();
          const conflictedSourceNodeIds = new Set<string>();
          candidate.sourceElements = {
            elementGeneration: candidateGeneration,
            executionId: runtimeFrame.grant.executionId,
            elements,
            markerSourceNodeIds: sourceNodeIdByElement,
            pagerootIds: pagerootIdByElement,
          };
          const registerProved = (candidates: unknown) => {
            const currentCandidate = runtimeCandidateRef.current;
            const activeIframe = runtimeCandidateIframeRef.current;
            if (
              !Array.isArray(candidates)
              || currentCandidate !== candidate
              || !activeIframe
              || sourceWindow !== activeIframe?.contentWindow
            ) return false;
            for (const value of candidates) {
              const element = value as HTMLElement;
              if (
                element?.nodeType !== 1
                || typeof element.getAttribute !== "function"
                || element.ownerDocument !== activeIframe.contentDocument
              ) continue;
              const sourceNodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE);
              const sourceEntry = sourceNodeId
                ? sourceIndex?.byNodeId.get(sourceNodeId)
                : null;
              const pagerootId = sourceEntry?.type === "element"
                ? sourceEntry.pagerootId
                : null;
              if (
                sourceNodeId
                && pagerootId
                && element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE) === pagerootId
                && element.getAttribute(EDIT_RUNTIME_SOURCE_MARKER_ATTRIBUTE) === sourceNodeId
              ) {
                if (conflictedSourceNodeIds.has(sourceNodeId)) continue;
                const existing = elementsBySourceNodeId.get(sourceNodeId);
                if (existing && existing !== element) {
                  elements.delete(existing);
                  elementsBySourceNodeId.delete(sourceNodeId);
                  conflictedSourceNodeIds.add(sourceNodeId);
                  continue;
                }
                elementsBySourceNodeId.set(sourceNodeId, element);
                sourceNodeIdByElement.set(element, sourceNodeId);
                pagerootIdByElement.set(element, pagerootId);
                elements.add(element);
              }
            }
            return true;
          };
          const reportActivationOutcome = (outcome: unknown) => {
            const currentCandidate = runtimeCandidateRef.current;
            const activeIframe = runtimeCandidateIframeRef.current;
            if (
              currentCandidate !== candidate
              || runtimeFrame.activation !== "pending"
              || sourceWindow !== activeIframe?.contentWindow
            ) return false;
            if (outcome === "activation-ready") {
              runtimeFrame.activation = "ready";
              return true;
            }
            if (outcome !== "activation-failed") return false;
            runtimeFrame.activation = "failed";
            queueMicrotask(() => {
              failRuntimeCandidateActivationRef.current(candidate, "failed");
            });
            return true;
          };
          return { registerProved, reportActivationOutcome };
        };
        Object.defineProperty(parentGlobals, registrationProperty, {
          configurable: true,
          enumerable: false,
          writable: false,
          value: openRegistration,
        });
        candidate.registrationCleanup = () => {
          if (parentGlobals[registrationProperty] === openRegistration) {
            delete parentGlobals[registrationProperty];
          }
        };
      }
      onEditRuntimeLoadStartRef.current?.(runtimeFrame.grant);
    }
    runtimeCandidateRef.current = candidate;
    setRuntimeCandidateRender(candidate.render);
    return true;
  }, [
    clearRuntimeRetiringFrame,
    documentBaseHref,
    editRuntimeGrant,
    frameRender,
    staticAssetBaseHref,
  ]);
  startRuntimeCandidateRef.current = startRuntimeCandidate;

  const finalizeRuntimeCandidatePromotion = useCallback((candidate: RuntimeCandidate) => {
    if (runtimePromotionRef.current !== candidate) return;
    // The old active browsing context remains authoritative until the new frame
    // has connected and restored the logical selection. Release its listeners
    // and runtime registration only after that handoff point.
    candidate.previousActive.runtimeSourceRegistrationCleanup();
    candidate.previousActive.cleanupFrame();
    candidate.handoffScrollCleanup();
    candidate.handoffScrollCleanup = () => undefined;
    runtimePromotionRef.current = null;
    containerRef.current?.setAttribute("data-runtime-handoff", "active");
    scheduleRuntimeRetiringFrameRemoval(candidate.previousActive.render.elementGeneration);
  }, [scheduleRuntimeRetiringFrameRemoval]);
  finalizeRuntimePromotionRef.current = finalizeRuntimeCandidatePromotion;

  const rollbackRuntimeCandidatePromotion = useCallback((
    candidate: RuntimeCandidate,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
  ): boolean => {
    if (runtimePromotionRef.current !== candidate) return false;
    const previous = candidate.previousActive;
    // During promotion the candidate browsing context occupies iframeRef;
    // runtimeCandidateIframeRef has already been cleared by promoteRuntimeCandidate.
    const candidateDocument = iframeRef.current?.contentDocument;
    const activeCandidateNativeEdit = activeNativeEditRef.current;
    if (
      activeCandidateNativeEdit
      && candidateDocument
      && activeCandidateNativeEdit.rootElement.ownerDocument === candidateDocument
    ) {
      const checkpointTimer = nativeEditCheckpointTimerRef.current;
      if (checkpointTimer !== null) window.clearTimeout(checkpointTimer);
      nativeEditCheckpointTimerRef.current = null;
      currentNativeEditLeaseRef.current = null;
      activeNativeEditRef.current = null;
      nativeCommandQueueRef.current.discardPendingNativeCommands("session-ended");
      retainNativeEditFocusRef.current = null;
      activeCandidateNativeEdit.rootElement.removeAttribute("data-html-canvas-editing");
      activeCandidateNativeEdit.session.dispose();
      activeCandidateNativeEdit.releaseHost?.();
      activeCandidateNativeEdit.rootElement.ownerDocument.getSelection()?.removeAllRanges();
      activeTextRangeRef.current = null;
      setIsEditing(false);
      setHasTextRange(false);
    }
    const currentCleanup = cleanupFrameRef.current;
    if (currentCleanup !== previous.cleanupFrame) currentCleanup();
    const cleanupFrame = runtimeRetiringCleanupFrameRef.current;
    if (cleanupFrame !== null) window.cancelAnimationFrame(cleanupFrame);
    runtimeRetiringCleanupFrameRef.current = null;
    runtimeRetiringGenerationRef.current = null;
    candidate.handoffScrollCleanup();
    candidate.handoffScrollCleanup = () => undefined;
    candidate.registrationCleanup();
    if (candidate.runtimeFrame && !candidate.outcomeReported) {
      candidate.runtimeFrame.settled = true;
      candidate.outcomeReported = true;
      onEditRuntimeLoadOutcomeRef.current?.(candidate.runtimeFrame.grant, outcome);
    }
    runtimeCandidateRef.current = null;
    runtimeCandidateIframeRef.current = null;
    runtimePromotionRef.current = null;
    runtimeFrameRef.current = previous.runtimeFrame;
    runtimeSourceElementsRef.current = previous.runtimeSourceElements;
    runtimeSourceRegistrationCleanupRef.current = previous.runtimeSourceRegistrationCleanup;
    frameLoadGenerationRef.current = previous.frameGeneration;
    frameGenerationSequenceRef.current = Math.max(
      frameGenerationSequenceRef.current,
      previous.frameGeneration,
    );
    nativeDomGenerationRef.current = previous.nativeDomGeneration;
    sourceIndexRef.current = previous.sourceIndex;
    frameSourceHtmlRef.current = previous.frameSourceHtml;
    frameWrittenHtmlRef.current = previous.frameWrittenHtml;
    expectedFrameHtmlRef.current = previous.expectedFrameHtml;
    expectedFrameTokenRef.current = previous.expectedFrameToken;
    renderedSourceHtmlRef.current = previous.renderedSourceHtml;
    appliedPageViewContextRef.current = previous.appliedPageViewContext;
    activeFrameConnectionPendingRef.current = previous.activeFrameConnectionPending;
    runtimeNeedsRerenderRef.current = previous.runtimeNeedsRerender;
    nativeSessionNeedsCanonicalFenceRef.current = previous.nativeSessionNeedsCanonicalFence;
    nativeEditNeedsReloadRef.current = previous.nativeEditNeedsReload;
    pendingFrameViewportRef.current = previous.pendingFrameViewport;
    pendingSharedViewportRef.current = previous.pendingSharedViewport;
    // Runtime activation failed after promotion. The old frame remains the
    // source-backed rollback target, but the failed checkpoint must not
    // restore native editing on that frame implicitly.
    pendingNativeEditResumeRef.current = null;
    // Invalidate every rAF scheduled by the failed candidate before restoring
    // the previous generation's pending viewport/selection state.
    pendingFrameRestoreEpochRef.current = previous.pendingFrameRestoreEpoch + 1;
    pendingSelectionRef.current = candidate.previousPendingSelection;
    pendingToolbarVisibleRef.current = candidate.previousPendingToolbarVisible;
    selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
    selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
    selectedElementRef.current = previous.selectedElement;
    if (previous.selectedElement?.isConnected && previous.selectedSourceSelection) {
      previous.selectedElement.setAttribute(
        "data-html-canvas-selected",
        previous.selectedSourceSelection.level,
      );
      previous.selectedElement.toggleAttribute(
        GLOBAL_SELECTION_ATTRIBUTE,
        isPageRootSelection(previous.selectedSourceSelection),
      );
    }
    selectedSourceSelectionRef.current = previous.selectedSourceSelection;
    activeTextRangeRef.current = previous.activeTextRange;
    runtimeGeneratedSelectionRef.current = previous.runtimeGeneratedSelection;
    cleanupFrameRef.current = previous.cleanupFrame;
    connectedFrameRef.current = previous.connectedFrame;
    containerRef.current?.setAttribute(
      "data-render-verified",
      previous.renderedSourceHtml ? "true" : "false",
    );
    containerRef.current?.removeAttribute("data-runtime-handoff");
    flushSync(() => {
      setFrameRender(previous.render);
      setRuntimeRetiringRender(null);
      setRuntimeCandidateRender(null);
      setSelection(previous.selectedSourceSelection);
      setRuntimeGeneratedSelection(previous.runtimeGeneratedSelection);
      setToolbarVisible(previous.toolbarVisible);
      setHasTextRange(Boolean(previous.activeTextRange));
    });
    return true;
  }, []);
  rollbackRuntimePromotionRef.current = rollbackRuntimeCandidatePromotion;

  const promoteRuntimeCandidate = useCallback((candidate: RuntimeCandidate): boolean => {
    if (runtimeCandidateRef.current !== candidate) return false;
    const iframe = runtimeCandidateIframeRef.current;
    const documentNode = iframe?.contentDocument;
    if (!iframe || !documentNode?.documentElement) return false;
    if (
      candidate.runtimeFrame
      && (
        candidate.runtimeFrame.activation !== "ready"
        || !candidate.sourceElements
      )
    ) return false;
    try {
      applyPageViewContextToDocument(
        documentNode,
        candidate.source,
        pageViewContextRef.current,
        null,
      );
      documentNode.documentElement.toggleAttribute("data-html-canvas-locked", lockedRef.current);
    } catch {
      return false;
    }

    const promotedGeneration = candidate.render.elementGeneration;
    const previous = candidate.previousActive;
    pendingFrameViewportRef.current = {
      left: candidate.viewportSnapshot.iframeScrollX,
      top: candidate.viewportSnapshot.iframeScrollY,
    };
    pendingSharedViewportRef.current = candidate.sharedViewportElement
      ? {
          element: candidate.sharedViewportElement,
          left: candidate.viewportSnapshot.sharedScrollLeft,
          top: candidate.viewportSnapshot.sharedScrollTop,
        }
      : null;
    pendingFrameRestoreEpochRef.current += 1;
    candidate.registrationCleanup();
    runtimeCandidateRef.current = null;
    runtimeCandidateIframeRef.current = null;
    runtimeSourceElementsRef.current = candidate.sourceElements;
    runtimeSourceRegistrationCleanupRef.current = () => undefined;
    runtimeFrameRef.current = candidate.runtimeFrame;
    activeFrameConnectionPendingRef.current = true;
    frameLoadGenerationRef.current = promotedGeneration;
    frameGenerationSequenceRef.current = Math.max(
      frameGenerationSequenceRef.current,
      promotedGeneration,
    );
    nativeDomGenerationRef.current += 1;
    sourceIndexRef.current = candidate.sourceIndex;
    frameSourceHtmlRef.current = candidate.source;
    frameWrittenHtmlRef.current = null;
    expectedFrameHtmlRef.current = candidate.prepared;
    expectedFrameTokenRef.current = candidate.verificationToken;
    renderedSourceHtmlRef.current = null;
    runtimeNeedsRerenderRef.current = false;
    containerRef.current?.setAttribute("data-runtime-handoff", "positioning");
    runtimePromotionRef.current = candidate;
    flushSync(() => {
      setRuntimeRetiringRender(previous.render);
      setFrameRender(candidate.render);
      setRuntimeCandidateRender(null);
    });
    const promotedIframe = iframeRef.current;
    if (!promotedIframe || promotedIframe !== iframe) {
      rollbackRuntimePromotionRef.current(candidate, "failed");
      return false;
    }
    if (!connectFrameRef.current(promotedIframe, promotedGeneration)) {
      rollbackRuntimePromotionRef.current(candidate, "failed");
      if (candidate.runtimeFrame) {
        startRuntimeCandidateRef.current(candidate.source, { runtimeFallback: true });
      }
      return false;
    }
    return true;
  }, []);

  const failRuntimeCandidate = useCallback((
    candidate: RuntimeCandidate,
    outcome: Exclude<HtmlCanvasEditRuntimeLoadOutcome, "ready">,
  ): boolean => {
    if (runtimeCandidateRef.current !== candidate) return false;
    const source = candidate.source;
    cancelRuntimeCandidateRef.current(outcome);
    if (candidate.runtimeFrame) {
      startRuntimeCandidateRef.current(source, { runtimeFallback: true });
      return true;
    }
    return false;
  }, []);
  failRuntimeCandidateActivationRef.current = failRuntimeCandidate;

  const connectRuntimeCandidate = useCallback((
    iframe: HTMLIFrameElement,
    candidateGeneration: number,
  ): boolean => {
    const candidate = runtimeCandidateRef.current;
    if (
      !candidate
      || candidate.render.elementGeneration !== candidateGeneration
      || iframe !== runtimeCandidateIframeRef.current
    ) return false;
    const documentNode = iframe.contentDocument;
    const marker = documentNode?.head?.querySelector<HTMLMetaElement>(
      `meta[${FRAME_VERIFICATION_ATTRIBUTE}]`,
    );
    if (
      !documentNode?.documentElement
      || !frameDocumentMatchesExpected(iframe, candidate.prepared, null)
      || marker?.getAttribute(FRAME_VERIFICATION_ATTRIBUTE) !== candidate.verificationToken
      || marker.getAttribute("content") !== candidate.verificationToken
      || (candidate.runtimeFrame && !candidate.loaded)
      || (candidate.runtimeFrame && candidate.runtimeFrame.activation !== "ready")
      || (candidate.runtimeFrame && !candidate.sourceElements)
    ) return false;
    return promoteRuntimeCandidate(candidate);
  }, [promoteRuntimeCandidate]);
  connectRuntimeCandidateRef.current = connectRuntimeCandidate;

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
  failActiveRuntimeFrameRef.current = fallBackToStaticRuntimeFrame;

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
    setSelectedStyle(readComputedEditableStyle(
      styleElement,
      activeStyleElements.length > 0 ? activeStyleElements : undefined,
    ));
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

  const updateOverlayPosition = useCallback((
    options: { allowRuntimeHandoff?: boolean } = {},
  ) => {
    const container = containerRef.current;
    const iframe = iframeRef.current;
    const documentNode = iframe?.contentDocument;
    const runtimeHandoff = container?.getAttribute("data-runtime-handoff");
    if (runtimeHandoff === "positioning" && !options.allowRuntimeHandoff) {
      const lastValidLayout = lastValidCommentLayoutRef.current;
      if (lastValidLayout) {
        container?.setAttribute("data-runtime-layout-ready", "true");
        // Keep the last complete layout authoritative while the candidate is
        // still being positioned. Publishing it again lets the surrounding
        // review surface retain its geometry without observing a transient
        // empty measurement from the new document.
        onCommentLayoutRef.current?.(lastValidLayout);
      }
      return;
    }
    const element = canvasVisualTargetElement(
      selectedElementRef.current,
      sourceIndexRef.current,
    );
    const sourceSha256 = sourceIndexRef.current?.sourceSha256 ?? "";
    const viewContextGeneration =
      appliedPageViewContextRef.current?.generation ?? 0;
    const layoutTargets = commentLayoutTargets(commentedTargetsRef.current);
    const targetIds = sortedCommentLayoutTargetIds(layoutTargets);
    const textEditing = Boolean(
      activeNativeEditRef.current
      || pendingNativeEditResumeRef.current,
    );
    const preservePreparedFrameOverlay = Boolean(
      container?.getAttribute("data-runtime-handoff") === "preparing"
      && selectedElementRef.current?.isConnected
      && renderedSourceHtmlRef.current === frameSourceHtmlRef.current,
    );
    if (!container || !iframe || !documentNode?.body) {
      container?.removeAttribute("data-runtime-layout-ready");
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
      if (!preservePreparedFrameOverlay) setOverlayPosition(null);
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
      container.removeAttribute("data-runtime-layout-ready");
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
      if (!preservePreparedFrameOverlay) setOverlayPosition(null);
      setInsertionPoints([]);
      setCommentMarkers([]);
      insertionPointsRef.current = [];
      return;
    }
    const commentTabAssociations = tabAssociations(documentNode);
    const commentLayouts = measureCommentTargetLayouts({
      documentNode,
      layoutTargets,
      sourceIndex: sourceIndexRef.current,
      scrollTop,
      commentTabAssociations,
    });
    const commentLayoutsByTargetId = new Map(
      commentLayouts.map((layout) => [layout.targetId, layout]),
    );
    const layoutState: HtmlCanvasCommentLayoutState = {
      sourceSha256,
      viewContextGeneration,
      ready: true,
      textEditing,
      targetIds,
      scrollTop,
      contentHeight: naturalDocumentContentHeight(documentNode, frameHeight),
      clientHeight: frameHeight,
      targets: commentLayouts,
    };
    lastValidCommentLayoutRef.current = layoutState;
    container.setAttribute("data-runtime-layout-ready", "true");
    onCommentLayoutRef.current?.(layoutState);

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
        if (!preservePreparedFrameOverlay) setOverlayPosition(null);
      }
    } else {
      if (!preservePreparedFrameOverlay) setOverlayPosition(null);
    }

    const insertionLayout = layoutInsertionPoints({
      documentNode,
      sourceIndex: sourceIndexRef.current,
      frameOffsetLeft,
      frameOffsetTop,
      frameWidth,
      frameHeight,
    });
    insertionPointsRef.current = insertionLayout.allInsertionPoints;
    setInsertionPoints(insertionLayout.visibleInsertionPoints);
    setCommentMarkers(layoutCommentMarkers({
      documentNode,
      commentedTargets: commentedTargetsRef.current,
      commentLayoutsByTargetId,
      commentTabAssociations,
      sourceIndex: sourceIndexRef.current,
      frameHeight,
      frameOffsetLeft,
      frameOffsetTop,
      containerWidth: containerRect.width,
      containerHeight: containerRect.height,
    }));
  }, []);

  const observeSelectedElement = useCallback(
    (element: HTMLElement, runtimeGenerated = false) => {
      resizeObserverRef.current?.disconnect();
      const visualElement = canvasVisualTargetElement(
        element,
        sourceIndexRef.current,
        { runtimeGenerated },
      ) ?? element;
      const ResizeObserverConstructor = visualElement.ownerDocument.defaultView?.ResizeObserver;
      if (!ResizeObserverConstructor) return;
      const observer = new ResizeObserverConstructor(() => updateOverlayPosition());
      observer.observe(visualElement);
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
    const currentRuntime = runtimeFrameRef.current;
    const runtimeIsCurrent = Boolean(
      currentRuntime?.settled
      && currentRuntime.elementGeneration === frameLoadGenerationRef.current,
    );
    if (runtimeIsCurrent && !activeNativeEditRef.current) return false;
    if (runtimeIsCurrent) runtimeNeedsRerenderRef.current = true;
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
      const previousSurface = alignPreviewSourceSurface(previousIndex, liveNodes);
      if (!previousSurface) return false;
      if (previousSurface.some((entry, index) => (
        liveNodes[index].getAttribute(SOURCE_NODE_ATTRIBUTE) !== entry.nodeId
      ))) return false;
      const detachedSurface = alignPreviewSourceSurface(result.sourceIndex, detachedNodes);
      if (
        !detachedSurface
        || detachedSurface.length !== nextElements.length
      ) return false;

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
      const liveTarget = liveNodes.find((node) => (
        node.getAttribute(SOURCE_NODE_ATTRIBUTE) === previousTarget.nodeId
      ));
      const detachedTarget = detachedNodes.find((node) => (
        node.getAttribute(SOURCE_NODE_ATTRIBUTE) === nextTarget.nodeId
      ));
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
      const stableSurface = alignPreviewSourceSurface(result.sourceIndex, stableNodes);
      if (!stableSurface) return false;

      // Direct patches refresh the mounted preview and every ephemeral source
      // identity in place. The DOM remains a preview only; it is never
      // serialized back into the user's source.
      stableSurface.forEach(({ node, nodeId }) => {
        node.setAttribute(SOURCE_NODE_ATTRIBUTE, nodeId);
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
      requestAnimationFrame(() => updateOverlayPosition());
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

  // Fail-closed edit refusals stay silent in the UI; the container attribute
  // below is the diagnostic trail relied on by tests and support tooling.
  const reportBlockedEdit = useCallback((cause: unknown) => {
    const rawDetail = cause instanceof Error
      ? cause.message
      : String(cause || "");
    containerRef.current?.setAttribute(
      "data-edit-block-detail",
      rawDetail.slice(0, 240),
    );
  }, []);

  const reportInlineStyleOverrideFailure = useCallback(() => {
    const message = "这个样式无法通过当前元素的局部修改可靠生效。可以把修改要求交给 Agent，由 Agent 调整页面样式结构。";
    setEditFeedback({
      code: "canvas_c02_style_override",
      title: "暂时不能直接修改这个样式",
      message,
      tone: "warning",
      sticky: false,
      recovery: "none",
    });
    onEditBlockedRef.current?.(message);
  }, []);

  const applySourceCommand = useCallback((
    command: CanvasSourceCommand,
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
    if (runtimeFrameRef.current) {
      const liveSourceElement = activeNativeEditRef.current?.selectionElement
        ?? selectedElementRef.current;
      const sourceProof = currentRuntimeSourceProof();
      if (
        !liveSourceElement?.isConnected
        || !sourceProof?.(liveSourceElement)
      ) {
        reportBlockedEdit(new Error(
          "运行页面中的源码目标身份已变化，本次修改已停止。",
        ));
        return null;
      }
    }
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
      const directSemanticOperation = command.type === "direct-semantic-operation"
        ? command.operation
        : null;
      let semanticResult = directSemanticOperation
        ? applySemanticOperation(
          createSemanticDocumentState(currentSource, {
            revision: semanticRevisionRef.current,
          }),
          directSemanticOperation,
        )
        : null;
      const directSemanticMaterialization = semanticResult?.materialization
        .sourcePatchResult as ReturnType<typeof applyPatchPlan> | undefined;
      const semanticCommand = directSemanticMaterialization?.inversePlan?.metadata
        ?.semanticCommand;
      const forwardPlan = directSemanticOperation
        ? planSemanticOperationPatch(sourceIndex, semanticCommand) as SourcePatchPlan
        : planSourcePatch(command, sourceIndex) as SourcePatchPlan;
      const ambientTargets = uniqueSelections([
        ...commentedTargetsRef.current.map((entry) => entry.target),
        ...trackedTargetsRef.current,
      ]);
      const originalTargets = uniqueSelections([
        mutation.target,
        ...ambientTargets,
      ]);
      const trackedTargetRefs = trackedSourceTargetRefs(
        originalTargets,
        forwardPlan.targetRefs,
      );
      const mappedResult = applyPatchPlan(
        forwardPlan,
        currentSource,
        { trackedTargetRefs },
      );
      if (mappedResult.html === currentSource) return null;
      const semanticOperation = directSemanticOperation
        || semanticOperationForSourceCommand(
          command as SourcePatchCommand,
          forwardPlan,
          sourceIndex,
          mutation,
          semanticRevisionRef.current,
        );
      semanticResult = semanticResult || (semanticOperation
        ? applySemanticOperation(
          createSemanticDocumentState(currentSource, {
            revision: semanticRevisionRef.current,
          }),
          semanticOperation,
        )
        : null);
      const semanticMaterialization = semanticResult?.materialization
        .sourcePatchResult as ReturnType<typeof applyPatchPlan> | undefined;
      const result = semanticMaterialization ?? mappedResult;
      if (semanticOperation && (
        !semanticMaterialization
        || mappedResult.html !== semanticMaterialization.html
        || mappedResult.sourceSha256 !== semanticMaterialization.sourceSha256
      )) {
        throw new Error("语义操作不能独立重放已接受的 SourcePatch 结果。");
      }
      options.validateResult?.(result);
      const targetUpdates = deterministicTargetUpdates(mappedResult, originalTargets);
      const targetUpdatesById = new Map(
        targetUpdates.map((target) => [target.id, target]),
      );
      const operationTargetUpdate = deterministicOperationTargetUpdate(
        mappedResult,
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
        ...(semanticOperation
          ? {
              semanticOperation,
              identityDelta: semanticResult?.identityDelta,
            }
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
      semanticRevisionRef.current = semanticResult?.nextRevision
        ?? semanticRevisionRef.current + 1;
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
        if (runtimeFrameRef.current) {
          runtimeNeedsRerenderRef.current = true;
        }
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
        activeNativeEdit.liveNodeId = refreshedIsland?.element.nodeId
          ?? refreshedFragmentNode?.parentId
          ?? activeNativeEdit.liveNodeId;
        activeNativeEdit.fragmentTextNodeId = refreshedFragmentNode?.nodeId
          ?? (nextFragmentHtml === "" ? null : activeNativeEdit.fragmentTextNodeId);
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
          ...(refreshedIsland
            ? {
                reconcileDomBeforeRebase: () => reconcileAllocatedLineBreakIds(
                  activeNativeEdit.session.hostElement,
                  activeNativeEdit.sourceInnerHtml,
                  nextSourceInnerHtml,
                ),
              }
            : {}),
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
        const selectionDeleted = mutation.property === "delete";
        pendingSelectionRef.current = selectionDeleted
          ? null
          : appliedMutation.target;
        pendingToolbarVisibleRef.current = selectionDeleted
          ? false
          : toolbarVisibleRef.current;
        selectedSourceSelectionRef.current = selectionDeleted
          ? null
          : appliedMutation.target;
        const currentRuntime = runtimeFrameRef.current;
        const preserveRuntimeActiveFrame = Boolean(
          currentRuntime?.settled
          && currentRuntime.elementGeneration === frameLoadGenerationRef.current,
        );
        if (selectionDeleted || !preserveRuntimeActiveFrame) {
          renderedSourceHtmlRef.current = null;
          selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
          selectedElementRef.current = null;
          resizeObserverRef.current?.disconnect();
        }
        if (mutation.kind !== "reorder" && !preserveRuntimeActiveFrame) {
          setOverlayPosition(null);
        }
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
    currentRuntimeSourceProof,
    loadFrameSource,
    reportBlockedEdit,
    synchronizeStablePreview,
  ]);

  const clearNativeEditCheckpointTimer = useCallback(() => {
    const timer = nativeEditCheckpointTimerRef.current;
    if (timer !== null) window.clearTimeout(timer);
    nativeEditCheckpointTimerRef.current = null;
  }, []);

  const discardPendingNativeCommands = useCallback((
    reason: NativeDeferredCommandDiscardReason,
  ) => {
    nativeCommandQueueRef.current.discardPendingNativeCommands(reason);
  }, []);

  const deferNativeCommand = useCallback((
    kind: string,
    run: () => void,
    payload?: unknown,
    options: NativeDeferredCommandOptions = {},
  ): boolean => {
    const active = activeNativeEditRef.current;
    return nativeCommandQueueRef.current.deferNativeCommand(
      kind,
      run,
      payload,
      options,
      active ? { session: active.session, lease: active.lease } : null,
    );
  }, []);
  deferNativeCommandRef.current = deferNativeCommand;

  drainPendingNativeCommandRef.current = (session) => {
    nativeCommandQueueRef.current.drainPendingNativeCommand(session, {
      getActive: () => {
        const active = activeNativeEditRef.current;
        return active ? { session: active.session, lease: active.lease } : null;
      },
      getCurrentLease: () => currentNativeEditLeaseRef.current,
      schedule: (run) => window.queueMicrotask(run),
    });
  };

  const refreshNativeEditRangeState = useCallback((
    active: ActiveNativeEdit,
    nextSelection: NativeEditSelection,
  ) => {
    const retained = retainNativeEditFocusRef.current;
    const retainedIsCurrent = Boolean(
      retained
      && retained.session === active.session
      && retained.targetId === active.target.id
      && nativeEditLeasesMatch(retained.lease, active.lease)
    );
    active.selection = nextSelection;
    const startOffset = Math.min(nextSelection.anchor, nextSelection.focus);
    const endOffset = Math.max(nextSelection.anchor, nextSelection.focus);
    if (startOffset === endOffset) {
      const retainedTextRange = retainedIsCurrent
        ? retained?.textRange ?? activeTextRangeRef.current
        : null;
      if (
        retained
        && retainedTextRange
        && retained.selection.anchor !== retained.selection.focus
      ) {
        activeTextRangeRef.current = cloneActiveTextRange(
          retainedTextRange,
          active.target,
        );
        setHasTextRange(true);
        updateSelectedStyle();
        return;
      }
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

  const nativeEditAuthorityIsCurrent = useCallback((active: ActiveNativeEdit) => {
    const currentDocument = iframeRef.current?.contentDocument;
    const selectedTarget = selectedSourceSelectionRef.current;
    return Boolean(
      activeNativeEditRef.current === active
      && active.rootElement.isConnected
      && active.selectionElement.isConnected
      && active.rootElement.ownerDocument === currentDocument
      && selectedElementRef.current === active.selectionElement
      && selectedTarget
      && selectedTarget.id === active.target.id
      && active.lease.domGeneration === nativeDomGenerationRef.current
      && nativeEditLeasesMatch(currentNativeEditLeaseRef.current, active.lease)
    );
  }, []);

  const restoreNativeEditSelectionForCommand = useCallback((
    active: ActiveNativeEdit,
  ): NativeEditSelection | null => {
    if (!nativeEditAuthorityIsCurrent(active)) {
      retainNativeEditFocusRef.current = null;
      return null;
    }
    const retained = retainNativeEditFocusRef.current;
    if (retained && (
      retained.session !== active.session
      || retained.targetId !== active.target.id
      || !nativeEditLeasesMatch(retained.lease, active.lease)
    )) {
      retainNativeEditFocusRef.current = null;
      return null;
    }
    const documentSelection = active.rootElement.ownerDocument.getSelection();
    const liveSelectionIsInside = Boolean(
      documentSelection?.anchorNode
      && documentSelection.focusNode
      && (
        documentSelection.anchorNode === active.rootElement
        || active.rootElement.contains(documentSelection.anchorNode)
      )
      && (
        documentSelection.focusNode === active.rootElement
        || active.rootElement.contains(documentSelection.focusNode)
      )
    );
    const selection = retained?.selection
      ?? (liveSelectionIsInside
        ? active.session.getSelection()
        : active.selection);
    active.session.restoreSelection(selection);
    refreshNativeEditRangeState(active, selection);
    return selection;
  }, [nativeEditAuthorityIsCurrent, refreshNativeEditRangeState]);

  const rememberNativeEditSelection = useCallback((active: ActiveNativeEdit) => {
    if (!nativeEditAuthorityIsCurrent(active)) {
      retainNativeEditFocusRef.current = null;
      return;
    }
    retainNativeEditFocusRef.current = {
      session: active.session,
      lease: { ...active.lease },
      targetId: active.target.id,
      selection: { ...active.selection },
      textRange: cloneActiveTextRange(activeTextRangeRef.current, active.target),
    };
  }, [nativeEditAuthorityIsCurrent]);

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
        caretOffsetY: runtimeCaretOffsetY(documentNode, rootElement),
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
            nodeId: active.liveNodeId ?? undefined,
            textNodeId: active.fragmentTextNodeId ?? undefined,
            beforeFragmentHtml: previousInnerHtml,
            nextFragmentHtml: nextInnerHtml,
            expectedSourceSha256: active.projection.sourceSha256,
          }
        : {
            type: "replace-editable-island" as const,
            targetRef: active.rootTargetRef,
            nodeId: active.liveNodeId ?? undefined,
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
              editableIslandDraftHtml(island.innerHtml, {
                baselineInnerHtml: previousInnerHtml,
              }) !== nextInnerHtml
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
    {
      replayQueuedUserCommand = false,
      resumeAfterRuntimeHandoff = false,
    }: FinishNativeEditingOptions = {},
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
        ? nativeCommandQueueRef.current.takeReplayableNativeCommandForCompletedSession(
          { session: active.session, lease: active.lease },
          currentNativeEditLeaseRef.current,
        )
        : null;
      const replayCompletedUserCommand = () => {
        if (!completedUserCommand) return;
        nativeCommandQueueRef.current.scheduleReplay(
          completedUserCommand,
          (run) => window.queueMicrotask(run),
        );
      };
      const source = frameSourceHtmlRef.current;
      const target = active.target;
      const rootElement = active.rootElement;
      const selectionElement = active.selectionElement;
      const settledRuntimeFrame = (
        runtimeFrameRef.current?.settled
        && runtimeFrameRef.current.elementGeneration === frameLoadGenerationRef.current
      ) ? runtimeFrameRef.current : null;
      const runtimeNativeResume = resumeAfterRuntimeHandoff
        && settledRuntimeFrame
        && runtimeNeedsRerenderRef.current
        ? {
            fenceId: ++nativeEditFenceSequenceRef.current,
            target,
            selection: { ...active.selection },
            focus: Boolean(
              rootElement.ownerDocument.activeElement === rootElement
              || (
                rootElement.ownerDocument.activeElement
                && rootElement.contains(rootElement.ownerDocument.activeElement)
              ),
            ),
            toolbarVisible: toolbarVisibleRef.current,
            caretOffsetY: runtimeCaretOffsetY(
              rootElement.ownerDocument,
              rootElement,
            ),
            ...(active.fragmentTargetRef
              ? { fragmentTargetRef: active.fragmentTargetRef }
              : {}),
          }
        : null;
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
      if (settledRuntimeFrame && runtimeNeedsRerenderRef.current) {
        runtimeNeedsRerenderRef.current = false;
        pendingNativeEditResumeRef.current = runtimeNativeResume
          ? {
              ...runtimeNativeResume,
              expectedFrameGeneration: frameLoadGenerationRef.current + 1,
              sourceRevision: sourceIndexRef.current?.sourceSha256 ?? "",
            }
          : null;
        // Keep the current runtime document authoritative while the replacement
        // candidate is prepared. The native session has already ended, but its
        // selection host is still the managed visual target in the old frame.
        if (
          !selectedElementRef.current?.isConnected
          && selectionElement.isConnected
        ) selectedElementRef.current = selectionElement;
        selectedSourceSelectionRef.current = target;
        pendingSelectionRef.current = target;
        pendingToolbarVisibleRef.current = true;
        loadFrameSource(source, {
          preserveViewport: true,
          forceRuntimeHandoff: true,
        });
        replayCompletedUserCommand();
        return { ...committed, frameReloading: true };
      }
      if (frameReloadRequired && !settledRuntimeFrame) {
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
      if (settledRuntimeFrame) {
        // No source change remains: keep the current disposable frame and drop
        // only the transient native-input guard.
        nativeSessionNeedsCanonicalFenceRef.current = false;
        fencedDocumentCleanupRef.current();
        renderedSourceHtmlRef.current = source;
      }
      // releaseHost() removes the transient pageroot-text-fragment wrapper.
      // The source parent remains the rebind target for the following style
      // patch; treating that wrapper as a lost host blocks toolbar formatting.
      const previewHostStillMounted = active.mode === "text-fragment"
        ? selectionElement.isConnected
        : rootElement.isConnected && selectionElement.isConnected;
      if (!previewHostStillMounted) {
        pendingNativeEditResumeRef.current = null;
        selectedElementRef.current = null;
        pendingSelectionRef.current = target;
        pendingToolbarVisibleRef.current = true;
        replayCompletedUserCommand();
        return { ...committed, frameReloading: false };
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
      requestAnimationFrame(() => updateOverlayPosition());
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
    const committed = finishNativeEditing(commitPendingEdit, "manual", {
      resumeAfterRuntimeHandoff: false,
    });
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
    runtimeGeneratedSelectionRef.current = false;
    setRuntimeGeneratedSelection(false);
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
      const sharedScrollElement = container.closest<HTMLElement>(
        ".review-scroll-stage",
      );
      // Scrolling the shared stage is not an outside selection gesture. In
      // particular, a native scrollbar pointerdown must leave the selected
      // target and its handoff anchor available while the drag is in flight.
      if (
        sharedScrollElement
        && sharedScrollbarPointerDown(sharedScrollElement, event)
      ) return;
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
        runtimeGenerated?: boolean;
        selectionOverride?: HtmlCanvasSelection;
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
        const requestedTarget = options.selectionOverride
          ?? (options.runtimeGenerated
            ? selectionForElement(
              element,
              null,
              undefined,
              "ambiguous",
              levelOverride,
            )
            : selectionForElement(
              element,
              sourceIndexRef.current,
              undefined,
              undefined,
              levelOverride,
            ));
        const committed = finishNativeEditing(true, "manual", {
          resumeAfterRuntimeHandoff: false,
        });
        if (!committed.ok) return activeNativeEdit.target;
        if (committed.frameReloading) {
          pendingSelectionRef.current = requestedTarget;
          pendingToolbarVisibleRef.current = options.showToolbar ?? true;
          return requestedTarget;
        }
      }
      selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
      selectedElementRef.current?.removeAttribute(GLOBAL_SELECTION_ATTRIBUTE);
      const nextSelection = options.selectionOverride
        ?? (options.runtimeGenerated
          ? selectionForElement(
            element,
            null,
            undefined,
            "ambiguous",
            levelOverride,
          )
          : selectionForElement(
            element,
            sourceIndexRef.current,
            undefined,
            undefined,
            levelOverride,
          ));
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
      runtimeGeneratedSelectionRef.current = options.runtimeGenerated === true;
      setRuntimeGeneratedSelection(options.runtimeGenerated === true);
      setToolbarVisible(options.showToolbar ?? true);
      onSelectRef.current?.(nextSelection);
      updateSelectedStyle();
      updateMoveAvailability();
      observeSelectedElement(element, options.runtimeGenerated === true);
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
      requestAnimationFrame(() => updateOverlayPosition());
      return nextSelection;
    },
    [finishNativeEditing, observeSelectedElement, updateMoveAvailability, updateOverlayPosition, updateSelectedStyle],
  );

  const selectResolvedTarget = useCallback((
    resolvedTarget: ResolvedCanvasTarget,
    options: {
      preserveTextSelection?: boolean;
      showToolbar?: boolean;
      fromQueuedCommand?: boolean;
    } = {},
  ): HtmlCanvasSelection => (
    selectElement(resolvedTarget.targetElement, undefined, {
      ...options,
      selectionOverride: resolvedTarget.selection,
      runtimeGenerated: resolvedTarget.runtimeGenerated,
    })
  ), [selectElement]);

  const requestCommentForTarget = useCallback((target: HtmlCanvasSelection): boolean => {
    if (target.resolution !== "exact" || !isValidPagerootElementId(target.elementId)) {
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
    const activeRange = activeTextRangeRef.current;
    const sameElement = Boolean(
      activeRange
      && (
        (
          activeRange.target.elementId
          && activeRange.target.elementId === target.elementId
        )
        || (
          activeRange.target.nodeId
          && activeRange.target.nodeId === target.nodeId
        )
      )
    );
    const textLocator = sameElement
      ? textLocatorForActiveRange(activeRange, sourceIndexRef.current)
      : null;
    onRequestCommentRef.current?.({
      ...target,
      ...(textLocator ? { textLocator } : {}),
    });
    return true;
  }, []);

  const startEditing = useCallback((
    caretPoint?: TextCaretPoint,
    restoredSelection?: NativeEditSelection,
  ): boolean => {
    hoverControllerRef.current?.hide();
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
    if (!selectedElementHasSourceMutationAuthority()) {
      containerRef.current?.setAttribute("data-native-start-status", "runtime-display-only");
      return false;
    }
    const priorRange = activeTextRangeRef.current;
    const islandHostElement = nativeEditHostForElement(selectedElement, sourceIndex);
    const hintedTextNode = !islandHostElement && caretPoint
      ? directTextNodeAtPoint(
          selectedElement.ownerDocument,
          selectedElement,
          caretPoint,
        )
      : null;
    const fragmentCandidate = islandHostElement
      ? null
      : nativeTextFragmentForRange(priorRange, sourceIndex)
        ?? nativeTextFragmentForElement(
          selectedElement,
          sourceIndex,
          hintedTextNode,
        );
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
      let liveText = fragmentCandidate
        ? fragmentCandidate.textNode.data
        : nativeLogicalText(islandHostElement!);
      if (liveText !== projection.text) {
        containerRef.current?.setAttribute(
          "data-native-start-status",
          "text-mismatch-remount",
        );
        if (fragmentCandidate) {
          fragmentCandidate.textNode.data = projection.text;
        } else {
          const hostNodeId = islandHostElement!.getAttribute(SOURCE_NODE_ATTRIBUTE);
          if (
            !hostNodeId
            || !remountNativeHostFromSource(
              islandHostElement!,
              hostNodeId,
              sourceIndex,
            )
          ) {
            containerRef.current?.setAttribute("data-native-start-status", "text-mismatch");
            reportBlockedEdit(new Error(
              "画布文字与源码节点已经漂移，已阻止直接编辑。",
            ));
            return false;
          }
        }
        liveText = fragmentCandidate
          ? fragmentCandidate.textNode.data
          : nativeLogicalText(islandHostElement!);
        if (liveText !== projection.text) {
          containerRef.current?.setAttribute("data-native-start-status", "text-mismatch");
          reportBlockedEdit(new Error(
            "画布文字与源码节点已经漂移，已阻止直接编辑。",
          ));
          return false;
        }
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
      if (!initialSelection && priorRange && activationLogicalRange && !caretPoint) {
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
          const lineBreakCheckpoint = state.inputType === "insertParagraph"
            || state.inputType === "insertLineBreak";
          nativeEditCheckpointTimerRef.current = window.setTimeout(() => {
            nativeEditCheckpointTimerRef.current = null;
            if (!nativeEditLeasesMatch(currentNativeEditLeaseRef.current, scheduledLease)) return;
            if (lineBreakCheckpoint) {
              finishNativeEditingRef.current(true, "automatic", {
                resumeAfterRuntimeHandoff: true,
              });
            } else {
              nativeEditCheckpointRef.current();
            }
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
      const layoutDrifted = !sameNativeLayout(layoutBeforeEditing, layoutAfterEditing)
        || !sameNativeTextStyle(layoutBeforeEditing, layoutAfterEditing)
        || !fragmentStyleStable;
      // Layout/style fingerprints observe post-entry drift only. They must
      // not refuse to enter; MutationObserver rollback and checkpoint scope
      // remain the fail-closed safety net.
      if (layoutDrifted) {
        containerRef.current?.setAttribute("data-native-layout-drift", "true");
        hostElement.setAttribute("data-native-layout-drift", "true");
      } else {
        containerRef.current?.removeAttribute("data-native-layout-drift");
        hostElement.removeAttribute("data-native-layout-drift");
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
        fragmentTextNodeId: fragmentCandidate?.textNodeId ?? null,
        liveNodeId: (
          fragmentCandidate?.parentElement ?? islandHostElement
        )?.getAttribute(SOURCE_NODE_ATTRIBUTE) ?? target.nodeId ?? null,
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
      // A caretPoint from the entering double-click wins over any identifying
      // 1-character range used only to mount a text fragment.
      if (caretPoint && !restoredSelection) session.focusAtPoint(caretPoint);
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
    selectedElementHasSourceMutationAuthority,
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
            const committed = finishNativeEditing(true, "manual", {
              resumeAfterRuntimeHandoff: false,
            });
            if (committed.ok) window.queueMicrotask(() => moveSelected(direction));
          },
          { direction },
        )) return true;
        const committed = finishNativeEditing(true, "manual", {
          resumeAfterRuntimeHandoff: false,
        });
        if (!committed.ok || committed.frameReloading) return false;
      }
      const element = selectedElementRef.current;
      if (
        readOnlyRef.current
        || !selectedElementHasSourceMutationAuthority()
        || !enableReorderRef.current
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
    [
      applySourceCommand,
      finishNativeEditing,
      reportBlockedEdit,
      selectedElementHasSourceMutationAuthority,
    ],
  );

  const applySelectedStructureOperation = useCallback((
    action: SelectedStructureAction,
    destination?: StructureDestination,
  ): boolean => {
    if (activeNativeEditRef.current) {
      if (deferNativeCommandRef.current(
        "target-switch",
        () => {
          const committed = finishNativeEditing(true, "manual", {
            resumeAfterRuntimeHandoff: false,
          });
          if (committed.ok) {
            window.queueMicrotask(() => applySelectedStructureOperation(action, destination));
          }
        },
        { action, destination },
      )) return true;
      const committed = finishNativeEditing(true, "manual", {
        resumeAfterRuntimeHandoff: false,
      });
      if (!committed.ok || committed.frameReloading) return false;
    }
    if (
      readOnlyRef.current
      || !selectedElementHasSourceMutationAuthority()
      || !enableReorderRef.current
    ) return false;
    const sourceIndex = sourceIndexRef.current;
    if (!sourceIndex) return false;
    const liveElement = selectedElementRef.current;
    const logicalSelection = liveElement?.isConnected
      ? selectionForElement(
        liveElement,
        sourceIndex,
        selectedSourceSelectionRef.current ?? undefined,
      )
      : selectedSourceSelectionRef.current;
    if (!logicalSelection) return false;
    try {
      const { operation, mutation } = selectedStructureCommand({
        sourceIndex,
        selection: logicalSelection,
        action,
        destination,
        baseRevision: semanticRevisionRef.current,
      });
      const result = applySourceCommand({
        type: "direct-semantic-operation",
        operation,
      }, mutation);
      if (!result) return false;
      if (action === "delete") clearSelection();
      return true;
    } catch (cause) {
      reportBlockedEdit(cause);
      return false;
    }
  }, [
    applySourceCommand,
    clearSelection,
    finishNativeEditing,
    reportBlockedEdit,
    selectedElementHasSourceMutationAuthority,
  ]);

  const duplicateSelected = useCallback(
    () => applySelectedStructureOperation("duplicate"),
    [applySelectedStructureOperation],
  );

  const deleteSelected = useCallback(
    () => applySelectedStructureOperation("delete"),
    [applySelectedStructureOperation],
  );

  const moveSelectedTo = useCallback((options: {
    parentElementId: string;
    beforeElementId?: string | null;
  }): boolean => applySelectedStructureOperation("move", options), [
    applySelectedStructureOperation,
  ]);

  const insertElement = useCallback((options: {
    parentElementId: string;
    beforeElementId?: string | null;
    html: string;
  }): boolean => {
    if (activeNativeEditRef.current) {
      if (deferNativeCommandRef.current(
        "target-switch",
        () => {
          const committed = finishNativeEditing(true, "manual", {
            resumeAfterRuntimeHandoff: false,
          });
          if (committed.ok) window.queueMicrotask(() => insertElement(options));
        },
        options,
      )) return true;
      const committed = finishNativeEditing(true, "manual", {
        resumeAfterRuntimeHandoff: false,
      });
      if (!committed.ok || committed.frameReloading) return false;
    }
    if (readOnlyRef.current || !enableReorderRef.current) return false;
    const sourceIndex = sourceIndexRef.current;
    if (!sourceIndex) return false;
    try {
      const { operation, mutation } = insertStructureCommand({
        sourceIndex,
        baseRevision: semanticRevisionRef.current,
        parentElementId: options.parentElementId,
        beforeElementId: options.beforeElementId ?? null,
        html: options.html,
        originalSelection: selectedSourceSelectionRef.current,
      });
      return Boolean(applySourceCommand({
        type: "direct-semantic-operation",
        operation,
      }, mutation));
    } catch (cause) {
      reportBlockedEdit(cause);
      return false;
    }
  }, [applySourceCommand, finishNativeEditing, reportBlockedEdit]);

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
      const committed = finishNativeEditing(true, "manual", {
        resumeAfterRuntimeHandoff: false,
      });
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
      requestAnimationFrame(() => updateOverlayPosition());
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
        observeSelectedElement(element, false);
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
        requestAnimationFrame(() => updateOverlayPosition());
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
      selectionOverride: activeRange.target,
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
      caretOffsetY: runtimeCaretOffsetY(documentNode, active.rootElement),
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
    options: { reuseDocument?: boolean } = {},
  ) => {
    nativeEditFenceSequenceRef.current += 1;
    const fenceId = nativeEditFenceSequenceRef.current;
    const reuseDocument = options.reuseDocument === true;
    const expectedFrameGeneration = reuseDocument
      ? frameLoadGenerationRef.current
      : frameLoadGenerationRef.current + 1;
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
    const currentRuntime = runtimeFrameRef.current;
    const preserveRuntimeActiveFrame = Boolean(
      currentRuntime?.settled
      && currentRuntime.elementGeneration === frameLoadGenerationRef.current,
    );
    if (!preserveRuntimeActiveFrame) {
      selectedElementRef.current?.removeAttribute("data-html-canvas-selected");
      selectedElementRef.current = null;
      resizeObserverRef.current?.disconnect();
      renderedSourceHtmlRef.current = null;
    }
    loadFrameSource(source, {
      preserveViewport: true,
      immediate: !reuseDocument,
      reuseDocument,
    });
    containerRef.current?.setAttribute(
      "data-native-fence-resume",
      `loaded:${frameLoadGenerationRef.current}:${expectedFrameTokenRef.current
        && (
          iframeRef.current?.srcdoc.includes(expectedFrameTokenRef.current)
          || frameWrittenHtmlRef.current?.includes(expectedFrameTokenRef.current)
        )
        ? "current"
        : "stale"}`,
    );
  }, [loadFrameSource]);
  queueNativeFenceReloadRef.current = queueNativeFenceReload;

  const checkpointPendingEdit = useCallback((): HtmlCanvasCommitResult => {
    const committed = checkpointNativeEdit("manual");
    const sourceIndex = sourceIndexRef.current;
    const canvasRenderedSha256 = sourceIndex?.sourceSha256 || "";
    return {
      ok: committed.ok,
      html: frameSourceHtmlRef.current,
      canvasRenderedSha256,
      sourceSha256: canvasRenderedSha256,
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
    const resumeEditing = options.resumeEditing ?? false;
    const preserveForHistory = options.preserveForHistory ?? false;
    const committed = checkpointNativeEdit(options.trigger ?? "fence", {
      deferPreviewReconcile: true,
    });
    const sourceIndex = sourceIndexRef.current;
    if (!committed.ok) {
      const canvasRenderedSha256 = sourceIndex?.sourceSha256 || "";
      return {
        ok: false,
        html: frameSourceHtmlRef.current,
        canvasRenderedSha256,
        sourceSha256: canvasRenderedSha256,
        pendingMutation: null,
        ...(committed.reason ? { reason: committed.reason } : {}),
      };
    }

    const settledRuntimeFrameIsCurrent = (): RuntimeFrameContext | null => {
      const current = runtimeFrameRef.current;
      if (
        !current?.settled
        || current.elementGeneration !== frameLoadGenerationRef.current
        || runtimeNeedsRerenderRef.current
        || nativeEditNeedsReloadRef.current
        || renderedSourceHtmlRef.current !== frameSourceHtmlRef.current
      ) return null;
      return current;
    };

    const activeRuntimeFrame = settledRuntimeFrameIsCurrent();
    if (
      resumeEditing
      && !preserveForHistory
      && activeNativeEditRef.current
      && activeRuntimeFrame
    ) {
      pendingHistoryBookmarkRef.current = null;
      pendingHistoryCanonicalFenceRef.current = false;
      containerRef.current?.setAttribute(
        "data-native-fence-resume",
        `retained-runtime:${activeRuntimeFrame.elementGeneration}`,
      );
      return {
        ok: true,
        html: frameSourceHtmlRef.current,
        canvasRenderedSha256: sourceIndexRef.current?.sourceSha256 || "",
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
    const detachedRuntimeFrame = settledRuntimeFrameIsCurrent();
    if (detachedRuntimeFrame && !preserveForHistory) {
      // After the session ends, a canonical fence would rebuild before the
      // caller has decided whether source changed. Dispose the mutation-owner
      // guard in place when the current disposable document is still exact.
      pendingHistoryBookmarkRef.current = null;
      pendingHistoryCanonicalFenceRef.current = false;
      nativeSessionNeedsCanonicalFenceRef.current = false;
      fencedDocumentCleanupRef.current();
      if (!resumeEditing) {
        pendingFrameRestoreEpochRef.current += 1;
        pendingNativeEditResumeRef.current = null;
        pendingSelectionRef.current = null;
        pendingToolbarVisibleRef.current = false;
      }
      containerRef.current?.setAttribute(
        "data-native-fence-resume",
        `retained-runtime:${detachedRuntimeFrame.elementGeneration}`,
      );
    } else if (needsCanonicalFence && !preserveForHistory) {
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
      canvasRenderedSha256: sourceIndexRef.current?.sourceSha256 || "",
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
      requestAnimationFrame(() => updateOverlayPosition());
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
      { reuseDocument: true },
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
      canvasRenderedSha256: committed.canvasRenderedSha256,
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
    requestAnimationFrame(() => updateOverlayPosition());
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
    requestAnimationFrame(() => updateOverlayPosition());
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
    const sourceHtml = frameSourceHtmlRef.current;
    const generation = frameLoadGenerationRef.current;
    const currentContext = pageViewContextRef.current;
    const cached = pagePresentationActionCacheRef.current;
    if (
      cached?.target === target
      && cached.sourceIndex === sourceIndex
      && cached.sourceHtml === sourceHtml
      && cached.documentKey === documentKey
      && cached.generation === generation
      && cached.currentContext === currentContext
    ) return cached.action;
    const action = createPagePresentationAction({
      html: sourceHtml,
      sourceIndex,
      documentKey,
      generation,
      currentContext,
      targetRef: sourceTargetRefForSelection(target),
    });
    pagePresentationActionCacheRef.current = {
      target,
      sourceIndex,
      sourceHtml,
      documentKey,
      generation,
      currentContext,
      action,
    };
    return action;
  }, []);

  const executePagePresentationAction = useCallback((
    target: HtmlCanvasSelection,
    options: { selectTargetAfter?: boolean } = {},
  ): boolean => {
    const perform = (): boolean => {
      if (lockedRef.current || readOnlyRef.current) return false;
      let frameReloading = false;
      if (activeNativeEditRef.current) {
        const committed = finishNativeEditing(true, "manual", {
          resumeAfterRuntimeHandoff: false,
        });
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
        requestAnimationFrame(() => updateOverlayPosition());
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
      getScrollTop,
      scrollToTop,
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
      duplicateSelected,
      deleteSelected,
      insertElement,
      moveSelectedTo,
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
      getScrollTop,
      deleteSelected,
      duplicateSelected,
      insertElement,
      moveSelected,
      moveSelectedTo,
      adoptHistorySource,
      cancelHistoryAction,
      selectTarget,
      showCommitBlocked,
      scrollToTop,
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
    if (!previewAssetsReady) return;
    if (!frameInitializedRef.current) {
      frameInitializedRef.current = true;
      loadFrameSource(html);
      lastPropRef.current = { html, baseHref: documentBaseHref };
      return;
    }

    const previous = lastPropRef.current;
    if (previous.html === html && previous.baseHref === documentBaseHref) return;
    lastPropRef.current = { html, baseHref: documentBaseHref };

    const echoIndex = pendingHtmlEchoesRef.current.indexOf(html);
    if (echoIndex >= 0 && previous.baseHref === documentBaseHref) {
      pendingHtmlEchoesRef.current.splice(0, echoIndex + 1);
      lastEmittedHtmlRef.current = html;
      return;
    }
    if (html === lastEmittedHtmlRef.current && previous.baseHref === documentBaseHref) return;
    if (activeNativeEditRef.current) detachNativeEditForFence();
    pendingNativeEditResumeRef.current = null;
    pendingHistoryBookmarkRef.current = null;
    pendingHistoryCanonicalFenceRef.current = false;
    const preserveRuntimeActiveFrame = Boolean(
      html !== frameSourceHtmlRef.current
      && runtimeFrameRef.current?.settled
      && runtimeFrameRef.current.elementGeneration === frameLoadGenerationRef.current,
    );
    if (!preserveRuntimeActiveFrame) resetSelection(false);
    lastEmittedHtmlRef.current = null;
    pendingHtmlEchoesRef.current = [];
    loadFrameSource(html);
  }, [
    detachNativeEditForFence,
    documentBaseHref,
    html,
    loadFrameSource,
    previewAssetsReady,
    resetSelection,
  ]);

  useEffect(() => {
    const handleWindowResize = () => updateOverlayPosition();
    window.addEventListener("resize", handleWindowResize);
    return () => window.removeEventListener("resize", handleWindowResize);
  }, [updateOverlayPosition]);

  useEffect(() => {
    requestAnimationFrame(() => updateOverlayPosition());
  }, [commentedTargets, updateOverlayPosition]);

  const selectedTargetId = selection?.id ?? null;
  const hasOverlayPosition = overlayPosition !== null;
  useEffect(() => {
    if (!selectedTargetId || !hasOverlayPosition) return;
    requestAnimationFrame(() => updateOverlayPosition());
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
    requestAnimationFrame(() => updateOverlayPosition());
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
      const runtimePromotion = runtimePromotionRef.current;
      runtimePromotionRef.current = null;
      const runtimeCandidate = runtimeCandidateRef.current;
      runtimeCandidateRef.current = null;
      runtimeCandidate?.handoffScrollCleanup();
      runtimeCandidate?.registrationCleanup();
      if (runtimePromotion && runtimePromotion !== runtimeCandidate) {
        runtimePromotion.handoffScrollCleanup();
      }
      runtimeCandidateIframeRef.current = null;
      const retiringCleanupFrame = runtimeRetiringCleanupFrameRef.current;
      if (retiringCleanupFrame !== null) window.cancelAnimationFrame(retiringCleanupFrame);
      runtimeRetiringCleanupFrameRef.current = null;
      runtimeRetiringGenerationRef.current = null;
      const runtimeFrame = runtimeFrameRef.current;
      runtimeFrameRef.current = null;
      runtimeSourceRegistrationCleanupRef.current();
      runtimeSourceElementsRef.current = null;
      if (runtimeFrame && !runtimeFrame.settled) {
        onEditRuntimeLoadOutcomeRef.current?.(runtimeFrame.grant, "failed");
      }
      fencedDocumentCleanupRef.current();
      const activeCleanup = cleanupFrameRef.current;
      activeCleanup();
      if (
        runtimePromotion
        && runtimePromotion.previousActive.cleanupFrame !== activeCleanup
      ) runtimePromotion.previousActive.cleanupFrame();
      runtimePromotion?.previousActive.runtimeSourceRegistrationCleanup();
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
    if (
      connectedFrameRef.current?.iframe === iframe
      && connectedFrameRef.current.generation === connectedFrameGeneration
    ) return true;
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
      !frameDocumentMatchesExpected(
        iframe,
        expectedFrameHtml,
        frameWrittenHtmlRef.current,
      )
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
      const runtimeSourceElements = runtimeSourceElementsRef.current;
      if (
        runtimeFrame.activation !== "ready"
        || !runtimeSourceElements
        || runtimeSourceElements.elementGeneration !== runtimeFrame.elementGeneration
        || runtimeSourceElements.executionId !== runtimeFrame.grant.executionId
      ) return false;
    }
    const promotedCandidate = runtimePromotionRef.current;
    const isRuntimePromotion = Boolean(
      promotedCandidate
      && promotedCandidate.render.elementGeneration === connectedFrameGeneration
      && (
        !promotedCandidate.runtimeFrame
        || promotedCandidate.runtimeFrame === runtimeFrame
      ),
    );
    hoverControllerRef.current?.hide();
    if (!isRuntimePromotion) {
      renderedSourceHtmlRef.current = frameSourceHtmlRef.current;
      containerRef.current?.setAttribute("data-render-verified", "true");
      performance.mark("pageroot:canvas:render-verified", { detail: Object.freeze({ content: runtimeFrame ? "runtime-loaded" : "static-complete" }) });
      fencedDocumentCleanupRef.current();
    }

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
    const resolveTargetAtEvent = (event: MouseEvent) => resolveCanvasTarget({
      documentNode,
      eventTarget: event.target,
      point: caretPointFromMouseEvent(event),
      sourceIndex: sourceIndexRef.current,
      enabled: true,
      isProvenRuntimeSourceElement: currentRuntimeSourceProof(),
      generation: nativeDomGenerationRef.current,
      identityScope: canvasTargetIdentityScopeForGeneration(
        nativeDomGenerationRef.current,
      ),
    });
    const handleClick = (event: MouseEvent) => {
      hoverControllerRef.current?.hide();
      // Authored controls remain selectable/editable content in the Canvas,
      // never live navigation or form controls. Suppress their browser action
      // before the active-edit fast path so a second click cannot navigate the
      // iframe away from the verified source document.
      const nativeActionTarget = findNativeActionTarget(event.target);
      if (nativeActionTarget) event.preventDefault();
      // Clicks always resolve the current DOM and permission proof. Hover is a
      // visual preview only and is never a selection or Option-click authority.
      const resolvedTarget = resolveTargetAtEvent(event);
      if (!resolvedTarget) {
        if (!lockedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          clearSelection();
        }
        return;
      }
      const target = resolvedTarget.targetElement;
      if (lockedRef.current) {
        if (target.closest(
          "a, button, form, input, select, summary, textarea, [contenteditable], [role=\"tab\"], [aria-expanded][aria-controls]",
        )) {
          event.preventDefault();
        }
        return;
      }
      const actionSelection = resolvedTarget.runtimeGenerated
        || !sourceIndexRef.current
        ? null
        : selectionForElement(resolvedTarget.hitElement, sourceIndexRef.current);
      if (
        event.altKey
        && actionSelection
        && resolvePagePresentationAction(actionSelection)
      ) {
        event.preventDefault();
        event.stopPropagation();
        if (event.detail === 1) {
          executePagePresentationAction(actionSelection, {
            selectTargetAfter: true,
          });
        }
        return;
      }
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) return;
      const activeEdit = activeNativeEditRef.current;
      if (activeEdit?.mode === "text-fragment") {
        const committed = finishNativeEditing(true, "manual", {
          resumeAfterRuntimeHandoff: false,
        });
        if (!committed.ok || committed.frameReloading) return;
      }
      if (captureTextRange()) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      selectResolvedTarget(resolvedTarget);
    };

    const handleDoubleClick = (event: MouseEvent) => {
      hoverControllerRef.current?.hide();
      if (findNativeActionTarget(event.target)) event.preventDefault();
      const caretPoint = caretPointFromMouseEvent(event);
      const resolvedTarget = resolveTargetAtEvent(event);
      if (!resolvedTarget) return;
      const target = resolvedTarget.targetElement;
      const dedicatedSurface = findDedicatedSourceSurfaceAtPoint(
        documentNode,
        caretPoint,
      );
      if (resolvedTarget.runtimeGenerated) {
        event.preventDefault();
        event.stopPropagation();
        if (!lockedRef.current) {
          selectResolvedTarget(resolvedTarget);
        }
        return;
      }
      if (
        event.altKey
        && !resolvedTarget.runtimeGenerated
        && sourceIndexRef.current
        && resolvePagePresentationAction(selectionForElement(
          resolvedTarget.hitElement,
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
        const committed = finishNativeEditing(true, "manual", {
          resumeAfterRuntimeHandoff: false,
        });
        if (!committed.ok || committed.frameReloading) return;
      }
      if (lockedRef.current) return;
      setSpacingMenuOpen(false);
      event.preventDefault();
      event.stopPropagation();
      const editTarget = dedicatedSurface ?? target;
      const sourceIndex = sourceIndexRef.current;
      const islandHostElement = sourceIndex
        ? nativeEditHostForElement(editTarget, sourceIndex)
        : null;
      if (!islandHostElement && !dedicatedSurface) {
        const identifyingRange = identifyingTextRangeAtPoint(
          documentNode,
          editTarget,
          caretPoint,
        );
        if (
          identifyingRange
          && identifyingRange.startContainer.isConnected
          && identifyingRange.endContainer.isConnected
        ) {
          const selection = documentNode.getSelection();
          selection?.removeAllRanges();
          selection?.addRange(identifyingRange);
          captureTextRange();
        } else {
          containerRef.current?.setAttribute(
            "data-native-start-status",
            "direct-text-hit-required",
          );
        }
      }
      selectResolvedTarget(resolvedTarget, {
        preserveTextSelection: Boolean(activeTextRangeRef.current),
      });
      if (dedicatedSurface) return;
      const editingStarted = startEditing(caretPoint);
      if (!editingStarted) selectResolvedTarget(resolvedTarget);
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
              resumeEditing: false,
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
        retainNativeEditFocusRef.current = null;
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
        && selectedElementHasSourceMutationAuthority()
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
      hoverControllerRef.current?.hide();
      onInteractionRef.current?.();
      setSpacingMenuOpen(false);
      const toolbarTarget = event.target instanceof Node
        && toolbarRef.current?.contains(event.target);
      if (toolbarTarget) {
        const activeNativeEdit = activeNativeEditRef.current;
        if (activeNativeEdit) {
          const documentSelection = activeNativeEdit.rootElement.ownerDocument.getSelection();
          const liveSelectionIsInside = Boolean(
            documentSelection?.anchorNode
            && documentSelection.focusNode
            && (
              documentSelection.anchorNode === activeNativeEdit.rootElement
              || activeNativeEdit.rootElement.contains(documentSelection.anchorNode)
            )
            && (
              documentSelection.focusNode === activeNativeEdit.rootElement
              || activeNativeEdit.rootElement.contains(documentSelection.focusNode)
            )
          );
          const retained = retainNativeEditFocusRef.current;
          const retainedIsCurrent = Boolean(
            retained
            && retained.session === activeNativeEdit.session
            && retained.targetId === activeNativeEdit.target.id
            && nativeEditLeasesMatch(retained.lease, activeNativeEdit.lease),
          );
          if (retained && !retainedIsCurrent) return;
          const selection = retained && retainedIsCurrent
            ? retained.selection
            : liveSelectionIsInside
              ? activeNativeEdit.session.getSelection()
              : activeNativeEdit.selection;
          retainNativeEditFocusRef.current = {
            session: activeNativeEdit.session,
            lease: { ...activeNativeEdit.lease },
            targetId: activeNativeEdit.target.id,
            selection: { ...selection },
            textRange: cloneActiveTextRange(
              activeTextRangeRef.current,
              activeNativeEdit.target,
            ),
          };
          const targetElement = event.target instanceof Element
            ? event.target
            : event.target instanceof Node
              ? event.target.parentElement
              : null;
          if (
            targetElement?.closest(
              "button[data-native-format-focus='preserve']",
            )
          ) event.preventDefault();
          const nativeActionTarget = findNativeActionTarget(event.target);
          if (
            nativeActionTarget
            && ["INPUT", "SELECT", "TEXTAREA"].includes(nativeActionTarget.tagName)
          ) event.preventDefault();
        }
        return;
      }
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) {
        retainNativeEditFocusRef.current = null;
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

    const handleScroll = () => {
      hoverControllerRef.current?.hide();
      updateOverlayPosition();
    };
    const handlePointerMove = (event: PointerEvent) => {
      hoverHintPointerInsideRef.current = false;
      if (
        event.buttons !== 0
        || lockedRef.current
        || readOnlyRef.current
        || !pointerCapabilityHoverEnabledRef.current
        || activeNativeEditRef.current
      ) {
        hoverControllerRef.current?.hide();
        return;
      }
      hoverControllerRef.current?.update(resolveCanvasTarget({
        documentNode,
        eventTarget: event.target,
        point: caretPointFromMouseEvent(event),
        sourceIndex: sourceIndexRef.current,
        enabled: true,
        isProvenRuntimeSourceElement: currentRuntimeSourceProof(),
        generation: nativeDomGenerationRef.current,
        identityScope: canvasTargetIdentityScopeForGeneration(
          nativeDomGenerationRef.current,
        ),
      }));
    };
    const handlePointerLeave = () => {
      // The caption is rendered outside the iframe. Let its pointer-enter
      // event win the transition from the iframe before hiding the hover
      // chrome, otherwise an outside caption cannot be clicked.
      globalThis.setTimeout(() => {
        if (!hoverHintPointerInsideRef.current) hoverControllerRef.current?.hide();
      }, 0);
    };
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
    documentNode.addEventListener("pointermove", handlePointerMove, true);
    documentNode.addEventListener("pointerleave", handlePointerLeave, true);
    documentNode.addEventListener("dblclick", handleDoubleClick, true);
    documentNode.addEventListener("beforeinput", handleBeforeInput, true);
    documentNode.addEventListener("paste", handleLockedTransfer, true);
    documentNode.addEventListener("drop", handleLockedTransfer, true);
    documentNode.addEventListener("submit", handleSubmit, true);
    documentNode.addEventListener("keydown", handleKeyDown, true);
    documentNode.addEventListener("scroll", handleScroll, true);
    iframe.addEventListener("pointerleave", handlePointerLeave);

    const pendingSelection = pendingSelectionRef.current;
    const pendingToolbarVisible = pendingToolbarVisibleRef.current;
    const pendingViewport = pendingFrameViewportRef.current;
    const pendingSharedViewport = pendingSharedViewportRef.current;
    const pendingNativeResume = pendingNativeEditResumeRef.current;
    const pendingRestoreEpoch = pendingFrameRestoreEpochRef.current;
    const sharedScrollElementForHandoff = isRuntimePromotion
      ? pendingSharedViewport?.element ?? null
      : null;
    const handleSharedScroll = () => {
      updateOverlayPosition();
    };
    sharedScrollElementForHandoff?.addEventListener("scroll", handleSharedScroll);
    if (isRuntimePromotion && promotedCandidate) {
      const previousScrollCleanup = promotedCandidate.handoffScrollCleanup;
      const candidateScrollCleanup = attachRuntimeHandoffScrollListeners({
        candidate: promotedCandidate,
        iframe,
        sharedScrollElement: null,
        includeShared: false,
      });
      promotedCandidate.handoffScrollCleanup = () => {
        candidateScrollCleanup();
        previousScrollCleanup();
      };
    }

    cleanupFrameRef.current = () => {
      documentNode.removeEventListener("click", handleClick, true);
      documentNode.removeEventListener("mousedown", handleMouseDown, true);
      documentNode.removeEventListener("mouseup", handleMouseUp, true);
      documentNode.removeEventListener(
        "pointerdown",
        handleDisabledButtonPointerDown,
        true,
      );
      documentNode.removeEventListener("pointermove", handlePointerMove, true);
      documentNode.removeEventListener("pointerleave", handlePointerLeave, true);
      iframe.removeEventListener("pointerleave", handlePointerLeave);
      documentNode.removeEventListener("dblclick", handleDoubleClick, true);
      documentNode.removeEventListener("beforeinput", handleBeforeInput, true);
      documentNode.removeEventListener("paste", handleLockedTransfer, true);
      documentNode.removeEventListener("drop", handleLockedTransfer, true);
      documentNode.removeEventListener("submit", handleSubmit, true);
      documentNode.removeEventListener("keydown", handleKeyDown, true);
      documentNode.removeEventListener("scroll", handleScroll, true);
      layoutObserver?.disconnect();
      sharedScrollElementForHandoff?.removeEventListener("scroll", handleSharedScroll);
      if (
        connectedFrameRef.current?.iframe === iframe
        && connectedFrameRef.current.generation === connectedFrameGeneration
      ) connectedFrameRef.current = null;
    };
    connectedFrameRef.current = {
      iframe,
      generation: connectedFrameGeneration,
    };
    containerRef.current?.setAttribute(
      "data-native-fence-resume",
      `connected:${connectedFrameGeneration}:${pendingSelection?.id ?? "none"}:${pendingNativeResume?.fenceId ?? "none"}`,
    );
    pendingSelectionRef.current = null;
    pendingToolbarVisibleRef.current = false;
    pendingFrameViewportRef.current = null;
    pendingSharedViewportRef.current = null;
    const positionRuntimeHandoff = (candidate: RuntimeCandidate) => {
      let attempts = 0;
      let stableCount = 0;
      let previousFingerprint: RuntimeHandoffLayoutFingerprint | null = null;
      let selectionRestored = !pendingSelection && !pendingNativeResume;
      let nativeResumeAttempted = !pendingNativeResume;
      let nativeResumeFailed = false;
      const startedAt = performance.now();
      const snapshot = candidate.viewportSnapshot;
      const frameView = documentNode.defaultView;
      if (candidate.runtimeFrame?.activation === "ready") {
        candidate.runtimeFrame.settled = true;
        containerRef.current?.setAttribute(
          "data-runtime-bootstrap-count",
          String(documentNode.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length),
        );
      }

      const isCurrent = () => {
        return runtimePromotionRef.current === candidate
          && iframe === iframeRef.current
          && iframe.contentDocument === documentNode
          && frameLoadGenerationRef.current === connectedFrameGeneration
          && expectedFrameTokenRef.current === expectedToken
          && containerRef.current?.getAttribute("data-runtime-handoff") === "positioning";
      };
      const userScrollIntentPending = (
        channel: RuntimeHandoffScrollChannel,
      ) => candidate.handoffScrollState[channel].userIntentPending;
      const markProgrammaticScroll = (
        channel: RuntimeHandoffScrollChannel,
        left: number,
        top: number,
      ) => {
        candidate.markProgrammaticScroll(channel, left, top);
      };
      const failHandoff = () => {
        if (!isCurrent()) return;
        const rolledBack = rollbackRuntimePromotionRef.current(candidate, "failed");
        if (rolledBack && candidate.runtimeFrame) {
          startRuntimeCandidateRef.current(candidate.source, { runtimeFallback: true });
        }
      };
      const scheduleNextAttempt = () => {
        if (!isCurrent()) return;
        attempts += 1;
        if (
          attempts >= Math.ceil(EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs / 16) + 30
          || performance.now() - startedAt >= EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs
        ) {
          failHandoff();
          return;
        }
        requestAnimationFrame(attemptPositioning);
      };
      const maximumFrameScrollTop = () => Math.max(
        0,
        (documentNode.scrollingElement || documentNode.documentElement).scrollHeight
          - iframe.clientHeight,
      );
      const maximumFrameScrollLeft = () => Math.max(
        0,
        (documentNode.scrollingElement || documentNode.documentElement).scrollWidth
          - iframe.clientWidth,
      );
      const frameScrollTarget = () => {
        const maximum = maximumFrameScrollTop();
        let targetTop = clampRuntimeScroll(snapshot.iframeScrollY, maximum);
        if (
          snapshot.viewportAnchorStableId
          && snapshot.viewportAnchorOffsetY !== null
        ) {
          const anchor = runtimeSourceElementForStableId(
            documentNode,
            sourceIndexRef.current,
            snapshot.viewportAnchorStableId,
          );
          const anchorTop = anchor?.getBoundingClientRect().top;
          const desiredAnchorOffsetY = snapshot.viewportAnchorOffsetY;
          if (
            anchor
            && desiredAnchorOffsetY !== null
            && anchorTop !== undefined
            && Number.isFinite(anchorTop)
          ) {
            targetTop = runtimeAnchorScrollTop({
              currentScrollTop: frameView?.scrollY || 0,
              currentAnchorOffsetY: anchorTop,
              desiredAnchorOffsetY: desiredAnchorOffsetY,
              maximumScrollTop: maximum,
            });
          }
        }
        return targetTop;
      };
      const restoreFrameViewport = () => {
        if (!frameView || userScrollIntentPending("frame")) {
          return frameView?.scrollY || 0;
        }
        const targetTop = frameScrollTarget();
        const targetLeft = clampRuntimeScroll(
          snapshot.iframeScrollX,
          maximumFrameScrollLeft(),
        );
        if (
          !runtimePositionWithinTolerance(frameView.scrollY, targetTop)
          || !runtimePositionWithinTolerance(frameView.scrollX, targetLeft)
        ) {
          markProgrammaticScroll("frame", targetLeft, targetTop);
          frameView.scrollTo({ left: targetLeft, top: targetTop, behavior: "auto" });
        }
        return targetTop;
      };
      const sharedAnchorViewportOffset = () => {
        if (
          !pendingSharedViewport
          || snapshot.viewportAnchorStableId === null
          || snapshot.viewportAnchorSharedOffsetY === null
        ) return null;
        const anchor = runtimeSourceElementForStableId(
          documentNode,
          sourceIndexRef.current,
          snapshot.viewportAnchorStableId,
        );
        const anchorRect = anchor?.getBoundingClientRect();
        const iframeRect = iframe.getBoundingClientRect();
        const sharedRect = pendingSharedViewport.element.getBoundingClientRect();
        if (!anchor || !anchorRect || !iframeRect || !sharedRect) return null;
        return iframeRect.top - sharedRect.top + anchorRect.top;
      };
      const sharedScrollTarget = () => {
        if (!pendingSharedViewport) return null;
        const element = pendingSharedViewport.element;
        const maximum = Math.max(0, element.scrollHeight - element.clientHeight);
        let targetTop = clampRuntimeScroll(snapshot.sharedScrollTop, maximum);
        const currentAnchorOffsetY = sharedAnchorViewportOffset();
        if (
          currentAnchorOffsetY !== null
          && snapshot.viewportAnchorSharedOffsetY !== null
        ) {
          targetTop = runtimeAnchorScrollTop({
            currentScrollTop: element.scrollTop,
            currentAnchorOffsetY,
            desiredAnchorOffsetY: snapshot.viewportAnchorSharedOffsetY,
            maximumScrollTop: maximum,
          });
        }
        return targetTop;
      };
      const restoreSharedViewportForHandoff = () => {
        if (!pendingSharedViewport || userScrollIntentPending("shared")) {
          return pendingSharedViewport?.element.scrollTop || 0;
        }
        const element = pendingSharedViewport.element;
        if (!element.isConnected) return element.scrollTop;
        const targetTop = sharedScrollTarget() ?? element.scrollTop;
        const targetLeft = clampRuntimeScroll(
          snapshot.sharedScrollLeft,
          Math.max(0, element.scrollWidth - element.clientWidth),
        );
        if (
          !runtimePositionWithinTolerance(element.scrollTop, targetTop)
          || !runtimePositionWithinTolerance(element.scrollLeft, targetLeft)
        ) {
          markProgrammaticScroll("shared", targetLeft, targetTop);
          element.scrollTo({ left: targetLeft, top: targetTop, behavior: "auto" });
        }
        return targetTop;
      };
      const restoreSelectionAndNativeEdit = () => {
        if (!selectionRestored) {
          const target = pendingSelection ?? pendingNativeResume?.target ?? null;
          if (!target || lockedRef.current) {
            selectionRestored = true;
          } else {
            const restoredTarget = selectTarget(target, {
              reveal: false,
              showToolbar: pendingNativeResume?.toolbarVisible
                ?? pendingToolbarVisible,
            });
            selectionRestored = Boolean(restoredTarget);
            containerRef.current?.setAttribute(
              "data-native-fence-resume",
              `positioning-selected:${restoredTarget?.id ?? "none"}`,
            );
            if (
              !pendingNativeResume
              && restoredTarget
              && candidate.previousActive.activeTextRange
              && sourceIndexRef.current
            ) {
              const restoredTextRange = restoreRuntimeTextSelection(
                documentNode,
                sourceIndexRef.current,
                candidate.previousActive.activeTextRange,
                restoredTarget,
              );
              activeTextRangeRef.current = restoredTextRange;
              setHasTextRange(Boolean(restoredTextRange));
              if (restoredTextRange) updateSelectedStyle();
            }
          }
        }
        if (nativeResumeAttempted || !pendingNativeResume || !selectionRestored) return;
        const resumeIsCurrent = (
          pendingNativeEditResumeRef.current?.fenceId === pendingNativeResume.fenceId
          && pendingNativeResume.expectedFrameGeneration === connectedFrameGeneration
          && pendingNativeResume.sourceRevision === sourceIndexRef.current?.sourceSha256
        );
        if (!resumeIsCurrent) {
          pendingNativeEditResumeRef.current = null;
          nativeResumeAttempted = true;
          return;
        }
        if (!pendingNativeResume.focus) {
          pendingNativeEditResumeRef.current = null;
          nativeResumeAttempted = true;
          return;
        }
        if (
          pendingNativeResume.fragmentTargetRef
          && selectedElementRef.current
          && sourceIndexRef.current
        ) {
          const restoredFragmentRange = activeRangeForTextFragmentTarget(
            selectedElementRef.current,
            sourceIndexRef.current,
            pendingNativeResume.target,
            pendingNativeResume.fragmentTargetRef,
          );
          activeTextRangeRef.current = restoredFragmentRange;
          setHasTextRange(Boolean(restoredFragmentRange));
        }
        const resumed = startEditing(undefined, pendingNativeResume.selection);
        const active = activeNativeEditRef.current;
        if (resumed && active) {
          active.rootElement.focus({ preventScroll: true });
          active.session.restoreSelection(pendingNativeResume.selection);
          pendingNativeEditResumeRef.current = null;
          nativeResumeAttempted = true;
          containerRef.current?.setAttribute("data-native-fence-resume", "positioning-resumed");
        } else {
          nativeResumeFailed = true;
          nativeResumeAttempted = true;
          containerRef.current?.setAttribute("data-native-fence-resume", "positioning-resume-failed");
        }
      };
      const correctCaretViewport = () => {
        const desiredCaretOffsetY = snapshot.caretOffsetY;
        if (
          !frameView
          || userScrollIntentPending("frame")
          || desiredCaretOffsetY === null
        ) return;
        const active = activeNativeEditRef.current;
        if (!active || active.rootElement.ownerDocument !== documentNode) return;
        const caretTop = runtimeCaretOffsetY(documentNode, active.rootElement);
        if (caretTop === null || !Number.isFinite(caretTop)) return;
        const targetTop = runtimeAnchorScrollTop({
          currentScrollTop: frameView.scrollY,
          currentAnchorOffsetY: caretTop,
          desiredAnchorOffsetY: desiredCaretOffsetY,
          maximumScrollTop: maximumFrameScrollTop(),
        });
        if (!runtimePositionWithinTolerance(frameView.scrollY, targetTop)) {
          markProgrammaticScroll("frame", frameView.scrollX, targetTop);
          frameView.scrollTo({
            left: frameView.scrollX,
            top: targetTop,
            behavior: "auto",
          });
        }
      };
      const captureLayoutFingerprint = (): RuntimeHandoffLayoutFingerprint => {
        const scrollingElement = documentNode.scrollingElement
          || documentNode.documentElement;
        const sharedElement = pendingSharedViewport?.element
          ?? candidate.sharedViewportElement;
        const active = activeNativeEditRef.current;
        let nativeSelection: RuntimeViewportSnapshot["nativeSelection"] = null;
        if (active?.rootElement.ownerDocument === documentNode) {
          try {
            nativeSelection = { ...active.session.getSelection() };
          } catch {
            nativeSelection = null;
          }
        }
        const viewport = captureRuntimeViewportSnapshot({
          iframe,
          sharedScrollElement: sharedElement,
          sourceIndex: sourceIndexRef.current,
          selectedElement: selectedElementRef.current,
          selectedSourceSelection: selectedSourceSelectionRef.current
            ?? pendingSelection
            ?? pendingNativeResume?.target
            ?? null,
          nativeSelection,
        });
        return {
          iframeWidth: iframe.clientWidth,
          iframeHeight: iframe.clientHeight,
          documentClientWidth: scrollingElement?.clientWidth || 0,
          documentClientHeight: scrollingElement?.clientHeight || 0,
          documentScrollWidth: scrollingElement?.scrollWidth || 0,
          documentScrollHeight: scrollingElement?.scrollHeight || 0,
          sharedClientWidth: sharedElement?.clientWidth ?? null,
          sharedClientHeight: sharedElement?.clientHeight ?? null,
          sharedScrollWidth: sharedElement?.scrollWidth ?? null,
          sharedScrollHeight: sharedElement?.scrollHeight ?? null,
          iframeScrollX: viewport.iframeScrollX,
          iframeScrollY: viewport.iframeScrollY,
          sharedScrollLeft: sharedElement?.scrollLeft ?? null,
          sharedScrollTop: sharedElement?.scrollTop ?? null,
          viewportAnchorStableId: viewport.viewportAnchorStableId,
          viewportAnchorOffsetY: viewport.viewportAnchorOffsetY,
          viewportAnchorSharedOffsetY: viewport.viewportAnchorSharedOffsetY,
          selectedStableId: viewport.selectedStableId,
          nativeSelection: viewport.nativeSelection,
          caretOffsetY: viewport.caretOffsetY,
        };
      };
      const updateStableFingerprint = () => {
        const currentFingerprint = captureLayoutFingerprint();
        stableCount = previousFingerprint
          && runtimeHandoffLayoutFingerprintWithinTolerance(
            currentFingerprint,
            previousFingerprint,
          )
          ? stableCount + 1
          : 1;
        previousFingerprint = currentFingerprint;
        return stableCount;
      };
      const validateHandoff = () => {
        if (!frameView || !documentNode.body || iframe.clientHeight <= 0 || iframe.clientWidth <= 0) {
          return false;
        }
        if (
          userScrollIntentPending("frame")
          || userScrollIntentPending("shared")
        ) return false;
        const expectedSelectedId = snapshot.selectedStableId
          ?? pendingSelection?.elementId
          ?? pendingNativeResume?.target.elementId
          ?? null;
        const actualSelectedId = runtimeStableIdForElement(
          selectedElementRef.current,
          sourceIndexRef.current,
        );
        if (expectedSelectedId && actualSelectedId !== expectedSelectedId) {
          return false;
        }
        if (nativeResumeFailed) return false;
        if (pendingNativeResume && pendingNativeResume.focus) {
          const active = activeNativeEditRef.current;
          const activeElement = documentNode.activeElement;
          if (
            !active
            || active.rootElement.ownerDocument !== documentNode
            || !activeElement
            || (activeElement !== active.rootElement && !active.rootElement.contains(activeElement))
          ) return false;
          const actualSelection = active.session.getSelection();
          if (
            actualSelection.anchor !== pendingNativeResume.selection.anchor
            || actualSelection.focus !== pendingNativeResume.selection.focus
          ) return false;
          if (snapshot.caretOffsetY !== null) {
            const caretTop = runtimeCaretOffsetY(documentNode, active.rootElement);
            if (
              caretTop === null
              || !runtimePositionWithinTolerance(caretTop, snapshot.caretOffsetY)
            ) return false;
          }
        }
        const expectedTop = frameScrollTarget();
        if (!runtimePositionWithinTolerance(frameView.scrollY, expectedTop)) {
          return false;
        }
        if (!runtimePositionWithinTolerance(
          frameView.scrollX,
          clampRuntimeScroll(snapshot.iframeScrollX, maximumFrameScrollLeft()),
        )) return false;
        if (snapshot.viewportAnchorStableId && snapshot.viewportAnchorOffsetY !== null) {
          const anchor = runtimeSourceElementForStableId(
            documentNode,
            sourceIndexRef.current,
            snapshot.viewportAnchorStableId,
          );
          if (anchor) {
            const anchorTop = anchor.getBoundingClientRect().top;
            const anchorActual = pendingSharedViewport
              && snapshot.viewportAnchorSharedOffsetY !== null
              ? sharedAnchorViewportOffset()
              : anchorTop;
            const anchorExpected = pendingSharedViewport
              && snapshot.viewportAnchorSharedOffsetY !== null
              ? snapshot.viewportAnchorSharedOffsetY
              : snapshot.viewportAnchorOffsetY;
            if (
              anchorActual === null
              || (
                !runtimePositionWithinTolerance(anchorActual, anchorExpected)
                && !runtimeAnchorOffsetIsClamped({
                  currentScrollTop: pendingSharedViewport
                    ? pendingSharedViewport.element.scrollTop
                    : frameView.scrollY,
                  currentAnchorOffsetY: anchorActual,
                  desiredAnchorOffsetY: anchorExpected,
                  maximumScrollTop: pendingSharedViewport
                    ? Math.max(
                      0,
                      pendingSharedViewport.element.scrollHeight
                        - pendingSharedViewport.element.clientHeight,
                    )
                    : maximumFrameScrollTop(),
                })
              )
            ) {
              return false;
            }
          }
        }
        if (
          pendingSharedViewport
          && !runtimePositionWithinTolerance(
            pendingSharedViewport.element.scrollTop,
            sharedScrollTarget() ?? pendingSharedViewport.element.scrollTop,
          )
        ) return false;
        if (
          pendingSharedViewport
          && !runtimePositionWithinTolerance(
            pendingSharedViewport.element.scrollLeft,
            clampRuntimeScroll(
              snapshot.sharedScrollLeft,
              Math.max(
                0,
                pendingSharedViewport.element.scrollWidth
                  - pendingSharedViewport.element.clientWidth,
              ),
            ),
          )
        ) return false;
        return true;
      };
      const activateHandoff = () => {
        if (!isCurrent()) return false;
        if (!validateHandoff()) return false;
        flushSync(() => {
          renderedSourceHtmlRef.current = frameSourceHtmlRef.current;
          containerRef.current?.setAttribute("data-render-verified", "true");
          performance.mark("pageroot:canvas:render-verified", { detail: Object.freeze({ content: "runtime-loaded" }) });
          updateOverlayPosition({ allowRuntimeHandoff: true });
          containerRef.current?.setAttribute("data-runtime-handoff", "active");
        });
        fencedDocumentCleanupRef.current();
        activeFrameConnectionPendingRef.current = false;
        const connectedRuntimeFrame = runtimeFrameRef.current;
        if (
          connectedRuntimeFrame?.elementGeneration === connectedFrameGeneration
          && connectedRuntimeFrame.activation === "ready"
        ) {
          if (!runtimeReadyReportedRef.current.has(connectedRuntimeFrame)) {
            runtimeReadyReportedRef.current.add(connectedRuntimeFrame);
            candidate.outcomeReported = true;
            onEditRuntimeLoadOutcomeRef.current?.(connectedRuntimeFrame.grant, "ready");
          }
        }
        finalizeRuntimePromotionRef.current(candidate);
        return true;
      };
      const attemptPositioning = () => {
        if (!isCurrent()) return;
        const bodyRect = documentNode.body?.getBoundingClientRect();
        if (
          !bodyRect
          || !Number.isFinite(bodyRect.width)
          || !Number.isFinite(bodyRect.height)
          || iframe.clientHeight <= 0
          || iframe.clientWidth <= 0
        ) {
          scheduleNextAttempt();
          return;
        }
        restoreFrameViewport();
        restoreSharedViewportForHandoff();
        restoreSelectionAndNativeEdit();
        requestAnimationFrame(() => {
          if (!isCurrent()) return;
          restoreFrameViewport();
          restoreSharedViewportForHandoff();
          correctCaretViewport();
          if (
            userScrollIntentPending("frame")
            || userScrollIntentPending("shared")
          ) {
            stableCount = 0;
            previousFingerprint = null;
            scheduleNextAttempt();
            return;
          }
          if (updateStableFingerprint() >= 2 && activateHandoff()) return;
          scheduleNextAttempt();
        });
      };
      requestAnimationFrame(attemptPositioning);
    };
    const restoreConnectedFrame = () => {
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
      const connectedRuntimeFrame = runtimeFrameRef.current;
      const connectedRuntimeFrameIsCurrent = Boolean(
        connectedRuntimeFrame?.elementGeneration === connectedFrameGeneration
        && connectedRuntimeFrame.verificationToken === expectedToken,
      );
      if (connectedRuntimeFrameIsCurrent && connectedRuntimeFrame) {
        // Proof and active handlers were already validated by connectFrame. Mark
        // this frame internally settled before rebinding a pending native edit;
        // the external ready outcome is still emitted only after that rebind.
        if (connectedRuntimeFrame.activation !== "ready") return;
        connectedRuntimeFrame.settled = true;
        containerRef.current?.setAttribute(
          "data-runtime-bootstrap-count",
          String(documentNode.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length),
        );
      }
      const sharedViewportStillCurrent = () => (
        iframe.contentDocument === documentNode
        && frameLoadGenerationRef.current === connectedFrameGeneration
        && expectedFrameTokenRef.current === expectedToken
        && pendingFrameRestoreEpochRef.current === pendingRestoreEpoch
      );
      const restoreSharedViewport = (remainingFrames = 30) => {
        const sharedViewport = pendingSharedViewport;
        if (
          !sharedViewport
          || !sharedViewport.element.isConnected
          || !sharedViewportStillCurrent()
        ) return;
        const maxTop = Math.max(
          0,
          sharedViewport.element.scrollHeight - sharedViewport.element.clientHeight,
        );
        const targetTop = Math.min(sharedViewport.top, maxTop);
        const currentTop = sharedViewport.element.scrollTop;
        // A zero position during the bounded rebuild window can be a transient
        // React/layout clamp. A different non-zero position is treated as a
        // fresh user scroll and ends restoration instead of fighting input.
        if (Math.abs(currentTop - targetTop) > 1) {
          if (currentTop > 1) return;
          sharedViewport.element.scrollTo({
            left: sharedViewport.left,
            top: targetTop,
            behavior: "auto",
          });
        }
        if (remainingFrames > 0) {
          requestAnimationFrame(() => restoreSharedViewport(remainingFrames - 1));
        }
      };
      restoreSharedViewport();
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
      if (
        connectedRuntimeFrameIsCurrent
        && connectedRuntimeFrame?.activation === "ready"
      ) {
        if (!runtimeReadyReportedRef.current.has(connectedRuntimeFrame)) {
          runtimeReadyReportedRef.current.add(connectedRuntimeFrame);
          const promotedCandidate = runtimePromotionRef.current;
          if (promotedCandidate?.runtimeFrame === connectedRuntimeFrame) {
            promotedCandidate.outcomeReported = true;
          }
          onEditRuntimeLoadOutcomeRef.current?.(connectedRuntimeFrame.grant, "ready");
        }
        activeFrameConnectionPendingRef.current = false;
      } else if (
        runtimeFrameRef.current?.elementGeneration !== connectedFrameGeneration
      ) {
        activeFrameConnectionPendingRef.current = false;
      }
      const activePromotedCandidate = runtimePromotionRef.current;
      if (
        activePromotedCandidate
        && activePromotedCandidate.render.elementGeneration === connectedFrameGeneration
        && (
          !activePromotedCandidate.runtimeFrame
          || activePromotedCandidate.runtimeFrame === connectedRuntimeFrame
        )
        && (!connectedRuntimeFrame || connectedRuntimeFrame.settled)
      ) finalizeRuntimePromotionRef.current(activePromotedCandidate);
    };
    if (isRuntimePromotion && promotedCandidate) {
      positionRuntimeHandoff(promotedCandidate);
    } else {
      requestAnimationFrame(restoreConnectedFrame);
    }
    return true;
  }, [
    canvasTargetIdentityScopeForGeneration,
    captureTextRange,
    clearSelection,
    currentRuntimeSourceProof,
    executePagePresentationAction,
    fencePendingEdit,
    finishNativeEditing,
    moveSelected,
    resolvePagePresentationAction,
    selectResolvedTarget,
    selectTarget,
    selectedElementHasSourceMutationAuthority,
    startEditing,
    updateOverlayPosition,
    updateSelectedStyle,
    fallBackToStaticRuntimeFrame,
  ]);
  connectFrameRef.current = connectFrame;

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
      const runtimeFrame = runtimeFrameRef.current;
      if (
        (
          runtimeFrame?.elementGeneration !== connectedFrameGeneration
          || activeFrameConnectionPendingRef.current
        )
        &&
        documentNode?.documentElement
        && expectedFrameHtml
        && expectedToken
        && frameDocumentMatchesExpected(
          iframe,
          expectedFrameHtml,
          frameWrittenHtmlRef.current,
        )
        && marker?.getAttribute(FRAME_VERIFICATION_ATTRIBUTE) === expectedToken
        && marker.getAttribute("content") === expectedToken
      ) {
        // Static documents can connect after parsing. Runtime documents wait
        // for iframe load so native script ordering and deferred work settle
        // according to browser semantics rather than a PageRoot paint probe.
        if (connectFrame(iframe, connectedFrameGeneration)) {
          return;
        }
      }
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

  useEffect(() => {
    const candidate = runtimeCandidateRef.current;
    const candidateRender = runtimeCandidateRender;
    if (
      !candidate
      || !candidateRender
      || candidate.render.elementGeneration !== candidateRender.elementGeneration
      || candidate.render.html !== candidateRender.html
    ) return undefined;
    let animationFrame = 0;
    let attempts = 0;
    const startedAt = performance.now();
    const connectParsedCandidate = () => {
      const current = runtimeCandidateRef.current;
      const iframe = runtimeCandidateIframeRef.current;
      if (
        current !== candidate
        || !iframe
        || candidate.render.elementGeneration !== candidateRender.elementGeneration
      ) return;
      if (connectRuntimeCandidateRef.current(
        iframe,
        candidateRender.elementGeneration,
      )) return;
      if (
        candidate.runtimeFrame
        && !candidate.runtimeFrame.settled
        && performance.now() - startedAt >= EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs
      ) {
        failRuntimeCandidate(candidate, "failed");
        return;
      }
      attempts += 1;
      const retryLimit = candidate.runtimeFrame
        ? Math.ceil(EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs / 16) + 30
        : 120;
      if (attempts < retryLimit) {
        animationFrame = requestAnimationFrame(connectParsedCandidate);
      } else {
        cancelRuntimeCandidateRef.current();
        setEditFeedback({
          code: "canvas_c01_source_map",
          title: "页面预览没有完成",
          message: "当前画布仍保持上一帧完整内容，请重新载入后再试。",
          tone: "error",
          sticky: true,
          recovery: "reload",
        });
      }
    };
    animationFrame = requestAnimationFrame(connectParsedCandidate);
    return () => cancelAnimationFrame(animationFrame);
  }, [failRuntimeCandidate, runtimeCandidateRender]);

  const applyInlineStyle = useCallback(
    (
      property: EditableStyleProperty,
      value: string,
      fromQueuedCommand = false,
    ) => {
      let element = selectedElementRef.current;
      if (readOnlyRef.current || !selectedElementHasSourceMutationAuthority() || !element) return;
      const config = STYLE_PROPERTY_CONFIGS.find((entry) => entry.property === property);
      if (!config) return;
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
        if (!restoreNativeEditSelectionForCommand(activeNativeEdit)) {
          reportBlockedEdit(new Error(
            "当前文字选择已失效，请重新选择文字后再修改格式。",
          ));
          return;
        }
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
        const committed = finishNativeEditing(true, "style", {
          resumeAfterRuntimeHandoff: false,
        });
        if (!committed.ok || committed.frameReloading) return;
        activeNativeEdit = null;
        element = selectedElementRef.current;
        if (!element || !element.isConnected) {
          reportBlockedEdit(new Error(
            "文字片段提交后的宿主没有精确重绑，已停止继续修改。",
          ));
          return;
        }
      }
      if (
        activeNativeEdit
        && activeRange
        && TEXT_RANGE_EDITABLE_PROPERTIES.has(property)
      ) {
        const styleTargets = activeRange.styleElements.filter(
          (candidate) => candidate.isConnected,
        );
        const styleTarget = styleTargets[0] || element;
        const verifiedOverride = verifyInlineStyleOverrideForTargets(
          styleTargets.length > 0 ? styleTargets : [styleTarget],
          config.cssProperty,
          value,
          activeNativeEdit,
        );
        if (!verifiedOverride) {
          reportInlineStyleOverrideFailure();
          return;
        }
        if (!activeNativeEdit.session.applyInlineStyle(
          config.cssProperty,
          value,
          verifiedOverride.priority === "important",
        )) {
          reportBlockedEdit(new Error("当前选区无法安全应用这个文字格式。"));
          retainNativeEditFocusRef.current = null;
          return;
        }
        const checkpoint = checkpointNativeEdit("style");
        if (!checkpoint.ok) {
          retainNativeEditFocusRef.current = null;
          return;
        }
        rememberNativeEditSelection(activeNativeEdit);
        return;
      }
      if (
        activeNativeEdit
        && !(activeRange && TEXT_RANGE_EDITABLE_PROPERTIES.has(property))
      ) {
        const committed = finishNativeEditing(true, "style", {
          resumeAfterRuntimeHandoff: false,
        });
        if (!committed.ok) return;
        activeNativeEdit = null;
      }
      if (activeRange && TEXT_RANGE_EDITABLE_PROPERTIES.has(property)) {
        const sourceIndex = sourceIndexRef.current;
        if (!sourceIndex) return;
        const styleTargets = activeRange.styleElements.filter(
          (candidate) => candidate.isConnected,
        );
        const styleTarget = styleTargets[0] || element;
        const verifiedOverride = verifyInlineStyleOverrideForTargets(
          styleTargets.length > 0 ? styleTargets : [styleTarget],
          config.cssProperty,
          value,
          activeNativeEdit,
        );
        if (!verifiedOverride) {
          reportInlineStyleOverrideFailure();
          return;
        }
        const beforeFacts = inlineStyleFacts(styleTarget, config.cssProperty);
        const command = {
          type: "set-text-range-style" as const,
          targetRef: sourceTargetRefForSelection(activeRange.target),
          segments: activeRange.segments,
          property: config.cssProperty,
          value,
          ...(verifiedOverride.priority === "important" ? { important: true } : {}),
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
          before: beforeFacts,
          after: {
            inlineValue: value,
            inlinePriority: verifiedOverride.priority,
            computedValue: verifiedOverride.computedValue,
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
      const beforeFacts = inlineStyleFacts(element, config.cssProperty);
      const verifiedOverride = verifyInlineStyleOverride(
        element,
        config.cssProperty,
        value,
        activeNativeEdit,
      );
      if (!verifiedOverride) {
        reportInlineStyleOverrideFailure();
        return;
      }
      const mutation: HtmlCanvasMutation = {
        kind: "style",
        target,
        property,
        before: beforeFacts,
        after: {
          inlineValue: value,
          inlinePriority: verifiedOverride.priority,
          computedValue: verifiedOverride.computedValue,
        },
      };
      applySourceCommand({
        type: "set-inline-style",
        targetRef: sourceTargetRefForSelection(target),
        property: config.cssProperty,
        value,
        ...(verifiedOverride.priority === "important" ? { important: true } : {}),
        expectedSourceSha256: sourceIndexRef.current?.sourceSha256 || "",
      }, mutation);
    },
    [
      applySourceCommand,
      checkpointNativeEdit,
      finishNativeEditing,
      rememberNativeEditSelection,
      refreshNativeEditRangeState,
      reportInlineStyleOverrideFailure,
      reportBlockedEdit,
      restoreNativeEditSelectionForCommand,
      selectedElementHasSourceMutationAuthority,
    ],
  );

  const applyNativeFormatShortcut = useCallback((
    shortcut: NativeFormatShortcut,
  ): boolean => {
    const active = activeNativeEditRef.current;
    if (!active) return false;
    const nativeSelection = restoreNativeEditSelectionForCommand(active);
    if (!nativeSelection) {
      reportBlockedEdit(new Error(
        "当前文字选择已失效，请重新选择文字后再修改格式。",
      ));
      return true;
    }
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
    reportBlockedEdit,
    restoreNativeEditSelectionForCommand,
  ]);
  applyNativeFormatShortcutRef.current = applyNativeFormatShortcut;

  const handleToolbarKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
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
        finishNativeEditing(true, "manual", {
          resumeAfterRuntimeHandoff: false,
        });
        return;
      }
      iframeRef.current?.focus();
      clearSelection();
    }
  }, [clearSelection, finishNativeEditing, spacingMenuOpen]);

  const editorHeight = typeof height === "number" ? `${height}px` : height;
  const containerStyle = { "--html-canvas-height": editorHeight } as CSSProperties;
  const toolbarStyle = overlayPosition
    ? ({ left: overlayPosition.toolbarLeft, top: overlayPosition.toolbarTop } satisfies CSSProperties)
    : undefined;
  const selectedNativeEditHost = selectedElementRef.current && sourceIndexRef.current
    ? nativeEditHostForElement(selectedElementRef.current, sourceIndexRef.current)
    : null;
  const selectedNativeTextFragment = (
    !selectedNativeEditHost
    && selectedElementRef.current
    && sourceIndexRef.current
  )
    ? nativeTextFragmentForRange(activeTextRangeRef.current, sourceIndexRef.current)
      ?? nativeTextFragmentForElement(
        selectedElementRef.current,
        sourceIndexRef.current,
      )
    : null;
  const selectedNativeEditAvailable = Boolean(
    !runtimeGeneratedSelection
    && (
      activeNativeEditRef.current
      || selectedNativeEditHost
      || selectedNativeTextFragment
    ),
  );
  const selectionCapability = selection && !interactionLocked
    ? canvasPointerCapabilityFromProof({
      canStartTextEdit: selectedNativeEditAvailable,
      sourceResolution: selection.resolution,
    })
    : null;
  const selectedVisualTargetElement = canvasVisualTargetElement(
    selectedElementRef.current,
    sourceIndexRef.current,
    { runtimeGenerated: runtimeGeneratedSelection },
  );
  const hoverTargetIsSelected = Boolean(
    hoverChrome.capability
    && selection
    && hoverChrome.capability.visualElement === selectedVisualTargetElement,
  );
  const runtimeHandoffPositioning = containerRef.current?.getAttribute(
    "data-runtime-handoff",
  ) === "positioning";
  const selectedOutlineStyle = runtimeHandoffPositioning
    ? selectionChromeProjectionRef.current?.selectedOutlineStyle
    : canvasTargetOutlineStyle(
        containerRef.current,
        iframeRef.current,
        selectedVisualTargetElement,
        Boolean(selection && isPageRootSelection(selection)),
      );
  const showHoverOutline = Boolean(
    !runtimeHandoffPositioning
    &&
    pointerCapabilityHoverEnabled
    && hoverChrome.outline
    && hoverChrome.capability
    && !hoverTargetIsSelected
    && !isEditing
    && !interactionLocked
  );
  const showHoverHint = Boolean(
    !runtimeHandoffPositioning
    &&
    pointerCapabilityHoverEnabled
    && hoverChrome.outline
    && hoverChrome.hint
    && hoverChrome.capability
    && !hoverTargetIsSelected
    && !isEditing
    && !interactionLocked
  );
  let hoverOutlineStyle: CSSProperties | undefined;
  let hoverHintStyle: CSSProperties | undefined;
  let hoverHintPlacement: ReturnType<typeof placeCanvasHoverHint> | undefined;
  const hoverHintCopy = hoverChrome.capability?.hint;
  const hoverHintMeasuredWidth = hoverHintMeasurement
    && hoverHintMeasurement.copy === hoverHintCopy
    ? hoverHintMeasurement.width
    : undefined;
  if (
    (showHoverOutline || showHoverHint)
    && hoverChrome.capability?.visualElement?.isConnected
    && containerRef.current
    && iframeRef.current
  ) {
    const containerRect = containerRef.current.getBoundingClientRect();
    const outline = canvasTargetOutlineStyle(
      containerRef.current,
      iframeRef.current,
      hoverChrome.capability.visualElement,
    );
    if (outline) {
      hoverOutlineStyle = outline;
      hoverHintPlacement = placeCanvasHoverHint({
        containerWidth: containerRect.width,
        targetLeft: outline.left,
        targetTop: outline.top,
        targetHeight: outline.height,
        labelWidth: hoverHintMeasuredWidth,
      });
      hoverHintStyle = showHoverHint
        ? {
          left: hoverHintPlacement.left,
          top: hoverHintPlacement.top,
          maxWidth: hoverHintPlacement.width,
        }
        : undefined;
    }
  }
  useLayoutEffect(() => {
    const hint = hoverHintMeasureRef.current;
    if (!showHoverHint || !hoverHintCopy || !hint) return;
    const width = hint.getBoundingClientRect().width;
    if (!Number.isFinite(width) || width <= 0) return;
    setHoverHintMeasurement((current) => {
      if (current && current.copy === hoverHintCopy && Math.abs(current.width - width) < 0.5) {
        return current;
      }
      return { copy: hoverHintCopy, width };
    });
  }, [hoverHintCopy, hoverHintPlacement?.left, hoverHintPlacement?.top, showHoverHint]);
  const selectedPagePresentationAction = (
    !readOnly
    && !interactionLocked
    && !runtimeGeneratedSelection
    && selection
  ) ? resolvePagePresentationAction(selection) : null;
  const selectionChromeProjection = stabilizeSelectionChromeProjection(
    selectionChromeProjectionRef.current,
    {
      toolbarStyle,
      selectedOutlineStyle,
      hoverOutlineStyle,
      hoverHintStyle,
      hoverHintPlacement,
      selectedPagePresentationAction,
    },
  );
  selectionChromeProjectionRef.current = selectionChromeProjection;
  const textFormatRequiresSelection = isEditing && !hasTextRange;
  const handleEditFeedbackAction = useCallback(() => {
    const recovery = editFeedback?.recovery;
    setEditFeedback(null);
    setEditFeedbackPaused(false);
    if (recovery === "reload") {
      onRequestReload?.();
    }
  }, [editFeedback?.recovery, onRequestReload]);
  const editFeedbackActionAvailable = editFeedback?.recovery === "reload"
    && Boolean(onRequestReload);
  const handleHoverHintPointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    hoverHintPointerInsideRef.current = true;
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const handleHoverHintPointerEnter = useCallback(() => {
    hoverHintPointerInsideRef.current = true;
  }, []);
  const handleHoverHintPointerLeave = useCallback(() => {
    hoverHintPointerInsideRef.current = false;
    hoverControllerRef.current?.hide();
  }, []);
  const handleHoverHintClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const resolvedTarget = hoverChrome.capability;
    if (interactionLocked || !resolvedTarget) return;
    hoverControllerRef.current?.hide();
    const currentDocument = iframeRef.current?.contentDocument;
    const currentSourceHash = sourceIndexRef.current?.sourceSha256;
    const expectedSourceHash = resolvedTarget.sourceRef?.expectedSourceSha256
      || resolvedTarget.selection.expectedSourceSha256;
    if (
      resolvedTarget.generation !== nativeDomGenerationRef.current
      || resolvedTarget.targetElement.ownerDocument !== currentDocument
      || !resolvedTarget.targetElement.isConnected
      || !resolvedTarget.visualElement.isConnected
      || (expectedSourceHash && expectedSourceHash !== currentSourceHash)
    ) return;
    // The caption has no current pointer hit. Rebuild selection from the live
    // canonical target instead of reusing a possibly stale selection override.
    selectElement(resolvedTarget.targetElement, undefined, {
      showToolbar: true,
      runtimeGenerated: resolvedTarget.runtimeGenerated,
    });
  }, [hoverChrome.capability, interactionLocked, selectElement]);
  const dismissEditFeedback = useCallback(() => {
    setEditFeedback(null);
  }, []);
  const handleSelectCommentMarker = useCallback((markerSelection: HtmlCanvasSelection) => {
    if (lockedRef.current) return;
    // The marker was clicked at the user's current Canvas position. Keep that
    // viewport stable; rail navigation can still reveal the paired target.
    selectTarget(markerSelection, { reveal: false, showToolbar: true });
  }, [selectTarget]);
  const handleToolbarPointerDownCapture = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const activeNativeEdit = activeNativeEditRef.current;
    if (!activeNativeEdit) return;
    if (activeNativeEdit.session.isComposing()) {
      // Moving focus from the authored iframe to this outer toolbar makes
      // Chromium/macOS expose intermediate IME text. Keep the editor focused.
      event.preventDefault();
      return;
    }
    const documentSelection = activeNativeEdit.rootElement.ownerDocument.getSelection();
    const liveSelectionIsInside = Boolean(
      documentSelection?.anchorNode
      && documentSelection.focusNode
      && (
        documentSelection.anchorNode === activeNativeEdit.rootElement
        || activeNativeEdit.rootElement.contains(documentSelection.anchorNode)
      )
      && (
        documentSelection.focusNode === activeNativeEdit.rootElement
        || activeNativeEdit.rootElement.contains(documentSelection.focusNode)
      )
    );
    const retained = retainNativeEditFocusRef.current;
    const retainedIsCurrent = Boolean(
      retained
      && retained.session === activeNativeEdit.session
      && retained.targetId === activeNativeEdit.target.id
      && nativeEditLeasesMatch(retained.lease, activeNativeEdit.lease),
    );
    if (retained && !retainedIsCurrent) return;
    const selection = retained && retainedIsCurrent
      ? retained.selection
      : liveSelectionIsInside
        ? activeNativeEdit.session.getSelection()
        : activeNativeEdit.selection;
    retainNativeEditFocusRef.current = {
      session: activeNativeEdit.session,
      lease: { ...activeNativeEdit.lease },
      targetId: activeNativeEdit.target.id,
      selection: { ...selection },
      textRange: cloneActiveTextRange(activeTextRangeRef.current, activeNativeEdit.target),
    };
    const target = event.target;
    if (
      target instanceof Element
      && target.closest("button[data-native-format-focus='preserve']")
    ) event.preventDefault();
  }, []);
  const handleToolbarMouseDownCapture = useCallback((
    event: ReactMouseEvent<HTMLDivElement>,
  ) => {
    if (activeNativeEditRef.current?.session.isComposing()) {
      // Chromium attaches the focus default to mousedown as well.
      event.preventDefault();
    }
  }, []);
  const executeSelectedPresentationAction = useCallback(() => {
    if (selection) executePagePresentationAction(selection);
  }, [executePagePresentationAction, selection]);
  const commentOnSelection = useCallback(() => {
    if (lockedRef.current || !selection) return;
    const openComment = () => {
      const activeRange = activeTextRangeRef.current;
      const sameElement = Boolean(
        activeRange
        && (
          (activeRange.target.elementId && activeRange.target.elementId === selection.elementId)
          || (activeRange.target.nodeId && activeRange.target.nodeId === selection.nodeId)
        )
      );
      const capturedTextLocator = sameElement
        ? textLocatorForActiveRange(activeRange, sourceIndexRef.current)
        : null;
      const commentTarget = capturedTextLocator
        ? { ...selection, textLocator: capturedTextLocator }
        : selection;
      if (activeNativeEditRef.current) {
        const committed = finishNativeEditing(true, "manual", {
          resumeAfterRuntimeHandoff: false,
        });
        if (!committed.ok) return;
      }
      requestCommentForTarget(commentTarget);
    };
    if (deferNativeCommandRef.current("comment", openComment)) return;
    openComment();
  }, [finishNativeEditing, requestCommentForTarget, selection]);
  const startEditingSelection = useCallback(() => {
    startEditing();
  }, [startEditing]);
  const toggleSpacingMenu = useCallback(() => {
    setSpacingMenuOpen((open) => !open);
  }, []);
  const selectionChromeModel = useMemo<SelectionChromeModel>(() => ({
    hover: deriveCapabilityHoverState({
      enabled: pointerCapabilityHoverEnabled,
      hoverChrome,
      hoverTargetIsSelected,
      isEditing,
      interactionLocked,
      outlineStyle: selectionChromeProjection.hoverOutlineStyle,
      hintStyle: selectionChromeProjection.hoverHintStyle,
      hintPlacement: selectionChromeProjection.hoverHintPlacement,
    }),
    overlay: deriveSelectionOverlay({
      selection,
      outlineStyle: selectionChromeProjection.selectedOutlineStyle,
    }),
    canvasTransitionActive,
    selectionCapabilitySpoken: selectionCapability ? selectionCapability.spoken : "",
    interactionLocked,
    hoverHintMeasureRef,
    editFeedback,
    reloadActionLabel,
    editFeedbackActionAvailable,
    renderedMode,
    commentMarkers,
    toolbarVisible,
    overlayPosition,
    toolbarRef,
    hasTextRange,
    isEditing,
    toolbarStyle: selectionChromeProjection.toolbarStyle,
    selectedPagePresentationAction: selectionChromeProjection.selectedPagePresentationAction,
    readOnly: readOnly || runtimeGeneratedSelection,
    selectedNativeEditAvailable,
    selectedStyle,
    textFormatRequiresSelection,
    enableReorder: enableReorder && !runtimeGeneratedSelection,
    moveAvailability,
    spacingMenuRef,
    spacingMenuOpen,
    usageProjectId,
    usageCapture,
  }), [
    canvasTransitionActive,
    commentMarkers,
    editFeedback,
    editFeedbackActionAvailable,
    enableReorder,
    hasTextRange,
    hoverChrome,
    hoverTargetIsSelected,
    interactionLocked,
    isEditing,
    moveAvailability,
    overlayPosition,
    pointerCapabilityHoverEnabled,
    readOnly,
    reloadActionLabel,
    renderedMode,
    runtimeGeneratedSelection,
    selectedNativeEditAvailable,
    selectionChromeProjection,
    selectedStyle,
    selection,
    selectionCapability,
    spacingMenuOpen,
    textFormatRequiresSelection,
    toolbarVisible,
    usageCapture,
    usageProjectId,
  ]);
  const selectionChromeActions = useMemo<SelectionChromeActions>(() => ({
    onHoverHintPointerDown: handleHoverHintPointerDown,
    onHoverHintPointerEnter: handleHoverHintPointerEnter,
    onHoverHintPointerLeave: handleHoverHintPointerLeave,
    onHoverHintClick: handleHoverHintClick,
    onEditFeedbackAction: handleEditFeedbackAction,
    onDismissEditFeedback: dismissEditFeedback,
    onPauseEditFeedback: setEditFeedbackPaused,
    onSelectCommentMarker: handleSelectCommentMarker,
    onToolbarKeyDown: handleToolbarKeyDown,
    onToolbarPointerDownCapture: handleToolbarPointerDownCapture,
    onToolbarMouseDownCapture: handleToolbarMouseDownCapture,
    onExecutePresentationAction: executeSelectedPresentationAction,
    onComment: commentOnSelection,
    onStartEditing: startEditingSelection,
    onApplyInlineStyle: applyInlineStyle,
    onMoveSelected: moveSelected,
    onDuplicateSelected: duplicateSelected,
    onDeleteSelected: deleteSelected,
    onToggleSpacingMenu: toggleSpacingMenu,
  }), [
    applyInlineStyle,
    commentOnSelection,
    dismissEditFeedback,
    deleteSelected,
    duplicateSelected,
    executeSelectedPresentationAction,
    handleEditFeedbackAction,
    handleHoverHintClick,
    handleHoverHintPointerDown,
    handleHoverHintPointerEnter,
    handleHoverHintPointerLeave,
    handleSelectCommentMarker,
    handleToolbarKeyDown,
    handleToolbarMouseDownCapture,
    handleToolbarPointerDownCapture,
    moveSelected,
    startEditingSelection,
    toggleSpacingMenu,
  ]);

  return (
    <div
      ref={containerRef}
      className={[styles.editor, className].filter(Boolean).join(" ")}
      style={containerStyle}
      data-testid="html-canvas-editor"
      data-locked={interactionLocked ? "true" : undefined}
      data-interaction-mode={renderedMode} data-runtime-library-origins={editRuntimeGrant?.libraryOrigins?.join(",") || undefined}
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
        onLoad={(event) => {
          connectFrame(event.currentTarget, frameRender.elementGeneration);
          restoreInitialScroll();
        }}
      />
      {runtimeRetiringRender ? (
        <iframe
          key={runtimeRetiringRender.elementGeneration}
          data-frame-generation={runtimeRetiringRender.elementGeneration}
          data-frame-role="runtime-retiring"
          className={styles.frame}
          title="Canvas runtime retiring frame"
          srcDoc={runtimeRetiringRender.html}
          sandbox={runtimeRetiringRender.runtime
            ? "allow-same-origin allow-scripts"
            : "allow-same-origin"}
          aria-hidden="true"
          tabIndex={-1}
          style={{
            gridColumn: "1",
            gridRow: "1",
            visibility: "visible",
            opacity: 1,
            pointerEvents: "none",
          }}
        />
      ) : null}
      {/* A promoted candidate keeps this generation key, so React moves the
          loaded browsing context into the active slot instead of reloading it. */}
      {runtimeCandidateRender ? (
        <iframe
          key={runtimeCandidateRender.elementGeneration}
          ref={runtimeCandidateIframeRef}
          data-frame-generation={runtimeCandidateRender.elementGeneration}
          data-frame-role="runtime-candidate"
          className={styles.frame}
          title="Canvas runtime candidate"
          srcDoc={runtimeCandidateRender.html}
          sandbox={runtimeCandidateRender.runtime
            ? "allow-same-origin allow-scripts"
            : "allow-same-origin"}
          aria-hidden="true"
          tabIndex={-1}
          style={{
            gridColumn: "1",
            gridRow: "1",
            visibility: "visible",
            opacity: 0,
            pointerEvents: "none",
          }}
          onLoad={(event) => {
            const candidate = runtimeCandidateRef.current;
            if (
              candidate
              && candidate.render.elementGeneration === runtimeCandidateRender.elementGeneration
            ) candidate.loaded = true;
            connectRuntimeCandidateRef.current(
              event.currentTarget,
              runtimeCandidateRender.elementGeneration,
            );
          }}
        />
      ) : null}
      <HtmlCanvasSelectionChrome
        model={selectionChromeModel}
        actions={selectionChromeActions}
      />
    </div>
  );
});

export default HtmlCanvasEditor;
