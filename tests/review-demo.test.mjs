import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, styles] = await Promise.all([
  readFile(new URL("../app/review-demo/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/review-demo/review-demo.module.css", import.meta.url), "utf8"),
]);

test("the AI review demo covers the complete version-level decision path", () => {
  assert.match(page, /type DemoState = "awaiting-ai" \| "ready" \| "review" \| "accepted" \| "kept"/);
  assert.match(page, /模拟 AI 返回/);
  assert.match(page, /审阅修改/);
  assert.match(page, /直接打开/);
  assert.match(page, /修改后/);
  assert.match(page, /修改前/);
  assert.match(page, /叠加对比/);
  assert.match(page, /接受全部并打开/);
  assert.match(page, /保留当前版本/);
  assert.match(page, /AI 候选 V1\.4 和本轮评论仍会保留/);
});

test("the demo pairs comments with several visible change types", () => {
  assert.match(page, /文案修改/);
  assert.match(page, /数字与样式/);
  assert.match(page, /模块移动/);
  assert.match(page, /整段重写/);
  assert.match(page, /你的评论/);
  assert.match(page, /额外变化/);
  assert.match(page, /第一版先按整份候选做决定/);
});

test("the demo remains isolated from the production AI and persistence bridges", () => {
  assert.doesNotMatch(page, /htmlAIProjects|workspace-bridge|activate-generated-version|fetch\(/);
  assert.match(page, /交互 Demo · 不写入文件/);
  assert.match(styles, /\.demoRoot/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
