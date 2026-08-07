import {
  RUNTIME_VISUAL_PROJECTION_PROTOCOL,
  RUNTIME_VISUAL_PROJECTION_VERSION,
  acceptRuntimeVisualProjection,
  describeRuntimeVisualCapture,
  mergeDeferredRuntimeVisualProjection,
  prepareRuntimeVisualCapture,
  rebindRuntimeVisualProjection,
} from "../domain/runtime-visual-projection.js";

const DEFAULT_CAPTURE_DEBOUNCE_MS = 180;
const MAX_PROJECTION_CACHE_ENTRIES = 8;

function initialSnapshot() {
  return Object.freeze({
    status: "idle",
    documentKey: null,
    sourceSha256: null,
    requestKey: null,
    projection: null,
  });
}

export class RuntimeVisualProjectionSession {
  #capture;

  #observer = null;

  #snapshot = initialSnapshot();

  #sequence = 0;

  #timer = null;

  #captureDebounceMs;

  #cache = new Map();

  #committedRequestKey = null;

  #pending = null;

  constructor({
    capture,
    captureDebounceMs = DEFAULT_CAPTURE_DEBOUNCE_MS,
  } = {}) {
    this.#capture = typeof capture === "function" ? capture : null;
    this.#captureDebounceMs = Math.max(0, Number(captureDebounceMs) || 0);
  }

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit(next) {
    this.#snapshot = Object.freeze({ ...next });
    try {
      this.#observer?.(this.#snapshot);
    } catch {
      // A view observer cannot change projection authority.
    }
  }

