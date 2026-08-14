import { createHash, randomBytes } from "node:crypto";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE,
  EDIT_RUNTIME_FROZEN_ATTRIBUTE,
  EDIT_RUNTIME_HOST_ATTRIBUTE,
  EDIT_RUNTIME_RESULT_ATTRIBUTE,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  isEditRuntimeExecutionId,
  isEditRuntimeSessionId,
} from "../app/domain/edit-runtime-contract.js";

const EDIT_RUNTIME_CAPTURE_WORLD_ID = 91_118;
const EDIT_RUNTIME_CAPTURE_PARTITION_PREFIX = "pageroot-edit-runtime-capture-";
const OWNER_CLEANUP_GRACE_MS = 250;
const PNG_SIGNATURE = Object.freeze([137, 80, 78, 71, 13, 10, 26, 10]);

class CaptureCancelledError extends Error {
  constructor() {
    super("Edit runtime capture was cancelled.");
  }
}

class CaptureTimedOutError extends Error {
  constructor() {
    super("Edit runtime capture timed out.");
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function validHostKey(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function validHostBinding(value, keys) {
  if (!isRecord(value) || !validHostKey(value.key) || keys.has(value.key)) return null;
  if (
    !Array.isArray(value.path)
    || value.path.length > 256
    || value.path.some((index) => (
      !Number.isSafeInteger(index) || index < 0 || index > 65_535
    ))
  ) return null;
  if (
    typeof value.tagName !== "string"
    || !/^[A-Za-z][A-Za-z0-9:-]{0,63}$/u.test(value.tagName)
    || !Array.isArray(value.identityAttributes)
    || value.identityAttributes.length < 1
    || value.identityAttributes.length > 8
  ) return null;
  const names = new Set();
  const identityAttributes = [];
  for (const pair of value.identityAttributes) {
    if (
      !Array.isArray(pair)
      || pair.length !== 2
      || typeof pair[0] !== "string"
      || !/^[A-Za-z_:][A-Za-z0-9:_.-]{0,127}$/u.test(pair[0])
      || typeof pair[1] !== "string"
      || pair[1].length > 2_048
      || names.has(pair[0].toLowerCase())
    ) return null;
    names.add(pair[0].toLowerCase());
    identityAttributes.push(Object.freeze([pair[0].toLowerCase(), pair[1]]));
  }
  keys.add(value.key);
  return Object.freeze({
    key: value.key,
    path: Object.freeze([...value.path]),
    tagName: value.tagName.toLowerCase(),
    identityAttributes: Object.freeze(identityAttributes),
  });
}

function normalizedBindings(value) {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > EDIT_AUTHOR_RUNTIME_BUDGET.hostCount
  ) return null;
  const keys = new Set();
  const bindings = value.map((binding) => validHostBinding(binding, keys));
  return bindings.some((binding) => binding === null)
    ? null
    : Object.freeze(bindings);
}

function expectedRuntimeUrl(value, sessionId) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === `${EDIT_RUNTIME_PROTOCOL_SCHEME}:`
      && url.hostname === sessionId
      && (url.pathname === "/index.html" || url.pathname === "/");
  } catch {
    return false;
  }
}

function result(outcome, reason) {
  return Object.freeze({ outcome, reason });
}

function pngSha256(value) {
  return "sha256:" + createHash("sha256").update(value).digest("hex");
}

