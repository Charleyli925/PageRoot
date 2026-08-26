import assert from "node:assert/strict";
import test from "node:test";

import { createWorkbenchTabsSession } from "../app/application/workbench-tabs-session.js";

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
