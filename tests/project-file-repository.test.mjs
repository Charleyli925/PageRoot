import assert from "node:assert/strict";
import {
  cp,
  link,
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
  assert.deepEqual(
    await readdir(path.join(target.projectRootPath, ".pageroot", "recovery")),
    ["import.json"],
  );
});

test("PROJECT.md starts with only the project title and can be cleared", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "项目规则.html");
  const projectNotesPath = path.join(imported.target.projectRootPath, "PROJECT.md");

  assert.equal(await readFile(projectNotesPath, "utf8"), "# 项目规则\n");
  const cleared = await value.repository.updateProjectNotes({
    target: imported.target,
    content: "",
  });

  assert.equal(cleared.updated, true);
  assert.equal(cleared.content, "");
  assert.equal(await readFile(projectNotesPath, "utf8"), "");
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

test("runtime authority seals Candidate record and output after review begins", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_candidate_authority",
    candidateId: "candidate_authority_0001",
    html: html("reviewed candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const requestRoot = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    "req_candidate_authority",
  );
  const runtimePath = path.join(imported.target.projectRootPath, ".pageroot", "runtime-state.json");
  const runtimeBefore = await json(runtimePath);
  const rewrittenHtml = html("unreviewed replacement");
  const rewrittenRecord = await json(path.join(requestRoot, "candidate.json"));
  rewrittenRecord.outputSha256 = sha256(Buffer.from(rewrittenHtml, "utf8"));
  await writeFile(path.join(requestRoot, "candidate.html"), rewrittenHtml, "utf8");
  await writeFile(path.join(requestRoot, "candidate.json"), JSON.stringify(rewrittenRecord), "utf8");

  await assert.rejects(
    value.repository.readCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_AUTHORITY_MISMATCH",
  );
  await assert.rejects(
    value.repository.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_AUTHORITY_MISMATCH",
  );

  const runtimeAfter = await json(runtimePath);
  assert.equal(
    runtimeAfter.activeRequest.candidateOutputSha256,
    runtimeBefore.activeRequest.candidateOutputSha256,
  );
  assert.equal(
    runtimeAfter.activeRequest.candidateRecordSha256,
    runtimeBefore.activeRequest.candidateRecordSha256,
  );
});

test("request recovery promotes a prepared Candidate only when its runtime seal survives", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const request = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_candidate_recovery",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: { summary: "recover sealed candidate" },
    prompt: "# recover sealed candidate\n",
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "candidate-prepared",
  });
  await assert.rejects(
    interrupted.completeRequest({
      target: imported.target,
      requestId: request.requestId,
      attemptId: request.attemptId,
      html: html("candidate after interrupted completion"),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );

  const recovered = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(recovered.activeRequest.status, "candidate-ready");
  assert.equal(recovered.activeCandidate.candidateId, request.candidateId);
});

test("Promotion recovery does not bypass the runtime-sealed Candidate record", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "sealed-promotion.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_sealed_promotion",
    candidateId: "candidate_sealed_promotion_0001",
    html: html("sealed Candidate"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "promotion-working-copy-prepared",
  });
  await assert.rejects(
    interrupted.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );

  const candidatePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    "req_sealed_promotion",
    "candidate.json",
  );
  const replacement = await json(candidatePath);
  replacement.createdAt = "2000-01-01T00:00:00.000Z";
  await writeFile(candidatePath, JSON.stringify(replacement), "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_AUTHORITY_MISMATCH",
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), html("V1"));
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

test("Request publication rechecks source bytes after freezing its input bundle", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "request-boundary.html");
  const externalHtml = html("external edit during request freeze");
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "request-input-manifest-written") {
        await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
      }
      return false;
    },
  });

  await assert.rejects(
    repository.prepareRequest({
      target: imported.target,
      requestId: "req_source_boundary",
      expectedSourceSha256: imported.target.sourceSha256,
      prompt: "# Request\n",
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SOURCE_HASH_CONFLICT",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externalHtml);
  const runtime = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  ));
  assert.equal(runtime.activeRequest, null);
  await assert.rejects(
    readFile(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "requests",
      "req_source_boundary",
      "request.json",
    )),
    (error) => error?.code === "ENOENT",
  );
});

