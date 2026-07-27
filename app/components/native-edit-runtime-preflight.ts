import { SOURCE_NODE_ATTRIBUTE } from "../lib/source-index.js";
import {
  applyNativeEditSessionAttributes,
  captureNativeEditSessionAttributes,
  chooseNativeEditHostMode,
  classifyNativeEventDelivery,
  NATIVE_EDIT_HOST_MODE,
  NATIVE_EDIT_SESSION_CONTROLLED_ATTRIBUTES,
  restoreNativeEditSessionAttributes,
  type NativeEditHostMode,
} from "../lib/native-edit-policy.js";
import type { NativeEditRuntimePreflight } from "../lib/native-edit-capability.js";
import { nativeLogicalText } from "../lib/native-dom-logical-index.js";
import { RuntimeDomSourceMap } from "../lib/runtime-dom-source-map.js";
import type { SourceTextMap } from "../lib/source-text-map.js";

export type NativeLayoutFingerprint = {
  x: number;
  y: number;
  width: number;
  height: number;
  scrollWidth: number;
  scrollHeight: number;
  display: string;
  position: string;
  font: string;
  lineHeight: string;
  whiteSpace: string;
  writingMode: string;
  transitionDuration: string;
  animationDuration: string;
  animationName: string;
  textRects: Array<{ x: number; y: number; width: number; height: number }>;
};

export type NativeEditModePreflight = {
  mode: NativeEditHostMode;
  fingerprint: NativeLayoutFingerprint;
  focusAccepted: boolean;
  layoutStable: boolean;
  styleStable: boolean;
};

export type NativeRuntimePreflightResult = {
  hostMode: NativeEditHostMode | null;
  runtimeMap: RuntimeDomSourceMap | null;
  runtime: NativeEditRuntimePreflight;
  layoutDebug: {
    before: NativeLayoutFingerprint;
    plaintextOnly: NativeEditModePreflight | null;
    controlled: NativeEditModePreflight | null;
    selectedMode: NativeEditHostMode | null;
    after: NativeLayoutFingerprint;
    restored: NativeLayoutFingerprint;
  };
};

export function nativeLayoutFingerprint(
  element: HTMLElement,
): NativeLayoutFingerprint {
  const rect = element.getBoundingClientRect();
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  const textRects: NativeLayoutFingerprint["textRects"] = [];
  const walker = element.ownerDocument.createTreeWalker(
    element,
    element.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4,
  );
  let current = walker.nextNode();
  while (current) {
    const text = (current as Text).data;
    for (const match of text.matchAll(/[^ \t\r\n\f]+/gu)) {
      const startOffset = match.index;
      const endOffset = startOffset + match[0].length;
      const range = element.ownerDocument.createRange();
      range.setStart(current, startOffset);
      range.setEnd(current, endOffset);
      for (const textRect of Array.from(range.getClientRects())) {
        textRects.push({
          x: Math.round((textRect.x - rect.x) * 100) / 100,
          y: Math.round((textRect.y - rect.y) * 100) / 100,
          width: Math.round(textRect.width * 100) / 100,
          height: Math.round(textRect.height * 100) / 100,
        });
      }
    }
    current = walker.nextNode();
  }
  return {
    x: Math.round(rect.x * 100) / 100,
    y: Math.round(rect.y * 100) / 100,
    width: Math.round(rect.width * 100) / 100,
    height: Math.round(rect.height * 100) / 100,
    scrollWidth: element.scrollWidth,
    scrollHeight: element.scrollHeight,
    display: style?.display ?? "",
    position: style?.position ?? "",
    font: style?.font ?? "",
    lineHeight: style?.lineHeight ?? "",
    whiteSpace: style?.whiteSpace ?? "",
    writingMode: style?.writingMode ?? "",
    transitionDuration: style?.transitionDuration ?? "",
    animationDuration: style?.animationDuration ?? "",
    animationName: style?.animationName ?? "",
    textRects,
  };
}

export function sameNativeLayout(
  left: NativeLayoutFingerprint,
  right: NativeLayoutFingerprint,
): boolean {
  const sameTextRects = left.textRects.length === right.textRects.length
    && left.textRects.every((rect, index) => {
      const candidate = right.textRects[index];
      return Boolean(
        candidate
        && Math.abs(rect.x - candidate.x) <= 0.5
        && Math.abs(rect.y - candidate.y) <= 0.5
        && Math.abs(rect.width - candidate.width) <= 0.5
        && Math.abs(rect.height - candidate.height) <= 0.5
      );
    });
  return (
    Math.abs(left.width - right.width) <= 0.5
    && Math.abs(left.height - right.height) <= 0.5
    && left.scrollWidth === right.scrollWidth
    && left.scrollHeight === right.scrollHeight
    && sameTextRects
  );
}

