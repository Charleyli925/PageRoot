import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  Menu,
  net,
  protocol,
  session as electronSession,
  shell,
  utilityProcess,
  webFrameMain,
} from "electron";
import electronUpdater from "electron-updater";
import {
  createHash,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ProjectFileError,
  ensureManagedWelcomeHtml,
  managedWelcomeSourcePath,
  readHtmlFile,
  writeHtmlCopy,
} from "./project-files.mjs";
import {
  createSafeExportDefaultPath,
  isProtectedExportDestination,
  normalizeHtmlExportPath,
  runProjectIpcOperation,
  selectExportDestination,
} from "./export-copy.mjs";
import {
  createWorkspaceRecoveryMailbox,
  stopBridgeProcessGracefully,
} from "./bridge-shutdown.mjs";
import {
  BridgeExitedBeforeReadyError,
  waitForBridgeReady,
} from "./bridge-startup.mjs";
import { createOpenInDefaultBrowserOperation } from "./open-in-default-browser.mjs";
import {
  createExternalFileOpenExitHandoff,
  createExternalFileOpenMailbox,
  externalOpenFailurePresentation,
  externalHtmlPathsFromArgv,
} from "./external-file-open.mjs";
import { createProjectOpenQueue } from "./project-open-queue.mjs";
import { assertTrustedRendererEvent } from "./project-ipc-security.mjs";
import {
  closeAbortPayload,
  normalizeCloseResult,
  runGuardedFinalExit,
  shouldPresentNativeCloseBlock,
  stopBridgeOrNotifyCloseAborted,
} from "./close-recovery.mjs";
import {
  PRODUCT_MAX_HTML_BYTES,
  isGeneratedWorkingCopyFileName,
} from "./product-contract.mjs";
import {
  isActiveProjectIdentity,
  isManagedVersionRelativePath,
} from "./project-path-policy.mjs";
import { handoffToQoderWork } from "./qoder-handoff.mjs";
import {
  LATEST_RELEASE_PAGE_URL,
  PROJECT_REPOSITORY_URL,
} from "./product-links.mjs";
import { createApplicationUpdateController } from "./application-update.mjs";
import {
  normalizeCompletedSourceRename,
  normalizePendingSourceRename,
  recoverPendingSourceRename,
  renameHtmlSource,
} from "./source-rename.mjs";
import {
  createTelemetryBuildConfig,
  createUsageTelemetry,
  durationBucket,
  readTelemetryBuildConfig,
} from "./usage-telemetry.mjs";
import {
  PREVIEW_PROTOCOL_SCHEME,
  createPreviewProtocolController,
  createPreviewSessionOperation,
  registerPreviewProtocolScheme,
} from "./preview-protocol.mjs";
import {
  createRuntimeSnapshotCaptureController,
} from "./runtime-visual-capture-owner.mjs";

// electron-updater is CommonJS; the default import is the supported ESM bridge.
const { autoUpdater } = electronUpdater;

registerPreviewProtocolScheme(protocol);

const directory = path.dirname(fileURLToPath(import.meta.url));
const USER_NOTICE_FILE_NAME = "PageRoot 用户声明与免责声明.txt";
const e2eUserDataPath = (() => {
  if (process.env.PAGEROOT_E2E !== "1") return null;
  const candidate = process.env.PAGEROOT_E2E_USER_DATA_DIR;
  if (!candidate) throw new Error("PAGEROOT_E2E_USER_DATA_DIR is required in E2E mode.");
  const resolved = path.resolve(candidate);
  const temporaryRoot = path.resolve(tmpdir());
  const relative = path.relative(temporaryRoot, resolved);
  if (
    relative === ""
    || relative.startsWith("..")
    || path.isAbsolute(relative)
    || !path.basename(resolved).startsWith("pageroot-native-e2e-")
  ) {
    throw new Error("PageRoot E2E userData must be an isolated pageroot-native-e2e-* directory under the system temporary directory.");
  }
  return resolved;
})();
const e2eWindowForeground = Boolean(e2eUserDataPath)
  && process.env.PAGEROOT_E2E_FOREGROUND === "1";
const e2eWindowRunsInBackground = Boolean(e2eUserDataPath)
  && !e2eWindowForeground;
const productUserDataPath = e2eUserDataPath || path.join(app.getPath("appData"), "PageRoot");
app.setPath("userData", productUserDataPath);
const applicationName = app.isPackaged
  ? path.basename(process.execPath, path.extname(process.execPath))
  : "源页";
app.setName(applicationName);
if (e2eWindowRunsInBackground && process.platform === "darwin") {
  app.setActivationPolicy("accessory");
}
if (e2eUserDataPath) {
  // Background E2E still needs deterministic timers, visibility state and
  // frame commits. Production launch behavior remains unchanged.
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
}

const BRIDGE_STARTUP_SLOW_MS = 12_000;
const RENDERER_CLOSE_TIMEOUT_MS = 30_000;
const BRIDGE_SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = PRODUCT_MAX_HTML_BYTES;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_PATH_LENGTH = 4096;
const MAX_RECENT_PROJECTS = 12;
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const PROJECT_STATE_VERSION = 2;
const PROJECT_CHANNELS = Object.freeze({
  getActiveProject: "html-projects:get-active",
  openHtml: "html-projects:open",
  readHtml: "html-projects:read",
  exportHtmlCopy: "html-projects:export-copy",
  showInFolder: "html-projects:show-in-folder",
  openInDefaultBrowser: "html-projects:open-in-default-browser",
  renameHtml: "html-projects:rename",
  activateGeneratedVersion: "html-projects:activate-generated-version",
  activateManagedWorkingCopy: "html-projects:activate-managed-working-copy",
  revealVersionFile: "html-projects:reveal-version-file",
  revealRequestFolder: "html-projects:reveal-request-folder",
  listRecentProjects: "html-projects:list-recent",
  openRecent: "html-projects:open-recent",
  forgetRecent: "html-projects:forget-recent",
  acceptExternalOpen: "html-projects:accept-external-open",
});
const APP_CHANNELS = Object.freeze({
  prepareClose: "html-app:prepare-close",
  closeResult: "html-app:close-result",
  closeAborted: "html-app:close-aborted",
  aboutRequested: "html-app:about-requested",
  workspaceUnavailable: "html-app:workspace-unavailable",
  workspaceRecoveryReady: "html-app:workspace-recovery-ready",
  externalOpenRequested: "html-app:external-open-requested",
  externalOpenReady: "html-app:external-open-ready",
  relaunch: "html-app:relaunch",
  openUserNotice: "html-app:open-user-notice",
});
const INTEGRATION_CHANNELS = Object.freeze({
  qoderHandoff: "html-integrations:qoder-handoff",
});
const UPDATE_CHANNELS = Object.freeze({
  getStatus: "html-updates:get-status",
  status: "html-updates:status",
  checkNow: "html-updates:check-now",
  downloadAvailable: "html-updates:download-available",
  installDownloaded: "html-updates:install-downloaded",
  openLatestRelease: "html-updates:open-latest-release",
  openRepository: "html-updates:open-repository",
});
const USAGE_CHANNELS = Object.freeze({
  capture: "html-usage:capture",
});
const PREVIEW_CHANNELS = Object.freeze({
  createSession: "html-preview:create-session",
  revokeSession: "html-preview:revoke-session",
});
const REVIEW_RUNTIME_SNAPSHOT_CHANNELS = Object.freeze({
  capture: "html-review-runtime-snapshots:capture",
});
const EDIT_CHANNELS = Object.freeze({
  historyRequested: "html-edit:history-requested",
  nativeHistory: "html-edit:native-history",
});

let bridgeProcess = null;
let bridgePort = null;
let bridgeStartupPromise = null;
const bridgeAuthToken = randomBytes(32).toString("base64url");
let mainWindow = null;
let rendererHasLoaded = false;
let isQuitting = false;
let finalExitStarted = false;
let closeRequest = null;
let coordinatedExit = null;
let closeAttemptGeneration = 0;
let projectIpcRegistered = false;
let projectState = null;
let stateWriteQueue = Promise.resolve();
let latestUpdateResult = null;
let applicationUpdate = null;
let usageTelemetry = null;
let workspaceFailurePrompt = null;
let managedWelcomeRegistration = null;
let previewProtocolController = null;
let reviewRuntimeSnapshotCaptureController = null;
const workspaceRecoveryMailbox = createWorkspaceRecoveryMailbox();
const externalFileOpenMailbox = createExternalFileOpenMailbox();
const externalFileOpenExitHandoff = createExternalFileOpenExitHandoff({
  handoffPath: path.join(app.getPath("userData"), "external-open-handoff.json"),
});
const projectOpenQueue = createProjectOpenQueue();

function ensurePreviewProtocolController() {
  if (!previewProtocolController) {
    previewProtocolController = createPreviewProtocolController({
      protocolApi: protocol,
      netFetch: (url, options) => net.fetch(url, options),
      maxHtmlBytes: MAX_HTML_BYTES,
    });
    previewProtocolController.install();
  }
  return previewProtocolController;
}

function ensureReviewRuntimeSnapshotCaptureController() {
  if (!reviewRuntimeSnapshotCaptureController) {
    reviewRuntimeSnapshotCaptureController = createRuntimeSnapshotCaptureController({
      BrowserWindowClass: BrowserWindow,
      createSession: async (payload) => {
        const sourcePath = await currentActivePath();
        return ensurePreviewProtocolController().createSession({
          ...payload,
          ...(sourcePath ? { sourcePath } : {}),
        });
      },
      revokeSession: (sessionId) => (
        Promise.resolve(
          ensurePreviewProtocolController().revokeSession(sessionId),
        )
      ),
      createIsolatedSession: (partition) => {
        const isolatedSession = electronSession.fromPartition(partition);
        ensurePreviewProtocolController().installFor(isolatedSession.protocol);
        return isolatedSession;
      },
      async releaseIsolatedSession(isolatedSession) {
        await Promise.all([
          Promise.resolve(isolatedSession.clearStorageData?.()).catch(() => undefined),
          Promise.resolve(
            isolatedSession.protocol?.unhandle?.("pageroot-preview"),
          ).catch(() => undefined),
        ]);
      },
    });
  }
  return reviewRuntimeSnapshotCaptureController;
}

function telemetryFingerprint(value) {
  const text = value instanceof Error
    ? `${value.name}\n${value.stack || value.message}`
    : String(value ?? "");
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function telemetryReasonCode(value, fallback = "UNKNOWN") {
  const normalized = String(value || fallback)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 80);
  return normalized || fallback;
}

function captureUsage(event, properties = {}, context = {}) {
  try {
    return usageTelemetry?.capture(event, properties, context) ?? false;
  } catch {
    return false;
  }
}

