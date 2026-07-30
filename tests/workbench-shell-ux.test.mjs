import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [
  workbench,
  aboutDialog,
  restartUpdateDialog,
  cancelAiRunDialog,
  styles,
  mainProcess,
  preload,
  canvas,
  sampleHtml,
  interactionPreview,
  interactionPreviewStyles,
  previewSandbox,
  bridgeClient,
] = await Promise.all([
  readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/AboutPageRootDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/RestartUpdateDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/CancelAiRunDialog.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
  readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url), "utf8"),
  readFile(new URL("../desktop/welcome-project-content.mjs", import.meta.url), "utf8"),
  readFile(new URL("../app/components/HtmlInteractionPreview.tsx", import.meta.url), "utf8"),
  readFile(new URL("../app/components/HtmlInteractionPreview.module.css", import.meta.url), "utf8"),
  readFile(new URL("../app/components/html-preview-sandbox.js", import.meta.url), "utf8"),
  readFile(new URL("../app/application/bridge-client.js", import.meta.url), "utf8"),
]);

test("startup welcome HTML is provisioned as a normal registered project", () => {
  assert.match(workbench, /const WELCOME_PROJECT/);
  assert.match(workbench, /name: WELCOME_PROJECT_NAME/);
  assert.match(sampleHtml, /WELCOME_PROJECT_NAME = "欢迎来到源页\.html"/);
  assert.match(workbench, /内置介绍页 · 打开本地 HTML 后开始编辑/);
  assert.doesNotMatch(workbench, /市场策略周报\.html|示例预览 · 打开本地 HTML 后自动更新/);
  assert.match(mainProcess, /ensureManagedWelcomeHtml/);
  assert.match(mainProcess, /ensureBridgeProjectRegistered/);
  assert.match(mainProcess, /\/project\/ensure/);
  assert.match(mainProcess, /workspace\.registered !== true/);
  assert.match(workbench, /data-project-state=\{/);
  assert.match(
    workbench,
    /projectHydrating[\s\S]*?"hydrating"[\s\S]*?sourcePath[\s\S]*?"ready"/,
  );
  assert.doesNotMatch(mainProcess, /if \(!activePath\) return null/);
  assert.match(sampleHtml, /<title>源页 · PageRoot<\/title>/);
  assert.match(
    sampleHtml,
    /<h1><span>所见，即可落笔。<\/span><span>所改，止于所选。<\/span><\/h1>/,
  );
  assert.match(
    sampleHtml,
    /<header class="hero">\s*<span class="demo-badge">内置介绍页<\/span>/,
  );
  assert.match(
    sampleHtml,
    /\.demo-badge \{[\s\S]*?position: absolute;[\s\S]*?top: 44px;[\s\S]*?right: 50px;/,
  );
  assert.match(sampleHtml, /顺畅的文本编辑/);
  assert.match(sampleHtml, /指哪改哪的局部修改/);
  assert.match(sampleHtml, /AI Agent 拿到完整上下文/);
  assert.match(sampleHtml, /AI Agent 结果安全接回/);
  assert.match(sampleHtml, /Claude Code · Codex · WorkBuddy · Qoder/);
  assert.match(sampleHtml, /无需复制整页 HTML 或重新描述位置/);
  assert.match(sampleHtml, /交给你正在使用的 AI Agent/);
  assert.match(sampleHtml, /校验后生成独立新版本/);
  assert.match(
    sampleHtml,
    /WELCOME_LOGO_RELATIVE_PATH = "brand-logo\.png"/,
  );
  assert.match(
    sampleHtml,
    /src="\.\/\$\{WELCOME_LOGO_RELATIVE_PATH\}"/,
  );
  assert.match(sampleHtml, /这张欢迎页本身，就是一次完整的 AI Agent 协作入口/);
  assert.match(sampleHtml, /双击即可直接编辑，也可以选中内容添加评论/);
  assert.match(sampleHtml, /从顶部「项目」打开其他 HTML/);
  assert.doesNotMatch(sampleHtml, /尚未绑定本地文件/);
  assert.doesNotMatch(sampleHtml, /利率拐点前的仓位选择|美国 10 年期|市场策略周报/);
});

test("presentational cleanup cannot strand an authorized project hydration", () => {
  const applyProjectFlow = workbench.slice(
    workbench.indexOf("const applyProject"),
    workbench.indexOf("const refreshRecents"),
  );
  assert.match(applyProjectFlow, /markProjectHydrationStage\("apply-start"\)/);
  assert.match(
    applyProjectFlow,
    /URL\.revokeObjectURL\(url\);[\s\S]*?catch \{[\s\S]*?must not block the next project's authority/u,
  );
  assert.match(
    applyProjectFlow,
    /typeof reviewStage\.scrollTo === "function"[\s\S]*?reviewStage\.scrollTo\(\{ top: 0 \}\);[\s\S]*?catch/u,
  );
  assert.match(
    applyProjectFlow,
    /editorRef\.current\?\.unlockNow\?\.\(\);[\s\S]*?catch[\s\S]*?editorRef\.current\?\.clearSelection\(\);[\s\S]*?catch/u,
  );
  assert.match(applyProjectFlow, /markProjectHydrationStage\("apply-complete"\)/);
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
  assert.match(
    workbench,
    /const showInFolder = window\.htmlAIProjects\?\.showInFolder[\s\S]*?withOneAutomaticRetry\(\(\) => showInFolder\(activeSourcePath\)\)/,
  );
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
    /sourceEndpoint\.searchParams\.set\("sourcePath", resolvedPreviousPath\)/,
  );
  assert.match(
    mainProcess,
    /authoritativeSource\.currentExactVersionId !== payload\.versionId/,
  );
  assert.match(
    mainProcess,
    /const authoritativeSourcePath = await realpath\(authoritativeSource\.sourcePath\)[\s\S]*?authoritativeSourcePath !== resolvedNextPath/,
  );
  assert.match(
    mainProcess,
    /pathParts\[1\] !== authoritativeSource\.storageDirectoryName/,
  );
  assert.doesNotMatch(
    mainProcess,
    /pathParts\[1\] !== payload\.projectId/,
  );
  assert.match(
    mainProcess,
    /const activatesCurrentProject =[\s\S]*?activePathIdentity === resolvedPreviousPath[\s\S]*?if \(activatesCurrentProject\) \{[\s\S]*?state\.activePath = resolvedNextPath/,
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
    /\.workbench\s*\{[\s\S]*?--notice-header-height:\s*88px[\s\S]*?grid-template-rows:\s*var\(--notice-header-height\) minmax\(0, 1fr\)/,
  );
  assert.match(
    unifiedSurfaceStyles,
    /\.workbench-header\s*\{[\s\S]*?min-height:\s*var\(--notice-header-height\)[\s\S]*?padding:\s*30px 16px 12px 22px/,
  );
  assert.match(
    unifiedSurfaceStyles,
    /@media \(max-width:\s*940px\)\s*\{[\s\S]*?\.workbench-header\s*\{[\s\S]*?padding:\s*30px 12px 12px 20px/,
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
    /aria-pressed=\{canvasMode === "preview"\}[\s\S]*?disabled=\{!browserPreviewOnly && interactionLocked\}/,
  );
  assert.match(
    workbench,
    /aria-pressed=\{canvasMode === "edit"\}[\s\S]*?disabled=\{browserPreviewOnly \|\| runInProgress \|\| viewMode === "history"\}/,
  );
  assert.match(workbench, /浏览器预览 · 只读[\s\S]*?操作不会保存/);
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
    "preview entry must pass a fail-closed source-authority fence before changing modes",
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
  assert.match(
    workbench,
    /const applyProject[\s\S]*?setViewMode\("current"\);[\s\S]*?setCanvasMode\([\s\S]*?runtimeCapabilitiesRef\.current\.sourceEditing !== "enabled"[\s\S]*?\? "preview"[\s\S]*?: "edit"/,
  );
  assert.match(styles, /\.workbench\[data-canvas-mode="preview"\]\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(styles, /\.workbench\[data-canvas-mode="preview"\] \.canvas-column\s*\{[\s\S]*?grid-column:\s*1 \/ -1/);

  assert.match(interactionPreview, /title="HTML 交互预览"/);
  assert.match(
    interactionPreview,
    /INDEPENDENT_PREVIEW_SANDBOX =[\s\S]*?"allow-scripts allow-same-origin allow-forms allow-modals allow-popups allow-downloads"/,
  );
  assert.match(
    interactionPreview,
    /SRCDOC_PREVIEW_SANDBOX =[\s\S]*?"allow-scripts allow-forms allow-modals allow-popups allow-downloads"/,
  );
  assert.match(interactionPreview, /sandbox=\{frameSandbox\}/);
  assert.doesNotMatch(interactionPreview, /allow-top-navigation/);
  assert.match(interactionPreview, /transport = "srcdoc"/);
  assert.match(interactionPreview, /previewApi\.createSession\(\{/);
  assert.match(interactionPreview, /\? \{ src: frameSource \?\? "about:blank" \}/);
  assert.match(interactionPreview, /: \{ srcDoc: prepared\.html \}/);
  assert.match(interactionPreview, /capturePageViewContext:/);
  assert.match(interactionPreview, /createPageViewContext\(\{/);
  assert.match(interactionPreview, /PREVIEW_STORAGE_BOOTSTRAP/);
  assert.match(interactionPreview, /预览模式 · 页面操作不会保存/);
  assert.match(workbench, /<HtmlInteractionPreview[\s\S]*?height="100%"/);
  assert.match(
    workbench,
    /capturePageViewContext\(\)[\s\S]*?applyPageViewContext\(nextContext\)[\s\S]*?setCanvasMode\("edit"\)/,
  );
  assert.match(workbench, /transport=\{interactivePreviewTransport\}/);
  assert.doesNotMatch(interactionPreview, /隔离交互预览|运行时 DOM、表单和存储不会写回源码/);
  assert.doesNotMatch(interactionPreview, /onChange|HtmlCanvasEditor|disableExecutableMarkup/);
  assert.match(interactionPreviewStyles, /\.preview\s*\{[\s\S]*?grid-template-rows:\s*36px minmax\(0, 1fr\)/);
  assert.match(interactionPreviewStyles, /\.preview\s*\{[\s\S]*?border:\s*0[\s\S]*?box-shadow:\s*none/);

  assert.match(canvas, /sandbox="allow-same-origin"/);
  assert.doesNotMatch(canvas, /sandbox="[^"]*allow-scripts/);
  assert.match(
    canvas,
    /a\[href\], area\[href\], button, form, input, select, textarea/,
  );
  assert.doesNotMatch(
    canvas,
    /setAttribute\(["']inert["']|\.inert\s*=/,
  );
  assert.match(previewSandbox, /type="application\/x-html-canvas-disabled"/);
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
  const switchDrain = projectSwitch.indexOf(
    'drainCoordinatorRef.current.drain("switch"',
    switchCutoff,
  );
  assert.match(
    projectSwitch.slice(switchFence, switchFenceGuard),
    /resumeEditing: false,[\s\S]*?trigger: "project-switch"/u,
  );
  assert.ok(
    switchFence >= 0
      && switchFenceGuard > switchFence
      && switchCutoff > switchFenceGuard
      && switchDrain > switchCutoff,
    "project switching must fail closed at a source-authority fence before persisting its cutoff revision",
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
    "navigation must pass both the source-authority fence and freeze guard before locking the view",
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
    "manual save must fail closed at a resumable source-authority fence before autosave",
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
    "export must reject a failed source-authority fence before choosing its source snapshot",
  );
});

test("outer source reversal shortcuts are blocked without exposing reversal APIs", () => {
  const shortcutFlow = workbench.slice(
    workbench.indexOf("const requestUserFlush"),
    workbench.indexOf("const openCommentComposer"),
  );
  assert.match(
    shortcutFlow,
    /event\.key\.toLowerCase\(\) === "z"[\s\S]*?target\?\.isContentEditable[\s\S]*?event\.preventDefault\(\);[\s\S]*?return;/u,
  );
  assert.doesNotMatch(canvas, /\b(?:undo|redo): \(\) => boolean/u);
  assert.doesNotMatch(shortcutFlow, /editorRef\.current\?\.(?:undo|redo)/u);
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
    /const transitionAffectsCurrentCanvas[\s\S]*?sameLocalSourcePath\(sourcePathRef\.current, run\.sourcePath\)[\s\S]*?sameLocalSourcePath\(sourcePathRef\.current, committedSourcePath\)[\s\S]*?const transitionContext = captureProjectContext\(\)[\s\S]*?fenceAndFreezeCurrentCanvas\([\s\S]*?if \(!frozen\.ok\)[\s\S]*?isCurrentProjectContext\(transitionContext\)[\s\S]*?await adoptGeneratedSourcePath\(\{[\s\S]*?htmlRef\.current = content;[\s\S]*?setHtml\(content\)/u,
  );
});

test("header prioritizes the filename and keeps the approved action order", () => {
  const headerClass = workbench.indexOf('className="workbench-header"');
  const headerStart = workbench.lastIndexOf("<header", headerClass);
  const header = workbench.slice(
    headerStart,
    workbench.indexOf("</header>", headerStart),
  );
  assert.match(header, /className="window-file"/);
  assert.match(header, /className="window-file-icon"[\s\S]*?<FileHtmlIcon/);
  assert.match(header, /className="save-status"/);
  assert.match(
    workbench,
    /const canShowCurrentFileInFolder = Boolean\([\s\S]*?sourcePath[\s\S]*?window\.htmlAIProjects\?\.showInFolder/,
  );
  assert.match(
    header,
    /className="file-version-label"[\s\S]*?canShowCurrentFileInFolder[\s\S]*?className="window-file-folder-action"[\s\S]*?onClick=\{\(\) => void showProjectInFolder\(\)\}[\s\S]*?>\s*在文件夹中打开\s*<\/button>[\s\S]*?className="save-status"/,
  );
  assert.doesNotMatch(header, /brand-logo\.png|className="brand"|className="update-badge"/);
  assert.match(
    header,
    /updateActionVisible[\s\S]*?className="header-update-badge"[\s\S]*?updateDownloaded[\s\S]*?setRestartUpdateOpen\(true\)[\s\S]*?downloadAvailableUpdate\(\)[\s\S]*?\{updateBadgeLabel\}/,
  );
  assert.match(
    styles,
    /\.window-file-title-row > strong,\s*\.window-file-title-action strong\s*\{[\s\S]*?font-size:\s*17px/,
  );
  assert.match(
    styles,
    /\.file-meta\s*\{[\s\S]*?font-style:\s*italic/,
  );
  assert.match(
    styles,
    /\.file-version-label,\s*\.window-file-folder-action\s*\{[\s\S]*?padding:\s*2px 7px[\s\S]*?border-radius:\s*999px[\s\S]*?background:\s*#f0f1f4[\s\S]*?color:\s*#666975[\s\S]*?font-weight:\s*650/,
  );
  assert.match(
    styles,
    /\.window-file-folder-action\s*\{[\s\S]*?border:\s*0[\s\S]*?text-decoration:\s*none/,
  );
  const editPreview = header.indexOf('className="canvas-mode-switch"');
  const project = header.indexOf('className="project-button"');
  const globalComment = header.indexOf('className="global-comment-button"');
  const send = header.indexOf('className="header-send-button"');
  const about = header.indexOf('className="about-trigger-button"');
  assert.ok(
    editPreview >= 0
      && project > editPreview
      && globalComment > project
      && send > globalComment,
    "header actions must remain edit/preview, project, global comment, then send",
  );
  assert.equal(about, -1);
  assert.doesNotMatch(header, /InfoIcon|关于源页/);
  assert.match(workbench, /window\.htmlAIUpdates/);
  assert.match(workbench, /updates\.getStatus\(\)/);
  assert.match(workbench, /updates\.onStatus\(receiveStatus\)/);
  assert.match(workbench, /updates\.checkNow\(\)/);
  assert.match(workbench, /downloadAvailable\(\)/);
  assert.match(workbench, /installDownloaded\(\)/);
  assert.match(workbench, /New! 重启更新/);
  assert.doesNotMatch(workbench, /PageRoot \$\{version\} 已下载[\s\S]*?setToast/);
  assert.doesNotMatch(header, /app-version-button|<strong>(?:YuanYe|PageRoot)<\/strong>/);
  assert.match(styles, /\.header-actions button,[\s\S]*?border:\s*0[\s\S]*?box-shadow:\s*none/);
  assert.match(
    styles,
    /\.header-actions \.header-update-badge\s*\{[\s\S]*?right:\s*0[\s\S]*?padding:\s*0[\s\S]*?border:\s*0[\s\S]*?background:\s*transparent[\s\S]*?color:\s*var\(--red\)[\s\S]*?font-style:\s*italic/,
  );
  assert.match(mainProcess, /startAutomaticChecks\(\)/);
  assert.match(mainProcess, /createApplicationUpdateController/);
  assert.match(mainProcess, /coordinateApplicationUpdateInstall/);
  assert.match(mainProcess, /label:\s*"关于源页"[\s\S]*?click:\s*requestAboutPageRoot/);
  assert.match(mainProcess, /LATEST_RELEASE_PAGE_URL/);
  assert.match(mainProcess, /shell\.openExternal\(LATEST_RELEASE_PAGE_URL\)/);
  assert.match(mainProcess, /shell\.openExternal\(PROJECT_REPOSITORY_URL\)/);
  assert.match(mainProcess, /APP_CHANNELS\.openUserNotice/);
  assert.match(mainProcess, /shell\.openPath\(userNoticePath\(\)\)/);
  assert.doesNotMatch(preload, /openLatestRelease:\s*\([^)]*url/);
  assert.doesNotMatch(preload, /openRepository:\s*\([^)]*url/);
  assert.doesNotMatch(preload, /openUserNotice:\s*\([^)]*(?:path|url)/);
  assert.match(aboutDialog, /<dialog[\s\S]*?className="about-dialog"/);
  assert.match(aboutDialog, /id="about-pageroot-title">源页</);
  assert.match(aboutDialog, /AI Agent 无缝接力/);
  assert.match(aboutDialog, /立即检查/);
  assert.match(aboutDialog, /下载更新/);
  assert.match(aboutDialog, /PageRoot on GitHub/);
  assert.match(aboutDialog, /用户声明与免责声明/);
  assert.match(aboutDialog, /userNoticeOpenFailed[\s\S]*?声明文件没有打开/);
  assert.doesNotMatch(aboutDialog, /每 4 小时自动检查/);
  assert.match(
    workbench,
    /const openUserNotice = useCallback[\s\S]*?htmlAIAppLifecycle\?\.openUserNotice\(\)[\s\S]*?setUserNoticeOpenFailed\(true\)/,
  );
  assert.doesNotMatch(aboutDialog, /PageRoot for macOS/);
  assert.doesNotMatch(aboutDialog, /Apache-2\.0/);
  assert.doesNotMatch(aboutDialog, /使用数据说明/);
  assert.doesNotMatch(aboutDialog, /Stable 频道/);
  assert.doesNotMatch(
    aboutDialog,
    /type="checkbox"|关闭数据收集|停止收集|opt.?out/iu,
  );
  assert.match(aboutDialog, /aria-live="polite"/);
  assert.doesNotMatch(aboutDialog, /role="progressbar"|about-check-spinner/);
  assert.match(restartUpdateDialog, /className="restart-update-dialog"/);
  assert.match(restartUpdateDialog, /现在重启并安装更新？/);
  assert.match(restartUpdateDialog, />\s*稍后\s*</);
  assert.match(restartUpdateDialog, /现在重启/);
  assert.match(styles, /\.about-dialog::backdrop[\s\S]*?backdrop-filter:\s*blur\(8px\)/);
  assert.match(styles, /\.about-dialog button:focus-visible/);
  assert.match(styles, /\.restart-update-dialog::backdrop/);
});

test("QoderWork handoff exposes a truthful process board and manual open action", () => {
  assert.match(workbench, /发送至 Qoder/);
  assert.match(workbench, /等待 QoderWork 返回修改结果/);
  assert.match(workbench, /画布已锁定，仅可浏览/);
  assert.match(
    workbench,
    /deriveRunProgressSteps\(\s*activeRun,\s*currentQoderHandoffStatus,\s*\)/,
  );
  assert.match(
    workbench,
    /completionObserved:\s*payload\.completionObserved === true/,
  );
  assert.match(workbench, /processSteps\.length\} 个阶段/);
  assert.doesNotMatch(workbench, /const returnedStates/);
  assert.match(workbench, /已记录评论范围外的额外变化/);
  assert.doesNotMatch(workbench, /采用这些额外变化|AI 还修改了评论范围外的内容/);
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
    /sameLocalSourcePath\(sourcePathRef\.current, run\.sourcePath\)[\s\S]*?visibleRun\?\.requestId === run\.requestId[\s\S]*?visibleRun\.attemptId === run\.attemptId/,
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
  assert.match(workbench, /className="process-step-index"/);
  assert.match(workbench, /className="process-step-status"/);
  assert.match(workbench, /processStepStatusLabel\(step\.state\)/);
  assert.match(workbench, /ShieldCheckIcon/);
  assert.match(workbench, /FloppyDiskIcon/);
  assert.match(workbench, /FlagCheckeredIcon/);
  assert.match(
    workbench,
    /case "validation":[\s\S]*?<FloppyDiskIcon size=\{22\} weight="regular"/,
  );
  const footerStart = workbench.indexOf('<footer className="processing-footer">');
  const footer = workbench.slice(footerStart, workbench.indexOf("</footer>", footerStart));
  const cancel = footer.indexOf("结束本轮并继续编辑");
  const preview = footer.indexOf("预览已发送 HTML");
  const copy = footer.indexOf("再次复制本轮要求");
  assert.ok(cancel >= 0 && preview > cancel && copy > preview);
  assert.match(
    footer,
    /activeRun\.status === "ready-to-open"[\s\S]*?打开最新版[\s\S]*?稍后处理/,
  );
  assert.match(
    footer,
    /handoffCopyFailed[\s\S]*?重新复制[\s\S]*?取消本轮/,
  );
  assert.match(
    footer,
    /awaiting-conflict-resolution[\s\S]*?采用 AI 版本[\s\S]*?保留外部版本/,
  );
  assert.match(footer, /checkingRun[\s\S]*?查看本轮文件/);
  assert.match(
    footer,
    /terminalRun[\s\S]*?修改要求[\s\S]*?返回编辑/,
  );
  assert.match(
    styles,
    /\.handoff-process-board ol\s*\{[\s\S]*?grid-template-rows:\s*repeat\(4,\s*minmax\(56px,\s*1fr\)\)[\s\S]*?gap:\s*9px/,
  );
  assert.match(
    styles,
    /\.handoff-process-board li\s*\{[\s\S]*?min-height:\s*56px[\s\S]*?grid-template-columns:\s*28px 40px minmax\(0,\s*1fr\) auto[\s\S]*?border-radius:\s*14px/,
  );
  assert.doesNotMatch(
    styles,
    /\.timeline-panel li:not\(:last-child\)::after/,
  );
  assert.match(
    styles,
    /\.process-step-status\[data-state="current"\]\s*\{[\s\S]*?background:\s*#efedff/,
  );
  assert.match(
    styles,
    /\.processing-footer\s*\{[\s\S]*?align-items:\s*flex-start[\s\S]*?padding:\s*0 26px 18px[\s\S]*?border-top:\s*0/,
  );
  assert.match(
    styles,
    /\.processing-header\s*\{[\s\S]*?min-height:\s*84px[\s\S]*?padding:\s*16px 26px/,
  );
  assert.match(
    styles,
    /\.side-drawer\[data-drawer="handoff"\] > \.drawer-body\s*\{[\s\S]*?padding:\s*14px 26px 10px/,
  );
  assert.match(
    styles,
    /\.processing-summary-bar\s*\{[\s\S]*?min-height:\s*58px/,
  );
  assert.match(
    styles,
    /\.processing-footer button\s*\{[\s\S]*?min-height:\s*42px[\s\S]*?border-radius:\s*11px/,
  );
  assert.match(workbench, /正在预览已发送 HTML[\s\S]*?返回等待处理/);
  assert.match(workbench, /const PREVIEW_NAVIGATION_AUTO_COLLAPSE_MS = 3_500/);
  assert.equal(
    [...workbench.matchAll(/<PreviewNavigationBanner/g)].length,
    2,
  );
  assert.match(
    workbench,
    /onMouseMove=\{\(\) => \{[\s\S]*?if \(collapsed\) setCollapsed\(false\)/,
  );
  assert.match(
    workbench,
    /data-handoff-preview=\{runInProgress && handoffPreviewOpen \? "true" : undefined\}/,
  );
  assert.match(
    styles,
    /\[data-handoff-preview="true"\] > \.review-scroll-stage\s*\{[\s\S]*?filter:\s*none;[\s\S]*?opacity:\s*1;/,
  );
  assert.match(
    styles,
    /\.preview-navigation-banner\[data-collapsed="true"\]\s*\{[\s\S]*?translateY\(-100%\)/,
  );
  assert.match(styles, /\.preview-banner-reveal:focus-visible/);
  assert.match(
    styles,
    /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.preview-navigation-banner/,
  );
  const processingHeaderStart = workbench.indexOf(
    '<header className="drawer-header processing-header">',
  );
  const processingHeader = workbench.slice(
    processingHeaderStart,
    workbench.indexOf("</header>", processingHeaderStart),
  );
  assert.doesNotMatch(processingHeader, /关闭处理面板|setDrawer\(null\)/);
  assert.doesNotMatch(processingHeader, /cancelActiveRun|取消发送/);
  assert.match(
    workbench,
    /generating[\s\S]*?\|\| submissionPendingRef\.current[\s\S]*?\|\| !projectLocked[\s\S]*?activeRun\?\.requestId !== "pending"/,
  );
});

test("ending a copied AI run warns clearly and restores editing with a stop reminder", () => {
  assert.match(cancelAiRunDialog, /AI Agent 可能仍在修改/);
  assert.match(
    cancelAiRunDialog,
    /结束本轮后，AI Agent 的修改将不会保存到源页。建议先停止 AI Agent。/,
  );
  assert.doesNotMatch(cancelAiRunDialog, /Qoder(?:Work)?/u);
  assert.match(cancelAiRunDialog, /aria-labelledby="cancel-ai-run-title"/);
  assert.match(cancelAiRunDialog, /aria-describedby="cancel-ai-run-description"/);
  assert.match(
    cancelAiRunDialog,
    /requestAnimationFrame\([\s\S]*?waitButtonRef\.current\?\.focus\(\)[\s\S]*?cancelAnimationFrame\(focusFrame\)/,
  );
  assert.match(
    cancelAiRunDialog,
    /onCancel=\{\(event\) => \{[\s\S]*?event\.preventDefault\(\);[\s\S]*?onClose\(\)/,
  );
  assert.match(
    cancelAiRunDialog,
    /结束本轮并继续编辑[\s\S]*?继续等待/,
  );
  assert.match(
    workbench,
    /currentQoderHandoffStatus === "copied"[\s\S]*?setCancelRunConfirmationKey\(activeRunOperationKey\(activeRun\)\)/,
  );
  assert.match(
    workbench,
    /<CancelAiRunDialog[\s\S]*?cancelActiveRun\(\{ agentMayBeRunning: true \}\)/,
  );
  assert.match(
    workbench,
    /reason: agentMayBeRunning[\s\S]*?"cancelled-by-user-after-agent-handoff"[\s\S]*?"cancelled-by-user"/,
  );
  assert.match(workbench, /本轮已结束，已恢复编辑/);
  assert.match(
    workbench,
    /AI Agent 不会被自动停止；如仍在运行，请手动停止。/,
  );
  assert.match(workbench, /dedupeKey: `ai-run-cancelled:\$\{run\.sourcePath\}`/);
  assert.match(workbench, /disposition: "background-result"/);
  assert.match(styles, /\.cancel-ai-run-dialog::backdrop/);
  assert.match(styles, /\.cancel-ai-run-card button:focus-visible/);
});

test("processing keeps its decision surface dismissible and project navigation available", () => {
  const recoveredRunStart = workbench.indexOf(
    "if (recoveredRun && isLockedLifecycle(recoveredRun.status))",
  );
  const recoveredRunEnd = workbench.indexOf("} else {", recoveredRunStart);
  const recoveredRun = workbench.slice(recoveredRunStart, recoveredRunEnd);
  assert.ok(recoveredRunStart >= 0 && recoveredRunEnd > recoveredRunStart);
  assert.match(
    recoveredRun,
    /projectHydratingRef\.current[\s\S]*?setHandoffPreviewOpen\(false\)[\s\S]*?setCanvasMode\("edit"\)[\s\S]*?setDrawer\("handoff"\)/,
  );
  assert.match(
    workbench,
    /className="project-button"[\s\S]*?disabled=\{projectHydrating \|\| viewTransitioning \|\| attachmentUploadCount > 0\}/,
  );
  assert.match(workbench, /aria-pressed=\{canvasMode === "edit"\}[\s\S]*?disabled=\{browserPreviewOnly \|\| runInProgress \|\| viewMode === "history"\}/);
  assert.match(workbench, /className="global-comment-button"[\s\S]*?disabled=\{interactionLocked \|\| canvasMode !== "edit"\}/);
  assert.match(styles, /\.drawer-overlay\.show\[data-drawer="handoff"\]\s*\{[\s\S]*?pointer-events:\s*none/);
  assert.doesNotMatch(workbench, /aria-modal=\{drawer === "handoff"/);
  assert.match(
    workbench,
    /if \(!drawer \|\| previewAttachment\) return(?: undefined)?;[\s\S]*?event\.key === "Escape"[\s\S]*?setDrawer\(null\)/,
  );
  assert.match(
    styles,
    /\.workbench\[data-round-state="processing"\] > \.review-scroll-stage\s*\{[\s\S]*?opacity:\s*0\.38/,
  );
  assert.match(
    workbench,
    /className="project-file-editor"[\s\S]*?disabled=\{fileView\.loading \|\| runInProgress\}/,
  );
  assert.match(workbench, /结束本轮并继续编辑/);
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
  assert.match(
    workbench,
    /browserPreviewOnly[\s\S]*?"操作不会保存"[\s\S]*?persistState === "idle"[\s\S]*?"已安全保存"[\s\S]*?: persistLabel/,
  );
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
  assert.match(flush, /bridgeClient\.autosave\(/);
  assert.match(workbench, /bridgeClient\.ensureProject\(/);
  assert.match(bridgeClient, /"\/autosave"/);
  assert.match(bridgeClient, /"\/project\/ensure"/);
  assert.match(
    bridgeClient,
    /const command = \([\s\S]*?timeoutMs = DEFAULT_WRITE_TIMEOUT_MS/,
  );
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
    /submissionIntentRef\.current\?\.token !== submissionIntent\.token[\s\S]*?projectEpochRef\.current !== submissionIntent\.epoch[\s\S]*?!sameLocalSourcePath\(sourcePathRef\.current, submissionIntent\.sourcePath\)/,
  );
  assert.match(workbench, /qoderHandoffStatesRef\s*=\s*useRef<Map<string, ProjectQoderHandoffState>>/);
  assert.match(workbench, /activatingRunsRef = useRef<Set<string>>/);
  assert.doesNotMatch(workbench, /waivingRunsRef|\/validation\/waive/);
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

test("forward edit events remain exact-once after persistence starts", () => {
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
  assert.match(workbench, /const nextEvents = appendDirectEditEvent\(\{/);
  assert.match(workbench, /inFlightKeys: auditInFlightKeysRef\.current/);
  assert.match(workbench, /persistCurrentDraftRecovery\(commentsRef\.current, nextEvents\.events\)/);
  assert.doesNotMatch(workbench, /undoFolds|redoFolds|undoesEventId/u);
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
    /const revealVersionInFinder = useCallback[\s\S]*?withOneAutomaticRetry\(\(\) => revealVersionFile\(\{[\s\S]*?versionId: version\.id/,
  );
  assert.match(
    workbench,
    /window\.htmlAIProjects\?\.revealVersionFile[\s\S]*?onClick=\{\(\) => void revealVersionInFinder\(version\)\}[\s\S]*?Finder/,
  );
  assert.match(styles, /\.version-list\s*\{[\s\S]*?border-radius:\s*15px/);
  assert.match(styles, /\.version-row\s*\{[\s\S]*?grid-template-columns:\s*42px minmax\(0, 1fr\) auto 14px/);
  assert.doesNotMatch(workbench, /const restoreVersion|\/restore|设为当前 HTML/);
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
    /const projectRecord = isRecord\(payload\.project\)[\s\S]*?if \(projectRecord\.displayName\) \{[\s\S]*?setProjectName\(String\(projectRecord\.displayName\)\)/,
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
    /className="window-file-title-row"[\s\S]*?role=\{fileRenameEditing \? undefined : "status"\}[\s\S]*?aria-live=\{fileRenameEditing \? undefined : "polite"\}[\s\S]*?aria-atomic=\{fileRenameEditing \? undefined : "true"\}[\s\S]*?className="window-file-title-action"[\s\S]*?\{currentSourceFileStem\}/,
  );
  assert.match(
    workbench,
    /aria-live=\{fileRenameEditing \? undefined : "polite"\}[\s\S]*?aria-atomic=\{fileRenameEditing \? undefined : "true"\}/u,
  );
  assert.match(
    workbench,
    /label: displayVersionLabel\(Number\(manifest\.versionOrdinal\)\)/,
  );
  assert.match(workbench, /return match \? `版本 \$\{Number\(match\[1\]\)\}`/);
});

test("a safely saved source can be renamed in place without exposing its extension", () => {
  assert.match(
    workbench,
    /const canOfferFileRename = Boolean\([\s\S]*?window\.htmlAIProjects\?\.renameHtml[\s\S]*?persistState === "idle"[\s\S]*?editRevision === lastPersistedRevision/,
  );
  assert.match(
    workbench,
    /const commitFileRename = useCallback[\s\S]*?drainCoordinatorRef\.current\.drain\("switch"[\s\S]*?renameFile\(\{[\s\S]*?operationId,[\s\S]*?sourcePath: previousSourcePath,[\s\S]*?stem: requestedStem,[\s\S]*?expectedSha256/,
  );
  assert.match(
    workbench,
    /className="window-file-title-action"[\s\S]*?title="双击重命名文件"[\s\S]*?onDoubleClick=\{beginFileRename\}/,
  );
  assert.match(
    workbench,
    /className="window-file-rename-field"[\s\S]*?aria-label="文件名（不含后缀）"[\s\S]*?\{currentSourceFileExtension\}/,
  );
  assert.match(
    workbench,
    /className="workbench-header"[\s\S]*?data-file-renaming=\{fileRenameEditing \? "true" : undefined\}/,
  );
  assert.match(
    workbench,
    /event\.key === "Enter"[\s\S]*?commitFileRename\(\)[\s\S]*?event\.key === "Escape"[\s\S]*?cancelFileRename\(\)/,
  );
  assert.match(
    styles,
    /\.workbench-header\[data-file-renaming="true"\]\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/,
  );
  assert.match(
    styles,
    /\.window-file-rename-field\s*\{[\s\S]*?border:\s*1px solid #c8c4ef[\s\S]*?border-radius:\s*7px/,
  );
  assert.match(
    styles,
    /\.window-file-rename-icon\s*\{[\s\S]*?opacity:\s*0[\s\S]*?\.window-file-title-action:hover \.window-file-rename-icon[\s\S]*?opacity:\s*0\.78/,
  );
});

test("the filename keeps distinct quick actions with non-layout tooltips", () => {
  assert.match(
    workbench,
    /className="window-file-quick-actions"[\s\S]*?className="window-file-quick-action"[\s\S]*?data-tooltip="打开本地HTML"[\s\S]*?aria-label="打开新的本地 HTML"[\s\S]*?onClick=\{\(\) => void openProject\(\)\}[\s\S]*?<PlusIcon[\s\S]*?data-tooltip="在默认浏览器中打开"[\s\S]*?onClick=\{\(\) => void openCurrentHtmlInDefaultBrowser\(\)\}[\s\S]*?<ArrowSquareOutIcon/,
  );
  assert.match(
    styles,
    /\.window-file-quick-actions\s*\{[\s\S]*?display:\s*inline-flex[\s\S]*?flex:\s*none/,
  );
  assert.match(
    styles,
    /\.window-file-quick-action\s*\{[\s\S]*?position:\s*relative[\s\S]*?width:\s*28px[\s\S]*?height:\s*28px[\s\S]*?color:\s*#6c65d5/,
  );
  assert.match(
    styles,
    /\.window-file-quick-action::after\s*\{[\s\S]*?content:\s*attr\(data-tooltip\)[\s\S]*?position:\s*absolute[\s\S]*?border:\s*1px solid #e1e2e8[\s\S]*?background:\s*rgb\(255 255 255 \/ 98%\)[\s\S]*?color:\s*#555864[\s\S]*?pointer-events:\s*none/,
  );
  const tooltipRule = styles.match(
    /\.window-file-quick-action::after\s*\{([\s\S]*?)\n\}/u,
  );
  assert.ok(tooltipRule);
  assert.doesNotMatch(tooltipRule[1], /rgb\(35 36 44|#000|black/u);
  assert.match(
    styles,
    /\.window-file-quick-action:hover::after,\s*\.window-file-quick-action:focus-visible::after\s*\{[\s\S]*?opacity:\s*1/,
  );
  assert.match(
    styles,
    /\.window-file-quick-action:disabled\s*\{[\s\S]*?opacity:\s*1[\s\S]*?\.window-file-quick-action:disabled > svg\s*\{[\s\S]*?opacity:\s*0\.48/,
  );
  assert.match(
    styles,
    /\.workbench\s*\{[\s\S]*?--notice-header-height:\s*88px/,
  );
  assert.match(
    workbench,
    /const openInDefaultBrowser = window\.htmlAIProjects\?\.openInDefaultBrowser[\s\S]*?withOneAutomaticRetry\(\(\) => openInDefaultBrowser\(activeSourcePath\)\)/,
  );
  const browserOpenFlow = workbench.slice(
    workbench.indexOf("const openCurrentHtmlInDefaultBrowser"),
    workbench.indexOf("const cancelFileRename"),
  );
  const browserOpenFence = browserOpenFlow.indexOf(
    "editorRef.current?.fencePendingEdit({",
  );
  const browserOpenFenceGuard = browserOpenFlow.indexOf(
    "if (!committed || !committed.ok)",
    browserOpenFence,
  );
  const browserOpenEnqueue = browserOpenFlow.indexOf(
    "enqueueAutosave(",
    browserOpenFenceGuard,
  );
  const browserOpenFlush = browserOpenFlow.indexOf(
    "await flushAutosave(launchRevision)",
    browserOpenEnqueue,
  );
  const browserOpenPersistenceGuard = browserOpenFlow.indexOf(
    "lastPersistedRevisionRef.current < launchRevision",
    browserOpenFlush,
  );
  const browserOpenBridge = browserOpenFlow.indexOf(
    "openInDefaultBrowser(activeSourcePath)",
    browserOpenPersistenceGuard,
  );
  assert.match(
    browserOpenFlow.slice(browserOpenFence, browserOpenFenceGuard),
    /resumeEditing: true,[\s\S]*?trigger: "save"/u,
  );
  assert.ok(
    browserOpenFence >= 0
      && browserOpenFenceGuard > browserOpenFence
      && browserOpenEnqueue > browserOpenFenceGuard
      && browserOpenFlush > browserOpenEnqueue
      && browserOpenPersistenceGuard > browserOpenFlush
      && browserOpenBridge > browserOpenPersistenceGuard,
    "default-browser launch must fence, enqueue and acknowledge the exact source revision before IPC",
  );
  assert.match(
    workbench,
    /!canOpenCurrentHtmlInDefaultBrowser[\s\S]*?persistState !== "idle"[\s\S]*?editRevision !== lastPersistedRevision/,
  );
});

test("project panel keeps actions clear without technical paths in the header", () => {
  assert.match(workbench, /className="project-button"[\s\S]*?项目/);
  assert.match(workbench, /const closeFileView = useCallback/);
  assert.match(workbench, /if \(!await closeFileView\(\)\) return;[\s\S]*?setDrawer\("files"\)/);
  assert.match(workbench, /className="current-project-card"/);
  assert.match(workbench, /导出 HTML 副本/);
  assert.match(workbench, />打开本地 HTML</);
  assert.match(workbench, /项目记录文件夹/);
  assert.match(workbench, /查看每轮要求、AI 返回与历史文件/);
  assert.match(workbench, /bridgeClient\.openFolder/);
  assert.match(bridgeClient, /"\/open-folder"/);
  assert.match(workbench, /以后每次 AI 修改都会读取/);
  assert.match(workbench, /规则只影响后续任务，不会修改当前 HTML/);
  assert.match(workbench, /修改会自动保存/);
  assert.doesNotMatch(workbench, /项目规则还有未保存修改/);
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

test("user-opened HTML stays lazily registered until a real project action", () => {
  assert.match(workbench, /bridgeClient\.ensureProject/);
  assert.match(bridgeClient, /"\/project\/ensure"/);
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
    /draftSessionRef\.current\.replaceAuthority\([\s\S]*?registeredContext[\s\S]*?authoritativeDraftRevision/,
  );
  assert.match(
    workbench,
    /!draftSessionRef\.current\.isActive\(context\)[\s\S]*?ensureProjectRegistered/,
  );
  assert.match(
    workbench,
    /const generateRequest = useCallback[\s\S]*?await ensureProjectRegistered\(\)/,
  );
  assert.match(
    workbench,
    /let activeComments = normalizeCurrentGlobalComments\(\)[\s\S]*?await ensureProjectRegistered\(\)[\s\S]*?activeComments = normalizeCurrentGlobalComments\(\)/,
  );
  assert.match(
    workbench,
    /const drained = await drainCoordinatorRef\.current\.drain\("submit"[\s\S]*?const persistedComments = commentsRef\.current\.filter\(commentHasContent\)[\s\S]*?submissionContext\.comments = persistedComments\.map[\s\S]*?submissionContext\.changeEvents = changeEventsRef\.current\.map/,
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
  assert.match(
    workbench,
    /await refreshWorkspace\(active\.sourcePath, epoch, false, epoch\);[\s\S]*?await refreshRecents\(\)/,
  );
  assert.match(workbench, /上次打开的 HTML 无法恢复/);
  assert.match(workbench, /文件可能已移动、删除或损坏/);
  assert.match(workbench, /className="startup-issue" role="alert"/);
  assert.match(workbench, />\s*选择其他 HTML\s*</);
});

test("comment composer is explicit, transient and horizontally contained", () => {
  const unifiedSurfaceStyles = styles.slice(styles.indexOf("PageRoot V5.1"));
  assert.match(workbench, /composerInCurrentTab && draftTarget && !interactionLocked \?/);
  assert.match(workbench, /setComposerOpen\(true\)/);
  assert.match(workbench, /setComposerOpen\(false\)/);
  assert.match(workbench, /draftTargetRef\.current\?\.id === target\.id/);
  assert.match(workbench, /if \(!resumesRecoveredDraft\)/);
  assert.match(workbench, /className="comment-card draft-comment-card"/);
  assert.match(workbench, /className="comment-header-action unsaved-comment-shortcut"/);
  assert.match(workbench, /const draftInOtherTab = hasCommentDraft && draftTargetInOtherTab/);
  assert.match(workbench, /className="unsaved-comment-status">未保存/);
  assert.match(workbench, /beginTargetRelink\("__composer"\)/);
  assert.match(workbench, /评论和附件仍保留，重新关联后即可发送/);
  assert.match(workbench, /recoveredDraftTarget\.id !== target\.id/);
  assert.match(workbench, /上一条评论还未保存/);
  assert.match(workbench, /请先点击“评论”保存；保存后仍可修改/);
  assert.match(workbench, /const resumeCurrentComposer = useCallback/);
  assert.match(
    workbench,
    /const recoveredComposerTarget = recoveredDraft\.composerTarget[\s\S]*?setDraftTarget\(recoveredComposerTarget\);[\s\S]*?setComposerOpen\(false\);/,
  );
  assert.doesNotMatch(workbench, /saved-comment-drafts|review-comment-drafts/);
  assert.match(workbench, /const activeCommentCount = activeCommentItems\.length/);
  assert.match(workbench, /const pendingSendItemCount = activeCommentCount;/);
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
    workbench.indexOf(") : hasCollapsedCommentDraft && draftTarget ? ("),
  );
  assert.doesNotMatch(composer, /targetResolutionLabel|className="target-resolution"/);
  assert.match(composer, /aria-label="删除未保存评论"/);
  assert.match(composer, /删除这条未保存评论？/);
  assert.match(workbench, /const discardCurrentComposer = useCallback/);
  assert.match(
    workbench,
    /discardedCommentId[\s\S]*?deletedCommentIdsRef\.current\.add\(discardedCommentId\)/,
  );
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
  assert.match(workbench, /layoutCommentRailItems\(\{/);
  assert.doesNotMatch(workbench, /const focusKey =|deferredItems\.unshift\(item\)/);
  assert.match(workbench, /queueReviewPairReveal\(target, "__composer"\)/);
  const canvasSelectionHandler = workbench.slice(
    workbench.indexOf("const handleCanvasSelection = useCallback"),
    workbench.indexOf("const readWorkspaceFile = useCallback"),
  );
  assert.match(canvasSelectionHandler, /updateFocusedComment\(nextComment\.commentId\)/);
  assert.doesNotMatch(canvasSelectionHandler, /queueReviewPairReveal|queueReviewCommentFocus/);
  assert.match(workbench, /data-focused=\{focusedCommentId === comment\.commentId/);
  assert.match(workbench, /aria-current=\{focusedCommentId === comment\.commentId \? "location"/);
  assert.match(
    unifiedSurfaceStyles,
    /\.comment-rail-content > \.comment-card\[data-focused="true"\],/,
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

test("comment cards show one two-line target label without duplicate copy", () => {
  assert.doesNotMatch(workbench, /<q\b|可添加附件/u);
  assert.match(
    workbench,
    /<span className="comment-target">\{insertionLabel\(comment\.target\)\}<\/span>/u,
  );
  assert.match(
    workbench,
    /<strong>\{insertionLabel\(comment\.target\)\}<\/strong>[\s\S]*?<p>\{comment\.text/u,
  );
  assert.match(
    styles,
    /\.comment-card-header \.comment-target\s*\{[\s\S]*?-webkit-line-clamp:\s*2/u,
  );
  assert.match(
    styles,
    /\.round-comment-list strong\s*\{[\s\S]*?-webkit-line-clamp:\s*2/u,
  );
  assert.match(
    workbench,
    /\{comment\.attachments\?\.length \? \([\s\S]*?\{comment\.attachments\.length\} 个附件/u,
  );
});

test("comment cards keep one visual boundary and reveal compact actions progressively", () => {
  const footerRule = styles.match(/\.comment-card-footer\s*\{(?<rule>[^}]*)\}/u)
    ?.groups?.rule;
  assert.ok(footerRule);
  assert.match(footerRule, /height:\s*0/u);
  assert.match(footerRule, /min-height:\s*0/u);
  assert.match(footerRule, /margin-top:\s*0/u);
  assert.match(footerRule, /padding:\s*0/u);
  assert.match(footerRule, /border:\s*0/u);
  assert.match(footerRule, /opacity:\s*0/u);
  assert.match(footerRule, /pointer-events:\s*none/u);
  assert.doesNotMatch(footerRule, /border-top/u);
  assert.match(
    styles,
    /\.comment-card:hover \.comment-card-footer,[\s\S]*?\.comment-card:focus-within \.comment-card-footer,[\s\S]*?\.comment-card\[data-editing="true"\] \.comment-card-footer\s*\{[\s\S]*?height:\s*30px;[\s\S]*?margin-top:\s*6px;[\s\S]*?opacity:\s*1;[\s\S]*?pointer-events:\s*auto/u,
  );
  assert.match(
    styles,
    /\.comment-card > p\s*\{[\s\S]*?font-size:\s*14px/u,
  );

  const editorRuleStart = styles.lastIndexOf(".comment-card .comment-edit-textarea {");
  assert.notEqual(editorRuleStart, -1);
  const editorRule = styles.slice(editorRuleStart, styles.indexOf("}", editorRuleStart) + 1);
  assert.match(editorRule, /border:\s*0/u);
  assert.match(editorRule, /background:\s*#f5f6f8/u);
  assert.match(editorRule, /font-size:\s*14px/u);
  assert.match(editorRule, /box-shadow:\s*inset 0 -2px 0 transparent/u);
  assert.match(
    styles,
    /\.comment-card \.comment-edit-textarea:focus,[\s\S]*?\.comment-card \.comment-edit-textarea:focus-visible\s*\{[\s\S]*?outline:\s*0;[\s\S]*?box-shadow:\s*inset 0 -2px 0 #8f8ae8/u,
  );

  const singleBoundaryRule = styles.match(
    /\.comment-rail-content > \.comment-card\[data-focused="true"\],[\s\S]*?\.comment-rail-content > \.comment-card:focus-visible\s*\{(?<rule>[^}]*)\}/u,
  )?.groups?.rule;
  assert.ok(singleBoundaryRule);
  assert.match(singleBoundaryRule, /outline:\s*0/u);
  assert.match(singleBoundaryRule, /box-shadow:\s*0 15px 32px rgb\(45 42 104 \/ 7%\)/u);
  assert.match(singleBoundaryRule, /animation:\s*none/u);
  assert.doesNotMatch(singleBoundaryRule, /0 0 0/u);
  assert.match(workbench, /data-editing=\{editing \? "true" : undefined\}/u);
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