function pngDescription(image) {
  if (!image || typeof image.isEmpty !== "function" || image.isEmpty()) return null;
  let png = null;
  try {
    png = image.toPNG?.();
  } catch {
    return null;
  }
  if (
    !(png instanceof Uint8Array)
    || png.byteLength < 24
  ) return null;
  if (!PNG_SIGNATURE.every((byte, index) => png[index] === byte)) return null;
  if (![73, 72, 68, 82].every((byte, index) => png[12 + index] === byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (width < 1 || height < 1) return null;
  return Object.freeze({
    bytes: new Uint8Array(png),
    width,
    height,
    byteLength: png.byteLength,
  });
}

function normalizedSnapshotPng(image, {
  maximumBytes = EDIT_AUTHOR_RUNTIME_BUDGET.snapshotBytes,
  maximumPixels = EDIT_AUTHOR_RUNTIME_BUDGET.snapshotPixels,
} = {}) {
  const description = pngDescription(image);
  if (!description) return null;
  if (
    description.byteLength > maximumBytes
    || Math.max(description.width, description.height) > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotDimension
    || description.width * description.height > maximumPixels
  ) return null;
  return Object.freeze({
    pngSha256: pngSha256(description.bytes),
    width: description.width,
    height: description.height,
    byteLength: description.byteLength,
    pngBase64: Buffer.from(description.bytes).toString("base64"),
  });
}

function resizedSnapshotPng(image, {
  layoutWidth,
  layoutHeight,
  maximumBytes,
  maximumPixels,
} = {}) {
  const allowedBytes = Math.max(24, Math.min(
    EDIT_AUTHOR_RUNTIME_BUDGET.snapshotBytes,
    Math.floor(Number(maximumBytes) || 0),
  ));
  const allowedPixels = Math.max(1, Math.min(
    EDIT_AUTHOR_RUNTIME_BUDGET.snapshotPixels,
    Math.floor(Number(maximumPixels) || 0),
  ));
  if (
    !Number.isSafeInteger(layoutWidth)
    || !Number.isSafeInteger(layoutHeight)
    || layoutWidth < 1
    || layoutHeight < 1
  ) return null;
  let candidate = image;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const accepted = normalizedSnapshotPng(candidate, {
      maximumBytes: allowedBytes,
      maximumPixels: allowedPixels,
    });
    if (accepted) return accepted;
    const current = pngDescription(candidate);
    if (!current || typeof candidate?.resize !== "function") return null;
    const widthScale = Math.min(1, layoutWidth / current.width);
    const heightScale = Math.min(1, layoutHeight / current.height);
    const pixelScale = Math.min(1, Math.sqrt(
      allowedPixels / (current.width * current.height),
    ));
    const byteScale = Math.min(1, Math.sqrt(allowedBytes / current.byteLength));
    const scale = Math.min(widthScale, heightScale, pixelScale, byteScale, 0.9);
    const width = Math.max(1, Math.floor(current.width * scale));
    const height = Math.max(1, Math.floor(current.height * scale));
    if (width === current.width && height === current.height) return null;
    try {
      candidate = candidate.resize({ width, height, quality: "good" });
    } catch {
      return null;
    }
  }
  return null;
}

function safeScriptValue(value) {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

function snapshotProbeScript({ sessionId, executionId, binding }) {
  return String.raw`(() => {
  "use strict";
  const expected = ${safeScriptValue({
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    sessionId,
    executionId,
    binding,
  })};
  const frozenAttribute = ${safeScriptValue(EDIT_RUNTIME_FROZEN_ATTRIBUTE)};
  const resultAttribute = ${safeScriptValue(EDIT_RUNTIME_RESULT_ATTRIBUTE)};
  const hostAttribute = ${safeScriptValue(EDIT_RUNTIME_HOST_ATTRIBUTE)};
  const bootstrapAttribute = ${safeScriptValue(EDIT_RUNTIME_BOOTSTRAP_ATTRIBUTE)};
  const root = document.documentElement;
  if (!root || root.getAttribute(frozenAttribute) !== "true") {
    return { state: "pending" };
  }
  let runtimeResult = null;
  try {
    runtimeResult = JSON.parse(root.getAttribute(resultAttribute) || "null");
  } catch {
    return { state: "invalid" };
  }
  if (
    !runtimeResult
    || runtimeResult.state !== "frozen"
    || runtimeResult.reason !== null
    || runtimeResult.contractVersion !== expected.contractVersion
    || runtimeResult.sessionId !== expected.sessionId
    || runtimeResult.executionId !== expected.executionId
    || document.querySelectorAll("[" + bootstrapAttribute + "]").length !== 1
  ) return { state: "rejected" };
  const allowedStyle = (property, value, priority) => {
    if (priority) return false;
    const normalized = String(value || "").trim().toLowerCase();
    if (property === "position") return normalized === "relative";
    if (property === "user-select") return normalized === "none";
    if (property === "-webkit-tap-highlight-color") {
      return /^rgba\(\s*0\s*,\s*0\s*,\s*0\s*,\s*0\s*\)$/u.test(normalized);
    }
    if (property !== "transform") return false;
    const match = /^scale\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)$/u.exec(String(value || ""));
    if (!match) return false;
    const scale = Number(match[1]);
    return Number.isFinite(scale) && scale > 0 && scale <= 1;
  };
  if (!Array.isArray(runtimeResult.hostKeys) || !runtimeResult.hostKeys.includes(expected.binding.key)) {
    return { state: "rejected" };
  }
  const host = document.querySelector("[" + hostAttribute + "=" + expected.binding.key + "]");
  if (!(host instanceof Element)) return { state: "frozen", snapshot: null };
  try { host.scrollIntoView({ block: "center", inline: "nearest" }); } catch {}
  const rect = host.getBoundingClientRect();
  const x = Math.floor(rect.x);
  const y = Math.floor(rect.y);
  const width = Math.max(1, Math.ceil(rect.width));
  const height = Math.max(1, Math.ceil(rect.height));
  if (
    !Number.isFinite(x)
    || !Number.isFinite(y)
    || !Number.isFinite(width)
    || !Number.isFinite(height)
    || x < 0
    || y < 0
    || x + width > window.innerWidth
    || y + height > window.innerHeight
  ) return { state: "frozen", snapshot: null };
  const hasVisiblePaint = Array.from(host.querySelectorAll("canvas,svg")).some((element) => {
    const paintRect = element.getBoundingClientRect();
    return Number.isFinite(paintRect.width)
      && Number.isFinite(paintRect.height)
      && paintRect.width >= 1
      && paintRect.height >= 1;
  });
  if (!hasVisiblePaint) return { state: "frozen", snapshot: null };
  const styles = [];
  for (const property of [
    "position",
    "user-select",
    "-webkit-tap-highlight-color",
    "transform",
  ]) {
    const value = host.style.getPropertyValue(property);
    const priority = host.style.getPropertyPriority(property);
    if (allowedStyle(property, value, priority)) styles.push([property, value]);
  }
  return { state: "frozen", snapshot: {
    key: expected.binding.key,
    rect: { x, y, width, height },
    styles,
  } };
})()`;
}

function normalizedProbe(value, binding, viewport) {
  if (!isRecord(value) || typeof value.state !== "string") return null;
  if (value.state === "pending" || value.state === "rejected" || value.state === "invalid") {
    return Object.freeze({ state: value.state, snapshot: null });
  }
  if (value.state !== "frozen") return null;
  if (value.snapshot === null) return Object.freeze({ state: "frozen", snapshot: null });
  const snapshot = value.snapshot;
  if (!isRecord(snapshot) || snapshot.key !== binding.key) return null;
  const rect = snapshot.rect;
  if (
    !isRecord(rect)
    || !Number.isSafeInteger(rect.x)
    || !Number.isSafeInteger(rect.y)
    || !Number.isSafeInteger(rect.width)
    || !Number.isSafeInteger(rect.height)
    || rect.x < 0
    || rect.y < 0
    || rect.width < 1
    || rect.height < 1
    || rect.x + rect.width > viewport.width
    || rect.y + rect.height > viewport.height
    || rect.width * rect.height > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotPixels
  ) return null;
  if (!Array.isArray(snapshot.styles) || snapshot.styles.length > 4) return null;
  const styles = [];
  const styleNames = new Set();
  for (const pair of snapshot.styles) {
    if (
      !Array.isArray(pair)
      || pair.length !== 2
      || typeof pair[0] !== "string"
      || typeof pair[1] !== "string"
      || pair[0].length > 64
      || pair[1].length > 128
      || styleNames.has(pair[0])
    ) return null;
    styleNames.add(pair[0]);
    styles.push(Object.freeze([pair[0], pair[1]]));
  }
  return Object.freeze({
    state: "frozen",
    snapshot: Object.freeze({
      key: snapshot.key,
      rect: Object.freeze({ ...rect }),
      styles: Object.freeze(styles),
    }),
  });
}

function configureIsolatedSession(session, expectedUrl) {
  session?.setPermissionRequestHandler?.((_webContents, _permission, callback) => {
    callback(false);
  });
  session?.setPermissionCheckHandler?.(() => false);
  session?.on?.("will-download", (event) => {
    event.preventDefault();
  });
  session?.webRequest?.onBeforeRequest?.((details, callback) => {
    let allowed = false;
    try {
      const expected = new URL(expectedUrl);
      const requested = new URL(details.url);
      allowed = (
        requested.protocol === `${EDIT_RUNTIME_PROTOCOL_SCHEME}:`
        && requested.hostname === expected.hostname
      ) || requested.protocol === "data:" || requested.protocol === "blob:";
    } catch {
      allowed = false;
    }
    callback({ cancel: !allowed });
  });
}

function waitForFirstOffscreenPaint(webContents) {
  if (typeof webContents?.once !== "function") return Promise.resolve();
  return new Promise((resolve) => {
    webContents.once("paint", () => resolve());
  });
}

async function settleOwnerCleanup(cleanup) {
  let timeoutId = null;
  const completed = Promise.resolve().then(cleanup).catch(() => undefined);
  const grace = new Promise((resolve) => {
    timeoutId = setTimeout(resolve, OWNER_CLEANUP_GRACE_MS);
  });
  try {
    await Promise.race([completed, grace]);
  } finally {
    if (timeoutId !== null) clearTimeout(timeoutId);
  }
}

function ownerExecutor(webContents, source) {
  if (typeof webContents?.executeJavaScriptInIsolatedWorld !== "function") {
    throw new Error("Edit runtime capture requires isolated-world evaluation.");
  }
  return webContents.executeJavaScriptInIsolatedWorld(
    EDIT_RUNTIME_CAPTURE_WORLD_ID,
    [{ code: source, url: "pageroot-edit-runtime-capture-owner.js" }],
    true,
    true,
  );
}

/**
 * Executes one already-authorized ECharts resource closure in a disposable,
 * opaque BrowserWindow and returns only bounded raster display artifacts. The
 * visible Edit iframe never receives author-script authority.
 */
export function createEditRuntimeCaptureController({
  BrowserWindowClass,
  createIsolatedSession,
  installProtocol,
  releaseIsolatedSession = async () => {},
  resolveRuntimeUrl,
  ownerDeadlineMs = EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs,
  randomToken = () => randomBytes(12).toString("hex"),
} = {}) {
  if (typeof BrowserWindowClass !== "function") {
    throw new TypeError("Edit runtime capture requires BrowserWindow.");
  }
  if (typeof createIsolatedSession !== "function" || typeof installProtocol !== "function") {
    throw new TypeError("Edit runtime capture requires isolated session ownership.");
  }
  if (typeof releaseIsolatedSession !== "function" || typeof resolveRuntimeUrl !== "function") {
    throw new TypeError("Edit runtime capture requires resource closure ownership.");
  }
  const deadlineMs = Math.max(1, Math.min(
    EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs,
    Math.round(Number(ownerDeadlineMs)) || EDIT_AUTHOR_RUNTIME_BUDGET.runtimeDeadlineMs,
  ));
  const activeCaptures = new Map();

  const capture = async ({ sessionId: rawSessionId, executionId: rawExecutionId, bindings: rawBindings } = {}) => {
    const sessionId = String(rawSessionId || "").toLowerCase();
    const executionId = String(rawExecutionId || "").toLowerCase();
    const bindings = normalizedBindings(rawBindings);
    if (!isEditRuntimeSessionId(sessionId) || !isEditRuntimeExecutionId(executionId) || !bindings) {
      return result("failed", "invalid-request");
    }
    const runtimeUrl = resolveRuntimeUrl(sessionId);
    if (!expectedRuntimeUrl(runtimeUrl, sessionId)) return result("failed", "unknown-session");
    const operationKey = `${sessionId}:${executionId}`;
    activeCaptures.get(operationKey)?.cancel("superseded");

    let captureWindow = null;
    let isolatedSession = null;
    let cancellationReason = null;
    let rejectCancelled = null;
    const cancelled = new Promise((_, reject) => {
      rejectCancelled = reject;
    });
    const operation = {
      cancel: (reason = "cancelled") => {
        if (cancellationReason) return;
        cancellationReason = reason;
        if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
        rejectCancelled?.(new CaptureCancelledError());
      },
    };
    activeCaptures.set(operationKey, operation);
    const deadlineAt = Date.now() + deadlineMs;
    const withOwnerDeadline = async (promise) => {
      const remaining = deadlineAt - Date.now();
      if (remaining <= 0) {
        operation.cancel("timed-out");
        throw new CaptureTimedOutError();
      }
      let timeoutId = null;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          operation.cancel("timed-out");
          reject(new CaptureTimedOutError());
        }, remaining);
      });
      try {
        return await Promise.race([promise, cancelled, timeout]);
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }
    };
    const viewport = Object.freeze({ width: 1_440, height: 2_400 });

    try {
      const partition = `${EDIT_RUNTIME_CAPTURE_PARTITION_PREFIX}${randomToken()}`;
      isolatedSession = await withOwnerDeadline(createIsolatedSession(partition));
      if (!isolatedSession || typeof isolatedSession !== "object") {
        return result("failed", "invalid-isolated-session");
      }
      installProtocol(isolatedSession.protocol);
      configureIsolatedSession(isolatedSession, runtimeUrl);
      captureWindow = new BrowserWindowClass({
        show: false,
        frame: false,
        useContentSize: true,
        width: viewport.width,
        height: viewport.height,
        paintWhenInitiallyHidden: true,
        webPreferences: {
          partition,
          session: isolatedSession,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
          offscreen: true,
          backgroundThrottling: false,
        },
      });
      captureWindow.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
      captureWindow.webContents.on?.("will-attach-webview", (event) => event.preventDefault());
      captureWindow.webContents.on?.("will-navigate", (event, url) => {
        if (url !== runtimeUrl) event.preventDefault();
      });
      captureWindow.webContents.on?.("will-frame-navigate", (event, url) => {
        if (url !== runtimeUrl) event.preventDefault();
      });
      const firstPaint = waitForFirstOffscreenPaint(captureWindow.webContents);
      await withOwnerDeadline(captureWindow.loadURL(runtimeUrl));
      await withOwnerDeadline(firstPaint);
      if (cancellationReason || captureWindow.isDestroyed()) throw new CaptureCancelledError();

      let probe = null;
      const readinessBinding = bindings[0];
      while (!probe || probe.state === "pending") {
        const rawProbe = await withOwnerDeadline(ownerExecutor(
          captureWindow.webContents,
          snapshotProbeScript({ sessionId, executionId, binding: readinessBinding }),
        ));
        probe = normalizedProbe(rawProbe, readinessBinding, viewport);
        if (!probe || probe.state === "invalid" || probe.state === "rejected") {
          return result("failed", "runtime-rejected");
        }
        if (probe.state === "pending") {
          await withOwnerDeadline(new Promise((resolve) => setTimeout(resolve, 25)));
        }
      }
      let aggregateBytes = 0;
      let aggregatePixels = 0;
      const snapshots = [];
      for (let bindingIndex = 0; bindingIndex < bindings.length; bindingIndex += 1) {
        const binding = bindings[bindingIndex];
        const rawProbe = await withOwnerDeadline(ownerExecutor(
          captureWindow.webContents,
          snapshotProbeScript({ sessionId, executionId, binding }),
        ));
        const snapshotProbe = normalizedProbe(rawProbe, binding, viewport);
        if (!snapshotProbe || snapshotProbe.state !== "frozen") {
          return result("failed", "runtime-rejected");
        }
        const probeSnapshot = snapshotProbe.snapshot;
        if (!probeSnapshot) continue;
        const image = await withOwnerDeadline(captureWindow.capturePage(
          probeSnapshot.rect,
          { stayHidden: true },
        ));
        // capturePage uses device pixels while the visible static <img> is
        // rendered at the host's CSS layout dimensions. Retain no invisible
        // HiDPI surplus, then reserve an equal share of the fixed aggregate
        // cap for the remaining approved hosts. This keeps every approved
        // chart visible without relaxing any byte or pixel authority limit.
        const remainingHostCount = bindings.length - bindingIndex;
        const png = resizedSnapshotPng(image, {
          layoutWidth: probeSnapshot.rect.width,
          layoutHeight: probeSnapshot.rect.height,
          maximumBytes: Math.floor(
            (EDIT_AUTHOR_RUNTIME_BUDGET.snapshotAggregateBytes - aggregateBytes)
              / remainingHostCount,
          ),
          maximumPixels: Math.floor(
            (EDIT_AUTHOR_RUNTIME_BUDGET.snapshotAggregatePixels - aggregatePixels)
              / remainingHostCount,
          ),
        });
        if (
          !png
          || aggregateBytes + png.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotAggregateBytes
          || aggregatePixels + png.width * png.height
            > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotAggregatePixels
        ) {
          return result("failed", "snapshot-budget");
        }
        aggregateBytes += png.byteLength;
        aggregatePixels += png.width * png.height;
        snapshots.push(Object.freeze({
          key: probeSnapshot.key,
          layoutWidth: probeSnapshot.rect.width,
          layoutHeight: probeSnapshot.rect.height,
          styles: probeSnapshot.styles,
          ...png,
        }));
      }
      if (!snapshots.length) return result("failed", "no-visible-host");
      return Object.freeze({
        outcome: "captured",
        // The probe only accepts the terminal document when precisely one
        // fixed bootstrap is present. Preserve that fact with the frozen
        // display grant so the visible static canvas can expose auditable
        // one-shot completion without receiving executable runtime markup.
        bootstrapCount: 1,
        snapshots: Object.freeze(snapshots),
      });
    } catch (error) {
      if (error instanceof CaptureTimedOutError || cancellationReason === "timed-out") {
        return result("timed-out", "owner-deadline");
      }
      if (error instanceof CaptureCancelledError || cancellationReason) {
        return result("cancelled", cancellationReason || "cancelled");
      }
      return result("failed", "capture-failed");
    } finally {
      if (captureWindow && !captureWindow.isDestroyed()) captureWindow.destroy();
      if (isolatedSession) {
        await settleOwnerCleanup(() => releaseIsolatedSession(isolatedSession));
      }
      if (activeCaptures.get(operationKey) === operation) activeCaptures.delete(operationKey);
    }
  };

  return Object.freeze({
    capture,
    dispose: () => {
      activeCaptures.forEach((operation) => operation.cancel("cancelled"));
      activeCaptures.clear();
    },
  });
}