async function initializeUsageTelemetry() {
  let environmentConfig;
  try {
    environmentConfig = createTelemetryBuildConfig(process.env);
  } catch {
    environmentConfig = createTelemetryBuildConfig({});
  }
  let packagedConfig = null;
  if (app.isPackaged) {
    packagedConfig = await readTelemetryBuildConfig(
      path.join(process.resourcesPath, "usage-telemetry-config.json"),
    ).catch(() => null);
  }
  const config = environmentConfig.enabled
    ? environmentConfig
    : packagedConfig || environmentConfig;
  const runtimeEnabled = (
    process.env.PAGEROOT_TELEMETRY_DISABLED !== "1"
    && process.env.PAGEROOT_E2E !== "1"
    && (
      app.isPackaged
      || process.env.PAGEROOT_TELEMETRY_DEV === "1"
    )
  );
  usageTelemetry = createUsageTelemetry({
    userDataPath: app.getPath("userData"),
    projectToken: config.projectToken,
    host: config.host,
    enabled: runtimeEnabled && config.enabled,
    appVersion: app.getVersion(),
    platform: process.platform,
    architecture: process.arch,
    fetchImpl: (url, options) => net.fetch(url, options),
  });
  await usageTelemetry.start();
}

process.on("uncaughtExceptionMonitor", (error) => {
  captureUsage("runtime_fault", {
    process: "main",
    kind: "main_uncaught",
    reason_code: telemetryReasonCode(error?.name, "UNCAUGHT_EXCEPTION"),
    fingerprint: telemetryFingerprint(error),
  });
});

function presentMainWindow() {
  if (
    e2eWindowRunsInBackground
    || !mainWindow
    || mainWindow.isDestroyed()
  ) return false;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  return true;
}

function requestAboutPageRoot() {
  if (
    !rendererHasLoaded
    || !mainWindow
    || mainWindow.isDestroyed()
  ) {
    return;
  }
  presentMainWindow();
  mainWindow.webContents.send(APP_CHANNELS.aboutRequested);
}

function requestRendererHistory(direction) {
  if (
    !rendererHasLoaded
    || !mainWindow
    || mainWindow.isDestroyed()
  ) return;
  mainWindow.webContents.send(EDIT_CHANNELS.historyRequested, { direction });
}

function installApplicationMenu() {
  if (process.platform !== "darwin") return;
  const menu = Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        {
          label: "关于源页",
          click: requestAboutPageRoot,
        },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    {
      role: "editMenu",
      submenu: [
        {
          label: "Undo",
          accelerator: "CommandOrControl+Z",
          click: () => requestRendererHistory("undo"),
        },
        {
          label: "Redo",
          accelerator: "CommandOrControl+Shift+Z",
          click: () => requestRendererHistory("redo"),
        },
        { type: "separator" },
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        { role: "pasteAndMatchStyle" },
        { role: "delete" },
        { role: "selectAll" },
        { type: "separator" },
        { role: "startSpeaking" },
        { role: "stopSpeaking" },
      ],
    },
    { role: "windowMenu" },
  ]);
  Menu.setApplicationMenu(menu);
}

function emptyProjectState() {
  return {
    version: PROJECT_STATE_VERSION,
    activePath: null,
    recent: [],
    pendingRename: null,
    lastRename: null,
    lastManagedActivation: null,
  };
}

function projectStatePath() {
  return path.join(app.getPath("userData"), "html-projects.json");
}

async function projectStatePathForRead() {
  const currentPath = projectStatePath();
  if (e2eUserDataPath) return currentPath;
  const compatibilityPaths = ["PageRootV2", "YuanYe", "HTML AI 工作台"].map(
    (directoryName) => (
      path.join(app.getPath("appData"), directoryName, "html-projects.json")
    ),
  );
  for (const candidate of [currentPath, ...compatibilityPaths]) {
    const isFile = await stat(candidate)
      .then((entry) => entry.isFile())
      .catch(() => false);
    if (isFile) return candidate;
  }
  return currentPath;
}

function assertHtmlPath(value, label = "HTML 文件路径") {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.length > MAX_PATH_LENGTH
    || value.includes("\0")
  ) {
    throw new TypeError(`${label}无效。`);
  }

  const resolved = path.resolve(value);
  if (!HTML_EXTENSIONS.has(path.extname(resolved).toLowerCase())) {
    throw new TypeError(`${label}必须以 .html 或 .htm 结尾。`);
  }
  return resolved;
}

async function existingPathIdentity(value) {
  const resolved = path.resolve(value);
  return realpath(resolved).catch(() => resolved);
}

function assertOptionalSuggestedName(value) {
  if (value === undefined || value === null || value === "") return null;
  const trimmed = typeof value === "string" ? value.trim() : value;
  if (
    typeof trimmed !== "string"
    || trimmed.length === 0
    || trimmed.length > 180
    || trimmed.includes("\0")
    || trimmed !== path.basename(trimmed)
    || trimmed.includes("\\")
    || trimmed === "."
    || trimmed === ".."
  ) {
    throw new TypeError("建议文件名无效。");
  }
  return trimmed;
}

function assertHtmlPayload(payload, { allowSuggestedName = false } = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("保存参数无效。");
  }
  const allowedKeys = allowSuggestedName
    ? new Set(["html", "sourcePath", "suggestedName", "expectedSha256"])
    : new Set(["html", "sourcePath", "expectedSha256"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("保存参数包含未支持的字段。");
  }
  if (typeof payload.html !== "string") {
    throw new TypeError("HTML 内容必须是字符串。");
  }
  if (Buffer.byteLength(payload.html, "utf8") > MAX_HTML_BYTES) {
    throw new RangeError("HTML 文件不能超过 25 MB。");
  }

  const sourcePath = payload.sourcePath === undefined || payload.sourcePath === null
    ? null
    : assertHtmlPath(payload.sourcePath, "sourcePath");
  const suggestedName = allowSuggestedName
    ? assertOptionalSuggestedName(payload.suggestedName)
    : null;
  const expectedSha256 = payload.expectedSha256 === undefined || payload.expectedSha256 === null
    ? null
    : String(payload.expectedSha256).trim().toLowerCase();
  if (expectedSha256 && !/^sha256:[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new TypeError("expectedSha256 必须使用 sha256:<64 位十六进制> 格式。");
  }

  return { html: payload.html, sourcePath, suggestedName, expectedSha256 };
}

function assertReadPayload(sourcePath) {
  return assertHtmlPath(sourcePath, "sourcePath");
}

function assertExportPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("导出参数无效。");
  }
  const allowedKeys = new Set(["html", "suggestedName", "sourcePath"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("导出参数包含未支持的字段。");
  }
  const { html, sourcePath, suggestedName } = assertHtmlPayload(
    {
      html: payload.html,
      sourcePath: payload.sourcePath ?? null,
      suggestedName: payload.suggestedName,
    },
    { allowSuggestedName: true },
  );
  return { html, sourcePath, suggestedName };
}

function isValidRecentEntry(entry) {
  if (!entry || typeof entry !== "object") return false;
  try {
    assertHtmlPath(entry.path);
  } catch {
    return false;
  }
  return Number.isFinite(entry.lastOpenedAt);
}

function normalizeManagedWorkingCopyActivation(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  try {
    const operationId = String(value.operationId || "");
    const projectId = String(value.projectId || "");
    const documentId = String(value.documentId || "");
    const workingCopyId = String(value.workingCopyId || "");
    const versionId = String(value.versionId || "");
    const expectedSha256 = String(value.expectedSha256 || "").trim().toLowerCase();
    const projectRootPath = String(value.projectRootPath || "");
    if (
      !/^[A-Za-z0-9_-]{8,160}$/.test(operationId)
      || !/^project_[A-Za-z0-9_-]+$/.test(projectId)
      || !/^doc_[A-Za-z0-9_-]+$/.test(documentId)
      || !/^work_ver_\d{4,}$/.test(workingCopyId)
      || !/^ver_\d{4,}$/.test(versionId)
      || !/^sha256:[a-f0-9]{64}$/.test(expectedSha256)
      || !projectRootPath
      || projectRootPath.length > MAX_PATH_LENGTH
      || projectRootPath.includes("\0")
      || !Number.isFinite(Number(value.completedAt))
    ) return null;
    return {
      operationId,
      projectId,
      documentId,
      workingCopyId,
      versionId,
      expectedSha256,
      previousSourcePath: assertHtmlPath(value.previousSourcePath, "previousSourcePath"),
      nextSourcePath: assertHtmlPath(value.nextSourcePath, "nextSourcePath"),
      projectRootPath: path.resolve(projectRootPath),
      completedAt: Number(value.completedAt),
    };
  } catch {
    return null;
  }
}

function sameManagedWorkingCopyActivation(left, right) {
  return Boolean(
    left
    && right
    && left.operationId === right.operationId
    && left.projectId === right.projectId
    && left.documentId === right.documentId
    && left.workingCopyId === right.workingCopyId
    && left.versionId === right.versionId
    && left.expectedSha256 === right.expectedSha256
    && left.previousSourcePath === right.previousSourcePath
    && left.nextSourcePath === right.nextSourcePath
    && left.projectRootPath === right.projectRootPath,
  );
}

async function loadProjectState() {
  if (projectState) return projectState;

  const statePath = await projectStatePathForRead();
  try {
    const stateStats = await stat(statePath);
    if (!stateStats.isFile() || stateStats.size > MAX_STATE_BYTES) {
      projectState = emptyProjectState();
      return projectState;
    }

    const parsed = JSON.parse(await readFile(statePath, "utf8"));
    const recent = Array.isArray(parsed.recent)
      ? parsed.recent.filter(isValidRecentEntry).slice(0, MAX_RECENT_PROJECTS).map((entry) => ({
        path: path.resolve(entry.path),
        name:
          typeof entry.name === "string" && entry.name.trim()
            ? entry.name.trim()
            : path.basename(entry.path),
        lastOpenedAt: entry.lastOpenedAt,
      }))
      : [];
    const activePath = typeof parsed.activePath === "string"
      && recent.some((entry) => entry.path === path.resolve(parsed.activePath))
      ? path.resolve(parsed.activePath)
      : null;

    projectState = {
      version: PROJECT_STATE_VERSION,
      activePath,
      recent,
      pendingRename: normalizePendingSourceRename(parsed.pendingRename),
      lastRename: normalizeCompletedSourceRename(parsed.lastRename),
      lastManagedActivation: normalizeManagedWorkingCopyActivation(parsed.lastManagedActivation),
    };
    if (projectState.pendingRename) {
      await recoverPendingSourceRename({
        state: projectState,
        readProject: readHtmlProject,
        persistState: persistProjectState,
      }).catch((error) => {
        console.error(
          "[source-rename:recovery]",
          error instanceof Error ? error.stack || error.message : String(error),
        );
      });
    }
  } catch {
    projectState = emptyProjectState();
  }

  return projectState;
}

function persistProjectState() {
  const writeState = async () => {
    const statePath = projectStatePath();
    await mkdir(path.dirname(statePath), { recursive: true });
    const temporaryPath = `${statePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(projectState, null, 2)}\n`, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporaryPath, statePath);
    } finally {
      await unlink(temporaryPath).catch(() => {});
    }
  };
  stateWriteQueue = stateWriteQueue.then(writeState, writeState);
  return stateWriteQueue;
}

