import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";

test("desktop package carries the v3 single patch engine, scope gate and active schemas", async () => {
  const [
    packageText,
    mainProcess,
    preload,
    rendererMain,
    rendererHtml,
    projectFiles,
    exportCopy,
    bridge,
    finalizer,
    lifecycleCore,
    htmlSourceParser,
    scopeValidator,
    bridgeShutdown,
    closeRecovery,
    qoderHandoff,
    manualUpdate,
    afterPack,
    iconInfo,
  ] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/project-files.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/export-copy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/workspace-bridge.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/finalize-attempt.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lifecycle-core.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/html-source-parser.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/scope-validator.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/bridge-shutdown.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/close-recovery.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/qoder-handoff.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/manual-update.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/after-pack.mjs", import.meta.url), "utf8"),
    stat(new URL("../desktop/resources/icon.icns", import.meta.url)),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.main, "desktop/main.mjs");
  assert.equal(packageJson.name, "pageroot");
  assert.match(packageJson.description, /源页（PageRoot）— Edit visually\. Stay in source\./);
  assert.equal(packageJson.build.appId, "com.htmlai.workbench");
  assert.equal(packageJson.version, "0.8.4");
  assert.equal(packageJson.build.productName, "PageRoot");
  assert.equal(packageJson.build.artifactName, "PageRoot-${version}-${arch}.${ext}");
  assert.equal(packageJson.build.mac.identity, "-");
  assert.equal(packageJson.build.afterPack, "desktop/after-pack.mjs");
  assert.ok(packageJson.build.files.includes("!node_modules/**/*"));
  assert.ok(packageJson.build.files.includes("desktop/preload.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/project-files.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/export-copy.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/bridge-shutdown.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/close-recovery.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/product-contract.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/qoder-handoff.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/manual-update.mjs"));
  assert.equal(
    packageJson.build.mac.extendInfo?.NSAppleEventsUsageDescription,
    undefined,
  );
  for (const target of [
    "bridge/workspace-bridge.mjs",
    "bridge/finalize-attempt.mjs",
    "bridge/lifecycle-core.mjs",
    "bridge/user-supplement-core.mjs",
    "bridge/record-user-supplement.mjs",
    "bridge/html-source-parser.mjs",
    "bridge/scope-validator.mjs",
    "bridge/target-identity.mjs",
    "bridge/product-contract.mjs",
    "bridge/attachment-storage.mjs",
    "node_modules/parse5",
    "node_modules/entities",
    "schemas",
    "build-info.json",
    "LICENSE",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    assert.ok(packageJson.build.extraResources.some((entry) => entry.to === target));
  }
  assert.equal(packageJson.scripts["release:mac"], "npm run gate:artifact:auto");
  assert.ok(iconInfo.size > 100_000);

  assert.match(mainProcess, /utilityProcess\.fork/);
  assert.match(mainProcess, /requestSingleInstanceLock/);
  assert.match(mainProcess, /app\.setPath\("userData",\s*productUserDataPath\)/);
  assert.match(mainProcess, /app\.setName\("源页"\)/);
  assert.match(
    mainProcess,
    /\["YuanYe",\s*"HTML AI 工作台"\][\s\S]*?"html-projects\.json"/,
  );
  const workspaceResolver = mainProcess.slice(
    mainProcess.indexOf("async function workspacePath()"),
    mainProcess.indexOf("async function startBridge()"),
  );
  assert.match(
    workspaceResolver,
    /\[pageRootWorkspace, yuanyeWorkspace, legacyWorkspace\]/,
  );
  assert.match(workspaceResolver, /return existingWorkspace \?\? pageRootWorkspace/);
  assert.doesNotMatch(workspaceResolver, /mkdir|writeFile|rename/);
  assert.match(mainProcess, /"ACTIVE_PROJECT_MISSING"/);
  assert.match(mainProcess, /titleBarStyle:\s*"hiddenInset"/);
  assert.match(mainProcess, /trafficLightPosition:\s*\{ x: 18, y: 15 \}/);
  assert.doesNotMatch(mainProcess, /PROJECT_CHANNELS\.persistHtml/);
  assert.doesNotMatch(mainProcess, /html-projects:persist/);
  assert.doesNotMatch(mainProcess, /PROJECT_CHANNELS\.newHtml|html-projects:new/);
  assert.match(mainProcess, /PROJECT_CHANNELS\.exportHtmlCopy/);
  assert.match(mainProcess, /PROJECT_CHANNELS\.readHtml/);
  assert.match(mainProcess, /PROJECT_CHANNELS\.showInFolder/);
  assert.match(mainProcess, /PROJECT_CHANNELS\.revealRequestFolder/);
  assert.match(mainProcess, /INTEGRATION_CHANNELS\.qoderHandoff/);
  assert.match(mainProcess, /UPDATE_CHANNELS\.getStatus/);
  assert.match(mainProcess, /UPDATE_CHANNELS\.openRepository/);
  assert.match(mainProcess, /scheduleAutomaticUpdateCheck\(\)/);
  assert.match(mainProcess, /net\.fetch/);
  assert.match(mainProcess, /app\.getVersion\(\)/);
  assert.match(mainProcess, /handoffToQoderWork/);
  assert.match(mainProcess, /clipboard\.writeText/);
  assert.match(mainProcess, /shell\.openExternal/);
  assert.match(mainProcess, /shell\.showItemInFolder\(sourcePath\)/);
  assert.match(mainProcess, /shell\.openPath\(resolvedRequestPath\)/);
  assert.match(
    mainProcess,
    /async function revealRequestFolder[\s\S]*?assertKnownProjectPath\(sourcePath\)[\s\S]*?realpath\(path\.resolve\(payload\.requestPath\)\)[\s\S]*?UNSAFE_REQUEST_PATH/,
  );
  assert.match(
    mainProcess,
    /async function showInFolder[\s\S]*?assertReadPayload\(sourcePathInput\)[\s\S]*?assertKnownProjectPath\(sourcePath\)[\s\S]*?inspectHtmlFile\(sourcePath\)/,
  );
  assert.match(mainProcess, /createSafeExportDefaultPath/);
  assert.match(mainProcess, /selectExportDestination/);
  assert.match(mainProcess, /isProtectedExportDestination/);
  assert.match(mainProcess, /runProjectIpcOperation/);
  assert.match(mainProcess, /重新选择位置/);
  assert.match(mainProcess, /取消/);
  assert.match(mainProcess, /trustedProject/);
  assert.match(mainProcess, /APP_CHANNELS\.prepareClose/);
  assert.match(mainProcess, /APP_CHANNELS\.closeResult/);
  assert.match(mainProcess, /APP_CHANNELS\.closeAborted/);
  assert.match(mainProcess, /requestRendererClose/);
  assert.match(mainProcess, /if \(!rendererHasLoaded\)/);
  assert.match(mainProcess, /coordinateApplicationExit/);
  assert.match(mainProcess, /event\.preventDefault\(\)/);
  assert.match(mainProcess, /stopBridge:\s*stopBridgeGracefully/);
  assert.match(mainProcess, /stopBridgeProcessGracefully/);
  assert.match(mainProcess, /stopBridgeOrNotifyCloseAborted/);
  assert.match(mainProcess, /HTML_AI_BRIDGE_AUTH_TOKEN:\s*bridgeAuthToken/);
  assert.match(mainProcess, /bridgeAuthToken,\s*\n\s*appVersion:\s*app\.getVersion\(\),\s*\n\s*}/);
  assert.match(
    mainProcess,
    /preload:\s*path\.join\(directory,\s*["']preload\.mjs["']\)/,
  );
  assert.match(mainProcess, /contextIsolation:\s*true/);
  assert.match(mainProcess, /nodeIntegration:\s*false/);
  assert.match(mainProcess, /sandbox:\s*true/);
  assert.match(mainProcess, /webSecurity:\s*true/);

  assert.match(projectFiles, /persistHtmlFile/);
  assert.match(projectFiles, /expectedSha256/);
  assert.match(projectFiles, /editRevision/);
  assert.match(projectFiles, /SOURCE_CHANGED/);
  assert.match(projectFiles, /rename/);
  assert.match(projectFiles, /readFile/);
  assert.match(projectFiles, /lastModifiedAt/);
  assert.match(projectFiles, /persistedRevision/);
  assert.match(exportCopy, /createSafeExportDefaultPath/);
  assert.match(exportCopy, /pathsReferToSameFile/);
  assert.match(exportCopy, /runProjectIpcOperation/);

  assert.match(
    preload,
    /contextBridge\.exposeInMainWorld\(["']htmlAIProjects["'],\s*projectsApi\)/,
  );
  assert.doesNotMatch(preload, /persistHtml:\s*\(payload\)/);
  assert.doesNotMatch(preload, /html-projects:persist/);
  assert.match(preload, /exportHtmlCopy:\s*\(payload\)/);
  assert.match(preload, /invokeProject/);
  assert.match(preload, /PROJECT_IPC_PROTOCOL/);
  assert.match(preload, /readHtml:\s*\(sourcePath\)/);
  assert.match(preload, /revealRequestFolder:\s*\(payload\)/);
  assert.match(
    preload,
    /handoffToQoderWork:\s*\(payload\)[\s\S]*?integrationChannels\.qoderHandoff/,
  );
  assert.match(
    preload,
    /exposeInMainWorld\(["']htmlAIIntegrations["'],\s*integrationsApi\)/,
  );
  assert.match(
    preload,
    /exposeInMainWorld\(["']htmlAIUpdates["'],\s*updatesApi\)/,
  );
  assert.match(preload, /exposeInMainWorld\(["']htmlAIRuntime["'],\s*runtimeConfig\)/);
  assert.match(preload, /exposeInMainWorld\(["']htmlAIAppLifecycle["'],\s*appLifecycleApi\)/);
  assert.match(preload, /onPrepareClose/);
  assert.match(preload, /reportReady/);
  assert.match(preload, /reportBlocked/);
  assert.match(preload, /onCloseAborted/);
  assert.doesNotMatch(preload, /saveHtml|saveHtmlAs/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer/s);

  assert.match(rendererMain, /html-ai:prepare-close/);
  assert.match(rendererMain, /html-ai:close-aborted/);
  assert.match(rendererMain, /waitUntil/);
  assert.match(rendererMain, /readinessChecks\.length === 0/);
  assert.match(rendererMain, /reportBlocked/);
  assert.match(rendererMain, /reportReady/);
  assert.match(rendererHtml, /Content-Security-Policy/);
  assert.match(rendererHtml, /default-src 'none'/);
  assert.match(rendererHtml, /script-src 'self'/);
  assert.match(rendererHtml, /connect-src http:\/\/127\.0\.0\.1:\*/);
  assert.match(rendererHtml, /frame-src 'self' data: blob:/);
  assert.match(rendererHtml, /object-src 'none'/);
  assert.match(rendererHtml, /base-uri 'self' file:/);
  assert.match(rendererHtml, /<title>源页<\/title>/);
  assert.match(rendererHtml, /源页（PageRoot）— Edit visually\. Stay in source\./);
  assert.doesNotMatch(rendererHtml, /frame-ancestors/);
  assert.match(mainProcess, /path\.join\(documents,\s*"PageRoot",\s*"项目记录"\)/);
  assert.match(mainProcess, /path\.join\(documents,\s*"YuanYe",\s*"项目记录"\)/);
  assert.match(bridge, /"PageRoot",\s*\n\s*"项目记录"/);

  assert.doesNotMatch(bridge, /\/Users\/lizexuan/);
  assert.match(bridge, /completion\.json/);
  assert.match(bridge, /scope-report\.json/);
  assert.match(bridge, /committed\.json/);
  assert.match(bridge, /ELECTRON_RUN_AS_NODE=1/);
  assert.match(finalizer, /finalizeAttempt/);
  assert.match(lifecycleCore, /completion\.json/);
  assert.match(lifecycleCore, /finalizerVersion/);
  assert.match(lifecycleCore, /canonicalizationVersion|CANONICALIZATION_VERSION/);
  assert.match(htmlSourceParser, /from "parse5"/);
  assert.match(htmlSourceParser, /sourceCodeLocationInfo:\s*true/);
  assert.match(scopeValidator, /SCOPE_ENFORCEMENT_MODE/);
  assert.match(scopeValidator, /validateScope/);
  assert.match(bridgeShutdown, /BridgeShutdownTimeoutError/);
  assert.match(bridgeShutdown, /应用已保持开启/);
  assert.doesNotMatch(bridgeShutdown, /SIGKILL/);
  assert.match(closeRecovery, /shouldRecoverEditorAfterCloseAbort/);
  assert.match(closeRecovery, /stopBridgeOrNotifyCloseAborted/);
  assert.match(qoderHandoff, /writeClipboard\(message\)/);
  assert.match(qoderHandoff, /readClipboard\(\)/);
  assert.match(qoderHandoff, /copiedMessage !== message/);
  assert.match(qoderHandoff, /status:\s*"copied"/);
  assert.doesNotMatch(
    qoderHandoff,
    /qoder-work:\/\/|osascript|System Events|openExternal|keystroke|execFile/,
  );
  assert.match(
    manualUpdate,
    /Charleyli925\/PageRoot\/releases\/latest\/download\/update-manifest\.json/,
  );
  assert.match(
    manualUpdate,
    /Charleyli925\/PageRoot\/releases\/latest/,
  );
  assert.match(
    manualUpdate,
    /PROJECT_REPOSITORY_URL[\s\S]*?Charleyli925\/PageRoot/,
  );
  assert.doesNotMatch(manualUpdate, /api\.github\.com/);
  assert.match(afterPack, /NSMicrophoneUsageDescription/);
  assert.match(afterPack, /NSAudioCaptureUsageDescription/);
  assert.match(afterPack, /Delete/);
});
