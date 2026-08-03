import { ProjectQueryFence } from "./project-query-fence.js";

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

function copyContext(value) {
  if (
    !value
    || !Number.isSafeInteger(Number(value.epoch))
    || !String(value.projectId || "")
    || !String(value.documentId || "")
    || !String(value.sourcePath || "")
  ) return null;
  return Object.freeze({
    epoch: Number(value.epoch),
    projectId: String(value.projectId),
    documentId: String(value.documentId),
    sourcePath: String(value.sourcePath),
  });
}

export class ProjectSession {
  #epoch = 0;

  #sourcePath = null;

  #projectId = "";

  #documentId = "";

  #observer = null;

  #queries = new ProjectQueryFence();

  setObserver(observer) {
    this.#observer = typeof observer === "function" ? observer : null;
  }

  #emit() {
    try {
      this.#observer?.(this.snapshot);
    } catch {
      // A view observer cannot change project identity authority.
    }
  }

  openLocator(sourcePath) {
    this.#queries.clear();
    this.#epoch += 1;
    this.#sourcePath = normalizedPath(sourcePath);
    this.#projectId = "";
    this.#documentId = "";
    this.#emit();
    return this.locator;
  }

  register({
    epoch,
    sourcePath,
    projectId,
    documentId,
  }) {
    if (
      Number(epoch) !== this.#epoch
      || !samePath(sourcePath, this.#sourcePath)
      || !String(projectId || "")
      || !String(documentId || "")
      || !this.#sourcePath
    ) return null;
    this.#projectId = String(projectId);
    this.#documentId = String(documentId);
    this.#emit();
    return this.context;
  }

  transitionSource({
    previousSourcePath,
    sourcePath,
    projectId = this.#projectId,
    documentId = this.#documentId,
  }) {
    const nextSourcePath = normalizedPath(sourcePath);
    if (
      !nextSourcePath
      || (
        previousSourcePath
        && !samePath(previousSourcePath, this.#sourcePath)
      )
    ) return null;
    this.#queries.clear();
    this.#epoch += 1;
    this.#sourcePath = nextSourcePath;
    this.#projectId = String(projectId || "");
    this.#documentId = String(documentId || "");
    this.#emit();
    return this.#projectId && this.#documentId ? this.context : this.locator;
  }

  matches(context) {
    const candidate = copyContext(context);
    return Boolean(
      candidate
      && candidate.epoch === this.#epoch
      && samePath(candidate.sourcePath, this.#sourcePath)
      && candidate.projectId === this.#projectId
      && candidate.documentId === this.#documentId,
    );
  }

  matchesLocator({ epoch, sourcePath }) {
    return Number(epoch) === this.#epoch
      && samePath(sourcePath, this.#sourcePath);
  }

  beginQuery(name, { sourcePath = this.#sourcePath } = {}) {
    const identity = {
      epoch: this.#epoch,
      projectId: this.#projectId,
      documentId: this.#documentId,
      sourcePath: normalizedPath(sourcePath) || "",
    };
    return Object.freeze({
      identity,
      ticket: this.#queries.begin(identity, name),
    });
  }

  isQueryCurrent(query) {
    return Boolean(
      query
      && this.#queries.isCurrent(query.ticket)
      && this.matchesLocator(query.identity),
    );
  }

  get locator() {
    return Object.freeze({
      epoch: this.#epoch,
      sourcePath: this.#sourcePath,
    });
  }

  get context() {
    if (!this.#sourcePath || !this.#projectId || !this.#documentId) return null;
    return Object.freeze({
      epoch: this.#epoch,
      projectId: this.#projectId,
      documentId: this.#documentId,
      sourcePath: this.#sourcePath,
    });
  }

  get snapshot() {
    return Object.freeze({
      epoch: this.#epoch,
      sourcePath: this.#sourcePath,
      projectId: this.#projectId,
      documentId: this.#documentId,
      registered: Boolean(this.context),
    });
  }

  get epoch() {
    return this.#epoch;
  }

  get sourcePath() {
    return this.#sourcePath;
  }

  get projectId() {
    return this.#projectId;
  }

  get documentId() {
    return this.#documentId;
  }
}
