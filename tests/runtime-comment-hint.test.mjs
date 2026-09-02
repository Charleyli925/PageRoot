import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeRuntimeVisualHint,
  runtimeVisualHintKindLabel,
} from "../app/lib/runtime-comment-hint.js";

test("runtime visual hints are bounded, whitespace-normalized and DOM-free", () => {
  const hint = normalizeRuntimeVisualHint({
    runtimeGenerated: true,
    kind: "table",
    label: "  财务\n\t数据表\u0000  ",
    renderedText: `  项目\n2025Q1 ${"x".repeat(500)}  `,
    relativePath: ` table:nth-of-type(1) ${"x".repeat(500)} `,
    relativeBox: { x: -1, y: 0.4, width: 2, height: Number.NaN },
    outerHTML: "<table>不应保存</table>",
    event: { type: "click" },
  });
  assert.deepEqual(hint, {
    runtimeGenerated: true,
    kind: "table",
    label: "财务 数据表",
    renderedText: `项目 2025Q1 ${"x".repeat(500)}`.slice(0, 320),
    relativePath: `table:nth-of-type(1) ${"x".repeat(500)}`.slice(0, 400),
  });
  assert.equal("outerHTML" in hint, false);
  assert.equal("event" in hint, false);
});

test("invalid runtime hint kinds fail closed to a user-facing region label", () => {
  assert.deepEqual(
    normalizeRuntimeVisualHint({
      runtimeGenerated: true,
      kind: "not-a-kind",
      label: "",
      relativeBox: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 },
    }),
    {
      runtimeGenerated: true,
      kind: "runtime-region",
      label: runtimeVisualHintKindLabel("runtime-region"),
      relativeBox: { x: 0.2, y: 0.3, width: 0.4, height: 0.5 },
    },
  );
  assert.equal(normalizeRuntimeVisualHint({ runtimeGenerated: false, kind: "table" }), null);
});
