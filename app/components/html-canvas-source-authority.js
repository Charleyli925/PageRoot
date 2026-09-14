import { STEMMIO_ELEMENT_ID_ATTRIBUTE } from "../../shared/stemmio-element-identity.mjs";

export const SOURCE_ELEMENT_ATTRIBUTE = STEMMIO_ELEMENT_ID_ATTRIBUTE;

export function escapedStemmioElementId(elementId) {
  return String(elementId).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export function sourceElementSelector(elementId) {
  return `[${SOURCE_ELEMENT_ATTRIBUTE}="${escapedStemmioElementId(elementId)}"]`;
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

export function createBoundSourceElementProof({
  authority,
  sourceIndex,
  expectedGeneration,
  expectedExecutionId,
  markerAttribute,
} = {}) {
  if (
    !authority
    || !sourceIndex
    || authority.elementGeneration !== expectedGeneration
    || authority.executionId !== expectedExecutionId
  ) {
    return null;
  }
  return (element) => {
    const registeredStemmioId = authority.stemmioIds.get(element);
    const liveStemmioId = sourceElementId(element);
    const liveSourceEntry = liveStemmioId
      ? sourceIndex.byStemmioId.get(liveStemmioId)
      : null;
    return Boolean(
      element
      && authority.elements.has(element)
      && element.isConnected
      && registeredStemmioId
      && registeredStemmioId === liveStemmioId
      && (!markerAttribute || element.getAttribute?.(markerAttribute) === registeredStemmioId)
      && liveSourceEntry?.type === "element"
      && liveSourceEntry.tagName === element.localName
    );
  };
}

export function sealEditorCreatedSourceElements(createdElements) {
  const sealed = new WeakSet();
  for (const element of createdElements) {
    if (element) sealed.add(element);
  }
  return sealed;
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
    creationTicket,
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
      || !creationTicket
      || typeof creationTicket.has !== "function"
      || !creationTicket.has(element)
    ) {
      return { ok: false, reason: "created-node-invalid" };
    }
    const stemmioId = sourceElementId(element);
    const sourceEntry = stemmioId ? sourceIndex.byStemmioId.get(stemmioId) : null;
    if (
      !stemmioId
      || !allowed.has(stemmioId)
      || seenIds.has(stemmioId)
      || sourceEntry?.type !== "element"
      || sourceEntry.tagName !== element.localName
      || uniqueSourceElement(documentNode, stemmioId) !== element
    ) {
      return { ok: false, reason: "created-identity-untrusted" };
    }
    if (authority.elements.has(element)) {
      return { ok: false, reason: "duplicate-grant" };
    }
    const alreadyId = authority.stemmioIds.get(element);
    if (alreadyId && alreadyId !== stemmioId) {
      return { ok: false, reason: "identity-conflict" };
    }
    seenIds.add(stemmioId);
  }
  if (seenIds.size !== allowed.size) {
    return { ok: false, reason: "grant-set-incomplete" };
  }
  for (const element of createdElements) {
    const stemmioId = sourceElementId(element);
    authority.elements.add(element);
    authority.stemmioIds.set(element, stemmioId);
    element.setAttribute(markerAttribute, stemmioId);
  }
  return { ok: true };
}

export function revokeRemovedSourceElements(options) {
  const { authority, removedElements, markerAttribute } = options;
  if (!authority) return;
  for (const element of removedElements) {
    if (!element) continue;
    authority.elements.delete(element);
    authority.stemmioIds.delete(element);
    if (typeof element.removeAttribute === "function") {
      element.removeAttribute(markerAttribute);
    }
  }
}
