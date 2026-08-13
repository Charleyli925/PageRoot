import { createHash, randomBytes } from "node:crypto";

import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_RUNTIME_FROZEN_ATTRIBUTE,
  EDIT_RUNTIME_RESULT_ATTRIBUTE,
  EDIT_RUNTIME_PROTOCOL_SCHEME,
  isEditRuntimeRequestId,
  isEditRuntimeSessionId,
  isEditRuntimeSourceSha256,
} from "../app/domain/edit-runtime-contract.js";
import { validateEditRuntimeHostBindings } from "./edit-runtime-protocol.mjs";

const EDIT_RUNTIME_PROBE_WORLD_ID = 91_118;
const EDIT_RUNTIME_PROBE_PARTITION_PREFIX = "pageroot-edit-runtime-probe-";
const OWNER_CLEANUP_GRACE_MS = 250;
const PROBE_REQUEST_KEYS = new Set([
  "contractVersion",
  "requestId",
  "sourceSha256",
  "html",
  "hosts",
  "canvasGeneration",
]);
const PROBE_HOST_KEYS = new Set([
  "key",
  "path",
  "tagName",
  "identityAttributes",
]);
const PROBE_RESULT_KEYS = new Set([
  "state",
  "reason",
  "hostKeys",
  "mutationRecords",
  "contractVersion",
  "executionId",
  "sessionId",
]);

class ProbeCancelledError extends Error {
  constructor() {
    super("Edit runtime probe was cancelled.");
  }
}

class ProbeTimedOutError extends Error {
  constructor() {
    super("Edit runtime probe timed out.");
  }
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function sourceSha256(html) {
  return `sha256:${createHash("sha256").update(html, "utf8").digest("hex")}`;
}

function outcome(outcomeValue, reason) {
  return Object.freeze({ outcome: outcomeValue, reason });
}

function validCanvasGeneration(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000;
}

function normalizeHosts(value) {
  if (!Array.isArray(value)) throw new TypeError("Edit runtime hosts are invalid.");
  if (value.some((host) => (
    !isRecord(host)
    || Object.keys(host).some((key) => !PROBE_HOST_KEYS.has(key))
  ))) {
    throw new TypeError("Edit runtime hosts are invalid.");
  }
  return validateEditRuntimeHostBindings(value);
}

function hostBindingKey(hosts) {
  return JSON.stringify(hosts.map((host) => ({
    key: host.key,
    path: host.path,
    tagName: host.tagName,
    identityAttributes: host.identityAttributes,
  })));
}

/**
 * Validates the sole trusted-renderer request. It deliberately excludes a
 * source path, raw script bytes, selectors, TargetRefs, screenshot data and
 * any result callback. Main binds the active local source path itself.
 */
export function validateEditRuntimeProbeRequest(value) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !PROBE_REQUEST_KEYS.has(key))
    || value.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
  ) throw new TypeError("Edit runtime probe request is invalid.");
  const html = typeof value.html === "string" ? value.html : null;
  const requestId = String(value.requestId || "");
  const sourceSha = String(value.sourceSha256 || "").toLowerCase();
  if (
    !html
    || Buffer.byteLength(html, "utf8") > EDIT_AUTHOR_RUNTIME_BUDGET.htmlBytes
    || !isEditRuntimeRequestId(requestId)
    || !isEditRuntimeSourceSha256(sourceSha)
    || sourceSha256(html) !== sourceSha
    || !validCanvasGeneration(value.canvasGeneration)
  ) throw new TypeError("Edit runtime probe source identity is invalid.");
  const hosts = normalizeHosts(value.hosts);
  return Object.freeze({
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    requestId,
    sourceSha256: sourceSha,
    html,
    hosts,
    canvasGeneration: value.canvasGeneration,
  });
}

