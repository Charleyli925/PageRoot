import { normalizePlainTextLineEndings } from "./native-input-intent.js";
import { textRangeToSourceEdit } from "./source-text-map.js";

export const NATIVE_SOURCE_EDIT_KIND = Object.freeze({
  INSERT_TEXT_FLOW: "insert-text-flow",
  DELETE_HARD_BREAK: "delete-hard-break",
  SPLIT_BLOCK: "split-block",
});

export class NativeStructuralEditError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "NativeStructuralEditError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details = {}) {
  throw new NativeStructuralEditError(code, message, details);
}

function normalizedSelection(sourceMap, selection) {
  const anchor = Number(selection?.anchor);
  const focus = Number(selection?.focus);
  if (
    !Number.isInteger(anchor)
    || !Number.isInteger(focus)
    || anchor < 0
    || focus < 0
    || anchor > sourceMap.textLength
    || focus > sourceMap.textLength
  ) {
    fail(
      "STRUCTURAL_SELECTION_INVALID",
      "The structural edit selection is outside the source text map.",
      { selection, textLength: sourceMap.textLength },
    );
  }
  return {
    anchor,
    focus,
    affinity: selection?.affinity === "left" ? "left" : "right",
    startOffset: Math.min(anchor, focus),
    endOffset: Math.max(anchor, focus),
  };
}

export function planNativeStructuralEdit(sourceMap, intent) {
  if (!sourceMap || typeof sourceMap.text !== "string") {
    fail(
      "STRUCTURAL_SOURCE_MAP_REQUIRED",
      "A source text map is required for structural editing.",
    );
  }
  const selection = normalizedSelection(sourceMap, intent?.selection);

  if (intent?.kind === NATIVE_SOURCE_EDIT_KIND.INSERT_TEXT_FLOW) {
    const nextText = normalizePlainTextLineEndings(intent.text);
    if (!nextText.includes("\n")) {
      fail(
        "TEXT_FLOW_BREAK_REQUIRED",
        "A text flow edit requires at least one explicit line break.",
      );
    }
    const edit = textRangeToSourceEdit(
      sourceMap,
      selection.startOffset,
      selection.endOffset,
      selection.affinity,
    );
    const nextOffset = selection.startOffset + nextText.length;
    return {
      kind: intent.kind,
      inputType: String(intent.inputType || "insertLineBreak"),
      command: {
        type: "replace-text-flow-range",
        replacements: [{
          deleteSegments: edit.deleteSegments,
          insertAt: edit.insertAt,
          beforeText: sourceMap.text.slice(
            selection.startOffset,
            selection.endOffset,
          ),
          nextText,
        }],
        beforeText: sourceMap.text.slice(
          selection.startOffset,
          selection.endOffset,
        ),
      },
      previousText: sourceMap.text,
      nextText: `${sourceMap.text.slice(0, selection.startOffset)}${nextText}${sourceMap.text.slice(selection.endOffset)}`,
      selection: {
        anchor: nextOffset,
        focus: nextOffset,
        affinity: "right",
      },
    };
  }

  if (intent?.kind === NATIVE_SOURCE_EDIT_KIND.DELETE_HARD_BREAK) {
    const startOffset = Number(intent.range?.startOffset);
    const endOffset = Number(intent.range?.endOffset);
    const hardBreak = sourceMap.runs.find((run) => (
      run.kind === "hard-break"
      && run.textStart === startOffset
      && run.textEnd === endOffset
    ));
    if (!hardBreak || endOffset - startOffset !== 1) {
      fail(
        "HARD_BREAK_RANGE_INVALID",
        "The requested deletion is not one authored hard break.",
        { range: intent.range },
      );
    }
    return {
      kind: intent.kind,
      inputType: String(intent.inputType || "deleteContentBackward"),
      command: {
        type: "delete-hard-break",
        hardBreakNodeId: hardBreak.nodeId,
      },
      previousText: sourceMap.text,
      nextText: `${sourceMap.text.slice(0, startOffset)}${sourceMap.text.slice(endOffset)}`,
      selection: {
        anchor: startOffset,
        focus: startOffset,
        affinity: intent.inputType === "deleteContentForward" ? "right" : "left",
      },
    };
  }

  if (intent?.kind === NATIVE_SOURCE_EDIT_KIND.SPLIT_BLOCK) {
    if (selection.startOffset !== selection.endOffset) {
      fail(
        "BLOCK_SPLIT_SELECTION_UNSUPPORTED",
        "Block splitting requires one collapsed caret.",
        { selection },
      );
    }
    const textRun = sourceMap.runs.length === 1
      && sourceMap.runs[0]?.kind === "text"
      && sourceMap.runs[0].parentNodeId === sourceMap.rootNodeId
      ? sourceMap.runs[0]
      : null;
    if (
      !["p", "li"].includes(sourceMap.rootTagName)
      || !textRun
      || selection.startOffset <= 0
      || selection.startOffset >= sourceMap.textLength
    ) {
      fail(
        "BLOCK_SPLIT_SIMPLE_TEXT_REQUIRED",
        "Only a caret inside one direct, non-empty <p> or <li> text node can split the block.",
        {
          rootTagName: sourceMap.rootTagName,
          runCount: sourceMap.runs.length,
          splitOffset: selection.startOffset,
          textLength: sourceMap.textLength,
        },
      );
    }
    return {
      kind: intent.kind,
      inputType: String(intent.inputType || "insertParagraph"),
      command: {
        type: "split-text-block",
        splitOffset: selection.startOffset,
      },
      previousText: sourceMap.text,
      nextText: sourceMap.text,
      firstText: sourceMap.text.slice(0, selection.startOffset),
      secondText: sourceMap.text.slice(selection.startOffset),
      selection: {
        anchor: 0,
        focus: 0,
        affinity: "right",
      },
    };
  }

  fail(
    "STRUCTURAL_INTENT_UNSUPPORTED",
    `Unsupported native structural edit: ${intent?.kind ?? "missing"}.`,
  );
}
