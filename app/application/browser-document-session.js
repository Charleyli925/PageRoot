function documentKey(projectId, documentId) {
  return `${projectId}\u0000${documentId}`;
}

function normalizeProject(project) {
  if (!project || typeof project !== "object" || Array.isArray(project)) {
    throw new TypeError("browser document project is required");
  }
  const projectId = String(project.projectId || "");
  const documentId = String(project.documentId || "");
  const name = String(project.name || "").trim();
  const html = typeof project.html === "string" ? project.html : null;
  const sha256 = String(project.sha256 || "");
  if (
    !/^project_[A-Za-z0-9_-]+$/u.test(projectId)
    || !/^doc_[A-Za-z0-9_-]+$/u.test(documentId)
    || !name
    || html === null
    || !/^sha256:[a-f0-9]{64}$/u.test(sha256)
    || project.sourcePath !== null
  ) {
    throw new TypeError("browser document requires frozen identity, HTML and Hash");
  }
  return Object.freeze({
    ...project,
    projectId,
    documentId,
    name,
    sourcePath: null,
    html,
    sha256,
  });
}

export class BrowserDocumentSession {
  #documents = new Map();

  get size() {
    return this.#documents.size;
  }

  retain(project) {
    const frozen = normalizeProject(project);
    const key = documentKey(frozen.projectId, frozen.documentId);
    const authority = Object.freeze({
      key,
      previous: this.#documents.get(key) || null,
    });
    this.#documents.set(key, frozen);
    return authority;
  }

  restore(authority) {
    const key = String(authority?.key || "");
    if (!key) return false;
    if (authority.previous) this.#documents.set(key, authority.previous);
    else this.#documents.delete(key);
    return true;
  }

  resolve(projectId, documentId) {
    return this.#documents.get(documentKey(projectId, documentId)) || null;
  }

  remove(projectId, documentId) {
    return this.#documents.delete(documentKey(projectId, documentId));
  }

  dispose() {
    this.#documents.clear();
  }
}
