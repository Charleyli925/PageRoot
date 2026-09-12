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
  let sourceMissing = false;
  let sourceObservation = null;

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
    watcherGeneration += 1;
    clearTimer();
    pending = false;
    stopMissingProbe();
    closeWatchers();
    watchedPath = "";
    sourceMissing = false;
    sourceObservation = null;
  }

  function emit() {
    if (!watchedPath) return;
    onChange({
      sourcePath: watchedPath,
      watcherGeneration,
      sourceMissing,
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
    const attachDirectory = () => {
      try {
        directoryWatcher = attachWatcher(directoryPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
        directoryWatcher = null;
      }
    };
    attachDirectory();
    if (!directoryWatcher) {
      sourceMissing = true;
      schedule();
    }
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
        const missing = Boolean(error || !information?.isFile() || information.isSymbolicLink());
        const observation = missing ? null
          : `${information.dev}:${information.ino}:${information.size}:${information.mtimeMs}:${information.ctimeMs}`;
        if (missing && directoryWatcher) {
          directoryWatcher.close();
          directoryWatcher = null;
        }
        if (!missing && !directoryWatcher) {
          try { attachDirectory(); } catch { /* The parent/probe still observes recovery. */ }
        }
        // Some native directory watches do not resume after Finder moves a
        // directory away and back. The existing bounded stat probe also owns
        // this recovery signal, without reading HTML or recreating paths.
        if (missing !== sourceMissing || (sourceObservation && observation !== sourceObservation)) {
          sourceMissing = missing;
          schedule();
        }
        sourceObservation = observation;
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