test("save rechecks source bytes immediately before its replacing write", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-boundary.html");
  const externalHtml = html("external edit before save write");
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "save-prepared") {
        await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
      }
      return false;
    },
  });

  await assert.rejects(
    repository.saveWorkingCopy({
      target: imported.target,
      html: html("PageRoot save that must not overwrite"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SOURCE_HASH_CONFLICT",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externalHtml);
});

test("save preserves an external replacement that races after the final source check", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-atomic-boundary.html");
  const externalHtml = html("external edit in the replacement window");
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "save-source-parking") {
        await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
      }
      return false;
    },
  });

  await assert.rejects(
    repository.saveWorkingCopy({
      target: imported.target,
      html: html("PageRoot bytes must not win this race"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SOURCE_HASH_CONFLICT",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externalHtml);
});

test("save refuses a missing Working Copy state before replacing HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-state-boundary.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  await rm(statePath);

  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: imported.target,
      html: html("must stay in memory"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_STATE_NOT_FOUND",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), html("V1"));
});

test("workspace recovers a source safely parked before publication", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-parked-recovery.html");
  const nextHtml = html("recovered after safe parking");
  const failing = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "save-source-parked",
  });

  await assert.rejects(
    failing.saveWorkingCopy({
      target: imported.target,
      html: nextHtml,
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );

  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(reopened.content, nextHtml);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), nextHtml);
});

test("promotion rechecks the Candidate base before manifest publication and recovery", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "promotion-boundary.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_promotion_boundary",
    candidateId: "candidate_promotion_boundary_0001",
    html: html("candidate based on V1"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const externalHtml = html("external edit before promotion commit");
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "promotion-working-copy-created") {
        await writeFile(imported.target.exactSourcePath, externalHtml, "utf8");
      }
      return false;
    },
  });

  await assert.rejects(
    repository.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_SOURCE_CHANGED",
  );
  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).recoverProject({
      projectRootPath: imported.target.projectRootPath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "CANDIDATE_SOURCE_CHANGED",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externalHtml);
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
    "req_promotion_boundary",
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

test("unlisted HTML never acquires a v4 binding from equal bytes or an inode", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "managed.html");
  const equalBytesPath = path.join(imported.target.projectRootPath, "unmanaged-copy.html");
  const hardLinkPath = path.join(imported.target.projectRootPath, "unmanaged-hard-link.html");
  await writeFile(equalBytesPath, await readFile(imported.target.exactSourcePath));
  await link(imported.target.exactSourcePath, hardLinkPath);

  for (const sourcePath of [equalBytesPath, hardLinkPath]) {
    assert.equal(
      await value.repository.resolveOpenTarget({ sourcePath }),
      null,
      sourcePath,
    );
    assert.equal(await value.repository.workspace({ sourcePath }), null, sourcePath);
  }
  const manifestBeforeImport = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(
    manifestBeforeImport.workingCopies.map((entry) => entry.sourceRelativePath),
    ["managed-V1.html"],
  );

  const fresh = await value.repository.importExternal({
    sourcePath: equalBytesPath,
    expectedSourceSha256: sha256(await readFile(equalBytesPath)),
  });
  assert.notEqual(fresh.target.projectId, imported.target.projectId);
  assert.equal(await readFile(hardLinkPath, "utf8"), html("V1"));
  const manifestAfterImport = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifestAfterImport, manifestBeforeImport);
});

test("same-parent root and Working Copy renames preserve identity; moves outside stop writes until return", async (t) => {
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
  const manifestAfterRename = await json(path.join(
    renamedRoot,
    ".pageroot",
    "manifest.json",
  ));
  assert.equal(manifestAfterRename.workingCopies[0].sourceRelativePath, "用户改名.html");
  assert.equal(manifestAfterRename.workingCopies[0].preferredFileStem, "用户改名");

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
      && error.code === "REGISTERED_PROJECT_UNAVAILABLE",
  );
  assert.equal(await readFile(path.join(movedRoot, "用户改名.html"), "utf8"), html("after html rename"));

  const external = await value.repository.resolveOpenTarget({
    sourcePath: path.join(movedRoot, "用户改名.html"),
  });
  assert.equal(external, null);

  await rename(movedRoot, renamedRoot);
  const resumed = await value.repository.resolveOpenTarget({
    sourcePath: path.join(renamedRoot, "用户改名.html"),
  });
  assert.equal(resumed.projectId, imported.target.projectId);
  assert.equal(resumed.projectRootPath, renamedRoot);
  const afterReturn = await value.repository.saveWorkingCopy({
    target: resumed,
    html: html("after return"),
    expectedSourceSha256: resumed.sourceSha256,
    editRevision: 3,
  });
  assert.equal(await readFile(afterReturn.target.exactSourcePath, "utf8"), html("after return"));
});