async function activateProject(filePath) {
  const normalizedPath = await existingPathIdentity(assertHtmlPath(filePath));
  const state = await loadProjectState();
  const recentPathIdentities = await Promise.all(
    state.recent.map((entry) => existingPathIdentity(entry.path)),
  );
  const now = Date.now();
  state.activePath = normalizedPath;
  state.lastManagedActivation = null;
  state.recent = [
    {
      path: normalizedPath,
      name: path.basename(normalizedPath),
      lastOpenedAt: now,
    },
    ...state.recent.filter(
      (_entry, index) => recentPathIdentities[index] !== normalizedPath,
    ),
  ].slice(0, MAX_RECENT_PROJECTS);
  await persistProjectState();
}

async function forgetProject(filePath) {
  const state = await loadProjectState();
  const forgottenIdentity = await existingPathIdentity(filePath);
  const recentPathIdentities = await Promise.all(
    state.recent.map((entry) => existingPathIdentity(entry.path)),
  );
  state.recent = state.recent.filter(
    (_entry, index) => recentPathIdentities[index] !== forgottenIdentity,
  );
  if (
    state.activePath
    && await existingPathIdentity(state.activePath) === forgottenIdentity
  ) state.activePath = null;
  await persistProjectState();
}

async function inspectHtmlFile(filePath) {
  const normalizedPath = assertHtmlPath(filePath);
  const fileStats = await lstat(normalizedPath);
  if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
    throw new ProjectFileError(
      "UNSAFE_EXTERNAL_HTML",
      "只能打开普通 HTML 文件。",
    );
  }
  if (fileStats.size > MAX_HTML_BYTES) {
    throw new ProjectFileError(
      "HTML_TOO_LARGE",
      "HTML 文件不能超过 25 MB。",
    );
  }
  return normalizedPath;
}

async function readHtmlProject(filePath) {
  const normalizedPath = await inspectHtmlFile(filePath);
  const canonicalPath = await realpath(normalizedPath);
  return readHtmlFile({
    sourcePath: canonicalPath,
    maxHtmlBytes: MAX_HTML_BYTES,
  });
}

function showExternalOpenError(error) {
  const presentation = externalOpenFailurePresentation(error);
  dialog.showErrorBox(
    "无法打开这个 HTML",
    `${presentation.message}\n\n错误代码：${presentation.code}`,
  );
}

function focusMainWindow() {
  return presentMainWindow();
}

function interruptCloseForExternalOpen() {
  if (!coordinatedExit || isQuitting || finalExitStarted) return false;
  closeAttemptGeneration += 1;
  if (!closeRequest) return true;
  const pending = closeRequest;
  closeRequest = null;
  clearTimeout(pending.timeout);
  pending.resolve({
    requestId: pending.requestId,
    ready: false,
    reason: "收到新的外部 HTML 打开请求，已取消关闭。",
    presentation: "in-app",
  });
  return true;
}

function deferExternalFileOpenUntilNextLaunch(filePath) {
  try {
    return externalFileOpenExitHandoff.defer(filePath);
  } catch {
    // The exiting process must never accept a new path after close has
    // committed. A failed private handoff leaves the request unaccepted.
    return null;
  }
}

function resumeDeferredExternalFileOpenAfterExitAbort() {
  if (isQuitting || finalExitStarted) return;
  const sourcePath = externalFileOpenExitHandoff.take();
  if (sourcePath) publishExternalFileOpen(sourcePath);
}

function publishExternalFileOpen(filePath) {
  if (isQuitting || finalExitStarted) {
    return deferExternalFileOpenUntilNextLaunch(filePath);
  }
  interruptCloseForExternalOpen();
  try {
    const request = externalFileOpenMailbox.publish(filePath);
    focusMainWindow();
    if (rendererHasLoaded && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(APP_CHANNELS.externalOpenRequested, request);
    }
    return request;
  } catch (error) {
    if (app.isReady()) showExternalOpenError(error);
    return null;
  }
}

async function openExternalFileRequest(request) {
  return projectOpenQueue.run(async () => {
    const project = await readHtmlProject(request.sourcePath);
    await activateProject(project.sourcePath);
    return project;
  });
}

async function adoptPendingExternalFileAtStartup() {
  const pending = externalFileOpenMailbox.peek();
  if (!pending) return null;
  const operation = externalFileOpenMailbox.accept(
    pending.requestId,
    openExternalFileRequest,
  );
  if (!operation) return null;
  try {
    return await operation;
  } catch (error) {
    showExternalOpenError(error);
    return null;
  }
}

async function acceptExternalFileOpen(payload) {
  if (
    !payload
    || typeof payload !== "object"
    || Array.isArray(payload)
    || Object.keys(payload).some((key) => key !== "requestId")
    || typeof payload.requestId !== "string"
  ) {
    throw new ProjectFileError(
      "INVALID_EXTERNAL_OPEN_REQUEST",
      "外部 HTML 打开请求无效。",
    );
  }
  const operation = externalFileOpenMailbox.accept(
    payload.requestId,
    openExternalFileRequest,
  );
  if (!operation) {
    throw new ProjectFileError(
      "EXTERNAL_OPEN_REQUEST_EXPIRED",
      "这次外部打开请求已经失效，请从 QoderWork 再点一次 PageRoot。",
    );
  }
  return operation;
}

async function currentActivePath() {
  const state = await loadProjectState();
  return state.activePath;
}

async function ensureBridgeProjectRegistered(project) {
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "欢迎页已经建立，但项目记录服务尚未就绪。",
    );
  }
  const endpoint = new URL(`http://127.0.0.1:${bridgePort}/project/ensure`);
  const response = await net.fetch(endpoint, {
    method: "POST",
    cache: "no-store",
    headers: {
      "Content-Type": "application/json",
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
    body: JSON.stringify({
      sourcePath: project.sourcePath,
      expectedSourceSha256: project.sha256,
    }),
  });
  const workspace = await response.json().catch(() => null);
  const [workspaceSourceIdentity, projectSourceIdentity] = await Promise.all([
    typeof workspace?.sourcePath === "string"
      ? existingPathIdentity(workspace.sourcePath)
      : Promise.resolve(null),
    existingPathIdentity(project.sourcePath),
  ]);
  if (
    !response.ok
    || !workspace
    || workspace.ok !== true
    || workspace.registered !== true
    || typeof workspace.projectId !== "string"
    || !/^project_[A-Za-z0-9_-]+$/.test(workspace.projectId)
    || typeof workspace.documentId !== "string"
    || !/^doc_[A-Za-z0-9_-]+$/.test(workspace.documentId)
    || workspaceSourceIdentity !== projectSourceIdentity
    || workspace.currentHtmlSha256 !== project.sha256
  ) {
    throw new ProjectFileError(
      "WELCOME_WORKSPACE_REGISTRATION_FAILED",
      "欢迎页已经建立，但对应的项目工作区没有通过完整性校验。",
      { sourcePath: project.sourcePath },
    );
  }
  managedWelcomeRegistration = `${projectSourceIdentity}\0${project.sha256}`;
}

async function getActiveProject() {
  return projectOpenQueue.run(getActiveProjectOperation);
}

async function getActiveProjectOperation() {
  const workspaceRoot = await workspacePath();
  const welcomeSourcePath = managedWelcomeSourcePath(workspaceRoot);
  let activePath = await currentActivePath();
  let project;
  if (!activePath) {
    project = await ensureManagedWelcomeHtml({
      workspaceRoot,
      maxHtmlBytes: MAX_HTML_BYTES,
    });
    activePath = project.sourcePath;
    await activateProject(activePath);
    // activateProject persists the canonical filesystem identity. Re-read the
    // welcome project through that identity so the renderer and bridge start
    // from the same source path on systems where /var maps to /private/var.
    project = null;
  }
  try {
    project ||= await readHtmlProject(activePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new ProjectFileError(
        "ACTIVE_PROJECT_MISSING",
        `上次打开的 HTML 已不在原位置：${activePath}`,
        { sourcePath: activePath },
      );
    }
    throw error;
  }
  const [activePathIdentity, welcomePathIdentity, projectSourceIdentity] =
    await Promise.all([
      existingPathIdentity(activePath),
      existingPathIdentity(welcomeSourcePath),
      existingPathIdentity(project.sourcePath),
    ]);
  if (activePathIdentity === welcomePathIdentity) {
    const registrationKey = `${projectSourceIdentity}\0${project.sha256}`;
    if (managedWelcomeRegistration !== registrationKey) {
      await ensureBridgeProjectRegistered(project);
    }
  }
  return project;
}

async function openHtml() {
  return projectOpenQueue.run(async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "打开 HTML 项目",
      buttonLabel: "打开",
      properties: ["openFile"],
      filters: [
        { name: "HTML 文件", extensions: ["html", "htm"] },
      ],
    });
    if (result.canceled || result.filePaths.length !== 1) return null;

    const project = await readHtmlProject(result.filePaths[0]);
    await activateProject(project.sourcePath);
    return project;
  });
}

async function assertKnownProjectPath(sourcePath) {
  const state = await loadProjectState();
  const requestedIdentity = await existingPathIdentity(sourcePath);
  const knownIdentities = await Promise.all([
    state.activePath,
    ...state.recent.map((entry) => entry.path),
  ].filter(Boolean).map(existingPathIdentity));
  const known = knownIdentities.includes(requestedIdentity);
  if (!known) {
    throw new ProjectFileError(
      "UNKNOWN_SOURCE",
      "只能更新已经由工作台打开的 HTML 文件。",
      { sourcePath },
    );
  }
}

async function readHtml(sourcePathInput) {
  const sourcePath = assertReadPayload(sourcePathInput);
  await assertKnownProjectPath(sourcePath);
  return readHtmlFile({
    sourcePath,
    maxHtmlBytes: MAX_HTML_BYTES,
  });
}

async function showInFolder(sourcePathInput) {
  const sourcePath = assertReadPayload(sourcePathInput);
  await assertKnownProjectPath(sourcePath);
  await inspectHtmlFile(sourcePath);
  shell.showItemInFolder(sourcePath);
  return { sourcePath };
}

const openInDefaultBrowser = createOpenInDefaultBrowserOperation({
  assertKnownProjectPath,
  inspectHtmlFile,
  openExternal: (sourceUrl) => shell.openExternal(sourceUrl),
});

const createPreviewSession = createPreviewSessionOperation({
  createSession: (payload) => (
    ensurePreviewProtocolController().createSession(payload)
  ),
  authorizeSourcePath: async (sourcePathInput) => {
    const sourcePath = assertReadPayload(sourcePathInput);
    await assertKnownProjectPath(sourcePath);
    return inspectHtmlFile(sourcePath);
  },
});

const captureReviewRuntimeSnapshot = (payload) => (
  ensureReviewRuntimeSnapshotCaptureController().capture(payload)
);

async function resolveKnownRenameSource(sourcePathInput) {
  const sourcePath = assertReadPayload(sourcePathInput);
  const state = await loadProjectState();
  const [requestedIdentity, activeIdentity] = await Promise.all([
    existingPathIdentity(sourcePath),
    state.activePath
      ? existingPathIdentity(state.activePath)
      : Promise.resolve(null),
  ]);
  if (!isActiveProjectIdentity({ requestedIdentity, activeIdentity })) {
    throw new ProjectFileError(
      "INACTIVE_RENAME_SOURCE",
      "只能重命名当前正在编辑的 HTML 文件。",
      { sourcePath },
    );
  }
  await inspectHtmlFile(sourcePath);
  return realpath(sourcePath);
}

