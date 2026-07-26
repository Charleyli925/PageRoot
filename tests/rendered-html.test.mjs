import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const productRoot = new URL("../", import.meta.url);

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the autosave-first workbench entry points", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>源页<\/title>/i);
  assert.match(
    html,
    /<link[^>]+rel=["']icon["'][^>]+href=["']\/favicon\.png["'][^>]*>/i,
  );
  assert.match(
    html,
    /<meta[^>]+property=["']og:image["'][^>]+content=["'][^"']*\/brand-logo\.png["'][^>]*>/i,
  );
  assert.match(
    html,
    /<meta[^>]+name=["']twitter:card["'][^>]+content=["']summary_large_image["'][^>]*>/i,
  );
  const faviconInfo = await import("node:fs/promises").then(({ stat }) => (
    stat(new URL("../public/favicon.png", import.meta.url))
  ));
  assert.ok(faviconInfo.size > 1_000);
  await access(new URL("../public/brand-logo.png", import.meta.url));
  await access(new URL("../public/qoder-logo.png", import.meta.url));
  for (const entryPoint of [
    "编辑",
    "预览",
    "项目",
    "全局评论",
    "发送至 Qoder",
    "评论会显示在这里",
  ]) {
    assert.match(html, new RegExp(entryPoint));
  }
  assert.doesNotMatch(html, /新建 HTML/);
  assert.doesNotMatch(html, /修改会自动写回源文件|单击选择，双击文字修改/);
  assert.match(html, /\saria-label=["'][^"']+["']/i);
  assert.doesNotMatch(html, />保存</);
  assert.doesNotMatch(html, />另存为</);
  assert.doesNotMatch(html, /历史版本已打开/);
  assert.doesNotMatch(html, /codex-preview|_sites-preview|react-loading-skeleton/i);
});

test("application boundaries encode the v3 single-source lifecycle instead of save-created versions", async () => {
  const [
    page,
    layout,
    packageText,
    workbench,
    bridgeClient,
    draftSession,
    drainCoordinator,
    runLifecycle,
    canvasEditor,
    nativeController,
    viteConfig,
  ] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/application/bridge-client.js", import.meta.url), "utf8"),
    readFile(new URL("../app/application/draft-session.js", import.meta.url), "utf8"),
    readFile(new URL("../app/application/drain-coordinator.js", import.meta.url), "utf8"),
    readFile(new URL("../app/domain/run-lifecycle.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/NativeEditingController.ts", import.meta.url), "utf8"),
    readFile(new URL("../vite.config.ts", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);
  const applicationLifecycle = [
    workbench,
    bridgeClient,
    draftSession,
    drainCoordinator,
    runLifecycle,
  ].join("\n");

  assert.doesNotMatch(page, /codex-preview|_sites-preview|SkeletonPreview/);
  assert.doesNotMatch(layout, /codex-preview|_sites-preview|Starter Project/);
  assert.doesNotMatch(viteConfig, /hosting\.json|sites-vite-plugin|chatgpt\.site/i);
  assert.equal(packageJson.dependencies?.["react-loading-skeleton"], undefined);
  assert.equal(packageJson.dependencies?.lexical, undefined);
  assert.equal(packageJson.dependencies?.["@lexical/history"], undefined);
  assert.equal(packageJson.dependencies?.["@lexical/plain-text"], undefined);
  assert.equal(packageJson.dependencies?.["@lexical/selection"], undefined);
  assert.equal(packageJson.version, "0.8.9");
  assert.equal(packageJson.build?.mac?.extendInfo?.NSMicrophoneUsageDescription, undefined);
  assert.equal(packageJson.build?.mac?.extendInfo?.NSSpeechRecognitionUsageDescription, undefined);

  for (const required of [
    "editRevisionRef",
    "lastPersistedRevisionRef",
    "pendingWriteRef",
    "flushAutosave",
    "expectedSourceSha256",
    "freezeCutoffRevision",
    "freezeNow",
    "projectLockedRef.current = true",
    "currentBasedOnVersionId",
    "currentExactVersionId",
    "viewingVersionId",
    "renderedContentSha256",
    "verifyCanvasRendered",
    "persistDraftRecovery",
    "recoverDraftLog",
    "recoveryIdentityFromRecord",
    "baseDraftRevision",
    "expectedDraftRevision",
    "preview-dirty",
    "html-ai:prepare-close",
    "bridgeAuthToken",
    "x-html-ai-bridge-token",
    "DEFAULT_READ_TIMEOUT_MS",
    "AbortSignal.timeout",
    "/autosave",
    "/version-file",
    "/conflict/resolve",
    "/active-run/cancel",
    "/draft",
    "awaiting-conflict-resolution",
    "recovering-transaction",
    "没有创建新版本",
    "旧版未被覆盖",
    "openedAiVersionNotice",
    "removeAcknowledgedAuditEvents",
    "hydrateRecentProjectRuns",
    '.drain("submit"',
    "projectIdRef.current === run.projectId",
    "transitionAffectsCurrentCanvas",
    "isCurrentProjectContext(transitionContext)",
    "已打开，但需要检查",
  ]) {
    assert.match(
      applicationLifecycle,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  assert.doesNotMatch(workbench, /archiveLocalVersion|saveCurrent|saveAs/);
  assert.doesNotMatch(workbench, /persistHtml\??:/);
  assert.doesNotMatch(workbench, /current\/index\.html/);
  assert.doesNotMatch(workbench, /versionEntryRelativePath/);
  assert.doesNotMatch(workbench, /result\.json 可选|OUTPUT_STABILITY/);
  assert.doesNotMatch(workbench, /fetch\(`\$\{BRIDGE_URL\}\/version`/);
  assert.doesNotMatch(workbench, /保存产生|保存并建立|已打开并保存/);
  assert.doesNotMatch(workbench, /beginNavigationOperation\(true\)/);
  assert.match(workbench, /Cmd\+S|event\.key\.toLowerCase\(\) === "s"/);
  assert.match(workbench, /lazy\(\(\) => import\("\.\/components\/HtmlCanvasEditor"\)\)/);
  assert.match(workbench, /仅预览 · 修改尚未绑定本地文件/u);
  assert.match(workbench, /添加位置：/u);
  assert.match(canvasEditor, /sourceValue/u);
  assert.match(canvasEditor, /computedValue/u);
  assert.doesNotMatch(workbench, /undoesEventId/u);
  assert.match(workbench, /版本号没有变化/);
  assert.match(
    workbench,
    /Boolean\(sourcePathRef\.current\) \|\| Boolean\(frozen\.pendingMutation\)/,
    "closing an untouched unbound sample must ignore a source-equal freeze",
  );

  assert.match(canvasEditor, /HtmlCanvasInteractionMode/);
  assert.match(canvasEditor, /SOURCE_NODE_ATTRIBUTE/);
  assert.match(canvasEditor, /instrumentPreviewHtml/);
  assert.match(canvasEditor, /planSourcePatch/);
  assert.match(canvasEditor, /applyPatchPlan/);
  assert.match(canvasEditor, /freezeNow/);
  assert.match(canvasEditor, /imperativeLockRef\.current = true/);
  assert.doesNotMatch(canvasEditor, /undoStackRef|redoStackRef|historyAction|historyId/u);
  assert.doesNotMatch(canvasEditor, /frameRevision/);
  assert.doesNotMatch(canvasEditor, /key=\{frameRevision\}/);
  assert.match(canvasEditor, /preserveViewport/);
  assert.match(canvasEditor, /sourceBackedPreviewElements/);
  assert.match(canvasEditor, /renderedSourceHtmlRef\.current = frameSourceHtmlRef\.current/);
  assert.match(canvasEditor, /getSourceHtml: \(\) => frameSourceHtmlRef\.current/);
  assert.match(canvasEditor, /kind: "text"/);
  assert.match(canvasEditor, /kind: "style"/);
  assert.match(canvasEditor, /kind: "reorder"/);
  assert.match(canvasEditor, /type: "replace-text-range"/);
  assert.match(canvasEditor, /replacements: mappedReplacements\.map/);
  assert.match(canvasEditor, /validateFormatSkeletonTransaction/);
  assert.match(canvasEditor, /textRangeToSourceSegments/);
  assert.doesNotMatch(
    canvasEditor,
    /textRangeToSourceEdit/,
    "native DOM commits must use FormatSkeleton descriptors rather than the legacy flat range mapper",
  );
  assert.match(canvasEditor, /new NativeEditingController\(/);
  assert.match(canvasEditor, /type: "set-inline-style"/);
  assert.match(canvasEditor, /type: "reorder-sibling"/);
  assert.match(canvasEditor, /加粗/);
  assert.match(canvasEditor, /斜体/);
  assert.match(canvasEditor, /填充/);
  assert.match(canvasEditor, /内边距/);
  assert.match(canvasEditor, /外间距/);
  assert.match(canvasEditor, /行距/);
  assert.doesNotMatch(canvasEditor, /insertionPoints\.map/);

  const finishingGuard = canvasEditor.indexOf('reason: "文字编辑正在提交。"');
  const finishNativeEditSource = canvasEditor.slice(
    Math.max(0, finishingGuard - 700),
    canvasEditor.indexOf("const resetSelection = useCallback", finishingGuard),
  );
  assert.match(
    finishNativeEditSource,
    /if \(\w+FinishingRef\.current\) \{[\s\S]*?ok: false[\s\S]*?文字编辑正在提交/u,
    "a native-edit transaction must fail closed on synchronous re-entry",
  );
  const commitIndex = finishNativeEditSource.indexOf("const committed = shouldApply");
  const checkpointGuardIndex = finishNativeEditSource.indexOf("if (!committed.ok) return committed;");
  const disposeIndex = finishNativeEditSource.indexOf("active.session.dispose()");
  assert.ok(commitIndex >= 0);
  assert.ok(checkpointGuardIndex > commitIndex);
  assert.ok(
    disposeIndex > checkpointGuardIndex,
    "a failed source checkpoint must retain the authored-DOM session and its unsaved draft",
  );

  const freezeSource = canvasEditor.slice(
    canvasEditor.indexOf("const commitPendingEdit = useCallback"),
    canvasEditor.indexOf("const unlockNow = useCallback"),
  );
  const freezeCommitIndex = freezeSource.indexOf("const committed = commitPendingEdit()");
  const freezeGuardIndex = freezeSource.indexOf("if (!committed.ok) return committed;");
  const imperativeLockIndex = freezeSource.indexOf("imperativeLockRef.current = true");
  assert.ok(freezeCommitIndex >= 0);
  assert.ok(freezeGuardIndex > freezeCommitIndex);
  assert.ok(
    imperativeLockIndex > freezeGuardIndex,
    "freezeNow must not lock the editor when a native-edit checkpoint fails",
  );

  assert.match(nativeController, /applyNativeEditSessionAttributes\(this\.hostElement/u);
  assert.match(nativeController, /this\.hostElement\.addEventListener\("beforeinput"/u);
  assert.match(nativeController, /documentNode\.addEventListener\("selectionchange"/u);
  assert.match(nativeController, /restoreAttribute\(this\.hostElement, name, saved\)/u);
  assert.doesNotMatch(nativeController, /documentNode\.body\.appendChild|surfaceElement|LexicalEditor|registerPlainText/u);
  assert.doesNotMatch(canvasEditor, /pageroot-text-editor|pageroot-text-ghost|data-pageroot-text-flow-item/u);

  await assert.rejects(
    access(new URL("../app/_sites-preview", import.meta.url)),
    { code: "ENOENT" },
  );
  await assert.rejects(
    access(new URL("public/_sites-preview", productRoot)),
    { code: "ENOENT" },
  );
  await assert.rejects(
    access(new URL("../.openai/hosting.json", import.meta.url)),
    { code: "ENOENT" },
  );
  await assert.rejects(
    access(new URL("../build/sites-vite-plugin.ts", import.meta.url)),
    { code: "ENOENT" },
  );
});

test("history cards read only v3 immutable annotations and show audit details", async () => {
  const [workbench, archiveSelector] = await Promise.all([
    readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
    readFile(
      new URL("../app/lib/version-audit-records.js", import.meta.url),
      "utf8",
    ),
  ]);

  assert.match(workbench, /raw\.manifest\.schemaVersion !== "3\.0\.0"/);
  assert.match(workbench, /const manifest = raw\.manifest/);
  assert.match(workbench, /versionAuditCollections\(raw\)/);
  assert.match(workbench, /commentsFromRecords\(auditCollections\.comments\)/);
  assert.match(workbench, /changesFromRecords\(auditCollections\.editEvents\)/);
  assert.match(workbench, /insertionLabel\(comment\.target\)/);
  assert.match(workbench, /dateTime=\{comment\.updatedAt \|\| comment\.createdAt\}/);
  assert.match(workbench, /historyRecordValue\(event, event\.before\)/);
  assert.match(workbench, /historyRecordValue\(event, event\.after\)/);
  assert.doesNotMatch(workbench, /function displayRecordValue/);
  assert.match(workbench, /dateTime=\{event\.createdAt\}/);
  assert.match(workbench, /value\.capturedRevision \?\? value\.revision/);
  assert.match(workbench, /value\.baseVersionId \|\| value\.basedOnVersionId/);

  assert.match(archiveSelector, /raw\.annotations\.schemaVersion === "3\.0\.0"/);
  assert.match(archiveSelector, /topLevelAnnotations\.comments/);
  assert.match(archiveSelector, /topLevelAnnotations\.editEvents/);
  assert.doesNotMatch(archiveSelector, /legacy|v2/i);
});

test("canvas persistence has one SourcePatchEngine path and clean v3 TargetRefs", async () => {
  const [
    workbench,
    draftSession,
    canvasEditor,
    nativeController,
    sourcePatchEngine,
    sourceTextMap,
    runtimeDomSourceMap,
    nativeCapability,
    globals,
  ] = await Promise.all([
    readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/application/draft-session.js", import.meta.url), "utf8"),
    readFile(new URL("../app/components/HtmlCanvasEditor.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/NativeEditingController.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/source-patch-engine.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/source-text-map.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/runtime-dom-source-map.js", import.meta.url), "utf8"),
    readFile(new URL("../app/lib/native-edit-capability.js", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
  ]);

  for (const required of [
    'from "../lib/source-patch-core.js"',
    "instrumentPreviewHtml",
    "SOURCE_NODE_ATTRIBUTE",
    "if (!onChangeRef.current(result.html, appliedMutation))",
    'type: "replace-text-range"',
    "replacements: mappedReplacements.map",
    "validateFormatSkeletonTransaction",
    "captureFormatSkeleton",
    "textRangeToSourceSegments",
    "buildSourceTextMap",
    "buildRuntimeDomMap",
    "classifyNativeEditCapability",
    "new NativeEditingController",
    'type: "set-inline-style"',
    'type: "reorder-sibling"',
    "synchronizeStablePreview",
    "在页面顶部添加内容建议",
    "target-resolution",
    "persistedTargetRef",
    "encodeComment: persistedComment",
    "encodeChangeEvent: persistedChangeEvent",
    "comments: write.comments.map(this.#encodeComment)",
    "changeEvents: write.changeEvents.map(this.#encodeChangeEvent)",
  ]) {
    assert.match(
      `${canvasEditor}\n${workbench}\n${draftSession}\n${globals}`,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  assert.doesNotMatch(
    canvasEditor,
    />样式来源</u,
    "the canvas no longer displays the style provenance panel",
  );

  for (const forbidden of [
    "serializeDocument",
    "getSerializedHtml",
    "onComment?:",
    "element.style[property] =",
    "legacyVersions",
    "legacy-history-group",
    "旧版保存记录",
    "moduleSelector",
    "sourceSelector",
    "editingElementRef",
    "restoreContentEditable",
    "placeTextCaret",
    "commitTextRangeEditing",
    "InlineEditSession",
    "pageroot-text-editor",
    "pageroot-text-ghost",
    "data-pageroot-text-flow-item",
  ]) {
    assert.doesNotMatch(
      `${canvasEditor}\n${workbench}\n${globals}`,
      new RegExp(forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }

  assert.match(
    canvasEditor,
    /liveParent\.insertBefore\([\s\S]*?The DOM remains a preview only; it is never[\s\S]*?serialized back into the user's source/u,
    "safe sibling reorder may move the mounted preview node but must never become a source serialization path",
  );

  assert.equal(
    canvasEditor.includes(".innerHTML"),
    false,
    "the canvas may not serialize a mutated preview DOM back into source",
  );
  assert.doesNotMatch(
    canvasEditor,
    /onChangeRef\.current\([^)]*outerHTML/s,
    "outerHTML is limited to preview sanitization and load verification",
  );
  assert.match(sourceTextMap, /export function textRangeToSourceEdit/u);
  assert.match(sourceTextMap, /export function textRangeToSourceSegments/u);
  assert.match(sourceTextMap, /export function sourceSegmentsToTextRange/u);
  assert.match(runtimeDomSourceMap, /export class RuntimeDomSourceMap/u);
  assert.match(runtimeDomSourceMap, /domPointToSourceAnchor\(/u);
  assert.match(runtimeDomSourceMap, /sourceAnchorToDomPoint\(/u);
  assert.match(nativeCapability, /EDITABLE: "native-editable"/u);
  assert.match(nativeCapability, /SELECT_COMMENT: "select-comment"/u);
  assert.match(nativeCapability, /COMMENT_ONLY: "comment-only"/u);
  assert.match(sourcePatchEngine, /Object\.hasOwn\(command, "replacements"\)/u);
  assert.match(sourcePatchEngine, /inputs = command\.replacements/u);
  assert.match(sourcePatchEngine, /Text replacements contain overlapping deletion ranges/u);
  assert.match(sourcePatchEngine, /metadataReplacements = replacements\.map/u);
  assert.match(
    nativeController,
    /captureCheckpoint\([\s\S]*?trigger: NativeEditCheckpointTrigger = "automatic",[\s\S]*?\): NativeEditCheckpoint/u,
  );
  assert.match(nativeController, /if \(!this\.hasCurrentLease\(\)\) return \{ ok: false, reason: "disposed" \}/u);
  assert.match(
    nativeController,
    /if \(this\.composing \|\| this\.draftCompositionUnsettled\) \{[\s\S]*?reason: "composing"/u,
  );
  assert.match(nativeController, /applyNativeEditSessionAttributes\(this\.hostElement/u);
  assert.doesNotMatch(nativeController, /setRootElement|LexicalEditor|registerPlainText/u);

  const targetWriter = workbench.slice(
    workbench.indexOf("function persistedTargetRef"),
    workbench.indexOf("function persistedComment"),
  );
  for (const allowedField of [
    "targetId:",
    "label:",
    "level:",
    "selector:",
    "textQuote:",
    "sourceAnchor:",
    "fingerprint:",
    "resolution:",
  ]) {
    assert.match(targetWriter, new RegExp(allowedField));
  }
  for (const retiredField of [
    "moduleSelector:",
    "anchor:",
    "nodeType:",
    "cssSelector:",
    "sourceSelector:",
    "boundingBox:",
    "insertion:",
  ]) {
    assert.doesNotMatch(targetWriter, new RegExp(retiredField));
  }
});

test("handoff fails closed before locking when a comment target is unsafe", async () => {
  const workbench = await readFile(
    new URL("../app/workbench.tsx", import.meta.url),
    "utf8",
  );

  const locatorGuard = workbench.match(
    /function canLocateTarget\(target: HtmlCanvasSelection\): boolean \{[\s\S]*?\n\}/u,
  )?.[0] ?? "";
  assert.notEqual(locatorGuard, "");
  assert.match(locatorGuard, /resolution === "exact"/);
  assert.match(locatorGuard, /resolution === "rebound"/);
  assert.doesNotMatch(locatorGuard, /resolution === "ambiguous"/);
  assert.doesNotMatch(locatorGuard, /resolution === "orphaned"/);

  for (const required of [
    "const unsafeTargets = activeComments.filter(",
    "条评论需要重新定位",
    "评论和附件已保留",
    "beginTargetRelink",
    "选择新位置",
    "activeComments.length === 0",
    "data-resolution={comment.target.resolution}",
    "targets: targets.map(persistedTargetRef)",
  ]) {
    assert.match(
      workbench,
      new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.doesNotMatch(workbench, /本轮没有提交/);

  const unsafeGuardIndex = workbench.indexOf(
    "const unsafeTargets = activeComments.filter(",
  );
  const handoffStartIndex = workbench.indexOf("const generateRequest = useCallback");
  const freezeBoundaryIndex = workbench.indexOf(
    "const frozen = editorRef.current?.freezeNow()",
    handoffStartIndex,
  );
  assert.ok(handoffStartIndex > -1);
  assert.ok(unsafeGuardIndex > -1);
  assert.ok(freezeBoundaryIndex > unsafeGuardIndex);
});
