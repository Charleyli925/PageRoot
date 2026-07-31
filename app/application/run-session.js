function normalizedPath(value) {
  return value ? String(value) : null;
}

function comparablePath(value) {
  const sourcePath = normalizedPath(value);
  if (!sourcePath) return "";
  if (sourcePath === "/private/var" || sourcePath.startsWith("/private/var/")) {
    return sourcePath.slice("/private".length);
  }
  if (sourcePath === "/private/tmp" || sourcePath.startsWith("/private/tmp/")) {
    return sourcePath.slice("/private".length);
  }
  return sourcePath;
}

function samePath(left, right) {
  return Boolean(
    left
    && right
    && comparablePath(left) === comparablePath(right),
  );
}

function sameRun(left, right) {
  if (!left || !right) return false;
  return left.requestId === right.requestId
    && left.attemptId === right.attemptId
    && samePath(left.sourcePath, right.sourcePath);
}

function sameAttempt(left, right) {
  return Boolean(
    left
    && right
    && left.requestId === right.requestId
    && left.attemptId === right.attemptId,
  );
}

function frozenEntries(map) {
  return Object.freeze(
    [...map.entries()].map(([key, value]) => Object.freeze([key, value])),
  );
}

const OPERATION_KINDS = Object.freeze([
  "activate",
  "cancel",
  "resolve",
  "poll",
]);

export class RunSession {
  #activeSourcePath;

  #activeRun = null;

  #activeHandoff = null;

  #runs = new Map();

  #results = new Map();

  #handoffs = new Map();