async function rebindRenamedWorkspace(sourcePath, expectedSha256) {
  if (!bridgePort) return false;
  const endpoint = new URL(`http://127.0.0.1:${bridgePort}/workspace`);
  endpoint.searchParams.set("sourcePath", sourcePath);
  const response = await net.fetch(endpoint, {
    cache: "no-store",
    headers: {
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
  });
  const workspace = await response.json().catch(() => null);
  if (
    !response.ok
    || !workspace
    || workspace.ok !== true
    || workspace.currentHtmlSha256 !== expectedSha256
    || typeof workspace.sourcePath !== "string"
  ) return false;
  const [workspaceIdentity, renamedIdentity] = await Promise.all([
    existingPathIdentity(workspace.sourcePath),
    existingPathIdentity(sourcePath),
  ]);
  return workspaceIdentity === renamedIdentity;
}

async function renameHtml(payload) {
  return projectOpenQueue.run(() => renameHtmlOperation(payload));
}

async function renameHtmlOperation(payload) {
  const state = await loadProjectState();
  return renameHtmlSource({
    payload,
    state,
    persistState: persistProjectState,
    resolveKnownSource: resolveKnownRenameSource,
    readProject: readHtmlProject,
    rebindWorkspace: rebindRenamedWorkspace,
  });
}

async function activateGeneratedVersion(payload) {
  return projectOpenQueue.run(() => activateGeneratedVersionOperation(payload));
}

function assertManagedWorkingCopyActivationPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("托管工作文件参数无效。");
  }
  const allowedKeys = new Set([
    "previousSourcePath",
    "nextSourcePath",
    "expectedSha256",
    "projectId",
    "documentId",
    "workingCopyId",
    "versionId",
    "projectRootPath",
    "operationId",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("托管工作文件参数包含未支持的字段。");
  }
  const previousSourcePath = assertHtmlPath(
    payload.previousSourcePath,
    "previousSourcePath",
  );
  const nextSourcePath = assertHtmlPath(
    payload.nextSourcePath,
    "nextSourcePath",
  );
  const expectedSha256 = String(payload.expectedSha256 || "").trim().toLowerCase();
  if (!/^sha256:[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new TypeError("expectedSha256 必须使用 sha256:<64 位十六进制> 格式。");
  }
  const projectId = String(payload.projectId || "");
  const documentId = String(payload.documentId || "");
  const workingCopyId = String(payload.workingCopyId || "");
  const versionId = String(payload.versionId || "");
  const projectRootPath = String(payload.projectRootPath || "");
  const operationId = payload.operationId === undefined || payload.operationId === null
    ? null
    : String(payload.operationId);
  if (
    !/^project_[A-Za-z0-9_-]+$/.test(projectId)
    || !/^doc_[A-Za-z0-9_-]+$/.test(documentId)
    || !/^work_ver_\d{4,}$/.test(workingCopyId)
    || !/^ver_\d{4,}$/.test(versionId)
    || !projectRootPath
    || projectRootPath.length > MAX_PATH_LENGTH
    || projectRootPath.includes("\0")
    || (operationId !== null && !/^[A-Za-z0-9_-]{8,160}$/.test(operationId))
  ) {
    throw new TypeError("托管工作文件身份无效。");
  }
  return {
    previousSourcePath,
    nextSourcePath,
    expectedSha256,
    projectId,
    documentId,
    workingCopyId,
    versionId,
    projectRootPath: path.resolve(projectRootPath),
    operationId,
  };
}

async function commitActivatedProjectPath({
  state,
  previousSourcePath,
  nextSourcePath,
  project,
  managedActivation = null,
}) {
  const now = Date.now();
  const activePathIdentity = state.activePath
    ? await existingPathIdentity(state.activePath)
    : null;
  const recentPathIdentities = await Promise.all(
    state.recent.map((entry) => existingPathIdentity(entry.path)),
  );
  const activatesCurrentProject =
    activePathIdentity === previousSourcePath
    || activePathIdentity === nextSourcePath;
  const replacedIndex = recentPathIdentities.findIndex(
    (identity) => identity === previousSourcePath || identity === nextSourcePath,
  );
  const replacedEntry = replacedIndex >= 0
    ? state.recent[replacedIndex]
    : null;
  const replacement = {
    path: nextSourcePath,
    name: replacedEntry?.name || path.basename(nextSourcePath),
    lastOpenedAt: activatesCurrentProject
      ? now
      : replacedEntry?.lastOpenedAt ?? now,
  };
  const retained = state.recent.filter(
    (_entry, index) => (
      recentPathIdentities[index] !== previousSourcePath
      && recentPathIdentities[index] !== nextSourcePath
    ),
  );
  if (activatesCurrentProject) {
    state.activePath = nextSourcePath;
    state.recent = [replacement, ...retained].slice(0, MAX_RECENT_PROJECTS);
  } else {
    retained.splice(
      Math.min(
        replacedIndex >= 0 ? replacedIndex : retained.length,
        retained.length,
      ),
      0,
      replacement,
    );
    state.recent = retained.slice(0, MAX_RECENT_PROJECTS);
  }
  state.lastManagedActivation = managedActivation;
  await persistProjectState();
  return {
    ...project,
    previousSourcePath,
  };
}

async function activateManagedWorkingCopy(payload) {
  return projectOpenQueue.run(() => activateManagedWorkingCopyOperation(payload));
}

async function activateManagedWorkingCopyOperation(payload) {
  const requested = assertManagedWorkingCopyActivationPayload(payload);
  if (
    process.env.PAGEROOT_E2E === "1"
    && process.env.PAGEROOT_E2E_GENERATED_VERSION_OPEN_FAILURE === "1"
    && requested.versionId !== "ver_0001"
  ) {
    throw new ProjectFileError(
      "E2E_MANAGED_WORKING_COPY_OPEN_FAILED",
      "测试注入：新版本文件暂时无法打开。",
    );
  }
  const state = await loadProjectState();
  const [previousSourcePath, nextSourcePath] = await Promise.all([
    existingPathIdentity(requested.previousSourcePath),
    existingPathIdentity(requested.nextSourcePath),
  ]);
  const activePathIdentity = state.activePath
    ? await existingPathIdentity(state.activePath)
    : null;
  const requestedActivation = requested.operationId
    ? {
      operationId: requested.operationId,
      projectId: requested.projectId,
      documentId: requested.documentId,
      workingCopyId: requested.workingCopyId,
      versionId: requested.versionId,
      expectedSha256: requested.expectedSha256,
      previousSourcePath,
      nextSourcePath,
      projectRootPath: requested.projectRootPath,
      completedAt: Date.now(),
    }
    : null;
  let managedActivation = null;
  if (requestedActivation) {
    const completed = state.lastManagedActivation;
    if (completed?.operationId === requestedActivation.operationId) {
      if (!sameManagedWorkingCopyActivation(completed, requestedActivation)) {
        throw new ProjectFileError(
          "MANAGED_WORKING_COPY_OPERATION_MISMATCH",
          "同一托管工作文件操作不能改变目标或前序文件。",
          { operationId: requestedActivation.operationId },
        );
      }
      if (activePathIdentity !== nextSourcePath) {
        throw new ProjectFileError(
          "MANAGED_WORKING_COPY_OPERATION_NOT_COMMITTED",
          "这次托管工作文件操作的桌面状态不完整，不能伪造重放结果。",
          { operationId: requestedActivation.operationId },
        );
      }
      managedActivation = completed;
    } else {
      if (activePathIdentity !== previousSourcePath) {
        throw new ProjectFileError(
          "MANAGED_WORKING_COPY_PREDECESSOR_CONFLICT",
          "当前桌面文件已变化，不能提交过期的托管工作文件切换。",
          {
            previousSourcePath: requested.previousSourcePath,
            activePath: state.activePath,
          },
        );
      }
      managedActivation = requestedActivation;
    }
  } else {
    const knownPathIdentities = new Set(await Promise.all([
      state.activePath,
      ...state.recent.map((entry) => entry.path),
    ].filter(Boolean).map(existingPathIdentity)));
    if (
      !knownPathIdentities.has(previousSourcePath)
      && !knownPathIdentities.has(nextSourcePath)
    ) {
      throw new ProjectFileError(
        "UNKNOWN_SOURCE",
        "只能从当前已经打开的 HTML 切换到托管工作文件。",
        { previousSourcePath: requested.previousSourcePath },
      );
    }
  }
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，当前文件没有切换。",
    );
  }

  const endpoint = new URL(`http://127.0.0.1:${bridgePort}/workspace`);
  endpoint.searchParams.set("sourcePath", nextSourcePath);
  const response = await net.fetch(endpoint, {
    cache: "no-store",
    headers: { "X-HTML-AI-Bridge-Token": bridgeAuthToken },
  });
  const workspace = await response.json().catch(() => null);
  const target = workspace?.openTarget;
  const exactTargetPath = typeof target?.exactSourcePath === "string"
    ? await existingPathIdentity(target.exactSourcePath)
    : null;
  const targetRootPath = typeof target?.projectRootPath === "string"
    ? path.resolve(target.projectRootPath)
    : "";
  if (
    !response.ok
    || !workspace
    || workspace.ok !== true
    || workspace.projectFileSchemaVersion !== "4.0.0"
    || workspace.projectId !== requested.projectId
    || workspace.documentId !== requested.documentId
    || workspace.currentHtmlSha256 !== requested.expectedSha256
    || !target
    || target.targetKind !== "working-copy"
    || target.projectId !== requested.projectId
    || target.documentId !== requested.documentId
    || target.workingCopyId !== requested.workingCopyId
    || target.versionId !== requested.versionId
    || target.sourceSha256 !== requested.expectedSha256
    || targetRootPath !== requested.projectRootPath
    || exactTargetPath !== nextSourcePath
  ) {
    throw new ProjectFileError(
      "MANAGED_WORKING_COPY_IDENTITY_MISMATCH",
      "项目记录无法确认这个托管工作文件，当前文件没有切换。",
      { nextSourcePath: requested.nextSourcePath },
    );
  }
  const project = await readHtmlProject(nextSourcePath);
  if (project.sha256 !== requested.expectedSha256) {
    throw new ProjectFileError(
      "MANAGED_WORKING_COPY_HASH_MISMATCH",
      "托管工作文件与已确认的项目内容不一致，当前文件没有切换。",
      {
        expectedSha256: requested.expectedSha256,
        actualSha256: project.sha256,
      },
    );
  }
  return commitActivatedProjectPath({
    state,
    previousSourcePath,
    nextSourcePath,
    project,
    managedActivation,
  });
}

