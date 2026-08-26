function rejected(code, reason) {
  return Object.freeze({ status: "rejected", code, reason });
}

function succeeded(value = {}) {
  return Object.freeze({ status: "succeeded", value: Object.freeze(value) });
}

export class WorkbenchTabsWorkflow {
  #session;
  #controller;
  #setTimer;
  #clearTimer;
  #operation = null;

  constructor({
    session,
    controller,
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
  }) {
    if (!session || !controller) throw new TypeError("tabs workflow requires session and controller");
    this.#session = session;
    this.#controller = controller;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  async activate(tabId, { deadlineMs = 15_000 } = {}) {
    if (this.#operation) return rejected("WORKBENCH_TAB_SWITCH_BUSY", "另一个标签页正在打开。");
    const operation = { kind: "activate", tabId };
    this.#operation = operation;
    try {
      return await this.#activate(tabId, { deadlineMs });
    } finally {
      if (this.#operation === operation) this.#operation = null;
    }
  }

  async #activate(tabId, { deadlineMs }) {
    const target = this.#session.snapshot.tabs.find((tab) => tab.tabId === tabId);
    if (!target) return rejected("WORKBENCH_TAB_NOT_FOUND", "这个标签页已经关闭。");
    if (target.tabId === this.#session.snapshot.activeTabId) return succeeded({ unchanged: true });
    this.#session.beginSwitch(tabId);
    if (target.kind === "start") {
      // Start is a real navigation target. It uses ProjectWorkflow's complete
      // prepareSwitch boundary so native edit/IME fencing, drains and Canvas
      // verification remain canonical even though no new project is opened.
      const prepared = await this.#controller.prepareProjectSwitch();
      if (prepared?.status !== "succeeded") {
        this.#session.cancelSwitch(tabId);
        return rejected(
          prepared?.code || "WORKBENCH_TAB_SWITCH_BLOCKED",
          String(prepared?.reason || "当前 HTML 尚未安全收口。"),
        );
      }
      const committed = this.#session.commitStart(tabId);
      return committed
        ? succeeded({ tabId })
        : rejected("WORKBENCH_TAB_COMMIT_REJECTED", "标签页状态已变化，没有离开当前 HTML。");
    }

    // ProjectWorkflow.openProject(kind=registered) owns the canonical
    // prepareSwitch -> DrainCoordinator -> Canvas fence. Tabs add no second
    // drain owner; they wait for that workflow and the resulting identity.
    const beforeEpoch = this.#controller.getSnapshot()?.projectSession?.epoch;
    const published = this.#waitForDocument(target, deadlineMs, { afterEpoch: beforeEpoch });
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
    if (identity.failed) {
      this.#session.cancelSwitch(tabId);
      return rejected(
        "WORKBENCH_TAB_OPEN_REJECTED",
        identity.reason || "这个 HTML 没有完成权威读取。",
      );
    }
    const committed = this.#session.commitDocument({
      tabId,
      projectId: identity.projectId,
      documentId: identity.documentId,
      title: target.title,
    });
    if (!committed) {
      return rejected("WORKBENCH_TAB_COMMIT_REJECTED", "HTML 已打开，但标签页身份已变化。");
    }
    // Committing the verified identity mounts the shared ContentOutlet so the
    // authoritative hydration can perform its Canvas acknowledgement. Keep
    // this operation locked until that acknowledgement and FIFO application
    // settle; close or a second activation must not race that interval.
    const settledPublication = this.#waitForDocument(target, deadlineMs, {
      afterEpoch: beforeEpoch,
      requireSettled: true,
    });
    const settled = await settledPublication.promise;
    if (!settled) {
      return rejected(
        "WORKBENCH_TAB_OPEN_TIMEOUT",
        "HTML 已进入当前标签，但权威读取和画布核对未在时限内完成。",
      );
    }
    if (settled.failed) {
      return rejected(
        "WORKBENCH_TAB_OPEN_REJECTED",
        settled.reason || "这个 HTML 没有完成权威读取。",
      );
    }
    return succeeded({ tabId });
  }

  async createStart() {
    if (this.#operation) return rejected("WORKBENCH_TAB_SWITCH_BUSY", "另一个标签页正在打开。");
    const operation = { kind: "create-start" };
    this.#operation = operation;
    try {
      const before = new Set(this.#session.snapshot.tabs.map((tab) => tab.tabId));
      this.#session.createStart({ focus: false });
      const created = this.#session.snapshot.tabs.find((tab) => !before.has(tab.tabId));
      return created
        ? this.#activate(created.tabId, { deadlineMs: 15_000 })
        : rejected("WORKBENCH_START_CREATE_FAILED", "无法创建新标签页。");
    } finally {
      if (this.#operation === operation) this.#operation = null;
    }
  }

  async close(tabId) {
    if (this.#operation) return rejected("WORKBENCH_TAB_SWITCH_BUSY", "标签页正在切换，请稍后再关闭。");
    const operation = { kind: "close", tabId };
    this.#operation = operation;
    try {
      return await this.#close(tabId);
    } finally {
      if (this.#operation === operation) this.#operation = null;
    }
  }

  async #close(tabId) {
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
    const activated = await this.#activate(next.tabId, { deadlineMs: 15_000 });
    if (activated.status !== "succeeded") return activated;
    if (this.#session.snapshot.activeTabId !== next.tabId) {
      return rejected("WORKBENCH_TAB_CLOSE_INVARIANT", "新标签页尚未完成身份核对，原标签页未关闭。");
    }
    this.#session.close(tabId);
    return succeeded({ tabId, activeTabId: next.tabId });
  }

  restorePending() {
    const pending = this.#session.snapshot.pendingTabId;
    return pending ? this.activate(pending) : Promise.resolve(succeeded({ unchanged: true }));
  }

  #waitForDocument(target, deadlineMs, { afterEpoch, requireSettled = false } = {}) {
    let settled = false;
    let timer = null;
    let unsubscribe = () => {};
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
      const inspect = (snapshot) => {
        const project = snapshot?.projectSession;
        if (project?.projectId !== target.projectId || project.documentId !== target.documentId) return;
        if (
          Number.isSafeInteger(afterEpoch)
          && Number.isSafeInteger(project.epoch)
          && project.epoch <= afterEpoch
        ) return;
        const hydration = snapshot?.project?.hydration;
        if (hydration?.phase === "failed") {
          settled = true;
          if (timer !== null) this.#clearTimer(timer);
          unsubscribe();
          resolve({ failed: true, reason: hydration.error });
          return;
        }
        if (requireSettled) {
          // Identity is necessary but not sufficient: after ContentOutlet is
          // mounted, the shared Controller must finish source hydration and
          // Canvas verification before another navigation can unmount it.
          if (hydration && hydration.phase !== "idle") return;
          if (
            snapshot?.project?.projectApplication
            && snapshot.project.projectApplication.status !== "idle"
          ) return;
        }
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
