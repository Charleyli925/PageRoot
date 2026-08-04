import {
  acceptRuntimeVisualProjection,
  prepareRuntimeVisualCapture,
} from "../domain/runtime-visual-projection.js";

const DEFAULT_CAPTURE_DEBOUNCE_MS = 180;

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

  request({
    html,
    sourcePath,
    documentKey,
    viewportWidth,
    pageViewContext = null,
  } = {}) {
    if (!this.#capture || typeof documentKey !== "string" || !documentKey) {
      this.reset();
      return false;
    }
    const prepared = prepareRuntimeVisualCapture({
      html,
      sourcePath,
      viewportWidth,
      pageViewContext,
    });
    if (!prepared) {
      this.reset();
      return false;
    }
    const requestKey = [
      documentKey,
      sourcePath,
      prepared.sourceSha256,
      prepared.payload?.viewport.width ?? Math.round(Number(viewportWidth) || 0),
      JSON.stringify(prepared.payload?.presentationEntries ?? []),
    ].join("\u0000");
    if (
      this.#snapshot.requestKey === requestKey
      && ["scheduled", "capturing", "ready"].includes(this.#snapshot.status)
    ) return true;

    this.#sequence += 1;
    const sequence = this.#sequence;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
    this.#emit({
      status: prepared.payload ? "scheduled" : "ready",
      documentKey,
      sourceSha256: prepared.sourceSha256,
      requestKey,
      projection: prepared.payload
        ? null
        : acceptRuntimeVisualProjection({
            html,
            documentKey,
            generation: sequence,
            rawProjection: {
              protocol: "pageroot-runtime-visual-projection",
              version: 1,
              sourceSha256: prepared.sourceSha256,
              visuals: [],
            },
          }),
    });
    if (!prepared.payload) return true;

    this.#timer = setTimeout(() => {
      this.#timer = null;
      if (sequence !== this.#sequence) return;
      this.#emit({
        ...this.#snapshot,
        status: "capturing",
      });
      void Promise.resolve(this.#capture(prepared.payload))
        .then((rawProjection) => {
          if (sequence !== this.#sequence) return;
          const projection = acceptRuntimeVisualProjection({
            html,
            documentKey,
            generation: sequence,
            rawProjection,
          });
          this.#emit({
            status: projection ? "ready" : "unavailable",
            documentKey,
            sourceSha256: prepared.sourceSha256,
            requestKey,
            projection,
          });
        })
        .catch(() => {
          if (sequence !== this.#sequence) return;
          this.#emit({
            status: "unavailable",
            documentKey,
            sourceSha256: prepared.sourceSha256,
            requestKey,
            projection: null,
          });
        });
    }, this.#captureDebounceMs);
    return true;
  }

  reset() {
    this.#sequence += 1;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
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
