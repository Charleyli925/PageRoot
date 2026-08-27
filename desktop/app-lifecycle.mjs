import {
  app,
  BrowserWindow,
  webFrameMain,
} from "electron";
import path from "node:path";

import { PREVIEW_PROTOCOL_SCHEME } from "./preview-protocol.mjs";

export function createWindowLifecycle(ctx) {
  function presentMainWindow({ userInitiated = false } = {}) {
    if (
      (ctx.e2eWindowRunsInBackground && !userInitiated)
      || !ctx.mainWindow
      || ctx.mainWindow.isDestroyed()
    ) return false;
    if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore();
    ctx.mainWindow.show();
    ctx.mainWindow.focus();
    return true;
  }

  async function createWindow() {
    const {
      e2eWindowForeground,
      registerProjectIpc,
      startBridge,
      rendererPath,
    } = ctx;
    // Only the renderer URL needs the Bridge endpoint. Protocol installation,
    // external-file adoption, window construction and IPC registration do not,
    // so let the utility process boot alongside them instead of ahead of them.
    // startBridge is idempotent and deduplicates concurrent starts, so awaiting
    // it again below costs nothing once the boot has already settled. No IPC
    // handler can observe a missing port either: the renderer that would call
    // one is loaded after the await, and fetchBridgeJson still fails closed.
    const bridgeStartup = startBridge();
    // Claim the rejection now so a throw between here and the await below cannot
    // surface as an unhandled rejection; the awaited promise still rejects.
    bridgeStartup.catch(() => {});
    ctx.ensurePreviewProtocolController();
    await ctx.adoptPendingExternalFileAtStartup();

    ctx.rendererHasLoaded = false;
    ctx.externalFileOpenDelivery.beginRendererLoad();
    ctx.workspaceRecoveryMailbox.beginRendererLoad();
    const mainWindow = new BrowserWindow({
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
        ? { icon: path.join(ctx.directory, "resources", "icon.png") }
        : {}),
      webPreferences: {
        preload: path.join(ctx.directory, "preload.mjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        ...(process.env.PAGEROOT_E2E === "1"
          ? { backgroundThrottling: false }
          : {}),
      },
    });
    ctx.mainWindow = mainWindow;

    registerProjectIpc();
    mainWindow.removeMenu();
    const loadedManagedPreviewFrameIds = new Set();
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (!ctx.isTrustedRendererUrl(url)) event.preventDefault();
    });
    mainWindow.webContents.on("will-frame-navigate", (details) => {
      if (details.isMainFrame) return;
      const parentFrame = details.frame?.parent;
      if (parentFrame !== ctx.mainWindow?.webContents.mainFrame) return;
      try {
        const previewProtocol = `${PREVIEW_PROTOCOL_SCHEME}:`;
        const protectedPreviewUrl = [details.frame?.url, details.initiator?.url]
          .find((url) => new URL(url || "about:blank").protocol === previewProtocol);
        if (!protectedPreviewUrl) return;
        details.preventDefault();
        const frame = details.frame;
        if (!frame || loadedManagedPreviewFrameIds.has(frame.frameTreeNodeId)) return;
        const activated = ctx.ensurePreviewProtocolController()
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
        if (!frame || frame.parent !== ctx.mainWindow?.webContents.mainFrame) return;
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
        ctx.rendererHasLoaded = false;
        ctx.externalFileOpenDelivery.beginRendererLoad();
        ctx.workspaceRecoveryMailbox.beginRendererLoad();
      },
    );
    mainWindow.webContents.on("did-finish-load", () => {
      ctx.rendererHasLoaded = true;
      ctx.ensureApplicationUpdateController().startAutomaticChecks();
      ctx.deliverExternalMailboxHead();
    });
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      ctx.captureUsage("runtime_fault", {
        process: "renderer",
        kind: "renderer_gone",
        reason_code: ctx.telemetryReasonCode(details?.reason, "RENDERER_GONE"),
        exit_code: Number.isInteger(details?.exitCode)
          ? Math.max(-1, Math.min(255, details.exitCode))
          : -1,
      });
      /*
       * Reporting the fault is not the same as surviving it. With no reload the window
       * stays on screen as a blank white rectangle for as long as the user looks at it,
       * which reads as a dead application even though the Bridge, the project and the
       * Working Copy are all intact. A clean exit is not a fault to recover from.
       */
      if (details?.reason === "clean-exit" || ctx.isQuitting || ctx.finalExitStarted) return;
      if (!ctx.mainWindow || ctx.mainWindow.isDestroyed() || !ctx.rendererLoadQuery) return;
      ctx.rendererHasLoaded = false;
      ctx.externalFileOpenDelivery.beginRendererLoad();
      // A cold boot with the original handshake, not reload(): the renderer needs those
      // query values to reach the Bridge, and this path also runs its normal restore of
      // the last active project instead of leaving an empty shell.
      void mainWindow.loadFile(ctx.rendererPath(), { query: ctx.rendererLoadQuery });
    });
    mainWindow.webContents.on("unresponsive", () => {
      ctx.captureUsage("runtime_fault", {
        process: "renderer",
        kind: "renderer_unresponsive",
        reason_code: "UNRESPONSIVE",
      });
    });
    mainWindow.webContents.on("responsive", () => {
      ctx.captureUsage("runtime_fault", {
        process: "renderer",
        kind: "renderer_responsive",
        reason_code: "RESPONSIVE",
      });
    });
    mainWindow.once("ready-to-show", presentMainWindow);
    mainWindow.on("close", (event) => {
      if (ctx.finalExitStarted) return;
      event.preventDefault();
      void ctx.coordinateApplicationExit("window-close");
    });
    mainWindow.on("closed", () => {
      ctx.applicationUpdate?.stopAutomaticChecks();
      ctx.reviewRuntimeSnapshotCaptureController?.dispose();
      ctx.reviewRuntimeSnapshotCaptureController = null;
      ctx.editRuntimeProtocolController?.dispose();
      ctx.editRuntimeProtocolController = null;
      ctx.previewProtocolController?.dispose();
      ctx.rendererHasLoaded = false;
      ctx.externalFileOpenDelivery.beginRendererLoad();
      ctx.workspaceRecoveryMailbox.beginRendererLoad();
      ctx.mainWindow = null;
    });

    const port = await bridgeStartup;
    /*
     * Remembered so a renderer that died can be booted again with the same handshake.
     * reload() was not enough: the renderer only reaches the Bridge through these
     * query values, and a window that comes back without them renders nothing at all —
     * which is the blank white window users were left staring at.
     */
    ctx.rendererLoadQuery = {
      bridgePort: String(port),
      bridgeAuthToken: ctx.bridgeAuthToken,
      appVersion: app.getVersion(),
    };
    await mainWindow.loadFile(rendererPath(), { query: ctx.rendererLoadQuery });
  }

  return { presentMainWindow, createWindow };
}
