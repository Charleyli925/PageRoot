import {
  domPointForLogicalOffset,
  logicalIndexForHost,
  logicalOffsetForDomPoint,
  nativeLogicalText,
} from "../lib/native-dom-logical-index.js";
import {
  normalizeEditableIslandHtml,
} from "../lib/editable-island.js";
import {
  NATIVE_EDIT_CHECKPOINT_DELAY_MS,
} from "../lib/native-edit-policy.js";
import type {
  NativeEditBaseline,
  NativeEditCheckpointTrigger,
  NativeEditLease,
  NativeEditLeaseStamp,
  NativeEditPendingCommandRequest,
  NativeEditQueueCommandResult,
  NativeEditQueuedCommand,
  NativeEditSelection,
  NativeEditSessionState,
} from "./native-edit-types";

export { NATIVE_EDIT_CHECKPOINT_DELAY_MS };
export { nativeLogicalText };
export type {
  NativeEditBaseline,
  NativeEditCheckpointTrigger,
  NativeEditLeaseStamp,
  NativeEditSelection,
  NativeEditSessionState,
};

export type IslandEditCheckpoint =
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
        previousInnerHtml: string;
        nextInnerHtml: string;
        previousText: string;
        nextText: string;
        beforeSelection: NativeEditSelection;
        selection: NativeEditSelection;
        inputType: string | null;
      };
      selection: NativeEditSelection;
    };

export type IslandEditingControllerOptions = {
  hostElement: HTMLElement;
  baseline: NativeEditBaseline;
  sourceInnerHtml: string;
  lease: NativeEditLease;
  ariaLabel?: string;
  onStateChange?: (state: NativeEditSessionState) => void;
  onBlur?: () => void;
  onEscape?: () => void;
  onError?: (error: Error) => void;
  onPendingCommandReady?: () => void;
};

export type IslandExternalBaselineOptions = {
  preserveLiveSelection?: boolean;
  lease?: NativeEditLeaseStamp;
  reconcileDomBeforeRebase?: () => unknown;
  getFormatSkeleton?: () => unknown;
};

type SavedAttribute = {
  present: boolean;
  value: string | null;
};

type PendingCommand = NativeEditQueuedCommand & {
  authority?: "user-explicit" | "system";
  payload?: unknown;
};

type CompositionSnapshot = {
  children: Node[];
  selection: NativeEditSelection;
};

const SESSION_ATTRIBUTES = [
  "aria-label",
  "contenteditable",
  "data-pageroot-v2-editing",
  "role",
  "spellcheck",
] as const;

