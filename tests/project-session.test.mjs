import assert from "node:assert/strict";
import test from "node:test";

import { ProjectSession } from "../app/application/project-session.js";

test("project session distinguishes a locator from registered authority", () => {
  const session = new ProjectSession();
  const locator = session.openLocator("/tmp/page.html");
  assert.equal(locator.epoch, 1);
  assert.equal(session.context, null);

  assert.equal(session.register({
    epoch: locator.epoch + 1,
    sourcePath: "/tmp/page.html",
    projectId: "project",
    documentId: "document",
  }), null);
  const context = session.register({
    epoch: locator.epoch,
    sourcePath: "/tmp/page.html",
    projectId: "project",
    documentId: "document",
  });
  assert.deepEqual(context, {
    epoch: 1,
    sourcePath: "/tmp/page.html",
    projectId: "project",
    documentId: "document",
  });
  assert.equal(session.matches(context), true);
});

test("project source transitions advance generation and retire old queries", () => {
  const session = new ProjectSession();
  const locator = session.openLocator("/tmp/page.html");
  session.register({
    ...locator,
    projectId: "project",
    documentId: "document",
  });
  const query = session.beginQuery("workspace");
  const transitioned = session.transitionSource({
    previousSourcePath: "/tmp/page.html",
    sourcePath: "/tmp/page-V1.2.html",
  });

  assert.equal(transitioned.epoch, 2);
  assert.equal(transitioned.projectId, "project");
  assert.equal(transitioned.documentId, "document");
  assert.equal(session.isQueryCurrent(query), false);
  assert.equal(session.matches({
    epoch: 1,
    sourcePath: "/tmp/page.html",
    projectId: "project",
    documentId: "document",
  }), false);
});

test("project queries reject a later query with the same complete identity", () => {
  const session = new ProjectSession();
  const locator = session.openLocator("/tmp/page.html");
  session.register({
    ...locator,
    projectId: "project",
    documentId: "document",
  });
  const first = session.beginQuery("workspace");
  const second = session.beginQuery("workspace");
  assert.equal(session.isQueryCurrent(first), false);
  assert.equal(session.isQueryCurrent(second), true);
});