test("a cross-volume-style move remains external until the project returns to its exact registered path", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "跨卷.html");
  const movedRoot = path.join(value.root, "other-volume", "跨卷项目");
  await mkdir(path.dirname(movedRoot), { recursive: true });

  // A real cross-volume Finder move is copy + delete.  cp() gives the moved
  // tree new file identities even when the test runner has only one volume.
  await cp(imported.target.projectRootPath, movedRoot, { recursive: true });
  await rm(imported.target.projectRootPath, { recursive: true, force: true });
  const movedHtml = path.join(movedRoot, path.basename(imported.target.exactSourcePath));

  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  assert.equal(await restarted.resolveOpenTarget({ sourcePath: movedHtml }), null);
  await assert.rejects(
    restarted.saveWorkingCopy({
      target: imported.target,
      html: html("must not follow cross-volume move"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTERED_PROJECT_UNAVAILABLE",
  );
  assert.equal(await readFile(movedHtml, "utf8"), html("V1"));

  // A return to the exact registered path can safely resume after v4 IDs and
  // manifest validate, even though the copied directory has a new inode.
  await cp(movedRoot, imported.target.projectRootPath, { recursive: true });
  const returnedHtml = path.join(
    imported.target.projectRootPath,
    path.basename(imported.target.exactSourcePath),
  );
  const returned = await restarted.resolveOpenTarget({ sourcePath: returnedHtml });
  assert.equal(returned.projectId, imported.target.projectId);
  const saved = await restarted.saveWorkingCopy({
    target: returned,
    html: html("after registered return"),
    expectedSourceSha256: returned.sourceSha256,
    editRevision: 1,
  });
  assert.equal(saved.target.projectId, imported.target.projectId);
  assert.equal(await readFile(returnedHtml, "utf8"), html("after registered return"));

  // A copied project is an external HTML, even when it carries a .pageroot
  // directory. Its first persistence starts a fresh V1 without copied history.
  const importedCopy = await restarted.importExternal({
    sourcePath: movedHtml,
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(importedCopy.imported, true);
  assert.notEqual(importedCopy.target.projectId, imported.target.projectId);
  const copiedManifest = await json(path.join(
    importedCopy.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(copiedManifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("macOS /private/var spelling resolves the same managed Working Copy without a duplicate prompt", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS path-alias regression");
    return;
  }
  const value = await fixture(t);
  const imported = await importSource(value, "路径别名.html");
  const privateSpelling = imported.target.exactSourcePath === "/var"
    || imported.target.exactSourcePath.startsWith("/var/")
    ? `/private${imported.target.exactSourcePath}`
    : imported.target.exactSourcePath;
  if (privateSpelling === imported.target.exactSourcePath) {
    t.skip("temporary directory is not exposed through /var");
    return;
  }

  const resolved = await value.repository.resolveOpenTarget({
    sourcePath: privateSpelling,
  });
  const workspace = await value.repository.workspace({
    sourcePath: privateSpelling,
  });
  assert.equal(resolved.projectId, imported.target.projectId);
  assert.equal(resolved.workingCopyId, imported.target.workingCopyId);
  assert.equal(workspace.target.projectId, imported.target.projectId);
  assert.equal(workspace.target.workingCopyId, imported.target.workingCopyId);
});

test("nested and symlinked Working Copy mappings are rejected before a save can escape", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const outside = path.join(value.root, "outside");
  const externalDirectory = path.join(outside, "nested");
  const externalHtml = path.join(externalDirectory, "target.html");
  await mkdir(externalDirectory, { recursive: true });
  await writeFile(externalHtml, html("outside before"), "utf8");
  await symlink(outside, path.join(imported.target.projectRootPath, "escape"), "dir");

  const manifestPath = path.join(imported.target.projectRootPath, ".pageroot", "manifest.json");
  const manifest = await json(manifestPath);
  manifest.workingCopies[0].sourceRelativePath = "escape/nested/target.html";
  await writeFile(manifestPath, JSON.stringify(manifest), "utf8");

  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: imported.target,
      html: html("must stay in project"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INVALID_RELATIVE_PATH",
  );
  assert.equal(await readFile(externalHtml, "utf8"), html("outside before"));
  assert.equal(
    await readFile(imported.target.exactSourcePath, "utf8"),
    html("V1"),
  );
});

test("a clean Working Copy adopts external disk bytes; pending PageRoot edits remain a conflict", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "external-change.html");
  const adoptedHtml = html("external clean change");
  await writeFile(imported.target.exactSourcePath, adoptedHtml, "utf8");

  const adopted = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(adopted.workingCopyRecovered, true);
  assert.equal(adopted.content, adoptedHtml);
  assert.equal(adopted.workingCopyState.currentSha256, sha256(Buffer.from(adoptedHtml, "utf8")));

  const statePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "working-copies",
    "work_ver_0001.json",
  );
  const state = await json(statePath);
  await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
  const conflictingDiskHtml = html("external while PageRoot pending");
  await writeFile(imported.target.exactSourcePath, conflictingDiskHtml, "utf8");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_CONFLICT",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), conflictingDiskHtml);
});

test("Registry and managed control paths reject symlinks", async (t) => {
  const rootLink = await fixture(t);
  const imported = await importSource(rootLink, "root-link.html");
  const alias = path.join(rootLink.projects, "symlinked-project");
  await symlink(imported.target.projectRootPath, alias, "dir");
  const registryPath = path.join(rootLink.projects, ".pageroot-registry.json");
  const registry = await json(registryPath);
  registry.projects[imported.target.projectId].registeredProjectRootPath = alias;
  await writeFile(registryPath, JSON.stringify(registry), "utf8");
  await assert.rejects(
    rootLink.repository.resolveOpenTarget({
      sourcePath: path.join(alias, path.basename(imported.target.exactSourcePath)),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && (error.code === "PATH_ESCAPES_PROJECT" || error.code === "UNSAFE_DIRECTORY"),
  );

  const controlLink = await fixture(t);
  const controlImported = await importSource(controlLink, "control-link.html");
  const controlRoot = path.join(controlImported.target.projectRootPath, ".pageroot");
  const relocatedControlRoot = path.join(controlLink.root, "relocated-control-root");
  await rename(controlRoot, relocatedControlRoot);
  await symlink(relocatedControlRoot, controlRoot, "dir");
  await assert.rejects(
    controlLink.repository.resolveOpenTarget({ sourcePath: controlImported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && (error.code === "PATH_ESCAPES_PROJECT" || error.code === "UNSAFE_DIRECTORY"),
  );
});

test("promotion uses the latest Working Copy name and allocates around file, directory and symlink collisions", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "A.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_renamed_promotion",
    candidateId: "candidate_renamed_promotion_0001",
    html: html("promoted from latest name"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const renamedPath = path.join(imported.target.projectRootPath, "B-V1.html");
  await rename(imported.target.exactSourcePath, renamedPath);
  const renamed = await value.repository.resolveOpenTarget({ sourcePath: renamedPath });
  assert.equal(renamed.workingCopyId, "work_ver_0001");

  const collisionFile = path.join(imported.target.projectRootPath, "B-V2.html");
  const collisionDirectory = path.join(imported.target.projectRootPath, "B-V2-V2.html");
  const collisionSymlink = path.join(imported.target.projectRootPath, "B-V2-V2-V2.html");
  const outside = path.join(value.root, "promotion-collision.html");
  await writeFile(collisionFile, html("user file collision"), "utf8");
  await mkdir(collisionDirectory);
  await writeFile(outside, html("user symlink collision"), "utf8");
  await symlink(outside, collisionSymlink, "file");

  const promoted = await value.repository.promoteCandidate({
    target: renamed,
    candidateId: candidate.candidate.candidateId,
  });
  assert.equal(
    path.basename(promoted.target.exactSourcePath),
    "B-V2-V2-V2-V2.html",
  );
  assert.equal(await readFile(collisionFile, "utf8"), html("user file collision"));
  assert.equal((await lstat(collisionDirectory)).isDirectory(), true);
  assert.equal((await lstat(collisionSymlink)).isSymbolicLink(), true);
});

test("promotion retries the next same-ordinal path after an OS no-replace collision", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "A.html");
  const candidateHtml = html("same bytes as concurrent user file");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_no_replace_race",
    candidateId: "candidate_no_replace_race_0001",
    html: candidateHtml,
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const renamedPath = path.join(imported.target.projectRootPath, "B-V1.html");
  await rename(imported.target.exactSourcePath, renamedPath);
  const renamed = await value.repository.resolveOpenTarget({ sourcePath: renamedPath });
  let raced = false;
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name, details) => {
      if (name === "promotion-visible-publication-before-link" && !raced) {
        raced = true;
        await writeFile(details.visiblePath, candidateHtml, "utf8");
      }
      return false;
    },
  });

  const promoted = await repository.promoteCandidate({
    target: renamed,
    candidateId: candidate.candidate.candidateId,
  });
  assert.equal(raced, true);
  assert.equal(path.basename(promoted.target.exactSourcePath), "B-V2-V2.html");
  assert.equal(
    await readFile(path.join(imported.target.projectRootPath, "B-V2.html"), "utf8"),
    candidateHtml,
  );
  assert.equal(await readFile(promoted.target.exactSourcePath, "utf8"), candidateHtml);
  const transaction = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "transactions",
    `promote_${candidate.candidate.candidateId}`,
    "transaction.json",
  ));
  assert.equal(transaction.finalWorkingCopyRelativePath, "B-V2-V2.html");
  assert.equal(transaction.pathAllocationOrdinal, 1);
});

