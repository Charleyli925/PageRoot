import { lstat, watch } from "node:fs";
import path from "node:path";

const DEFAULT_DEBOUNCE_MS = 200;
const MISSING_PATH_PROBE_MS = 400;

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
  let directoryWatcher = null;
  let parentWatcher = null;
  let missingProbe = null;
  let watchedPath = "";
  let watcherGeneration = 0;
  let timer = null;
  let pending = false;

  function clearTimer() {
    if (!timer) return;
    clearTimeout(timer);
    timer = null;
  }

  function stopMissingProbe() {
    if (!missingProbe) return;
    clearInterval(missingProbe);
    missingProbe = null;
  }

  function closeWatchers() {
    if (directoryWatcher) {
      directoryWatcher.close();
      directoryWatcher = null;
    }
    if (parentWatcher) {
      parentWatcher.close();
      parentWatcher = null;
    }
  }

  function close() {
    clearTimer();
    pending = false;
    stopMissingProbe();
    closeWatchers();
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
    if (watchedPath === nextPath && directoryWatcher) return;
    close();
    watchedPath = nextPath;
    watcherGeneration += 1;
    const generation = watcherGeneration;
    const attachWatcher = (targetPath) => {
      const nextWatcher = watch(targetPath, { persistent: true }, () => {
        if (generation !== watcherGeneration) return;
        schedule();
      });
      nextWatcher.on("error", () => {
        if (generation !== watcherGeneration) return;
        schedule();
      });
      return nextWatcher;
    };
    const directoryPath = path.dirname(nextPath);
    directoryWatcher = attachWatcher(directoryPath);
    const parentPath = path.dirname(directoryPath);
    if (parentPath && parentPath !== directoryPath) {
      try {
        parentWatcher = attachWatcher(parentPath);
      } catch {
        parentWatcher = null;
      }
    }
    missingProbe = setInterval(() => {
      if (generation !== watcherGeneration) return;
      lstat(nextPath, (error, information) => {
        if (generation !== watcherGeneration) return;
        if (error?.code === "ENOENT" || (information && !information.isFile())) {
          stopMissingProbe();
          schedule();
        }
      });
    }, MISSING_PATH_PROBE_MS);
    missingProbe.unref?.();
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
