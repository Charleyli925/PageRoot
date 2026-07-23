import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  workbench,
  styles,
  mainProcess,
  preload,
  canvas,
  sampleHtml,
  interactionPreview,
  interactionPreviewStyles,
] = await Promise.all([
  readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/lib/sample-html.ts", import.meta.url), "utf8"),
  readFile(new URL("../app/components/HtmlInteractionPreview.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/HtmlInteractionPreview.module.css", import.meta.url), "utf8"),
]);

test("unbound startup opens the PageRoot introduction instead of a business sample", () => {
  assert.match(workbench, /const WELCOME_PROJECT/);
  assert.match(workbench, /name: "欢迎来到源页\.html"/);
  assert.match(workbench, /内置介绍页 · 打开本地 HTML 后开始编辑/);
  assert.doesNotMatch(workbench, /市场策略周报\.html|示例预览 · 打开本地 HTML 后自动更新/);
  assert.match(sampleHtml, /<title>源页 · PageRoot<\/title>/);
  assert.match(
    sampleHtml,
    /<h1><span>所见，即可落笔。<\/span><span>所改，止于所选。<\/span><\/h1>/,
  );
  assert.match(sampleHtml, /顺畅的文本编辑/);
  assert.match(sampleHtml, /指哪改哪的局部修改/);
  assert.match(sampleHtml, /轻松完整的评论体验/);
  assert.match(sampleHtml, /完整的安全校验/);
  assert.match(sampleHtml, /真实 HTML 是唯一事实源/);
  assert.match(sampleHtml, /发送、校验，再打开最新版/);
  assert.match(sampleHtml, /从顶部「项目」打开 HTML/);
  assert.doesNotMatch(sampleHtml, /利率拐点前的仓位选择|美国 10 年期|市场策略周报/);
});