function normalizedOwnerResult(value, probeSession, request) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !PROBE_RESULT_KEYS.has(key))
    || value.state !== "frozen"
    || value.reason !== null
    || value.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
    || value.executionId !== probeSession.probeExecutionId
    || value.sessionId !== probeSession.sessionId
    || !Number.isSafeInteger(value.mutationRecords)
    || value.mutationRecords < 0
    || value.mutationRecords > EDIT_AUTHOR_RUNTIME_BUDGET.mutationRecordCount
    || !Array.isArray(value.hostKeys)
    || value.hostKeys.length !== request.hosts.length
  ) return null;
  const expected = new Set(request.hosts.map((host) => host.key));
  const received = new Set();
  for (const key of value.hostKeys) {
    if (typeof key !== "string" || !expected.has(key) || received.has(key)) return null;
    received.add(key);
  }
  return Object.freeze({
    hostKeys: Object.freeze([...received].sort()),
    mutationRecords: value.mutationRecords,
  });
}

function rejectedOwnerResult(value, probeSession) {
  if (
    !isRecord(value)
    || Object.keys(value).some((key) => !PROBE_RESULT_KEYS.has(key))
    || value.state !== "rejected"
    || typeof value.reason !== "string"
    || value.reason.length > 160
    || value.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
    || value.executionId !== probeSession.probeExecutionId
    || value.sessionId !== probeSession.sessionId
  ) return null;
  return value.reason;
}

export function isolatedEditRuntimeResultScript() {
  return String.raw`(() => {
  "use strict";
  const root = document.documentElement;
  if (!root || root.getAttribute(${JSON.stringify(EDIT_RUNTIME_FROZEN_ATTRIBUTE)}) !== "true") {
    return null;
  }
  const serialized = root.getAttribute(${JSON.stringify(EDIT_RUNTIME_RESULT_ATTRIBUTE)});
  if (!serialized || serialized.length > 16384) return null;
  try {
    return JSON.parse(serialized);
  } catch {
    return null;
  }
})()`;
}

function configureIsolatedSession(session, expectedUrl) {
  session?.setPermissionRequestHandler?.((_webContents, _permission, callback) => {
    callback(false);
  });
  session?.setPermissionCheckHandler?.(() => false);
  session?.on?.("will-download", (event) => event.preventDefault());
  session?.webRequest?.onBeforeRequest?.((details, callback) => {
    let allowed = false;
    try {
      const expected = new URL(expectedUrl);
      const requested = new URL(details.url);
      // The hidden probe is allowed to resolve only this exact one-use
      // protocol session. The bootstrap itself later loads fixed bytes from
      // the same origin; no filesystem, HTTP(S), data/blob, navigation or
      // neighboring session can become an execution path.
      allowed = requested.protocol === `${EDIT_RUNTIME_PROTOCOL_SCHEME}:`
        && requested.hostname === expected.hostname;
    } catch {
      allowed = false;
    }
    callback({ cancel: !allowed });
  });
}

function ownerExecutor(webContents, source) {
  if (typeof webContents?.executeJavaScriptInIsolatedWorld !== "function") {
    throw new Error("Edit runtime probe requires isolated-world evaluation.");
  }
  return webContents.executeJavaScriptInIsolatedWorld(
    EDIT_RUNTIME_PROBE_WORLD_ID,
    [{ code: source, url: "pageroot-edit-runtime-owner.js" }],
    true,
    true,
  );
}

