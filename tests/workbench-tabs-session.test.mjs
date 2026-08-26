import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkbenchTabsSession,
  reconcileWorkbenchTabsWhenReady,
} from "../app/application/workbench-tabs-session.js";

const a = { projectId: "project_alpha", documentId: "doc_alpha", title: "Alpha" };
const b = { projectId: "project_beta", documentId: "doc_beta", title: "Beta" };

test("tabs deduplicate by durable project and document identity", () => {
  const session = createWorkbenchTabsSession();
  session.bindDocument(a);
  session.bindDocument({ ...a, title: "Alpha renamed" });
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "document").length, 1);
  assert.equal(
    session.snapshot.tabs.find((tab) => tab.kind === "document").title,
    "Alpha renamed",
  );
});

test("opening from the active Start converts only that blank tab in place", () => {
  const session = createWorkbenchTabsSession();
  session.createStart({ focus: true });
  const before = session.snapshot.tabs.length;
  const inactiveStartId = session.snapshot.tabs.find(
    (tab) => tab.kind === "start" && tab.tabId !== session.snapshot.activeTabId,
  ).tabId;
  session.bindDocument(a);
  assert.equal(session.snapshot.tabs.length, before);
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === inactiveStartId), true);
  assert.equal(session.snapshot.tabs.find(
    (tab) => tab.tabId === session.snapshot.activeTabId,
  )?.projectId, a.projectId);
  session.bindDocument({ ...a, title: "Alpha renamed" });
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "document").length, 1);
  assert.equal(session.snapshot.tabs.length, before);
});

test("staging a registered project from active Start reuses the blank slot", () => {
  const session = createWorkbenchTabsSession();
  session.createStart({ focus: true });
  const before = session.snapshot.tabs.length;
  const replacedStartId = session.snapshot.activeTabId;
  const staged = session.stageDocument(a);
  assert.ok(staged);
  assert.equal(session.snapshot.tabs.length, before);
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === replacedStartId), true);
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === staged.tabId), false);
  assert.equal(session.resolveTab(staged.tabId)?.tabId, staged.tabId);
  session.beginSwitch(staged.tabId);
  assert.equal(session.snapshot.pendingTabId, staged.tabId);
  assert.equal(session.snapshot.activeTabId, replacedStartId);
  session.bindDocument({ ...a, title: "Alpha renamed", focus: false });
  session.commitDocument({ ...a, tabId: staged.tabId, title: "Alpha renamed" });
  assert.equal(session.snapshot.activeTabId, staged.tabId);
  assert.equal(session.snapshot.tabs.some((tab) => tab.tabId === replacedStartId), false);
  assert.equal(session.snapshot.tabs.find((tab) => tab.tabId === staged.tabId)?.title, "Alpha renamed");
  assert.equal(session.snapshot.tabs.length, before);
});

test("opening an already represented document from active Start removes the blank and focuses the existing tab", () => {
  const session = createWorkbenchTabsSession();
  session.bindDocument(a);
  session.createStart({ focus: true });
  const before = session.snapshot.tabs.length;
  session.bindDocument({ ...a, title: "Alpha existing" });
  assert.equal(session.snapshot.tabs.length, before - 1);
  assert.equal(session.snapshot.tabs.filter((tab) => tab.kind === "document").length, 1);
  assert.equal(session.snapshot.tabs.find((tab) => tab.tabId === session.snapshot.activeTabId)?.title, "Alpha existing");
});

test("switch is pending until the single mounted controller publishes the document", () => {
  const session = createWorkbenchTabsSession();
  session.bindDocument(a);
  session.bindDocument({ ...b, focus: false });
  const beta = session.snapshot.tabs.find((tab) => tab.projectId === b.projectId);
  session.beginSwitch(beta.tabId);
  assert.equal(session.snapshot.activeTabId.includes("alpha"), true);
  assert.equal(session.snapshot.pendingTabId, beta.tabId);
  session.bindDocument(b);
  assert.equal(session.snapshot.activeTabId, beta.tabId);
  assert.equal(session.snapshot.mountedDocumentTabId, beta.tabId);
});

test("closing the last document enters the start tab without deleting durable facts", () => {
  const session = createWorkbenchTabsSession();
  const document = session.bindDocument(a).tabs.find((tab) => tab.kind === "document");
  const result = session.close(document.tabId);
  assert.equal(result.snapshot.tabs.some((tab) => tab.kind === "document"), false);
  assert.equal(result.snapshot.tabs.some((tab) => tab.kind === "start"), true);
  assert.equal(result.snapshot.mountedDocumentTabId, null);
});