  #cacheProjection(requestKey, projection) {
    this.#cache.delete(requestKey);
    this.#cache.set(requestKey, projection);
    while (this.#cache.size > MAX_PROJECTION_CACHE_ENTRIES) {
      this.#cache.delete(this.#cache.keys().next().value);
    }
  }

  #commit({ requestKey, projection }) {
    this.#pending = null;
    this.#committedRequestKey = requestKey;
    this.#cacheProjection(requestKey, projection);
    this.#emit({
      status: "ready",
      documentKey: projection.documentKey,
      sourceSha256: projection.sourceSha256,
      requestKey,
      projection,
    });
  }

  #rebind(projection, {
    html,
    documentKey,
    descriptor,
    sourceIndex,
  }, generation) {
    if (!projection || projection.documentKey !== documentKey) return null;
    if (projection.sourceSha256 === descriptor.sourceSha256) return projection;
    return rebindRuntimeVisualProjection({
      html,
      documentKey,
      generation,
      projection,
      sourceIndex,
    });
  }

  request({
    html,
    sourcePath,
    documentKey,
    viewportWidth,
    pageViewContext = null,
    sourceIndex = null,
  } = {}) {
    if (!this.#capture || typeof documentKey !== "string" || !documentKey) {
      this.reset();
      return false;
    }
    const descriptor = describeRuntimeVisualCapture({
      html,
      sourcePath,
      viewportWidth,
      pageViewContext,
      sourceIndex,
    });
    if (!descriptor) {
      this.reset();
      return false;
    }
    const requestKey = [
      documentKey,
      sourcePath,
      descriptor.dependencySha256,
      descriptor.viewportWidth,
      descriptor.presentationDependencySha256,
    ].join("\u0000");
    const latest = {
      html,
      sourcePath,
      documentKey,
      viewportWidth: descriptor.viewportWidth,
      pageViewContext,
      sourceIndex,
      descriptor,
    };

    if (
      this.#pending?.requestKey === requestKey
      && ["scheduled", "capturing"].includes(this.#snapshot.status)
    ) {
      this.#pending.latest = latest;
      const rebound = this.#rebind(
        this.#snapshot.projection,
        latest,
        this.#sequence,
      );
      this.#emit({
        ...this.#snapshot,
        documentKey,
        sourceSha256: descriptor.sourceSha256,
        projection: rebound ?? this.#snapshot.projection,
      });
      return true;
    }

    if (
      this.#snapshot.status === "ready"
      && this.#committedRequestKey === requestKey
      && this.#snapshot.projection?.documentKey === documentKey
      && this.#snapshot.projection.sourceSha256 === descriptor.sourceSha256
    ) return true;

    const cached = this.#cache.get(requestKey)
      ?? (this.#committedRequestKey === requestKey
        ? this.#snapshot.projection
        : null);
    if (cached) {
      const rebound = this.#rebind(cached, latest, this.#sequence + 1);
      if (rebound) {
        this.#sequence += 1;
        if (this.#timer !== null) clearTimeout(this.#timer);
        this.#timer = null;
        this.#commit({ requestKey, projection: rebound });
        return true;
      }
    }

    this.#sequence += 1;
    const sequence = this.#sequence;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;

    if (descriptor.candidates.length === 0) {
      const projection = acceptRuntimeVisualProjection({
        html,
        documentKey,
        generation: sequence,
        sourceIndex,
        rawProjection: {
          protocol: RUNTIME_VISUAL_PROJECTION_PROTOCOL,
          version: RUNTIME_VISUAL_PROJECTION_VERSION,
          sourceSha256: descriptor.sourceSha256,
          visuals: [],
          deferredSourceNodeIds: [],
        },
      });
      if (!projection) {
        this.reset();
        return false;
      }
      this.#commit({ requestKey, projection });
      return true;
    }

    const retainedProjection = this.#snapshot.projection?.documentKey === documentKey
      ? this.#snapshot.projection
      : null;
    this.#pending = { requestKey, sequence, latest, capture: null };
    this.#emit({
      status: "scheduled",
      documentKey,
      sourceSha256: descriptor.sourceSha256,
      requestKey,
      projection: retainedProjection,
    });

    this.#timer = setTimeout(() => {
      this.#timer = null;
      const pending = this.#pending;
      if (!pending || pending.sequence !== sequence || sequence !== this.#sequence) return;
      const captureContext = pending.latest;
      const prepared = prepareRuntimeVisualCapture({
        html: captureContext.html,
        sourcePath: captureContext.sourcePath,
        viewportWidth: captureContext.viewportWidth,
        pageViewContext: captureContext.pageViewContext,
        sourceIndex: captureContext.sourceIndex,
      });
      if (
        !prepared?.payload
        || prepared.dependencySha256 !== captureContext.descriptor.dependencySha256
      ) {
        this.#pending = null;
        this.#emit({
          ...this.#snapshot,
          status: "unavailable",
        });
        return;
      }
      pending.capture = captureContext;
      this.#emit({
        ...this.#snapshot,
        status: "capturing",
      });
      void Promise.resolve(this.#capture(prepared.payload))
        .then((rawProjection) => {
          const currentPending = this.#pending;
          if (
            sequence !== this.#sequence
            || currentPending?.sequence !== sequence
          ) return;
          let projection = acceptRuntimeVisualProjection({
            html: captureContext.html,
            documentKey,
            generation: sequence,
            rawProjection,
            sourceIndex: captureContext.sourceIndex,
          });
          const current = currentPending.latest;
          if (
            projection
            && projection.sourceSha256 !== current.descriptor.sourceSha256
          ) {
            projection = rebindRuntimeVisualProjection({
              html: current.html,
              documentKey,
              generation: sequence,
              projection,
              sourceIndex: current.sourceIndex,
            });
          }
          if (projection) {
            projection = mergeDeferredRuntimeVisualProjection({
              html: current.html,
              documentKey,
              generation: sequence,
              projection,
              fallbackProjection: this.#snapshot.projection,
              sourceIndex: current.sourceIndex,
            });
          }
          if (projection) {
            this.#commit({ requestKey, projection });
            return;
          }
          this.#pending = null;
          this.#emit({
            ...this.#snapshot,
            status: "unavailable",
            documentKey,
            sourceSha256: current.descriptor.sourceSha256,
            requestKey,
          });
        })
        .catch(() => {
          if (sequence !== this.#sequence) return;
          const current = this.#pending?.latest ?? captureContext;
          this.#pending = null;
          this.#emit({
            ...this.#snapshot,
            status: "unavailable",
            documentKey,
            sourceSha256: current.descriptor.sourceSha256,
            requestKey,
          });
        });
    }, this.#captureDebounceMs);
    return true;
  }

  suspend() {
    this.#sequence += 1;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending = null;
    if (this.#snapshot.projection) {
      this.#emit({
        status: "ready",
        documentKey: this.#snapshot.projection.documentKey,
        sourceSha256: this.#snapshot.projection.sourceSha256,
        requestKey: this.#committedRequestKey,
        projection: this.#snapshot.projection,
      });
    } else if (this.#snapshot.status !== "idle") {
      this.#emit(initialSnapshot());
    }
  }

  reset() {
    this.#sequence += 1;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#pending = null;
    this.#cache.clear();
    this.#committedRequestKey = null;
    if (this.#snapshot.status !== "idle") this.#emit(initialSnapshot());
  }

  dispose() {
    this.reset();
    this.#observer = null;
  }

  get snapshot() {
    return this.#snapshot;
  }
}
