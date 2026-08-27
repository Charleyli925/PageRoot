import {
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_RUNTIME_HOST_ATTRIBUTE,
} from "../domain/edit-runtime-contract.js";

export function sameRuntimeGrant(left, right) {
  return Boolean(
    left
    && right
    && left.sessionId === right.sessionId
    && left.executionId === right.executionId
    && left.sourceSha256 === right.sourceSha256
    && left.canvasGeneration === right.canvasGeneration,
  );
}

export function frameDocumentMatchesExpected(iframe, expectedFrameHtml, writtenHtml) {
  return iframe.srcdoc === expectedFrameHtml || writtenHtml === expectedFrameHtml;
}

export function isRuntimeFrameFrozenResult(value, frame) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  if (
    value.state !== "frozen"
    || value.reason !== null
    || value.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
    || value.executionId !== frame.grant.executionId
    || value.sessionId !== frame.grant.sessionId
    || !Array.isArray(value.hostKeys)
    || value.hostKeys.length !== frame.grant.hosts.length
  ) return false;
  const expected = new Set(frame.grant.hosts.map((host) => host.key));
  const received = new Set();
  for (const key of value.hostKeys) {
    if (typeof key !== "string" || !expected.has(key) || received.has(key)) return false;
    received.add(key);
  }
  return received.size === expected.size;
}

export function hostHasAuthorPaint(element) {
  if (!element || element.nodeType !== 1) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "canvas" || tag === "svg") return true;
  return Boolean(element.querySelector("canvas, svg"));
}

export function runtimeFrameKeepsAuthorPaint(documentNode, frame) {
  if (documentNode.querySelectorAll("img[data-pageroot-edit-runtime-snapshot]").length > 0) {
    return false;
  }
  // Host discovery includes every source-empty unique binding, not only
  // charts. Unused empty hosts must not discard a frozen author canvas.
  return frame.grant.hosts.some((host) => {
    const element = documentNode.querySelector(
      `[${EDIT_RUNTIME_HOST_ATTRIBUTE}="${host.key}"]`,
    );
    return hostHasAuthorPaint(element);
  });
}
