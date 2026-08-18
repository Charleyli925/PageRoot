import type { HtmlCanvasTargetResolution } from "./HtmlCanvasEditor.types";

export const CANVAS_POINTER_CAPABILITY_KINDS: readonly [
  "edit-text",
  "select-comment",
  "comment-ai",
];

export type CanvasPointerCapabilityKind =
  (typeof CANVAS_POINTER_CAPABILITY_KINDS)[number];

export type CanvasPointerCapability = Readonly<{
  kind: CanvasPointerCapabilityKind;
  hint: string;
  spoken: string;
  cursor: "text" | "pointer" | "help";
}>;

export const CANVAS_POINTER_CAPABILITIES: Readonly<
  Record<CanvasPointerCapabilityKind, CanvasPointerCapability>
>;

export function canvasPointerCapabilityFromProof(input: {
  canStartTextEdit?: boolean;
  sourceResolution?: HtmlCanvasTargetResolution | null;
}): CanvasPointerCapability;
