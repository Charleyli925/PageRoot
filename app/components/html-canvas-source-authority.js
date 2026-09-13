import { PAGEROOT_ELEMENT_ID_ATTRIBUTE } from "../../shared/pageroot-element-identity.mjs";

export const SOURCE_ELEMENT_ATTRIBUTE = PAGEROOT_ELEMENT_ID_ATTRIBUTE;

export function escapedPagerootElementId(elementId) {
  return String(elementId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function sourceElementSelector(elementId) {
  return `[${SOURCE_ELEMENT_ATTRIBUTE}="${escapedPagerootElementId(elementId)}"]`;
}

export function sourceElementId(element) {
  const value = element?.getAttribute?.(SOURCE_ELEMENT_ATTRIBUTE) ?? "";
  return value || null;
}

export function uniqueSourceElement(documentNode, elementId) {
  if (!documentNode?.querySelectorAll) return null;
  const matches = documentNode.querySelectorAll(sourceElementSelector(elementId));
  return matches.length === 1 ? matches[0] : null;
}

export function grantEditorCreatedSourceElements(options) {
  const {
    authority,
    documentNode,
    sourceIndex,
    expectedGeneration,
    expectedExecutionId,
    createdElements,
    allowedElementIds,
    markerAttribute,
  } = options;
  if (!authority || !documentNode || !sourceIndex) {
    return { ok: false, reason: "authority-missing" };
  }
  if (
    authority.elementGeneration !== expectedGeneration
    || authority.executionId !== expectedExecutionId
  ) {
    return { ok: false, reason: "stale-frame" };
  }
  const allowed = new Set(allowedElementIds);
  const seenIds = new Set();
  for (const element of createdElements) {
    if (
      !element
      || element.nodeType !== 1
      || element.ownerDocument !== documentNode
      || !element.isConnected
    ) {
      return { ok: false, reason: "created-node-invalid" };
    }
    const pagerootId = sourceElementId(element);
    const sourceEntry = pagerootId ? sourceIndex.byPagerootId.get(pagerootId) : null;
    if (
      !pagerootId
      || !allowed.has(pagerootId)
      || seenIds.has(pagerootId)
      || sourceEntry?.type !== "element"
      || sourceEntry.tagName !== element.localName
      || uniqueSourceElement(documentNode, pagerootId) !== element
    ) {
      return { ok: false, reason: "created-identity-untrusted" };
    }
    if (authority.elements.has(element)) {
      return { ok: false, reason: "duplicate-grant" };
    }
    const alreadyId = authority.pagerootIds.get(element);
    if (alreadyId && alreadyId !== pagerootId) {
      return { ok: false, reason: "identity-conflict" };
    }
    seenIds.add(pagerootId);
  }
  if (seenIds.size !== allowed.size) {
    return { ok: false, reason: "grant-set-incomplete" };
  }
  for (const element of createdElements) {
    const pagerootId = sourceElementId(element);
    authority.elements.add(element);
    authority.pagerootIds.set(element, pagerootId);
    element.setAttribute(markerAttribute, pagerootId);
  }
  return { ok: true };
}

export function revokeRemovedSourceElements(options) {
  const { authority, removedElements, markerAttribute } = options;
  if (!authority) return;
  for (const element of removedElements) {
    if (!element) continue;
    authority.elements.delete(element);
    authority.pagerootIds.delete(element);
    if (typeof element.removeAttribute === "function") {
      element.removeAttribute(markerAttribute);
    }
  }
}
