import type { ResolvedCanvasPointerCapability } from "./html-canvas-pointer-capability";

export const CANVAS_HOVER_OUTLINE_DELAY_MS: 80;
export const CANVAS_HOVER_HINT_DELAY_MS: 400;

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
