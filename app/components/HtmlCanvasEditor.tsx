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
  SOURCE_NODE_ATTRIBUTE,
  applyPatchPlan,
  buildSourceIndex,
  createInsertionPointTargetRef,
  createTargetRef,
  instrumentPreviewHtml,
  isDisposableSourceTextWrapper,
  planSourcePatch,
  resolveTargetRef,
} from "../lib/source-patch-core.js";
import {
  sourceTargetRefForSelection,
  targetLevelForSelection,
} from "../lib/canvas-target-rebind.js";
import {
  buildSourceTextMap,
  isTransparentSourceTextElement,
  sourceSegmentsToTextRange,
  textRangeToSourceSegments,
  type SourceTextMap,
} from "../lib/source-text-map.js";
import {
  classifyNativeEditCapability,
  isNativeEditableCapability,
} from "../lib/native-edit-capability.js";
import { RuntimeDomSourceMap } from "../lib/runtime-dom-source-map.js";
import {
  captureFormatSkeleton,
  validateFormatSkeletonTransaction,
  type FormatSkeleton,
} from "../lib/format-skeleton.js";
import {
  NATIVE_EDIT_CHECKPOINT_DELAY_MS,
  NativeEditingController,
  nativeLogicalText,
  type NativeEditBaseline,
  type NativeEditCheckpointTrigger,
  type NativeEditSelection,
  type NativeEditSessionState,
} from "./NativeEditingController";
import {
  planNativeStructuralEdit,
  type NativeSourceEditIntent,
} from "../lib/native-structural-edit-planner.js";
import {
  buildRuntimeDomMap,
  nativeRuntimePreflight as inspectNativeEditRuntime,
} from "./native-edit-runtime-preflight";
import styles from "./HtmlCanvasEditor.module.css";

const EDITOR_STYLE_ATTRIBUTE = "data-html-canvas-editor-style";
const INJECTED_BASE_ATTRIBUTE = "data-html-canvas-injected-base";
const DISABLED_SCRIPT_ATTRIBUTE = "data-html-canvas-disabled-script";
const ORIGINAL_SCRIPT_TYPE_ATTRIBUTE = "data-html-canvas-original-script-type";
const DISABLED_REFRESH_ATTRIBUTE = "data-html-canvas-disabled-refresh";
const FRAME_VERIFICATION_ATTRIBUTE = "data-html-canvas-render-verification";
const GLOBAL_SELECTION_ATTRIBUTE = "data-html-canvas-global-selected";
const MISSING_ATTRIBUTE_VALUE = "__html_canvas_missing__";

const EDITOR_DOCUMENT_STYLES = `
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
`;

export type HtmlCanvasSelectionLevel = "module" | "part" | "insertion";
export type HtmlCanvasTargetResolution = "exact" | "rebound" | "ambiguous" | "orphaned";

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
  /** Stable identity shared by a direct edit and its undo/redo mutations. */
  historyId?: string;
  /** Lets the host fold history without creating a second editing authority. */
  historyAction?: "undo" | "redo";
  target: HtmlCanvasSelection;
  property?: string;
  before: unknown;
  after: unknown;
  /** Ephemeral post-patch refs for host state; never persisted as audit payload. */
  targetUpdates?: HtmlCanvasSelection[];
  /** Every input targetId covered by the deterministic patch refresh. */
  trackedTargetIds?: string[];
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
  count?: number;
  label?: string;
};

const EMPTY_COMMENTED_TARGETS: readonly HtmlCanvasCommentedTarget[] = [];
const EMPTY_TRACKED_TARGETS: readonly HtmlCanvasSelection[] = [];

export type HtmlCanvasEditorHandle = {
  /** Returns the exact source string held by the single SourcePatchEngine. */
  getSourceHtml: () => string;
  /** Exact source string whose sanitized representation has finished loading in the iframe. */
  getRenderedSourceHtml: () => string | null;
  /** Commits delivered native input while keeping the live editing session active. */
  checkpointPendingEdit: () => HtmlCanvasCommitResult;
  /** Cuts Chromium editing history, reloads canonical DOM, and optionally resumes editing. */
  fencePendingEdit: (options?: {
    resumeEditing?: boolean;
    trigger?: NativeEditCheckpointTrigger;
  }) => HtmlCanvasCommitResult;
  commitPendingEdit: () => HtmlCanvasCommitResult;
  /** Captures pending text and synchronously blocks every mutation entrypoint. */
  freezeNow: () => HtmlCanvasFreezeSnapshot;
  /** Releases an imperative freeze when the controlled mode is editing. */
  unlockNow: () => boolean;
  undo: () => boolean;
  canUndo: () => boolean;
  /** True while source-uncommitted native text or marked text still exists. */
  hasPendingNativeEdit: () => boolean;
  redo: () => boolean;
  canRedo: () => boolean;
  clearSelection: () => void;
  select: (
    target: HtmlCanvasSelection,
    options?: { reveal?: boolean; showToolbar?: boolean },
  ) => HtmlCanvasSelection | null;
  startEditing: () => boolean;
  moveSelected: (direction: "up" | "down") => boolean;
  /** Defers one explicit user command until the current native composition is stable/cancelled. */
  deferNativeCommand: (
    kind: string,
    run: () => void,
    payload?: unknown,
    options?: NativeDeferredCommandOptions,
  ) => boolean;
};

export type HtmlCanvasEditorProps = {
  /** A complete document or an HTML fragment. Fragments are normalized to a complete document. */
  html: string;
  /** Called with the exact next source produced by SourcePatchEngine. */
  onChange: (nextSourceHtml: string, mutation?: HtmlCanvasMutation) => boolean;
  /** Called when an element is selected or the selection is cleared. */
  onSelect?: (selection: HtmlCanvasSelection | null) => void;
  /** Notifies the host about any pointer interaction inside the isolated iframe. */
  onInteraction?: () => void;
  /** Opens the host product's comment composer for the current selection. */
  onRequestComment?: (selection: HtmlCanvasSelection) => void;
  /** Callback alternative to using a ref. Receives null when the editor unmounts. */
  onReady?: (api: HtmlCanvasEditorHandle | null) => void;
  /** Handles Cmd/Ctrl+S inside the iframe without exposing the browser's native Save dialog. */
  onRequestFlush?: () => void;
  /** Reports a fail-closed edit whose source target could not be patched safely. */
  onEditBlocked?: (message: string) => void;
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
  /** Keeps the current document's undo stack while temporarily rendering an immutable history file. */
  preserveUndoHistory?: boolean;
  /** CSS selectors that already have comments and should receive a compact canvas marker. */
  commentedTargets?: readonly HtmlCanvasCommentedTarget[];
  /** Non-visual audit targets that must retain identity through later source patches. */
  trackedTargets?: readonly HtmlCanvasSelection[];
};

type OverlayPosition = {
  toolbarLeft: number;
  toolbarTop: number;
};

type SelectedStyle = {
  fontSize: number;
  color: string;
  backgroundColor: string;
  padding: number;
  margin: number;
  lineHeight: number;
  isBold: boolean;
  isItalic: boolean;
  sources: StyleSourceInfo[];
};

type EditableStyleProperty =
  | "fontSize"
  | "color"
  | "backgroundColor"
  | "fontWeight"
  | "fontStyle"
  | "padding"
  | "margin"
  | "lineHeight";

type StyleSourceKind = "inline" | "rule" | "variable" | "inherit" | "initial" | "default";

type StyleSourceInfo = {
  property: EditableStyleProperty;
  cssProperty: string;
  label: string;
  computedValue: string;
  kind: StyleSourceKind;
  selector: string;
  source: string;
  mediaCondition: string;
  sharedImpactCount: number;
  important: boolean;
  variableName?: string;
};

type StyleDeclarationCandidate = {
  value: string;
  important: boolean;
  selector: string;
  source: string;
  mediaCondition: string;
  sharedImpactCount: number;
  specificity: [number, number, number, number];
  order: number;
};

type MoveAvailability = {
  up: boolean;
  down: boolean;
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
  left: number;
  top: number;
};

type TextRangeSegment = {
  textNodeId: string;
  startOffset: number;
  endOffset: number;
};

type ActiveTextRange = {
  target: HtmlCanvasSelection;
  segments: TextRangeSegment[];
  text: string;
  styleElements: HTMLElement[];
  direction: "forward" | "backward";
};

type ActiveNativeEdit = {
  rootElement: HTMLElement;
  target: HtmlCanvasSelection;
  projection: SourceTextMap;
  rootTargetRef: SourceTargetRef;
  runtimeMap: RuntimeDomSourceMap;
  formatSkeleton: FormatSkeleton;
  session: NativeEditingController;
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
  session: NativeEditingController;
  lease: ActiveNativeEdit["lease"];
  run: () => void;
  onDiscard?: (reason: NativeDeferredCommandDiscardReason) => void;
};

type RetainedNativeEditFocus = {
  session: NativeEditingController;
  lease: ActiveNativeEdit["lease"];
};

type NativeEditFenceBookmark = {
  fenceId: number;
  target: HtmlCanvasSelection;
  selection: NativeEditSelection;
  focus: boolean;
  toolbarVisible: boolean;
};

type PendingNativeEditResume = NativeEditFenceBookmark & {
  expectedFrameGeneration: number;
  sourceRevision: string;
};

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

function nativeSelectionFromMutationValue(
  value: unknown,
  fallback: NativeEditSelection,
): NativeEditSelection {
  if (!value || typeof value !== "object" || !("selection" in value)) return fallback;
  const selection = (value as { selection?: Partial<NativeEditSelection> }).selection;
  if (
    !selection
    || !Number.isSafeInteger(selection.anchor)
    || !Number.isSafeInteger(selection.focus)
    || Number(selection.anchor) < 0
    || Number(selection.focus) < 0
    || (selection.affinity !== "left" && selection.affinity !== "right")
  ) return fallback;
  return {
    anchor: Number(selection.anchor),
    focus: Number(selection.focus),
    affinity: selection.affinity,
  };
}

type EditFeedback = {
  title: string;
  message: string;
  tone: "warning" | "error";
  sticky: boolean;
};

type EditorHistoryEntry = {
  inversePlan: SourcePatchPlan;
  mutation: HtmlCanvasMutation;
};

type SourceIndexValue = ReturnType<typeof buildSourceIndex>;
type SourceElementValue = {
  type: "element";
  nodeId: string;
  tagName: string;
  parentId: string | null;
  previousElementSiblingId: string | null;
  nextElementSiblingId: string | null;
  childIds: string[];
  childElementIds: string[];
  textNodeIds: string[];
  textContent: string;
  attributes: Array<{
    name: string;
    rawValue?: string | null;
    value?: string | null;
  }>;
  startTagRange: { startOffset: number; endOffset: number };
  attributesByName: Map<string, Array<{
    value?: string | null;
    rawValue?: string | null;
  }>>;
};
type SourceTargetRef = {
  targetId: string;
  label: string;
  level: "module" | "subregion" | "text" | "insertion-point";
  selector?: string;
  textQuote?: string;
  sourceAnchor?: HtmlCanvasSelection["sourceAnchor"];
  fingerprint?: HtmlCanvasFingerprint;
  resolution: HtmlCanvasTargetResolution;
};
type SourcePatchCommand = Parameters<typeof planSourcePatch>[0];
type SourcePatchPlan = NonNullable<ReturnType<typeof planSourcePatch>>;

const MAX_UNDO_ENTRIES = 100;

const STYLE_PROPERTY_CONFIGS: ReadonlyArray<{
  property: EditableStyleProperty;
  cssProperty: string;
  label: string;
}> = [
  { property: "fontSize", cssProperty: "font-size", label: "字号" },
  { property: "color", cssProperty: "color", label: "文字颜色" },
  { property: "backgroundColor", cssProperty: "background-color", label: "填充" },
  { property: "fontWeight", cssProperty: "font-weight", label: "字重" },
  { property: "fontStyle", cssProperty: "font-style", label: "字形" },
  { property: "padding", cssProperty: "padding-top", label: "内边距" },
  { property: "margin", cssProperty: "margin-top", label: "外间距" },
  { property: "lineHeight", cssProperty: "line-height", label: "行距" },
];

const TEXT_RANGE_EDITABLE_PROPERTIES = new Set<EditableStyleProperty>([
  "fontSize",
  "color",
  "backgroundColor",
  "fontWeight",
  "fontStyle",
]);

const NATURALLY_INHERITED_PROPERTIES = new Set([
  "color",
  "font-family",
  "font-size",
  "font-style",
  "font-weight",
  "line-height",
  "text-align",
  "text-indent",
  "text-transform",
  "visibility",
  "white-space",
  "word-spacing",
]);

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function disableExecutableMarkup(source: string): string {
  return source.replace(/<script\b([^>]*)>/gi, (_openingTag, rawAttributes: string) => {
    const typePattern = /\s+type\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;
    const typeMatch = rawAttributes.match(typePattern);
    const originalType = typeMatch ? typeMatch[1] ?? typeMatch[2] ?? typeMatch[3] ?? "" : MISSING_ATTRIBUTE_VALUE;
    const attributesWithoutType = rawAttributes.replace(typePattern, "");
    return `<script${attributesWithoutType} type="application/x-html-canvas-disabled" ${DISABLED_SCRIPT_ATTRIBUTE}="true" ${ORIGINAL_SCRIPT_TYPE_ATTRIBUTE}="${escapeAttribute(originalType)}">`;
  });
}

function doctypeString(doctype: DocumentType | null): string {
  if (!doctype) return "<!DOCTYPE html>";
  const publicId = doctype.publicId ? ` PUBLIC "${doctype.publicId}"` : "";
  const systemId = doctype.systemId
    ? `${publicId ? "" : " SYSTEM"} "${doctype.systemId}"`
    : "";
  return `<!DOCTYPE ${doctype.name}${publicId}${systemId}>`;
}

function sanitizeDocument(source: string, baseUrl?: string): string {
  const disabledSource = disableExecutableMarkup(source);
  if (typeof DOMParser === "undefined") return disabledSource;

  const parsed = new DOMParser().parseFromString(disabledSource, "text/html");
  parsed.querySelectorAll("meta[http-equiv]").forEach((node) => {
    const directive = node.getAttribute("http-equiv")?.trim().toLowerCase();
    if (directive === "refresh") {
      node.setAttribute(DISABLED_REFRESH_ATTRIBUTE, "true");
      node.setAttribute("http-equiv", "x-html-canvas-disabled-refresh");
    }
  });

  if (baseUrl && !parsed.head.querySelector("base")) {
    const base = parsed.createElement("base");
    base.href = baseUrl;
    base.setAttribute(INJECTED_BASE_ATTRIBUTE, "true");
    parsed.head.prepend(base);
  }

  return `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`;
}

