import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createReviewRuntimeCaptureController,
  validateReviewRuntimeCaptureRequest,
} from "../desktop/runtime-visual-capture-owner.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==",
  "base64",
);
const HTML = "<!doctype html><html><body><main><div class=chart>Revenue</div></main></body></html>";
const SOURCE_SHA256 = `sha256:${createHash("sha256").update(HTML, "utf8").digest("hex")}`;
const SOURCE_BOX_SIGNATURE = JSON.stringify([
  ["class", "chart"],
  ["height", null],
  ["hidden", null],
  ["style", null],
  ["width", null],
]);

function request(overrides = {}) {
  return {
    contractVersion: 1,
    captureSessionId: "review-owner-session-0001",
    sourceSha256: SOURCE_SHA256,
    side: "before",
    html: HTML,
    candidates: [{
      key: "runtime-host-1",
      path: [1, 0, 0],
      tagName: "DIV",
      sourceBoxSignature: SOURCE_BOX_SIGNATURE,
      identityAttributes: [["class", "chart"]],
      identityText: "Revenue",
    }],
    viewport: { width: 960, height: 640 },
    ...overrides,
  };
}

function facts(contentDigest = "a".repeat(32)) {
  return {
    status: "captured",
    facts: [{
      key: "runtime-host-1",
      state: "stable",
      contentDigest,
      paintDigest: "b".repeat(32),
      geometryDigest: "c".repeat(32),
      vectorDigest: "",
      contentAtoms: 1,
      paintAtoms: 1,
      geometryAtoms: 4,
      vectorAtoms: 0,
      rect: { x: 0, y: 0, width: 1, height: 1 },
    }],
  };
}

