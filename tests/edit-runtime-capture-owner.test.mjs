import assert from "node:assert/strict";
import test from "node:test";

import { EDIT_AUTHOR_RUNTIME_BUDGET } from "../app/domain/edit-runtime-contract.js";
import { createEditRuntimeCaptureController } from "../desktop/edit-runtime-capture-owner.mjs";

const SESSION_ID = "0123456789abcdef0123456789abcdef";
const EXECUTION_ID = "abcdefabcdefabcdefabcdef";
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

function pngWithDimensions(width, height, byteLength = 64) {
  const png = new Uint8Array(Math.max(24, byteLength));
  png.set(PNG_SIGNATURE);
  png.set([73, 72, 68, 82], 12);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return png;
}

function bindings(count) {
  return Array.from({ length: count }, (_, index) => ({
    key: `edit-runtime-${index + 1}`,
    path: [1, index],
    tagName: "main",
    identityAttributes: [["id", `chart-${index + 1}`]],
  }));
}

function fakeOwner({
  imageWidth = 1_600,
  imageHeight = 1_200,
  imageBytes = 64,
  canResize = true,
} = {}) {
  const state = {
    captures: [],
    partitions: [],
    resizes: [],
    windows: [],
  };
  class FakeNativeImage {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      if (!canResize) this.resize = undefined;
    }

    isEmpty() {
      return false;
    }

    toPNG() {
      return pngWithDimensions(this.width, this.height, imageBytes);
    }

    resize({ width, height, quality }) {
      state.resizes.push({ width, height, quality });
      return new FakeNativeImage(width, height);
    }
  }

  class FakeBrowserWindow {
    destroyed = false;

    constructor(options) {
      this.options = options;
      this.paintHandlers = [];
      this.webContents = {
        once: (event, handler) => {
          if (event === "paint") this.paintHandlers.push(handler);
        },
        on() {},
        setWindowOpenHandler() {},
        executeJavaScriptInIsolatedWorld: async (_worldId, scripts) => {
          const key = /"key":"([a-z0-9-]+)"/u.exec(scripts[0].code)?.[1];
          assert.ok(key, "probe must bind to one approved host key");
          return {
            state: "frozen",
            snapshot: {
              key,
              rect: { x: 0, y: 0, width: 800, height: 600 },
              styles: [],
            },
          };
        },
      };
      state.windows.push(this);
    }

    async loadURL() {
      for (const handler of this.paintHandlers.splice(0)) handler();
    }

    async capturePage(rect, options) {
      state.captures.push({ rect, options });
      return new FakeNativeImage(imageWidth, imageHeight);
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const controller = createEditRuntimeCaptureController({
    BrowserWindowClass: FakeBrowserWindow,
    createIsolatedSession: (partition) => {
      state.partitions.push(partition);
      return {
        protocol: { handle() {}, unhandle() {} },
        setPermissionRequestHandler() {},
        setPermissionCheckHandler() {},
        on() {},
        webRequest: { onBeforeRequest() {} },
      };
    },
    installProtocol() {},
    releaseIsolatedSession: async () => {},
    resolveRuntimeUrl: (sessionId) => (
      `pageroot-edit-runtime://${sessionId}/index.html`
    ),
    randomToken: () => "capture-test",
  });
  return { controller, state };
}

test("Edit capture downscales HiDPI snapshots to preserve all approved hosts within fixed aggregate caps", async () => {
  const requestedBindings = bindings(10);
  const { controller, state } = fakeOwner();
  const captured = await controller.capture({
    sessionId: SESSION_ID,
    executionId: EXECUTION_ID,
    bindings: requestedBindings,
  });

  assert.equal(captured.outcome, "captured");
  assert.equal(captured.bootstrapCount, 1);
  assert.equal(captured.snapshots.length, requestedBindings.length);
  assert.equal(state.captures.length, requestedBindings.length);
  assert.ok(state.resizes.length >= requestedBindings.length);
  assert.equal(state.windows[0].destroyed, true);
  const aggregatePixels = captured.snapshots.reduce(
    (total, snapshot) => total + snapshot.width * snapshot.height,
    0,
  );
  const aggregateBytes = captured.snapshots.reduce(
    (total, snapshot) => total + snapshot.byteLength,
    0,
  );
  assert.ok(aggregatePixels <= EDIT_AUTHOR_RUNTIME_BUDGET.snapshotAggregatePixels);
  assert.ok(aggregateBytes <= EDIT_AUTHOR_RUNTIME_BUDGET.snapshotAggregateBytes);
  for (const snapshot of captured.snapshots) {
    assert.deepEqual(
      { layoutWidth: snapshot.layoutWidth, layoutHeight: snapshot.layoutHeight },
      { layoutWidth: 800, layoutHeight: 600 },
    );
    assert.ok(snapshot.width <= snapshot.layoutWidth);
    assert.ok(snapshot.height <= snapshot.layoutHeight);
  }
});

test("Edit capture fails closed when an over-budget image cannot be resized", async () => {
  const { controller, state } = fakeOwner({ canResize: false });
  const captured = await controller.capture({
    sessionId: SESSION_ID,
    executionId: EXECUTION_ID,
    bindings: bindings(10),
  });

  assert.deepEqual(captured, { outcome: "failed", reason: "snapshot-budget" });
  assert.equal(state.windows[0].destroyed, true);
});
