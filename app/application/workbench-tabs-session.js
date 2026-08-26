const MAX_TABS = 24;
const STATUS = new Set(["normal", "processing", "review-ready", "error", "opening"]);

function documentKey(projectId, documentId) {
  return `${projectId}\u0000${documentId}`;
}

function freezeTab(tab) {
  return Object.freeze({ ...tab });
}

function startTab(tabId = "start:1") {
  return freezeTab({
    tabId,
    kind: "start",
    title: "开始",
    status: "normal",
  });
}

function normalizedDocumentTab(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const projectId = String(value.projectId || "");
  const documentId = String(value.documentId || "");
  const tabId = String(value.tabId || "");
  const title = String(value.title || "").trim();
  if (
    !/^project_[A-Za-z0-9_-]+$/.test(projectId)
    || !/^doc_[A-Za-z0-9_-]+$/.test(documentId)
    || !/^[A-Za-z0-9:_-]{1,240}$/.test(tabId)
    || !title
    || title.length > 180
  ) return null;
  return freezeTab({
    tabId,
    kind: "document",
    projectId,
    documentId,
    title,
    status: STATUS.has(value.status) ? value.status : "normal",
  });
}

function frozenSnapshot({
  revision,
  tabs,
  activeTabId,
  pendingTabId,
  mountedDocumentTabId,
  runtimeOwnerTabId,
}) {
  return Object.freeze({
    revision,
    tabs: Object.freeze(tabs.map(freezeTab)),
    activeTabId,
    pendingTabId,
    mountedDocumentTabId,
    runtimeOwnerTabId: runtimeOwnerTabId ?? null,
  });
}

