import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import type { PagePresentationAction } from "../lib/page-view-context.js";
import type { MoveAvailability } from "./html-canvas-selection";
import type {
  EditableStyleProperty,
  SelectedStyle,
} from "./html-canvas-style-inspector";
import type {
  CanvasCapabilityHoverSnapshot,
  CanvasHoverHintPlacement,
} from "./html-canvas-capability-hover";
import type { NoticeUsageCapture } from "./NoticeBar";
import type {
  HtmlCanvasInteractionMode,
  HtmlCanvasSelection,
} from "./HtmlCanvasEditor.types";

export type HtmlCanvasCommentMarker = {
  key: string;
  selection: HtmlCanvasSelection;
  count?: number;
  label?: string;
  placement?: "target-corner" | "tab-side";
  left: number;
  top: number;
};

export type HtmlCanvasEditFeedback = {
  code: string;
  title: string;
  message: string;
  tone: "warning" | "error";
  sticky: boolean;
  recovery: "reload" | "none";
};

export type CapabilityHoverState =
  | { kind: "off" }
  | {
    kind: "preview";
    capability: NonNullable<CanvasCapabilityHoverSnapshot["capability"]>;
    outlineStyle: CSSProperties;
    hint: {
      style: CSSProperties;
      placement: CanvasHoverHintPlacement;
    } | null;
  };

export type SelectionOverlayState =
  | { kind: "none" }
  | {
    kind: "target";
    selection: HtmlCanvasSelection;
    outlineStyle?: CSSProperties;
  };

export type SelectionChromeModel = {
  hover: CapabilityHoverState;
  overlay: SelectionOverlayState;
  canvasTransitionActive: boolean;
  selectionCapabilitySpoken: string;
  interactionLocked: boolean;
  hoverHintMeasureRef: RefObject<HTMLDivElement | null>;
  editFeedback: HtmlCanvasEditFeedback | null;
  reloadActionLabel: string;
  editFeedbackActionAvailable: boolean;
  renderedMode: HtmlCanvasInteractionMode;
  commentMarkers: readonly HtmlCanvasCommentMarker[];
  toolbarVisible: boolean;
  overlayPosition: { toolbarLeft: number; toolbarTop: number } | null;
  toolbarRef: RefObject<HTMLDivElement | null>;
  hasTextRange: boolean;
  isEditing: boolean;
  toolbarStyle: CSSProperties | undefined;
  selectedPagePresentationAction: PagePresentationAction | null;
  readOnly: boolean;
  selectedNativeEditAvailable: boolean;
  selectedStyle: SelectedStyle;
  textFormatRequiresSelection: boolean;
  enableReorder: boolean;
  moveAvailability: MoveAvailability;
  spacingMenuRef: RefObject<HTMLDetailsElement | null>;
  spacingMenuOpen: boolean;
  usageProjectId?: string;
  usageCapture?: NoticeUsageCapture;
};

export type SelectionChromeActions = {
  onHoverHintPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onHoverHintPointerEnter: () => void;
  onHoverHintPointerLeave: () => void;
  onHoverHintClick: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onEditFeedbackAction: () => void;
  onDismissEditFeedback: () => void;
  onPauseEditFeedback: (paused: boolean) => void;
  onSelectCommentMarker: (selection: HtmlCanvasSelection) => void;
  onToolbarKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => void;
  onToolbarPointerDownCapture: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onToolbarMouseDownCapture: (event: ReactMouseEvent<HTMLDivElement>) => void;
  onExecutePresentationAction: () => void;
  onComment: () => void;
  onStartEditing: () => void;
  onApplyInlineStyle: (property: EditableStyleProperty, value: string) => void;
  onMoveSelected: (direction: "up" | "down") => void;
  onToggleSpacingMenu: () => void;
};

export type SelectionChromeProjection = Readonly<{
  toolbarStyle?: CSSProperties;
  selectedOutlineStyle?: CSSProperties;
  hoverOutlineStyle?: CSSProperties;
  hoverHintStyle?: CSSProperties;
  hoverHintPlacement?: CanvasHoverHintPlacement;
  selectedPagePresentationAction: PagePresentationAction | null;
}>;

