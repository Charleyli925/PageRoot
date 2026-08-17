import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  canvasPointerCapabilityFromProof,
} from "../app/components/html-canvas-pointer-proof.js";

test("editable proof wins over a selectable or button-like host", () => {
  assert.equal(
    canvasPointerCapabilityFromProof({
      canStartTextEdit: true,
      sourceResolution: "exact",
    }).hint,
    "双击文字直接编辑",
  );
  assert.equal(
    canvasPointerCapabilityFromProof({
      canStartTextEdit: true,
      sourceResolution: "ambiguous",
    }).cursor,
    "text",
  );
});

test("mapped source targets use the select-and-comment caption", () => {
  assert.equal(
    canvasPointerCapabilityFromProof({
      canStartTextEdit: false,
      sourceResolution: "exact",
    }).hint,
    "单击选择并评论",
  );
  assert.equal(
    canvasPointerCapabilityFromProof({
      canStartTextEdit: false,
      sourceResolution: "rebound",
    }).cursor,
    "pointer",
  );
});

test("unmapped targets stay comment-only", () => {
  const capability = canvasPointerCapabilityFromProof({
    canStartTextEdit: false,
    sourceResolution: "ambiguous",
  });
  assert.equal(capability.hint, "可添加评论交给 AI");
  assert.equal(capability.cursor, "help");
});

test("classifier does not approximate editability from tag names", async () => {
  const source = await readFile(
    new URL("../app/components/html-canvas-pointer-capability.ts", import.meta.url),
    "utf8",
  );
  const proof = await readFile(
    new URL("../app/components/html-canvas-pointer-proof.js", import.meta.url),
    "utf8",
  );
  assert.equal(source.includes("isNativeDirectEditRoot"), false);
  assert.equal(proof.includes("isNativeDirectEditRoot"), false);
  assert.equal(proof.includes("button"), false);
});

test("guide and hover copy stay off the selected toolbar", async () => {
  const editor = await readFile(
    new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url),
    "utf8",
  );
  const card = await readFile(
    new URL("../app/components/FirstEditGuideCard.tsx", import.meta.url),
    "utf8",
  );
  assert.equal(editor.includes("capabilityCaption"), false);
  assert.equal(editor.includes("selectionCapability.hint"), false);
  assert.equal(card.includes("知道了"), false);
  assert.equal(card.includes("单击选择"), false);
  assert.equal(card.includes("点击“预览”查看最终效果。"), false);
  assert.equal(card.includes("打开自己的 HTML，添加为项目"), true);
  assert.equal(card.includes("双击改字，自动保存在当前页"), true);
  assert.equal(card.includes("单击要改的区域，写下评论，AI 会按这里改"), true);
  assert.equal(card.includes("点右上角发送，把任务粘贴给 AI Agent"), true);
});
