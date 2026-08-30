export function sameRuntimeGrant(left, right) {
  return Boolean(
    left
    && right
    && left.sessionId === right.sessionId
    && left.executionId === right.executionId
    && left.documentBasePath === right.documentBasePath
    && left.sourceSha256 === right.sourceSha256
    && left.canvasGeneration === right.canvasGeneration
    && left.programIdentity === right.programIdentity
  );
}

export function frameDocumentMatchesExpected(iframe, expectedFrameHtml, writtenHtml) {
  return iframe.srcdoc === expectedFrameHtml || writtenHtml === expectedFrameHtml;
}
