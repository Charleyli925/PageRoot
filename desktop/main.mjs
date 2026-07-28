import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  net,
  shell,
  utilityProcess,
} from "electron";
import electronUpdater from "electron-updater";
import { randomBytes, randomUUID } from "node:crypto";
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
  closeAbortPayload,
  stopBridgeOrNotifyCloseAborted,
} from "./close-recovery.mjs";
import {
  PRODUCT_MAX_HTML_BYTES,
  isGeneratedWorkingCopyFileName,
} from "./product-contract.mjs";
import { handoffToQoderWork } from "./qoder-handoff.mjs";
import {
  LATEST_RELEASE_PAGE_URL,
  PROJECT_REPOSITORY_URL,
} from "./manual-update.mjs";
import { createApplicationUpdateController } from "./application-update.mjs";

// electron-updater is CommonJS; the default import is the supported ESM bridge.
const { autoUpdater } = electronUpdater;

const directory = path.dirname(fileURLToPath(import.meta.url));
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
const productUserDataPath = e2eUserDataPath || path.join(app.getPath("appData"), "PageRoot");
app.setPath("userData", productUserDataPath);
app.setName("源页");
if (e2eUserDataPath) {
  // Hosted macOS runners can report an Electron window as visible while the
  // WindowServer still classifies it as background or occluded. Keep the
  // renderer's startup timers and frame commits active for deterministic E2E
  // hydration; production launch behavior remains unchanged.
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  app.commandLine.appendSwitch("disable-backgrounding-occluded-windows");
}

const STARTUP_TIMEOUT_MS = 12_000;
const RENDERER_CLOSE_TIMEOUT_MS = 30_000;
const BRIDGE_SHUTDOWN_TIMEOUT_MS = 5_000;
const MAX_HTML_BYTES = PRODUCT_MAX_HTML_BYTES;
const MAX_STATE_BYTES = 1024 * 1024;
const MAX_PATH_LENGTH = 4096;
const MAX_RECENT_PROJECTS = 12;
const HTML_EXTENSIONS = new Set([".html", ".htm"]);
const PROJECT_STATE_VERSION = 1;
const PROJECT_CHANNELS = Object.freeze({
  getActiveProject: "html-projects:get-active",
  openHtml: "html-projects:open",
  readHtml: "html-projects:read",
  exportHtmlCopy: "html-projects:export-copy",
  showInFolder: "html-projects:show-in-folder",
  activateGeneratedVersion: "html-projects:activate-generated-version",
  revealVersionFile: "html-projects:reveal-version-file",
  revealRequestFolder: "html-projects:reveal-request-folder",
  listRecentProjects: "html-projects:list-recent",
  openRecent: "html-projects:open-recent",
  forgetRecent: "html-projects:forget-recent",
});
const APP_CHANNELS = Object.freeze({
  prepareClose: "html-app:prepare-close",
  closeResult: "html-app:close-result",
  closeAborted: "html-app:close-aborted",
  workspaceUnavailable: "html-app:workspace-unavailable",
  workspaceRecoveryReady: "html-app:workspace-recovery-ready",
  relaunch: "html-app:relaunch",
});
const INTEGRATION_CHANNELS = Object.freeze({
  qoderHandoff: "html-integrations:qoder-handoff",
});
const UPDATE_CHANNELS = Object.freeze({
  getStatus: "html-updates:get-status",
  status: "html-updates:status",
  checkNow: "html-updates:check-now",
  installDownloaded: "html-updates:install-downloaded",
  openLatestRelease: "html-updates:open-latest-release",
  openRepository: "html-updates:open-repository",
});

let bridgeProcess = null;
let bridgePort = null;
const bridgeAuthToken = randomBytes(32).toString("base64url");
let mainWindow = null;
let rendererHasLoaded = false;
let isQuitting = false;
let finalExitStarted = false;
let closeRequest = null;
let coordinatedExit = null;
let projectIpcRegistered = false;
let projectState = null;
let stateWriteQueue = Promise.resolve();
let latestUpdateResult = null;
let applicationUpdate = null;
let workspaceFailurePrompt = null;
let managedWelcomeRegistration = null;
const workspaceRecoveryMailbox = createWorkspaceRecoveryMailbox();

