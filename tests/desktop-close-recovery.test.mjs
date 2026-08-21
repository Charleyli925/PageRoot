import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  canCloseDuringHydration,
  closeAbortPayload,
  normalizeCloseResult,
  runGuardedFinalExit,
  shouldPresentNativeCloseBlock,
  shouldRecoverEditorAfterCloseAbort,
  stopBridgeOrNotifyCloseAborted,
} from "../desktop/close-recovery.mjs";

const productRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const safeRendererState = Object.freeze({
  approvedRequestId: "close-request-0001",
  abortedRequestId: "close-request-0001",
  imposedEditorFreeze: true,
  projectLocked: false,
  projectHydrating: false,
  projectLoadError: false,
  viewTransitioning: false,
  submissionPending: false,
  persistState: "idle",
  pendingWrite: false,
  flushInProgress: false,
  draftPending: false,
  draftFlushInProgress: false,
  draftPersistError: false,
  editRevision: 7,
  lastPersistedRevision: 7,
});

test("an untouched hydrating project can close without waiting on a stuck read", () => {
  const hydrationState = {
    projectHydrating: true,
    viewTransitioning: false,
    submissionPending: false,
    persistState: "idle",
    pendingWrite: false,
    flushInProgress: false,
    draftPending: false,
    draftFlushInProgress: false,
    editRevision: 0,
    lastPersistedRevision: 0,
  };
  assert.equal(canCloseDuringHydration(hydrationState), true);

  for (const unsafeState of [
    { projectHydrating: false },
    { viewTransitioning: true },
    { submissionPending: true },
    { persistState: "queued" },
    { pendingWrite: true },
    { flushInProgress: true },
    { draftPending: true },
    { draftFlushInProgress: true },
    { editRevision: 1 },
  ]) {
    assert.equal(
      canCloseDuringHydration({
        ...hydrationState,
        ...unsafeState,
      }),
      false,
      `unsafe hydration close allowed: ${JSON.stringify(unsafeState)}`,
    );
  }
});

test("a failed Bridge shutdown notifies the exact renderer close request and stays rejected", async () => {
  const notifications = [];
  const shutdownError = Object.assign(new Error("Bridge 安全退出超时。"), {
    code: "BRIDGE_SHUTDOWN_TIMEOUT",
  });

  await assert.rejects(
    stopBridgeOrNotifyCloseAborted({
      requestId: safeRendererState.approvedRequestId,
      stopBridge: async () => {
        throw shutdownError;
      },
      notifyCloseAborted: async (payload) => notifications.push(payload),
    }),
    shutdownError,
  );

  assert.deepEqual(notifications, [{
    requestId: safeRendererState.approvedRequestId,
    reason: shutdownError.message,
  }]);
});