async function activateGeneratedVersionOperation(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("新版本文件参数无效。");
  }
  const allowedKeys = new Set([
    "previousSourcePath",
    "nextSourcePath",
    "expectedSha256",
    "projectId",
    "versionId",
  ]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("新版本文件参数包含未支持的字段。");
  }
  const previousSourcePath = assertHtmlPath(
    payload.previousSourcePath,
    "previousSourcePath",
  );
  const nextSourcePath = assertHtmlPath(
    payload.nextSourcePath,
    "nextSourcePath",
  );
  if (
    typeof payload.projectId !== "string"
    || !/^project_[A-Za-z0-9_-]+$/.test(payload.projectId)
    || typeof payload.versionId !== "string"
    || !/^ver_\d{4,}$/.test(payload.versionId)
    || typeof payload.expectedSha256 !== "string"
    || !/^sha256:[a-f0-9]{64}$/.test(payload.expectedSha256)
  ) {
    throw new TypeError("新版本文件身份无效。");
  }
  if (
    process.env.PAGEROOT_E2E === "1"
    && process.env.PAGEROOT_E2E_GENERATED_VERSION_OPEN_FAILURE === "1"
  ) {
    throw new ProjectFileError(
      "E2E_GENERATED_VERSION_OPEN_FAILED",
      "测试注入：新版本文件暂时无法打开。",
    );
  }

  const state = await loadProjectState();
  const [resolvedPreviousPath, resolvedNextPath] = await Promise.all([
    realpath(previousSourcePath),
    realpath(nextSourcePath),
  ]);
  const knownPathIdentities = new Set(await Promise.all([
    state.activePath,
    ...state.recent.map((entry) => entry.path),
  ].filter(Boolean).map(existingPathIdentity)));
  if (
    !knownPathIdentities.has(resolvedPreviousPath)
    && !knownPathIdentities.has(resolvedNextPath)
  ) {
    throw new ProjectFileError(
      "UNKNOWN_SOURCE",
      "只能切换当前工作台已经打开的 HTML 项目。",
      { previousSourcePath, nextSourcePath },
    );
  }
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，当前文件没有切换。",
    );
  }

  const sourceEndpoint = new URL(`http://127.0.0.1:${bridgePort}/source`);
  sourceEndpoint.searchParams.set("sourcePath", resolvedPreviousPath);
  const sourceResponse = await net.fetch(sourceEndpoint, {
    cache: "no-store",
    headers: {
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
  });
  const authoritativeSource = await sourceResponse.json().catch(() => null);
  if (
    !sourceResponse.ok
    || !authoritativeSource
    || authoritativeSource.ok !== true
    || authoritativeSource.projectId !== payload.projectId
    || authoritativeSource.currentExactVersionId !== payload.versionId
    || authoritativeSource.sha256 !== payload.expectedSha256
    || typeof authoritativeSource.sourcePath !== "string"
  ) {
    throw new ProjectFileError(
      "GENERATED_VERSION_IDENTITY_MISMATCH",
      "项目记录无法确认这个 AI 新版本，当前文件没有切换。",
    );
  }
  const authoritativeSourcePath = await realpath(authoritativeSource.sourcePath);
  if (authoritativeSourcePath !== resolvedNextPath) {
    throw new ProjectFileError(
      "GENERATED_VERSION_PATH_MISMATCH",
      "新版本路径与项目记录不一致，当前文件没有切换。",
      {
        expectedPath: authoritativeSource.sourcePath,
        requestedPath: nextSourcePath,
      },
    );
  }

  const workspaceRoot = await workspacePath().then((value) => realpath(value));
  const relativeNextPath = path.relative(workspaceRoot, resolvedNextPath);
  const pathParts = relativeNextPath.split(path.sep);
  if (
    typeof authoritativeSource.storageDirectoryName !== "string"
    || !authoritativeSource.storageDirectoryName
    || pathParts.length !== 4
    || pathParts[0] !== "projects"
    || pathParts[1] !== authoritativeSource.storageDirectoryName
    || pathParts[2] !== "working"
    || !isGeneratedWorkingCopyFileName(pathParts[3])
  ) {
    throw new ProjectFileError(
      "UNSAFE_GENERATED_VERSION_PATH",
      "只能打开当前项目记录中新生成的版本 HTML。",
      { nextSourcePath: resolvedNextPath },
    );
  }
  const nextStats = await lstat(resolvedNextPath);
  if (!nextStats.isFile() || nextStats.isSymbolicLink()) {
    throw new ProjectFileError(
      "GENERATED_VERSION_NOT_REGULAR",
      "新版本不是可编辑的普通 HTML 文件。",
    );
  }
  const project = await readHtmlProject(resolvedNextPath);
  if (project.sha256 !== payload.expectedSha256) {
    throw new ProjectFileError(
      "GENERATED_VERSION_HASH_MISMATCH",
      "新版本文件与已确认的 AI 结果不一致，当前项目没有切换。",
      {
        expectedSha256: payload.expectedSha256,
        actualSha256: project.sha256,
      },
    );
  }

  const activated = await commitActivatedProjectPath({
    state,
    previousSourcePath: resolvedPreviousPath,
    nextSourcePath: resolvedNextPath,
    project,
  });
  return {
    ...activated,
    versionId: payload.versionId,
  };
}

async function revealVersionFile(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("历史版本参数无效。");
  }
  const allowedKeys = new Set(["sourcePath", "versionId"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("历史版本参数包含未支持的字段。");
  }
  const sourcePath = assertReadPayload(payload.sourcePath);
  await assertKnownProjectPath(sourcePath);
  await inspectHtmlFile(sourcePath);
  if (
    typeof payload.versionId !== "string"
    || !/^ver_\d{4,}$/.test(payload.versionId)
  ) {
    throw new TypeError("历史版本编号无效。");
  }
  if (!bridgePort) {
    throw new ProjectFileError(
      "BRIDGE_NOT_READY",
      "项目记录服务尚未就绪，请稍后重试。",
    );
  }

  const endpoint = new URL(`http://127.0.0.1:${bridgePort}/version-file`);
  endpoint.searchParams.set("sourcePath", sourcePath);
  endpoint.searchParams.set("versionId", payload.versionId);
  const response = await net.fetch(endpoint, {
    cache: "no-store",
    headers: {
      "X-HTML-AI-Bridge-Token": bridgeAuthToken,
    },
  });
  const versionRecord = await response.json().catch(() => null);
  if (
    !response.ok
    || !versionRecord
    || versionRecord.ok !== true
    || versionRecord.versionId !== payload.versionId
    || typeof versionRecord.projectId !== "string"
    || typeof versionRecord.storageDirectoryName !== "string"
    || typeof versionRecord.path !== "string"
  ) {
    throw new ProjectFileError(
      "VERSION_FILE_UNAVAILABLE",
      "这个历史版本文件暂时无法显示，请重新打开版本历史后再试。",
    );
  }

  const [workspaceRoot, resolvedVersionPath] = await Promise.all([
    workspacePath().then((value) => realpath(value)),
    realpath(path.resolve(versionRecord.path)),
  ]);
  const relativeVersionPath = path.relative(
    workspaceRoot,
    resolvedVersionPath,
  );
  if (
    !relativeVersionPath
    || relativeVersionPath.startsWith(`..${path.sep}`)
    || relativeVersionPath === ".."
    || path.isAbsolute(relativeVersionPath)
    || !isManagedVersionRelativePath(relativeVersionPath, {
      projectId: versionRecord.projectId,
      storageDirectoryName: versionRecord.storageDirectoryName,
      versionId: payload.versionId,
    })
  ) {
    throw new ProjectFileError(
      "UNSAFE_VERSION_PATH",
      "只能显示当前项目记录中的历史 HTML。",
      { versionPath: resolvedVersionPath },
    );
  }
  const versionStats = await lstat(resolvedVersionPath);
  if (!versionStats.isFile() || versionStats.isSymbolicLink()) {
    throw new ProjectFileError(
      "VERSION_FILE_NOT_REGULAR",
      "这个历史版本不是可显示的普通 HTML 文件。",
    );
  }
  shell.showItemInFolder(resolvedVersionPath);
  return {
    sourcePath,
    versionId: payload.versionId,
    versionPath: resolvedVersionPath,
  };
}

async function revealRequestFolder(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("本轮目录参数无效。");
  }
  const allowedKeys = new Set(["sourcePath", "requestPath"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("本轮目录参数包含未支持的字段。");
  }
  const sourcePath = assertReadPayload(payload.sourcePath);
  await assertKnownProjectPath(sourcePath);
  await inspectHtmlFile(sourcePath);
  if (
    typeof payload.requestPath !== "string"
    || !payload.requestPath
    || payload.requestPath.length > MAX_PATH_LENGTH
    || payload.requestPath.includes("\0")
  ) {
    throw new TypeError("本轮目录路径无效。");
  }

  const [workspaceRoot, resolvedRequestPath] = await Promise.all([
    workspacePath().then((value) => realpath(value)),
    realpath(path.resolve(payload.requestPath)),
  ]);
  const relativeRequestPath = path.relative(workspaceRoot, resolvedRequestPath);
  if (
    !relativeRequestPath
    || relativeRequestPath.startsWith(`..${path.sep}`)
    || relativeRequestPath === ".."
    || path.isAbsolute(relativeRequestPath)
    || !/^req_[a-z\d_-]+$/i.test(path.basename(resolvedRequestPath))
  ) {
    throw new ProjectFileError(
      "UNSAFE_REQUEST_PATH",
      "只能打开当前项目记录中的本轮目录。",
      { requestPath: resolvedRequestPath },
    );
  }
  const requestStats = await stat(resolvedRequestPath);
  if (!requestStats.isDirectory()) {
    throw new ProjectFileError(
      "REQUEST_PATH_NOT_DIRECTORY",
      "本轮目录不存在。",
      { requestPath: resolvedRequestPath },
    );
  }
  const openError = await shell.openPath(resolvedRequestPath);
  if (openError) throw new Error(openError);
  return { requestPath: resolvedRequestPath };
}

async function exportHtmlCopy(payload) {
  const { html, sourcePath, suggestedName } = assertExportPayload(payload);
  const activePath = await currentActivePath();
  const defaultDirectory = sourcePath
    ? path.dirname(sourcePath)
    : activePath
      ? path.dirname(activePath)
      : app.getPath("documents");
  const requestedName = suggestedName
    || (sourcePath ? path.basename(sourcePath) : null)
    || (activePath ? path.basename(activePath) : null)
    || "HTML.html";
  const protectedPaths = [sourcePath, activePath].filter(Boolean);
  const defaultPath = await createSafeExportDefaultPath({
    directoryPath: defaultDirectory,
    suggestedName: requestedName,
    sourcePath,
    activePath,
  });
  const destinationPath = await selectExportDestination({
    defaultPath,
    protectedPaths,
    normalizeDestination: (value) => assertHtmlPath(normalizeHtmlExportPath(value)),
    showSaveDialog: (safeDefaultPath) => dialog.showSaveDialog(mainWindow, {
      title: "导出 HTML 副本",
      buttonLabel: "导出副本",
      defaultPath: safeDefaultPath,
      properties: ["createDirectory", "showOverwriteConfirmation"],
      filters: [
        { name: "HTML 文件", extensions: ["html", "htm"] },
      ],
    }),
    showProtectedWarning: async () => {
      const warning = await dialog.showMessageBox(mainWindow, {
        type: "warning",
        title: "请选择其他导出位置",
        message: "HTML 副本不能覆盖当前源文件",
        detail: "源文件保持不变。请更换文件名或文件夹后再导出。",
        buttons: ["重新选择位置", "取消"],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
      });
      return warning.response === 0;
    },
  });
  if (!destinationPath) return null;

  // Recheck immediately before writing so a path alias or hard link created
  // while the save dialog was open still cannot target the source file.
  if (await isProtectedExportDestination(destinationPath, protectedPaths)) {
    throw new ProjectFileError(
      "EXPORT_OVER_SOURCE",
      "导出位置刚刚发生变化，源文件没有被改动。请重新选择位置。",
      { destinationPath },
    );
  }
  const exported = await writeHtmlCopy({
    destinationPath,
    html,
    maxHtmlBytes: MAX_HTML_BYTES,
  });
  // Export is deliberately not activated and does not mutate recent files.
  return {
    ...exported,
    exported: true,
  };
}

