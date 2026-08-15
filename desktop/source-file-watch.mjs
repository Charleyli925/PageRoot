import { watch } from "node:fs";
import path from "node:path";

const DEFAULT_DEBOUNCE_MS = 200;

function resolvedPath(value) {
  const nextPath = String(value || "").trim();
  return nextPath ? path.resolve(nextPath) : "";
}

function sameFileName(left, right) {
  return path.basename(String(left || "")) === path.basename(String(right || ""));
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
  let timer = null;

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function close() {
    clearTimer();
    if (watcher) {
      watcher.close();
      watcher = null;
    }
    watchedPath = "";
  }

  function emit() {
    if (!watchedPath) return;
    onChange({ sourcePath: watchedPath });
  }

  function schedule() {
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
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
    if (watchedPath === nextPath && watcher) return; // same path: keep the live watcher
    close();
    watchedPath = nextPath;
    watcher = watch(path.dirname(nextPath), { persistent: true }, (_eventType, filename) => {
      if (filename && !sameFileName(filename, nextPath)) return;
      schedule();
    });
    watcher.on("error", () => {
      close();
    });
  }

  return {
    watch: watchSource,
    close,
    get watchedPath() {
      return watchedPath || null;
    },
  };
}
