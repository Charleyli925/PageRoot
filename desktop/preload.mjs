// Sandboxed Electron preload scripts intentionally use Electron's limited
// CommonJS `require` polyfill, even when the file has a .mjs extension.
/* global require */
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { contextBridge, ipcRenderer } = require("electron");

const channels = Object.freeze({
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
const appChannels = Object.freeze({
  prepareClose: "html-app:prepare-close",
  closeResult: "html-app:close-result",
  closeAborted: "html-app:close-aborted",
  workspaceUnavailable: "html-app:workspace-unavailable",
  workspaceRecoveryReady: "html-app:workspace-recovery-ready",
  relaunch: "html-app:relaunch",
});
const integrationChannels = Object.freeze({
  qoderHandoff: "html-integrations:qoder-handoff",
});
const updateChannels = Object.freeze({
  getStatus: "html-updates:get-status",
  status: "html-updates:status",
  checkNow: "html-updates:check-now",
  installDownloaded: "html-updates:install-downloaded",
  openLatestRelease: "html-updates:open-latest-release",
  openRepository: "html-updates:open-repository",
});
const PROJECT_IPC_PROTOCOL = "html-ai-project-result";
const PROJECT_IPC_VERSION = 1;

function projectOperationError(payload) {
  const message = typeof payload?.message === "string" && payload.message.trim()
    ? payload.message.trim()
    : "本地文件操作没有完成，请重试。";
  const error = new Error(message);
  Object.defineProperty(error, "code", {
    value: typeof payload?.code === "string" ? payload.code : "PROJECT_SERVICE_ERROR",
    enumerable: true,
  });
  if (payload?.details && typeof payload.details === "object") {
    Object.defineProperty(error, "details", {
      value: Object.freeze({ ...payload.details }),
      enumerable: true,
    });
  }
  return error;
}

async function invokeProject(channel, ...args) {
  let result;
  try {
    result = await ipcRenderer.invoke(channel, ...args);
  } catch {
    throw projectOperationError({
      code: "PROJECT_SERVICE_UNAVAILABLE",
      message: "本地文件服务暂时不可用，请重试。",
    });
  }

  if (
    !result
    || typeof result !== "object"
    || result.protocol !== PROJECT_IPC_PROTOCOL
    || result.version !== PROJECT_IPC_VERSION
    || typeof result.ok !== "boolean"
  ) {
    throw projectOperationError({
      code: "INVALID_PROJECT_RESPONSE",
      message: "本地文件服务返回了无效结果，请重试。",
    });
  }
  if (!result.ok) throw projectOperationError(result.error);
  return result.value;
}

const projectsApi = Object.freeze({
  getActiveProject: () => invokeProject(channels.getActiveProject),
  openHtml: () => invokeProject(channels.openHtml),
  readHtml: (sourcePath) => invokeProject(channels.readHtml, sourcePath),
  exportHtmlCopy: (payload) => invokeProject(channels.exportHtmlCopy, payload),
  showInFolder: (sourcePath) => invokeProject(channels.showInFolder, sourcePath),
  activateGeneratedVersion: (payload) => invokeProject(
    channels.activateGeneratedVersion,
    payload,
  ),
  revealVersionFile: (payload) => invokeProject(channels.revealVersionFile, payload),
  revealRequestFolder: (payload) => invokeProject(channels.revealRequestFolder, payload),
  listRecentProjects: () => invokeProject(channels.listRecentProjects),
  openRecent: (sourcePath) => invokeProject(channels.openRecent, sourcePath),
  forgetRecent: (sourcePath) => invokeProject(channels.forgetRecent, sourcePath),
});
const integrationsApi = Object.freeze({
  handoffToQoderWork: (payload) => invokeProject(
    integrationChannels.qoderHandoff,
    payload,
  ),
});
const updateStatusListeners = new Map();
const updatesApi = Object.freeze({
  getStatus: () => invokeProject(updateChannels.getStatus),
  checkNow: () => invokeProject(updateChannels.checkNow),
  onStatus: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onStatus listener must be a function.");
    }
    const wrapped = (_event, payload) => listener(
      payload && typeof payload === "object"
        ? Object.freeze({ ...payload })
        : null,
    );
    updateStatusListeners.set(listener, wrapped);
    ipcRenderer.on(updateChannels.status, wrapped);
    return () => {
      const registered = updateStatusListeners.get(listener);
      if (!registered) return;
      updateStatusListeners.delete(listener);
      ipcRenderer.removeListener(updateChannels.status, registered);
    };
  },
  installDownloaded: () => invokeProject(updateChannels.installDownloaded),
  openLatestRelease: () => invokeProject(updateChannels.openLatestRelease),
  openRepository: () => invokeProject(updateChannels.openRepository),
});

