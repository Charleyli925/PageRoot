import {
  NativeTextChangeTracker,
  NativeTransactionSelectionTracker,
  classifyNativeInput,
  type NativeTextChangeTrackerSnapshot,
  type NativeTextReplacement,
} from "../lib/native-edit-transaction.js";
import {
  NativeBlockEditDraft,
  type NativeBlockEditDraftSnapshot,
  type NativeBlockPendingCommand,
} from "../lib/native-block-edit-draft.js";
import { isTransparentSourceTextElement } from "../lib/source-text-map.js";

export const NATIVE_EDIT_CHECKPOINT_DELAY_MS = 700;

const COMPOSITION_TERMINAL_DELIVERY_GRACE_MS = 80;

const PENDING_COMPOSITION_COMMAND_GRACE_MS = 1200;

const COLLAPSED_TEXT_INSERT_INPUT_TYPES = new Set([
  "insertCompositionText",
  "insertFromComposition",
  "insertFromPaste",
  "insertFromPasteAsQuotation",
  "insertReplacementText",
  "insertText",
]);

const EXPLICIT_COMPOSITION_FALLBACK_TRIGGERS = new Set<NativeEditCheckpointTrigger>([
  "blur",
  "fence",
  "history",
  "style",
  "save",
  "export",
  "project-switch",
  "ai",
  "manual",
]);

const ATOM_TAGS = new Set([
  "audio",
  "button",
  "canvas",
  "embed",
  "iframe",
  "img",
  "input",
  "math",
  "object",
  "select",
  "svg",
  "textarea",
  "video",
]);

const MANAGED_EDIT_ATTRIBUTE_NAMES = new Set([
  "aria-label",
  "aria-multiline",
  "autocapitalize",
  "autocomplete",
  "contenteditable",
  "data-gramm",
  "data-html-canvas-editing",
  "data-html-canvas-native-editing",
  "data-html-canvas-selected",
  "role",
  "spellcheck",
  "tabindex",
]);

const SESSION_CONTROLLED_ATTRIBUTE_NAMES = [
  "aria-label",
  "aria-multiline",
  "autocapitalize",
  "autocomplete",
  "contenteditable",
  "data-html-canvas-native-editing",
  "data-gramm",
  "role",
  "spellcheck",
  "tabindex",
] as const;

const SESSION_CONTROLLED_ATTRIBUTE_NAME_SET = new Set<string>(
  SESSION_CONTROLLED_ATTRIBUTE_NAMES,
);

// Keep this in lockstep with source-patch-engine's disposable empty text
// wrappers. These are the only authored elements Chromium may temporarily
// remove after their complete text range is replaced.
const DISPOSABLE_INLINE_WRAPPER_TAGS = new Set([
  "b",
  "em",
  "i",
  "mark",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

export type NativeEditSelection = {
  anchor: number;
  focus: number;
  affinity: "left" | "right";
};

export type NativeEditBaseline = {
  revision: string;
  text: string;
  selection?: NativeEditSelection;
};

export type NativeEditLeaseStamp = {
  readonly sessionId: string;
  readonly domGeneration: number;
  readonly sourceRevision: string;
  readonly hostId: string;
};

export type NativeEditLease = {
  stamp: NativeEditLeaseStamp;
  isCurrent: (stamp: NativeEditLeaseStamp) => boolean;
  advance: (
    expected: NativeEditLeaseStamp,
    next: NativeEditLeaseStamp,
  ) => boolean;
};

export type NativeEditExternalDomReconcileResult = {
  ok: boolean;
  rollback?: () => void;
};

export type NativeEditCheckpoint =
  | {
      ok: false;
      reason: "composing" | "not-ready" | "disposed" | "dom-drift";
    }
  | {
      ok: true;
      checkpoint: null;
      selection: NativeEditSelection;
    }
  | {
      ok: true;
      checkpoint: {
        previousText: string;
        nextText: string;
        replacements: NativeTextReplacement[];
        beforeSelection: NativeEditSelection;
        selection: NativeEditSelection;
        inputType: string | null;
        requiresCanonicalReconcile: boolean;
        authority: "strict" | "composition-fallback";
        /** The only logical range a stable composition fallback may replace. */
        formatEditRange?: {
          startOffset: number;
          endOffset: number;
          affinity: "left" | "right";
        };
      };
      selection: NativeEditSelection;
    };

export type NativeEditCheckpointTrigger =
  | "automatic"
  | "blur"
  | "fence"
  | "history"
  | "style"
  | "save"
  | "export"
  | "project-switch"
  | "ai"
  | "manual";

export type NativeEditPendingCommandRequest = {
  kind: string;
  /** Only an actual user command may authorize the narrow stable-composition fallback. */
  authority?: "user-explicit" | "system";
  payload?: unknown;
};

export type NativeEditQueuedCommand = NativeBlockPendingCommand;

export type NativeEditQueueCommandResult =
  | { queued: false }
  | {
      queued: true;
      sequence: number;
      replacedSequence: number | null;
    };

export type NativeEditSessionState = {
  dirty: boolean;
  draftPending: boolean;
  composing: boolean;
  requiresCanonicalReconcile: boolean;
  selection: NativeEditSelection;
  inputType: string | null;
};

export type NativeEditExternalBaselineOptions = {
  preserveLiveSelection?: boolean;
  lease?: NativeEditLeaseStamp;
  /** Applies trusted preview metadata after composition rollback but before snapshots advance. */
  reconcileDomBeforeRebase?: () => NativeEditExternalDomReconcileResult;
  /** Captures the next revision's source-owned format skeleton after DOM metadata reconciliation. */
  getFormatSkeleton?: () => unknown;
};

export type NativeEditingControllerOptions = {
  hostElement: HTMLElement;
  baseline: NativeEditBaseline;
  lease: NativeEditLease;
  ariaLabel?: string;
  onStateChange?: (state: NativeEditSessionState) => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  onUnsupportedInput?: (inputType: string) => void;
  onError?: (error: Error) => void;
  canRemoveInlineWrapper?: (element: Element) => boolean;
  /** Source-owned formatting data. The controller only snapshots it; DOM never becomes source. */
  formatSkeleton?: unknown;
  /** Fired after the queued command's composition is stable or has been cancelled safely. */
  onPendingCommandReady?: () => void;
  /** Optional diagnostic hook for shadow-mode disagreement; never changes commit authority. */
  onShadowTrace?: (trace: {
    code: string;
    strictText: string;
    draftText: string;
    lease: NativeEditLeaseStamp;
  }) => void;
};

type DomPoint = {
  node: Node;
  offset: number;
};

type Token = {
  kind: "text" | "hard-break" | "atom";
  node: Node;
  text: string;
  start: number;
  end: number;
};

type SavedAttribute = {
  present: boolean;
  value: string | null;
};

type AuthoredAttribute = {
  namespaceURI: string | null;
  qualifiedName: string;
  localName: string;
  value: string;
};

type StructuralNodeRecord = {
  node: Node;
  parent: Node | null;
  nodeType: number;
  namespaceURI: string | null;
  localName: string | null;
  nodeValue: string | null;
  attributes: string[];
  attributeNames: string[];
  logicalStart: number | null;
  logicalEnd: number | null;
};

type DomStructureSnapshot = {
  records: StructuralNodeRecord[];
};

type NativeMutationIntent = {
  inputType: string;
  originalRanges: Array<{ startOffset: number; endOffset: number }>;
};

type PendingNativeCandidate = {
  lease: NativeEditLeaseStamp;
  announcedInputTypes: Set<string>;
  currentRanges: Array<{ startOffset: number; endOffset: number }>;
  intentStart: number;
  previousInputType: string | null;
  startSelection: NativeEditSelection;
  startText: string;
};

type RestorableDomNode = {
  node: Node;
  nodeValue: string | null;
  attributes: AuthoredAttribute[] | null;
  children: RestorableDomNode[];
  templateChildren: RestorableDomNode[] | null;
};

type CompositionSnapshot = {
  lease: NativeEditLeaseStamp;
  children: RestorableDomNode[];
  hostAttributes: AuthoredAttribute[];
  structure: DomStructureSnapshot;
  selection: NativeEditSelection;
  text: string;
  tracker: NativeTextChangeTrackerSnapshot;
  replacements: NativeTextReplacement[];
  nativeMutationIntentLength: number;
  lastInputType: string | null;
  unauthorizedDomDrift: boolean;
  requiresCanonicalReconcile: boolean;
};

type CompositionTerminalCandidate = {
  data: string;
  inputType: "insertText" | "insertFromComposition";
  required: boolean;
};

type CompositionCommitAuthority = {
  intentStart: number;
  originalStart: number;
  originalEnd: number;
  outputStart: number;
  outputEnd: number;
  data: string;
};

type CompositionEpoch =
  | {
      lease: NativeEditLeaseStamp;
      id: number;
      phase: "composing";
      snapshot: CompositionSnapshot;
      cancelRequested: boolean;
      compositionInputDelivered: boolean;
      pendingTerminal: CompositionTerminalCandidate | null;
      commitAuthority: CompositionCommitAuthority | null;
    }
  | {
      lease: NativeEditLeaseStamp;
      id: number;
      phase: "settling";
      snapshot: CompositionSnapshot;
      cancelled: boolean;
      focusGuard: boolean;
      lateDeliveryPending: boolean;
      compositionInputDelivered: boolean;
      pendingTerminal: CompositionTerminalCandidate | null;
      commitAuthority: CompositionCommitAuthority | null;
    };

type LogicalReplacementCoverage = {
  originalStart: number;
  originalEnd: number;
  outputStart: number;
  outputEnd: number;
};

function cloneLeaseStamp(stamp: NativeEditLeaseStamp): NativeEditLeaseStamp {
  return Object.freeze({
    sessionId: stamp.sessionId,
    domGeneration: stamp.domGeneration,
    sourceRevision: stamp.sourceRevision,
    hostId: stamp.hostId,
  });
}

function leaseStampsMatch(
  left: NativeEditLeaseStamp,
  right: NativeEditLeaseStamp,
): boolean {
  return left.sessionId === right.sessionId
    && left.domGeneration === right.domGeneration
    && left.sourceRevision === right.sourceRevision
    && left.hostId === right.hostId;
}

function sameLeaseHost(
  left: NativeEditLeaseStamp,
  right: NativeEditLeaseStamp,
): boolean {
  return left.sessionId === right.sessionId
    && left.domGeneration === right.domGeneration
    && left.hostId === right.hostId;
}

function errorFrom(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function isAtomElement(element: Element): boolean {
  return (
    ATOM_TAGS.has(element.localName)
    || element.getAttribute("contenteditable") === "false"
  );
}

function tokensForHost(hostElement: HTMLElement): Token[] {
  const tokens: Token[] = [];
  let logicalOffset = 0;
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node as Text).data;
      tokens.push({
        kind: "text",
        node,
        text,
        start: logicalOffset,
        end: logicalOffset + text.length,
      });
      logicalOffset += text.length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.localName === "br") {
      tokens.push({
        kind: "hard-break",
        node,
        text: "\n",
        start: logicalOffset,
        end: logicalOffset + 1,
      });
      logicalOffset += 1;
      return;
    }
    if (isAtomElement(element)) {
      tokens.push({
        kind: "atom",
        node,
        text: "\ufffc",
        start: logicalOffset,
        end: logicalOffset + 1,
      });
      logicalOffset += 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  hostElement.childNodes.forEach(visit);
  return tokens;
}

export function nativeLogicalText(hostElement: HTMLElement): string {
  return tokensForHost(hostElement).map((token) => token.text).join("");
}

function nodeLogicalLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node as Text).data.length;
  if (node.nodeType !== Node.ELEMENT_NODE) return 0;
  const element = node as Element;
  if (element.localName === "br" || isAtomElement(element)) return 1;
  return Array.from(node.childNodes).reduce(
    (total, child) => total + nodeLogicalLength(child),
    0,
  );
}

function logicalOffsetForDomPoint(
  hostElement: HTMLElement,
  targetNode: Node,
  targetOffset: number,
): number | null {
  if (targetNode !== hostElement && !hostElement.contains(targetNode)) return null;
  let consumed = 0;
  let result: number | null = null;
  const visit = (node: Node) => {
    if (result !== null) return;
    if (node === targetNode) {
      if (node.nodeType === Node.TEXT_NODE) {
        const length = (node as Text).data.length;
        result = consumed + Math.max(0, Math.min(length, targetOffset));
        return;
      }
      const children = Array.from(node.childNodes);
      const childLimit = Math.max(0, Math.min(children.length, targetOffset));
      result = consumed + children
        .slice(0, childLimit)
        .reduce((total, child) => total + nodeLogicalLength(child), 0);
      return;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      consumed += (node as Text).data.length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.localName === "br" || isAtomElement(element)) {
      consumed += 1;
      return;
    }
    node.childNodes.forEach(visit);
  };
  visit(hostElement);
  return result;
}

function transparentInlineLogicalRanges(
  hostElement: HTMLElement,
): Array<{ startOffset: number; endOffset: number }> {
  const ranges: Array<{ startOffset: number; endOffset: number }> = [];
  let logicalOffset = 0;
  const visit = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      logicalOffset += (node as Text).data.length;
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const element = node as Element;
    if (element.localName === "br" || isAtomElement(element)) {
      logicalOffset += 1;
      return;
    }
    const startOffset = logicalOffset;
    node.childNodes.forEach(visit);
    if (node !== hostElement && isTransparentSourceTextElement(element.localName)) {
      ranges.push({ startOffset, endOffset: logicalOffset });
    }
  };
  hostElement.childNodes.forEach(visit);
  return ranges;
}

/**
 * A logical text offset cannot distinguish the several real DOM/source
 * anchors that meet at the start or end of an authored inline wrapper. The
 * browser may apply caret gravity to either side (even when Selection points
 * at the following Text node), while a later text-only patch would have to
 * guess. Block only collapsed insertion gestures at those exact boundaries;
 * interior typing and non-collapsed replacements remain native.
 */
function insertionTargetsAmbiguousInlineBoundary(
  hostElement: HTMLElement,
  event: InputEvent | null,
): boolean {
  let startNode: Node | null = null;
  let startOffset = 0;
  let endNode: Node | null = null;
  let endOffset = 0;
  if (event && typeof event.getTargetRanges === "function") {
    const ranges = Array.from(event.getTargetRanges());
    // This guard deliberately owns only a single collapsed insertion point.
    // Multi-range and non-collapsed replacements continue through the normal
    // native-input/tracker validation path instead of being reclassified as
    // an ambiguous caret merely because their logical text width is zero.
    if (ranges.length > 1) return false;
    const targetRange = ranges[0];
    if (targetRange) {
      if (!targetRange.collapsed) return false;
      startNode = targetRange.startContainer;
      startOffset = targetRange.startOffset;
      endNode = targetRange.endContainer;
      endOffset = targetRange.endOffset;
    }
  }
  if (!startNode || !endNode) {
    const selection = hostElement.ownerDocument.getSelection();
    if (!selection?.anchorNode || !selection.focusNode) return true;
    if (!selection.isCollapsed) return false;
    startNode = selection.anchorNode;
    startOffset = selection.anchorOffset;
    endNode = selection.focusNode;
    endOffset = selection.focusOffset;
  }
  const logicalStart = logicalOffsetForDomPoint(
    hostElement,
    startNode,
    startOffset,
  );
  const logicalEnd = logicalOffsetForDomPoint(
    hostElement,
    endNode,
    endOffset,
  );
  if (logicalStart === null || logicalEnd === null) return true;
  // The collapsed checks above are the authority for this event-level guard;
  // this equality is only a defensive consistency check for DOM point
  // conversion, never a way to turn a non-collapsed range into a caret.
  if (logicalStart !== logicalEnd) return false;
  return transparentInlineLogicalRanges(hostElement).some((range) => (
    logicalStart === range.startOffset || logicalStart === range.endOffset
  ));
}

function domPointForLogicalOffset(
  hostElement: HTMLElement,
  logicalOffset: number,
  affinity: "left" | "right",
): DomPoint {
  const tokens = tokensForHost(hostElement);
  const logicalLength = tokens.at(-1)?.end ?? 0;
  const clamped = Math.max(0, Math.min(logicalLength, logicalOffset));
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.kind === "text") {
      if (clamped > token.start && clamped < token.end) {
        return { node: token.node, offset: clamped - token.start };
      }
      if (clamped === token.start && affinity === "right") {
        return { node: token.node, offset: 0 };
      }
      if (clamped === token.end && affinity === "left") {
        return { node: token.node, offset: token.text.length };
      }
    }
    if (clamped === token.start || clamped === token.end) {
      const parent = token.node.parentNode;
      if (!parent) continue;
      const childIndex = Array.from<Node>(parent.childNodes).indexOf(token.node);
      return {
        node: parent,
        offset: childIndex + (clamped === token.end ? 1 : 0),
      };
    }
  }
  const lastText = [...tokens].reverse().find((token) => token.kind === "text");
  if (lastText?.node.nodeType === Node.TEXT_NODE) {
    return { node: lastText.node, offset: (lastText.node as Text).data.length };
  }
  return { node: hostElement, offset: hostElement.childNodes.length };
}

function graphemeDeletionRange(
  text: string,
  caretOffset: number,
  inputType: "deleteContentBackward" | "deleteContentForward",
): { startOffset: number; endOffset: number } | null {
  type Segment = { segment: string; index: number };
  type SegmenterConstructor = new (
    locales?: string | string[],
    options?: { granularity: "grapheme" },
  ) => { segment(input: string): Iterable<Segment> };
  const Segmenter = (Intl as typeof Intl & {
    Segmenter?: SegmenterConstructor;
  }).Segmenter;
  if (!Segmenter) return null;
  const clampedCaret = Math.max(0, Math.min(text.length, caretOffset));
  const segments = Array.from(
    new Segmenter(undefined, { granularity: "grapheme" }).segment(text),
  );
  const segment = inputType === "deleteContentBackward"
    ? segments.find((candidate) => (
      candidate.index + candidate.segment.length === clampedCaret
    ))
    : segments.find((candidate) => candidate.index === clampedCaret);
  if (!segment) return null;
  return {
    startOffset: segment.index,
    endOffset: segment.index + segment.segment.length,
  };
}

function complexGraphemeDeletionRange(
  text: string,
  caretOffset: number,
  inputType: "deleteContentBackward" | "deleteContentForward",
): { startOffset: number; endOffset: number } | null {
  const range = graphemeDeletionRange(text, caretOffset, inputType);
  return range && range.endOffset - range.startOffset > 1 ? range : null;
}

