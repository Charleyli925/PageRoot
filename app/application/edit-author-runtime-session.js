import {
  EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
  EDIT_AUTHOR_RUNTIME_BUDGET,
  collectEditRuntimeScripts,
  isEditRuntimeEchartsCandidate,
  isEditRuntimeSourceSha256,
} from "../domain/edit-runtime-contract.js";
import {
  resolveRuntimeSnapshotHosts,
  runtimeSnapshotCaptureCandidate,
} from "../domain/runtime-snapshot-hosts.js";

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function frozenSnapshot({
  phase = "static",
  sourceSha256 = null,
  canvasGeneration = null,
  grant = null,
  lastOutcome = null,
} = {}) {
  return Object.freeze({
    phase,
    sourceSha256: sourceSha256 ? String(sourceSha256) : null,
    canvasGeneration: Number.isSafeInteger(canvasGeneration) ? canvasGeneration : null,
    grant,
    lastOutcome,
  });
}

function normalizedGrant(value, request) {
  if (
    !isRecord(value)
    || value.contractVersion !== EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION
    || typeof value.sessionId !== "string"
    || !/^[a-f0-9]{32}$/u.test(value.sessionId)
    || typeof value.executionId !== "string"
    || !/^[a-f0-9]{24}$/u.test(value.executionId)
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
    if (!expectedHost || hosts.some((candidate) => candidate.key === host.key)) return null;
    if (
      JSON.stringify(host.path) !== JSON.stringify(expectedHost.path)
      || host.tagName !== expectedHost.tagName
      || JSON.stringify(host.identityAttributes) !== JSON.stringify(expectedHost.identityAttributes)
    ) return null;
    hosts.push(expectedHost);
  }
  if (hosts.length !== request.hosts.length) return null;
  return Object.freeze({
    contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
    sessionId: value.sessionId,
    executionId: value.executionId,
    sourceSha256: request.sourceSha256,
    resourceSha256: String(value.resourceSha256).toLowerCase(),
    scriptCount: value.scriptCount,
    byteLength: value.byteLength,
    canvasGeneration: request.canvasGeneration,
    hosts: Object.freeze(hosts),
  });
}

function sameIdentity(left, right) {
  return Boolean(
    left
    && right
    && left.sourceSha256 === right.sourceSha256
    && left.canvasGeneration === right.canvasGeneration
    && left.sourcePath === right.sourcePath
    && left.html === right.html
  );
}

/**
 * Renderer-side owner for the author-runtime lifecycle. It owns only a
 * disposable authorization grant; it never receives, stores, serializes, or
 * publishes a runtime DOM. The Workbench may use its existing loading surface
 * while probing; a static Edit projection is the only fallback whenever this
 * Session cannot prove a fresh compatible grant.
 */
export class EditAuthorRuntimeSession {
  #port;

  #listeners = new Set();

  #snapshot = frozenSnapshot();

  #identity = null;

  #generation = 0;

  #requestSequence = 0;

  #disposed = false;

