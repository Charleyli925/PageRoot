import { STEMMIO_ELEMENT_ID_ATTRIBUTE } from "../../shared/stemmio-element-identity.mjs";
import type { SourceElementValue, SourceIndexValue } from "./html-canvas-internal-types";

export const SOURCE_ELEMENT_ATTRIBUTE = STEMMIO_ELEMENT_ID_ATTRIBUTE;

export function escapedStemmioElementId(elementId: string): string {
  return elementId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function sourceElementSelector(elementId: string): string {
  return `[${SOURCE_ELEMENT_ATTRIBUTE}="${escapedStemmioElementId(elementId)}"]`;
}

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

export function sourceElementId(element: Element | null): string | null {
  const value = element?.getAttribute(SOURCE_ELEMENT_ATTRIBUTE) ?? "";
  return value || null;
}

export function sourceElementFromDom(
  element: Element | null,
  sourceIndex: SourceIndexValue | null | undefined,
): SourceElementValue | null {
  const elementId = sourceElementId(element);
  if (!elementId || !sourceIndex) return null;
  const sourceElement = sourceIndex.byStemmioId.get(elementId);
  return sourceElement?.type === "element" ? sourceElement : null;
}

export function uniqueSourceElement(
  documentNode: Document,
  elementId: string,
): HTMLElement | null {
  const matches = documentNode.querySelectorAll<HTMLElement>(
    sourceElementSelector(elementId),
  );
  return matches.length === 1 ? matches[0] : null;
}

export function registerProvedStableSourceElements(options: {
  candidates: unknown;
  documentNode: Document | null;
  sourceIndex: SourceIndexValue | null | undefined;
  elements: WeakSet<HTMLElement>;
  stemmioIds: WeakMap<HTMLElement, string>;
  claimed: Map<string, HTMLElement>;
  conflicted: Set<string>;
  markerAttribute?: string;
}): boolean {
  const {
    candidates,
    documentNode,
    sourceIndex,
    elements,
    stemmioIds,
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
    const stemmioId = sourceElementId(element);
    const sourceEntry = stemmioId ? sourceIndex?.byStemmioId.get(stemmioId) : null;
    if (
      !stemmioId
      || sourceEntry?.type !== "element"
      || sourceEntry.tagName !== element.localName
      || (
        markerAttribute
        && element.getAttribute(markerAttribute) !== stemmioId
      )
    ) continue;
    if (conflicted.has(stemmioId)) continue;
    const existing = claimed.get(stemmioId);
    if (existing && existing !== element) {
      elements.delete(existing);
      claimed.delete(stemmioId);
      conflicted.add(stemmioId);
      continue;
    }
    claimed.set(stemmioId, element);
    stemmioIds.set(element, stemmioId);
    elements.add(element);
  }
  return true;
}
