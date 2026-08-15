import {
  EDIT_AUTHOR_RUNTIME_BUDGET,
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  collectEditRuntimeScripts,
  isEditRuntimeEchartsCandidate,
  isEditRuntimeSourceSha256,
} from "../domain/edit-runtime-contract.js";
import {
  resolveEditRuntimeHosts,
  runtimeSnapshotCaptureCandidate,
} from "../domain/runtime-snapshot-hosts.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function frozenSnapshot({
  phase = "static",
  sourceSha256 = null,
  sourcePath = null,
  canvasGeneration = null,
  grant = null,
  lastOutcome = null,
} = {}) {
  return Object.freeze({
    phase,
    sourceSha256: sourceSha256 ? String(sourceSha256) : null,
    sourcePath: sourcePath ? String(sourcePath) : null,
    canvasGeneration: Number.isSafeInteger(canvasGeneration) ? canvasGeneration : null,
    grant,
    lastOutcome,
  });
}

function normalizedRuntimeSourcePath(value) {
  const sourcePath = value ? String(value) : "";
  // macOS exposes the same temporary-file tree through both /var and
  // /private/var (and likewise /tmp). A renderer/Main round trip can switch
  // between those spellings without changing the actual source authority.
  if (sourcePath === "/private/var" || sourcePath.startsWith("/private/var/")) {
    return sourcePath.slice("/private".length);
  }
  if (sourcePath === "/private/tmp" || sourcePath.startsWith("/private/tmp/")) {
    return sourcePath.slice("/private".length);
  }
  return sourcePath;
}

function sameKey(left, right) {
  return Boolean(left)
    && Boolean(right)
    && left.sourcePath === right.sourcePath
    && left.canvasGeneration === right.canvasGeneration;
}

function base64ByteLength(value) {
  const text = String(value || "");
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(text)) {
    return null;
  }
  const padding = text.endsWith("==") ? 2 : text.endsWith("=") ? 1 : 0;
  return (text.length / 4) * 3 - padding;
}

function allowedRuntimeHostStyle(property, value) {
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
}

function normalizedSnapshots(value, expectedHosts) {
  if (
    !Array.isArray(value)
    || value.length < 1
    || value.length > expectedHosts.size
  ) return null;
  const seen = new Set();
  const snapshots = [];
  let aggregateBytes = 0;
  let aggregatePixels = 0;
  for (const snapshot of value) {
    if (
      !isRecord(snapshot)
      || typeof snapshot.key !== "string"
      || !expectedHosts.has(snapshot.key)
      || seen.has(snapshot.key)
      || !/^sha256:[a-f0-9]{64}$/u.test(String(snapshot.pngSha256 || "").toLowerCase())
      || !Number.isSafeInteger(snapshot.width)
      || !Number.isSafeInteger(snapshot.height)
      || !Number.isSafeInteger(snapshot.byteLength)
      || !Number.isSafeInteger(snapshot.layoutWidth)
      || !Number.isSafeInteger(snapshot.layoutHeight)
      || typeof snapshot.pngBase64 !== "string"
      || snapshot.width < 1
      || snapshot.height < 1
      || snapshot.layoutWidth < 1
      || snapshot.layoutHeight < 1
      || snapshot.width > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotDimension
      || snapshot.height > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotDimension
      || snapshot.layoutWidth > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotDimension
      || snapshot.layoutHeight > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotDimension
      || snapshot.width * snapshot.height > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotPixels
      || snapshot.layoutWidth * snapshot.layoutHeight > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotPixels
      || snapshot.byteLength < 24
      || snapshot.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotBytes
      || base64ByteLength(snapshot.pngBase64) !== snapshot.byteLength
      || !Array.isArray(snapshot.styles)
      || snapshot.styles.length > 4
    ) return null;
    const styles = [];
    const styleNames = new Set();
    for (const pair of snapshot.styles) {
      if (
        !Array.isArray(pair)
        || pair.length !== 2
        || typeof pair[0] !== "string"
        || typeof pair[1] !== "string"
        || styleNames.has(pair[0])
        || !allowedRuntimeHostStyle(pair[0], pair[1])
      ) return null;
      styleNames.add(pair[0]);
      styles.push(Object.freeze([pair[0], pair[1]]));
    }
    aggregateBytes += snapshot.byteLength;
    if (aggregateBytes > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotAggregateBytes) return null;
    aggregatePixels += snapshot.width * snapshot.height;
    if (aggregatePixels > EDIT_AUTHOR_RUNTIME_BUDGET.snapshotAggregatePixels) return null;
    seen.add(snapshot.key);
    snapshots.push(Object.freeze({
      key: snapshot.key,
      pngSha256: String(snapshot.pngSha256).toLowerCase(),
      width: snapshot.width,
      height: snapshot.height,
      byteLength: snapshot.byteLength,
      pngBase64: snapshot.pngBase64,
      layoutWidth: snapshot.layoutWidth,
      layoutHeight: snapshot.layoutHeight,
      styles: Object.freeze(styles),
    }));
  }
  return Object.freeze(snapshots);
}

