const GLOBAL_KEY = "__PAGEROOT_RUNTIME_CONTINUITY__";

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function readState(target) {
  const existing = target[GLOBAL_KEY];
  if (existing && Array.isArray(existing.events) && Array.isArray(existing.samples)) {
    return existing;
  }
  const created = {
    enabled: false,
    raf: null,
    getRoot: null,
    events: [],
    samples: [],
  };
  target[GLOBAL_KEY] = created;
  return created;
}

function hasBox(node) {
  return Boolean(node) && typeof node.getBoundingClientRect === "function";
}

function startVisualLoop(target) {
  const state = readState(target);
  if (state.raf != null || !state.enabled) return;
  const tick = () => {
    if (!state.enabled) {
      state.raf = null;
      return;
    }
    sampleRuntimeContinuityVisuals(state.getRoot?.() || null, target);
    state.raf = target.requestAnimationFrame(tick);
  };
  state.raf = target.requestAnimationFrame(tick);
}

export function enableRuntimeContinuityProbe(target = window) {
  const state = readState(target);
  state.enabled = true;
  startVisualLoop(target);
  return state;
}

export function attachRuntimeContinuityProbe(
  getRoot,
  target = window,
) {
  const state = readState(target);
  state.getRoot = getRoot;
  target.__PAGEROOT_ENABLE_RUNTIME_CONTINUITY__ = () => enableRuntimeContinuityProbe(target);
  target.__PAGEROOT_READ_RUNTIME_CONTINUITY__ = () => readRuntimeContinuityTrace(target);
  target.__PAGEROOT_SUMMARIZE_RUNTIME_CONTINUITY__ = () => (
    summarizeRuntimeContinuity(readRuntimeContinuityTrace(target))
  );
  startVisualLoop(target);
  return () => {
    if (state.getRoot === getRoot) state.getRoot = null;
    if (state.raf != null) target.cancelAnimationFrame(state.raf);
    state.raf = null;
  };
}

export function recordRuntimeContinuityEvent(
  name,
  details = {},
  target = window,
) {
  if (typeof target === "undefined") return;
  const state = readState(target);
  if (!state.enabled) return;
  state.events.push({
    t: now(),
    name,
    ...(details.reason ? { reason: details.reason } : {}),
  });
}

export function sampleRuntimeContinuityVisuals(
  root,
  target = window,
) {
  if (!root) return null;
  const canvas = root.closest?.(".review-scroll-stage") || root.parentElement;
  const rail = canvas?.querySelector?.(".comments-panel.comment-rail") || null;
  const frames = Array.from(root.querySelectorAll?.("iframe") || []);
  const iframe = frames.find((frame) => !frame.hasAttribute?.("data-frame-role")) || null;
  const candidate = root.querySelector?.('iframe[data-frame-role="runtime-candidate"]');
  const visibleFrames = frames.filter((frame) => {
    if (!frame.isConnected) return false;
    const style = target.getComputedStyle?.(frame);
    if (!style) return true;
    return style.visibility !== "hidden" && Number(style.opacity) > 0.01;
  });
  const iframeRect = hasBox(iframe) ? iframe.getBoundingClientRect() : null;
  const innerDocument = iframe && "contentDocument" in iframe ? iframe.contentDocument : null;
  const selected = innerDocument?.querySelector("[data-html-canvas-selected]");
  const sample = {
    t: now(),
    canvasWidth: hasBox(canvas) ? canvas.getBoundingClientRect().width : 0,
    commentRailWidth: hasBox(rail) ? rail.getBoundingClientRect().width : 0,
    iframeRect: iframeRect
      ? {
        x: iframeRect.x,
        y: iframeRect.y,
        width: iframeRect.width,
        height: iframeRect.height,
      }
      : null,
    outerScrollTop: canvas && "scrollTop" in canvas ? canvas.scrollTop : 0,
    innerScrollTop: innerDocument?.scrollingElement?.scrollTop
      || innerDocument?.documentElement?.scrollTop
      || 0,
    visibleFrameCount: visibleFrames.length,
    frameGeneration: iframe?.getAttribute?.("data-frame-generation") || null,
    candidatePresent: Boolean(candidate),
    selectionStableId: selected?.getAttribute("data-pageroot-id") || null,
  };
  const state = readState(target);
  if (state.enabled) state.samples.push(sample);
  return sample;
}

export function readRuntimeContinuityTrace(target = window) {
  const state = readState(target);
  return {
    events: state.events.slice(),
    samples: state.samples.slice(),
  };
}

export function summarizeRuntimeContinuity(trace) {
  const counts = {
    frameCreated: 0,
    candidateCreated: 0,
    runtimeRefreshRequested: 0,
  };
  for (const event of trace.events) {
    if (event.name === "frameCreated") counts.frameCreated += 1;
    if (event.name === "candidateCreated") counts.candidateCreated += 1;
    if (event.name === "runtimeRefreshRequested") counts.runtimeRefreshRequested += 1;
  }
  const widths = trace.samples.map((sample) => sample.canvasWidth).filter((width) => width > 0);
  const railWidths = trace.samples.map((sample) => sample.commentRailWidth);
  const scrollTops = trace.samples.map((sample) => sample.outerScrollTop);
  return {
    ...counts,
    maxCanvasWidthDelta: widths.length > 1 ? Math.max(...widths) - Math.min(...widths) : 0,
    railDisappeared: railWidths.some((width, index) => index > 0 && railWidths[0] > 8 && width < 1),
    jumpedToTop: scrollTops.some((value, index) => index > 0 && scrollTops[0] > 50 && value < 1),
    missingVisibleFrame: trace.samples.some((sample) => sample.visibleFrameCount < 1),
  };
}
