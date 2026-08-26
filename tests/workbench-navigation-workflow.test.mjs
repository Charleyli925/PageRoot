import assert from "node:assert/strict";
import test from "node:test";

import { WorkbenchNavigationSession } from "../app/application/workbench-navigation-session.js";
import {
  WorkbenchNavigationWorkflow,
  workbenchStartupPriority,
} from "../app/application/workbench-navigation-workflow.js";
import { WorkbenchTabsSession } from "../app/application/workbench-tabs-session.js";

const A = { projectId: "project_alpha", documentId: "doc_alpha", name: "Alpha" };
const B = { projectId: "project_beta", documentId: "doc_beta", name: "Beta" };
const C = { projectId: "project_gamma", documentId: "doc_gamma", name: "Gamma" };

test("cold-start priority is external FIFO, persisted active tab, activePath compatibility, then Start", () => {
  assert.equal(workbenchStartupPriority({
    externalRequestCount: 1,
    persistedStatePresent: true,
    persistedActiveTabId: "document:B",
  }), "external");
  assert.equal(workbenchStartupPriority({
    persistedStatePresent: true,
    persistedActiveTabId: "document:B",
  }), "persisted-active-tab");
  assert.equal(workbenchStartupPriority({ persistedStatePresent: false }), "active-path-compatibility");
  assert.equal(workbenchStartupPriority({ persistedStatePresent: true }), "start");
});

function projectSnapshot(project, epoch, options = {}) {
  return {
    projectSession: { projectId: project.projectId, documentId: project.documentId, epoch },
    project: {
      hydration: {
        phase: options.hydration || "idle",
        epoch,
        error: options.error || null,
      },
      projectApplication: {
        status: options.application || "idle",
        activeApplicationId: options.activeApplicationId || null,
        queuedApplicationId: null,
      },
    },
    document: {
      canvasAuthority: {
        status: options.canvas || "verified",
        error: options.canvasError || null,
      },
    },
  };
}

function fixture({ open, confirm, cancel, acceptExternal, acceptBrowser } = {}) {
  const tabs = new WorkbenchTabsSession();
  tabs.bindDocument({ ...A, title: A.name });
  const navigation = new WorkbenchNavigationSession();
  const phases = [];
  navigation.subscribe((snapshot) => phases.push({
    phase: snapshot.phase,
    transactionId: snapshot.transactionId,
    ordinal: snapshot.admissionOrdinal,
  }));
  let snapshot = projectSnapshot(A, 1);
  const listeners = new Set();
  const calls = [];
  const controller = {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      listener(snapshot);
      return () => listeners.delete(listener);
    },
  };
  const publish = (next) => {
    snapshot = next;
    for (const listener of listeners) listener(snapshot);
  };
  let workflow;
  let applicationSequence = 0;
  const apply = (active, project, options = {}) => {
    applicationSequence += 1;
    const applicationId = options.applicationId || `application-${applicationSequence}`;
    const epoch = options.epoch || Number(snapshot.projectSession?.epoch || 0) + 1;
    publish(projectSnapshot(project, epoch, {
      hydration: options.hydration || "idle",
      error: options.error,
      canvas: options.canvas || "verified",
      application: options.application || "idle",
      activeApplicationId: options.activeApplicationId,
    }));
    const receipt = workflow.applyProject({
      transactionId: active.transactionId,
      applicationId,
      project,
      epoch,
      activeLocked: false,
    });
    return { applicationId, receipt, epoch };
  };
  const projectWorkflow = {
    confirmation: null,
    getSnapshot() {
      return { openConfirmation: this.confirmation };
    },
    async prepareSwitch() {
      calls.push("prepare");
      return { status: "succeeded", value: {} };
    },
    async openProject(input) {
      calls.push(`open:${input.kind}:${input.projectId || input.sourcePath || ""}`);
      if (open) return open({ input, calls, apply: (project, options) => apply(input, project, options), publish, workflow, projectWorkflow: this });
      const project = input.projectId === A.projectId ? A : B;
      const applied = apply(input, project);
      return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
    },
    acceptBrowserProject(input) {
      calls.push("browser");
      if (acceptBrowser) return acceptBrowser({ input, apply: (project, options) => apply(input, project, options), publish });
      const applied = apply(input, B);
      return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
    },
    acceptExternalProject(input) {
      calls.push(`external:${input.requestId}`);
      if (acceptExternal) return acceptExternal({ input, apply: (project, options) => apply(input, project, options), publish, workflow });
      queueMicrotask(() => apply(input, B));
      return { status: "succeeded", value: { requestId: input.requestId } };
    },
    async confirmExternalOpen(input) {
      calls.push(`confirm:${input.requestId}`);
      if (confirm) return confirm({ input, apply: (project, options) => apply(input, project, options), publish, workflow });
      apply(input, B, { applicationId: `prepared-${input.requestId}` });
      return { status: "succeeded", value: { opened: true } };
    },
    async cancelExternalOpen(input) {
      calls.push(`cancel:${input.requestId}`);
      return cancel ? cancel({ input, publish }) : { status: "succeeded", value: { canceled: true } };
    },
  };
  workflow = new WorkbenchNavigationWorkflow({
    session: navigation,
    tabs,
    projectWorkflow,
    controller,
    clock: { now: () => 1_000 },
  });
  return { tabs, navigation, phases, calls, controller, projectWorkflow, workflow, publish, apply };
}