const query = new URLSearchParams(globalThis.location.search);
const bridgePort = query.get("bridgePort") || "";
const bridgeAuthToken = query.get("bridgeAuthToken") || "";
const appVersion = query.get("appVersion") || "";
const runtimeCapabilities = Object.freeze({
  sourceEditing: "enabled",
  projectOpening: "desktop-dialog",
  attachmentPersistence: "bridge",
  closeCoordination: "electron-handshake",
});
const runtimeConfig = Object.freeze({
  bridgePort,
  bridgeAuthToken,
  appVersion,
  capabilities: runtimeCapabilities,
});

const closeListeners = new Map();
const closeAbortListeners = new Map();
const workspaceUnavailableListeners = new Map();
function normalizedWorkspaceIssue(payload) {
  return Object.freeze({
    title: typeof payload?.title === "string"
      ? payload.title
      : "本地项目资料暂时不可用",
    message: typeof payload?.message === "string"
      ? payload.message
      : "当前页面内容仍保留，可以导出后重新打开源页。",
  });
}
const appLifecycleApi = Object.freeze({
  onPrepareClose: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onPrepareClose listener must be a function.");
    }
    const wrapped = (_event, payload) => listener(Object.freeze({
      requestId: payload?.requestId,
      reason: payload?.reason,
      deadlineAt: payload?.deadlineAt,
    }));
    closeListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.prepareClose, wrapped);
    return () => {
      const registered = closeListeners.get(listener);
      if (!registered) return;
      closeListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.prepareClose, registered);
    };
  },
  onCloseAborted: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onCloseAborted listener must be a function.");
    }
    const wrapped = (_event, payload) => listener(Object.freeze({
      requestId: payload?.requestId,
      reason: payload?.reason,
    }));
    closeAbortListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.closeAborted, wrapped);
    return () => {
      const registered = closeAbortListeners.get(listener);
      if (!registered) return;
      closeAbortListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.closeAborted, registered);
    };
  },
  reportReady: (requestId) => ipcRenderer.invoke(appChannels.closeResult, {
    requestId,
    ready: true,
  }),
  reportBlocked: (requestId, reason) => ipcRenderer.invoke(appChannels.closeResult, {
    requestId,
    ready: false,
    reason,
  }),
  onWorkspaceUnavailable: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onWorkspaceUnavailable listener must be a function.");
    }
    const wrapped = (_event, payload) => listener(
      normalizedWorkspaceIssue(payload),
    );
    workspaceUnavailableListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.workspaceUnavailable, wrapped);
    void ipcRenderer.invoke(appChannels.workspaceRecoveryReady)
      .then((payload) => {
        if (
          workspaceUnavailableListeners.get(listener) === wrapped
          && payload?.issue
        ) {
          wrapped(null, payload.issue);
        }
      })
      .catch(() => {});
    return () => {
      const registered = workspaceUnavailableListeners.get(listener);
      if (!registered) return;
      workspaceUnavailableListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.workspaceUnavailable, registered);
    };
  },
  relaunch: () => ipcRenderer.invoke(appChannels.relaunch),
});

contextBridge.exposeInMainWorld("htmlAIProjects", projectsApi);
contextBridge.exposeInMainWorld("htmlAIIntegrations", integrationsApi);
contextBridge.exposeInMainWorld("htmlAIUpdates", updatesApi);
contextBridge.exposeInMainWorld("htmlAIRuntime", runtimeConfig);
contextBridge.exposeInMainWorld("htmlAIAppLifecycle", appLifecycleApi);