function replacementTextForFrozenRange(
  beforeText: string,
  afterText: string,
  startOffset: number,
  endOffset: number,
): string | null {
  if (
    startOffset < 0
    || endOffset < startOffset
    || endOffset > beforeText.length
    || !afterText.startsWith(beforeText.slice(0, startOffset))
  ) return null;
  const suffix = beforeText.slice(endOffset);
  if (!afterText.endsWith(suffix)) return null;
  const insertedEnd = afterText.length - suffix.length;
  if (insertedEnd < startOffset) return null;
  return afterText.slice(startOffset, insertedEnd);
}

function selectionValue(hostElement: HTMLElement): NativeEditSelection {
  const selection = hostElement.ownerDocument.getSelection();
  const logicalLength = nativeLogicalText(hostElement).length;
  if (!selection?.anchorNode || !selection.focusNode) {
    return { anchor: logicalLength, focus: logicalLength, affinity: "right" };
  }
  const anchor = logicalOffsetForDomPoint(
    hostElement,
    selection.anchorNode,
    selection.anchorOffset,
  );
  const focus = logicalOffsetForDomPoint(
    hostElement,
    selection.focusNode,
    selection.focusOffset,
  );
  if (anchor === null || focus === null) {
    return { anchor: logicalLength, focus: logicalLength, affinity: "right" };
  }
  return {
    anchor,
    focus,
    affinity: anchor === focus
      ? (focus > 0 ? "left" : "right")
      : anchor < focus ? "right" : "left",
  };
}

function setSelectionValue(
  hostElement: HTMLElement,
  value: NativeEditSelection,
): void {
  const selection = hostElement.ownerDocument.getSelection();
  if (!selection) return;
  const anchor = domPointForLogicalOffset(hostElement, value.anchor, value.affinity);
  const focus = domPointForLogicalOffset(hostElement, value.focus, value.affinity);
  selection.removeAllRanges();
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(anchor.node, anchor.offset, focus.node, focus.offset);
    return;
  }
  const range = hostElement.ownerDocument.createRange();
  if (value.anchor <= value.focus) {
    range.setStart(anchor.node, anchor.offset);
    range.setEnd(focus.node, focus.offset);
  } else {
    range.setStart(focus.node, focus.offset);
    range.setEnd(anchor.node, anchor.offset);
  }
  selection.addRange(range);
}

function savedAttribute(element: Element, name: string): SavedAttribute {
  return {
    present: element.hasAttribute(name),
    value: element.getAttribute(name),
  };
}

function restoreAttribute(
  element: Element,
  name: string,
  saved: SavedAttribute,
): void {
  if (saved.present) element.setAttribute(name, saved.value ?? "");
  else element.removeAttribute(name);
}

function authoredAttributes(
  element: Element,
  ignoreManagedAttributes = false,
): AuthoredAttribute[] {
  return Array.from(element.attributes)
    .filter((attribute) => (
      !ignoreManagedAttributes || !MANAGED_EDIT_ATTRIBUTE_NAMES.has(attribute.name)
    ))
    .map((attribute) => ({
      namespaceURI: attribute.namespaceURI,
      qualifiedName: attribute.name,
      localName: attribute.localName,
      value: attribute.value,
    }))
    .sort((left, right) => (
      `${left.namespaceURI ?? ""}\u0000${left.qualifiedName}`
        .localeCompare(`${right.namespaceURI ?? ""}\u0000${right.qualifiedName}`)
    ));
}

function attributeSignature(attributes: AuthoredAttribute[]): string[] {
  return attributes.map((attribute) => JSON.stringify([
    attribute.namespaceURI,
    attribute.qualifiedName,
    attribute.localName,
    attribute.value,
  ]));
}

function captureDomStructure(hostElement: HTMLElement): DomStructureSnapshot {
  const records: StructuralNodeRecord[] = [];
  let logicalOffset = 0;
  const visit = (
    node: Node,
    parent: Node | null,
    participatesInLogicalText: boolean,
  ) => {
    // Browsers may split, merge, add, or remove Text nodes while carrying out
    // a supported beforeinput/composition transaction. Their logical value is
    // validated separately by NativeTextChangeTracker, so text-node topology
    // is intentionally absent from this authored-structure snapshot.
    if (node.nodeType === Node.TEXT_NODE) {
      if (participatesInLogicalText) logicalOffset += (node as Text).data.length;
      return;
    }
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : null;
    const attributes = element
      ? authoredAttributes(element, node === hostElement)
      : [];
    const logicalStart = participatesInLogicalText ? logicalOffset : null;
    const record: StructuralNodeRecord = {
      node,
      parent,
      nodeType: node.nodeType,
      namespaceURI: element?.namespaceURI ?? null,
      localName: element?.localName ?? null,
      nodeValue: element ? null : node.nodeValue,
      attributes: attributeSignature(attributes),
      attributeNames: attributes.map((attribute) => attribute.qualifiedName),
      logicalStart,
      logicalEnd: null,
    };
    records.push(record);
    const isLogicalAtom = Boolean(
      participatesInLogicalText
      && element
      && (element.localName === "br" || isAtomElement(element))
    );
    if (isLogicalAtom) logicalOffset += 1;
    node.childNodes.forEach((child) => visit(
      child,
      node,
      participatesInLogicalText && !isLogicalAtom,
    ));
    if (element?.localName === "template") {
      const templateContent = (element as HTMLTemplateElement).content;
      visit(templateContent, element, false);
    }
    record.logicalEnd = participatesInLogicalText ? logicalOffset : null;
  };
  visit(hostElement, null, true);
  return { records };
}

function domStructureSnapshotsMatch(
  expected: DomStructureSnapshot,
  actual: DomStructureSnapshot,
): boolean {
  if (actual.records.length !== expected.records.length) return false;
  return expected.records.every((record, index) => (
    structuralRecordMatches(record, actual.records[index])
  ));
}

function domStructureLogicalRangesMatch(
  expected: DomStructureSnapshot,
  actual: DomStructureSnapshot,
): boolean {
  return actual.records.length === expected.records.length
    && expected.records.every((record, index) => (
      record.logicalStart === actual.records[index].logicalStart
      && record.logicalEnd === actual.records[index].logicalEnd
    ));
}

function replacementCoverages(
  replacements: ReadonlyArray<NativeTextReplacement>,
): LogicalReplacementCoverage[] {
  const sorted = [...replacements].sort((left, right) => (
    left.startOffset - right.startOffset || left.endOffset - right.endOffset
  ));
  const coverages: LogicalReplacementCoverage[] = [];
  let delta = 0;
  let previousEnd = -1;
  for (const replacement of sorted) {
    if (replacement.startOffset < previousEnd) return [];
    const outputStart = replacement.startOffset + delta;
    const outputEnd = outputStart + replacement.nextText.length;
    coverages.push({
      originalStart: replacement.startOffset,
      originalEnd: replacement.endOffset,
      outputStart,
      outputEnd,
    });
    delta += replacement.nextText.length
      - (replacement.endOffset - replacement.startOffset);
    previousEnd = replacement.endOffset;
  }
  return coverages;
}

function domStructureOwnershipOutsideCoveragesMatches(
  expected: DomStructureSnapshot,
  actual: DomStructureSnapshot,
  coverages: ReadonlyArray<LogicalReplacementCoverage>,
): boolean {
  if (expected.records.length !== actual.records.length) return false;
  return expected.records.every((record, index) => {
    const current = actual.records[index];
    if (
      record.logicalStart === null
      || record.logicalEnd === null
      || current.logicalStart === null
      || current.logicalEnd === null
    ) return true;
    const originalStart = record.logicalStart;
    const originalEnd = record.logicalEnd;
    const outputBoundaryInterval = (
      offset: number,
      side: "start" | "end",
    ): { minimum: number; maximum: number } => {
      const candidates: Array<{ minimum: number; maximum: number }> = [];
      for (const coverage of coverages) {
        const collapsed = coverage.originalStart === coverage.originalEnd;
        const strictlyInside = coverage.originalStart < offset
          && offset < coverage.originalEnd;
        if (
          (collapsed && coverage.originalStart === offset)
          || strictlyInside
          || (side === "start" && coverage.originalStart === offset)
          || (side === "end" && coverage.originalEnd === offset)
        ) {
          candidates.push({
            minimum: coverage.outputStart,
            maximum: coverage.outputEnd,
          });
        } else if (side === "start" && coverage.originalEnd === offset) {
          candidates.push({
            minimum: coverage.outputEnd,
            maximum: coverage.outputEnd,
          });
        } else if (side === "end" && coverage.originalStart === offset) {
          candidates.push({
            minimum: coverage.outputStart,
            maximum: coverage.outputStart,
          });
        }
      }
      if (candidates.length > 0) {
        return {
          minimum: Math.min(...candidates.map(({ minimum }) => minimum)),
          maximum: Math.max(...candidates.map(({ maximum }) => maximum)),
        };
      }
      const mapped = offset + coverages.reduce((delta, coverage) => (
        coverage.originalEnd < offset
          ? delta + (coverage.outputEnd - coverage.outputStart)
            - (coverage.originalEnd - coverage.originalStart)
          : delta
      ), 0);
      return { minimum: mapped, maximum: mapped };
    };
    const startInterval = outputBoundaryInterval(originalStart, "start");
    const endInterval = outputBoundaryInterval(originalEnd, "end");
    return current.logicalStart >= startInterval.minimum
      && current.logicalStart <= startInterval.maximum
      && current.logicalEnd >= endInterval.minimum
      && current.logicalEnd <= endInterval.maximum;
  });
}

function structuralRecordMatches(
  expected: StructuralNodeRecord,
  actual: StructuralNodeRecord,
): boolean {
  return actual.node === expected.node
    && actual.parent === expected.parent
    && actual.nodeType === expected.nodeType
    && actual.namespaceURI === expected.namespaceURI
    && actual.localName === expected.localName
    && actual.nodeValue === expected.nodeValue
    && actual.attributes.length === expected.attributes.length
    && actual.attributes.every((value, attributeIndex) => (
      value === expected.attributes[attributeIndex]
    ));
}

function deletionFullyCoversRange(
  startOffset: number,
  endOffset: number,
  replacements: ReadonlyArray<{ startOffset: number; endOffset: number }>,
): boolean {
  let coveredUntil = startOffset;
  for (const replacement of [...replacements].sort((left, right) => (
    left.startOffset - right.startOffset
  ))) {
    if (replacement.endOffset <= coveredUntil) continue;
    if (replacement.startOffset > coveredUntil) return false;
    coveredUntil = Math.max(coveredUntil, replacement.endOffset);
    if (coveredUntil >= endOffset) return true;
  }
  return false;
}

function isProvablyDisposableMissingWrapper(
  record: StructuralNodeRecord,
  intents: NativeMutationIntent[],
  replacements: NativeTextReplacement[],
  canRemoveInlineWrapper: ((element: Element) => boolean) | undefined,
): boolean {
  const startOffset = record.logicalStart;
  const endOffset = record.logicalEnd;
  return record.nodeType === Node.ELEMENT_NODE
    && record.namespaceURI === "http://www.w3.org/1999/xhtml"
    && record.localName !== null
    && DISPOSABLE_INLINE_WRAPPER_TAGS.has(record.localName)
    && record.attributeNames.every((name) => (
      name === "style" || name === "data-html-ai-source-node-id"
    ))
    && Boolean(
      canRemoveInlineWrapper
      && canRemoveInlineWrapper(record.node as Element)
    )
    && startOffset !== null
    && endOffset !== null
    && endOffset > startOffset
    && intents.some((intent) => (
      classifyNativeInput(intent.inputType).category === "text"
      && deletionFullyCoversRange(startOffset, endOffset, intent.originalRanges)
    ))
    && deletionFullyCoversRange(startOffset, endOffset, replacements)
    && !replacements.some((replacement) => (
      replacement.nextText !== ""
      && (
        // An insertion strictly inside a removed wrapper would be written
        // back inside that source wrapper, so accepting its disappearance
        // would make the authored DOM and SourcePatch disagree. The exact
        // leading boundary is different: when the selection continues past
        // the wrapper, Chromium owns the inserted text from the surviving
        // preceding boundary and removes the now-empty wrapper.
        (
          replacement.startOffset > startOffset
          && replacement.startOffset < endOffset
        )
        || (
          replacement.startOffset === startOffset
          && replacement.endOffset <= endOffset
        )
      )
  ));
}

function isCompositionCoveredMissingWrapper(
  record: StructuralNodeRecord,
  authority: CompositionCommitAuthority,
  canRemoveInlineWrapper: ((element: Element) => boolean) | undefined,
): boolean {
  const startOffset = record.logicalStart;
  const endOffset = record.logicalEnd;
  return record.nodeType === Node.ELEMENT_NODE
    && record.namespaceURI === "http://www.w3.org/1999/xhtml"
    && record.localName !== null
    && DISPOSABLE_INLINE_WRAPPER_TAGS.has(record.localName)
    && record.attributeNames.every((name) => (
      name === "style" || name === "data-html-ai-source-node-id"
    ))
    && Boolean(
      canRemoveInlineWrapper
      && canRemoveInlineWrapper(record.node as Element)
    )
    && startOffset !== null
    && endOffset !== null
    && endOffset > startOffset
    && startOffset >= authority.originalStart
    && endOffset <= authority.originalEnd;
}

function isSafeCompositionTemporaryWrapper(
  record: StructuralNodeRecord,
  authority: CompositionCommitAuthority,
): boolean {
  const startOffset = record.logicalStart;
  const endOffset = record.logicalEnd;
  return record.nodeType === Node.ELEMENT_NODE
    && record.namespaceURI === "http://www.w3.org/1999/xhtml"
    && record.localName !== null
    && DISPOSABLE_INLINE_WRAPPER_TAGS.has(record.localName)
    // Start with the exact shape observed from Chromium/macOS. Attributes on
    // a browser-created wrapper are not needed to preserve text and would
    // broaden the trust boundary to author-controlled behavior or styling.
    && record.attributes.length === 0
    && startOffset !== null
    && endOffset !== null
    && endOffset > startOffset
    && startOffset >= authority.outputStart
    && endOffset <= authority.outputEnd;
}

function domStructureMatchesCompositionTemporaryTree(
  expected: DomStructureSnapshot,
  actual: DomStructureSnapshot,
  authority: CompositionCommitAuthority,
  canRemoveInlineWrapper: ((element: Element) => boolean) | undefined,
): boolean {
  const expectedByNode = new Map(expected.records.map((record) => [record.node, record]));
  const actualByNode = new Map(actual.records.map((record) => [record.node, record]));
  const added = actual.records.filter((record) => !expectedByNode.has(record.node));
  if (
    added.length === 0
    || added.some((record) => !isSafeCompositionTemporaryWrapper(record, authority))
  ) return false;
  const removed = expected.records.filter((record) => !actualByNode.has(record.node));
  if (removed.some((record) => !isCompositionCoveredMissingWrapper(
    record,
    authority,
    canRemoveInlineWrapper,
  ))) return false;

  // Removing temporary wrappers from the actual tree and covered authored
  // wrappers from the expected tree must reveal the exact same authored
  // elements in the same order, with the same identity, parent and attrs.
  // This rejects wrapping/moving any surviving authored element.
  const actualSurvivors = actual.records.filter((record) => expectedByNode.has(record.node));
  const expectedSurvivors = expected.records.filter((record) => actualByNode.has(record.node));
  if (
    actualSurvivors.length !== expectedSurvivors.length
    || expectedSurvivors.some((record, index) => (
      !structuralRecordMatches(record, actualSurvivors[index])
    ))
  ) return false;

  const survivorExpectedSnapshot = { records: expectedSurvivors };
  const survivorActualSnapshot = { records: actualSurvivors };
  return domStructureOwnershipOutsideCoveragesMatches(
    survivorExpectedSnapshot,
    survivorActualSnapshot,
    [{
      originalStart: authority.originalStart,
      originalEnd: authority.originalEnd,
      outputStart: authority.outputStart,
      outputEnd: authority.outputEnd,
    }],
  );
}

function domStructureSnapshotsMatchTextTransaction(
  expected: DomStructureSnapshot,
  actual: DomStructureSnapshot,
  intents: NativeMutationIntent[],
  replacements: NativeTextReplacement[],
  canRemoveInlineWrapper: ((element: Element) => boolean) | undefined,
  compositionAuthority?: CompositionCommitAuthority,
): boolean {
  if (domStructureSnapshotsMatch(expected, actual)) {
    // A script can move a Text node across an authored wrapper without
    // changing either the document's logical text or the non-text topology.
    // When the text tracker sees no replacement, wrapper ranges are the only
    // proof that text ownership (and therefore styling/source structure) did
    // not drift. Text-node split/merge keeps these ranges unchanged.
    if (replacements.length === 0) {
      return domStructureLogicalRangesMatch(expected, actual);
    }
    return domStructureOwnershipOutsideCoveragesMatches(
      expected,
      actual,
      replacementCoverages(replacements),
    );
  }
  if (
    intents.length === 0
    || replacements.length === 0
  ) return false;

  if (
    compositionAuthority
    && domStructureMatchesCompositionTemporaryTree(
      expected,
      actual,
      compositionAuthority,
      canRemoveInlineWrapper,
    )
  ) return true;

  const expectedByNode = new Map(expected.records.map((record) => [record.node, record]));
  if (actual.records.some((record) => !expectedByNode.has(record.node))) return false;
  const actualNodes = new Set(actual.records.map((record) => record.node));
  const missing = expected.records.filter((record) => !actualNodes.has(record.node));
  if (
    missing.length === 0
    || missing.some((record) => (
      !isProvablyDisposableMissingWrapper(
        record,
        intents,
        replacements,
        canRemoveInlineWrapper,
      )
    ))
  ) return false;

  const expectedSurvivors = expected.records.filter((record) => actualNodes.has(record.node));
  return actual.records.length === expectedSurvivors.length
    && expectedSurvivors.every((record, index) => (
      structuralRecordMatches(record, actual.records[index])
    ));
}

function restoreAuthoredAttributes(
  element: Element,
  savedAttributes: AuthoredAttribute[],
  preserveManagedAttributes = true,
): void {
  const savedKeys = new Set(savedAttributes.map((attribute) => (
    `${attribute.namespaceURI ?? ""}\u0000${attribute.qualifiedName}`
  )));
  for (const attribute of Array.from(element.attributes)) {
    if (preserveManagedAttributes && MANAGED_EDIT_ATTRIBUTE_NAMES.has(attribute.name)) continue;
    const key = `${attribute.namespaceURI ?? ""}\u0000${attribute.name}`;
    if (savedKeys.has(key)) continue;
    if (attribute.namespaceURI) {
      element.removeAttributeNS(attribute.namespaceURI, attribute.localName);
    } else {
      element.removeAttribute(attribute.name);
    }
  }
  for (const attribute of savedAttributes) {
    if (attribute.namespaceURI) {
      element.setAttributeNS(
        attribute.namespaceURI,
        attribute.qualifiedName,
        attribute.value,
      );
    } else {
      element.setAttribute(attribute.qualifiedName, attribute.value);
    }
  }
}