function emptyProjectState() {
  return {
    version: PROJECT_STATE_VERSION,
    activePath: null,
    recent: [],
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
    };
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
    throw new TypeError("只能打开普通 HTML 文件。");
  }
  if (fileStats.size > MAX_HTML_BYTES) {
    throw new RangeError("HTML 文件不能超过 25 MB。");
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

async function activateGeneratedVersion(payload) {
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
    pathParts.length !== 4
    || pathParts[0] !== "projects"
    || pathParts[1] !== payload.projectId
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

  const now = Date.now();
  const activePathIdentity = state.activePath
    ? await existingPathIdentity(state.activePath)
    : null;
  const recentPathIdentities = await Promise.all(
    state.recent.map((entry) => existingPathIdentity(entry.path)),
  );
  const activatesCurrentProject =
    activePathIdentity === resolvedPreviousPath
    || activePathIdentity === resolvedNextPath;
  const replacedIndex = recentPathIdentities.findIndex(
    (identity) =>
      identity === resolvedPreviousPath
      || identity === resolvedNextPath,
  );
  const replacedEntry = replacedIndex >= 0
    ? state.recent[replacedIndex]
    : null;
  const replacement = {
    path: resolvedNextPath,
    name:
      replacedEntry?.name
      || path.basename(previousSourcePath),
    lastOpenedAt: activatesCurrentProject
      ? now
      : replacedEntry?.lastOpenedAt ?? now,
  };
  const retained = state.recent.filter(
    (_entry, index) =>
      recentPathIdentities[index] !== resolvedPreviousPath
      && recentPathIdentities[index] !== resolvedNextPath,
  );
  if (activatesCurrentProject) {
    state.activePath = resolvedNextPath;
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
  await persistProjectState();
  return {
    ...project,
    previousSourcePath: resolvedPreviousPath,
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
    || !new RegExp(
      `^projects${path.sep}project_[A-Za-z0-9_-]+${path.sep}versions`
      + `${path.sep}${payload.versionId}${path.sep}files${path.sep}index\\.html$`,
    ).test(relativeVersionPath)
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
}

async function forgetRecentProject(filePath) {
  const normalizedPath = assertHtmlPath(filePath);
  await forgetProject(normalizedPath);
  return { sourcePath: normalizedPath };
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

async function openLatestRelease() {
  await shell.openExternal(LATEST_RELEASE_PAGE_URL);
  return { opened: true };
}

async function openProjectRepository() {
  await shell.openExternal(PROJECT_REPOSITORY_URL);
  return { opened: true };
}

function registerProjectIpc() {
  if (projectIpcRegistered) return;
  projectIpcRegistered = true;

  const assertTrustedEvent = (event) => {
    if (
      !mainWindow
      || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame
      || !isTrustedRendererUrl(event.senderFrame.url)
    ) {
      throw new ProjectFileError(
        "UNAUTHORIZED_FILE_REQUEST",
        "文件请求未获授权。",
      );
    }
  };
  const trusted = (handler) => async (event, ...args) => {
    assertTrustedEvent(event);
    return handler(...args);
  };
  const trustedProject = (handler) => async (event, ...args) => (
    runProjectIpcOperation(
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
    )
  );

  ipcMain.handle(PROJECT_CHANNELS.getActiveProject, trustedProject(getActiveProject));
  ipcMain.handle(PROJECT_CHANNELS.openHtml, trustedProject(openHtml));
  ipcMain.handle(PROJECT_CHANNELS.readHtml, trustedProject(readHtml));
  ipcMain.handle(PROJECT_CHANNELS.exportHtmlCopy, trustedProject(exportHtmlCopy));
  ipcMain.handle(PROJECT_CHANNELS.showInFolder, trustedProject(showInFolder));
  ipcMain.handle(
    PROJECT_CHANNELS.activateGeneratedVersion,
    trustedProject(activateGeneratedVersion),
  );
  ipcMain.handle(PROJECT_CHANNELS.revealVersionFile, trustedProject(revealVersionFile));
  ipcMain.handle(PROJECT_CHANNELS.revealRequestFolder, trustedProject(revealRequestFolder));
  ipcMain.handle(PROJECT_CHANNELS.listRecentProjects, trustedProject(listRecentProjects));
  ipcMain.handle(PROJECT_CHANNELS.openRecent, trustedProject(openRecent));
  ipcMain.handle(PROJECT_CHANNELS.forgetRecent, trustedProject(forgetRecentProject));
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
    }),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.getStatus,
    trustedProject(() => latestUpdateResult),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.checkNow,
    trustedProject(checkForApplicationUpdates),
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
    }),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.openLatestRelease,
    trustedProject(openLatestRelease),
  );
  ipcMain.handle(
    UPDATE_CHANNELS.openRepository,
    trustedProject(openProjectRepository),
  );
  ipcMain.handle(APP_CHANNELS.closeResult, trusted(reportCloseResult));
  ipcMain.handle(
    APP_CHANNELS.workspaceRecoveryReady,
    trusted(() => ({
      issue: workspaceRecoveryMailbox.acknowledgeRendererReady(),
    })),
  );
  ipcMain.handle(
    APP_CHANNELS.relaunch,
    trusted(async () => ({
      relaunched: await coordinateApplicationRelaunch("user-relaunch"),
    })),
  );
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

function normalizedCloseResult(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new TypeError("关闭确认结果无效。");
  }
  const allowedKeys = new Set(["requestId", "ready", "reason"]);
  if (Object.keys(payload).some((key) => !allowedKeys.has(key))) {
    throw new TypeError("关闭确认结果包含未支持的字段。");
  }
  if (
    typeof payload.requestId !== "string"
    || payload.requestId.length < 8
    || payload.requestId.length > 100
  ) {
    throw new TypeError("关闭确认 requestId 无效。");
  }
  if (typeof payload.ready !== "boolean") {
    throw new TypeError("关闭确认 ready 必须是布尔值。");
  }
  const reason = payload.ready
    ? null
    : typeof payload.reason === "string" && payload.reason.trim()
      ? payload.reason.trim().slice(0, 500)
      : "编辑器尚未确认所有本地更改都已安全写入。";
  return {
    requestId: payload.requestId,
    ready: payload.ready,
    reason,
  };
}

