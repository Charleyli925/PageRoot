import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadVersionGraph() {
  const typescript = await import("typescript");
  const source = await readFile(
    new URL("../app/workbench/version-graph.ts", import.meta.url),
    "utf8",
  );
  const compiled = typescript.transpileModule(source, {
    compilerOptions: {
      module: typescript.ModuleKind.ESNext,
      target: typescript.ScriptTarget.ES2022,
    },
    fileName: "version-graph.ts",
  });
  return import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputText, "utf8").toString("base64")}`,
  );
}

const { versionEntryTitle } = await loadVersionGraph();

function title(input) {
  return versionEntryTitle({
    isInitial: false,
    comments: [],
    directEditCount: 0,
    ...input,
  });
}

test("the initial version is titled by its import, not by a summary field", () => {
  assert.equal(
    versionEntryTitle({ isInitial: true, comments: [], directEditCount: 0 }),
    "原始导入",
  );
});

test("a version is titled by the user's own first requirement", () => {
  assert.equal(
    title({ comments: [{ label: "主按钮", text: "颜色统一成品牌紫" }] }),
    "主按钮：颜色统一成品牌紫",
  );
});

test("multiple requirements keep the first one and count the rest", () => {
  assert.equal(
    title({
      comments: [
        { label: "价格表", text: "改成两档" },
        { label: "页脚", text: "标题再短一点" },
      ],
    }),
    "价格表：改成两档 等 2 条",
  );
});

test("a requirement spanning lines is condensed to a single line", () => {
  assert.equal(
    title({ comments: [{ label: "首屏", text: "改成\n  左文右图  " }] }),
    "首屏：改成 左文右图",
  );
});

test("an over-long requirement is truncated instead of overflowing the row", () => {
  const long = "改".repeat(120);
  const result = title({ comments: [{ label: "页面", text: long }] });
  assert.ok(result.startsWith("页面：改"));
  assert.ok(result.endsWith("…"));
  assert.ok(result.length < long.length);
});

test("an attachment-only comment falls back to its target label", () => {
  assert.equal(title({ comments: [{ label: "主视觉图", text: "   " }] }), "主视觉图");
});

test("a version with no comments is titled by its local edits", () => {
  assert.equal(title({ directEditCount: 3 }), "本地编辑 · 3 处");
});

test("a version whose requirement is unavailable stays untitled instead of filler", () => {
  // The v4 workspace payload carries no per-version comments, so a filler label
  // would repeat on every row; the row still shows its V-number and time.
  assert.equal(title({}), "");
});

test("a branch head names the version it forked from when nothing else is known", () => {
  assert.equal(title({ branchedFromOrdinal: 16 }), "从 V16 分出");
});

test("the round's frozen requirement titles a version that carries no comments", () => {
  // Current projects keep comments in the request, not on the version, so this
  // is the path that actually names versions in the product.
  assert.equal(
    title({ requirement: "价格表：改成两档" }),
    "价格表：改成两档",
  );
});

test("a frozen requirement outranks both local edits and the branch fallback", () => {
  assert.equal(
    title({
      requirement: "页脚：加上备案号",
      directEditCount: 2,
      branchedFromOrdinal: 4,
    }),
    "页脚：加上备案号",
  );
});

test("a blank frozen requirement falls through instead of titling nothing", () => {
  assert.equal(title({ requirement: "   ", branchedFromOrdinal: 4 }), "从 V4 分出");
});

test("the user's requirement still outranks the branch fallback", () => {
  assert.equal(
    title({
      comments: [{ label: "价格表", text: "改成两档" }],
      requirement: "应当被评论超过",
      branchedFromOrdinal: 16,
    }),
    "价格表：改成两档",
  );
});
