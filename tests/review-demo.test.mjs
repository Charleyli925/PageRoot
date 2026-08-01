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
  assert.match(page, /overlay: "对照"/);
  assert.match(page, /接受全部并打开/);
  assert.match(page, /保留当前版本/);
  assert.match(page, /AI 候选 V1\.4 和本轮评论仍会保留/);
});

test("the demo pairs comments with several visible change types", () => {
  assert.match(page, /文案修改/);
  assert.match(page, /数字与样式/);
  assert.match(page, /模块移动/);
  assert.match(page, /整段重写/);
  assert.match(page, /你的要求/);
  assert.match(page, /评论范围外/);
  assert.match(page, /第一版先按整份候选做决定/);
});

test("the content map uses headings and visible copy from the complex HTML fixture", () => {
  assert.match(page, /页面内容地图/);
  assert.match(page, /按页面里的标题整理/);
  assert.match(page, /不显示代码名称/);
  assert.match(page, /为复杂页面而生 \/ 数字实验场/);
  assert.match(page, /从宏观指标到微观事件，保持同一条数据叙事/);
  assert.match(page, /一份包含多层语义结构的长篇阅读样本/);
  assert.match(page, /可筛选、可扩展的项目目录/);
  assert.match(page, /包含完整表格语义的运营后台/);
  assert.match(page, /画廊、嵌入内容与可编程画布/);
  assert.match(page, /10 个名称直接来自页面标题/);
  assert.match(page, /根据页面里的导航文字整理/);
});

test("adaptive comparison covers complex changes with user-facing comparison methods", () => {
  assert.match(page, /完整前后/);
  assert.match(page, /并排布局/);
  assert.match(page, /顺序追踪/);
  assert.match(page, /逐项清单/);
  assert.match(page, /表格差异/);
  assert.match(page, /表单与反馈/);
  assert.match(page, /操作结果/);
  assert.match(page, /移动不会显示成删除再新增/);
  assert.match(page, /这部分具体改了什么/);
  assert.match(page, /评论范围外/);
});

test("the demo remains isolated from the production AI and persistence bridges", () => {
  assert.doesNotMatch(page, /htmlAIProjects|workspace-bridge|activate-generated-version|fetch\(/);
  assert.match(page, /交互 Demo · 不写入文件/);
  assert.match(styles, /\.demoRoot/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
