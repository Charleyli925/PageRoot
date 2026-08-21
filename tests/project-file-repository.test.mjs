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
  unlink,
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

async function promoteNextVersion(repository, target, label) {
  const candidate = await repository.createCandidate({
    target,
    requestId: `req_${label}`,
    candidateId: `candidate_${label}_0001`,
    html: html(label),
    expectedSourceSha256: target.sourceSha256,
  });
  const promoted = await repository.promoteCandidate({
    target,
    candidateId: candidate.candidate.candidateId,
  });
  assert.equal(promoted.promoted, true);
  return promoted.target;
}

function currentRegistryWriteLockPath(fixtureValue) {
  return path.join(fixtureValue.projects, ".pageroot-registry-write-lock");
}

function currentRegistryWriteLockOwnerPath(fixtureValue, token) {
  return path.join(
    currentRegistryWriteLockPath(fixtureValue),
    `.owner-${token}.json`,
  );
}

async function seedCurrentRegistryWriteLock(fixtureValue, pid) {
  const token = "00000000-0000-4000-8000-000000000002";
  await mkdir(currentRegistryWriteLockPath(fixtureValue));
  await writeFile(
    currentRegistryWriteLockOwnerPath(fixtureValue, token),
    `${JSON.stringify({
      pid,
      token,
      createdAt: "2026-08-16T00:00:00.000Z",
    })}\n`,
    "utf8",
  );
  return { token };
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function prepareAiTaskRequest(repository, target, requestId) {
  return repository.prepareRequest({
    target,
    requestId,
    attemptId: "attempt_001",
    expectedSourceSha256: target.sourceSha256,
    request: {
      freezeCutoffRevision: 0,
      summary: "生成一份可审阅的候选页面",
      comments: [],
      changeEvents: [],
      instructions: [],
      targets: [],
    },
    prompt: `# ${requestId}\n\n只生成本轮候选页面。\n`,
  });
}

function registryPath(fixtureValue) {
  return path.join(fixtureValue.projects, ".pageroot-registry.json");
}

async function initializedRepository(fixtureValue, options = {}) {
  const repository = new ProjectFileRepository({
    projectsRoot: fixtureValue.projects,
    ...options,
  });
  await repository.initialize();
  return repository;
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

test("a legacy v4 Runtime without historyActivation opens as null and normalizes on write", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "legacy-runtime.html");
  const runtimePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  );
  const legacyRuntime = await json(runtimePath);
  delete legacyRuntime.historyActivation;
  await writeFile(runtimePath, JSON.stringify(legacyRuntime), "utf8");

  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  const workspace = await restarted.workspace({ sourcePath: imported.target.exactSourcePath });
  assert.equal(workspace.runtime.historyActivation, null);
  assert.equal("historyActivation" in await json(runtimePath), false);

  const saved = await restarted.saveWorkingCopy({
    target: workspace.target,
    html: html("legacy runtime normalized"),
    expectedSourceSha256: workspace.sourceSha256,
    editRevision: 1,
  });
  assert.equal(saved.versionCreated, false);
  assert.equal((await json(runtimePath)).historyActivation, null);
});

test("the Registry alone determines catalog membership and secure project opens", async (t) => {
  const value = await fixture(t);
  const a = await importSource(value, "A.html");
  const b = await importSource(value, "B.html");

  const initial = await value.repository.listRegisteredProjects();
  assert.deepEqual(
    new Set(initial.map((row) => row.projectId)),
    new Set([a.target.projectId, b.target.projectId]),
  );
  assert.equal(initial.every((row) => row.availability === "ready"), true);

  const bBeforeRename = initial.find((row) => row.projectId === b.target.projectId);
  assert.equal(bBeforeRename?.activeWorkingCopyId, "work_ver_0001");
  assert.equal(bBeforeRename?.currentBasedOnVersionId, "ver_0001");
  assert.equal(bBeforeRename?.latestOfficialVersionId, "ver_0001");

  const renamedRoot = path.join(value.projects, "B renamed");
  await rename(b.target.projectRootPath, renamedRoot);
  const afterRename = await value.repository.listRegisteredProjects();
  const bAfterRename = afterRename.find((row) => row.projectId === b.target.projectId);
  assert.equal(bAfterRename?.availability, "ready");
  assert.equal(bAfterRename?.projectName, "B renamed");
  assert.equal(bAfterRename?.registeredProjectRootPath, renamedRoot);

  const resolved = await value.repository.resolveRegisteredProjectOpenTarget({
    projectId: b.target.projectId,
  });
  assert.equal(resolved.target.projectId, b.target.projectId);
  assert.equal(resolved.target.documentId, b.target.documentId);
  assert.equal(resolved.target.workingCopyId, "work_ver_0001");
  assert.equal(resolved.target.projectRootPath, renamedRoot);
  assert.equal(resolved.sourceSha256, resolved.target.sourceSha256);

  const finderRenamedWorkingCopy = path.join(renamedRoot, "B Finder renamed.html");
  await rename(resolved.target.exactSourcePath, finderRenamedWorkingCopy);
  const afterWorkingCopyRename = await value.repository.listRegisteredProjects();
  const bAfterWorkingCopyRename = afterWorkingCopyRename.find(
    (row) => row.projectId === b.target.projectId,
  );
  assert.equal(bAfterWorkingCopyRename?.availability, "ready");
  assert.equal(bAfterWorkingCopyRename?.activeSourcePath, finderRenamedWorkingCopy);
  const rebound = await value.repository.resolveRegisteredProjectOpenTarget({
    projectId: b.target.projectId,
  });
  assert.equal(rebound.target.exactSourcePath, finderRenamedWorkingCopy);
  const reboundManifest = await json(path.join(
    renamedRoot,
    ".pageroot",
    "manifest.json",
  ));
  assert.equal(
    reboundManifest.workingCopies.find(
      (entry) => entry.workingCopyId === rebound.target.workingCopyId,
    )?.sourceRelativePath,
    "B Finder renamed.html",
  );

  const copiedRoot = path.join(value.root, "unregistered copy");
  await cp(renamedRoot, copiedRoot, { recursive: true });
  assert.equal((await value.repository.listRegisteredProjects()).length, 2);

  const movedRoot = path.join(value.root, "moved B");
  await rename(renamedRoot, movedRoot);
  await symlink(movedRoot, renamedRoot);
  const unavailable = await value.repository.listRegisteredProjects();
  const bUnavailable = unavailable.find((row) => row.projectId === b.target.projectId);
  const aReady = unavailable.find((row) => row.projectId === a.target.projectId);
  assert.equal(bUnavailable?.availability, "unavailable");
  assert.equal(aReady?.availability, "ready");
  await assert.rejects(
    value.repository.resolveRegisteredProjectOpenTarget({ projectId: b.target.projectId }),
    (error) => error instanceof ProjectFileRepositoryError
      && ["REGISTERED_PROJECT_UNAVAILABLE", "PATH_ESCAPES_PROJECT"].includes(error.code),
  );
});

test("AI task projections are re-creatable, collision-safe and never Candidate authority", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "ai-task-projection.html");
  const requestId = "req_ai_task_projection_0001";
  const request = await prepareAiTaskRequest(value.repository, imported.target, requestId);

  const processingProjection = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.match(processingProjection.taskRelativePath, /^AI任务\/\d{4}-\d{2}-\d{2}-候选版本2$/u);
  assert.equal(processingProjection.candidatePath, null);
  assert.equal(
    await readFile(processingProjection.promptPath, "utf8"),
    `# ${requestId}\n\n只生成本轮候选页面。\n`,
  );

  const candidateHtml = html("AI task projection candidate");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");
  const readyProjection = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.match(readyProjection.candidatePath, /-V2-待审阅\.html$/u);
  assert.equal(await readFile(readyProjection.candidatePath, "utf8"), candidateHtml);

  await writeFile(readyProjection.candidatePath, html("user tampered projection"), "utf8");
  const collisionRecovered = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.notEqual(collisionRecovered.taskPath, readyProjection.taskPath);
  assert.equal(await readFile(collisionRecovered.candidatePath, "utf8"), candidateHtml);
  const hiddenCandidate = await value.repository.readCandidate({
    target: imported.target,
    candidateId: request.candidateId,
  });
  assert.equal(hiddenCandidate.content, candidateHtml);
  const beforePromotion = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  assert.deepEqual(beforePromotion.versions.map((version) => version.versionId), ["ver_0001"]);

  await rm(collisionRecovered.taskPath, { recursive: true, force: true });
  const rebuilt = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.equal(rebuilt.taskPath, collisionRecovered.taskPath);
  assert.equal(await readFile(rebuilt.candidatePath, "utf8"), candidateHtml);

  const promoted = await value.repository.promoteCandidate({
    target: imported.target,
    candidateId: request.candidateId,
  });
  assert.equal(promoted.version.versionId, "ver_0002");
  assert.equal(await readFile(rebuilt.candidatePath, "utf8"), candidateHtml);
});

