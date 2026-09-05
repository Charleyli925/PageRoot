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

function computedStyle(target, node) {
  if (!node || typeof target.getComputedStyle !== "function") return null;
  try {
    return target.getComputedStyle(node);
  } catch {
    return null;
  }
}

function isDisplayed(target, node) {
  let current = node;
  while (current) {
    const style = computedStyle(target, current);
    if (style?.display === "none") return false;
    current = current.parentElement || null;
  }
  return true;
}

function isVisuallyPresentFrame(frame, target) {
  if (!frame?.isConnected) return false;
  if (!isDisplayed(target, frame)) return false;
  const style = computedStyle(target, frame);
  if (style && (style.visibility === "hidden" || Number(style.opacity) <= 0.01)) {
    return false;
  }
  const rect = hasBox(frame) ? frame.getBoundingClientRect() : null;
  if (rect && (rect.width < 1 || rect.height < 1)) return false;
  if (frame.contentDocument) {
    const doc = frame.contentDocument;
    if (!doc?.documentElement) return false;
  }
  return true;
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
  const stage = root.closest?.(".review-scroll-stage") || root.parentElement;
  const canvasHost = root;
  const rail = stage?.querySelector?.(".comments-panel.comment-rail")
    || root.parentElement?.querySelector?.(".comments-panel.comment-rail")
    || null;
  const frames = Array.from(root.querySelectorAll?.("iframe") || []);
  const iframe = frames.find((frame) => !frame.hasAttribute?.("data-frame-role")) || null;
  const candidate = root.querySelector?.('iframe[data-frame-role="runtime-candidate"]');
  const visibleFrames = frames.filter((frame) => isVisuallyPresentFrame(frame, target));
  const iframeRect = hasBox(iframe) ? iframe.getBoundingClientRect() : null;
  const innerDocument = iframe && "contentDocument" in iframe ? iframe.contentDocument : null;
  const nestedScroller = innerDocument?.querySelector?.("[data-nested-scroll], [style*='overflow']") || null;
  const selected = innerDocument?.querySelector("[data-html-canvas-selected]");
  const sample = {
    t: now(),
    stageWidth: hasBox(stage) ? stage.getBoundingClientRect().width : 0,
    canvasWidth: hasBox(canvasHost) ? canvasHost.getBoundingClientRect().width : 0,
    commentRailWidth: hasBox(rail) ? rail.getBoundingClientRect().width : 0,
    iframeRect: iframeRect
      ? {
        x: iframeRect.x,
        y: iframeRect.y,
        width: iframeRect.width,
        height: iframeRect.height,
      }
      : null,
    outerScrollTop: stage && "scrollTop" in stage ? stage.scrollTop : 0,
    innerScrollTop: Number(
      nestedScroller?.scrollTop
      || innerDocument?.scrollingElement?.scrollTop
      || innerDocument?.documentElement?.scrollTop
      || 0,
    ),
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

function jumpedToTop(samples) {
  const first = samples[0];
  return samples.some((sample, index) => {
    if (index === 0) return false;
    const outerJump = first.outerScrollTop > 50 && sample.outerScrollTop < 1;
    const innerJump = first.innerScrollTop > 50 && sample.innerScrollTop < 1;
    return outerJump || innerJump;
  });
}

export function summarizeRuntimeContinuity(trace) {
  const counts = {
    frameCreated: 0,
    candidateCreated: 0,
    runtimeRefreshRequested: 0,
    framePrepared: 0,
    frameCleared: 0,
    framePromoted: 0,
  };
  for (const event of trace?.events || []) {
    if (event.name === "frameCreated") counts.frameCreated += 1;
    if (event.name === "candidateCreated") counts.candidateCreated += 1;
    if (event.name === "runtimeRefreshRequested") counts.runtimeRefreshRequested += 1;
    if (event.name === "framePrepared") counts.framePrepared += 1;
    if (event.name === "frameCleared") counts.frameCleared += 1;
    if (event.name === "framePromoted") counts.framePromoted += 1;
  }
  const samples = Array.isArray(trace?.samples) ? trace.samples : [];
  if (samples.length < 2) {
    return {
      ...counts,
      insufficientSamples: true,
      maxCanvasWidthDelta: Number.POSITIVE_INFINITY,
      railDisappeared: true,
      railNarrowed: true,
      jumpedToTop: true,
      missingVisibleFrame: true,
      unexpectedCandidate: counts.candidateCreated > 0,
      latest: null,
    };
  }
  const widths = samples.map((sample) => Number(sample.canvasWidth) || 0);
  const railWidths = samples.map((sample) => Number(sample.commentRailWidth) || 0);
  const firstRail = railWidths[0];
  return {
    ...counts,
    insufficientSamples: false,
    maxCanvasWidthDelta: Math.max(...widths) - Math.min(...widths),
    railDisappeared: railWidths.some((width, index) => index > 0 && firstRail > 8 && width < 1),
    railNarrowed: railWidths.some((width, index) => (
      index > 0 && firstRail > 8 && width <= firstRail * 0.5
    )),
    jumpedToTop: jumpedToTop(samples),
    missingVisibleFrame: samples.some((sample) => sample.visibleFrameCount < 1),
    unexpectedCandidate: counts.candidateCreated > 0
      || samples.some((sample) => sample.candidatePresent),
    latest: Object.freeze({
      visibleFrameCount: Number(samples.at(-1).visibleFrameCount) || 0,
      candidatePresent: Boolean(samples.at(-1).candidatePresent),
      canvasWidth: Number(samples.at(-1).canvasWidth) || 0,
    }),
  };
}
