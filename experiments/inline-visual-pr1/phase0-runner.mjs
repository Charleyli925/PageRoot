import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";

import { app, BrowserWindow, session } from "electron";

const VIEWPORT = Object.freeze({ width: 960, height: 640 });
const RESIZED_VIEWPORT = Object.freeze({ width: 800, height: 600 });
const MASKED_SLOT_KEYS = Object.freeze(["canvas-chart", "svg-chart"]);
const SLOT_IDS = Object.freeze({
  "canvas-chart": "slot-canvas",
  "svg-chart": "slot-svg",
  "replacement-check": "slot-replaced",
});
const HARD_TERMINATE_BUDGET_MS = 1_000;
const READY_DEADLINE_MS = 3_000;
const SAFE_ORIGIN = "data:";
const phase0Windows = new Set();
const phase0Partitions = new Set();

app.on("window-all-closed", (event) => event.preventDefault());

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function writeEvidence(value, exitCode) {
  await new Promise((resolve) => process.stdout.write(`${JSON.stringify(value)}\n`, resolve));
  app.exit(exitCode);
}

function withDeadline(promise, deadlineMs, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`${label} timed out.`)), deadlineMs)),
  ]);
}

function dataUrl(documentHtml) {
  return `data:text/html;charset=utf-8,${encodeURIComponent(documentHtml)}`;
}

