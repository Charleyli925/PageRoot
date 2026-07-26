import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyNativeInputIntent,
  hasMultilinePlainText,
  normalizePlainTextLineEndings,
} from "../app/lib/native-input-intent.js";

test("native input intents support text while rejecting browser history input", () => {
  assert.deepEqual(classifyNativeInputIntent("insertText"), {
    kind: "text",
    action: "insertText",
    supported: true,
    composition: false,
  });
  assert.deepEqual(classifyNativeInputIntent("insertCompositionText"), {
    kind: "text",
    action: "insertCompositionText",
    supported: true,
    composition: true,
  });
  assert.deepEqual(classifyNativeInputIntent("historyRedo"), {
    kind: "unsupported",
    action: "historyRedo",
    supported: false,
  });
});

test("structural browser defaults remain named but blocked until source planners own them", () => {
  assert.deepEqual(classifyNativeInputIntent("insertLineBreak"), {
    kind: "insert-hard-break",
    action: "insertLineBreak",
    supported: false,
  });
  assert.deepEqual(classifyNativeInputIntent("insertParagraph"), {
    kind: "split-block",
    action: "insertParagraph",
    supported: false,
  });
  assert.deepEqual(classifyNativeInputIntent("formatBold"), {
    kind: "format",
    action: "formatBold",
    supported: false,
  });
});

test("plain text line endings normalize without adopting clipboard formatting", () => {
  assert.equal(normalizePlainTextLineEndings("甲\r\n乙\r丙\n丁"), "甲\n乙\n丙\n丁");
  assert.equal(hasMultilinePlainText("单行"), false);
  assert.equal(hasMultilinePlainText("第一行\r\n第二行"), true);
});
