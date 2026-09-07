import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import { fixture, importSource, promoteNextVersion, registryPath } from "./project-file-repository-harness.mjs";
async function observeReads(action) {
  const originals = Object.fromEntries(["writeFile", "rename", "link", "unlink", "mkdir", "open", "readFile"].map((key) => [key, fs[key]]));
  const writes = []; const htmlReads = [];
  for (const key of Object.keys(originals)) fs[key] = async (...args) => {
    if (["writeFile", "rename", "link", "unlink", "mkdir"].includes(key)) writes.push([key, String(args[0])]);
    if (["open", "readFile"].includes(key) && /\.html?$/iu.test(String(args[0]))) htmlReads.push(String(args[0]));
    return originals[key](...args);
  };
  syncBuiltinESMExports();
  try { await action(); } finally { Object.assign(fs, originals); syncBuiltinESMExports(); }
  assert.deepEqual(writes, []); assert.deepEqual(htmlReads, []);
}
test("catalog expansion and refresh do not write or read HTML after startup recovery", async (t) => {
  const f = await fixture(t); const { target } = await importSource(f);
  await promoteNextVersion(f.repository, target, "catalog_v2");
  await f.repository.initialize();
  await observeReads(async () => {
    for (let i = 0; i < 3; i++) {
      const rows = await f.repository.listRegisteredProjects();
      assert.equal(rows[0].sourceStatus, "unknown");
      assert.equal((await f.repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })).versions.length, 2);
    }
  });
});
test("catalog discovers renamed folders without rebinding registry and retains missing-file metadata", async (t) => {
  const f = await fixture(t); const { target } = await importSource(f);
  await f.repository.initialize();
  const before = await fs.readFile(registryPath(f));
  const renamed = `${target.projectRootPath}-renamed`;
  await fs.rename(target.projectRootPath, renamed);
  await fs.rm(path.join(renamed, path.basename(target.exactSourcePath)));
  await observeReads(async () => {
    const rows = await f.repository.listRegisteredProjects();
    assert.equal(rows[0].documentId, target.documentId);
    assert.equal(rows[0].sourceStatus, "missing");
    assert.equal((await f.repository.listRegisteredProjectVersionSummaries({ projectId: target.projectId })).versions.length, 1);
  });
  assert.deepEqual(await fs.readFile(registryPath(f)), before);
});