export function sameNativeTextStyle(
  left: NativeLayoutFingerprint,
  right: NativeLayoutFingerprint,
  options: {
    allowUaOwnedWhiteSpace?: boolean;
  } = {},
): boolean {
  // Chromium owns white-space on a plaintext-only editing host: authored
  // `normal`, `nowrap`, or `pre-line` can be reported as `pre`/`pre-wrap`.
  // This is only a style-name exception. Geometry remains an independent gate.
  const uaOwnedEditingWhiteSpace = Boolean(options.allowUaOwnedWhiteSpace) && (
    ["normal", "nowrap", "pre-line"].includes(left.whiteSpace)
    && ["pre", "pre-wrap"].includes(right.whiteSpace)
  );
  const whiteSpaceStable = left.whiteSpace === right.whiteSpace
    || uaOwnedEditingWhiteSpace;
  return (
    left.display === right.display
    && left.position === right.position
    && left.font === right.font
    && left.lineHeight === right.lineHeight
    && whiteSpaceStable
    && left.writingMode === right.writingMode
  );
}

function hasGeneratedPseudoContent(element: HTMLElement): boolean {
  const view = element.ownerDocument.defaultView;
  if (!view) return true;
  const hasContent = (
    candidate: HTMLElement,
    pseudo: "::before" | "::after",
  ) => {
    const content = view.getComputedStyle(candidate, pseudo).content;
    return Boolean(
      content
      && content !== "none"
      && content !== "normal"
      && content !== "\"\""
    );
  };
  return [
    element,
    ...Array.from(element.querySelectorAll<HTMLElement>("*")),
  ].some((candidate) => (
    hasContent(candidate, "::before") || hasContent(candidate, "::after")
  ));
}

export function buildRuntimeDomMap(
  rootElement: HTMLElement,
  sourceMap: SourceTextMap,
  rootTargetRef: Record<string, unknown>,
): RuntimeDomSourceMap | null {
  const runtimeMap = new RuntimeDomSourceMap({
    epoch: sourceMap.sourceSha256.slice(0, 12),
    idPrefix: "pageroot",
  });
  const sourceElements = [
    rootElement,
    ...Array.from(
      rootElement.querySelectorAll<HTMLElement>(`[${SOURCE_NODE_ATTRIBUTE}]`),
    ),
  ];
  for (const element of sourceElements) {
    const sourceNodeId = element.getAttribute(SOURCE_NODE_ATTRIBUTE);
    if (!sourceNodeId) return null;
    runtimeMap.bindElement(element, {
      sourceNodeId,
      targetRef: element === rootElement ? rootTargetRef : null,
    });
  }

  const sourceRuns = sourceMap.runs.filter((run) => run.kind === "text");
  const showText = rootElement.ownerDocument.defaultView?.NodeFilter.SHOW_TEXT ?? 4;
  const walker = rootElement.ownerDocument.createTreeWalker(rootElement, showText);
  const entries: Array<{
    node: Text;
    spans: Array<{
      domStart: number;
      domEnd: number;
      textNodeId: string;
      sourceStartOffset: number;
      sourceEndOffset: number;
    }>;
  }> = [];
  let runIndex = 0;
  let runOffset = 0;
  let current = walker.nextNode();
  while (current) {
    const textNode = current as Text;
    const spans = [];
    let domOffset = 0;
    while (domOffset < textNode.data.length) {
      const run = sourceRuns[runIndex];
      if (!run) return null;
      const remainingDom = textNode.data.length - domOffset;
      const remainingSource = run.text.length - runOffset;
      const length = Math.min(remainingDom, remainingSource);
      if (
        length <= 0
        || textNode.data.slice(domOffset, domOffset + length)
          !== run.text.slice(runOffset, runOffset + length)
      ) return null;
      spans.push({
        domStart: domOffset,
        domEnd: domOffset + length,
        textNodeId: run.textNodeId,
        sourceStartOffset: runOffset,
        sourceEndOffset: runOffset + length,
      });
      domOffset += length;
      runOffset += length;
      if (runOffset === run.text.length) {
        runIndex += 1;
        runOffset = 0;
      }
    }
    if (textNode.data.length > 0) entries.push({ node: textNode, spans });
    current = walker.nextNode();
  }
  if (runIndex !== sourceRuns.length || runOffset !== 0) return null;
  runtimeMap.bindTextSequence(rootElement, entries);
  return runtimeMap;
}

