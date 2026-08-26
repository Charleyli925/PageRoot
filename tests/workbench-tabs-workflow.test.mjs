import assert from "node:assert/strict";
import test from "node:test";

import { createWorkbenchTabsSession } from "../app/application/workbench-tabs-session.js";
import { WorkbenchTabsWorkflow } from "../app/application/workbench-tabs-workflow.js";

function controllerFixture() {
  let snapshot = { projectSession: { projectId: "project_alpha", documentId: "doc_alpha" } };
  const listeners = new Set();
  const calls = [];
  return {
    calls,
    controller: {
      getSnapshot: () => snapshot,
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async drainBoundary() { calls.push("drain"); return { ok: true }; },
      async openProject(input) {
        calls.push("prepareSwitch");
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
  const session = createWorkbenchTabsSession();
  session.bindDocument({ projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" });
  session.bindDocument({ projectId: "project_beta", documentId: "doc_beta", title: "Beta", focus: false });
  const { controller, calls } = controllerFixture();
  const workflow = new WorkbenchTabsWorkflow({ session, controller });
  const beta = session.snapshot.tabs.find((tab) => tab.projectId === "project_beta");
  const outcome = await workflow.activate(beta.tabId);
  assert.equal(outcome.status, "succeeded");
  assert.deepEqual(calls, ["prepareSwitch", "drain", "open:project_beta"]);
  assert.equal(session.snapshot.activeTabId, beta.tabId);
  assert.equal(session.snapshot.runtimeOwnerTabId, beta.tabId);
});

test("start activation drains the current controller and only unmounts the outlet", async () => {
  const session = createWorkbenchTabsSession();
  const document = session.bindDocument({ projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" }).tabs.find((tab) => tab.kind === "document");
  const { controller, calls } = controllerFixture();
  const workflow = new WorkbenchTabsWorkflow({ session, controller });
  const start = session.createStart({ focus: false }).tabs.find((tab) => tab.kind === "start" && tab.tabId !== "start:1");
  await workflow.activate(start.tabId);
  assert.deepEqual(calls, ["drain"]);
  assert.equal(session.snapshot.mountedDocumentTabId, null);
  assert.equal(session.snapshot.runtimeOwnerTabId, document.tabId);
});
