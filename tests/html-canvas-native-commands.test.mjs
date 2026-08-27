import assert from "node:assert/strict";
import test from "node:test";

import {
  NativeDeferredCommandQueue,
  nativeEditLeasesMatch,
} from "../app/components/html-canvas-native-commands.ts";

function lease(overrides = {}) {
  return {
    sessionId: "session-a",
    domGeneration: 1,
    sourceRevision: "rev-1",
    hostId: "host-a",
    ...overrides,
  };
}

function createSession() {
  let sequence = 0;
  let pending = null;
  return {
    queuePendingCommand(request) {
      sequence += 1;
      const replacedSequence = pending?.sequence ?? null;
      pending = {
        sequence,
        kind: request.kind,
        authority: request.authority ?? "user-explicit",
        payload: request.payload,
        compositionId: `island_${sequence}`,
      };
      return { queued: true, sequence, replacedSequence };
    },
    takePendingCommand() {
      const command = pending;
      pending = null;
      return command;
    },
  };
}

test("nativeEditLeasesMatch requires every stamp field", () => {
  const current = lease();
  assert.equal(nativeEditLeasesMatch(current, lease()), true);
  assert.equal(nativeEditLeasesMatch(current, lease({ hostId: "host-b" })), false);
  assert.equal(nativeEditLeasesMatch(null, current), false);
});

test("a pending user-explicit command blocks later system work", () => {
  const queue = new NativeDeferredCommandQueue();
  const session = createSession();
  const discarded = [];
  const active = { session, lease: lease() };
  assert.equal(queue.deferNativeCommand("user", () => {}, null, {
    authority: "user-explicit",
    onDiscard: (reason) => discarded.push(`user:${reason}`),
  }, active), true);
  assert.equal(queue.deferNativeCommand("system", () => {}, null, {
    authority: "system",
    onDiscard: (reason) => discarded.push(`system:${reason}`),
  }, active), true);
  assert.deepEqual(discarded, ["system:blocked-by-user-command"]);
});

test("a later user-explicit command supersedes the incumbent", () => {
  const queue = new NativeDeferredCommandQueue();
  const session = createSession();
  const discarded = [];
  const active = { session, lease: lease() };
  assert.equal(queue.deferNativeCommand("first", () => {}, null, {
    authority: "user-explicit",
    onDiscard: (reason) => discarded.push(`first:${reason}`),
  }, active), true);
  assert.equal(queue.deferNativeCommand("second", () => {}, null, {
    authority: "user-explicit",
    onDiscard: (reason) => discarded.push(`second:${reason}`),
  }, active), true);
  assert.deepEqual(discarded, ["first:superseded"]);
});

test("drain discards a command whose lease no longer matches", () => {
  const queue = new NativeDeferredCommandQueue();
  const session = createSession();
  const discarded = [];
  const active = { session, lease: lease() };
  assert.equal(queue.deferNativeCommand("user", () => {}, null, {
    authority: "user-explicit",
    onDiscard: (reason) => discarded.push(reason),
  }, active), true);
  queue.drainPendingNativeCommand(session, {
    getActive: () => active,
    getCurrentLease: () => lease({ sourceRevision: "rev-2" }),
    schedule: (run) => run(),
  });
  assert.deepEqual(discarded, ["stale-session"]);
});