test("the right-side project panel keeps file actions concise and safe", () => {
  assert.match(workbench, /brand-logo\.png/);
  assert.match(workbench, /className="drawer-header project-panel-header"/);
  assert.match(workbench, /className="project-tabs"/);
  assert.match(workbench, />当前项目</);
  assert.match(workbench, />版本历史</);
  assert.match(workbench, />打开本地 HTML</);
  assert.match(workbench, />最近打开</);
  assert.match(workbench, /导出 HTML 副本/);
  assert.match(workbench, /className="current-project-card"/);
  assert.doesNotMatch(workbench, />新建 HTML</);
  assert.doesNotMatch(workbench, /api\.newHtml/);
  assert.doesNotMatch(workbench, /className="project-switcher"|className="project-menu"/);
  assert.match(workbench, /api\.showInFolder\(activeSourcePath\)/);
  assert.match(workbench, /formatProjectTimestamp\(project\.lastOpenedAt\)/);
  assert.doesNotMatch(workbench, /formatRecentProjectTimestamp/);
  assert.match(styles, /\.side-drawer\s*\{[\s\S]*?width:\s*min\(410px, calc\(100vw - 24px\)\)/);
  assert.match(styles, /\.project-tabs\s*\{[\s\S]*?grid-template-columns:\s*1fr 1fr/);
  assert.match(styles, /\.current-project-card\s*\{[\s\S]*?grid-template-columns:\s*42px minmax\(0, 1fr\) auto/);
  assert.match(workbench, /onInteraction=\{\(\) => setProjectMenuOpen\(false\)\}/);
  assert.match(workbench, /document\.addEventListener\("pointerdown", onPointerDown, true\)/);

  for (const source of [mainProcess, preload]) {
    assert.match(source, /html-projects:show-in-folder/);
    assert.match(source, /html-projects:activate-generated-version/);
    assert.match(source, /html-projects:reveal-version-file/);
    assert.doesNotMatch(source, /html-projects:new|newHtml/);
  }
  assert.match(mainProcess, /assertKnownProjectPath\(sourcePath\)/);
  assert.match(mainProcess, /inspectHtmlFile\(sourcePath\)/);
  assert.match(mainProcess, /shell\.showItemInFolder\(sourcePath\)/);
  assert.match(mainProcess, /shell\.showItemInFolder\(resolvedVersionPath\)/);
  assert.match(
    mainProcess,
    /sourceEndpoint\.searchParams\.set\("sourcePath", previousSourcePath\)/,
  );
  assert.match(
    mainProcess,
    /authoritativeSource\.currentExactVersionId !== payload\.versionId/,
  );
  assert.match(
    mainProcess,
    /authoritativeSource\.sourcePath[\s\S]*?path\.resolve\(nextSourcePath\)/,
  );
  assert.match(
    mainProcess,
    /const activatesCurrentProject =[\s\S]*?state\.activePath === previousSourcePath[\s\S]*?if \(activatesCurrentProject\) \{[\s\S]*?state\.activePath = resolvedNextPath/,
  );
  assert.match(
    mainProcess,
    /typeof entry\.name === "string" && entry\.name\.trim\(\)[\s\S]*?: path\.basename\(entry\.path\)/,
  );
  assert.match(
    mainProcess,
    /name:\s*replacedEntry\?\.name[\s\S]*?\|\| path\.basename\(previousSourcePath\)/,
  );
});

test("canvas chrome stays compact and keeps project actions visually clear", () => {
  const unifiedSurfaceStyles = styles.slice(styles.indexOf("PageRoot V5.1"));
  assert.doesNotMatch(workbench, /className="canvas-guide"/);
  assert.doesNotMatch(workbench, /修改会自动写回源文件|单击选择，双击文字修改/);
  assert.doesNotMatch(workbench, /className="canvas-edit-status"/);
  assert.match(workbench, /height=\{`\$\{canvasDocumentHeight\}px`\}/);
  assert.match(workbench, /ref=\{reviewStageRef\} className="review-scroll-stage"/);
  assert.match(
    styles,
    /\.header-actions button,[\s\S]*?font-weight:\s*680/,
  );
  assert.match(
    unifiedSurfaceStyles,
    /\.workbench\s*\{[\s\S]*?grid-template-rows:\s*76px minmax\(0, 1fr\)/,
  );
  assert.match(
    unifiedSurfaceStyles,
    /\.workbench-header\s*\{[\s\S]*?padding:\s*30px 16px 8px 22px/,
  );
  assert.match(
    unifiedSurfaceStyles,
    /\.review-scroll-stage\s*\{[\s\S]*?overflow-y:\s*auto[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) 376px/,
  );
});

test("editing and interactive preview are separate canvas modes", () => {
  assert.match(workbench, /type CanvasMode = "edit" \| "preview"/);
  assert.match(workbench, /data-canvas-mode=\{canvasMode\}/);
  assert.match(workbench, /className="canvas-mode-switch"[\s\S]*?编辑[\s\S]*?预览/);
  assert.match(
    workbench,
    /aria-pressed=\{canvasMode === "preview"\}[\s\S]*?disabled=\{interactionLocked\}/,
  );
  const previewModeStart = workbench.indexOf('aria-pressed={canvasMode === "preview"}');
  const previewModeEnd = workbench.indexOf("</button>", previewModeStart);
  const previewModeControl = workbench.slice(
    previewModeStart,
    previewModeEnd,
  );
  const previewFence = previewModeControl.indexOf("editorRef.current?.fencePendingEdit({");
  const previewFenceGuard = previewModeControl.indexOf("if (!committed || !committed.ok)", previewFence);
  const previewClear = previewModeControl.indexOf("editorRef.current?.clearSelection();", previewFenceGuard);
  const enterPreview = previewModeControl.indexOf('setCanvasMode("preview");', previewClear);
  assert.match(previewModeControl, /resumeEditing: false,[\s\S]*?trigger: "manual"/);
  assert.ok(
    previewFence >= 0
      && previewFenceGuard > previewFence
      && previewClear > previewFenceGuard
      && enterPreview > previewClear,
    "preview entry must pass a fail-closed History Fence before changing modes",
  );
  assert.match(
    workbench,
    /className="canvas-edit-surface"[\s\S]*?hidden=\{canvasMode !== "edit"\}[\s\S]*?<HtmlCanvasEditor/,
  );
  assert.match(workbench, /\{canvasMode === "preview" \? \([\s\S]*?<HtmlInteractionPreview/);
  assert.ok(
    workbench.indexOf('className="canvas-edit-surface"')
      < workbench.indexOf('{canvasMode === "preview" ? ('),
    "the editing canvas remains mounted behind the disposable preview",
  );
  assert.match(workbench, /\{canvasMode === "edit" \? \(\s*<aside[\s\S]*?className="comments-panel comment-rail"/);
  assert.match(workbench, /setCanvasMode\("edit"\);[\s\S]*?setDrawer\("history"\)/);
  assert.match(workbench, /const applyProject[\s\S]*?setViewMode\("current"\);\s*setCanvasMode\("edit"\)/);
  assert.match(styles, /\.workbench\[data-canvas-mode="preview"\]\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.workbench\[data-canvas-mode="preview"\] \.canvas-column\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);

  assert.match(interactionPreview, /title="HTML 交互预览"/);
  assert.match(
    interactionPreview,
    /sandbox="allow-scripts allow-forms allow-modals allow-popups allow-downloads"/,
  );
  assert.doesNotMatch(interactionPreview, /allow-same-origin|allow-top-navigation/);
  assert.match(interactionPreview, /srcDoc=\{previewHtml\}/);
  assert.match(interactionPreview, /PREVIEW_STORAGE_BOOTSTRAP/);
  assert.match(interactionPreview, /预览模式 · 页面操作不会保存/);
  assert.match(workbench, /<HtmlInteractionPreview[\s\S]*?height="100%"/);
  assert.doesNotMatch(interactionPreview, /隔离交互预览|运行时 DOM、表单和存储不会写回源码/);
  assert.doesNotMatch(interactionPreview, /onChange|HtmlCanvasEditor|disableExecutableMarkup/);
  assert.match(interactionPreviewStyles, /\.preview\s*\{[\s\S]*?grid-template-rows:\s*36px minmax\(0, 1fr\)/);
  assert.match(interactionPreviewStyles, /\.preview\s*\{[\s\S]*?border:\s*0[\s\S]*?box-shadow:\s*none/);

  assert.match(canvas, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(canvas, /sandbox="[^"]*allow-scripts/);
  assert.match(canvas, /type="application\/x-html-canvas-disabled"/);
});

test("workbench transitions fail closed when a native DOM edit cannot commit or freeze", () => {
  const closeFlow = workbench.slice(
    workbench.indexOf("const handlePrepareClose"),
    workbench.indexOf("const handleCloseAborted"),
  );
  assert.match(
    closeFlow,
    /const frozen = editorRef\.current\?\.freezeNow\(\);[\s\S]*?if \(!frozen\)[\s\S]*?return \{ ready: false[\s\S]*?if \(!frozen\.ok\)[\s\S]*?return \{[\s\S]*?enqueueAutosave\(frozen\.html/u,
  );
  assert.match(
    closeFlow,
    /lastPersistedRevisionRef\.current !== cutoffRevision[\s\S]*?sourceShaRef\.current !== frozenSourceSha256/u,
  );

  const projectSwitch = workbench.slice(
    workbench.indexOf("const prepareProjectSwitch"),
    workbench.indexOf("const openProject", workbench.indexOf("const prepareProjectSwitch")),
  );
  const switchFence = projectSwitch.indexOf("editorRef.current?.fencePendingEdit({");
  const switchFenceGuard = projectSwitch.indexOf(
    "if (shouldCommitCurrentCanvas && (!committed || !committed.ok))",
    switchFence,
  );
  const switchCutoff = projectSwitch.indexOf(
    "const switchCutoffRevision = editRevisionRef.current;",
    switchFenceGuard,
  );
  const switchFlush = projectSwitch.indexOf("flushAutosave(switchCutoffRevision)", switchCutoff);
  assert.match(
    projectSwitch.slice(switchFence, switchFenceGuard),
    /resumeEditing: false,[\s\S]*?trigger: "project-switch"/u,
  );
  assert.ok(
    switchFence >= 0
      && switchFenceGuard > switchFence
      && switchCutoff > switchFenceGuard
      && switchFlush > switchCutoff,
    "project switching must fail closed at a History Fence before persisting its cutoff revision",
  );
  assert.match(
    projectSwitch,
    /lastPersistedRevisionRef\.current !== switchCutoffRevision[\s\S]*?sourceShaRef\.current !== committed\.sourceSha256/u,
  );

  const navigation = workbench.slice(
    workbench.indexOf("const beginNavigationOperation"),
    workbench.indexOf("const finishNavigationOperation"),
  );
  const navigationFence = navigation.indexOf("editorRef.current?.fencePendingEdit({");
  const navigationFenceGuard = navigation.indexOf("if (!fenced || !fenced.ok)", navigationFence);
  const navigationFreeze = navigation.indexOf("editorRef.current?.freezeNow()", navigationFenceGuard);
  const navigationFreezeGuard = navigation.indexOf("if (!frozen || !frozen.ok)", navigationFreeze);
  const navigationLock = navigation.indexOf("viewTransitioningRef.current = true", navigationFreezeGuard);
  assert.match(
    navigation.slice(navigationFence, navigationFenceGuard),
    /resumeEditing: false,[\s\S]*?trigger: "project-switch"/u,
  );
  assert.ok(
    navigationFence >= 0
      && navigationFenceGuard > navigationFence
      && navigationFreeze > navigationFenceGuard
      && navigationFreezeGuard > navigationFreeze
      && navigationLock > navigationFreezeGuard,
    "navigation must pass both the History Fence and freeze guard before locking the view",
  );

  const userFlush = workbench.slice(
    workbench.indexOf("const requestUserFlush"),
    workbench.indexOf("useEffect", workbench.indexOf("const requestUserFlush")),
  );
  const saveFence = userFlush.indexOf("editorRef.current?.fencePendingEdit({");
  const saveGuard = userFlush.indexOf("if (!committed || !committed.ok)", saveFence);
  const saveFlush = userFlush.indexOf("void flushAutosave();", saveGuard);
  assert.match(
    userFlush.slice(saveFence, saveGuard),
    /resumeEditing: true,[\s\S]*?trigger: "save"/u,
  );
  assert.ok(
    saveFence >= 0 && saveGuard > saveFence && saveFlush > saveGuard,
    "manual save must fail closed at a resumable History Fence before autosave",
  );

  const exportFlow = workbench.slice(
    workbench.indexOf("const exportCurrentHtml"),
    workbench.indexOf("const beginNavigationOperation"),
  );
  const exportFence = exportFlow.indexOf("editorRef.current?.fencePendingEdit({");
  const exportGuard = exportFlow.indexOf("if (committed && !committed.ok)", exportFence);
  const exportSnapshot = exportFlow.indexOf("const nextHtml = committed?.html", exportGuard);
  assert.match(
    exportFlow.slice(exportFence, exportGuard),
    /resumeEditing: true,[\s\S]*?trigger: "export"/u,
  );
  assert.ok(
    exportFence >= 0 && exportGuard > exportFence && exportSnapshot > exportGuard,
    "export must reject a failed History Fence before choosing its source snapshot",
  );
});

test("outer undo and redo shortcuts dispatch both PageRoot history directions", () => {
  const shortcutFlow = workbench.slice(
    workbench.indexOf("const requestUserFlush"),
    workbench.indexOf("const openCommentComposer"),
  );
  assert.match(
    shortcutFlow,
    /event\.key\.toLowerCase\(\) === "z"[\s\S]*?event\.preventDefault\(\);[\s\S]*?if \(event\.shiftKey\) editorRef\.current\?\.redo\?\.\(\);[\s\S]*?else editorRef\.current\?\.undo\?\.\(\);/u,
  );
});

test("external source adoption invalidates the active native editing session", () => {
  const refreshWorkspace = workbench.slice(
    workbench.indexOf("const refreshWorkspace"),
    workbench.indexOf("const hydrateRecentProjectRuns"),
  );
  assert.match(
    refreshWorkspace,
    /sourceTransitionToken === epoch[\s\S]*?projectHydratingRef\.current[\s\S]*?if \(projectHydratingRef\.current && !hydrationSourceTransitionAuthorized\)[\s\S]*?if \(canonicalSourcePath !== activeSource\)[\s\S]*?fenceAndFreezeCurrentCanvas\([\s\S]*?await adoptGeneratedSourcePath\([\s\S]*?if \(mustAdoptAuthoritativeSource\)[\s\S]*?await verifyCanvasRendered/u,
  );

  const completedVersion = workbench.slice(
    workbench.indexOf("const openCommittedVersion"),
    workbench.indexOf("const processRunStatus"),
  );
  assert.match(
    completedVersion,
    /const transitionAffectsCurrentCanvas[\s\S]*?sourcePathRef\.current === run\.sourcePath[\s\S]*?sourcePathRef\.current === committedSourcePath[\s\S]*?const transitionContext = captureProjectContext\(\)[\s\S]*?fenceAndFreezeCurrentCanvas\([\s\S]*?if \(!frozen\.ok\)[\s\S]*?isCurrentProjectContext\(transitionContext\)[\s\S]*?await adoptGeneratedSourcePath\(\{[\s\S]*?htmlRef\.current = content;[\s\S]*?setHtml\(content\)/u,
  );
});

test("header prioritizes the filename and keeps the approved action order", () => {
  const headerStart = workbench.indexOf('<header className="workbench-header">');
  const header = workbench.slice(
    headerStart,
    workbench.indexOf("</header>", headerStart),
  );
  assert.match(header, /className="window-file"/);
  assert.match(header, /className="save-status"/);
  assert.doesNotMatch(header, /brand-logo\.png|className="brand"|className="update-badge"/);
  assert.match(
    header,
    /updateAvailable[\s\S]*?className="header-update-badge"[\s\S]*?>\s*Update\s*</,
  );
  const editPreview = header.indexOf('className="canvas-mode-switch"');
  const project = header.indexOf('className="project-button"');
  const globalComment = header.indexOf('className="global-comment-button"');
  const send = header.indexOf('className="header-send-button"');
  assert.ok(
    editPreview >= 0
      && project > editPreview
      && globalComment > project
      && send > globalComment,
    "header actions must remain edit/preview, project, global comment, then send",
  );
  assert.match(workbench, /window\.htmlAIUpdates/);
  assert.match(workbench, /updates\.getStatus\(\)/);
  assert.match(workbench, /updates\.onStatus\(receiveStatus\)/);
  assert.doesNotMatch(header, /app-version-button|检查更新|<strong>(?:YuanYe|PageRoot)<\/strong>/);
  assert.match(styles, /\.header-actions button,[\s\S]*?border:\s*0[\s\S]*?box-shadow:\s*none/);
  assert.match(mainProcess, /scheduleAutomaticUpdateCheck\(\)/);
  assert.match(mainProcess, /LATEST_RELEASE_PAGE_URL/);
  assert.match(mainProcess, /shell\.openExternal\(LATEST_RELEASE_PAGE_URL\)/);
  assert.doesNotMatch(preload, /openLatestRelease:\s*\([^)]*url/);
});

test("QoderWork handoff exposes a truthful process board and manual open action", () => {
  assert.match(workbench, /发送至 Qoder/);
  assert.match(workbench, /交接内容已写入剪贴板/);
  assert.match(workbench, /不代表 Qoder 已收到/);
  assert.match(workbench, /等待 QoderWork 返回修改结果/);
  assert.match(workbench, /画布已锁定，仅可浏览/);
  assert.match(workbench, /身份、Hash 与文件完整性/);
  assert.match(workbench, /范围与质量校验/);
  assert.match(workbench, /无视本校验，继续/);
  assert.match(workbench, /打开最新版/);
  const sendToQoderStart = workbench.indexOf("const sendToQoderWork = useCallback");
  const sendToQoderEnd = workbench.indexOf("const revealActiveRunInFinder", sendToQoderStart);
  const sendToQoderWork = workbench.slice(sendToQoderStart, sendToQoderEnd);
  assert.match(sendToQoderWork, /qoderHandoffStatesRef\.current\.set\(run\.sourcePath, nextState\)/);
  assert.match(sendToQoderWork, /publishStatus\("copying"\)/);
  assert.match(sendToQoderWork, /publishStatus\("copied"\)/);
  assert.match(sendToQoderWork, /publishStatus\("failed"\)/);
  assert.match(
    sendToQoderWork,
    /sourcePathRef\.current === run\.sourcePath[\s\S]*?visibleRun\?\.requestId === run\.requestId[\s\S]*?visibleRun\.attemptId === run\.attemptId/,
  );
  assert.doesNotMatch(sendToQoderWork, /setDrawer\("handoff"\)|tone: "success"/);
  assert.match(workbench, /qoder-logo\.png/);
  assert.match(workbench, /window\.htmlAIIntegrations/);
  assert.match(workbench, /integrations\.handoffToQoderWork/);
  assert.match(
    sendToQoderWork,
    /result\.status !== "copied" \|\| result\.copied !== true/u,
  );
  assert.match(
    workbench,
    /await sendToQoderWork\(durableRun\.handoffMessage, durableRun\)/,
  );
  assert.doesNotMatch(workbench, /QoderWork 已打开|已粘贴至 QoderWork|自动发送消息/);
  assert.match(workbench, /在 Finder 中查看本轮文件/);
  assert.match(workbench, /revealRequestFolder/);
  assert.match(workbench, />本轮记录</);
  const footerStart = workbench.indexOf('<footer className="processing-footer">');
  const footer = workbench.slice(footerStart, workbench.indexOf("</footer>", footerStart));
  const cancel = footer.indexOf("取消发送，继续编辑");
  const preview = footer.indexOf("预览已发送 HTML");
  const copy = footer.indexOf("再次复制本轮要求");
  assert.ok(cancel >= 0 && preview > cancel && copy > preview);
  assert.match(footer, /activeRun\.status === "ready-to-open"[\s\S]*?打开最新版/);
  assert.match(workbench, /正在预览已发送 HTML[\s\S]*?返回等待处理/);
  const processingHeaderStart = workbench.indexOf(
    '<header className="drawer-header processing-header">',
  );
  const processingHeader = workbench.slice(
    processingHeaderStart,
    workbench.indexOf("</header>", processingHeaderStart),
  );
  assert.match(
    processingHeader,
    /aria-label="关闭处理面板"[\s\S]*?onClick=\{\(\) => setDrawer\(null\)\}/,
  );
  assert.doesNotMatch(processingHeader, /cancelActiveRun|取消发送/);
  assert.match(
    workbench,
    /generating[\s\S]*?\|\| submissionPendingRef\.current[\s\S]*?\|\| !projectLocked[\s\S]*?activeRun\?\.requestId !== "pending"/,
  );
});

test("processing uses one blocking decision surface while preserving recovery actions", () => {
  assert.match(
    workbench,
    /<nav className="header-actions"[\s\S]*?disabled=\{\s*projectHydrating \|\| viewTransitioning \|\| Boolean\(projectLoadError\)/,
  );
  assert.match(workbench, /aria-pressed=\{canvasMode === "edit"\}[\s\S]*?disabled=\{runInProgress \|\| viewMode === "history"\}/);
  assert.match(workbench, /className="global-comment-button"[\s\S]*?disabled=\{interactionLocked \|\| canvasMode !== "edit"\}/);
  assert.match(styles, /\.drawer-overlay\.show\[data-drawer="handoff"\]\s*\{[\s\S]*?pointer-events:\s*auto/);
  assert.match(
    styles,
    /\.workbench\[data-round-state="processing"\] > \.review-scroll-stage\s*\{[\s\S]*?opacity:\s*0\.38/,
  );
  assert.match(
    workbench,
    /className="project-file-editor"[\s\S]*?disabled=\{fileView\.loading \|\| runInProgress\}/,
  );
  assert.match(workbench, /取消发送，继续编辑/);
  assert.match(workbench, /预览已发送 HTML/);
  assert.match(workbench, /再次复制本轮要求/);
  assert.match(
    styles,
    /\.side-drawer\[data-drawer="handoff"\] > \.drawer-body\s*\{[\s\S]*?overflow:\s*hidden/,
  );
  assert.match(
    styles,
    /\.side-drawer\[data-drawer="handoff"\] \.round-comment-list\s*\{[\s\S]*?overflow-y:\s*auto/,
  );
});

test("header keeps persistence state concise without a redundant history suffix", () => {
  assert.doesNotMatch(workbench, /currentIdentity/);
  assert.match(workbench, /className="save-status"/);
  assert.match(workbench, /\{viewMode === "history"/);
  assert.match(workbench, /\{persistState === "idle" \? "已安全保存" : persistLabel\}/);
});

test("first project registration is part of the recoverable autosave transaction", () => {
  const flushStart = workbench.indexOf("const flushAutosave = useCallback");
  const flushEnd = workbench.indexOf("const enqueueAutosave = useCallback", flushStart);
  assert.ok(flushStart >= 0 && flushEnd > flushStart);
  const flush = workbench.slice(flushStart, flushEnd);
  const writing = flush.indexOf('persistStateRef.current = "writing"');
  const transactionTry = flush.indexOf("try {", writing);
  const registration = flush.indexOf("await ensureProjectRegistered(", transactionTry);
  const transactionCatch = flush.indexOf("} catch (cause) {", registration);
  assert.ok(writing >= 0 && transactionTry > writing);
  assert.ok(registration > transactionTry && transactionCatch > registration);
  assert.match(flush, /\/autosave`[\s\S]*?BRIDGE_WRITE_TIMEOUT_MS/);
  assert.match(workbench, /\/project\/ensure`[\s\S]*?BRIDGE_WRITE_TIMEOUT_MS/);
  const recovery = flush.slice(transactionCatch);
  assert.match(recovery, /pendingWriteRef\.current = recoveryWrite/);
  assert.match(
    recovery,
    /fenceAndFreezeCurrentCanvas\([\s\S]*?persistRecoveryLog\(recoveryWrite, writeContext\)[\s\S]*?persistStateRef\.current = "conflict"/u,
  );
  assert.match(recovery, /persistRecoveryLog\(recoveryWrite, writeContext\)/);
  assert.match(
    flush,
    /editRevisionRef\.current > lastPersistedRevisionRef\.current[\s\S]*?const reconstructedWrite: PendingWrite[\s\S]*?html: htmlRef\.current[\s\S]*?pendingWriteRef\.current = reconstructedWrite/,
  );
  assert.match(
    recovery,
    /isCurrentProjectContext\(writeContext\)[\s\S]*?pendingWriteRef\.current = recoveryWrite/,
  );
  assert.match(
    workbench,
    /targetSha256 === currentSourceSha256[\s\S]*?const reconciledRevision = Math\.max\(serverRevision, recoveredRevision\)[\s\S]*?lastPersistedRevisionRef\.current = reconciledRevision/,
  );
});

test("AI submission and run operations remain isolated by project and run identity", () => {
  const generateStart = workbench.indexOf("const generateRequest = useCallback");
  const generateEnd = workbench.indexOf(
    "const openCommittedVersion = useCallback",
    generateStart,
  );
  const generate = workbench.slice(generateStart, generateEnd);
  const intentClaim = generate.indexOf("submissionIntentRef.current = submissionIntent");
  const registration = generate.indexOf("await ensureProjectRegistered()");
  assert.ok(intentClaim >= 0 && registration > intentClaim);
  assert.match(generate, /if \(submissionIntentRef\.current\) return/);
  assert.match(
    generate,
    /submissionIntentRef\.current\?\.token !== submissionIntent\.token[\s\S]*?projectEpochRef\.current !== submissionIntent\.epoch[\s\S]*?sourcePathRef\.current !== submissionIntent\.sourcePath/,
  );
  assert.match(workbench, /qoderHandoffStatesRef\s*=\s*useRef<Map<string, ProjectQoderHandoffState>>/);
  assert.match(workbench, /activatingRunsRef = useRef<Set<string>>/);
  assert.match(workbench, /waivingRunsRef = useRef<Set<string>>/);
  assert.match(workbench, /cancellingRunsRef = useRef<Set<string>>/);
  assert.match(
    workbench,
    /statusPollBusyRef = useRef<Set<string>>\(new Set\(\)\)[\s\S]*?statusPollBusyRef\.current\.has\(operationKey\)[\s\S]*?statusPollBusyRef\.current\.delete\(operationKey\)/,
  );
  assert.match(
    workbench,
    /await Promise\.allSettled\([\s\S]*?backgroundRunsRef\.current\.values\(\)/,
  );
  assert.match(
    workbench,
    /const projectQoderHandoff = project\.sourcePath[\s\S]*?qoderHandoffStatesRef\.current\.get\(project\.sourcePath\)/,
  );
  assert.match(
    workbench,
    /const previousState = qoderHandoffStatesRef\.current\.get\(run\.sourcePath\)[\s\S]*?previousState\.requestId !== run\.requestId[\s\S]*?previousState\.attemptId !== run\.attemptId/,
  );
});

test("undo and redo use stable history identity without folding in-flight audit events", () => {
  assert.match(canvas, /historyId\?: string/);
  assert.match(canvas, /historyAction:\s*"undo"/);
  assert.match(
    workbench,
    /const auditInFlightKeysRef = useRef<Set<string>>\(new Set\(\)\)/,
  );
  assert.match(
    workbench,
    /const inFlightAuditKeys = write\.events\.map\(auditEventKey\)[\s\S]*?auditInFlightKeysRef\.current\.add\(key\)/,
  );
  assert.match(
    workbench,
    /finally \{[\s\S]*?auditInFlightKeysRef\.current\.delete\(key\)/,
  );
  assert.match(workbench, /const history = reduceDirectEditHistory\(\{/);
  assert.match(workbench, /undoFolds: undoDraftFoldsRef\.current/);
  assert.match(workbench, /redoFolds: redoDraftFoldsRef\.current/);
  assert.match(workbench, /inFlightKeys: auditInFlightKeysRef\.current/);
  assert.match(workbench, /persistCurrentDraftRecovery\(commentsRef\.current, history\.events\)/);
});

test("history opens concise immutable versions in the canvas with their comments", () => {
  assert.match(workbench, /className="version-panel-heading"/);
  assert.match(
    workbench,
    /<header className="version-panel-heading">[\s\S]*?ClockCounterClockwiseIcon[\s\S]*?安全保留每一次修改/,
  );
  assert.match(workbench, /首次编辑或发送给 AI 后，会建立版本 1/);
  assert.match(workbench, /在画布中查看不会覆盖当前 HTML；历史内容与当时的评论都保持只读/);
  assert.match(workbench, /className="version-list"/);
  assert.match(workbench, /className="view-version-button"[\s\S]*?在画布中查看/);
  assert.match(workbench, /viewMode === "history" && viewingVersion[\s\S]*?viewingVersion\.comments\.filter\(commentHasContent\)/);
  assert.match(workbench, /正在浏览 \{viewingVersion\?\.label \|\| viewingVersionId\}/);
  assert.match(workbench, /回到当前版本/);
  assert.match(
    workbench,
    /revealVersionFile\?: \(payload: \{[\s\S]*?sourcePath: string;[\s\S]*?versionId: string;/,
  );
  assert.match(
    workbench,
    /const revealVersionInFinder = useCallback[\s\S]*?await api\.revealVersionFile\(\{[\s\S]*?versionId: version\.id/,
  );
  assert.match(
    workbench,
    /window\.htmlAIProjects\?\.revealVersionFile[\s\S]*?onClick=\{\(\) => void revealVersionInFinder\(version\)\}[\s\S]*?Finder/,
  );
  assert.match(styles, /\.version-list\s*\{[\s\S]*?border-radius:\s*15px/);
  assert.match(styles, /\.version-row\s*\{[\s\S]*?grid-template-columns:\s*42px minmax\(0, 1fr\) auto 14px/);
  const restoreStart = workbench.indexOf("const restoreVersion = useCallback");
  const restoreEnd = workbench.indexOf("const persistLabel =", restoreStart);
  assert.ok(restoreStart >= 0 && restoreEnd > restoreStart);
  assert.match(
    workbench.slice(restoreStart, restoreEnd),
    /auditPendingRef\.current = \[\];\s*undoDraftFoldsRef\.current\.clear\(\);\s*redoDraftFoldsRef\.current\.clear\(\);\s*changeEventsRef\.current = \[\];\s*setChangeEvents\(\[\]\);/,
  );
});

test("AI completion adopts the generated semantic file before editing resumes", () => {
  assert.match(
    workbench,
    /activateGeneratedVersion\?: \(payload: \{[\s\S]*?previousSourcePath: string;[\s\S]*?nextSourcePath: string;/,
  );
  assert.match(
    workbench,
    /const adoptGeneratedSourcePath = useCallback[\s\S]*?await api\.activateGeneratedVersion\(\{[\s\S]*?previousSourcePath,[\s\S]*?nextSourcePath,[\s\S]*?expectedSha256/,
  );
  assert.match(
    workbench,
    /sourcePathRef\.current = nextSourcePath;[\s\S]*?setSourcePath\(nextSourcePath\);[\s\S]*?setSourceSha256\(expectedSha256\)/,
  );
  const adoptionStart = workbench.indexOf("const adoptGeneratedSourcePath = useCallback");
  const adoptionEnd = workbench.indexOf("const recoverAutosaveLog", adoptionStart);
  assert.ok(adoptionStart >= 0 && adoptionEnd > adoptionStart);
  assert.doesNotMatch(
    workbench.slice(adoptionStart, adoptionEnd),
    /setProjectName\(fileNameFromSourcePath/,
  );
  assert.match(
    workbench,
    /const projectRecord = isRecord\(payload\.project\)[\s\S]*?if \(projectRecord\.name\) setProjectName\(String\(projectRecord\.name\)\)/,
  );
  assert.match(
    workbench,
    /const committedSourcePath = String\([\s\S]*?sourcePayload\.sourcePath[\s\S]*?payload\.currentPath[\s\S]*?payload\.workingCopyPath/,
  );
  assert.match(
    workbench,
    /await adoptGeneratedSourcePath\(\{[\s\S]*?previousSourcePath: run\.sourcePath,[\s\S]*?nextSourcePath: committedSourcePath/,
  );
  assert.match(
    workbench,
    /await refreshWorkspace\(committedSourcePath, adoptedContext\.epoch\)/,
  );
  assert.match(
    workbench,
    /setOpenedAiVersionNotice\(\{[\s\S]*?fileName: fileNameFromSourcePath\(committedSourcePath\)[\s\S]*?versionLabel: candidateLabel/,
  );
  assert.match(
    workbench,
    /activeRun\.status === "ready-to-open"[\s\S]*?打开最新版/u,
  );
  assert.doesNotMatch(workbench, /className="ai-file-opened-card"/u);
  assert.doesNotMatch(workbench, /QoderWork 返回的新文件已打开|原文件已保留/u);
  assert.match(
    workbench,
    /<strong title=\{activeOpenedAiVersionNotice\?\.fileName \|\| projectName\}>/,
  );
  assert.match(workbench, /aria-live="polite"[\s\S]*?aria-atomic="true"/u);
  assert.match(
    workbench,
    /label: displayVersionLabel\(Number\(manifest\.versionOrdinal\)\)/,
  );
  assert.match(workbench, /return match \? `版本 \$\{Number\(match\[1\]\)\}`/);
});

test("project panel keeps actions clear without technical paths in the header", () => {
  assert.match(workbench, /className="project-button"[\s\S]*?项目/);
  assert.match(workbench, /const closeFileView = useCallback/);
  assert.match(workbench, /if \(!closeFileView\(\)\) return;[\s\S]*?setDrawer\("files"\)/);
  assert.match(workbench, /className="current-project-card"/);
  assert.match(workbench, /导出 HTML 副本/);
  assert.match(workbench, />打开本地 HTML</);
  assert.match(workbench, /项目记录文件夹/);
  assert.match(workbench, /查看每轮要求、AI 返回与历史文件/);
  assert.match(workbench, /BRIDGE_URL\}\/open-folder/);
  assert.match(workbench, /以后每次 AI 修改都会读取/);
  assert.match(workbench, /保存只影响后续任务，不会修改当前 HTML/);
  assert.match(workbench, /项目规则还有未保存修改/);
  assert.match(workbench, /<details[\s\S]*?className="project-advanced"/);
  const headerStart = workbench.indexOf('<header className="workbench-header">');
  const header = workbench.slice(
    headerStart,
    workbench.indexOf("</header>", headerStart),
  );
  assert.doesNotMatch(header, /sourcePath|folderFromSourcePath|projectRecordsPath|\/Users\//);
  assert.doesNotMatch(workbench, /<strong>\{activeRun\.requestId\}/);
  assert.doesNotMatch(workbench, /<code>[\s\S]*?version\.requestId/);
  assert.doesNotMatch(workbench, /shortHash\(viewingVersion\.contentSha256\)/);
  assert.match(styles, /\.current-project-card\s*\{/);
  assert.match(styles, /\.project-advanced\s*\{/);
});

test("first open stays read-only until a real project action", () => {
  assert.match(workbench, /BRIDGE_URL\}\/project\/ensure/);
  assert.match(
    workbench,
    /const ensureProjectRegistered = useCallback/,
  );
  assert.match(
    workbench,
    /if \(!write\.projectId \|\| !write\.documentId\) \{[\s\S]*?ensureProjectRegistered/,
  );
  assert.match(
    workbench,
    /const generateRequest = useCallback[\s\S]*?await ensureProjectRegistered\(\)/,
  );
  assert.match(
    workbench,
    /let activeComments = commentsRef\.current\.filter\(commentHasContent\)[\s\S]*?await ensureProjectRegistered\(\)[\s\S]*?activeComments = commentsRef\.current\.filter\(commentHasContent\)/,
  );
  assert.match(
    workbench,
    /const flushed = await flushAutosave\(freezeCutoffRevision\)[\s\S]*?const persistedComments = commentsRef\.current\.filter\(commentHasContent\)[\s\S]*?submissionContext\.comments = persistedComments\.map[\s\S]*?submissionContext\.changeEvents = changeEventsRef\.current\.map/,
  );
  assert.match(
    workbench,
    /comment\.target\.sourceAnchor\.sourceSha256[\s\S]*?!== persistedSourceSha256/,
  );
  assert.match(workbench, /payload\.projectRoot/);
  assert.match(workbench, /workspacePaths\.projectRecords/);
  assert.match(
    workbench,
    /Promise\.allSettled\(\[api\.getActiveProject\(\), api\.listRecentProjects\(\)\]\)/,
  );
  assert.match(workbench, /上次打开的 HTML 无法恢复/);
  assert.match(workbench, /文件可能已移动、删除或损坏/);
  assert.match(workbench, /className="startup-issue" role="alert"/);
  assert.match(workbench, />\s*选择其他 HTML\s*</);
});

test("comment composer is explicit, transient and horizontally contained", () => {
  const unifiedSurfaceStyles = styles.slice(styles.indexOf("PageRoot V5.1"));
  assert.match(workbench, /composerOpen && draftTarget && !interactionLocked \?/);
  assert.match(workbench, /setComposerOpen\(true\)/);
  assert.match(workbench, /setComposerOpen\(false\)/);
  assert.match(workbench, /draftTargetRef\.current\?\.id === target\.id/);
  assert.match(workbench, /if \(!resumesRecoveredDraft\)/);
  assert.match(workbench, /className="draft-recovery-card[^"]*"/);
  assert.match(workbench, />继续填写</);
  assert.match(workbench, /recoveredDraftTarget\.id !== target\.id/);
  assert.match(workbench, /const activeCommentCount = activeCommentItems\.length/);
  assert.match(workbench, />\s*评论\s*<\/button>/);
  assert.doesNotMatch(workbench, />\s*加入本轮\s*<\/button>|⌘ Enter 添加/);
  assert.match(workbench, /onClick=\{closeCommentComposer\}/);
  assert.doesNotMatch(
    workbench,
    /onSelect=\{\(target\) => \{[\s\S]{0,160}setDraftTarget\(target\)/,
  );
  assert.doesNotMatch(workbench, /className="comment-action locate-comment"/);
  assert.match(
    workbench,
    /focusCommentTarget\(comment\.target, comment\.commentId\)/,
  );
  assert.match(workbench, /\(event\.metaKey \|\| event\.ctrlKey\) && event\.key === "Enter"/);
  assert.doesNotMatch(workbench, /自动记录 · ⌘ Enter 发送/);
  assert.doesNotMatch(workbench, /comment-target[\s\S]{0,300}targetResolutionLabel/);
  const composer = workbench.slice(
    workbench.indexOf('className="comment-composer rail-comment-composer"'),
    workbench.indexOf('className="draft-recovery-card rail-status-card"'),
  );
  assert.doesNotMatch(composer, /targetResolutionLabel|className="target-resolution"/);
  assert.match(workbench, /className="comments-panel comment-rail"/);
  assert.match(workbench, /className="comment-rail-content"/);
  assert.match(
    unifiedSurfaceStyles,
    /\.review-scroll-stage\s*\{[\s\S]*?overflow-y:\s*auto/,
  );
  assert.match(
    unifiedSurfaceStyles,
    /\.comments-panel\.comment-rail\s*\{[\s\S]*?overflow:\s*visible/,
  );
  assert.match(styles, /\.comment-rail-content > \.comment-card\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(unifiedSurfaceStyles, /\.comment-card-tools\s*\{[\s\S]*?gap:\s*9px/);
  assert.match(workbench, /data-comment-measure=\{comment\.commentId\}/);
  assert.match(workbench, /const focusKey = composerOpen && draftTarget \? "__composer" : focusedCommentId/);
  assert.match(workbench, /deferredItems\.unshift\(item\)/);
  assert.match(workbench, /queueReviewPairReveal\(target, "__composer"\)/);
  assert.match(workbench, /data-focused=\{focusedCommentId === comment\.commentId/);
  assert.match(workbench, /aria-current=\{focusedCommentId === comment\.commentId \? "location"/);
  assert.match(
    unifiedSurfaceStyles,
    /\.comment-rail-content > \.comment-card\[data-focused="true"\]\s*\{[\s\S]*?animation:\s*review-focus-arrive/,
  );
  assert.match(
    unifiedSurfaceStyles,
    /\.canvas-column\s*\{[\s\S]*?padding:\s*0/,
  );
  assert.match(
    unifiedSurfaceStyles,
    /\.comments-panel\.comment-rail\s*\{[\s\S]*?border-left:\s*0/,
  );
  assert.match(workbench, /className="comment-tool-button cancel-edit"/);
  assert.match(workbench, /className="comment-tool-button confirm-edit"/);
  assert.match(workbench, /className="comment-delete-confirm"/);
  assert.match(workbench, />删除这条评论？</);
  assert.match(workbench, /typeof input\.showPicker === "function"/);
  assert.match(workbench, /editorRef\.current\?\.select\(target, \{ showToolbar: false \}\)/);
  assert.match(workbench, /openGlobalCommentComposer[\s\S]*?tagName: "body"[\s\S]*?openCommentComposer\(globalTarget\)/);
});

test("comment attachments support paste, upload, removal, preview, and AI handoff metadata", () => {
  assert.match(workbench, /PaperclipIcon/);
  assert.match(workbench, /aria-label="添加附件"/);
  assert.match(workbench, /aria-label="添加图片"/);
  assert.match(workbench, /onPaste=\{\(event\) =>/);
  assert.match(workbench, /event\.clipboardData\.items/);
  assert.match(workbench, /dataBase64: await fileAsBase64\(file\)/);
  assert.match(workbench, /className="image-attachment-preview"/);
  assert.match(workbench, /className="remove-attachment-button"/);
  assert.match(workbench, /className="file-attachment"/);
  assert.match(workbench, /className="attachment-lightbox"/);
  assert.match(
    workbench,
    /if \(event\.target === event\.currentTarget\) setPreviewAttachment\(null\)/,
  );
  assert.match(workbench, /aria-label="关闭图片预览"/);
  assert.match(workbench, /onEnsurePreview=\{ensureAttachmentObjectUrl\}/);
  assert.doesNotMatch(
    workbench,
    /versions\.flatMap\(\(version\) =>\s*version\.comments\.flatMap/,
  );
  assert.match(workbench, /aria-label=\{`预览图片 \$\{attachment\.fileName\}`\}/);
  assert.match(workbench, /aria-label=\{`移除图片 \$\{attachment\.fileName\}`\}/);
  assert.match(workbench, /attachmentRefs: \(comment\.attachments \?\? \[\]\)/);
  assert.match(workbench, /attachments: comment\.attachments\.map\(persistedAttachment\)/);
  assert.doesNotMatch(workbench, /\boriginalPath\b|\bfile\.path\b/);
  assert.match(styles, /\.composer-footer-tools,[\s\S]*?gap:\s*7px/);
  assert.match(styles, /\.comment-tool-button\s*\{[\s\S]*?box-shadow:\s*none/);
  assert.match(styles, /\.image-attachment:hover \.remove-attachment-button/);
  assert.match(styles, /\.image-attachment-preview:focus-visible/);
  assert.match(styles, /\.file-attachment-open strong\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(styles, /\.attachment-lightbox\s*\{[\s\S]*?position:\s*fixed/);
});
