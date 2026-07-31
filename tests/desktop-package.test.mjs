import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import test from "node:test";
import semver from "semver";

test("desktop package carries the v3 single patch engine, scope gate and active schemas", async () => {
  const [
    packageText,
    mainProcess,
    preload,
    rendererMain,
    rendererHtml,
    projectFiles,
    sourceRename,
    exportCopy,
    openInDefaultBrowser,
    projectIpcSecurity,
    bridge,
    finalizer,
    lifecycleCore,
    htmlSourceParser,
    scopeValidator,
    bridgeShutdown,
    closeRecovery,
    qoderHandoff,
    manualUpdate,
    applicationUpdate,
    userNotice,
    usageTelemetry,
    previewProtocol,
    afterPack,
    entitlements,
    iconInfo,
  ] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../desktop/main.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preload.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/main.tsx", import.meta.url), "utf8"),
    readFile(new URL("../desktop/renderer/index.html", import.meta.url), "utf8"),
    readFile(new URL("../desktop/project-files.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/source-rename.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/export-copy.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/open-in-default-browser.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/project-ipc-security.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/workspace-bridge.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/finalize-attempt.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/lifecycle-core.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/html-source-parser.mjs", import.meta.url), "utf8"),
    readFile(new URL("../scripts/scope-validator.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/bridge-shutdown.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/close-recovery.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/qoder-handoff.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/manual-update.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/application-update.mjs", import.meta.url), "utf8"),
    readFile(new URL("../PageRoot 用户声明与免责声明.txt", import.meta.url), "utf8"),
    readFile(new URL("../desktop/usage-telemetry.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/preview-protocol.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/after-pack.mjs", import.meta.url), "utf8"),
    readFile(new URL("../desktop/resources/entitlements.mac.plist", import.meta.url), "utf8"),
    stat(new URL("../desktop/resources/icon.icns", import.meta.url)),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.main, "desktop/main.mjs");
  assert.equal(packageJson.name, "pageroot");
  assert.match(packageJson.description, /源页（PageRoot）— Editable islands/);
  assert.equal(packageJson.build.appId, "com.htmlai.workbench");
  assert.equal(semver.valid(packageJson.version), packageJson.version);
  assert.equal(packageJson.build.productName, "PageRoot");
  assert.equal(packageJson.build.artifactName, "PageRoot-${version}-${arch}.${ext}");
  assert.equal(packageJson.build.forceCodeSigning, true);
  assert.equal(packageJson.build.mac.identity, undefined);
  assert.equal(packageJson.build.mac.hardenedRuntime, true);
  assert.equal(packageJson.build.mac.notarize, true);
  assert.equal(
    packageJson.build.mac.entitlements,
    "desktop/resources/entitlements.mac.plist",
  );
  assert.equal(
    packageJson.build.mac.entitlementsInherit,
    "desktop/resources/entitlements.mac.plist",
  );
  assert.deepEqual(packageJson.build.mac.target, ["dmg", "zip"]);
  assert.equal(packageJson.build.publish[0].provider, "github");
  assert.equal(packageJson.build.publish[0].owner, "Charleyli925");
  assert.equal(packageJson.build.publish[0].repo, "PageRoot");
  assert.equal(packageJson.build.publish[0].releaseType, "release");
  assert.equal(packageJson.dependencies["electron-updater"], "6.8.9");
  assert.equal(packageJson.build.afterPack, "desktop/after-pack.mjs");
  assert.ok(packageJson.build.files.includes("!node_modules/**/*"));
  assert.ok(packageJson.build.files.includes("desktop/preload.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/project-files.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/source-rename.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/project-path-policy.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/welcome-project-content.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/export-copy.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/open-in-default-browser.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/project-ipc-security.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/bridge-shutdown.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/close-recovery.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/product-contract.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/qoder-handoff.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/manual-update.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/application-update.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/usage-telemetry.mjs"));
  assert.ok(packageJson.build.files.includes("desktop/preview-protocol.mjs"));
  assert.ok(packageJson.build.files.includes("public/brand-logo.png"));
  const mainLocalImports = [...mainProcess.matchAll(
    /from\s+"\.\/([^"]+)";/gu,
  )].map((match) => `desktop/${match[1]}`);
  for (const runtimeModule of mainLocalImports) {
    assert.ok(
      packageJson.build.files.includes(runtimeModule),
      `Electron main-process dependency must be packaged: ${runtimeModule}`,
    );
  }
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
    "bridge/draft-aggregate.mjs",
    "bridge/draft-service.mjs",
    "node_modules/parse5",
    "node_modules/entities",
    "node_modules/electron-updater",
    "node_modules/builder-util-runtime",
    "node_modules/fs-extra",
    "node_modules/js-yaml",
    "node_modules/lazy-val",
    "node_modules/lodash.escaperegexp",
    "node_modules/lodash.isequal",
    "node_modules/semver",
    "node_modules/tiny-typed-emitter",
    "node_modules/debug",
    "node_modules/sax",
    "node_modules/ms",
    "node_modules/argparse",
    "node_modules/graceful-fs",
    "node_modules/jsonfile",
    "node_modules/universalify",
    "schemas",
    "build-info.json",
    "PageRoot 用户声明与免责声明.txt",
    "usage-telemetry-config.json",
    "LICENSE",
    "PRIVACY.md",
    "NOTICE",
    "THIRD_PARTY_NOTICES.md",
  ]) {
    assert.ok(packageJson.build.extraResources.some((entry) => entry.to === target));
  }
  assert.equal(packageJson.scripts["release:mac"], "npm run gate:artifact:auto");
  assert.ok(iconInfo.size > 100_000);
  assert.match(userNotice, /AI Agent 生成或修改的内容可能不准确/);
  assert.match(userNotice, /只会把交接内容复制到本机剪贴板/);
  assert.match(userNotice, /Apache License 2\.0/);

  assert.match(mainProcess, /utilityProcess\.fork/);
  assert.match(mainProcess, /requestSingleInstanceLock/);
  assert.match(mainProcess, /app\.setPath\("userData",\s*productUserDataPath\)/);
  assert.match(mainProcess, /app\.setName\("源页"\)/);
  assert.match(
    mainProcess,
    /\["PageRootV2",\s*"YuanYe",\s*"HTML AI 工作台"\][\s\S]*?"html-projects\.json"/,
  );
  assert.match(
    mainProcess,
    /if \(e2eUserDataPath\) return currentPath/,
  );
  const workspaceResolver = mainProcess.slice(
    mainProcess.indexOf("async function workspacePath()"),
    mainProcess.indexOf("async function startBridge()"),
  );
  assert.match(
    workspaceResolver,
    /\[\s*pageRootWorkspace,\s*pageRootV2Workspace,\s*yuanyeWorkspace,\s*legacyWorkspace,\s*\]/,
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
  assert.match(mainProcess, /PROJECT_CHANNELS\.openInDefaultBrowser/);
  assert.match(mainProcess, /PROJECT_CHANNELS\.renameHtml/);
  assert.match(mainProcess, /PROJECT_CHANNELS\.revealRequestFolder/);
  assert.match(mainProcess, /PROJECT_CHANNELS\.forgetRecent/);
  assert.match(mainProcess, /INTEGRATION_CHANNELS\.qoderHandoff/);
  assert.match(mainProcess, /UPDATE_CHANNELS\.getStatus/);
  assert.match(mainProcess, /UPDATE_CHANNELS\.checkNow/);
  assert.match(mainProcess, /UPDATE_CHANNELS\.installDownloaded/);
  assert.match(mainProcess, /UPDATE_CHANNELS\.openLatestRelease/);
  assert.match(mainProcess, /UPDATE_CHANNELS\.openRepository/);
  assert.match(
    mainProcess,
    /shell\.openExternal\(LATEST_RELEASE_PAGE_URL\)/,
  );
  assert.match(
    mainProcess,
    /shell\.openExternal\(PROJECT_REPOSITORY_URL\)/,
  );
  assert.match(mainProcess, /startAutomaticChecks\(\)/);
  assert.match(mainProcess, /createApplicationUpdateController\(\{/);
  assert.match(mainProcess, /updater:\s*autoUpdater/);
  assert.match(mainProcess, /coordinateApplicationUpdateInstall/);
  assert.match(mainProcess, /installDownloadedUpdate\(\)/);
  assert.doesNotMatch(mainProcess, /checkForManualUpdate\(\{/);
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
  assert.match(
    openInDefaultBrowser,
    /return async function openInDefaultBrowser[\s\S]*?assertDefaultBrowserSourcePath\(sourcePathInput\)[\s\S]*?assertKnownProjectPath\(sourcePath\)[\s\S]*?inspectHtmlFile\(sourcePath\)[\s\S]*?pathToFileURL\(sourcePath\)\.href[\s\S]*?openExternal\(sourceUrl\)/,
  );
  assert.match(mainProcess, /createOpenInDefaultBrowserOperation\(\{/);
  assert.match(mainProcess, /assertTrustedRendererEvent\(event,\s*\{/);
  assert.match(
    projectIpcSecurity,
    /event\?\.sender !== webContents[\s\S]*?senderFrame !== webContents\.mainFrame[\s\S]*?!isTrustedRendererUrl\(senderFrame\?\.url\)[\s\S]*?UNAUTHORIZED_FILE_REQUEST/,
  );
  assert.match(
    mainProcess,
    /async function renameHtml[\s\S]*?renameHtmlSource\([\s\S]*?resolveKnownSource:\s*resolveKnownRenameSource[\s\S]*?rebindWorkspace:\s*rebindRenamedWorkspace/,
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
  assert.match(mainProcess, /APP_CHANNELS\.workspaceUnavailable/);
  assert.match(mainProcess, /APP_CHANNELS\.relaunch/);
  assert.match(mainProcess, /APP_CHANNELS\.openUserNotice/);
  assert.match(
    mainProcess,
    /shell\.openPath\(userNoticePath\(\)\)/,
  );
  assert.match(mainProcess, /coordinateApplicationRelaunch/);
  assert.match(
    mainProcess,
    /buttons:\s*\["返回源页处理",\s*"重新打开源页"\]/,
  );
  assert.match(
    mainProcess,
    /workspaceRecoveryMailbox\.publish\([\s\S]*?delivery\.deliverToRenderer[\s\S]*?webContents\.send\([\s\S]*?APP_CHANNELS\.workspaceUnavailable[\s\S]*?delivery\.issue[\s\S]*?return;/,
    "only a renderer that acknowledged its recovery listener suppresses the native modal",
  );
  assert.match(mainProcess, /APP_CHANNELS\.workspaceRecoveryReady/);
  assert.match(mainProcess, /workspaceRecoveryMailbox\.acknowledgeRendererReady\(\)/);
  assert.match(
    mainProcess,
    /"did-start-navigation"[\s\S]*?isInPlace,\s*isMainFrame[\s\S]*?if \(isInPlace \|\| !isMainFrame\) return;[\s\S]*?workspaceRecoveryMailbox\.beginRendererLoad\(\)/,
    "only a real main-frame navigation may revoke renderer close readiness",
  );
  assert.doesNotMatch(mainProcess, /"did-start-loading"/);
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
  assert.match(mainProcess, /registerPreviewProtocolScheme\(protocol\)/);
  assert.match(mainProcess, /createPreviewProtocolController\(\{/);
  assert.match(
    mainProcess,
    /createPreviewSessionOperation\(\{[\s\S]*?assertKnownProjectPath\(sourcePath\)[\s\S]*?inspectHtmlFile\(sourcePath\)/,
  );
  assert.match(mainProcess, /PREVIEW_CHANNELS\.createSession/);
  assert.match(mainProcess, /PREVIEW_CHANNELS\.revokeSession/);
  assert.match(mainProcess, /will-frame-navigate/);
  assert.match(previewProtocol, /PREVIEW_PROTOCOL_SCHEME = "pageroot-preview"/);
  assert.match(previewProtocol, /protocolApi\.handle\(PREVIEW_PROTOCOL_SCHEME/);
  assert.match(previewProtocol, /isContainedPath\(session\.sourceRoot, resolvedPath\)/);
  assert.doesNotMatch(previewProtocol, /bypassCSP:\s*true/);
  assert.match(mainProcess, /show:\s*process\.env\.PAGEROOT_E2E === "1"/u);
  assert.match(
    mainProcess,
    /process\.env\.PAGEROOT_E2E === "1"[\s\S]*?backgroundThrottling:\s*false/u,
  );
  assert.match(
    mainProcess,
    /if \(e2eUserDataPath\) \{[\s\S]*?disable-background-timer-throttling[\s\S]*?disable-renderer-backgrounding[\s\S]*?disable-backgrounding-occluded-windows[\s\S]*?\}/u,
    "hosted Electron E2E must keep startup timers and rendering active without changing production",
  );

  assert.match(projectFiles, /persistHtmlFile/);
  assert.match(projectFiles, /expectedSha256/);
  assert.match(projectFiles, /editRevision/);
  assert.match(projectFiles, /SOURCE_CHANGED/);
  assert.match(projectFiles, /rename/);
  assert.match(projectFiles, /readFile/);
  assert.match(projectFiles, /lastModifiedAt/);
  assert.match(projectFiles, /persistedRevision/);
  assert.match(sourceRename, /pendingRename/);
  assert.match(sourceRename, /expectedSha256/);
  assert.match(sourceRename, /RENAME_DESTINATION_EXISTS/);
  assert.match(sourceRename, /recoverPendingSourceRename/);
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
  assert.match(
    preload,
    /exposeInMainWorld\(["']htmlAIPreview["'],\s*previewApi\)/,
  );
  assert.match(preload, /exposeInMainWorld\(["']htmlAIRuntime["'],\s*runtimeConfig\)/);
  assert.match(preload, /exposeInMainWorld\(["']htmlAIAppLifecycle["'],\s*appLifecycleApi\)/);
  assert.match(preload, /onPrepareClose/);
  assert.match(preload, /reportReady/);
  assert.match(preload, /reportBlocked/);
  assert.match(preload, /onCloseAborted/);
  assert.match(preload, /onWorkspaceUnavailable/);
  assert.match(
    preload,
    /ipcRenderer\.invoke\(appChannels\.workspaceRecoveryReady\)/,
  );
  assert.match(preload, /relaunch:\s*\(\) => ipcRenderer\.invoke\(appChannels\.relaunch\)/);
  assert.match(
    preload,
    /openUserNotice:\s*\(\) => invokeProject\(appChannels\.openUserNotice\)/,
  );
  assert.match(preload, /forgetRecent:\s*\(sourcePath\)/);
  assert.match(
    preload,
    /installDownloaded:\s*\(\) => invokeProject\(updateChannels\.installDownloaded\)/,
  );
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
  assert.match(rendererHtml, /frame-src 'self' data: blob: pageroot-preview:/);
  assert.match(rendererHtml, /object-src 'none'/);
  assert.match(rendererHtml, /base-uri 'self' file:/);
  assert.match(rendererHtml, /<title>源页<\/title>/);
  assert.match(rendererHtml, /源页（PageRoot）— Editable islands/);
  assert.doesNotMatch(rendererHtml, /frame-ancestors/);
  assert.match(mainProcess, /path\.join\(\s*documents,\s*"PageRoot",\s*"项目记录",?\s*\)/);
  assert.match(mainProcess, /path\.join\(\s*documents,\s*"PageRootV2",\s*"项目记录",?\s*\)/);
  assert.match(mainProcess, /path\.join\(\s*documents,\s*"YuanYe",\s*"项目记录",?\s*\)/);
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
  assert.match(applicationUpdate, /updater\.autoDownload = false/);
  assert.match(applicationUpdate, /updater\.autoInstallOnAppQuit = false/);
  assert.match(applicationUpdate, /updater\.allowPrerelease = false/);
  assert.match(applicationUpdate, /updater\.disableDifferentialDownload = false/);
  assert.match(applicationUpdate, /updater\.downloadUpdate\(\)/);
  assert.match(applicationUpdate, /updater\.quitAndInstall\(\)/);
  assert.match(mainProcess, /createUsageTelemetry/);
  assert.match(mainProcess, /html-usage:capture/);
  assert.match(preload, /exposeInMainWorld\("htmlAIUsage", usageApi\)/);
  assert.match(preload, /exposeInMainWorld\("htmlAIEdit", editApi\)/);
  assert.match(mainProcess, /html-edit:history-requested/);
  assert.match(mainProcess, /html-edit:native-history/);
  assert.match(usageTelemetry, /\$process_person_profile:\s*false/u);
  assert.match(usageTelemetry, /\$geoip_disable:\s*true/u);
  assert.match(usageTelemetry, /\$is_server:\s*false/u);
  assert.match(usageTelemetry, /createHmac\(\s*"sha256"/u);
  assert.doesNotMatch(
    `${mainProcess}\n${usageTelemetry}`,
    /systemProfiler|serialNumber|hardwareUuid|IOPlatformUUID|ioreg|machineId/iu,
  );
  assert.match(entitlements, /com\.apple\.security\.cs\.allow-jit/);
  assert.doesNotMatch(entitlements, /disable-library-validation/);
  assert.match(afterPack, /NSMicrophoneUsageDescription/);
  assert.match(afterPack, /NSAudioCaptureUsageDescription/);
  assert.match(afterPack, /Delete/);
});