function captureRestorableDomNode(node: Node): RestorableDomNode {
  const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : null;
  const templateContent = element?.localName === "template"
    ? (element as HTMLTemplateElement).content
    : null;
  return {
    node,
    nodeValue: element ? null : node.nodeValue,
    attributes: element ? authoredAttributes(element) : null,
    children: Array.from(node.childNodes).map(captureRestorableDomNode),
    templateChildren: templateContent
      ? Array.from(templateContent.childNodes).map(captureRestorableDomNode)
      : null,
  };
}

function restoreRestorableDomNode(snapshot: RestorableDomNode): void {
  const { node } = snapshot;
  if (snapshot.attributes && node.nodeType === Node.ELEMENT_NODE) {
    restoreAuthoredAttributes(node as Element, snapshot.attributes, false);
  } else if (node.nodeValue !== snapshot.nodeValue) {
    node.nodeValue = snapshot.nodeValue;
  }
  for (const child of snapshot.children) restoreRestorableDomNode(child);
  if (node.nodeType === Node.ELEMENT_NODE) {
    (node as Element).replaceChildren(
      ...snapshot.children.map((child) => child.node),
    );
    if (snapshot.templateChildren) {
      const templateContent = (node as HTMLTemplateElement).content;
      for (const child of snapshot.templateChildren) restoreRestorableDomNode(child);
      templateContent.replaceChildren(
        ...snapshot.templateChildren.map((child) => child.node),
      );
    }
  }
}

export class NativeEditingController {
  readonly hostElement: HTMLElement;

  private baseline: NativeEditBaseline;

  private leaseStamp: NativeEditLeaseStamp;

  private readonly leaseIsCurrent: NativeEditLease["isCurrent"];

  private readonly leaseAdvance: NativeEditLease["advance"];

  private readonly tracker: NativeTextChangeTracker;

  private readonly transactionSelection = new NativeTransactionSelectionTracker();

  private readonly cleanup: Array<() => void> = [];

  private readonly onStateChange?: NativeEditingControllerOptions["onStateChange"];

  private readonly onBlur?: NativeEditingControllerOptions["onBlur"];

  private readonly onEscape?: NativeEditingControllerOptions["onEscape"];

  private readonly onUndo?: NativeEditingControllerOptions["onUndo"];

  private readonly onRedo?: NativeEditingControllerOptions["onRedo"];

  private readonly onUnsupportedInput?: NativeEditingControllerOptions["onUnsupportedInput"];

  private readonly onError?: NativeEditingControllerOptions["onError"];

  private readonly canRemoveInlineWrapper?: NativeEditingControllerOptions["canRemoveInlineWrapper"];

  private readonly onPendingCommandReady?: NativeEditingControllerOptions["onPendingCommandReady"];

  private readonly onShadowTrace?: NativeEditingControllerOptions["onShadowTrace"];

  private readonly blockDraft: NativeBlockEditDraft;

  private readonly originalAttributes: Record<string, SavedAttribute>;

  private readonly activeSessionAttributes: Record<string, SavedAttribute>;

  private baselineChildren: Node[];

  private baselineHostAttributes: AuthoredAttribute[];

  private domStructureSnapshot: DomStructureSnapshot;

  private ready = false;

  private disposed = false;

  private nextCompositionEpochId = 1;

  private compositionEpoch: CompositionEpoch | null = null;

  private requiresCanonicalReconcile = false;

  private restoringCompositionSnapshot = false;

  private compositionEndFocusGuardTimer: number | null = null;

  private compositionSettlingTimer: number | null = null;

  private compositionTerminalDeliveryTimer: number | null = null;

  private pendingCommandTimer: number | null = null;

  private compositionSettlingTaskTurn = 0;

  private compositionSettlingObservationRunning = false;

  private pendingCommandReadyScheduled = false;

  private explicitFallbackCommandSequence: number | null = null;

  private lastInputType: string | null = null;

  private mutationObserver: MutationObserver | null = null;

  private nativeMutationWindow = false;

  private nativeMutationValidated = false;

  private nativeMutationObserved = false;

  private expectedMutationWindow = false;

  private mutationWindowTimer: number | null = null;

  private nativeMutationIntents: NativeMutationIntent[] = [];

  private pendingNativeCandidate: PendingNativeCandidate | null = null;

  /** Last DOM state proved by a complete input/composition delivery. */
  private lastValidatedSnapshot: CompositionSnapshot | null = null;

  /** Frozen before an IME can apply caret gravity at an inline boundary. */
  private ambiguousCompositionOrigin = false;

  /** Drains late platform events from an IME epoch PageRoot blocked safely. */
  private blockedAmbiguousCompositionEpochId: number | null = null;

  private unauthorizedDomDrift = false;

  private stateFrame: number | null = null;

  private get composing(): boolean {
    return this.compositionEpoch?.phase === "composing"
      && leaseStampsMatch(this.compositionEpoch.lease, this.leaseStamp);
  }

  private get compositionSnapshot(): CompositionSnapshot | null {
    const epoch = this.compositionEpoch;
    return epoch && leaseStampsMatch(epoch.lease, this.leaseStamp)
      ? epoch.snapshot
      : null;
  }

  private get compositionCommitAuthority(): CompositionCommitAuthority | null {
    return this.compositionEpoch?.phase === "settling"
      && leaseStampsMatch(this.compositionEpoch.lease, this.leaseStamp)
      ? this.compositionEpoch.commitAuthority
      : null;
  }

  private get discardCompositionOnEnd(): boolean {
    return this.compositionEpoch?.phase === "composing"
      && leaseStampsMatch(this.compositionEpoch.lease, this.leaseStamp)
      && this.compositionEpoch.cancelRequested;
  }

  private get cancelledCompositionTombstone(): boolean {
    return this.compositionEpoch?.phase === "settling"
      && leaseStampsMatch(this.compositionEpoch.lease, this.leaseStamp)
      && this.compositionEpoch.cancelled;
  }

  private get cancelledCompositionDeliveryPending(): boolean {
    return this.compositionEpoch?.phase === "settling"
      && leaseStampsMatch(this.compositionEpoch.lease, this.leaseStamp)
      && this.compositionEpoch.cancelled
      && this.compositionEpoch.lateDeliveryPending;
  }

  private get compositionEndFocusGuard(): boolean {
    return this.compositionEpoch?.phase === "settling"
      && leaseStampsMatch(this.compositionEpoch.lease, this.leaseStamp)
      && this.compositionEpoch.focusGuard;
  }

  private get compositionDeliveryPending(): boolean {
    return this.compositionEpoch?.phase === "settling"
      && leaseStampsMatch(this.compositionEpoch.lease, this.leaseStamp)
      && Boolean(this.compositionEpoch.pendingTerminal);
  }

  private get draftCompositionUnsettled(): boolean {
    const guard = this.currentDraftCompositionGuard();
    return guard?.phase === "composing" || guard?.phase === "settling";
  }

  private externalLeaseIsCurrent(stamp: NativeEditLeaseStamp): boolean {
    try {
      return this.leaseIsCurrent(stamp);
    } catch {
      return false;
    }
  }

  private isLeaseStampCurrent(stamp: NativeEditLeaseStamp): boolean {
    return !this.disposed
      && leaseStampsMatch(this.leaseStamp, stamp)
      && this.externalLeaseIsCurrent(stamp);
  }

  private hasCurrentLease(): boolean {
    return this.isLeaseStampCurrent(this.leaseStamp);
  }

  private canHandleEvent(event: Event): boolean {
    if (this.hasCurrentLease()) return true;
    event.preventDefault();
    return false;
  }

  private callbackIfCurrent(callback: (() => void) | undefined): void {
    if (this.hasCurrentLease()) callback?.();
  }

  private unsupportedInputIfCurrent(inputType: string): void {
    if (this.hasCurrentLease()) this.onUnsupportedInput?.(inputType);
  }

  private reportErrorIfCurrent(error: Error): void {
    if (this.hasCurrentLease()) this.onError?.(error);
  }

  private draftCompositionId(epoch: CompositionEpoch | null = this.compositionEpoch): string | null {
    if (!epoch || !leaseStampsMatch(epoch.lease, this.leaseStamp)) return null;
    return `composition_${epoch.id}`;
  }

  private draftSnapshot(): NativeBlockEditDraftSnapshot<unknown> {
    return this.blockDraft.snapshot();
  }

  private currentDraftCompositionGuard() {
    const snapshot = this.draftSnapshot();
    const compositionId = this.draftCompositionId();
    return compositionId && snapshot.compositionGuard?.compositionId === compositionId
      ? snapshot.compositionGuard
      : null;
  }

  private beginDraftComposition(): void {
    const compositionId = this.draftCompositionId();
    if (!compositionId) return;
    this.blockDraft.beginComposition({
      lease: this.leaseStamp,
      compositionId,
      selection: this.getSelection(),
    });
  }

  private endDraftComposition(): void {
    const compositionId = this.draftCompositionId();
    if (!compositionId) return;
    const guard = this.currentDraftCompositionGuard();
    if (guard?.phase !== "composing") return;
    this.blockDraft.endComposition({
      lease: this.leaseStamp,
      compositionId,
    });
  }

  private cancelDraftComposition(): void {
    const compositionId = this.draftCompositionId();
    if (!compositionId) return;
    const guard = this.currentDraftCompositionGuard();
    if (!guard || guard.phase === "cancelled") return;
    if (guard.phase !== "stable") {
      this.blockDraft.cancelComposition({
        lease: this.leaseStamp,
        compositionId,
      });
    }
  }

  private discardDraftProvisionalComposition(): boolean {
    const compositionId = this.draftCompositionId();
    if (!compositionId) return false;
    const discarded = this.blockDraft.discardProvisionalComposition({
      lease: this.leaseStamp,
      compositionId,
    });
    return discarded.accepted;
  }

  private acknowledgeDraftComposition(): void {
    const compositionId = this.draftCompositionId();
    const guard = this.currentDraftCompositionGuard();
    if (
      !compositionId
      || (guard?.phase !== "stable" && guard?.phase !== "cancelled")
    ) return;
    this.blockDraft.acknowledgeComposition({
      lease: this.leaseStamp,
      compositionId,
    });
  }

  private recordDraftOwnedMutation(reason: string): void {
    const guard = this.currentDraftCompositionGuard();
    this.blockDraft.recordOwnedMutation({
      lease: this.leaseStamp,
      compositionId: guard ? guard.compositionId : null,
      reason,
    });
  }

  private recordDraftOwnedText(evidence: "input" | "composition"): void {
    const guard = this.currentDraftCompositionGuard();
    const result = this.blockDraft.recordOwnedText({
      lease: this.leaseStamp,
      text: this.hasBrowserEmptyHostPlaceholder()
        ? ""
        : nativeLogicalText(this.hostElement),
      selection: this.getSelection(),
      evidence,
      compositionId: guard ? guard.compositionId : null,
    });
    if (!result.accepted) return;
    const strictText = this.tracker.value();
    const draftText = this.draftSnapshot().currentText;
    if (strictText !== draftText) {
      this.onShadowTrace?.({
        code: guard ? "composition-shadow-pending" : "strict-draft-text-mismatch",
        strictText,
        draftText,
        lease: cloneLeaseStamp(this.leaseStamp),
      });
    }
  }

  private hasStableDraftComposition(): boolean {
    const guard = this.currentDraftCompositionGuard();
    return guard?.phase === "stable" && guard.fallbackAuthorized;
  }

  private draftCompositionOwnsProvisionalDom(): boolean {
    const guard = this.currentDraftCompositionGuard();
    return Boolean(
      guard
      && (guard.phase === "settling" || guard.phase === "stable")
      && this.compositionEpoch?.phase === "settling"
      && !this.compositionEpoch.cancelled
      && !this.compositionEpoch.commitAuthority,
    );
  }

  private retireDomOnlyProvisionalBeforeComposition(): boolean {
    const epoch = this.compositionEpoch?.phase === "settling"
      ? this.compositionEpoch
      : null;
    if (
      !epoch
      || epoch.cancelled
      || epoch.commitAuthority
      || epoch.compositionInputDelivered
      || !this.draftCompositionOwnsProvisionalDom()
    ) return true;

    // A second compositionstart is not source authority for an earlier
    // DOM-only candidate. Restore and retire that whole provisional epoch
    // before capturing the next one, otherwise the new snapshot would inherit
    // DOM text that NativeTextChangeTracker has never accepted.
    this.clearCompositionTerminalDeliveryTimer();
    this.clearCompositionSettlingTimer();
    const restored = this.restoreCompositionSnapshot();
    this.finishNativeMutationWindow();
    return restored
      && this.compositionEpoch === null
      && this.currentDraftCompositionGuard() === null;
  }

  private notifyPendingCommandReady(): void {
    if (
      this.pendingCommandReadyScheduled
      || !this.draftSnapshot().pendingCommand
      || !this.hasCurrentLease()
      || this.compositionDeliveryPending
    ) return;
    const guard = this.currentDraftCompositionGuard();
    if (guard && guard.phase !== "stable" && guard.phase !== "cancelled") return;
    this.pendingCommandReadyScheduled = true;
    const lease = cloneLeaseStamp(this.leaseStamp);
    window.queueMicrotask(() => {
      this.pendingCommandReadyScheduled = false;
      if (!this.isLeaseStampCurrent(lease)) return;
      const currentGuard = this.currentDraftCompositionGuard();
      if (
        this.compositionDeliveryPending
        || (currentGuard
          && currentGuard.phase !== "stable"
          && currentGuard.phase !== "cancelled")
      ) return;
      this.onPendingCommandReady?.();
    });
  }

  private clearCompositionSettlingTimer(): void {
    if (this.compositionSettlingTimer === null) return;
    window.clearTimeout(this.compositionSettlingTimer);
    this.compositionSettlingTimer = null;
  }

  private clearCompositionTerminalDeliveryTimer(): void {
    if (this.compositionTerminalDeliveryTimer === null) return;
    window.clearTimeout(this.compositionTerminalDeliveryTimer);
    this.compositionTerminalDeliveryTimer = null;
  }

  private scheduleCompositionSettling(): void {
    if (!this.hasCurrentLease()) return;
    const epoch = this.compositionEpoch?.phase === "settling"
      ? this.compositionEpoch
      : null;
    const compositionId = this.draftCompositionId(epoch);
    const guard = this.currentDraftCompositionGuard();
    if (
      !epoch
      || !compositionId
      || !guard
      || (guard.phase !== "settling" && guard.phase !== "stable")
    ) return;
    this.clearCompositionSettlingTimer();
    const lease = cloneLeaseStamp(this.leaseStamp);
    const observe = (taskTurn: number) => {
      if (
        !this.isLeaseStampCurrent(lease)
        || this.draftCompositionId() !== compositionId
      ) return false;
      this.compositionSettlingObservationRunning = true;
      try {
        this.flushPendingMutationRecords();
      } finally {
        this.compositionSettlingObservationRunning = false;
      }
      const result = this.blockDraft.observeSettling({
        lease,
        compositionId,
        text: this.hasBrowserEmptyHostPlaceholder()
          ? ""
          : nativeLogicalText(this.hostElement),
        selection: this.getSelection(),
        taskTurn,
      });
      if (!result.accepted) return false;
      if (result.stable) {
        this.finishNativeMutationWindow();
        this.emitState();
        this.notifyPendingCommandReady();
        return true;
      }
      return false;
    };

    const firstTurn = ++this.compositionSettlingTaskTurn;
    window.queueMicrotask(() => {
      if (observe(firstTurn)) return;
      const secondTurn = ++this.compositionSettlingTaskTurn;
      const timer = window.setTimeout(() => {
        if (this.compositionSettlingTimer !== timer) return;
        this.compositionSettlingTimer = null;
        observe(secondTurn);
      }, 0);
      this.compositionSettlingTimer = timer;
    });
  }

  private clearPendingCommandTimer(): void {
    if (this.pendingCommandTimer === null) return;
    window.clearTimeout(this.pendingCommandTimer);
    this.pendingCommandTimer = null;
  }

  private schedulePendingCommandCancellation(): void {
    this.clearPendingCommandTimer();
    const lease = cloneLeaseStamp(this.leaseStamp);
    const compositionId = this.draftCompositionId();
    if (!compositionId) {
      this.notifyPendingCommandReady();
      return;
    }
    const timer = window.setTimeout(() => {
      if (this.pendingCommandTimer !== timer) return;
      this.pendingCommandTimer = null;
      if (
        !this.isLeaseStampCurrent(lease)
        || this.draftCompositionId() !== compositionId
        || this.hasStableDraftComposition()
      ) {
        this.notifyPendingCommandReady();
        return;
      }
      const epoch = this.compositionEpoch;
      if (epoch?.phase === "composing") {
        this.compositionEpoch = {
          lease: epoch.lease,
          id: epoch.id,
          phase: "settling",
          snapshot: epoch.snapshot,
          cancelled: false,
          focusGuard: true,
          lateDeliveryPending: false,
          compositionInputDelivered: epoch.compositionInputDelivered,
          pendingTerminal: null,
          commitAuthority: null,
        };
        this.endDraftComposition();
      }
      this.blockDraft.markCompositionTimeout({ lease, compositionId });
      this.cancelDraftComposition();
      if (this.restoreCompositionSnapshot(true)) {
        this.establishCancelledCompositionTombstone();
      } else {
        this.restoreLastValidatedSnapshot();
      }
      this.finishNativeMutationWindow();
      this.emitState();
      this.notifyPendingCommandReady();
    }, PENDING_COMPOSITION_COMMAND_GRACE_MS);
    this.pendingCommandTimer = timer;
  }