function prepareVerifiedFrameDocument(
  source: string,
  verificationToken: string,
  baseUrl?: string,
): string {
  const sanitized = sanitizeDocument(source, baseUrl);
  if (typeof DOMParser === "undefined") return sanitized;
  const parsed = new DOMParser().parseFromString(sanitized, "text/html");
  parsed.head.querySelectorAll(`style[${EDITOR_STYLE_ATTRIBUTE}]`).forEach((node) => node.remove());
  const editorStyle = parsed.createElement("style");
  editorStyle.setAttribute(EDITOR_STYLE_ATTRIBUTE, "true");
  editorStyle.textContent = EDITOR_DOCUMENT_STYLES;
  parsed.head.prepend(editorStyle);
  const marker = parsed.createElement("meta");
  marker.setAttribute(FRAME_VERIFICATION_ATTRIBUTE, verificationToken);
  marker.setAttribute("content", verificationToken);
  parsed.head.prepend(marker);
  return `${doctypeString(parsed.doctype)}\n${parsed.documentElement.outerHTML}`;
}

function baseHrefFromSourcePath(sourcePath?: string): string | undefined {
  if (!sourcePath) return undefined;
  const trimmedPath = sourcePath.trim();
  if (!trimmedPath) return undefined;

  try {
    if (/^[a-z][a-z\d+.-]*:/i.test(trimmedPath)) {
      const sourceUrl = new URL(trimmedPath);
      if (!sourceUrl.pathname.endsWith("/")) {
        sourceUrl.pathname = sourceUrl.pathname.slice(0, sourceUrl.pathname.lastIndexOf("/") + 1);
      }
      sourceUrl.search = "";
      sourceUrl.hash = "";
      return sourceUrl.href;
    }
  } catch {
    return undefined;
  }

  const normalizedPath = trimmedPath.replace(/\\/g, "/");
  if (!normalizedPath.startsWith("/")) return undefined;
  const directoryPath = normalizedPath.endsWith("/")
    ? normalizedPath
    : normalizedPath.slice(0, normalizedPath.lastIndexOf("/") + 1);
  const encodedPath = directoryPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  return `file://${encodedPath}`;
}

function escapeIdentifier(documentNode: Document, value: string): string {
  const cssApi = documentNode.defaultView?.CSS;
  if (cssApi?.escape) return cssApi.escape(value);
  return value.replace(/(^-?\d)|[^a-zA-Z0-9_-]/g, (match, leadingDigit: string | undefined) => {
    if (leadingDigit) return `\\3${leadingDigit} `;
    return `\\${match}`;
  });
}

function isUniqueSelector(documentNode: Document, selector: string): boolean {
  try {
    return documentNode.querySelectorAll(selector).length === 1;
  } catch {
    return false;
  }
}

function selectorForElement(element: HTMLElement): string {
  const documentNode = element.ownerDocument;
  if (element === documentNode.body) return "body";
  if (element === documentNode.documentElement) return "html";

  if (element.id) {
    const idSelector = `#${escapeIdentifier(documentNode, element.id)}`;
    if (isUniqueSelector(documentNode, idSelector)) return idSelector;
  }

  for (const attributeName of ["data-ai-id", "data-testid", "data-section"]) {
    const value = element.getAttribute(attributeName);
    if (!value) continue;
    const escapedValue = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    const attributeSelector = `[${attributeName}="${escapedValue}"]`;
    if (isUniqueSelector(documentNode, attributeSelector)) return attributeSelector;
  }

  const parts: string[] = [];
  let current: HTMLElement | null = element;

  while (current && current !== documentNode.body) {
    const tagName = current.tagName.toLowerCase();
    const classSelector = Array.from(current.classList)
      .filter((className) => !className.startsWith("html-canvas-"))
      .slice(0, 2)
      .map((className) => `.${escapeIdentifier(documentNode, className)}`)
      .join("");
    let part = `${tagName}${classSelector}`;

    const sameTagSiblings = current.parentElement
      ? Array.from(current.parentElement.children).filter((sibling) => sibling.tagName === current?.tagName)
      : [];
    if (sameTagSiblings.length > 1) {
      part += `:nth-of-type(${sameTagSiblings.indexOf(current) + 1})`;
    }
    parts.unshift(part);

    const candidate = parts.join(" > ");
    if (isUniqueSelector(documentNode, candidate)) return candidate;
    current = current.parentElement;
  }

  return `body > ${parts.join(" > ")}`;
}

