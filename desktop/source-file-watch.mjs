import { watch } from "node:fs";
import path from "node:path";

const DEFAULT_DEBOUNCE_MS = 200;

function resolvedPath(value) {
  const nextPath = String(value || "").trim();
  return nextPath ? path.resolve(nextPath) : "";
}

export function createSourceFileWatcher({
  onChange,
  debounceMs = DEFAULT_DEBOUNCE_MS,
} = {}) {
  if (typeof onChange !== "function") {
    throw new TypeError("onChange must be a function.");
  }
  const delay = Number(debounceMs);
  const waitMs = Number.isFinite(delay) && delay >= 0 ? delay : DEFAULT_DEBOUNCE_MS;
  let watcher = null;
  let watchedPath = "";
  let watcherGeneration = 0;
  let timer = null;
  let pending = false;

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function close() {
    clearTimer();
    pending = false;
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    watchedPath = "";
  }

  function emit() {
    if (!watchedPath) return;
    onChange({
      sourcePath: watchedPath,
      watcherGeneration,
    });
  }

  function schedule() {
    pending = true;
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      pending = false;
      emit();
    }, waitMs);
    timer.unref?.();
  }

  function watchSource(sourcePath) {
    const nextPath = resolvedPath(sourcePath);
    if (!nextPath) {
      close();
      return;
    }
    if (watchedPath === nextPath && watcher) return;
    close();
    watchedPath = nextPath;
    watcherGeneration += 1;
    const generation = watcherGeneration;
    watcher = watch(path.dirname(nextPath), { persistent: true }, () => {
      if (generation !== watcherGeneration) return;
      schedule();
    });
    watcher.on("error", () => {
      if (generation !== watcherGeneration) return;
      schedule();
    });
  }

  return {
    watch: watchSource,
    close,
    get watchedPath() {
      return watchedPath || null;
    },
    get watcherGeneration() {
      return watcherGeneration;
    },
    get pending() {
      return pending;
    },
  };
}