  constructor(options: NativeEditingControllerOptions) {
    this.hostElement = options.hostElement;
    this.baseline = options.baseline;
    this.leaseStamp = cloneLeaseStamp(options.lease.stamp);
    this.leaseIsCurrent = options.lease.isCurrent;
    this.leaseAdvance = options.lease.advance;
    if (!this.externalLeaseIsCurrent(this.leaseStamp)) {
      throw new Error("编辑会话已失效，已停止直接编辑。");
    }
    this.tracker = new NativeTextChangeTracker(options.baseline.text);
    this.onStateChange = options.onStateChange;
    this.onBlur = options.onBlur;
    this.onEscape = options.onEscape;
    this.onUndo = options.onUndo;
    this.onRedo = options.onRedo;
    this.onUnsupportedInput = options.onUnsupportedInput;
    this.onError = options.onError;
    this.canRemoveInlineWrapper = options.canRemoveInlineWrapper;
    this.onPendingCommandReady = options.onPendingCommandReady;
    this.onShadowTrace = options.onShadowTrace;
    this.blockDraft = new NativeBlockEditDraft({
      lease: this.leaseStamp,
      baselineText: options.baseline.text,
      baselineSelection: options.baseline.selection ?? {
        anchor: options.baseline.text.length,
        focus: options.baseline.text.length,
        affinity: "right",
      },
      formatSkeleton: options.formatSkeleton ?? null,
    });
    this.originalAttributes = Object.fromEntries(
      SESSION_CONTROLLED_ATTRIBUTE_NAMES.map((name) => (
        [name, savedAttribute(this.hostElement, name)]
      )),
    );
    this.baselineChildren = this.cloneChildren();
    this.baselineHostAttributes = authoredAttributes(this.hostElement, true);
    this.domStructureSnapshot = captureDomStructure(this.hostElement);

    const actualText = nativeLogicalText(this.hostElement);
    if (actualText !== options.baseline.text) {
      throw new Error("真实 DOM 文字与源码映射不一致，已停止直接编辑。");
    }

    this.hostElement.setAttribute("data-html-canvas-native-editing", "true");
    this.hostElement.setAttribute("contenteditable", "plaintext-only");
    this.hostElement.setAttribute("role", "textbox");
    this.hostElement.setAttribute("aria-multiline", "true");
    this.hostElement.setAttribute("aria-label", options.ariaLabel || "原位编辑文字");
    this.hostElement.setAttribute("autocapitalize", "off");
    this.hostElement.setAttribute("autocomplete", "off");
    this.hostElement.setAttribute("data-gramm", "false");
    this.hostElement.spellcheck = true;
    if (this.hostElement.tabIndex < 0) this.hostElement.tabIndex = 0;
    this.activeSessionAttributes = Object.fromEntries(
      SESSION_CONTROLLED_ATTRIBUTE_NAMES.map((name) => (
        [name, savedAttribute(this.hostElement, name)]
      )),
    );
    this.domStructureSnapshot = captureDomStructure(this.hostElement);

    const documentNode = this.hostElement.ownerDocument;
    const MutationObserverConstructor = documentNode.defaultView?.MutationObserver;
    if (!MutationObserverConstructor) {
      for (const [name, saved] of Object.entries(this.originalAttributes)) {
        restoreAttribute(this.hostElement, name, saved);
      }
      throw new Error("当前页面无法监测文字变化，已停止直接编辑。");
    }
    this.mutationObserver = new MutationObserverConstructor((records) => {
      if (!this.hasCurrentLease()) return;
      this.handleObservedMutations(records);
    });
    this.mutationObserver.observe(this.hostElement, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
    });
    const onBeforeInput = (event: InputEvent) => this.handleBeforeInput(event);
    const onInput = (event: Event) => this.handleInput(event as InputEvent);
    const onPaste = (event: ClipboardEvent) => this.handlePaste(event);
    const onCompositionStart = (event: CompositionEvent) => {
      if (!this.canHandleEvent(event)) return;
      if (this.requiresCanonicalReconcile) {
        event.preventDefault();
        return;
      }
      if (this.blockedAmbiguousCompositionEpochId !== null) {
        this.blockedAmbiguousCompositionEpochId = null;
        this.acknowledgeDraftComposition();
        this.compositionEpoch = null;
        this.finishNativeMutationWindow();
      }
      if (!this.retireDomOnlyProvisionalBeforeComposition()) {
        event.preventDefault();
        return;
      }
      this.clearCompositionEndFocusGuard();
      this.clearCancelledCompositionTombstone();
      this.resolveNativeDeliveryBeforeComposition();
      this.ambiguousCompositionOrigin = insertionTargetsAmbiguousInlineBoundary(
        this.hostElement,
        null,
      );
      this.captureCompositionSnapshot();
      this.beginDraftComposition();
      this.openNativeMutationWindow();
      this.beginNativeCandidate("insertCompositionText");
      this.captureNativeMutationIntent(null, "insertCompositionText");
      this.emitState();
    };
    const onCompositionEnd = (event: CompositionEvent) => {
      if (!this.canHandleEvent(event)) return;
      if (
        !this.compositionEpoch
        || !leaseStampsMatch(this.compositionEpoch.lease, this.leaseStamp)
      ) return;
      if (this.composing && this.ambiguousCompositionOrigin) {
        this.cancelAmbiguousBoundaryComposition();
        this.unsupportedInputIfCurrent("insertAtAmbiguousInlineBoundary");
        return;
      }
      if (this.cancelledCompositionTombstone) {
        this.restoreCompositionSnapshot(true);
        if (this.nativeMutationWindow) {
          this.nativeMutationValidated = true;
          this.closeMutationWindowAfterDelivery();
        }
        return;
      }
      this.ambiguousCompositionOrigin = false;
      if (this.compositionEpoch?.phase === "settling") {
        // macOS input methods and browser bridges may repeat compositionend
        // after the accepted value has already been delivered. A repeated end
        // event has no new cancelable beforeinput range and therefore cannot
        // start, reject, or rewind an epoch. If late DOM drift accompanies it,
        // restore the last fully validated value (which includes the accepted
        // composition), never the older composition-start snapshot.
        if (
          this.compositionEpoch.commitAuthority
          && !this.compositionAuthorityTextMatchesDom()
        ) {
          this.markUnauthorizedDomDrift(
            "输入法完成后文字又发生了变化，已恢复到上一次安全内容。",
          );
          this.restoreLastValidatedSnapshot();
          this.finishNativeMutationWindow();
        }
        return;
      }
      const activeEpoch = this.compositionEpoch?.phase === "composing"
        ? this.compositionEpoch
        : null;
      const matchingCandidate = (
        activeEpoch
        && this.nativeMutationWindow
      ) ? this.pendingNativeCandidate : null;
      const cancelRequested = activeEpoch?.cancelRequested ?? false;
      if (activeEpoch) {
        this.compositionEpoch = {
          lease: activeEpoch.lease,
          id: activeEpoch.id,
          phase: "settling",
          snapshot: activeEpoch.snapshot,
          cancelled: false,
          focusGuard: false,
          lateDeliveryPending: false,
          compositionInputDelivered: activeEpoch.compositionInputDelivered,
          pendingTerminal: activeEpoch.pendingTerminal,
          commitAuthority: activeEpoch.commitAuthority,
        };
        this.endDraftComposition();
      }
      this.openCompositionEndFocusGuard();
      let cancelled = false;
      let awaitingTerminalInput = false;
      if (cancelRequested) {
        cancelled = this.restoreCompositionSnapshot(true);
      } else if (!matchingCandidate) {
        cancelled = this.rejectCompositionEpoch(
          "输入法事件没有完整开始，本次文字没有保存，已恢复原内容。",
        );
      } else if (
        event.data === ""
        && !activeEpoch?.commitAuthority
        && !activeEpoch?.pendingTerminal
      ) {
        const snapshot = this.compositionSnapshot;
        const finalText = this.hasBrowserEmptyHostPlaceholder()
          ? ""
          : nativeLogicalText(this.hostElement);
        if (
          snapshot
          && matchingCandidate
          && finalText !== snapshot.text
          && !activeEpoch?.compositionInputDelivered
        ) {
          // Some macOS bridges mutate the authored DOM but omit every input
          // delivery before an empty compositionend. Keep only that DOM-only
          // result as provisional evidence. Once any composition input was
          // delivered, an empty end is cancellation and must restore the
          // frozen selection instead. The provisional path gains no source
          // authority until two stable observations and a later explicit
          // command pass the source-owned FormatSkeleton.
          this.recordDraftOwnedMutation("empty-compositionend-provisional-dom");
          this.nativeMutationValidated = true;
          this.scheduleCompositionSettling();
          this.emitState();
          return;
        }
        // Empty end without a changed, isolated candidate remains Escape or
        // cancellation and restores only this composition's start snapshot.
        this.cancelDraftComposition();
        cancelled = this.restoreCompositionSnapshot(true);
      } else {
        const snapshot = this.compositionSnapshot;
        const pendingTerminal = activeEpoch?.pendingTerminal ?? null;
        const terminalMismatch = Boolean(
          event.data
          && pendingTerminal
          && event.data !== pendingTerminal.data
        );
        const committedData = event.data
          || activeEpoch?.commitAuthority?.data
          || pendingTerminal?.data
          || "";
        const originalStart = snapshot
          ? Math.min(snapshot.selection.anchor, snapshot.selection.focus)
          : -1;
        const originalEnd = snapshot
          ? Math.max(snapshot.selection.anchor, snapshot.selection.focus)
          : -1;
        const expectedText = snapshot
          ? `${snapshot.text.slice(0, originalStart)}${committedData}${snapshot.text.slice(originalEnd)}`
          : null;
        const terminalTextMatches = Boolean(
          snapshot
          && nativeLogicalText(this.hostElement) === expectedText
        );
        if (!snapshot || terminalMismatch || !committedData) {
          cancelled = this.rejectCompositionEpoch(
            "输入法最终文字超出了开始选区，本次文字没有保存，已恢复原内容。",
          );
        } else {
          if (this.compositionEpoch?.phase === "settling") {
            this.compositionEpoch = {
              ...this.compositionEpoch,
              commitAuthority: {
                intentStart: snapshot.nativeMutationIntentLength,
                originalStart,
                originalEnd,
                outputStart: originalStart,
                outputEnd: originalStart + committedData.length,
                data: committedData,
              },
            };
          }
          // beforeinput is only an announcement. Empty compositionend cannot
          // promote it, and a non-empty end whose DOM mutation is still due
          // must also wait for the matching input event. A bounded delivery
          // watchdog restores the epoch if that required input never arrives.
          awaitingTerminalInput = Boolean(
            pendingTerminal
            && !activeEpoch?.commitAuthority
            && (event.data === "" || !terminalTextMatches)
          );
          if (!awaitingTerminalInput && !terminalTextMatches) {
            cancelled = this.rejectCompositionEpoch(
              "输入法最终文字超出了开始选区，本次文字没有保存，已恢复原内容。",
            );
          } else if (
            !awaitingTerminalInput
            && this.compositionEpoch?.phase === "settling"
          ) {
            this.compositionEpoch = {
              ...this.compositionEpoch,
              pendingTerminal: pendingTerminal && !activeEpoch?.commitAuthority
                ? { ...pendingTerminal, required: false }
                : null,
            };
          }
        }
        if (awaitingTerminalInput) {
          this.schedulePendingCompositionTerminalWatchdog();
          this.emitState();
          return;
        }
        if (!this.nativeMutationWindow) return;
        if (cancelled) {
          // rejectCompositionEpoch already restored the pre-composition DOM.
        } else if (nativeLogicalText(this.hostElement) === matchingCandidate.startText) {
          this.discardPendingNativeCandidate();
          this.updateFromDom();
        } else if (this.updateFromDom()) {
          this.promoteNativeCandidate(this.lastInputType || "insertCompositionText");
        }
      }
      if (!this.nativeMutationWindow) return;
      if (cancelled) this.establishCancelledCompositionTombstone();
      // A successful non-empty composition also keeps its start snapshot until
      // the same-task focus guard closes. A focusout delivered immediately
      // after compositionend is not an explicit acceptance and must restore
      // only the composition, not erase an earlier uncheckpointed edit.
      this.nativeMutationValidated = true;
      if (
        this.compositionEpoch?.phase === "settling"
        && this.compositionEpoch.pendingTerminal
      ) {
        this.schedulePendingCompositionTerminalWatchdog();
      } else {
        this.closeMutationWindowAfterDelivery();
      }
    };
    const onSelectionChange = () => {
      if (!this.hasCurrentLease()) return;
      const selection = documentNode.getSelection();
      if (
        selection?.anchorNode
        && (
          selection.anchorNode === this.hostElement
          || this.hostElement.contains(selection.anchorNode)
        )
      ) this.emitState();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!this.canHandleEvent(event)) return;
      if (event.key !== "Escape") return;
      const compositionWasActive = this.composing;
      if (this.consumeCompositionEscape()) {
        // Some macOS IMEs expose compositionend before the keydown for the
        // Escape that closed the candidate window. Consume that trailing key;
        // it must not become PageRoot's separate "leave edit mode" command.
        // While composition is still live, do not prevent the native action:
        // the platform IME still owns Escape and must close its candidate UI.
        if (!compositionWasActive) event.preventDefault();
        return;
      }
      event.preventDefault();
      this.callbackIfCurrent(this.onEscape);
    };
    const onFocusOut = (event: FocusEvent) => {
      if (!this.canHandleEvent(event)) return;
      const relatedTarget = event.relatedTarget;
      if (
        relatedTarget
        && typeof relatedTarget === "object"
        && "nodeType" in relatedTarget
        && this.hostElement.contains(relatedTarget as Node)
      ) return;
      this.failClosedCompositionForFocusLoss();
      this.callbackIfCurrent(this.onBlur);
    };
    const onWindowBlur = (event: Event) => {
      if (!this.canHandleEvent(event)) return;
      this.failClosedCompositionForFocusLoss();
    };
    const preventDrop = (event: DragEvent) => {
      if (!this.canHandleEvent(event)) return;
      event.preventDefault();
    };
    const preventDragStart = (event: DragEvent) => {
      if (!this.canHandleEvent(event)) return;
      event.preventDefault();
    };

    this.hostElement.addEventListener("beforeinput", onBeforeInput);
    this.hostElement.addEventListener("input", onInput);
    this.hostElement.addEventListener("paste", onPaste);
    this.hostElement.addEventListener("compositionstart", onCompositionStart);
    this.hostElement.addEventListener("compositionend", onCompositionEnd);
    this.hostElement.addEventListener("keydown", onKeyDown);
    this.hostElement.addEventListener("focusout", onFocusOut);
    this.hostElement.addEventListener("drop", preventDrop);
    this.hostElement.addEventListener("dragstart", preventDragStart);
    documentNode.addEventListener("selectionchange", onSelectionChange);
    documentNode.defaultView?.addEventListener("blur", onWindowBlur);
    this.cleanup.push(() => this.hostElement.removeEventListener("beforeinput", onBeforeInput));
    this.cleanup.push(() => this.hostElement.removeEventListener("input", onInput));
    this.cleanup.push(() => this.hostElement.removeEventListener("paste", onPaste));
    this.cleanup.push(() => this.hostElement.removeEventListener("compositionstart", onCompositionStart));
    this.cleanup.push(() => this.hostElement.removeEventListener("compositionend", onCompositionEnd));
    this.cleanup.push(() => this.hostElement.removeEventListener("keydown", onKeyDown));
    this.cleanup.push(() => this.hostElement.removeEventListener("focusout", onFocusOut));
    this.cleanup.push(() => this.hostElement.removeEventListener("drop", preventDrop));
    this.cleanup.push(() => this.hostElement.removeEventListener("dragstart", preventDragStart));
    this.cleanup.push(() => documentNode.removeEventListener("selectionchange", onSelectionChange));
    this.cleanup.push(() => documentNode.defaultView?.removeEventListener("blur", onWindowBlur));
    this.ready = true;
    if (options.baseline.selection) setSelectionValue(this.hostElement, options.baseline.selection);
    this.refreshLastValidatedSnapshot();
    this.emitState();
  }

  private handleBeforeInput(event: InputEvent): void {
    if (!this.canHandleEvent(event)) return;
    if (this.isBlockedAmbiguousCompositionDelivery(event)) {
      event.preventDefault();
      if (this.compositionEpoch?.phase === "settling") {
        this.compositionEpoch = {
          ...this.compositionEpoch,
          lateDeliveryPending: true,
        };
      }
      return;
    }
    if (this.blockedAmbiguousCompositionEpochId !== null) {
      // A normal, new gesture after the same-task IME drain owns a fresh
      // transaction. Retire the blocked tombstone rather than letting it be
      // mistaken for an accepted settling composition.
      this.blockedAmbiguousCompositionEpochId = null;
      this.acknowledgeDraftComposition();
      this.compositionEpoch = null;
      this.finishNativeMutationWindow();
    }
    if (
      this.composing
      && this.ambiguousCompositionOrigin
      && COLLAPSED_TEXT_INSERT_INPUT_TYPES.has(event.inputType)
    ) {
      event.preventDefault();
      this.cancelAmbiguousBoundaryComposition();
      this.unsupportedInputIfCurrent("insertAtAmbiguousInlineBoundary");
      return;
    }
    if (
      this.draftCompositionOwnsProvisionalDom()
      && this.isCompositionDeliveryType(event.inputType)
      && (
        event.inputType !== "insertText"
        || event.isComposing
        || this.compositionEndFocusGuard
      )
    ) {
      // A late IME tail can restart the stable-observation barrier, but it is
      // not promoted into the strict tracker merely because beforeinput fired.
      this.openNativeMutationWindow();
      return;
    }
    if (this.isMatchingCompositionCommitEvent(event)) {
      // Some engines expose a final insertFromComposition/insertText delivery
      // after compositionend. It belongs to the same epoch and must neither
      // create a second transaction nor be blocked while the provisional DOM
      // is waiting for canonical reconciliation.
      this.openNativeMutationWindow();
      return;
    }
    // A generic insertText is ambiguous once the same-task end guard expires:
    // it is then a real new keystroke, not a late composition delivery.
    // Composition-specific input types remain safe to drain from the
    // long-lived cancellation tombstone.
    const revivesCancelledCommit = (
      this.cancelledCompositionTombstone
      && this.isNonEmptyCompositionDelivery(event)
      && (
        event.inputType !== "insertText"
        || this.compositionEndFocusGuard
      )
    );
    if (revivesCancelledCommit) {
      this.reviveCancelledCompositionCommit(event.data!);
    }
    if (this.requiresCanonicalReconcile) {
      // A browser-created provisional wrapper must first complete the single
      // SourcePatch -> canonical DOM -> runtime rebind transaction. Never let
      // a second input inherit or mutate that temporary tree.
      event.preventDefault();
      return;
    }
    if (
      this.compositionEpoch?.phase === "settling"
      && this.compositionEpoch.pendingTerminal
      && !revivesCancelledCommit
    ) {
      // A required terminal input still owns provisional marked-text DOM, so
      // fail closed. If non-empty compositionend already proved and accepted
      // the value, retire only its optional late-tail drain and let the new
      // gesture begin normally.
      if (this.compositionEpoch.pendingTerminal.required) {
        this.rejectCompositionEpoch(
          "输入法没有完成上一段文字，请点回文字后重新输入。",
        );
        this.finishNativeMutationWindow();
        event.preventDefault();
        return;
      }
      this.compositionEpoch = {
        ...this.compositionEpoch,
        pendingTerminal: null,
      };
      this.clearCompositionTerminalDeliveryTimer();
      this.finishNativeMutationWindow();
      this.notifyPendingCommandReady();
    }
    if (
      this.compositionEpoch?.phase === "settling"
      && this.compositionEpoch.commitAuthority
      && !this.compositionEpoch.cancelled
      && !revivesCancelledCommit
    ) {
      // This is a genuinely new operation, not a terminal delivery from the
      // preceding IME epoch. Retire that epoch before collecting new intent.
      this.acknowledgeDraftComposition();
      this.compositionEpoch = null;
    }
    if (
      this.cancelledCompositionTombstone
      && this.isCancelledCompositionTombstoneEvent(event)
    ) {
      if (this.compositionEpoch?.phase === "settling") {
        this.compositionEpoch = {
          ...this.compositionEpoch,
          lateDeliveryPending: true,
        };
      }
      event.preventDefault();
      return;
    }
    // Any explicitly new ordinary input owns a new transaction epoch. It is
    // the durable boundary that retires a cancelled-composition tombstone.
    this.clearCancelledCompositionTombstone();
    if (this.compositionEndFocusGuard) this.clearCompositionEndFocusGuard();
    const input = classifyNativeInput(event.inputType);
    const insertedText = event.data
      ?? event.dataTransfer?.getData("text/plain")
      ?? "";
    if (
      event.inputType.startsWith("insert")
      && /[\r\n]/u.test(insertedText)
    ) {
      event.preventDefault();
      this.unsupportedInputIfCurrent("insertFromPasteMultiline");
      return;
    }
    if (input.category === "history") {
      event.preventDefault();
      if (input.action === "redo") this.callbackIfCurrent(this.onRedo);
      else this.callbackIfCurrent(this.onUndo);
      return;
    }
    if (!input.supported) {
      event.preventDefault();
      this.unsupportedInputIfCurrent(event.inputType || "unknown");
      return;
    }
    if (event.inputType === "insertFromDrop") {
      event.preventDefault();
      this.unsupportedInputIfCurrent(event.inputType);
      return;
    }
    if (
      !this.composing
      && COLLAPSED_TEXT_INSERT_INPUT_TYPES.has(event.inputType)
      && insertionTargetsAmbiguousInlineBoundary(this.hostElement, event)
    ) {
      event.preventDefault();
      this.unsupportedInputIfCurrent("insertAtAmbiguousInlineBoundary");
      this.emitState();
      return;
    }
    this.capturePendingCompositionTerminal(event);
    if (this.handleComplexGraphemeDeletion(event)) return;
    if (!this.openNativeMutationWindow()) {
      event.preventDefault();
      return;
    }
    this.beginNativeCandidate(event.inputType || "unknown");
    this.captureNativeMutationIntent(event, event.inputType || "unknown");
  }

  private beginNativeCandidate(inputType: string): void {
    if (!this.hasCurrentLease()) return;
    if (!this.pendingNativeCandidate) {
      this.pendingNativeCandidate = {
        lease: this.leaseStamp,
        announcedInputTypes: new Set(),
        currentRanges: [],
        intentStart: this.nativeMutationIntents.length,
        previousInputType: this.lastInputType,
        startSelection: this.getSelection(),
        startText: nativeLogicalText(this.hostElement),
      };
      this.transactionSelection.freeze(this.getSelection());
    }
    this.pendingNativeCandidate.announcedInputTypes.add(inputType);
    this.lastInputType = inputType || this.lastInputType;
  }

  private promoteNativeCandidate(inputType: string | null): void {
    if (
      this.pendingNativeCandidate
      && !leaseStampsMatch(this.pendingNativeCandidate.lease, this.leaseStamp)
    ) return;
    if (inputType) this.lastInputType = inputType;
    this.pendingNativeCandidate = null;
  }

  private discardPendingNativeCandidate(): void {
    const pending = this.pendingNativeCandidate;
    if (!pending) return;
    if (!leaseStampsMatch(pending.lease, this.leaseStamp)) return;
    this.nativeMutationIntents.splice(pending.intentStart);
    this.lastInputType = pending.previousInputType;
    this.pendingNativeCandidate = null;
    if (!this.tracker.dirty()) this.transactionSelection.rebase();
  }

  private captureNativeMutationIntent(
    event: InputEvent | null,
    inputType: string,
  ): void {
    const targetOffsets: Array<{ startOffset: number; endOffset: number }> = [];
    if (event && typeof event.getTargetRanges === "function") {
      for (const range of event.getTargetRanges()) {
        const startOffset = logicalOffsetForDomPoint(
          this.hostElement,
          range.startContainer,
          range.startOffset,
        );
        const endOffset = logicalOffsetForDomPoint(
          this.hostElement,
          range.endContainer,
          range.endOffset,
        );
        if (startOffset !== null && endOffset !== null) {
          targetOffsets.push({
            startOffset: Math.min(startOffset, endOffset),
            endOffset: Math.max(startOffset, endOffset),
          });
        }
      }
    }
    if (targetOffsets.length === 0) {
      const selection = this.getSelection();
      const selectionStart = Math.min(selection.anchor, selection.focus);
      const selectionEnd = Math.max(selection.anchor, selection.focus);
      const deletion = selectionStart === selectionEnd
        && (
          inputType === "deleteContentBackward"
          || inputType === "deleteContentForward"
        )
        ? graphemeDeletionRange(
          this.pendingNativeCandidate?.startText ?? nativeLogicalText(this.hostElement),
          selectionStart,
          inputType,
        )
        : null;
      targetOffsets.push(deletion ?? {
        startOffset: selectionStart,
        endOffset: selectionEnd,
      });
    }
    for (const { startOffset, endOffset } of targetOffsets) {
      const candidate = this.pendingNativeCandidate;
      if (candidate && !candidate.currentRanges.some((range) => (
        range.startOffset === startOffset && range.endOffset === endOffset
      ))) {
        candidate.currentRanges.push({ startOffset, endOffset });
      }
      let originalRanges: Array<{ startOffset: number; endOffset: number }> = [];
      try {
        originalRanges = endOffset === startOffset
          ? [{ startOffset, endOffset }]
          : this.tracker.originalRangesForCurrentRange(
            startOffset,
            endOffset,
          );
      } catch {
        // A composition update may expose offsets for its transient marked
        // text before the tracker accepts the final value. compositionstart
        // has already captured the source-backed pre-mutation range.
        continue;
      }
      this.storeNativeMutationIntent(inputType, originalRanges);
    }
  }

  private storeNativeMutationIntent(
    inputType: string,
    originalRanges: Array<{ startOffset: number; endOffset: number }>,
  ): void {
    if (originalRanges.length === 0) return;
    const duplicate = this.nativeMutationIntents.some((intent) => (
      intent.inputType === inputType
      && JSON.stringify(intent.originalRanges) === JSON.stringify(originalRanges)
    ));
    if (!duplicate) this.nativeMutationIntents.push({ inputType, originalRanges });
  }

  private handleComplexGraphemeDeletion(event: InputEvent): boolean {
    if (!this.canHandleEvent(event)) return true;
    if (
      this.composing
      || (
        event.inputType !== "deleteContentBackward"
        && event.inputType !== "deleteContentForward"
      )
    ) return false;
    const selection = this.getSelection();
    if (selection.anchor !== selection.focus) return false;
    const currentText = nativeLogicalText(this.hostElement);
    const deletion = complexGraphemeDeletionRange(
      currentText,
      selection.focus,
      event.inputType,
    );
    if (!deletion) return false;
    const start = domPointForLogicalOffset(
      this.hostElement,
      deletion.startOffset,
      "right",
    );
    const end = domPointForLogicalOffset(
      this.hostElement,
      deletion.endOffset,
      "left",
    );
    // Keep the correction deliberately narrow: PageRoot performs the delete
    // only when the whole grapheme lives in one authored Text node. Chromium
    // may otherwise delete only one code unit across inline boundaries and
    // leave an orphan combining mark, ZWJ, or surrogate. Fail closed before
    // the DOM changes; the user can select the whole visible cluster instead.
    if (
      start.node !== end.node
      || start.node.nodeType !== Node.TEXT_NODE
    ) {
      event.preventDefault();
      this.unsupportedInputIfCurrent("deleteComplexGraphemeAcrossInlineBoundary");
      this.emitState();
      return true;
    }

    event.preventDefault();
    if (!this.openNativeMutationWindow()) return true;
    this.beginNativeCandidate(event.inputType);
    if (this.pendingNativeCandidate) {
      this.pendingNativeCandidate.currentRanges = [{
        startOffset: deletion.startOffset,
        endOffset: deletion.endOffset,
      }];
    }
    try {
      this.storeNativeMutationIntent(
        event.inputType,
        this.tracker.originalRangesForCurrentRange(
          deletion.startOffset,
          deletion.endOffset,
        ),
      );
      const range = this.hostElement.ownerDocument.createRange();
      range.setStart(start.node, start.offset);
      range.setEnd(end.node, end.offset);
      range.deleteContents();
      setSelectionValue(this.hostElement, {
        anchor: deletion.startOffset,
        focus: deletion.startOffset,
        affinity: "left",
      });
      if (!this.updateFromDom()) {
        this.finishNativeMutationWindow();
        return true;
      }
      this.promoteNativeCandidate(event.inputType);
      this.nativeMutationValidated = true;
      this.closeMutationWindowAfterDelivery();
      return true;
    } catch (cause) {
      this.reportErrorIfCurrent(errorFrom(cause));
      this.restoreLastValidatedSnapshot();
      this.finishNativeMutationWindow();
      return true;
    }
  }

  private handlePaste(event: ClipboardEvent): void {
    if (!this.canHandleEvent(event)) return;
    const plainText = event.clipboardData?.getData("text/plain") ?? "";
    if (!/[\r\n]/u.test(plainText)) return;
    // A multiline plaintext paste makes Chromium synthesize child blocks in a
    // plaintext-only host. PageRoot cannot losslessly map that transient
    // structure back to an existing text island, so reject the whole gesture
    // at the clipboard event, before the DOM or Selection can move.
    event.preventDefault();
    this.unsupportedInputIfCurrent("insertFromPasteMultiline");
    this.emitState();
  }

  private handleInput(event: InputEvent): void {
    if (!this.canHandleEvent(event)) return;
    if (this.isBlockedAmbiguousCompositionDelivery(event)) {
      this.restoreCompositionSnapshot(true);
      if (this.compositionEpoch?.phase === "settling") {
        this.compositionEpoch = {
          ...this.compositionEpoch,
          lateDeliveryPending: false,
        };
      }
      return;
    }
    if (
      this.compositionEpoch?.phase === "composing"
      && this.isCompositionDeliveryType(event.inputType)
    ) {
      this.compositionEpoch = {
        ...this.compositionEpoch,
        compositionInputDelivered: true,
      };
    }
    const settlingEpoch = this.compositionEpoch?.phase === "settling"
      && !this.compositionEpoch.cancelled
      && this.isCompositionDeliveryType(event.inputType)
      ? this.compositionEpoch
      : null;
    if (
      settlingEpoch
      && !settlingEpoch.commitAuthority
      && this.draftCompositionOwnsProvisionalDom()
    ) {
      // A few macOS IME bridges deliver a late provisional input without a
      // matching beforeinput after the first stable observation pair. Re-open
      // ownership only when beforeinput did not already do so; otherwise the
      // MutationObserver record from this same delivery would be classified as
      // unowned after scheduleCompositionSettling closed the previous window.
      if (!this.nativeMutationWindow && !this.openNativeMutationWindow()) return;
      this.recordDraftOwnedText("composition");
      this.nativeMutationValidated = true;
      this.scheduleCompositionSettling();
      this.emitState();
      return;
    }
    if (settlingEpoch) {
      // Once compositionend has frozen the accepted range/value, the DOM is
      // the authority for draining the platform's optional final input tail.
      // Apple and third-party IMEs may omit data or normalize its inputType;
      // requiring an exact event payload would route that harmless tail into
      // the ordinary-input rollback lane and erase earlier accepted typing.
      if (
        !settlingEpoch.commitAuthority
        || !this.compositionAuthorityTextMatchesDom()
      ) {
        this.rejectCompositionEpoch(
          "输入法最终文字超出了开始选区，本次文字没有保存，已恢复原内容。",
        );
        this.finishNativeMutationWindow();
        return;
      }
      this.compositionEpoch = {
        ...settlingEpoch,
        pendingTerminal: null,
      };
      this.clearCompositionTerminalDeliveryTimer();
      if (nativeLogicalText(this.hostElement) !== this.tracker.value()) {
        if (!this.updateFromDom()) {
          this.rejectCompositionEpoch(
            "输入法最终文字超出了开始选区，本次文字没有保存，已恢复原内容。",
          );
          this.finishNativeMutationWindow();
          return;
        }
        if (this.pendingNativeCandidate) {
          this.promoteNativeCandidate(event.inputType || this.lastInputType);
        }
      }
      this.nativeMutationValidated = true;
      this.closeMutationWindowAfterDelivery();
      this.emitState();
      this.notifyPendingCommandReady();
      return;
    }
    if (this.isMatchingCompositionCommitEvent(event)) {
      if (!this.compositionAuthorityTextMatchesDom()) {
        this.rejectCompositionEpoch(
          "输入法最终文字超出了开始选区，本次文字没有保存，已恢复原内容。",
        );
        this.finishNativeMutationWindow();
        return;
      }
      if (this.compositionEpoch?.phase === "settling") {
        this.compositionEpoch = {
          ...this.compositionEpoch,
          pendingTerminal: null,
        };
        this.clearCompositionTerminalDeliveryTimer();
      }
      if (this.updateFromDom() && this.pendingNativeCandidate) {
        this.promoteNativeCandidate(event.inputType || this.lastInputType);
      }
      this.nativeMutationValidated = true;
      this.closeMutationWindowAfterDelivery();
      this.notifyPendingCommandReady();
      return;
    }
    if (
      this.cancelledCompositionTombstone
      && this.isCancelledCompositionTombstoneEvent(event)
    ) {
      const snapshot = this.compositionSnapshot;
      if (snapshot && nativeLogicalText(this.hostElement) !== snapshot.text) {
        this.restoreCompositionSnapshot(true);
      }
      if (this.compositionEpoch?.phase === "settling") {
        this.compositionEpoch = {
          ...this.compositionEpoch,
          lateDeliveryPending: false,
        };
      }
      return;
    }
    this.clearCancelledCompositionTombstone();
    if (this.compositionEndFocusGuard) this.clearCompositionEndFocusGuard();
    if (!this.composing) {
      if (!this.nativeMutationWindow || !this.pendingNativeCandidate) {
        // input is not cancelable and carries no browser transaction identity.
        // Without a current-lease beforeinput candidate it may be a delayed
        // tail from the retired source revision. Drop it here; any accompanying
        // DOM mutation is independently rejected by MutationObserver and by
        // captureCheckpoint's tracker/DOM equality wall.
        return;
      }
      const candidate = this.pendingNativeCandidate;
      if (!leaseStampsMatch(candidate.lease, this.leaseStamp)) return;
      if (!candidate.announcedInputTypes.has(event.inputType)) {
        this.markUnauthorizedDomDrift(
          "输入开始和完成的操作类型不一致，本次文字没有保存，已恢复原内容。",
        );
        this.restoreLastValidatedSnapshot();
        this.finishNativeMutationWindow();
        return;
      }
      this.lastInputType = event.inputType || this.lastInputType;
      if (nativeLogicalText(this.hostElement) === candidate.startText) {
        this.discardPendingNativeCandidate();
        this.updateFromDom();
      } else if (this.updateFromDom()) {
        this.promoteNativeCandidate(event.inputType || this.lastInputType);
      }
      this.nativeMutationValidated = true;
    } else if (event.inputType) {
      this.lastInputType = event.inputType;
      this.capturePreEndCompositionCommit(event);
    }
    if (!this.composing) this.closeMutationWindowAfterDelivery();
  }

  private handleObservedMutations(records: MutationRecord[]): void {
    if (!this.hasCurrentLease() || records.length === 0) return;
    if (this.restoringCompositionSnapshot) return;
    if (this.expectedMutationWindow) return;
    const hasSessionAttributeMutation = records.some((record) => (
      record.type === "attributes"
      && record.target === this.hostElement
      && Boolean(
        record.attributeName
        && SESSION_CONTROLLED_ATTRIBUTE_NAME_SET.has(record.attributeName)
      )
    ));
    if (hasSessionAttributeMutation && !this.activeSessionAttributesMatch()) {
      this.blockDraft.poison({
        lease: this.leaseStamp,
        reason: "session-attribute-mutation",
      });
      this.markUnauthorizedDomDrift(
        "编辑状态被页面改变，本次文字没有保存，已恢复可编辑状态。",
      );
      this.restoreLastValidatedSnapshot();
      return;
    }
    if (
      this.cancelledCompositionTombstone
      && this.cancelledCompositionDeliveryPending
    ) {
      const hasSourceContentMutation = records.some((record) => (
        record.type !== "attributes"
        || !record.attributeName
        || record.target !== this.hostElement
        || !MANAGED_EDIT_ATTRIBUTE_NAMES.has(record.attributeName)
      ));
      if (hasSourceContentMutation) {
        this.restoreCompositionSnapshot(true);
        if (this.compositionEpoch?.phase === "settling") {
          this.compositionEpoch = {
            ...this.compositionEpoch,
            lateDeliveryPending: false,
          };
        }
      }
      return;
    }
    if (this.nativeMutationWindow) {
      this.nativeMutationObserved = true;
      this.recordDraftOwnedMutation(
        this.currentDraftCompositionGuard()
          ? "composition-dom-mutation"
          : "native-input-dom-mutation",
      );
      if (this.draftCompositionOwnsProvisionalDom()) {
        // During the bounded settling barrier MutationObserver supplies only
        // in-island evidence. It never updates source or broadens the allowed
        // logical range; FormatSkeleton remains the final authority.
        return;
      }
      // Clipboard and IME delivery may expose the browser's DOM mutation to
      // MutationObserver before the matching input/compositionend handler has
      // advanced NativeTextChangeTracker. Before validation, defer. Once the
      // final event has validated, prove the DOM again so a later microtask
      // cannot hide behind the delivery window.
      if (this.composing || !this.nativeMutationValidated) return;
      const currentText = this.hasBrowserEmptyHostPlaceholder()
        ? ""
        : nativeLogicalText(this.hostElement);
      if (currentText !== this.tracker.value()) {
        this.markUnauthorizedDomDrift(
          "输入完成后页面文字又发生了变化，本次文字没有保存，已恢复原内容。",
        );
        this.restoreLastValidatedSnapshot();
        return;
      }
      this.ensureDomStructureIntegrity(this.tracker.replacements());
      return;
    }
    const hasSourceContentMutation = records.some((record) => (
      record.type !== "attributes"
      || !record.attributeName
      || record.target !== this.hostElement
      || !MANAGED_EDIT_ATTRIBUTE_NAMES.has(record.attributeName)
    ));
    if (!hasSourceContentMutation) return;
    this.blockDraft.recordUnownedMutation({
      lease: this.leaseStamp,
      reason: "mutation-outside-native-delivery",
    });
    this.markUnauthorizedDomDrift(
      "页面内容在编辑之外发生了变化，已停止写入以保护源文件。",
    );
    // Do not leave a visually drifted host alive until a later checkpoint.
    // A queued source commit could otherwise win the race and rebase this
    // unauthorized DOM as if it belonged to the preceding input.
    this.restoreLastValidatedSnapshot();
  }

  private markUnauthorizedDomDrift(message: string): void {
    if (!this.hasCurrentLease() || this.unauthorizedDomDrift) return;
    this.unauthorizedDomDrift = true;
    this.reportErrorIfCurrent(new Error(message));
  }

  private rejectCompositionEpoch(message: string): boolean {
    if (!this.hasCurrentLease()) return false;
    this.clearCompositionTerminalDeliveryTimer();
    const epoch = this.compositionEpoch;
    this.cancelDraftComposition();
    this.markUnauthorizedDomDrift(message);
    if (!epoch) {
      this.restoreLastValidatedSnapshot();
      return false;
    }
    if (epoch.phase === "composing") {
      this.compositionEpoch = {
        lease: epoch.lease,
        id: epoch.id,
        phase: "settling",
        snapshot: epoch.snapshot,
        cancelled: false,
        focusGuard: true,
        lateDeliveryPending: false,
        compositionInputDelivered: epoch.compositionInputDelivered,
        pendingTerminal: null,
        commitAuthority: null,
      };
    }
    if (!this.restoreCompositionSnapshot(true)) {
      this.restoreLastValidatedSnapshot();
      return false;
    }
    this.establishCancelledCompositionTombstone();
    this.emitState();
    return true;
  }

  private activeSessionAttributesMatch(): boolean {
    if (!this.hasCurrentLease()) return false;
    return SESSION_CONTROLLED_ATTRIBUTE_NAMES.every((name) => {
      const expected = this.activeSessionAttributes[name];
      return this.hostElement.hasAttribute(name) === expected.present
        && (!expected.present || this.hostElement.getAttribute(name) === expected.value);
    });
  }

  private hasBrowserEmptyHostPlaceholder(): boolean {
    if (!this.hasCurrentLease()) return false;
    // Chromium keeps the caret visible after deleting all text by inserting a
    // single, attribute-free <br>. It is browser UI state rather than authored
    // structure. Removing this exact UI placeholder is only normalization;
    // ensureDomStructureIntegrity still proves any authored wrappers that also
    // disappeared against the final replacements and transaction intents.
    const children = Array.from(this.hostElement.childNodes);
    const placeholder = children.find((node) => node.nodeType === Node.ELEMENT_NODE);
    if (
      !placeholder
      || children.filter((node) => node.nodeType === Node.ELEMENT_NODE).length !== 1
      || (placeholder as Element).localName !== "br"
      || (placeholder as Element).attributes.length !== 0
      || placeholder.childNodes.length !== 0
      || children.some((node) => (
        node !== placeholder
        && (node.nodeType !== Node.TEXT_NODE || (node as Text).data !== "")
      ))
      || this.hostElement.textContent !== ""
    ) return false;
    return true;
  }

  private normalizeBrowserEmptyHostPlaceholder(): boolean {
    if (!this.hasCurrentLease()) return false;
    if (!this.hasBrowserEmptyHostPlaceholder()) return false;
    this.runExpectedMutation(() => {
      this.hostElement.replaceChildren();
      const selection = this.hostElement.ownerDocument.getSelection();
      const range = this.hostElement.ownerDocument.createRange();
      range.selectNodeContents(this.hostElement);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    });
    this.unauthorizedDomDrift = false;
    return true;
  }

  private ensureDomStructureIntegrity(
    replacements = this.tracker.replacements(),
  ): boolean {
    if (!this.hasCurrentLease()) return false;
    this.normalizeBrowserEmptyHostPlaceholder();
    const actualStructure = captureDomStructure(this.hostElement);
    // Text-node split/merge is deliberately absent from DomStructureSnapshot.
    // Any other authored topology, comment, element identity/parent, or
    // authored-attribute difference requires a canonical island rebuild after
    // SourcePatch, even when the change is a browser behavior we can prove and
    // accept (for example an IME wrapper or a fully consumed inline wrapper).
    if (!domStructureSnapshotsMatch(this.domStructureSnapshot, actualStructure)) {
      this.requiresCanonicalReconcile = true;
    }
    const compositionAuthority = this.compositionCommitAuthority;
    const compositionSnapshot = this.compositionSnapshot;
    let structureMatches = false;
    if (compositionAuthority && compositionSnapshot) {
      const compositionStartMatchesSession = domStructureSnapshotsMatchTextTransaction(
        this.domStructureSnapshot,
        compositionSnapshot.structure,
        this.nativeMutationIntents.slice(
          0,
          compositionSnapshot.nativeMutationIntentLength,
        ),
        compositionSnapshot.replacements,
        this.canRemoveInlineWrapper,
      );
      const compositionReplacement: NativeTextReplacement = {
        startOffset: compositionAuthority.originalStart,
        endOffset: compositionAuthority.originalEnd,
        beforeText: compositionSnapshot.text.slice(
          compositionAuthority.originalStart,
          compositionAuthority.originalEnd,
        ),
        nextText: compositionAuthority.data,
      };
      structureMatches = compositionStartMatchesSession
        && domStructureSnapshotsMatchTextTransaction(
          compositionSnapshot.structure,
          actualStructure,
          [{
            inputType: this.lastInputType || "insertCompositionText",
            originalRanges: [{
              startOffset: compositionAuthority.originalStart,
              endOffset: compositionAuthority.originalEnd,
            }],
          }],
          [compositionReplacement],
          this.canRemoveInlineWrapper,
          compositionAuthority,
        );
    } else {
      // Every completed input since the current SourcePatch baseline remains
      // part of one cumulative native transaction. Older accepted intents are
      // therefore still required to prove wrappers legitimately removed by a
      // prior gesture while a later keystroke is delivered before checkpoint.
      structureMatches = domStructureSnapshotsMatchTextTransaction(
        this.domStructureSnapshot,
        actualStructure,
        this.nativeMutationIntents,
        replacements,
        this.canRemoveInlineWrapper,
      );
    }
    if (
      !this.unauthorizedDomDrift
      && this.activeSessionAttributesMatch()
      && structureMatches
    ) {
      return true;
    }
    if (compositionSnapshot) {
      this.rejectCompositionEpoch(
        "输入过程中网页结构发生了变化，本次文字没有保存，已恢复原内容。",
      );
    } else {
      this.markUnauthorizedDomDrift(
        "输入过程中网页结构发生了变化，本次文字没有保存，已恢复原内容。",
      );
      this.restoreLastValidatedSnapshot();
    }
    return false;
  }

  private flushPendingMutationRecords(): void {
    if (!this.hasCurrentLease()) return;
    this.handleObservedMutations(this.mutationObserver?.takeRecords() ?? []);
  }

  private finishNativeMutationWindow(): void {
    this.clearMutationWindowTimer();
    this.nativeMutationWindow = false;
    this.nativeMutationValidated = false;
    this.nativeMutationObserved = false;
  }

  private rejectUnfinishedNativeDelivery(): void {
    if (this.compositionSnapshot) {
      this.rejectCompositionEpoch(
        "浏览器没有完成这次输入，本次文字没有保存，已恢复原内容。",
      );
    } else {
      this.markUnauthorizedDomDrift(
        "浏览器没有完成这次输入，本次文字没有保存，已恢复原内容。",
      );
      this.restoreLastValidatedSnapshot();
    }
    this.finishNativeMutationWindow();
  }

  private resolveNativeDeliveryBeforeComposition(): void {
    if (!this.nativeMutationWindow) return;
    if (
      this.compositionEpoch?.phase === "settling"
      && this.compositionEpoch.pendingTerminal?.required
    ) {
      this.rejectUnfinishedNativeDelivery();
      return;
    }
    this.flushPendingMutationRecords();
    if (!this.nativeMutationValidated && this.nativeMutationObserved) {
      this.rejectUnfinishedNativeDelivery();
      return;
    }
    if (!this.nativeMutationValidated) this.discardPendingNativeCandidate();
    this.finishNativeMutationWindow();
  }

  private openNativeMutationWindow(): boolean {
    if (!this.hasCurrentLease()) return false;
    if (this.nativeMutationWindow) this.flushPendingMutationRecords();
    if (
      this.nativeMutationWindow
      && !this.composing
      && !this.nativeMutationValidated
      && this.nativeMutationObserved
    ) {
      // A second ordinary beforeinput cannot complete or authorize an older
      // DOM mutation whose own input event never arrived.
      this.rejectUnfinishedNativeDelivery();
      return false;
    }
    if (
      this.nativeMutationWindow
      && !this.composing
      && !this.nativeMutationValidated
    ) {
      // The prior candidate produced no DOM/input. Replace it rather than
      // carrying its range authority or input metadata into this gesture.
      this.discardPendingNativeCandidate();
    }
    const continuesUnfinishedDelivery = (
      this.nativeMutationWindow
      && !this.nativeMutationValidated
    );
    this.nativeMutationWindow = true;
    this.nativeMutationValidated = false;
    // A second beforeinput can arrive while the first is still waiting for its
    // input event. Preserve mutation evidence across that overlap so the new
    // watchdog cannot launder the first orphan DOM change as a valid edit.
    if (!continuesUnfinishedDelivery) this.nativeMutationObserved = false;
    this.clearMutationWindowTimer();
    // beforeinput is cancelable and normally followed by input in the same
    // browser task, but scripts/browser edge cases may omit input entirely.
    // Schedule the watchdog now so such a window can neither remain open nor
    // hide an illegal structural mutation indefinitely.
    // Use PageRoot's controller realm rather than the preview iframe's timer
    // queue. The iframe may be replaced or throttled while feedback renders;
    // source checkpoint timers live in this outer realm as well.
    const lease = this.leaseStamp;
    const timer = window.setTimeout(() => {
      if (this.mutationWindowTimer !== timer) return;
      this.mutationWindowTimer = null;
      if (!this.isLeaseStampCurrent(lease) || !this.nativeMutationWindow) return;
      // Composition is a multi-event transaction. Its final value is proved
      // by compositionend (or rolled back by the existing focus-loss guard).
      if (this.composing) return;
      if (this.draftCompositionOwnsProvisionalDom()) {
        this.scheduleCompositionSettling();
        return;
      }
      if (
        this.compositionEpoch?.phase === "settling"
        && this.compositionEpoch.pendingTerminal
      ) {
        this.rejectCompositionEpoch(
          "浏览器没有完成输入法的最终输入，本次文字没有保存，已恢复输入前内容。",
        );
        this.finishNativeMutationWindow();
        return;
      }
      this.flushPendingMutationRecords();
      const observedMutationWithoutInput = this.nativeMutationObserved;
      // beforeinput only announces a candidate operation. Without its input
      // completion event, even a structurally valid text mutation is not an
      // accepted user transaction and must never reach SourcePatch/history.
      if (observedMutationWithoutInput) {
        this.markUnauthorizedDomDrift(
          "浏览器没有完成这次输入，本次文字没有保存，已恢复原内容。",
        );
        if (this.compositionSnapshot) {
          this.rejectCompositionEpoch(
            "浏览器没有完成这次输入，本次文字没有保存，已恢复原内容。",
          );
        } else {
          this.restoreLastValidatedSnapshot();
        }
      } else {
        this.discardPendingNativeCandidate();
      }
      this.finishNativeMutationWindow();
    }, 0);
    this.mutationWindowTimer = timer;
    return true;
  }

  private closeMutationWindowAfterDelivery(): void {
    if (!this.hasCurrentLease()) return;
    this.clearMutationWindowTimer();
    const lease = this.leaseStamp;
    const timer = window.setTimeout(() => {
      if (this.mutationWindowTimer !== timer) return;
      this.mutationWindowTimer = null;
      if (!this.isLeaseStampCurrent(lease)) return;
      this.flushPendingMutationRecords();
      this.finishNativeMutationWindow();
    }, 0);
    this.mutationWindowTimer = timer;
  }

  private schedulePendingCompositionTerminalWatchdog(): void {
    if (!this.hasCurrentLease()) return;
    this.clearCompositionTerminalDeliveryTimer();
    this.clearMutationWindowTimer();
    const lease = this.leaseStamp;
    const epoch = this.compositionEpoch?.phase === "settling"
      ? this.compositionEpoch
      : null;
    if (!epoch?.pendingTerminal) return;
    const epochId = epoch.id;
    const timer = window.setTimeout(() => {
      if (this.compositionTerminalDeliveryTimer !== timer) return;
      this.compositionTerminalDeliveryTimer = null;
      if (
        !this.isLeaseStampCurrent(lease)
        || this.compositionEpoch?.phase !== "settling"
        || this.compositionEpoch.id !== epochId
        || !this.compositionEpoch.pendingTerminal
      ) return;
      if (this.compositionEpoch.pendingTerminal.required) {
        this.rejectCompositionEpoch(
          "浏览器没有完成输入法的最终输入，本次文字没有保存，已恢复输入前内容。",
        );
      } else {
        this.compositionEpoch = {
          ...this.compositionEpoch,
          pendingTerminal: null,
        };
      }
      this.finishNativeMutationWindow();
      this.emitState();
      this.notifyPendingCommandReady();
    }, COMPOSITION_TERMINAL_DELIVERY_GRACE_MS);
    this.compositionTerminalDeliveryTimer = timer;
  }

  private clearMutationWindowTimer(): void {
    if (this.mutationWindowTimer === null) return;
    window.clearTimeout(this.mutationWindowTimer);
    this.mutationWindowTimer = null;
  }

  private isBlockedAmbiguousCompositionDelivery(event: InputEvent): boolean {
    const epoch = this.compositionEpoch;
    if (
      this.blockedAmbiguousCompositionEpochId === null
      || epoch?.phase !== "settling"
      || epoch.id !== this.blockedAmbiguousCompositionEpochId
      || !this.isCompositionDeliveryType(event.inputType)
    ) return false;
    return event.inputType !== "insertText"
      || event.isComposing
      || this.compositionEndFocusGuard;
  }

  private cancelAmbiguousBoundaryComposition(): void {
    const epoch = this.compositionEpoch;
    this.ambiguousCompositionOrigin = false;
    if (epoch?.phase !== "composing") return;
    this.compositionEpoch = {
      lease: epoch.lease,
      id: epoch.id,
      phase: "settling",
      snapshot: epoch.snapshot,
      cancelled: false,
      focusGuard: true,
      lateDeliveryPending: false,
      compositionInputDelivered: epoch.compositionInputDelivered,
      pendingTerminal: null,
      commitAuthority: null,
    };
    this.blockedAmbiguousCompositionEpochId = epoch.id;
    this.openCompositionEndFocusGuard();
    if (this.restoreCompositionSnapshot(true)) {
      this.establishCancelledCompositionTombstone();
    } else {
      this.restoreLastValidatedSnapshot();
    }
    this.finishNativeMutationWindow();
    this.emitState();
  }

  private isCancelledCompositionTombstoneEvent(event: InputEvent): boolean {
    return (
      event.inputType === "insertCompositionText"
      || event.inputType === "insertFromComposition"
      || event.inputType === "deleteByComposition"
    ) && (event.data === null || event.data === "");
  }

  private isCompositionDeliveryType(inputType: string): boolean {
    return inputType === "insertCompositionText"
      || inputType === "insertFromComposition"
      || inputType === "insertText"
      || inputType === "deleteByComposition";
  }

  private isNonEmptyCompositionDelivery(event: InputEvent): boolean {
    return this.isCompositionDeliveryType(event.inputType)
      && typeof event.data === "string"
      && event.data.length > 0;
  }

  private capturePendingCompositionTerminal(event: InputEvent): void {
    const epoch = this.compositionEpoch?.phase === "composing"
      ? this.compositionEpoch
      : null;
    if (
      !epoch
      || event.isComposing
      || (
        event.inputType !== "insertText"
        && event.inputType !== "insertFromComposition"
      )
      || typeof event.data !== "string"
      || event.data.length === 0
    ) return;
    this.compositionEpoch = {
      ...epoch,
      pendingTerminal: {
        data: event.data,
        inputType: event.inputType,
        required: true,
      },
    };
  }

  private capturePreEndCompositionCommit(event: InputEvent): void {
    const epoch = this.compositionEpoch?.phase === "composing"
      ? this.compositionEpoch
      : null;
    const data = event.data;
    if (
      !epoch
      || event.isComposing
      || (
        event.inputType !== "insertText"
        && event.inputType !== "insertFromComposition"
      )
      || typeof data !== "string"
      || data.length === 0
      || (
        epoch.pendingTerminal
        && (
          epoch.pendingTerminal.data !== data
          || epoch.pendingTerminal.inputType !== event.inputType
        )
      )
    ) return;
    const originalStart = Math.min(
      epoch.snapshot.selection.anchor,
      epoch.snapshot.selection.focus,
    );
    const originalEnd = Math.max(
      epoch.snapshot.selection.anchor,
      epoch.snapshot.selection.focus,
    );
    const expectedText = `${epoch.snapshot.text.slice(0, originalStart)}`
      + `${data}${epoch.snapshot.text.slice(originalEnd)}`;
    if (nativeLogicalText(this.hostElement) !== expectedText) return;
    this.compositionEpoch = {
      ...epoch,
      pendingTerminal: null,
      commitAuthority: {
        intentStart: epoch.snapshot.nativeMutationIntentLength,
        originalStart,
        originalEnd,
        outputStart: originalStart,
        outputEnd: originalStart + data.length,
        data,
      },
    };
  }

  private isMatchingCompositionCommitEvent(event: InputEvent): boolean {
    const authority = this.compositionCommitAuthority;
    const epoch = this.compositionEpoch?.phase === "settling"
      ? this.compositionEpoch
      : null;
    const pendingTerminal = epoch?.pendingTerminal ?? null;
    return Boolean(
      authority
      && this.isCompositionDeliveryType(event.inputType)
      && event.data === authority.data
      && (
        event.inputType !== "insertText"
        || this.compositionEndFocusGuard
        || (
          pendingTerminal?.inputType === event.inputType
          && pendingTerminal.data === event.data
        )
      )
      && (
        !pendingTerminal
        || (
          pendingTerminal.inputType === event.inputType
          && pendingTerminal.data === event.data
        )
      )
    );
  }

  private reviveCancelledCompositionCommit(data: string): void {
    const epoch = this.compositionEpoch;
    if (epoch?.phase !== "settling" || !epoch.cancelled) return;
    const originalStart = Math.min(
      epoch.snapshot.selection.anchor,
      epoch.snapshot.selection.focus,
    );
    const originalEnd = Math.max(
      epoch.snapshot.selection.anchor,
      epoch.snapshot.selection.focus,
    );
    this.compositionEpoch = {
      ...epoch,
      cancelled: false,
      lateDeliveryPending: false,
      commitAuthority: {
        intentStart: epoch.snapshot.nativeMutationIntentLength,
        originalStart,
        originalEnd,
        outputStart: originalStart,
        outputEnd: originalStart + data.length,
        data,
      },
    };
  }

  private compositionAuthorityTextMatchesDom(): boolean {
    const authority = this.compositionCommitAuthority;
    const snapshot = this.compositionSnapshot;
    if (!authority || !snapshot) return false;
    const expectedText = `${snapshot.text.slice(0, authority.originalStart)}`
      + `${authority.data}${snapshot.text.slice(authority.originalEnd)}`;
    return nativeLogicalText(this.hostElement) === expectedText;
  }

  private clearCancelledCompositionTombstone(): void {
    const epoch = this.compositionEpoch;
    if (epoch?.phase !== "settling" || !epoch.cancelled) return;
    if (!epoch.focusGuard) {
      this.acknowledgeDraftComposition();
      this.compositionEpoch = null;
      return;
    }
    this.compositionEpoch = {
      ...epoch,
      cancelled: false,
      lateDeliveryPending: false,
    };
  }

  private establishCancelledCompositionTombstone(): void {
    const epoch = this.compositionEpoch;
    if (epoch?.phase !== "settling") return;
    this.compositionEpoch = {
      ...epoch,
      cancelled: true,
      lateDeliveryPending: false,
      pendingTerminal: null,
      commitAuthority: null,
    };
  }

  private resetTransientEditingState(): void {
    if (this.compositionEndFocusGuardTimer !== null) {
      window.clearTimeout(this.compositionEndFocusGuardTimer);
      this.compositionEndFocusGuardTimer = null;
    }
    this.ambiguousCompositionOrigin = false;
    this.blockedAmbiguousCompositionEpochId = null;
    this.compositionEpoch = null;
    this.requiresCanonicalReconcile = false;
    this.finishNativeMutationWindow();
    this.pendingNativeCandidate = null;
    this.nativeMutationIntents = [];
    this.lastInputType = null;
    this.clearCompositionSettlingTimer();
    this.clearCompositionTerminalDeliveryTimer();
    this.clearPendingCommandTimer();
    this.pendingCommandReadyScheduled = false;
    this.explicitFallbackCommandSequence = null;
  }

  private captureCurrentDomSnapshot(
    selection: NativeEditSelection = this.getSelection(),
    lease: NativeEditLeaseStamp = this.leaseStamp,
  ): CompositionSnapshot {
    return {
      lease: cloneLeaseStamp(lease),
      children: Array.from(this.hostElement.childNodes).map(captureRestorableDomNode),
      hostAttributes: authoredAttributes(this.hostElement, true),
      structure: captureDomStructure(this.hostElement),
      selection,
      text: nativeLogicalText(this.hostElement),
      tracker: this.tracker.snapshot(),
      replacements: this.tracker.replacements(),
      nativeMutationIntentLength: this.nativeMutationIntents.length,
      lastInputType: this.lastInputType,
      unauthorizedDomDrift: this.unauthorizedDomDrift,
      requiresCanonicalReconcile: this.requiresCanonicalReconcile,
    };
  }

  private refreshLastValidatedSnapshot(): void {
    if (!this.hasCurrentLease()) return;
    this.lastValidatedSnapshot = this.captureCurrentDomSnapshot();
  }

  private restoreLastValidatedSnapshot(): boolean {
    const snapshot = this.lastValidatedSnapshot;
    if (
      !this.hasCurrentLease()
      || (snapshot && !leaseStampsMatch(snapshot.lease, this.leaseStamp))
    ) return false;
    if (!snapshot) {
      this.rollback();
      return false;
    }
    this.restoringCompositionSnapshot = true;
    try {
      this.runExpectedMutation(() => {
        restoreAuthoredAttributes(this.hostElement, snapshot.hostAttributes);
        for (const [name, saved] of Object.entries(this.activeSessionAttributes)) {
          restoreAttribute(this.hostElement, name, saved);
        }
        for (const child of snapshot.children) restoreRestorableDomNode(child);
        this.hostElement.replaceChildren(
          ...snapshot.children.map((child) => child.node),
        );
      });
    } finally {
      this.restoringCompositionSnapshot = false;
    }
    const restoreSelection = this.pendingNativeCandidate?.startSelection
      ?? snapshot.selection;
    this.tracker.restore(snapshot.tracker);
    this.nativeMutationIntents.splice(snapshot.nativeMutationIntentLength);
    this.pendingNativeCandidate = null;
    this.lastInputType = snapshot.lastInputType;
    this.unauthorizedDomDrift = snapshot.unauthorizedDomDrift;
    this.requiresCanonicalReconcile = snapshot.requiresCanonicalReconcile;
    if (!this.tracker.dirty()) this.transactionSelection.rebase();
    setSelectionValue(this.hostElement, restoreSelection);
    // Re-capture because restoring uses the original authored node identities,
    // and the next rejected gesture must start from this exact live tree.
    this.refreshLastValidatedSnapshot();
    this.emitState();
    return true;
  }

  private captureCompositionSnapshot(): void {
    if (!this.hasCurrentLease()) return;
    const snapshot = this.captureCurrentDomSnapshot();
    this.compositionEpoch = {
      lease: this.leaseStamp,
      id: this.nextCompositionEpochId,
      phase: "composing",
      snapshot,
      cancelRequested: false,
      compositionInputDelivered: false,
      pendingTerminal: null,
      commitAuthority: null,
    };
    this.nextCompositionEpochId += 1;
  }

  private restoreCompositionSnapshot(retainForTombstone = false): boolean {
    const snapshot = this.compositionSnapshot;
    if (
      !this.hasCurrentLease()
      || !snapshot
      || !leaseStampsMatch(snapshot.lease, this.leaseStamp)
    ) return false;
    this.clearCompositionTerminalDeliveryTimer();
    if (!this.discardDraftProvisionalComposition()) {
      this.cancelDraftComposition();
    }
    this.restoringCompositionSnapshot = true;
    try {
      this.runExpectedMutation(() => {
        restoreAuthoredAttributes(this.hostElement, snapshot.hostAttributes);
        for (const [name, saved] of Object.entries(this.activeSessionAttributes)) {
          restoreAttribute(this.hostElement, name, saved);
        }
        for (const child of snapshot.children) restoreRestorableDomNode(child);
        this.hostElement.replaceChildren(
          ...snapshot.children.map((child) => child.node),
        );
      });
    } finally {
      this.restoringCompositionSnapshot = false;
    }
    // The session structure snapshot remains tied to the current SourcePatch
    // baseline. A composition can start after accepted, not-yet-checkpointed
    // edits; restoring only this epoch must not silently rebase that source
    // authority to provisional DOM.
    this.tracker.restore(snapshot.tracker);
    this.nativeMutationIntents.splice(snapshot.nativeMutationIntentLength);
    this.pendingNativeCandidate = null;
    this.lastInputType = snapshot.lastInputType;
    this.unauthorizedDomDrift = snapshot.unauthorizedDomDrift;
    this.requiresCanonicalReconcile = snapshot.requiresCanonicalReconcile;
    if (!this.tracker.dirty()) this.transactionSelection.rebase();
    setSelectionValue(this.hostElement, snapshot.selection);
    if (!retainForTombstone) {
      this.acknowledgeDraftComposition();
      this.compositionEpoch = null;
    } else if (this.compositionEpoch?.phase === "settling") {
      this.compositionEpoch = {
        ...this.compositionEpoch,
        commitAuthority: null,
      };
    }
    this.refreshLastValidatedSnapshot();
    this.emitState();
    this.notifyPendingCommandReady();
    return true;
  }

  private clearCompositionEndFocusGuard(preserveSnapshot = false): void {
    if (this.compositionEndFocusGuardTimer !== null) {
      window.clearTimeout(this.compositionEndFocusGuardTimer);
      this.compositionEndFocusGuardTimer = null;
    }
    const epoch = this.compositionEpoch;
    if (epoch?.phase !== "settling") return;
    const withoutGuard: CompositionEpoch = { ...epoch, focusGuard: false };
    if (
      !preserveSnapshot
      && !epoch.cancelled
      && !this.requiresCanonicalReconcile
      && !epoch.commitAuthority
      && !this.currentDraftCompositionGuard()
    ) {
      this.compositionEpoch = null;
      return;
    }
    this.compositionEpoch = withoutGuard;
  }

  private openCompositionEndFocusGuard(): void {
    if (!this.hasCurrentLease()) return;
    this.clearCompositionEndFocusGuard(true);
    if (this.compositionEpoch?.phase !== "settling") return;
    this.compositionEpoch = {
      ...this.compositionEpoch,
      focusGuard: true,
    };
    const lease = this.leaseStamp;
    const timer = window.setTimeout(() => {
      if (this.compositionEndFocusGuardTimer !== timer) return;
      this.compositionEndFocusGuardTimer = null;
      if (!this.isLeaseStampCurrent(lease)) return;
      const epoch = this.compositionEpoch;
      if (epoch?.phase !== "settling") return;
      if (
        !epoch.cancelled
        && !this.requiresCanonicalReconcile
        && !epoch.pendingTerminal
        && (!epoch.commitAuthority || !this.tracker.dirty())
        && !this.currentDraftCompositionGuard()
      ) {
        this.compositionEpoch = null;
        return;
      }
      this.compositionEpoch = { ...epoch, focusGuard: false };
    }, 0);
    this.compositionEndFocusGuardTimer = timer;
  }

  private failClosedCompositionForFocusLoss(): void {
    if (!this.hasCurrentLease()) return;
    const requiredTerminalPending = this.compositionEpoch?.phase === "settling"
      && this.compositionEpoch.pendingTerminal?.required;
    if (
      !this.composing
      && !this.compositionEndFocusGuard
      && !requiredTerminalPending
    ) return;
    // A focus loss in the same task as compositionend is not an explicit IME
    // acceptance. Restore the composition-start DOM and Selection so raw
    // marked text cannot become a SourcePatch or history/audit entry, while a
    // preceding accepted but not-yet-checkpointed text edit remains intact.
    if (this.compositionEpoch?.phase === "composing") {
      const epoch = this.compositionEpoch;
      // A browser/window blur is allowed to omit compositionend. Move the
      // epoch to its cancelled-drain lane ourselves so save/undo cannot stay
      // stranded as "composing" and a late terminal event can be absorbed.
      this.compositionEpoch = {
        lease: epoch.lease,
        id: epoch.id,
        phase: "settling",
        snapshot: epoch.snapshot,
        cancelled: false,
        focusGuard: true,
        lateDeliveryPending: false,
        compositionInputDelivered: epoch.compositionInputDelivered,
        pendingTerminal: epoch.pendingTerminal,
        commitAuthority: null,
      };
    }
    if (this.restoreCompositionSnapshot(true)) {
      this.establishCancelledCompositionTombstone();
    } else if (!this.cancelledCompositionTombstone) {
      this.restoreLastValidatedSnapshot();
    }
    if (this.nativeMutationWindow) this.closeMutationWindowAfterDelivery();
  }

  private updateFromDom(): boolean {
    if (!this.hasCurrentLease()) return false;
    try {
      const nextText = this.hasBrowserEmptyHostPlaceholder()
        ? ""
        : nativeLogicalText(this.hostElement);
      const currentText = this.tracker.value();
      if (nextText !== currentText) {
        const authority = this.compositionCommitAuthority;
        const compositionSnapshot = this.compositionSnapshot;
        if (authority && compositionSnapshot) {
          if (
            currentText !== compositionSnapshot.text
            || nextText !== (
              `${compositionSnapshot.text.slice(0, authority.originalStart)}`
              + `${authority.data}`
              + `${compositionSnapshot.text.slice(authority.originalEnd)}`
            )
          ) {
            throw new Error(
              "输入法最终文字无法对应开始选区，已恢复到上一次安全内容。",
            );
          }
          this.tracker.replaceCurrentRange(
            authority.originalStart,
            authority.originalEnd,
            authority.data,
          );
          // Even when an IME only changed one Text node, its browser epoch may
          // still deliver an indistinguishable generic insertText tail. A new
          // canonical island/session is the only reliable generation fence;
          // ordinary keyboard, delete and paste checkpoints remain live-DOM.
          this.requiresCanonicalReconcile = true;
        } else {
          const candidate = this.pendingNativeCandidate;
          if (
            !candidate
            || candidate.currentRanges.length !== 1
            || candidate.startText !== currentText
          ) {
            throw new Error(
              "这次输入无法对应唯一的文字位置，已恢复到上一次安全内容。",
            );
          }
          const [range] = candidate.currentRanges;
          const insertedText = replacementTextForFrozenRange(
            candidate.startText,
            nextText,
            range.startOffset,
            range.endOffset,
          );
          if (insertedText === null) {
            throw new Error(
              "这次输入改变了选区之外的文字，已恢复到上一次安全内容。",
            );
          }
          this.tracker.replaceCurrentRange(
            range.startOffset,
            range.endOffset,
            insertedText,
          );
        }
        if (this.tracker.value() !== nextText) {
          throw new Error(
            "这次输入的文字位置无法验证，已恢复到上一次安全内容。",
          );
        }
      }
      this.normalizeBrowserEmptyHostPlaceholder();
      const replacements = this.tracker.replacements();
      if (!this.ensureDomStructureIntegrity(replacements)) return false;
      const draftComposition = this.currentDraftCompositionGuard();
      this.recordDraftOwnedText(draftComposition ? "composition" : "input");
      if (
        draftComposition
        && (draftComposition.phase === "settling" || draftComposition.phase === "stable")
      ) {
        this.scheduleCompositionSettling();
      }
      if (!this.tracker.dirty() && !this.composing) {
        this.transactionSelection.rebase();
        this.nativeMutationIntents = [];
      }
      this.refreshLastValidatedSnapshot();
      this.emitState();
      return true;
    } catch (cause) {
      this.reportErrorIfCurrent(errorFrom(cause));
      this.restoreLastValidatedSnapshot();
      return false;
    }
  }

  private emitState(): void {
    if (!this.ready || !this.hasCurrentLease()) return;
    if (this.stateFrame !== null) return;
    const windowNode = this.hostElement.ownerDocument.defaultView;
    if (!windowNode) return;
    const lease = this.leaseStamp;
    const frame = windowNode.requestAnimationFrame(() => {
      if (this.stateFrame !== frame) return;
      this.stateFrame = null;
      if (!this.ready || !this.isLeaseStampCurrent(lease)) return;
      this.onStateChange?.({
        dirty: this.tracker.dirty(),
        draftPending: this.hasPendingDraft(),
        composing: this.composing
          || this.compositionDeliveryPending
          || this.draftCompositionUnsettled,
        requiresCanonicalReconcile: this.requiresCanonicalReconcile,
        selection: this.getSelection(),
        inputType: this.lastInputType,
      });
    });
    this.stateFrame = frame;
  }

  private cloneChildren(): Node[] {
    return Array.from(this.hostElement.childNodes).map((node) => node.cloneNode(true));
  }

  focusSelection(): void {
    if (!this.hasCurrentLease()) return;
    this.hostElement.focus({ preventScroll: true });
    setSelectionValue(
      this.hostElement,
      this.baseline.selection ?? this.getSelection(),
    );
    this.emitState();
  }

  focusAtPoint(point?: { clientX: number; clientY: number }): void {
    if (!this.hasCurrentLease()) return;
    const priorSelection = this.getSelection();
    this.hostElement.focus({ preventScroll: true });
    if (!point) {
      this.focusSelection();
      return;
    }
    const documentNode = this.hostElement.ownerDocument;
    const caretPosition = documentNode.caretPositionFromPoint?.(point.clientX, point.clientY);
    const fallbackRange = documentNode.caretRangeFromPoint?.(point.clientX, point.clientY);
    const offsetNode = caretPosition?.offsetNode ?? fallbackRange?.startContainer ?? null;
    const offset = caretPosition?.offset ?? fallbackRange?.startOffset ?? 0;
    if (
      offsetNode
      && (offsetNode === this.hostElement || this.hostElement.contains(offsetNode))
    ) {
      const selection = documentNode.getSelection();
      const range = documentNode.createRange();
      range.setStart(offsetNode, offset);
      range.collapse(true);
      selection?.removeAllRanges();
      selection?.addRange(range);
    } else {
      // A stale overlay coordinate must not replace a valid browser word/range
      // Selection with the host's default focus caret.
      setSelectionValue(this.hostElement, priorSelection);
    }
    this.emitState();
  }

  getSelection(): NativeEditSelection {
    if (!this.hasCurrentLease()) {
      return this.baseline.selection ?? {
        anchor: this.baseline.text.length,
        focus: this.baseline.text.length,
        affinity: "right",
      };
    }
    return selectionValue(this.hostElement);
  }

  getStyleElementsForSelection(): HTMLElement[] {
    if (!this.hasCurrentLease()) return [this.hostElement];
    const selection = this.hostElement.ownerDocument.getSelection();
    if (!selection || selection.rangeCount !== 1) return [this.hostElement];
    const range = selection.getRangeAt(0);
    const elements: HTMLElement[] = [];
    const walker = this.hostElement.ownerDocument.createTreeWalker(
      this.hostElement,
      NodeFilter.SHOW_TEXT,
    );
    let current = walker.nextNode();
    while (current) {
      try {
        if (range.intersectsNode(current) && current.parentElement) {
          if (!elements.includes(current.parentElement)) elements.push(current.parentElement);
        }
      } catch {
        return [this.hostElement];
      }
      current = walker.nextNode();
    }
    return elements.length > 0 ? elements : [this.hostElement];
  }

  queuePendingCommand(
    request: NativeEditPendingCommandRequest,
  ): NativeEditQueueCommandResult {
    if (!this.hasCurrentLease()) return { queued: false };
    const guard = this.currentDraftCompositionGuard();
    if (
      !guard
      || (
        guard.phase !== "composing"
        && guard.phase !== "settling"
        && guard.phase !== "stable"
      )
    ) return { queued: false };
    const queued = this.blockDraft.queueCommand({
      lease: this.leaseStamp,
      command: request,
    });
    if (!queued.accepted) return { queued: false };
    if (guard.phase === "stable") this.notifyPendingCommandReady();
    else this.schedulePendingCommandCancellation();
    return {
      queued: true,
      sequence: queued.pendingCommand.sequence,
      replacedSequence: queued.replacedCommand?.sequence ?? null,
    };
  }

  takePendingCommand(): NativeEditQueuedCommand | null {
    if (!this.hasCurrentLease()) return null;
    if (this.compositionDeliveryPending) return null;
    const guard = this.currentDraftCompositionGuard();
    if (guard && guard.phase !== "stable" && guard.phase !== "cancelled") {
      return null;
    }
    const result = this.blockDraft.takePendingCommand({ lease: this.leaseStamp });
    if (!result.accepted || !result.command) return null;
    this.clearPendingCommandTimer();
    const compositionSnapshot = this.compositionSnapshot;
    const provisionalComposition = Boolean(
      compositionSnapshot
      && this.draftCompositionOwnsProvisionalDom()
      && nativeLogicalText(this.hostElement) !== this.tracker.value()
      && !this.compositionCommitAuthority
    );
    const mustCancelProvisionalComposition = Boolean(
      provisionalComposition
      && (
        compositionSnapshot!.replacements.length > 0
        || result.command.kind === "undo"
        || result.command.kind === "redo"
        || result.command.authority === "system"
      )
    );
    this.explicitFallbackCommandSequence = mustCancelProvisionalComposition
      ? null
      : result.command.sequence;
    if (mustCancelProvisionalComposition && compositionSnapshot) {
      // Redo cannot accept a new composition first because that clears its
      // stack. Undo and system work must not adopt provisional IME DOM either.
      // A user command after earlier strict edits preserves those proven edits
      // and discards only the current marked-text epoch before replay.
      this.restoreCompositionSnapshot(true);
      this.establishCancelledCompositionTombstone();
      const compositionId = this.draftCompositionId();
      if (compositionId) {
        this.blockDraft.acknowledgeComposition({
          lease: this.leaseStamp,
          compositionId,
        });
      }
      this.explicitFallbackCommandSequence = null;
    }
    return result.command;
  }

  getBlockDraftSnapshot(): NativeBlockEditDraftSnapshot<unknown> {
    return this.draftSnapshot();
  }

  captureCheckpoint(
    trigger: NativeEditCheckpointTrigger = "automatic",
  ): NativeEditCheckpoint {
    if (!this.hasCurrentLease()) return { ok: false, reason: "disposed" };
    const checkpointLease = this.leaseStamp;
    if (!this.ready) return { ok: false, reason: "not-ready" };
    if (this.composing || this.draftCompositionUnsettled) {
      return { ok: false, reason: "composing" };
    }
    if (
      this.compositionEpoch?.phase === "settling"
      && this.compositionEpoch.pendingTerminal
      && !this.compositionEpoch.pendingTerminal.required
    ) return { ok: false, reason: "composing" };
    if (
      this.compositionEpoch?.phase === "settling"
      && this.compositionEpoch.pendingTerminal?.required
    ) {
      this.rejectUnfinishedNativeDelivery();
      return { ok: false, reason: "dom-drift" };
    }
    if (this.nativeMutationWindow) {
      this.flushPendingMutationRecords();
      if (!this.isLeaseStampCurrent(checkpointLease)) {
        return { ok: false, reason: "disposed" };
      }
      if (!this.nativeMutationValidated && this.nativeMutationObserved) {
        // Save, blur, Escape, or an outer action can ask for a checkpoint in
        // the same task as beforeinput. It cannot promote an unfinished DOM
        // mutation into a source transaction ahead of the watchdog.
        this.rejectUnfinishedNativeDelivery();
        return { ok: false, reason: "dom-drift" };
      }
      if (!this.nativeMutationValidated) this.discardPendingNativeCandidate();
      this.finishNativeMutationWindow();
    }
    const nextText = this.hasBrowserEmptyHostPlaceholder()
      ? ""
      : nativeLogicalText(this.hostElement);
    if (nextText !== this.tracker.value()) {
      const guard = this.currentDraftCompositionGuard();
      const compositionId = this.draftCompositionId();
      const snapshot = this.compositionSnapshot;
      const fallback = guard?.phase === "stable" && compositionId
        ? this.blockDraft.compositionFallbackCandidate({
            lease: checkpointLease,
            compositionId,
          })
        : null;
      if (
        EXPLICIT_COMPOSITION_FALLBACK_TRIGGERS.has(trigger)
        && this.explicitFallbackCommandSequence !== null
        && fallback?.accepted
        && snapshot
        && snapshot.replacements.length === 0
        && !this.tracker.dirty()
        && snapshot.text === this.baseline.text
        && fallback.candidate.text === nextText
      ) {
        const startOffset = Math.min(
          snapshot.selection.anchor,
          snapshot.selection.focus,
        );
        const endOffset = Math.max(
          snapshot.selection.anchor,
          snapshot.selection.focus,
        );
        const replacementText = replacementTextForFrozenRange(
          snapshot.text,
          nextText,
          startOffset,
          endOffset,
        );
        if (replacementText !== null && !/[\r\n]/u.test(replacementText)) {
          const trackerSnapshot = this.tracker.snapshot();
          try {
            this.tracker.replaceCurrentRange(
              startOffset,
              endOffset,
              replacementText,
            );
            const replacements = this.tracker.replacements();
            const beforeSelection = this.transactionSelection.startSelection()
              ?? snapshot.selection;
            this.explicitFallbackCommandSequence = null;
            return {
              ok: true,
              checkpoint: {
                previousText: this.baseline.text,
                nextText,
                replacements,
                beforeSelection,
                selection: fallback.candidate.selection,
                inputType: this.lastInputType || "insertCompositionText",
                requiresCanonicalReconcile: true,
                authority: "composition-fallback",
                formatEditRange: {
                  startOffset,
                  endOffset,
                  affinity: snapshot.selection.affinity,
                },
              },
              selection: fallback.candidate.selection,
            };
          } finally {
            this.tracker.restore(trackerSnapshot);
          }
        }
      }
      if (fallback?.accepted && !EXPLICIT_COMPOSITION_FALLBACK_TRIGGERS.has(trigger)) {
        // Autosave/debounce is never an authorization boundary for provisional
        // IME DOM. A user command will either validate it or cancel it.
        return { ok: false, reason: "composing" };
      }
      // Every supported browser edit reaches updateFromDom from its matching
      // input/composition delivery. A checkpoint must never discover and
      // promote new text on its own: MutationObserver delivery is asynchronous,
      // so a script or a late browser default action can otherwise mutate the
      // host and synchronously save before the observer has a chance to reject
      // it. Restore the last source-backed baseline instead.
      this.markUnauthorizedDomDrift(
        "页面在这次输入之外又改动了文字，已恢复到上一次安全内容。",
      );
      this.restoreLastValidatedSnapshot();
      return { ok: false, reason: "dom-drift" };
    }
    this.normalizeBrowserEmptyHostPlaceholder();
    const selection = this.getSelection();
    const replacements = this.tracker.replacements();
    if (!this.ensureDomStructureIntegrity(replacements)) {
      return { ok: false, reason: "dom-drift" };
    }
    if (replacements.length === 0) {
      this.transactionSelection.rebase();
      this.nativeMutationIntents = [];
      const guard = this.currentDraftCompositionGuard();
      const compositionId = this.draftCompositionId();
      if (
        compositionId
        && (guard?.phase === "stable" || guard?.phase === "cancelled")
      ) {
        this.blockDraft.acknowledgeComposition({
          lease: this.leaseStamp,
          compositionId,
        });
      }
      this.explicitFallbackCommandSequence = null;
      return { ok: true, checkpoint: null, selection };
    }
    const beforeSelection = this.transactionSelection.startSelection();
    if (!beforeSelection) return { ok: false, reason: "not-ready" };
    this.explicitFallbackCommandSequence = null;
    return {
      ok: true,
      checkpoint: {
        previousText: this.baseline.text,
        nextText,
        replacements,
        beforeSelection,
        selection,
        inputType: this.lastInputType,
        requiresCanonicalReconcile: this.requiresCanonicalReconcile,
        authority: "strict",
      },
      selection,
    };
  }

  applyExternalBaseline(
    baseline: NativeEditBaseline,
    options: NativeEditExternalBaselineOptions = {},
  ): boolean {
    const currentLease = this.leaseStamp;
    const nextLease = options.lease
      ? cloneLeaseStamp(options.lease)
      : currentLease;
    if (
      this.disposed
      || !sameLeaseHost(currentLease, nextLease)
      || nextLease.sourceRevision !== baseline.revision
      || !this.externalLeaseIsCurrent(currentLease)
    ) return false;
    const compositionMustRestore = this.compositionEpoch?.phase === "composing"
      || (
        this.compositionEpoch?.phase === "settling"
        && (
          this.compositionEpoch.cancelled
          || Boolean(this.compositionEpoch.pendingTerminal?.required)
          || !this.compositionEpoch.commitAuthority
        )
    );
    if (
      this.compositionSnapshot
      && !this.requiresCanonicalReconcile
      && compositionMustRestore
    ) {
      this.restoreCompositionSnapshot();
    }
    // Drain every record owned by the previous source revision before the
    // revision stamp advances. A MutationObserver callback already queued by
    // the old revision can then neither be mistaken for the new baseline nor
    // touch the new lease.
    this.flushPendingMutationRecords();
    if (!this.externalLeaseIsCurrent(currentLease)) return false;
    if (nativeLogicalText(this.hostElement) !== baseline.text) {
      this.rollback();
      return false;
    }
    let reconcileRollback: (() => void) | null = null;
    const rollbackReconcile = () => {
      const rollback = reconcileRollback;
      reconcileRollback = null;
      if (!rollback) return;
      try {
        this.runExpectedMutation(rollback);
      } catch {
        // The caller's reconciliation is best-effort preview metadata. A
        // failed rollback still fails this rebase and lets the canonical
        // island restart repair the mounted DOM from source authority.
      }
    };
    if (options.reconcileDomBeforeRebase) {
      let reconciled: NativeEditExternalDomReconcileResult;
      try {
        reconciled = this.runExpectedMutation(options.reconcileDomBeforeRebase);
      } catch {
        return false;
      }
      reconcileRollback = reconciled?.rollback ?? null;
      if (!reconciled?.ok || nativeLogicalText(this.hostElement) !== baseline.text) {
        rollbackReconcile();
        return false;
      }
    }
    this.resetTransientEditingState();
    if (this.stateFrame !== null) {
      this.hostElement.ownerDocument.defaultView?.cancelAnimationFrame(this.stateFrame);
      this.stateFrame = null;
    }
    if (!options.preserveLiveSelection && baseline.selection) {
      setSelectionValue(this.hostElement, baseline.selection);
    }
    const snapshotSelection = selectionValue(this.hostElement);
    let nextFormatSkeleton = this.draftSnapshot().formatSkeleton;
    if (options.getFormatSkeleton) {
      try {
        nextFormatSkeleton = options.getFormatSkeleton();
      } catch {
        rollbackReconcile();
        return false;
      }
    }
    const nextBaselineChildren = this.cloneChildren();
    const nextBaselineHostAttributes = authoredAttributes(this.hostElement, true);
    const nextDomStructureSnapshot = captureDomStructure(this.hostElement);
    if (!this.externalLeaseIsCurrent(currentLease)) {
      rollbackReconcile();
      return false;
    }
    const draftRebased = this.blockDraft.rebaseFromSource({
      lease: currentLease,
      nextLease,
      baselineText: baseline.text,
      baselineSelection: snapshotSelection,
      formatSkeleton: nextFormatSkeleton,
      preservePendingCommand: false,
      advanceLease: (expected, next) => (
        leaseStampsMatch(expected, currentLease)
        && leaseStampsMatch(next, nextLease)
        && (
          leaseStampsMatch(currentLease, nextLease)
          || this.leaseAdvance(currentLease, nextLease)
        )
      ),
    });
    if (!draftRebased.accepted) {
      rollbackReconcile();
      return false;
    }
    this.leaseStamp = nextLease;
    this.baseline = baseline;
    this.tracker.rebase(baseline.text);
    this.transactionSelection.rebase();
    this.baselineChildren = nextBaselineChildren;
    this.baselineHostAttributes = nextBaselineHostAttributes;
    this.domStructureSnapshot = nextDomStructureSnapshot;
    this.unauthorizedDomDrift = false;
    this.lastValidatedSnapshot = this.captureCurrentDomSnapshot(
      snapshotSelection,
      nextLease,
    );
    reconcileRollback = null;
    this.emitState();
    return true;
  }

  restoreSelection(selection: NativeEditSelection): void {
    if (!this.hasCurrentLease()) return;
    setSelectionValue(this.hostElement, selection);
    this.emitState();
  }

  /** Marks a synchronous source-authority DOM reconciliation as expected. */
  runExpectedMutation<T>(operation: () => T): T {
    if (!this.hasCurrentLease()) return undefined as T;
    // Do not let this operation erase older observer evidence. Classify any
    // already queued records under the state in which they occurred first.
    const pendingRecords = this.mutationObserver?.takeRecords() ?? [];
    this.handleObservedMutations(pendingRecords);
    const priorExpectedMutationWindow = this.expectedMutationWindow;
    this.expectedMutationWindow = true;
    try {
      return operation();
    } finally {
      // MutationObserver delivery is asynchronous, but takeRecords can discard
      // exactly the synchronous mutations performed by this trusted operation.
      // Restore immediately: a queued microtask is outside the authority scope.
      this.mutationObserver?.takeRecords();
      this.expectedMutationWindow = priorExpectedMutationWindow;
    }
  }

  rollback(): void {
    if (!this.hasCurrentLease()) return;
    const selection = this.getSelection();
    this.resetTransientEditingState();
    this.runExpectedMutation(() => {
      restoreAuthoredAttributes(this.hostElement, this.baselineHostAttributes);
      for (const [name, saved] of Object.entries(this.activeSessionAttributes)) {
        restoreAttribute(this.hostElement, name, saved);
      }
      this.hostElement.replaceChildren(
        ...this.baselineChildren.map((node) => node.cloneNode(true)),
      );
    });
    this.domStructureSnapshot = captureDomStructure(this.hostElement);
    this.tracker.rebase(this.baseline.text);
    this.transactionSelection.rebase();
    this.unauthorizedDomDrift = false;
    const logicalLength = this.baseline.text.length;
    setSelectionValue(this.hostElement, {
      anchor: Math.min(selection.anchor, logicalLength),
      focus: Math.min(selection.focus, logicalLength),
      affinity: selection.affinity,
    });
    this.blockDraft.rebaseFromSource({
      lease: this.leaseStamp,
      nextLease: this.leaseStamp,
      baselineText: this.baseline.text,
      baselineSelection: this.getSelection(),
      formatSkeleton: this.draftSnapshot().formatSkeleton,
      preservePendingCommand: false,
    });
    this.refreshLastValidatedSnapshot();
    this.emitState();
  }

  isComposing(): boolean {
    return this.hasCurrentLease()
      && (
        this.composing
        || this.compositionDeliveryPending
        || this.draftCompositionUnsettled
      );
  }

  consumeCompositionEscape(): boolean {
    if (!this.hasCurrentLease()) return false;
    if (this.compositionEpoch?.phase === "composing") {
      this.compositionEpoch = {
        ...this.compositionEpoch,
        cancelRequested: true,
      };
      return true;
    }
    // The long-lived tombstone protects only late empty composition delivery.
    // Escape itself is a one-shot member of the same-task focus guard. Retire
    // that guard immediately so a later, intentional Escape still exits even
    // when the browser's iframe timer queue is throttled.
    if (this.compositionEndFocusGuard && this.compositionSnapshot) {
      this.clearCompositionEndFocusGuard();
      return true;
    }
    return false;
  }

  isDirty(): boolean {
    return this.hasCurrentLease() && this.tracker.dirty();
  }

  hasPendingDraft(): boolean {
    if (!this.hasCurrentLease()) return false;
    const snapshot = this.draftSnapshot();
    const guard = snapshot.compositionGuard;
    return Boolean(
      guard
      && (
        guard.phase === "composing"
        || guard.phase === "settling"
        || guard.phase === "stable"
      )
    ) || snapshot.currentText !== snapshot.baselineText;
  }

  private detachSessionInfrastructure(): void {
    while (this.cleanup.length > 0) this.cleanup.pop()?.();
    const observer = this.mutationObserver;
    if (observer) {
      observer.takeRecords();
      observer.disconnect();
      observer.takeRecords();
      this.mutationObserver = null;
    }
  }

  private cancelAllScheduledWork(): void {
    if (this.mutationWindowTimer !== null) {
      window.clearTimeout(this.mutationWindowTimer);
      this.mutationWindowTimer = null;
    }
    if (this.compositionEndFocusGuardTimer !== null) {
      window.clearTimeout(this.compositionEndFocusGuardTimer);
      this.compositionEndFocusGuardTimer = null;
    }
    if (this.stateFrame !== null) {
      this.hostElement.ownerDocument.defaultView?.cancelAnimationFrame(this.stateFrame);
      this.stateFrame = null;
    }
    this.clearCompositionSettlingTimer();
    this.clearCompositionTerminalDeliveryTimer();
    this.clearPendingCommandTimer();
    this.pendingCommandReadyScheduled = false;
  }

  /**
   * Permanently retires this editable host before a source-authority fence.
   * Unlike dispose(), this deliberately does not restore authored/session
   * attributes: the caller will replace the retired island with canonical DOM.
   */
  fenceDispose(): void {
    if (this.disposed) return;
    // Invalidate locally before removing any listener or draining observer
    // records. A listener already on the dispatch stack can now only drop its
    // tail; it cannot call PageRoot or mutate the next DOM generation.
    this.disposed = true;
    this.ready = false;
    this.blockDraft.expire({
      lease: this.leaseStamp,
      reason: "history-or-source-fence",
    });
    this.detachSessionInfrastructure();
    this.cancelAllScheduledWork();
    this.compositionEpoch = null;
    this.pendingNativeCandidate = null;
    this.nativeMutationIntents = [];
    this.nativeMutationWindow = false;
    this.nativeMutationValidated = false;
    this.nativeMutationObserved = false;
    this.expectedMutationWindow = false;
    // A fence permanently retires this exact host. The outer owner may already
    // have cleared its current-lease ref before calling us, so removal must not
    // depend on lease validation. No future session may reuse this DOM node.
    for (const name of SESSION_CONTROLLED_ATTRIBUTE_NAMES) {
      this.hostElement.removeAttribute(name);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    const ownedHost = this.hasCurrentLease();
    if (ownedHost && this.compositionSnapshot) {
      this.restoreCompositionSnapshot();
    }
    if (ownedHost) this.resetTransientEditingState();
    this.blockDraft.expire({
      lease: this.leaseStamp,
      reason: "editing-session-disposed",
    });
    this.disposed = true;
    this.ready = false;
    this.detachSessionInfrastructure();
    this.cancelAllScheduledWork();
    // Keep the legacy dispose contract: HtmlCanvas intentionally clears its
    // outer lease ref before ending a normal session, but the retiring
    // controller must still restore the attributes it captured on entry.
    for (const [name, saved] of Object.entries(this.originalAttributes)) {
      restoreAttribute(this.hostElement, name, saved);
    }
  }
}