function restorePriorInteractionState({
  rootElement,
  priorActiveElement,
  scrollPositions,
  liveSelection,
  priorSelection,
}: {
  rootElement: HTMLElement;
  priorActiveElement: Element | null;
  scrollPositions: Array<{ element: Element; left: number; top: number }>;
  liveSelection: Selection | null;
  priorSelection: {
    anchorNode: Node;
    anchorOffset: number;
    focusNode: Node;
    focusOffset: number;
  } | null;
}): void {
  const documentNode = rootElement.ownerDocument;
  const view = documentNode.defaultView;
  const ViewHTMLElement = view?.HTMLElement;
  if (
    ViewHTMLElement
    && priorActiveElement instanceof ViewHTMLElement
    && priorActiveElement.isConnected
  ) {
    (priorActiveElement as HTMLElement).focus({ preventScroll: true });
  } else {
    rootElement.blur();
  }
  for (const position of scrollPositions) {
    position.element.scrollLeft = position.left;
    position.element.scrollTop = position.top;
  }
  if (!liveSelection) return;
  liveSelection.removeAllRanges();
  if (
    priorSelection
    && priorSelection.anchorNode.isConnected
    && priorSelection.focusNode.isConnected
  ) {
    liveSelection.setBaseAndExtent(
      priorSelection.anchorNode,
      priorSelection.anchorOffset,
      priorSelection.focusNode,
      priorSelection.focusOffset,
    );
  }
}