function splitSelectorList(selectorText: string): string[] {
  const selectors: string[] = [];
  let current = "";
  let bracketDepth = 0;
  let parenthesisDepth = 0;
  let quote: "'" | '"' | null = null;
  for (const character of selectorText) {
    if (quote) {
      current += character;
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    if (character === "[") bracketDepth += 1;
    if (character === "]") bracketDepth = Math.max(0, bracketDepth - 1);
    if (character === "(") parenthesisDepth += 1;
    if (character === ")") parenthesisDepth = Math.max(0, parenthesisDepth - 1);
    if (character === "," && bracketDepth === 0 && parenthesisDepth === 0) {
      if (current.trim()) selectors.push(current.trim());
      current = "";
      continue;
    }
    current += character;
  }
  if (current.trim()) selectors.push(current.trim());
  return selectors;
}

function selectorSpecificity(selector: string): [number, number, number, number] {
  const withoutWhere = selector.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, "");
  const idCount = withoutWhere.match(/#[\w-]+/g)?.length ?? 0;
  const classCount = (
    withoutWhere.match(/\.[\w-]+/g)?.length ?? 0
  ) + (
    withoutWhere.match(/\[[^\]]+\]/g)?.length ?? 0
  ) + (
    withoutWhere.match(/:(?!:)[\w-]+(?:\([^)]*\))?/g)?.length ?? 0
  );
  const pseudoElementCount = withoutWhere.match(/::[\w-]+/g)?.length ?? 0;
  const typeCount = withoutWhere.match(/(?:^|[\s>+~,(])(?:[a-z][\w-]*)(?=[#.:[\s>+~),]|$)/gi)?.length ?? 0;
  return [0, idCount, classCount, typeCount + pseudoElementCount];
}

function compareSpecificity(
  left: [number, number, number, number],
  right: [number, number, number, number],
): number {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function styleSheetSourceLabel(
  documentNode: Document,
  sheet: CSSStyleSheet,
  sheetIndex: number,
): string {
  if (sheet.href) return `<link> ${sheet.href}`;
  const ownerNode = sheet.ownerNode;
  if (ownerNode && "nodeName" in ownerNode && ownerNode.nodeName.toLowerCase() === "style") {
    const styleElements = Array.from(documentNode.querySelectorAll("style"));
    const styleIndex = styleElements.indexOf(ownerNode as HTMLStyleElement);
    return `<style> #${styleIndex >= 0 ? styleIndex + 1 : sheetIndex + 1}`;
  }
  return `样式表 #${sheetIndex + 1}`;
}

function matchingSelector(element: HTMLElement, selectorText: string): string | null {
  const selectors = splitSelectorList(selectorText);
  const matches = selectors.filter((selector) => {
    try {
      return element.matches(selector);
    } catch {
      return false;
    }
  });
  if (matches.length === 0) {
    try {
      return element.matches(selectorText) ? selectorText : null;
    } catch {
      return null;
    }
  }
  return matches.sort((left, right) =>
    compareSpecificity(selectorSpecificity(right), selectorSpecificity(left))
  )[0];
}

function sharedSelectorImpact(documentNode: Document, selectorText: string): number {
  const impactedElements = new Set<Element>();
  for (const selector of splitSelectorList(selectorText)) {
    try {
      documentNode.querySelectorAll(selector).forEach((element) => {
        impactedElements.add(element);
      });
    } catch {
      // A malformed selector must not widen the reported shared impact.
    }
  }
  return impactedElements.size;
}

function activeMediaCondition(view: Window | null, condition: string): boolean {
  if (!condition) return true;
  if (!view) return false;
  try {
    return view.matchMedia(condition).matches;
  } catch {
    return false;
  }
}

function activeSupportsCondition(view: Window | null, condition: string): boolean {
  if (!condition) return true;
  if (!view) return false;
  const css = (view as Window & {
    CSS?: { supports: (conditionText: string) => boolean };
  }).CSS;
  if (!css?.supports) return false;
  try {
    return css.supports(condition);
  } catch {
    return false;
  }
}

function styleDeclarationCandidates(
  element: HTMLElement,
  cssProperty: string,
): StyleDeclarationCandidate[] {
  const documentNode = element.ownerDocument;
  const view = documentNode.defaultView;
  const candidates: StyleDeclarationCandidate[] = [];
  let order = 0;

  const visitRuleList = (
    rules: CSSRuleList,
    source: string,
    inheritedMediaCondition = "",
  ) => {
    for (const rule of Array.from(rules)) {
      order += 1;
      if ("selectorText" in rule && "style" in rule) {
        const styleRule = rule as CSSStyleRule;
        const selector = matchingSelector(element, styleRule.selectorText);
        if (!selector) continue;
        const value = styleRule.style.getPropertyValue(cssProperty).trim();
        if (!value) continue;
        candidates.push({
          value,
          important: styleRule.style.getPropertyPriority(cssProperty) === "important",
          selector,
          source,
          mediaCondition: inheritedMediaCondition,
          sharedImpactCount: sharedSelectorImpact(documentNode, styleRule.selectorText),
          specificity: selectorSpecificity(selector),
          order,
        });
        continue;
      }

      if ("styleSheet" in rule && (rule as CSSImportRule).styleSheet) {
        const importRule = rule as CSSImportRule;
        const importMedia = importRule.media?.mediaText || "";
        if (!activeMediaCondition(view, importMedia)) continue;
        try {
          visitRuleList(
            importRule.styleSheet!.cssRules,
            importRule.href || source,
            [inheritedMediaCondition, importMedia].filter(Boolean).join(" and "),
          );
        } catch {
          // Cross-origin styles may affect the computed result while keeping
          // their rule list intentionally opaque to the renderer.
        }
        continue;
      }

      if ("cssRules" in rule) {
        const groupingRule = rule as CSSGroupingRule & { conditionText?: string };
        const condition = typeof groupingRule.conditionText === "string"
          ? groupingRule.conditionText
          : "";
        if (rule.type === 4 && !activeMediaCondition(view, condition)) continue;
        if (rule.type === 12 && !activeSupportsCondition(view, condition)) continue;
        visitRuleList(
          groupingRule.cssRules,
          source,
          [inheritedMediaCondition, condition].filter(Boolean).join(" and "),
        );
      }
    }
  };

  Array.from(documentNode.styleSheets).forEach((sheet, sheetIndex) => {
    if (sheet.disabled) return;
    const sheetMedia = sheet.media?.mediaText || "";
    if (!activeMediaCondition(view, sheetMedia)) return;
    try {
      visitRuleList(
        sheet.cssRules,
        styleSheetSourceLabel(documentNode, sheet, sheetIndex),
        sheetMedia,
      );
    } catch {
      // A cross-origin sheet is read-only and may not expose cssRules.
    }
  });

  const inlineValue = element.style.getPropertyValue(cssProperty).trim();
  if (inlineValue) {
    candidates.push({
      value: inlineValue,
      important: element.style.getPropertyPriority(cssProperty) === "important",
      selector: "inline style",
      source: "当前元素开始标签的 style 属性",
      mediaCondition: "",
      sharedImpactCount: 1,
      specificity: [1, 0, 0, 0],
      order: Number.MAX_SAFE_INTEGER,
    });
  }

  return candidates;
}

function winningStyleCandidate(
  candidates: StyleDeclarationCandidate[],
): StyleDeclarationCandidate | null {
  return candidates.reduce<StyleDeclarationCandidate | null>((winner, candidate) => {
    if (!winner) return candidate;
    if (winner.important !== candidate.important) {
      return candidate.important ? candidate : winner;
    }
    const specificity = compareSpecificity(candidate.specificity, winner.specificity);
    if (specificity !== 0) return specificity > 0 ? candidate : winner;
    return candidate.order >= winner.order ? candidate : winner;
  }, null);
}

function styleSourceForProperty(
  element: HTMLElement,
  property: EditableStyleProperty,
  cssProperty: string,
  label: string,
): StyleSourceInfo {
  const documentNode = element.ownerDocument;
  const view = documentNode.defaultView;
  const computedValue = view?.getComputedStyle(element).getPropertyValue(cssProperty).trim() || "";
  const winner = winningStyleCandidate(styleDeclarationCandidates(element, cssProperty));
  const variableName = winner?.value.match(/var\(\s*(--[\w-]+)/)?.[1];
  const winnerKeyword = winner?.value.trim().toLowerCase();
  const naturallyInherited = NATURALLY_INHERITED_PROPERTIES.has(cssProperty);
  const explicitlyInherited = winnerKeyword === "inherit"
    || (winnerKeyword === "unset" && naturallyInherited);
  const explicitlyInitial = winnerKeyword === "initial"
    || (winnerKeyword === "unset" && !naturallyInherited);

  if (winner && variableName) {
    return {
      property,
      cssProperty,
      label,
      computedValue,
      kind: "variable",
      selector: winner.selector,
      source: winner.source,
      mediaCondition: winner.mediaCondition || "无",
      sharedImpactCount: winner.sharedImpactCount,
      important: winner.important,
      variableName,
    };
  }

  if (winner && !explicitlyInherited && !explicitlyInitial) {
    return {
      property,
      cssProperty,
      label,
      computedValue,
      kind: winner.selector === "inline style" ? "inline" : "rule",
      selector: winner.selector,
      source: winner.source,
      mediaCondition: winner.mediaCondition || "无",
      sharedImpactCount: winner.sharedImpactCount,
      important: winner.important,
    };
  }

  if (winner && explicitlyInitial) {
    return {
      property,
      cssProperty,
      label,
      computedValue,
      kind: "initial",
      selector: winner.selector,
      source: winner.source,
      mediaCondition: winner.mediaCondition || "无",
      sharedImpactCount: winner.sharedImpactCount,
      important: winner.important,
    };
  }

  const parent = element.parentElement;
  const parentComputedValue = parent && view
    ? view.getComputedStyle(parent).getPropertyValue(cssProperty).trim()
    : "";
  if (
    explicitlyInherited
    || (
      naturallyInherited
      && parent
      && parentComputedValue === computedValue
    )
  ) {
    return {
      property,
      cssProperty,
      label,
      computedValue,
      kind: "inherit",
      selector: winner?.selector || (parent ? selectorForElement(parent) : "父元素"),
      source: winner?.source || "父元素的 computed style",
      mediaCondition: winner?.mediaCondition || "无",
      sharedImpactCount: winner?.sharedImpactCount ?? (parent ? 1 : 0),
      important: winner?.important || false,
    };
  }

  return {
    property,
    cssProperty,
    label,
    computedValue,
    kind: "default",
    selector: "—",
    source: "浏览器默认样式",
    mediaCondition: "无",
    sharedImpactCount: 0,
    important: false,
  };
}

function styleSourcesForElement(element: HTMLElement): StyleSourceInfo[] {
  return STYLE_PROPERTY_CONFIGS.map(({ property, cssProperty, label }) =>
    styleSourceForProperty(element, property, cssProperty, label)
  );
}

function visibleText(element: HTMLElement): string {
  const value = (element.innerText || element.textContent || "").replace(/\s+/g, " ").trim();
  return value.length > 42 ? `${value.slice(0, 42)}…` : value;
}

function readableLabel(element: HTMLElement): string {
  const tagName = element.tagName.toLowerCase();
  const typeLabel: Record<string, string> = {
    a: "链接",
    article: "文章模块",
    aside: "侧边模块",
    blockquote: "引用",
    button: "按钮",
    footer: "页脚",
    form: "表单",
    h1: "一级标题",
    h2: "二级标题",
    h3: "三级标题",
    h4: "标题",
    header: "页头模块",
    img: "图片",
    li: "列表项",
    main: "主内容",
    nav: "导航模块",
    p: "正文",
    section: "内容模块",
    table: "表格",
    ul: "列表",
    ol: "列表",
  };
  const label =
    element.getAttribute("aria-label") ||
    element.getAttribute("alt") ||
    element.getAttribute("title") ||
    visibleText(element);
  const prefix = typeLabel[tagName] || tagName.toUpperCase();
  return label ? `${prefix} · ${label}` : prefix;
}

function inferSelectionLevel(element: HTMLElement): HtmlCanvasSelectionLevel {
  const explicitLevel = element.getAttribute("data-ai-level");
  if (explicitLevel === "module" || explicitLevel === "part") return explicitLevel;

  const moduleTags = new Set(["ARTICLE", "ASIDE", "FOOTER", "HEADER", "MAIN", "NAV", "SECTION"]);
  const identity = `${element.id} ${element.className}`.toLowerCase();
  const hasModuleIdentity = /(^|[\s_-])(module|section|panel|card|block|container)([\s_-]|$)/.test(identity);
  const directBodyBlock = element.parentElement === element.ownerDocument.body &&
    !["A", "BUTTON", "H1", "H2", "H3", "H4", "H5", "H6", "IMG", "P", "SPAN"].includes(element.tagName);
  return moduleTags.has(element.tagName) || hasModuleIdentity || directBodyBlock ? "module" : "part";
}

function defaultGlobalCommentElement(documentNode: Document): HTMLElement | null {
  return documentNode.body;
}

function isPageRootElement(element: Element | null): element is HTMLElement {
  return Boolean(
    element
    && (
      element === element.ownerDocument.body
      || element === element.ownerDocument.documentElement
    ),
  );
}

function isPageRootSelection(selection: HtmlCanvasSelection | null): boolean {
  return Boolean(
    selection
    && selection.level === "module"
    && (selection.tagName === "body" || selection.tagName === "html"),
  );
}

function sourceMoveAvailability(
  sourceIndex: SourceIndexValue | null,
  selection: HtmlCanvasSelection | null,
): MoveAvailability {
  if (
    !sourceIndex
    || !selection
    || selection.level === "insertion"
    || selection.resolution === "ambiguous"
    || selection.resolution === "orphaned"
  ) {
    return { up: false, down: false };
  }
  try {
    const resolution = resolveTargetRef(
      sourceIndex,
      sourceTargetRefForSelection(selection),
    );
    const element = resolution.target;
    if (!element || element.type !== "element") return { up: false, down: false };
    const parent = element.parentId ? sourceIndex.byNodeId.get(element.parentId) : null;
    if (
      parent?.type !== "element"
      || ["body", "html"].includes(element.tagName)
      || ["html", "head"].includes(parent.tagName)
    ) {
      return { up: false, down: false };
    }
    const previous = element.previousElementSiblingId
      ? sourceIndex.byNodeId.get(element.previousElementSiblingId)
      : null;
    const next = element.nextElementSiblingId
      ? sourceIndex.byNodeId.get(element.nextElementSiblingId)
      : null;
    return {
      up: previous?.type === "element",
      down: next?.type === "element",
    };
  } catch {
    return { up: false, down: false };
  }
}

function uniqueSelections(
  targets: readonly HtmlCanvasSelection[],
): HtmlCanvasSelection[] {
  const byTargetId = new Map<string, HtmlCanvasSelection>();
  for (const target of targets) {
    if (target.id && !byTargetId.has(target.id)) byTargetId.set(target.id, target);
  }
  return [...byTargetId.values()];
}

function trackedSourceTargetRefs(
  targets: readonly HtmlCanvasSelection[],
  operationTargetRefs: readonly SourceTargetRef[],
): SourceTargetRef[] {
  const operationTargetIds = new Set(
    operationTargetRefs.map((target) => target.targetId),
  );
  return uniqueSelections(targets).flatMap((target) => {
    if (
      operationTargetIds.has(target.id)
      || target.resolution === "ambiguous"
      || target.resolution === "orphaned"
    ) return [];
    return [sourceTargetRefForSelection(target)];
  });
}

function selectionFromRefreshedTarget(
  original: HtmlCanvasSelection,
  targetRef: SourceTargetRef,
  nodeId?: string,
): HtmlCanvasSelection {
  return {
    id: targetRef.targetId,
    ...(nodeId ? { nodeId } : {}),
    label: targetRef.label,
    selector: targetRef.selector || "",
    level: original.level,
    tagName: targetRef.level === "insertion-point"
      ? "insertion"
      : targetRef.fingerprint?.tagName || original.tagName,
    text: targetRef.textQuote || "",
    resolution: targetRef.resolution,
    ...(targetRef.textQuote !== undefined ? { textQuote: targetRef.textQuote } : {}),
    ...(targetRef.sourceAnchor ? { sourceAnchor: targetRef.sourceAnchor } : {}),
    ...(targetRef.fingerprint ? { fingerprint: targetRef.fingerprint } : {}),
  };
}

function deterministicTargetUpdates(
  result: ReturnType<typeof applyPatchPlan>,
  originalTargets: readonly HtmlCanvasSelection[],
): HtmlCanvasSelection[] {
  const originals = new Map(
    uniqueSelections(originalTargets).map((target) => [target.id, target]),
  );
  const afterNodeIds = new Map(
    result.targetMappings.map((mapping) => [
      mapping.targetId,
      mapping.afterNodeId || undefined,
    ]),
  );
  const refreshedTargetRefs = [
    ...result.refreshedTargetRefs,
    ...result.refreshedTrackedTargetRefs,
  ] as SourceTargetRef[];
  return refreshedTargetRefs.flatMap((targetRef: SourceTargetRef) => {
    const original = originals.get(targetRef.targetId);
    if (!original) return [];
    return [
      selectionFromRefreshedTarget(
        original,
        targetRef as SourceTargetRef,
        afterNodeIds.get(targetRef.targetId),
      ),
    ];
  });
}

function selectionForElement(
  element: HTMLElement,
  sourceIndex?: SourceIndexValue | null,
  identityTarget?: HtmlCanvasSelection | null,
  resolutionOverride?: HtmlCanvasTargetResolution,
  levelOverride?: HtmlCanvasSelectionLevel,
): HtmlCanvasSelection {
  const selector = selectorForElement(element);
  const level = levelOverride ?? identityTarget?.level ?? inferSelectionLevel(element);
  const nodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE) || undefined;
  let targetRef: SourceTargetRef | null = null;
  if (sourceIndex && nodeId) {
    try {
      targetRef = createTargetRef(sourceIndex, nodeId, {
        level: targetLevelForSelection(level),
        ...(identityTarget?.id ? { targetId: identityTarget.id } : {}),
        ...(identityTarget?.label ? { label: identityTarget.label } : {}),
      }) as SourceTargetRef;
    } catch {
      targetRef = null;
    }
  }
  const rect = element.getBoundingClientRect();
  const view = element.ownerDocument.defaultView;
  return {
    id: targetRef?.targetId || nodeId || element.getAttribute("data-ai-id") || element.id || selector,
    ...(nodeId ? { nodeId } : {}),
    label: level === "module" && isPageRootElement(element)
      ? "整个页面"
      : readableLabel(element),
    selector: targetRef?.selector || selector,
    level,
    tagName: element.tagName.toLowerCase(),
    text: visibleText(element),
    resolution: resolutionOverride || (targetRef ? "exact" : "orphaned"),
    ...(targetRef?.textQuote ? { textQuote: targetRef.textQuote } : {}),
    ...(targetRef?.sourceAnchor ? { sourceAnchor: targetRef.sourceAnchor } : {}),
    ...(targetRef?.fingerprint ? { fingerprint: targetRef.fingerprint } : {}),
    boundingBox: {
      x: Math.round((rect.left + (view?.scrollX || 0)) * 100) / 100,
      y: Math.round((rect.top + (view?.scrollY || 0)) * 100) / 100,
      width: Math.round(rect.width * 100) / 100,
      height: Math.round(rect.height * 100) / 100,
    },
  };
}

function sourceTextNodeForDomText(
  textNode: Text,
  sourceIndex: SourceIndexValue,
): { nodeId: string; value: string } | null {
  const parentElement = textNode.parentElement;
  const parentNodeId = parentElement?.getAttribute(SOURCE_NODE_ATTRIBUTE);
  if (!parentElement || !parentNodeId) return null;
  const sourceParent = sourceIndex.byNodeId.get(parentNodeId);
  if (!sourceParent || sourceParent.type !== "element") return null;
  const childIndex = Array.from(parentElement.childNodes).indexOf(textNode);
  const sourceChildId = sourceParent.childIds?.[childIndex];
  const sourceText = sourceChildId ? sourceIndex.byNodeId.get(sourceChildId) : null;
  if (
    !sourceText
    || sourceText.type !== "text"
    || sourceText.value !== textNode.data
  ) return null;
  return { nodeId: sourceText.nodeId, value: sourceText.value };
}

function activeTextRangeFromDocument(
  documentNode: Document,
  sourceIndex: SourceIndexValue | null,
): ActiveTextRange | null {
  const domSelection = documentNode.getSelection();
  if (!sourceIndex || !domSelection || domSelection.rangeCount !== 1 || domSelection.isCollapsed) {
    return null;
  }
  const range = domSelection.getRangeAt(0);
  const commonNode = range.commonAncestorContainer;
  const commonElement = commonNode.nodeType === 1
    ? commonNode as HTMLElement
    : commonNode.parentElement;
  const targetElement = commonElement?.closest<HTMLElement>(`[${SOURCE_NODE_ATTRIBUTE}]`) ?? null;
  if (
    !targetElement
    || ["BODY", "HTML", "HEAD", "SCRIPT", "STYLE", "NOSCRIPT"].includes(targetElement.tagName)
  ) return null;

  const showText = documentNode.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = documentNode.createTreeWalker(targetElement, showText);
  const segments: TextRangeSegment[] = [];
  const styleElements: HTMLElement[] = [];
  let currentNode = walker.nextNode();
  while (currentNode) {
    const textNode = currentNode as Text;
    let intersects = false;
    try {
      intersects = range.intersectsNode(textNode);
    } catch {
      return null;
    }
    if (intersects) {
      const startOffset = range.startContainer === textNode ? range.startOffset : 0;
      const endOffset = range.endContainer === textNode ? range.endOffset : textNode.data.length;
      if (endOffset > startOffset) {
        const sourceText = sourceTextNodeForDomText(textNode, sourceIndex);
        if (!sourceText || endOffset > sourceText.value.length) return null;
        segments.push({
          textNodeId: sourceText.nodeId,
          startOffset,
          endOffset,
        });
        const textParent = textNode.parentElement;
        if (textParent && !styleElements.includes(textParent)) styleElements.push(textParent);
      }
    }
    currentNode = walker.nextNode();
  }
  if (segments.length === 0 || styleElements.length === 0) return null;
  let direction: ActiveTextRange["direction"] = "forward";
  if (domSelection.anchorNode && domSelection.focusNode) {
    try {
      const anchorRange = documentNode.createRange();
      anchorRange.setStart(domSelection.anchorNode, domSelection.anchorOffset);
      anchorRange.collapse(true);
      const focusRange = documentNode.createRange();
      focusRange.setStart(domSelection.focusNode, domSelection.focusOffset);
      focusRange.collapse(true);
      direction = anchorRange.compareBoundaryPoints(0, focusRange) <= 0
        ? "forward"
        : "backward";
    } catch {
      direction = "forward";
    }
  }
  return {
    target: selectionForElement(targetElement, sourceIndex, undefined, undefined, "part"),
    segments,
    text: range.toString(),
    styleElements,
    direction,
  };
}

function escapedSourceNodeId(nodeId: string): string {
  return nodeId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function isCanonicalSourceElement(
  element: HTMLElement,
  sourceIndex: SourceIndexValue,
): boolean {
  const nodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE);
  const sourceElement = nodeId ? sourceIndex.byNodeId.get(nodeId) : null;
  if (!nodeId || sourceElement?.type !== "element") return false;
  const matches = element.ownerDocument.querySelectorAll(
    `[${SOURCE_NODE_ATTRIBUTE}="${escapedSourceNodeId(nodeId)}"]`,
  );
  if (matches.length !== 1 || matches[0] !== element) return false;
  const domParent = element.parentElement?.closest<HTMLElement>(
    `[${SOURCE_NODE_ATTRIBUTE}]`,
  ) ?? null;
  const domParentId = domParent?.getAttribute(SOURCE_NODE_ATTRIBUTE) ?? null;
  return domParentId === sourceElement.parentId;
}

function nativeEditHostForElement(
  element: HTMLElement,
  sourceIndex: SourceIndexValue,
): HTMLElement | null {
  let candidate = element.closest<HTMLElement>(`[${SOURCE_NODE_ATTRIBUTE}]`);
  while (candidate) {
    if (!isCanonicalSourceElement(candidate, sourceIndex)) return null;
    const computedDisplay = candidate.ownerDocument.defaultView
      ?.getComputedStyle(candidate).display.toLowerCase() ?? "";
    const tagName = candidate.tagName.toLowerCase();
    // Inline semantic tags normally join their surrounding sentence. Once an
    // author turns one into its own rendered box (for example a block metric
    // implemented with <strong>), it is the text host itself rather than a
    // reason to climb into a much larger, non-text parent such as <article>.
    const standaloneTransparentBox = (
      computedDisplay !== "inline"
      && computedDisplay !== "contents"
    );
    if (!isTransparentSourceTextElement(tagName) || standaloneTransparentBox) break;
    candidate = candidate.parentElement?.closest<HTMLElement>(
      `[${SOURCE_NODE_ATTRIBUTE}]`,
    ) ?? null;
  }
  if (!candidate) return null;
  const nodeId = candidate.getAttribute(SOURCE_NODE_ATTRIBUTE);
  if (!nodeId) return null;
  return sourceIndex.byNodeId.get(nodeId)?.type === "element" ? candidate : null;
}

function sourceTextParentsForSegments(
  rootElement: HTMLElement,
  segments: readonly TextRangeSegment[],
  sourceIndex: SourceIndexValue,
): HTMLElement[] | null {
  const wantedIds = new Set(segments.map((segment) => segment.textNodeId));
  const parentsByTextId = new Map<string, HTMLElement>();
  const documentNode = rootElement.ownerDocument;
  const showText = documentNode.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = documentNode.createTreeWalker(rootElement, showText);
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const sourceText = sourceTextNodeForDomText(textNode, sourceIndex);
    if (sourceText && wantedIds.has(sourceText.nodeId) && textNode.parentElement) {
      parentsByTextId.set(sourceText.nodeId, textNode.parentElement);
    }
    current = walker.nextNode();
  }
  if ([...wantedIds].some((nodeId) => !parentsByTextId.has(nodeId))) return null;
  return [...new Set(
    segments.map((segment) => parentsByTextId.get(segment.textNodeId)!),
  )];
}

function sourceBackedPreviewElements(documentNode: Document): Element[] {
  const elements: Element[] = [];
  const visit = (element: Element) => {
    if (element.hasAttribute(SOURCE_NODE_ATTRIBUTE)) elements.push(element);
    const childElements = element.tagName === "TEMPLATE"
      ? Array.from((element as HTMLTemplateElement).content.children)
      : Array.from(element.children);
    childElements.forEach(visit);
  };
  if (documentNode.documentElement) visit(documentNode.documentElement);
  return elements;
}

const NATIVE_PREVIEW_MANAGED_ATTRIBUTES = new Set([
  SOURCE_NODE_ATTRIBUTE,
  "aria-label",
  "aria-multiline",
  "autocapitalize",
  "autocomplete",
  "contenteditable",
  "data-gramm",
  "data-html-canvas-editing",
  "data-html-canvas-global-selected",
  "data-html-canvas-native-editing",
  "data-html-canvas-selected",
  "role",
  "spellcheck",
  "tabindex",
]);

type NativePreviewOwnershipNode =
  | { kind: "text"; value: string }
  | { kind: "comment"; value: string }
  | {
      kind: "element";
      namespaceURI: string | null;
      localName: string;
      sourceBacked: boolean;
      attributes: string[];
      logicalText: string;
      children: NativePreviewOwnershipNode[];
    };

function nativePreviewOwnershipNode(node: Node): NativePreviewOwnershipNode | null {
  if (node.nodeType === Node.TEXT_NODE) {
    const value = (node as Text).data;
    return value ? { kind: "text", value } : null;
  }
  if (node.nodeType === Node.COMMENT_NODE) {
    return { kind: "comment", value: node.nodeValue ?? "" };
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const element = node as Element;
  const children: NativePreviewOwnershipNode[] = [];
  for (const childNode of Array.from(element.childNodes)) {
    const child = nativePreviewOwnershipNode(childNode);
    if (!child) continue;
    const previous = children.at(-1);
    if (child.kind === "text" && previous?.kind === "text") {
      previous.value += child.value;
    } else {
      children.push(child);
    }
  }
  const attributes = Array.from(element.attributes)
    .filter((attribute) => !NATIVE_PREVIEW_MANAGED_ATTRIBUTES.has(attribute.name))
    .map((attribute) => JSON.stringify([
      attribute.namespaceURI,
      attribute.name,
      attribute.value,
    ]))
    .sort();
  return {
    kind: "element",
    namespaceURI: element.namespaceURI,
    localName: element.localName,
    sourceBacked: element.hasAttribute(SOURCE_NODE_ATTRIBUTE),
    attributes,
    logicalText: nativeLogicalText(element as HTMLElement),
    children,
  };
}

function nativePreviewOwnershipMatches(
  liveRoot: HTMLElement,
  canonicalRoot: HTMLElement,
): boolean {
  return JSON.stringify(nativePreviewOwnershipNode(liveRoot))
    === JSON.stringify(nativePreviewOwnershipNode(canonicalRoot));
}

function canonicalNativeHostPreview(
  rootElement: HTMLElement,
  nextNodeId: string,
  nextIndex: SourceIndexValue,
): HTMLElement | null {
  const view = rootElement.ownerDocument.defaultView;
  if (!view) return null;
  const instrumented = instrumentPreviewHtml(nextIndex, {
    attributeName: SOURCE_NODE_ATTRIBUTE,
  }).html;
  const detachedDocument = new view.DOMParser().parseFromString(
    disableExecutableMarkup(instrumented),
    "text/html",
  );
  const detachedTarget = detachedDocument.querySelector<HTMLElement>(
    `[${SOURCE_NODE_ATTRIBUTE}="${escapedSourceNodeId(nextNodeId)}"]`,
  );
  return detachedTarget?.tagName === rootElement.tagName ? detachedTarget : null;
}

type PreviewSourceNodeIdPlan = {
  apply: () => void;
  rollback: () => void;
};

function planMountedPreviewSourceNodeIds(
  documentNode: Document,
  previousIndex: SourceIndexValue,
  nextIndex: SourceIndexValue,
  options: {
    excludeRoot?: HTMLElement;
  } = {},
): PreviewSourceNodeIdPlan | null {
  const previousRoots = (previousIndex.elements as SourceElementValue[]).filter((element) => {
    const parent = element.parentId
      ? previousIndex.byNodeId.get(element.parentId)
      : null;
    return !parent || parent.type !== "element";
  });
  const nextRoots = (nextIndex.elements as SourceElementValue[]).filter((element) => {
    const parent = element.parentId
      ? nextIndex.byNodeId.get(element.parentId)
      : null;
    return !parent || parent.type !== "element";
  });
  if (previousRoots.length !== nextRoots.length) return null;
  const excludedNodeId = options.excludeRoot?.getAttribute(SOURCE_NODE_ATTRIBUTE) ?? null;
  const nextNodeIdByPreviousNodeId = new Map<string, string>();
  const pairSubtrees = (
    previousElement: SourceElementValue,
    nextElement: SourceElementValue,
  ): boolean => {
    if (previousElement.tagName !== nextElement.tagName) return false;
    nextNodeIdByPreviousNodeId.set(previousElement.nodeId, nextElement.nodeId);
    if (previousElement.nodeId === excludedNodeId) return true;
    if (previousElement.childElementIds.length !== nextElement.childElementIds.length) {
      return false;
    }
    for (let index = 0; index < previousElement.childElementIds.length; index += 1) {
      const previousChild = previousIndex.byNodeId.get(
        previousElement.childElementIds[index],
      );
      const nextChild = nextIndex.byNodeId.get(nextElement.childElementIds[index]);
      if (
        !previousChild
        || previousChild.type !== "element"
        || !nextChild
        || nextChild.type !== "element"
        || !pairSubtrees(previousChild, nextChild)
      ) return false;
    }
    return true;
  };
  for (let index = 0; index < previousRoots.length; index += 1) {
    if (!pairSubtrees(previousRoots[index], nextRoots[index])) return null;
  }

  const liveNodes = sourceBackedPreviewElements(documentNode).filter((node) => (
    !options.excludeRoot
    || (
      node !== options.excludeRoot
      && !options.excludeRoot.contains(node)
    )
  ));
  const updates: Array<{ node: Element; nextNodeId: string }> = [];
  for (const node of liveNodes) {
    const previousNodeId = node.getAttribute(SOURCE_NODE_ATTRIBUTE);
    const nextNodeId = previousNodeId
      ? nextNodeIdByPreviousNodeId.get(previousNodeId)
      : null;
    const nextElement = nextNodeId ? nextIndex.byNodeId.get(nextNodeId) : null;
    if (
      !nextElement
      || node.tagName.toLowerCase() !== nextElement.tagName
    ) return null;
    updates.push({ node, nextNodeId: nextElement.nodeId });
  }
  const previousValues = updates.map(({ node }) => ({
    node,
    present: node.hasAttribute(SOURCE_NODE_ATTRIBUTE),
    value: node.getAttribute(SOURCE_NODE_ATTRIBUTE),
  }));
  const rollback = () => {
    for (let index = previousValues.length - 1; index >= 0; index -= 1) {
      const previous = previousValues[index];
      if (previous.present && previous.value !== null) {
        previous.node.setAttribute(SOURCE_NODE_ATTRIBUTE, previous.value);
      } else {
        previous.node.removeAttribute(SOURCE_NODE_ATTRIBUTE);
      }
    }
  };
  return {
    apply: () => {
      try {
        updates.forEach(({ node, nextNodeId }) => {
          node.setAttribute(SOURCE_NODE_ATTRIBUTE, nextNodeId);
        });
      } catch (cause) {
        rollback();
        throw cause;
      }
    },
    rollback,
  };
}

function refreshMountedPreviewSourceNodeIds(
  documentNode: Document,
  previousIndex: SourceIndexValue,
  nextIndex: SourceIndexValue,
  options: {
    session?: NativeEditingController;
    excludeRoot?: HTMLElement;
  } = {},
): boolean {
  const plan = planMountedPreviewSourceNodeIds(
    documentNode,
    previousIndex,
    nextIndex,
    { excludeRoot: options.excludeRoot },
  );
  if (!plan) return false;
  if (options.session) {
    return options.session.runExpectedMutation(() => {
      plan.apply();
      return true;
    }) === true;
  }
  plan.apply();
  return true;
}

type TextCaretPoint = {
  clientX: number;
  clientY: number;
};

function caretPointFromMouseEvent(event: MouseEvent): TextCaretPoint {
  // clientX/clientY are already in the same viewport coordinate system as
  // Range.getClientRects(). MouseEvent.offsetX/offsetY are not reliable for
  // inline descendants such as <pre><code>: Chromium can report them relative
  // to a different padding/offset parent and make a real glyph click look like
  // empty space.
  return {
    clientX: event.clientX,
    clientY: event.clientY,
  };
}

function wordBoundsAtOffset(text: string, requestedOffset: number): {
  startOffset: number;
  endOffset: number;
} | null {
  if (!text || !text.trim()) return null;
  const offset = Math.max(0, Math.min(text.length, requestedOffset));
  if (typeof Intl.Segmenter === "function") {
    const segments = new Intl.Segmenter(undefined, { granularity: "word" }).segment(text);
    let nearest: { startOffset: number; endOffset: number; distance: number } | null = null;
    for (const segment of segments) {
      if (!segment.segment.trim()) continue;
      const startOffset = segment.index;
      const endOffset = segment.index + segment.segment.length;
      if (offset >= startOffset && offset <= endOffset) return { startOffset, endOffset };
      const distance = Math.min(
        Math.abs(offset - startOffset),
        Math.abs(offset - endOffset),
      );
      if (!nearest || distance < nearest.distance) {
        nearest = { startOffset, endOffset, distance };
      }
    }
    if (nearest) return nearest;
  }

  let characterOffset = Math.min(offset, text.length - 1);
  while (characterOffset > 0 && /\s/u.test(text[characterOffset])) characterOffset -= 1;
  if (/\p{Script=Han}/u.test(text[characterOffset])) {
    return { startOffset: characterOffset, endOffset: characterOffset + 1 };
  }
  const isWordCharacter = (character: string) => /[\p{L}\p{N}_-]/u.test(character);
  let startOffset = characterOffset;
  let endOffset = characterOffset + 1;
  while (startOffset > 0 && isWordCharacter(text[startOffset - 1])) startOffset -= 1;
  while (endOffset < text.length && isWordCharacter(text[endOffset])) endOffset += 1;
  return { startOffset, endOffset };
}

function selectWordAtPoint(
  documentNode: Document,
  target: HTMLElement,
  point: TextCaretPoint,
): Range | null {
  const caretPosition = documentNode.caretPositionFromPoint?.(point.clientX, point.clientY);
  const caretRange = !caretPosition
    ? documentNode.caretRangeFromPoint?.(point.clientX, point.clientY)
    : null;
  const pointNode = caretPosition?.offsetNode || caretRange?.startContainer;
  const pointOffset = caretPosition?.offset ?? caretRange?.startOffset;
  const textNode = pointNode?.nodeType === 3 ? pointNode as Text : null;
  const textOffset = typeof pointOffset === "number" ? pointOffset : 0;
  // caretPositionFromPoint may return the nearest text when the pointer is on
  // an inert iframe/canvas or on empty layout space. Never turn that proximity
  // guess into an edit target: the point must lie on the chosen text glyphs.
  if (!textNode || !target.contains(textNode) || !textNode.data.trim()) return null;
  if (!textNode) return null;
  const bounds = wordBoundsAtOffset(textNode.data, textOffset);
  if (!bounds) return null;
  const range = documentNode.createRange();
  range.setStart(textNode, bounds.startOffset);
  range.setEnd(textNode, bounds.endOffset);
  if (!nativeTextRangeContainsPoint(range, point)) return null;
  const selection = documentNode.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
  return range;
}

function nativeTextRangeContainsPoint(
  range: Range,
  point: TextCaretPoint,
): boolean {
  if (
    range.collapsed
    || !range.startContainer.isConnected
    || !range.endContainer.isConnected
  ) return false;
  const tolerance = 2;
  return Array.from(range.getClientRects()).some((rect) => (
    rect.width > 0
    && rect.height > 0
    && point.clientX >= rect.left - tolerance
    && point.clientX <= rect.right + tolerance
    && point.clientY >= rect.top - tolerance
    && point.clientY <= rect.bottom + tolerance
  ));
}

function nativeTextRangeMatchesActivation(
  range: Range,
  target: HTMLElement,
  point: TextCaretPoint,
): boolean {
  return target.contains(range.startContainer)
    && target.contains(range.endContainer)
    && nativeTextRangeContainsPoint(range, point);
}

function toHexColor(value: string, fallback: string): string {
  if (/^#[0-9a-f]{6}$/i.test(value)) return value.toLowerCase();
  const channels = value.match(/[\d.]+/g)?.slice(0, 4).map(Number);
  if (!channels || channels.length < 3 || (channels.length === 4 && channels[3] === 0)) return fallback;
  return `#${channels
    .slice(0, 3)
    .map((channel) => Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0"))
    .join("")}`;
}

function findSelectableElement(target: EventTarget | null): HTMLElement | null {
  if (!target || typeof target !== "object" || !("nodeType" in target) || target.nodeType !== 1) return null;
  const element = target as HTMLElement;
  if (["HTML", "BODY", "HEAD", "SCRIPT", "STYLE"].includes(element.tagName)) return null;
  if (element.namespaceURI === "http://www.w3.org/2000/svg") {
    return element.closest("svg") as unknown as HTMLElement | null;
  }
  if (element.namespaceURI === "http://www.w3.org/1998/Math/MathML") {
    return element.closest("math") as unknown as HTMLElement | null;
  }
  return element;
}

const MEDIA_SURFACE_SELECTOR = "iframe, audio, video, canvas, object, embed";

function findCanvasSelectionElement(target: EventTarget | null): HTMLElement | null {
  const element = findSelectableElement(target);
  if (!element) return null;
  const ownsMediaSurface = element.matches(MEDIA_SURFACE_SELECTOR)
    || Boolean(element.querySelector(MEDIA_SURFACE_SELECTOR));
  if (!ownsMediaSurface) return element;
  let candidate: HTMLElement | null = element;
  while (candidate && candidate !== candidate.ownerDocument.body) {
    if (
      candidate.hasAttribute(SOURCE_NODE_ATTRIBUTE)
      && inferSelectionLevel(candidate) === "module"
    ) return candidate;
    candidate = candidate.parentElement;
  }
  return element;
}

function findNativeActionTarget(target: EventTarget | null): HTMLElement | null {
  const element = findSelectableElement(target);
  return element?.closest<HTMLElement>(
    "a[href], area[href], button, form, input, select, textarea",
  ) ?? null;
}

function isCanvasRootElement(target: EventTarget | null): boolean {
  return Boolean(
    target
    && typeof target === "object"
    && "nodeType" in target
    && target.nodeType === 1
    && ["HTML", "BODY"].includes((target as HTMLElement).tagName),
  );
}

const HtmlCanvasEditor = forwardRef<HtmlCanvasEditorHandle, HtmlCanvasEditorProps>(function HtmlCanvasEditor(
  {
    html,
    onChange,
    onSelect,
    onInteraction,
    onRequestComment,
    onReady,
    onRequestFlush,
    onEditBlocked,
    baseHref,
    sourcePath,
    className,
    iframeTitle = "HTML 可视化编辑画布",
    height = 720,
    readOnly = false,
    interactionMode = "editing",
    locked = false,
    enableReorder = true,
    preserveUndoHistory = false,
    commentedTargets = EMPTY_COMMENTED_TARGETS,
    trackedTargets = EMPTY_TRACKED_TARGETS,
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
    session: NativeEditingController,
  ) => void>(() => undefined);
  const nativeEditCheckpointTimerRef = useRef<number | null>(null);
  const nativeEditCheckpointRef = useRef<() => void>(() => undefined);
  const nativeEditSessionSequenceRef = useRef(0);
  const nativeDomGenerationRef = useRef(0);
  const nativeHistoryDirtyRef = useRef(false);
  const nativeEditFenceSequenceRef = useRef(0);
  const currentNativeEditLeaseRef = useRef<ActiveNativeEdit["lease"] | null>(null);
  const pendingNativeEditResumeRef = useRef<PendingNativeEditResume | null>(null);
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
  const undoRef = useRef<(fromQueuedCommand?: boolean) => boolean>(() => false);
  const redoRef = useRef<(fromQueuedCommand?: boolean) => boolean>(() => false);
  const insertionPointsRef = useRef<InsertionPoint[]>([]);
  const cleanupFrameRef = useRef<() => void>(() => undefined);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);
  const frameInitializedRef = useRef(false);
  const lastEmittedHtmlRef = useRef<string | null>(null);
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
  const historySequenceRef = useRef(0);
  const undoStackRef = useRef<EditorHistoryEntry[]>([]);
  const redoStackRef = useRef<EditorHistoryEntry[]>([]);
  const imperativeLockRef = useRef(false);
  const lastPropRef = useRef({ html, baseHref: resolvedBaseHref });
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  const onInteractionRef = useRef(onInteraction);
  const onRequestCommentRef = useRef(onRequestComment);
  const onRequestFlushRef = useRef(onRequestFlush);
  const onEditBlockedRef = useRef(onEditBlocked);
  const readOnlyRef = useRef(readOnly);
  const lockedRef = useRef(locked);
  const enableReorderRef = useRef(enableReorder);
  const commentedTargetsRef = useRef(commentedTargets);
  const trackedTargetsRef = useRef(trackedTargets);
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
  onRequestCommentRef.current = onRequestComment;
  onRequestFlushRef.current = onRequestFlush;
  onEditBlockedRef.current = onEditBlocked;
  readOnlyRef.current = readOnly || controlledInteractionLocked || imperativeLockRef.current;
  lockedRef.current = controlledInteractionLocked || imperativeLockRef.current;
  enableReorderRef.current = enableReorder && !lockedRef.current;
  commentedTargetsRef.current = commentedTargets;
  trackedTargetsRef.current = trackedTargets;

  // Keep the server and hydration value deterministic, then normalize through DOMParser after mount.
  const [frameRender, setFrameRender] = useState(() => ({
    html: disableExecutableMarkup(html),
    elementGeneration: 0,
  }));
  const [selection, setSelection] = useState<HtmlCanvasSelection | null>(null);
  const [overlayPosition, setOverlayPosition] = useState<OverlayPosition | null>(null);
  const [toolbarVisible, setToolbarVisible] = useState(false);
  const [hasTextRange, setHasTextRange] = useState(false);
  const [hasPendingNativeDraft, setHasPendingNativeDraft] = useState(false);
  const [selectedStyle, setSelectedStyle] = useState<SelectedStyle>({
    fontSize: 16,
    color: "#202124",
    backgroundColor: "#ffffff",
    padding: 0,
    margin: 0,
    lineHeight: 24,
    isBold: false,
    isItalic: false,
    sources: [],
  });
  const [moveAvailability, setMoveAvailability] = useState<MoveAvailability>({ up: false, down: false });
  const [isEditing, setIsEditing] = useState(false);
  const [, setInsertionPoints] = useState<InsertionPoint[]>([]);
  const [commentMarkers, setCommentMarkers] = useState<CommentMarker[]>([]);
  const [, setSelectedInsertionId] = useState<string | null>(null);
  const [editFeedback, setEditFeedback] = useState<EditFeedback | null>(null);
  const [undoDepth, setUndoDepth] = useState(0);
  const [redoDepth, setRedoDepth] = useState(0);
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
      // reach its real save/export/history/style handler so that handler can
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
    if (!editFeedback || editFeedback.sticky) return undefined;
    const timer = window.setTimeout(() => {
      setEditFeedback((current) => current === editFeedback ? null : current);
    }, 8000);
    return () => window.clearTimeout(timer);
  }, [editFeedback]);

  const loadFrameSource = useCallback((
    source: string,
    options: { preserveViewport?: boolean; immediate?: boolean } = {},
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
    pendingFrameRestoreEpochRef.current += 1;
    frameLoadGenerationRef.current += 1;
    nativeDomGenerationRef.current += 1;
    nativeHistoryDirtyRef.current = false;
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
        title: "暂时不能直接编辑这个页面",
        message,
        tone: "error",
        sticky: true,
      });
      onEditBlockedRef.current?.(message);
    }
    const prepared = prepareVerifiedFrameDocument(instrumentedSource, token, resolvedBaseHref);
    frameSourceHtmlRef.current = source;
    expectedFrameTokenRef.current = token;
    expectedFrameHtmlRef.current = prepared;
    renderedSourceHtmlRef.current = null;
    containerRef.current?.setAttribute("data-render-verified", "false");
    const replaceFrameElement = () => {
      setFrameRender((current) => ({
        html: prepared,
        elementGeneration: current.elementGeneration + 1,
      }));
    };
    if (options.immediate) {
      // A History Fence must retire the browsing context itself. Chromium can
      // accept a rapid srcdoc assignment without navigating the existing
      // iframe, which leaves its contenteditable undo manager alive. A keyed
      // remount guarantees a fresh Document and therefore a fresh native edit
      // history before Selection is restored.
      flushSync(replaceFrameElement);
    } else {
      replaceFrameElement();
    }
  }, [resolvedBaseHref]);

  const updateSelectedStyle = useCallback(() => {
    const element = selectedElementRef.current;
    const activeStyleElements = activeTextRangeRef.current?.styleElements.filter(
      (candidate) => candidate.isConnected,
    ) ?? [];
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
    if (!container || !iframe || !documentNode?.body) {
      setOverlayPosition(null);
      setInsertionPoints([]);
      setCommentMarkers([]);
      insertionPointsRef.current = [];
      return;
    }

    if (lockedRef.current) {
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
      const target = rawTarget.target;
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
      nextCommentMarkers.push({
        key: target.id || `${target.selector}:${targetIndex}`,
        selection: selectionForElement(targetElement, sourceIndexRef.current, target),
        count: rawTarget.count,
        label: rawTarget.label,
        left: isGlobalPageTarget
          ? Math.max(18, Math.min(containerRect.width - 28, frameOffsetLeft + 18))
          : Math.max(18, Math.min(containerRect.width - 28, frameOffsetLeft + targetRect.right - 12)),
        top: isGlobalPageTarget
          ? Math.max(18, Math.min(containerRect.height - 18, frameOffsetTop + 18))
          : Math.max(18, Math.min(containerRect.height - 18, frameOffsetTop + targetRect.top - 10)),
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
    // A partial text replacement can live inside mixed inline markup. Reloading
    // the verified preview keeps every sibling element intact instead of
    // flattening the selected parent through textContent.
    if (plan.type === "replace-text-range") return false;
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

  const recordHistoryEntry = useCallback((
    inversePlan: SourcePatchPlan,
    mutation: HtmlCanvasMutation,
  ): HtmlCanvasMutation => {
    if (!mutation.historyId) historySequenceRef.current += 1;
    const recordedMutation: HtmlCanvasMutation = {
      ...mutation,
      historyId: mutation.historyId
        || `history_${Date.now().toString(36)}_${historySequenceRef.current.toString(36)}`,
    };
    undoStackRef.current = [
      ...undoStackRef.current,
      { inversePlan, mutation: recordedMutation },
    ].slice(-MAX_UNDO_ENTRIES);
    redoStackRef.current = [];
    containerRef.current?.setAttribute("data-undo-depth", String(undoStackRef.current.length));
    containerRef.current?.setAttribute("data-redo-depth", "0");
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(0);
    return recordedMutation;
  }, []);

  const reportBlockedEdit = useCallback((cause: unknown) => {
    const rawDetail = cause instanceof Error
      ? cause.message
      : String(cause || "");
    containerRef.current?.setAttribute(
      "data-edit-block-detail",
      rawDetail.slice(0, 240),
    );
    let title = "请重新选择后再试";
    let message = "你可以继续浏览和选择文字，也可以添加评论说明要怎么改。";
    if (/两种样式的边界|文字属于哪一侧|样式内一个字的位置/iu.test(rawDetail)) {
      title = "请把光标移入文字内部";
      message = "这里正好是两种文字样式的边界，直接输入可能跑到错误一侧。请把光标移到样式内一个字的位置后输入，或添加评论。";
    } else if (/空的排版元素|输入可能跑到错误位置/iu.test(rawDetail)) {
      title = "这里暂时不能直接改字";
      message = "这段文字旁有一个空的排版元素，直接输入可能跑到错误位置。你仍可以选中文字，或添加评论交给 AI 处理。";
    } else if (
      /复杂网页结构|暂不支持直接改字|source structure|structural command/iu.test(rawDetail)
    ) {
      title = "这里暂时不能直接改字";
      message = "这段内容里有需要保留的网页结构。你仍可以选中文字，或添加评论交给 AI 处理。";
    } else if (/transform|zoom|多栏|flex|grid|布局|盒子|光标错位|间距变化/iu.test(rawDetail)) {
      title = "这里暂时不能直接改字";
      message = "这段文字的排版比较特殊。你仍可以选中文字调整样式，或添加评论交给 AI 处理。";
    } else if (/多行粘贴/iu.test(rawDetail)) {
      title = "这里暂时不能粘贴多行文字";
      message = "可以粘贴单行文字；如果需要加入多行内容，请添加评论交给 AI 处理。";
    } else if (/换行|新增段落/iu.test(rawDetail)) {
      title = "这里暂时不能新增换行";
      message = "可以继续修改现有文字；如果需要拆分段落，请添加评论交给 AI 处理。";
    } else if (/图片|图标|嵌入组件|结构边界|删除键|退格/iu.test(rawDetail)) {
      title = "这处内容不能这样删除";
      message = "请只修改文字，或添加评论说明要删除的图片、图标或组件。";
    } else if (/输入法|输入事件|输入过程中|浏览器没有完成这次输入|候选/iu.test(rawDetail)) {
      title = "已恢复输入前的文字";
      message = "输入法没有完整确认这次输入。请点回文字后重新输入；如果仍然失败，可以选中文字添加评论。";
    } else if (/源码地图|源码节点|目标|定位|映射|漂移|唯一静态文字/iu.test(rawDetail)) {
      title = "请重新选择这段文字";
      message = "页面内容可能刚刚发生了变化。请再点一次要修改的文字，或添加评论。";
    }
    setEditFeedback({
      title,
      message,
      tone: "warning",
      sticky: false,
    });
    onEditBlockedRef.current?.(message);
  }, []);

  const applySourceCommand = useCallback((
    command: SourcePatchCommand,
    mutation: HtmlCanvasMutation,
    options: {
      recordHistory?: boolean;
      validateResult?: (result: ReturnType<typeof applyPatchPlan>) => void;
      nativeTextCommit?: {
        selection: NativeEditSelection;
        requiresCanonicalReconcile: boolean;
        /** A source-authority fence will retire this session immediately. */
        deferPreviewReconcile?: boolean;
      };
    } = {},
  ): ReturnType<typeof applyPatchPlan> | null => {
    const sourceIndex = sourceIndexRef.current;
    const currentSource = frameSourceHtmlRef.current;
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
      const originalTargets = uniqueSelections([
        mutation.target,
        ...commentedTargetsRef.current.map((entry) => entry.target),
        ...trackedTargetsRef.current,
      ]);
      const trackedTargetRefs = trackedSourceTargetRefs(
        originalTargets,
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
      let appliedMutation: HtmlCanvasMutation = {
        ...mutation,
        target: targetUpdatesById.get(mutation.target.id) || {
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
      if (options.recordHistory !== false) {
        historySequenceRef.current += 1;
        appliedMutation = {
          ...appliedMutation,
          historyId: appliedMutation.historyId
            || `history_${Date.now().toString(36)}_${historySequenceRef.current.toString(36)}`,
        };
      }
      if (!onChangeRef.current(result.html, appliedMutation)) {
        reportBlockedEdit(new Error("宿主状态已锁定，本次画布修改未被接受。"));
        return null;
      }
      if (options.recordHistory !== false) {
        recordHistoryEntry(result.inversePlan, appliedMutation);
        mutation.historyId = appliedMutation.historyId;
      }
      setEditFeedback(null);
      lastEmittedHtmlRef.current = result.html;
      const activeNativeEdit = activeNativeEditRef.current;
      const keepsNativeEditMounted = Boolean(
        activeNativeEdit
        && activeNativeEdit.target.id === mutation.target.id
        && (
          forwardPlan.type === "replace-text-range"
          || forwardPlan.type === "replace-text-flow-range"
          || forwardPlan.type === "delete-hard-break"
          || forwardPlan.type === "set-text-range-style"
        ),
      );
      let previewStayedMounted = false;
      if (activeNativeEdit && keepsNativeEditMounted) {
        containerRef.current?.setAttribute("data-native-commit-path", "attempt");
        sourceIndexRef.current = result.sourceIndex;
        frameSourceHtmlRef.current = result.html;
        let refreshedNativePreview = false;
        const nextTarget = appliedMutation.target;
        if (options.nativeTextCommit?.deferPreviewReconcile) {
          // History/save/export/navigation will synchronously retire this
          // controller after SourcePatch returns. Do not create an interim
          // contenteditable owner only to destroy it in the same command.
          nativeEditNeedsReloadRef.current = true;
          renderedSourceHtmlRef.current = null;
          containerRef.current?.setAttribute(
            "data-native-commit-path",
            "fence-deferred",
          );
        } else if (nextTarget.nodeId) {
          try {
            const refreshedRootRef = result.refreshedTargetRefs.find(
              (targetRef: SourceTargetRef) => (
                targetRef.targetId === activeNativeEdit.rootTargetRef.targetId
              ),
            );
            if (refreshedRootRef) {
              const logicalSelection = options.nativeTextCommit?.selection
                ?? activeNativeEdit.session.getSelection();
              const refreshedProjection = buildSourceTextMap(
                result.sourceIndex,
                refreshedRootRef,
                { allowEmpty: true },
              );
              const canonicalHost = canonicalNativeHostPreview(
                activeNativeEdit.rootElement,
                nextTarget.nodeId,
                result.sourceIndex,
              );
              const canPreserveLiveDom = Boolean(
                options.nativeTextCommit
                && !options.nativeTextCommit.requiresCanonicalReconcile
                && canonicalHost
                && activeNativeEdit.rootElement.isConnected
                && nativeLogicalText(activeNativeEdit.rootElement) === refreshedProjection.text
                && nativePreviewOwnershipMatches(
                  activeNativeEdit.rootElement,
                  canonicalHost!,
                ),
              );
              if (!canPreserveLiveDom) {
                const preserveReasons = [
                  options.nativeTextCommit ? null : "not-native",
                  options.nativeTextCommit?.requiresCanonicalReconcile ? "structure" : null,
                  canonicalHost ? null : "no-canonical-host",
                  activeNativeEdit.rootElement.isConnected ? null : "disconnected",
                  nativeLogicalText(activeNativeEdit.rootElement) === refreshedProjection.text
                    ? null
                    : "text-mismatch",
                  canonicalHost && nativePreviewOwnershipMatches(
                    activeNativeEdit.rootElement,
                    canonicalHost,
                  )
                    ? null
                    : "ownership-mismatch",
                ].filter(Boolean).join(",");
                containerRef.current?.setAttribute(
                  "data-native-commit-path",
                  `canonical:${preserveReasons}`,
                );
                containerRef.current?.setAttribute("data-native-commit-detail", preserveReasons);
              }
              if (canPreserveLiveDom) {
                try {
                  const nextLease = {
                    ...activeNativeEdit.lease,
                    sourceRevision: refreshedProjection.sourceSha256,
                  };
                  let refreshedRuntimeMap: RuntimeDomSourceMap | null = null;
                  let refreshedFormatSkeleton: FormatSkeleton | null = null;
                  const rebased = activeNativeEdit.session.applyExternalBaseline({
                    revision: refreshedProjection.sourceSha256,
                    text: refreshedProjection.text,
                  }, {
                    preserveLiveSelection: true,
                    lease: nextLease,
                    reconcileDomBeforeRebase: () => {
                      const sourceNodeIdPlan = planMountedPreviewSourceNodeIds(
                        activeNativeEdit.rootElement.ownerDocument,
                        sourceIndex,
                        result.sourceIndex,
                      );
                      if (!sourceNodeIdPlan) return { ok: false };
                      try {
                        sourceNodeIdPlan.apply();
                        refreshedRuntimeMap = buildRuntimeDomMap(
                          activeNativeEdit.rootElement,
                          refreshedProjection,
                          refreshedRootRef,
                        );
                        if (refreshedRuntimeMap) {
                          refreshedFormatSkeleton = captureFormatSkeleton(
                            result.sourceIndex,
                            refreshedProjection,
                            {
                              root: activeNativeEdit.rootElement,
                              runtimeMap: refreshedRuntimeMap,
                              getComputedStyle: (element) => (
                                activeNativeEdit.rootElement.ownerDocument.defaultView!
                                  .getComputedStyle(element)
                              ),
                            },
                          );
                        }
                      } catch (cause) {
                        sourceNodeIdPlan.rollback();
                        throw cause;
                      }
                      return {
                        ok: Boolean(refreshedRuntimeMap && refreshedFormatSkeleton),
                        rollback: sourceNodeIdPlan.rollback,
                      };
                    },
                    getFormatSkeleton: () => {
                      if (!refreshedFormatSkeleton) {
                        throw new Error("格式骨架无法推进到新的源码版本。");
                      }
                      return refreshedFormatSkeleton;
                    },
                  });
                  if (!rebased || !refreshedRuntimeMap || !refreshedFormatSkeleton) {
                    throw new Error("真实 DOM 无法原位推进文字检查点。");
                  }
                  activeNativeEdit.projection = refreshedProjection;
                  activeNativeEdit.rootTargetRef = refreshedRootRef;
                  activeNativeEdit.runtimeMap = refreshedRuntimeMap;
                  activeNativeEdit.formatSkeleton = refreshedFormatSkeleton;
                  activeNativeEdit.selection = logicalSelection;
                  refreshedNativePreview = true;
                  containerRef.current?.setAttribute("data-native-commit-path", "preserved");
                } catch (cause) {
                  const detail = cause instanceof Error ? cause.message : String(cause);
                  containerRef.current?.setAttribute(
                    "data-native-commit-path",
                    `preserve-failed:${detail}`,
                  );
                  containerRef.current?.setAttribute("data-native-commit-detail", detail);
                  refreshedNativePreview = false;
                }
              }
              if (!refreshedNativePreview) {
                refreshedNativePreview = restartCanonicalNativeEditRef.current(
                  activeNativeEdit,
                  nextTarget,
                  logicalSelection,
                  sourceIndex,
                  result.sourceIndex,
                );
                containerRef.current?.setAttribute(
                  "data-native-commit-path",
                  refreshedNativePreview ? "canonical-restarted" : "canonical-restart-failed",
                );
              }
            }
          } catch (cause) {
            // The source transaction is already accepted. A runtime binding
            // miss is repaired on session exit without replacing the iframe.
            containerRef.current?.setAttribute(
              "data-native-commit-path",
              `refresh-failed:${cause instanceof Error ? cause.message : String(cause)}`,
            );
            refreshedNativePreview = false;
          }
        }
        if (!options.nativeTextCommit?.deferPreviewReconcile) {
          nativeEditNeedsReloadRef.current = !refreshedNativePreview;
          renderedSourceHtmlRef.current = refreshedNativePreview ? result.html : null;
        }
        containerRef.current?.setAttribute("data-render-verified", "true");
        activeNativeEdit.target = nextTarget;
        selectedSourceSelectionRef.current = nextTarget;
        setSelection(nextTarget);
        onSelectRef.current?.(nextTarget);
        previewStayedMounted = true;
      } else {
        previewStayedMounted = synchronizeStablePreview(
          sourceIndex,
          result,
          forwardPlan,
          mutation,
          appliedMutation,
        );
      }
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
    recordHistoryEntry,
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
    currentNativeEditLeaseRef.current = null;
    activeNativeEditRef.current = null;
    discardPendingNativeCommands("session-ended");
    retainNativeEditFocusRef.current = null;
    installFencedDocumentGuardRef.current(rootElement.ownerDocument);
    active.session.fenceDispose();
    nativeEditNeedsReloadRef.current = false;
    activeTextRangeRef.current = null;
    setIsEditing(false);
    setHasTextRange(false);
    setHasPendingNativeDraft(false);
    rootElement.removeAttribute("data-html-canvas-editing");
    rootElement.ownerDocument.getSelection()?.removeAllRanges();
    queueNativeFenceReloadRef.current(
      source,
      {
        fenceId: nativeEditFenceSequenceRef.current,
        target,
        selection,
        focus: true,
        toolbarVisible: true,
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
        previousText,
        replacements,
        nextText,
        beforeSelection,
        selection: nextSelection,
      } = captured.checkpoint;
      const formatValidation = validateFormatSkeletonTransaction(
        active.formatSkeleton,
        {
          root: active.rootElement,
          runtimeMap: active.runtimeMap,
          expectedSourceSha256: active.projection.sourceSha256,
          replacements: replacements.map((replacement) => ({
            startOffset: replacement.startOffset,
            endOffset: replacement.endOffset,
            nextText: replacement.nextText,
            affinity: captured.checkpoint.formatEditRange?.affinity
              ?? nextSelection.affinity,
          })),
          finalSelection: nextSelection,
          allowPlaceholderBreak: nextText === "",
          getComputedStyle: (element) => (
            active.rootElement.ownerDocument.defaultView!.getComputedStyle(element)
          ),
        },
      );
      if (!formatValidation.ok) {
        const reason = /LINK/u.test(formatValidation.code)
          ? "这次修改跨过了链接边界。为避免链接地址或范围变化，已保留原内容；可改为评论编辑。"
          : "这次输入改变了选区外的格式或网页结构，已保留原内容；可重新点选文字后再试。";
        restoreRejectedNativeCheckpoint(active, beforeSelection);
        reportBlockedEdit(new Error(reason));
        return { ok: false, mutation: null, reason };
      }
      const descriptorsByInput = new Map(
        formatValidation.patch.replacements.map((replacement) => (
          [replacement.inputIndex, replacement]
        )),
      );
      const mappedReplacements = replacements.map((replacement, inputIndex) => {
        const mapped = descriptorsByInput.get(inputIndex);
        if (
          !mapped
          || mapped.beforeText !== replacement.beforeText
          || mapped.nextText !== replacement.nextText
        ) {
          throw new Error("格式骨架与文字 Patch 的范围不一致，已停止提交。");
        }
        return {
          ...replacement,
          deleteSegments: mapped.deleteSegments,
          insertAt: mapped.insertAt,
        };
      });
      const mutation: HtmlCanvasMutation = {
        kind: "text",
        target: active.target,
        property: "nativeText",
        before: {
          text: previousText,
          selection: beforeSelection,
          replacements: mappedReplacements.map((replacement) => ({
            beforeText: replacement.beforeText,
            deleteSegments: replacement.deleteSegments,
            logicalRange: {
              startOffset: replacement.startOffset,
              endOffset: replacement.endOffset,
            },
          })),
        },
        after: {
          text: nextText,
          replacements: mappedReplacements.map((replacement) => ({
            nextText: replacement.nextText,
            insertAt: replacement.insertAt,
          })),
          selection: nextSelection,
        },
      };
      let validatedProjection: SourceTextMap | null = null;
      const result = applySourceCommand({
        type: "replace-text-range",
        targetRef: active.rootTargetRef,
        replacements: mappedReplacements.map((replacement) => ({
          deleteSegments: replacement.deleteSegments,
          insertAt: replacement.insertAt,
          beforeText: replacement.beforeText,
          nextText: replacement.nextText,
        })),
        beforeText: mappedReplacements.map((replacement) => replacement.beforeText).join(""),
        expectedSourceSha256: active.projection.sourceSha256,
      }, mutation, {
        nativeTextCommit: {
          selection: nextSelection,
          requiresCanonicalReconcile: captured.checkpoint.requiresCanonicalReconcile
            || formatValidation.patch.canonicalizeDom,
          deferPreviewReconcile: options.deferPreviewReconcile,
        },
        validateResult: (candidate) => {
          const operationTargetRef = candidate.refreshedTargetRefs.find(
            (targetRef: SourceTargetRef) => (
              targetRef.targetId === active.rootTargetRef.targetId
            ),
          );
          if (!operationTargetRef || operationTargetRef.resolution !== "exact") {
            throw new Error("文字宿主无法在 Patch 后精确重绑，已停止提交。");
          }
          const projection = buildSourceTextMap(
            candidate.sourceIndex,
            operationTargetRef,
            { allowEmpty: true },
          );
          if (projection.text !== nextText) {
            throw new Error("源码 Patch 结果与文字草稿不一致，已停止继续提交。");
          }
          validatedProjection = projection;
        },
      });
      if (!result || !validatedProjection) {
        const reason = "文字草稿无法安全映射到当前源码。";
        restoreRejectedNativeCheckpoint(active, beforeSelection);
        return { ok: false, mutation: null, reason };
      }
      sourceCommitted = true;
      const nextProjection = validatedProjection as SourceTextMap;
      if (options.deferPreviewReconcile) {
        containerRef.current?.setAttribute(
          "data-native-commit-path",
          "checkpoint-fence-deferred",
        );
        return { ok: true, mutation };
      }
      // A plain Text-node edit keeps the live DOM and exact native Selection.
      // Structural/composition changes create a new canonical island/session.
      // If both paths miss after the source commit, terminate and reload from
      // source rather than adopting provisional browser DOM as a baseline.
      const currentActive = activeNativeEditRef.current;
      if (
        nativeEditNeedsReloadRef.current
        || !currentActive
        || currentActive.projection.sourceSha256 !== nextProjection.sourceSha256
        || currentActive.projection.text !== nextProjection.text
      ) {
        const priorCommitPath = containerRef.current?.getAttribute("data-native-commit-path");
        containerRef.current?.setAttribute(
          "data-native-commit-path",
          `checkpoint-reload:${[
            priorCommitPath ? `after-${priorCommitPath}` : null,
            nativeEditNeedsReloadRef.current ? "needs-reload" : null,
            currentActive ? null : "no-active",
            currentActive && currentActive.projection.sourceSha256 !== nextProjection.sourceSha256
              ? "revision-mismatch"
              : null,
            currentActive && currentActive.projection.text !== nextProjection.text
              ? "text-mismatch"
              : null,
          ].filter(Boolean).join(",")}`,
        );
        if (activeNativeEditRef.current === active) {
          reloadCommittedNativeEditFromSource(active, result.html, nextSelection);
        } else if (!activeNativeEditRef.current) {
          installFencedDocumentGuardRef.current(active.rootElement.ownerDocument);
          const resumeTarget = selectedSourceSelectionRef.current ?? mutation.target;
          queueNativeFenceReloadRef.current(
            result.html,
            {
              fenceId: nativeEditFenceSequenceRef.current,
              target: resumeTarget,
              selection: nextSelection,
              focus: true,
              toolbarVisible: true,
            },
            resumeTarget,
            nextSelection,
          );
        }
        return { ok: true, mutation, frameReloading: true };
      }
      containerRef.current?.setAttribute("data-native-commit-path", "checkpoint-preserved");
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

  const applyNativeSourceEditIntent = useCallback((
    originSession: NativeEditingController,
    intent: NativeSourceEditIntent,
  ): boolean => {
    const originActive = activeNativeEditRef.current;
    if (!originActive || originActive.session !== originSession) return false;

    const checkpoint = checkpointNativeEdit("manual");
    if (!checkpoint.ok) return true;
    const active = activeNativeEditRef.current;
    const sourceIndex = sourceIndexRef.current;
    if (!active || !sourceIndex || sourceIndex.source !== frameSourceHtmlRef.current) {
      reportBlockedEdit(new Error("换行前的源码状态已经变化，请重新点选文字后再试。"));
      return true;
    }

    try {
      const structural = planNativeStructuralEdit(active.projection, intent);
      let validatedProjection: SourceTextMap | null = null;
      const mutation: HtmlCanvasMutation = {
        kind: "structure",
        target: active.target,
        property: structural.kind === "delete-hard-break"
          ? "hardBreakDelete"
          : "plainTextFlow",
        before: {
          text: structural.previousText,
          selection: intent.selection,
        },
        after: {
          text: structural.nextText,
          selection: structural.selection,
          inputType: structural.inputType,
        },
      };
      const result = applySourceCommand({
        ...structural.command,
        targetRef: active.rootTargetRef,
        expectedSourceSha256: active.projection.sourceSha256,
      } as SourcePatchCommand, mutation, {
        nativeTextCommit: {
          selection: structural.selection,
          requiresCanonicalReconcile: true,
        },
        validateResult: (candidate) => {
          const operationTargetRef = candidate.refreshedTargetRefs.find(
            (targetRef: SourceTargetRef) => (
              targetRef.targetId === active.rootTargetRef.targetId
            ),
          );
          if (!operationTargetRef || operationTargetRef.resolution !== "exact") {
            throw new Error("换行后的文字宿主无法精确重绑，已停止提交。");
          }
          const projection = buildSourceTextMap(
            candidate.sourceIndex,
            operationTargetRef,
            { allowEmpty: true },
          );
          if (projection.text !== structural.nextText) {
            throw new Error("换行后的源码文字与预期不一致，已停止提交。");
          }
          validatedProjection = projection;
        },
      });
      if (!result || !validatedProjection) {
        reportBlockedEdit(new Error("这处文字无法生成安全的换行源码修改。"));
      }
    } catch (cause) {
      reportBlockedEdit(cause);
    }
    // The browser event is always consumed once it reaches the source-owned
    // structural lane. A rejected plan must not fall back to browser DOM.
    return true;
  }, [
    applySourceCommand,
    checkpointNativeEdit,
    reportBlockedEdit,
  ]);

  const finishNativeEditing = useCallback((
    shouldApply: boolean,
    trigger: NativeEditCheckpointTrigger = "manual",
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
      const source = frameSourceHtmlRef.current;
      const target = active.target;
      const rootElement = active.rootElement;
      const frameReloadRequired = (
        nativeEditNeedsReloadRef.current
        || !rootElement.isConnected
        || renderedSourceHtmlRef.current !== source
      );
      currentNativeEditLeaseRef.current = null;
      activeNativeEditRef.current = null;
      discardPendingNativeCommands("session-ended");
      retainNativeEditFocusRef.current = null;
      active.session.dispose();
      nativeEditNeedsReloadRef.current = false;
      activeTextRangeRef.current = null;
      setIsEditing(false);
      setHasTextRange(false);
      setHasPendingNativeDraft(false);
      rootElement.removeAttribute("data-html-canvas-editing");
      rootElement.ownerDocument.getSelection()?.removeAllRanges();
      if (frameReloadRequired) {
        selectedElementRef.current = null;
        pendingSelectionRef.current = target;
        pendingToolbarVisibleRef.current = true;
        renderedSourceHtmlRef.current = null;
        loadFrameSource(source, { preserveViewport: true });
        return { ...committed, frameReloading: true };
      }

      pendingSelectionRef.current = null;
      pendingToolbarVisibleRef.current = false;
      pendingFrameRestoreEpochRef.current += 1;
      selectedElementRef.current = rootElement;
      selectedSourceSelectionRef.current = target;
      rootElement.setAttribute("data-html-canvas-selected", target.level);
      renderedSourceHtmlRef.current = source;
      containerRef.current?.setAttribute("data-render-verified", "true");
      setSelection(target);
      setToolbarVisible(true);
      setSelectedInsertionId(null);
      onSelectRef.current?.(target);
      updateSelectedStyle();
      updateMoveAvailability();
      observeSelectedElement(rootElement);
      requestAnimationFrame(updateOverlayPosition);
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

  const requestGlobalComment = useCallback(() => {
    if (lockedRef.current) return;
    const documentNode = iframeRef.current?.contentDocument;
    if (!documentNode) return;
    const globalElement = defaultGlobalCommentElement(documentNode);
    if (!globalElement) return;
    const target = selectElement(globalElement, "module");
    onRequestCommentRef.current?.(target);
  }, [selectElement]);

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
    const hostElement = nativeEditHostForElement(selectedElement, sourceIndex);
    if (!hostElement) {
      containerRef.current?.setAttribute("data-native-start-status", "no-host");
      reportBlockedEdit(new Error(
        "这段可见内容不是当前源码中的唯一静态文字，无法安全进入原位编辑。",
      ));
      return false;
    }
    const priorRange = activeTextRangeRef.current;
    const target = selectElement(hostElement, "part", {
      preserveTextSelection: Boolean(priorRange),
      showToolbar: true,
    });
    try {
      const rootTargetRef = sourceTargetRefForSelection(target);
      const projection = buildSourceTextMap(
        sourceIndex,
        rootTargetRef,
        { allowEmpty: true },
      );
      const activationLogicalRange = priorRange
        ? sourceSegmentsToTextRange(projection, priorRange.segments)
        : null;
      const preflight = inspectNativeEditRuntime(
        hostElement,
        projection,
        rootTargetRef,
        { ariaLabel: `编辑${target.label}` },
      );
      const capability = classifyNativeEditCapability(
        sourceIndex,
        rootTargetRef,
        {
          features: {
            hardBreak: true,
            structuralRange: false,
            emptyHost: true,
          },
          runtime: preflight.runtime,
        },
      );
      if (
        !isNativeEditableCapability(capability)
        || !preflight.runtimeMap
        || !preflight.hostMode
      ) {
        containerRef.current?.setAttribute(
          "data-native-start-status",
          `capability:${capability.code}`,
        );
        containerRef.current?.setAttribute(
          "data-native-capability-detail",
          `${capability.code}:${JSON.stringify({
            ...capability.details,
            layout: preflight.layoutDebug,
          })}`.slice(0, 2400),
        );
        reportBlockedEdit(new Error(capability.userMessage));
        return false;
      }
      if (nativeLogicalText(hostElement) !== projection.text) {
        containerRef.current?.setAttribute("data-native-start-status", "text-mismatch");
        reportBlockedEdit(new Error(
          "画布文字与源码节点已经漂移，已阻止直接编辑。",
        ));
        return false;
      }
      const formatSkeleton = captureFormatSkeleton(
        sourceIndex,
        projection,
        {
          root: hostElement,
          runtimeMap: preflight.runtimeMap,
          getComputedStyle: (element) => (
            hostElement.ownerDocument.defaultView!.getComputedStyle(element)
          ),
        },
      );
      let initialSelection: NativeEditSelection | undefined = restoredSelection;
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
      nativeEditSessionSequenceRef.current += 1;
      // Entering contenteditable gives Chromium a native undo owner for this
      // Document even when the user later blurs before typing. Keep that
      // generation marked until a canonical frame replacement cuts it off.
      nativeHistoryDirtyRef.current = true;
      const lease: ActiveNativeEdit["lease"] = {
        sessionId: `native_${nativeEditSessionSequenceRef.current.toString(36)}`,
        domGeneration: nativeDomGenerationRef.current,
        sourceRevision: projection.sourceSha256,
        hostId: rootTargetRef.targetId,
      };
      currentNativeEditLeaseRef.current = lease;
      const handleSessionState = (state: NativeEditSessionState) => {
        const active = activeNativeEditRef.current;
        if (
          !active
          || active.session !== session
          || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, active.lease)
        ) return;
        setHasPendingNativeDraft(state.draftPending);
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
      const session: NativeEditingController = new NativeEditingController({
        hostElement,
        hostMode: preflight.hostMode,
        baseline,
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
        formatSkeleton,
        onStateChange: handleSessionState,
        onPendingCommandReady: () => {
          drainPendingNativeCommandRef.current(session);
        },
        onShadowTrace: (trace) => {
          containerRef.current?.setAttribute(
            "data-native-shadow-trace",
            `${trace.code}:${trace.strictText.length}:${trace.draftText.length}`,
          );
        },
        onBlur: () => {
          const activeAtBlur = activeNativeEditRef.current;
          if (!activeAtBlur || activeAtBlur.session !== session) {
            if (retainNativeEditFocusRef.current?.session === session) {
              retainNativeEditFocusRef.current = null;
            }
            return;
          }
          const blurredLease = { ...activeAtBlur.lease };
          window.setTimeout(() => {
            const active = activeNativeEditRef.current;
            if (
              !active
              || active.session !== session
              || !nativeEditLeasesMatch(currentNativeEditLeaseRef.current, blurredLease)
            ) {
              if (retainNativeEditFocusRef.current?.session === session) {
                retainNativeEditFocusRef.current = null;
              }
              return;
            }
            const retainedFocus = retainNativeEditFocusRef.current;
            if (
              retainedFocus?.session === session
              && nativeEditLeasesMatch(retainedFocus.lease, blurredLease)
            ) {
              retainNativeEditFocusRef.current = null;
              // The toolbar lives outside the preview iframe. Keep the native
              // DOM session alive while its controls retain keyboard focus.
              return;
            }
            if (retainedFocus?.session === session) {
              retainNativeEditFocusRef.current = null;
            }
            if (deferNativeCommandRef.current(
              "blur",
              () => finishNativeEditing(true, "blur"),
              undefined,
              { authority: "system" },
            )) return;
            finishNativeEditing(true, "blur");
          }, 0);
        },
        onEscape: () => finishNativeEditing(true, "manual"),
        onUndo: () => undoRef.current(),
        onRedo: () => redoRef.current(),
        onSourceEditIntent: (intent: NativeSourceEditIntent): boolean => (
          applyNativeSourceEditIntent(session, intent)
        ),
        onUnsupportedInput: (inputType) => reportBlockedEdit(new Error(
          inputType === "insertFromPasteMultiline"
            ? "当前结构暂不支持多行粘贴，可粘贴单行文字或添加评论。"
            : inputType === "insertAtAmbiguousInlineBoundary"
              ? "这个光标位置正好在两种样式的边界，浏览器无法可靠判断文字属于哪一侧。请把光标移到样式内一个字的位置后输入，或添加评论。"
            : inputType === "deleteComplexGraphemeAcrossInlineBoundary"
              ? "这个字符跨越了多个样式边界，删除键可能拆坏文字；请选中完整字符后再删除，或添加评论。"
            : inputType === "insertParagraph" || inputType === "insertLineBreak"
              ? "当前结构暂不支持新增段落或换行，可选中文字后添加评论。"
              : "这次操作跨越了暂不支持的网页结构，可选中文字后添加评论。",
        )),
        onError: reportBlockedEdit,
        canRemoveInlineWrapper: (element) => {
          const sourceNodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE);
          const currentIndex = sourceIndexRef.current;
          return Boolean(
            sourceNodeId
            && currentIndex
            && isDisposableSourceTextWrapper(
              currentIndex.byNodeId.get(sourceNodeId),
            )
          );
        },
      });
      const active: ActiveNativeEdit = {
        rootElement: hostElement,
        target,
        projection,
        rootTargetRef,
        runtimeMap: preflight.runtimeMap,
        formatSkeleton,
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
        preflight.hostMode,
      );
      containerRef.current?.setAttribute(
        "data-native-event-delivery-mode",
        preflight.runtime.nativeEventDeliveryMode ?? "unsafe",
      );
      hostElement.setAttribute("data-html-canvas-editing", "true");
      activeTextRangeRef.current = priorRange
        ? { ...priorRange, target }
        : null;
      setIsEditing(true);
      setHasTextRange(Boolean(priorRange));
      setHasPendingNativeDraft(false);
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
      containerRef.current?.setAttribute(
        "data-native-start-status",
        `error:${cause instanceof Error ? cause.message : String(cause)}`.slice(0, 500),
      );
      const currentLease = currentNativeEditLeaseRef.current;
      if (currentLease?.hostId === selectedSourceSelectionRef.current?.id) {
        currentNativeEditLeaseRef.current = null;
      }
      reportBlockedEdit(cause);
      return false;
    }
  }, [
    clearNativeEditCheckpointTimer,
    finishNativeEditing,
    applyNativeSourceEditIntent,
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
    setHasPendingNativeDraft(false);
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
        finishNativeEditing(true, "manual");
        return false;
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
      if (requestComment) onRequestCommentRef.current?.(point.selection);
      return point.selection;
    },
    [finishNativeEditing, updateOverlayPosition],
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
    const currentTarget = active.rootElement.isConnected
      && !nativeEditNeedsReloadRef.current
      ? selectionForElement(
          active.rootElement,
          sourceIndexRef.current,
          active.target,
          undefined,
          "part",
        )
      : active.target;
    active.target = currentTarget;
    const liveSourceNodeId = active.rootElement.getAttribute(SOURCE_NODE_ATTRIBUTE);
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
    };
    clearNativeEditCheckpointTimer();
    currentNativeEditLeaseRef.current = null;
    activeNativeEditRef.current = null;
    discardPendingNativeCommands("session-ended");
    retainNativeEditFocusRef.current = null;
    installFencedDocumentGuard(documentNode);
    active.session.fenceDispose();
    active.rootElement.removeAttribute("data-html-canvas-editing");
    documentNode.getSelection()?.removeAllRanges();
    activeTextRangeRef.current = null;
    setIsEditing(false);
    setHasTextRange(false);
    setHasPendingNativeDraft(false);
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

  const applyHistoryPlan = useCallback((
    plan: SourcePatchPlan,
    mutation: HtmlCanvasMutation,
    nativeBookmark: NativeEditFenceBookmark | null = null,
  ): ReturnType<typeof applyPatchPlan> | null => {
    if (readOnlyRef.current || lockedRef.current) return null;
    try {
      const previousIndex = sourceIndexRef.current;
      if (!previousIndex || previousIndex.source !== frameSourceHtmlRef.current) {
        reportBlockedEdit(new Error("源码地图已过期，无法安全撤销。"));
        return null;
      }
      const originalTargets = uniqueSelections([
        mutation.target,
        ...commentedTargetsRef.current.map((entry) => entry.target),
        ...trackedTargetsRef.current,
      ]);
      const trackedTargetRefs = trackedSourceTargetRefs(
        originalTargets,
        plan.targetRefs,
      );
      const result = applyPatchPlan(
        plan,
        frameSourceHtmlRef.current,
        { trackedTargetRefs },
      );
      const targetUpdates = deterministicTargetUpdates(result, originalTargets);
      const targetUpdatesById = new Map(
        targetUpdates.map((target) => [target.id, target]),
      );
      const appliedMutation: HtmlCanvasMutation = {
        ...mutation,
        target: targetUpdatesById.get(mutation.target.id) || {
          ...mutation.target,
          resolution: "orphaned",
        },
        targetUpdates,
        trackedTargetIds: [
          ...new Set([
            ...plan.targetRefs.map(
              (target: SourceTargetRef) => target.targetId,
            ),
            ...trackedTargetRefs.map((target) => target.targetId),
          ]),
        ],
      };
      if (!onChangeRef.current(result.html, appliedMutation)) {
        reportBlockedEdit(new Error("宿主状态已锁定，本次撤销未被接受。"));
        return null;
      }
      lastEmittedHtmlRef.current = result.html;
      if (activeNativeEditRef.current) {
        throw new Error("撤销前的原位编辑会话没有完整结束。");
      }
      sourceIndexRef.current = result.sourceIndex;
      frameSourceHtmlRef.current = result.html;
      const nextSelection = nativeBookmark
        ? nativeSelectionFromMutationValue(
            appliedMutation.after,
            nativeBookmark.selection,
          )
        : undefined;
      // PageRoot history never shares a browsing context with Chromium's
      // contenteditable history. Undo/redo always crosses a fresh canonical
      // Document, even if the native controller already ended on blur.
      queueNativeFenceReload(
        result.html,
        nativeBookmark,
        appliedMutation.target,
        nextSelection,
      );
      setEditFeedback(null);
      return result;
    } catch (cause) {
      reportBlockedEdit(cause);
      return null;
    }
  }, [
    queueNativeFenceReload,
    reportBlockedEdit,
  ]);

  const undo = useCallback((fromQueuedCommand = false): boolean => {
    if (readOnlyRef.current || lockedRef.current) return false;
    if (activeNativeEditRef.current) {
      if (
        !fromQueuedCommand
        && deferNativeCommandRef.current("undo", () => undoRef.current(true))
      ) {
        return true;
      }
      const committed = checkpointNativeEdit("history", {
        deferPreviewReconcile: true,
      });
      if (!committed.ok) return false;
    }
    const pendingResume = pendingNativeEditResumeRef.current;
    const nativeBookmark = activeNativeEditRef.current
      ? detachNativeEditForFence()
      : pendingResume
        ? {
            fenceId: pendingResume.fenceId,
            target: pendingResume.target,
            selection: pendingResume.selection,
            focus: pendingResume.focus,
            toolbarVisible: pendingResume.toolbarVisible,
        }
        : null;
    const entry = undoStackRef.current.at(-1);
    if (!entry) {
      if (nativeBookmark || nativeHistoryDirtyRef.current) {
        const fallbackTarget = nativeBookmark?.target ?? selectedSourceSelectionRef.current;
        queueNativeFenceReload(
          frameSourceHtmlRef.current,
          nativeBookmark,
          fallbackTarget,
          nativeBookmark?.selection,
        );
      }
      return false;
    }
    const mutation = {
      ...entry.mutation,
      historyAction: "undo" as const,
      before: entry.mutation.after,
      after: entry.mutation.before,
    };
    const result = applyHistoryPlan(entry.inversePlan, mutation, nativeBookmark);
    if (!result) {
      if (nativeBookmark || nativeHistoryDirtyRef.current) {
        const fallbackTarget = nativeBookmark?.target ?? selectedSourceSelectionRef.current;
        queueNativeFenceReload(
          frameSourceHtmlRef.current,
          nativeBookmark,
          fallbackTarget,
          nativeBookmark?.selection,
        );
      }
      return false;
    }
    undoStackRef.current = undoStackRef.current.slice(0, -1);
    redoStackRef.current = [
      ...redoStackRef.current,
      { inversePlan: result.inversePlan, mutation: entry.mutation },
    ].slice(-MAX_UNDO_ENTRIES);
    containerRef.current?.setAttribute("data-undo-depth", String(undoStackRef.current.length));
    containerRef.current?.setAttribute("data-redo-depth", String(redoStackRef.current.length));
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
    return true;
  }, [
    applyHistoryPlan,
    checkpointNativeEdit,
    detachNativeEditForFence,
    queueNativeFenceReload,
  ]);
  undoRef.current = undo;

  const redo = useCallback((fromQueuedCommand = false): boolean => {
    if (readOnlyRef.current || lockedRef.current) return false;
    if (activeNativeEditRef.current) {
      if (
        !fromQueuedCommand
        && deferNativeCommandRef.current("redo", () => redoRef.current(true))
      ) {
        return true;
      }
      const committed = checkpointNativeEdit("history", {
        deferPreviewReconcile: true,
      });
      if (!committed.ok) return false;
    }
    const pendingResume = pendingNativeEditResumeRef.current;
    const nativeBookmark = activeNativeEditRef.current
      ? detachNativeEditForFence()
      : pendingResume
        ? {
            fenceId: pendingResume.fenceId,
            target: pendingResume.target,
            selection: pendingResume.selection,
            focus: pendingResume.focus,
            toolbarVisible: pendingResume.toolbarVisible,
        }
        : null;
    const entry = redoStackRef.current.at(-1);
    if (!entry) {
      if (nativeBookmark || nativeHistoryDirtyRef.current) {
        const fallbackTarget = nativeBookmark?.target ?? selectedSourceSelectionRef.current;
        queueNativeFenceReload(
          frameSourceHtmlRef.current,
          nativeBookmark,
          fallbackTarget,
          nativeBookmark?.selection,
        );
      }
      return false;
    }
    const mutation = {
      ...entry.mutation,
      historyAction: "redo" as const,
    };
    const result = applyHistoryPlan(entry.inversePlan, mutation, nativeBookmark);
    if (!result) {
      if (nativeBookmark || nativeHistoryDirtyRef.current) {
        const fallbackTarget = nativeBookmark?.target ?? selectedSourceSelectionRef.current;
        queueNativeFenceReload(
          frameSourceHtmlRef.current,
          nativeBookmark,
          fallbackTarget,
          nativeBookmark?.selection,
        );
      }
      return false;
    }
    redoStackRef.current = redoStackRef.current.slice(0, -1);
    undoStackRef.current = [
      ...undoStackRef.current,
      { inversePlan: result.inversePlan, mutation: entry.mutation },
    ].slice(-MAX_UNDO_ENTRIES);
    containerRef.current?.setAttribute("data-undo-depth", String(undoStackRef.current.length));
    containerRef.current?.setAttribute("data-redo-depth", String(redoStackRef.current.length));
    setUndoDepth(undoStackRef.current.length);
    setRedoDepth(redoStackRef.current.length);
    return true;
  }, [
    applyHistoryPlan,
    checkpointNativeEdit,
    detachNativeEditForFence,
    queueNativeFenceReload,
  ]);
  redoRef.current = redo;

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
      trigger?: NativeEditCheckpointTrigger;
    } = {},
  ): HtmlCanvasCommitResult => {
    const resumeEditing = options.resumeEditing ?? true;
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

    const bookmark = detachNativeEditForFence();
    const needsCanonicalFence = Boolean(bookmark) || nativeHistoryDirtyRef.current;
    if (needsCanonicalFence) {
      const target = resumeEditing
        ? bookmark?.target ?? selectedSourceSelectionRef.current
        : null;
      queueNativeFenceReload(
        frameSourceHtmlRef.current,
        resumeEditing ? bookmark : null,
        target,
        bookmark?.selection,
      );
    } else if (!resumeEditing) {
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

  const api = useMemo<HtmlCanvasEditorHandle>(
    () => ({
      getSourceHtml: () => frameSourceHtmlRef.current,
      getRenderedSourceHtml: () => renderedSourceHtmlRef.current,
      checkpointPendingEdit,
      fencePendingEdit,
      commitPendingEdit,
      freezeNow,
      unlockNow,
      undo,
      canUndo: () => Boolean(
        undoStackRef.current.length > 0
        || activeNativeEditRef.current?.session.isDirty()
        || activeNativeEditRef.current?.session.hasPendingDraft()
      ),
      hasPendingNativeEdit: () => Boolean(
        activeNativeEditRef.current?.session.isDirty()
        || activeNativeEditRef.current?.session.hasPendingDraft()
        || activeNativeEditRef.current?.session.isComposing()
      ),
      redo,
      canRedo: () => redoStackRef.current.length > 0,
      clearSelection,
      select: selectTarget,
      startEditing,
      moveSelected,
      deferNativeCommand,
    }),
    [
      clearSelection,
      checkpointPendingEdit,
      fencePendingEdit,
      commitPendingEdit,
      deferNativeCommand,
      freezeNow,
      moveSelected,
      redo,
      selectTarget,
      startEditing,
      undo,
      unlockNow,
    ],
  );

  useImperativeHandle(forwardedRef, () => api, [api]);

  useEffect(() => {
    onReady?.(api);
    return () => onReady?.(null);
  }, [api, onReady]);

  useEffect(() => {
    if (!frameInitializedRef.current) {
      frameInitializedRef.current = true;
      loadFrameSource(html);
      lastPropRef.current = { html, baseHref: resolvedBaseHref };
      undoStackRef.current = [];
      redoStackRef.current = [];
      containerRef.current?.setAttribute("data-undo-depth", "0");
      containerRef.current?.setAttribute("data-redo-depth", "0");
      setUndoDepth(0);
      setRedoDepth(0);
      return;
    }

    const previous = lastPropRef.current;
    if (previous.html === html && previous.baseHref === resolvedBaseHref) return;
    lastPropRef.current = { html, baseHref: resolvedBaseHref };

    if (html === lastEmittedHtmlRef.current && previous.baseHref === resolvedBaseHref) return;
    if (activeNativeEditRef.current) detachNativeEditForFence();
    pendingNativeEditResumeRef.current = null;
    resetSelection(false);
    if (!preserveUndoHistory) {
      undoStackRef.current = [];
      redoStackRef.current = [];
      containerRef.current?.setAttribute("data-undo-depth", "0");
      containerRef.current?.setAttribute("data-redo-depth", "0");
      setUndoDepth(0);
      setRedoDepth(0);
    }
    lastEmittedHtmlRef.current = null;
    loadFrameSource(html);
  }, [
    detachNativeEditForFence,
    html,
    loadFrameSource,
    preserveUndoHistory,
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
      activeNativeEditRef.current?.session.fenceDispose();
      activeNativeEditRef.current = null;
      discardPendingNativeCommands("unmounted");
      retainNativeEditFocusRef.current = null;
      pendingNativeEditResumeRef.current = null;
      fencedDocumentCleanupRef.current();
      cleanupFrameRef.current();
      resizeObserverRef.current?.disconnect();
    };
  }, [clearNativeEditCheckpointTimer, discardPendingNativeCommands]);

  const connectFrame = useCallback((iframe: HTMLIFrameElement) => {
    if (iframe !== iframeRef.current) return;
    const connectedFrameGeneration = frameLoadGenerationRef.current;
    cleanupFrameRef.current();
    const documentNode = iframe.contentDocument;
    const expectedFrameHtml = expectedFrameHtmlRef.current;
    const expectedToken = expectedFrameTokenRef.current;
    if (!documentNode?.documentElement || !expectedFrameHtml || !expectedToken) {
      renderedSourceHtmlRef.current = null;
      containerRef.current?.setAttribute("data-render-verified", "false");
      return;
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
      return;
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

    const handleClick = (event: MouseEvent) => {
      if (isCanvasRootElement(event.target)) {
        if (!lockedRef.current) {
          event.preventDefault();
          event.stopPropagation();
          clearSelection();
        }
        return;
      }
      const target = findCanvasSelectionElement(event.target);
      if (!target) return;
      if (lockedRef.current) {
        if (target.closest("a, button, form, input, select, textarea, [contenteditable]")) {
          event.preventDefault();
        }
        return;
      }
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) return;
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
      const target = findCanvasSelectionElement(event.target);
      if (!target) return;
      if (activeNativeEditRef.current?.rootElement.contains(event.target as Node)) return;
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
      const editingStarted = capturedRange ? startEditing() : false;
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

    const handleKeyDown = (event: KeyboardEvent) => {
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
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
          event.preventDefault();
          if (event.shiftKey) redo();
          else undo();
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        clearSelection();
        return;
      }
      if (event.key === "Enter" && selectedElementRef.current) {
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
  }, [
    captureTextRange,
    clearSelection,
    fencePendingEdit,
    finishNativeEditing,
    moveSelected,
    selectElement,
    selectTarget,
    startEditing,
    undo,
    redo,
    updateOverlayPosition,
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
          || element !== activeNativeEdit.rootElement
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

  const handleToolbarKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.stopPropagation();
      if (event.shiftKey) redo();
      else undo();
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
  const textFormatRequiresSelection = isEditing && !hasTextRange;

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
        className={styles.frame}
        title={
          renderedMode === "history"
            ? `${iframeTitle}（正在查看历史版本，只读）`
            : interactionLocked
              ? `${iframeTitle}（本轮已锁定，仅可浏览）`
              : iframeTitle
        }
        srcDoc={frameRender.html}
        sandbox="allow-same-origin"
        onLoad={(event) => connectFrame(event.currentTarget)}
      />

      {editFeedback && !interactionLocked ? (
        <section
          className={styles.editBlockedNotice}
          data-tone={editFeedback.tone}
          role={editFeedback.tone === "error" ? "alert" : "status"}
          aria-live={editFeedback.tone === "error" ? "assertive" : "polite"}
        >
          <div>
            <strong>{editFeedback.title}</strong>
            <span>{editFeedback.message}</span>
          </div>
          <button
            type="button"
            onClick={() => setEditFeedback(null)}
            aria-label="关闭修改提示"
          >关闭</button>
        </section>
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
          style={{ left: marker.left, top: marker.top }}
          aria-label={marker.label || `${marker.selection.label}已有${marker.count || 1}条评论`}
          title={marker.label || "查看已有评论"}
          onClick={() => {
            if (lockedRef.current) return;
            selectTarget(marker.selection, { showToolbar: true });
          }}
        >
          <span className={styles.commentGlyph} aria-hidden="true">评</span>
          {marker.count && marker.count > 1 ? <span className={styles.commentCount}>{marker.count}</span> : null}
        </button>
      )) : null}

      <button
        type="button"
        className={styles.globalCommentButton}
        data-active={!interactionLocked && isPageRootSelection(selection) ? "true" : undefined}
        aria-label="给整个页面留全局评论"
        title={interactionLocked ? "当前页面只读" : "全局评论"}
        disabled={interactionLocked}
        onClick={requestGlobalComment}
      >
        全局评论
      </button>

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
                onRequestCommentRef.current?.(selection);
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
                className={styles.undoToolButton}
                disabled={
                  undoDepth === 0
                  && !activeNativeEditRef.current?.session.isDirty()
                  && !hasPendingNativeDraft
                }
                aria-label="撤销上一次文字、样式或排序修改"
                title="撤销上一次修改（不包括评论）"
                onClick={() => undo()}
              >
                撤销
              </button>

              <button
                type="button"
                className={styles.undoToolButton}
                disabled={redoDepth === 0}
                aria-label="重做上一次撤销的文字、样式或排序修改"
                title="重做上一次撤销（不包括评论）"
                onClick={() => redo()}
              >
                重做
              </button>

              <button
                type="button"
                className={styles.toolButton}
                aria-pressed={isEditing}
                disabled={!selectedNativeEditHost}
                title={!selectedNativeEditHost
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
