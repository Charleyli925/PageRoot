import { createHash, randomBytes } from "node:crypto";
import { parse as parseHtml } from "parse5";

import {
  RUNTIME_VISUAL_CONTRACT,
  RUNTIME_VISUAL_CONTRACT_VERSION,
  isRuntimeVisualSessionIdentity,
  isRuntimeVisualSourceSha256,
} from "../app/domain/runtime-visual-contract.js";

const RUNTIME_SNAPSHOT_CAPTURE_WORLD_ID = 91_117;
const RUNTIME_SNAPSHOT_CAPTURE_PARTITION_PREFIX = "pageroot-runtime-snapshot-";
const MAX_VIEWPORT_WIDTH = 4_096;
const MAX_VIEWPORT_HEIGHT = 2_400;
const MIN_VIEWPORT_WIDTH = 320;
const MIN_VIEWPORT_HEIGHT = 320;
const MAX_PATH_DEPTH = 256;
const MAX_IDENTITY_VALUE_LENGTH = 2_048;
const MAX_PNG_BYTES = 2_000_000;
const MAX_PNG_DIMENSION = 4_096;
const OWNER_CLEANUP_GRACE_MS = 250;
const CAPTURE_REQUEST_KEYS = new Set([
  "contractVersion",
  "captureSessionId",
  "sourceSha256",
  "side",
  "html",
  "candidates",
  "viewport",
]);
const CAPTURE_CANDIDATE_KEYS = new Set([
  "key",
  "path",
  "tagName",
  "kind",
  "identityAttributes",
]);
const OWNER_RECT_KEYS = new Set(["key", "state", "rect"]);
const RECT_KEYS = new Set(["x", "y", "width", "height"]);

class CaptureCancelledError extends Error {
  constructor() {
    super("Runtime snapshot capture was cancelled.");
  }
}

