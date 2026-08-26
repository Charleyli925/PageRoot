import assert from "node:assert/strict";
import {
  cp,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { sha256 } from "../scripts/lifecycle-core.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../scripts/project-file-repository.mjs";
import {
  fixture,
  html,
  importSource,
  json,
  registryPath,
  wait,
} from "./project-file-repository-harness.mjs";

test("two repository instances importing the same path publish only one project", async (t) => {
  const value = await fixture(t);
  const sourcePath = path.join(value.sources, "concurrent-same.html");
  const buffer = Buffer.from(html("concurrent same"), "utf8");
  await writeFile(sourcePath, buffer);
  const expectedSourceSha256 = sha256(buffer);

  let releaseFirst = () => {};
  const firstPaused = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let firstReached;
  const firstReady = new Promise((resolve) => {
    firstReached = resolve;
  });
  t.after(() => releaseFirst());
  const firstRepository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "import-intent-recorded") {
        firstReached();
        await firstPaused;
      }
      return false;
    },
  });
  const firstImport = firstRepository.importExternal({
    sourcePath,
    expectedSourceSha256,
  });
  await firstReady;

  const secondRepository = new ProjectFileRepository({ projectsRoot: value.projects });
  const secondImport = secondRepository.importExternal({
    sourcePath,
    expectedSourceSha256,
  });
  await wait(40);
  releaseFirst();
  const [firstResult, secondResult] = await Promise.all([firstImport, secondImport]);
  assert.equal(
    [firstResult, secondResult].filter((result) => result.imported).length,
    1,
  );
  assert.equal(firstResult.target.projectId, secondResult.target.projectId);
  const registry = await json(registryPath(value));
  assert.equal(Object.keys(registry.projects).length, 1);
  assert.deepEqual(registry.pendingImports, {});
});

test("two repository instances importing different paths keep both Registry entries", async (t) => {
  const value = await fixture(t);
  const firstPath = path.join(value.sources, "concurrent-a.html");
  const secondPath = path.join(value.sources, "concurrent-b.html");
  const firstBuffer = Buffer.from(html("concurrent a"), "utf8");
  const secondBuffer = Buffer.from(html("concurrent b"), "utf8");
  await writeFile(firstPath, firstBuffer);
  await writeFile(secondPath, secondBuffer);

  let releaseFirst = () => {};
  const firstPaused = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let firstReached;
  const firstReady = new Promise((resolve) => {
    firstReached = resolve;
  });
  t.after(() => releaseFirst());
  const firstRepository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "import-intent-recorded") {
        firstReached();
        await firstPaused;
      }
      return false;
    },
  });
  const firstImport = firstRepository.importExternal({
    sourcePath: firstPath,
    expectedSourceSha256: sha256(firstBuffer),
  });
  await firstReady;

  const secondRepository = new ProjectFileRepository({ projectsRoot: value.projects });
  const secondImport = secondRepository.importExternal({
    sourcePath: secondPath,
    expectedSourceSha256: sha256(secondBuffer),
  });
  await wait(40);
  releaseFirst();
  const [firstResult, secondResult] = await Promise.all([firstImport, secondImport]);
  assert.equal(firstResult.imported, true);
  assert.equal(secondResult.imported, true);
  assert.notEqual(firstResult.target.projectId, secondResult.target.projectId);
  const registry = await json(registryPath(value));
  assert.deepEqual(
    Object.keys(registry.projects).sort(),
    [firstResult.target.projectId, secondResult.target.projectId].sort(),
  );
});