test("save fault injection recovers a complete durable state or a retained old state", async (t) => {
  for (const failpoint of [
    "save-prepared",
    "save-source-written",
    "save-state-written",
    "save-manifest-written",
    "save-committed",
  ]) {
    const value = await fixture(t);
    const imported = await importSource(value, "save-fault.html");
    const nextHtml = html(`save fault ${failpoint}`);
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(
      failing.saveWorkingCopy({
        target: imported.target,
        html: nextHtml,
        expectedSourceSha256: imported.target.sourceSha256,
        editRevision: 7,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
      failpoint,
    );

    const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
    const workspace = await restarted.workspace({ sourcePath: imported.target.exactSourcePath });
    const expectedHtml = failpoint === "save-prepared" ? html("V1") : nextHtml;
    assert.equal(workspace.content, expectedHtml, failpoint);
    assert.equal(workspace.workingCopyState.currentSha256, sha256(Buffer.from(expectedHtml)), failpoint);
    assert.equal(workspace.workingCopyState.saveState, "saved", failpoint);
    const transactions = (await readdir(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "transactions",
    ))).filter((entry) => entry.startsWith("save_"));
    assert.equal(transactions.length, 1, failpoint);
    const transaction = await json(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "transactions",
      transactions[0],
    ));
    assert.equal(transaction.state, "committed", failpoint);
    const manifest = await json(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "manifest.json",
    ));
    assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"], failpoint);
  }
});