class CaptureTimedOutError extends Error {
  constructor() {
    super("Runtime snapshot capture timed out.");
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedInteger(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function normalizedString(value, maximum) {
  return typeof value === "string" && value.length <= maximum ? value : null;
}

function sourceSha256(value) {
  return `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function pngSha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function result(outcome, reason) {
  return Object.freeze({ outcome, reason });
}

function captureResult(request, snapshots) {
  return Object.freeze({
    outcome: "captured",
    envelope: Object.freeze({
      contractVersion: RUNTIME_VISUAL_CONTRACT_VERSION,
      sessionId: request.captureSessionId,
      sourceSha256: request.sourceSha256,
      runtimeVisualSnapshots: Object.freeze(snapshots),
    }),
  });
}

function safeScriptValue(value) {
  return JSON.stringify(value).replace(/</gu, "\\u003c");
}

function validAttributeName(value) {
  return typeof value === "string"
    && /^[A-Za-z_:][A-Za-z0-9:_.-]{0,127}$/u.test(value)
    && !value.toLowerCase().startsWith("data-pageroot-");
}

function validCandidateKey(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function validTagName(value) {
  return typeof value === "string" && /^[A-Za-z][A-Za-z0-9:-]{0,63}$/u.test(value);
}

function validKind(value) {
  return value === "canvas" || value === "svg" || value === "host";
}

function normalizeIdentityAttributes(value) {
  if (
    !Array.isArray(value)
    || value.length > RUNTIME_VISUAL_CONTRACT.identityAttributeLimit
  ) return null;
  const names = new Set();
  const attributes = [];
  for (const item of value) {
    if (
      !Array.isArray(item)
      || item.length !== 2
      || !validAttributeName(item[0])
      || !normalizedString(item[1], MAX_IDENTITY_VALUE_LENGTH)
      || names.has(item[0])
    ) return null;
    names.add(item[0]);
    attributes.push(Object.freeze([item[0], item[1]]));
  }
  return Object.freeze(attributes);
}

function normalizeCandidate(value, keys) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !CAPTURE_CANDIDATE_KEYS.has(key))
  ) return null;
  const key = validCandidateKey(value.key) ? value.key : null;
  const tagName = validTagName(value.tagName) ? value.tagName : null;
  const kind = validKind(value.kind) ? value.kind : null;
  const identityAttributes = normalizeIdentityAttributes(value.identityAttributes);
  if (
    !key
    || keys.has(key)
    || !tagName
    || !kind
    || !identityAttributes
    || (kind === "canvas" && tagName.toLowerCase() !== "canvas")
    || (kind === "svg" && tagName.toLowerCase() !== "svg")
    || (kind === "host" && identityAttributes.length === 0)
    || !Array.isArray(value.path)
    || value.path.length > MAX_PATH_DEPTH
  ) return null;
  const path = value.path.map((index) => boundedInteger(index, 0, 65_535));
  if (path.some((index) => index === null)) return null;
  keys.add(key);
  return Object.freeze({
    key,
    path: Object.freeze(path),
    tagName,
    kind,
    identityAttributes,
  });
}

function elementChildren(node) {
  return (node?.childNodes || []).filter((child) => typeof child?.tagName === "string");
}

function staticHtmlElement(document) {
  return elementChildren(document).find((node) => node.tagName === "html") || null;
}

function staticTagMatches(element, tagName) {
  const sourceTag = String(element?.tagName || "");
  if (!sourceTag) return false;
  return element?.namespaceURI === "http://www.w3.org/1999/xhtml"
    ? sourceTag.toLowerCase() === tagName.toLowerCase()
    : sourceTag === tagName;
}

function staticAttribute(element, name) {
  const attributes = Array.isArray(element?.attrs) ? element.attrs : [];
  const exact = attributes.find((attribute) => attribute.name === name);
  if (exact) return String(exact.value ?? "");
  if (element?.namespaceURI !== "http://www.w3.org/1999/xhtml") return null;
  const normalized = name.toLowerCase();
  const htmlAttribute = attributes.find((attribute) => attribute.name.toLowerCase() === normalized);
  return htmlAttribute ? String(htmlAttribute.value ?? "") : null;
}

function staticSourceContentIsEmpty(node) {
  return (node?.childNodes || []).every((child) => {
    if (child?.nodeName === "#comment") return true;
    if (child?.nodeName === "#text") return !String(child.value || "").trim();
    return false;
  });
}

function staticMatchesBinding(element, candidate) {
  if (!staticTagMatches(element, candidate.tagName)) return false;
  if (candidate.kind === "host" && !staticSourceContentIsEmpty(element)) return false;
  return candidate.identityAttributes.every(([name, value]) => (
    staticAttribute(element, name) === value
  ));
}

function staticElements(root) {
  const elements = [];
  const visit = (node) => {
    if (!node || typeof node !== "object") return;
    if (typeof node.tagName === "string") elements.push(node);
    (node.childNodes || []).forEach(visit);
    if (node.content) visit(node.content);
  };
  visit(root);
  return elements;
}

function staticChildAtPath(root, path) {
  let element = root;
  for (const index of path) {
    element = elementChildren(element)[index] || null;
    if (!element) return null;
  }
  return element;
}

// Validate the source-backed binding before authored JavaScript runs. The path
// is the authority for direct Canvas/SVG roots. Source-empty hosts additionally
// require their stable source identity to be unique, rather than asking the
// runtime DOM to guess a replacement target.
function frozenSourceBindingKeys(request) {
  let document;
  try {
    document = parseHtml(request.html);
  } catch {
    return null;
  }
  const root = staticHtmlElement(document);
  if (!root) return null;
  const elements = staticElements(root);
  const keys = new Set();
  request.candidates.forEach((candidate) => {
    const bound = staticChildAtPath(root, candidate.path);
    if (!bound || !staticMatchesBinding(bound, candidate)) return;
    if (candidate.kind !== "host") {
      keys.add(candidate.key);
      return;
    }
    const matches = elements.filter((element) => staticMatchesBinding(element, candidate));
    if (matches.length === 1 && matches[0] === bound) keys.add(candidate.key);
  });
  return keys;
}

/**
 * Validates the only renderer-to-owner request. It deliberately excludes a
 * project path, TargetRef, comment IDs, binary data, and arbitrary scripts.
 */
export function validateRuntimeSnapshotCaptureRequest(value) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !CAPTURE_REQUEST_KEYS.has(key))
  ) {
    throw new TypeError("Runtime snapshot capture request is invalid.");
  }
  if (value.contractVersion !== RUNTIME_VISUAL_CONTRACT_VERSION) {
    throw new TypeError("Runtime snapshot capture contract version is invalid.");
  }
  const captureSessionId = String(value.captureSessionId || "");
  const sourceSha = String(value.sourceSha256 || "").toLowerCase();
  const html = typeof value.html === "string" ? value.html : null;
  if (
    !isRuntimeVisualSessionIdentity(captureSessionId)
    || !isRuntimeVisualSourceSha256(sourceSha)
    || !html
    || Buffer.byteLength(html, "utf8") > RUNTIME_VISUAL_CONTRACT.pageBudget.htmlBytes
    || sourceSha256(html) !== sourceSha
  ) {
    throw new TypeError("Runtime snapshot capture source identity is invalid.");
  }
  if (value.side !== "before" && value.side !== "after" && value.side !== "edit") {
    throw new TypeError("Runtime snapshot capture side is invalid.");
  }
  if (
    !isRecord(value.viewport)
    || Object.keys(value.viewport).some((key) => key !== "width" && key !== "height")
  ) {
    throw new TypeError("Runtime snapshot capture viewport is invalid.");
  }
  const width = boundedInteger(value.viewport.width, MIN_VIEWPORT_WIDTH, MAX_VIEWPORT_WIDTH);
  const height = boundedInteger(value.viewport.height, MIN_VIEWPORT_HEIGHT, MAX_VIEWPORT_HEIGHT);
  if (width === null || height === null) {
    throw new TypeError("Runtime snapshot capture viewport is invalid.");
  }
  if (
    !Array.isArray(value.candidates)
    || value.candidates.length > RUNTIME_VISUAL_CONTRACT.pageBudget.visualLimit
  ) {
    throw new TypeError("Runtime snapshot capture candidates are invalid.");
  }
  const keys = new Set();
  const candidates = value.candidates.map((candidate) => normalizeCandidate(candidate, keys));
  if (candidates.some((candidate) => candidate === null)) {
    throw new TypeError("Runtime snapshot capture candidate identity is invalid.");
  }
  return Object.freeze({
    contractVersion: RUNTIME_VISUAL_CONTRACT_VERSION,
    captureSessionId,
    sourceSha256: sourceSha,
    side: value.side,
    html,
    candidates: Object.freeze(candidates),
    viewport: Object.freeze({ width, height }),
  });
}

function isolatedSnapshotRectScript(candidate) {
  return String.raw`(() => {
  "use strict";
  const __pagerootRuntimeSnapshotRects = true;
  const candidate = ${safeScriptValue(candidate)};
  const queryElements = Function.prototype.call.bind(Element.prototype.querySelectorAll);
  const getAttribute = Function.prototype.call.bind(Element.prototype.getAttribute);
  const getRect = Function.prototype.call.bind(Element.prototype.getBoundingClientRect);
  const scrollIntoView = Function.prototype.call.bind(Element.prototype.scrollIntoView);
  const childAtPath = (path) => {
    let element = document.documentElement;
    for (const index of path) {
      element = element?.children?.[index] || null;
      if (!(element instanceof Element)) return null;
    }
    return element instanceof Element ? element : null;
  };
  const tagMatches = (element, tagName) => (
    element instanceof Element
    && String(element.tagName || "").toLowerCase() === String(tagName || "").toLowerCase()
  );
  const bindingMatches = (element, candidate) => (
    tagMatches(element, candidate.tagName)
    && candidate.identityAttributes.every(([name, value]) => getAttribute(element, name) === value)
  );
  const usableRect = (element) => {
    const rect = getRect(element);
    if (
      !Number.isFinite(rect.x)
      || !Number.isFinite(rect.y)
      || !Number.isFinite(rect.width)
      || !Number.isFinite(rect.height)
      || rect.width < 1
      || rect.height < 1
      || rect.x < 0
      || rect.y < 0
      || rect.x + rect.width > window.innerWidth
      || rect.y + rect.height > window.innerHeight
    ) return null;
    return {
      x: Math.floor(rect.x),
      y: Math.floor(rect.y),
      width: Math.max(1, Math.ceil(rect.width)),
      height: Math.max(1, Math.ceil(rect.height)),
    };
  };
  const unavailable = () => ({
    status: "captured",
    snapshots: [{ key: candidate.key, state: "unavailable", rect: null }],
  });
  const host = childAtPath(candidate.path);
  if (!bindingMatches(host, candidate)) return unavailable();
  try { scrollIntoView(host, { block: "center", inline: "nearest" }); } catch {
    return unavailable();
  }
  const hostRect = usableRect(host);
  const paintTargets = candidate.kind === "host"
    ? Array.from(queryElements(host, "canvas,svg"))
    : [host];
  const hasVisiblePaint = paintTargets.some((target) => usableRect(target) !== null);
  return {
    status: "captured",
    snapshots: [
      hostRect && hasVisiblePaint
        ? { key: candidate.key, state: "captured", rect: hostRect }
        : { key: candidate.key, state: "unavailable", rect: null },
    ],
  };
})()`;
}

function normalizedViewportRect(value, request) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !RECT_KEYS.has(key))
  ) return null;
  const rect = {
    x: boundedInteger(value.x, 0, request.viewport.width - 1),
    y: boundedInteger(value.y, 0, request.viewport.height - 1),
    width: boundedInteger(value.width, 1, request.viewport.width),
    height: boundedInteger(value.height, 1, request.viewport.height),
  };
  if (
    Object.values(rect).some((number) => number === null)
    || rect.x + rect.width > request.viewport.width
    || rect.y + rect.height > request.viewport.height
  ) return null;
  return Object.freeze(rect);
}

function normalizedOwnerRects(value, request) {
  if (
    !isRecord(value)
    || value.status !== "captured"
    || !Array.isArray(value.snapshots)
  ) return null;
  if (value.snapshots.length !== request.candidates.length) return null;
  const expectedKeys = new Set(request.candidates.map((candidate) => candidate.key));
  const seen = new Set();
  const snapshots = [];
  for (const rawSnapshot of value.snapshots) {
    if (
      !isRecord(rawSnapshot)
      || Object.keys(rawSnapshot).some((key) => !OWNER_RECT_KEYS.has(key))
      || !validCandidateKey(rawSnapshot.key)
      || !expectedKeys.has(rawSnapshot.key)
      || seen.has(rawSnapshot.key)
      || (rawSnapshot.state !== "captured" && rawSnapshot.state !== "unavailable")
    ) return null;
    const rect = rawSnapshot.state === "captured"
      ? normalizedViewportRect(rawSnapshot.rect, request)
      : rawSnapshot.rect === null ? null : undefined;
    if (rect === undefined || (rawSnapshot.state === "captured" && !rect)) return null;
    seen.add(rawSnapshot.key);
    snapshots.push(Object.freeze({
      key: rawSnapshot.key,
      state: rawSnapshot.state,
      rect,
    }));
  }
  return Object.freeze({ snapshots: Object.freeze(snapshots) });
}

function unavailableSnapshot(key) {
  return Object.freeze({
    key,
    state: "unavailable",
    pngSha256: "",
    width: 0,
    height: 0,
    byteLength: 0,
    pngBytes: new Uint8Array(),
  });
}

function validatedPng(image) {
  if (!image || typeof image.isEmpty !== "function" || image.isEmpty()) return null;
  const png = image.toPNG?.();
  if (!(png instanceof Uint8Array) || png.byteLength < 24 || png.byteLength > MAX_PNG_BYTES) {
    return null;
  }
  if (![137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => png[index] === byte)) {
    return null;
  }
  if (![73, 72, 68, 82].every((byte, index) => png[12 + index] === byte)) return null;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);
  if (
    width < 1
    || height < 1
    || width > MAX_PNG_DIMENSION
    || height > MAX_PNG_DIMENSION
    || width * height > RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels
  ) return null;
  const pngBytes = new Uint8Array(png);
  return Object.freeze({
    pngSha256: pngSha256(pngBytes),
    width,
    height,
    byteLength: pngBytes.byteLength,
    pngBytes,
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
      allowed = requested.protocol === "pageroot-preview:"
        && requested.hostname === expected.hostname;
    } catch {
      allowed = false;
    }
    callback({ cancel: !allowed });
  });
}

function ownerExecutor(webContents, source) {
  if (typeof webContents?.executeJavaScriptInIsolatedWorld !== "function") {
    throw new Error("Runtime snapshot capture requires isolated-world evaluation.");
  }
  return webContents.executeJavaScriptInIsolatedWorld(
    RUNTIME_SNAPSHOT_CAPTURE_WORLD_ID,
    [{ code: source, url: "pageroot-runtime-snapshot-owner.js" }],
    true,
    true,
  );
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

/**
 * One-use RuntimeSnapshotOwner. The authored page gets no Bridge, project
 * capability, comment data, or owner protocol; it can only affect a bounded
 * PNG presentation result that the trusted renderer may discard.
 */
export function createRuntimeSnapshotCaptureController({
  BrowserWindowClass,
  createSession,
  revokeSession,
  createIsolatedSession,
  releaseIsolatedSession = async () => {},
  ownerDeadlineMs = RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
  randomToken = () => randomBytes(12).toString("hex"),
} = {}) {
  if (typeof BrowserWindowClass !== "function") {
    throw new TypeError("Runtime snapshot capture requires BrowserWindow.");
  }
  if (typeof createSession !== "function" || typeof revokeSession !== "function") {
    throw new TypeError("Runtime snapshot capture requires preview session ownership.");
  }
  if (typeof createIsolatedSession !== "function") {
    throw new TypeError("Runtime snapshot capture requires an isolated session.");
  }
  if (typeof releaseIsolatedSession !== "function") {
    throw new TypeError("Runtime snapshot capture requires isolated session cleanup.");
  }
  const deadlineMs = Math.max(1, Math.min(
    RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
    Math.round(Number(ownerDeadlineMs)) || RUNTIME_VISUAL_CONTRACT.ownerDeadlineMs,
  ));
  const activeCaptures = new Map();

  const capture = async (rawRequest) => {
    let request;
    try {
      request = validateRuntimeSnapshotCaptureRequest(rawRequest);
    } catch {
      return result("failed", "invalid-request");
    }
    const frozenBindingKeys = frozenSourceBindingKeys(request);
    if (!frozenBindingKeys) {
      return result("failed", "frozen-source-unavailable");
    }
    const captureCandidates = request.candidates.filter((candidate) => (
      frozenBindingKeys.has(candidate.key)
    ));
    if (!captureCandidates.length) {
      return captureResult(
        request,
        request.candidates.map((candidate) => unavailableSnapshot(candidate.key)),
      );
    }
    const operationKey = `${request.captureSessionId}:${request.side}`;
    activeCaptures.get(operationKey)?.cancel("superseded");

    let captureWindow = null;
    let previewSession = null;
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

    try {
      previewSession = await withOwnerDeadline(createSession({
        html: request.html,
        bootstrapJavaScript: "",
      }));
      if (!previewSession?.sessionId || !previewSession?.url) {
        return result("failed", "invalid-preview-session");
      }
      const partition = `${RUNTIME_SNAPSHOT_CAPTURE_PARTITION_PREFIX}${randomToken()}`;
      isolatedSession = await withOwnerDeadline(createIsolatedSession(partition));
      if (!isolatedSession || typeof isolatedSession !== "object") {
        return result("failed", "invalid-isolated-session");
      }
      configureIsolatedSession(isolatedSession, previewSession.url);
      captureWindow = new BrowserWindowClass({
        show: false,
        frame: false,
        useContentSize: true,
        width: request.viewport.width,
        height: request.viewport.height,
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
      captureWindow.webContents.on?.("will-attach-webview", (event) => {
        event.preventDefault();
      });
      captureWindow.webContents.on?.("will-navigate", (event, url) => {
        if (url !== previewSession.url) event.preventDefault();
      });
      const firstPaint = waitForFirstOffscreenPaint(captureWindow.webContents);
      await withOwnerDeadline(captureWindow.loadURL(previewSession.url));
      await withOwnerDeadline(firstPaint);
      if (cancellationReason || captureWindow.isDestroyed()) throw new CaptureCancelledError();

      let capturedPixels = 0;
      let capturedBytes = 0;
      const snapshots = [];
      for (const candidate of request.candidates) {
        if (!frozenBindingKeys.has(candidate.key)) {
          snapshots.push(unavailableSnapshot(candidate.key));
          continue;
        }
        try {
          const remainingPixels = RUNTIME_VISUAL_CONTRACT.pageBudget.canvasPixels - capturedPixels;
          const remainingBytes = RUNTIME_VISUAL_CONTRACT.pageBudget.visualBytes - capturedBytes;
          if (remainingPixels < 1 || remainingBytes < 1) {
            snapshots.push(unavailableSnapshot(candidate.key));
            continue;
          }
          const ownerRequest = Object.freeze({
            ...request,
            candidates: Object.freeze([candidate]),
          });
          const ownerRects = normalizedOwnerRects(await withOwnerDeadline(ownerExecutor(
            captureWindow.webContents,
            isolatedSnapshotRectScript(candidate),
          )), ownerRequest);
          const ownerSnapshot = ownerRects?.snapshots[0];
          if (!ownerSnapshot || ownerSnapshot.state !== "captured" || !ownerSnapshot.rect) {
            snapshots.push(unavailableSnapshot(candidate.key));
            continue;
          }
          if (ownerSnapshot.rect.width * ownerSnapshot.rect.height > remainingPixels) {
            snapshots.push(unavailableSnapshot(candidate.key));
            continue;
          }
          const image = await withOwnerDeadline(captureWindow.capturePage(ownerSnapshot.rect, {
            stayHidden: true,
          }));
          const png = validatedPng(image);
          if (
            !png
            || png.width * png.height > remainingPixels
            || png.byteLength > remainingBytes
          ) {
            snapshots.push(unavailableSnapshot(candidate.key));
            continue;
          }
          capturedPixels += png.width * png.height;
          capturedBytes += png.byteLength;
          snapshots.push(Object.freeze({ key: candidate.key, state: "captured", ...png }));
        } catch (error) {
          if (error instanceof CaptureTimedOutError || error instanceof CaptureCancelledError) {
            throw error;
          }
          snapshots.push(unavailableSnapshot(candidate.key));
        }
      }
      return captureResult(request, snapshots);
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
      await Promise.all([
        isolatedSession
          ? settleOwnerCleanup(() => releaseIsolatedSession(isolatedSession))
          : undefined,
        previewSession?.sessionId
          ? settleOwnerCleanup(() => revokeSession(previewSession.sessionId))
          : undefined,
      ]);
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
