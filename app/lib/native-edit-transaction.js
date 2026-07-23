import {
  classifyNativeInputIntent,
  NATIVE_INPUT_INTENT_KIND,
} from "./native-input-intent.js";

function isSafeUtf16Boundary(value, offset) {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return !(
    previous >= 0xd800
    && previous <= 0xdbff
    && next >= 0xdc00
    && next <= 0xdfff
  );
}

export function classifyNativeInput(inputType) {
  const intent = classifyNativeInputIntent(inputType);
  if (intent.kind === NATIVE_INPUT_INTENT_KIND.HISTORY) {
    return { category: "history", action: intent.action, supported: true };
  }
  if (intent.kind === NATIVE_INPUT_INTENT_KIND.TEXT) {
    return {
      category: "text",
      action: intent.action,
      supported: true,
      composition: intent.composition === true,
    };
  }
  if (
    intent.kind === NATIVE_INPUT_INTENT_KIND.INSERT_HARD_BREAK
    || intent.kind === NATIVE_INPUT_INTENT_KIND.SPLIT_BLOCK
    || intent.kind === NATIVE_INPUT_INTENT_KIND.FORMAT
    || intent.kind === NATIVE_INPUT_INTENT_KIND.STRUCTURE
  ) {
    return {
      category: "structure",
      action: intent.action,
      supported: false,
    };
  }
  return {
    category: "unsupported",
    action: intent.action,
    supported: false,
  };
}

export function diffNativeText(previousText, nextText) {
  if (previousText === nextText) return null;
  let prefix = 0;
  const prefixLimit = Math.min(previousText.length, nextText.length);
  while (
    prefix < prefixLimit
    && previousText.charCodeAt(prefix) === nextText.charCodeAt(prefix)
  ) prefix += 1;
  while (
    prefix > 0
    && (
      !isSafeUtf16Boundary(previousText, prefix)
      || !isSafeUtf16Boundary(nextText, prefix)
    )
  ) prefix -= 1;

  let suffix = 0;
  const suffixLimit = Math.min(
    previousText.length - prefix,
    nextText.length - prefix,
  );
  while (
    suffix < suffixLimit
    && previousText.charCodeAt(previousText.length - suffix - 1)
      === nextText.charCodeAt(nextText.length - suffix - 1)
  ) suffix += 1;
  while (
    suffix > 0
    && (
      !isSafeUtf16Boundary(previousText, previousText.length - suffix)
      || !isSafeUtf16Boundary(nextText, nextText.length - suffix)
    )
  ) suffix -= 1;

  const endOffset = previousText.length - suffix;
  return {
    startOffset: prefix,
    endOffset,
    beforeText: previousText.slice(prefix, endOffset),
    nextText: nextText.slice(prefix, nextText.length - suffix),
  };
}

function copyNativeEditSelection(selection) {
  if (
    !selection
    || !Number.isSafeInteger(selection.anchor)
    || !Number.isSafeInteger(selection.focus)
    || selection.anchor < 0
    || selection.focus < 0
    || (selection.affinity !== "left" && selection.affinity !== "right")
  ) {
    throw new TypeError("Native transaction selection is invalid.");
  }
  return {
    anchor: selection.anchor,
    focus: selection.focus,
    affinity: selection.affinity,
  };
}

/**
 * Freezes the browser Selection that existed before the first DOM mutation in
 * a source transaction. Later input/selectionchange events may advance the
 * live caret, but they must not rewrite the history transaction's before
 * bookmark. A successful source rebase starts the next transaction.
 */
export class NativeTransactionSelectionTracker {
  constructor() {
    this.transactionStart = null;
  }

  freeze(selection) {
    if (this.transactionStart === null) {
      this.transactionStart = copyNativeEditSelection(selection);
    }
    return this.startSelection();
  }

  startSelection() {
    return this.transactionStart === null
      ? null
      : copyNativeEditSelection(this.transactionStart);
  }

  rebase() {
    this.transactionStart = null;
  }
}

function pieceLength(piece) {
  return piece.kind === "original"
    ? piece.endOffset - piece.startOffset
    : piece.text.length;
}

function slicePiece(piece, startOffset, endOffset) {
  if (endOffset <= startOffset) return null;
  if (piece.kind === "original") {
    return {
      kind: "original",
      startOffset: piece.startOffset + startOffset,
      endOffset: piece.startOffset + endOffset,
    };
  }
  return { kind: "inserted", text: piece.text.slice(startOffset, endOffset) };
}

function mergePieces(pieces) {
  const merged = [];
  for (const piece of pieces) {
    if (pieceLength(piece) === 0) continue;
    const previous = merged.at(-1);
    if (
      previous?.kind === "original"
      && piece.kind === "original"
      && previous.endOffset === piece.startOffset
    ) {
      previous.endOffset = piece.endOffset;
      continue;
    }
    if (previous?.kind === "inserted" && piece.kind === "inserted") {
      previous.text += piece.text;
      continue;
    }
    merged.push({ ...piece });
  }
  return merged;
}

/** Tracks disjoint browser mutations against one source-backed baseline. */
export class NativeTextChangeTracker {
  constructor(baselineText) {
    this.rebase(baselineText);
  }

  rebase(nextBaselineText) {
    this.baselineText = String(nextBaselineText);
    this.currentText = String(nextBaselineText);
    this.pieces = this.baselineText
      ? [{ kind: "original", startOffset: 0, endOffset: this.baselineText.length }]
      : [];
  }