async function listRecentProjects() {
  const state = await loadProjectState();
  return Promise.all(state.recent.map(async (entry) => {
    const sourcePath = await existingPathIdentity(entry.path);
    return {
      path: sourcePath,
      sourcePath,
      name: entry.name,
      lastOpenedAt: entry.lastOpenedAt,
    };
  }));
}

async function openRecent(filePath) {
  return projectOpenQueue.run(async () => {
    const normalizedPath = assertHtmlPath(filePath);
    const state = await loadProjectState();
    const requestedIdentity = await existingPathIdentity(normalizedPath);
    const recentIdentities = await Promise.all(
      state.recent.map((entry) => existingPathIdentity(entry.path)),
    );
    if (!recentIdentities.includes(requestedIdentity)) {
      throw new ProjectFileError(
        "NOT_RECENT_PROJECT",
        "该文件已从最近项目中移除，请用“打开本地 HTML”重新选择。",
      );
    }

    try {
      const project = await readHtmlProject(normalizedPath);
      await activateProject(project.sourcePath);
      return project;
    } catch (error) {
      if (error?.code === "ENOENT") await forgetProject(normalizedPath);
      throw error;
    }
  });
}

async function forgetRecentProject(filePath) {
  return projectOpenQueue.run(async () => {
    const normalizedPath = assertHtmlPath(filePath);
    await forgetProject(normalizedPath);
    return { sourcePath: normalizedPath };
  });
}

function publishApplicationUpdateStatus(result) {
  latestUpdateResult = result;
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(UPDATE_CHANNELS.status, result);
  }
}

function ensureApplicationUpdateController() {
  if (applicationUpdate) return applicationUpdate;
  applicationUpdate = createApplicationUpdateController({
    updater: autoUpdater,
    currentVersion: app.getVersion(),
    architecture: process.arch,
    enabled: (
      app.isPackaged
      && process.platform === "darwin"
      && process.env.PAGEROOT_E2E !== "1"
    ),
    onStatus: publishApplicationUpdateStatus,
  });
  latestUpdateResult = applicationUpdate.getStatus();
  return applicationUpdate;
}

async function checkForApplicationUpdates() {
  return ensureApplicationUpdateController().checkForUpdates();
}

async function downloadApplicationUpdate() {
  return ensureApplicationUpdateController().downloadAvailableUpdate();
}

async function openLatestRelease() {
  await shell.openExternal(LATEST_RELEASE_PAGE_URL);
  return { opened: true };
}

async function openProjectRepository() {
  await shell.openExternal(PROJECT_REPOSITORY_URL);
  return { opened: true };
}

function userNoticePath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, USER_NOTICE_FILE_NAME)
    : path.join(directory, "..", USER_NOTICE_FILE_NAME);
}

async function openUserNotice() {
  const openError = await shell.openPath(userNoticePath());
  if (openError) {
    throw new ProjectFileError(
      "USER_NOTICE_OPEN_FAILED",
      "声明文件没有打开，请重新安装源页后重试。",
    );
  }
  return { opened: true };
}

function registerProjectIpc() {
  if (projectIpcRegistered) return;
  projectIpcRegistered = true;

  const assertTrustedEvent = (event) => assertTrustedRendererEvent(event, {
    mainWindow,
    isTrustedRendererUrl,
  });
  const trusted = (handler) => async (event, ...args) => {
    assertTrustedEvent(event);
    return handler(...args);
  };
  const trustedProject = (handler, operationOverride) => async (event, ...args) => {
    const startedAt = Date.now();
    const operation = operationOverride || String(handler.name || "desktop_operation")
      .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
      .toLowerCase();
    const result = await runProjectIpcOperation(
      async () => {
        assertTrustedEvent(event);
        return handler(...args);
      },
      {
        onError: (error, normalized) => {
          console.error(
            `[project-ipc:${normalized.code}]`,
            error instanceof Error ? error.stack || error.message : String(error),
          );
        },
      },
    );
    const projectId = args.find((argument) => (
      argument
      && typeof argument === "object"
      && !Array.isArray(argument)
      && typeof argument.projectId === "string"
    ))?.projectId;
    let operationResult = "failure";
    if (result.ok) {
      operationResult = result.value === null ? "cancelled" : "success";
    }
    captureUsage(
      "operation_finished",
      {
        operation,
        result: operationResult,
        ...(result.ok ? {} : { error_code: result.error.code }),
        duration_bucket: durationBucket(Date.now() - startedAt),
      },
      { projectId },
    );
    return result;
  };

  ipcMain.handle(PROJECT_CHANNELS.getActiveProject, trustedProject(getActiveProject));
  ipcMain.handle(PROJECT_CHANNELS.openHtml, trustedProject(openHtml));
  ipcMain.handle(PROJECT_CHANNELS.readHtml, trustedProject(readHtml));
  ipcMain.handle(PROJECT_CHANNELS.exportHtmlCopy, trustedProject(exportHtmlCopy));
  ipcMain.handle(PROJECT_CHANNELS.showInFolder, trustedProject(showInFolder));
  ipcMain.handle(
    PROJECT_CHANNELS.openInDefaultBrowser,
    trustedProject(openInDefaultBrowser),
  );
  ipcMain.handle(PROJECT_CHANNELS.renameHtml, trustedProject(renameHtml));
  ipcMain.handle(
    PROJECT_CHANNELS.activateGeneratedVersion,
    trustedProject(activateGeneratedVersion),
  );
  ipcMain.handle(
    PROJECT_CHANNELS.activateManagedWorkingCopy,
    trustedProject(activateManagedWorkingCopy),
  );
  ipcMain.handle(PROJECT_CHANNELS.revealVersionFile, trustedProject(revealVersionFile));
  ipcMain.handle(PROJECT_CHANNELS.revealRequestFolder, trustedProject(revealRequestFolder));
  ipcMain.handle(PROJECT_CHANNELS.listRecentProjects, trustedProject(listRecentProjects));
  ipcMain.handle(PROJECT_CHANNELS.openRecent, trustedProject(openRecent));
  ipcMain.handle(PROJECT_CHANNELS.forgetRecent, trustedProject(forgetRecentProject));
  ipcMain.handle(
    PROJECT_CHANNELS.acceptExternalOpen,
    trustedProject(acceptExternalFileOpen, "external_open"),
  );
  ipcMain.handle(
    INTEGRATION_CHANNELS.qoderHandoff,
    trustedProject((payload) => {
      if (
        process.env.PAGEROOT_E2E === "1"
        && process.env.PAGEROOT_E2E_QODER_HANDOFF_FAILURE === "1"
      ) {
        throw new ProjectFileError(
          "E2E_QODER_HANDOFF_FAILED",
          "测试注入：交接内容未能写入剪贴板。",
        );
      }
      return handoffToQoderWork(payload, {
        writeClipboard: (message) => clipboard.writeText(message),
        readClipboard: () => clipboard.readText(),
      });
    }, "qoder_handoff"),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.getStatus,
    trustedProject(() => latestUpdateResult, "update_get_status"),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.checkNow,
    trustedProject(checkForApplicationUpdates),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.downloadAvailable,
    trustedProject(downloadApplicationUpdate),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.installDownloaded,
    trustedProject(async () => {
      if (
        ensureApplicationUpdateController().getStatus().status
        !== "downloaded"
      ) {
        return { installing: false, reason: "not-ready" };
      }
      const installing = await coordinateApplicationUpdateInstall(
        "update-install",
      );
      return {
        installing,
        reason: installing ? null : "close-blocked",
      };
    }, "update_install"),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.openLatestRelease,
    trustedProject(openLatestRelease),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.openRepository,
    trustedProject(openProjectRepository),
  );
  ipcMain.handle(
    APP_CHANNELS.openUserNotice,
    trustedProject(openUserNotice),
  );
  ipcMain.handle(
    PREVIEW_CHANNELS.createSession,
    trustedProject(
      createPreviewSession,
      "preview_create_session",
    ),
  );
  ipcMain.handle(
    PREVIEW_CHANNELS.revokeSession,
    trustedProject(
      (sessionId) => ensurePreviewProtocolController().revokeSession(sessionId),
      "preview_revoke_session",
    ),
  );
  ipcMain.handle(
    REVIEW_RUNTIME_SNAPSHOT_CHANNELS.capture,
    trustedProject(
      captureReviewRuntimeSnapshot,
      "review_runtime_snapshot_capture",
    ),
  );
  ipcMain.handle(APP_CHANNELS.closeResult, trusted(reportCloseResult));
  ipcMain.handle(
    APP_CHANNELS.workspaceRecoveryReady,
    trusted(() => ({
      issue: workspaceRecoveryMailbox.acknowledgeRendererReady(),
    })),
  );
  ipcMain.handle(
    APP_CHANNELS.externalOpenReady,
    trusted(() => externalFileOpenMailbox.peek()),
  );
  ipcMain.handle(
    APP_CHANNELS.relaunch,
    trusted(async () => ({
      relaunched: await coordinateApplicationRelaunch("user-relaunch"),
    })),
  );
  ipcMain.handle(
    EDIT_CHANNELS.nativeHistory,
    trusted((direction) => {
      if (direction !== "undo" && direction !== "redo") {
        throw new TypeError("原生编辑历史方向无效。");
      }
      if (!mainWindow || mainWindow.isDestroyed()) {
        return { applied: false };
      }
      if (direction === "undo") mainWindow.webContents.undo();
      else mainWindow.webContents.redo();
      return { applied: true };
    }),
  );
  ipcMain.on(USAGE_CHANNELS.capture, (event, payload) => {
    try {
      assertTrustedEvent(event);
      usageTelemetry?.captureFromRenderer(payload);
    } catch {
      // Usage reporting is deliberately best-effort and never changes product flow.
    }
  });
}

function findAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close((error) => {
        if (error) reject(error);
        else if (port) resolve(port);
        else reject(new Error("无法分配本地服务端口。"));
      });
    });
  });
}

function bridgeScriptPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "bridge", "workspace-bridge.mjs")
    : path.join(directory, "..", "scripts", "workspace-bridge.mjs");
}

function rendererPath() {
  return app.isPackaged
    ? path.join(app.getAppPath(), "dist-desktop", "renderer", "index.html")
    : path.join(directory, "..", "dist-desktop", "renderer", "index.html");
}

function isTrustedRendererUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "file:"
      && path.resolve(fileURLToPath(url)) === path.resolve(rendererPath());
  } catch {
    return false;
  }
}

async function reportCloseResult(payload) {
  const result = normalizeCloseResult(payload);
  if (!closeRequest || closeRequest.requestId !== result.requestId) {
    return { accepted: false, reason: "request-expired" };
  }

  const pending = closeRequest;
  closeRequest = null;
  clearTimeout(pending.timeout);
  pending.resolve(result);
  return { accepted: true };
}

function requestRendererClose(reason) {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return Promise.resolve({
      requestId: null,
      ready: true,
      reason: null,
      presentation: null,
    });
  }
  // Before the first renderer load there is no editable document or queued
  // renderer write to drain, so startup failures can exit without a timeout.
  if (!rendererHasLoaded) {
    return Promise.resolve({
      requestId: null,
      ready: true,
      reason: null,
      presentation: null,
    });
  }
  if (closeRequest) return closeRequest.promise;

  const requestId = randomUUID();
  const deadlineAt = Date.now() + RENDERER_CLOSE_TIMEOUT_MS;
  let resolveRequest;
  const promise = new Promise((resolve) => {
    resolveRequest = resolve;
  });
  const timeout = setTimeout(() => {
    if (!closeRequest || closeRequest.requestId !== requestId) return;
    closeRequest = null;
    resolveRequest({
      requestId,
      ready: false,
      reason: "等待编辑器写入完成超时。请保持应用开启，确认自动保存状态后再关闭。",
      presentation: "native",
    });
  }, RENDERER_CLOSE_TIMEOUT_MS);
  closeRequest = {
    requestId,
    promise,
    resolve: resolveRequest,
    timeout,
  };
  mainWindow.webContents.send(APP_CHANNELS.prepareClose, {
    requestId,
    reason,
    deadlineAt,
  });
  return promise;
}