for (const intent of ["startup", "local", "recent", "registered"]) {
  test(`${intent} uses one correlated transaction receipt and terminal identity`, async () => {
    const harness = fixture();
    if (intent === "registered") {
      harness.tabs.bindDocument({ ...B, title: B.name, focus: false });
    }
    const outcome = intent === "registered"
      ? await harness.workflow.activateTab(`document:${B.projectId}:${B.documentId}`)
      : await harness.workflow.openProject({ kind: intent, sourcePath: intent === "recent" ? "/B.html" : null });
    assert.equal(outcome.status, "succeeded");
    const receipt = harness.navigation.snapshot.lastReceipt;
    assert.equal(receipt.projectId, B.projectId);
    assert.equal(receipt.documentId, B.documentId);
    assert.equal(receipt.transactionId.startsWith("workbench-navigation-"), true);
    assert.equal(harness.tabs.snapshot.activeTabId, receipt.tabId);
    assert.equal(harness.tabs.snapshot.mountedDocumentTabId, receipt.tabId);
    assert.equal(harness.navigation.snapshot.phase, "idle");
    assert.deepEqual(
      harness.phases.filter((phase) => phase.transactionId === receipt.transactionId).map((phase) => phase.phase),
      ["admitted", "preparing", "opening", "applied", "hydrating", "canvas-verified", "committed"],
    );
  });
}

test("browser picker continuation retains its admitted transaction and exact application receipt", async () => {
  const harness = fixture({
    open: async ({ input }) => ({
      status: "succeeded",
      value: { operationId: `picker-${input.transactionId}`, awaitingFile: true },
    }),
  });
  const requested = await harness.workflow.openProject({ kind: "local" });
  assert.equal(requested.status, "succeeded");
  assert.equal(harness.navigation.snapshot.phase, "awaiting-user");
  const transactionId = harness.navigation.snapshot.transactionId;
  const accepted = await harness.workflow.acceptBrowserProject({
    operationId: `picker-${transactionId}`,
    project: B,
  });
  assert.equal(accepted.status, "succeeded");
  assert.equal(harness.navigation.snapshot.lastReceipt.transactionId, transactionId);
  assert.equal(harness.tabs.snapshot.activeTabId, `document:${B.projectId}:${B.documentId}`);
});

test("Start activation and active-tab close keep mounted/runtime ownership invariant", async () => {
  const harness = fixture();
  const created = await harness.workflow.createStart();
  assert.equal(created.status, "succeeded");
  const startReceipt = harness.navigation.snapshot.lastReceipt;
  assert.equal(startReceipt.kind, "start");
  assert.equal(harness.tabs.snapshot.activeTabId, startReceipt.tabId);
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, null);
  assert.equal(harness.tabs.snapshot.runtimeOwnerTabId, `document:${A.projectId}:${A.documentId}`);

  const returned = await harness.workflow.activateTab(`document:${A.projectId}:${A.documentId}`);
  assert.equal(returned.status, "succeeded");
  const closed = await harness.workflow.closeTab(`document:${A.projectId}:${A.documentId}`);
  assert.equal(closed.status, "succeeded");
  assert.equal(harness.tabs.snapshot.tabs.some((tab) => tab.kind === "document"), false);
  assert.equal(harness.tabs.snapshot.tabs.find(
    (tab) => tab.tabId === harness.tabs.snapshot.activeTabId,
  ).kind, "start");
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, null);
  assert.equal(harness.tabs.snapshot.runtimeOwnerTabId, null);
});

test("external admission completes only after the correlated application and terminal settlement", async () => {
  const harness = fixture();
  const accepted = await harness.workflow.acceptExternalProject({ requestId: "external-B" });
  assert.equal(accepted.status, "succeeded");
  assert.notEqual(harness.navigation.snapshot.phase, "idle");
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(harness.navigation.snapshot.phase, "idle");
  assert.equal(harness.navigation.snapshot.lastReceipt.projectId, B.projectId);
});

test("pre-apply failure restores the exact prior tab and controller alignment", async () => {
  const harness = fixture({
    open: async () => ({ status: "rejected", code: "OPEN_FAILED", reason: "failed before apply" }),
  });
  harness.tabs.bindDocument({ ...B, title: B.name, focus: false });
  const before = harness.tabs.snapshot;
  const outcome = await harness.workflow.activateTab(`document:${B.projectId}:${B.documentId}`);
  assert.equal(outcome.status, "rejected");
  assert.equal(harness.tabs.snapshot.activeTabId, before.activeTabId);
  assert.equal(harness.tabs.snapshot.mountedDocumentTabId, before.mountedDocumentTabId);
  assert.equal(harness.controller.getSnapshot().projectSession.projectId, A.projectId);
});

