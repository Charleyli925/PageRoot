import {
  acceptedRuntimeVisualEnvelope,
  RUNTIME_VISUAL_CONTRACT_VERSION,
} from "../domain/runtime-visual-contract.js";
import {
  describeRuntimeSnapshotInputs,
} from "../domain/runtime-snapshot-hosts.js";
import {
  acceptRuntimeVisualSnapshots,
  runtimeVisualSnapshotsByteSize,
} from "../lib/runtime-visual-snapshots.js";

const DEFAULT_CAPTURE_DEBOUNCE_MS = 120;
const VIEWPORT_BUCKET_WIDTH = 64;
const CAPTURE_VIEWPORT_HEIGHT = 1_200;
const MAX_CACHE_ENTRIES = 4;
const MAX_CACHE_BYTES = 16 * 1024 * 1024;

function markSnapshotEvent(event) {
  try {
    const name = `pageroot:runtime-snapshot:${event}`;
    globalThis.performance?.clearMarks?.(name);
    globalThis.performance?.mark?.(name);
  } catch {
    // Diagnostics cannot own disposable presentation state.
  }
}

function initialSnapshot() {
  return Object.freeze({
    status: "idle",
    documentKey: null,
    sourceSha256: null,
    requestKey: null,
    projection: null,
  });
}

function normalizedViewportWidth(value) {
  const width = Math.round(Number(value));
  return Number.isFinite(width)
    ? Math.max(320, Math.min(4_096, width))
    : null;
}

function viewportBucket(width) {
  return Math.floor(width / VIEWPORT_BUCKET_WIDTH);
}

function captureSessionSuffix() {
  try {
    const bytes = new Uint8Array(10);
    globalThis.crypto?.getRandomValues?.(bytes);
    if (bytes.some((value) => value !== 0)) {
      return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
    }
  } catch {
    // A deterministic fallback keeps the owner request valid in non-browser tests.
  }
  return Math.random().toString(36).slice(2).padEnd(20, "0");
}

function createCaptureSessionId(sequence) {
  return `runtime-edit-${String(sequence).padStart(8, "0")}-${captureSessionSuffix()}`;
}

function snapshotsByBinding(candidates, snapshots, capturedSourceSha256) {
  const snapshotsByKey = new Map(snapshots.map((snapshot) => [snapshot.key, snapshot]));
  const byBinding = new Map();
  candidates.forEach((candidate) => {
    const snapshot = snapshotsByKey.get(candidate.captureKey);
    if (snapshot?.state === "captured") {
      byBinding.set(candidate.bindingKey, Object.freeze({
        ...snapshot,
        capturedSourceSha256,
      }));
    }
  });
  return byBinding;
}

function snapshotsFromProjection(projection) {
  const snapshots = new Map();
  projection?.visuals?.forEach((visual) => {
    if (!visual?.bindingKey || !visual?.pngBytes) return;
    snapshots.set(visual.bindingKey, Object.freeze({
      key: visual.captureKey,
      state: "captured",
      capturedSourceSha256: visual.capturedSourceSha256,
      pngSha256: visual.pngSha256,
      width: visual.width,
      height: visual.height,
      byteLength: visual.byteLength,
      pngBytes: visual.pngBytes,
    }));
  });
  return snapshots;
}

function projectionFor({
  descriptor,
  documentKey,
  generation,
  snapshots,
}) {
  const visuals = descriptor.candidates.flatMap((candidate) => {
    const snapshot = snapshots.get(candidate.bindingKey);
    if (snapshot?.state !== "captured") return [];
    return [Object.freeze({
      captureKey: candidate.captureKey,
      bindingKey: candidate.bindingKey,
      sourceNodeId: candidate.sourceNodeId,
      tagName: candidate.tagName,
      kind: candidate.kind,
      hostTargetRef: candidate.hostTargetRef,
      capturedSourceSha256: snapshot.capturedSourceSha256,
      pngSha256: snapshot.pngSha256,
      width: snapshot.width,
      height: snapshot.height,
      byteLength: snapshot.byteLength,
      pngBytes: snapshot.pngBytes,
    })];
  });
  return Object.freeze({
    documentKey,
    generation,
    sourceSha256: descriptor.sourceSha256,
    runtimeInputSha256: descriptor.runtimeInputSha256,
    visuals: Object.freeze(visuals),
  });
}