  #busy = new Map(
    OPERATION_KINDS.map((kind) => [kind, new Set()]),
  );

  #observer = null;

  constructor({ sourcePath = null } = {}) {
    this.#activeSourcePath = normalizedPath(sourcePath);
  }

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit() {
    try {
      this.#observer?.(this.snapshot);
    } catch {
      // A view observer cannot change run authority.
    }
  }

  #findBySource(map, sourcePath) {
    if (!sourcePath) return null;
    if (map.has(sourcePath)) return map.get(sourcePath) ?? null;
    for (const [trackedPath, value] of map) {
      const valueSourcePath = value?.sourcePath;
      if (
        samePath(trackedPath, sourcePath)
        || samePath(valueSourcePath, sourcePath)
      ) return value;
    }
    return null;
  }

  #deleteBySource(map, sourcePath) {
    let changed = false;
    for (const [trackedPath, value] of map) {
      if (
        samePath(trackedPath, sourcePath)
        || samePath(value?.sourcePath, sourcePath)
      ) {
        map.delete(trackedPath);
        changed = true;
      }
    }
    return changed;
  }

  activate(sourcePath) {
    this.#activeSourcePath = normalizedPath(sourcePath);
    this.#activeRun = this.runForSource(this.#activeSourcePath);
    this.#activeHandoff = this.handoffForSource(this.#activeSourcePath);
    this.#emit();
    return this.snapshot;
  }

  setActiveRun(run) {
    this.#activeRun = run || null;
    this.#emit();
    return this.#activeRun;
  }

  trackRun(run, { activate = "if-current" } = {}) {
    if (!run?.sourcePath) return null;
    this.#deleteBySource(this.#runs, run.sourcePath);
    this.#runs.set(run.sourcePath, run);
    if (
      activate === "always"
      || (
        activate !== "never"
        && samePath(this.#activeSourcePath, run.sourcePath)
      )
    ) {
      this.#activeRun = run;
    }
    this.#emit();
    return run;
  }

  runForSource(sourcePath) {
    return this.#findBySource(this.#runs, sourcePath);
  }

  hasRun(run) {
    const tracked = this.runForSource(run?.sourcePath);
    return sameRun(tracked, run);
  }

  removeRun(run, { clearActive = true } = {}) {
    if (!run) return false;
    let changed = false;
    for (const [trackedPath, tracked] of this.#runs) {
      if (sameAttempt(tracked, run)) {
        this.#runs.delete(trackedPath);
        changed = true;
      }
    }
    if (clearActive && sameAttempt(this.#activeRun, run)) {
      this.#activeRun = null;
      changed = true;
    }
    if (changed) this.#emit();
    return changed;
  }

  clearActiveRun() {
    if (!this.#activeRun) return false;
    this.#activeRun = null;
    this.#emit();
    return true;
  }

  publishHandoff(state) {
    if (!state?.sourcePath) return false;
    const previous = this.handoffForSource(state.sourcePath);
    if (
      state.status !== "copying"
      && previous
      && (
        previous.requestId !== state.requestId
        || previous.attemptId !== state.attemptId
      )
    ) return false;
    this.#deleteBySource(this.#handoffs, state.sourcePath);
    this.#handoffs.set(state.sourcePath, state);
    if (
      samePath(this.#activeSourcePath, state.sourcePath)
      && sameRun(this.#activeRun, state)
    ) {
      this.#activeHandoff = state;
    }
    this.#emit();
    return true;
  }

  handoffForSource(sourcePath) {
    return this.#findBySource(this.#handoffs, sourcePath);
  }

  clearHandoff(sourcePath) {
    const changed = this.#deleteBySource(this.#handoffs, sourcePath);
    if (samePath(this.#activeHandoff?.sourcePath, sourcePath)) {
      this.#activeHandoff = null;
    }
    if (changed) this.#emit();
    return changed;
  }

  clearActiveHandoff() {
    if (!this.#activeHandoff) return false;
    this.#activeHandoff = null;
    this.#emit();
    return true;
  }

  markResult(sourcePath, result) {
    const activeSourcePath = normalizedPath(sourcePath);
    if (!activeSourcePath || !result) return false;
    this.#deleteBySource(this.#results, activeSourcePath);
    this.#results.set(activeSourcePath, result);
    this.#emit();
    return true;
  }

  clearResult(sourcePath) {
    const changed = this.#deleteBySource(this.#results, sourcePath);
    if (changed) this.#emit();
    return changed;
  }

  resultForSource(sourcePath) {
    return this.#findBySource(this.#results, sourcePath);
  }

  rebaseSource({
    previousSourcePath,
    sourcePath,
    projectId = "",
  }) {
    const nextSourcePath = normalizedPath(sourcePath);
    if (!previousSourcePath || !nextSourcePath) return false;

    const trackedRun = this.runForSource(previousSourcePath)
      || (
        projectId
          ? [...this.#runs.values()].find(
            (run) => run.projectId === projectId,
          ) || null
          : null
      );
    for (const [trackedPath, run] of this.#runs) {
      if (
        samePath(trackedPath, previousSourcePath)
        || (
          projectId
          && run.projectId === projectId
        )
      ) this.#runs.delete(trackedPath);
    }
    const nextRun = trackedRun
      ? { ...trackedRun, sourcePath: nextSourcePath }
      : null;
    if (nextRun) this.#runs.set(nextSourcePath, nextRun);

    const trackedHandoff = this.handoffForSource(previousSourcePath);
    this.#deleteBySource(this.#handoffs, previousSourcePath);
    const nextHandoff = trackedHandoff
      ? { ...trackedHandoff, sourcePath: nextSourcePath }
      : null;
    if (nextHandoff) this.#handoffs.set(nextSourcePath, nextHandoff);

    const trackedResult = this.resultForSource(previousSourcePath);
    this.#deleteBySource(this.#results, previousSourcePath);
    if (trackedResult) this.#results.set(nextSourcePath, trackedResult);

    if (samePath(this.#activeSourcePath, previousSourcePath)) {
      this.#activeSourcePath = nextSourcePath;
      this.#activeRun = nextRun;
      this.#activeHandoff = nextHandoff;
    } else {
      if (samePath(this.#activeRun?.sourcePath, previousSourcePath)) {
        this.#activeRun = nextRun;
      }
      if (samePath(this.#activeHandoff?.sourcePath, previousSourcePath)) {
        this.#activeHandoff = nextHandoff;
      }
    }
    this.#emit();
    return true;
  }

  beginOperation(kind, key) {
    const busy = this.#busy.get(kind);
    if (!busy || !key || busy.has(key)) return false;
    busy.add(key);
    return true;
  }

  endOperation(kind, key) {
    return this.#busy.get(kind)?.delete(key) ?? false;
  }

  isOperationBusy(kind, key) {
    return Boolean(key && this.#busy.get(kind)?.has(key));
  }

  get activeRun() {
    return this.#activeRun;
  }

  get activeHandoff() {
    return this.#activeHandoff;
  }

  get runs() {
    return Object.freeze([...this.#runs.values()]);
  }

  get snapshot() {
    return Object.freeze({
      activeSourcePath: this.#activeSourcePath,
      activeRun: this.#activeRun,
      activeHandoff: this.#activeHandoff,
      backgroundResults: frozenEntries(this.#results),
    });
  }
}
