import type { ResolvedCanvasPointerCapability } from "./html-canvas-pointer-capability";

export const CANVAS_HOVER_DELAY_MS: 80;
export const CANVAS_HOVER_OUTLINE_DELAY_MS: 80;
export const CANVAS_HOVER_HINT_DELAY_MS: 80;
export const CANVAS_HOVER_HINT_INSET_PX: 4;
export const CANVAS_HOVER_HINT_HEIGHT_PX: 24;
export const CANVAS_HOVER_HINT_MIN_WIDTH_PX: 96;
export const CANVAS_HOVER_HINT_GAP_PX: 8;
export const CANVAS_HOVER_EDGE_INSET_PX: 8;
export const CANVAS_HOVER_HINT_WIDTH_PX: 196;

export type CanvasHoverHintPlacement = Readonly<{
  left: number;
  top: number;
  width: number;
  placement: "above" | "below";
}>;

export function placeCanvasHoverHint(options?: {
  containerWidth?: number;
  targetLeft?: number;
  targetTop?: number;
  targetHeight?: number;
  labelWidth?: number;
  labelHeight?: number;
  gap?: number;
  edgeInset?: number;
}): CanvasHoverHintPlacement;

export type CanvasHoverHitRect = Readonly<{
  left: number;
  top: number;
  width: number;
  height: number;
}>;

export type CanvasHoverChromeLayout = Readonly<{
  outline: CanvasHoverHitRect;
  hint: Readonly<{ left: number; top: number; maxWidth: number }> | null;
}>;

export function layoutCanvasHoverChrome(hitRect: CanvasHoverHitRect): CanvasHoverChromeLayout;

export function clipCanvasTargetRectToViewport(
  hitRect: CanvasHoverHitRect,
  viewport: Readonly<{ width: number; height: number }>,
): CanvasHoverHitRect | null;

export type CanvasCapabilityHoverSnapshot = Readonly<{
  cursor: "default" | "text" | "pointer" | "help";
  outline: boolean;
  hint: boolean;
  capability: ResolvedCanvasPointerCapability | null;
}>;

export function createCanvasCapabilityHoverController(options?: {
  delayMs?: number;
  scheduler?: {
    setTimeout(callback: () => void, delayMs: number): unknown;
    clearTimeout(handle: unknown): void;
  };
  onChange?: (snapshot: CanvasCapabilityHoverSnapshot) => void;
}): {
  update(capability: ResolvedCanvasPointerCapability | null): void;
  hide(): void;
  readonly snapshot: CanvasCapabilityHoverSnapshot;
  dispose(): void;
};
