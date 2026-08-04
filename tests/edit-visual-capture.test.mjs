import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditVisualCaptureController,
  createEditVisualCaptureOperation,
  validateEditVisualCapturePayload,
} from "../desktop/edit-visual-capture.mjs";
import { prepareRuntimeVisualCapture } from "../app/domain/runtime-visual-projection.js";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==";
const SOURCE = "<!doctype html><main><div id=chart></div></main>";

function payload() {
  return prepareRuntimeVisualCapture({
    html: SOURCE,
    sourcePath: "/tmp/report.html",
    viewportWidth: 900,
  }).payload;
}

test("main-process capture validation accepts only the bounded renderer contract", () => {
  const valid = validateEditVisualCapturePayload(payload());
  assert.equal(valid.sourcePath, "/tmp/report.html");
  assert.equal(valid.candidates.length, 1);
  assert.equal(Object.isFrozen(valid), true);
  assert.equal(validateEditVisualCapturePayload({
    ...payload(),
    presentationEntries: [{
      sourceNodeId: payload().candidates[0].sourceNodeId,
      classAdd: ["active"],
      classRemove: [],
    }],
  }).presentationEntries.length, 1);

  assert.throws(() => validateEditVisualCapturePayload({
    ...payload(),
    sourceNodeAttribute: "data-attacker-node",
  }), /source-node attribute/u);
  assert.throws(() => validateEditVisualCapturePayload({
    ...payload(),
    sourceSha256: "sha256:bad",
  }), /source hash/u);
  assert.throws(() => validateEditVisualCapturePayload({
    ...payload(),
    candidates: [payload().candidates[0], payload().candidates[0]],
  }), /candidate identity/u);
  assert.throws(() => validateEditVisualCapturePayload({
    ...payload(),
    runtimeDom: "<script>bad()</script>",
  }), /unsupported fields/u);
});

test("capture operation authorizes and replaces the renderer source path", async () => {
  const captured = [];
  const operation = createEditVisualCaptureOperation({
    authorizeSourcePath: async (sourcePath) => {
      assert.equal(sourcePath, "/tmp/alias/report.html");
      return "/private/tmp/report.html";
    },
    capture: async (request) => {
      captured.push(request);
      return { visuals: [] };
    },
  });
  const request = {
    ...payload(),
    sourcePath: "/tmp/alias/report.html",
  };
  await operation(request);
  assert.equal(captured[0].sourcePath, "/private/tmp/report.html");
  assert.equal(captured[0].html, request.html);

  let called = false;
  const rejected = createEditVisualCaptureOperation({
    authorizeSourcePath: async () => {
      throw new Error("unknown source");
    },
    capture: async () => {
      called = true;
    },
  });
  await assert.rejects(rejected(request), /unknown source/u);
  assert.equal(called, false);
});

test("capture controller destroys its hidden window and revokes its preview session", async () => {
  const captures = [];
  const windows = [];
  class FakeBrowserWindow {
    destroyed = false;

    webContents = {
      setWindowOpenHandler() {},
      on() {},
      executeJavaScript: async (source) => {
        if (source.includes("const populated = []")) {
          return [payload().candidates[0]];
        }
        if (source.startsWith("new Promise")) {
          return {
            x: 4,
            y: 8,
            width: 320,
            height: 120,
            layoutWidth: 320,
            layoutHeight: 120,
          };
        }
        return true;
      },
    };

    constructor(options) {
      this.options = options;
      windows.push(this);
    }

    async loadURL(url) {
      this.url = url;
    }

    async capturePage(rect, options) {
      captures.push({ rect, options });
      return {
        isEmpty: () => false,
        toDataURL: () => PNG,
        getSize: () => ({ width: 1, height: 1 }),
        resize() {
          return this;
        },
      };
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const revoked = [];
  const controller = createEditVisualCaptureController({
    BrowserWindowClass: FakeBrowserWindow,
    createSession: async () => ({
      sessionId: "0123456789abcdef0123456789abcdef",
      url: "pageroot-preview://0123456789abcdef0123456789abcdef/index.html",
    }),
    revokeSession: async (sessionId) => {
      revoked.push(sessionId);
    },
    wait: async () => {},
  });

  const result = await controller.capture(payload());
  assert.equal(result.protocol, "pageroot-runtime-visual-projection");
  assert.equal(result.visuals.length, 1);
  assert.deepEqual(captures, [{
    rect: { x: 4, y: 8, width: 320, height: 120 },
    options: { stayHidden: true },
  }]);
  assert.equal(windows[0].options.show, false);
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.equal(windows[0].destroyed, true);
  assert.deepEqual(revoked, ["0123456789abcdef0123456789abcdef"]);
});
