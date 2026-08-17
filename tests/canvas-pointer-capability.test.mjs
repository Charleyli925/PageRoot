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
    "双击编辑",
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