test("serialized state contains identity and presentation only", () => {
  const session = createWorkbenchTabsSession();
  session.bindDocument(a);
  const serialized = JSON.stringify(session.serialize());
  assert.match(serialized, /project_alpha/u);
  assert.doesNotMatch(serialized, /sourcePath|html|sha256|\/Users\//u);
});

test("persisted null active identity restores Start without selecting a legacy document", () => {
  const session = createWorkbenchTabsSession();
  session.hydrate({
    version: 1,
    activeTabId: null,
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  });
  assert.equal(session.snapshot.tabs.find(
    (tab) => tab.tabId === session.snapshot.activeTabId,
  )?.kind, "start");
  assert.equal(session.snapshot.pendingTabId, null);
  assert.equal(session.serialize().activeTabId, null);
});

test("restored document titles are projected from the registry and never persisted", () => {
  const session = createWorkbenchTabsSession();
  session.hydrate({
    version: 1,
    activeTabId: "document:project_alpha:doc_alpha",
    tabs: [
      {
        tabId: "document:project_alpha:doc_alpha",
        projectId: "project_alpha",
        documentId: "doc_alpha",
      },
      {
        tabId: "document:project_beta:doc_beta",
        projectId: "project_beta",
        documentId: "doc_beta",
      },
    ],
  });
  const reconciled = session.reconcileRegisteredProjects([
    { ...a, projectName: "Alpha from registry", availability: "ready" },
    { ...b, projectName: "Beta from registry", availability: "ready" },
  ]);
  assert.deepEqual(
    reconciled.snapshot.tabs.filter((tab) => tab.kind === "document").map((tab) => tab.title),
    ["Alpha from registry", "Beta from registry"],
  );
  assert.deepEqual(reconciled.missing, []);
  assert.doesNotMatch(JSON.stringify(session.serialize()), /Alpha from registry|Beta from registry/u);
});

test("missing restored documents are removed and leave a usable Start tab", () => {
  const session = createWorkbenchTabsSession();
  session.hydrate({
    version: 1,
    activeTabId: "document:project_alpha:doc_alpha",
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  });
  const reconciled = session.reconcileRegisteredProjects([]);
  assert.equal(reconciled.missing.length, 1);
  assert.equal(reconciled.snapshot.tabs.length, 1);
  assert.equal(reconciled.snapshot.tabs[0].kind, "start");
  assert.equal(reconciled.snapshot.activeTabId, reconciled.snapshot.tabs[0].tabId);
  assert.equal(reconciled.snapshot.pendingTabId, null);
  assert.equal(reconciled.snapshot.mountedDocumentTabId, null);
});

test("restore reconciliation is deterministic when catalog readiness arrives first", () => {
  const session = createWorkbenchTabsSession();
  const registeredProjects = [
    { ...a, projectName: "Catalog first", availability: "ready" },
  ];
  assert.equal(reconcileWorkbenchTabsWhenReady({
    session,
    tabsPersistenceReady: false,
    registeredProjectsReady: true,
    registeredProjects,
  }), null);
  session.hydrate({
    version: 1,
    activeTabId: null,
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  });
  const reconciled = reconcileWorkbenchTabsWhenReady({
    session,
    tabsPersistenceReady: true,
    registeredProjectsReady: true,
    registeredProjects,
  });
  assert.equal(reconciled.snapshot.tabs.find((tab) => tab.kind === "document")?.title, "Catalog first");
});

test("restore reconciliation is deterministic when tabs hydration arrives first", () => {
  const session = createWorkbenchTabsSession();
  session.hydrate({
    version: 1,
    activeTabId: null,
    tabs: [{
      tabId: "document:project_alpha:doc_alpha",
      projectId: "project_alpha",
      documentId: "doc_alpha",
    }],
  });
  assert.equal(reconcileWorkbenchTabsWhenReady({
    session,
    tabsPersistenceReady: true,
    registeredProjectsReady: false,
    registeredProjects: [],
  }), null);
  const reconciled = reconcileWorkbenchTabsWhenReady({
    session,
    tabsPersistenceReady: true,
    registeredProjectsReady: true,
    registeredProjects: [],
  });
  assert.equal(reconciled.missing.length, 1);
  assert.equal(reconciled.snapshot.tabs.every((tab) => tab.kind === "start"), true);
});

test("binding a twenty-fifth document fails closed instead of creating invalid persistence", () => {
  const session = createWorkbenchTabsSession();
  for (let index = 0; index < 24; index += 1) {
    assert.ok(session.bindDocument({
      projectId: `project_capacity_${index}`,
      documentId: `doc_capacity_${index}`,
      title: `Capacity ${index}`,
      focus: index === 0,
    }));
  }
  assert.equal(session.snapshot.tabs.length, 24);
  assert.equal(session.canAddTab(), false);
  assert.equal(session.canRepresentNewDocument(), false);
  assert.equal(session.bindDocument({
    projectId: "project_capacity_overflow",
    documentId: "doc_capacity_overflow",
    title: "Overflow",
  }), null);
  assert.equal(session.snapshot.tabs.length, 24);
});

test("a full workbench can replace its active Start slot with one accepted document", () => {
  const session = createWorkbenchTabsSession();
  for (let index = 0; index < 23; index += 1) {
    session.bindDocument({
      projectId: `project_replace_${index}`,
      documentId: `doc_replace_${index}`,
      title: `Replace ${index}`,
      focus: false,
    });
  }
  assert.equal(session.snapshot.tabs.length, 24);
  assert.equal(session.canAddTab(), false);
  assert.equal(session.canRepresentNewDocument(), true);
  const bound = session.bindDocument({
    projectId: "project_replacement",
    documentId: "doc_replacement",
    title: "Replacement",
  });
  assert.ok(bound);
  assert.equal(bound.tabs.length, 24);
  assert.equal(bound.tabs.some((tab) => tab.kind === "start"), false);
  assert.equal(bound.tabs.find((tab) => tab.tabId === bound.activeTabId)?.projectId, "project_replacement");
});