function fakeOwner({
  factsSequence = [facts(), facts()],
  loadURL = async () => {},
  ownerDeadlineMs,
  releaseIsolatedSession,
} = {}) {
  const state = {
    createRequests: [],
    revoked: [],
    partitions: [],
    windows: [],
    isolatedSources: [],
    permissionRequests: [],
    permissionChecks: [],
    downloadHandlers: [],
    beforeRequest: [],
  };
  let sessionIndex = 0;
  class FakeBrowserWindow {
    destroyed = false;

    constructor(options) {
      this.options = options;
      this.webContents = {
        setWindowOpenHandler: (handler) => {
          this.windowOpenHandler = handler;
        },
        on: (event, handler) => {
          this.handlers ??= new Map();
          this.handlers.set(event, handler);
        },
        executeJavaScriptInIsolatedWorld: async (worldId, scripts, userGesture) => {
          state.isolatedSources.push({ worldId, scripts, userGesture });
          return scripts[0].code.includes("__pagerootReviewRuntimeCaptureFacts")
            ? factsSequence.shift() || facts()
            : { x: 0, y: 0, width: 1, height: 1 };
        },
      };
      state.windows.push(this);
    }

    async loadURL(url) {
      this.url = url;
      await loadURL(url);
    }

    async capturePage(rect, options) {
      state.capturePage ??= [];
      state.capturePage.push({ rect, options });
      return {
        isEmpty: () => false,
        toPNG: () => PNG,
      };
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const controller = createReviewRuntimeCaptureController({
    BrowserWindowClass: FakeBrowserWindow,
    createSession: async (payload) => {
      state.createRequests.push(payload);
      sessionIndex += 1;
      const sessionId = `review-preview-${String(sessionIndex).padStart(4, "0")}`;
      return {
        sessionId,
        url: `pageroot-preview://${sessionId}/index.html`,
      };
    },
    revokeSession: async (sessionId) => {
      state.revoked.push(sessionId);
    },
    createIsolatedSession: async (partition) => {
      state.partitions.push(partition);
      return {
        setPermissionRequestHandler(handler) {
          state.permissionRequests.push(handler);
        },
        setPermissionCheckHandler(handler) {
          state.permissionChecks.push(handler);
        },
        on(event, handler) {
          if (event === "will-download") state.downloadHandlers.push(handler);
        },
        webRequest: {
          onBeforeRequest(handler) {
            state.beforeRequest.push(handler);
          },
        },
      };
    },
    releaseIsolatedSession: releaseIsolatedSession || (async (session) => {
      state.released ??= [];
      state.released.push(session);
    }),
    ...(ownerDeadlineMs === undefined ? {} : { ownerDeadlineMs }),
    randomToken: () => `capture-${state.partitions.length + 1}`,
  });
  return { controller, state };
}

test("review owner rejects non-authoritative or oversized capture inputs", () => {
  const accepted = validateReviewRuntimeCaptureRequest(request());
  assert.equal(accepted.sourceSha256, SOURCE_SHA256);
  assert.equal(accepted.candidates[0].key, "runtime-host-1");
  assert.equal(Object.isFrozen(accepted), true);
  const svgBinding = validateReviewRuntimeCaptureRequest(request({
    candidates: [{ ...request().candidates[0], tagName: "svg" }],
  }));
  assert.equal(svgBinding.candidates[0].tagName, "svg");
  assert.throws(
    () => validateReviewRuntimeCaptureRequest(request({ sourcePath: "/private/report.html" })),
    /invalid/u,
  );
  assert.throws(
    () => validateReviewRuntimeCaptureRequest(request({ bootstrapJavaScript: "bad()" })),
    /invalid/u,
  );
  assert.throws(
    () => validateReviewRuntimeCaptureRequest(request({ sourceSha256: "sha256:bad" })),
    /invalid/u,
  );
  assert.throws(
    () => validateReviewRuntimeCaptureRequest(request({
      candidates: [{ ...request().candidates[0], path: [-1] }],
    })),
    /identity/u,
  );
});

test("review owner captures only through an isolated, one-use Electron session", async () => {
  const { controller, state } = fakeOwner();
  const captured = await controller.capture(request());

  assert.equal(captured.outcome, "captured");
  assert.equal(captured.envelope.sessionId, "review-owner-session-0001");
  assert.equal(captured.envelope.sourceSha256, SOURCE_SHA256);
  assert.deepEqual(captured.envelope.runtimeVisualSnapshots, [{
    key: "runtime-host-1",
    state: "stable",
    contentSignature: `${"a".repeat(32)}:1`,
    paintSignature: `${"b".repeat(32)}:1`,
    geometrySignature: `${"c".repeat(32)}:4`,
    vectorSignature: "",
    canvasSignature: `${createHash("sha256").update(PNG).digest("hex")}:1`,
    contentAtoms: 1,
    paintAtoms: 1,
    geometryAtoms: 4,
    vectorAtoms: 0,
    canvasPixels: 1,
  }]);
  assert.deepEqual(state.createRequests, [{ html: HTML, bootstrapJavaScript: "" }]);
  assert.deepEqual(state.revoked, ["review-preview-0001"]);
  assert.equal(state.windows[0].destroyed, true);
  assert.equal(state.windows[0].options.show, false);
  assert.equal(state.windows[0].options.webPreferences.contextIsolation, true);
  assert.equal(state.windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(state.windows[0].options.webPreferences.sandbox, true);
  assert.equal(state.windows[0].options.webPreferences.webSecurity, true);
  assert.equal(state.windows[0].options.webPreferences.webviewTag, false);
  assert.equal(state.windows[0].options.webPreferences.session, state.released[0]);
  assert.equal(state.windows[0].options.webPreferences.offscreen, true);
  assert.equal(state.capturePage.length, 1);
  assert.equal(state.isolatedSources.length, 3);
  assert.equal(state.isolatedSources.every(({ worldId, scripts, userGesture }) => (
    worldId === 91_117
    && userGesture === true
    && scripts.length === 1
  )), true);
  assert.equal(state.isolatedSources.filter(({ scripts }) => (
    scripts[0].code.includes("__pagerootReviewRuntimeCaptureFacts")
  )).length, 2);
  assert.equal(state.windows[0].webContents.executeJavaScript, undefined);
  assert.equal(state.permissionRequests[0](null, "notifications", () => {}), undefined);
  assert.equal(state.permissionChecks[0](), false);
  let downloadPrevented = false;
  state.downloadHandlers[0]({
    preventDefault() {
      downloadPrevented = true;
    },
  });
  assert.equal(downloadPrevented, true);
  let requestDecision;
  state.beforeRequest[0]({ url: "https://attacker.invalid/script.js" }, (value) => {
    requestDecision = value;
  });
  assert.deepEqual(requestDecision, { cancel: true });
  state.beforeRequest[0]({
    url: "pageroot-preview://review-preview-0001/index.html",
  }, (value) => {
    requestDecision = value;
  });
  assert.deepEqual(requestDecision, { cancel: false });
});

test("review owner rejects a source binding mismatch before creating a preview session", async () => {
  const { controller, state } = fakeOwner();
  const captured = await controller.capture(request({
    candidates: [{
      ...request().candidates[0],
      sourceBoxSignature: "[]",
    }],
  }));

  assert.deepEqual(captured, {
    outcome: "unmapped",
    reason: "frozen-binding-mismatch",
  });
  assert.deepEqual(state.createRequests, []);
  assert.deepEqual(state.partitions, []);
});

test("review owner drops an unstable host and creates a fresh partition per capture", async () => {
  const { controller, state } = fakeOwner({
    factsSequence: [facts("a".repeat(32)), facts("d".repeat(32)), facts(), facts()],
  });
  const unstable = await controller.capture(request());
  assert.equal(unstable.outcome, "captured");
  assert.equal(unstable.envelope.runtimeVisualSnapshots[0].state, "unavailable");
  const stable = await controller.capture(request({ captureSessionId: "review-owner-session-0002" }));
  assert.equal(stable.outcome, "captured");
  assert.equal(state.partitions.length, 2);
  assert.notEqual(state.partitions[0], state.partitions[1]);
  assert.deepEqual(state.revoked, ["review-preview-0001", "review-preview-0002"]);
  assert.equal(state.windows.every((captureWindow) => captureWindow.destroyed), true);
});

test("review owner keeps before and after captures isolated without cancelling either side", async () => {
  const { controller, state } = fakeOwner();
  const [before, after] = await Promise.all([
    controller.capture(request({ side: "before" })),
    controller.capture(request({ side: "after" })),
  ]);

  assert.equal(before.outcome, "captured");
  assert.equal(after.outcome, "captured");
  assert.equal(state.partitions.length, 2);
  assert.notEqual(state.partitions[0], state.partitions[1]);
  assert.deepEqual(state.revoked, ["review-preview-0001", "review-preview-0002"]);
  assert.equal(state.windows.every((captureWindow) => captureWindow.destroyed), true);
});

test("review owner cancels and revokes a late page load at its hard deadline", async () => {
  const { controller, state } = fakeOwner({
    loadURL: () => new Promise(() => {}),
    ownerDeadlineMs: 10,
  });
  const timedOut = await controller.capture(request());
  assert.deepEqual(timedOut, { outcome: "timed-out", reason: "owner-deadline" });
  assert.deepEqual(state.revoked, ["review-preview-0001"]);
  assert.equal(state.windows[0].destroyed, true);
});

test("review owner reports its deadline without waiting for isolated-session storage cleanup", async () => {
  const { controller, state } = fakeOwner({
    loadURL: () => new Promise(() => {}),
    ownerDeadlineMs: 10,
    releaseIsolatedSession: () => new Promise(() => {}),
  });
  const startedAt = performance.now();
  const timedOut = await controller.capture(request());
  const elapsedMs = performance.now() - startedAt;

  assert.deepEqual(timedOut, { outcome: "timed-out", reason: "owner-deadline" });
  assert.ok(elapsedMs < 600, `owner response waited ${elapsedMs.toFixed(1)}ms`);
  assert.deepEqual(state.revoked, ["review-preview-0001"]);
  assert.equal(state.windows[0].destroyed, true);
});