test("post-apply failure is committed-error and keeps tab/controller on the receipt identity", async () => {
  const harness = fixture({
    open: async ({ apply }) => {
      const applied = apply(B, { hydration: "failed", error: "hydrate failed" });
      return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
    },
  });
  const outcome = await harness.workflow.openProject({ kind: "local" });
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.committed, true);
  assert.equal(harness.tabs.snapshot.activeTabId, outcome.tabId);
  assert.equal(harness.controller.getSnapshot().projectSession.projectId, B.projectId);
  assert.equal(harness.tabs.snapshot.tabs.find((tab) => tab.tabId === outcome.tabId).status, "error");
});

test("same-tick A then B is admitted in ordinal order without busy rejection", async () => {
  let releaseFirst;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const harness = fixture({
    open: async ({ input, apply }) => {
      if (input.sourcePath === "/B.html") await firstGate;
      const project = input.sourcePath === "/B.html" ? B : C;
      const applied = apply(project);
      return { status: "succeeded", value: { opened: true, applicationId: applied.applicationId } };
    },
  });
  const first = harness.workflow.openProject({ kind: "recent", sourcePath: "/B.html" });
  const second = harness.workflow.openProject({ kind: "recent", sourcePath: "/C.html" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(harness.calls, ["open:recent:/B.html"]);
  releaseFirst();
  assert.equal((await first).status, "succeeded");
  assert.equal((await second).status, "succeeded");
  assert.deepEqual(harness.calls, ["open:recent:/B.html", "open:recent:/C.html"]);
  assert.equal(harness.tabs.snapshot.activeTabId, `document:${C.projectId}:${C.documentId}`);
  assert.equal(harness.navigation.snapshot.admissionOrdinal, 2);
});

test("confirmation failure after apply rolls tabs back with the controller receipt", async () => {
  const harness = fixture({
    open: async ({ input, workflow, projectWorkflow }) => {
      projectWorkflow.confirmation = { requestId: "confirm-B", classification: "new-external" };
      workflow.onConfirmationPresented({
        transactionId: input.transactionId,
        requestId: "confirm-B",
      });
      return { status: "succeeded", value: { awaitingConfirmation: true, opened: false } };
    },
    confirm: async ({ input, apply, publish }) => {
      apply(B, { applicationId: `prepared-${input.requestId}` });
      publish(projectSnapshot(A, 3));
      return { status: "rejected", code: "CANVAS_FAILED", reason: "rolled back" };
    },
  });
  const before = harness.tabs.snapshot;
  await harness.workflow.openProject({ kind: "local" });
  const outcome = await harness.workflow.confirmOpen({
    requestId: "confirm-B",
    action: "import-new",
  });
  assert.equal(outcome.status, "rejected");
  assert.equal(outcome.committed, undefined);
  assert.equal(harness.tabs.snapshot.activeTabId, before.activeTabId);
  assert.equal(harness.controller.getSnapshot().projectSession.projectId, A.projectId);
});

test("close waits for a committing confirmation instead of canceling it", async () => {
  let releaseCommit;
  const commitGate = new Promise((resolve) => { releaseCommit = resolve; });
  const harness = fixture({
    open: async ({ input, workflow, projectWorkflow }) => {
      projectWorkflow.confirmation = { requestId: "confirm-B", classification: "new-external" };
      workflow.onConfirmationPresented({ transactionId: input.transactionId, requestId: "confirm-B" });
      return { status: "succeeded", value: { awaitingConfirmation: true, opened: false } };
    },
    confirm: async ({ input, apply }) => {
      await commitGate;
      apply(B, { applicationId: `prepared-${input.requestId}` });
      return { status: "succeeded", value: { opened: true } };
    },
  });
  await harness.workflow.openProject({ kind: "local" });
  const commit = harness.workflow.confirmOpen({ requestId: "confirm-B", action: "import-new" });
  await new Promise((resolve) => setImmediate(resolve));
  let closeSettled = false;
  const close = harness.workflow.prepareClose({ deadlineAt: 6_000 })
    .then((value) => { closeSettled = true; return value; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closeSettled, false);
  assert.deepEqual(harness.calls.filter((call) => call.startsWith("cancel:")), []);
  releaseCommit();
  assert.equal((await commit).status, "succeeded");
  assert.equal(await close, true);
});

test("disposal rolls back an awaiting transaction and rejects later admissions", async () => {
  const harness = fixture({
    open: async () => ({ status: "succeeded", value: { awaitingFile: true } }),
  });
  await harness.workflow.openProject({ kind: "local" });
  harness.workflow.dispose();
  assert.equal(harness.navigation.snapshot.phase, "idle");
  assert.equal(harness.tabs.snapshot.activeTabId, `document:${A.projectId}:${A.documentId}`);
  const outcome = await harness.workflow.openProject({ kind: "local" });
  assert.equal(outcome.code, "WORKBENCH_NAVIGATION_DISPOSED");
});
