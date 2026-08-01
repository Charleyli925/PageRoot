import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [page, styles, generator, gitignore] = await Promise.all([
  readFile(new URL("../app/review-demo/page.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/review-demo/review-demo.module.css", import.meta.url), "utf8"),
  readFile(new URL("../scripts/generate-review-demo-fixtures.mjs", import.meta.url), "utf8"),
  readFile(new URL("../.gitignore", import.meta.url), "utf8"),
]);

test("the AI review demo covers the complete version-level decision path", () => {
  assert.match(page, /type DemoState = "awaiting-ai" \| "ready" \| "review" \| "accepted" \| "kept"/);
  assert.match(page, /模拟 AI 返回/);
  assert.match(page, /审阅修改/);
  assert.match(page, /直接打开/);
  assert.match(page, /修改后/);
  assert.match(page, /修改前/);
  assert.match(page, /type ReviewSide = "before" \| "after"/);
  assert.match(page, /接受全部并打开/);
  assert.match(page, /保留当前版本/);
  assert.match(page, /AI 候选 V1\.4 和本轮评论仍会保留/);
});

test("the demo keeps realistic complex changes available to the canvas review", () => {
  assert.match(page, /整段重做/);
  assert.match(page, /布局和数字/);
  assert.match(page, /章节调整/);
  assert.match(page, /卡片增删与排序/);
  assert.match(page, /表格变化/);
  assert.match(page, /字段与反馈/);
  assert.match(page, /布局与交互/);
  assert.match(page, /AI 同时调整了 Image Map 的热区/);
  assert.match(page, /REVIEW_DIFF_TARGETS/);
  assert.match(page, /pageroot-diff-structure/);
});

test("the content map uses headings and visible copy from the complex HTML fixture", () => {
  assert.match(page, /页面内容地图/);
  assert.match(page, /按页面里的内容整理/);
  assert.match(page, /两边会同时定位并压暗无关内容/);
  assert.match(page, /为复杂页面而生 \/ 数字实验场/);
  assert.match(page, /从宏观指标到微观事件，保持同一条数据叙事/);
  assert.match(page, /一份包含多层语义结构的长篇阅读样本/);
  assert.match(page, /可筛选、可扩展的项目目录/);
  assert.match(page, /包含完整表格语义的运营后台/);
  assert.match(page, /画廊、嵌入内容与可编程画布/);
  assert.match(page, /根据页面里的导航文字整理/);
  assert.match(page, /mapPinned/);
  assert.match(page, /onMouseEnter=\{\(\) => setMapPeeked\(true\)\}/);
  assert.match(styles, /\.canvasMapDrawer\[data-open="true"\]/);
});

test("canvas review exposes orthogonal focus, difference, scroll, and zoom controls", () => {
  assert.match(page, /const \[focused, setFocused\] = useState\(false\)/);
  assert.match(page, /全部变化/);
  assert.match(page, /文字与数据/);
  assert.match(page, /结构与顺序/);
  assert.match(page, /视觉样式/);
  assert.match(page, /同步滚动/);
  assert.match(page, /独立滚动/);
  assert.match(page, /Option 临时单独滚动/);
  assert.match(page, /查看整页/);
  assert.match(page, /适应/);
  assert.match(page, /100%/);
  assert.match(page, /getSemanticScrollPosition/);
  assert.match(page, /SEMANTIC_SCROLL_ANCHORS/);
  assert.match(page, /aria-hidden=\{!mapOpen\}/);
  assert.match(page, /inert=\{!mapOpen \? true : undefined\}/);
});

test("the review surface renders the two complete local HTML documents", () => {
  assert.match(page, /\/review-demo-local\/before\.html/);
  assert.match(page, /\/review-demo-local\/after\.html/);
  assert.match(page, /固定桌面画布/);
  assert.match(page, /targetViewportWidth = 1180/);
  assert.match(page, /复杂 HTML 完整页面/);
  assert.match(page, /side="before" zoom=\{zoom\}/);
  assert.match(page, /side="after" zoom=\{zoom\}/);
  assert.match(page, /全页打开/);
  assert.match(page, /sandbox="allow-scripts allow-forms allow-modals allow-popups allow-same-origin"/);
  assert.match(page, /anchor: "top"/);
  assert.match(page, /anchor: "form-lab"/);
  assert.match(styles, /\.canvasGrid/);
  assert.match(styles, /\.canvasDocumentScale iframe/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) minmax\(0, 1fr\)/);
});

test("the local fixture generator creates a full candidate without committing user HTML", () => {
  assert.match(generator, /export function createCandidate/);
  assert.match(generator, /validateDocuments/);
  assert.match(generator, /sourceSha256/);
  assert.match(generator, /changedAreas: \["top", "dashboard", "story", "catalog", "operations", "form-lab", "media"\]/);
  assert.match(generator, /跨端内容审阅器/);
  assert.match(generator, /高预算审批说明/);
  assert.match(generator, /selectedSignalRatio/);
  assert.doesNotMatch(generator, /\/Users\/lizexuan|复杂HTML综合测试页\.html/);
  assert.match(gitignore, /\/public\/review-demo-local\//);
});

test("the demo remains isolated from the production AI and persistence bridges", () => {
  assert.doesNotMatch(page, /htmlAIProjects|workspace-bridge|activate-generated-version|fetch\(/);
  assert.match(page, /交互 Demo · 不写入文件/);
  assert.match(styles, /\.demoRoot/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
