import assert from "node:assert/strict";
import test from "node:test";
import {
  canCloseDuringHydration,
  closeAbortPayload,
  runGuardedFinalExit,
  shouldRecoverEditorAfterCloseAbort,
  stopBridgeOrNotifyCloseAborted,
} from "../desktop/close-recovery.mjs";

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
