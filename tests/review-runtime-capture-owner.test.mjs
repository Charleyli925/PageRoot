import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runInNewContext } from "node:vm";

import {
  createRuntimeSnapshotCaptureController,
  isolatedSnapshotRectScript,
  validateRuntimeSnapshotCaptureRequest,
} from "../desktop/runtime-visual-capture-owner.mjs";
import { RUNTIME_VISUAL_CONTRACT } from "../app/domain/runtime-visual-contract.js";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR42mNk+M/wHwAEAQH/2p9Z5QAAAABJRU5ErkJggg==",
  "base64",
);
const HTML = "<!doctype html><html><body><main><canvas id=chart></canvas></main></body></html>";
const SOURCE_SHA256 = `sha256:${createHash("sha256").update(HTML, "utf8").digest("hex")}`;
const MULTI_HOST_HTML = "<!doctype html><html><body><main><canvas id=chart></canvas><canvas id=chart-two></canvas></main></body></html>";

function pngWithDimensions(width, height, byteLength = PNG.byteLength) {
  const png = new Uint8Array(Math.max(byteLength, PNG.byteLength));
  png.set(PNG);
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  return png;
}

function request(overrides = {}) {
  return {
    contractVersion: RUNTIME_VISUAL_CONTRACT.version,
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

function ownerRects(renderedText = "图表 9.54") {
  return {
    status: "captured",
    snapshots: [{
      key: "runtime-host-1",
      state: "captured",
      rect: { x: 0, y: 0, width: 1, height: 1 },
      renderedText,
    }],
  };
}

function ownerRectsFor(key, rect, renderedText = "图表 9.54") {
  return {
    status: "captured",
    snapshots: [{ key, state: "captured", rect, renderedText }],
  };
}

function isolatedVisibleText({
  color = "rgb(0, 0, 0)",
  textFill = "currentcolor",
  textShadow = "none",
  textDecorationColor = "currentcolor",
  textDecorationLine = "none",
  textStrokeColor = "transparent",
  textStrokeWidth = "0px",
  svg = false,
  fill = "none",
  fillOpacity = "1",
  stroke = "none",
  strokeOpacity = "1",
  strokeWidth = "0px",
  clippingAncestor = null,
  hostStyle = null,
  textStyle = null,
  textValue = "visible chart label",
  textRect = null,
  textRects = null,
} = {}) {
  class Element {
    constructor(tagName, attributes = {}) {
      this.tagName = tagName;
      this.attributes = attributes;
      this.children = [];
      this.namespaceURI = svg
        ? "http://www.w3.org/2000/svg"
        : "http://www.w3.org/1999/xhtml";
      this.rect = { x: 10, y: 10, width: 100, height: 60 };
      this.style = {
        display: "block",
        visibility: "visible",
        contentVisibility: "visible",
        opacity: "1",
        color,
        webkitTextFillColor: textFill,
        textShadow,
        textDecorationColor,
        textDecorationLine,
        webkitTextStrokeColor: textStrokeColor,
        webkitTextStrokeWidth: textStrokeWidth,
        fill,
        fillOpacity,
        stroke,
        strokeOpacity,
        strokeWidth,
        filter: "none",
        maskImage: "none",
        webkitMaskImage: "none",
        backgroundClip: "border-box",
        webkitBackgroundClip: "border-box",
        backgroundColor: "rgba(0, 0, 0, 0)",
        backgroundImage: "none",
        webkitBackgroundImage: "none",
        textTransform: "none",
        whiteSpace: "normal",
        getPropertyValue(name) {
          if (name === "-webkit-text-fill-color") return this.webkitTextFillColor;
          if (name === "mask-image") return this.maskImage;
          if (name === "-webkit-mask-image") return this.webkitMaskImage;
          if (name === "background-clip") return this.backgroundClip;
          if (name === "-webkit-background-clip") return this.webkitBackgroundClip;
          if (name === "background-color") return this.backgroundColor;
          if (name === "background-image") return this.backgroundImage;
          if (name === "-webkit-background-image") return this.webkitBackgroundImage;
          if (name === "text-transform") return this.textTransform;
          if (name === "white-space") return this.whiteSpace;
          return "";
        },
      };
    }

    getAttribute(name) {
      return this.attributes[name] ?? null;
    }

    getBoundingClientRect() {
      return this.rect;
    }

    querySelectorAll() {
      return [];
    }

    scrollIntoView() {}
  }

  class TreeWalker {
    constructor(nodes) {
      this.nodes = nodes;
      this.index = 0;
    }

    nextNode() {
      return this.nodes[this.index++] || null;
    }
  }

  class Range {
    selectNodeContents(node) {
      this.node = node;
    }

    getClientRects() {
      return this.node.clientRects || [this.node.parentElement.rect];
    }
  }

  class Document {
    constructor(root, nodes) {
      this.documentElement = root;
      this.nodes = nodes;
    }

    createTreeWalker() {
      return new TreeWalker(this.nodes);
    }

    createRange() {
      return new Range();
    }
  }

  class Window {
    constructor() {
      this.innerWidth = 960;
      this.innerHeight = 640;
      // Chromium exposes this as an instance method, not Window.prototype.
      this.getComputedStyle = (element) => element.style;
    }
  }

  const root = new Element("HTML");
  const host = new Element(svg ? "SVG" : "CANVAS", { id: "chart" });
  Object.assign(host.style, hostStyle || {});
  host.parentElement = root;
  root.children.push(host);
  let textParent = host;
  if (clippingAncestor) {
    const ancestor = new Element("SPAN");
    ancestor.parentElement = host;
    ancestor.rect = clippingAncestor.rect || ancestor.rect;
    Object.assign(ancestor.style, clippingAncestor.style || {});
    host.children.push(ancestor);
    textParent = ancestor;
  }
  const textElement = svg || clippingAncestor ? new Element(svg ? "text" : "SPAN") : host;
  if (textElement !== host) {
    textElement.parentElement = textParent;
    textElement.rect = textRect || textElement.rect;
    textParent.children.push(textElement);
  }
  Object.assign(textElement.style, textStyle || {});
  const text = {
    nodeValue: textValue,
    parentElement: textElement,
    clientRects: textRects,
  };
  const document = new Document(root, [text]);
  const window = new Window();
  const result = runInNewContext(isolatedSnapshotRectScript({
    key: "runtime-host-1",
    path: [0],
    tagName: svg ? "svg" : "canvas",
    kind: svg ? "svg" : "canvas",
    identityAttributes: [["id", "chart"]],
  }), {
    Array,
    Document,
    Element,
    Number,
    Range,
    String,
    TextEncoder,
    TreeWalker,
    Window,
    document,
    window,
  });
  return result.snapshots[0].renderedText;
}

function fakeOwner({
  rects = ownerRects(),
  loadURL = async () => {},
  ownerDeadlineMs,
  captureSettleMs = 0,
  releaseIsolatedSession,
  frozenChartScripts,
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
    protocolHandlers: [],
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
        protocol: {
          handle(scheme, handler) {
            state.protocolHandlers.push({ scheme, handler });
          },
        },
      };
    },
    releaseIsolatedSession: releaseIsolatedSession || (async (session) => {
      state.released ??= [];
      state.released.push(session);
    }),
    ...(ownerDeadlineMs === undefined ? {} : { ownerDeadlineMs }),
    ...(frozenChartScripts === undefined ? {} : { frozenChartScripts }),
    captureSettleMs,
    randomToken: () => `capture-${state.partitions.length + 1}`,
  });
  return { controller, state };
}

