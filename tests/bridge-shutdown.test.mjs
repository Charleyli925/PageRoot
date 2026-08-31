import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  BridgeShutdownTimeoutError,
  createWorkspaceRecoveryMailbox,
  stopBridgeProcessGracefully,
} from "../desktop/bridge-shutdown.mjs";

class FakeBridgeProcess extends EventEmitter {
  constructor({ exitOnStop = false, acceptStop = true } = {}) {
    super();
    this.exitOnStop = exitOnStop;
    this.acceptStop = acceptStop;
    this.stopRequests = 0;
  }

  kill() {
    this.stopRequests += 1;
    if (this.exitOnStop) {
      queueMicrotask(() => this.emit("exit", 0));
    }
    return this.acceptStop;
  }
}

test("workspace recovery is replayed only after the renderer listener acknowledges readiness", () => {
  const mailbox = createWorkspaceRecoveryMailbox();
  const firstIssue = {
    title: "本地项目资料暂时不可用",
    message: "请先导出 PageRoot 工作副本。",
  };

  const beforeReady = mailbox.publish(firstIssue);
  assert.equal(beforeReady.deliverToRenderer, false);
  assert.deepEqual(mailbox.acknowledgeRendererReady(), firstIssue);

  const afterReady = mailbox.publish({
    title: "本地项目资料仍不可用",
    message: "请重新打开源页。",
  });
  assert.equal(afterReady.deliverToRenderer, true);

  mailbox.beginRendererLoad();
  assert.equal(mailbox.inspect().rendererReady, false);
  assert.deepEqual(
    mailbox.acknowledgeRendererReady(),
    afterReady.issue,
    "a renderer reload must replay the latest undelivered recovery issue",
  );
});

test("graceful Bridge shutdown completes only after the process exit event", async () => {
  const child = new FakeBridgeProcess({ exitOnStop: true });
  let safeExitCommitted = false;

  const result = await stopBridgeProcessGracefully(child, {
    timeoutMs: 100,
    requestStop: (target) => target.kill(),
  });
  safeExitCommitted = true;

  assert.deepEqual(result, { code: 0 });
  assert.equal(child.stopRequests, 1);
  assert.equal(safeExitCommitted, true);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});

test("Bridge shutdown timeout is fail-closed and never becomes a successful exit", async () => {
  const child = new FakeBridgeProcess();
  let safeExitCommitted = false;

  await assert.rejects(
    stopBridgeProcessGracefully(child, {
      timeoutMs: 15,
      requestStop: (target) => target.kill(),
    }).then(() => {
      safeExitCommitted = true;
    }),
    (error) => {
      assert.ok(error instanceof BridgeShutdownTimeoutError);
      assert.equal(error.code, "BRIDGE_SHUTDOWN_TIMEOUT");
      assert.match(error.message, /应用已保持开启/);
      assert.match(error.message, /不会强制终止服务/);
      return true;
    },
  );

  assert.equal(child.stopRequests, 1);
  assert.equal(safeExitCommitted, false);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);

  // A late exit cannot retroactively turn the rejected shutdown into success.
  child.emit("exit", 0);
  assert.equal(safeExitCommitted, false);
});

test("a rejected graceful stop request fails without retrying or forcing the process", async () => {
  const child = new FakeBridgeProcess({ acceptStop: false });

  await assert.rejects(
    stopBridgeProcessGracefully(child, {
      timeoutMs: 100,
      requestStop: (target) => target.kill(),
    }),
    (error) => {
      assert.equal(error.code, "BRIDGE_SHUTDOWN_REJECTED");
      assert.match(error.message, /应用将保持开启/);
      return true;
    },
  );

  assert.equal(child.stopRequests, 1);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
});