function waitForFirstOffscreenPaint(webContents) {
  if (typeof webContents?.once !== "function") return Promise.resolve();
  return new Promise((resolve) => webContents.once("paint", resolve));
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

function compatibleGrant(request, probeSession, hostKeys) {
  const permitted = new Set(hostKeys);
  return Object.freeze({
    outcome: "compatible",
    grant: Object.freeze({
      contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      sessionId: probeSession.sessionId,
      executionId: probeSession.directExecutionId,
      sourceSha256: request.sourceSha256,
      resourceSha256: probeSession.resourceSha256,
      scriptCount: probeSession.scriptCount,
      byteLength: probeSession.byteLength,
      canvasGeneration: request.canvasGeneration,
      hosts: Object.freeze(request.hosts.filter((host) => permitted.has(host.key))),
    }),
  });
}

/**
 * Main-process owner for the one-shot author runtime. A compatible answer
 * authorizes only a new direct Edit execution; it never returns the probe DOM
 * or a screenshot. Any uncertain result leaves the renderer on static Edit.
 */
export function createEditRuntimeProbeOwner({
  BrowserWindowClass,
  createSession,
  revokeSession,
  createIsolatedSession,
  releaseIsolatedSession = async () => {},
  ownerDeadlineMs = EDIT_AUTHOR_RUNTIME_BUDGET.ownerDeadlineMs,
  randomToken = () => randomBytes(12).toString("hex"),
  now = () => Date.now(),
} = {}) {
  if (typeof BrowserWindowClass !== "function") {
    throw new TypeError("Edit runtime probe requires BrowserWindow.");
  }
  if (typeof createSession !== "function" || typeof revokeSession !== "function") {
    throw new TypeError("Edit runtime probe requires protocol session ownership.");
  }
  if (typeof createIsolatedSession !== "function" || typeof releaseIsolatedSession !== "function") {
    throw new TypeError("Edit runtime probe requires isolated session ownership.");
  }
  const deadlineMs = Math.max(1, Math.min(
    EDIT_AUTHOR_RUNTIME_BUDGET.ownerDeadlineMs,
    Math.round(Number(ownerDeadlineMs)) || EDIT_AUTHOR_RUNTIME_BUDGET.ownerDeadlineMs,
  ));
  const activeProbes = new Map();
  const grants = new Set();
  const compatibilityCache = new Map();

  const clearExpiredCache = () => {
    const cutoff = now() - EDIT_AUTHOR_RUNTIME_BUDGET.cacheTtlMs;
    for (const [key, entry] of compatibilityCache) {
      if (entry.lastAccessedAt < cutoff) compatibilityCache.delete(key);
    }
  };
  const cacheKeyFor = (request, probeSession) => (
    [
      EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      request.sourceSha256,
      probeSession.resourceSha256,
      hostBindingKey(request.hosts),
    ].join("\u0000")
  );
  const rememberCompatibility = (key, ownerResult, byteLength) => {
    clearExpiredCache();
    compatibilityCache.delete(key);
    compatibilityCache.set(key, {
      hostKeys: ownerResult.hostKeys,
      byteLength,
      lastAccessedAt: now(),
    });
    let totalBytes = 0;
    for (const entry of compatibilityCache.values()) totalBytes += entry.byteLength;
    while (
      compatibilityCache.size > EDIT_AUTHOR_RUNTIME_BUDGET.cacheEntries
      || totalBytes > EDIT_AUTHOR_RUNTIME_BUDGET.cacheBytes
    ) {
      const oldestKey = compatibilityCache.keys().next().value;
      if (!oldestKey) break;
      totalBytes -= compatibilityCache.get(oldestKey)?.byteLength || 0;
      compatibilityCache.delete(oldestKey);
    }
  };

  const probe = async (rawRequest) => {
    let request;
    try {
      request = validateEditRuntimeProbeRequest(rawRequest);
    } catch {
      return outcome("failed", "invalid-request");
    }
    const operationKey = request.sourceSha256;
    activeProbes.get(operationKey)?.cancel("superseded");
    let probeWindow = null;
    let probeSession = null;
    let isolatedSession = null;
    let cancellationReason = null;
    let rejectCancelled = null;
    const cancelled = new Promise((_, reject) => {
      rejectCancelled = reject;
    });
    const operation = {
      sessionId: null,
      cancel: (reason = "cancelled") => {
        if (cancellationReason) return;
        cancellationReason = reason;
        if (probeWindow && !probeWindow.isDestroyed()) probeWindow.destroy();
        rejectCancelled?.(new ProbeCancelledError());
      },
    };
    activeProbes.set(operationKey, operation);
    const deadlineAt = now() + deadlineMs;
    const withDeadline = async (promise) => {
      const remaining = deadlineAt - now();
      if (remaining <= 0) {
        operation.cancel("timed-out");
        throw new ProbeTimedOutError();
      }
      let timeoutId = null;
      const timeout = new Promise((_, reject) => {
        timeoutId = setTimeout(() => {
          operation.cancel("timed-out");
          reject(new ProbeTimedOutError());
        }, remaining);
      });
      try {
        return await Promise.race([promise, cancelled, timeout]);
      } finally {
        if (timeoutId !== null) clearTimeout(timeoutId);
      }
    };
    let keepGrant = false;
    try {
      probeSession = await withDeadline(createSession({
        html: request.html,
        bindings: request.hosts,
        sourceSha256: request.sourceSha256,
      }));
      if (
        !probeSession
        || !isEditRuntimeSessionId(probeSession.sessionId)
        || typeof probeSession.probeUrl !== "string"
        || !probeSession.probeExecutionId
        || !probeSession.directExecutionId
        || !isEditRuntimeSourceSha256(probeSession.resourceSha256)
      ) return outcome("failed", "invalid-protocol-session");
      operation.sessionId = probeSession.sessionId;
      clearExpiredCache();
      const cacheKey = cacheKeyFor(request, probeSession);
      const cached = compatibilityCache.get(cacheKey);
      if (cached) {
        cached.lastAccessedAt = now();
        keepGrant = true;
        grants.add(probeSession.sessionId);
        return compatibleGrant(request, probeSession, cached.hostKeys);
      }
      const partition = `${EDIT_RUNTIME_PROBE_PARTITION_PREFIX}${randomToken()}`;
      isolatedSession = await withDeadline(createIsolatedSession(partition));
      if (!isolatedSession || typeof isolatedSession !== "object") {
        return outcome("failed", "invalid-isolated-session");
      }
      configureIsolatedSession(isolatedSession, probeSession.probeUrl);
      probeWindow = new BrowserWindowClass({
        show: false,
        frame: false,
        width: 1280,
        height: 900,
        useContentSize: true,
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
      probeWindow.webContents.setWindowOpenHandler?.(() => ({ action: "deny" }));
      probeWindow.webContents.on?.("will-attach-webview", (event) => event.preventDefault());
      probeWindow.webContents.on?.("will-navigate", (event, url) => {
        if (url !== probeSession.probeUrl) event.preventDefault();
      });
      const firstPaint = waitForFirstOffscreenPaint(probeWindow.webContents);
      await withDeadline(probeWindow.loadURL(probeSession.probeUrl));
      await withDeadline(firstPaint);
      let ownerResult = null;
      while (!ownerResult) {
        const rawResult = await withDeadline(ownerExecutor(
          probeWindow.webContents,
          isolatedEditRuntimeResultScript(),
        ));
        ownerResult = normalizedOwnerResult(rawResult, probeSession, request);
        if (ownerResult) break;
        const rejectedReason = rejectedOwnerResult(rawResult, probeSession);
        if (rejectedReason) return outcome("rejected", rejectedReason);
        await withDeadline(new Promise((resolve) => setTimeout(resolve, 16)));
      }
      rememberCompatibility(cacheKey, ownerResult, Number(probeSession.byteLength) || 0);
      keepGrant = true;
      grants.add(probeSession.sessionId);
      return compatibleGrant(request, probeSession, ownerResult.hostKeys);
    } catch (error) {
      if (error instanceof ProbeTimedOutError || cancellationReason === "timed-out") {
        return outcome("timed-out", "owner-deadline");
      }
      if (error instanceof ProbeCancelledError || cancellationReason) {
        return outcome("cancelled", cancellationReason || "cancelled");
      }
      return outcome("failed", "probe-failed");
    } finally {
      if (probeWindow && !probeWindow.isDestroyed()) probeWindow.destroy();
      await Promise.all([
        isolatedSession
          ? settleOwnerCleanup(() => releaseIsolatedSession(isolatedSession))
          : undefined,
        probeSession?.sessionId && !keepGrant
          ? settleOwnerCleanup(() => revokeSession(probeSession.sessionId))
          : undefined,
      ]);
      if (activeProbes.get(operationKey) === operation) activeProbes.delete(operationKey);
    }
  };

  const revoke = async (sessionId) => {
    if (!isEditRuntimeSessionId(sessionId)) return Object.freeze({ revoked: false });
    for (const operation of activeProbes.values()) {
      if (operation.sessionId === sessionId) operation.cancel("revoked");
    }
    grants.delete(sessionId);
    return revokeSession(sessionId);
  };

  return Object.freeze({
    probe,
    revoke,
    dispose: () => {
      activeProbes.forEach((operation) => operation.cancel("cancelled"));
      activeProbes.clear();
      compatibilityCache.clear();
      for (const sessionId of grants) void Promise.resolve(revokeSession(sessionId));
      grants.clear();
    },
    cacheSize: () => compatibilityCache.size,
  });
}
