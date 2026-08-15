import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  activeManagedLocatorFromOpenTarget,
  normalizeActiveManagedLocator,
  rebaseActiveManagedLocator,
} from "../desktop/active-managed-locator.mjs";

const LOCATOR = {
  projectId: "project_aaaaaaaaaaaaaaaa",
  documentId: "doc_bbbbbbbbbbbbbbbb",
  workingCopyId: "work_ver_0001",
  versionId: "ver_0001",
  sourcePath: "/tmp/PageRoot/项目/demo/page-V1.html",
  sourceSha256: "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  projectRootPath: "/tmp/PageRoot/项目/demo",
};

test("old desktop state without activeManagedLocator stays inert", () => {
  assert.equal(normalizeActiveManagedLocator(undefined), null);
  assert.equal(normalizeActiveManagedLocator(null), null);
  assert.equal(normalizeActiveManagedLocator({ activePath: "/tmp/page.html" }), null);
  assert.equal(normalizeActiveManagedLocator({
    ...LOCATOR,
    sourceSha256: "not-a-hash",
  }), null);
});

test("a valid locator round-trips and rebases with active/recent paths", () => {
  const normalized = normalizeActiveManagedLocator(LOCATOR);
  assert.equal(normalized.projectId, LOCATOR.projectId);
  assert.equal(normalized.sourcePath, path.resolve(LOCATOR.sourcePath));
  assert.equal(normalized.projectRootPath, path.resolve(LOCATOR.projectRootPath));

  const nextPath = "/tmp/PageRoot/项目/demo/Finder renamed.html";
  const rebased = rebaseActiveManagedLocator(normalized, {
    previousSourcePath: LOCATOR.sourcePath,
    nextSourcePath: nextPath,
    sourceSha256: LOCATOR.sourceSha256,
    projectRootPath: "/tmp/PageRoot/项目/demo-renamed",
  });
  assert.equal(rebased.workingCopyId, "work_ver_0001");
  assert.equal(rebased.versionId, "ver_0001");
  assert.equal(rebased.sourcePath, path.resolve(nextPath));
  assert.equal(rebased.projectRootPath, path.resolve("/tmp/PageRoot/项目/demo-renamed"));

  const unrelated = rebaseActiveManagedLocator(normalized, {
    previousSourcePath: "/tmp/other.html",
    nextSourcePath: "/tmp/other-renamed.html",
  });
  assert.equal(unrelated.sourcePath, normalized.sourcePath);
});

test("an OpenTarget can seed the restart locator cache", () => {
  const locator = activeManagedLocatorFromOpenTarget({
    projectId: LOCATOR.projectId,
    documentId: LOCATOR.documentId,
    workingCopyId: LOCATOR.workingCopyId,
    versionId: LOCATOR.versionId,
    exactSourcePath: LOCATOR.sourcePath,
    sourceSha256: LOCATOR.sourceSha256,
    projectRootPath: LOCATOR.projectRootPath,
    targetKind: "working-copy",
  });
  assert.deepEqual(locator, normalizeActiveManagedLocator(LOCATOR));
});