function jsonForInlineScript(value) {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

function htmlAttribute(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function phase0SourceMarkup({ hang = false } = {}) {
  const slotIds = jsonForInlineScript(SLOT_IDS);
  const bindingBootstrap = String.raw`(() => {
  "use strict";
  const slotIds = ${slotIds};
  const call = Function.prototype.call;
  const addEventListener = EventTarget.prototype.addEventListener;
  const stopImmediatePropagation = Event.prototype.stopImmediatePropagation;
  const getBoundingClientRect = Element.prototype.getBoundingClientRect;
  const sourceSlots = Object.entries(slotIds).map(([key, id]) => ({
    key,
    id,
    element: document.getElementById(id),
  }));
  let privatePort = null;
  const snapshot = () => sourceSlots.map((slot) => {
    const rect = slot.element instanceof Element
      ? call.call(getBoundingClientRect, slot.element)
      : null;
    return {
      key: slot.key,
      connected: Boolean(slot.element?.isConnected),
      sameElement: Boolean(slot.element?.isConnected && document.getElementById(slot.id) === slot.element),
      rect: rect && Number.isFinite(rect.x) && Number.isFinite(rect.y)
        && Number.isFinite(rect.width) && Number.isFinite(rect.height)
        ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
        : null,
    };
  });
  const report = (type, requestId = null) => {
    if (!privatePort) return;
    privatePort.postMessage({
      type,
      requestId,
      slots: snapshot(),
      authorObservedBinding: Boolean(window.__phase0AuthorObservedBinding),
    });
  };
  const afterLayout = (callback) => setTimeout(callback, 16);
  const receiveBinding = (event) => {
    const data = event.data;
    window.parent.postMessage({
      type: "phase0-bind-observation",
      parentMatched: event.source === window.parent,
      messageMatched: Boolean(data && data.type === "phase0-bind"),
      nonceMatched: typeof data?.nonce === "string",
      transferredPortCount: event.ports.length,
      alreadyBound: Boolean(privatePort),
    }, "*");
    if (
      event.source !== window.parent
      || !data
      || data.type !== "phase0-bind"
      || typeof data.nonce !== "string"
      || event.ports.length !== 1
      || privatePort
    ) return;
    call.call(stopImmediatePropagation, event);
    privatePort = event.ports[0];
    privatePort.onmessage = (portEvent) => {
      const message = portEvent.data;
      if (!message || typeof message !== "object") return;
      if (message.type === "phase0-measure" && typeof message.requestId === "string") {
        afterLayout(() => report("phase0-measurement", message.requestId));
      }
      if (
        message.type === "phase0-scroll"
        && typeof message.requestId === "string"
        && Number.isFinite(message.top)
      ) {
        window.scrollTo(0, Math.max(0, Math.floor(message.top)));
        afterLayout(() => report("phase0-measurement", message.requestId));
      }
    };
    privatePort.start?.();
    afterLayout(() => report("phase0-bound"));
  };
  call.call(addEventListener, window, "message", receiveBinding, true);
  window.parent.postMessage({ type: "phase0-bootstrap-ready", slotCount: sourceSlots.length }, "*");
})();`;
  const authorScript = String.raw`(() => {
  window.__phase0AuthorObservedBinding = false;
  window.addEventListener("message", (event) => {
    if (event.data?.type === "phase0-bind") window.__phase0AuthorObservedBinding = true;
  }, true);
  window.parent.postMessage({
    type: "phase0-bound",
    nonce: "forged-by-author-script",
    slots: [{ key: "canvas-chart", connected: true, sameElement: true }],
  }, "*");
  const canvasHost = document.getElementById("slot-canvas");
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 160;
  canvas.style.cssText = "display:block;width:100%;height:100%";
  const context = canvas.getContext("2d");
  context.fillStyle = "#e91e63";
  context.fillRect(0, 0, canvas.width, canvas.height);
  canvasHost.replaceChildren(canvas);
  const svgHost = document.getElementById("slot-svg");
  svgHost.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%" viewBox="0 0 10 10"><rect width="10" height="10" fill="#00a7c4"/></svg>';
  const replacement = document.getElementById("slot-replaced");
  replacement.replaceWith(Object.assign(document.createElement("div"), {
    id: "slot-replaced",
    textContent: "replaced",
  }));
  ${hang ? "while (true) {}" : ""}
})();`;
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 1px; background: transparent; }
      body { min-height: 1280px; overflow-y: scroll; font-family: sans-serif; }
      #fixture-stage { position: relative; min-height: 1280px; }
      .phase0-slot { position: absolute; overflow: hidden; border: 0; }
      #slot-canvas { left: 7vw; top: 80px; width: 23vw; aspect-ratio: 2 / 1; }
      #slot-svg { left: 49vw; top: 320px; width: 28vw; aspect-ratio: 5 / 2; }
      #slot-replaced { left: 12vw; top: 510px; width: 22vw; height: 100px; }
      #phase0-input { position: absolute; top: 16px; left: 12px; width: 180px; }
    </style>
  </head>
  <body>
    <main id="fixture-stage">
      <input id="phase0-input" aria-label="synthetic edit input" value="static source">
      <div id="slot-canvas" class="phase0-slot" data-report-key="canvas-chart" data-report-visual-slot="fixed"></div>
      <div id="slot-svg" class="phase0-slot" data-report-key="svg-chart" data-report-visual-slot="fixed"></div>
      <div id="slot-replaced" class="phase0-slot" data-report-key="replacement-check" data-report-visual-slot="fixed"></div>
    </main>
    <script>${bindingBootstrap}</script>
    <script>${authorScript}</script>
  </body>
</html>`;
}

function staticEditMarkup() {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <style>
      * { box-sizing: border-box; }
      html, body { margin: 0; min-height: 1px; background: #f7f7f7; }
      body { min-height: 1280px; overflow-y: scroll; font-family: sans-serif; }
      #fixture-stage { position: relative; min-height: 1280px; }
      .phase0-slot { position: absolute; overflow: hidden; border: 0; background: #d7d7d7; }
      #slot-canvas { left: 7vw; top: 80px; width: 23vw; aspect-ratio: 2 / 1; }
      #slot-svg { left: 49vw; top: 320px; width: 28vw; aspect-ratio: 5 / 2; }
      #slot-replaced { left: 12vw; top: 510px; width: 22vw; height: 100px; }
      #phase0-input { position: absolute; top: 16px; left: 12px; width: 180px; }
    </style>
  </head>
  <body>
    <main id="fixture-stage">
      <input id="phase0-input" aria-label="synthetic edit input" value="static source">
      <div id="slot-canvas" class="phase0-slot" data-report-key="canvas-chart" data-report-visual-slot="fixed"></div>
      <div id="slot-svg" class="phase0-slot" data-report-key="svg-chart" data-report-visual-slot="fixed"></div>
      <div id="slot-replaced" class="phase0-slot" data-report-key="replacement-check" data-report-visual-slot="fixed"></div>
    </main>
  </body>
</html>`;
}

function runtimeWrapperMarkup({ sourceHtml, nonce }) {
  const allowedKeys = jsonForInlineScript(MASKED_SLOT_KEYS);
  const expectedNonce = jsonForInlineScript(nonce);
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-src 'self'">
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; }
      #runtime-source {
        position: fixed;
        inset: 0;
        width: 100vw;
        height: 100vh;
        border: 0;
        pointer-events: none;
        clip-path: url(#phase0-inline-mask);
      }
    </style>
  </head>
  <body>
    <svg aria-hidden="true" width="0" height="0" focusable="false">
      <defs><clipPath id="phase0-inline-mask" clipPathUnits="userSpaceOnUse"></clipPath></defs>
    </svg>
    <iframe id="runtime-source" sandbox="allow-scripts" srcdoc="${htmlAttribute(sourceHtml)}"></iframe>
    <script>
      (() => {
        "use strict";
        const allowedKeys = new Set(${allowedKeys});
        const expectedNonce = ${expectedNonce};
        const source = document.getElementById("runtime-source");
        const mask = document.getElementById("phase0-inline-mask");
        const state = {
          bound: false,
          binding: null,
          bindObservations: [],
          forgedWindowMessages: 0,
          maskedKeys: [],
          wrapperPointerEvents: getComputedStyle(source).pointerEvents,
        };
        const pending = new Map();
        let privatePort = null;
        let nextRequest = 0;
        const finiteRect = (value) => value
          && typeof value === "object"
          && ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key]))
          && value.width >= 0
          && value.height >= 0;
        const normalizedSlots = (slots) => {
          if (!Array.isArray(slots) || slots.length !== 3) return null;
          const keys = new Set();
          const normalized = [];
          for (const slot of slots) {
            if (!slot || typeof slot !== "object" || typeof slot.key !== "string" || keys.has(slot.key)) return null;
            if (!(slot.key in ${jsonForInlineScript(SLOT_IDS)})) return null;
            if (typeof slot.connected !== "boolean" || typeof slot.sameElement !== "boolean") return null;
            if (slot.rect !== null && !finiteRect(slot.rect)) return null;
            keys.add(slot.key);
            normalized.push({
              key: slot.key,
              connected: slot.connected,
              sameElement: slot.sameElement,
              rect: slot.rect === null ? null : {
                x: slot.rect.x,
                y: slot.rect.y,
                width: slot.rect.width,
                height: slot.rect.height,
              },
            });
          }
          return normalized;
        };
        const settle = (requestId, value) => {
          const entry = pending.get(requestId);
          if (!entry) return;
          pending.delete(requestId);
          entry.resolve(value);
        };
        const receivePrivate = (event) => {
          const message = event.data;
          if (!message || typeof message !== "object") return;
          const slots = normalizedSlots(message.slots);
          if (!slots || message.authorObservedBinding !== false) return;
          if (message.type === "phase0-bound") {
            state.binding = slots;
            return;
          }
          if (message.type === "phase0-measurement" && typeof message.requestId === "string") {
            settle(message.requestId, slots);
          }
        };
        const bind = () => {
          if (state.bound || source.contentWindow === null) return;
          const channel = new MessageChannel();
          privatePort = channel.port1;
          privatePort.onmessage = receivePrivate;
          privatePort.start?.();
          state.bound = true;
          source.contentWindow.postMessage({ type: "phase0-bind", nonce: expectedNonce }, "*", [channel.port2]);
        };
        window.addEventListener("message", (event) => {
          if (event.source !== source.contentWindow || !event.data || typeof event.data !== "object") return;
          if (event.data.type === "phase0-bootstrap-ready" && !state.bound) {
            bind();
            return;
          }
          if (event.data.type === "phase0-bind-observation") {
            state.bindObservations.push({
              parentMatched: event.data.parentMatched === true,
              messageMatched: event.data.messageMatched === true,
              nonceMatched: event.data.nonceMatched === true,
              transferredPortCount: Number(event.data.transferredPortCount),
              alreadyBound: event.data.alreadyBound === true,
            });
            return;
          }
          state.forgedWindowMessages += 1;
        });
        window.__phase0AwaitBinding = async (deadlineMs) => {
          const deadline = Date.now() + deadlineMs;
          while (Date.now() < deadline) {
            if (state.binding) return state.binding;
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
          throw new Error("phase0 private binding did not arrive");
        };
        window.__phase0Measure = () => new Promise((resolve, reject) => {
          if (!privatePort) {
            reject(new Error("phase0 private port is unavailable"));
            return;
          }
          const requestId = "measure-" + (++nextRequest);
          const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error("phase0 measurement did not arrive"));
          }, 1_000);
          pending.set(requestId, {
            resolve(value) {
              clearTimeout(timer);
              resolve(value);
            },
          });
          privatePort.postMessage({ type: "phase0-measure", requestId });
        });
        window.__phase0Scroll = (top) => new Promise((resolve, reject) => {
          if (!privatePort || !Number.isFinite(top)) {
            reject(new Error("phase0 scroll request is invalid"));
            return;
          }
          const requestId = "scroll-" + (++nextRequest);
          const timer = setTimeout(() => {
            pending.delete(requestId);
            reject(new Error("phase0 scroll did not settle"));
          }, 1_000);
          pending.set(requestId, {
            resolve(value) {
              clearTimeout(timer);
              resolve(value);
            },
          });
          privatePort.postMessage({ type: "phase0-scroll", requestId, top });
        });
        window.__phase0ApplyMask = (slots) => {
          if (!Array.isArray(slots) || slots.length !== allowedKeys.size) return false;
          const keys = new Set();
          const rectangles = [];
          for (const slot of slots) {
            if (!slot || !allowedKeys.has(slot.key) || keys.has(slot.key) || !finiteRect(slot.rect)) return false;
            if (slot.rect.width < 1 || slot.rect.height < 1) return false;
            keys.add(slot.key);
            rectangles.push(slot);
          }
          mask.replaceChildren(...rectangles.map((slot) => {
            const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
            rect.setAttribute("x", String(slot.rect.x));
            rect.setAttribute("y", String(slot.rect.y));
            rect.setAttribute("width", String(slot.rect.width));
            rect.setAttribute("height", String(slot.rect.height));
            return rect;
          }));
          state.maskedKeys = rectangles.map((slot) => slot.key).sort();
          return true;
        };
        window.__phase0State = () => ({
          bound: state.bound,
          binding: state.binding,
          bindObservations: state.bindObservations,
          forgedWindowMessages: state.forgedWindowMessages,
          maskedKeys: state.maskedKeys,
          wrapperPointerEvents: state.wrapperPointerEvents,
        });
      })();
    </script>
  </body>
