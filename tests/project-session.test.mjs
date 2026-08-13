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

test("a managed OpenTarget preserves exact file identity through a Session epoch", () => {
  const session = new ProjectSession();
  const locator = session.openLocator("/tmp/external.html");
  const context = session.adoptOpenTarget({
    previousSourcePath: locator.sourcePath,
    target: {
      projectId: "project_0123456789abcdef",
      documentId: "doc_0123456789abcdef",
      projectRootPath: "/tmp/项目",
      targetKind: "working-copy",
      workingCopyId: "work_ver_0001",
      versionId: "ver_0001",
      exactSourcePath: "/tmp/项目/external-V1.html",
      sourceSha256: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    },
  });

  assert.deepEqual(context, {
    epoch: 2,
    projectId: "project_0123456789abcdef",
    documentId: "doc_0123456789abcdef",
    sourcePath: "/tmp/项目/external-V1.html",
    projectRootPath: "/tmp/项目",
    targetKind: "working-copy",
    workingCopyId: "work_ver_0001",
    versionId: "ver_0001",
    exactSourcePath: "/tmp/项目/external-V1.html",
    sourceSha256: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    sessionEpoch: 2,
  });
  assert.equal(session.matches(context), true);
  assert.equal(session.matches({ ...context, exactSourcePath: "/tmp/项目/other.html" }), false);
  assert.equal(session.matches({ ...context, sourceSha256: "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" }), false);
});
