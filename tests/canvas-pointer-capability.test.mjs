import assert from "node:assert/strict";
import test from "node:test";

import {
  canvasPointerCapabilityFromProof,
} from "../app/components/html-canvas-pointer-proof.js";
import { moduleHasSubstance } from "../app/components/html-canvas-pointer-hit.js";

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
  assert.equal(capability.cursor, "default");
});

test("empty modules have no substance and filled modules do", () => {
  assert.equal(moduleHasSubstance({ children: [], textContent: "" }), false);
  assert.equal(moduleHasSubstance({ children: [], textContent: "   \n" }), false);
  assert.equal(moduleHasSubstance({
    children: [{ tagName: "SCRIPT" }],
    textContent: "var ignored = true;",
  }), false);
  assert.equal(moduleHasSubstance({
    children: [{ tagName: "SCRIPT" }],
    childNodes: [
      { nodeType: 3, textContent: "  \n" },
      { nodeType: 1, tagName: "SCRIPT", textContent: "var ignored = true;" },
    ],
    textContent: "var ignored = true;",
  }), false);
  assert.equal(moduleHasSubstance({
    children: [],
    childNodes: [{ nodeType: 3, textContent: "仓位建议" }],
    textContent: "仓位建议",
  }), true);
  assert.equal(moduleHasSubstance({
    children: [{ tagName: "P" }],
    textContent: "仓位建议",
  }), true);
  assert.equal(moduleHasSubstance({
    children: [],
    textContent: "只有文字",
  }), true);
});
