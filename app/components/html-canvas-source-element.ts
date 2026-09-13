import type { SourceElementValue, SourceIndexValue } from "./html-canvas-internal-types";
import {
  SOURCE_ELEMENT_ATTRIBUTE,
  sourceElementId,
} from "./html-canvas-source-authority.js";

export {
  SOURCE_ELEMENT_ATTRIBUTE,
  escapedPagerootElementId,
  sourceElementSelector,
  sourceElementId,
  uniqueSourceElement,
  grantEditorCreatedSourceElements,
  revokeRemovedSourceElements,
} from "./html-canvas-source-authority.js";
export type { RuntimeSourceAuthority } from "./html-canvas-source-authority.js";

export function closestSourceElement(
  node: EventTarget | Node | null,
): HTMLElement | null {
  if (!node || typeof node !== "object") return null;
  const asNode = node as Node;
  const element = asNode.nodeType === 3
    ? (asNode as Text).parentElement
    : asNode.nodeType === 1
      ? asNode as HTMLElement
      : null;
  return element?.closest<HTMLElement>(`[${SOURCE_ELEMENT_ATTRIBUTE}]`) ?? null;
}

export function sourceElementFromDom(
  element: Element | null,
  sourceIndex: SourceIndexValue | null | undefined,
): SourceElementValue | null {
  const elementId = sourceElementId(element);
  if (!elementId || !sourceIndex) return null;
  const sourceElement = sourceIndex.byPagerootId.get(elementId);
  return sourceElement?.type === "element" ? sourceElement : null;
}

export function registerProvedStableSourceElements(options: {
  candidates: unknown;
  documentNode: Document | null;
  sourceIndex: SourceIndexValue | null | undefined;
  elements: WeakSet<HTMLElement>;
  pagerootIds: WeakMap<HTMLElement, string>;
  claimed: Map<string, HTMLElement>;
  conflicted: Set<string>;
  markerAttribute?: string;
}): boolean {
  const {
    candidates,
    documentNode,
    sourceIndex,
    elements,
    pagerootIds,
    claimed,
    conflicted,
    markerAttribute,
  } = options;
  if (!Array.isArray(candidates) || !documentNode) return false;
  for (const value of candidates) {
    const element = value as HTMLElement;
    if (
      element?.nodeType !== 1
      || typeof element.getAttribute !== "function"
      || element.ownerDocument !== documentNode
    ) continue;
    const pagerootId = sourceElementId(element);
    const sourceEntry = pagerootId ? sourceIndex?.byPagerootId.get(pagerootId) : null;
    if (
      !pagerootId
      || sourceEntry?.type !== "element"
      || sourceEntry.tagName !== element.localName
      || (
        markerAttribute
        && element.getAttribute(markerAttribute) !== pagerootId
      )
    ) continue;
    if (conflicted.has(pagerootId)) continue;
    const existing = claimed.get(pagerootId);
    if (existing && existing !== element) {
      elements.delete(existing);
      claimed.delete(pagerootId);
      conflicted.add(pagerootId);
      continue;
    }
    claimed.set(pagerootId, element);
    pagerootIds.set(element, pagerootId);
    elements.add(element);
  }
  return true;
}
