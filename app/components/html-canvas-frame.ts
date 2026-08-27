import {
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_RUNTIME_HOST_ATTRIBUTE,
  type EditRuntimeGrant,
} from "../domain/edit-runtime-contract.js";

export type RuntimeFrameContext = {
  verificationToken: string;
  grant: EditRuntimeGrant;
  elementGeneration: number;
  settled: boolean;
};

export function sameRuntimeGrant(
  left: EditRuntimeGrant | null | undefined,
  right: EditRuntimeGrant | null | undefined,
): boolean {
  return Boolean(
    left
    && right
    && left.sessionId === right.sessionId
    && left.executionId === right.executionId
    && left.sourceSha256 === right.sourceSha256
    && left.canvasGeneration === right.canvasGeneration,
  );
}

export function frameDocumentMatchesExpected(
  iframe: HTMLIFrameElement,
  expectedFrameHtml: string,
  writtenHtml: string | null,
): boolean {
  return iframe.srcdoc === expectedFrameHtml || writtenHtml === expectedFrameHtml;
}

export function isRuntimeFrameFrozenResult(
  value: unknown,
  frame: RuntimeFrameContext,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const result = value as Record<string, unknown>;
  if (
    result.state !== "frozen"
    || result.reason !== null
    || result.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
    || result.executionId !== frame.grant.executionId
    || result.sessionId !== frame.grant.sessionId
    || !Array.isArray(result.hostKeys)
    || result.hostKeys.length !== frame.grant.hosts.length
  ) return false;
  const expected = new Set(frame.grant.hosts.map((host) => host.key));
  const received = new Set<string>();
  for (const key of result.hostKeys) {
    if (typeof key !== "string" || !expected.has(key) || received.has(key)) return false;
    received.add(key);
  }
  return received.size === expected.size;
}

export function hostHasAuthorPaint(element: Element | null): boolean {
  if (!element || element.nodeType !== 1) return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "canvas" || tag === "svg") return true;
  return Boolean(element.querySelector("canvas, svg"));
}

export function runtimeFrameKeepsAuthorPaint(
  documentNode: Document,
  frame: RuntimeFrameContext,
): boolean {
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