  constructor({ port = null } = {}) {
    if (
      port !== null
      && (!isRecord(port) || typeof port.probe !== "function" || typeof port.revoke !== "function")
    ) {
      throw new TypeError("EditAuthorRuntimeSession requires a narrow probe/revoke port.");
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
        // View listeners cannot influence the owner state machine.
      }
    }
  }

  #revoke(grant) {
    if (!grant?.sessionId || !this.#port) return;
    void Promise.resolve(this.#port.revoke(grant.sessionId)).catch(() => undefined);
  }

  #returnToStatic(lastOutcome = null) {
    const grant = this.#snapshot.grant;
    this.#revoke(grant);
    this.#emit({
      phase: "static",
      sourceSha256: this.#identity?.sourceSha256 || null,
      canvasGeneration: this.#identity?.canvasGeneration ?? null,
      lastOutcome,
    });
  }

  #hostCandidates(html) {
    const resolved = resolveRuntimeSnapshotHosts({
      beforeHtml: html,
      afterHtml: html,
      maximum: EDIT_AUTHOR_RUNTIME_BUDGET.hostCount,
    });
    if (!resolved) return [];
    const candidates = [];
    for (const pair of resolved.hosts) {
      // One-shot Edit deliberately accepts only the stable, source-empty host
      // variant. Direct Canvas/SVG roots belong to the Review raster path and
      // may not be a source-empty container for a new author execution.
      if (pair.before.kind !== "host") continue;
      const candidate = runtimeSnapshotCaptureCandidate(
        `edit-runtime-${candidates.length + 1}`,
        pair.before,
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
    const normalizedSourceSha = String(sourceSha256 || "").toLowerCase();
    const identity = (
      typeof html === "string"
      && typeof sourcePath === "string"
      && sourcePath
      && isEditRuntimeSourceSha256(normalizedSourceSha)
      && Number.isSafeInteger(canvasGeneration)
      && canvasGeneration >= 0
      && sourceIsAuthoritative === true
    ) ? Object.freeze({
      sourceSha256: normalizedSourceSha,
      canvasGeneration,
      sourcePath,
      html,
    }) : null;
    if (this.#disposed) return this.#snapshot;
    if (!identity) {
      this.#generation += 1;
      this.#identity = null;
      this.#returnToStatic(null);
      return this.#snapshot;
    }
    if (sameIdentity(this.#identity, identity)) return this.#snapshot;
    this.#generation += 1;
    this.#identity = identity;
    this.#returnToStatic(null);
    if (!this.#port) return this.#snapshot;
    const scriptContract = collectEditRuntimeScripts(identity.html);
    if (
      scriptContract.unsupportedReason
      || scriptContract.executableScripts.length < 1
      || scriptContract.executableScripts.length > EDIT_AUTHOR_RUNTIME_BUDGET.scriptCount
      || !isEditRuntimeEchartsCandidate(identity.html)
    ) return this.#snapshot;
    const hosts = this.#hostCandidates(identity.html);
    if (!hosts.length) return this.#snapshot;
    const generation = this.#generation;
    const requestId = `edit-runtime-${identity.sourceSha256.slice(-16)}-${(++this.#requestSequence).toString(36)}`;
    const request = Object.freeze({
      contractVersion: EDIT_AUTHOR_RUNTIME_CONTRACT_VERSION,
      requestId,
      sourceSha256: identity.sourceSha256,
      html: identity.html,
      hosts,
      canvasGeneration: identity.canvasGeneration,
    });
    this.#emit({
      phase: "probing",
      sourceSha256: identity.sourceSha256,
      canvasGeneration: identity.canvasGeneration,
    });
    void Promise.resolve(this.#port.probe(request)).then((result) => {
      if (
        this.#disposed
        || generation !== this.#generation
        || !sameIdentity(this.#identity, identity)
      ) {
        this.#revoke(result?.grant);
        return;
      }
      const grant = result?.outcome === "compatible"
        ? normalizedGrant(result.grant, request)
        : null;
      if (grant) {
        this.#emit({
          phase: "compatible",
          sourceSha256: identity.sourceSha256,
          canvasGeneration: identity.canvasGeneration,
          grant,
        });
        return;
      }
      this.#returnToStatic(result?.outcome || "failed");
    }).catch(() => {
      if (
        this.#disposed
        || generation !== this.#generation
        || !sameIdentity(this.#identity, identity)
      ) return;
      this.#returnToStatic("failed");
    });
    return this.#snapshot;
  }

  beginDirectLoad({ sessionId, sourceSha256, canvasGeneration } = {}) {
    const grant = this.#snapshot.grant;
    if (
      this.#snapshot.phase !== "compatible"
      || !grant
      || grant.sessionId !== sessionId
      || grant.sourceSha256 !== String(sourceSha256 || "").toLowerCase()
      || grant.canvasGeneration !== canvasGeneration
    ) return false;
    this.#emit({
      phase: "loading",
      sourceSha256: grant.sourceSha256,
      canvasGeneration: grant.canvasGeneration,
      grant,
    });
    return true;
  }

  settleDirectLoad({ sessionId, sourceSha256, canvasGeneration, outcome } = {}) {
    const grant = this.#snapshot.grant;
    if (
      this.#snapshot.phase !== "loading"
      || !grant
      || grant.sessionId !== sessionId
      || grant.sourceSha256 !== String(sourceSha256 || "").toLowerCase()
      || grant.canvasGeneration !== canvasGeneration
    ) return false;
    if (outcome === "ready") {
      this.#revoke(grant);
      this.#emit({
        phase: "ready",
        sourceSha256: grant.sourceSha256,
        canvasGeneration: grant.canvasGeneration,
        lastOutcome: "ready",
      });
      return true;
    }
    this.#returnToStatic(typeof outcome === "string" ? outcome : "failed");
    return true;
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#generation += 1;
    this.#revoke(this.#snapshot.grant);
    this.#listeners.clear();
    this.#identity = null;
    this.#emit({ phase: "static" });
  }
}
