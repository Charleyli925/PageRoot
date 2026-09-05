import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspacePreferencesSession,
} from "../app/application/workspace-preferences-session.js";

const persisted = {
  schemaVersion: 2,
  workspace: {
    rememberPanelWidths: true,
    sidebarWidth: 300,
    inspectorWidth: 410,
    motion: "reduced",
    restoreTabsOnLaunch: false,
    defaultAgentProviderId: "codex",
  },
};

test("workspace preference session loads v2 values and writes narrow patches", async () => {
  const calls = [];
  const session = new WorkspacePreferencesSession({
    port: {
      async get() { return persisted; },
      async record(input) {
        calls.push(input);
        return {
          ...persisted,
          workspace: { ...persisted.workspace, ...input.workspace },
        };
      },
    },
  });
  await session.load();
  assert.equal(session.snapshot.workspace.sidebarWidth, 300);
  assert.equal(session.snapshot.workspace.restoreTabsOnLaunch, false);
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "codex");
  assert.equal(await session.update({ defaultAgentProviderId: "pageroot" }), true);
  assert.deepEqual(calls, [{ workspace: { defaultAgentProviderId: "pageroot" } }]);
  assert.equal(session.snapshot.workspace.defaultAgentProviderId, "pageroot");
  session.dispose();
});

test("the first preference change waits for hydration without losing the optimistic patch", async () => {
  const calls = [];
  let resolveGet;
  const session = new WorkspacePreferencesSession({
    port: {
      get() {
        return new Promise((resolve) => { resolveGet = resolve; });
      },
      async record(input) {
        calls.push(input);
        return {
          ...persisted,
          workspace: { ...persisted.workspace, ...input.workspace },
        };
      },
    },
  });
  const write = session.update({ sidebarWidth: 340 });
  assert.equal(session.snapshot.workspace.sidebarWidth, 340);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.length, 0);
  resolveGet(persisted);
  assert.equal(await write, true);
  assert.deepEqual(calls, [{ workspace: { sidebarWidth: 340 } }]);
  assert.equal(session.snapshot.workspace.sidebarWidth, 340);
  session.dispose();
});

test("a preference write failure stays visible and retry replays the pending patch", async () => {
  let fail = true;
  const session = new WorkspacePreferencesSession({
    port: {
      async get() { return persisted; },
      async record(input) {
        if (fail) throw new Error("disk unavailable");
        return {
          ...persisted,
          workspace: { ...persisted.workspace, ...input.workspace },
        };
      },
    },
  });
  await session.load();
  assert.equal(await session.update({ motion: "system" }), false);
  assert.equal(session.snapshot.saving, false);
  assert.match(session.snapshot.error, /disk unavailable/u);
  fail = false;
  assert.equal(session.retry(), true);
  assert.equal(await session.flush({ deadlineAt: Date.now() + 1_000 }), true);
  assert.equal(session.snapshot.error, null);
  assert.equal(session.snapshot.workspace.motion, "system");
  session.dispose();
});

test("invalid workspace patches are rejected before they reach the port", async () => {
  let writes = 0;
  const session = new WorkspacePreferencesSession({
    port: {
      async get() { return null; },
      async record() { writes += 1; return persisted; },
    },
  });
  assert.throws(() => session.update({ sidebarWidth: 999 }), /范围/u);
  assert.throws(() => session.update({ unknown: true }), /未知字段/u);
  assert.throws(() => session.update({ defaultAgentProviderId: "gemini" }), /默认 Agent/u);
  assert.equal(writes, 0);
  assert.equal(await session.update({ defaultAgentProviderId: "pageroot" }), true);
  assert.equal(writes, 1);
  session.dispose();
});
