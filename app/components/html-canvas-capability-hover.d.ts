import type { ResolvedCanvasPointerCapability } from "./html-canvas-pointer-capability";

export const CANVAS_HOVER_OUTLINE_DELAY_MS: 80;
export const CANVAS_HOVER_HINT_DELAY_MS: 400;
export const CANVAS_HOVER_HINT_INSET_PX: 4;
export const CANVAS_HOVER_HINT_HEIGHT_PX: 22;
export const CANVAS_HOVER_HINT_MIN_WIDTH_PX: 96;

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

export type CanvasCapabilityHoverSnapshot = Readonly<{
  cursor: "default" | "text" | "pointer" | "help";
  outline: boolean;
  hint: boolean;
  capability: ResolvedCanvasPointerCapability | null;
}>;

export function createCanvasCapabilityHoverController(options?: {
  outlineDelayMs?: number;
  hintDelayMs?: number;
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