test("duplicate external-source claims fail closed without changing Registry bytes", async (t) => {
  const value = await fixture(t);
  const first = await importSource(value, "冲突甲.html");
  const second = await importSource(value, "冲突乙.html");
  const filePath = registryPath(value);
  const registry = await json(filePath);
  const firstRecord = registry.projects[first.target.projectId];
  registry.projects[second.target.projectId].importSourceKey = firstRecord.importSourceKey;
  registry.projects[second.target.projectId].importSourceSha256 = firstRecord.importSourceSha256;
  const seeded = Buffer.from(`${JSON.stringify(registry, null, 2)}\n`, "utf8");
  await writeFile(filePath, seeded);

  await assert.rejects(
    value.repository.classifyOpenPath({ sourcePath: first.sourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "EXTERNAL_SOURCE_BINDING_CONFLICT",
  );
  await assert.rejects(
    value.repository.importExternal({
      sourcePath: first.sourcePath,
      expectedSourceSha256: sha256(first.buffer),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "EXTERNAL_SOURCE_BINDING_CONFLICT",
  );
  assert.deepEqual(await readFile(filePath), seeded);
  assert.equal(
    (await readdir(value.projects, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith(".")).length,
    2,
  );
});

test("only a Registry pending-import intent can recover a published import", async (t) => {
  for (const failpoint of [
    "import-directories-created",
    "import-snapshot-written",
    "import-working-copy-written",
    "import-metadata-written",
  ]) {
    const value = await fixture(t);
    const sourcePath = path.join(value.sources, "fault.html");
    const source = html(failpoint);
    await writeFile(sourcePath, source, "utf8");
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(
      failing.importExternal({
        sourcePath,
        expectedSourceSha256: sha256(Buffer.from(source, "utf8")),
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
      failpoint,
    );
    assert.equal(await readFile(sourcePath, "utf8"), source, failpoint);
    assert.deepEqual(
      (await readdir(value.projects)).filter(
        (entry) => entry !== ".pageroot-registry.json",
      ),
      [],
      failpoint,
    );
  }

  const published = await fixture(t);
  const publishedSourcePath = path.join(published.sources, "published.html");
  const publishedSource = html("pending registry intent");
  await writeFile(publishedSourcePath, publishedSource, "utf8");
  const interruptedAfterPublish = new ProjectFileRepository({
    projectsRoot: published.projects,
    failpoint: async (name) => name === "import-project-published",
  });
  await assert.rejects(
    interruptedAfterPublish.importExternal({
      sourcePath: publishedSourcePath,
      expectedSourceSha256: sha256(Buffer.from(publishedSource, "utf8")),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const pendingRegistry = await json(path.join(
    published.projects,
    ".pageroot-registry.json",
  ));
  assert.equal(Object.keys(pendingRegistry.projects).length, 0);
  assert.equal(Object.keys(pendingRegistry.pendingImports).length, 1);
  const publishedRoots = (await readdir(published.projects, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  assert.equal(publishedRoots.length, 1);
  const recoveredPublish = new ProjectFileRepository({ projectsRoot: published.projects });
  await recoveredPublish.initialize();
  const reopenedPublished = await recoveredPublish.resolveOpenTarget({
    sourcePath: path.join(published.projects, publishedRoots[0].name, "published-V1.html"),
  });
  assert.equal(reopenedPublished.targetKind, "working-copy");
  const recoveredRegistry = await json(path.join(
    published.projects,
    ".pageroot-registry.json",
  ));
  assert.equal(Object.keys(recoveredRegistry.pendingImports).length, 0);
  assert.equal(Object.keys(recoveredRegistry.projects).length, 1);

  const committed = await fixture(t);
  const committedSourcePath = path.join(committed.sources, "committed.html");
  const committedSource = html("registry committed");
  await writeFile(committedSourcePath, committedSource, "utf8");
  const reportedUnknown = new ProjectFileRepository({
    projectsRoot: committed.projects,
    failpoint: async (name) => name === "import-registry-written",
  });
  await assert.rejects(
    reportedUnknown.importExternal({
      sourcePath: committedSourcePath,
      expectedSourceSha256: sha256(Buffer.from(committedSource, "utf8")),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const committedRoots = (await readdir(committed.projects, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."));
  assert.equal(committedRoots.length, 1);
  const reopened = await new ProjectFileRepository({
    projectsRoot: committed.projects,
  }).resolveOpenTarget({
    sourcePath: path.join(committed.projects, committedRoots[0].name, "committed-V1.html"),
  });
  assert.equal(reopened.targetKind, "working-copy");
  const retriedImport = await new ProjectFileRepository({
    projectsRoot: committed.projects,
  }).importExternal({
    sourcePath: committedSourcePath,
    expectedSourceSha256: sha256(Buffer.from(committedSource, "utf8")),
  });
  assert.equal(retriedImport.imported, false);
  assert.equal(retriedImport.target.projectId, reopened.projectId);
  assert.equal(retriedImport.target.versionId, "ver_0001");
  assert.equal(retriedImport.target.workingCopyId, "work_ver_0001");
  const committedRegistry = await json(path.join(
    committed.projects,
    ".pageroot-registry.json",
  ));
  assert.equal(Object.keys(committedRegistry.projects).length, 1);

  const recovered = await fixture(t);
  const imported = await importSource(recovered, "recovery.html");
  const copiedRoot = path.join(recovered.projects, "unregistered-copy");
  await cp(imported.target.projectRootPath, copiedRoot, { recursive: true });
  const registryPath = path.join(recovered.projects, ".pageroot-registry.json");
  const registry = await json(registryPath);
  delete registry.projects[imported.target.projectId];
  await writeFile(registryPath, JSON.stringify(registry), "utf8");

  const restart = new ProjectFileRepository({ projectsRoot: recovered.projects });
  await restart.initialize();
  const originalUnregistered = await restart.resolveOpenTarget({
    sourcePath: imported.target.exactSourcePath,
  });
  const copiedUnregistered = await restart.resolveOpenTarget({
    sourcePath: path.join(copiedRoot, path.basename(imported.target.exactSourcePath)),
  });
  assert.equal(originalUnregistered, null);
  assert.equal(copiedUnregistered, null);
});
