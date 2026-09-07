import assert from "node:assert/strict";
import test from "node:test";
import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";
const { deriveWorkbenchPresentation } = await loadWorkbenchModel("workbench-header-projection");
const { orderedProjectVersions } = await loadWorkbenchModel("project-version-tree-model");
function input() {
  return {
    project: { projectId: "A", documentId: "docA", sourcePath: "/A-V2.html" },
    version: { versions: [1, 2, 3].map((i) => ({ id: `v${i}`, label: `V${i}`, displayFileName: `A-V${i}.html` })), currentBasedOnVersionId: "v2", latestVersionId: "v3", viewingVersionId: "v1", viewMode: "current" },
    activeTab: { tabId: "tabA", kind: "document", title: "A-V2.html", projectId: "A", documentId: "docA" },
    canvasMode: "edit", reviewActive: false, hasReadyPayload: false, hasReadyReviewSession: false,
    reviewPreparing: false, canShowCurrentFileInFolder: true, canOpenCurrentHtmlInDefaultBrowser: true,
    persistState: "idle", editRevision: 0, lastPersistedRevision: 0, hasWorkspaceController: true,
    projectHydrating: false, projectLoadError: false, viewTransitioning: false, runInProgress: false,
    workspaceIssue: false, externalSourcePreview: false, hasDocumentHistoryAction: false, interactionLocked: false,
  };
}
test("history gives sidebar and tab the viewed Version while retaining distinct current/latest identities", () => {
  const source = input(); source.version.viewMode = "history";
  const p = deriveWorkbenchPresentation(source);
  assert.equal(p.selectedVersionId, "v1"); assert.equal(p.displayedVersionId, "v1");
  assert.equal(p.tabTitle, "A-V1.html"); assert.equal(p.viewLabel, "历史");
  assert.equal(p.currentEditingVersionId, "v2"); assert.equal(p.latestVersionId, "v3");
  assert.equal(p.edit.enabled, false); assert.match(p.edit.reason, /历史版本只读/u);
  assert.equal(p.canReloadCurrentSource, false);
  assert.equal(p.mode, "edit"); // projection never claims a preview runtime switch
  assert.equal(source.version.currentBasedOnVersionId, "v2");
});
test("current and review share a selected baseline and change only their display and permissions", () => {
  const source = input(); const current = deriveWorkbenchPresentation(source);
  assert.equal(current.selectedVersionId, "v2"); assert.equal(current.tabTitle, "A-V2.html");
  assert.equal(current.viewLabel, "当前"); assert.equal(current.edit.enabled, true);
  source.reviewActive = true;
  const review = deriveWorkbenchPresentation(source);
  assert.equal(review.selectedVersionId, "v2"); assert.equal(review.viewLabel, "审阅");
  assert.equal(review.edit.enabled, false); assert.equal(review.preview.enabled, false);
  assert.equal(review.review.selected, true);
});
test("a different project tab cannot inherit the old project's history or selection", () => {
  const source = input(); source.version.viewMode = "history";
  source.activeTab = { ...source.activeTab, projectId: "B", documentId: "docB", tabId: "tabB", title: "B.html" };
  const p = deriveWorkbenchPresentation(source);
  assert.equal(p.tabTitle, "B.html"); assert.equal(p.selectedVersionId, null);
  assert.equal(p.displayedVersion, null); assert.equal(p.viewLabel, null);
  assert.equal(p.currentEditingVersionId, null); assert.equal(p.latestVersionId, null);
});
test("safety conditions continue to control file and mode buttons", () => {
  const source = input(); source.runInProgress = true; source.interactionLocked = true;
  source.persistState = "saving";
  const p = deriveWorkbenchPresentation(source);
  assert.equal(p.edit.enabled, false); assert.equal(p.preview.enabled, false);
  assert.equal(p.canOpenCurrentHtml, false); assert.equal(p.canReloadCurrentSource, false);
});
test("a branching lineage still renders V1 through Vn without mutating input", () => {
  const versions = [{ versionId: "v3", ordinal: 3, basedOnVersionId: "v1" }, { versionId: "v1", ordinal: 1 }, { versionId: "v2", ordinal: 2, basedOnVersionId: "v1" }];
  assert.deepEqual(orderedProjectVersions(versions).map((row) => row.ordinal), [1, 2, 3]);
  assert.deepEqual(versions.map((row) => row.ordinal), [3, 1, 2]);
  assert.equal(versions[0].basedOnVersionId, "v1");
});
