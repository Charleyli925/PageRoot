import assert from "node:assert/strict";
import test from "node:test";
import { decodeWorkspaceResponse } from "../app/application/workspace-controller-codecs.js";
import { VersionSession } from "../app/application/version-session.js";
import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";
const versionModel = await loadWorkbenchModel("version-model");
const records = await loadWorkbenchModel("record-model");
const comments = await loadWorkbenchModel("comment-model");
const summaries = await loadWorkbenchModel("project-version-tree-model");
const codecs = { ...versionModel, ...records, ...comments };
function response() {
  return {
    projectId: "project_test", documentId: "document_test",
    latestVersionId: "ver_0008", currentBasedOnVersionId: "ver_0002", currentExactVersionId: null,
    versions: Array.from({ length: 8 }, (_, index) => ({
      schemaVersion: "4.0.0", versionId: `ver_${String(index + 1).padStart(4, "0")}`,
      ordinal: index + 1, sourceType: index ? "internal-ai" : "initial",
      createdAt: "2026-09-01T00:00:00.000Z", displayFileName: `sample-V${index + 1}.html`,
      isActiveWorkingCopy: true, isLatestOfficial: true,
    })),
    runtimeState: { draft: {
      draftRevision: 3,
      comments: [{ commentId: "comment_one", text: "preserve this draft", target: { targetId: "target_one", selector: "body", tagName: "body", level: "module" } }],
      changeEvents: [{ eventId: "change_one", kind: "text", target: { targetId: "target_one", selector: "body", tagName: "body", level: "module" }, createdAt: "2026-09-01T00:00:00.000Z", basedOnVersionId: "ver_0002", revision: 2, provenance: { actor: { kind: "human", id: "local" }, device: "device_22743a39-3445-4283-ba90-ba39ec4b72e2" }, before: "before", after: "after" }],
    } },
  };
}
function publish(session, payload) {
  const decoded = decodeWorkspaceResponse(payload, codecs);
  session.hydrate({ ...payload, versions: decoded.versions });
  return decoded;
}
test("eight real Bridge rows remain distinct through the production decoder and Session", () => {
  const payload = response();
  assert.ok(payload.versions.every((row) => !Object.hasOwn(row, "id")));
  const session = new VersionSession();
  const decoded = publish(session, payload);
  assert.equal(new Set(session.snapshot.versions.map((version) => version.id)).size, 8);
  const rows = summaries.projectVersionSummariesFromVersions(session.snapshot.versions,
    payload.projectId, payload.documentId, "sample-V2.html", {
      activeVersionId: session.snapshot.currentBasedOnVersionId, latestVersionId: session.snapshot.latestVersionId,
    });
  assert.deepEqual(rows.filter((row) => row.isActiveWorkingCopy).map((row) => row.versionId), ["ver_0002"]);
  assert.deepEqual(rows.filter((row) => row.isLatestOfficial).map((row) => row.versionId), ["ver_0008"]);
  assert.equal(new Set(rows.map((row) => row.displayFileName)).size, 8);
  assert.equal(decoded.comments[0].commentId, "comment_one");
  assert.equal(decoded.comments[0].target.id, "target_comment_one");
  assert.equal(decoded.changeEvents[0].eventId, "change_one");
  assert.equal(decoded.changeEvents[0].target.id, "target_one");
  assert.equal(decoded.draft.comments[0].target.targetId, "target_one");
});
for (const [label, corrupt] of [
  ["missing ID", (p) => { delete p.versions[0].versionId; }],
  ["duplicate ID", (p) => { p.versions[1].versionId = p.versions[0].versionId; }],
  ["illegal ordinal", (p) => { p.versions[0].ordinal = 0; }],
  ["duplicate ordinal", (p) => { p.versions[1].ordinal = 1; }],
  ["wrong project", (p) => { p.versions[0].projectId = "other"; }],
  ["missing current target", (p) => { p.currentBasedOnVersionId = "ver_0099"; }],
  ["missing latest target", (p) => { p.latestVersionId = "ver_0099"; }],
  ["invalid draft comment", (p) => { delete p.runtimeState.draft.comments[0].commentId; }],
  ["invalid change event", (p) => { delete p.runtimeState.draft.changeEvents[0].eventId; }],
  ["invalid persisted provenance", (p) => { p.runtimeState.draft.changeEvents[0].provenance.device = "invalid"; }],
  ["unknown edit field", (p) => { p.runtimeState.draft.changeEvents[0].unexpected = true; }],
  ["invalid draft", (p) => { p.runtimeState.draft = null; }],
]) test(`${label} does not replace valid Session authority`, () => {
  const session = new VersionSession();
  publish(session, response());
  const before = session.snapshot;
  const payload = response(); corrupt(payload);
  assert.throws(() => publish(session, payload));
  assert.equal(session.snapshot, before);
});
test("missing authority leaves both summary markers unknown despite stale row flags", () => {
  const payload = response(); delete payload.latestVersionId; delete payload.currentBasedOnVersionId;
  const { versions } = decodeWorkspaceResponse(payload, codecs);
  const rows = summaries.projectVersionSummariesFromVersions(versions, payload.projectId, payload.documentId, "sample.html");
  assert.ok(rows.every((row) => row.isActiveWorkingCopy === null && row.isLatestOfficial === null));
});
