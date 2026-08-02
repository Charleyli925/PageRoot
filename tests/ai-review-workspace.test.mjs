import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workbench, handoff, review, reviewDocument, styles] = await Promise.all([
  readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/handoff-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/AiReviewWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/review-document.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/ai-review-workspace.module.css", import.meta.url), "utf8"),
]);

test("a ready AI result is review-first with exactly one direct-open alternative", () => {
  const readyStart = handoff.indexOf('activeRun.status === "ready-to-open"');
  const readyEnd = handoff.indexOf(": pendingRunOutcome", readyStart);
  const readyFooter = handoff.slice(readyStart, readyEnd);
  assert.match(readyFooter, /className="primary-action"[\s\S]*?审阅对比/);
  assert.match(readyFooter, /className="secondary-action"[\s\S]*?直接打开/);
  assert.doesNotMatch(readyFooter, /稍后处理|打开最新版/);
  assert.ok(readyFooter.indexOf("审阅对比") < readyFooter.indexOf("直接打开"));
});

test("formal review loads and verifies the immutable candidate without activating it", () => {
  const reviewStart = workbench.indexOf("const reviewReadyResult = useCallback");
  const reviewEnd = workbench.indexOf("const processRunStatus", reviewStart);
  const loader = workbench.slice(reviewStart, reviewEnd);
  assert.match(loader, /bridgeClient\.versionFile\(/);
  assert.match(loader, /await browserSha256\(candidateHtml\) !== candidateHash/);
  assert.match(loader, /await browserSha256\(frozenHtml\) !== run\.baseSnapshotSha256/);
  assert.doesNotMatch(loader, /activateReadyVersion/);
  assert.match(
    workbench,
    /onAccept=\{\(\) => \{[\s\S]*?setReadyReviewSession\(null\)[\s\S]*?requestAnimationFrame\(\(\) => void activateReadyResult\(\)\)/,
  );
});

test("formal review keeps the selected demo hierarchy without demo chrome", () => {
  assert.match(review, /审阅模式/);
  assert.match(review, /双页对比/);
  assert.match(review, /保留当前版本/);
  assert.match(review, /接受全部并打开/);
  assert.match(review, /上下文可见度/);
  assert.match(review, /审阅显示方式/);
  assert.match(review, /同步滚动/);
  assert.match(review, /独立滚动/);
  assert.match(review, /画布缩放/);
  assert.match(review, /内容地图/);
  assert.doesNotMatch(review, /交互 Demo|重新体验 Demo|模拟 AI 返回/);
  assert.match(styles, /translateY\(calc\(-100% \+ 24px\)\)/);
});

test("keeping the current version explains the reversible path before leaving review", () => {
  assert.match(review, /确认后会返回本轮处理页面/);
  assert.match(review, /可以随时再次回到这个审阅页面/);
  assert.match(review, /继续审阅/);
  assert.match(review, /continueReviewButtonRef\.current\?\.focus\(\)/);
  assert.match(review, /event\.key === "Escape"/);
  assert.match(workbench, /仍保留在本轮处理里，可以随时再次进入审阅对比/);
});

test("the review canvas preserves untrusted-document isolation", () => {
  assert.match(review, /sandbox="allow-scripts"/);
  assert.doesNotMatch(review, /allow-same-origin/);
  assert.doesNotMatch(review, /allow-forms|allow-modals|allow-popups|allow-downloads/);
  assert.match(reviewDocument, /script, meta\[http-equiv=/);
  assert.match(reviewDocument, /\/\^on\/i\.test\(attribute\.name\)/);
  assert.match(reviewDocument, /element\.setAttribute\("sandbox", ""\)/);
  assert.match(reviewDocument, /source: "pageroot-ai-review"/);
  assert.match(review, /event\.source !== framesRef\.current/);
});

test("desktop review serves its bootstrap outside the renderer CSP and keeps registrations stable", () => {
  assert.match(reviewDocument, /bootstrap\.src = REVIEW_BOOTSTRAP_PATH/);
  assert.match(review, /window\.htmlAIPreview/);
  assert.match(review, /previewApi\.createSession/);
  assert.match(review, /previewApi\.revokeSession/);
  assert.match(review, /const reviewStateRef = useRef/);
  assert.match(review, /const sendState = useCallback[\s\S]*?\}, \[sessionId\]\)/);
});

test("change discovery covers surrounding regions and descendant presentation attributes", () => {
  assert.match(reviewDocument, /bodyChildren\.forEach\(collectCoveredRegions\)/);
  assert.match(reviewDocument, /\[element, \.\.\.element\.querySelectorAll\("\*"\)\]/);
  assert.match(reviewDocument, /!structureChanged[\s\S]*?presentationSignature/);
});
