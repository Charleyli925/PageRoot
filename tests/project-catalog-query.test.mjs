import assert from "node:assert/strict";
import test from "node:test";
import { loadCatalogVersionSummaries } from "../app/application/project-catalog-query.js";
import { loadWorkbenchModel } from "./helpers/workbench-model-loader.mjs";
const { projectVersionSummariesFromWorkspace: decode } = await loadWorkbenchModel("project-version-tree-model");
function response(projectId, documentId, count) {
  return { status: "succeeded", value: { projectId, documentId,
    currentBasedOnVersionId: "ver_0001", latestVersionId: `ver_000${count}`,
    versions: Array.from({ length: count }, (_, i) => ({ projectId, documentId, versionId: `ver_000${i + 1}`, ordinal: i + 1, displayFileName: `file-V${i+1}.html`, modifiedAt: "2026-09-07T00:00:00.000Z" })),
  } };
}
function harness() {
  const snapshot = { registered: [{ projectId: "A", documentId: "docA" }, { projectId: "B", documentId: "docB" }], versionSummaries: {} };
  const generations = new Map();
  const publish = (id, entry) => { snapshot.versionSummaries[id] = entry; };
  return { snapshot, generations, publish,
    load: (projectId, read, refresh = true) => loadCatalogVersionSummaries({ projectId, read, refresh, decode, generations, publish, getSnapshot: () => snapshot, isDisposed: () => false }),
  };
}
test("an older V2 response cannot replace a later V3 catalog result", async () => {
  const h = harness(); let resolve;
  await h.load("A", async () => response("A", "docA", 2));
  const old = h.load("A", () => new Promise((r) => { resolve = r; }));
  await h.load("A", async () => response("A", "docA", 3));
  await h.load("B", async () => response("B", "docB", 1));
  resolve(response("A", "docA", 2));
  assert.equal((await old).status, "stale");
  assert.equal(h.snapshot.versionSummaries.A.versions.length, 3);
  assert.equal(h.snapshot.versionSummaries.B.versions.length, 1);
});
test("Session publication cancels a pending older query using the same generation", async () => {
  const h = harness(); let resolve;
  const old = h.load("A", () => new Promise((r) => { resolve = r; }));
  h.generations.set("A", h.generations.get("A") + 1);
  h.publish("A", { documentId: "docA", versions: decode(response("A", "docA", 3).value), status: "ready" });
  resolve(response("A", "docA", 2));
  assert.equal((await old).status, "stale");
  assert.equal(h.snapshot.versionSummaries.A.versions.length, 3);
});
test("failed refresh retains valid versions; first failure stays local", async () => {
  const h = harness(); await h.load("A", async () => response("A", "docA", 2));
  const before = h.snapshot.versionSummaries.A.versions;
  const fail = async () => { throw new Error("unavailable"); };
  await h.load("A", fail); await h.load("B", fail);
  assert.equal(h.snapshot.versionSummaries.A.versions, before);
  assert.equal(h.snapshot.versionSummaries.A.status, "error");
  assert.equal(h.snapshot.versionSummaries.A.reason, "unavailable");
  assert.deepEqual(h.snapshot.versionSummaries.B.versions, []);
});
test("a different document never inherits old project summaries", async () => {
  const h = harness(); await h.load("A", async () => response("A", "docA", 2));
  h.snapshot.registered[0].documentId = "replacement";
  const outcome = await h.load("A", async () => response("A", "docA", 3));
  assert.equal(outcome.status, "rejected");
  assert.deepEqual(h.snapshot.versionSummaries.A.versions, []);
});

test("current Session and background Bridge data produce the same summary shape", async () => {
  const { projectVersionSummariesFromVersions } = await loadWorkbenchModel("project-version-tree-model");
  const wire = response("A", "docA", 3).value;
  const current = projectVersionSummariesFromVersions(wire.versions.map((row) => ({
    id: row.versionId, ordinal: row.ordinal, displayFileName: row.displayFileName,
    generatedAt: row.modifiedAt, modifiedAt: row.modifiedAt,
    basedOnVersionId: row.basedOnVersionId, previousVersionId: row.previousVersionId,
  })), "A", "docA", "file-V1.html", { activeVersionId: wire.currentBasedOnVersionId, latestVersionId: wire.latestVersionId });
  assert.deepEqual(decode(wire), current);
});