  update(nextText) {
    const normalized = String(nextText);
    const delta = diffNativeText(this.currentText, normalized);
    if (!delta) return;
    this.replaceCurrentRange(delta.startOffset, delta.endOffset, delta.nextText);
  }

  replaceCurrentRange(startOffset, endOffset, nextText) {
    if (
      !Number.isSafeInteger(startOffset)
      || !Number.isSafeInteger(endOffset)
      || startOffset < 0
      || endOffset < startOffset
      || endOffset > this.currentText.length
    ) {
      throw new RangeError("Current native replacement range is invalid.");
    }
    const insertedText = String(nextText);
    const normalized = `${this.currentText.slice(0, startOffset)}`
      + `${insertedText}${this.currentText.slice(endOffset)}`;
    if (normalized === this.baselineText) {
      this.rebase(this.baselineText);
      return;
    }
    const before = [];
    const after = [];
    let consumed = 0;
    for (const piece of this.pieces) {
      const length = pieceLength(piece);
      const pieceStart = consumed;
      const beforeSlice = slicePiece(
        piece,
        0,
        Math.max(0, Math.min(length, startOffset - pieceStart)),
      );
      if (beforeSlice) before.push(beforeSlice);
      const afterSlice = slicePiece(
        piece,
        Math.max(0, Math.min(length, endOffset - pieceStart)),
        length,
      );
      if (afterSlice) after.push(afterSlice);
      consumed += length;
    }
    this.pieces = mergePieces([
      ...before,
      ...(insertedText ? [{ kind: "inserted", text: insertedText }] : []),
      ...after,
    ]);
    this.currentText = normalized;
  }

  snapshot() {
    return {
      baselineText: this.baselineText,
      currentText: this.currentText,
      pieces: this.pieces.map((piece) => ({ ...piece })),
    };
  }

  restore(snapshot) {
    if (
      !snapshot
      || typeof snapshot.baselineText !== "string"
      || typeof snapshot.currentText !== "string"
      || !Array.isArray(snapshot.pieces)
    ) {
      throw new TypeError("Native text tracker snapshot is invalid.");
    }
    const pieces = snapshot.pieces.map((piece) => {
      if (piece?.kind === "inserted" && typeof piece.text === "string") {
        return { kind: "inserted", text: piece.text };
      }
      if (
        piece?.kind === "original"
        && Number.isSafeInteger(piece.startOffset)
        && Number.isSafeInteger(piece.endOffset)
        && piece.startOffset >= 0
        && piece.endOffset >= piece.startOffset
        && piece.endOffset <= snapshot.baselineText.length
      ) {
        return {
          kind: "original",
          startOffset: piece.startOffset,
          endOffset: piece.endOffset,
        };
      }
      throw new TypeError("Native text tracker snapshot piece is invalid.");
    });
    const reconstructed = pieces.map((piece) => (
      piece.kind === "inserted"
        ? piece.text
        : snapshot.baselineText.slice(piece.startOffset, piece.endOffset)
    )).join("");
    if (reconstructed !== snapshot.currentText) {
      throw new TypeError("Native text tracker snapshot does not match its pieces.");
    }
    this.baselineText = snapshot.baselineText;
    this.currentText = snapshot.currentText;
    this.pieces = pieces;
  }

  replacements() {
    const replacements = [];
    let originalCursor = 0;
    let insertedText = "";
    for (const piece of this.pieces) {
      if (piece.kind === "inserted") {
        insertedText += piece.text;
        continue;
      }
      if (piece.startOffset < originalCursor) {
        return [{
          startOffset: 0,
          endOffset: this.baselineText.length,
          beforeText: this.baselineText,
          nextText: this.currentText,
        }];
      }
      if (piece.startOffset > originalCursor || insertedText) {
        replacements.push({
          startOffset: originalCursor,
          endOffset: piece.startOffset,
          beforeText: this.baselineText.slice(originalCursor, piece.startOffset),
          nextText: insertedText,
        });
      }
      originalCursor = piece.endOffset;
      insertedText = "";
    }
    if (originalCursor < this.baselineText.length || insertedText) {
      replacements.push({
        startOffset: originalCursor,
        endOffset: this.baselineText.length,
        beforeText: this.baselineText.slice(originalCursor),
        nextText: insertedText,
      });
    }
    return replacements.filter((replacement) => (
      replacement.beforeText !== replacement.nextText
    ));
  }

  originalRangesForCurrentRange(startOffset, endOffset) {
    if (
      !Number.isSafeInteger(startOffset)
      || !Number.isSafeInteger(endOffset)
      || startOffset < 0
      || endOffset < startOffset
      || endOffset > this.currentText.length
    ) {
      throw new RangeError("Current native text range is invalid.");
    }
    const ranges = [];
    let currentCursor = 0;
    for (const piece of this.pieces) {
      const length = pieceLength(piece);
      const overlapStart = Math.max(startOffset, currentCursor);
      const overlapEnd = Math.min(endOffset, currentCursor + length);
      if (piece.kind === "original" && overlapEnd > overlapStart) {
        const mapped = {
          startOffset: piece.startOffset + overlapStart - currentCursor,
          endOffset: piece.startOffset + overlapEnd - currentCursor,
        };
        const previous = ranges.at(-1);
        if (previous && previous.endOffset === mapped.startOffset) {
          previous.endOffset = mapped.endOffset;
        } else {
          ranges.push(mapped);
        }
      }
      currentCursor += length;
    }
    return ranges;
  }

  value() {
    return this.currentText;
  }

  dirty() {
    return this.currentText !== this.baselineText;
  }
}
