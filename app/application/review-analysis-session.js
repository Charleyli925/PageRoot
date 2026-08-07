const DEFAULT_MAX_CACHE_ENTRIES = 4;
const DEFAULT_MAX_CACHE_BYTES = 32 * 1024 * 1024;

function nextTask() {
  return new Promise((resolve) => globalThis.setTimeout(resolve, 0));
}

export class ReviewAnalysisCancelledError extends Error {
  constructor() {
    super("Review analysis was superseded.");
    this.name = "ReviewAnalysisCancelledError";
  }
}

export class ReviewAnalysisSession {
  #cache = new Map();

  #cacheBytes = 0;

  #generation = 0;

  #pending = null;

  #maxCacheEntries;

  #maxCacheBytes;

  #estimateSize;

  constructor({
    maxCacheEntries = DEFAULT_MAX_CACHE_ENTRIES,
    maxCacheBytes = DEFAULT_MAX_CACHE_BYTES,
    estimateSize,
  } = {}) {
    this.#maxCacheEntries = Math.max(1, Math.round(maxCacheEntries) || 1);
    this.#maxCacheBytes = Math.max(1, Math.round(maxCacheBytes) || 1);
    this.#estimateSize = typeof estimateSize === "function"
      ? estimateSize
      : () => 1;
  }

  #cached(key) {
    const entry = this.#cache.get(key);
    if (!entry) return null;
    this.#cache.delete(key);
    this.#cache.set(key, entry);
    return entry.value;
  }

  #store(key, value) {
    const previous = this.#cache.get(key);
    if (previous) this.#cacheBytes -= previous.bytes;
    this.#cache.delete(key);
    const bytes = Math.max(1, Math.round(Number(this.#estimateSize(value))) || 1);
    if (bytes > this.#maxCacheBytes) return;
    this.#cache.set(key, { value, bytes });
    this.#cacheBytes += bytes;
    while (
      this.#cache.size > this.#maxCacheEntries
      || this.#cacheBytes > this.#maxCacheBytes
    ) {
      const oldestKey = this.#cache.keys().next().value;
      const oldest = this.#cache.get(oldestKey);
      this.#cache.delete(oldestKey);
      this.#cacheBytes -= oldest?.bytes ?? 0;
    }
  }

  analyze({ key, compute } = {}) {
    if (typeof key !== "string" || !key || typeof compute !== "function") {
      return Promise.reject(new TypeError(
        "Review analysis requires a cache key and compute function.",
      ));
    }
    const cached = this.#cached(key);
    if (cached !== null) {
      if (this.#pending?.key !== key) this.cancel();
      return Promise.resolve(cached);
    }
    if (this.#pending?.key === key) return this.#pending.promise;

    const generation = ++this.#generation;
    const promise = (async () => {
      await nextTask();
      if (generation !== this.#generation) {
        throw new ReviewAnalysisCancelledError();
      }
      let value;
      try {
        value = await compute({
          isCancelled: () => generation !== this.#generation,
        });
      } catch (cause) {
        if (generation !== this.#generation) {
          throw new ReviewAnalysisCancelledError();
        }
        throw cause;
      }
      if (generation !== this.#generation) {
        throw new ReviewAnalysisCancelledError();
      }
      this.#store(key, value);
      return value;
    })().finally(() => {
      if (this.#pending?.generation === generation) this.#pending = null;
    });
    this.#pending = { key, generation, promise };
    return promise;
  }

  cancel() {
    this.#generation += 1;
    this.#pending = null;
  }

  clear() {
    this.cancel();
    this.#cache.clear();
    this.#cacheBytes = 0;
  }

  dispose() {
    this.clear();
  }
}
