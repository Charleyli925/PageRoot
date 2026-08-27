import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveCapabilityHoverState,
  deriveSelectionOverlay,
  selectionChromeViewFields,
} from "../app/components/html-canvas-selection-chrome-contract.ts";

const selection = Object.freeze({
  id: "target_1",
  label: "Target",
  selector: "main > p",
  level: "part",
  tagName: "p",
  text: "Target",
  resolution: "exact",
});
const capability = Object.freeze({
  kind: "edit-text",
  hint: "Edit text",
  spoken: "Editable",
  cursor: "text",
});
const hoverChrome = Object.freeze({
  cursor: "text",
  outline: true,
  hint: true,
  capability,
});
const outlineStyle = Object.freeze({ left: 1, top: 2, width: 3, height: 4 });
const hintStyle = Object.freeze({ left: 5, top: 6 });
const hintPlacement = Object.freeze({ left: 5, top: 6, width: 96, placement: "below" });

function hoverInput(overrides = {}) {
  return {
    enabled: true,
    hoverChrome,
    hoverTargetIsSelected: false,
    isEditing: false,
    interactionLocked: false,
    outlineStyle,
    hintStyle,
    hintPlacement,
    ...overrides,
  };
}

test("deriveCapabilityHoverState covers off, preview-with-hint and preview-without-hint", () => {
  for (const overrides of [
    { enabled: false },
    { hoverChrome: { ...hoverChrome, outline: false } },
    { hoverChrome: { ...hoverChrome, capability: null } },
    { hoverTargetIsSelected: true },
    { isEditing: true },
    { interactionLocked: true },
    { outlineStyle: undefined },
  ]) {
    assert.deepEqual(deriveCapabilityHoverState(hoverInput(overrides)), { kind: "off" });
  }

  const preview = deriveCapabilityHoverState(hoverInput());
  assert.deepEqual(preview, {
    kind: "preview",
    capability,
    outlineStyle,
    hint: { style: hintStyle, placement: hintPlacement },
  });

  const withoutHint = deriveCapabilityHoverState(hoverInput({
    hoverChrome: { ...hoverChrome, hint: false },
  }));
  assert.equal(withoutHint.kind, "preview");
  assert.equal(withoutHint.hint, null);
});

test("deriveSelectionOverlay and view fields cover every union branch", () => {
  const none = deriveSelectionOverlay({ selection: null, outlineStyle });
  assert.deepEqual(none, { kind: "none" });
  const target = deriveSelectionOverlay({ selection, outlineStyle });
  assert.deepEqual(target, { kind: "target", selection, outlineStyle });

  const baseModel = {
    hover: { kind: "off" },
    overlay: none,
  };
  assert.deepEqual(selectionChromeViewFields(baseModel), {
    showHoverOutline: false,
    showHoverHint: false,
    hoverOutlineStyle: undefined,
    hoverHintStyle: undefined,
    hoverHintPlacement: undefined,
    hoverCapability: null,
    selection: null,
    selectedOutlineStyle: undefined,
  });

  const preview = deriveCapabilityHoverState(hoverInput());
  assert.deepEqual(selectionChromeViewFields({ hover: preview, overlay: target }), {
    showHoverOutline: true,
    showHoverHint: true,
    hoverOutlineStyle: outlineStyle,
    hoverHintStyle: hintStyle,
    hoverHintPlacement: hintPlacement,
    hoverCapability: capability,
    selection,
    selectedOutlineStyle: outlineStyle,
  });

  const withoutHint = deriveCapabilityHoverState(hoverInput({
    hoverChrome: { ...hoverChrome, hint: false },
  }));
  assert.equal(
    selectionChromeViewFields({ hover: withoutHint, overlay: none }).showHoverHint,
    false,
  );
});