test("AI task projection never adopts a directory that wins its allocation race", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "ai-task-directory-race.html");
  let racedDirectoryPath = "";
  let injected = false;
  const racing = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name, details) => {
      if (name !== "ai-task-projection-before-directory-claim" || injected) return false;
      injected = true;
      racedDirectoryPath = details.taskDirectoryPath;
      await mkdir(racedDirectoryPath, { recursive: true });
      return false;
    },
  });
  const requestId = "req_ai_task_directory_race_0001";
  const request = await prepareAiTaskRequest(racing, imported.target, requestId);
  assert.equal(injected, true);
  assert.notEqual(racedDirectoryPath, "");
  assert.deepEqual(await readdir(racedDirectoryPath), []);

  const candidateHtml = html("Candidate after an allocation race");
  const completed = await racing.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");
  const projection = await racing.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.notEqual(projection.taskPath, racedDirectoryPath);
  assert.equal(await readFile(projection.candidatePath, "utf8"), candidateHtml);
  assert.deepEqual(await readdir(racedDirectoryPath), []);
});

test("AI task projection rebinds its display filename after a controlled Working Copy rename", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "before-ai-task-rename.html");
  const requestId = "req_ai_task_rename_0001";
  const request = await prepareAiTaskRequest(value.repository, imported.target, requestId);
  const processing = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.equal(processing.candidatePath, null);

  const renamedWorkingCopy = path.join(
    imported.target.projectRootPath,
    "after-ai-task-rename.html",
  );
  await rename(imported.target.exactSourcePath, renamedWorkingCopy);
  const candidateHtml = html("Candidate after a Finder rename");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");

  const projection = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.equal(projection.taskPath, processing.taskPath);
  assert.match(
    path.basename(projection.candidatePath),
    /^after-ai-task-rename-V2-待审阅\.html$/u,
  );
  assert.equal(await readFile(projection.candidatePath, "utf8"), candidateHtml);
  const receipt = await json(projection.receiptPath);
  assert.equal(receipt.candidateFileName, path.basename(projection.candidatePath));

  const replay = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.equal(replay.taskPath, processing.taskPath);
  assert.equal(replay.candidatePath, projection.candidatePath);

  const renamedAgain = path.join(
    imported.target.projectRootPath,
    "after-candidate-rename.html",
  );
  await rename(renamedWorkingCopy, renamedAgain);
  const rebuiltAfterCandidateRename = await value.repository.materializeAiTaskProjection({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    candidateId: request.candidateId,
  });
  assert.notEqual(rebuiltAfterCandidateRename.taskPath, projection.taskPath);
  assert.match(
    path.basename(rebuiltAfterCandidateRename.candidatePath),
    /^after-candidate-rename-V2-待审阅\.html$/u,
  );
  assert.equal(
    await readFile(rebuiltAfterCandidateRename.candidatePath, "utf8"),
    candidateHtml,
  );
});

test("AI task display publication cannot make a sealed Candidate unavailable", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "ai-task-display-failure.html");
  const requestId = "req_ai_task_display_failure_0001";
  const request = await prepareAiTaskRequest(value.repository, imported.target, requestId);
  const recoveryRoot = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "recovery",
    "ai-task-projections",
  );
  const outside = path.join(value.root, "outside-ai-task-display");
  await mkdir(outside);
  await rm(recoveryRoot, { recursive: true, force: true });
  await symlink(outside, recoveryRoot, "dir");

  const candidateHtml = html("Candidate survives display failure");
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");

  const status = await value.repository.requestStatus({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
  });
  assert.equal(status.status, "candidate-ready");
  assert.equal(status.candidate.candidateId, request.candidateId);
  const hiddenCandidate = await value.repository.readCandidate({
    target: imported.target,
    candidateId: request.candidateId,
  });
  assert.equal(hiddenCandidate.content, candidateHtml);
  await assert.rejects(
    value.repository.materializeAiTaskProjection({
      target: imported.target,
      requestId,
      attemptId: "attempt_001",
      candidateId: request.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "AI_TASK_PROJECTION_PATH_ESCAPE",
  );
});

test("AI task projection replays every publication failpoint without a second Candidate", async (t) => {
  const processingStages = [
    "ai-task-projection-receipt-written",
    "ai-task-projection-directory-allocated",
    "ai-task-projection-prompt-written",
    "ai-task-projection-completed",
    "ai-task-projection-finder-returning",
  ];
  for (const stage of processingStages) {
    const value = await fixture(t);
    const imported = await importSource(value, `projection-${stage}.html`);
    const requestId = `req_${stage.replaceAll("ai-task-projection-", "")}_0001`;
    let injected = true;
    const failing = new ProjectFileRepository({
      projectsRoot: value.projects,
      failpoint: (name) => name === stage && injected,
    });
    const prepared = await prepareAiTaskRequest(failing, imported.target, requestId);
    assert.equal(prepared.status, "processing", stage);
    injected = false;
    const retry = new ProjectFileRepository({ projectsRoot: value.projects });
    const projection = await retry.materializeAiTaskProjection({
      target: imported.target,
      requestId,
      attemptId: "attempt_001",
    });
    assert.equal(projection.candidatePath, null, stage);
    const manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
    assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"], stage);
  }

  const value = await fixture(t);
  const imported = await importSource(value, "projection-candidate-written.html");
  const requestId = "req_candidate_written_0001";
  const request = await prepareAiTaskRequest(value.repository, imported.target, requestId);
  let injected = true;
  const failing = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: (name) => name === "ai-task-projection-candidate-written" && injected,
  });
  const candidateHtml = html("candidate failpoint recovery");
  const completedWithDeferredDisplay = await failing.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completedWithDeferredDisplay.status, "candidate-ready");
  await assert.rejects(
    failing.materializeAiTaskProjection({
      target: imported.target,
      requestId,
      attemptId: "attempt_001",
      candidateId: request.candidateId,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "INJECTED_FAILPOINT",
  );
  injected = false;
  const retry = new ProjectFileRepository({ projectsRoot: value.projects });
  const completed = await retry.completeRequest({
    target: imported.target,
    requestId,
    attemptId: "attempt_001",
    html: candidateHtml,
  });
  assert.equal(completed.status, "candidate-ready");
  const hiddenCandidate = await retry.readCandidate({
    target: imported.target,
    candidateId: request.candidateId,
  });
  assert.equal(hiddenCandidate.content, candidateHtml);
  const requests = await readdir(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
  ));
  assert.equal(requests.filter((name) => name === requestId).length, 1);
  const manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
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

test("a historical Version reactivates its original Working Copy without changing its immutable snapshot", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "history-lineage.html");
  let active = imported.target;
  let v2Target = null;
  const v2Snapshot = html("immutable V2");
  for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
    const candidate = await value.repository.createCandidate({
      target: active,
      requestId: `req_history_${ordinal}`,
      candidateId: `candidate_history_${ordinal}_0001`,
      html: ordinal === 2 ? v2Snapshot : html(`V${ordinal}`),
      expectedSourceSha256: active.sourceSha256,
    });
    const promoted = await value.repository.promoteCandidate({
      target: active,
      candidateId: candidate.candidate.candidateId,
    });
    active = promoted.target;
    if (ordinal === 2) v2Target = active;
  }
  assert.equal(active.versionId, "ver_0006");
  assert.equal(v2Target?.workingCopyId, "work_ver_0002");

  const workspaceBeforeHistory = await value.repository.workspace({
    sourcePath: active.exactSourcePath,
  });
  assert.deepEqual(
    workspaceBeforeHistory.workingCopies.find(
      (workingCopy) => workingCopy.workingCopyId === "work_ver_0002",
    ),
    {
      workingCopyId: "work_ver_0002",
      versionId: "ver_0002",
      basedOnVersionId: "ver_0002",
      differsFromBase: false,
      saveState: "saved",
    },
  );
  const visibleV2 = await value.repository.resolveVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
  });
  assert.equal(visibleV2.workingCopyId, "work_ver_0002");
  assert.equal(visibleV2.workingCopyPath, v2Target?.exactSourcePath);
  assert.equal(visibleV2.sourceSha256, v2Target?.sourceSha256);

  const activated = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_continue_v2_0001",
    expectedActiveWorkingCopyId: "work_ver_0006",
  });
  assert.equal(activated.activated, true);
  assert.equal(activated.previousWorkingCopyId, "work_ver_0006");
  assert.equal(activated.target.versionId, "ver_0002");
  assert.equal(activated.target.workingCopyId, "work_ver_0002");
  assert.equal(activated.historyActivation.state, "desktop-pending");
  const retried = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_continue_v2_0001",
    expectedActiveWorkingCopyId: "work_ver_0006",
  });
  assert.equal(retried.activated, false);
  assert.equal(retried.replayed, true);
  assert.equal(retried.previousWorkingCopyId, "work_ver_0006");
  assert.equal(retried.target.workingCopyId, activated.target.workingCopyId);

  const resumedAfterLostResponse = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_retry_after_lost_response_0001",
    expectedActiveWorkingCopyId: "work_ver_0006",
  });
  assert.equal(resumedAfterLostResponse.replayed, true);
  assert.equal(
    resumedAfterLostResponse.historyActivation.operationId,
    "history_continue_v2_0001",
  );

  const confirmed = await value.repository.confirmVersionWorkingCopyActivation({
    target: active,
    operationId: "history_continue_v2_0001",
    previousWorkingCopyId: "work_ver_0006",
    activatedWorkingCopyId: "work_ver_0002",
    versionId: "ver_0002",
  });
  assert.equal(confirmed.confirmed, true);
  assert.equal(confirmed.historyActivation.state, "desktop-confirmed");
  const confirmRetry = await value.repository.confirmVersionWorkingCopyActivation({
    target: active,
    operationId: "history_continue_v2_0001",
    previousWorkingCopyId: "work_ver_0006",
    activatedWorkingCopyId: "work_ver_0002",
    versionId: "ver_0002",
  });
  assert.equal(confirmRetry.confirmed, false);
  const runtimeAfterActivation = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  ));
  assert.equal(runtimeAfterActivation.activeWorkingCopyId, "work_ver_0002");
  assert.equal(runtimeAfterActivation.historyActivation.state, "desktop-confirmed");

  const resumedAfterConfirmationLoss = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_retry_after_confirmation_loss_0001",
    expectedActiveWorkingCopyId: "work_ver_0006",
  });
  assert.equal(resumedAfterConfirmationLoss.replayed, true);
  assert.equal(
    resumedAfterConfirmationLoss.historyActivation.operationId,
    "history_continue_v2_0001",
  );

  await assert.rejects(
    value.repository.activateVersionWorkingCopy({
      target: active,
      versionId: "ver_0003",
      operationId: "history_stale_v3_0001",
      expectedActiveWorkingCopyId: "work_ver_0006",
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "HISTORY_ACTIVATION_PREDECESSOR_CONFLICT",
  );

  const v2Edited = html("editable V2 after history continuation");
  const saved = await value.repository.saveWorkingCopy({
    target: activated.target,
    html: v2Edited,
    expectedSourceSha256: activated.target.sourceSha256,
    editRevision: 1,
  });
  assert.equal(await readFile(
    path.join(saved.target.projectRootPath, ".pageroot", "versions", "ver_0002", "index.html"),
    "utf8",
  ), v2Snapshot);
  const revealedEditedV2 = await value.repository.resolveVersionWorkingCopy({
    target: saved.target,
    versionId: "ver_0002",
  });
  assert.equal(revealedEditedV2.workingCopyPath, saved.target.exactSourcePath);
  assert.equal(revealedEditedV2.sourceSha256, saved.target.sourceSha256);
  assert.equal(revealedEditedV2.workingCopyState.differsFromBase, true);

  const restarted = new ProjectFileRepository({ projectsRoot: value.projects });
  const reopened = await restarted.workspace({ sourcePath: saved.target.exactSourcePath });
  assert.equal(reopened.target.versionId, "ver_0002");
  assert.equal(reopened.target.workingCopyId, "work_ver_0002");
  assert.equal(reopened.content, v2Edited);

  const candidate = await restarted.createCandidate({
    target: reopened.target,
    requestId: "req_history_v7",
    candidateId: "candidate_history_v7_0001",
    html: html("V7 based on V2"),
    expectedSourceSha256: reopened.target.sourceSha256,
  });
  const promoted = await restarted.promoteCandidate({
    target: reopened.target,
    candidateId: candidate.candidate.candidateId,
  });
  assert.equal(promoted.version.versionId, "ver_0007");
  assert.equal(promoted.version.basedOnVersionId, "ver_0002");
  assert.equal(promoted.version.previousVersionId, "ver_0006");
  const runtimeAfterPromotion = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  ));
  assert.equal(runtimeAfterPromotion.historyActivation, null);
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

