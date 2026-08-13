import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../scripts/lifecycle-core.mjs";
import {
  finalizeProjectFileAttempt,
} from "../scripts/project-file-finalizer.mjs";
import { ProjectFileRepository } from "../scripts/project-file-repository.mjs";

function html(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1></body></html>`;
}

test("project-file finalizer freezes a Candidate output without publishing a Version", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-project-finalizer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.html");
  const source = html("V1");
  await writeFile(sourcePath, source, "utf8");
  const repository = new ProjectFileRepository({ projectsRoot: path.join(root, "projects") });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(source, "utf8")),
  });
  const request = await repository.prepareRequest({
    target: imported.target,
    requestId: "req_finalizer",
    expectedSourceSha256: imported.target.sourceSha256,
    prompt: "# Candidate\n",
  });
  const outputPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    ...request.outputRelativePath.split("/"),
  );
  await writeFile(outputPath, html("Candidate"), "utf8");

  const finalized = await finalizeProjectFileAttempt({
    projectRoot: imported.target.projectRootPath,
    requestId: request.requestId,
    attemptId: request.attemptId,
  });
  assert.equal(finalized.ok, true);
  assert.equal(finalized.status, "completed");
  assert.equal(finalized.proposedVersionId, "ver_0002");
  const replayed = await finalizeProjectFileAttempt({
    projectRoot: imported.target.projectRootPath,
    requestId: request.requestId,
    attemptId: request.attemptId,
  });
  assert.equal(replayed.replayed, true);
  assert.equal(await readFile(sourcePath, "utf8"), source);
  const manifest = JSON.parse(await readFile(
    path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.equal(manifest.latestOfficialVersionId, "ver_0001");
  assert.equal(manifest.versions.length, 1);

  const registryPath = path.join(root, "projects", ".pageroot-registry.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  delete registry.projects[imported.target.projectId];
  await writeFile(registryPath, JSON.stringify(registry), "utf8");
  await assert.rejects(
    finalizeProjectFileAttempt({
      projectRoot: imported.target.projectRootPath,
      requestId: request.requestId,
      attemptId: request.attemptId,
    }),
    (error) => error?.code === "REGISTERED_PROJECT_UNAVAILABLE",
  );
});