function sameScalarRecord<T extends object>(
  left: T | undefined,
  right: T | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  const leftRecord = left as Readonly<Record<string, unknown>>;
  const rightRecord = right as Readonly<Record<string, unknown>>;
  return leftKeys.length === rightKeys.length
    && leftKeys.every(
      (key) => Object.hasOwn(rightRecord, key) && Object.is(leftRecord[key], rightRecord[key]),
    );
}

export function stabilizeSelectionChromeProjection(
  previous: SelectionChromeProjection | null,
  next: SelectionChromeProjection,
): SelectionChromeProjection {
  if (!previous) return next;
  const projection: SelectionChromeProjection = {
    toolbarStyle: sameScalarRecord(previous.toolbarStyle, next.toolbarStyle)
      ? previous.toolbarStyle
      : next.toolbarStyle,
    selectedOutlineStyle: sameScalarRecord(
      previous.selectedOutlineStyle,
      next.selectedOutlineStyle,
    ) ? previous.selectedOutlineStyle : next.selectedOutlineStyle,
    hoverOutlineStyle: sameScalarRecord(previous.hoverOutlineStyle, next.hoverOutlineStyle)
      ? previous.hoverOutlineStyle
      : next.hoverOutlineStyle,
    hoverHintStyle: sameScalarRecord(previous.hoverHintStyle, next.hoverHintStyle)
      ? previous.hoverHintStyle
      : next.hoverHintStyle,
    hoverHintPlacement: sameScalarRecord(
      previous.hoverHintPlacement,
      next.hoverHintPlacement,
    ) ? previous.hoverHintPlacement : next.hoverHintPlacement,
    selectedPagePresentationAction: next.selectedPagePresentationAction,
  };
  return Object.keys(projection).every(
    (key) => projection[key as keyof SelectionChromeProjection]
      === previous[key as keyof SelectionChromeProjection],
  ) ? previous : projection;
}

export function deriveCapabilityHoverState(input: {
  enabled: boolean;
  hoverChrome: CanvasCapabilityHoverSnapshot;
  hoverTargetIsSelected: boolean;
  isEditing: boolean;
  interactionLocked: boolean;
  outlineStyle?: CSSProperties;
  hintStyle?: CSSProperties;
  hintPlacement?: CanvasHoverHintPlacement;
}): CapabilityHoverState {
  if (
    !input.enabled
    || !input.hoverChrome.outline
    || !input.hoverChrome.capability
    || input.hoverTargetIsSelected
    || input.isEditing
    || input.interactionLocked
    || !input.outlineStyle
  ) {
    return { kind: "off" };
  }
  return {
    kind: "preview",
    capability: input.hoverChrome.capability,
    outlineStyle: input.outlineStyle,
    hint: input.hoverChrome.hint && input.hintStyle && input.hintPlacement
      ? {
        style: input.hintStyle,
        placement: input.hintPlacement,
      }
      : null,
  };
}

export function deriveSelectionOverlay(input: {
  selection: HtmlCanvasSelection | null;
  outlineStyle?: CSSProperties;
}): SelectionOverlayState {
  if (!input.selection) return { kind: "none" };
  return {
    kind: "target",
    selection: input.selection,
    outlineStyle: input.outlineStyle,
  };
}

export function selectionChromeViewFields(model: SelectionChromeModel) {
  const hover = model.hover;
  const overlay = model.overlay;
  return {
    showHoverOutline: hover.kind === "preview",
    showHoverHint: hover.kind === "preview" && Boolean(hover.hint),
    hoverOutlineStyle: hover.kind === "preview" ? hover.outlineStyle : undefined,
    hoverHintStyle: hover.kind === "preview" ? hover.hint?.style : undefined,
    hoverHintPlacement: hover.kind === "preview" ? hover.hint?.placement : undefined,
    hoverCapability: hover.kind === "preview" ? hover.capability : null,
    selection: overlay.kind === "target" ? overlay.selection : null,
    selectedOutlineStyle: overlay.kind === "target" ? overlay.outlineStyle : undefined,
  };
}
