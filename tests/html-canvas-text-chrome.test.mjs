import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeCanvasTextChromeRects,
} from "../app/components/html-canvas-text-chrome.js";

test("text chrome joins adjacent inline fragments on one visual line", () => {
  assert.deepEqual(normalizeCanvasTextChromeRects([
    { left: 40, top: 20, width: 72, height: 24 },
    { left: 116, top: 20, width: 68, height: 24 },
  ]), [
    { left: 36, top: 18, width: 152, height: 28 },
  ]);
});

test("text chrome keeps wrapped lines and distant inline islands compact", () => {
  assert.deepEqual(normalizeCanvasTextChromeRects([
    { left: 40, top: 20, width: 96, height: 24 },
    { left: 360, top: 20, width: 72, height: 24 },
    { left: 40, top: 58, width: 128, height: 24 },
  ]), [
    { left: 36, top: 18, width: 104, height: 28 },
    { left: 356, top: 18, width: 80, height: 28 },
    { left: 36, top: 56, width: 136, height: 28 },
  ]);
});

test("text chrome ignores empty or invalid geometry", () => {
  assert.deepEqual(normalizeCanvasTextChromeRects([
    { left: 20, top: 20, width: 0, height: 24 },
    { left: Number.NaN, top: 20, width: 20, height: 24 },
    null,
  ]), []);
});