</html>`;
}

function createWindow(options) {
  const window = new BrowserWindow(options);
  phase0Windows.add(window);
  window.once("closed", () => phase0Windows.delete(window));
  window.webContents.setBackgroundThrottling(false);
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  return window;
}

async function loadWindow(window, documentHtml) {
  await withDeadline(window.loadURL(dataUrl(documentHtml)), READY_DEADLINE_MS, "phase0 window load");
  await window.webContents.executeJavaScript("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

async function measureEditWindow(window) {
  return window.webContents.executeJavaScript(`(() => {
    const ids = ${jsonForInlineScript(SLOT_IDS)};
    return {
      slots: Object.entries(ids).map(([key, id]) => {
        const element = document.getElementById(id);
        const rect = element.getBoundingClientRect();
        return { key, rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height } };
      }),
      scrollTop: window.scrollY,
      viewport: { width: window.innerWidth, height: window.innerHeight, dpr: window.devicePixelRatio },
    };
  })()`);
}

function comparableSlots(slots) {
  return slots
    .filter((slot) => MASKED_SLOT_KEYS.includes(slot.key))
    .sort((left, right) => left.key.localeCompare(right.key));
}

function rectsAgree(leftSlots, rightSlots, tolerance = 0.25) {
  const left = comparableSlots(leftSlots);
  const right = comparableSlots(rightSlots);
  if (left.length !== right.length) return false;
  return left.every((leftSlot, index) => {
    const rightSlot = right[index];
    if (leftSlot.key !== rightSlot.key || !leftSlot.rect || !rightSlot.rect) return false;
    return ["x", "y", "width", "height"].every((key) => (
      Math.abs(leftSlot.rect[key] - rightSlot.rect[key]) <= tolerance
    ));
  });
}

async function applyMask(window, slots) {
  return window.webContents.executeJavaScript(
    `window.__phase0ApplyMask(${jsonForInlineScript(comparableSlots(slots))})`,
  );
}

function colorAt(image, viewport, point) {
  const size = image.getSize();
  const x = Math.max(0, Math.min(size.width - 1, Math.floor(point.x * size.width / viewport.width)));
  const y = Math.max(0, Math.min(size.height - 1, Math.floor(point.y * size.height / viewport.height)));
  const bitmap = image.toBitmap();
  const offset = ((y * size.width) + x) * 4;
  const channels = [bitmap[offset + 2], bitmap[offset + 1], bitmap[offset], bitmap[offset + 3]];
  return channels.map((channel) => channel.toString(16).padStart(2, "0")).join("");
}

function rectCenter(slot) {
  return {
    x: slot.rect.x + (slot.rect.width / 2),
    y: slot.rect.y + (slot.rect.height / 2),
  };
}

async function probeMask(window, editorSlots) {
  const image = await window.capturePage();
  const slots = new Map(editorSlots.map((slot) => [slot.key, slot]));
  const canvasColor = colorAt(image, VIEWPORT, rectCenter(slots.get("canvas-chart")));
  const svgColor = colorAt(image, VIEWPORT, rectCenter(slots.get("svg-chart")));
  const outsideColor = colorAt(image, VIEWPORT, { x: 16, y: 180 });
  const replacementColor = colorAt(image, VIEWPORT, rectCenter(slots.get("replacement-check")));
  const transparent = (color) => color.endsWith("00");
  return Object.freeze({
    canvasPainted: canvasColor.startsWith("e91e63"),
    svgPainted: svgColor.startsWith("00a7c4"),
    outsideTransparent: transparent(outsideColor),
    replacementTransparent: transparent(replacementColor),
    sampledColors: Object.freeze({
      canvas: canvasColor,
      svg: svgColor,
      outside: outsideColor,
      replacement: replacementColor,
    }),
    imageSize: image.getSize(),
  });
}

function configureRuntimeSession(partition, resourceState) {
  const isolated = session.fromPartition(partition, { cache: false });
  isolated.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  isolated.setPermissionCheckHandler(() => false);
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const allowed = details.url.startsWith(SAFE_ORIGIN) || details.url === "about:blank";
    if (!allowed) {
      resourceState.externalAttemptCount += 1;
      callback({ cancel: true });
      return;
    }
    callback({});
  });
  phase0Partitions.add(partition);
  return isolated;
}

async function releaseRuntimeSession(partition, isolated) {
  isolated.webRequest.onBeforeRequest(null);
  isolated.setPermissionRequestHandler(null);
  isolated.setPermissionCheckHandler(null);
  await isolated.clearStorageData().catch(() => undefined);
  await isolated.clearCache().catch(() => undefined);
  phase0Partitions.delete(partition);
}

function destroyWindow(window) {
  if (!window || window.isDestroyed()) return Promise.resolve();
  const closed = new Promise((resolve) => window.once("closed", resolve));
  window.destroy();
  return closed;
}

async function runTerminationProbe(editorWindow) {
  const partition = `temp:pageroot-inline-visual-phase0-hang-${randomBytes(8).toString("hex")}`;
  const resourceState = { externalAttemptCount: 0 };
  const isolated = configureRuntimeSession(partition, resourceState);
  const hangingWindow = createWindow({
    x: 24,
    y: 24,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    show: false,
    frame: false,
    transparent: true,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      partition,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });
  hangingWindow.setIgnoreMouseEvents(true, { forward: true });
  const nonce = randomBytes(16).toString("hex");
  const editorProcessId = editorWindow.webContents.getProcessId();
  const load = hangingWindow.loadURL(dataUrl(runtimeWrapperMarkup({
    sourceHtml: phase0SourceMarkup({ hang: true }),
    nonce,
  }))).catch(() => undefined);
  await wait(150);
  const runtimeProcessId = hangingWindow.webContents.getProcessId();
  const separateRenderer = Boolean(runtimeProcessId && runtimeProcessId !== editorProcessId);
  let editorResponsiveWhileHung = false;
  if (separateRenderer) {
    editorResponsiveWhileHung = await withDeadline(
      editorWindow.webContents.executeJavaScript("document.readyState"),
      500,
      "edit responsiveness during runtime hang",
    ).then((readyState) => readyState === "complete" || readyState === "interactive").catch(() => false);
  }
  const startedAt = performance.now();
  await destroyWindow(hangingWindow);
  const elapsedMs = performance.now() - startedAt;
  await load;
  await releaseRuntimeSession(partition, isolated);
  return Object.freeze({
    editorProcessId,
    runtimeProcessId,
    separateRenderer,
    editorResponsiveWhileHung,
    terminationElapsedMs: Math.round(elapsedMs),
    withinBudget: elapsedMs <= HARD_TERMINATE_BUDGET_MS,
    externalAttemptCount: resourceState.externalAttemptCount,
  });
}

async function run() {
  app.commandLine.appendSwitch("disable-background-timer-throttling");
  app.commandLine.appendSwitch("disable-renderer-backgrounding");
  await app.whenReady();
  const resourceState = { externalAttemptCount: 0 };
  const partition = `temp:pageroot-inline-visual-phase0-${randomBytes(8).toString("hex")}`;
  const isolated = configureRuntimeSession(partition, resourceState);
  const evidence = {
    schemaVersion: 1,
    environment: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      platform: process.platform,
      architecture: process.arch,
    },
    host: {
      surfaceCount: 1,
      sourceKind: "synthetic-only",
      runtimeWindowVisible: false,
      editorScriptsExecuted: false,
    },
    probes: {},
    decision: null,
  };
  const consoleMessages = [];
  let editorWindow = null;
  let runtimeWindow = null;
  try {
    editorWindow = createWindow({
      x: 24,
      y: 24,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      show: false,
      frame: false,
      webPreferences: {
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    await loadWindow(editorWindow, staticEditMarkup());
    editorWindow.webContents.setZoomFactor(1);
    await wait(25);
    await editorWindow.webContents.executeJavaScript(`(() => {
      window.__phase0EditEvents = { pointerdown: 0, wheel: 0, keydown: 0, compositionstart: 0 };
      for (const type of Object.keys(window.__phase0EditEvents)) {
        window.addEventListener(type, () => { window.__phase0EditEvents[type] += 1; }, true);
      }
    })()`);

    const nonce = randomBytes(16).toString("hex");
    runtimeWindow = createWindow({
      x: 24,
      y: 24,
      width: VIEWPORT.width,
      height: VIEWPORT.height,
      show: false,
      frame: false,
      transparent: true,
      focusable: false,
      skipTaskbar: true,
      hasShadow: false,
      parent: editorWindow,
      webPreferences: {
        partition,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        backgroundThrottling: false,
      },
    });
    runtimeWindow.webContents.on("console-message", (event) => {
      if (consoleMessages.length < 8) consoleMessages.push(String(event.message || "").slice(0, 240));
    });
    runtimeWindow.setIgnoreMouseEvents(true, { forward: true });
    await loadWindow(runtimeWindow, runtimeWrapperMarkup({
      sourceHtml: phase0SourceMarkup(),
      nonce,
    }));
    runtimeWindow.webContents.setZoomFactor(1);
    await wait(25);
    const binding = await withDeadline(
      runtimeWindow.webContents.executeJavaScript(`window.__phase0AwaitBinding(${READY_DEADLINE_MS})`),
      READY_DEADLINE_MS + 250,
      "phase0 private binding",
    );
    await wait(50);
    const initialEdit = await measureEditWindow(editorWindow);
    const initialRuntime = await runtimeWindow.webContents.executeJavaScript("window.__phase0Measure()");
    const maskApplied = await applyMask(runtimeWindow, initialEdit.slots);
    await wait(50);
    const mask = await probeMask(runtimeWindow, initialEdit.slots);
    const wrapperState = await runtimeWindow.webContents.executeJavaScript("window.__phase0State()");
    const bindingByKey = new Map(binding.map((slot) => [slot.key, slot]));

    evidence.probes.identity = {
      acceptedPrivateBinding: binding.length === Object.keys(SLOT_IDS).length,
      forgedWindowMessagesRejected: wrapperState.forgedWindowMessages > 0,
      authorObservedBinding: binding.some((slot) => slot.authorObservedBinding === true),
      replacementDetected: bindingByKey.get("replacement-check")?.sameElement === false,
      noDomOrPixelTransferToEdit: true,
    };
    evidence.probes.geometry = {
      initialAgreement: rectsAgree(initialEdit.slots, initialRuntime),
      initialViewport: initialEdit.viewport,
    };
    evidence.probes.mask = {
      maskApplied: maskApplied === true,
      ...mask,
    };

    await Promise.all([
      new Promise((resolve) => editorWindow.once("resize", resolve)),
      new Promise((resolve) => runtimeWindow.once("resize", resolve)),
      editorWindow.setBounds({ x: 24, y: 24, width: RESIZED_VIEWPORT.width, height: RESIZED_VIEWPORT.height }),
      runtimeWindow.setBounds({ x: 24, y: 24, width: RESIZED_VIEWPORT.width, height: RESIZED_VIEWPORT.height }),
    ]);
    await wait(50);
    const resizedEdit = await measureEditWindow(editorWindow);
    const resizedRuntime = await runtimeWindow.webContents.executeJavaScript("window.__phase0Measure()");
    const resizedMaskApplied = await applyMask(runtimeWindow, resizedEdit.slots);
    editorWindow.webContents.setZoomFactor(1.25);
    runtimeWindow.webContents.setZoomFactor(1.25);
    await wait(75);
    const zoomedEdit = await measureEditWindow(editorWindow);
    const zoomedRuntime = await runtimeWindow.webContents.executeJavaScript("window.__phase0Measure()");
    const scrollTop = 140;
    await editorWindow.webContents.executeJavaScript(`window.scrollTo(0, ${scrollTop})`);
    const scrolledRuntime = await runtimeWindow.webContents.executeJavaScript(`window.__phase0Scroll(${scrollTop})`);
    await wait(25);
    const scrolledEdit = await measureEditWindow(editorWindow);
    const scrolledMaskApplied = await applyMask(runtimeWindow, scrolledEdit.slots);
    evidence.probes.geometry = {
      ...evidence.probes.geometry,
      resizeAgreement: rectsAgree(resizedEdit.slots, resizedRuntime),
      zoomAgreement: rectsAgree(zoomedEdit.slots, zoomedRuntime),
      scrollAgreement: rectsAgree(scrolledEdit.slots, scrolledRuntime),
      resizeMaskApplied: resizedMaskApplied === true,
      scrollMaskApplied: scrolledMaskApplied === true,
      resizedViewport: resizedEdit.viewport,
      zoomedViewport: zoomedEdit.viewport,
    };

    editorWindow.webContents.sendInputEvent({ type: "mouseDown", x: 20, y: 20, button: "left", clickCount: 1 });
    editorWindow.webContents.sendInputEvent({ type: "mouseUp", x: 20, y: 20, button: "left", clickCount: 1 });
    editorWindow.webContents.sendInputEvent({ type: "mouseWheel", x: 20, y: 20, deltaY: 8, deltaX: 0, canScroll: true });
    await wait(25);
    const editEvents = await editorWindow.webContents.executeJavaScript("window.__phase0EditEvents");
    evidence.probes.pointer = {
      runtimeWindowFocusable: runtimeWindow.isFocusable(),
      nativeIgnoreMouseEventsConfigured: true,
      wrapperPointerEvents: wrapperState.wrapperPointerEvents,
      editorInputSmoke: editEvents.pointerdown > 0 && editEvents.wheel > 0,
      nativePassThroughAllInputClasses: "unverified",
      nativeWindowComposition: "unverified",
      reason: "CI-safe Electron APIs cannot prove OS-level click, drag, selection, context menu, keyboard, IME traversal or final WindowServer composition through a separate native overlay window.",
    };
    const externalAttemptCountBeforeNavigation = resourceState.externalAttemptCount;
    await runtimeWindow.webContents.loadURL("https://phase0.invalid/blocked-navigation").catch(() => undefined);
    await wait(25);
    evidence.probes.resourcePolicy = {
      externalNavigationBlocked: resourceState.externalAttemptCount > externalAttemptCountBeforeNavigation,
      permissionPolicy: "deny-all",
      runtimePartition: "temporary",
    };
    evidence.probes.termination = await runTerminationProbe(editorWindow);
    const decisive = [
      evidence.probes.identity.acceptedPrivateBinding,
      evidence.probes.identity.forgedWindowMessagesRejected,
      evidence.probes.identity.replacementDetected,
      evidence.probes.geometry.initialAgreement,
      evidence.probes.geometry.resizeAgreement,
      evidence.probes.geometry.zoomAgreement,
      evidence.probes.geometry.scrollAgreement,
      evidence.probes.mask.maskApplied,
      evidence.probes.mask.canvasPainted,
      evidence.probes.mask.svgPainted,
      evidence.probes.mask.outsideTransparent,
      evidence.probes.mask.replacementTransparent,
      evidence.probes.termination.separateRenderer,
      evidence.probes.termination.editorResponsiveWhileHung,
      evidence.probes.termination.withinBudget,
    ];
    evidence.decision = {
      outcome: decisive.every(Boolean) && evidence.probes.pointer.nativePassThroughAllInputClasses === true
        ? "go"
        : "no-go",
      reasonCodes: [
        ...(decisive.every(Boolean) ? [] : ["phase0-mechanical-proof-incomplete"]),
        "phase0-native-pointer-pass-through-unverified",
        "phase0-native-window-composition-unverified",
      ],
      productionImplementationAuthorized: false,
    };
  } catch (error) {
    evidence.decision = {
      outcome: "no-go",
      reasonCodes: ["phase0-probe-failed"],
      productionImplementationAuthorized: false,
    };
    evidence.failure = { name: error?.name || "Error", message: String(error?.message || error) };
    if (runtimeWindow && !runtimeWindow.isDestroyed()) {
      evidence.failure.wrapperState = await runtimeWindow.webContents
        .executeJavaScript("typeof window.__phase0State === 'function' ? window.__phase0State() : null")
        .catch(() => null);
    }
    if (consoleMessages.length > 0) evidence.failure.consoleMessages = consoleMessages;
  } finally {
    await destroyWindow(runtimeWindow);
    await destroyWindow(editorWindow);
    await releaseRuntimeSession(partition, isolated);
    evidence.cleanup = {
      activeRuntimeWindows: [...phase0Windows].filter((window) => !window.isDestroyed()).length,
      activeRuntimePartitions: phase0Partitions.size,
    };
  }
  await writeEvidence(evidence, 0);
}

run().catch((error) => {
  writeEvidence({
    schemaVersion: 1,
    decision: {
      outcome: "no-go",
      reasonCodes: ["phase0-runner-crashed"],
      productionImplementationAuthorized: false,
    },
    failure: { name: error?.name || "Error", message: String(error?.message || error) },
  }, 1).catch(() => app.exit(1));
});
