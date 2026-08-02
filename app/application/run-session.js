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

  #activeOutcome = null;

  #runs = new Map();

  #results = new Map();

  #handoffs = new Map();

  #copiedHandoffs = new Map();

  #recoveredRuns = new Map();

  #outcomes = new Map();

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

  #matchesTrackedRun(map, run) {
    return sameRun(this.#findBySource(map, run?.sourcePath), run);
  }

  #clearRunScopedState(sourcePath) {
    const copied = this.#deleteBySource(this.#copiedHandoffs, sourcePath);
    const recovered = this.#deleteBySource(this.#recoveredRuns, sourcePath);
    return copied || recovered;
  }

  activate(sourcePath) {
    this.#activeSourcePath = normalizedPath(sourcePath);
    this.#activeRun = this.runForSource(this.#activeSourcePath);
    this.#activeHandoff = this.handoffForSource(this.#activeSourcePath);
    this.#activeOutcome = this.outcomeForSource(this.#activeSourcePath);
    this.#emit();
    return this.snapshot;
  }

  setActiveRun(run) {
    if (
      run?.sourcePath
      && !sameRun(this.#activeRun, run)
      && !this.#matchesTrackedRun(this.#runs, run)
    ) {
      this.#clearRunScopedState(run.sourcePath);
    }
    this.#activeRun = run || null;
    this.#emit();
    return this.#activeRun;
  }

  trackRun(run, { activate = "if-current", recovered = false } = {}) {
    if (!run?.sourcePath) return null;
    const previous = this.runForSource(run.sourcePath);
    const sameTrackedRun = sameRun(previous, run);
    if (!sameTrackedRun) this.#clearRunScopedState(run.sourcePath);
    if (recovered && !sameTrackedRun) {
      this.#deleteBySource(this.#recoveredRuns, run.sourcePath);
      this.#recoveredRuns.set(run.sourcePath, run);
    }
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
        this.#clearRunScopedState(trackedPath);
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
    const copyAlreadyConfirmed = this.#matchesTrackedRun(
      this.#copiedHandoffs,
      state,
    );
    if (state.status === "copying" && !copyAlreadyConfirmed) {
      this.#deleteBySource(this.#copiedHandoffs, state.sourcePath);
    }
    if (state.status === "copied") {
      this.#deleteBySource(this.#copiedHandoffs, state.sourcePath);
      this.#copiedHandoffs.set(state.sourcePath, state);
    }
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
    this.#deleteBySource(this.#copiedHandoffs, sourcePath);
    if (samePath(this.#activeHandoff?.sourcePath, sourcePath)) {
      this.#activeHandoff = null;
    }
    if (changed) this.#emit();
    return changed;
  }

  clearActiveHandoff() {
    if (!this.#activeHandoff) return false;
    this.#deleteBySource(
      this.#copiedHandoffs,
      this.#activeHandoff.sourcePath,
    );
    this.#activeHandoff = null;
    this.#emit();
    return true;
  }

  rememberOutcome(run) {
    if (!run?.sourcePath) return null;
    this.#deleteBySource(this.#outcomes, run.sourcePath);
    this.#outcomes.set(run.sourcePath, run);
    if (samePath(this.#activeSourcePath, run.sourcePath)) {
      this.#activeOutcome = run;
    }
    this.#emit();
    return run;
  }

  forgetOutcome(sourcePath) {
    const changed = this.#deleteBySource(this.#outcomes, sourcePath);
    if (samePath(this.#activeOutcome?.sourcePath, sourcePath)) {
      this.#activeOutcome = null;
    }
    if (changed) this.#emit();
    return changed;
  }

  outcomeForSource(sourcePath) {
    return this.#findBySource(this.#outcomes, sourcePath);
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

    const copiedHandoff = this.#findBySource(
      this.#copiedHandoffs,
      previousSourcePath,
    );
    this.#deleteBySource(this.#copiedHandoffs, previousSourcePath);
    if (copiedHandoff) {
      this.#copiedHandoffs.set(nextSourcePath, {
        ...copiedHandoff,
        sourcePath: nextSourcePath,
      });
    }

    const recoveredRun = this.#findBySource(
      this.#recoveredRuns,
      previousSourcePath,
    );
    this.#deleteBySource(this.#recoveredRuns, previousSourcePath);
    if (recoveredRun) {
      this.#recoveredRuns.set(nextSourcePath, {
        ...recoveredRun,
        sourcePath: nextSourcePath,
      });
    }

    const trackedResult = this.resultForSource(previousSourcePath);
    this.#deleteBySource(this.#results, previousSourcePath);
    if (trackedResult) this.#results.set(nextSourcePath, trackedResult);

    const trackedOutcome = this.outcomeForSource(previousSourcePath);
    this.#deleteBySource(this.#outcomes, previousSourcePath);
    const nextOutcome = trackedOutcome
      ? { ...trackedOutcome, sourcePath: nextSourcePath }
      : null;
    if (nextOutcome) this.#outcomes.set(nextSourcePath, nextOutcome);

    if (samePath(this.#activeSourcePath, previousSourcePath)) {
      this.#activeSourcePath = nextSourcePath;
      this.#activeRun = nextRun;
      this.#activeHandoff = nextHandoff;
      this.#activeOutcome = nextOutcome;
    } else {
      if (samePath(this.#activeRun?.sourcePath, previousSourcePath)) {
        this.#activeRun = nextRun;
      }
      if (samePath(this.#activeHandoff?.sourcePath, previousSourcePath)) {
        this.#activeHandoff = nextHandoff;
      }
      if (samePath(this.#activeOutcome?.sourcePath, previousSourcePath)) {
        this.#activeOutcome = nextOutcome;
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

  get activeHandoffMayBeRunning() {
    if (!this.#activeRun) return false;
    return this.#matchesTrackedRun(this.#copiedHandoffs, this.#activeRun)
      || (
        this.#activeRun.status === "processing"
        && this.#matchesTrackedRun(this.#recoveredRuns, this.#activeRun)
      );
  }

  get runs() {
    return Object.freeze([...this.#runs.values()]);
  }

  get snapshot() {
    return Object.freeze({
      activeSourcePath: this.#activeSourcePath,
      activeRun: this.#activeRun,
      activeHandoff: this.#activeHandoff,
      activeHandoffMayBeRunning: this.activeHandoffMayBeRunning,
      recentOutcome: this.#activeOutcome,
      backgroundResults: frozenEntries(this.#results),
    });
  }
}
