import { projectAppliedEventToWorkbenchTabs } from "./workbench-tabs-session.js";

function rejected(code, reason, details = {}) {
  return Object.freeze({ status: "rejected", code, reason, ...details });
}

function succeeded(value = {}) {
  return Object.freeze({ status: "succeeded", value: Object.freeze(value) });
}

function outcomeError(outcome, fallbackCode, fallbackReason) {
  return Object.freeze({
    code: String(outcome?.code || fallbackCode),
    reason: String(outcome?.reason || fallbackReason),
  });
}

function transactionId(ordinal, now) {
  return `workbench-navigation-${Math.max(0, Number(now) || 0).toString(36)}-${ordinal.toString(36)}`;
}

export function workbenchStartupPriority({
  externalRequestCount = 0,
  persistedStatePresent = false,
  persistedActiveTabId = null,
} = {}) {
  if (Number(externalRequestCount) > 0) return "external";
  if (persistedStatePresent && persistedActiveTabId) return "persisted-active-tab";
  if (!persistedStatePresent) return "active-path-compatibility";
  return "start";
}

export function workbenchNavigationOutcomeHasCommittedDocument(outcome) {
  return Boolean(
    outcome
    && outcome.status === "rejected"
    && outcome.committed === true
    && typeof outcome.tabId === "string"
    && outcome.tabId,
  );
}

export class WorkbenchNavigationWorkflow {
  #session;
  #tabs;
  #surfaceCache;
  #projectWorkflow;
  #controller;
  #browserDocuments;
  #tabsPersistence;
  #clock;
  #setTimer;
  #clearTimer;
  #admissionTail = Promise.resolve();
  #busy = false;
  #active = null;
  #ordinal = 0;
  #disposed = false;
  #terminalReceipts = new Map();
  #idleWaiters = new Set();
  #closeFreeze = null;

  constructor({
    session,
    tabs,
    surfaceCache = null,
    projectWorkflow,
    controller,
    browserDocuments = null,
    tabsPersistence = null,
    clock = { now: Date.now },
    setTimer = (callback, delay) => setTimeout(callback, delay),
    clearTimer = (timer) => clearTimeout(timer),
  }) {
    if (!session || !tabs || !projectWorkflow || !controller) {
      throw new TypeError("navigation workflow requires session, tabs, project workflow and controller");
    }
    this.#session = session;
    this.#tabs = tabs;
    this.#surfaceCache = surfaceCache;
    this.#projectWorkflow = projectWorkflow;
    this.#controller = controller;
    this.#browserDocuments = browserDocuments;
    this.#tabsPersistence = tabsPersistence;
    this.#clock = clock;
    this.#setTimer = setTimer;
    this.#clearTimer = clearTimer;
  }