test("save recovery refuses an externally changed Working Copy instead of overwriting it", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-conflict.html");
  const failing = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "save-source-written",
  });
  await assert.rejects(
    failing.saveWorkingCopy({
      target: imported.target,
      html: html("interrupted PageRoot save"),
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const externallyChanged = html("external change after interruption");
  await writeFile(imported.target.exactSourcePath, externallyChanged, "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SAVE_RECOVERY_CONFLICT",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externallyChanged);
});

test("request preparation fault injection restores one immutable active Request", async (t) => {
  for (const failpoint of [
    "request-input-written",
    "request-project-rules-written",
    "request-annotations-written",
    "request-change-record-written",
    "request-prompt-written",
    "request-input-manifest-written",
    "request-record-written",
    "request-runtime-written",
    "request-prepared",
  ]) {
    const value = await fixture(t);
    const imported = await importSource(value, "request-fault.html");
    const request = { summary: `fault recovery ${failpoint}` };
    const prompt = `# ${failpoint}\n`;
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: async (name) => name === failpoint,
    });
    await assert.rejects(
      failing.prepareRequest({
        target: imported.target,
        requestId: "req_fault_recovery",
        attemptId: "attempt_001",
        expectedSourceSha256: imported.target.sourceSha256,
        request,
        prompt,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "INJECTED_FAILPOINT",
      failpoint,
    );

    const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
    const prepared = await restarted.prepareRequest({
      target: imported.target,
      requestId: "req_fault_recovery",
      attemptId: "attempt_001",
      expectedSourceSha256: imported.target.sourceSha256,
      request,
      prompt,
    });
    assert.equal(prepared.status, "processing", failpoint);
    const workspace = await restarted.workspace({ sourcePath: imported.target.exactSourcePath });
    assert.equal(workspace.activeRequest.requestId, "req_fault_recovery", failpoint);
    assert.equal(workspace.activeRequest.status, "processing", failpoint);
    const requestRoots = (await readdir(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "requests",
    ), { withFileTypes: true })).filter((entry) => entry.isDirectory());
    assert.deepEqual(requestRoots.map((entry) => entry.name), ["req_fault_recovery"], failpoint);
  }
});

