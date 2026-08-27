function sameScalarRecord(left, right) {
  if (left === right) return true;
  if (!left || !right) return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every(
      (key) => Object.hasOwn(right, key) && Object.is(left[key], right[key]),
    );
}

export function stabilizeSelectionChromeProjection(previous, next) {
  if (!previous) return next;
  const projection = {
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
    (key) => projection[key] === previous[key],
  ) ? previous : projection;
}

export function deriveCapabilityHoverState(input) {
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

export function deriveSelectionOverlay(input) {
  if (!input.selection) return { kind: "none" };
  return {
    kind: "target",
    selection: input.selection,
    outlineStyle: input.outlineStyle,
  };
}

export function selectionChromeViewFields(model) {
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
