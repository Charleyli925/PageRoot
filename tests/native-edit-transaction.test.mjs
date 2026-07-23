import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  NativeTextChangeTracker,
  NativeTransactionSelectionTracker,
  classifyNativeInput,
  diffNativeText,
} from "../app/lib/native-edit-transaction.js";

test("DOM structure capture remains a single accumulated traversal", () => {
  const source = readFileSync(
    new URL("../app/components/NativeEditingController.ts", import.meta.url),
    "utf8",
  );
  const start = source.indexOf("function captureDomStructure(");
  const end = source.indexOf("\nfunction domStructureSnapshotsMatch(", start);
  assert.notEqual(start, -1, "captureDomStructure must remain directly auditable");
  assert.notEqual(end, -1, "captureDomStructure boundary must remain directly auditable");
  const implementation = source.slice(start, end);
  assert.match(implementation, /let logicalOffset = 0;/u);
  assert.doesNotMatch(implementation, /logicalOffsetForDomPoint/u);
  assert.doesNotMatch(implementation, /nodeLogicalLength/u);
});

test("native transaction selection remains frozen until the source baseline advances", () => {
  const selections = new NativeTransactionSelectionTracker();
  const before = { anchor: 14, focus: 14, affinity: "left" };
  assert.deepEqual(selections.freeze(before), before);

  // input, compositionend, and selectionchange all expose the new caret. They
  // must not rewrite the history transaction's before bookmark.
  assert.deepEqual(
    selections.freeze({ anchor: 21, focus: 21, affinity: "left" }),
    before,
  );
  assert.deepEqual(selections.startSelection(), before);

  // Returned values are snapshots, not mutable aliases of the stored state.
  selections.startSelection().anchor = 99;
  assert.deepEqual(selections.startSelection(), before);

  selections.rebase();
  assert.equal(selections.startSelection(), null);
  const nextBefore = { anchor: 3, focus: 8, affinity: "right" };
  assert.deepEqual(selections.freeze(nextBefore), nextBefore);
});

test("native input classification separates text, history, and structural operations", () => {
  assert.deepEqual(classifyNativeInput("insertText"), {
    category: "text",
    action: "insertText",
    supported: true,
    composition: false,
  });
  assert.deepEqual(classifyNativeInput("historyUndo"), {
    category: "history",
    action: "undo",
    supported: true,
  });
  assert.deepEqual(classifyNativeInput("insertParagraph"), {
    category: "structure",
    action: "insertParagraph",
    supported: false,
  });
  assert.equal(classifyNativeInput("formatBold").supported, false);
});

test("native text diff preserves emoji surrogate boundaries", () => {
  assert.deepEqual(diffNativeText("A😀B", "A🌏B"), {
    startOffset: 1,
    endOffset: 3,
    beforeText: "😀",
    nextText: "🌏",
  });
});

test("native tracker keeps disjoint browser edits as separate replacements", () => {
  const tracker = new NativeTextChangeTracker("alpha beta gamma");
  tracker.update("Alpha beta gamma");
  tracker.update("Alpha beta Gamma");
  assert.deepEqual(tracker.replacements(), [
    { startOffset: 0, endOffset: 1, beforeText: "a", nextText: "A" },
    { startOffset: 11, endOffset: 12, beforeText: "g", nextText: "G" },
  ]);
  tracker.rebase("Alpha beta Gamma");
  assert.equal(tracker.dirty(), false);
});

test("native tracker snapshot restores exact piece identity after a transient edit", () => {
  const tracker = new NativeTextChangeTracker("a");
  tracker.update("aa");
  const accepted = tracker.snapshot();
  assert.deepEqual(tracker.replacements(), [
    { startOffset: 1, endOffset: 1, beforeText: "", nextText: "a" },
  ]);

  tracker.update("b");
  tracker.restore(accepted);
  assert.equal(tracker.value(), "aa");
  assert.deepEqual(tracker.replacements(), [
    { startOffset: 1, endOffset: 1, beforeText: "", nextText: "a" },
  ]);

  accepted.pieces[0].kind = "inserted";
  assert.deepEqual(tracker.replacements(), [
    { startOffset: 1, endOffset: 1, beforeText: "", nextText: "a" },
  ]);
});

test("native tracker maps later gesture ranges back to the source baseline", () => {
  const tracker = new NativeTextChangeTracker("abcDEFghi");
  tracker.update("++abcDEFghi");
  assert.deepEqual(tracker.originalRangesForCurrentRange(5, 8), [
    { startOffset: 3, endOffset: 6 },
  ]);

  tracker.update("++abcXXDEFghi");
  assert.deepEqual(tracker.originalRangesForCurrentRange(3, 10), [
    { startOffset: 1, endOffset: 6 },
  ]);
});

test("explicit current ranges disambiguate equal adjacent source characters", () => {
  const tracker = new NativeTextChangeTracker("&&");
  tracker.replaceCurrentRange(0, 1, "");
  assert.equal(tracker.value(), "&");
  assert.deepEqual(tracker.replacements(), [
    { startOffset: 0, endOffset: 1, beforeText: "&", nextText: "" },
  ]);

  tracker.rebase("aa");
  tracker.replaceCurrentRange(1, 1, "a");
  assert.equal(tracker.value(), "aaa");
  assert.deepEqual(tracker.replacements(), [
    { startOffset: 1, endOffset: 1, beforeText: "", nextText: "a" },
  ]);
});
