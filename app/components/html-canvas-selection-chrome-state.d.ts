import type { CSSProperties } from "react";

import type { PagePresentationAction } from "../lib/page-view-context.js";
import type {
  CanvasCapabilityHoverSnapshot,
  CanvasHoverHintPlacement,
} from "./html-canvas-capability-hover";
import type { HtmlCanvasSelection } from "./HtmlCanvasEditor.types";
import type {
  CapabilityHoverState,
  SelectionChromeModel,
  SelectionChromeProjection,
  SelectionOverlayState,
} from "./html-canvas-selection-chrome-contract";

export function stabilizeSelectionChromeProjection(
  previous: SelectionChromeProjection | null,
  next: SelectionChromeProjection,
): SelectionChromeProjection;

export function deriveCapabilityHoverState(input: {
  enabled: boolean;
  hoverChrome: CanvasCapabilityHoverSnapshot;
  hoverTargetIsSelected: boolean;
  isEditing: boolean;
  interactionLocked: boolean;
  outlineStyle?: CSSProperties;
  hintStyle?: CSSProperties;
  hintPlacement?: CanvasHoverHintPlacement;
}): CapabilityHoverState;

export function deriveSelectionOverlay(input: {
  selection: HtmlCanvasSelection | null;
  outlineStyle?: CSSProperties;
}): SelectionOverlayState;

export function selectionChromeViewFields(model: SelectionChromeModel): {
  showHoverOutline: boolean;
  showHoverHint: boolean;
  hoverOutlineStyle: CSSProperties | undefined;
  hoverHintStyle: CSSProperties | undefined;
  hoverHintPlacement: CanvasHoverHintPlacement | undefined;
  hoverCapability: NonNullable<CanvasCapabilityHoverSnapshot["capability"]> | null;
  selection: HtmlCanvasSelection | null;
  selectedOutlineStyle: CSSProperties | undefined;
};

export type {
  CapabilityHoverState,
  PagePresentationAction,
  SelectionChromeModel,
  SelectionChromeProjection,
  SelectionOverlayState,
};
