import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  createRuntimeSnapshotCaptureController,
  validateRuntimeSnapshotCaptureRequest,
} from "../desktop/runtime-visual-capture-owner.mjs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==",
  "base64",
);
const HTML = "<!doctype html><html><body><main><canvas id=chart></canvas></main></body></html>";
const SOURCE_SHA256 = `sha256:${createHash("sha256").update(HTML, "utf8").digest("hex")}`;
const MULTI_HOST_HTML = "<!doctype html><html><body><main><canvas id=chart></canvas><canvas id=chart-two></canvas></main></body></html>";

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
      tagName: "canvas",
      kind: "canvas",
      identityAttributes: [["id", "chart"]],
    }],
    viewport: { width: 960, height: 640 },
    ...overrides,
  };
}

function ownerRects() {
  return {
    status: "captured",
    snapshots: [{
      key: "runtime-host-1",
      state: "captured",
      rect: { x: 0, y: 0, width: 1, height: 1 },
    }],
  };
}

function ownerRectsFor(key, rect) {
  return {
    status: "captured",
    snapshots: [{ key, state: "captured", rect }],
  };
}

function fakeOwner({
  rects = ownerRects(),
  loadURL = async () => {},
  ownerDeadlineMs,
  releaseIsolatedSession,
  png = PNG,
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
    captureEvents: [],
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
        executeJavaScriptInIsolatedWorld: async (worldId, scripts, userGesture) => {
          state.isolatedSources.push({ worldId, scripts, userGesture });
          state.captureEvents.push({ type: "measure", scripts });
          return typeof rects === "function"
            ? rects({ worldId, scripts, userGesture, index: state.isolatedSources.length - 1 })
            : rects;
        },
      };
      state.windows.push(this);
    }

    async loadURL(url) {
      this.url = url;
      await loadURL(url);
      const paintHandlers = this.paintHandlers.splice(0);
      if (paintHandlers.length) {
        state.captureEvents.push({ type: "paint" });
        paintHandlers.forEach((handler) => handler());
      }
    }

    async capturePage(rect, options) {
      state.capturePage ??= [];
      state.capturePage.push({ rect, options });
      state.captureEvents.push({ type: "capture", rect });
      return {
        isEmpty: () => false,
        toPNG: () => png,
      };
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const controller = createRuntimeSnapshotCaptureController({
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

test("runtime snapshot owner rejects non-authoritative or unsupported capture inputs", () => {
  const accepted = validateRuntimeSnapshotCaptureRequest(request());
  assert.equal(accepted.sourceSha256, SOURCE_SHA256);
  assert.equal(accepted.candidates[0].kind, "canvas");
  assert.equal(Object.isFrozen(accepted), true);
  assert.equal(
    validateRuntimeSnapshotCaptureRequest(request({
      captureSessionId: "runtime-edit-session-0001",
      side: "edit",
    })).side,
    "edit",
  );
  assert.throws(
    () => validateRuntimeSnapshotCaptureRequest(request({ sourcePath: "/private/report.html" })),
    /invalid/u,
  );
  assert.throws(
    () => validateRuntimeSnapshotCaptureRequest(request({
      candidates: [{ ...request().candidates[0], kind: "computed-selector" }],
    })),
    /identity/u,
  );
  assert.throws(
    () => validateRuntimeSnapshotCaptureRequest(request({
      candidates: [{ ...request().candidates[0], path: [-1] }],
    })),
    /identity/u,
  );
});

test("runtime snapshot owner captures once through an isolated one-use Electron session", async () => {
  const { controller, state } = fakeOwner();
  const captured = await controller.capture(request());

  assert.equal(captured.outcome, "captured");
  assert.equal(captured.envelope.sessionId, "review-owner-session-0001");
  const snapshot = captured.envelope.runtimeVisualSnapshots[0];
  assert.equal(snapshot.state, "captured");
  assert.equal(snapshot.pngSha256, `sha256:${createHash("sha256").update(PNG).digest("hex")}`);
  assert.equal(snapshot.width, 1);
  assert.equal(snapshot.height, 1);
  assert.equal(snapshot.layoutWidth, 1);
  assert.equal(snapshot.layoutHeight, 1);
  assert.equal(snapshot.byteLength, PNG.byteLength);
  assert.deepEqual([...snapshot.pngBytes], [...PNG]);
  assert.deepEqual(state.createRequests, [{ html: HTML, bootstrapJavaScript: "" }]);
  assert.deepEqual(state.revoked, ["review-preview-0001"]);
  assert.equal(state.windows[0].destroyed, true);
  assert.equal(state.capturePage.length, 1);
  assert.equal(state.isolatedSources.length, 1, "no second owner fact pass is allowed");
  assert.match(state.isolatedSources[0].scripts[0].code, /__pagerootRuntimeSnapshotRects/);
  assert.equal(state.windows[0].options.webPreferences.contextIsolation, true);
  assert.equal(state.windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(state.windows[0].options.webPreferences.sandbox, true);
  assert.equal(state.windows[0].options.webPreferences.webviewTag, false);
  assert.equal(state.windows[0].webContents.executeJavaScript, undefined);
  assert.equal(state.permissionChecks[0](), false);
  let downloadPrevented = false;
  state.downloadHandlers[0]({ preventDefault() { downloadPrevented = true; } });
  assert.equal(downloadPrevented, true);
  let requestDecision;
  state.beforeRequest[0]({ url: "https://attacker.invalid/script.js" }, (value) => {
    requestDecision = value;
  });
  assert.deepEqual(requestDecision, { cancel: true });
});

test("runtime snapshot owner omits a source binding mismatch before creating a preview session", async () => {
  const { controller, state } = fakeOwner();
  const captured = await controller.capture(request({
    candidates: [{ ...request().candidates[0], identityAttributes: [["id", "other"]] }],
  }));
  assert.equal(captured.outcome, "captured");
  assert.equal(captured.envelope.runtimeVisualSnapshots[0].state, "unavailable");
  assert.deepEqual(state.createRequests, []);
  assert.deepEqual(state.partitions, []);
});

test("runtime snapshot owner keeps valid hosts when another frozen binding is rejected", async () => {
  const { controller, state } = fakeOwner();
  const captured = await controller.capture(request({
    candidates: [
      request().candidates[0],
      {
        ...request().candidates[0],
        key: "runtime-host-2",
        identityAttributes: [["id", "other"]],
      },
    ],
  }));

  assert.equal(captured.outcome, "captured");
  assert.equal(captured.envelope.runtimeVisualSnapshots[0].state, "captured");
  assert.deepEqual(captured.envelope.runtimeVisualSnapshots[1], {
    key: "runtime-host-2",
    state: "unavailable",
    pngSha256: "",
    width: 0,
    height: 0,
    layoutWidth: 0,
    layoutHeight: 0,
    byteLength: 0,
    pngBytes: new Uint8Array(),
  });
  assert.equal(state.capturePage.length, 1);
});

test("runtime snapshot owner captures each host before measuring the next viewport", async () => {
  const candidates = [
    request().candidates[0],
    {
      ...request().candidates[0],
      key: "runtime-host-2",
      path: [1, 0, 1],
      identityAttributes: [["id", "chart-two"]],
    },
  ];
  const rects = [
    ownerRectsFor("runtime-host-1", { x: 11, y: 12, width: 41, height: 21 }),
    ownerRectsFor("runtime-host-2", { x: 21, y: 22, width: 51, height: 31 }),
  ];
  const { controller, state } = fakeOwner({
    rects: ({ index }) => rects[index],
  });
  const captured = await controller.capture(request({
    html: MULTI_HOST_HTML,
    sourceSha256: `sha256:${createHash("sha256").update(MULTI_HOST_HTML, "utf8").digest("hex")}`,
    candidates,
  }));

  assert.equal(captured.outcome, "captured");
  assert.deepEqual(state.captureEvents.map((event) => event.type), [
    "paint",
    "measure",
    "capture",
    "measure",
    "capture",
  ]);
  assert.deepEqual(state.capturePage.map(({ rect }) => rect), [
    { x: 11, y: 12, width: 41, height: 21 },
    { x: 21, y: 22, width: 51, height: 31 },
  ]);
  assert.deepEqual(captured.envelope.runtimeVisualSnapshots.map((snapshot) => ({
    layoutWidth: snapshot.layoutWidth,
    layoutHeight: snapshot.layoutHeight,
  })), [
    { layoutWidth: 41, layoutHeight: 21 },
    { layoutWidth: 51, layoutHeight: 31 },
  ]);
  assert.match(state.isolatedSources[0].scripts[0].code, /runtime-host-1/u);
  assert.match(state.isolatedSources[1].scripts[0].code, /runtime-host-2/u);
});

test("runtime snapshot owner keeps before and after captures isolated without cancelling either side", async () => {
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

test("runtime snapshot owner silently marks invalid PNG output unavailable", async () => {
  const { controller } = fakeOwner({ png: new Uint8Array([1, 2, 3]) });
  const captured = await controller.capture(request());
  assert.equal(captured.outcome, "captured");
  assert.deepEqual(captured.envelope.runtimeVisualSnapshots[0], {
    key: "runtime-host-1",
    state: "unavailable",
    pngSha256: "",
    width: 0,
    height: 0,
    layoutWidth: 0,
    layoutHeight: 0,
    byteLength: 0,
    pngBytes: new Uint8Array(),
  });
});

test("runtime snapshot owner reports its hard deadline and cleans up", async () => {
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