test("runtime snapshot owner rejects non-authoritative or unsupported capture inputs", () => {
  const accepted = validateRuntimeSnapshotCaptureRequest(request());
  assert.equal(accepted.sourceSha256, SOURCE_SHA256);
  assert.equal(accepted.candidates[0].kind, "canvas");
  assert.equal(Object.isFrozen(accepted), true);
  assert.throws(
    () => validateRuntimeSnapshotCaptureRequest(request({ side: "edit" })),
    /side is invalid/u,
  );
  assert.throws(
    () => validateRuntimeSnapshotCaptureRequest(request({ contractVersion: 1 })),
    /contract version is invalid/u,
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
  assert.throws(
    () => validateRuntimeSnapshotCaptureRequest(request({
      viewport: {
        width: RUNTIME_VISUAL_CONTRACT.pageBudget.viewport.maxWidth + 1,
        height: 640,
      },
    })),
    /viewport/u,
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
  assert.equal(
    snapshot.renderedTextSha256,
    `sha256:${createHash("sha256").update("图表 9.54", "utf8").digest("hex")}`,
  );
  assert.equal(Object.hasOwn(snapshot, "renderedText"), false, "raw rendered text must not leave the owner");
  assert.deepEqual(state.createRequests, [{ html: HTML, bootstrapJavaScript: "" }]);
  assert.deepEqual(state.revoked, ["review-preview-0001"]);
  assert.equal(state.windows[0].destroyed, true);
  assert.equal(state.capturePage.length, 1);
  assert.equal(state.isolatedSources.length, 1, "no second owner fact pass is allowed");
  assert.match(state.isolatedSources[0].scripts[0].code, /__pagerootRuntimeSnapshotRects/);
  assert.match(
    state.isolatedSources[0].scripts[0].code,
    /replace\(\/\\s\+\/gu, " "\)/u,
    "the isolated owner must normalize visible-text whitespace rather than a literal backslash sequence",
  );
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

test("isolated visible-text summary excludes transparent paint but keeps a visible text fill", () => {
  assert.equal(isolatedVisibleText({ color: "transparent" }), "");
  assert.equal(isolatedVisibleText({ color: "rgba(255, 0, 0, 0)" }), "");
  assert.equal(isolatedVisibleText({
    color: "color(srgb 1 0 0 / 0)",
    textShadow: "0 0 2px rgba(0, 255, 0, 0)",
  }), "");
  assert.equal(isolatedVisibleText({
    color: "rgb(255, 0, 0)",
    textFill: "transparent",
  }), "");
  assert.equal(isolatedVisibleText({
    color: "transparent",
    textDecorationLine: "underline",
    textDecorationColor: "rgb(0, 0, 0)",
  }), "");
  assert.equal(isolatedVisibleText({
    color: "transparent",
    textFill: "rgb(0, 0, 255)",
  }), "visible chart label");
  assert.equal(isolatedVisibleText({
    color: "transparent",
    textStrokeColor: "rgb(0, 0, 0)",
    textStrokeWidth: "1px",
  }), "visible chart label");
  assert.equal(isolatedVisibleText({
    svg: true,
    fill: "rgb(0, 0, 0)",
    fillOpacity: "0",
  }), "");
  assert.equal(isolatedVisibleText({
    svg: true,
    fill: "none",
    stroke: "rgb(0, 0, 0)",
    strokeWidth: "1px",
    strokeOpacity: "0",
  }), "");
  assert.equal(isolatedVisibleText({
    svg: true,
    fill: "rgb(0, 0, 0)",
    fillOpacity: "1",
  }), "visible chart label");
  assert.equal(isolatedVisibleText({
    svg: true,
    fill: "url(#possibly-transparent-gradient)",
  }), "");
  assert.equal(isolatedVisibleText({
    color: "transparent",
    textFill: "transparent",
    textStyle: {
      backgroundClip: "text",
      webkitBackgroundClip: "text",
      backgroundImage: "linear-gradient(rgb(255, 0, 0), rgb(0, 0, 255))",
    },
  }), "visible chart label");
  assert.equal(isolatedVisibleText({
    color: "transparent",
    textFill: "transparent",
    textStyle: {
      backgroundClip: "text",
      backgroundImage: "linear-gradient(rgba(255, 0, 0, 0), rgba(0, 0, 255, 0))",
    },
  }), "");
});

test("isolated visible-text summary excludes text hidden by ancestor clipping", () => {
  assert.equal(isolatedVisibleText({
    clippingAncestor: {
      rect: { x: 10, y: 10, width: 1, height: 1 },
      style: { overflow: "hidden" },
    },
    textRect: { x: 20, y: 20, width: 100, height: 60 },
  }), "");
  assert.equal(isolatedVisibleText({
    clippingAncestor: {
      rect: { x: 10, y: 10, width: 200, height: 100 },
      style: { overflow: "hidden" },
    },
  }), "visible chart label");
  assert.equal(isolatedVisibleText({
    clippingAncestor: {
      rect: { x: 10, y: 10, width: 100, height: 20 },
      style: { overflow: "hidden" },
    },
    textRects: [
      { x: 10, y: 10, width: 100, height: 18 },
      { x: 10, y: 28, width: 100, height: 18 },
    ],
  }), "");
  assert.equal(isolatedVisibleText({
    clippingAncestor: {
      style: { position: "absolute", clip: "rect(0px, 0px, 0px, 0px)" },
    },
  }), "");
  assert.equal(isolatedVisibleText({
    clippingAncestor: {
      style: { clip: "rect(0px, 0px, 0px, 0px)" },
    },
  }), "visible chart label");
  assert.equal(isolatedVisibleText({
    clippingAncestor: {
      style: { clipPath: "inset(50%)" },
    },
  }), "");
  assert.equal(isolatedVisibleText({
    clippingAncestor: {
      style: { clipPath: "inset(0)" },
    },
  }), "visible chart label");
});

test("isolated visible-text summary excludes post-paint zero-opacity filters", () => {
  assert.equal(isolatedVisibleText({
    hostStyle: { filter: "opacity(0)" },
  }), "");
  assert.equal(isolatedVisibleText({
    clippingAncestor: { style: { filter: "blur(1px) opacity(0%)" } },
  }), "");
  assert.equal(isolatedVisibleText({
    hostStyle: { filter: "opacity(0.01)" },
  }), "visible chart label");
});

test("isolated visible-text summary defers transformed text but preserves visible whitespace", () => {
  assert.equal(isolatedVisibleText({
    textStyle: { textTransform: "uppercase" },
  }), "");
  assert.equal(isolatedVisibleText({
    textValue: "A  B\nC",
    textStyle: { whiteSpace: "pre-wrap" },
  }), "A  B\nC");
  assert.equal(isolatedVisibleText({
    textValue: "A  B\nC",
    textStyle: { whiteSpace: "pre-line" },
  }), "A B\nC");
  assert.equal(isolatedVisibleText({ textValue: "A  B\nC" }), "A B C");
});

test("isolated visible-text summary honors a descendant visibility override", () => {
  assert.equal(isolatedVisibleText({
    clippingAncestor: { style: { visibility: "hidden" } },
    textStyle: { visibility: "visible" },
  }), "visible chart label");
  assert.equal(isolatedVisibleText({
    clippingAncestor: { style: { visibility: "hidden" } },
    textStyle: { visibility: "hidden" },
  }), "");
});

test("isolated visible-text summary leaves masked text to the raster layer", () => {
  assert.equal(isolatedVisibleText({
    hostStyle: { maskImage: "linear-gradient(transparent, transparent)" },
  }), "");
  assert.equal(isolatedVisibleText({
    clippingAncestor: { style: { webkitMaskImage: "url(#fully-hidden)" } },
  }), "");
  assert.equal(isolatedVisibleText({ hostStyle: { maskImage: "none" } }), "visible chart label");
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
    renderedTextSha256: "",
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
    renderedTextSha256: "",
  });
});

test("runtime snapshot owner fails closed for hostile >2MB and >4096 PNG results", async () => {
  const { pngBytes, pngDimension } = RUNTIME_VISUAL_CONTRACT.pageBudget;
  const hostilePngs = [
    pngWithDimensions(1, 1, pngBytes + 1),
    pngWithDimensions(pngDimension + 1, 1),
    pngWithDimensions(1, pngDimension + 1),
  ];

  for (const png of hostilePngs) {
    const { controller } = fakeOwner({ png });
    const captured = await controller.capture(request());
    assert.equal(captured.outcome, "captured");
    assert.equal(captured.envelope.runtimeVisualSnapshots[0].state, "unavailable");
  }
});

test("runtime snapshot owner hashes bounded visible text and suppresses an over-limit owner response", async () => {
  const overTextBudget = "x".repeat(RUNTIME_VISUAL_CONTRACT.pageBudget.renderedTextBytes + 1);
  const { controller, state } = fakeOwner({ rects: ownerRects(overTextBudget) });
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
    renderedTextSha256: "",
  });
  assert.deepEqual(state.capturePage || [], []);
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

test("capture settles after the first paint before measuring or sampling pixels", async () => {
  const { controller, state } = fakeOwner({ captureSettleMs: 60 });
  const startedAt = performance.now();
  const captured = await controller.capture(request());
  const elapsedMs = performance.now() - startedAt;
  assert.equal(captured.outcome, "captured");
  assert.ok(elapsedMs >= 55, `capture sampled after ${elapsedMs.toFixed(1)}ms without settling`);
  assert.deepEqual(
    state.captureEvents.map(({ type }) => type),
    ["paint", "measure", "capture"],
    "the settle wait must not reorder paint, measurement and capture",
  );
});

test("the settle wait stays subordinate to the owner deadline", async () => {
  const { controller, state } = fakeOwner({
    captureSettleMs: 5_000,
    ownerDeadlineMs: 40,
    releaseIsolatedSession: () => new Promise(() => {}),
  });
  const startedAt = performance.now();
  const timedOut = await controller.capture(request());
  const elapsedMs = performance.now() - startedAt;
  assert.deepEqual(timedOut, { outcome: "timed-out", reason: "owner-deadline" });
  assert.ok(elapsedMs < 600, `owner response waited ${elapsedMs.toFixed(1)}ms`);
  assert.equal(state.windows[0].destroyed, true);
});

test("frozen chart scripts are prewarmed per capture session and served only from pinned bytes", async () => {
  const frozenUrl = "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js";
  const frozenBytes = Buffer.from("window.__pagerootFrozenEcharts = 1;", "utf8");
  const prewarmed = [];
  const { controller, state } = fakeOwner({
    frozenChartScripts: {
      prewarm: async (payload) => {
        prewarmed.push(payload);
      },
      resolve: (captureSessionId, url) => (
        captureSessionId === "review-owner-session-0001" && url === frozenUrl
          ? frozenBytes
          : null
      ),
    },
  });
  const captured = await controller.capture(request());
  assert.equal(captured.outcome, "captured");
  assert.equal(prewarmed.length, 1);
  assert.equal(prewarmed[0].captureSessionId, "review-owner-session-0001");
  assert.equal(typeof prewarmed[0].html, "string");

  const https = state.protocolHandlers.find((entry) => entry.scheme === "https");
  assert.ok(https, "the isolated session serves https only through the frozen handler");
  const served = await https.handler({ url: frozenUrl });
  assert.equal(served.status, 200);
  assert.equal(served.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.deepEqual(Buffer.from(await served.arrayBuffer()), frozenBytes);
  const blocked = await https.handler({ url: "https://cdnjs.cloudflare.com/ajax/libs/other.js" });
  assert.equal(blocked.status, 403, "an unpinned URL is blocked, never fetched");

  let frozenDecision;
  state.beforeRequest[0]({ url: frozenUrl }, (value) => {
    frozenDecision = value;
  });
  assert.deepEqual(frozenDecision, { cancel: false });
  let attackerDecision;
  state.beforeRequest[0]({ url: "https://attacker.invalid/script.js" }, (value) => {
    attackerDecision = value;
  });
  assert.deepEqual(attackerDecision, { cancel: true });
});

test("without a frozen script store the isolated session stays fully closed", async () => {
  const { controller, state } = fakeOwner();
  const captured = await controller.capture(request());
  assert.equal(captured.outcome, "captured");
  assert.equal(state.protocolHandlers.length, 0, "no https handler is installed");
  let decision;
  state.beforeRequest[0]({
    url: "https://cdnjs.cloudflare.com/ajax/libs/echarts/5.5.0/echarts.min.js",
  }, (value) => {
    decision = value;
  });
  assert.deepEqual(decision, { cancel: true });
});
