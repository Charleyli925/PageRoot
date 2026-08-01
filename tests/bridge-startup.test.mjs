import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  BridgeExitedBeforeReadyError,
  BridgeProcessStartupError,
  BridgeReadyPortMismatchError,
  waitForBridgeReady,
} from "../desktop/bridge-startup.mjs";

class FakeBridgeProcess extends EventEmitter {
  constructor() {
    super();
    this.stdout = new EventEmitter();
    this.stderr = new EventEmitter();
  }
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function assertStartupListenersRemoved(child) {
  assert.equal(child.stdout.listenerCount("data"), 0);
  assert.equal(child.stderr.listenerCount("data"), 0);
  assert.equal(child.listenerCount("exit"), 0);
  assert.equal(child.listenerCount("error"), 0);
}

test("a live Bridge remains pending after the startup observation point and later becomes ready", async () => {
  const child = new FakeBridgeProcess();
  let slowNotifications = 0;
  let outcome = "pending";
  const startup = waitForBridgeReady(child, {
    expectedPort: 41_237,
    slowAfterMs: 10,
    onStillStarting: () => {
      slowNotifications += 1;
      throw new Error("diagnostic callbacks are best-effort");
    },
  }).then((result) => {
    outcome = "resolved";
    return result;
  });

  await delay(25);
  assert.equal(slowNotifications, 1);
  assert.equal(
    outcome,
    "pending",
    "crossing the old fatal timeout must not reject or resolve a live startup",
  );

  child.stdout.emit(
    "data",
    Buffer.from(`${JSON.stringify({ type: "ready", port: 41_237 })}\n`),
  );
  assert.deepEqual(await startup, { port: 41_237, wasDelayed: true });
  assertStartupListenersRemoved(child);
});

test("Bridge readiness accepts split JSON after ignoring unrelated diagnostics", async () => {
  const child = new FakeBridgeProcess();
  const startup = waitForBridgeReady(child, {
    expectedPort: 52_109,
    slowAfterMs: 100,
  });

  child.stdout.emit("data", Buffer.from("plain diagnostic\n{\"type\":\"rea"));
  child.stdout.emit("data", Buffer.from("dy\",\"port\":52109}\n"));

  assert.deepEqual(await startup, { port: 52_109, wasDelayed: false });
  assertStartupListenersRemoved(child);
});

test("Bridge exit before readiness is the terminal startup failure", async () => {
  const child = new FakeBridgeProcess();
  const startup = waitForBridgeReady(child, {
    expectedPort: 31_111,
    slowAfterMs: 100,
  });
  child.stderr.emit("data", Buffer.from("permission denied"));
  child.emit("exit", 13);

  await assert.rejects(startup, (error) => {
    assert.ok(error instanceof BridgeExitedBeforeReadyError);
    assert.equal(error.code, "BRIDGE_EXITED_BEFORE_READY");
    assert.equal(error.exitCode, 13);
    assert.match(error.message, /准备完成前意外退出/);
    assert.match(error.message, /permission denied/);
    return true;
  });
  assertStartupListenersRemoved(child);
});

test("Bridge process errors before readiness preserve a stable failure code", async () => {
  const child = new FakeBridgeProcess();
  const startup = waitForBridgeReady(child, {
    expectedPort: 31_112,
    slowAfterMs: 100,
  });
  child.emit("error", "launch", "utilityProcess.fork", "launch rejected");

  await assert.rejects(startup, (error) => {
    assert.ok(error instanceof BridgeProcessStartupError);
    assert.equal(error.code, "BRIDGE_PROCESS_ERROR");
    assert.match(error.message, /launch rejected/);
    return true;
  });
  assertStartupListenersRemoved(child);
});

test("Bridge readiness cannot publish a port other than the reserved port", async () => {
  const child = new FakeBridgeProcess();
  const startup = waitForBridgeReady(child, {
    expectedPort: 31_113,
    slowAfterMs: 100,
  });
  child.stdout.emit(
    "data",
    Buffer.from(`${JSON.stringify({ type: "ready", port: 31_114 })}\n`),
  );

  await assert.rejects(startup, (error) => {
    assert.ok(error instanceof BridgeReadyPortMismatchError);
    assert.equal(error.code, "BRIDGE_READY_PORT_MISMATCH");
    assert.equal(error.expectedPort, 31_113);
    assert.equal(error.actualPort, 31_114);
    return true;
  });
  assertStartupListenersRemoved(child);
});