function normalizedGrant(value, request) {
  if (
    !isRecord(value)
    || value.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
    || !/^[a-f0-9]{32}$/u.test(String(value.sessionId || ""))
    || !/^[a-f0-9]{24}$/u.test(String(value.executionId || ""))
    || String(value.sourceSha256 || "").toLowerCase() !== request.sourceSha256
    || !isEditRuntimeSourceSha256(value.resourceSha256)
    || !Number.isSafeInteger(value.scriptCount)
    || value.scriptCount < 1
    || value.scriptCount > EDIT_AUTHOR_RUNTIME_BUDGET.scriptCount
    || !Number.isSafeInteger(value.byteLength)
    || value.byteLength < 1
    || value.byteLength > EDIT_AUTHOR_RUNTIME_BUDGET.aggregateScriptBytes
    || value.bootstrapCount !== 1
    || value.canvasGeneration !== request.canvasGeneration
    || !Array.isArray(value.hosts)
  ) return null;
  const expected = new Map(request.hosts.map((host) => [host.key, host]));
  const hosts = [];
  for (const host of value.hosts) {
    if (!isRecord(host) || typeof host.key !== "string") return null;
    const expectedHost = expected.get(host.key);
    if (
      !expectedHost
      || hosts.some((candidate) => candidate.key === host.key)
      || JSON.stringify(host.path) !== JSON.stringify(expectedHost.path)
      || host.tagName !== expectedHost.tagName
      || JSON.stringify(host.identityAttributes) !== JSON.stringify(expectedHost.identityAttributes)
    ) return null;
    hosts.push(expectedHost);
  }
  if (hosts.length !== request.hosts.length) return null;
  const snapshots = normalizedSnapshots(value.snapshots, expected);
  if (!snapshots) return null;
  return Object.freeze({
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    sessionId: String(value.sessionId).toLowerCase(),
    executionId: String(value.executionId).toLowerCase(),
    sourceSha256: request.sourceSha256,
    resourceSha256: String(value.resourceSha256).toLowerCase(),
    scriptCount: value.scriptCount,
    byteLength: value.byteLength,
    bootstrapCount: 1,
    canvasGeneration: request.canvasGeneration,
    hosts: Object.freeze(hosts),
    snapshots,
  });
}

/**
 * The sole application owner for Edit author-runtime state. Its key is exactly
 * (sourcePath, canvasGeneration): ordinary source revisions, autosaves, and
 * comments intentionally cannot start another preparation in the same canvas.
 */
export class EditAuthorRuntimeSession {
  #port;
  #listeners = new Set();
  #snapshot = frozenSnapshot();
  #identity = null;
  #pendingPreparation = null;
  #attemptGeneration = 0;
  #requestSequence = 0;
  #disposed = false;

