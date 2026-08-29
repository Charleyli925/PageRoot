import { performance as nodePerformance } from "node:perf_hooks";

const TIMING_FIELDS = Object.freeze([
  "repositoryQueueWaitMs",
  "recoveryMs",
  "registryResolveMs",
  "projectReloadMs",
  "workingCopyScanMs",
  "workingCopyReconcileMs",
  "workingCopyIdentityMs",
  "stateFilesReadMs",
  "sourceReadMs",
  "workspaceSerializeMs",
  "workspaceTotalMs",
]);

function finiteMilliseconds(value) {
  const milliseconds = Number(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return 0;
  return Math.round(milliseconds * 1_000) / 1_000;
}

/**
 * Per-call diagnostic timer for ProjectFileRepository.workspace(). It owns no
 * Repository facts and cannot influence queue ordering or operation results.
 */
export class WorkspacePerformanceTiming {
  #now;

  #enqueuedAt;

  #checkpointAt;

  #values = Object.create(null);

  constructor({ now = () => nodePerformance.now() } = {}) {
    if (typeof now !== "function") {
      throw new TypeError("WorkspacePerformanceTiming requires a monotonic clock.");
    }
    this.#now = now;
    this.#enqueuedAt = this.#readNow();
    this.#checkpointAt = this.#enqueuedAt;
    for (const field of TIMING_FIELDS) this.#values[field] = 0;
  }

  markDequeued() {
    const dequeuedAt = this.#readNow();
    this.#values.repositoryQueueWaitMs = Math.max(0, dequeuedAt - this.#enqueuedAt);
    this.#checkpointAt = dequeuedAt;
  }

  checkpoint(field) {
    if (!TIMING_FIELDS.includes(field) || [
      "repositoryQueueWaitMs",
      "workspaceTotalMs",
    ].includes(field)) {
      throw new TypeError(`Unsupported workspace timing checkpoint: ${field}`);
    }
    const checkpointAt = this.#readNow();
    this.#values[field] += Math.max(0, checkpointAt - this.#checkpointAt);
    this.#checkpointAt = checkpointAt;
  }

  async measure(field, operation) {
    if (!TIMING_FIELDS.includes(field) || field === "repositoryQueueWaitMs") {
      throw new TypeError(`Unsupported workspace timing field: ${field}`);
    }
    if (typeof operation !== "function") {
      throw new TypeError("Workspace timing operation must be a function.");
    }
    const startedAt = this.#readNow();
    try {
      return await operation();
    } finally {
      this.#values[field] += this.#elapsedSince(startedAt);
    }
  }

  measureSync(field, operation) {
    if (!TIMING_FIELDS.includes(field) || field === "repositoryQueueWaitMs") {
      throw new TypeError(`Unsupported workspace timing field: ${field}`);
    }
    if (typeof operation !== "function") {
      throw new TypeError("Workspace timing operation must be a function.");
    }
    const startedAt = this.#readNow();
    try {
      return operation();
    } finally {
      this.#values[field] += this.#elapsedSince(startedAt);
    }
  }

  snapshot() {
    this.#values.workspaceTotalMs = this.#elapsedSince(this.#enqueuedAt);
    return Object.freeze(Object.fromEntries(
      TIMING_FIELDS.map((field) => [field, finiteMilliseconds(this.#values[field])]),
    ));
  }

  #readNow() {
    const value = Number(this.#now());
    if (!Number.isFinite(value)) {
      throw new TypeError("Workspace performance clock returned a non-finite value.");
    }
    return value;
  }

  #elapsedSince(startedAt) {
    return Math.max(0, this.#readNow() - startedAt);
  }
}

export { TIMING_FIELDS as WORKSPACE_PERFORMANCE_TIMING_FIELDS };
