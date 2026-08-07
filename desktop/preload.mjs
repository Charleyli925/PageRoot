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
  openInDefaultBrowser: "html-projects:open-in-default-browser",
  renameHtml: "html-projects:rename",
  activateGeneratedVersion: "html-projects:activate-generated-version",
  revealVersionFile: "html-projects:reveal-version-file",
  revealRequestFolder: "html-projects:reveal-request-folder",
  listRecentProjects: "html-projects:list-recent",
  openRecent: "html-projects:open-recent",
  forgetRecent: "html-projects:forget-recent",
  acceptExternalOpen: "html-projects:accept-external-open",
});
const appChannels = Object.freeze({
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
const integrationChannels = Object.freeze({
  qoderHandoff: "html-integrations:qoder-handoff",
});
const updateChannels = Object.freeze({
  getStatus: "html-updates:get-status",
  status: "html-updates:status",
  checkNow: "html-updates:check-now",
  downloadAvailable: "html-updates:download-available",
  installDownloaded: "html-updates:install-downloaded",
  openLatestRelease: "html-updates:open-latest-release",
  openRepository: "html-updates:open-repository",
});
const usageChannels = Object.freeze({
  capture: "html-usage:capture",
});
const previewChannels = Object.freeze({
  createSession: "html-preview:create-session",
  revokeSession: "html-preview:revoke-session",
});
const editVisualChannels = Object.freeze({
  captureProjection: "html-edit-visuals:capture-projection",
});
const editChannels = Object.freeze({
  historyRequested: "html-edit:history-requested",
  nativeHistory: "html-edit:native-history",
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
  openInDefaultBrowser: (sourcePath) => invokeProject(
    channels.openInDefaultBrowser,
    sourcePath,
  ),
  renameHtml: (payload) => invokeProject(channels.renameHtml, payload),
  activateGeneratedVersion: (payload) => invokeProject(
    channels.activateGeneratedVersion,
    payload,
  ),
  revealVersionFile: (payload) => invokeProject(channels.revealVersionFile, payload),
  revealRequestFolder: (payload) => invokeProject(channels.revealRequestFolder, payload),
  listRecentProjects: () => invokeProject(channels.listRecentProjects),
  openRecent: (sourcePath) => invokeProject(channels.openRecent, sourcePath),
  forgetRecent: (sourcePath) => invokeProject(channels.forgetRecent, sourcePath),
  acceptExternalOpen: (requestId) => invokeProject(
    channels.acceptExternalOpen,
    { requestId },
  ),
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
  downloadAvailable: () => invokeProject(updateChannels.downloadAvailable),
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
  interactivePreview: "independent-url",
  editVisualProjection: "offscreen-capture",
});
const runtimeConfig = Object.freeze({
  bridgePort,
  bridgeAuthToken,
  appVersion,
  capabilities: runtimeCapabilities,
});

const previewApi = Object.freeze({
  createSession: (payload) => invokeProject(previewChannels.createSession, payload),
  revokeSession: (sessionId) => invokeProject(
    previewChannels.revokeSession,
    sessionId,
  ),
});

const editVisualApi = Object.freeze({
  captureProjection: (payload) => invokeProject(
    editVisualChannels.captureProjection,
    payload,
  ),
});

const closeListeners = new Map();
const closeAbortListeners = new Map();
const aboutRequestListeners = new Map();
const workspaceUnavailableListeners = new Map();
const externalOpenListeners = new Map();
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
function normalizedExternalOpenRequest(payload) {
  if (
    !payload
    || typeof payload.requestId !== "string"
    || !payload.requestId
    || typeof payload.sourcePath !== "string"
    || !payload.sourcePath
  ) return null;
  return Object.freeze({
    requestId: payload.requestId,
    sourcePath: payload.sourcePath,
  });
}
const appLifecycleApi = Object.freeze({
  onAboutRequested: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onAboutRequested listener must be a function.");
    }
    const wrapped = () => listener();
    aboutRequestListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.aboutRequested, wrapped);
    return () => {
      const registered = aboutRequestListeners.get(listener);
      if (!registered) return;
      aboutRequestListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.aboutRequested, registered);
    };
  },
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
  reportBlocked: (requestId, reason, presentation = "native") => ipcRenderer.invoke(appChannels.closeResult, {
    requestId,
    ready: false,
    reason,
    presentation,
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
  onExternalOpenRequested: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onExternalOpenRequested listener must be a function.");
    }
    let liveDeliveryGeneration = 0;
    const wrapped = (_event, payload) => {
      const request = normalizedExternalOpenRequest(payload);
      if (!request) return;
      liveDeliveryGeneration += 1;
      listener(request);
    };
    externalOpenListeners.set(listener, wrapped);
    ipcRenderer.on(appChannels.externalOpenRequested, wrapped);
    const catchUpGeneration = liveDeliveryGeneration;
    void ipcRenderer.invoke(appChannels.externalOpenReady)
      .then((payload) => {
        if (
          externalOpenListeners.get(listener) !== wrapped
          || !payload
          // A live IPC delivery is newer than the asynchronous readiness
          // snapshot. Never let that stale catch-up response replace the
          // currently pending mailbox request in the renderer session.
          || liveDeliveryGeneration !== catchUpGeneration
        ) return;
        const request = normalizedExternalOpenRequest(payload);
        if (request) listener(request);
      })
      .catch(() => {});
    return () => {
      const registered = externalOpenListeners.get(listener);
      if (!registered) return;
      externalOpenListeners.delete(listener);
      ipcRenderer.removeListener(appChannels.externalOpenRequested, registered);
    };
  },
  relaunch: () => ipcRenderer.invoke(appChannels.relaunch),
  openUserNotice: () => invokeProject(appChannels.openUserNotice),
});

