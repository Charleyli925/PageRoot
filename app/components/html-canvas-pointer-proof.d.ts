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
  cursor: "default" | "text" | "pointer";
}>;

export const CANVAS_POINTER_CAPABILITIES: Readonly<
  Record<CanvasPointerCapabilityKind, CanvasPointerCapability>
>;

export type ElementCopyAvailability = "available" | "busy" | "unsupported";

export const ELEMENT_COPY_AVAILABILITIES: readonly ElementCopyAvailability[];

export function elementCopyAvailabilityFromProof(input: {
  sourceMutationAuthority?: boolean | null;
  containsRuntimeGeneratedContent?: boolean;
  transientBusy?: boolean;
}): ElementCopyAvailability;

export function canvasPointerCapabilityFromProof(input: {
  canStartTextEdit?: boolean;
  sourceResolution?: HtmlCanvasTargetResolution | null;
}): CanvasPointerCapability;