export class WorkbenchTabsSession {
  #listeners = new Set();
  #pendingPriorStatus = null;
  #snapshot = frozenSnapshot({
    revision: 0,
    tabs: [startTab()],
    activeTabId: "start:1",
    pendingTabId: null,
    mountedDocumentTabId: null,
    runtimeOwnerTabId: null,
  });

  get snapshot() {
    return this.#snapshot;
  }

  subscribe(listener) {
    if (typeof listener !== "function") throw new TypeError("tabs listener is required");
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #publish(next) {
    this.#snapshot = frozenSnapshot({
      ...next,
      revision: this.#snapshot.revision + 1,
    });
    for (const listener of this.#listeners) listener(this.#snapshot);
    return this.#snapshot;
  }

  hydrate(value) {
    const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
    const seenTabs = new Set();
    const seenDocuments = new Set();
    const tabs = [];
    for (const candidate of Array.isArray(source.tabs) ? source.tabs : []) {
      const tab = normalizedDocumentTab({ ...candidate, title: "HTML" });
      if (!tab || seenTabs.has(tab.tabId)) continue;
      const key = documentKey(tab.projectId, tab.documentId);
      if (seenDocuments.has(key)) continue;
      seenTabs.add(tab.tabId);
      seenDocuments.add(key);
      tabs.push(tab);
      // The synthetic start page also occupies a tab slot after hydration.
      if (tabs.length >= MAX_TABS - 1) break;
    }
    const start = startTab();
    tabs.unshift(start);
    const requestedActive = String(source.activeTabId || "");
    const pendingTabId = tabs.some(
      (tab) => tab.kind === "document" && tab.tabId === requestedActive,
    ) ? requestedActive : null;
    return this.#publish({
      tabs,
      activeTabId: start.tabId,
      pendingTabId,
      mountedDocumentTabId: null,
      runtimeOwnerTabId: null,
    });
  }

  createStart({ focus = true } = {}) {
    if (this.#snapshot.tabs.length >= MAX_TABS) return null;
    let sequence = 1;
    const ids = new Set(this.#snapshot.tabs.map((tab) => tab.tabId));
    while (ids.has(`start:${sequence}`)) sequence += 1;
    const tab = startTab(`start:${sequence}`);
    const tabs = [...this.#snapshot.tabs, tab];
    return this.#publish({
      tabs,
      activeTabId: focus ? tab.tabId : this.#snapshot.activeTabId,
      pendingTabId: null,
      mountedDocumentTabId: focus ? null : this.#snapshot.mountedDocumentTabId,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
    });
  }

  bindDocument({ projectId, documentId, title, status = "normal", focus = true }) {
    const tab = normalizedDocumentTab({
      tabId: `document:${projectId}:${documentId}`,
      projectId,
      documentId,
      title,
      status,
    });
    if (!tab) throw new TypeError("valid project/document tab identity is required");
    const existingIndex = this.#snapshot.tabs.findIndex((item) => (
      item.kind === "document"
      && item.projectId === tab.projectId
      && item.documentId === tab.documentId
    ));
    const tabs = [...this.#snapshot.tabs];
    const resolved = existingIndex >= 0
      ? freezeTab({ ...tabs[existingIndex], title: tab.title, status: tab.status })
      : tab;
    if (existingIndex >= 0) tabs[existingIndex] = resolved;
    else tabs.push(resolved);
    const shouldFocus = focus || this.#snapshot.pendingTabId === resolved.tabId;
    return this.#publish({
      tabs,
      activeTabId: shouldFocus ? resolved.tabId : this.#snapshot.activeTabId,
      pendingTabId: shouldFocus ? null : this.#snapshot.pendingTabId,
      mountedDocumentTabId: shouldFocus
        ? resolved.tabId
        : this.#snapshot.mountedDocumentTabId,
      runtimeOwnerTabId: resolved.tabId,
    });
  }

  stageDocument({ projectId, documentId, title, status = "normal" }) {
    const tab = normalizedDocumentTab({
      tabId: `document:${projectId}:${documentId}`,
      projectId,
      documentId,
      title,
      status,
    });
    if (!tab) throw new TypeError("valid project/document tab identity is required");
    const existing = this.#snapshot.tabs.find((item) => (
      item.kind === "document"
      && item.projectId === projectId
      && item.documentId === documentId
    ));
    if (existing) return existing;
    if (this.#snapshot.tabs.length >= MAX_TABS) return null;
    this.#publish({ ...this.#snapshot, tabs: [...this.#snapshot.tabs, tab] });
    return tab;
  }

  beginSwitch(tabId) {
    const target = this.#snapshot.tabs.find((tab) => tab.tabId === tabId);
    if (!target) return null;
    if (target.kind === "start") return this.#publish({
      ...this.#snapshot,
      pendingTabId: target.tabId,
    });
    if (target.tabId === this.#snapshot.activeTabId) return this.#snapshot;
    this.#pendingPriorStatus = target.status;
    return this.#publish({
      ...this.#snapshot,
      tabs: this.#snapshot.tabs.map((tab) => (
        tab.tabId === target.tabId ? freezeTab({ ...tab, status: "opening" }) : tab
      )),
      pendingTabId: target.tabId,
    });
  }

  commitStart(tabId) {
    const target = this.#snapshot.tabs.find((tab) => tab.tabId === tabId && tab.kind === "start");
    if (!target || this.#snapshot.pendingTabId !== tabId) return null;
    this.#pendingPriorStatus = null;
    return this.#publish({
      ...this.#snapshot,
      activeTabId: tabId,
      pendingTabId: null,
      mountedDocumentTabId: null,
    });
  }

  commitDocument({ tabId, projectId, documentId, title }) {
    const target = this.#snapshot.tabs.find((tab) => tab.tabId === tabId && tab.kind === "document");
    if (
      !target || target.projectId !== projectId || target.documentId !== documentId
      || this.#snapshot.pendingTabId !== tabId
    ) return null;
    this.#pendingPriorStatus = null;
    return this.#publish({
      ...this.#snapshot,
      tabs: this.#snapshot.tabs.map((tab) => tab.tabId === tabId
        ? freezeTab({ ...tab, title: String(title || tab.title), status: "normal" })
        : tab),
      activeTabId: tabId,
      pendingTabId: null,
      mountedDocumentTabId: tabId,
      runtimeOwnerTabId: tabId,
    });
  }

  cancelSwitch(tabId) {
    if (this.#snapshot.pendingTabId !== tabId) return this.#snapshot;
    const priorStatus = this.#pendingPriorStatus;
    this.#pendingPriorStatus = null;
    return this.#publish({
      ...this.#snapshot,
      tabs: this.#snapshot.tabs.map((tab) => (
        tab.tabId === tabId && tab.status === "opening"
          ? freezeTab({ ...tab, status: STATUS.has(priorStatus) ? priorStatus : "normal" })
          : tab
      )),
      pendingTabId: null,
    });
  }

  updateStatus(projectId, documentId, status) {
    if (!STATUS.has(status)) return this.#snapshot;
    let changed = false;
    const tabs = this.#snapshot.tabs.map((tab) => {
      if (
        tab.kind !== "document"
        || tab.projectId !== projectId
        || tab.documentId !== documentId
        || tab.status === status
      ) return tab;
      changed = true;
      return freezeTab({ ...tab, status });
    });
    return changed ? this.#publish({ ...this.#snapshot, tabs }) : this.#snapshot;
  }

  close(tabId) {
    const index = this.#snapshot.tabs.findIndex((tab) => tab.tabId === tabId);
    if (index < 0) return Object.freeze({ snapshot: this.#snapshot, nextTabId: null });
    const tabs = this.#snapshot.tabs.filter((tab) => tab.tabId !== tabId);
    if (!tabs.length) tabs.push(startTab());
    const wasActive = this.#snapshot.activeTabId === tabId;
    const next = wasActive ? tabs[Math.min(index, tabs.length - 1)] : null;
    const snapshot = this.#publish({
      tabs,
      activeTabId: wasActive ? next.tabId : this.#snapshot.activeTabId,
      pendingTabId: this.#snapshot.pendingTabId === tabId ? null : this.#snapshot.pendingTabId,
      mountedDocumentTabId: wasActive
        ? (next.kind === "document" ? null : null)
        : this.#snapshot.mountedDocumentTabId,
      runtimeOwnerTabId: this.#snapshot.runtimeOwnerTabId,
    });
    return Object.freeze({ snapshot, nextTabId: next?.tabId || null });
  }

  serialize() {
    return Object.freeze({
      version: 1,
      activeTabId: this.#snapshot.tabs.find((tab) => (
        tab.tabId === this.#snapshot.activeTabId && tab.kind === "document"
      )) ? this.#snapshot.activeTabId : null,
      tabs: Object.freeze(this.#snapshot.tabs
        .filter((tab) => tab.kind === "document")
        .map((tab) => Object.freeze({
          tabId: tab.tabId,
          projectId: tab.projectId,
          documentId: tab.documentId,
        }))),
    });
  }
}

export function createWorkbenchTabsSession() {
  return new WorkbenchTabsSession();
}