test("every final-exit intent fails closed before file watching is stopped", () => {
  const source = readFileSync(path.join(productRoot, "desktop", "main.mjs"), "utf8");
  const start = source.indexOf("    isQuitting = true;\n", source.indexOf("async function coordinateApplicationExit"));
  const end = source.indexOf("    await usageTelemetry?.shutdown", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const preparation = source.slice(start, end);
  const bridgeStop = preparation.indexOf("await stopBridgeOrNotifyCloseAborted({");
  const watcherStop = preparation.indexOf("sourceFileWatcher.close();");
  assert.notEqual(bridgeStop, -1);
  assert.notEqual(watcherStop, -1);
  assert.ok(bridgeStop < watcherStop);
  assert.doesNotMatch(preparation, /intent === "relaunch"/u);
  assert.doesNotMatch(preparation, /stopBridgeGracefully\(\)\.catch/u);
  assert.match(
    source,
    /if \(watchedSourcePath\) sourceFileWatcher\.watch\(watchedSourcePath\);/u,
  );
});

test("desktop shutdown outlives the Bridge Agent cleanup budget", () => {
  const mainSource = readFileSync(path.join(productRoot, "desktop", "main.mjs"), "utf8");
  const serviceSource = readFileSync(
    path.join(productRoot, "scripts", "agent-bridge-service.mjs"),
    "utf8",
  );
  const bridgeSource = readFileSync(
    path.join(productRoot, "scripts", "workspace-bridge.mjs"),
    "utf8",
  );
  const desktopTimeout = Number(mainSource.match(
    /const BRIDGE_SHUTDOWN_TIMEOUT_MS = ([\d_]+);/u,
  )?.[1].replaceAll("_", ""));
  const agentTimeout = Number(serviceSource.match(
    /const CANCEL_TIMEOUT_MS = ([\d_]+);/u,
  )?.[1].replaceAll("_", ""));
  assert.equal(Number.isSafeInteger(desktopTimeout), true);
  assert.equal(Number.isSafeInteger(agentTimeout), true);
  assert.ok(desktopTimeout >= agentTimeout + 2_000);
  assert.match(bridgeSource, /server\.closeAllConnections\?\.\(\);/u);
});

test("a failed final update install restores exit guards before returning control", async () => {
  const events = [];
  const installError = new Error("下载的更新已不再可安装。");
  let finalExitStarted = false;
  let ipcRegistered = true;
  let bridgeRunning = false;

  await assert.rejects(
    runGuardedFinalExit({
      armFinalExit: () => {
        events.push("arm");
        finalExitStarted = true;
        ipcRegistered = false;
      },
      executeFinalExit: () => {
        events.push("install");
        throw installError;
      },
      restoreFinalExit: async (error) => {
        events.push("restart-bridge");
        assert.equal(error, installError);
        bridgeRunning = true;
        finalExitStarted = false;
        events.push("register-ipc");
        ipcRegistered = true;
        events.push("notify-renderer");
      },
    }),
    installError,
  );

  assert.deepEqual(events, [
    "arm",
    "install",
    "restart-bridge",
    "register-ipc",
    "notify-renderer",
  ]);
  assert.equal(finalExitStarted, false);
  assert.equal(ipcRegistered, true);
  assert.equal(bridgeRunning, true);
});

test("the editor recovers only for its own safely persisted close freeze", () => {
  assert.equal(shouldRecoverEditorAfterCloseAbort(safeRendererState), true);

  for (const unsafeState of [
    { abortedRequestId: "close-request-9999" },
    { imposedEditorFreeze: false },
    { projectLocked: true },
    { projectHydrating: true },
    { projectLoadError: true },
    { viewTransitioning: true },
    { submissionPending: true },
    { persistState: "failed" },
    { persistState: "conflict" },
    { pendingWrite: true },
    { flushInProgress: true },
    { draftPending: true },
    { draftFlushInProgress: true },
    { draftPersistError: true },
    { editRevision: 8 },
  ]) {
    assert.equal(
      shouldRecoverEditorAfterCloseAbort({
        ...safeRendererState,
        ...unsafeState,
      }),
      false,
      `unsafe close state recovered: ${JSON.stringify(unsafeState)}`,
    );
  }
});

test("close-abort payloads reject missing or malformed request identities", () => {
  assert.equal(closeAbortPayload(null, new Error("failed")), null);
  assert.equal(closeAbortPayload("short", new Error("failed")), null);
  assert.deepEqual(closeAbortPayload("close-request-0002", "已取消关闭"), {
    requestId: "close-request-0002",
    reason: "已取消关闭",
  });
});

test("renderer-owned close blockers stay in the application instead of opening a native alert", () => {
  const inAppResult = normalizeCloseResult({
    requestId: "close-request-0003",
    ready: false,
    reason: "源文件正在自动复核。",
    presentation: "in-app",
  });
  assert.deepEqual(inAppResult, {
    requestId: "close-request-0003",
    ready: false,
    reason: "源文件正在自动复核。",
    presentation: "in-app",
  });
  assert.equal(shouldPresentNativeCloseBlock(inAppResult), false);

  const legacyOrTimeoutResult = normalizeCloseResult({
    requestId: "close-request-0004",
    ready: false,
    reason: "Renderer 没有完成关闭确认。",
  });
  assert.equal(legacyOrTimeoutResult.presentation, "native");
  assert.equal(shouldPresentNativeCloseBlock(legacyOrTimeoutResult), true);
});

test("close result normalization rejects unsupported presentation values", () => {
  assert.throws(
    () => normalizeCloseResult({
      requestId: "close-request-0005",
      ready: false,
      reason: "blocked",
      presentation: "toast",
    }),
    /关闭阻断出口无效/u,
  );
});
