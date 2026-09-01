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

export const RUNTIME_HANDOFF_TOLERANCE_PX = 2;

export function clampRuntimeScroll(value, maximum) {
  const numericValue = Number(value);
  const numericMaximum = Number(maximum);
  return Math.min(
    Math.max(0, Number.isFinite(numericValue) ? numericValue : 0),
    Math.max(0, Number.isFinite(numericMaximum) ? numericMaximum : 0),
  );
}

export function runtimeAnchorScrollTop({
  currentScrollTop,
  currentAnchorOffsetY,
  desiredAnchorOffsetY,
  maximumScrollTop,
}) {
  const current = Number(currentScrollTop);
  const currentAnchor = Number(currentAnchorOffsetY);
  const desiredAnchor = Number(desiredAnchorOffsetY);
  if (![current, currentAnchor, desiredAnchor].every(Number.isFinite)) {
    return clampRuntimeScroll(currentScrollTop, maximumScrollTop);
  }
  return clampRuntimeScroll(
    current + currentAnchor - desiredAnchor,
    maximumScrollTop,
  );
}

export function runtimePositionWithinTolerance(
  actual,
  expected,
  tolerance = RUNTIME_HANDOFF_TOLERANCE_PX,
) {
  const numericActual = Number(actual);
  const numericExpected = Number(expected);
  const numericTolerance = Number(tolerance);
  return Number.isFinite(numericActual)
    && Number.isFinite(numericExpected)
    && Number.isFinite(numericTolerance)
    && Math.abs(numericActual - numericExpected) <= Math.max(0, numericTolerance);
}
