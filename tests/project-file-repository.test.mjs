import assert from "node:assert/strict";
import {
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { sha256 } from "../scripts/lifecycle-core.mjs";
import {
  ProjectFileRepository,
  ProjectFileRepositoryError,
} from "../scripts/project-file-repository.mjs";

function html(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1></body></html>`;
}

async function json(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-project-files-"));
  const sources = path.join(root, "sources");
  const projects = path.join(root, "projects");
  await Promise.all([
    writeFile(path.join(root, ".keep"), "", "utf8"),
    mkdir(sources, { recursive: true }),
  ]);
  t.after(() => rm(root, { recursive: true, force: true }));
  return {
    root,
    sources,
    projects,
    repository: new ProjectFileRepository({ projectsRoot: projects }),
  };
}

async function importSource(fixtureValue, name = "原文件.html", content = html("V1")) {
  const sourcePath = path.join(fixtureValue.sources, name);
  const buffer = Buffer.from(content, "utf8");
  await mkdir(path.dirname(sourcePath), { recursive: true });
  await writeFile(sourcePath, buffer);
  const imported = await fixtureValue.repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(buffer),
  });
  assert.equal(imported.imported, true);
  return { sourcePath, buffer, target: imported.target };
}

test("atomic import creates V1 facts once and ordinary saves never create a Version", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "原文件.htm");
  const original = await readFile(imported.sourcePath);

  assert.equal(imported.target.targetKind, "working-copy");
  assert.equal(imported.target.workingCopyId, "work_ver_0001");
  assert.equal(imported.target.versionId, "ver_0001");
  assert.match(imported.target.exactSourcePath, /原文件-V1\.htm$/u);
  assert.deepEqual(
    Object.keys(await json(path.join(imported.target.projectRootPath, ".pageroot", "project.json"))).sort(),
    ["createdAt", "documentId", "projectId", "schemaVersion"],
  );
  const importRecovery = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "recovery",
    "import.json",
  ));
  assert.equal("externalSourcePath" in importRecovery, false);
  assert.deepEqual(await readFile(imported.sourcePath), original);

  let target = imported.target;
  for (let revision = 1; revision <= 100; revision += 1) {
    const content = html(`save-${revision}`);
    const result = await value.repository.saveWorkingCopy({
      target,
      html: content,
      expectedSourceSha256: target.sourceSha256,
      editRevision: revision,
    });
    assert.equal(result.versionCreated, false);
    target = result.target;
  }

  const manifest = await json(path.join(target.projectRootPath, ".pageroot", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  assert.equal(manifest.latestOfficialVersionId, "ver_0001");
  assert.equal(await readFile(imported.sourcePath, "utf8"), original.toString("utf8"));
});

test("a Candidate is not a Version until adoption, rejection consumes no ordinal, and promotion is idempotent", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const firstCandidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_rejected",
    candidateId: "candidate_rejected_0001",
    html: html("rejected candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });

  assert.equal(firstCandidate.candidate.status, "pending-review");
  assert.equal(firstCandidate.candidate.proposedVersionId, "ver_0002");
  assert.ok(["ready", "attention"].includes(firstCandidate.candidate.assessment.status));
  let manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  assert.equal(manifest.latestOfficialVersionId, "ver_0001");

  const rejected = await value.repository.rejectCandidate({
    target: imported.target,
    candidateId: firstCandidate.candidate.candidateId,
  });
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.latestOfficialVersionId, "ver_0001");

  const secondCandidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_adopted",
    candidateId: "candidate_adopted_0001",
    html: html("adopted candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(secondCandidate.candidate.proposedVersionId, "ver_0002");

  const promoted = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: secondCandidate.candidate.candidateId,
  });
  assert.equal(promoted.promoted, true);
  assert.equal(promoted.version.versionId, "ver_0002");
  assert.equal(promoted.target.workingCopyId, "work_ver_0002");

  const repeated = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: secondCandidate.candidate.candidateId,
  });
  assert.equal(repeated.version.versionId, "ver_0002");
  manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
  assert.equal(manifest.latestOfficialVersionId, "ver_0002");
});

test("blocked Candidate validation never reserves a Version", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  await assert.rejects(
    value.repository.createCandidate({
      target: imported.target,
      requestId: "req_empty_candidate",
      candidateId: "candidate_empty_0001",
      html: "<!doctype html><html><head><title>empty</title></head><body></body></html>",
      expectedSourceSha256: imported.target.sourceSha256,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_UNUSABLE",
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("a Candidate cannot be adopted after its frozen Working Copy changes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_stale_candidate",
    candidateId: "candidate_stale_0001",
    html: html("candidate from V1"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const edited = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("working copy changed after review"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });

  await assert.rejects(
    value.repository.promoteCandidate({
      target: edited.target,
      candidateId: candidate.candidate.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_SOURCE_CHANGED",
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  const persistedCandidate = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    "req_stale_candidate",
    "candidate.json",
  ));
  assert.equal(persistedCandidate.status, "pending-review");
});

test("exact path, rather than equal bytes, determines the opened document", async (t) => {
  const value = await fixture(t);
  const sameBytes = html("same bytes");
  const first = await importSource(value, "left/same.html", sameBytes);
  const second = await importSource(value, "right/same.html", sameBytes);

  assert.equal(first.target.sourceSha256, second.target.sourceSha256);
  assert.notEqual(first.target.projectId, second.target.projectId);
  assert.notEqual(first.target.exactSourcePath, second.target.exactSourcePath);
  assert.equal(path.basename(first.target.projectRootPath), "same");
  assert.equal(path.basename(second.target.projectRootPath), "same (2)");

  const reopenedFirst = await value.repository.resolveOpenTarget({
    sourcePath: first.target.exactSourcePath,
  });
  const reopenedSecond = await value.repository.resolveOpenTarget({
    sourcePath: second.target.exactSourcePath,
  });
  assert.equal(reopenedFirst.projectId, first.target.projectId);
  assert.equal(reopenedFirst.exactSourcePath, first.target.exactSourcePath);
  assert.equal(reopenedSecond.projectId, second.target.projectId);
  assert.equal(reopenedSecond.exactSourcePath, second.target.exactSourcePath);
});

test("folder and HTML rename preserve stable identity; an unknown move pauses writes until reopened", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const renamedRoot = path.join(value.projects, "移动后项目");
  await rename(imported.target.projectRootPath, renamedRoot);

  let saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("after folder rename"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  assert.equal(saved.target.projectRootPath, renamedRoot);
  assert.equal(saved.target.projectId, imported.target.projectId);

  const renamedHtml = path.join(renamedRoot, "用户改名.html");
  await rename(saved.target.exactSourcePath, renamedHtml);
  saved = await value.repository.saveWorkingCopy({
    target: saved.target,
    html: html("after html rename"),
    expectedSourceSha256: saved.target.sourceSha256,
    editRevision: 2,
  });
  assert.equal(saved.target.exactSourcePath, renamedHtml);
  assert.equal(saved.target.projectId, imported.target.projectId);

  const outside = path.join(value.root, "outside");
  await mkdir(outside);
  const movedRoot = path.join(outside, "far-away");
  await rename(renamedRoot, movedRoot);
  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: saved.target,
      html: html("must not write old root"),
      expectedSourceSha256: saved.target.sourceSha256,
      editRevision: 3,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "PROJECT_RELOCATION_REQUIRED",
  );
  assert.equal(await readFile(path.join(movedRoot, "用户改名.html"), "utf8"), html("after html rename"));

  const rebound = await value.repository.resolveOpenTarget({
    sourcePath: path.join(movedRoot, "用户改名.html"),
  });
  assert.equal(rebound.projectId, imported.target.projectId);
  assert.equal(rebound.projectRootPath, movedRoot);
});

test("duplicate project identity requires an explicit reassociation choice", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const copiedRoot = path.join(value.root, "copied-project");
  await cp(imported.target.projectRootPath, copiedRoot, { recursive: true });
  const copiedHtml = path.join(copiedRoot, path.basename(imported.target.exactSourcePath));

  await assert.rejects(
    value.repository.resolveOpenTarget({ sourcePath: copiedHtml }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "DUPLICATE_PROJECT_ID"
      && error.details.actions.join(",") === "reassociate,import-as-new,cancel",
  );
  const reassociated = await value.repository.resolveOpenTarget({
    sourcePath: copiedHtml,
    duplicateResolution: "reassociate",
  });
  assert.equal(reassociated.projectId, imported.target.projectId);
  assert.equal(reassociated.projectRootPath, copiedRoot);

  const importedAsNew = await value.repository.importExternal({
    sourcePath: copiedHtml,
    expectedSourceSha256: reassociated.sourceSha256,
    forceNew: true,
  });
  assert.equal(importedAsNew.imported, true);
  assert.notEqual(importedAsNew.target.projectId, imported.target.projectId);
  const newManifest = await json(path.join(
    importedAsNew.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(newManifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("import fails before publication without registration debris, and rejects symbolic links", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-project-files-fault-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourcePath = path.join(root, "source.html");
  await writeFile(sourcePath, html("fault"), "utf8");
  const projects = path.join(root, "projects");
  const repository = new ProjectFileRepository({
    projectsRoot: projects,
    failpoint: async (name) => name === "import-metadata-written",
  });
  await assert.rejects(
    repository.importExternal({
      sourcePath,
      expectedSourceSha256: sha256(Buffer.from(html("fault"), "utf8")),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const entries = await readdir(projects);
  assert.deepEqual(entries.filter((entry) => entry !== ".pageroot-registry.json"), []);

  const symlinkPath = path.join(root, "linked.html");
  await symlink(sourcePath, symlinkPath);
  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: path.join(root, "safe-projects") })
      .importExternal({ sourcePath: symlinkPath }),
    (error) => error instanceof ProjectFileRepositoryError && error.code === "UNSAFE_FILE",
  );
});

test("import fault injection never leaves a half-registered project and bounded recovery completes a published import", async (t) => {
  for (const failpoint of [
    "import-directories-created",
    "import-snapshot-written",
    "import-working-copy-written",
    "import-metadata-written",
    "import-project-published",
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

  const recovered = await fixture(t);
  const imported = await importSource(recovered, "recovery.html");
  const recoveryPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "recovery",
    "import.json",
  );
  const importRecovery = await json(recoveryPath);
  await writeFile(recoveryPath, JSON.stringify({
    ...importRecovery,
    state: "prepared",
  }), "utf8");
  const registryPath = path.join(recovered.projects, ".pageroot-registry.json");
  const registry = await json(registryPath);
  delete registry.projects[imported.target.projectId];
  await writeFile(registryPath, JSON.stringify(registry), "utf8");

  const restart = new ProjectFileRepository({ projectsRoot: recovered.projects });
  await restart.initialize();
  const rebound = await restart.resolveOpenTarget({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(rebound.projectId, imported.target.projectId);
  assert.equal((await json(recoveryPath)).state, "committed");
});

test("request finalization creates a reviewable Candidate only, and manifest path traversal is refused", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_workflow",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: { summary: "candidate lifecycle" },
    prompt: "# Frozen candidate request\n",
  });
  assert.equal(prepared.status, "processing");
  assert.equal(prepared.proposedVersionId, "ver_0002");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId: prepared.requestId,
    attemptId: prepared.attemptId,
    html: html("request candidate"),
  });
  assert.equal(completed.status, "candidate-ready");
  assert.equal(completed.candidate.status, "pending-review");
  const beforeAdoption = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
  assert.equal(beforeAdoption.latestOfficialVersionId, "ver_0001");
  assert.equal(beforeAdoption.versions.length, 1);

  const manifestPath = path.join(imported.target.projectRootPath, ".pageroot", "manifest.json");
  const tampered = await json(manifestPath);
  tampered.workingCopies[0].sourceRelativePath = "../escape.html";
  await writeFile(manifestPath, JSON.stringify(tampered), "utf8");
  await assert.rejects(
    value.repository.resolveOpenTarget({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && (error.code === "INVALID_RELATIVE_PATH" || error.code === "PATH_ESCAPES_PROJECT"),
  );
});

test("promotion fault recovery leaves exactly one formal Version and regular files at every commit point", async (t) => {
  for (const failpoint of [
    "promotion-prepared",
    "promotion-snapshot-created",
    "promotion-working-copy-created",
    "promotion-manifest-committed",
    "promotion-completed",
  ]) {
    const value = await fixture(t);
    const imported = await importSource(value);
    const candidate = await value.repository.createCandidate({
      target: imported.target,
      requestId: "req_fault",
      candidateId: "candidate_fault_0001",
      html: html("fault recovery candidate"),
      expectedSourceSha256: imported.target.sourceSha256,
    });
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(
      failing.promoteCandidate({
        target: imported.target,
        candidateId: candidate.candidate.candidateId,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
      failpoint,
    );
    const recovery = new ProjectFileRepository({ projectsRoot: value.projects });
    const reopened = await recovery.workspace({
      sourcePath: imported.target.exactSourcePath,
    });
    assert.equal(reopened.manifest.latestOfficialVersionId, "ver_0002");
    const recovered = await recovery.recoverProject({
      projectRootPath: imported.target.projectRootPath,
    });
    assert.deepEqual(recovered, []);
    const manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
    assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
    assert.equal(manifest.latestOfficialVersionId, "ver_0002");
    const htmlInfo = await lstat(path.join(imported.target.projectRootPath, "原文件-V2.html"));
    assert.equal(htmlInfo.isFile(), true);
    assert.equal(htmlInfo.isSymbolicLink(), false);
  }
});