const usageApi = Object.freeze({
  capture: (event, properties = {}, projectId) => {
    if (
      typeof event !== "string"
      || event.length > 80
      || !properties
      || typeof properties !== "object"
      || Array.isArray(properties)
      || Object.keys(properties).length > 12
      || Object.values(properties).some((value) => (
        value !== null
        && value !== undefined
        && typeof value !== "string"
        && typeof value !== "number"
        && typeof value !== "boolean"
      ))
      || (
        projectId !== undefined
        && (
          typeof projectId !== "string"
          || !/^project_[A-Za-z0-9_-]{1,180}$/.test(projectId)
        )
      )
    ) return;
    ipcRenderer.send(usageChannels.capture, {
      event,
      properties: { ...properties },
      ...(projectId ? { projectId } : {}),
    });
  },
});
const historyRequestListeners = new Map();
const editApi = Object.freeze({
  onHistoryRequested: (listener) => {
    if (typeof listener !== "function") {
      throw new TypeError("onHistoryRequested listener must be a function.");
    }
    const wrapped = (_event, payload) => {
      const direction = payload?.direction;
      if (direction === "undo" || direction === "redo") listener(direction);
    };
    historyRequestListeners.set(listener, wrapped);
    ipcRenderer.on(editChannels.historyRequested, wrapped);
    return () => {
      const registered = historyRequestListeners.get(listener);
      if (!registered) return;
      historyRequestListeners.delete(listener);
      ipcRenderer.removeListener(editChannels.historyRequested, registered);
    };
  },
  runNativeHistory: (direction) => {
    if (direction !== "undo" && direction !== "redo") {
      throw new TypeError("direction must be undo or redo.");
    }
    return ipcRenderer.invoke(editChannels.nativeHistory, direction);
  },
});

contextBridge.exposeInMainWorld("htmlAIProjects", projectsApi);
contextBridge.exposeInMainWorld("htmlAIIntegrations", integrationsApi);
contextBridge.exposeInMainWorld("htmlAIUpdates", updatesApi);
contextBridge.exposeInMainWorld("htmlAIPreview", previewApi);
contextBridge.exposeInMainWorld("htmlAIEditVisuals", editVisualApi);
contextBridge.exposeInMainWorld("htmlAIRuntime", runtimeConfig);
contextBridge.exposeInMainWorld("htmlAIAppLifecycle", appLifecycleApi);
contextBridge.exposeInMainWorld("htmlAIUsage", usageApi);
contextBridge.exposeInMainWorld("htmlAIEdit", editApi);
