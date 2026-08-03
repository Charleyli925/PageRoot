import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [workbench, handoff, review, reviewDocument, styles, headerShell] = await Promise.all([
  readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/handoff-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/AiReviewWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/review-document.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/ai-review-workspace.module.css", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/workbench-header-shell.tsx", import.meta.url), "utf8"),
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
  assert.match(loader, /fenceAndFreezeCurrentCanvas\(/);
  assert.doesNotMatch(loader, /activateReadyVersion/);
  assert.match(
    workbench,
    /onAccept=\{\(\) => \{[\s\S]*?void activateReadyResult\(\{[\s\S]*?reviewed: true[\s\S]*?\}\);[\s\S]*?\}\}/,
  );
  assert.doesNotMatch(
    workbench.slice(workbench.indexOf("onAccept={() =>"), workbench.indexOf("onRevealCandidateHtml", workbench.indexOf("onAccept={() =>"))),
    /setReadyReviewSession\(null\)|setDrawer\(|requestAnimationFrame/,
  );
  assert.match(workbench, /const candidateVersionId = activeRun\?\.candidateVersionId/);
  assert.match(workbench, /revealVersionInFinder\(\{ id: candidateVersionId \}\)/);
  assert.match(workbench, /const readyReviewOverlay = readyReviewSession \? \(/);
  assert.match(workbench, /inert=\{readyReviewSession \? true : undefined\}/);
  assert.match(
    workbench,
    /await openCommittedVersion\(run, mergedPayload\)[\s\S]*?setDrawer\(null\)[\s\S]*?requestAnimationFrame[\s\S]*?requestAnimationFrame[\s\S]*?setReadyReviewSession\(null\)/,
  );
  assert.match(
    workbench,
    /removeRun\(run, \{ clearActive: false \}\);[\s\S]*?clearActiveHandoff\(\)/,
  );
  assert.match(styles, /\.reviewRoot \{[\s\S]*?position: fixed;[\s\S]*?inset: 0;/);
});

test("formal review reuses the workbench header and exposes the frozen seven-mode hierarchy", () => {
  assert.match(review, /审阅模式/);
  assert.match(review, /页面预览/);
  assert.match(review, /变化审阅/);
  assert.match(review, /双页/);
  assert.match(review, /左页/);
  assert.match(review, /右页/);
  assert.match(review, /全部变化/);
  assert.match(review, /返回 AI 修改前/);
  assert.match(review, /打开 AI 修改后/);
  assert.match(review, /上下文可见度/);
  assert.match(review, /同步滚动/);
  assert.match(review, /独立滚动/);
  assert.match(review, /画布缩放/);
  assert.match(review, /内容地图/);
  assert.match(review, /data-testid="review-outline-item"/);
  assert.match(review, /data-view=\{canvasView\}/);
  assert.match(review, /WorkbenchHeaderShell/);
  assert.match(workbench, /WorkbenchHeaderShell/);
  assert.match(headerShell, /className=\{joinClassNames\("workbench-header", className\)\}/);
  assert.match(review, /const DEFAULT_CONTEXT_VISIBILITY = 18/);
  assert.match(review, /const \[displayMode, setDisplayMode\] = useState<ReviewDisplayMode>\("diff-all"\)/);
  assert.match(review, /setFocus\(documents\.changes\[0\]\?\.id \|\| "all"\)/);
  assert.match(review, /"diff-style": \{ canvasView: "split", filter: "style"/);
  assert.doesNotMatch(review, /aria-label="退出审阅"/);
  assert.doesNotMatch(review, /交互 Demo|重新体验 Demo|模拟 AI 返回/);
  assert.doesNotMatch(review, /setCanvasView|canvasVersionPair|返回并排对比/);
  assert.match(styles, /\.mapHandle[\s\S]*?transform: translate\(var\(--map-panel-width\), -50%\)/);
  assert.match(styles, /\.mapPanel[\s\S]*?left: 42px;[\s\S]*?transform: translateX\(calc\(100% \+ 42px\)\)/);
  assert.match(styles, /\.mapDrawer\[data-open="true"\] \.mapHandle[\s\S]*?transform: translate\(0, -50%\)/);
  assert.doesNotMatch(styles, /\.appHeader|\.canvasVersionPair/);
  assert.match(styles, /\.segmented\[data-items="3"\]/);
  assert.match(styles, /\.segmented\[data-items="4"\]/);
  assert.match(styles, /\.canvasToolbarHandle[\s\S]*?font-size: 8px/);
  assert.doesNotMatch(styles, /\.reviewRoot button,[\s\S]{0,80}font: inherit/);
  assert.match(styles, /\.reviewRoot button,[\s\S]{0,80}font-family: inherit/);
  assert.match(styles, /\.previewButtonLabel small[\s\S]*?font-style: italic/);
  assert.match(styles, /\.transparencyField > \.toolbarFieldLabel/);
  assert.match(review, /<small>\{documents\.changes\.length\} 处变化<\/small>/);
  assert.match(styles, /\.mapDrawer[\s\S]*?right: 0;[\s\S]*?bottom: 10px/);
});

test("returning before the AI edit explains the reversible path before leaving review", () => {
  assert.match(review, /不会采用这次 AI 返回的/);
  assert.match(review, /将继续使用[\s\S]*?AI 修改前[\s\S]*?为基线重新修改/);
  assert.match(review, /AI 返回的 HTML 已自动保留，点击在 Finder 中显示/);
  assert.match(review, /onRevealCandidateHtml/);
  assert.match(review, /返回修改前版本/);
  assert.match(review, /确认并打开/);
  assert.match(review, /确认后将切换到 AI 修改后的/);
  assert.match(review, /可在历史记录中查看/);
  assert.match(review, /继续审阅/);
  assert.match(review, /continueReviewButtonRef\.current\?\.focus\(\)/);
  assert.match(review, /event\.key === "Escape"/);
  assert.match(review, /event\.key !== "Tab"/);
  assert.match(workbench, /declined-ai-candidate-after-review/);
  assert.match(workbench, /当前页面可直接继续编辑/);
  assert.match(workbench, /onRevealCandidateHtml=\{\(\) => \{/);
});

test("the review canvas preserves authored interactions inside untrusted-document isolation", () => {
  assert.match(review, /sandbox="allow-scripts"/);
  assert.doesNotMatch(review, /allow-same-origin/);
  assert.doesNotMatch(review, /allow-forms|allow-modals|allow-popups|allow-downloads/);
  assert.match(reviewDocument, /directive === "refresh"/);
  assert.match(reviewDocument, /directive === "content-security-policy"/);
  assert.doesNotMatch(reviewDocument, /querySelectorAll\(['"]script,/);
  assert.doesNotMatch(reviewDocument, /\/\^on\/i\.test\(attribute\.name\)/);
  assert.match(reviewDocument, /element\.setAttribute\("sandbox", ""\)/);
  assert.match(reviewDocument, /event\.target\.closest\("a\[href\], area\[href\]"\)/);
  assert.match(reviewDocument, /addEventListener\("submit", \(event\) => event\.preventDefault\(\)/);
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

test("change discovery builds a complete outline and precise change markers", () => {
  assert.match(reviewDocument, /isPanelContainer\(child\) \|\| isGenericContentContainer\(child\)/);
  assert.match(reviewDocument, /data-pageroot-outline-id/);
  assert.match(reviewDocument, /regionGroupLabel/);
  assert.match(reviewDocument, /outline\.push/);
  assert.match(reviewDocument, /markTextDifferences/);
  assert.match(reviewDocument, /sentenceAwareTextDifferences/);
  assert.match(reviewDocument, /data-pageroot-review-text-group/);
  assert.match(reviewDocument, /data-pageroot-review-text/);
  assert.match(reviewDocument, /data-pageroot-review-marker/);
  assert.match(reviewDocument, /attachChangeMarkerMetadata/);
  assert.match(reviewDocument, /data-pageroot-review-structure/);
  assert.match(reviewDocument, /data-pageroot-review-style/);
  assert.match(reviewDocument, /markMovedPairs/);
  assert.match(reviewDocument, /if \(pair\?\.moved[\s\S]*?return "结构变化"/);
  assert.match(reviewDocument, /matchingStylesheetSignature/);
  assert.match(reviewDocument, /VISUAL_ATTRIBUTE_NAMES/);
  assert.match(reviewDocument, /pairVisualElements/);
  assert.match(reviewDocument, /presentationSignature\(before\) !== presentationSignature\(after\)/);
  assert.match(reviewDocument, /markStructureDifferences/);
  assert.match(reviewDocument, /changedStylesheetSelectors/);
  assert.match(reviewDocument, /STYLE_PROPERTY_LABELS/);
  assert.match(reviewDocument, /return `\$\{\[\.\.\.new Set\(labels\)\]\.join\("、"\)\}变化`/);
  assert.match(reviewDocument, /hasDirectReviewText/);
  assert.match(reviewDocument, /data-pageroot-review-text-context/);
  assert.match(reviewDocument, /annotateUnchangedSubtrees/);
  assert.match(reviewDocument, /annotateActionKeys/);
});

test("review controls produce persistent visual state instead of label-only changes", () => {
  assert.match(review, /const selectReviewMode = useCallback/);
  assert.match(review, /documents\.changes\.filter\(\(change\) => change\.types\.includes\(mode\)\)/);
  assert.match(review, /selectChange\(target\.id, mode\)/);
  assert.match(review, /const selectPreviewMode = useCallback/);
  assert.match(review, /setDisplayMode\("preview-split"\)/);
  assert.match(review, /setDisplayMode\(DISPLAY_MODE_BY_FILTER\[resolvedFilter\]\)/);
  assert.match(review, /const handleSegmentedKeyDown = useCallback/);
  assert.match(review, /event\.key === "ArrowRight" \|\| event\.key === "ArrowDown"/);
  assert.match(review, /buttons\[targetIndex\]\.focus\(\)/);
  assert.match(review, /buttons\[targetIndex\]\.click\(\)/);
  assert.match(review, /focus === "all" && documents\.changes\[0\]/);
  assert.match(review, /本轮没有检测到变化，仍可查看双页/);
  assert.match(review, /本轮没有检测到\$\{FILTER_LABELS\[filter\]\}变化/);
  assert.match(reviewDocument, /--pageroot-review-context-opacity/);
  assert.match(reviewDocument, /setProperty\("--pageroot-review-context-opacity", String\(transparency\)\)/);
  assert.match(review, /visible=\{canvasView === "split" \|\| canvasView === "before"\}/);
  assert.match(styles, /\.canvasReview\[data-toolbar-open="true"\] \.canvasGrid[\s\S]*?padding-top: 118px/);
  assert.match(reviewDocument, /element\.dataset\.pagerootReviewId === state\.focus/);
  assert.match(reviewDocument, /element\.dataset\.pagerootOutlineId === state\.focus/);
});

test("all-change review keeps text treatment precise and mirrors authored actions", () => {
  assert.match(reviewDocument, /data-pageroot-review-filter="all"\] \[data-pageroot-review-marker-types~="structure"\]/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-filter="all"\] \[data-pageroot-review-id\]/);
  assert.match(reviewDocument, /data-pageroot-review-filter="all"\] \[data-pageroot-review-text="removed"\]/);
  assert.match(reviewDocument, /color: inherit !important;[\s\S]*?text-decoration: none !important/);
  assert.match(reviewDocument, /side === "after"[\s\S]*?getClientRects\(\)/);
  assert.match(reviewDocument, /previous\.tone === record\.tone/);
  assert.doesNotMatch(reviewDocument, /background: #fff0ef|background: #eaf8f1/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-style\][\s\S]{0,180}solid #1980aa/);
  assert.match(reviewDocument, /matchingPanelControl/);
  assert.match(reviewDocument, /revealTarget/);
  assert.match(reviewDocument, /activatePanelKey/);
  assert.match(reviewDocument, /post\("action", \{ actionKey \}\)/);
  assert.match(review, /type: "activate-panel"/);
  assert.match(review, /type: "mirror-action"/);
  assert.match(reviewDocument, /message\.type === "mirror-action"/);
  assert.match(reviewDocument, /post\("control-state"/);
  assert.match(reviewDocument, /reviewAnchor/);
  assert.match(reviewDocument, /message\.type === "sync-scroll"/);
  assert.match(review, /type: "sync-scroll"/);
  assert.match(reviewDocument, /message\.boundary === "top"/);
  assert.match(reviewDocument, /programmaticScrollToken/);
  assert.match(reviewDocument, /renderReviewOverlays/);
  assert.match(reviewDocument, /record\.top <= previous\.bottom \+ 12/);
  assert.match(review, /document\.addEventListener\("pointerdown", closeOnOutsidePointer, true\)/);
});