  openProject(input = {}) {
    const kind = String(input.kind || "local");
    const pickerId = kind === "local" && !input.sourcePath
      ? this.#projectWorkflow.requestBrowserFilePicker?.() || null
      : null;
    if (pickerId) {
      if (
        this.#active?.continuation === "browser-file"
        && this.#session.snapshot.phase === "awaiting-user"
      ) {
        return Promise.resolve(succeeded({ operationId: pickerId, awaitingFile: true }));
      }
      return this.#admit({ kind, sourcePath: null }, (active) => {
        active.continuation = "browser-file";
        this.#session.transition(active.transactionId, "preparing");
        this.#session.transition(active.transactionId, "opening");
        this.#session.transition(active.transactionId, "awaiting-user");
        return {
          suspended: true,
          outcome: succeeded({ operationId: pickerId, awaitingFile: true }),
        };
      });
    }
    if (
      kind === "local"
      && this.#active?.continuation === "browser-file"
      && this.#session.snapshot.phase === "awaiting-user"
    ) {
      this.#rollbackAndRelease(this.#active, null);
    }
    return this.#admit({ kind, sourcePath: input.sourcePath || null }, (active) => (
      this.#openProject(active, input)
    ));
  }

  activateTab(tabId, input = {}) {
    return this.#admit({
      kind: input.intentKind || "tab-activation",
      tabId: String(tabId || ""),
    }, (active) => this.#activateTab(active, tabId, input));
  }

  openRegisteredProject(input) {
    return this.#admit({
      kind: "registered-sidebar",
      projectId: String(input?.projectId || ""),
      documentId: String(input?.documentId || ""),
    }, async (active) => {
      const tab = this.#tabs.stageDocument(input);
      if (!tab) {
        return { outcome: rejected(
          "WORKBENCH_TAB_SWITCH_BUSY",
          "另一个开始标签正在打开 HTML，请稍后重试。",
        ) };
      }
      return this.#activateTab(active, tab.tabId, input);
    });
  }

  createStart() {
    return this.#admit({ kind: "create-start" }, async (active) => {
      const before = new Set(this.#tabs.snapshot.tabs.map((tab) => tab.tabId));
      this.#tabs.createStart({ focus: false });
      const created = this.#tabs.snapshot.tabs.find((tab) => !before.has(tab.tabId));
      return created
        ? this.#activateTab(active, created.tabId, {})
        : { outcome: rejected("WORKBENCH_START_CREATE_FAILED", "无法创建新标签页。") };
    });
  }

  closeTab(tabId) {
    return this.#admit({ kind: "close-tab", tabId: String(tabId || "") }, async (active) => {
      const snapshot = this.#tabs.snapshot;
      const index = snapshot.tabs.findIndex((tab) => tab.tabId === tabId);
      if (index < 0) return { outcome: succeeded({ unchanged: true }) };
      const closing = snapshot.tabs[index];
      if (snapshot.activeTabId !== tabId) {
        this.#tabs.close(tabId);
        this.#surfaceCache?.remove(tabId);
        if (closing.kind === "document") {
          this.#browserDocuments?.remove(closing.projectId, closing.documentId);
        }
        return { outcome: succeeded({ tabId }) };
      }
      let next = snapshot.tabs[index + 1] || snapshot.tabs[index - 1] || null;
      if (!next) {
        const before = new Set(snapshot.tabs.map((tab) => tab.tabId));
        this.#tabs.createStart({ focus: false });
        next = this.#tabs.snapshot.tabs.find((tab) => !before.has(tab.tabId)) || null;
      }
      if (!next) return { outcome: rejected("WORKBENCH_TAB_CLOSE_FAILED", "无法安全关闭这个标签页。") };
      const activated = await this.#activateTab(active, next.tabId, {});
      if (activated.outcome.status !== "succeeded") return activated;
      this.#tabs.close(tabId);
      this.#surfaceCache?.remove(tabId);
      if (closing.kind === "document") {
        this.#browserDocuments?.remove(closing.projectId, closing.documentId);
      }
      return {
        ...activated,
        outcome: succeeded({ tabId, activeTabId: next.tabId }),
      };
    });
  }

  acceptBrowserProject(input) {
    const active = this.#active;
    if (active?.continuation === "browser-file") {
      return this.#continue(active, async () => {
        active.browserAuthority = this.#browserDocuments?.retain(input?.project) || null;
        this.#session.transition(active.transactionId, "opening");
        active.continuation = null;
        const outcome = this.#projectWorkflow.acceptBrowserProject({
          ...input,
          transactionId: active.transactionId,
        });
        return this.#finishOpened(active, outcome, { deadlineMs: 15_000 });
      });
    }
    return this.#admit({ kind: "browser-file" }, async (next) => {
      next.browserAuthority = this.#browserDocuments?.retain(input?.project) || null;
      this.#session.transition(next.transactionId, "opening");
      const outcome = this.#projectWorkflow.acceptBrowserProject({
        ...input,
        transactionId: next.transactionId,
      });
      return this.#finishOpened(next, outcome, { deadlineMs: 15_000 });
    });
  }

  acceptExternalProject(input) {
    return this.#admit({
      kind: "external",
      requestId: String(input?.requestId || ""),
    }, async (active) => {
      active.requestId = String(input?.requestId || "");
      this.#session.transition(active.transactionId, "opening");
      const outcome = this.#projectWorkflow.acceptExternalProject({
        ...input,
        transactionId: active.transactionId,
      });
      if (outcome?.status !== "succeeded") return { outcome };
      active.continuation = "external-terminal";
      active.externalAuto = true;
      void this.#finishExternalWhenApplied(active);
      return { suspended: true, outcome };
    });
  }

  confirmOpen(input = {}) {
    const requestedId = String(input.requestId || "");
    const active = this.#active;
    if (active && active.requestId === requestedId && active.continuation) {
      return this.#continue(active, () => this.#confirm(active, input));
    }
    return this.#admit({ kind: "confirmation", requestId: requestedId }, (next) => {
      next.requestId = requestedId;
      return this.#confirm(next, input);
    });
  }

  cancelOpen(input = {}) {
    const requestedId = String(input.requestId || "");
    const active = this.#active;
    if (active && active.requestId === requestedId && active.continuation) {
      return this.#continue(active, async () => {
        const outcome = await this.#projectWorkflow.cancelExternalOpen(input);
        if (outcome?.status === "succeeded") this.#tabs.restoreAuthority(active.priorTabs);
        return { outcome };
      });
    }
    return this.#admit({ kind: "confirmation-cancel", requestId: requestedId }, async () => ({
      outcome: await this.#projectWorkflow.cancelExternalOpen(input),
    }));
  }

  retryOpen(input = {}) {
    const confirmation = this.#projectWorkflow.getSnapshot().openConfirmation;
    return this.confirmOpen({
      ...input,
      action: confirmation?.classification === "new-external"
        ? "import-new"
        : "continue-current",
      deleteOriginal: confirmation?.deleteOriginal === true,
    });
  }

  resumeDeferredProjectApplication() {
    if (this.#closeFreeze) return rejected(
      "WORKBENCH_NAVIGATION_CLOSE_FROZEN",
      "窗口正在完成关闭核对，暂不继续 HTML 切换。",
    );
    return this.#projectWorkflow.resumeDeferredProjectApplication();
  }

  resumeDeferredExternalProject() {
    if (this.#closeFreeze) return rejected(
      "WORKBENCH_NAVIGATION_CLOSE_FROZEN",
      "窗口正在完成关闭核对，暂不继续外部 HTML 打开。",
    );
    return this.#projectWorkflow.resumeDeferredExternalProject();
  }

  beginClose({ requestId } = {}) {
    const id = String(requestId || "");
    if (!id || this.#disposed) return false;
    if (this.#closeFreeze) return false;
    this.#closeFreeze = Object.freeze({ requestId: id, phase: "preparing" });
    return true;
  }

  commitClose({ requestId } = {}) {
    const id = String(requestId || "");
    if (!this.#closeFreeze || this.#closeFreeze.requestId !== id) return false;
    this.#closeFreeze = Object.freeze({ requestId: id, phase: "ready" });
    return true;
  }

  abortClose({ requestId } = {}) {
    const id = String(requestId || "");
    if (!this.#closeFreeze || this.#closeFreeze.requestId !== id) return false;
    this.#closeFreeze = null;
    return true;
  }

  authorizeProjectApplication({ transactionId: receivedTransactionId, applicationId } = {}) {
    const received = String(receivedTransactionId || "");
    const receivedApplication = String(applicationId || "");
    if (!received) {
      return Object.freeze({ accepted: true, kind: "authority-refresh" });
    }
    const active = this.#active;
    if (
      !active
      || active.transactionId !== received
      || active.applicationAuthorityOpen !== true
      || this.#terminalReceipts.has(received)
      || !receivedApplication
      || (active.applicationId && active.applicationId !== receivedApplication)
    ) {
      return Object.freeze({ accepted: false, kind: "stale" });
    }
    active.applicationId = receivedApplication;
    return Object.freeze({ accepted: true, kind: "transaction" });
  }

  applyProject({ transactionId: receivedTransactionId, applicationId, project, epoch, activeLocked }) {
    const active = this.#active;
    const received = String(receivedTransactionId || "");
    if (!received) {
      const snapshot = projectAppliedEventToWorkbenchTabs({
        session: this.#tabs,
        event: { type: "project-applied", project, activeLocked },
        title: project?.name,
      });
      const activeTab = snapshot?.tabs.find((tab) => tab.tabId === snapshot.activeTabId) || null;
      return Object.freeze({
        transactionId: "uncorrelated",
        applicationId: applicationId ? String(applicationId) : null,
        projectId: String(project?.projectId || "") || null,
        documentId: String(project?.documentId || "") || null,
        epoch: Number(epoch) || 0,
        tabId: activeTab?.kind === "document" ? activeTab.tabId : null,
        kind: "authority-refresh",
      });
    }
    const receivedApplication = String(applicationId || "");
    if (
      !active
      || active.transactionId !== received
      || active.applicationAuthorityOpen !== true
      || this.#terminalReceipts.has(received)
      || !receivedApplication
      || (active.applicationId && active.applicationId !== receivedApplication)
    ) {
      return Object.freeze({
        transactionId: received,
        applicationId: receivedApplication || null,
        projectId: String(project?.projectId || "") || null,
        documentId: String(project?.documentId || "") || null,
        epoch: Number(epoch) || 0,
        tabId: null,
        kind: "stale",
      });
    }
    active.applicationId = receivedApplication;

    const projectId = String(project?.projectId || "");
    const documentId = String(project?.documentId || "");
    const title = String(project?.name || "HTML");
    let tabId = active.expectedTabId;
    if (tabId) {
      this.#tabs.bindDocument({
        projectId,
        documentId,
        title,
        status: activeLocked === true ? "processing" : "normal",
        focus: false,
      });
      const committed = this.#tabs.commitDocument({ tabId, projectId, documentId, title });
      if (!committed) tabId = null;
    }
    if (!tabId) {
      const snapshot = this.#tabs.bindDocument({
        projectId,
        documentId,
        title,
        status: activeLocked === true ? "processing" : "normal",
        focus: true,
      });
      tabId = snapshot?.activeTabId || null;
    }
    const receipt = Object.freeze({
      transactionId: active.transactionId,
      applicationId: applicationId ? String(applicationId) : null,
      projectId: projectId || null,
      documentId: documentId || null,
      epoch: Number(epoch) || 0,
      tabId,
      kind: String(active.intent.kind || "project"),
    });
    active.receipt = receipt;
    active.applicationAuthorityOpen = false;
    this.#session.applied(active.transactionId, receipt);
    active.resolveReceipt?.(receipt);
    return receipt;
  }

  onConfirmationPresented({ transactionId: receivedTransactionId, requestId }) {
    const active = this.#active;
    if (!active || active.transactionId !== String(receivedTransactionId || "")) return false;
    active.requestId = String(requestId || "");
    active.continuation = "confirmation";
    active.externalAuto = false;
    this.#session.transition(active.transactionId, "awaiting-user");
    return true;
  }

  onTerminalFailure({ transactionId: receivedTransactionId, reason }) {
    const active = this.#active;
    if (!active || active.transactionId !== String(receivedTransactionId || "")) return false;
    this.#complete(active, { outcome: rejected(
      "WORKBENCH_NAVIGATION_EXTERNAL_FAILED",
      String(reason || "外部 HTML 没有完成打开。"),
    ) });
    return true;
  }

  async prepareClose({ deadlineAt }) {
    const active = this.#active;
    if (!active) return true;
    if (this.#session.snapshot.phase === "awaiting-user") {
      this.#rollbackAndRelease(active, null);
      return true;
    }
    return this.waitForIdle({ deadlineAt });
  }

  waitForIdle({ deadlineAt }) {
    if (!this.#active) return Promise.resolve(true);
    const remaining = Math.max(0, Number(deadlineAt) - Number(this.#clock.now()));
    if (remaining <= 0) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiter = { timer: null, unsubscribe: () => {}, resolve: null };
      const settle = (value) => {
        if (!this.#idleWaiters.delete(waiter)) return;
        if (waiter.timer !== null) this.#clearTimer(waiter.timer);
        waiter.unsubscribe();
        resolve(value);
      };
      waiter.resolve = settle;
      const unsubscribe = this.#session.subscribe((snapshot) => {
        if (snapshot.phase !== "idle") return;
        settle(true);
      });
      waiter.unsubscribe = unsubscribe;
      waiter.timer = this.#setTimer(() => settle(false), remaining);
      this.#idleWaiters.add(waiter);
    });
  }

  waitForTerminal(transactionId) {
    const id = String(transactionId || "");
    if (!id) return Promise.resolve(null);
    if (this.#terminalReceipts.has(id)) {
      return Promise.resolve(this.#terminalReceipts.get(id));
    }
    if (this.#active?.transactionId === id) return this.#active.terminalPromise;
    return Promise.resolve(null);
  }

  dispose() {
    this.#disposed = true;
    this.#closeFreeze = null;
    if (this.#active) this.#rollbackAndRelease(this.#active, {
      code: "WORKBENCH_NAVIGATION_DISPOSED",
      reason: "导航已停止。",
    });
    for (const waiter of [...this.#idleWaiters]) waiter.resolve(false);
    this.#session.dispose();
  }

  async #openProject(active, input) {
    this.#session.transition(active.transactionId, "preparing");
    this.#session.transition(active.transactionId, "opening");
    const outcome = await this.#projectWorkflow.openProject({
      ...input,
      transactionId: active.transactionId,
    });
    if (outcome?.status !== "succeeded") {
      return this.#finishOpened(active, outcome, { deadlineMs: 15_000 });
    }
    if (outcome.value?.awaitingFile) {
      active.continuation = "browser-file";
      this.#session.transition(active.transactionId, "awaiting-user");
      return { suspended: true, outcome };
    }
    if (outcome.value?.awaitingConfirmation) {
      const confirmation = this.#projectWorkflow.getSnapshot().openConfirmation;
      active.requestId = String(confirmation?.requestId || "");
      active.continuation = "confirmation";
      this.#session.transition(active.transactionId, "awaiting-user");
      return { suspended: true, outcome };
    }
    if (!outcome.value?.opened) return { outcome };
    return this.#finishOpened(active, outcome, { deadlineMs: 15_000 });
  }

  async #activateTab(active, tabId, { deadlineMs = 15_000 } = {}) {
    const target = this.#tabs.resolveTab(tabId);
    if (!target) return { outcome: rejected("WORKBENCH_TAB_NOT_FOUND", "这个标签页已经关闭。") };
    if (target.tabId === this.#tabs.snapshot.activeTabId) {
      return { outcome: succeeded({ unchanged: true }) };
    }
    const current = this.#tabs.resolveTab(this.#tabs.snapshot.activeTabId);
    this.#surfaceCache?.touch(target.tabId);
    active.expectedTabId = target.tabId;
    this.#tabs.beginSwitch(target.tabId);
    this.#session.transition(active.transactionId, "preparing");
    if (target.kind === "start") {
      // Start -> Start changes presentation focus only. The retained document
      // controller was already fenced and unmounted by the first Start
      // activation, so a second drain would incorrectly let a transient React
      // view transition reject a valid queued new-tab command.
      const prepared = current?.kind === "start"
        ? succeeded()
        : await this.#projectWorkflow.prepareSwitch();
      if (prepared?.status !== "succeeded") {
        return { outcome: rejected(
          prepared?.code || "WORKBENCH_TAB_SWITCH_BLOCKED",
          String(prepared?.reason || "当前 HTML 尚未安全收口。"),
        ) };
      }
      if (current?.kind === "document") this.#captureCurrentSurface(current);
      const committed = this.#tabs.commitStart(target.tabId);
      if (!committed) return { outcome: rejected(
        "WORKBENCH_TAB_COMMIT_REJECTED",
        "标签页状态已变化，没有离开当前 HTML。",
      ) };
      const receipt = Object.freeze({
        transactionId: active.transactionId,
        applicationId: null,
        projectId: null,
        documentId: null,
        epoch: Number(this.#controller.getSnapshot()?.projectSession?.epoch) || 0,
        tabId: target.tabId,
        kind: "start",
      });
      this.#session.transition(active.transactionId, "canvas-verified", { receipt });
      return { outcome: succeeded({ tabId: target.tabId }), receipt };
    }
    if (current?.kind === "document") this.#captureCurrentSurface(current);
    this.#session.transition(active.transactionId, "opening");
    const browserProject = this.#browserDocuments?.resolve(target.projectId, target.documentId);
    const outcome = browserProject
      ? this.#projectWorkflow.acceptProject(browserProject, {
        kind: "browser-memory",
        transactionId: active.transactionId,
      })
      : await this.#projectWorkflow.openProject({
        kind: "registered",
        projectId: target.projectId,
        transactionId: active.transactionId,
      });
    return this.#finishOpened(active, outcome, { deadlineMs });
  }

  #captureCurrentSurface(tab) {
    const snapshot = this.#controller.getSnapshot();
    return this.#surfaceCache?.capture({
      tab,
      project: snapshot?.projectSession,
      document: snapshot?.document,
    }) || null;
  }

  async #confirm(active, input) {
    active.continuation = null;
    active.externalAuto = false;
    this.#session.transition(active.transactionId, "opening");
    const outcome = await this.#projectWorkflow.confirmExternalOpen({
      ...input,
      transactionId: active.transactionId,
    });
    if (outcome?.status !== "succeeded") {
      if (active.receipt && this.#controllerMatchesPrior(active.priorController)) {
        this.#tabs.restoreAuthority(active.priorTabs);
        active.receipt = null;
      }
      return {
        outcome: active.receipt
          ? rejected(
            outcome?.code || "WORKBENCH_NAVIGATION_COMMITTED_ERROR",
            outcome?.reason || "HTML 已切换，但最终收口失败。",
            { committed: true, tabId: active.receipt.tabId },
          )
          : outcome,
        receipt: active.receipt,
      };
    }
    if (!active.receipt) {
      return { outcome: rejected(
        "WORKBENCH_NAVIGATION_RECEIPT_MISSING",
        "HTML 打开成功，但缺少应用回执。",
      ) };
    }
    this.#session.transition(active.transactionId, "display-ready", { receipt: active.receipt });
    void this.#monitorSettlement(active.receipt, 15_000);
    return { outcome, receipt: active.receipt };
  }

  async #finishOpened(active, outcome, { deadlineMs }) {
    if (outcome?.status !== "succeeded") {
      const project = this.#projectWorkflow.getSnapshot();
      if (
        project?.open?.phase === "deferred"
        || project?.projectApplication?.status === "deferred"
      ) {
        active.continuation = "deferred-project";
        void this.#finishDeferredWhenApplied(active, deadlineMs);
        return { suspended: true, outcome };
      }
      return { outcome };
    }
    if (outcome.value?.opened === false) return { outcome };
    const expectedApplicationId = outcome.value?.applicationId || null;
    const receipt = await this.#waitForReceipt(active, deadlineMs, expectedApplicationId);
    if (!receipt) {
      return { outcome: rejected(
        "WORKBENCH_NAVIGATION_APPLY_TIMEOUT",
        "HTML 已接收打开请求，但应用回执未在时限内到达。",
      ) };
    }
    // The correlated application receipt means the exact HTML bytes are now
    // published. Release the user-facing admission here; hydration and Canvas
    // verification continue as independently fenced readiness work.
    this.#session.transition(active.transactionId, "display-ready", { receipt });
    void this.#monitorSettlement(receipt, deadlineMs);
    return { outcome: succeeded({ ...outcome.value, receipt }), receipt };
  }

  async #monitorSettlement(receipt, deadlineMs) {
    const settled = await this.#waitForSettlement(null, receipt, deadlineMs);
    if (settled.stale) return;
    if (!settled.ok && receipt.projectId && receipt.documentId) {
      this.#tabs.updateStatus(receipt.projectId, receipt.documentId, "error");
    }
  }

  async #finishExternalWhenApplied(active) {
    const receipt = await this.#waitForReceipt(active, 15_000, null);
    if (this.#active !== active || active.externalAuto !== true) return;
    if (!receipt) {
      this.#complete(active, { outcome: rejected(
        "WORKBENCH_NAVIGATION_APPLY_TIMEOUT",
        "外部 HTML 已接收，但应用回执未在时限内到达。",
      ) });
      return;
    }
    const result = await this.#finishOpened(active, succeeded({
      opened: true,
      applicationId: receipt.applicationId,
    }), { deadlineMs: 15_000 });
    this.#complete(active, result);
  }

  async #finishDeferredWhenApplied(active, deadlineMs) {
    const receipt = await this.#waitForReceipt(active, deadlineMs, null);
    if (!receipt || this.#active !== active) {
      if (this.#active === active) this.#complete(active, { outcome: rejected(
        "WORKBENCH_NAVIGATION_DEFERRED_TIMEOUT",
        "已保留导航请求，但未在时限内获得应用回执。",
      ) });
      return;
    }
    active.continuation = null;
    const result = await this.#finishOpened(active, succeeded({
      opened: true,
      applicationId: receipt.applicationId,
    }), { deadlineMs });
    this.#complete(active, result);
  }

  #waitForReceipt(active, deadlineMs, expectedApplicationId) {
    if (
      active.receipt
      && (!expectedApplicationId || active.receipt.applicationId === expectedApplicationId)
    ) return Promise.resolve(active.receipt);
    return new Promise((resolve) => {
      let timer = null;
      let settled = false;
      const settle = (receipt) => {
        if (settled) return;
        settled = true;
        if (timer !== null) this.#clearTimer(timer);
        active.resolveReceipt = null;
        active.cancelReceiptWait = null;
        resolve(receipt);
      };
      active.resolveReceipt = (receipt) => {
        if (expectedApplicationId && receipt.applicationId !== expectedApplicationId) return;
        settle(receipt);
      };
      active.cancelReceiptWait = () => settle(null);
      timer = this.#setTimer(() => {
        this.#expireApplicationAuthority(active);
        if (expectedApplicationId) {
          this.#projectWorkflow.cancelProjectApplication?.(expectedApplicationId);
        }
        settle(null);
      }, deadlineMs);
    });
  }

  #waitForSettlement(active, receipt, deadlineMs) {
    let timer = null;
    let unsubscribe = () => {};
    return new Promise((resolve) => {
      let settled = false;
      const settle = (value) => {
        if (settled) return;
        settled = true;
        if (timer !== null) this.#clearTimer(timer);
        unsubscribe();
        if (active) active.cancelSettlementWait = null;
        resolve(value);
      };
      const inspect = (snapshot) => {
        const project = snapshot?.projectSession;
        const sessionAligned = Boolean(
          project?.projectId
          && project.projectId === receipt.projectId
          && project.documentId === receipt.documentId
          && Number(project.epoch) === receipt.epoch,
        );
        // In-memory browser HTML has no disk locator, so ProjectSession keeps
        // an empty projectId after openLocator(null). Settlement still has to
        // complete or the next picker/accept stays queued behind this one.
        const browserMemoryAligned = Boolean(
          receipt.projectId
          && !project?.sourcePath
          && !project?.projectId
          && Number(project?.epoch) === receipt.epoch,
        );
        if (!sessionAligned && !browserMemoryAligned) {
          if (Number(project?.epoch) > receipt.epoch) settle({ ok: false, stale: true });
          return;
        }
        const hydration = snapshot?.project?.hydration;
        if (hydration?.phase === "failed" && Number(hydration.epoch) === receipt.epoch) {
          settle({
            ok: false,
            code: "WORKBENCH_NAVIGATION_HYDRATION_FAILED",
            reason: hydration.error || "HTML 权威读取失败。",
          });
          return;
        }
        if (hydration?.phase !== "idle") return;
        const application = snapshot?.project?.projectApplication;
        if (
          receipt.applicationId
          && [application?.activeApplicationId, application?.queuedApplicationId]
            .includes(receipt.applicationId)
        ) return;
        const canvas = snapshot?.document?.canvasAuthority;
        if (canvas?.status === "failed") {
          settle({
            ok: false,
            code: "WORKBENCH_NAVIGATION_CANVAS_FAILED",
            reason: canvas.error || "HTML 画布核对失败。",
          });
          return;
        }
        if (canvas && !["verified", "idle"].includes(canvas.status)) return;
        settle({ ok: true });
      };
      unsubscribe = this.#controller.subscribe(inspect);
      if (active) {
        active.cancelSettlementWait = () => settle({
          ok: false,
          code: "WORKBENCH_NAVIGATION_DISPOSED",
          reason: "导航已停止。",
        });
      }
      inspect(this.#controller.getSnapshot());
      if (!settled) timer = this.#setTimer(() => {
        settle({
          ok: false,
          code: "WORKBENCH_NAVIGATION_SETTLE_TIMEOUT",
          reason: "HTML 已进入当前标签，但权威读取和画布核对未在时限内完成。",
        });
      }, deadlineMs);
    });
  }

  #admit(intent, execute) {
    const predecessor = this.#admissionTail.catch(() => {});
    let release;
    const completion = new Promise((resolve) => { release = resolve; });
    this.#admissionTail = predecessor.then(() => completion);
    // Browser-file `input.click()` must run in the same user-activation turn.
    // Queuing an idle admission behind `predecessor.then()` yields a microtask,
    // so Chromium silently ignores the click and encoding-error "重新选择"
    // cannot reopen the picker.
    if (!this.#busy) {
      return this.#beginAdmission(intent, execute, release);
    }
    return predecessor.then(() => this.#beginAdmission(intent, execute, release));
  }

  #beginAdmission(intent, execute, release) {
    if (this.#disposed) {
      release();
      return rejected("WORKBENCH_NAVIGATION_DISPOSED", "导航已停止。");
    }
    if (this.#closeFreeze) {
      release();
      return rejected(
        "WORKBENCH_NAVIGATION_CLOSE_FROZEN",
        "窗口正在完成关闭核对，暂不接收新的 HTML 导航。",
      );
    }
    this.#busy = true;
    this.#ordinal += 1;
    const id = transactionId(this.#ordinal, this.#clock.now());
    const active = {
      transactionId: id,
      intent: Object.freeze({ ...intent }),
      priorTabs: this.#tabs.captureAuthority(),
      priorController: this.#controller.getSnapshot()?.projectSession || null,
      receipt: null,
      expectedTabId: null,
      requestId: null,
      continuation: null,
      browserAuthority: null,
      applicationId: null,
      applicationAuthorityOpen: true,
      cancelReceiptWait: null,
      cancelSettlementWait: null,
      release: () => {
        this.#busy = false;
        release();
      },
    };
    active.terminalPromise = new Promise((resolve) => {
      active.resolveTerminal = resolve;
    });
    this.#active = active;
    this.#session.admit({
      transactionId: id,
      intent: active.intent,
      admissionOrdinal: this.#ordinal,
    });
    try {
      return Promise.resolve(execute(active)).then(
        (result) => (result?.suspended ? result.outcome : this.#complete(active, result)),
        (cause) => this.#complete(active, {
          outcome: rejected(
            "WORKBENCH_NAVIGATION_REJECTED",
            String(cause?.message || cause || "导航失败。"),
          ),
        }),
      );
    } catch (cause) {
      return this.#complete(active, {
        outcome: rejected(
          "WORKBENCH_NAVIGATION_REJECTED",
          String(cause?.message || cause || "导航失败。"),
        ),
      });
    }
  }

  #continue(active, execute) {
    if (this.#active !== active) {
      return Promise.resolve(rejected("WORKBENCH_NAVIGATION_STALE", "这次导航已经结束。"));
    }
    if (this.#closeFreeze) {
      return Promise.resolve(rejected(
        "WORKBENCH_NAVIGATION_CLOSE_FROZEN",
        "窗口正在完成关闭核对，暂不继续这次 HTML 导航。",
      ));
    }
    return Promise.resolve().then(execute).then(
      (result) => result?.suspended ? result.outcome : this.#complete(active, result),
      (cause) => this.#complete(active, { outcome: rejected(
        "WORKBENCH_NAVIGATION_REJECTED",
        String(cause?.message || cause || "导航失败。"),
      ) }),
    );
  }

  #complete(active, result = {}) {
    if (this.#active !== active) return result.outcome || rejected(
      "WORKBENCH_NAVIGATION_STALE",
      "这次导航已经结束。",
    );
    const outcome = result.outcome || succeeded();
    this.#expireApplicationAuthority(active);
    const error = outcome.status === "succeeded"
      ? null
      : outcomeError(outcome, "WORKBENCH_NAVIGATION_REJECTED", "导航失败。");
    if (outcome.status !== "succeeded" && !result.receipt) {
      this.#tabs.restoreAuthority(active.priorTabs);
      if (active.browserAuthority) this.#browserDocuments?.restore(active.browserAuthority);
    }
    this.#session.finish(active.transactionId, {
      receipt: result.receipt || null,
      error,
    });
    const terminal = Object.freeze({
      transactionId: active.transactionId,
      outcome,
      receipt: result.receipt || null,
    });
    this.#terminalReceipts.set(active.transactionId, terminal);
    if (this.#terminalReceipts.size > 256) {
      this.#terminalReceipts.delete(this.#terminalReceipts.keys().next().value);
    }
    this.#tabsPersistence?.commit(this.#tabs.serialize());
    this.#cancelActiveWaits(active);
    active.resolveTerminal?.(terminal);
    this.#active = null;
    active.release?.();
    return outcome;
  }

  #rollbackAndRelease(active, error) {
    if (this.#active !== active) return;
    this.#expireApplicationAuthority(active);
    this.#tabs.restoreAuthority(active.priorTabs);
    if (active.browserAuthority) this.#browserDocuments?.restore(active.browserAuthority);
    this.#session.finish(active.transactionId, { error });
    const terminal = Object.freeze({
      transactionId: active.transactionId,
      outcome: error ? rejected(error.code, error.reason) : succeeded({ canceled: true }),
      receipt: null,
    });
    this.#terminalReceipts.set(active.transactionId, terminal);
    if (this.#terminalReceipts.size > 256) {
      this.#terminalReceipts.delete(this.#terminalReceipts.keys().next().value);
    }
    this.#tabsPersistence?.commit(this.#tabs.serialize());
    this.#cancelActiveWaits(active);
    active.resolveTerminal?.(terminal);
    this.#active = null;
    active.release?.();
  }

  #cancelActiveWaits(active) {
    active.cancelReceiptWait?.();
    active.cancelSettlementWait?.();
    active.cancelReceiptWait = null;
    active.cancelSettlementWait = null;
    active.resolveReceipt = null;
  }

  #expireApplicationAuthority(active) {
    if (!active) return;
    active.applicationAuthorityOpen = false;
  }

  #controllerMatchesPrior(prior) {
    const current = this.#controller.getSnapshot()?.projectSession;
    return Boolean(
      prior
      && current
      && prior.projectId === current.projectId
      && prior.documentId === current.documentId
      && Number(prior.epoch) <= Number(current.epoch),
    );
  }
}
