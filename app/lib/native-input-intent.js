const SAFE_TEXT_INPUT_TYPES = new Set([
  "deleteByCut",
  "deleteContent",
  "deleteContentBackward",
  "deleteContentForward",
  "deleteEntireSoftLine",
  "deleteHardLineBackward",
  "deleteHardLineForward",
  "deleteSoftLineBackward",
  "deleteSoftLineForward",
  "deleteWordBackward",
  "deleteWordForward",
  "insertCompositionText",
  "insertFromComposition",
  "insertFromDrop",
  "insertFromPaste",
  "insertFromPasteAsQuotation",
  "insertReplacementText",
  "insertText",
]);

const FORMAT_INPUT_TYPES = new Set([
  "formatBackColor",
  "formatBold",
  "formatFontColor",
  "formatFontName",
  "formatIndent",
  "formatItalic",
  "formatJustifyCenter",
  "formatJustifyFull",
  "formatJustifyLeft",
  "formatJustifyRight",
  "formatOutdent",
  "formatRemove",
  "formatSetBlockTextDirection",
  "formatSetInlineTextDirection",
  "formatStrikethrough",
  "formatSubscript",
  "formatSuperscript",
  "formatUnderline",
]);

const OTHER_STRUCTURAL_INPUT_TYPES = new Set([
  "deleteByDrag",
  "deleteByComposition",
  "insertHorizontalRule",
  "insertOrderedList",
  "insertTranspose",
  "insertUnorderedList",
]);

export const NATIVE_INPUT_INTENT_KIND = Object.freeze({
  TEXT: "text",
  HISTORY: "history",
  INSERT_HARD_BREAK: "insert-hard-break",
  SPLIT_BLOCK: "split-block",
  FORMAT: "format",
  STRUCTURE: "structure",
  UNSUPPORTED: "unsupported",
});

export function classifyNativeInputIntent(inputType) {
  const action = String(inputType || "");
  if (action === "historyUndo" || action === "historyRedo") {
    return {
      kind: NATIVE_INPUT_INTENT_KIND.HISTORY,
      action: action === "historyRedo" ? "redo" : "undo",
      supported: true,
    };
  }
  if (SAFE_TEXT_INPUT_TYPES.has(action)) {
    return {
      kind: NATIVE_INPUT_INTENT_KIND.TEXT,
      action,
      supported: true,
      composition: action.includes("Composition"),
    };
  }
  if (action === "insertLineBreak") {
    return {
      kind: NATIVE_INPUT_INTENT_KIND.INSERT_HARD_BREAK,
      action,
      supported: false,
    };
  }
  if (action === "insertParagraph") {
    return {
      kind: NATIVE_INPUT_INTENT_KIND.SPLIT_BLOCK,
      action,
      supported: false,
    };
  }
  if (FORMAT_INPUT_TYPES.has(action)) {
    return {
      kind: NATIVE_INPUT_INTENT_KIND.FORMAT,
      action,
      supported: false,
    };
  }
  if (OTHER_STRUCTURAL_INPUT_TYPES.has(action)) {
    return {
      kind: NATIVE_INPUT_INTENT_KIND.STRUCTURE,
      action,
      supported: false,
    };
  }
  return {
    kind: NATIVE_INPUT_INTENT_KIND.UNSUPPORTED,
    action: action || "unknown",
    supported: false,
  };
}

export function normalizePlainTextLineEndings(value) {
  return String(value ?? "").replace(/\r\n?/gu, "\n");
}

export function hasMultilinePlainText(value) {
  return normalizePlainTextLineEndings(value).includes("\n");
}
