export const CANVAS_HOVER_DELAY_MS = 80;
export const CANVAS_HOVER_OUTLINE_DELAY_MS = CANVAS_HOVER_DELAY_MS;
export const CANVAS_HOVER_HINT_DELAY_MS = CANVAS_HOVER_DELAY_MS;
export const CANVAS_HOVER_HINT_INSET_PX = 4;
const CANVAS_HOVER_LAYOUT_HINT_HEIGHT_PX = 22;
export const CANVAS_HOVER_HINT_HEIGHT_PX = 24;
export const CANVAS_HOVER_HINT_MIN_WIDTH_PX = 96;
export const CANVAS_HOVER_HINT_GAP_PX = 8;
export const CANVAS_HOVER_EDGE_INSET_PX = 8;
export const CANVAS_HOVER_HINT_WIDTH_PX = 196;

export function layoutCanvasHoverChrome(hitRect) {
  const left = Number(hitRect?.left) || 0;
  const top = Number(hitRect?.top) || 0;
  const width = Math.max(0, Number(hitRect?.width) || 0);
  const height = Math.max(0, Number(hitRect?.height) || 0);
  const outline = { left, top, width, height };
  const inset = CANVAS_HOVER_HINT_INSET_PX;
  const fits = height >= CANVAS_HOVER_LAYOUT_HINT_HEIGHT_PX + inset * 2
    && width >= CANVAS_HOVER_HINT_MIN_WIDTH_PX + inset * 2;
  if (!fits) return { outline, hint: null };
  return {
    outline,
    hint: {
      left: left + inset,
      top: top + inset,
      maxWidth: Math.max(0, width - inset * 2),
    },
  };
}

export function clipCanvasTargetRectToViewport(hitRect, viewport) {
  const left = Number(hitRect?.left);
  const top = Number(hitRect?.top);
  const width = Math.max(0, Number(hitRect?.width));
  const height = Math.max(0, Number(hitRect?.height));
  const viewportWidth = Math.max(0, Number(viewport?.width));
  const viewportHeight = Math.max(0, Number(viewport?.height));
  if (![left, top, width, height, viewportWidth, viewportHeight].every(Number.isFinite)) {
    return null;
  }
  const clippedLeft = Math.max(0, left);
  const clippedTop = Math.max(0, top);
  const clippedRight = Math.min(viewportWidth, left + width);
  const clippedBottom = Math.min(viewportHeight, top + height);
  if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return null;
  return {
    left: clippedLeft,
    top: clippedTop,
    width: clippedRight - clippedLeft,
    height: clippedBottom - clippedTop,
  };
}

function finiteNonNegative(value, fallback) {
  return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Place the fixed-size hover caption outside its target outline.
 * Coordinates are relative to the editor container.
 */
export function placeCanvasHoverHint({
  containerWidth,
  targetLeft,
  targetTop,
  targetHeight,
  labelWidth = CANVAS_HOVER_HINT_WIDTH_PX,
  labelHeight = CANVAS_HOVER_HINT_HEIGHT_PX,
  gap = CANVAS_HOVER_HINT_GAP_PX,
  edgeInset = CANVAS_HOVER_EDGE_INSET_PX,
} = {}) {
  const width = finiteNonNegative(containerWidth, 0);
  const requestedLabelWidth = finiteNonNegative(labelWidth, CANVAS_HOVER_HINT_WIDTH_PX);
  const requestedLabelHeight = finiteNonNegative(labelHeight, CANVAS_HOVER_HINT_HEIGHT_PX);
  const safeGap = finiteNonNegative(gap, CANVAS_HOVER_HINT_GAP_PX);
  const requestedEdgeInset = finiteNonNegative(edgeInset, CANVAS_HOVER_EDGE_INSET_PX);
  const safeEdgeInset = Math.min(requestedEdgeInset, width / 2);
  const labelOuterWidth = Math.min(
    requestedLabelWidth,
    Math.max(0, width - (safeEdgeInset * 2)),
  );
  const targetX = finiteNonNegative(targetLeft, 0);
  const targetY = finiteNonNegative(targetTop, 0);
  const targetBoxHeight = finiteNonNegative(targetHeight, 0);
  const maxLeft = Math.max(safeEdgeInset, width - safeEdgeInset - labelOuterWidth);
  const left = clamp(targetX, safeEdgeInset, maxLeft);
  const aboveTop = targetY - requestedLabelHeight - safeGap;
  const hasRoomAbove = aboveTop >= safeEdgeInset;
  return {
    left,
    top: hasRoomAbove ? aboveTop : targetY + targetBoxHeight + safeGap,
    width: labelOuterWidth,
    placement: hasRoomAbove ? "above" : "below",
  };
}

function emptySnapshot() {
  return Object.freeze({
    cursor: "default",
    outline: false,
    hint: false,
    capability: null,
  });
}

export function createCanvasCapabilityHoverController({
  delayMs = CANVAS_HOVER_DELAY_MS,
  scheduler = {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  },
  onChange,
} = {}) {
  let hoverTimer = null;
  let currentKey = null;
  let snapshot = emptySnapshot();

  const emit = (next) => {
    snapshot = Object.freeze({ ...next });
    onChange?.(snapshot);
  };

  const clearTimers = () => {
    if (hoverTimer != null) scheduler.clearTimeout(hoverTimer);
    hoverTimer = null;
  };

  const hide = () => {
    clearTimers();
    currentKey = null;
    if (snapshot.capability || snapshot.cursor !== "default") {
      emit(emptySnapshot());
    }
  };

  const update = (capability) => {
    if (!capability) {
      hide();
      return;
    }
    const key = `${capability.kind}:${capability.generation}:${capability.visualKey}`;
    if (key === currentKey) {
      const current = snapshot.capability;
      if (current !== capability) {
        // A shared visual surface can contain several canonical source targets
        // (for example two authored SVG children). Keep the visual lifecycle
        // alive while replacing the complete resolved target contract.
        emit({
          ...snapshot,
          cursor: capability.cursor,
          capability,
        });
      }
      return;
    }
    clearTimers();
    currentKey = key;
    emit({
      cursor: capability.cursor,
      outline: false,
      hint: false,
      capability,
    });
    hoverTimer = scheduler.setTimeout(() => {
      hoverTimer = null;
      if (currentKey !== key) return;
      const currentCapability = snapshot.capability;
      if (!currentCapability) return;
      emit({
        cursor: currentCapability.cursor,
        outline: true,
        hint: true,
        capability: currentCapability,
      });
    }, delayMs);
  };

  return {
    update,
    hide,
    get snapshot() {
      return snapshot;
    },
    dispose: hide,
  };
}
