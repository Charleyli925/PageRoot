export const NATIVE_EDIT_HOST_MODE = Object.freeze({
  PLAINTEXT_ONLY: "plaintext-only",
  CONTROLLED: "true",
});

export const NATIVE_EDIT_CHECKPOINT_DELAY_MS = 700;
export const NATIVE_EDIT_COMPOSITION_TERMINAL_GRACE_MS = 80;
export const NATIVE_EDIT_PENDING_COMPOSITION_COMMAND_GRACE_MS = 1200;

export const NATIVE_EDIT_SESSION_CONTROLLED_ATTRIBUTES = Object.freeze([
  "aria-label",
  "aria-multiline",
  "autocapitalize",
  "autocomplete",
  "contenteditable",
  "data-gramm",
  "data-html-canvas-editing",
  "data-html-canvas-native-editing",
  "role",
  "spellcheck",
  "tabindex",
]);

export const NATIVE_EDIT_MANAGED_ATTRIBUTES = Object.freeze([
  ...NATIVE_EDIT_SESSION_CONTROLLED_ATTRIBUTES,
  "data-html-canvas-global-selected",
  "data-html-canvas-selected",
]);

export const NATIVE_EDIT_FORMAT_SKELETON_ROOT_ATTRIBUTES = Object.freeze([
  ...NATIVE_EDIT_MANAGED_ATTRIBUTES,
]);

// Formatting-only HTML wrappers that may disappear when their complete text
// range is replaced. Links and semantic wrappers deliberately stay absent.
export const NATIVE_EDIT_DISPOSABLE_INLINE_WRAPPER_TAGS = Object.freeze([
  "b",
  "em",
  "i",
  "mark",
  "s",
  "small",
  "span",
  "strong",
  "sub",
  "sup",
  "u",
]);

const NATIVE_EDIT_HOST_MODES = new Set(Object.values(NATIVE_EDIT_HOST_MODE));
const DISPOSABLE_INLINE_WRAPPER_TAG_SET = new Set(
  NATIVE_EDIT_DISPOSABLE_INLINE_WRAPPER_TAGS,
);

export function isNativeEditHostMode(value) {
  return NATIVE_EDIT_HOST_MODES.has(value);
}

export function isDisposableNativeInlineWrapperTag(tagName) {
  return DISPOSABLE_INLINE_WRAPPER_TAG_SET.has(
    String(tagName ?? "").toLowerCase(),
  );
}

export function captureNativeEditSessionAttributes(element) {
  return Object.fromEntries(
    NATIVE_EDIT_SESSION_CONTROLLED_ATTRIBUTES.map((name) => [
      name,
      {
        present: element.hasAttribute(name),
        value: element.getAttribute(name),
      },
    ]),
  );
}

export function restoreNativeEditSessionAttributes(element, snapshot) {
  for (const name of NATIVE_EDIT_SESSION_CONTROLLED_ATTRIBUTES) {
    const saved = snapshot?.[name];
    if (saved?.present) element.setAttribute(name, saved.value ?? "");
    else element.removeAttribute(name);
  }
}

export function applyNativeEditSessionAttributes(
  element,
  {
    hostMode,
    ariaLabel = "原位编辑文字",
  },
) {
  if (!isNativeEditHostMode(hostMode)) {
    throw new TypeError("Native edit host mode is invalid.");
  }
  element.setAttribute("data-html-canvas-editing", "true");
  element.setAttribute("data-html-canvas-native-editing", "true");
  element.setAttribute("contenteditable", hostMode);
  element.setAttribute("role", "textbox");
  element.setAttribute("aria-multiline", "true");
  element.setAttribute("aria-label", ariaLabel);
  element.setAttribute("autocapitalize", "off");
  element.setAttribute("autocomplete", "off");
  element.setAttribute("data-gramm", "false");
  element.setAttribute("spellcheck", "true");
  if (element.tabIndex < 0) element.setAttribute("tabindex", "0");
}

function modeProofIsStable(proof) {
  return proof?.layoutStable === true && proof?.styleStable === true;
}

/**
 * Prefer Chromium's plaintext-only surface. Fall back to a controlled
 * contenteditable host only when its measured layout and text style are exact.
 * The controller still enforces a plain-text transaction contract in either
 * mode.
 */
export function chooseNativeEditHostMode({
  plaintextOnly,
  controlled,
}) {
  if (modeProofIsStable(plaintextOnly)) {
    return NATIVE_EDIT_HOST_MODE.PLAINTEXT_ONLY;
  }
  if (modeProofIsStable(controlled)) {
    return NATIVE_EDIT_HOST_MODE.CONTROLLED;
  }
  return null;
}

/**
 * display:contents is not unconditional proof of event loss. When mutation
 * observation is available, PageRoot may enter optimistically: a missing
 * beforeinput/input pair is detected and rolled back before SourcePatch.
 */
export function classifyNativeEventDelivery({
  hasDisplayContents,
  observerReady,
}) {
  if (!hasDisplayContents) return "native";
  if (observerReady) return "observer-guarded";
  return "unsafe";
}
