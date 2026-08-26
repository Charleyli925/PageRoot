function rejected(code, reason) {
  return Object.freeze({ status: "rejected", code, reason });
}

function succeeded(value = {}) {
  return Object.freeze({ status: "succeeded", value: Object.freeze(value) });
}

export class WorkbenchTabsWorkflow {
  #session;
  #controller;
  #now;
  #setTimer;
  #clearTimer;
  #operation = null;

  constructor({
    session,
    controller,
    now = Date.now,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
  }) {
    if (!session || !controller) throw new TypeError("tabs workflow requires session and controller");
    this.#session = session;
    this.#controller = controller;
    this.#now = now;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  async activate(tabId, { deadlineMs = 15_000 } = {}) {
    if (this.#operation) return rejected("WORKBENCH_TAB_SWITCH_BUSY", "另一个标签页正在打开。");
    const target = this.#session.snapshot.tabs.find((tab) => tab.tabId === tabId);
    if (!target) return rejected("WORKBENCH_TAB_NOT_FOUND", "这个标签页已经关闭。");
    if (target.tabId === this.#session.snapshot.activeTabId) return succeeded({ unchanged: true });
    this.#session.beginSwitch(tabId);
    const operation = { tabId };
    this.#operation = operation;
    try {
      if (target.kind === "start") {
        const drained = await this.#controller.drainBoundary("switch", {
          deadlineAt: this.#now() + deadlineMs,
        });
        if (!drained?.ok) {
          this.#session.cancelSwitch(tabId);
          return rejected(
            "WORKBENCH_TAB_DRAIN_BLOCKED",
            String(drained?.reason || "当前 HTML 尚未安全收口。"),
          );
        }
        this.#session.commitStart(tabId);
        return succeeded({ tabId });
      }

      // ProjectWorkflow.openProject(kind=registered) owns the canonical
      // prepareSwitch -> DrainCoordinator -> Canvas fence. Tabs add no second
      // drain owner; they wait for that workflow and the resulting identity.
      const published = this.#waitForDocument(target, deadlineMs);
      const opened = await this.#controller.openProject({
        kind: "registered",
        projectId: target.projectId,
      });
      if (opened?.status !== "succeeded") {
        published.cancel();
        this.#session.cancelSwitch(tabId);
        return rejected(
          opened?.code || "WORKBENCH_TAB_OPEN_REJECTED",
          String(opened?.reason || "这个 HTML 没有安全打开。"),
        );
      }
      const identity = await published.promise;
      if (!identity) {
        this.#session.cancelSwitch(tabId);
        return rejected("WORKBENCH_TAB_OPEN_TIMEOUT", "项目已接收打开请求，但身份核对未在时限内完成。");
      }
      this.#session.commitDocument({
        tabId,
        projectId: identity.projectId,
        documentId: identity.documentId,
        title: target.title,
      });
      return succeeded({ tabId });
    } finally {
      if (this.#operation === operation) this.#operation = null;
    }
  }

  async createStart() {
    const before = new Set(this.#session.snapshot.tabs.map((tab) => tab.tabId));
    this.#session.createStart({ focus: false });
    const created = this.#session.snapshot.tabs.find((tab) => !before.has(tab.tabId));
    return created ? this.activate(created.tabId) : rejected("WORKBENCH_START_CREATE_FAILED", "无法创建新标签页。");
  }

  async close(tabId) {
    const snapshot = this.#session.snapshot;
    const index = snapshot.tabs.findIndex((tab) => tab.tabId === tabId);
    if (index < 0) return succeeded({ unchanged: true });
    if (snapshot.activeTabId !== tabId) {
      this.#session.close(tabId);
      return succeeded({ tabId });
    }
    let next = snapshot.tabs[index + 1] || snapshot.tabs[index - 1] || null;
    if (!next) {
      const before = new Set(snapshot.tabs.map((tab) => tab.tabId));
      this.#session.createStart({ focus: false });
      next = this.#session.snapshot.tabs.find((tab) => !before.has(tab.tabId)) || null;
    }
    if (!next) return rejected("WORKBENCH_TAB_CLOSE_FAILED", "无法安全关闭这个标签页。");
    const activated = await this.activate(next.tabId);
    if (activated.status !== "succeeded") return activated;
    this.#session.close(tabId);
    return succeeded({ tabId, activeTabId: next.tabId });
  }

  restorePending() {
    const pending = this.#session.snapshot.pendingTabId;
    return pending ? this.activate(pending) : Promise.resolve(succeeded({ unchanged: true }));
  }

  #waitForDocument(target, deadlineMs) {
    let settled = false;
    let timer = null;
    let unsubscribe = () => {};
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
      const inspect = (snapshot) => {
        const project = snapshot?.projectSession;
        if (project?.projectId !== target.projectId || project.documentId !== target.documentId) return;
        settled = true;
        if (timer !== null) this.#clearTimer(timer);
        unsubscribe();
        resolve({ projectId: project.projectId, documentId: project.documentId });
      };
      unsubscribe = this.#controller.subscribe(inspect);
      inspect(this.#controller.getSnapshot());
      if (!settled) {
        timer = this.#setTimer(() => {
          settled = true;
          unsubscribe();
          resolve(null);
        }, deadlineMs);
      }
    });
    return {
      promise,
      cancel: () => {
        if (settled) return;
        settled = true;
        if (timer !== null) this.#clearTimer(timer);
        unsubscribe();
        resolvePromise(null);
      },
    };
  }
}