test("createCandidate ignores authored script changes and keeps weak continuity as review", async (t) => {
  const value = await fixture(t);
  const base = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <title>Scope fixture</title>
  <script id="shared-script">window.scopeFixture = 1;</script>
</head>
<body>
  <main id="target"><p id="inside">目标正文</p></main>
  <aside id="outside">目标外正文</aside>
</body>
</html>`;
  const imported = await importSource(value, "scope.html", base);

  const scriptOnly = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_script_only",
    candidateId: "candidate_script_only_0001",
    html: base.replace("window.scopeFixture = 1", "window.scopeFixture = 2"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(scriptOnly.candidate.status, "pending-review");
  assert.equal(scriptOnly.candidate.assessment.status, "ready");
  assert.deepEqual(scriptOnly.candidate.assessment.issueCodes, []);
  assert.equal("executable" in scriptOnly.candidate.assessment, false);
  assert.equal(
    "executableSurfaceUnchanged" in scriptOnly.candidate.assessment.health,
    false,
  );
  assert.equal(scriptOnly.candidate.proposedVersionId, "ver_0002");

  await value.repository.rejectCandidate({
    target: imported.target,
    candidateId: scriptOnly.candidate.candidateId,
  });

  const unrelated = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_unrelated_page",
    candidateId: "candidate_unrelated_0001",
    html: `<!doctype html><html><head><title>另一页</title><script id="shared-script">window.scopeFixture = 1;</script></head><body><article>全新的内容与结构</article></body></html>`,
    expectedSourceSha256: imported.target.sourceSha256,
  });
  assert.equal(unrelated.candidate.status, "pending-review");
  assert.equal(unrelated.candidate.assessment.status, "attention");
  assert.deepEqual(
    unrelated.candidate.assessment.issueCodes,
    ["PAGE_CONTINUITY_UNCERTAIN"],
  );
  assert.equal(unrelated.candidate.proposedVersionId, "ver_0002");
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

test("Promotion recovery re-derives every Candidate-backed transaction field", async (t) => {
  const mutations = [
    ["transaction ID", (transaction) => { transaction.transactionId = "promote_candidate_other_0001"; }],
    ["request ID", (transaction) => { transaction.requestId = "req_other"; }],
    ["Version ID", (transaction) => { transaction.versionId = "ver_0999"; }],
    ["Version ordinal", (transaction) => { transaction.versionOrdinal = 999; }],
    ["base lineage", (transaction) => { transaction.basedOnVersionId = "ver_0999"; }],
    ["previous lineage", (transaction) => { transaction.previousVersionId = "ver_0999"; }],
    ["Candidate output hash", (transaction) => { transaction.candidateOutputSha256 = "sha256:" + "0".repeat(64); }],
    ["preferred stem", (transaction) => { transaction.preferredFileStem = "unrelated"; }],
    ["preferred extension", (transaction) => { transaction.preferredExtension = ".htm"; }],
    ["visible Working Copy path", (transaction) => { transaction.finalWorkingCopyRelativePath = "unrelated-V2.html"; }],
    ["prepared Working Copy path", (transaction) => {
      transaction.preparedWorkingCopyRelativePath = "transactions/"
        + transaction.transactionId + "/prepared-working-copy.htm";
    }],
  ];
  for (const [index, [label, mutate]] of mutations.entries()) {
    const value = await fixture(t);
    const imported = await importSource(value, `transaction-authority-${index}.html`);
    const candidate = await value.repository.createCandidate({
      target: imported.target,
      requestId: `req_transaction_authority_${index}`,
      candidateId: `candidate_transaction_authority_${index.toString().padStart(4, "0")}`,
      html: html(`sealed Candidate ${label}`),
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
      label,
    );
    const transactionPath = path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "transactions",
      `promote_${candidate.candidate.candidateId}`,
      "transaction.json",
    );
    const transaction = await json(transactionPath);
    mutate(transaction);
    await writeFile(transactionPath, JSON.stringify(transaction), "utf8");

    await assert.rejects(
      new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
        sourcePath: imported.target.exactSourcePath,
      }),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "PROMOTION_TRANSACTION_MISMATCH",
      label,
    );
    const manifest = await json(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      "manifest.json",
    ));
    assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"], label);
  }
});

test("Promotion recovery validates the recorded Working Copy against sealed authority", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "promotion-working-copy-authority.html");
  const candidate = await value.repository.createCandidate({
    target: imported.target,
    requestId: "req_promotion_working_copy_authority",
    candidateId: "candidate_promotion_working_copy_authority_0001",
    html: html("sealed Candidate Working Copy"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "promotion-working-copy-created",
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
  transaction.workingCopy = {
    ...transaction.workingCopy,
    basedOnVersionId: "ver_0001",
    sourceRelativePath: "unrelated-V2.html",
    stateRelativePath: "working-copies/work_ver_0999.json",
  };
  await writeFile(transactionPath, JSON.stringify(transaction), "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "PROMOTION_TRANSACTION_MISMATCH",
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

test("save conflicts when both PageRoot and disk changed", async (t) => {
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
      && error.code === "WORKING_COPY_CONFLICT",
  );

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), externalHtml);
});

test("save silently adopts external disk bytes when PageRoot has no dirty buffer", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-clean-adopt.html");
  const adoptedHtml = html("external clean change");
  await writeFile(imported.target.exactSourcePath, adoptedHtml, "utf8");

  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("V1"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 0,
  });

  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), adoptedHtml);
  assert.equal(saved.currentSha256, sha256(Buffer.from(adoptedHtml, "utf8")));
  const state = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  ));
  assert.equal(state.saveState, "saved");
  assert.equal(state.currentSha256, saved.currentSha256);
});

test("workspace recovers a legacy parked save journal to complete new bytes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-legacy-parked.html");
  const previousHtml = html("V1");
  const nextHtml = html("recovered from legacy parked journal");
  const recoveryId = `save_${imported.target.workingCopyId}_1_${"a".repeat(32)}`;
  const recoveryRoot = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "recovery",
    recoveryId,
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  const workingCopy = manifest.workingCopies.find(
    (entry) => entry.workingCopyId === imported.target.workingCopyId,
  );
  await mkdir(recoveryRoot, { recursive: true });
  await writeFile(path.join(recoveryRoot, "previous.html"), previousHtml, "utf8");
  await writeFile(path.join(recoveryRoot, "next.html"), nextHtml, "utf8");
  await rm(imported.target.exactSourcePath);
  await writeFile(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "transactions",
    `${recoveryId}.json`,
  ), JSON.stringify({
    schemaVersion: "4.0.0",
    kind: "save",
    state: "source-parked",
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    workingCopyId: imported.target.workingCopyId,
    sourceRelativePath: workingCopy.sourceRelativePath,
    expectedSourceSha256: imported.target.sourceSha256,
    targetSourceSha256: sha256(Buffer.from(nextHtml, "utf8")),
    editRevision: 1,
    recoveryId,
    preparedAt: "2026-08-15T00:00:00.000Z",
  }), "utf8");

  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(reopened.content, nextHtml);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), nextHtml);
});

test("workspace recovers a legacy parked journal whose previous inode changed", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-legacy-parked-conflict.html");
  const previousHtml = html("external descriptor write after publication");
  const nextHtml = html("PageRoot save survives beside external write");
  const recoveryId = `save_${imported.target.workingCopyId}_1_${"b".repeat(32)}`;
  const recoveryRoot = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "recovery",
    recoveryId,
  );
  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  const workingCopy = manifest.workingCopies.find(
    (entry) => entry.workingCopyId === imported.target.workingCopyId,
  );
  await mkdir(recoveryRoot, { recursive: true });
  await writeFile(path.join(recoveryRoot, "previous.html"), previousHtml, "utf8");
  await writeFile(path.join(recoveryRoot, "next.html"), nextHtml, "utf8");
  await writeFile(imported.target.exactSourcePath, nextHtml, "utf8");
  await writeFile(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "transactions",
    `${recoveryId}.json`,
  ), JSON.stringify({
    schemaVersion: "4.0.0",
    kind: "save",
    state: "committed",
    projectId: imported.target.projectId,
    documentId: imported.target.documentId,
    workingCopyId: imported.target.workingCopyId,
    sourceRelativePath: workingCopy.sourceRelativePath,
    expectedSourceSha256: imported.target.sourceSha256,
    targetSourceSha256: sha256(Buffer.from(nextHtml, "utf8")),
    editRevision: 1,
    recoveryId,
    preparedAt: "2026-08-15T00:00:00.000Z",
    committedAt: "2026-08-15T00:00:01.000Z",
  }), "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "SAVE_RECOVERY_CONFLICT",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), nextHtml);
  assert.equal(await readFile(path.join(recoveryRoot, "previous.html"), "utf8"), previousHtml);
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

test("workspace recovers a source after a post-rename save crash", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-parked-recovery.html");
  const nextHtml = html("recovered after safe parking");
  const failing = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => name === "save-source-written",
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

test("reading a current V4 Registry never rewrites its bytes", async (t) => {
  const value = await fixture(t);
  await importSource(value, "current-registry.html");
  const before = await readFile(registryPath(value));

  await initializedRepository(value);

  assert.deepEqual(await readFile(registryPath(value)), before);
});

// An unrecognized Registry shape is refused rather than replaced. Returning an
// empty Registry instead would let the next import overwrite the real file, which
// would destroy every recorded external-source binding and root identity while
// leaving the project directories orphaned on disk. The shape seeded here is the
// pre-hardening V4 one: same schemaVersion, but no pendingImports and records
// without a durable root identity.
test("an unrecognized Registry shape fails closed without changing its bytes", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "未知形状.html");
  const managedBefore = await readFile(imported.target.exactSourcePath);
  const current = JSON.parse(await readFile(registryPath(value), "utf8"));
  const unknown = {
    schemaVersion: current.schemaVersion,
    updatedAt: current.updatedAt,
    projects: Object.fromEntries(Object.entries(current.projects).map(([id, record]) => [
      id,
      { projectRootPath: record.registeredProjectRootPath, updatedAt: record.updatedAt },
    ])),
  };
  const unknownBytes = Buffer.from(`${JSON.stringify(unknown, null, 2)}\n`, "utf8");
  await writeFile(registryPath(value), unknownBytes);

  for (const run of [
    (repository) => repository.listRegisteredProjects(),
    (repository) => repository.classifyOpenPath({ sourcePath: imported.sourcePath }),
    (repository) => repository.importExternal({
      sourcePath: imported.sourcePath,
      expectedSourceSha256: sha256(managedBefore),
    }),
  ]) {
    await assert.rejects(
      run(new ProjectFileRepository({
        projectsRoot: value.projects,
        registryWriteLockTimeoutMs: 200,
      })),
      (error) => error instanceof ProjectFileRepositoryError
        && error.code === "UNSUPPORTED_REGISTRY_SCHEMA",
    );
  }

  assert.deepEqual(await readFile(registryPath(value)), unknownBytes);
  assert.deepEqual(await readFile(imported.target.exactSourcePath), managedBefore);
  assert.equal(
    (await readdir(value.projects)).some((entry) => entry.startsWith(".pageroot-registry-backups")),
    false,
  );
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
  assert.equal(
    adopted.workingCopies.find(
      (workingCopy) => workingCopy.workingCopyId === imported.target.workingCopyId,
    )?.differsFromBase,
    true,
  );

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

test("forceUnlockWorkingCopy adopts disk hash without rewriting HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "force-unlock.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
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

  const unlocked = await value.repository.forceUnlockWorkingCopy({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(unlocked.status, "force-unlocked");
  assert.equal(unlocked.content, conflictingDiskHtml);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), conflictingDiskHtml);

  const nextState = await json(statePath);
  assert.equal(nextState.saveState, "saved");
  assert.equal(nextState.currentSha256, sha256(Buffer.from(conflictingDiskHtml, "utf8")));
  assert.equal(nextState.lastPersistedRevision, state.lastPersistedRevision);

  const workspace = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(workspace.content, conflictingDiskHtml);
});

test("forceUnlockWorkingCopy clears a stuck activeRequest without rewriting HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "force-unlock-active-run.html");
  await prepareAiTaskRequest(value.repository, imported.target, "req_force_unlock_active");
  const runtimePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "runtime-state.json",
  );
  assert.ok((await json(runtimePath)).activeRequest);

  const statePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "working-copies",
    `${imported.target.workingCopyId}.json`,
  );
  const state = await json(statePath);
  await writeFile(statePath, JSON.stringify({ ...state, saveState: "failed" }), "utf8");
  const conflictingDiskHtml = html("external while request active");
  await writeFile(imported.target.exactSourcePath, conflictingDiskHtml, "utf8");

  const unlocked = await value.repository.forceUnlockWorkingCopy({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(unlocked.status, "force-unlocked");
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), conflictingDiskHtml);

  const runtime = await json(runtimePath);
  assert.equal(runtime.activeRequest, null);
  const workspace = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(workspace.activeRequest, null);
  assert.equal(workspace.content, conflictingDiskHtml);
});

test("validation errors return an in-memory errorPreview without persisting it", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "invalid-preview.html");
  await prepareAiTaskRequest(value.repository, imported.target, "req_invalid_preview");
  const incomplete = "<html><body>truncated";
  const completed = await value.repository.completeRequest({
    target: imported.target,
    requestId: "req_invalid_preview",
    attemptId: "attempt_001",
    html: incomplete,
  });
  assert.equal(completed.status, "error");
  assert.equal(completed.request.error.errorCode, "INCOMPLETE_HTML");
  assert.match(String(completed.request.error.errorPreview || ""), /truncated/);
  const record = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "requests",
    "req_invalid_preview",
    "request.json",
  ));
  assert.equal(record.error.errorPreview, undefined);
  assert.equal(record.error.errorCode, "INCOMPLETE_HTML");
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

test("verified project roots are not reused across serial turns after a symlink swap", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "serial-root-cache.html");
  const first = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("after first save"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  assert.equal(first.versionCreated, false);

  const relocated = path.join(value.root, "relocated-serial-root");
  await rename(imported.target.projectRootPath, relocated);
  await symlink(relocated, imported.target.projectRootPath, "dir");
  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: first.target,
      html: html("after symlink swap"),
      expectedSourceSha256: first.target.sourceSha256,
      editRevision: 2,
    }),
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

test("request recovery binds Request identity to its sealed runtime anchor", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "runtime-identity-anchor.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_runtime_identity_anchor",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: { summary: "runtime identity anchor" },
    prompt: "# Runtime identity anchor\n",
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const requestPath = path.join(controlRoot, "requests", prepared.requestId, "request.json");
  const runtimeBefore = await json(runtimePath);
  const record = await json(requestPath);
  record.attemptId = "attempt_002";
  await writeFile(requestPath, JSON.stringify(record), "utf8");

  await assert.rejects(
    new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
      sourcePath: imported.target.exactSourcePath,
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REQUEST_IDENTITY_MISMATCH",
  );
  const runtimeAfter = await json(runtimePath);
  assert.equal(runtimeAfter.activeRequest?.requestId, runtimeBefore.activeRequest?.requestId);
  assert.equal(runtimeAfter.activeRequest?.attemptId, runtimeBefore.activeRequest?.attemptId);
});

test("request recovery never recreates runtime authority from Agent-owned Request files", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "agent-owned-request.html");
  const prepared = await value.repository.prepareRequest({
    target: imported.target,
    requestId: "req_agent_owned_recovery",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: { summary: "must retain the runtime seal" },
    prompt: "# Runtime seal\n",
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const runtimePath = path.join(controlRoot, "runtime-state.json");
  const requestPath = path.join(controlRoot, "requests", prepared.requestId, "request.json");
  const inputManifestPath = path.join(controlRoot, "requests", prepared.requestId, "input-manifest.json");
  const runtime = await json(runtimePath);
  runtime.activeRequest = null;
  runtime.activeCandidateId = null;
  await writeFile(runtimePath, JSON.stringify(runtime), "utf8");

  // An external Agent may alter every file it can see in its Request tree.
  // Its new digest must not become runtime authority when PageRoot reopens.
  const launderedManifest = Buffer.from('{"agent":"replacement bundle"}\n', "utf8");
  await writeFile(inputManifestPath, launderedManifest);
  const record = await json(requestPath);
  record.status = "processing";
  record.inputManifestSha256 = sha256(launderedManifest);
  await writeFile(requestPath, JSON.stringify(record), "utf8");

  const reopened = await new ProjectFileRepository({ projectsRoot: value.projects }).workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(reopened.activeRequest, null);
  assert.equal(reopened.activeCandidate, null);
  const runtimeAfter = await json(runtimePath);
  assert.equal(runtimeAfter.activeRequest, null);
  assert.equal(runtimeAfter.activeCandidateId, null);
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

test("import rechecks the bytes read after stat before publishing a project", async (t) => {
  const value = await fixture(t);
  const sourcePath = path.join(value.sources, "stat-race.html");
  const source = html("small before stat race");
  await writeFile(sourcePath, source, "utf8");
  const oversized = Buffer.alloc((20 * 1024 * 1024) + 1, 0x61);
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      if (name === "html-read-after-stat") await writeFile(sourcePath, oversized);
      return false;
    },
  });
  await assert.rejects(
    repository.importExternal({
      sourcePath,
      expectedSourceSha256: sha256(Buffer.from(source, "utf8")),
    }),
    (error) => error instanceof ProjectFileRepositoryError && error.code === "SOURCE_TOO_LARGE",
  );
  assert.deepEqual(
    (await readdir(value.projects)).filter((entry) => entry !== ".pageroot-registry.json"),
    [],
  );
});

test("workspace validates Working Copy state before following its declared Draft path", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "state-before-draft.html");
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const statePath = path.join(controlRoot, "working-copies", "work_ver_0001.json");
  const state = await json(statePath);
  const untrustedDraftPath = path.join(controlRoot, "drafts", "untrusted.json");
  await writeFile(untrustedDraftPath, "not JSON", "utf8");
  await writeFile(statePath, JSON.stringify({
    ...state,
    draftRelativePath: "drafts/untrusted.json",
  }), "utf8");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_STATE_INVALID",
  );
});

test("workspace follows only the v4 Working Copy saveState vocabulary", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-state-vocabulary.html");
  const statePath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "working-copies",
    "work_ver_0001.json",
  );
  const state = await json(statePath);

  await writeFile(statePath, JSON.stringify({ ...state, saveState: "saving" }), "utf8");
  const savingWorkspace = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(savingWorkspace.workingCopyState.saveState, "saving");

  await writeFile(statePath, JSON.stringify({ ...state, saveState: "queued" }), "utf8");
  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_STATE_INVALID",
  );
});

test("workspace rejects a malformed Working Copy Draft instead of publishing an empty authority", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "malformed-draft.html");
  const draftPath = path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "drafts",
    "work_ver_0001.json",
  );
  await writeFile(draftPath, JSON.stringify({ draftRevision: 0, comments: [] }), "utf8");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "WORKING_COPY_DRAFT_INVALID",
  );
});

test("import reserves UTF-8 component space and skips every occupied project-root placeholder", async (t) => {
  const utf8 = await fixture(t);
  const longName = `${"中".repeat(80)}.html`;
  const imported = await importSource(utf8, longName);
  assert.ok(Buffer.byteLength(path.basename(imported.target.exactSourcePath), "utf8") <= 255);
  assert.ok(Buffer.byteLength(path.basename(imported.target.projectRootPath), "utf8") <= 255);
  assert.match(path.basename(imported.target.exactSourcePath), /-V1\.html$/u);

  for (const kind of ["file", "directory", "symlink"]) {
    const value = await fixture(t);
    const blocker = path.join(value.projects, "occupied");
    await mkdir(value.projects, { recursive: true });
    if (kind === "file") {
      await writeFile(blocker, "placeholder", "utf8");
    } else if (kind === "directory") {
      await mkdir(blocker);
    } else {
      const outside = path.join(value.root, "occupied-target");
      await writeFile(outside, "placeholder", "utf8");
      await symlink(outside, blocker, "file");
    }
    const occupied = await importSource(value, "occupied.html");
    assert.notEqual(path.basename(occupied.target.projectRootPath), "occupied", kind);
    const information = await lstat(blocker);
    assert.equal(
      kind === "file" ? information.isFile() : (kind === "directory"
        ? information.isDirectory()
        : information.isSymbolicLink()),
      true,
      kind,
    );
  }
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

function reconcileInput(target, extra = {}) {
  return {
    operationId: extra.operationId || "reconcile_test_operation_01",
    previousSourcePath: extra.previousSourcePath || target.exactSourcePath,
    projectId: extra.projectId || target.projectId,
    documentId: extra.documentId || target.documentId,
    workingCopyId: extra.workingCopyId || target.workingCopyId,
    versionId: extra.versionId || target.versionId,
    expectedSourceSha256: extra.expectedSourceSha256 || target.sourceSha256,
    reason: extra.reason || "watch",
  };
}


test("reconcileWorkingCopyLocator rebinds a same-directory Finder rename without creating IDs", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "活动页.html");
  const renamedPath = path.join(imported.target.projectRootPath, "Finder 新名字.html");
  await rename(imported.target.exactSourcePath, renamedPath);

  const reconciled = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target),
  );
  assert.equal(reconciled.status, "relocated");
  assert.equal(reconciled.openTarget.projectId, imported.target.projectId);
  assert.equal(reconciled.openTarget.documentId, imported.target.documentId);
  assert.equal(reconciled.openTarget.workingCopyId, imported.target.workingCopyId);
  assert.equal(reconciled.openTarget.versionId, imported.target.versionId);
  assert.equal(reconciled.sourcePath, renamedPath);
  assert.equal(reconciled.sourceSha256, imported.target.sourceSha256);
  assert.equal(reconciled.openTarget.exactSourcePath, renamedPath);

  const manifest = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    "manifest.json",
  ));
  const workingCopy = manifest.workingCopies.find(
    (entry) => entry.workingCopyId === imported.target.workingCopyId,
  );
  assert.equal(workingCopy.sourceRelativePath, "Finder 新名字.html");
  assert.equal(workingCopy.preferredFileStem, "Finder 新名字");
  assert.equal(workingCopy.preferredExtension, ".html");

  const again = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target, { previousSourcePath: renamedPath }),
  );
  assert.equal(again.status, "unchanged");
  assert.equal(again.sourcePath, renamedPath);
});

test("reconcileWorkingCopyLocator follows a same-parent project folder rename", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "文件夹页.html");
  const renamedRoot = path.join(value.projects, "改名后的项目");
  await rename(imported.target.projectRootPath, renamedRoot);
  const previousSourcePath = path.join(renamedRoot, path.basename(imported.target.exactSourcePath));
  const renamedHtml = path.join(renamedRoot, "文件夹页 Finder.html");
  await rename(previousSourcePath, renamedHtml);

  const reconciled = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target, {
      previousSourcePath: imported.target.exactSourcePath,
    }),
  );
  assert.equal(reconciled.status, "relocated");
  assert.equal(reconciled.openTarget.projectId, imported.target.projectId);
  assert.equal(reconciled.openTarget.projectRootPath, renamedRoot);
  assert.equal(reconciled.sourcePath, renamedHtml);
});

test("reconcileWorkingCopyLocator reports content-changed after a Finder rename plus edit", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "内容变化.html");
  const renamedPath = path.join(imported.target.projectRootPath, "内容变化 Finder.html");
  await rename(imported.target.exactSourcePath, renamedPath);
  const edited = html("Finder also edited the bytes");
  await writeFile(renamedPath, edited, "utf8");

  const reconciled = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target),
  );
  assert.equal(reconciled.status, "content-changed");
  assert.equal(reconciled.sourcePath, renamedPath);
  assert.equal(reconciled.openTarget.workingCopyId, imported.target.workingCopyId);
  assert.notEqual(reconciled.sourceSha256, imported.target.sourceSha256);
  assert.equal(await readFile(renamedPath, "utf8"), edited);
});

test("reconcileWorkingCopyLocator does not claim copies, hard links, symlinks or escaped roots", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "唯一身份.html");
  const renamedPath = path.join(imported.target.projectRootPath, "唯一身份 Finder.html");
  await rename(imported.target.exactSourcePath, renamedPath);

  const hardLinkPath = path.join(imported.target.projectRootPath, "hard-link.html");
  await link(renamedPath, hardLinkPath);
  await assert.rejects(
    value.repository.reconcileWorkingCopyLocator(reconcileInput(imported.target)),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "MANAGED_PATH_AMBIGUOUS",
  );
  await unlink(hardLinkPath);

  const copiedRoot = path.join(value.root, "copied-project");
  await cp(imported.target.projectRootPath, copiedRoot, { recursive: true });
  const copiedHtml = path.join(copiedRoot, "唯一身份 Finder.html");
  const originalReconcile = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target, { previousSourcePath: renamedPath }),
  );
  assert.equal(originalReconcile.sourcePath, renamedPath);
  assert.notEqual(originalReconcile.sourcePath, copiedHtml);

  const symlinkPath = path.join(imported.target.projectRootPath, "alias.html");
  await symlink(renamedPath, symlinkPath);
  const afterSymlink = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target, { previousSourcePath: renamedPath }),
  );
  assert.equal(afterSymlink.sourcePath, renamedPath);

  const movedRoot = path.join(value.root, "escaped-project");
  await rename(imported.target.projectRootPath, movedRoot);
  await assert.rejects(
    value.repository.reconcileWorkingCopyLocator(
      reconcileInput(imported.target, { previousSourcePath: renamedPath }),
    ),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTERED_PROJECT_UNAVAILABLE",
  );
});

test("reconcileWorkingCopyLocator refuses a version mismatch and does not guess by hash", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "不猜测.html");
  const decoy = path.join(imported.target.projectRootPath, "decoy.html");
  await writeFile(decoy, html("V1"), "utf8");
  await rename(
    imported.target.exactSourcePath,
    path.join(imported.target.projectRootPath, "不猜测 Finder.html"),
  );

  await assert.rejects(
    value.repository.reconcileWorkingCopyLocator(
      reconcileInput(imported.target, { versionId: "ver_0002" }),
    ),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "MANAGED_SOURCE_IDENTITY_MISMATCH",
  );

  const equalBytes = await importSource(value, "另一份同字节.html", html("V1"));
  await rename(
    equalBytes.target.exactSourcePath,
    path.join(equalBytes.target.projectRootPath, "另一份同字节 Finder.html"),
  );
  const recovered = await value.repository.reconcileWorkingCopyLocator(
    reconcileInput(imported.target),
  );
  assert.equal(recovered.openTarget.projectId, imported.target.projectId);
  assert.notEqual(recovered.openTarget.projectId, equalBytes.target.projectId);
});

test("editing the V1 working file still binds the original external path to the same project", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "编辑后重开.html");
  const originalBytes = await readFile(imported.sourcePath);
  const originalSha256 = sha256(originalBytes);
  const edited = html("local edit after import");
  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: edited,
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  const registryBefore = await readFile(registryPath(value));

  const classified = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.projectId, imported.target.projectId);
  assert.equal(classified.projectFacts.openTarget.workingCopyId, "work_ver_0001");
  assert.equal(classified.projectFacts.currentDiffersFromBase, true);
  assert.equal(classified.projectFacts.sourceRelation, "unchanged");
  assert.equal(classified.sourceSha256, originalSha256);
  assert.equal(await readFile(imported.sourcePath, "utf8"), originalBytes.toString("utf8"));
  assert.deepEqual(await readFile(registryPath(value)), registryBefore);

  const retried = await value.repository.importExternal({
    sourcePath: imported.sourcePath,
    expectedSourceSha256: originalSha256,
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.projectId, imported.target.projectId);
  assert.equal(retried.target.workingCopyId, saved.target.workingCopyId);
  assert.equal(retried.target.exactSourcePath, saved.target.exactSourcePath);
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

test("promoting V2 still returns the current V2 working copy for the original path", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "晋升后重开.html");
  const active = await promoteNextVersion(value.repository, imported.target, "promoted_reopen");
  assert.equal(active.workingCopyId, "work_ver_0002");
  assert.equal(active.versionId, "ver_0002");

  const classified = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.projectId, imported.target.projectId);
  assert.equal(classified.projectFacts.openTarget.workingCopyId, "work_ver_0002");
  assert.equal(classified.projectFacts.latestOfficialVersionId, "ver_0002");
  assert.equal(classified.projectFacts.currentBasedOnVersionId, "ver_0002");
  assert.equal(classified.projectFacts.initialVersionId, "ver_0001");
  assert.equal(classified.projectFacts.currentDiffersFromBase, false);

  const retried = await value.repository.importExternal({
    sourcePath: imported.sourcePath,
    expectedSourceSha256: sha256(imported.buffer),
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.workingCopyId, "work_ver_0002");
  assert.equal(retried.target.versionId, "ver_0002");
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

test("a historical active Working Copy is returned instead of silently jumping to latest", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "历史工作稿.html");
  let active = imported.target;
  for (const label of ["history_v2", "history_v3"]) {
    active = await promoteNextVersion(value.repository, active, label);
  }
  assert.equal(active.workingCopyId, "work_ver_0003");
  const activated = await value.repository.activateVersionWorkingCopy({
    target: active,
    versionId: "ver_0002",
    operationId: "history_continue_v2_reopen_0001",
    expectedActiveWorkingCopyId: "work_ver_0003",
  });
  assert.equal(activated.target.workingCopyId, "work_ver_0002");
  const editedHistory = html("continue from V2");
  const saved = await value.repository.saveWorkingCopy({
    target: activated.target,
    html: editedHistory,
    expectedSourceSha256: activated.target.sourceSha256,
    editRevision: 1,
  });

  const classified = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.openTarget.workingCopyId, "work_ver_0002");
  assert.equal(classified.projectFacts.currentBasedOnVersionId, "ver_0002");
  assert.equal(classified.projectFacts.latestOfficialVersionId, "ver_0003");
  assert.equal(classified.projectFacts.currentDiffersFromBase, true);

  const retried = await value.repository.importExternal({
    sourcePath: imported.sourcePath,
    expectedSourceSha256: sha256(imported.buffer),
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.workingCopyId, "work_ver_0002");
  assert.equal(retried.target.exactSourcePath, saved.target.exactSourcePath);
  assert.notEqual(retried.target.workingCopyId, "work_ver_0003");
});

test("a later change to the external original stays bound and reports sourceRelation=changed", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "原稿已改.html");
  const changed = html("external original changed");
  const changedBytes = Buffer.from(changed, "utf8");
  const changedSha256 = sha256(changedBytes);
  await writeFile(imported.sourcePath, changedBytes);
  const registryBefore = await readFile(registryPath(value));

  const classified = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.projectId, imported.target.projectId);
  assert.equal(classified.sourceRelation, "changed");
  assert.equal(classified.projectFacts.sourceRelation, "changed");
  assert.equal(classified.sourceSha256, changedSha256);
  assert.deepEqual(await readFile(registryPath(value)), registryBefore);

  const retried = await value.repository.importExternal({
    sourcePath: imported.sourcePath,
    expectedSourceSha256: changedSha256,
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.projectId, imported.target.projectId);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), html("V1"));
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

test("equal bytes on another path remain a new external source", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "left/same-bytes.html");
  const otherPath = path.join(value.sources, "right/same-bytes.html");
  await mkdir(path.dirname(otherPath), { recursive: true });
  await writeFile(otherPath, imported.buffer);
  const registryBefore = await readFile(registryPath(value));

  const classified = await value.repository.classifyOpenPath({ sourcePath: otherPath });
  assert.equal(classified.kind, "new-external");
  assert.equal(classified.sourceFileName, "same-bytes.html");
  assert.equal(classified.visibleV1FileName, "same-bytes-V1.html");
  assert.equal(classified.sourceSha256, sha256(imported.buffer));
  assert.deepEqual(await readFile(registryPath(value)), registryBefore);

  const second = await value.repository.importExternal({
    sourcePath: otherPath,
    expectedSourceSha256: sha256(imported.buffer),
  });
  assert.equal(second.imported, true);
  assert.notEqual(second.target.projectId, imported.target.projectId);
});

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

test("a bound project with a missing Working Copy fails closed instead of becoming a new import", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "损坏绑定.html");
  await rm(imported.target.exactSourcePath);
  const registryBefore = await readFile(registryPath(value));

  await assert.rejects(
    value.repository.classifyOpenPath({ sourcePath: imported.sourcePath }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code !== "SOURCE_NOT_FOUND"
      && !String(error.code).includes("new-external"),
  );
  await assert.rejects(
    value.repository.importExternal({
      sourcePath: imported.sourcePath,
      expectedSourceSha256: sha256(imported.buffer),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code !== "SOURCE_NOT_FOUND",
  );
  assert.deepEqual(await readFile(registryPath(value)), registryBefore);
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

test("macOS /var and /private/var aliases share one external source binding", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS path-alias regression");
    return;
  }
  const value = await fixture(t);
  const imported = await importSource(value, "外部路径别名.html");
  const aliasPath = imported.sourcePath === "/var"
    || imported.sourcePath.startsWith("/var/")
    ? `/private${imported.sourcePath}`
    : imported.sourcePath.startsWith("/private/var/")
      ? imported.sourcePath.slice("/private".length)
      : null;
  if (!aliasPath || aliasPath === imported.sourcePath) {
    t.skip("temporary directory is not exposed through /var");
    return;
  }

  const classified = await value.repository.classifyOpenPath({ sourcePath: aliasPath });
  assert.equal(classified.kind, "known-external");
  assert.equal(classified.projectFacts.projectId, imported.target.projectId);

  const retried = await value.repository.importExternal({
    sourcePath: aliasPath,
    expectedSourceSha256: sha256(imported.buffer),
  });
  assert.equal(retried.imported, false);
  assert.equal(retried.target.projectId, imported.target.projectId);
  assert.equal(Object.keys((await json(registryPath(value))).projects).length, 1);
});

// Releasing the lock is cleanup, never authority. A release that cannot complete
// must not become the outcome of an operation that already committed, and must not
// replace the original error whose code drives recovery in the renderer.
test("a failed lock release never replaces a committed import result", async (t) => {
  const value = await fixture(t);
  const sourcePath = path.join(value.sources, "提交后释放失败.html");
  const buffer = Buffer.from(html("committed"), "utf8");
  await writeFile(sourcePath, buffer);

  let damaged = false;
  const repository = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint: async (name) => {
      // By this failpoint the project directory is renamed into place and the
      // Registry is published, so the import is fully committed.
      if (name === "import-registry-written" && !damaged) {
        const lockPath = currentRegistryWriteLockPath(value);
        const owner = (await readdir(lockPath)).find((entry) => entry.startsWith(".owner-"));
        if (owner) {
          await writeFile(path.join(lockPath, owner), "{ truncated", "utf8");
          damaged = true;
        }
      }
      return false;
    },
  });

  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(buffer),
  });

  assert.equal(damaged, true);
  assert.equal(imported.imported, true);
  assert.equal(
    Object.keys((await json(registryPath(value))).projects).length,
    1,
  );

  // The undamaged half of the contract: an unreleasable lock is inert, not
  // terminal, so the next import reclaims it on age instead of failing busy.
  const nextPath = path.join(value.sources, "后续导入.html");
  const nextBuffer = Buffer.from(html("next"), "utf8");
  await writeFile(nextPath, nextBuffer);
  const next = await new ProjectFileRepository({
    projectsRoot: value.projects,
    registryWriteLockTimeoutMs: 400,
    registryWriteLockGraceMs: 10_000,
    clock: () => Date.now() + 60_000,
  }).importExternal({
    sourcePath: nextPath,
    expectedSourceSha256: sha256(nextBuffer),
  });
  assert.equal(next.imported, true);
  assert.equal(
    (await readdir(value.projects)).includes(".pageroot-registry-write-lock"),
    false,
  );
});

test("a live Registry write lock fails busy; a dead lock can be retired by its exact token", async (t) => {
  const value = await fixture(t);
  await importSource(value, "锁基线.html");
  await seedCurrentRegistryWriteLock(value, process.pid);
  const busy = new ProjectFileRepository({
    projectsRoot: value.projects,
    registryWriteLockTimeoutMs: 80,
  });
  await assert.rejects(
    busy.importExternal({
      sourcePath: path.join(value.sources, "锁活进程.html"),
      expectedSourceSha256: sha256(Buffer.from(html("V1"), "utf8")),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTRY_BUSY",
  );

  await rm(currentRegistryWriteLockPath(value), { recursive: true, force: true });
  await seedCurrentRegistryWriteLock(value, 2_147_483_647);
  const otherPath = path.join(value.sources, "锁死进程.html");
  const otherBuffer = Buffer.from(html("dead lock import"), "utf8");
  await writeFile(otherPath, otherBuffer);
  const imported = await new ProjectFileRepository({
    projectsRoot: value.projects,
  }).importExternal({
    sourcePath: otherPath,
    expectedSourceSha256: sha256(otherBuffer),
  });
  assert.equal(imported.imported, true);
  assert.equal(
    (await readdir(value.projects)).includes(".pageroot-registry-write-lock"),
    false,
  );
});

// An unresolvable lock directory is crash residue, not a held lock. Every shape
// below is reachable from a single interrupted process, and none of them can ever
// become resolvable again, so each must have a bounded automatic exit.
for (const shape of [
  {
    name: "an empty lock directory (crash between mkdir and the owner write)",
    seed: async () => {},
  },
  {
    name: "a doubled marker (crash between the two retire renames)",
    seed: async (lockPath) => {
      await writeFile(
        path.join(lockPath, ".owner-00000000-0000-4000-8000-00000000000a.json"),
        `${JSON.stringify({
          pid: 2_147_483_647,
          token: "00000000-0000-4000-8000-00000000000a",
          createdAt: "2026-08-16T00:00:00.000Z",
        })}\n`,
        "utf8",
      );
      await writeFile(
        path.join(
          lockPath,
          ".retiring-00000000-0000-4000-8000-00000000000b-00000000-0000-4000-8000-00000000000b.json",
        ),
        `${JSON.stringify({
          pid: 2_147_483_647,
          token: "00000000-0000-4000-8000-00000000000b",
          createdAt: "2026-08-16T00:00:00.000Z",
        })}\n`,
        "utf8",
      );
    },
  },
  {
    name: "a damaged owner file",
    seed: async (lockPath) => {
      await writeFile(
        path.join(lockPath, ".owner-00000000-0000-4000-8000-00000000000a.json"),
        "{ truncated",
        "utf8",
      );
    },
  },
]) {
  test(`an aged Registry write lock with ${shape.name} is reclaimed`, async (t) => {
    const value = await fixture(t);
    await importSource(value, "残留基线.html");
    const lockPath = currentRegistryWriteLockPath(value);
    await mkdir(lockPath);
    await shape.seed(lockPath);

    const sourcePath = path.join(value.sources, "残留回收.html");
    const buffer = Buffer.from(html("reclaimed"), "utf8");
    await writeFile(sourcePath, buffer);
    const imported = await new ProjectFileRepository({
      projectsRoot: value.projects,
      registryWriteLockTimeoutMs: 200,
      registryWriteLockGraceMs: 10_000,
      // The lock is inspected from a clock beyond its grace period, which is how
      // a user reaching a crashed lock minutes or days later observes it.
      clock: () => Date.now() + 60_000,
    }).importExternal({
      sourcePath,
      expectedSourceSha256: sha256(buffer),
    });

    assert.equal(imported.imported, true);
    assert.equal(
      (await readdir(value.projects)).includes(".pageroot-registry-write-lock"),
      false,
    );
    assert.equal(
      (await readdir(value.projects)).some(
        (entry) => entry.startsWith(".pageroot-lock-unresolvable-"),
      ),
      false,
    );
  });
}

test("an unresolvable Registry write lock inside its grace period still fails busy", async (t) => {
  const value = await fixture(t);
  await importSource(value, "宽限期基线.html");
  // A live owner that is mid-release or mid-retire reads back as unresolvable for
  // a moment. The grace period is what keeps that transient state from being
  // mistaken for crash residue.
  await mkdir(currentRegistryWriteLockPath(value));

  const sourcePath = path.join(value.sources, "宽限期内.html");
  const buffer = Buffer.from(html("within grace"), "utf8");
  await writeFile(sourcePath, buffer);
  await assert.rejects(
    new ProjectFileRepository({
      projectsRoot: value.projects,
      registryWriteLockTimeoutMs: 80,
      registryWriteLockGraceMs: 10_000,
    }).importExternal({
      sourcePath,
      expectedSourceSha256: sha256(buffer),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTRY_BUSY",
  );
  assert.equal(
    (await readdir(value.projects)).includes(".pageroot-registry-write-lock"),
    true,
  );
});

test("an aged lock owned by a live process is never reclaimed", async (t) => {
  const value = await fixture(t);
  await importSource(value, "活锁基线.html");
  await seedCurrentRegistryWriteLock(value, process.pid);

  const sourcePath = path.join(value.sources, "活锁不可回收.html");
  const buffer = Buffer.from(html("live owner"), "utf8");
  await writeFile(sourcePath, buffer);
  await assert.rejects(
    new ProjectFileRepository({
      projectsRoot: value.projects,
      registryWriteLockTimeoutMs: 80,
      registryWriteLockGraceMs: 0,
      clock: () => Date.now() + 86_400_000,
    }).importExternal({
      sourcePath,
      expectedSourceSha256: sha256(buffer),
    }),
    (error) => error instanceof ProjectFileRepositoryError
      && error.code === "REGISTRY_BUSY",
  );
  assert.equal(
    (await readdir(value.projects)).includes(".pageroot-registry-write-lock"),
    true,
  );
});

test("classifyOpenPath is read-only for managed, known and new HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "分类只读.html");
  const freshPath = path.join(value.sources, "尚未导入.html");
  await writeFile(freshPath, html("fresh"), "utf8");
  const registryBefore = await readFile(registryPath(value));

  const managed = await value.repository.classifyOpenPath({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(managed.kind, "managed-project");
  assert.equal(managed.target.projectId, imported.target.projectId);

  const known = await value.repository.classifyOpenPath({
    sourcePath: imported.sourcePath,
  });
  assert.equal(known.kind, "known-external");
  assert.equal(known.projectFacts.projectId, imported.target.projectId);
  assert.equal("importSourceKey" in known, false);
  assert.equal("importSourceKey" in known.projectFacts, false);

  const fresh = await value.repository.classifyOpenPath({ sourcePath: freshPath });
  assert.equal(fresh.kind, "new-external");
  assert.equal(fresh.sourceFileName, "尚未导入.html");
  assert.equal(fresh.visibleV1FileName, "尚未导入-V1.html");

  assert.deepEqual(await readFile(registryPath(value)), registryBefore);
});

// Forward compatibility. A Registry that carries every required member plus a
// member a newer PageRoot added is fully explainable, so it is read normally
// and that member survives the next Registry write. Refusing it instead would
// lock every project out of an older build, and dropping it would destroy the
// newer build's data just as silently as replacing the whole file.
test("a newer Registry member survives an older build's read and write", async (t) => {
  const value = await fixture(t);
  const first = await importSource(value, "第一个.html");
  const seeded = JSON.parse(await readFile(registryPath(value), "utf8"));
  seeded.futureRegistrySection = { schemaChannel: "next" };
  seeded.projects[first.target.projectId].ownerAccountId = "account_future";
  await writeFile(
    registryPath(value),
    `${JSON.stringify(seeded, null, 2)}\n`,
    "utf8",
  );

  await assert.doesNotReject(() => value.repository.listRegisteredProjects());

  // A second import forces a full Registry read, mutation and atomic write.
  const second = await importSource(value, "第二个.html");

  const after = JSON.parse(await readFile(registryPath(value), "utf8"));
  assert.deepEqual(after.futureRegistrySection, { schemaChannel: "next" });
  assert.equal(
    after.projects[first.target.projectId].ownerAccountId,
    "account_future",
  );
  assert.ok(after.projects[second.target.projectId]);
});

// The stored Draft is an envelope: #saveDraft rebuilds schemaVersion, project,
// document, Working Copy and base Version from the loaded project and then
// spreads the active snapshot over it. Those five members are authored by the
// writer on every save, so they must never be carried back from disk as if they
// were unknown members — a stale file would otherwise overwrite the
// authoritative identity and pin the schema version forever.
test("a stored Draft keeps its authoritative envelope while preserving unknown members", async (t) => {
  const value = await fixture(t);
  const { target } = await importSource(value, "草稿信封.html");
  const draftFile = path.join(
    target.projectRootPath,
    ".pageroot",
    "drafts",
    `${target.workingCopyId}.json`,
  );

  await value.repository.saveDraft({
    target,
    operationId: "draftop_envelope_000001",
    expectedDraftRevision: 0,
    comments: [{ commentId: "comment_a", text: "a" }],
    changeEvents: [],
    deletedCommentIds: [],
  });
  const persisted = await json(draftFile);
  assert.equal(persisted.workingCopyId, target.workingCopyId);

  // A newer build added a member, and the envelope on disk has drifted.
  await writeFile(
    draftFile,
    `${JSON.stringify({
      ...persisted,
      schemaVersion: "9.9.9",
      workingCopyId: "work_ver_9999",
      provenance: { actor: "human" },
    }, null, 2)}\n`,
    "utf8",
  );

  await value.repository.saveDraft({
    target,
    operationId: "draftop_envelope_000002",
    expectedDraftRevision: persisted.draftRevision,
    comments: [{ commentId: "comment_a", text: "b" }],
    changeEvents: [],
    deletedCommentIds: [],
  });

  const rewritten = await json(draftFile);
  assert.equal(rewritten.schemaVersion, persisted.schemaVersion);
  assert.equal(rewritten.workingCopyId, target.workingCopyId);
  assert.equal(rewritten.projectId, target.projectId);
  assert.deepEqual(rewritten.provenance, { actor: "human" });
});

// manifest.json is mutated in place and written back as the object that was
// read, and the Working Copy state spreads the record it read before overriding
// its authoritative members. Both orderings preserve a member a newer PageRoot
// added; the stored Draft envelope above is the one that had to be corrected to
// match them.
//
// `fileIdentity` is the counter-example and the boundary of the rule. It is
// authored from a fresh stat on every save — a save publishes through an atomic
// rename, so the inode legitimately changes — and is therefore replaced, not
// round-tripped. An authored sub-record cannot carry unknown members, and its
// schema stays strict.
test("unknown manifest and Working Copy state members survive an ordinary save", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "清单未知成员.html");
  const control = path.join(imported.target.projectRootPath, ".pageroot");
  const manifestFile = path.join(control, "manifest.json");

  const manifest = await json(manifestFile);
  manifest.ownerAccountId = "account_future";
  manifest.versions[0].provenance = { seq: 1 };
  manifest.workingCopies[0].provenance = { seq: 2 };
  manifest.workingCopies[0].fileIdentity.futureIdentity = "next";
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const stateFile = path.join(
    control,
    manifest.workingCopies[0].stateRelativePath,
  );
  const state = await json(stateFile);
  state.provenance = { seq: 3 };
  await writeFile(stateFile, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const saved = await value.repository.saveWorkingCopy({
    target: imported.target,
    html: html("清单未知成员 saved"),
    expectedSourceSha256: imported.target.sourceSha256,
    editRevision: 1,
  });
  assert.equal(saved.versionCreated, false);

  const rewrittenManifest = await json(manifestFile);
  assert.equal(rewrittenManifest.ownerAccountId, "account_future");
  assert.deepEqual(rewrittenManifest.versions[0].provenance, { seq: 1 });
  assert.deepEqual(rewrittenManifest.workingCopies[0].provenance, { seq: 2 });
  assert.equal(
    "futureIdentity" in rewrittenManifest.workingCopies[0].fileIdentity,
    false,
  );
  assert.deepEqual(
    Object.keys(rewrittenManifest.workingCopies[0].fileIdentity).sort(),
    ["birthtimeMs", "device", "inode"],
  );

  const rewrittenState = await json(stateFile);
  assert.deepEqual(rewrittenState.provenance, { seq: 3 });
  assert.equal(rewrittenState.schemaVersion, state.schemaVersion);
});

