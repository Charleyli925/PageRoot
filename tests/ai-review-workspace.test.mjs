import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

import ts from "typescript";

const [
  workbench,
  handoff,
  review,
  reviewDocument,
  reviewState,
  styles,
  headerShell,
  pagePresentation,
  canvasPageView,
  reviewScrollSync,
] = await Promise.all([
  readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/handoff-view.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/AiReviewWorkspace.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/review-document.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/review-state.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/ai-review-workspace.module.css", import.meta.url), "utf8"),
  readFile(new URL("../app/workbench/workbench-header-shell.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/page-presentation-dom.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/html-canvas-page-view.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/review-scroll-sync.js", import.meta.url), "utf8"),
]);

function generatedReviewBootstrap(candidateKeys = [], reviewCommentBindings = []) {
  const sourceFile = ts.createSourceFile(
    "review-document.ts",
    reviewDocument,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const declaration = sourceFile.statements.find((node) => (
    ts.isFunctionDeclaration(node)
    && node.name?.text === "reviewBootstrap"
  ));
  assert.ok(declaration, "reviewBootstrap declaration must exist");
  const transpiled = ts.transpileModule(
    reviewDocument.slice(declaration.getStart(sourceFile), declaration.end),
    {
      compilerOptions: {
        module: ts.ModuleKind.None,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const context = vm.createContext({
    REVIEW_RUNTIME_VISUAL_CANDIDATE_LIMIT: 128,
    REVIEW_RUNTIME_VISUAL_SOURCE_BOX_ATTRIBUTES: [
      "class",
      "height",
      "hidden",
      "style",
      "width",
    ],
  });
  new vm.Script(transpiled).runInContext(context);
  const runtimeVisualBindings = candidateKeys.map((key, index) => ({
    key,
    path: [1, index],
    tagName: "DIV",
    sourceBoxSignature: "[]",
  }));
  return context.reviewBootstrap(
    "review-session",
    "before",
    runtimeVisualBindings,
    reviewCommentBindings,
  );
}

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

test("formal review reuses the workbench header and exposes independent review controls", () => {
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
  assert.match(review, /useReducer\([\s\S]*?reduceReviewState,[\s\S]*?DEFAULT_REVIEW_STATE/);
  assert.match(reviewState, /pageView: "split"/);
  assert.match(reviewState, /changeFilter: "all"/);
  assert.match(reviewState, /contextVisibility: 18/);
  assert.match(reviewState, /navigationTarget: "all"/);
  assert.doesNotMatch(review, /ReviewDisplayMode|DISPLAY_MODE_PROJECTION|DISPLAY_MODE_BY_FILTER/);
  assert.doesNotMatch(review, /aria-label="退出审阅"/);
  assert.doesNotMatch(review, /交互 Demo|重新体验 Demo|模拟 AI 返回/);
  assert.doesNotMatch(review, /setCanvasView|canvasVersionPair|返回并排对比/);
  assert.match(styles, /\.mapHandle[\s\S]*?transform: translate\(var\(--map-panel-width\), -50%\)/);
  assert.match(styles, /\.mapPanel[\s\S]*?left: 42px;[\s\S]*?transform: translateX\(calc\(100% \+ 42px\)\)/);
  assert.match(styles, /\.mapDrawer\[data-open="true"\] \.mapHandle[\s\S]*?transform: translate\(0, -50%\)/);
  assert.doesNotMatch(styles, /\.appHeader|\.canvasVersionPair/);
  assert.match(styles, /\.segmented\[data-items="3"\]/);
  assert.match(styles, /\.pagePreviewControl \.segmented\[data-items="3"\][\s\S]*?width: min\(216px, 100%\)/);
  assert.match(styles, /\.segmented\[data-items="4"\]/);
  assert.match(styles, /\.canvasToolbarHandle[\s\S]*?font-size: 8px/);
  assert.doesNotMatch(styles, /\.reviewRoot button,[\s\S]{0,80}font: inherit/);
  assert.match(styles, /\.reviewRoot button,[\s\S]{0,80}font-family: inherit/);
  assert.match(styles, /\.previewButtonLabel small[\s\S]*?font-style: italic/);
  assert.match(styles, /\.transparencyField > \.toolbarFieldLabel/);
  assert.match(styles, /justify-content: flex-start;[\s\S]*?gap: 1ch/);
  assert.match(review, /<small>\{reviewChanges\.length\} 处变化<\/small>/);
  assert.match(styles, /\.canvasGrid[\s\S]*?gap: 3px;[\s\S]*?padding: 3px/);
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
  assert.match(reviewDocument, /readableReviewTextFootprintPlan/);
  assert.match(reviewDocument, /pairReviewSemanticTextUnits/);
  assert.match(reviewDocument, /"list-item"/);
  assert.match(reviewDocument, /"numbered-line"/);
  assert.match(reviewDocument, /"table-row"/);
  assert.match(reviewDocument, /data-pageroot-review-text-block-groups/);
  assert.match(reviewDocument, /data-pageroot-review-text-group/);
  assert.match(reviewDocument, /data-pageroot-review-text-anchors/);
  assert.match(reviewDocument, /data-pageroot-review-text-context/);
  assert.match(reviewDocument, /data-pageroot-review-text-change/);
  assert.match(reviewDocument, /data-pageroot-review-text/);
  assert.match(reviewDocument, /data-pageroot-review-marker/);
  assert.match(reviewDocument, /attachChangeMarkerMetadata/);
  assert.match(reviewDocument, /data-pageroot-review-structure/);
  assert.match(reviewDocument, /data-pageroot-review-style/);
  assert.match(reviewDocument, /markMovedPairs/);
  assert.match(reviewDocument, /if \(pair\?\.moved[\s\S]*?return "位置调整"/);
  assert.match(reviewDocument, /VISUAL_ATTRIBUTE_NAMES/);
  assert.match(reviewDocument, /pairVisualElements/);
  assert.match(reviewDocument, /elementPairScore/);
  assert.match(reviewDocument, /pairSiblingElements/);
  assert.match(reviewDocument, /similarity >= \.46/);
  assert.match(reviewDocument, /markStructureDifferences/);
  assert.match(reviewDocument, /changedStylesheetSelectors/);
  assert.match(reviewDocument, /styleScopeForProperties/);
  assert.match(reviewDocument, /"block-size"/);
  assert.match(reviewDocument, /data-pageroot-review-style-owner/);
  assert.match(reviewDocument, /data-pageroot-review-style-scope/);
  assert.match(reviewDocument, /contentStyleRects/);
  assert.match(reviewDocument, /range\.getClientRects\(\)/);
  assert.match(reviewDocument, /reviewTextInventoryForNodes/);
  assert.match(reviewDocument, /semanticTextInventories/);
  assert.match(reviewDocument, /STRUCTURE_TRANSPARENT_TAGS/);
  assert.doesNotMatch(reviewDocument, /beforeTokenRanges\.length \?/);
  assert.doesNotMatch(reviewDocument, /afterTokenRanges\.length \?/);
  assert.match(reviewDocument, /const structureChanged = markStructureDifferences\(pair\)/);
  assert.match(reviewDocument, /const styleChanged = markStyleDifferences\(pair\.before, pair\.after\)/);
  assert.match(reviewDocument, /const textChanged = markTextDifferences\(pair\.before, pair\.after\)/);
  assert.doesNotMatch(reviewDocument, /presentationSignature\(before\) !== presentationSignature\(after\)/);
  assert.doesNotMatch(reviewDocument, /const positional = afterElements\[index\]/);
  assert.match(reviewDocument, /annotatePanelPairs/);
  assert.match(reviewDocument, /annotateActionPairs/);
});

test("review controls keep page, filter, visibility, and navigation orthogonal", () => {
  assert.match(review, /const selectReviewMode = useCallback/);
  assert.match(review, /type: "set-change-filter", value: mode/);
  assert.match(review, /const selectPreviewMode = useCallback/);
  assert.match(review, /type: "set-page-view", value: mode/);
  assert.match(review, /const selectOutlineItem = useCallback/);
  assert.match(review, /type: "set-navigation-target", value: item\.id/);
  assert.match(review, /const selectPageOverview = useCallback/);
  assert.match(review, /type: "set-navigation-target", value: "all"/);
  assert.match(review, /const handleSegmentedKeyDown = useCallback/);
  assert.match(review, /event\.key === "ArrowRight" \|\| event\.key === "ArrowDown"/);
  assert.match(review, /buttons\[targetIndex\]\.focus\(\)/);
  assert.match(review, /buttons\[targetIndex\]\.click\(\)/);
  assert.match(review, /type: "set-context-visibility"/);
  assert.doesNotMatch(review, /focus === "all" && documents\.changes\[0\]/);
  assert.match(review, /本轮没有检测到变化，仍可查看双页/);
  assert.match(review, /本轮没有检测到\$\{FILTER_LABELS\[filter\]\}变化/);
  assert.match(reviewDocument, /--pageroot-review-context-opacity/);
  assert.match(reviewDocument, /setProperty\("--pageroot-review-context-opacity", String\(transparency\)\)/);
  assert.match(review, /visible=\{canvasView === "split" \|\| canvasView === "before"\}/);
  assert.match(styles, /\.canvasReview\[data-toolbar-open="true"\] \.canvasGrid[\s\S]*?padding-top: 117px/);
  assert.match(reviewDocument, /element\.dataset\.pagerootReviewId === state\.focus/);
  assert.match(reviewDocument, /element\.dataset\.pagerootOutlineId === state\.focus/);
  assert.match(reviewState, /case "set-page-view"/);
  assert.match(reviewState, /case "set-change-filter"/);
  assert.match(reviewState, /case "set-context-visibility"/);
  assert.match(reviewState, /case "set-navigation-target"/);
  assert.match(reviewState, /case "set-page-presentation"/);
  assert.match(review, /coordinatePagePresentation/);
  assert.match(reviewDocument, /data-pageroot-review-panel-path/);
});

test("comments and formal review share one explicit and indexed Tab registry", () => {
  assert.match(reviewDocument, /from "\.\.\/lib\/page-presentation-dom"/);
  assert.match(canvasPageView, /from "\.\.\/lib\/page-presentation-dom"/);
  assert.match(pagePresentation, /export function pageTabAssociations/);
  assert.match(pagePresentation, /\[role="tab"\]\[aria-controls\]/);
  assert.match(pagePresentation, /"\[data-p\]"/);
  assert.match(pagePresentation, /"\[data-tab\]"/);
  assert.match(pagePresentation, /inferredIndexedTabAssociations/);
  assert.match(pagePresentation, /requireSourceBackedPanels \?\? !options\.detached/);
  assert.match(pagePresentation, /group\.members\.filter\(hasIndexedTabActiveState\)\.length === 1/);
  assert.match(reviewDocument, /const panelPath = panelPathForElement/);
  assert.match(review, /dispatchReviewState\(\{ type: "set-page-presentation"/);
});

test("all-change review keeps text treatment precise and mirrors authored actions", () => {
  assert.match(reviewDocument, /data-pageroot-review-filter="all"\] \[data-pageroot-review-marker-types~="structure"\]/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-filter="all"\] \[data-pageroot-review-id\]/);
  assert.match(reviewDocument, /data-pageroot-review-filter="all"\] \[data-pageroot-review-text="removed"\]/);
  assert.match(reviewDocument, /color: inherit !important;[\s\S]*?text-decoration: none !important/);
  assert.match(reviewDocument, /querySelectorAll\('\[data-pageroot-review-marker-types~="text"\]'\)/);
  assert.match(reviewDocument, /textTone[\s\S]*?"text-removed"[\s\S]*?"text-added"/);
  assert.match(reviewDocument, /"新增内容"/);
  assert.match(reviewDocument, /"删除内容"/);
  assert.match(reviewDocument, /"文本调整"/);
  assert.match(reviewDocument, /"段落改写"/);
  assert.match(reviewDocument, /readableTextRecords/);
  assert.match(reviewDocument, /mergeTextLineIntervals/);
  assert.match(reviewDocument, /scope: "text-block"/);
  assert.match(reviewDocument, /mergeConnectedRecords\(nonTextRecords/);
  assert.match(reviewDocument, /mergeConnectedRecords/);
  assert.match(reviewDocument, /minimalRecords/);
  assert.match(reviewDocument, /dominantStyleBoxes/);
  assert.match(reviewDocument, /candidate\.element\.contains\(record\.element\)/);
  assert.match(reviewDocument, /left\.tone !== "style" \|\| left\.ownerKey === right\.ownerKey/);
  assert.match(reviewDocument, /tone: record\.tones\.length > 1 \? "mixed" : record\.tones\[0\]/);
  assert.match(reviewDocument, /allModeSummary/);
  assert.match(reviewDocument, /fuseConnectedFragments/);
  assert.match(reviewDocument, /unionPath/);
  assert.match(reviewDocument, /data-pageroot-review-overlay-shape/);
  assert.match(reviewDocument, /data-pageroot-review-overlay-shape-svg/);
  assert.match(reviewDocument, /data-pageroot-review-fragment-count/);
  assert.match(reviewDocument, /data-pageroot-review-overlay-label/);
  assert.match(reviewDocument, /data-pageroot-review-mask-layer/);
  assert.match(reviewDocument, /data-pageroot-review-mask-hole/);
  assert.match(reviewDocument, /data-pageroot-review-mask-dim/);
  assert.match(reviewDocument, /fill-opacity/);
  assert.match(reviewDocument, /data-pageroot-review-mask-layer[\s\S]*?background: transparent !important/);
  assert.match(reviewDocument, /data-pageroot-review-mask-layer[\s\S]*?border: 0 !important/);
  assert.match(reviewDocument, /data-pageroot-review-overlay-box[\s\S]*?min-width: 0 !important/);
  assert.match(reviewDocument, /box\.style\.setProperty\("width",[\s\S]*?"important"\)/);
  assert.match(reviewDocument, /data-tone="text-removed"[\s\S]*?#d14b44/);
  assert.match(reviewDocument, /data-tone="text-added"[\s\S]*?#239b56/);
  assert.match(reviewDocument, /data-tone="structure"[\s\S]*?#1677c8/);
  assert.match(reviewDocument, /data-tone="style"[\s\S]*?#6d5ce7/);
  assert.doesNotMatch(reviewDocument, /background: #fff0ef|background: #eaf8f1/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-style\][\s\S]{0,180}solid #1980aa/);
  assert.match(reviewDocument, /matchingPanelControl/);
  assert.match(reviewDocument, /revealTarget/);
  assert.match(reviewDocument, /activatePanelKey/);
  assert.match(reviewDocument, /post\("action", \{/);
  assert.match(review, /type: "activate-panel"/);
  assert.match(review, /type: "mirror-action"/);
  assert.match(reviewDocument, /message\.type === "mirror-action"/);
  assert.match(reviewDocument, /post\("control-state"/);
  assert.match(reviewDocument, /post\("scroll-intent"\)/);
  assert.match(reviewDocument, /post\("scroll-position"/);
  assert.match(reviewDocument, /post\("scroll-geometry"/);
  assert.match(reviewDocument, /message\.type === "scroll-owner"/);
  assert.match(reviewDocument, /message\.type === "set-scroll-position"/);
  assert.match(review, /new ReviewScrollCoordinator/);
  assert.match(review, /const gestureId = coordinator\?\.invalidateGesture\(\) \|\| 0/);
  assert.match(review, /type: "scroll-owner"/);
  assert.match(review, /type: "set-scroll-position"/);
  assert.match(reviewScrollSync, /stableAnchorPairs/);
  assert.match(reviewScrollSync, /viewportHeight \/ 3/);
  assert.match(reviewScrollSync, /this\.cancelPendingFrame\(\)/);
  assert.match(reviewScrollSync, /this\.frameHandle = this\.requestFrame/);
  assert.match(reviewDocument, /renderReviewOverlays/);
  assert.match(reviewDocument, /recordsAreClose/);
  assert.match(reviewDocument, /MutationObserver/);
  assert.match(reviewDocument, /ResizeObserver/);
  assert.match(reviewDocument, /post\("action-applied"/);
  assert.match(reviewDocument, /beginProjectionTransition/);
  assert.match(reviewDocument, /post\("presentation-ready"/);
  assert.match(reviewDocument, /commitProjectionTransition/);
  assert.match(reviewDocument, /if \(projectionTransitioning\) \{[\s\S]*?renderTransitionMask\(\);[\s\S]*?schedulePresentationReady/);
  assert.doesNotMatch(reviewDocument, /animateFollowerScroll|topDelta \* \.28/);
  const scrollHandlerStart = reviewDocument.indexOf('addEventListener("scroll", () =>');
  const scrollHandlerEnd = reviewDocument.indexOf('const handleLayoutChange', scrollHandlerStart);
  const scrollHandler = reviewDocument.slice(scrollHandlerStart, scrollHandlerEnd);
  assert.doesNotMatch(
    scrollHandler,
    /getBoundingClientRect|scheduleOverlayRender|scheduleLayoutReport|requestAnimationFrame/,
  );
  assert.match(scrollHandler, /post\("scroll-position"/);
  assert.doesNotMatch(reviewDocument, /annotateUnchangedSubtrees/);
  const actionMirrorStart = review.indexOf('(message.type === "action" || message.type === "control-state")');
  const actionMirrorEnd = review.indexOf('if (message.type === "panel-change")', actionMirrorStart);
  assert.doesNotMatch(review.slice(actionMirrorStart, actionMirrorEnd), /scrollMode === "linked"/);
  assert.match(review, /document\.addEventListener\("pointerdown", closeOnOutsidePointer, true\)/);
});

test("runtime chart review supplements only the initial bounded static footprint", () => {
  assert.match(reviewDocument, /annotateRuntimeVisualCandidates/);
  assert.match(
    reviewDocument,
    /const runtimeVisualAnnotations: ReviewRuntimeVisualAnnotations = options\.externalBootstrap\s+\? annotateRuntimeVisualCandidates/,
  );
  assert.match(
    reviewDocument,
    /const runtimeVisualCandidates = runtimeVisualAnnotations\.candidates/,
  );
  assert.match(reviewDocument, /reviewBootstrapElementBinding/);
  assert.match(reviewDocument, /runtimeVisualInitialBindings = Object\.freeze/);
  assert.match(reviewDocument, /initialBindingObserver/);
  assert.match(reviewDocument, /bootstrapFallbackJavaScript/);
  assert.match(review, /bootstrapFallbackJavaScript: documents\.bootstrapFallbackJavaScript\.before/);
  assert.match(review, /bootstrapFallbackJavaScript: documents\.bootstrapFallbackJavaScript\.after/);
  assert.match(review, /\[documents, independentTransport, runtimeVisualFrameRun, sourcePath\]/);
  assert.match(review, /frameRun: number;/);
  assert.match(
    review,
    /desktopSessionResult\.frameRun === runtimeVisualFrameRun/,
  );
  assert.match(
    review,
    /const frame = event\.currentTarget;\s+if \(iframeRef\.current !== frame\) return;/,
  );
  assert.match(
    review,
    /if \(message\.type === "ready"\) \{\s+runtimeVisualReadySidesRef\.current\.add\(message\.side\);\s+const frame = framesRef\.current\[message\.side\];\s+if \(frame\) \{\s+prepareReviewCommentFrame\(message\.side, frame\);\s+prepareRuntimeVisualFrame\(message\.side, frame\);/,
  );
  assert.match(reviewDocument, /staticReviewMarkerCoversRuntimeHost/);
  assert.match(reviewDocument, /collectRuntimeVisualSnapshots/);
  assert.match(reviewDocument, /runtimeVisualBatchNodeLimit/);
  assert.match(reviewDocument, /runtimeVisualBatchAtomLimit/);
  assert.match(reviewDocument, /runtimeVisualBatchValueLimit/);
  assert.match(reviewDocument, /runtimeVisualSnapshotBudgetExhausted/);
  assert.match(
    reviewDocument,
    /const runtimeVisualSnapshotBudget = \{\s+atoms: 0,\s+nodes: 0,\s+valueLength: 0,\s+canvasPixels: 0,\s+\}/,
  );
  assert.match(
    reviewDocument,
    /captureRuntimeVisualHost\(\s+host,\s+expectedKey,\s+sourceBoxSignature,\s+runtimeVisualSnapshotBudget,\s+\)/,
  );
  assert.doesNotMatch(
    reviewDocument,
    /captureRuntimeVisualHost\(host, \{\s+atoms: 0,/,
  );
  assert.match(reviewDocument, /runtimeVisualUnavailableSnapshot/);
  assert.match(reviewDocument, /hostIndex % 4 === 0/);
  assert.match(reviewDocument, /runtimeVisualExpectedKeys = Object\.freeze/);
  assert.match(reviewDocument, /const RuntimeVisualString = String;/);
  assert.match(reviewDocument, /const RuntimeVisualPromise = Promise;/);
  assert.match(reviewDocument, /runtimeVisualMathImul = Math\.imul\.bind\(Math\)/);
  assert.match(reviewDocument, /runtimeVisualSetTimeout = window\.setTimeout\.bind\(window\)/);
  assert.match(
    reviewDocument,
    /runtimeVisualRequestAnimationFrame = window\.requestAnimationFrame\.bind\(window\)/,
  );
  assert.match(
    reviewDocument,
    /runtimeVisualPromiseRace = \(values\) => new RuntimeVisualPromise\(\(resolve, reject\) => \{/,
  );
  assert.match(
    reviewDocument,
    /runtimeVisualPromiseResolve = RuntimeVisualPromise\.resolve\.bind\(RuntimeVisualPromise\)/,
  );
  assert.match(reviewDocument, /runtimeVisualStringCharCodeAt/);
  assert.match(reviewDocument, /runtimeVisualStringPadStart/);
  assert.match(reviewDocument, /const runtimeVisualNormalizeText = \(value\) =>/);
  assert.match(
    reviewDocument,
    /const text = runtimeVisualNormalizeText\(\s*runtimeVisualNodeTextContent\(textNode\) \|\| "",\s*\);/,
  );
  assert.match(reviewDocument, /runtimeVisualDocumentQuerySelectorAll/);
  assert.match(reviewDocument, /runtimeVisualGetComputedStyle = getComputedStyle\.bind\(window\)/);
  assert.match(reviewDocument, /const hosts = runtimeVisualExpectedHosts\(\)/);
  assert.match(reviewDocument, /if \(hosts === null\) return null/);
  assert.match(reviewDocument, /if \(runtimeVisualSnapshots !== null\)/);
  assert.match(reviewDocument, /runtimeVisualInitialBindingElement/);
  assert.match(reviewDocument, /runtimeVisualInitialBindingMatches/);
  assert.match(reviewDocument, /drainInitialBindings\(\);/);
  assert.match(reviewDocument, /runtimeVisualKeyForHost\(host\) !== key/);
  assert.match(reviewDocument, /type === "apply-runtime-visual-changes"/);
  assert.match(reviewDocument, /new MessageChannel\(\)/);
  assert.match(reviewDocument, /!event\.isTrusted/);
  assert.match(reviewDocument, /stopImmediateMessagePropagation\(event\)/);
  assert.match(reviewDocument, /type: "runtime-visual-channel"/);
  assert.match(reviewDocument, /type: "runtime-visual-snapshots"/);
  assert.match(reviewDocument, /runtimeVisualSnapshotBatch = runtimeVisualSnapshots/);
  assert.match(reviewDocument, /runtimeVisualSourceBoxSignatures/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-runtime-identity-attribute/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-runtime-source-/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-runtime-host/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-runtime-source-box/);
  assert.match(
    reviewDocument,
    /changedScripts\.some\(\(\{ content \}\) => referencesHost\(content\)\)/,
  );
  assert.match(
    reviewDocument,
    /requiresDeterministicConfirmation: commentPriority > 0 && !runtimeVisualCause/,
  );
  assert.doesNotMatch(reviewDocument, /sectionPair\.(?:before|after)\?\.contains/);
  assert.doesNotMatch(reviewDocument, /hostReferenceScripts/);
  assert.match(reviewDocument, /remainingSignatures/);
  assert.match(reviewDocument, /if \(explicitValues\.length\) return explicitValues/);
  assert.match(reviewDocument, /hostBoxMutated/);
  assert.match(reviewDocument, /hostFullyTransparent/);
  assert.match(reviewDocument, /"host-box\|opacity=0"/);
  assert.match(reviewDocument, /runtimeVisualVisibilityCache = new RuntimeVisualWeakMap/);
  assert.match(
    reviewDocument,
    /while \(runtimeVisualIsInstance\(RuntimeVisualElement, current\)\)[\s\S]*?runtimeVisualStyleValue\(style, "opacity"\)[\s\S]*?current === host/,
  );
  assert.match(
    reviewDocument,
    /if \(isVector\) \{[\s\S]*?runtimeVisualVisible\([\s\S]*?runtimeVisualVisibilityCache/,
  );
  const runtimeChannelTransferStart = reviewDocument.indexOf(
    "const transferRuntimeVisualChannel",
  );
  const runtimeChannelTransferEnd = reviewDocument.indexOf(
    "const clamp",
    runtimeChannelTransferStart,
  );
  assert.match(
    reviewDocument.slice(runtimeChannelTransferStart, runtimeChannelTransferEnd),
    /publishRuntimeVisualSnapshots\(\);[\s\S]*post\("ready"/,
  );
  assert.match(reviewDocument, /\|size=" \+ runtimeVisualRounded\(rect\.width\)/);
  assert.match(reviewDocument, /\|\| hostOwnPaint/);
  assert.match(review, /new ReviewRuntimeVisualCoordinator/);
  assert.match(review, /REVIEW_RUNTIME_VISUAL_DEADLINE_MS/);
  assert.match(review, /onRequestConfirmation: requestRuntimeVisualConfirmation/);
  assert.match(review, /setRuntimeVisualFrameRun\(\(current\) => current \+ 1\)/);
  assert.match(review, /runtimeVisualCoordinatorRef\.current\?\.failConfirmation\(\)/);
  assert.match(
    review,
    /REVIEW_RUNTIME_VISUAL_FRAME_REGISTRATION_MS = 1_500/,
  );
  assert.match(review, /createReviewCapabilityChallenge/);
  assert.match(review, /event\.ports\.length === 1/);
  assert.match(review, /message\.challenge !== expectedChallenge/);
  assert.match(review, /coordinator\.start\(\)/);
  assert.match(review, /useLayoutEffect\(\(\) => \{/);
  assert.match(review, /runtimeVisualOwnerDocumentsRef/);
  assert.match(review, /runtimeVisualFrameDocumentsRef/);
  const runtimeOwnerStart = review.indexOf("useLayoutEffect(() => {");
  const runtimeOwnerEnd = review.indexOf(
    "const finishPagePresentation",
    runtimeOwnerStart,
  );
  assert.match(
    review.slice(runtimeOwnerStart, runtimeOwnerEnd),
    /drainRegisteredFrames\(\);[\s\S]*runtimeVisualCoordinatorRef\.current = coordinator;[\s\S]*drainRegisteredFrames\(\);/,
  );
  assert.match(review, /prepareRuntimeVisualFrame\(side, frame\)/);
  assert.match(
    review,
    /useLayoutEffect\(\(\) => \{\s+const handleMessage =/,
  );
  const runtimeReadyStart = review.indexOf('if (message.type === "ready")');
  const runtimeReadyEnd = review.indexOf(
    'if (message.type === "presentation-ready")',
    runtimeReadyStart,
  );
  assert.doesNotMatch(
    review.slice(runtimeReadyStart, runtimeReadyEnd),
    /runtimeVisualSnapshots|coordinator\.accept/,
  );
  assert.match(review, /confirmationAction \|\| runtimeVisualPending/);
  assert.match(
    review,
    /if \(reviewLoadFailed\)[\s\S]*?settleWithoutRuntime[\s\S]*?REVIEW_RUNTIME_VISUAL_FRAME_REGISTRATION_MS/,
  );
  assert.doesNotMatch(review, /运行态不稳定|分析未完成|概括标记/);
});

test("the generated runtime review bootstrap stays syntactically valid", () => {
  const bootstrap = generatedReviewBootstrap(["runtime-host-1", "runtime-host-2"]);
  assert.doesNotThrow(() => new vm.Script(bootstrap));
  assert.match(
    bootstrap,
    /const runtimeVisualExpectedKeys = Object\.freeze\([\s\S]*?\["runtime-host-1","runtime-host-2"\]/,
  );
  assert.match(bootstrap, /const reviewCommentChannel = side === "before"/);
  assert.match(bootstrap, /type: "review-comment-channel"/);
  assert.match(bootstrap, /const capturePrivateChannelRequest = \(event\) =>/);
  assert.match(
    bootstrap,
    /runtimeVisualAddEventListener\("message", capturePrivateChannelRequest, \{ capture: true \}\)/,
  );
  assert.match(bootstrap, /const runtimeVisualInitialBindings = Object\.freeze/);
  assert.match(bootstrap, /const reviewCommentInitialBindings = Object\.freeze/);
  assert.match(bootstrap, /const initialBindingObserver/);
  assert.match(bootstrap, /const runtimeVisualIdentityElements = new RuntimeVisualMap\(\)/);
  assert.match(bootstrap, /const reviewCommentIdentityElements = new RuntimeVisualMap\(\)/);
  assert.match(bootstrap, /message\.type !== "comment-targets"/);
  assert.doesNotMatch(bootstrap, /data-pageroot-review-runtime-source-/);
  assert.doesNotMatch(bootstrap, /data-pageroot-review-comment-source-/);
  assert.doesNotMatch(bootstrap, /review-comment-1|runtime-comment-caption/);
});

test("formal review projects frozen user comments with private source identities", () => {
  assert.match(workbench, /comments: reviewComments/);
  assert.match(workbench, /documents=\{readyReviewSession\.documents\}/);
  assert.match(reviewDocument, /annotateReviewComments\(\s*beforeDocument/);
  assert.match(reviewDocument, /post\("comment-layout", \{ commentLayouts \}\)/);
  assert.match(reviewDocument, /firstRect\.top \+ scrollY/);
  assert.match(review, /MAX_REVIEW_COMMENT_COORDINATE = 10_000_000/);
  assert.match(review, /Math\.abs\(top\) > MAX_REVIEW_COMMENT_COORDINATE/);
  assert.match(review, /Math\.abs\(viewportTop\) > MAX_REVIEW_COMMENT_COORDINATE/);
  assert.doesNotMatch(review, /Math\.abs\((?:left|top)\) > 100_000/);
  assert.match(review, /reviewCommentContentLayer/);
  assert.match(styles, /--review-comment-scroll-y/);
  assert.match(reviewDocument, /annotateReviewComments\(\s*beforeDocument,/);
  assert.match(reviewDocument, /durableReviewCommentTargetSelector/);
  assert.match(reviewDocument, /:nth-\(\?:child\|of-type\)\\\(/);
  assert.match(reviewDocument, /selector\.startsWith\("#"\)/);
  assert.match(reviewDocument, /sourceNodeId\?: string/);
  assert.match(reviewDocument, /reviewCommentBootstrapBindings/);
  assert.match(
    reviewDocument,
    /clearReviewCommentScopeAttributes\(beforeDocument\);/,
  );
  assert.match(reviewDocument, /reviewCommentInitialBindings = Object\.freeze/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-comment-source-/);
  assert.match(reviewDocument, /commentTargets: reviewCommentTargets/);
  assert.match(reviewDocument, /let reviewCommentTargets = \[\]/);
  assert.match(reviewDocument, /type: "review-comment-channel"/);
  assert.match(reviewDocument, /capturePrivateChannelRequest/);
  assert.match(reviewDocument, /\{ capture: true \}/);
  assert.doesNotMatch(reviewDocument, /\$\{JSON\.stringify\(reviewCommentTargets\)\}/);
  assert.match(reviewDocument, /side === "before"/);
  const commentLayoutStart = reviewDocument.indexOf("const reportReviewCommentLayouts");
  const commentLayoutEnd = reviewDocument.indexOf("const reportScrollGeometry", commentLayoutStart);
  assert.doesNotMatch(
    reviewDocument.slice(commentLayoutStart, commentLayoutEnd),
    /data-pageroot-review-comment-key/,
  );
  assert.match(review, /message\.side !== "before"/);
  assert.match(review, /safeReviewCommentLayouts\(message\.commentLayouts, allowedKeys\)/);
  assert.match(review, /type: "request-review-comment-channel"/);
  assert.match(review, /reviewCommentTargets: documents\.commentTargets/);
  assert.match(review, /commentGroups=\{documents\.commentGroups\}/);
  assert.match(review, /data-testid="review-comment-marker"/);
  assert.match(review, /data-testid="review-comment-bubble"/);
  assert.match(review, />评<\/span>/);
  assert.match(styles, /\.reviewCommentMarker\s*\{[^}]*?width:\s*30px;[^}]*?height:\s*30px;/);
  assert.match(styles, /\.reviewCommentMarker\s*\{[^}]*?border-radius:\s*14px;/);
  assert.match(styles, /\.reviewCommentMarker\s*\{[^}]*?background:\s*#6258d6;/);
  assert.match(styles, /\.reviewCommentMarker\s*\{[^}]*?color:\s*#fff;/);
  assert.match(styles, /\.reviewCommentMarker\s*\{[^}]*?font-size:\s*15px;/);
  assert.match(styles, /\.reviewCommentMarker:hover \.reviewCommentBubble\s*\{/);
  assert.doesNotMatch(reviewDocument, /data-pageroot-review-comment-(?:data|layer|marker|bubble)/);
  assert.doesNotMatch(reviewDocument, /用户评论/);
  assert.doesNotMatch(review, /data-testid="review-comment-marker"[\s\S]{0,400}(?:onClick|tabIndex)/);
  assert.doesNotMatch(styles, /\.reviewCommentMarker:focus/);
});
