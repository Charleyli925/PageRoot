import {
  createTargetRef,
  planSourcePatch,
  resolveTargetRef,
} from "../lib/source-patch-core.js";
import { isEditableIslandTarget } from "../lib/editable-island.js";
import { isTransparentSourceTextElement } from "../lib/source-text-map.js";
import { disableExecutableMarkup } from "./html-preview-sandbox.js";
import {
  SOURCE_ELEMENT_ATTRIBUTE,
  sourceElementFromDom,
  sourceElementId,
  uniqueSourceElement,
} from "./html-canvas-source-element";
import { PAGEROOT_ELEMENT_ID_ATTRIBUTE } from "../../shared/pageroot-element-identity.mjs";
import type {
  SourceElementValue,
  SourceIndexValue,
  SourceTargetRef,
  ActiveTextRange,
  TextRangeSegment,
} from "./html-canvas-internal-types";

function sourceParentPagerootId(
  sourceIndex: SourceIndexValue,
  sourceElement: SourceElementValue,
): string | null {
  if (!sourceElement.parentId) return null;
  const parent = sourceIndex.byNodeId.get(sourceElement.parentId);
  return parent?.type === "element" ? parent.pagerootId ?? null : null;
}

export function sourceTextNodeForDomText(
  textNode: Text,
  sourceIndex: SourceIndexValue,
): { nodeId: string; value: string } | null {
  const parentElement = textNode.parentElement;
  const sourceParent = sourceElementFromDom(parentElement, sourceIndex);
  if (!parentElement || !sourceParent) return null;
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

export function isCanonicalSourceElement(
  element: HTMLElement,
  sourceIndex: SourceIndexValue,
): boolean {
  const sourceElement = sourceElementFromDom(element, sourceIndex);
  const pagerootId = sourceElement?.pagerootId ?? null;
  if (!sourceElement || !pagerootId) return false;
  if (sourceElementId(element) !== pagerootId) return false;
  const domParent = element.parentElement?.closest<HTMLElement>(
    `[${SOURCE_ELEMENT_ATTRIBUTE}]`,
  ) ?? null;
  return sourceElementId(domParent) === sourceParentPagerootId(sourceIndex, sourceElement);
}

export function nativeEditHostForElement(
  element: HTMLElement,
  sourceIndex: SourceIndexValue,
): HTMLElement | null {
  let candidate = element.closest<HTMLElement>(`[${SOURCE_ELEMENT_ATTRIBUTE}]`);
  let nearestSafeCandidate: HTMLElement | null = null;
  while (candidate) {
    if (!isCanonicalSourceElement(candidate, sourceIndex)) return null;
    const candidateNode = sourceElementFromDom(candidate, sourceIndex);
    if (!candidateNode) return null;
    try {
      const candidateTargetRef = createTargetRef(
        sourceIndex,
        candidateNode,
        { level: "subregion" },
      ) as SourceTargetRef;
      if (isEditableIslandTarget(sourceIndex, candidateTargetRef).editable) {
        nearestSafeCandidate = candidate;
      }
    } catch {
      return null;
    }
    const computedDisplay = candidate.ownerDocument.defaultView
      ?.getComputedStyle(candidate).display.toLowerCase() ?? "";
    const tagName = candidate.tagName.toLowerCase();
    const standaloneTransparentBox = (
      computedDisplay !== "inline"
      && computedDisplay !== "contents"
    );
    const climbThrough = tagName === "br" || (
      isTransparentSourceTextElement(tagName) && !standaloneTransparentBox
    );
    if (!climbThrough) break;
    const parentCandidate = candidate.parentElement?.closest<HTMLElement>(
      `[${SOURCE_ELEMENT_ATTRIBUTE}]`,
    ) ?? null;
    if (
      !parentCandidate
      || parentCandidate === candidate.ownerDocument.body
      || parentCandidate === candidate.ownerDocument.documentElement
    ) break;
    candidate = parentCandidate;
  }
  return nearestSafeCandidate;
}

export type NativeTextFragmentCandidate = {
  parentElement: HTMLElement;
  textNode: Text;
  textNodeId: string;
  parentElementId: string | null;
  directTextOrdinal: number;
  textTargetRef: SourceTargetRef;
  sourceInnerHtml: string;
};

function nativeTextFragmentForDirectText(
  parentElement: HTMLElement,
  textNode: Text,
  sourceIndex: SourceIndexValue,
): NativeTextFragmentCandidate | null {
  if (
    !isCanonicalSourceElement(parentElement, sourceIndex)
    || nativeEditHostForElement(parentElement, sourceIndex)
    || textNode.parentElement !== parentElement
  ) return null;
  const parentDisplay = parentElement.ownerDocument.defaultView
    ?.getComputedStyle(parentElement).display ?? "";
  if (["flex", "inline-flex", "grid", "inline-grid"].includes(parentDisplay)) {
    return null;
  }
  const sourceText = sourceTextNodeForDomText(textNode, sourceIndex);
  const sourceParent = sourceElementFromDom(parentElement, sourceIndex);
  const sourceNode = sourceText ? sourceIndex.byNodeId.get(sourceText.nodeId) : null;
  if (
    !sourceText
    || sourceParent?.type !== "element"
    || sourceNode?.type !== "text"
    || sourceNode.parentId !== sourceParent.nodeId
  ) return null;
  try {
    const parentTargetRef = createTargetRef(sourceIndex, sourceParent, {
      level: "subregion",
    }) as SourceTargetRef;
    const textTargetRef = createTargetRef(sourceIndex, sourceNode, {
      level: "text",
    }) as SourceTargetRef;
    const parentIslandCapability = isEditableIslandTarget(
      sourceIndex,
      parentTargetRef,
    );
    if (
      parentIslandCapability.editable
      || parentIslandCapability.code !== "EDITABLE_ISLAND_STRUCTURE_UNSUPPORTED"
    ) return null;
    const sourceInnerHtml = sourceIndex.source.slice(
      sourceNode.range.startOffset,
      sourceNode.range.endOffset,
    );
    const ordinal = Math.max(0, sourceParent.textNodeIds.indexOf(sourceText.nodeId));
    planSourcePatch({
      type: "update-direct-text-node",
      targetRef: parentTargetRef,
      textTargetRef,
      elementId: sourceParent.pagerootId,
      parentElementId: sourceParent.pagerootId,
      directTextOrdinal: ordinal,
      beforeFragmentHtml: sourceInnerHtml,
      nextFragmentHtml: sourceInnerHtml,
      expectedSourceSha256: sourceIndex.sourceSha256,
    }, sourceIndex);
    return {
      parentElement,
      textNode,
      textNodeId: sourceText.nodeId,
      parentElementId: sourceParent.pagerootId ?? null,
      directTextOrdinal: ordinal,
      textTargetRef,
      sourceInnerHtml,
    };
  } catch {
    return null;
  }
}

export function nativeTextFragmentForRange(
  range: ActiveTextRange | null,
  sourceIndex: SourceIndexValue,
): NativeTextFragmentCandidate | null {
  if (!range || range.segments.length !== 1 || !range.target.elementId) return null;
  const segment = range.segments[0];
  const sourceText = sourceIndex.byNodeId.get(segment.textNodeId);
  const sourceParent = range.target.elementId
    ? sourceIndex.byPagerootId.get(range.target.elementId)
    : null;
  if (
    sourceText?.type !== "text"
    || sourceParent?.type !== "element"
    || sourceText.parentId !== sourceParent.nodeId
    || segment.startOffset < 0
    || segment.endOffset > sourceText.value.length
    || segment.endOffset <= segment.startOffset
  ) return null;
  const documentNode = range.styleElements[0]?.ownerDocument;
  const parentElement = sourceParent.pagerootId && documentNode
    ? uniqueSourceElement(documentNode, sourceParent.pagerootId)
    : null;
  if (!parentElement) return null;
  const textNode = Array.from(parentElement.childNodes).find((node): node is Text => (
    node.nodeType === 3
    && sourceTextNodeForDomText(node as Text, sourceIndex)?.nodeId === sourceText.nodeId
  )) ?? null;
  if (!textNode) return null;
  return nativeTextFragmentForDirectText(parentElement, textNode, sourceIndex);
}

export function nativeTextFragmentForElement(
  element: HTMLElement,
  sourceIndex: SourceIndexValue,
  textNodeHint?: Text | null,
): NativeTextFragmentCandidate | null {
  const parentElement = element.closest<HTMLElement>(`[${SOURCE_ELEMENT_ATTRIBUTE}]`);
  if (!parentElement) return null;
  const hinted = textNodeHint
    && parentElement.contains(textNodeHint)
    && textNodeHint.parentElement === parentElement
    ? textNodeHint
    : null;
  if (hinted) {
    return nativeTextFragmentForDirectText(parentElement, hinted, sourceIndex);
  }
  const directTextNodes = Array.from(parentElement.childNodes).filter((node): node is Text => {
    if (node.nodeType !== 3) return false;
    const textNode = node as Text;
    return Boolean(textNode.data.trim())
      && Boolean(sourceTextNodeForDomText(textNode, sourceIndex));
  });
  if (directTextNodes.length !== 1) return null;
  return nativeTextFragmentForDirectText(
    parentElement,
    directTextNodes[0],
    sourceIndex,
  );
}

export const TEXT_FRAGMENT_HOST_ATTRIBUTE = "data-pageroot-text-fragment-host";

export function mountNativeTextFragmentHost(textNode: Text): {
  hostElement: HTMLElement;
  release: () => void;
} | null {
  const parentNode = textNode.parentNode;
  if (!parentNode) return null;
  const hostElement = textNode.ownerDocument.createElement("pageroot-text-fragment");
  hostElement.setAttribute(TEXT_FRAGMENT_HOST_ATTRIBUTE, "true");
  hostElement.style.setProperty("all", "unset", "important");
  hostElement.style.setProperty("display", "inline", "important");
  parentNode.insertBefore(hostElement, textNode);
  hostElement.appendChild(textNode);
  let released = false;
  return {
    hostElement,
    release: () => {
      if (released) return;
      released = true;
      const mountedParent = hostElement.parentNode;
      if (!mountedParent) return;
      while (hostElement.firstChild) {
        mountedParent.insertBefore(hostElement.firstChild, hostElement);
      }
      hostElement.remove();
    },
  };
}

export function sourceTextParentsForSegments(
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

export { alignPreviewSourceSurface } from "../lib/align-preview-source-surface.js";

export function sourceBackedPreviewElements(documentNode: Document): Element[] {
  const elements: Element[] = [];
  const visit = (element: Element) => {
    if (element.hasAttribute(SOURCE_ELEMENT_ATTRIBUTE)) elements.push(element);
    const childElements = element.tagName === "TEMPLATE"
      ? Array.from((element as HTMLTemplateElement).content.children)
      : Array.from(element.children);
    childElements.forEach(visit);
  };
  if (documentNode.documentElement) visit(documentNode.documentElement);
  return elements;
}

export function canonicalNativeHostPreview(
  rootElement: HTMLElement,
  nextElementId: string,
  nextIndex: SourceIndexValue,
): HTMLElement | null {
  const view = rootElement.ownerDocument.defaultView;
  if (!view || !nextElementId) return null;
  const sourceElement = nextIndex.byPagerootId.get(nextElementId)
    ?? nextIndex.byNodeId.get(nextElementId);
  const pagerootId = sourceElement?.type === "element"
    ? sourceElement.pagerootId
    : nextElementId;
  if (!pagerootId) return null;
  const detachedDocument = new view.DOMParser().parseFromString(
    disableExecutableMarkup(nextIndex.source),
    "text/html",
  );
  const detachedTarget = uniqueSourceElement(detachedDocument, pagerootId);
  return detachedTarget?.tagName === rootElement.tagName ? detachedTarget : null;
}

export function remountNativeHostFromSource(
  hostElement: HTMLElement,
  nodeId: string,
  sourceIndex: SourceIndexValue,
): boolean {
  const canonical = canonicalNativeHostPreview(hostElement, nodeId, sourceIndex);
  if (!canonical) return false;
  const documentNode = hostElement.ownerDocument;
  hostElement.replaceChildren(
    ...Array.from(canonical.childNodes).map((node) => documentNode.importNode(node, true)),
  );
  return true;
}

export type StableMountedSourceNodeRefresh = Readonly<{
  element: HTMLElement;
  pagerootId: string;
}>;

/**
 * Lists live elements whose persistent Stable ID still resolves exactly in the
 * latest source. Runtime DOM is not rewritten with parse-local node ids.
 */
export function refreshStableMountedPreviewSourceNodeIds(
  documentNode: Document,
  nextIndex: SourceIndexValue,
): readonly StableMountedSourceNodeRefresh[] {
  const ViewHTMLElement = documentNode.defaultView?.HTMLElement;
  return sourceBackedPreviewElements(documentNode).flatMap((element) => {
    if (!ViewHTMLElement || !(element instanceof ViewHTMLElement)) return [];
    const pagerootId = element.getAttribute(PAGEROOT_ELEMENT_ID_ATTRIBUTE);
    const nextElement = pagerootId ? nextIndex.byPagerootId.get(pagerootId) : null;
    if (
      !pagerootId
      || !nextElement
      || nextElement.type !== "element"
      || nextElement.tagName !== element.tagName.toLowerCase()
    ) return [];
    return [{ element, pagerootId }];
  });
}

export function adoptCanonicalHistoryIslandInPlace(options: {
  rootElement: HTMLElement;
  previousIndex: SourceIndexValue;
  nextIndex: SourceIndexValue;
  previousTargetRef: SourceTargetRef;
  nextTargetRef: SourceTargetRef;
}): boolean {
  const {
    rootElement,
    previousIndex,
    nextIndex,
    previousTargetRef,
    nextTargetRef,
  } = options;
  const documentNode = rootElement.ownerDocument;
  const previousResolution = resolveTargetRef(previousIndex, previousTargetRef);
  const nextResolution = resolveTargetRef(nextIndex, nextTargetRef);
  if (
    previousResolution.resolution !== "exact"
    || nextResolution.resolution !== "exact"
    || previousResolution.target?.type !== "element"
    || nextResolution.target?.type !== "element"
    || sourceElementId(rootElement) !== previousResolution.target.pagerootId
  ) return false;

  const previousCapability = isEditableIslandTarget(
    previousIndex,
    previousTargetRef,
  );
  const nextCapability = isEditableIslandTarget(nextIndex, nextTargetRef);
  if (!previousCapability.editable || !nextCapability.editable) return false;
  const previousIsland = previousCapability.island;
  const nextIsland = nextCapability.island;
  if (
    previousIsland.element.pagerootId !== previousResolution.target.pagerootId
    || nextIsland.element.pagerootId !== nextResolution.target.pagerootId
    || previousIsland.element.tagName !== nextIsland.element.tagName
    || previousIndex.source.slice(0, previousIsland.contentRange.startOffset)
      !== nextIndex.source.slice(0, nextIsland.contentRange.startOffset)
    || previousIndex.source.slice(previousIsland.contentRange.endOffset)
      !== nextIndex.source.slice(nextIsland.contentRange.endOffset)
  ) return false;

  const canonicalTarget = canonicalNativeHostPreview(
    rootElement,
    String(nextIsland.element.pagerootId || nextIsland.element.nodeId || ""),
    nextIndex,
  );
  if (!canonicalTarget) return false;
  const canonicalChildren = Array.from(canonicalTarget.childNodes).map(
    (node) => documentNode.importNode(node, true),
  );

  rootElement.replaceChildren(...canonicalChildren);
  const nextElements = nextIndex.elements as SourceElementValue[];
  const mountedElements = sourceBackedPreviewElements(documentNode);
  if (
    mountedElements.length !== nextElements.length
    || mountedElements.some((element, index) => (
      element.getAttribute(SOURCE_ELEMENT_ATTRIBUTE) !== nextElements[index].pagerootId
      || element.tagName.toLowerCase() !== nextElements[index].tagName
    ))
  ) throw new Error("历史文字结果无法保持当前画布的 Stable ID 映射。");
  return true;
}
