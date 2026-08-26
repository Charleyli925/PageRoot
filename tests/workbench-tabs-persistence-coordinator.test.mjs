import assert from "node:assert/strict";
import test from "node:test";

import { WorkbenchTabsPersistenceCoordinator } from "../app/application/workbench-tabs-persistence-coordinator.js";

const A = Object.freeze({ version: 1, activeTabId: null, tabs: Object.freeze([]) });
const B = Object.freeze({
  version: 1,
  activeTabId: "document:project_b:doc_b",
  tabs: Object.freeze([Object.freeze({
    tabId: "document:project_b:doc_b",
    projectId: "project_b",
    documentId: "doc_b",
  })]),
});

test("tabs persistence is revisioned single-flight and drains the latest receipt", async () => {
  const writes = [];
  const releases = [];
  const coordinator = new WorkbenchTabsPersistenceCoordinator({
    port: {
      async get() { return null; },
      set(state) {
        writes.push(state);
        return new Promise((resolve) => releases.push(resolve));
      },
    },
  });
  coordinator.commit(A);
  coordinator.commit(B);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [A]);
  releases.shift()();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [A, B]);
  let drained = false;
  const drain = coordinator.drain({ deadlineAt: Date.now() + 1_000 })
    .then((result) => { drained = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(drained, false);
  releases.shift()();
  assert.deepEqual(await drain, { ok: true, revision: 2 });
  assert.equal(coordinator.snapshot.acknowledgedRevision, 2);
  assert.equal(coordinator.snapshot.restartSafe, true);
});

test("tabs persistence rejection is visible and failure-closes close until retry", async () => {
  let fail = true;
  const snapshots = [];
  const coordinator = new WorkbenchTabsPersistenceCoordinator({
    port: {
      async get() { return null; },
      async set() {
        if (fail) throw new Error("disk unavailable");
      },
    },
  });
  coordinator.subscribe((snapshot) => snapshots.push(snapshot));
  coordinator.commit(B);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(coordinator.snapshot.phase, "failed");
  assert.equal(coordinator.snapshot.restartSafe, false);
  assert.equal((await coordinator.drain({ deadlineAt: Date.now() + 1_000 })).ok, false);
  assert.match(coordinator.snapshot.error, /disk unavailable/u);
  fail = false;
  assert.equal(coordinator.retry(), true);
  assert.deepEqual(await coordinator.drain({ deadlineAt: Date.now() + 1_000 }), {
    ok: true,
    revision: 1,
  });
  assert.equal(snapshots.some((snapshot) => snapshot.phase === "failed"), true);
});

test("tabs persistence load failure closes restart safety until a terminal write", async () => {
  const coordinator = new WorkbenchTabsPersistenceCoordinator({
    port: {
      async get() { throw new Error("state unreadable"); },
      async set() {},
    },
  });
  await assert.rejects(coordinator.load(), /state unreadable/u);
  assert.equal(coordinator.snapshot.phase, "failed");
  assert.equal(coordinator.snapshot.restartSafe, false);
  assert.equal((await coordinator.drain({ deadlineAt: Date.now() + 1_000 })).ok, false);
  coordinator.commit(A);
  assert.deepEqual(await coordinator.drain({ deadlineAt: Date.now() + 1_000 }), {
    ok: true,
    revision: 1,
  });
  assert.equal(coordinator.snapshot.restartSafe, true);
});

test("close drain waits for an in-flight persisted-state load", async () => {
  let releaseLoad;
  const coordinator = new WorkbenchTabsPersistenceCoordinator({
    port: {
      get: () => new Promise((resolve) => { releaseLoad = resolve; }),
      async set() {},
    },
  });
  const loading = coordinator.load();
  let settled = false;
  const draining = coordinator.drain({ deadlineAt: Date.now() + 1_000 })
    .then((result) => { settled = true; return result; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(settled, false);
  releaseLoad(null);
  await loading;
  assert.deepEqual(await draining, { ok: true, revision: 0 });
});

test("tabs persistence payload remains identity-only", async () => {
  let written = null;
  const coordinator = new WorkbenchTabsPersistenceCoordinator({
    port: {
      async get() { return null; },
      async set(state) { written = state; },
    },
  });
  coordinator.commit(B);
  assert.equal((await coordinator.drain({ deadlineAt: Date.now() + 1_000 })).ok, true);
  const serialized = JSON.stringify(written);
  for (const forbidden of ["html", "sha256", "sourcePath", "title", "name"]) {
    assert.equal(serialized.includes(forbidden), false);
  }
});
