export const CANVAS_HOVER_OUTLINE_DELAY_MS = 80;
export const CANVAS_HOVER_HINT_DELAY_MS = 400;
export const CANVAS_HOVER_HINT_INSET_PX = 4;
export const CANVAS_HOVER_HINT_HEIGHT_PX = 22;
export const CANVAS_HOVER_HINT_MIN_WIDTH_PX = 96;

export function layoutCanvasHoverChrome(hitRect) {
  const left = Number(hitRect?.left) || 0;
  const top = Number(hitRect?.top) || 0;
  const width = Math.max(0, Number(hitRect?.width) || 0);
  const height = Math.max(0, Number(hitRect?.height) || 0);
  const outline = { left, top, width, height };
  const inset = CANVAS_HOVER_HINT_INSET_PX;
  const fits = height >= CANVAS_HOVER_HINT_HEIGHT_PX + inset * 2
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

function emptySnapshot() {
  return Object.freeze({
    cursor: "default",
    outline: false,
    hint: false,
    capability: null,
  });
}

export function createCanvasCapabilityHoverController({
  outlineDelayMs = CANVAS_HOVER_OUTLINE_DELAY_MS,
  hintDelayMs = CANVAS_HOVER_HINT_DELAY_MS,
  scheduler = {
    setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
    clearTimeout: (handle) => globalThis.clearTimeout(handle),
  },
  onChange,
} = {}) {
  let outlineTimer = null;
  let hintTimer = null;
  let currentKey = null;
  let snapshot = emptySnapshot();

  const emit = (next) => {
    snapshot = Object.freeze({ ...next });
    onChange?.(snapshot);
  };

  const clearTimers = () => {
    if (outlineTimer != null) scheduler.clearTimeout(outlineTimer);
    if (hintTimer != null) scheduler.clearTimeout(hintTimer);
    outlineTimer = null;
    hintTimer = null;
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
    const key = `${capability.kind}:${capability.targetKey}`;
    if (key === currentKey) return;
    clearTimers();
    currentKey = key;
    emit({
      cursor: capability.cursor,
      outline: false,
      hint: false,
      capability,
    });
    outlineTimer = scheduler.setTimeout(() => {
      outlineTimer = null;
      if (currentKey !== key) return;
      emit({
        cursor: capability.cursor,
        outline: true,
        hint: snapshot.hint,
        capability,
      });
    }, outlineDelayMs);
    hintTimer = scheduler.setTimeout(() => {
      hintTimer = null;
      if (currentKey !== key) return;
      emit({
        cursor: capability.cursor,
        outline: true,
        hint: true,
        capability,
      });
    }, hintDelayMs);
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
