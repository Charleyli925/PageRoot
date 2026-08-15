import {
  SOURCE_NODE_ATTRIBUTE,
  createTargetRef,
  instrumentPreviewHtml,
  planSourcePatch,
  resolveTargetRef,
} from "../lib/source-patch-core.js";
import { isEditableIslandTarget } from "../lib/editable-island.js";
import { isTransparentSourceTextElement } from "../lib/source-text-map.js";
import { disableExecutableMarkup } from "./html-preview-sandbox.js";
import { escapedSourceNodeId } from "./html-canvas-page-view";
import type {
  SourceElementValue,
  SourceIndexValue,
  SourceTargetRef,
  ActiveTextRange,
  TextRangeSegment,
} from "./html-canvas-internal-types";
import type { IslandEditingController } from "./IslandEditingController";

export function sourceTextNodeForDomText(
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

export function isCanonicalSourceElement(
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

export function nativeEditHostForElement(
  element: HTMLElement,
  sourceIndex: SourceIndexValue,
): HTMLElement | null {
  let candidate = element.closest<HTMLElement>(`[${SOURCE_NODE_ATTRIBUTE}]`);
  let nearestSafeCandidate: HTMLElement | null = null;
  while (candidate) {
    if (!isCanonicalSourceElement(candidate, sourceIndex)) return null;
    const candidateNodeId = candidate.getAttribute(SOURCE_NODE_ATTRIBUTE);
    const candidateNode = candidateNodeId
      ? sourceIndex.byNodeId.get(candidateNodeId)
      : null;
    if (candidateNode?.type !== "element") return null;
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
    // Inline semantic tags normally join their surrounding sentence. Once an
    // author turns one into its own rendered box (for example a block metric
    // implemented with <strong>), it is the text host itself rather than a
    // reason to climb into a much larger, non-text parent such as <article>.
    const standaloneTransparentBox = (
      computedDisplay !== "inline"
      && computedDisplay !== "contents"
    );
    if (!isTransparentSourceTextElement(tagName) || standaloneTransparentBox) break;
    const parentCandidate = candidate.parentElement?.closest<HTMLElement>(
      `[${SOURCE_NODE_ATTRIBUTE}]`,
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
  const parentNodeId = parentElement.getAttribute(SOURCE_NODE_ATTRIBUTE);
  const sourceParent = parentNodeId ? sourceIndex.byNodeId.get(parentNodeId) : null;
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
    planSourcePatch({
      type: "update-direct-text-node",
      targetRef: parentTargetRef,
      textTargetRef,
      nodeId: sourceParent.nodeId,
      textNodeId: sourceText.nodeId,
      beforeFragmentHtml: sourceInnerHtml,
      nextFragmentHtml: sourceInnerHtml,
      expectedSourceSha256: sourceIndex.sourceSha256,
    }, sourceIndex);
    return {
      parentElement,
      textNode,
      textNodeId: sourceText.nodeId,
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
  if (!range || range.segments.length !== 1 || !range.target.nodeId) return null;
  const segment = range.segments[0];
  const sourceText = sourceIndex.byNodeId.get(segment.textNodeId);
  if (
    sourceText?.type !== "text"
    || !sourceText.parentId
    || sourceText.parentId !== range.target.nodeId
    || segment.startOffset < 0
    || segment.endOffset > sourceText.value.length
    || segment.endOffset <= segment.startOffset
  ) return null;
  const sourceParent = sourceIndex.byNodeId.get(sourceText.parentId);
  if (sourceParent?.type !== "element") return null;
  const documentNode = range.styleElements[0]?.ownerDocument;
  const parentElement = documentNode?.querySelector<HTMLElement>(
    `[${SOURCE_NODE_ATTRIBUTE}="${escapedSourceNodeId(sourceParent.nodeId)}"]`,
  ) ?? null;
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
  const parentElement = element.closest<HTMLElement>(`[${SOURCE_NODE_ATTRIBUTE}]`);
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

export function sourceBackedPreviewElements(documentNode: Document): Element[] {
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

export function canonicalNativeHostPreview(
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

export function refreshMountedPreviewSourceNodeIds(
  documentNode: Document,
  previousIndex: SourceIndexValue,
  nextIndex: SourceIndexValue,
  options: {
    session?: IslandEditingController;
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
    || rootElement.getAttribute(SOURCE_NODE_ATTRIBUTE)
      !== previousResolution.target.nodeId
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
    previousIsland.element.nodeId !== previousResolution.target.nodeId
    || nextIsland.element.nodeId !== nextResolution.target.nodeId
    || previousIsland.element.tagName !== nextIsland.element.tagName
    || previousIndex.source.slice(0, previousIsland.contentRange.startOffset)
      !== nextIndex.source.slice(0, nextIsland.contentRange.startOffset)
    || previousIndex.source.slice(previousIsland.contentRange.endOffset)
      !== nextIndex.source.slice(nextIsland.contentRange.endOffset)
  ) return false;

  const canonicalTarget = canonicalNativeHostPreview(
    rootElement,
    nextIsland.element.nodeId,
    nextIndex,
  );
  if (!canonicalTarget) return false;
  const canonicalChildren = Array.from(canonicalTarget.childNodes).map(
    (node) => documentNode.importNode(node, true),
  );
  if (!refreshMountedPreviewSourceNodeIds(
    documentNode,
    previousIndex,
    nextIndex,
    { excludeRoot: rootElement },
  )) return false;

  rootElement.replaceChildren(...canonicalChildren);
  rootElement.setAttribute(SOURCE_NODE_ATTRIBUTE, nextIsland.element.nodeId);
  const nextElements = nextIndex.elements as SourceElementValue[];
  const mountedElements = sourceBackedPreviewElements(documentNode);
  if (
    mountedElements.length !== nextElements.length
    || mountedElements.some((element, index) => (
      element.getAttribute(SOURCE_NODE_ATTRIBUTE) !== nextElements[index].nodeId
      || element.tagName.toLowerCase() !== nextElements[index].tagName
    ))
  ) throw new Error("历史文字结果无法保持当前画布的源码节点映射。");
  return true;
}
