import assert from "node:assert/strict";
import test from "node:test";

import {
  createEditVisualCaptureController,
  createEditVisualCaptureOperation,
  validateEditVisualCapturePayload,
} from "../desktop/edit-visual-capture.mjs";
import { prepareRuntimeVisualCapture } from "../app/domain/runtime-visual-projection.js";
import { RUNTIME_VISUAL_CONTRACT } from "../app/domain/runtime-visual-contract.js";
import { runtimeVisualHostilePage } from "./fixtures/runtime-visual-hostile-pages.mjs";

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==";
const PNG_BYTES = Buffer.from(PNG.slice(PNG.indexOf(",") + 1), "base64");
const SOURCE = `<!doctype html><main><div id=chart></div><script>
  document.getElementById("chart").appendChild(document.createElement("svg"));
</script></main>`;

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
  assert.throws(() => validateEditVisualCapturePayload({
    ...payload(),
    candidates: Array.from(
      { length: RUNTIME_VISUAL_CONTRACT.candidateLimit + 1 },
      (_, index) => ({ sourceNodeId: `element:${index}:1:div`, tagName: "div" }),
    ),
  }), /candidates/u);
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
  const executedScripts = [];
  const windows = [];
  class FakeBrowserWindow {
    destroyed = false;

    webContents = {
      setWindowOpenHandler() {},
      on() {},
      executeJavaScript: async (source) => {
        executedScripts.push(source);
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
            captureBox: "content",
            complete: true,
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
        toPNG: () => PNG_BYTES,
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
  assert.equal(result.version, 2);
  assert.equal(result.visuals.length, 1);
  assert.equal(result.visuals[0].captureBox, "content");
  assert.equal(result.visuals[0].sizingMode, "contain");
  assert.equal(result.visuals[0].deviceScaleFactor, 1);
  assert.match(result.visuals[0].runtimeContentSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.deepEqual(
    Buffer.from(result.visuals[0].pngBytes),
    PNG_BYTES,
  );
  assert.deepEqual(result.visuals[0].crop, {
    x: 4,
    y: 8,
    width: 320,
    height: 120,
  });
  assert.deepEqual(result.deferredSourceNodeIds, []);
  assert.deepEqual(captures, [{
    rect: { x: 4, y: 8, width: 320, height: 120 },
    options: { stayHidden: true },
  }]);
  assert.equal(windows[0].options.show, false);
  assert.equal(windows[0].options.webPreferences.nodeIntegration, false);
  assert.equal(windows[0].options.webPreferences.sandbox, true);
  assert.equal(windows[0].destroyed, true);
  assert.deepEqual(revoked, ["0123456789abcdef0123456789abcdef"]);
  assert.equal(executedScripts.some((source) => (
    source.includes("new MutationObserver")
    && source.includes("lastMutationAt")
  )), true);
  assert.equal(executedScripts.some((source) => (
    source.includes("preservesPaintedGeometry")
    && source.includes("window.dispatchEvent(new Event(\"resize\"))")
    && source.includes('computed.display === "none"')
  )), true);
  assert.equal(executedScripts.some((source) => (
    source.includes("viewportScale")
    && source.includes("ancestor.clientWidth * ancestorScale.x")
    && source.includes("deviceScaleFactor")
    && source.includes("complete: true")
  )), true);
  assert.equal(executedScripts.some((source) => (
    source.includes('candidate.tagName === "canvas"')
    && source.includes("getImageData")
  )), true);
});

test("capture controller defers an incomplete host instead of stretching a clipped bitmap", async () => {
  let capturePageCalled = false;
  class FakeBrowserWindow {
    destroyed = false;

    webContents = {
      setWindowOpenHandler() {},
      on() {},
      executeJavaScript: async (source) => {
        if (source.includes("const populated = []")) return [payload().candidates[0]];
        if (source.startsWith("new Promise")) {
          return {
            x: 0,
            y: 0,
            width: 320,
            height: 120,
            layoutWidth: 320,
            layoutHeight: 1_500,
            captureBox: "content",
            complete: false,
          };
        }
        return true;
      },
    };

    async loadURL() {}

    async capturePage() {
      capturePageCalled = true;
      throw new Error("capturePage must not receive incomplete geometry");
    }

    isDestroyed() {
      return this.destroyed;
    }

    destroy() {
      this.destroyed = true;
    }
  }

  const controller = createEditVisualCaptureController({
    BrowserWindowClass: FakeBrowserWindow,
    createSession: async () => ({
      sessionId: "fedcba9876543210fedcba9876543210",
      url: "pageroot-preview://fedcba9876543210fedcba9876543210/index.html",
    }),
    revokeSession: async () => {},
  });
  const result = await controller.capture(payload());
  assert.equal(capturePageCalled, false);
  assert.deepEqual(result.visuals, []);
  assert.deepEqual(
    result.deferredSourceNodeIds,
    [payload().candidates[0].sourceNodeId],
  );
});

test("capture owner deadline destroys a page that stalls its settle clock", async () => {
  const fixture = runtimeVisualHostilePage("pr105-owner-deadline");
  const hostilePayload = prepareRuntimeVisualCapture({
    html: fixture.html,
    sourcePath: "/tmp/hostile-clock.html",
    viewportWidth: 900,
  }).payload;
  const windows = [];
  class FakeBrowserWindow {
    destroyed = false;

    webContents = {
      setWindowOpenHandler() {},
      on() {},
      executeJavaScript: async (source) => {
        if (source.includes("const populated = []")) return hostilePayload.candidates;
        if (source.includes("let lastMutationAt = startedAt")) {
          return new Promise(() => {});
        }
        return true;
      },
    };

    constructor() {
      windows.push(this);
    }

    async loadURL() {}

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
      sessionId: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      url: "pageroot-preview://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/index.html",
    }),
    revokeSession: async (sessionId) => revoked.push(sessionId),
    ownerDeadlineMs: 10,
  });
  await assert.rejects(controller.capture(hostilePayload), /timed out/u);
  assert.equal(windows[0].destroyed, true, fixture.contract);
  assert.deepEqual(revoked, ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"]);
});
