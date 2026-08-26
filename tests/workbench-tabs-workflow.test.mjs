import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkbenchTabsSession,
  projectAppliedEventToWorkbenchTabs,
} from "../app/application/workbench-tabs-session.js";
import {
  WorkbenchTabsWorkflow,
  workbenchTabOutcomeHasCommittedDocument,
} from "../app/application/workbench-tabs-workflow.js";

function controllerFixture({
  prepareResult = { status: "succeeded" },
  openProject,
  initialSnapshot = { projectSession: { projectId: "project_alpha", documentId: "doc_alpha" } },
} = {}) {
  let snapshot = initialSnapshot;
  const listeners = new Set();
  const calls = [];
  return {
    calls,
    controller: {
      getSnapshot: () => snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async prepareProjectSwitch() {
        calls.push("prepareSwitch");
        calls.push("fence");
        if (prepareResult.status !== "succeeded") return prepareResult;
        calls.push("drain");
        return prepareResult;
      },
      async openProject(input) {
        if (openProject) return openProject({ input, calls, publish(next) {
          snapshot = next;
          for (const listener of listeners) listener(snapshot);
        } });
        calls.push("prepareSwitch");
        calls.push("fence");
        calls.push("drain");
        calls.push(`open:${input.projectId}`);
        snapshot = { projectSession: { projectId: input.projectId, documentId: `doc_${input.projectId.slice(8)}` } };
        for (const listener of listeners) listener(snapshot);
        return { status: "succeeded" };
      },
    },
  };
}