/**
 * Owns Edit's one bounded last-snapshot cache. It re-resolves every display
 * host through the current SourceIndex, so an ordinary text edit may rebind a
 * bitmap while a chart-input change keeps the old image only during a silent
 * background replacement.
 */
export class EditRuntimeSnapshotSession {
  #capture;

  #observer = null;

  #snapshot = initialSnapshot();

  #sequence = 0;

  #timer = null;

  #captureDebounceMs;

  #cache = new Map();

  #cacheBytes = 0;

  #pending = null;

  #documentKey = null;

  #captureIdentitySequence = 0;

  #captureSessionId = createCaptureSessionId(0);

  constructor({
    capture,
    captureDebounceMs = DEFAULT_CAPTURE_DEBOUNCE_MS,
  } = {}) {
    this.#capture = typeof capture === "function" ? capture : null;
    this.#captureDebounceMs = Math.max(0, Number(captureDebounceMs) || 0);
  }

  get snapshot() {
    return this.#snapshot;
  }

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit(next) {
    this.#snapshot = Object.freeze({ ...next });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change snapshot authority.
    }
  }

  #remember(requestKey, snapshots) {
    const bytes = runtimeVisualSnapshotsByteSize([...snapshots.values()]);
    if (!bytes || bytes > MAX_CACHE_BYTES) return;
    const previous = this.#cache.get(requestKey);
    if (previous) this.#cacheBytes -= previous.bytes;
    this.#cache.delete(requestKey);
    this.#cache.set(requestKey, Object.freeze({ snapshots, bytes }));
    this.#cacheBytes += bytes;
    while (
      this.#cache.size > MAX_CACHE_ENTRIES
      || this.#cacheBytes > MAX_CACHE_BYTES
    ) {
      const oldestKey = this.#cache.keys().next().value;
      const oldest = this.#cache.get(oldestKey);
      this.#cache.delete(oldestKey);
      this.#cacheBytes -= oldest?.bytes ?? 0;
    }
  }

  #cached(requestKey) {
    const entry = this.#cache.get(requestKey);
    if (!entry) return null;
    this.#cache.delete(requestKey);
    this.#cache.set(requestKey, entry);
    return entry.snapshots;
  }

  #commit({ requestKey, projection }) {
    this.#pending = null;
    this.#emit({
      status: "ready",
      documentKey: projection.documentKey,
      sourceSha256: projection.sourceSha256,
      requestKey,
      projection,
    });
  }

  #clearTimer() {
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #beginNewDocument(documentKey) {
    if (this.#documentKey === null || this.#documentKey === documentKey) return;
    this.reset();
  }

  request({
    html,
    documentKey,
    viewportWidth,
    sourceIndex = null,
  } = {}) {
    if (!this.#capture || typeof documentKey !== "string" || !documentKey) {
      this.reset();
      return false;
    }
    this.#beginNewDocument(documentKey);
    const width = normalizedViewportWidth(viewportWidth);
    const descriptor = width === null
      ? null
      : describeRuntimeSnapshotInputs({ html, sourceIndex });
    if (!descriptor) {
      this.reset();
      return false;
    }
    this.#documentKey = documentKey;
    const requestKey = [
      documentKey,
      descriptor.runtimeInputSha256,
      viewportBucket(width),
    ].join("\u0000");
    const latest = Object.freeze({ html, descriptor, width, documentKey });

    if (this.#pending?.requestKey === requestKey) {
      this.#pending.latest = latest;
      const retained = projectionFor({
        descriptor,
        documentKey,
        generation: this.#pending.sequence,
        snapshots: snapshotsFromProjection(this.#snapshot.projection),
      });
      this.#emit({
        ...this.#snapshot,
        documentKey,
        sourceSha256: descriptor.sourceSha256,
        projection: retained.visuals.length ? retained : null,
      });
      return true;
    }

    const cached = this.#cached(requestKey);
    if (cached) {
      this.#sequence += 1;
      this.#clearTimer();
      const projection = projectionFor({
        descriptor,
        documentKey,
        generation: this.#sequence,
        snapshots: cached,
      });
      this.#commit({ requestKey, projection });
      markSnapshotEvent("cache-hit");
      return true;
    }

    this.#sequence += 1;
    const sequence = this.#sequence;
    this.#clearTimer();
    if (!descriptor.candidates.length) {
      this.#commit({
        requestKey,
        projection: projectionFor({
          descriptor,
          documentKey,
          generation: sequence,
          snapshots: new Map(),
        }),
      });
      return true;
    }

    const retained = projectionFor({
      descriptor,
      documentKey,
      generation: sequence,
      snapshots: snapshotsFromProjection(this.#snapshot.projection),
    });
    this.#pending = { requestKey, sequence, latest };
    this.#emit({
      status: "scheduled",
      documentKey,
      sourceSha256: descriptor.sourceSha256,
      requestKey,
      projection: retained.visuals.length ? retained : null,
    });
    markSnapshotEvent("scheduled");
    this.#timer = setTimeout(() => {
      this.#timer = null;
      const pending = this.#pending;
      if (!pending || pending.sequence !== sequence || this.#sequence !== sequence) return;
      const captureContext = pending.latest;
      const expected = Object.freeze({
        sessionId: this.#captureSessionId,
        sourceSha256: captureContext.descriptor.sourceSha256,
      });
      this.#emit({ ...this.#snapshot, status: "capturing" });
      const request = Object.freeze({
        contractVersion: RUNTIME_VISUAL_CONTRACT_VERSION,
        captureSessionId: this.#captureSessionId,
        sourceSha256: captureContext.descriptor.sourceSha256,
        side: "edit",
        html: captureContext.html,
        candidates: Object.freeze(
          captureContext.descriptor.candidates.map(({ captureCandidate }) => captureCandidate),
        ),
        viewport: Object.freeze({
          width: captureContext.width,
          height: CAPTURE_VIEWPORT_HEIGHT,
        }),
      });
      void Promise.resolve(this.#capture(request)).then((result) => {
        const current = this.#pending;
        if (this.#sequence !== sequence || current?.sequence !== sequence) {
          markSnapshotEvent("late-discard");
          return;
        }
        const envelope = result?.outcome === "captured"
          ? acceptedRuntimeVisualEnvelope(result.envelope, expected)
          : null;
        const snapshots = envelope
          ? acceptRuntimeVisualSnapshots(
              result.envelope.runtimeVisualSnapshots,
              new Set(captureContext.descriptor.candidates.map(({ captureKey }) => captureKey)),
            )
          : null;
        if (!snapshots) {
          this.#pending = null;
          this.#emit({
            status: "unavailable",
            documentKey,
            sourceSha256: current.latest.descriptor.sourceSha256,
            requestKey,
            projection: null,
          });
          return;
        }
        const byBinding = snapshotsByBinding(
          captureContext.descriptor.candidates,
          snapshots,
          captureContext.descriptor.sourceSha256,
        );
        this.#remember(requestKey, byBinding);
        const projection = projectionFor({
          descriptor: current.latest.descriptor,
          documentKey,
          generation: sequence,
          snapshots: byBinding,
        });
        if (!projection.visuals.length) {
          this.#pending = null;
          this.#emit({
            status: "unavailable",
            documentKey,
            sourceSha256: current.latest.descriptor.sourceSha256,
            requestKey,
            projection: null,
          });
          return;
        }
        this.#commit({ requestKey, projection });
        markSnapshotEvent("capture-ready");
      }).catch(() => {
        if (this.#sequence !== sequence) return;
        const current = this.#pending;
        if (!current || current.sequence !== sequence) return;
        this.#pending = null;
        this.#emit({
          status: "unavailable",
          documentKey,
          sourceSha256: current.latest.descriptor.sourceSha256,
          requestKey,
          projection: null,
        });
      });
    }, this.#captureDebounceMs);
    return true;
  }

  suspend() {
    this.#sequence += 1;
    this.#clearTimer();
    this.#pending = null;
    if (this.#snapshot.projection) {
      this.#emit({
        status: "ready",
        documentKey: this.#snapshot.projection.documentKey,
        sourceSha256: this.#snapshot.projection.sourceSha256,
        requestKey: this.#snapshot.requestKey,
        projection: this.#snapshot.projection,
      });
    } else if (this.#snapshot.status !== "idle") {
      this.#emit(initialSnapshot());
    }
  }

  reset() {
    this.#sequence += 1;
    this.#clearTimer();
    this.#pending = null;
    this.#cache.clear();
    this.#cacheBytes = 0;
    this.#documentKey = null;
    this.#captureIdentitySequence += 1;
    this.#captureSessionId = createCaptureSessionId(this.#captureIdentitySequence);
    if (this.#snapshot.status !== "idle") this.#emit(initialSnapshot());
  }

  dispose() {
    this.reset();
    this.#observer = null;
  }
}
