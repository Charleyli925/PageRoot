import type { HtmlCanvasRuntimeVisualHint, HtmlCanvasRuntimeVisualHintKind } from "../components/HtmlCanvasEditor.types";

export const RUNTIME_VISUAL_HINT_KINDS: readonly HtmlCanvasRuntimeVisualHintKind[];
export const RUNTIME_VISUAL_HINT_MAX_LABEL_LENGTH: number;
export const RUNTIME_VISUAL_HINT_MAX_TEXT_LENGTH: number;
export const RUNTIME_VISUAL_HINT_MAX_PATH_LENGTH: number;

export function runtimeVisualHintKindLabel(
  kind: HtmlCanvasRuntimeVisualHintKind,
): string;
export function normalizeRuntimeVisualHint(
  value: unknown,
): HtmlCanvasRuntimeVisualHint | null;