test("request recovery keeps the original runtime input-manifest anchor", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "runtime-anchor.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_runtime_anchor",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: { summary: "runtime anchor" },
    prompt: "# Runtime anchor\n",
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const requestPath = path.join(controlRoot, "requests", prepared.requestId, "request.json");
  const runtimeBefore = await json(runtimePath);
  const requestRecord = await json(requestPath);
  requestRecord.inputManifestSha256 = sha256(Buffer.from("untrusted manifest", "utf8"));
  await writeFile(requestPath, JSON.stringify(requestRecord), "utf8");

  await assert.rejects(
    value.repository.prepareRequest({
      target: imported.target,
      requestId: prepared.requestId,
      attemptId: prepared.attemptId,
      expectedSourceSha256: imported.target.sourceSha256,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "FROZEN_REQUEST_BUNDLE_MISMATCH",
  );
  const runtimeAfter = await json(runtimePath);
  assert.equal(
    runtimeAfter.activeRequest?.inputManifestSha256,
    runtimeBefore.activeRequest?.inputManifestSha256,
  );
});

test("a Request freezes comments, targets and project rules alongside its exact HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "frozen-request.html");
  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("persisted before request"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  await value.repository.updateProjectNotes({
    target: saved.target,
    content: "# 项目规则\n\n只修改首页标题。\n",
  });
  const comments = [{
    commentId: "comment_001",
    text: "把标题改成欢迎页",
    target: { targetId: "target_title" },
    attachments: [{
      attachmentId: "attachment_001",
      fileName: "参考.png",
      relativePath: "draft/attachments/comment_001/attachment_001-参考.png",
    }],
  }];
  const request = {
    freezeCutoffRevision: 1,
    summary: "按评论更新标题",
    comments,
    changeEvents: [{ eventId: "edit_001", kind: "text", target: { targetId: "target_title" } }],
    instructions: [{ instructionId: "instruction_001", text: "保留其他内容" }],
    targets: [{ targetId: "target_title", selector: "h1" }],
    preserveOutsideTargets: false,
  };
  const prepared = await value.repository.prepareRequest({
    target: saved.target,
    requestId: "req_frozen_inputs",
    attemptId: "attempt_001",
    expectedSourceSha256: saved.target.sourceSha256,
    request,
    prompt: "# 本轮任务\n",
  });
  const requestRoot = path.join(
    saved.target.projectRootPath,
    ".pageroot",
    "requests",
    prepared.requestId,
  );
  const annotationsPath = path.join(requestRoot, "input", "annotations", "records.json");
  const projectRulesPath = path.join(requestRoot, "input", "PROJECT.md");
  const changeRequestPath = path.join(requestRoot, "change-request.json");
  const inputManifestPath = path.join(requestRoot, "input-manifest.json");
  const frozenAnnotations = await readFile(annotationsPath);
  const frozenProjectRules = await readFile(projectRulesPath);
  const frozenChangeRequest = await readFile(changeRequestPath);
  const annotations = JSON.parse(frozenAnnotations.toString("utf8"));
  const changeRequest = JSON.parse(frozenChangeRequest.toString("utf8"));
  const inputManifest = await json(inputManifestPath);
  assert.deepEqual(annotations.comments, comments);
  assert.deepEqual(changeRequest.requirements, {
    ...request,
    preserveOutsideTargets: true,
  });
  assert.deepEqual(inputManifest.readOrder, [
    "PROMPT.md",
    "input/AI_RULES.md",
    "change-request.json",
    "input/PROJECT.md",
    "input/base/index.html",
    "input/annotations/records.json",
  ]);
  assert.equal(
    inputManifest.files.find((entry) => entry.path === "input/base/index.html").sha256,
    saved.target.sourceSha256,
  );
  assert.equal(prepared.inputManifestSha256, sha256(await readFile(inputManifestPath)));

  await value.repository.updateProjectNotes({
    target: saved.target,
    content: "# 已修改的项目规则\n",
  });
  assert.deepEqual(await readFile(annotationsPath), frozenAnnotations);
  assert.deepEqual(await readFile(projectRulesPath), frozenProjectRules);
  assert.deepEqual(await readFile(changeRequestPath), frozenChangeRequest);
});

test("a copied project remains external and its first import creates an independent V1", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value);
  const copiedRoot = path.join(value.projects, "copied-project");
  await cp(imported.target.projectRootPath, copiedRoot, { recursive: true });
  const copiedHtml = path.join(copiedRoot, path.basename(imported.target.exactSourcePath));
  const copiedManifestBefore = await readFile(path.join(
    copiedRoot,
    ".pageroot",
    "manifest.json",
  ));

  assert.equal(
    await value.repository.resolveOpenTarget({ sourcePath: copiedHtml }),
    null,
  );

  const importedAsNew = await value.repository.importExternal({
    sourcePath: copiedHtml,
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(importedAsNew.imported, true);
  assert.notEqual(importedAsNew.target.projectId, imported.target.projectId);
  const newManifest = await json(path.join(
    importedAsNew.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(newManifest.versions.map((version) => version.versionId), ["ver_0001"]);
  assert.deepEqual(await readFile(path.join(
    copiedRoot,
    ".pageroot",
    "manifest.json",
  )), copiedManifestBefore);
});

test("a damaged v4 record is ignored and its HTML imports as a fresh V1", async (t) => {
  const value = await fixture(t);
  const damaged = await importSource(value, "damaged.html");
  const healthy = await importSource(value, "healthy.html");
  await rm(damaged.target.projectRootPath, { recursive: true, force: true });
  await mkdir(damaged.target.projectRootPath);
  const damagedHtml = path.join(damaged.target.projectRootPath, "damaged.html");
  await writeFile(damagedHtml, html("replacement"), "utf8");

  const resolvedHealthy = await value.repository.resolveOpenTarget({
    sourcePath: healthy.target.exactSourcePath,
  });
  assert.equal(resolvedHealthy.projectId, healthy.target.projectId);
  assert.equal(
    await value.repository.resolveOpenTarget({ sourcePath: damagedHtml }),
    null,
  );
  const imported = await value.repository.importExternal({
    sourcePath: damagedHtml,
    expectedSourceSha256: sha256(await readFile(damagedHtml)),
  });
  assert.equal(imported.imported, true);
  assert.notEqual(imported.target.projectId, damaged.target.projectId);
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("external import creates a byte-preserving V1 for every relative resource form", async (t) => {
  const value = await fixture(t);
  const cases = [
    ["unquoted-src", "<img src=assets/chart.svg>"],
    ["srcset", "<source srcset='assets/hero.webp 1x, https://cdn.example/hero.webp 2x'>"],
    ["poster", "<video poster='assets/poster.jpg'></video>"],
    ["object-data", "<object data=assets/report.pdf></object>"],
    ["style-attribute", "<div style=\"background-image: url(assets/background.png)\"></div>"],
    ["style-url", "<style>.card { background: url('./assets/card.png'); }</style>"],
    ["style-import", "<style>@import \"./assets/theme.css\";</style>"],
  ];
  for (const [name, markup] of cases) {
    const sourcePath = path.join(value.sources, `${name}.html`);
    const source = `<!doctype html><html><head><title>${name}</title></head><body>${markup}</body></html>`;
    const buffer = Buffer.from(source, "utf8");
    await writeFile(sourcePath, buffer);
    const imported = await value.repository.importExternal({
      sourcePath,
      expectedSourceSha256: sha256(buffer),
    });
    assert.equal(imported.imported, true, name);
    assert.deepEqual(await readFile(sourcePath), buffer, `${name} source`);
    assert.deepEqual(
      await readFile(imported.target.exactSourcePath),
      buffer,
      `${name} V1`,
    );
  }

  const safeSourcePath = path.join(value.sources, "safe-resources.html");
  const safeSource = `<!doctype html><html><head><title>safe</title></head><body><img src=\"data:image/svg+xml;base64,PHN2Zy8+\"><source srcset=\"data:image/svg+xml;base64,PHN2Zy8+ 1x, https://cdn.example/image.webp 2x\"></body></html>`;
  const safeBuffer = Buffer.from(safeSource, "utf8");
  await writeFile(safeSourcePath, safeBuffer);
  const imported = await value.repository.importExternal({
    sourcePath: safeSourcePath,
    expectedSourceSha256: sha256(safeBuffer),
  });
  assert.equal(imported.imported, true);
  assert.deepEqual(await readFile(imported.target.exactSourcePath), safeBuffer);
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

test("a replaced private promotion file fails recovery without deleting user bytes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "promotion-tamper.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_tampered_promotion",
    candidateId: "candidate_tampered_promotion_0001",
    html: html("candidate before user replacement"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "promotion-working-copy-prepared",
  });
  await assert.rejects(
    interrupted.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  const transactionPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "transactions",
    `promote_${candidate.candidate.candidateId}`,
    "transaction.json",
  );
  const transaction = await json(transactionPath);
  const preparedPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    ...transaction.preparedWorkingCopyRelativePath.split("/"),
  );
  const replacement = html("user replaced preparation file");
  await rm(preparedPath);
  await writeFile(preparedPath, replacement, "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "PROMOTION_PREPARED_FILE_CHANGED",
  );
  assert.equal(await readFile(preparedPath, "utf8"), replacement);
});

test("a replaced published promotion file fails recovery without deleting user bytes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "published-promotion.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_replaced_published_promotion",
    candidateId: "candidate_replaced_published_promotion_0001",
    html: html("Candidate before visible replacement"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const replacement = html("user-owned replacement after publication");
  let publishedPath = null;
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name, details) => {
      if (name === "promotion-working-copy-created") {
        const transaction = await json(path.join(details.transactionRoot, "transaction.json"));
        publishedPath = path.join(
          imported.target.projectRootPath,
          transaction.finalWorkingCopyRelativePath,
        );
        await rm(publishedPath);
        await writeFile(publishedPath, replacement, "utf8");
        return true;
      }
      return false;
    },
  });
  await assert.rejects(
    interrupted.promoteCandidate({
      target: imported.target,
      candidateId: candidate.candidate.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  assert.ok(publishedPath);

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "PROMOTION_PATH_REPLACED",
  );
  assert.equal(await readFile(publishedPath, "utf8"), replacement);
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("promotion fault recovery leaves exactly one formal Version and regular files at every commit point", async (t) => {
  for (const failpoint of [
    "promotion-prepared",
    "promotion-snapshot-created",
    "promotion-working-copy-prepared",
    "promotion-working-copy-created",
    "promotion-manifest-committed",
    "promotion-candidate-promoted",
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
    await assert.rejects(
      readFile(path.join(imported.target.projectRootPath, "原文件-V2-V2.html")),
      (error) => error?.code === "ENOENT",
      failpoint,
    );
  }
});