export function nativeRuntimePreflight(
  rootElement: HTMLElement,
  sourceMap: SourceTextMap,
  rootTargetRef: Record<string, unknown>,
  options: { ariaLabel?: string } = {},
): NativeRuntimePreflightResult {
  const runtimeMap = buildRuntimeDomMap(rootElement, sourceMap, rootTargetRef);
  const documentNode = rootElement.ownerDocument;
  const view = documentNode.defaultView;
  const before = nativeLayoutFingerprint(rootElement);
  const priorActiveElement = documentNode.activeElement;
  const liveSelection = documentNode.getSelection();
  const priorSelection = liveSelection?.anchorNode && liveSelection.focusNode
    ? {
        anchorNode: liveSelection.anchorNode,
        anchorOffset: liveSelection.anchorOffset,
        focusNode: liveSelection.focusNode,
        focusOffset: liveSelection.focusOffset,
      }
    : null;
  const hadSelectionRange = Boolean(liveSelection?.rangeCount);
  const scrollPositions: Array<{
    element: Element;
    left: number;
    top: number;
  }> = [];
  let scrollCandidate: Element | null = rootElement;
  while (scrollCandidate) {
    scrollPositions.push({
      element: scrollCandidate,
      left: scrollCandidate.scrollLeft,
      top: scrollCandidate.scrollTop,
    });
    scrollCandidate = scrollCandidate.parentElement;
  }
  const scrollingElement = documentNode.scrollingElement;
  if (
    scrollingElement
    && !scrollPositions.some(({ element }) => element === scrollingElement)
  ) {
    scrollPositions.push({
      element: scrollingElement,
      left: scrollingElement.scrollLeft,
      top: scrollingElement.scrollTop,
    });
  }

  const originalAttributes = captureNativeEditSessionAttributes(rootElement);
  const MutationObserverConstructor = view?.MutationObserver;
  const preflightObserver = MutationObserverConstructor
    ? new MutationObserverConstructor(() => undefined)
    : null;
  preflightObserver?.observe(documentNode.documentElement, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
  });
  const preflightMutationRecords: MutationRecord[] = [];
  const collectPreflightMutations = () => {
    preflightMutationRecords.push(...(preflightObserver?.takeRecords() ?? []));
  };
  const measureMode = (mode: NativeEditHostMode): NativeEditModePreflight => {
    applyNativeEditSessionAttributes(rootElement, {
      hostMode: mode,
      ariaLabel: options.ariaLabel,
    });
    rootElement.focus({ preventScroll: true });
    const fingerprint = nativeLayoutFingerprint(rootElement);
    collectPreflightMutations();
    return {
      mode,
      fingerprint,
      focusAccepted: documentNode.activeElement === rootElement,
      layoutStable: sameNativeLayout(before, fingerprint),
      styleStable: sameNativeTextStyle(before, fingerprint, {
        allowUaOwnedWhiteSpace: mode === NATIVE_EDIT_HOST_MODE.PLAINTEXT_ONLY,
      }),
    };
  };

  let plaintextOnly: NativeEditModePreflight | null = null;
  let controlled: NativeEditModePreflight | null = null;
  let preflightFailed = false;
  try {
    plaintextOnly = measureMode(NATIVE_EDIT_HOST_MODE.PLAINTEXT_ONLY);
    if (!plaintextOnly.layoutStable || !plaintextOnly.styleStable) {
      controlled = measureMode(NATIVE_EDIT_HOST_MODE.CONTROLLED);
    }
  } catch {
    preflightFailed = true;
  } finally {
    restoreNativeEditSessionAttributes(rootElement, originalAttributes);
    try {
      restorePriorInteractionState({
        rootElement,
        priorActiveElement,
        scrollPositions,
        liveSelection,
        priorSelection,
      });
    } catch {
      preflightFailed = true;
    }
    collectPreflightMutations();
    preflightObserver?.disconnect();
  }

  const restored = nativeLayoutFingerprint(rootElement);
  const activeElementRestored = documentNode.activeElement === priorActiveElement;
  const selectionRestored = !liveSelection
    || (
      !hadSelectionRange
        ? liveSelection.rangeCount === 0
        : Boolean(
            priorSelection
            && liveSelection.anchorNode === priorSelection.anchorNode
            && liveSelection.anchorOffset === priorSelection.anchorOffset
            && liveSelection.focusNode === priorSelection.focusNode
            && liveSelection.focusOffset === priorSelection.focusOffset
          )
    );
  const restorationStable = sameNativeLayout(before, restored)
    && sameNativeTextStyle(before, restored);
  const hostMode = chooseNativeEditHostMode({ plaintextOnly, controlled });
  const selectedAttempt = hostMode === NATIVE_EDIT_HOST_MODE.PLAINTEXT_ONLY
    ? plaintextOnly
    : hostMode === NATIVE_EDIT_HOST_MODE.CONTROLLED
      ? controlled
      : null;
  const sessionAttributeNames = new Set(
    NATIVE_EDIT_SESSION_CONTROLLED_ATTRIBUTES,
  );
  const unexpectedPreflightMutations = preflightMutationRecords.filter(
    (record) => !(
      record.type === "attributes"
      && record.target === rootElement
      && Boolean(
        record.attributeName
        && sessionAttributeNames.has(record.attributeName)
      )
    ),
  );
  const writingModeSupportsNativeCaret = (
    before.writingMode === ""
    || before.writingMode === "horizontal-tb"
  );
  const hasDisplayContents = [
    rootElement,
    ...Array.from(rootElement.querySelectorAll<HTMLElement>("*")),
  ].some((element) => (
    view?.getComputedStyle(element).display.toLowerCase() === "contents"
  ));
  const nativeEventDeliveryMode = classifyNativeEventDelivery({
    hasDisplayContents,
    observerReady: Boolean(preflightObserver),
  });
  const after = selectedAttempt?.fingerprint
    ?? controlled?.fingerprint
    ?? plaintextOnly?.fingerprint
    ?? before;

  return {
    hostMode,
    runtimeMap,
    layoutDebug: {
      before,
      plaintextOnly,
      controlled,
      selectedMode: hostMode,
      after,
      restored,
    },
    runtime: {
      preflightComplete: true,
      sourceBacked: Boolean(rootElement.getAttribute(SOURCE_NODE_ATTRIBUTE)),
      isConnected: rootElement.isConnected,
      crossOrigin: false,
      insideShadowRoot: rootElement.getRootNode() !== rootElement.ownerDocument,
      generatedContent: false,
      pseudoContent: hasGeneratedPseudoContent(rootElement),
      isSingleTextIsland: nativeLogicalText(rootElement) === sourceMap.text,
      mappingComplete: Boolean(runtimeMap),
      contentEditableMode: hostMode,
      styleStable: Boolean(selectedAttempt?.styleStable && restorationStable),
      layoutStable: Boolean(selectedAttempt?.layoutStable && restorationStable),
      selectionStable: Boolean(
        selectedAttempt?.focusAccepted
        && activeElementRestored
        && selectionRestored
        && writingModeSupportsNativeCaret
        && (
          rootElement.ownerDocument.caretPositionFromPoint
          || rootElement.ownerDocument.caretRangeFromPoint
        )
      ),
      observerReady: Boolean(preflightObserver),
      nativeEventDeliveryMode,
      nativeEventDeliveryStable: nativeEventDeliveryMode === "native",
      nativeEventDeliveryGuarded: nativeEventDeliveryMode === "observer-guarded",
      authorMutationRisk: preflightFailed
        || unexpectedPreflightMutations.length > 0
        || !restorationStable,
    },
  };
}
