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
  assert.match(sampleHtml, /看得见地改，<span>留在源码里。<\/span>/);
  assert.match(sampleHtml, /真实 HTML 是唯一事实源/);
  assert.match(sampleHtml, /打开一份 HTML，开始一次有边界的修改/);
  assert.match(sampleHtml, /这是一张可以试操作的内置介绍页/);
  assert.doesNotMatch(sampleHtml, /利率拐点前的仓位选择|美国 10 年期|市场策略周报/);
});

test("project switcher matches the visual project menu and exposes folders safely", () => {
  const nextVersionStyles = styles.slice(styles.indexOf("/* Next-version shell"));
  assert.match(workbench, /brand-logo\.png/);
  assert.match(workbench, /CaretDownIcon/);
  assert.match(workbench, /FileTextIcon/);
  assert.match(workbench, /TriangleIcon/);
  assert.match(workbench, />当前项目</);
  assert.match(workbench, />打开本地 HTML…</);
  assert.match(workbench, />最近打开</);
  assert.doesNotMatch(workbench, />新建 HTML</);
  assert.doesNotMatch(workbench, /api\.newHtml/);
  assert.match(workbench, /folderFromSourcePath\(sourcePath\)/);
  assert.match(workbench, /在 Finder 中显示/);
  assert.match(workbench, /api\.showInFolder\(activeSourcePath\)/);
  assert.match(workbench, /formatProjectTimestamp\(project\.lastOpenedAt\)/);
  assert.doesNotMatch(workbench, /formatRecentProjectTimestamp/);
  assert.match(nextVersionStyles, /grid-template-rows:\s*56px minmax\(0, 1fr\)/);
  assert.match(styles, /\.project-switcher\s*\{[\s\S]*?border:\s*0/);
  assert.match(styles, /\.project-switcher\s*\{[\s\S]*?width:\s*fit-content/);
  assert.match(styles, /\.project-menu-file\s*\{[\s\S]*?min-height:\s*44px/);
  assert.match(styles, /\.project-menu-pointer/);
  assert.match(styles, /\.current-project-file/);
  assert.match(workbench, /onInteraction=\{\(\) => setProjectMenuOpen\(false\)\}/);
  assert.match(workbench, /ref=\{projectSwitcherRef\}[\s\S]*?className="project-switcher"/);
  assert.match(workbench, /ref=\{projectMenuRef\}[\s\S]*?className="project-menu"/);
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
  const nextVersionStyles = styles.slice(styles.indexOf("/* Next-version shell"));
  assert.doesNotMatch(workbench, /className="canvas-guide"/);
  assert.doesNotMatch(workbench, /修改会自动写回源文件|单击选择，双击文字修改/);
  assert.match(workbench, /className="canvas-edit-status"[\s\S]*?本地文本编辑会直接修改源文件并保存/);
  assert.match(workbench, /height="calc\(100vh - 56px\)"/);
  assert.match(
    styles,
    /\.header-actions button,[\s\S]*?font-weight:\s*650/,
  );
  assert.match(nextVersionStyles, /\.canvas-edit-status\s*\{[\s\S]*?height:\s*27px/);
  assert.match(nextVersionStyles, /\.canvas-edit-status::before\s*\{[\s\S]*?width:\s*5px/);
});

test("editing and interactive preview are separate canvas modes", () => {
  assert.match(workbench, /type CanvasMode = "edit" \| "preview"/);
  assert.match(workbench, /data-canvas-mode=\{canvasMode\}/);
  assert.match(workbench, /className="canvas-mode-switch"[\s\S]*?>编辑<\/button>[\s\S]*?>预览<\/button>/);
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
  assert.match(workbench, /\{canvasMode === "edit" \? \(\s*<aside className="comments-panel"/);
  assert.match(workbench, /setCanvasMode\("edit"\);\s*setDrawer\("history"\)/);
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
  assert.doesNotMatch(interactionPreview, /隔离交互预览|运行时 DOM、表单和存储不会写回源码/);
  assert.doesNotMatch(interactionPreview, /onChange|HtmlCanvasEditor|disableExecutableMarkup/);
  assert.match(interactionPreviewStyles, /\.preview\s*\{[\s\S]*?grid-template-rows:\s*36px minmax\(0, 1fr\)/);

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

test("header keeps the project next to the GitHub logo and only shows new when available", () => {
  assert.match(workbench, /className="brand"/);
  assert.match(workbench, /className="update-badge"/);
  assert.match(workbench, />new!<\/span>/);
  assert.match(workbench, /window\.htmlAIUpdates/);
  assert.match(workbench, /updates\.getStatus\(\)/);
  assert.match(workbench, /updates\.onStatus\(receiveStatus\)/);
  assert.match(workbench, /openProjectRepository\(\)/);
  assert.doesNotMatch(
    workbench,
    /app-version-button|检查更新|<strong>(?:YuanYe|PageRoot)<\/strong>/,
  );
  assert.match(styles, /\.update-badge\s*\{[\s\S]*?position:\s*absolute/);
  assert.match(styles, /\.update-badge\s*\{[\s\S]*?right:\s*-6px[\s\S]*?bottom:\s*-4px/);
  assert.match(mainProcess, /scheduleAutomaticUpdateCheck\(\)/);
  assert.match(mainProcess, /PROJECT_REPOSITORY_URL/);
  assert.doesNotMatch(preload, /openProjectRepository:\s*\([^)]*url/);
});

test("QoderWork handoff exposes a truthful process board and manual open action", () => {
  assert.match(workbench, /已复制，可粘贴至 QoderWork/);
  assert.match(workbench, /查看本轮处理/);
  assert.match(workbench, /再次复制评论/);
  assert.match(workbench, /仅确认已写入剪贴板，不代表 AI 已收到/);
  assert.match(workbench, /本轮要求已冻结/);
  assert.match(workbench, /身份、Hash 与文件完整性/);
  assert.match(workbench, /范围与质量校验/);
  assert.match(workbench, /无视本校验，继续/);
  assert.match(workbench, /当前左侧仍是旧版；点击后才会切换。/);
  assert.match(workbench, /打开 Qoder 返回的最新版/);
  const sendToQoderStart = workbench.indexOf("const sendToQoderWork = useCallback");
  const sendToQoderEnd = workbench.indexOf("const revealActiveRunInFinder", sendToQoderStart);
  const sendToQoderWork = workbench.slice(sendToQoderStart, sendToQoderEnd);
  assert.match(sendToQoderWork, /setQoderHandoffState\(\{ requestId, status: "copied" }\)/);
  assert.doesNotMatch(sendToQoderWork, /setDrawer\("handoff"\)|tone: "success"/);
  assert.match(
    workbench,
    /runInProgress \? \([\s\S]*?qoder-logo\.png[\s\S]*?currentQoderHandoffStatus/,
  );
  assert.match(workbench, /window\.htmlAIIntegrations/);
  assert.match(workbench, /integrations\.handoffToQoderWork/);
  assert.match(
    sendToQoderWork,
    /result\.status !== "copied" \|\| result\.copied !== true/u,
  );
  assert.match(
    workbench,
    /await sendToQoderWork\(durableRun\.handoffMessage, durableRun\.requestId\)/,
  );
  assert.match(workbench, /等待 AI 写回受控文件/);
  assert.doesNotMatch(workbench, /QoderWork 已打开|已粘贴至 QoderWork|自动发送消息/);
  assert.match(workbench, /在 Finder 中查看本轮文件/);
  assert.match(workbench, /revealRequestFolder/);
  assert.match(workbench, /className="handoff-history"/);
  assert.match(workbench, />本轮记录</);
  assert.match(workbench, />源页原始评论</);
  assert.match(workbench, />本地编辑</);
  assert.match(workbench, />内部 AI 对话补充</);
  assert.match(workbench, />AI 结果与校验</);
  assert.match(workbench, /"先不发送，继续编辑评论"/);
  assert.doesNotMatch(workbench, />取消本轮<\/button>/);
  assert.match(
    workbench,
    /<details[\s\S]*?aria-label="本轮评论"[\s\S]*?<summary className="handoff-history-heading">/,
  );
  assert.match(
    workbench,
    /<details[\s\S]*?aria-label="本轮页面修改"\s*>[\s\S]*?<summary className="handoff-history-heading">/,
  );
  const handoffPanel = workbench.slice(
    workbench.indexOf('{drawer === "handoff" ?'),
    workbench.indexOf('<div', workbench.indexOf('{drawer === "handoff" ?') + 1_000),
  );
  assert.doesNotMatch(handoffPanel, /activeRun\.requestId\}\s*\/\s*\{activeRun\.attemptId/);
  assert.doesNotMatch(handoffPanel, /查看本轮目录/);
  assert.match(
    workbench,
    /if \(!runInProgress\)[\s\S]*?void generateRequest\(\);[\s\S]*?setDrawer\("handoff"\)/,
  );
  assert.match(
    workbench,
    /runInProgress[\s\S]*?如有任何建议和问题，请钉钉联系<strong>竺可<\/strong>。/,
  );
});

test("processing keeps project rules, history, and HTML export available", () => {
  assert.match(
    workbench,
    /<nav className="header-actions"[\s\S]*?disabled=\{\s*projectHydrating \|\| viewTransitioning \|\| Boolean\(projectLoadError\)/,
  );
  assert.doesNotMatch(
    workbench,
    /<nav className="header-actions"[\s\S]{0,900}disabled=\{\s*runInProgress/,
  );
  assert.match(
    workbench,
    /disabled=\{projectHydrating \|\| viewTransitioning\}[\s\S]*?exportCurrentHtml/,
  );
  assert.match(workbench, /textarea[\s\S]*?disabled=\{runInProgress\}/);
});

test("header keeps persistence state concise without a redundant history suffix", () => {
  assert.doesNotMatch(workbench, /currentIdentity/);
  assert.match(workbench, /className="save-indicator"/);
  assert.match(workbench, /\{viewMode === "history"/);
  assert.match(workbench, /: persistLabel\}/);
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

test("history separates the editable current HTML from immutable versions", () => {
  assert.match(workbench, /className="current-work-history"/);
  assert.match(workbench, /当前 HTML 可编辑；历史版本保持只读/);
  assert.match(workbench, /首次编辑或发送给 AI 后，会建立版本 1/);
  assert.match(workbench, /本地编辑不会自动生成新版本；发送至 QoderWork 并成功完成后/);
  assert.match(
    workbench,
    /\{activeCommentCount\} 条评论 · \{summarizedChangeEvents\.length\} 项修改/,
  );
  assert.match(workbench, /historyRecordValue\(event, event\.before\)/);
  assert.match(workbench, /完整审计仍保存在项目记录中/);
  assert.match(workbench, /历史基线与 AI 版本/);
  assert.doesNotMatch(workbench, /版本历史\{latestVersion/);
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
    /window\.htmlAIProjects\?\.revealVersionFile[\s\S]*?onClick=\{\(\) => void revealVersionInFinder\(version\)\}[\s\S]*?>在 Finder 中显示<\/button>/,
  );
  assert.match(styles, /\.side-drawer\s*\{[\s\S]*?width:\s*min\(420px, calc\(100vw - 24px\)\)/);
  assert.match(styles, /\.drawer-body\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(
    styles,
    /\.history-record > \.history-change-values\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
  assert.match(
    styles,
    /\.history-record > \.history-change-values del,[\s\S]*?white-space:\s*pre-wrap/,
  );
  assert.match(
    styles,
    /\.history-item-heading strong,[\s\S]*?overflow-wrap:\s*anywhere[\s\S]*?white-space:\s*normal/,
  );
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
  assert.match(workbench, /QoderWork 返回的新文件已打开/u);
  assert.doesNotMatch(workbench, /className="ai-file-opened-card"/u);
  assert.match(workbench, /原文件已保留/u);
  assert.match(workbench, /aria-live="polite"[\s\S]*?aria-atomic="true"/u);
  assert.match(
    workbench,
    /label: displayVersionLabel\(Number\(manifest\.versionOrdinal\)\)/,
  );
  assert.match(workbench, /return match \? `版本 \$\{Number\(match\[1\]\)\}`/);
});

test("project files keep paths, rules, and technical records concise", () => {
  assert.match(workbench, />项目文件<\/button>/);
  assert.match(
    workbench,
    /setFileView\(null\);\s*setDrawer\("files"\)/,
  );
  assert.match(workbench, /当前页面与项目记录的位置/);
  assert.match(workbench, /className="project-locations"/);
  assert.match(workbench, />当前 HTML</);
  assert.match(workbench, />项目记录</);
  assert.match(workbench, /在 Finder 中显示当前 HTML/);
  assert.match(workbench, /在 Finder 中打开项目记录/);
  assert.match(workbench, /BRIDGE_URL\}\/open-folder/);
  assert.match(workbench, /首次编辑或发送给 AI 后创建/);
  assert.match(workbench, /仅打开不会改动源文件/);
  assert.match(workbench, /用于以后每次 AI 修改/);
  assert.match(workbench, /<details className="technical-files">/);
  assert.match(workbench, />技术记录<\/summary>/);
  assert.match(workbench, />本轮 Prompt</);
  assert.match(workbench, />本轮修改要求</);
  assert.match(workbench, />本轮 AI 规则</);
  assert.doesNotMatch(workbench, /<strong>\{activeRun\.requestId\}/);
  assert.doesNotMatch(workbench, /<code>[\s\S]*?version\.requestId/);
  assert.doesNotMatch(workbench, /shortHash\(viewingVersion\.contentSha256\)/);
  assert.match(styles, /\.project-location-card\s*\{/);
  assert.match(styles, /\.technical-files\s*\{/);
  assert.match(styles, /\.project-location-path\s*\{[\s\S]*?-webkit-line-clamp:\s*2/);
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
  assert.match(workbench, /composerOpen && draftTarget \?/);
  assert.match(workbench, /setComposerOpen\(true\)/);
  assert.match(workbench, /setComposerOpen\(false\)/);
  assert.match(workbench, /draftTargetRef\.current\?\.id === target\.id/);
  assert.match(workbench, /if \(!resumesRecoveredDraft\)/);
  assert.match(workbench, /className="draft-recovery-card"/);
  assert.match(workbench, />继续填写</);
  assert.match(workbench, />放弃</);
  assert.match(workbench, /recoveredDraftTarget\.id !== target\.id/);
  assert.match(workbench, /const activeCommentCount = activeCommentItems\.length/);
  assert.match(workbench, /if \(!commentHasContent\(comment\)\) deleteComment\(comment\.commentId\)/);
  assert.match(workbench, />发送评论</);
  assert.match(workbench, /onClick=\{closeCommentComposer\}/);
  assert.doesNotMatch(
    workbench,
    /onSelect=\{\(target\) => \{[\s\S]{0,160}setDraftTarget\(target\)/,
  );
  assert.doesNotMatch(workbench, /className="comment-action locate-comment"/);
  assert.match(workbench, /onClick=\{\(\) => \{[\s\S]*focusCommentTarget\(comment\.target\)/);
  assert.match(workbench, /event\.key === "Enter" && !event\.shiftKey/);
  assert.doesNotMatch(workbench, /自动记录 · ⌘ Enter 发送/);
  assert.doesNotMatch(workbench, /comment-target[\s\S]{0,300}targetResolutionLabel/);
  const composer = workbench.slice(
    workbench.indexOf('className="comment-composer"'),
    workbench.indexOf('className="draft-recovery-card"'),
  );
  assert.doesNotMatch(composer, /targetResolutionLabel|className="target-resolution"/);
  assert.doesNotMatch(workbench, /<header className="comments-header">[\s\S]{0,900}<b>\{activeCommentCount\}<\/b>/);
  assert.match(styles, /\.comment-list\s*\{[\s\S]*?overflow-x:\s*hidden/);
  assert.match(styles, /\.comment-list\s*\{[\s\S]*?grid-row:\s*3/);
  assert.match(styles, /\.comment-list\s*\{[\s\S]*?grid-auto-rows:\s*max-content/);
  assert.match(styles, /\.comments-footer\s*\{[\s\S]*?grid-row:\s*4/);
  assert.match(styles, /\.comment-card\s*\{[\s\S]*?min-width:\s*0[\s\S]*?overflow:\s*hidden/);
  assert.match(styles, /\.comment-card-actions\s*\{/);
  assert.doesNotMatch(styles, /\.locate-comment\s*\{/);
  assert.match(styles, /\.delete-comment\s*\{/);
  assert.match(workbench, /editorRef\.current\?\.select\(target, \{ showToolbar: false \}\)/);
});

test("comment attachments support paste, upload, removal, preview, and AI handoff metadata", () => {
  assert.match(workbench, /PaperclipIcon/);
  assert.match(workbench, />添加图片或文件</);
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
  assert.match(
    workbench,
    /onKeyDown=\{\(event\) => \{\s*if \(event\.target !== event\.currentTarget\) return;/,
  );
  assert.match(workbench, /attachmentRefs: \(comment\.attachments \?\? \[\]\)/);
  assert.match(workbench, /attachments: comment\.attachments\.map\(persistedAttachment\)/);
  assert.doesNotMatch(workbench, /\boriginalPath\b|\bfile\.path\b/);
  assert.match(styles, /\.image-attachment:hover \.remove-attachment-button/);
  assert.match(styles, /\.image-attachment-preview:focus-visible/);
  assert.match(styles, /\.file-attachment-open strong\s*\{[\s\S]*?text-overflow:\s*ellipsis/);
  assert.match(styles, /\.attachment-lightbox\s*\{[\s\S]*?position:\s*fixed/);
});