async function reportCloseResult(payload) {
  const result = normalizedCloseResult(payload);
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
    return Promise.resolve({ requestId: null, ready: true, reason: null });
  }
  // Before the first renderer load there is no editable document or queued
  // renderer write to drain, so startup failures can exit without a timeout.
  if (!rendererHasLoaded) {
    return Promise.resolve({ requestId: null, ready: true, reason: null });
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
    APP_CHANNELS.closeResult,
    APP_CHANNELS.workspaceRecoveryReady,
    APP_CHANNELS.relaunch,
  ]) {
    ipcMain.removeHandler(channel);
  }
  projectIpcRegistered = false;
}

const EXIT_INTENTS = Object.freeze({
  quit: Object.freeze({
    abortDetail: "源页已取消关闭并返回当前页面，请处理后再试。",
    abortButton: "继续编辑",
    errorTitle: "无法安全关闭源页",
  }),
  relaunch: Object.freeze({
    abortDetail: "源页已取消重新打开并返回当前页面，请处理后再试。",
    abortButton: "返回源页",
    errorTitle: "暂时无法重新打开源页",
  }),
  update: Object.freeze({
    abortDetail: "源页已取消安装更新并返回当前页面，请处理后再试。",
    abortButton: "返回源页",
    errorTitle: "暂时无法安装更新",
  }),
});

async function coordinateApplicationExit(reason, intent = "quit") {
  if (coordinatedExit) return coordinatedExit;
  const exitIntent = EXIT_INTENTS[intent];
  if (!exitIntent) throw new TypeError(`Unsupported exit intent: ${intent}`);
  coordinatedExit = (async () => {
    const result = await requestRendererClose(reason);
    if (!result.ready) {
      notifyRendererCloseAborted(result.requestId, result.reason);
      const messageBoxOptions = {
        type: "warning",
        title: "还有内容没有保存",
        message: result.reason || "当前页面还有内容没有保存完成。",
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
    unregisterIpc();
    finalExitStarted = true;
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
  })().catch((error) => {
    coordinatedExit = null;
    isQuitting = false;
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
      await coordinateApplicationRelaunch("workspace-unavailable");
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

async function startBridge() {
  if (bridgeProcess && bridgePort) return bridgePort;

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
  bridgePort = port;

  return await new Promise((resolve, reject) => {
    let output = "";
    let errorOutput = "";
    let settled = false;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (error) reject(error);
      else resolve(port);
    };

    const timeout = setTimeout(() => {
      finish(new Error(`本地工作区服务启动超时。${errorOutput ? `\n${errorOutput}` : ""}`));
    }, STARTUP_TIMEOUT_MS);

    child.stdout?.on("data", (chunk) => {
      output += chunk.toString();
      const lines = output.split("\n");
      output = lines.pop() || "";
      for (const line of lines) {
        try {
          const message = JSON.parse(line);
          if (message.type === "ready") finish();
        } catch {
          // Ignore non-JSON diagnostics from the service.
        }
      }
    });

    child.stderr?.on("data", (chunk) => {
      errorOutput += chunk.toString();
    });

    child.once("exit", (code) => {
      bridgeProcess = null;
      bridgePort = null;
      if (!settled) finish(new Error(`本地工作区服务意外退出（${code}）。${errorOutput ? `\n${errorOutput}` : ""}`));
      else if (!isQuitting) {
        void showWorkspaceUnavailableRecovery();
      }
    });

    child.once("error", (_type, _location, report) => {
      finish(new Error(report || "无法启动本地工作区服务。"));
    });
  });
}

async function createWindow() {
  const port = await startBridge();

  rendererHasLoaded = false;
  workspaceRecoveryMailbox.beginRendererLoad();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 960,
    minHeight: 720,
    backgroundColor: "#f7f8fa",
    title: "源页",
    show: process.env.PAGEROOT_E2E === "1",
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
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!isTrustedRendererUrl(url)) event.preventDefault();
  });
  mainWindow.webContents.on(
    "did-start-navigation",
    (_event, _url, isInPlace, isMainFrame) => {
      if (isInPlace || !isMainFrame) return;
      rendererHasLoaded = false;
      workspaceRecoveryMailbox.beginRendererLoad();
    },
  );
  mainWindow.webContents.on("did-finish-load", () => {
    rendererHasLoaded = true;
    ensureApplicationUpdateController().startAutomaticChecks();
  });
  mainWindow.once("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (event) => {
    if (finalExitStarted) return;
    event.preventDefault();
    void coordinateApplicationExit("window-close");
  });
  mainWindow.on("closed", () => {
    applicationUpdate?.stopAutomaticChecks();
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

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(async () => {
    if (process.platform === "darwin" && app.dock && !app.isPackaged) {
      app.dock.setIcon(path.join(directory, "resources", "icon.png"));
    }
    ensureApplicationUpdateController();
    await createWindow();
  }).catch((error) => {
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