function cloneLeaseStamp(stamp: NativeEditLeaseStamp): NativeEditLeaseStamp {
  return { ...stamp };
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

function captureAttribute(element: HTMLElement, name: string): SavedAttribute {
  return {
    present: element.hasAttribute(name),
    value: element.getAttribute(name),
  };
}

function restoreAttribute(
  element: HTMLElement,
  name: string,
  saved: SavedAttribute,
): void {
  if (saved.present) element.setAttribute(name, saved.value ?? "");
  else element.removeAttribute(name);
}

function selectionValue(hostElement: HTMLElement): NativeEditSelection {
  const fallback = nativeLogicalText(hostElement).length;
  const selection = hostElement.ownerDocument.getSelection();
  if (
    !selection
    || !selection.anchorNode
    || !selection.focusNode
    || (
      selection.anchorNode !== hostElement
      && !hostElement.contains(selection.anchorNode)
    )
    || (
      selection.focusNode !== hostElement
      && !hostElement.contains(selection.focusNode)
    )
  ) {
    return { anchor: fallback, focus: fallback, affinity: "right" };
  }
  const index = logicalIndexForHost(hostElement);
  const anchor = logicalOffsetForDomPoint(
    hostElement,
    selection.anchorNode,
    selection.anchorOffset,
    index,
  );
  const focus = logicalOffsetForDomPoint(
    hostElement,
    selection.focusNode,
    selection.focusOffset,
    index,
  );
  if (anchor === null || focus === null) {
    return { anchor: fallback, focus: fallback, affinity: "right" };
  }
  return {
    anchor,
    focus,
    affinity: anchor === focus && anchor > 0
      ? "left"
      : anchor < focus
        ? "left"
        : "right",
  };
}

function setSelectionValue(
  hostElement: HTMLElement,
  value: NativeEditSelection,
): void {
  const selection = hostElement.ownerDocument.getSelection();
  if (!selection) return;
  const index = logicalIndexForHost(hostElement);
  const anchor = domPointForLogicalOffset(
    hostElement,
    value.anchor,
    value.affinity,
    index,
  );
  const focus = domPointForLogicalOffset(
    hostElement,
    value.focus,
    value.affinity,
    index,
  );
  if (typeof selection.setBaseAndExtent === "function") {
    selection.setBaseAndExtent(
      anchor.node,
      anchor.offset,
      focus.node,
      focus.offset,
    );
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
  selection.removeAllRanges();
  selection.addRange(range);
}

function selectionRangeInsideHost(hostElement: HTMLElement): Range | null {
  const selection = hostElement.ownerDocument.getSelection();
  if (!selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (
    (
      range.startContainer !== hostElement
      && !hostElement.contains(range.startContainer)
    )
    || (
      range.endContainer !== hostElement
      && !hostElement.contains(range.endContainer)
    )
  ) return null;
  return range;
}

function htmlForPlainText(documentNode: Document, value: string): DocumentFragment {
  const fragment = documentNode.createDocumentFragment();
  const normalized = String(value).replace(/\r\n?/gu, "\n");
  normalized.split("\n").forEach((line, index) => {
    if (index > 0) fragment.append(documentNode.createElement("br"));
    if (line) fragment.append(documentNode.createTextNode(line));
  });
  return fragment;
}

function insertFragmentAtSelection(
  hostElement: HTMLElement,
  fragment: DocumentFragment,
): boolean {
  const range = selectionRangeInsideHost(hostElement);
  if (!range) return false;
  const insertedNodes = Array.from(fragment.childNodes);
  range.deleteContents();
  range.insertNode(fragment);
  const selection = hostElement.ownerDocument.getSelection();
  const lastNode = insertedNodes.at(-1);
  if (selection && lastNode) {
    const caret = hostElement.ownerDocument.createRange();
    caret.setStartAfter(lastNode);
    caret.collapse(true);
    selection.removeAllRanges();
    selection.addRange(caret);
  }
  return true;
}

function insertTextAtSelection(
  hostElement: HTMLElement,
  value: string,
): boolean {
  const range = selectionRangeInsideHost(hostElement);
  if (!range) return false;
  if (!value) {
    range.deleteContents();
    range.collapse(true);
    const selection = hostElement.ownerDocument.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    return true;
  }
  const fragment = hostElement.ownerDocument.createDocumentFragment();
  fragment.append(hostElement.ownerDocument.createTextNode(value));
  return insertFragmentAtSelection(hostElement, fragment);
}

function deleteSelection(
  hostElement: HTMLElement,
  inputType: string,
): boolean {
  const selection = hostElement.ownerDocument.getSelection();
  const range = selectionRangeInsideHost(hostElement);
  if (!selection || !range) return false;
  if (!range.collapsed) {
    range.deleteContents();
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
    return true;
  }

  const logical = selectionValue(hostElement).focus;
  const text = nativeLogicalText(hostElement);
  const backward = inputType.includes("Backward");
  const deletesWord = inputType.includes("Word");
  if (!inputType.includes("Line")) {
    const segmenter = new Intl.Segmenter(undefined, {
      granularity: deletesWord ? "word" : "grapheme",
    });
    const segments = Array.from(segmenter.segment(text));
    const meaningfulSegments = deletesWord
      ? segments.filter((segment) => segment.isWordLike || segment.segment.trim())
      : segments;
    const segment = backward
      ? [...meaningfulSegments].reverse().find((candidate) => (
          candidate.index < logical
          && candidate.index + candidate.segment.length >= logical
        ))
      : meaningfulSegments.find((candidate) => (
          candidate.index <= logical
          && candidate.index + candidate.segment.length > logical
        ));
    if (segment) {
      const startOffset = backward ? segment.index : logical;
      const endOffset = backward
        ? logical
        : segment.index + segment.segment.length;
      const index = logicalIndexForHost(hostElement);
      const startPoint = domPointForLogicalOffset(
        hostElement,
        startOffset,
        "right",
        index,
      );
      const endPoint = domPointForLogicalOffset(
        hostElement,
        endOffset,
        "left",
        index,
      );
      const deletionRange = hostElement.ownerDocument.createRange();
      deletionRange.setStart(startPoint.node, startPoint.offset);
      deletionRange.setEnd(endPoint.node, endPoint.offset);
      deletionRange.deleteContents();
      deletionRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(deletionRange);
      return true;
    }
  }
  const granularity = inputType.includes("Word")
    ? "word"
    : inputType.includes("SoftLine")
      ? "lineboundary"
      : inputType.includes("HardLine")
        ? "line"
        : "character";
  if (typeof selection.modify === "function") {
    selection.modify("extend", backward ? "backward" : "forward", granularity);
    const deletionRange = selection.rangeCount === 1
      ? selection.getRangeAt(0)
      : null;
    if (
      deletionRange
      && (
        deletionRange.startContainer === hostElement
        || hostElement.contains(deletionRange.startContainer)
      )
      && (
        deletionRange.endContainer === hostElement
        || hostElement.contains(deletionRange.endContainer)
      )
    ) {
      deletionRange.deleteContents();
      deletionRange.collapse(true);
      selection.removeAllRanges();
      selection.addRange(deletionRange);
      return true;
    }
    setSelectionValue(hostElement, {
      anchor: logical,
      focus: logical,
      affinity: logical === 0 ? "right" : "left",
    });
  }

  if ((backward && logical === 0) || (!backward && logical === text.length)) {
    return true;
  }
  let start = logical;
  let end = logical;
  if (backward) {
    start -= 1;
    const prior = text.charCodeAt(start);
    if (
      prior >= 0xdc00
      && prior <= 0xdfff
      && start > 0
      && text.charCodeAt(start - 1) >= 0xd800
      && text.charCodeAt(start - 1) <= 0xdbff
    ) start -= 1;
  } else {
    const point = text.codePointAt(end);
    end += point !== undefined && point > 0xffff ? 2 : 1;
  }
  const index = logicalIndexForHost(hostElement);
  const startPoint = domPointForLogicalOffset(
    hostElement,
    Math.max(0, start),
    "left",
    index,
  );
  const endPoint = domPointForLogicalOffset(
    hostElement,
    Math.min(text.length, end),
    "right",
    index,
  );
  const deletionRange = hostElement.ownerDocument.createRange();
  deletionRange.setStart(startPoint.node, startPoint.offset);
  deletionRange.setEnd(endPoint.node, endPoint.offset);
  deletionRange.deleteContents();
  deletionRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(deletionRange);
  return true;
}

function restoreChildren(hostElement: HTMLElement, children: Node[]): void {
  hostElement.replaceChildren(
    ...children.map((node) => node.cloneNode(true)),
  );
}

export class IslandEditingController {
  readonly hostElement: HTMLElement;

  private baseline: NativeEditBaseline;

  private baselineInnerHtml: string;

  private baselineCanonicalInnerHtml: string;

  private baselineChildren: Node[];

  private baselineSelection: NativeEditSelection;

  private lastValidatedChildren: Node[];

  private lastValidatedSelection: NativeEditSelection;

  private readonly lease: NativeEditLease;

  private leaseStamp: NativeEditLeaseStamp;

  private readonly callbacks: Pick<
    IslandEditingControllerOptions,
    "onStateChange" | "onBlur" | "onEscape" | "onError" | "onPendingCommandReady"
  >;

  private readonly savedAttributes = new Map<string, SavedAttribute>();

  private readonly cleanup: Array<() => void> = [];

  private observer: MutationObserver | null = null;

  private expectedMutationDepth = 0;

  private composing = false;

  private compositionEscapeRequested = false;

  private compositionSnapshot: CompositionSnapshot | null = null;

  private disposed = false;

  private ready = false;

  private lastInputType: string | null = null;

  private pendingCommand: PendingCommand | null = null;

  private pendingCommandSequence = 0;

  private stateFrame: number | null = null;

  private inputDeliveryExpected = false;

  private inputDeliveryTimer: number | null = null;

  constructor(options: IslandEditingControllerOptions) {
    this.hostElement = options.hostElement;
    this.baseline = { ...options.baseline };
    this.baselineInnerHtml = String(options.sourceInnerHtml);
    this.lease = options.lease;
    this.leaseStamp = cloneLeaseStamp(options.lease.stamp);
    this.callbacks = {
      onStateChange: options.onStateChange,
      onBlur: options.onBlur,
      onEscape: options.onEscape,
      onError: options.onError,
      onPendingCommandReady: options.onPendingCommandReady,
    };
    this.baselineCanonicalInnerHtml = this.serializeCanonical();
    this.baselineChildren = Array.from(this.hostElement.childNodes).map(
      (node) => node.cloneNode(true),
    );
    this.baselineSelection = options.baseline.selection ?? {
      anchor: options.baseline.text.length,
      focus: options.baseline.text.length,
      affinity: "right",
    };
    this.lastValidatedChildren = this.baselineChildren.map(
      (node) => node.cloneNode(true),
    );
    this.lastValidatedSelection = { ...this.baselineSelection };

    for (const name of SESSION_ATTRIBUTES) {
      this.savedAttributes.set(name, captureAttribute(this.hostElement, name));
    }
    this.hostElement.setAttribute("contenteditable", "true");
    this.hostElement.setAttribute("spellcheck", "false");
    this.hostElement.setAttribute("role", "textbox");
    this.hostElement.setAttribute("data-pageroot-v2-editing", "true");
    if (options.ariaLabel) {
      this.hostElement.setAttribute("aria-label", options.ariaLabel);
    }

    const listen = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Document,
      type: K,
      listener: EventListener,
      capture = false,
    ) => {
      target.addEventListener(type, listener, capture);
      this.cleanup.push(() => target.removeEventListener(type, listener, capture));
    };
    listen(this.hostElement, "beforeinput", this.handleBeforeInput as EventListener);
    listen(this.hostElement, "input", this.handleInput as EventListener);
    listen(this.hostElement, "paste", this.handlePaste as EventListener);
    listen(this.hostElement, "compositionstart", this.handleCompositionStart as EventListener);
    listen(this.hostElement, "compositionend", this.handleCompositionEnd as EventListener);
    listen(this.hostElement, "blur", this.handleBlur as EventListener);
    listen(this.hostElement, "keydown", this.handleKeyDown as EventListener);
    listen(
      this.hostElement.ownerDocument,
      "selectionchange",
      this.handleSelectionChange as EventListener,
    );

    this.observer = new MutationObserver((records) => {
      if (
        records.length === 0
        || this.expectedMutationDepth > 0
        || this.disposed
        || this.composing
      ) return;
      this.restoreLastValidatedDraft();
      this.reportError(new Error(
        "页面在编辑之外发生了变化，已恢复到上一次安全内容。",
      ));
    });
    this.observer.observe(this.hostElement, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    this.ready = true;
    this.emitState();
  }

  private hasCurrentLease(): boolean {
    return !this.disposed
      && this.lease.isCurrent(this.leaseStamp);
  }

  private reportError(error: unknown): void {
    if (!this.hasCurrentLease()) return;
    this.callbacks.onError?.(
      error instanceof Error ? error : new Error(String(error)),
    );
  }

  private serializeCanonical(): string {
    return normalizeEditableIslandHtml(this.hostElement.innerHTML, {
      baselineInnerHtml: this.baselineInnerHtml,
    });
  }

  private armExpectedInputDelivery(): void {
    this.inputDeliveryExpected = true;
    const view = this.hostElement.ownerDocument.defaultView;
    if (!view) return;
    if (this.inputDeliveryTimer !== null) {
      view.clearTimeout(this.inputDeliveryTimer);
    }
    this.inputDeliveryTimer = view.setTimeout(() => {
      this.inputDeliveryTimer = null;
      this.inputDeliveryExpected = false;
    }, 0);
  }

  private clearExpectedInputDelivery(): void {
    this.inputDeliveryExpected = false;
    const view = this.hostElement.ownerDocument.defaultView;
    if (view && this.inputDeliveryTimer !== null) {
      view.clearTimeout(this.inputDeliveryTimer);
    }
    this.inputDeliveryTimer = null;
  }

  private validateDom(): boolean {
    try {
      this.serializeCanonical();
      this.refreshLastValidatedDraft();
      this.emitState();
      return true;
    } catch (cause) {
      this.restoreLastValidatedDraft();
      this.reportError(cause);
      return false;
    }
  }

  private handleBeforeInput = (event: InputEvent): void => {
    if (!this.hasCurrentLease()) return;
    this.lastInputType = event.inputType || null;
    if (
      !event.isComposing
      && (
        event.inputType === "insertText"
        || event.inputType === "insertReplacementText"
      )
    ) {
      this.normalizeCollapsedInsertionAffinity();
    }
    if (
      event.inputType === "historyUndo"
      || event.inputType === "historyRedo"
      || event.inputType.startsWith("format")
    ) {
      event.preventDefault();
      return;
    }
    if (!event.isComposing && event.inputType.startsWith("delete")) {
      event.preventDefault();
      this.runExpectedMutation(() => {
        if (!deleteSelection(this.hostElement, event.inputType)) {
          throw new Error("无法在当前光标位置删除文字。");
        }
      });
      this.validateDom();
      return;
    }
    if (
      !event.isComposing
      && (
        event.inputType === "insertText"
        || event.inputType === "insertReplacementText"
      )
    ) {
      event.preventDefault();
      this.runExpectedMutation(() => {
        if (!insertTextAtSelection(this.hostElement, event.data ?? "")) {
          throw new Error("无法在当前光标位置插入文字。");
        }
      });
      this.validateDom();
      return;
    }
    if (
      event.inputType !== "insertParagraph"
      && event.inputType !== "insertLineBreak"
    ) {
      this.armExpectedInputDelivery();
      return;
    }
    event.preventDefault();
    this.runExpectedMutation(() => {
      const fragment = this.hostElement.ownerDocument.createDocumentFragment();
      fragment.append(this.hostElement.ownerDocument.createElement("br"));
      if (!insertFragmentAtSelection(this.hostElement, fragment)) {
        throw new Error("无法在当前光标位置插入换行。");
      }
    });
    this.validateDom();
  };

  private handleInput = (event: InputEvent): void => {
    if (!this.hasCurrentLease()) return;
    this.lastInputType = event.inputType || this.lastInputType;
    this.observer?.takeRecords();
    if (!this.composing && !this.inputDeliveryExpected) {
      this.restoreLastValidatedDraft();
      this.reportError(new Error(
        "页面在编辑之外发生了变化，已恢复到上一次安全内容。",
      ));
      return;
    }
    this.clearExpectedInputDelivery();
    if (
      !this.composing
      && this.lastInputType?.startsWith("delete")
      && this.hostElement.childNodes.length === 1
      && this.hostElement.firstElementChild?.localName === "br"
    ) {
      this.runExpectedMutation(() => this.hostElement.replaceChildren());
    }
    if (!this.composing) this.validateDom();
    else this.emitState();
  };

  private handlePaste = (event: ClipboardEvent): void => {
    if (!this.hasCurrentLease()) return;
    event.preventDefault();
    this.lastInputType = "insertFromPaste";
    this.normalizeCollapsedInsertionAffinity();
    const text = event.clipboardData?.getData("text/plain") ?? "";
    this.runExpectedMutation(() => {
      if (!insertFragmentAtSelection(
        this.hostElement,
        htmlForPlainText(this.hostElement.ownerDocument, text),
      )) {
        throw new Error("无法在当前光标位置粘贴文字。");
      }
    });
    this.validateDom();
  };

  private handleCompositionStart = (): void => {
    if (!this.hasCurrentLease()) return;
    this.normalizeCollapsedInsertionAffinity();
    this.compositionSnapshot = {
      children: Array.from(this.hostElement.childNodes).map(
        (node) => node.cloneNode(true),
      ),
      selection: this.getSelection(),
    };
    this.composing = true;
    this.clearExpectedInputDelivery();
    this.compositionEscapeRequested = false;
    this.emitState();
  };

  private handleCompositionEnd = (event: CompositionEvent): void => {
    if (!this.hasCurrentLease()) return;
    this.composing = false;
    this.observer?.takeRecords();
    const snapshot = this.compositionSnapshot;
    this.compositionSnapshot = null;
    if (snapshot) {
      this.runExpectedMutation(() => {
        restoreChildren(this.hostElement, snapshot.children);
        setSelectionValue(this.hostElement, snapshot.selection);
        if (
          !this.compositionEscapeRequested
          && !insertTextAtSelection(this.hostElement, event.data ?? "")
        ) {
          throw new Error("输入法确认文字时无法恢复原光标位置。");
        }
      });
    }
    this.compositionEscapeRequested = false;
    this.validateDom();
    this.emitState();
    if (this.pendingCommand) {
      this.hostElement.ownerDocument.defaultView?.queueMicrotask(() => {
        if (this.hasCurrentLease() && this.pendingCommand) {
          this.callbacks.onPendingCommandReady?.();
        }
      });
    }
  };

  private handleBlur = (): void => {
    if (!this.hasCurrentLease()) return;
    if (this.composing) {
      const snapshot = this.compositionSnapshot;
      this.composing = false;
      this.compositionSnapshot = null;
      this.compositionEscapeRequested = false;
      this.observer?.takeRecords();
      if (snapshot) {
        this.runExpectedMutation(() => {
          restoreChildren(this.hostElement, snapshot.children);
          setSelectionValue(this.hostElement, snapshot.selection);
        });
      }
      this.validateDom();
    }
    this.callbacks.onBlur?.();
  };

  private handleKeyDown = (event: KeyboardEvent): void => {
    if (!this.hasCurrentLease()) return;
    if (!this.composing && event.key === "Enter") {
      event.preventDefault();
      this.lastInputType = event.shiftKey
        ? "insertLineBreak"
        : "insertParagraph";
      this.runExpectedMutation(() => {
        const fragment = this.hostElement.ownerDocument.createDocumentFragment();
        fragment.append(this.hostElement.ownerDocument.createElement("br"));
        if (!insertFragmentAtSelection(this.hostElement, fragment)) {
          throw new Error("无法在当前光标位置插入换行。");
        }
      });
      this.validateDom();
      return;
    }
    if (
      !this.composing
      && (event.key === "Backspace" || event.key === "Delete")
    ) {
      event.preventDefault();
      const direction = event.key === "Backspace" ? "Backward" : "Forward";
      const granularity = event.metaKey
        ? "SoftLine"
        : event.altKey
          ? "Word"
          : "Content";
      this.lastInputType = `delete${granularity}${direction}`;
      this.runExpectedMutation(() => {
        if (!deleteSelection(this.hostElement, this.lastInputType ?? "")) {
          throw new Error("无法在当前光标位置删除文字。");
        }
      });
      this.validateDom();
      return;
    }
    if (event.key === "Escape") {
      if (this.composing) {
        this.compositionEscapeRequested = true;
        return;
      }
      event.preventDefault();
      this.callbacks.onEscape?.();
    }
  };

  private handleSelectionChange = (): void => {
    if (!this.hasCurrentLease()) return;
    const selection = this.hostElement.ownerDocument.getSelection();
    if (
      !selection?.anchorNode
      || (
        selection.anchorNode !== this.hostElement
        && !this.hostElement.contains(selection.anchorNode)
      )
    ) return;
    this.lastValidatedSelection = this.getSelection();
    this.emitState();
  };

  private emitState(): void {
    if (!this.hasCurrentLease() || this.stateFrame !== null) return;
    const view = this.hostElement.ownerDocument.defaultView;
    if (!view) return;
    this.stateFrame = view.requestAnimationFrame(() => {
      this.stateFrame = null;
      if (!this.hasCurrentLease()) return;
      let dirty = false;
      try {
        dirty = this.serializeCanonical() !== this.baselineCanonicalInnerHtml;
      } catch {
        dirty = true;
      }
      this.callbacks.onStateChange?.({
        dirty,
        draftPending: dirty || this.composing || Boolean(this.pendingCommand),
        composing: this.composing,
        requiresCanonicalReconcile: dirty,
        selection: this.getSelection(),
        inputType: this.lastInputType,
      });
    });
  }

  private refreshLastValidatedDraft(): void {
    this.lastValidatedChildren = Array.from(this.hostElement.childNodes).map(
      (node) => node.cloneNode(true),
    );
    this.lastValidatedSelection = this.getSelection();
  }

  private restoreLastValidatedDraft(): void {
    const selection = { ...this.lastValidatedSelection };
    this.runExpectedMutation(() => restoreChildren(
      this.hostElement,
      this.lastValidatedChildren,
    ));
    const length = nativeLogicalText(this.hostElement).length;
    setSelectionValue(this.hostElement, {
      anchor: Math.min(selection.anchor, length),
      focus: Math.min(selection.focus, length),
      affinity: selection.affinity,
    });
    this.emitState();
  }

  private normalizeCollapsedInsertionAffinity(): void {
    const selection = this.hostElement.ownerDocument.getSelection();
    if (!selection?.isCollapsed || !selection.anchorNode) return;
    if (
      selection.anchorNode !== this.hostElement
      && !this.hostElement.contains(selection.anchorNode)
    ) return;
    const logical = selectionValue(this.hostElement);
    const prefix = this.hostElement.ownerDocument.createRange();
    prefix.selectNodeContents(this.hostElement);
    prefix.setEnd(selection.anchorNode, selection.anchorOffset);
    const affinity = prefix.toString().trim().length === 0 ? "right" : "left";
    const point = domPointForLogicalOffset(
      this.hostElement,
      logical.focus,
      affinity,
    );
    const range = this.hostElement.ownerDocument.createRange();
    range.setStart(point.node, point.offset);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  focusSelection(): void {
    if (!this.hasCurrentLease()) return;
    this.hostElement.focus({ preventScroll: true });
    setSelectionValue(this.hostElement, this.baseline.selection ?? this.baselineSelection);
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
    const caretPosition = documentNode.caretPositionFromPoint?.(
      point.clientX,
      point.clientY,
    );
    const fallbackRange = documentNode.caretRangeFromPoint?.(
      point.clientX,
      point.clientY,
    );
    const offsetNode = caretPosition?.offsetNode
      ?? fallbackRange?.startContainer
      ?? null;
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
      setSelectionValue(this.hostElement, priorSelection);
    }
    this.emitState();
  }

  getSelection(): NativeEditSelection {
    if (!this.hasCurrentLease()) return this.baselineSelection;
    return selectionValue(this.hostElement);
  }

  restoreSelection(selection: NativeEditSelection): void {
    if (!this.hasCurrentLease()) return;
    setSelectionValue(this.hostElement, selection);
    this.emitState();
  }

  getStyleElementsForSelection(): HTMLElement[] {
    if (!this.hasCurrentLease()) return [this.hostElement];
    const selection = this.hostElement.ownerDocument.getSelection();
    if (!selection || selection.rangeCount !== 1) return [this.hostElement];
    if (selection.isCollapsed) {
      const logical = this.getSelection();
      const point = domPointForLogicalOffset(
        this.hostElement,
        logical.focus,
        logical.focus === 0 ? "right" : "left",
      );
      const element = point.node.nodeType === Node.TEXT_NODE
        ? point.node.parentElement
        : point.node instanceof HTMLElement
          ? point.node
          : point.node.parentElement;
      return element ? [element] : [this.hostElement];
    }
    const range = selection.getRangeAt(0);
    const elements: HTMLElement[] = [];
    const walker = this.hostElement.ownerDocument.createTreeWalker(
      this.hostElement,
      NodeFilter.SHOW_TEXT,
    );
    let current = walker.nextNode();
    while (current) {
      if (range.intersectsNode(current) && current.parentElement) {
        if (!elements.includes(current.parentElement)) {
          elements.push(current.parentElement);
        }
      }
      current = walker.nextNode();
    }
    return elements.length > 0 ? elements : [this.hostElement];
  }

  applyInlineStyle(property: string, value: string, important = false): boolean {
    if (!this.hasCurrentLease() || this.composing) return false;
    const range = selectionRangeInsideHost(this.hostElement);
    if (!range || range.collapsed) return false;
    const beforeSelection = this.getSelection();
    try {
      this.runExpectedMutation(() => {
        const span = this.hostElement.ownerDocument.createElement("span");
        span.style.setProperty(property, value, important ? "important" : "");
        span.append(range.extractContents());
        range.insertNode(span);
        const selection = this.hostElement.ownerDocument.getSelection();
        const nextRange = this.hostElement.ownerDocument.createRange();
        nextRange.selectNodeContents(span);
        selection?.removeAllRanges();
        selection?.addRange(nextRange);
      });
      if (!this.validateDom()) return false;
      this.baselineSelection = beforeSelection;
      return true;
    } catch (cause) {
      this.rollback();
      this.reportError(cause);
      return false;
    }
  }

  queuePendingCommand(
    request: NativeEditPendingCommandRequest,
  ): NativeEditQueueCommandResult {
    if (!this.hasCurrentLease() || !this.composing) return { queued: false };
    this.pendingCommandSequence += 1;
    const replacedSequence = this.pendingCommand?.sequence ?? null;
    this.pendingCommand = {
      sequence: this.pendingCommandSequence,
      kind: request.kind,
      authority: request.authority ?? "user-explicit",
      payload: request.payload,
      compositionId: `island_${this.pendingCommandSequence.toString(36)}`,
    };
    this.emitState();
    return {
      queued: true,
      sequence: this.pendingCommandSequence,
      replacedSequence,
    };
  }

  takePendingCommand(): NativeEditQueuedCommand | null {
    if (!this.hasCurrentLease() || this.composing || !this.pendingCommand) return null;
    const command = this.pendingCommand;
    this.pendingCommand = null;
    this.emitState();
    return command;
  }

  captureCheckpoint(
    trigger: NativeEditCheckpointTrigger = "automatic",
  ): IslandEditCheckpoint {
    void trigger;
    if (!this.hasCurrentLease()) return { ok: false, reason: "disposed" };
    if (!this.ready) return { ok: false, reason: "not-ready" };
    if (this.composing) return { ok: false, reason: "composing" };
    const selection = this.getSelection();
    let nextInnerHtml: string;
    try {
      nextInnerHtml = this.serializeCanonical();
    } catch (cause) {
      this.rollback();
      this.reportError(cause);
      return { ok: false, reason: "dom-drift" };
    }
    if (nextInnerHtml === this.baselineCanonicalInnerHtml) {
      return { ok: true, checkpoint: null, selection };
    }
    return {
      ok: true,
      checkpoint: {
        previousInnerHtml: this.baselineInnerHtml,
        nextInnerHtml,
        previousText: this.baseline.text,
        nextText: nativeLogicalText(this.hostElement),
        beforeSelection: this.baselineSelection,
        selection,
        inputType: this.lastInputType,
      },
      selection,
    };
  }

  applyExternalIslandBaseline(
    baseline: NativeEditBaseline & { innerHtml: string },
    options: IslandExternalBaselineOptions = {},
  ): boolean {
    const currentLease = this.leaseStamp;
    const nextLease = cloneLeaseStamp(options.lease ?? currentLease);
    if (
      !this.hasCurrentLease()
      || !leaseStampsMatch(
        { ...currentLease, sourceRevision: nextLease.sourceRevision },
        nextLease,
      )
      || baseline.revision !== nextLease.sourceRevision
    ) return false;
    let canonical: string;
    try {
      canonical = normalizeEditableIslandHtml(baseline.innerHtml, {
        baselineInnerHtml: baseline.innerHtml,
      });
      if (this.serializeCanonical() !== canonical) return false;
    } catch {
      return false;
    }
    if (
      !leaseStampsMatch(currentLease, nextLease)
      && !this.lease.advance(currentLease, nextLease)
    ) return false;
    this.leaseStamp = nextLease;
    this.baseline = { ...baseline };
    this.baselineInnerHtml = baseline.innerHtml;
    this.baselineCanonicalInnerHtml = canonical;
    this.baselineChildren = Array.from(this.hostElement.childNodes).map(
      (node) => node.cloneNode(true),
    );
    this.baselineSelection = options.preserveLiveSelection
      ? this.getSelection()
      : baseline.selection ?? this.getSelection();
    if (!options.preserveLiveSelection && baseline.selection) {
      setSelectionValue(this.hostElement, baseline.selection);
    }
    this.lastInputType = null;
    this.clearExpectedInputDelivery();
    this.refreshLastValidatedDraft();
    this.emitState();
    return true;
  }

  applyExternalBaseline(
    baseline: NativeEditBaseline,
    options: IslandExternalBaselineOptions = {},
  ): boolean {
    let innerHtml: string;
    try {
      innerHtml = this.serializeCanonical();
    } catch {
      return false;
    }
    return this.applyExternalIslandBaseline(
      { ...baseline, innerHtml },
      options,
    );
  }

  runExpectedMutation<T>(operation: () => T): T {
    if (!this.hasCurrentLease()) return undefined as T;
    this.observer?.takeRecords();
    this.expectedMutationDepth += 1;
    try {
      return operation();
    } finally {
      this.observer?.takeRecords();
      this.expectedMutationDepth -= 1;
    }
  }

  rollback(): void {
    if (!this.hasCurrentLease()) return;
    const selection = this.getSelection();
    this.runExpectedMutation(() => restoreChildren(
      this.hostElement,
      this.baselineChildren,
    ));
    const length = nativeLogicalText(this.hostElement).length;
    setSelectionValue(this.hostElement, {
      anchor: Math.min(selection.anchor, length),
      focus: Math.min(selection.focus, length),
      affinity: selection.affinity,
    });
    this.lastInputType = null;
    this.clearExpectedInputDelivery();
    this.refreshLastValidatedDraft();
    this.emitState();
  }

  isComposing(): boolean {
    return this.hasCurrentLease() && this.composing;
  }

  consumeCompositionEscape(): boolean {
    if (!this.hasCurrentLease() || !this.composing) return false;
    this.compositionEscapeRequested = true;
    return true;
  }

  isDirty(): boolean {
    if (!this.hasCurrentLease()) return false;
    try {
      return this.serializeCanonical() !== this.baselineCanonicalInnerHtml;
    } catch {
      return true;
    }
  }

  hasPendingDraft(): boolean {
    return this.hasCurrentLease()
      && (this.isDirty() || this.composing || Boolean(this.pendingCommand));
  }

  private detach(): void {
    this.observer?.takeRecords();
    this.observer?.disconnect();
    this.observer = null;
    while (this.cleanup.length > 0) this.cleanup.pop()?.();
    const view = this.hostElement.ownerDocument.defaultView;
    if (this.stateFrame !== null) view?.cancelAnimationFrame(this.stateFrame);
    this.stateFrame = null;
  }

  fenceDispose(): void {
    this.dispose();
  }

  dispose(): void {
    if (this.disposed) return;
    this.detach();
    for (const [name, saved] of this.savedAttributes) {
      restoreAttribute(this.hostElement, name, saved);
    }
    this.pendingCommand = null;
    this.compositionSnapshot = null;
    this.clearExpectedInputDelivery();
    this.disposed = true;
  }
}
