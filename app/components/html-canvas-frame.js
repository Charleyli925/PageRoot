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

export const RUNTIME_HANDOFF_TOLERANCE_PX = 8;

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

export const READING_POSITION_READY_FRAMES = 30;

export function runtimeRectIntersectsClip(screenRect, clipRect, inset = 1) {
  if (!screenRect || !clipRect) return false;
  return screenRect.bottom > clipRect.top + inset
    && screenRect.top < clipRect.bottom - inset;
}

export function runtimeElementScreenRect(iframe, element) {
  if (!iframe || !element) return null;
  const iframeRect = iframe.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    top: iframeRect.top + rect.top,
    bottom: iframeRect.top + rect.bottom,
  };
}

export function runtimeElementIsInReadingViewport(iframe, element, clipRect) {
  return runtimeRectIntersectsClip(
    runtimeElementScreenRect(iframe, element),
    clipRect,
  );
}

export function frameScrollLimits(iframe, documentNode) {
  return {
    maxTop: Math.max(
      0,
      (documentNode?.scrollingElement?.scrollHeight || 0) - (iframe?.clientHeight || 0),
    ),
    maxLeft: Math.max(
      0,
      (documentNode?.scrollingElement?.scrollWidth || 0) - (iframe?.clientWidth || 0),
    ),
  };
}

export function outerScrollLimits(outer) {
  return {
    maxTop: Math.max(0, (outer?.scrollHeight || 0) - (outer?.clientHeight || 0)),
    maxLeft: Math.max(0, (outer?.scrollWidth || 0) - (outer?.clientWidth || 0)),
  };
}

export function frameScrollMetricsReady(iframe, documentNode) {
  const bodyRect = documentNode?.body?.getBoundingClientRect();
  return Boolean(
    bodyRect
    && Number.isFinite(bodyRect.width)
    && Number.isFinite(bodyRect.height)
    && iframe?.clientHeight > 0
    && iframe?.clientWidth > 0
  );
}

export function outerScrollMetricsReady(outer, desiredOuterTop) {
  if (!outer || desiredOuterTop === null || desiredOuterTop === undefined) return true;
  return outerScrollLimits(outer).maxTop + RUNTIME_HANDOFF_TOLERANCE_PX >= desiredOuterTop;
}

export function scheduleWhenReady({
  isCurrent,
  isReady,
  remainingFrames = READING_POSITION_READY_FRAMES,
  onReady,
}) {
  let remaining = remainingFrames;
  const tick = () => {
    if (!isCurrent()) return;
    if (!isReady() && remaining > 0) {
      remaining -= 1;
      requestAnimationFrame(tick);
      return;
    }
    onReady();
  };
  requestAnimationFrame(tick);
}

export function applyReadingPosition({
  iframe,
  documentNode,
  outer = null,
  anchor,
  anchorElement = null,
  adjustOuter = false,
}) {
  const frameView = documentNode?.defaultView;
  if (!iframe || !frameView || !anchor) return false;
  const limits = frameScrollLimits(iframe, documentNode);
  const currentAnchorScreenTop = runtimeElementScreenRect(iframe, anchorElement)?.top;
  const targetTop = (
    anchorElement
    && anchor.viewportAnchorScreenOffsetY !== null
    && Number.isFinite(currentAnchorScreenTop)
  )
    ? runtimeAnchorScrollTop({
        currentScrollTop: frameView.scrollY,
        currentAnchorOffsetY: currentAnchorScreenTop,
        desiredAnchorOffsetY: anchor.viewportAnchorScreenOffsetY,
        maximumScrollTop: limits.maxTop,
      })
    : clampRuntimeScroll(anchor.iframeScrollTop, limits.maxTop);
  frameView.scrollTo({
    left: clampRuntimeScroll(anchor.iframeScrollLeft, limits.maxLeft),
    top: targetTop,
    behavior: "auto",
  });
  if (
    adjustOuter
    && outer
    && anchor.outerScrollLeft !== null
    && anchor.outerScrollTop !== null
  ) {
    const outerLimits = outerScrollLimits(outer);
    outer.scrollTo({
      left: clampRuntimeScroll(anchor.outerScrollLeft, outerLimits.maxLeft),
      top: clampRuntimeScroll(anchor.outerScrollTop, outerLimits.maxTop),
      behavior: "auto",
    });
  }
  return true;
}

export function correctReadingPositionOnce({
  iframe,
  documentNode,
  outer = null,
  anchor,
  anchorElement = null,
  adjustOuter = false,
}) {
  const frameView = documentNode?.defaultView;
  if (
    !iframe
    || !frameView
    || !anchorElement
    || anchor?.viewportAnchorScreenOffsetY === null
    || anchor?.viewportAnchorScreenOffsetY === undefined
  ) return;
  const currentTop = runtimeElementScreenRect(iframe, anchorElement)?.top;
  if (
    !Number.isFinite(currentTop)
    || runtimePositionWithinTolerance(currentTop, anchor.viewportAnchorScreenOffsetY)
  ) return;
  const limits = frameScrollLimits(iframe, documentNode);
  frameView.scrollTo({
    left: frameView.scrollX,
    top: runtimeAnchorScrollTop({
      currentScrollTop: frameView.scrollY,
      currentAnchorOffsetY: currentTop,
      desiredAnchorOffsetY: anchor.viewportAnchorScreenOffsetY,
      maximumScrollTop: limits.maxTop,
    }),
    behavior: "auto",
  });
  if (!adjustOuter || !outer) {
    const visibleRect = anchorElement.getBoundingClientRect();
    if (visibleRect.bottom <= 0 || visibleRect.top >= iframe.clientHeight) {
      anchorElement.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    return;
  }
  const residual = (
    runtimeElementScreenRect(iframe, anchorElement)?.top
    ?? currentTop
  ) - anchor.viewportAnchorScreenOffsetY;
  if (Math.abs(residual) > RUNTIME_HANDOFF_TOLERANCE_PX) {
    const outerLimits = outerScrollLimits(outer);
    outer.scrollTo({
      left: outer.scrollLeft,
      top: clampRuntimeScroll(outer.scrollTop + residual, outerLimits.maxTop),
      behavior: "auto",
    });
  }
  const visibleRect = runtimeElementScreenRect(iframe, anchorElement);
  const outerRect = outer.getBoundingClientRect();
  if (!visibleRect) return;
  if (visibleRect.top < outerRect.top) {
    outer.scrollTop -= outerRect.top - visibleRect.top;
  } else if (visibleRect.bottom > outerRect.bottom) {
    outer.scrollTop += visibleRect.bottom - outerRect.bottom;
  }
}
