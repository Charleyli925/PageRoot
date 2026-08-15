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
  return Object.freeze({
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    sessionId: String(value.sessionId).toLowerCase(),
    executionId: String(value.executionId).toLowerCase(),
    sourceSha256: request.sourceSha256,
    resourceSha256: String(value.resourceSha256).toLowerCase(),
    scriptCount: value.scriptCount,
    byteLength: value.byteLength,
    canvasGeneration: request.canvasGeneration,
    hosts: Object.freeze(hosts),
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
