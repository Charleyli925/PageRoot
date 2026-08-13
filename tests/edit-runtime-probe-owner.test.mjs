import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
} from "../app/domain/edit-runtime-contract.js";
import {
  createEditRuntimeProbeOwner,
  isolatedEditRuntimeResultScript,
  validateEditRuntimeProbeRequest,
} from "../desktop/edit-runtime-probe-owner.mjs";

const HTML = [
  "<!doctype html><html><body>",
  '<main id="chart-host" style="width:640px;height:360px"></main>',
  "<script>window.renderChart = true</script>",
  "</body></html>",
].join("");
const SOURCE_SHA256 = `sha256:${createHash("sha256").update(HTML, "utf8").digest("hex")}`;
const HOSTS = [{
  key: "edit-runtime-1",
  path: [1, 0],
  tagName: "main",
  identityAttributes: [["id", "chart-host"]],
}];

function request(overrides = {}) {
  return {
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    requestId: "edit-runtime-12345678",
    sourceSha256: SOURCE_SHA256,
    html: HTML,
    hosts: HOSTS,
    canvasGeneration: 9,
    ...overrides,
  };
}

function fakeOwner({ result, ownerDeadlineMs } = {}) {
  const state = {
    createRequests: [],
    revoked: [],
    partitions: [],
    windows: [],
    isolatedSources: [],
    permissions: [],
    checks: [],
    downloads: [],
    requests: [],
    released: [],
  };
  let sessionIndex = 0;
  class FakeBrowserWindow {
    destroyed = false;

    constructor(options) {
      this.options = options;
      this.paintHandlers = [];
      this.webContents = {
        setWindowOpenHandler: (handler) => {
          this.windowOpenHandler = handler;
        },
        once: (event, handler) => {
          if (event === "paint") this.paintHandlers.push(handler);
        },
        on: (event, handler) => {
          this.handlers ??= new Map();
          this.handlers.set(event, handler);
        },
        executeJavaScriptInIsolatedWorld: async (worldId, scripts, userGesture, awaitPromise) => {
          state.isolatedSources.push({ worldId, scripts, userGesture, awaitPromise });
          return typeof result === "function"
            ? result({ state, index: state.isolatedSources.length - 1 })
            : result;
        },
      };
      state.windows.push(this);
    }

    async loadURL(url) {
      this.url = url;
      this.paintHandlers.splice(0).forEach((handler) => handler());
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const owner = createEditRuntimeProbeOwner({
    BrowserWindowClass: FakeBrowserWindow,
    createSession: async (payload) => {
      state.createRequests.push(payload);
      sessionIndex += 1;
      const sessionId = sessionIndex.toString(16).padStart(32, "0");
      return {
        sessionId,
        probeExecutionId: "a".repeat(24),
        directExecutionId: "b".repeat(24),
        probeUrl: `pageroot-edit-runtime://${sessionId}/.pageroot/probe/index.html`,
        resourceSha256: "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        scriptCount: 1,
        byteLength: 128,
      };
    },
    revokeSession: async (sessionId) => {
      state.revoked.push(sessionId);
      return { revoked: true };
    },
    createIsolatedSession: async (partition) => {
      state.partitions.push(partition);
      return {
        setPermissionRequestHandler(handler) {
          state.permissions.push(handler);
        },
        setPermissionCheckHandler(handler) {
          state.checks.push(handler);
        },
        on(event, handler) {
          if (event === "will-download") state.downloads.push(handler);
        },
        webRequest: {
          onBeforeRequest(handler) {
            state.requests.push(handler);
          },
        },
      };
    },
    releaseIsolatedSession: async (isolatedSession) => state.released.push(isolatedSession),
    randomToken: () => "probe-test",
    ...(ownerDeadlineMs === undefined ? {} : { ownerDeadlineMs }),
  });
  return { owner, state };
}

function frozenResult(sessionId) {
  return {
    state: "frozen",
    reason: null,
    hostKeys: ["edit-runtime-1"],
    mutationRecords: 4,
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    executionId: "a".repeat(24),
    sessionId,
  };
}

test("Edit probe owner accepts only a complete source-bound request", () => {
  const accepted = validateEditRuntimeProbeRequest(request());
  assert.equal(accepted.sourceSha256, SOURCE_SHA256);
  assert.equal(accepted.hosts[0].key, "edit-runtime-1");
  assert.throws(
    () => validateEditRuntimeProbeRequest(request({ sourcePath: "/Users/demo/report.html" })),
    /invalid/u,
  );
  assert.throws(
    () => validateEditRuntimeProbeRequest(request({ sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" })),
    /identity/u,
  );
  assert.match(isolatedEditRuntimeResultScript(), /data-pageroot-edit-runtime-result/u);
});

test("Edit probe owner returns a grant without returning probe DOM, source HTML, or screenshots", async () => {
  const { owner, state } = fakeOwner({
    result: ({ state: fakeState }) => frozenResult(
      fakeState.createRequests.length.toString(16).padStart(32, "0"),
    ),
  });
  const result = await owner.probe(request());

  assert.equal(result.outcome, "compatible");
  assert.deepEqual(Object.keys(result).sort(), ["grant", "outcome"]);
  assert.equal(result.grant.executionId, "b".repeat(24));
  assert.equal(result.grant.hosts[0].key, "edit-runtime-1");
  assert.equal(Object.hasOwn(result, "html"), false);
  assert.equal(Object.hasOwn(result, "dom"), false);
  assert.equal(Object.hasOwn(result, "screenshot"), false);
  assert.equal(state.windows[0].destroyed, true);
  assert.equal(state.windows[0].options.webPreferences.contextIsolation, true);
  assert.equal(state.windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(state.windows[0].options.webPreferences.sandbox, true);
  assert.equal(state.windows[0].webContents.executeJavaScript, undefined);
  assert.equal(state.checks[0](), false);
  let networkDecision;
  state.requests[0]({ url: "https://attacker.invalid/steal.js" }, (decision) => {
    networkDecision = decision;
  });
  assert.deepEqual(networkDecision, { cancel: true });
  assert.equal(state.released.length, 1);
});

test("Edit probe owner caches compatibility but keeps each direct grant separately revocable", async () => {
  const { owner, state } = fakeOwner({
    result: ({ state: fakeState }) => frozenResult(
      fakeState.createRequests.length.toString(16).padStart(32, "0"),
    ),
  });
  const first = await owner.probe(request());
  const second = await owner.probe(request({ requestId: "edit-runtime-87654321" }));

  assert.equal(first.outcome, "compatible");
  assert.equal(second.outcome, "compatible");
  assert.notEqual(first.grant.sessionId, second.grant.sessionId);
  assert.equal(state.windows.length, 1, "cache hit skips hidden BrowserWindow probing");
  assert.equal(owner.cacheSize(), 1);
  await owner.revoke(second.grant.sessionId);
  assert.deepEqual(state.revoked, [second.grant.sessionId]);
  owner.dispose();
  assert.deepEqual(state.revoked.sort(), [first.grant.sessionId, second.grant.sessionId].sort());
});

test("Edit probe owner fails closed when the isolated result mutates source authority", async () => {
  const { owner, state } = fakeOwner({
    ownerDeadlineMs: 1,
    result: ({ state: fakeState }) => ({
      ...frozenResult(fakeState.createRequests.length.toString(16).padStart(32, "0")),
      hostKeys: ["unknown-host"],
    }),
  });
  const result = await owner.probe(request());

  assert.equal(result.outcome, "timed-out");
  assert.equal(result.reason, "owner-deadline");
  assert.equal(state.windows[0].destroyed, true);
  assert.equal(state.revoked.length, 1);
});