  constructor({ port = null } = {}) {
    if (
      port !== null
      && (!isRecord(port) || typeof port.prepare !== "function" || typeof port.revoke !== "function")
    ) {
      throw new TypeError("EditAuthorRuntimeSession requires a narrow prepare/revoke port.");
    }
    this.#port = port;
  }

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") {
      throw new TypeError("EditAuthorRuntimeSession listener must be a function.");
    }
    this.#listeners.add(listener);
    listener(this.#snapshot);
    return () => this.#listeners.delete(listener);
  }

  #emit(next) {
    this.#snapshot = frozenSnapshot(next);
    for (const listener of this.#listeners) {
      try {
        listener(this.#snapshot);
      } catch {
        // View listeners observe state but cannot influence its lifecycle.
      }
    }
  }

  #revoke(grant) {
    if (!grant?.sessionId || !this.#port) return;
    void Promise.resolve(this.#port.revoke(grant.sessionId)).catch(() => undefined);
  }

  #transitionToStatic(phase, lastOutcome, identity = this.#identity) {
    this.#pendingPreparation = null;
    this.#revoke(this.#snapshot.grant);
    this.#emit({
      phase,
      sourceSha256: identity?.sourceSha256 || null,
      sourcePath: identity?.sourcePath || null,
      canvasGeneration: identity?.canvasGeneration ?? null,
      lastOutcome,
    });
  }

  #hostCandidates(html) {
    const resolved = resolveEditRuntimeHosts({
      html,
      maximum: EDIT_AUTHOR_RUNTIME_BUDGET.hostCount,
    });
    if (!resolved?.hosts.length) return Object.freeze([]);
    const candidates = [];
    for (const host of resolved.hosts) {
      const candidate = runtimeSnapshotCaptureCandidate(
        "edit-runtime-" + String(candidates.length + 1),
        host,
      );
      if (!candidate) continue;
      candidates.push(Object.freeze({
        key: candidate.key,
        path: candidate.path,
        tagName: candidate.tagName,
        identityAttributes: candidate.identityAttributes,
      }));
      if (candidates.length >= EDIT_AUTHOR_RUNTIME_BUDGET.hostCount) break;
    }
    return Object.freeze(candidates);
  }

  refresh({
    html,
    sourceSha256,
    canvasGeneration,
    sourcePath,
    sourceIsAuthoritative = false,
  } = {}) {
    if (this.#disposed) return this.#snapshot;
    const normalizedSourceSha = String(sourceSha256 || "").toLowerCase();
    const normalizedSourcePath = normalizedRuntimeSourcePath(sourcePath);
    const identity = (
      typeof html === "string"
      && normalizedSourcePath
      && isEditRuntimeSourceSha256(normalizedSourceSha)
      && Number.isSafeInteger(canvasGeneration)
      && canvasGeneration >= 0
    ) ? Object.freeze({
      html,
      sourceSha256: normalizedSourceSha,
      sourcePath: normalizedSourcePath,
      canvasGeneration,
    }) : null;

    if (!identity) {
      if (this.#identity || this.#snapshot.phase !== "static") {
        this.#attemptGeneration += 1;
        this.#identity = null;
        this.#transitionToStatic("static", "invalid-source", null);
      }
      return this.#snapshot;
    }
    const authorityJustBecameAvailable = (
      sameKey(this.#identity, identity)
      && sourceIsAuthoritative
      && this.#snapshot.phase === "static"
      && this.#snapshot.lastOutcome === "source-not-authoritative"
    );
    // A non-authoritative source cannot consume the one attempt for this
    // canvas generation. It is only a precondition wait; the first matching
    // authoritative snapshot must still be able to prepare the final frame.
    if (sameKey(this.#identity, identity) && !authorityJustBecameAvailable) {
      return this.#snapshot;
    }

    this.#attemptGeneration += 1;
    this.#pendingPreparation = null;
    this.#revoke(this.#snapshot.grant);
    this.#identity = identity;
    const attemptGeneration = this.#attemptGeneration;
    if (!sourceIsAuthoritative) {
      this.#emit({
        phase: "static",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        lastOutcome: "source-not-authoritative",
      });
      return this.#snapshot;
    }
    const scriptContract = collectEditRuntimeScripts(identity.html);
    if (
      scriptContract.unsupportedReason
      || scriptContract.executableScripts.length < 1
      || scriptContract.executableScripts.length > EDIT_AUTHOR_RUNTIME_BUDGET.scriptCount
      || !isEditRuntimeEchartsCandidate(identity.html)
    ) {
      this.#emit({
        phase: "static",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        lastOutcome: "not-candidate",
      });
      return this.#snapshot;
    }
    const hosts = this.#hostCandidates(identity.html);
    if (!hosts.length || !this.#port) {
      this.#emit({
        phase: "static",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        lastOutcome: hosts.length ? "desktop-unavailable" : "no-approved-hosts",
      });
      return this.#snapshot;
    }

    const request = Object.freeze({
      contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      requestId: "edit-runtime-" + identity.sourceSha256.slice(-16)
        + "-" + String(++this.#requestSequence).toString(36),
      sourceSha256: identity.sourceSha256,
      html: identity.html,
      hosts,
      canvasGeneration: identity.canvasGeneration,
    });
    this.#pendingPreparation = Object.freeze({
      attemptGeneration,
      identity,
      request,
      started: false,
    });
    this.#emit({
      phase: "preparing",
      sourceSha256: identity.sourceSha256,
      sourcePath: identity.sourcePath,
      canvasGeneration: identity.canvasGeneration,
    });
    return this.#snapshot;
  }

  /**
   * The Workbench calls this only after the preparing snapshot has committed
   * its no-interaction loading surface. That presentation acknowledgement is
   * what prevents a fast main-process grant from racing a mounted static frame.
   */
  startPreparation({ sourceSha256, canvasGeneration } = {}) {
    const pending = this.#pendingPreparation;
    if (
      this.#disposed
      || !pending
      || pending.started
      || this.#snapshot.phase !== "preparing"
      || !sameKey(this.#identity, pending.identity)
      || pending.identity.sourceSha256 !== String(sourceSha256 || "").toLowerCase()
      || pending.identity.canvasGeneration !== canvasGeneration
    ) return false;
    this.#pendingPreparation = Object.freeze({ ...pending, started: true });
    const { attemptGeneration, identity, request } = pending;
    void Promise.resolve(this.#port.prepare(request)).then((result) => {
      if (
        this.#disposed
        || attemptGeneration !== this.#attemptGeneration
        || !sameKey(this.#identity, identity)
      ) {
        this.#revoke(result);
        return;
      }
      this.#pendingPreparation = null;
      const grant = normalizedGrant(result, request);
      if (!grant) {
        this.#transitionToStatic("static-fallback", "prepare-failed", identity);
        return;
      }
      this.#emit({
        phase: "ready",
        sourceSha256: identity.sourceSha256,
        sourcePath: identity.sourcePath,
        canvasGeneration: identity.canvasGeneration,
        grant,
      });
    }).catch(() => {
      if (
        this.#disposed
        || attemptGeneration !== this.#attemptGeneration
        || !sameKey(this.#identity, identity)
      ) return;
      this.#transitionToStatic("static-fallback", "prepare-failed", identity);
    });
    return true;
  }

  beginRuntime({ sessionId, sourceSha256, canvasGeneration } = {}) {
    const grant = this.#snapshot.grant;
    if (
      this.#snapshot.phase !== "ready"
      || !grant
      || grant.sessionId !== String(sessionId || "").toLowerCase()
      || grant.sourceSha256 !== String(sourceSha256 || "").toLowerCase()
      || grant.canvasGeneration !== canvasGeneration
    ) return false;
    this.#emit({
      phase: "running",
      sourceSha256: grant.sourceSha256,
      sourcePath: this.#identity?.sourcePath || null,
      canvasGeneration: grant.canvasGeneration,
      grant,
    });
    return true;
  }

  settleRuntime({ sessionId, sourceSha256, canvasGeneration, outcome } = {}) {
    const grant = this.#snapshot.grant;
    if (
      this.#snapshot.phase !== "running"
      || !grant
      || grant.sessionId !== String(sessionId || "").toLowerCase()
      || grant.sourceSha256 !== String(sourceSha256 || "").toLowerCase()
      || grant.canvasGeneration !== canvasGeneration
    ) return false;
    if (outcome === "ready") {
      this.#revoke(grant);
      this.#emit({
        phase: "settled",
        sourceSha256: grant.sourceSha256,
        sourcePath: this.#identity?.sourcePath || null,
        canvasGeneration: grant.canvasGeneration,
        grant,
        lastOutcome: "ready",
      });
      return true;
    }
    this.#transitionToStatic(
      "static-fallback",
      outcome === "rejected" ? "rejected" : "runtime-failed",
    );
    return true;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#attemptGeneration += 1;
    this.#revoke(this.#snapshot.grant);
    this.#identity = null;
    this.#pendingPreparation = null;
    this.#listeners.clear();
    this.#snapshot = frozenSnapshot();
  }
}