test("document activation commits only after ProjectWorkflow publication matches identity", async () => {
  const session = new WorkbenchTabsSession();
  session.bindDocument({ projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" });
  session.bindDocument({ projectId: "project_beta", documentId: "doc_beta", title: "Beta", focus: false });
  let eventProjectionObserved = false;
  const { controller, calls } = controllerFixture({
    async openProject({ input, calls: openCalls, publish }) {
      openCalls.push("prepareSwitch", "fence", "drain", `open:${input.projectId}`);
      projectAppliedEventToWorkbenchTabs({
        session,
        event: {
          type: "project-applied",
          project: { projectId: "project_beta", documentId: "doc_beta", name: "Beta event" },
        },
      });
      assert.equal(session.snapshot.pendingTabId, "document:project_beta:doc_beta");
      assert.equal(session.snapshot.activeTabId, "document:project_alpha:doc_alpha");
      eventProjectionObserved = true;
      publish({ projectSession: { projectId: "project_beta", documentId: "doc_beta" } });
      return { status: "succeeded" };
    },
  });
  const workflow = new WorkbenchTabsWorkflow({ session, controller });
  const beta = session.snapshot.tabs.find((tab) => tab.projectId === "project_beta");
  const outcome = await workflow.activate(beta.tabId);
  assert.equal(outcome.status, "succeeded");
  assert.equal(eventProjectionObserved, true);
  assert.deepEqual(calls, ["prepareSwitch", "fence", "drain", "open:project_beta"]);
  assert.equal(session.snapshot.activeTabId, beta.tabId);
  assert.equal(session.snapshot.runtimeOwnerTabId, beta.tabId);
});

test("document activation mounts the verified identity but remains busy until hydration settles", async () => {
  let finishHydration;
  const session = new WorkbenchTabsSession();
  const alpha = session.bindDocument({ projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" }).tabs.find((tab) => tab.kind === "document");
  session.bindDocument({ projectId: "project_beta", documentId: "doc_beta", title: "Beta", focus: false });
  const { controller } = controllerFixture({
    async openProject({ publish }) {
      publish({
        projectSession: { projectId: "project_beta", documentId: "doc_beta" },
        project: {
          hydration: { phase: "hydrating", error: null },
          projectApplication: { status: "applying" },
        },
      });
      finishHydration = () => publish({
        projectSession: { projectId: "project_beta", documentId: "doc_beta" },
        project: {
          hydration: { phase: "idle", error: null },
          projectApplication: { status: "idle" },
        },
      });
      return { status: "succeeded" };
    },
  });
  const workflow = new WorkbenchTabsWorkflow({ session, controller });
  const beta = session.snapshot.tabs.find((tab) => tab.projectId === "project_beta");
  const activation = workflow.activate(beta.tabId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.activeTabId, beta.tabId);
  assert.equal((await workflow.close(alpha.tabId)).code, "WORKBENCH_TAB_SWITCH_BUSY");
  finishHydration();
  assert.equal((await activation).status, "succeeded");
  assert.equal(session.snapshot.activeTabId, beta.tabId);
});

test("post-commit settle timeout is explicit and never authorizes restore cleanup", async () => {
  const timers = [];
  const session = new WorkbenchTabsSession();
  session.bindDocument({ projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" });
  session.bindDocument({ projectId: "project_beta", documentId: "doc_beta", title: "Beta", focus: false });
  const { controller } = controllerFixture({
    async openProject({ publish }) {
      publish({
        projectSession: { projectId: "project_beta", documentId: "doc_beta", epoch: 2 },
        project: {
          hydration: { phase: "hydrating", error: null },
          projectApplication: { status: "idle" },
        },
      });
      return { status: "succeeded" };
    },
  });
  const workflow = new WorkbenchTabsWorkflow({
    session,
    controller,
    setTimer(callback) {
      const timer = { callback, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer(timer) {
      timer.cleared = true;
    },
  });
  const beta = session.snapshot.tabs.find((tab) => tab.projectId === "project_beta");
  const activation = workflow.activate(beta.tabId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.activeTabId, beta.tabId);
  const liveTimer = timers.findLast((timer) => !timer.cleared);
  assert.ok(liveTimer);
  liveTimer.callback();
  const outcome = await activation;
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.committed, true);
  assert.equal(outcome.tabId, beta.tabId);
  assert.equal(workbenchTabOutcomeHasCommittedDocument(outcome), true);
  assert.equal(session.snapshot.activeTabId, beta.tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, beta.tabId);
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === beta.tabId), true);
});

test("returning from Start ignores pre-open identity and keeps the new epoch operation locked until settled", async () => {
  let finishHydration;
  const session = new WorkbenchTabsSession();
  const beta = session.bindDocument({ projectId: "project_beta", documentId: "doc_beta", title: "Beta" }).tabs.find((tab) => tab.kind === "document");
  const start = session.createStart({ focus: true }).tabs.find((tab) => tab.kind === "start");
  assert.equal(session.snapshot.activeTabId, start.tabId);
  const { controller } = controllerFixture({
    initialSnapshot: {
      projectSession: { projectId: "project_beta", documentId: "doc_beta", epoch: 4 },
      project: {
        hydration: { phase: "idle", error: null },
        projectApplication: { status: "idle" },
      },
    },
    async openProject({ publish }) {
      publish({
        projectSession: { projectId: "project_beta", documentId: "doc_beta", epoch: 5 },
        project: {
          hydration: { phase: "hydrating", error: null },
          projectApplication: { status: "applying" },
        },
      });
      finishHydration = () => publish({
        projectSession: { projectId: "project_beta", documentId: "doc_beta", epoch: 5 },
        project: {
          hydration: { phase: "idle", error: null },
          projectApplication: { status: "idle" },
        },
      });
      return { status: "succeeded" };
    },
  });
  const workflow = new WorkbenchTabsWorkflow({ session, controller });
  const activation = workflow.activate(beta.tabId);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(session.snapshot.activeTabId, beta.tabId);
  assert.equal((await workflow.activate(start.tabId)).code, "WORKBENCH_TAB_SWITCH_BUSY");
  finishHydration();
  assert.equal((await activation).status, "succeeded");
  assert.equal(session.snapshot.activeTabId, beta.tabId);
});

test("start activation uses the canonical native-edit fence and drain before unmounting", async () => {
  const session = new WorkbenchTabsSession();
  const document = session.bindDocument({ projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" }).tabs.find((tab) => tab.kind === "document");
  const { controller, calls } = controllerFixture();
  const workflow = new WorkbenchTabsWorkflow({ session, controller });
  const start = session.createStart({ focus: false }).tabs.find((tab) => tab.kind === "start");
  await workflow.activate(start.tabId);
  assert.deepEqual(calls, ["prepareSwitch", "fence", "drain"]);
  assert.equal(session.snapshot.mountedDocumentTabId, null);
  assert.equal(session.snapshot.runtimeOwnerTabId, document.tabId);
});

test("start activation keeps the mounted DOM owner when the native-edit fence blocks before drain", async () => {
  const session = new WorkbenchTabsSession();
  const document = session.bindDocument({ projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" }).tabs.find((tab) => tab.kind === "document");
  const { controller, calls } = controllerFixture({
    prepareResult: { status: "blocked", code: "PROJECT_SWITCH_NATIVE_EDIT", reason: "请先完成输入法组字。" },
  });
  const workflow = new WorkbenchTabsWorkflow({ session, controller });
  const start = session.createStart({ focus: false }).tabs.find((tab) => tab.kind === "start");

  const outcome = await workflow.activate(start.tabId);
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.code, "PROJECT_SWITCH_NATIVE_EDIT");
  assert.deepEqual(calls, ["prepareSwitch", "fence"]);
  assert.equal(session.snapshot.activeTabId, document.tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, document.tabId);
});

test("close rejects while activation is pending and never removes its target", async () => {
  let releaseOpen;
  const openReleased = new Promise((resolve) => { releaseOpen = resolve; });
  const session = new WorkbenchTabsSession();
  session.bindDocument({ projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" });
  session.bindDocument({ projectId: "project_beta", documentId: "doc_beta", title: "Beta", focus: false });
  const { controller } = controllerFixture({
    async openProject({ input, calls, publish }) {
      calls.push("prepareSwitch", "fence", "drain", `open:${input.projectId}`);
      await openReleased;
      publish({ projectSession: { projectId: input.projectId, documentId: "doc_beta" } });
      return { status: "succeeded" };
    },
  });
  const workflow = new WorkbenchTabsWorkflow({ session, controller });
  const beta = session.snapshot.tabs.find((tab) => tab.projectId === "project_beta");
  const activation = workflow.activate(beta.tabId);
  await new Promise((resolve) => setImmediate(resolve));

  const close = await workflow.close(beta.tabId);
  assert.equal(close.status, "rejected");
  assert.equal(close.code, "WORKBENCH_TAB_SWITCH_BUSY");
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === beta.tabId), true);

  releaseOpen();
  assert.equal((await activation).status, "succeeded");
  assert.equal(session.snapshot.activeTabId, beta.tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, beta.tabId);
});
