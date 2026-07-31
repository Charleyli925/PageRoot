import assert from "node:assert/strict";
import test from "node:test";

import { VersionSession } from "../app/application/version-session.js";

test("version session adopts one complete workspace authority", () => {
  const session = new VersionSession();
  const version = { id: "version_002" };
  session.hydrate({
    versions: [version],
    latestVersionId: version.id,
    currentBasedOnVersionId: "version_001",
    currentExactVersionId: null,
    restoredFromVersionId: "version_001",
  });

  assert.deepEqual(session.snapshot.versions, [version]);
  assert.equal(session.snapshot.latestVersionId, "version_002");
  assert.equal(session.snapshot.currentBasedOnVersionId, "version_001");
  assert.equal(session.snapshot.restoredFromVersionId, "version_001");
});

test("version session restores a failed history transition atomically", () => {
  const session = new VersionSession();
  session.adoptCommitted("version_002");
  const previousView = session.captureView();
  session.enterHistory("version_001");
  assert.equal(session.snapshot.viewMode, "history");
  assert.equal(session.snapshot.viewingVersionId, "version_001");

  session.restoreView(previousView);
  assert.equal(session.snapshot.viewMode, "current");
  assert.equal(session.snapshot.viewingVersionId, null);
});

test("source edits retire only exact-version identity", () => {
  const session = new VersionSession();
  session.adoptCommitted("version_002");
  assert.equal(session.markSourceEdited(), true);
  assert.equal(session.snapshot.currentExactVersionId, null);
  assert.equal(session.snapshot.currentBasedOnVersionId, "version_002");
  assert.equal(session.snapshot.latestVersionId, "version_002");
});
