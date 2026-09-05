export type ContinuityEventName =
  | "frameCreated"
  | "framePrepared"
  | "framePromoted"
  | "frameCleared"
  | "runtimeRefreshRequested"
  | "candidateCreated";

export type ContinuityVisualSample = {
  t: number;
  canvasWidth: number;
  commentRailWidth: number;
  iframeRect: { x: number; y: number; width: number; height: number } | null;
  outerScrollTop: number;
  innerScrollTop: number;
  visibleFrameCount: number;
  frameGeneration: string | null;
  candidatePresent: boolean;
  selectionStableId: string | null;
};

export type ContinuityEvent = {
  t: number;
  name: ContinuityEventName;
  reason?: string;
};

export type ContinuityTrace = {
  events: ContinuityEvent[];
  samples: ContinuityVisualSample[];
};

export function enableRuntimeContinuityProbe(
  target?: Window & typeof globalThis,
): ContinuityTrace & {
  enabled: boolean;
  raf: number | null;
  getRoot: (() => Element | null) | null;
};

export function attachRuntimeContinuityProbe(
  getRoot: () => Element | null,
  target?: Window & typeof globalThis,
): () => void;

export function recordRuntimeContinuityEvent(
  name: ContinuityEventName,
  details?: { reason?: string },
  target?: Window & typeof globalThis,
): void;

export function sampleRuntimeContinuityVisuals(
  root: Element | null,
  target?: Window & typeof globalThis,
): ContinuityVisualSample | null;

export function readRuntimeContinuityTrace(
  target?: Window & typeof globalThis,
): ContinuityTrace;

export function summarizeRuntimeContinuity(trace: ContinuityTrace): {
  frameCreated: number;
  candidateCreated: number;
  runtimeRefreshRequested: number;
  maxCanvasWidthDelta: number;
  railDisappeared: boolean;
  jumpedToTop: boolean;
  missingVisibleFrame: boolean;
};