function notifyRendererCloseAborted(requestId, error) {
  const payload = closeAbortPayload(requestId, error);
  if (!payload || !mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.send(APP_CHANNELS.closeAborted, payload);
}

async function stopBridgeGracefully() {
  const child = bridgeProcess;
  if (!child) {
    bridgePort = null;
    return { code: null };
  }

  const result = await stopBridgeProcessGracefully(child, {
    timeoutMs: BRIDGE_SHUTDOWN_TIMEOUT_MS,
    // UtilityProcess.kill sends SIGTERM. The bridge handles SIGTERM by
    // closing its HTTP server before exiting, so in-flight writes can finish.
    // There is deliberately no SIGKILL fallback: an unconfirmed shutdown
    // keeps the application open instead of risking an interrupted fsync.
    requestStop: (target) => target.kill(),
  });

  if (bridgeProcess === child) bridgeProcess = null;
  bridgePort = null;
  return result;
}

function unregisterIpc() {
  for (const channel of [
    ...Object.values(PROJECT_CHANNELS),
    ...Object.values(INTEGRATION_CHANNELS),
    ...Object.values(UPDATE_CHANNELS),
    ...Object.values(REVIEW_RUNTIME_SNAPSHOT_CHANNELS),
    APP_CHANNELS.closeResult,
    APP_CHANNELS.workspaceRecoveryReady,
    APP_CHANNELS.externalOpenReady,
    APP_CHANNELS.relaunch,
    EDIT_CHANNELS.nativeHistory,
  ]) {
    ipcMain.removeHandler(channel);
  }
  ipcMain.removeAllListeners(USAGE_CHANNELS.capture);
  projectIpcRegistered = false;
}

const EXIT_INTENTS = Object.freeze({
  quit: Object.freeze({
    abortDetail: "源页已取消关闭并返回当前页面，请处理后再试。",
    abortButton: "继续编辑",
    blockedMessage: "关闭前的安全确认没有完成。",
    errorTitle: "无法安全关闭源页",
  }),
  relaunch: Object.freeze({
    abortDetail: "源页已取消重新打开并返回当前页面，请处理后再试。",
    abortButton: "返回源页",
    blockedMessage: "重新打开前的安全确认没有完成。",
    errorTitle: "暂时无法重新打开源页",
  }),
  update: Object.freeze({
    abortDetail: "源页已取消安装更新并返回当前页面，请处理后再试。",
    abortButton: "返回源页",
    blockedMessage: "安装更新前的安全确认没有完成。",
    errorTitle: "暂时无法安装更新",
  }),
});

async function coordinateApplicationExit(reason, intent = "quit") {
  if (coordinatedExit) return coordinatedExit;
  const exitIntent = EXIT_INTENTS[intent];
  if (!exitIntent) throw new TypeError(`Unsupported exit intent: ${intent}`);
  coordinatedExit = (async () => {
    const closeAttempt = closeAttemptGeneration;
    const result = await requestRendererClose(reason);
    if (closeAttempt !== closeAttemptGeneration) {
      notifyRendererCloseAborted(
        result.requestId,
        "收到新的外部 HTML 打开请求，已取消关闭。",
      );
      presentMainWindow();
      coordinatedExit = null;
      return false;
    }
    if (!result.ready) {
      const nativeBlock = (
        !e2eWindowRunsInBackground
        && shouldPresentNativeCloseBlock(result)
      );
      const interruptionSurface = nativeBlock ? "native" : "global";
      captureUsage("interruption_changed", {
        interruption_code: "close_safety",
        phase: "started",
        result: "unknown",
        surface: interruptionSurface,
      });
      notifyRendererCloseAborted(result.requestId, result.reason);
      if (!nativeBlock) {
        presentMainWindow();
        captureUsage("interruption_changed", {
          interruption_code: "close_safety",
          phase: "resolved",
          result: "continued",
          surface: interruptionSurface,
        });
        coordinatedExit = null;
        return false;
      }
      const messageBoxOptions = {
        type: "warning",
        title: exitIntent.errorTitle,
        message: result.reason || exitIntent.blockedMessage,
        detail: exitIntent.abortDetail,
        buttons: [exitIntent.abortButton],
        defaultId: 0,
        noLink: true,
      };
      if (mainWindow && !mainWindow.isDestroyed()) {
        await dialog.showMessageBox(mainWindow, messageBoxOptions);
      } else {
        await dialog.showMessageBox(messageBoxOptions);
      }
      captureUsage("interruption_changed", {
        interruption_code: "close_safety",
        phase: "resolved",
        result: "continued",
        surface: interruptionSurface,
      });
      coordinatedExit = null;
      return false;
    }

    isQuitting = true;
    await stateWriteQueue.catch(() => {});
    if (intent === "relaunch") {
      if (bridgeProcess) await stopBridgeGracefully().catch(() => {});
    } else {
      await stopBridgeOrNotifyCloseAborted({
        requestId: result.requestId,
        stopBridge: stopBridgeGracefully,
        notifyCloseAborted: (payload) => {
          notifyRendererCloseAborted(payload.requestId, payload.reason);
        },
      });
    }
    await usageTelemetry?.shutdown({
      reason: intent === "quit" ? "quit" : intent,
    }).catch(() => {});
    await runGuardedFinalExit({
      armFinalExit: () => {
        unregisterIpc();
        finalExitStarted = true;
      },
      executeFinalExit: () => {
        if (intent === "relaunch") {
          app.relaunch();
          setImmediate(() => app.exit(0));
        } else if (intent === "update") {
          const installing = ensureApplicationUpdateController()
            .installDownloadedUpdate();
          if (!installing) throw new Error("下载的更新已不再可安装。");
        } else {
          app.quit();
        }
        return true;
      },
      restoreFinalExit: async (error) => {
        finalExitStarted = false;
        isQuitting = false;
        let restartError = null;
        try {
          await startBridge();
          await initializeUsageTelemetry();
        } catch (caught) {
          restartError = caught;
        } finally {
          registerProjectIpc();
          notifyRendererCloseAborted(result.requestId, error);
          resumeDeferredExternalFileOpenAfterExitAbort();
        }
        if (restartError) throw restartError;
      },
    });
    return true;
  })().catch((error) => {
    coordinatedExit = null;
    isQuitting = false;
    resumeDeferredExternalFileOpenAfterExitAbort();
    dialog.showErrorBox(
      exitIntent.errorTitle,
      error instanceof Error ? error.message : String(error),
    );
    return false;
  });
  return coordinatedExit;
}

async function coordinateApplicationRelaunch(reason) {
  return coordinateApplicationExit(reason, "relaunch");
}

async function coordinateApplicationUpdateInstall(reason) {
  return coordinateApplicationExit(reason, "update");
}

async function showWorkspaceUnavailableRecovery() {
  captureUsage("runtime_fault", {
    process: "bridge",
    kind: "bridge_exit",
    reason_code: "BRIDGE_UNAVAILABLE",
  });
  const delivery = workspaceRecoveryMailbox.publish({
    title: "本地项目资料暂时不可用",
    message: "当前页面内容仍保留。可先导出当前编辑，再重新打开源页恢复本地服务。",
  });
  if (
    delivery.deliverToRenderer
    && mainWindow
    && !mainWindow.isDestroyed()
  ) {
    mainWindow.webContents.send(
      APP_CHANNELS.workspaceUnavailable,
      delivery.issue,
    );
    return;
  }
  if (workspaceFailurePrompt) return workspaceFailurePrompt;
  captureUsage("interruption_changed", {
    interruption_code: "workspace_unavailable",
    phase: "started",
    result: "unknown",
    surface: "native",
  });
  const options = {
    type: "warning",
    title: delivery.issue.title,
    message: "源页的本地项目服务已停止。",
    detail: "当前窗口中的内容仍保留。返回源页可先导出当前编辑；若没有待保存内容，也可以直接重新打开。",
    buttons: ["返回源页处理", "重新打开源页"],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
  };
  workspaceFailurePrompt = (
    mainWindow && !mainWindow.isDestroyed()
      ? dialog.showMessageBox(mainWindow, options)
      : dialog.showMessageBox(options)
  ).then(async (result) => {
    if (result.response === 1) {
      captureUsage("interruption_changed", {
        interruption_code: "workspace_unavailable",
        phase: "resolved",
        result: "recovered",
        surface: "native",
      });
      await coordinateApplicationRelaunch("workspace-unavailable");
    } else {
      captureUsage("interruption_changed", {
        interruption_code: "workspace_unavailable",
        phase: "resolved",
        result: "continued",
        surface: "native",
      });
    }
  }).finally(() => {
    workspaceFailurePrompt = null;
  });
  return workspaceFailurePrompt;
}

async function workspacePath() {
  const explicitWorkspace = process.env.HTML_AI_WORKSPACE?.trim();
  if (explicitWorkspace) {
    return path.resolve(explicitWorkspace);
  }

  const documents = app.getPath("documents");
  const legacyWorkspace = path.join(
    documents,
    "HTML AI 工作台",
    "项目记录",
  );
  const yuanyeWorkspace = path.join(documents, "YuanYe", "项目记录");
  const pageRootV2Workspace = path.join(
    documents,
    "PageRootV2",
    "项目记录",
  );
  const pageRootWorkspace = path.join(documents, "PageRoot", "项目记录");
  const existingWorkspace = await Promise.all(
    [
      pageRootWorkspace,
      pageRootV2Workspace,
      yuanyeWorkspace,
      legacyWorkspace,
    ].map(async (candidate) => (
      await stat(candidate)
        .then((entry) => entry.isDirectory())
        .catch(() => false)
        ? candidate
        : null
    )),
  ).then((candidates) => candidates.find(Boolean));
  return existingWorkspace ?? pageRootWorkspace;
}

async function launchBridge() {
  const [port, workspace] = await Promise.all([
    findAvailablePort(),
    workspacePath(),
  ]);

  const child = utilityProcess.fork(bridgeScriptPath(), [], {
    env: {
      ...process.env,
      HTML_AI_ALLOW_FILE_ORIGIN: "1",
      HTML_AI_BRIDGE_AUTH_TOKEN: bridgeAuthToken,
      HTML_AI_BRIDGE_PORT: String(port),
      HTML_AI_WORKSPACE: workspace,
    },
    serviceName: "HTML AI Workspace Bridge",
    stdio: "pipe",
  });

  bridgeProcess = child;
  let ready = false;

  child.once("exit", (code) => {
    const ownedProcess = bridgeProcess === child;
    if (ownedProcess) {
      bridgeProcess = null;
      bridgePort = null;
    }
    if (!ownedProcess || !ready) return;
    captureUsage("runtime_fault", {
      process: "bridge",
      kind: "bridge_exit",
      reason_code: "BRIDGE_EXITED_AFTER_READY",
      exit_code: Number.isInteger(code) ? code : -1,
    });
    if (!isQuitting) void showWorkspaceUnavailableRecovery();
  });
  child.once("error", (_type, _location, report) => {
    const ownedProcess = bridgeProcess === child;
    if (!ownedProcess || !ready) return;
    bridgeProcess = null;
    bridgePort = null;
    captureUsage("runtime_fault", {
      process: "bridge",
      kind: "bridge_exit",
      reason_code: "BRIDGE_PROCESS_ERROR",
      fingerprint: telemetryFingerprint(report || "bridge-process-error"),
    });
    if (!isQuitting) void showWorkspaceUnavailableRecovery();
  });

  try {
    await waitForBridgeReady(child, {
      expectedPort: port,
      slowAfterMs: BRIDGE_STARTUP_SLOW_MS,
      onStillStarting: () => {
        console.warn(
          "[bridge-startup] 本地工作区服务仍在启动；继续等待系统权限处理。",
        );
      },
    });
    if (bridgeProcess !== child) {
      throw new BridgeExitedBeforeReadyError(null);
    }
    bridgePort = port;
    ready = true;
    return port;
  } catch (error) {
    // If the child is still alive, keep its handle so the coordinated fatal
    // shutdown can request a graceful stop instead of orphaning the process.
    bridgePort = null;
    captureUsage("runtime_fault", {
      process: "bridge",
      kind: "bridge_start",
      reason_code: telemetryReasonCode(
        error?.code || error?.name,
        "BRIDGE_START_FAILED",
      ),
      fingerprint: telemetryFingerprint(error),
      ...(Number.isInteger(error?.exitCode)
        ? { exit_code: error.exitCode }
        : {}),
    });
    throw error;
  }
}

async function startBridge() {
  if (bridgeProcess && bridgePort) return bridgePort;
  if (bridgeStartupPromise) return bridgeStartupPromise;

  const startup = launchBridge();
  bridgeStartupPromise = startup;
  try {
    return await startup;
  } finally {
    if (bridgeStartupPromise === startup) bridgeStartupPromise = null;
  }
}

async function createWindow() {
  const port = await startBridge();
  ensurePreviewProtocolController();
  await adoptPendingExternalFileAtStartup();

  rendererHasLoaded = false;
  workspaceRecoveryMailbox.beginRendererLoad();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 720,
    backgroundColor: "#f7f8fa",
    title: "源页",
    show: e2eWindowForeground,
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset",
          trafficLightPosition: { x: 18, y: 15 },
        }
      : {}),
    ...(!app.isPackaged
      ? { icon: path.join(directory, "resources", "icon.png") }
      : {}),
    webPreferences: {
      preload: path.join(directory, "preload.mjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      ...(process.env.PAGEROOT_E2E === "1"
        ? { backgroundThrottling: false }
        : {}),
    },
  });

  registerProjectIpc();

  mainWindow.removeMenu();
  const loadedManagedPreviewFrameIds = new Set();
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on("will-frame-navigate", (details) => {
    if (details.isMainFrame) return;
    const parentFrame = details.frame?.parent;
    if (parentFrame !== mainWindow?.webContents.mainFrame) return;
    try {
      const previewProtocol = `${PREVIEW_PROTOCOL_SCHEME}:`;
      const protectedPreviewUrl = [details.frame?.url, details.initiator?.url]
        .find((url) => new URL(url || "about:blank").protocol === previewProtocol);
      if (!protectedPreviewUrl) return;
      details.preventDefault();
      const frame = details.frame;
      if (!frame || loadedManagedPreviewFrameIds.has(frame.frameTreeNodeId)) return;
      const activated = ensurePreviewProtocolController()
        .activateNavigationFallback(protectedPreviewUrl);
      if (!activated) return;
      const protectedSessionId = new URL(protectedPreviewUrl).hostname;
      setImmediate(() => {
        if (frame.isDestroyed()) return;
        try {
          const currentFrameUrl = new URL(frame.url);
          if (
            currentFrameUrl.protocol !== previewProtocol
            || currentFrameUrl.hostname !== protectedSessionId
            || !["/", "/index.html"].includes(currentFrameUrl.pathname)
          ) return;
          frame.reload();
        } catch {
          // A detached frame has already been replaced by its owning React tree.
        }
      });
    } catch {
      details.preventDefault();
    }
  });
  mainWindow.webContents.on(
    "did-frame-finish-load",
    (_event, isMainFrame, frameProcessId, frameRoutingId) => {
      if (isMainFrame) return;
      const frame = webFrameMain.fromId(frameProcessId, frameRoutingId);
      if (!frame || frame.parent !== mainWindow?.webContents.mainFrame) return;
      try {
        if (new URL(frame.url).protocol === `${PREVIEW_PROTOCOL_SCHEME}:`) {
          loadedManagedPreviewFrameIds.add(frame.frameTreeNodeId);
        }
      } catch {
        // A detached frame has no stable completion identity to retain.
      }
    },
  );
  mainWindow.webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (isInPlace || !isMainFrame) return;
      loadedManagedPreviewFrameIds.clear();
      rendererHasLoaded = false;
      workspaceRecoveryMailbox.beginRendererLoad();
    },
  );
  mainWindow.webContents.on("did-finish-load", () => {
    rendererHasLoaded = true;
    ensureApplicationUpdateController().startAutomaticChecks();
    const pendingExternalOpen = externalFileOpenMailbox.peek();
    if (pendingExternalOpen) {
      mainWindow?.webContents.send(
        APP_CHANNELS.externalOpenRequested,
        pendingExternalOpen,
      );
    }
  });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    captureUsage("runtime_fault", {
      process: "renderer",
      kind: "renderer_gone",
      reason_code: telemetryReasonCode(details?.reason, "RENDERER_GONE"),
      exit_code: Number.isInteger(details?.exitCode)
        ? Math.max(-1, Math.min(255, details.exitCode))
        : -1,
    });
  });
  mainWindow.webContents.on("unresponsive", () => {
    captureUsage("runtime_fault", {
      process: "renderer",
      kind: "renderer_unresponsive",
      reason_code: "UNRESPONSIVE",
    });
  });
  mainWindow.webContents.on("responsive", () => {
    captureUsage("runtime_fault", {
      process: "renderer",
      kind: "renderer_responsive",
      reason_code: "RESPONSIVE",
    });
  });
  mainWindow.once("ready-to-show", presentMainWindow);
  mainWindow.on("close", (event) => {
    if (finalExitStarted) return;
    event.preventDefault();
    void coordinateApplicationExit("window-close");
  });
  mainWindow.on("closed", () => {
    applicationUpdate?.stopAutomaticChecks();
    reviewRuntimeSnapshotCaptureController?.dispose();
    reviewRuntimeSnapshotCaptureController = null;
    previewProtocolController?.dispose();
    rendererHasLoaded = false;
    workspaceRecoveryMailbox.beginRendererLoad();
    mainWindow = null;
  });

  await mainWindow.loadFile(rendererPath(), {
    query: {
      bridgePort: String(port),
      bridgeAuthToken,
      appVersion: app.getVersion(),
    },
  });
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

app.on("open-file", (event, filePath) => {
  event.preventDefault();
  publishExternalFileOpen(filePath);
});

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // Only the process that owns Electron's single-instance lock may consume
  // the durable one-shot record. A losing secondary process forwards its
  // command line to the owner and must leave this record for the authoritative
  // next launch. Keep ordinary argv opens in the same sequence so a newer
  // launch argument still supersedes an older committed-exit handoff.
  for (const sourcePath of [
    externalFileOpenExitHandoff.take(),
    ...externalHtmlPathsFromArgv(process.argv.slice(1)),
  ].filter(Boolean)) {
    externalFileOpenMailbox.publish(sourcePath);
  }

  app.on("second-instance", (_event, commandLine) => {
    captureUsage("app_launched", { launch_reason: "second_instance" });
    for (const sourcePath of externalHtmlPathsFromArgv(commandLine)) {
      publishExternalFileOpen(sourcePath);
    }
    if (!isQuitting && !finalExitStarted) presentMainWindow();
  });

  app.whenReady().then(async () => {
    if (
      process.platform === "darwin"
      && app.dock
      && !app.isPackaged
      && !e2eWindowRunsInBackground
    ) {
      app.dock.setIcon(path.join(directory, "resources", "icon.png"));
    }
    installApplicationMenu();
    ensureApplicationUpdateController();
    await initializeUsageTelemetry();
    await createWindow();
  }).catch(async (error) => {
    captureUsage("runtime_fault", {
      process: "main",
      kind: "startup_failure",
      reason_code: telemetryReasonCode(error?.name, "STARTUP_FAILURE"),
      fingerprint: telemetryFingerprint(error),
    });
    await usageTelemetry?.shutdown({ reason: "quit" }).catch(() => {});
    dialog.showErrorBox(
      "源页启动失败",
      error instanceof Error ? error.message : String(error),
    );
    app.quit();
  });
}

app.on("window-all-closed", () => {
  if (finalExitStarted) app.quit();
  else void coordinateApplicationExit("window-all-closed");
});

app.on("before-quit", (event) => {
  if (finalExitStarted) return;
  event.preventDefault();
  void coordinateApplicationExit("app-quit");
});
