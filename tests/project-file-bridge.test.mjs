import assert from "node:assert/strict";
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

import {
  createBridgeTestEnvironment,
} from "./helpers/bridge-test-environment.mjs";
import {
  finalizeProjectFileAttempt,
} from "../scripts/project-file-finalizer.mjs";
import { ProjectFileRepository } from "../scripts/project-file-repository.mjs";
import { sha256 } from "../scripts/lifecycle-core.mjs";

function html(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1></body></html>`;
}

async function postJson(bridge, pathname, body) {
  return bridge.postJson(pathname, body);
}

function legacyV4RegistryFromCurrent(current) {
  return {
    schemaVersion: "4.0.0",
    updatedAt: current.updatedAt,
    projects: Object.fromEntries(Object.entries(current.projects).map(([projectId, record]) => [
      projectId,
      {
        projectRootPath: record.registeredProjectRootPath,
        updatedAt: record.updatedAt,
      },
    ])),
  };
}

test("project-file PR1 import switches to V1 before the queued save and leaves external bytes untouched", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-bridge-",
  });
  const original = html("external V1");
  const sourcePath = await environment.createSource("external.htm", original);
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(preview.response.status, 200);
  assert.equal(preview.body.registered, false);

  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  assert.equal(ensured.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(ensured.body.imported, true);
  assert.match(ensured.body.sourcePath, /external-V1\.htm$/u);
  assert.equal(ensured.body.openTarget.workingCopyId, "work_ver_0001");
  assert.equal(await readFile(sourcePath, "utf8"), original);

  const edited = html("queued first edit");
  const saved = await postJson(bridge, "/autosave", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    editRevision: 1,
    html: edited,
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.versionCreated, false);
  assert.equal(saved.body.content, edited);
  assert.equal(saved.body.currentExactVersionId, null);
  assert.equal(await readFile(sourcePath, "utf8"), original);
  const manifest = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
});

test("the Bridge exposes every Registry member and opens one only by projectId", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-catalog-",
  });
  const aPath = await environment.createSource("A.html", html("A"));
  const bPath = await environment.createSource("B.html", html("B"));
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });

  const ensure = async (sourcePath) => {
    const preview = await bridge.requestJson(
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}&projectStorageVersion=4.0.0`,
    );
    return postJson(bridge, "/project/ensure", {
      sourcePath,
      expectedSourceSha256: preview.body.currentHtmlSha256,
      projectStorageVersion: "4.0.0",
    });
  };
  const [a, b] = await Promise.all([ensure(aPath), ensure(bPath)]);
  assert.equal(a.response.status, 200, JSON.stringify(a.body));
  assert.equal(b.response.status, 200, JSON.stringify(b.body));

  const catalog = await bridge.requestJson("/registered-projects");
  assert.equal(catalog.response.status, 200, JSON.stringify(catalog.body));
  assert.equal(catalog.body.ok, true);
  assert.deepEqual(
    new Set(catalog.body.projects.map((project) => project.projectId)),
    new Set([a.body.projectId, b.body.projectId]),
  );
  assert.equal(catalog.body.projects.every((project) => project.availability === "ready"), true);

  const opened = await bridge.requestJson(
    `/registered-project/open?projectId=${encodeURIComponent(b.body.projectId)}`,
  );
  assert.equal(opened.response.status, 200, JSON.stringify(opened.body));
  assert.equal(opened.body.projectId, b.body.projectId);
  assert.equal(opened.body.documentId, b.body.documentId);
  assert.equal(opened.body.openTarget.workingCopyId, "work_ver_0001");
  assert.equal(opened.body.sourcePath, b.body.sourcePath);
  assert.equal(opened.body.sourceSha256, opened.body.openTarget.sourceSha256);

  const finderRenamedWorkingCopy = join(
    b.body.projectRoot,
    "B Finder renamed.html",
  );
  await rename(b.body.sourcePath, finderRenamedWorkingCopy);
  const reboundCatalog = await bridge.requestJson("/registered-projects");
  assert.equal(reboundCatalog.response.status, 200, JSON.stringify(reboundCatalog.body));
  const reboundRow = reboundCatalog.body.projects.find(
    (project) => project.projectId === b.body.projectId,
  );
  assert.equal(reboundRow?.availability, "ready");
  assert.equal(reboundRow?.activeSourcePath, finderRenamedWorkingCopy);
  const reboundOpen = await bridge.requestJson(
    `/registered-project/open?projectId=${encodeURIComponent(b.body.projectId)}`,
  );
  assert.equal(reboundOpen.response.status, 200, JSON.stringify(reboundOpen.body));
  assert.equal(reboundOpen.body.sourcePath, finderRenamedWorkingCopy);

  const invalid = await bridge.requestJson("/registered-project/open?projectId=project_not_valid");
  assert.equal(invalid.response.status, 400);
});

test("Bridge migrates an exact legacy V4 Registry before workspace GET and first ensureProject", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-legacy-v4-bridge-",
  });
  const projectsRoot = join(environment.root, "project-files");
  const seedSourcePath = await environment.createSource("legacy-seed.html", html("legacy seed"));
  const openingSource = html("new external source");
  const openingSourcePath = await environment.createSource("legacy-opening.html", openingSource);
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: projectsRoot,
  });

  const seedPreview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(seedSourcePath)}&projectStorageVersion=4.0.0`,
  );
  assert.equal(seedPreview.response.status, 200, JSON.stringify(seedPreview.body));
  const seeded = await postJson(bridge, "/project/ensure", {
    sourcePath: seedSourcePath,
    expectedSourceSha256: seedPreview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(seeded.response.status, 200, JSON.stringify(seeded.body));

  const registryPath = join(projectsRoot, ".pageroot-registry.json");
  const currentRegistry = JSON.parse(await readFile(registryPath, "utf8"));
  const legacyRegistryBytes = Buffer.from(
    `${JSON.stringify(legacyV4RegistryFromCurrent(currentRegistry), null, 2)}\n`,
    "utf8",
  );
  const legacyRegistrySha256 = sha256(legacyRegistryBytes);
  await writeFile(registryPath, legacyRegistryBytes);

  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(openingSourcePath)}&projectStorageVersion=4.0.0`,
  );
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.registered, false);
  const migratedRegistry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.deepEqual(migratedRegistry.pendingImports, {});
  const backupPath = join(
    projectsRoot,
    ".pageroot-registry-backups",
    `${legacyRegistrySha256.slice("sha256:".length)}.json`,
  );
  assert.deepEqual(await readFile(backupPath), legacyRegistryBytes);

  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath: openingSourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  assert.equal(ensured.body.imported, true);
  assert.equal(await readFile(openingSourcePath, "utf8"), openingSource);

  const reopened = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&projectStorageVersion=4.0.0`,
  );
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.registered, true);
  assert.equal(reopened.body.projectId, ensured.body.projectId);
});

test("a v4 client treats a pre-v4 project as a fresh V1 import", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-pre-v4-",
  });
  const original = html("pre-v4 external source");
  const sourcePath = await environment.createSource("pre-v4.html", original);
  const legacyProjectId = "project_aaaaaaaaaaaaaaaa";
  const legacyStorageDirectoryName = "pre-v4-legacy__20260101T000000__aaaaaaaa";
  const legacyProjectRoot = join(environment.workspace, "projects", legacyStorageDirectoryName);
  await mkdir(join(legacyProjectRoot, "versions"), { recursive: true });
  await writeFile(
    join(environment.workspace, "project-registry.json"),
    `${JSON.stringify({
      schemaVersion: "3.0.0",
      projects: {
        [legacyProjectId]: {
          displayName: "pre-v4",
          sourcePath,
          createdAt: "2026-01-01T00:00:00.000Z",
          storageDirectoryName: legacyStorageDirectoryName,
        },
      },
    }, null, 2)}\n`,
  );
  await writeFile(
    join(legacyProjectRoot, "project.json"),
    `${JSON.stringify({
      schemaVersion: "3.0.0",
      projectId: legacyProjectId,
      documentId: "doc_aaaaaaaaaaaaaaaa",
      sourcePath,
      createdAt: "2026-01-01T00:00:00.000Z",
      storageDirectoryName: legacyStorageDirectoryName,
    }, null, 2)}\n`,
  );
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });

  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.registered, false);
  assert.equal(preview.body.projectId, null);
  const source = await bridge.requestJson(
    `/source?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(source.response.status, 200, JSON.stringify(source.body));
  assert.equal(source.body.registered, false);
  assert.equal(source.body.content, original);

  const imported = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
  });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(imported.body.imported, true);
  assert.notEqual(imported.body.projectId, legacyProjectId);
  assert.match(imported.body.sourcePath, /pre-v4-V1\.html$/u);
  assert.equal(await readFile(sourcePath, "utf8"), original);
  assert.equal(
    JSON.parse(await readFile(join(environment.workspace, "project-registry.json"), "utf8"))
      .projects[legacyProjectId].storageDirectoryName,
    legacyStorageDirectoryName,
  );
  const manifest = JSON.parse(await readFile(
    join(imported.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);

  const reopened = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(imported.body.sourcePath)}`,
  );
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.registered, true);
  assert.equal(reopened.body.projectId, imported.body.projectId);
});

test("Bridge continues a historical Version through one durable Working Copy receipt", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-history-bridge-",
  });
  const projectsRoot = join(environment.root, "project-files");
  const sourcePath = await environment.createSource("history-bridge.html", html("external V1"));
  const bridge = await environment.start({ HTML_AI_PROJECT_FILES_ROOT: projectsRoot });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));

  const repository = new ProjectFileRepository({ projectsRoot });
  let active = (await repository.workspace({ sourcePath: ensured.body.sourcePath })).target;
  let v2WorkingCopyPath = null;
  const v2Html = html("immutable V2");
  for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
    const candidate = await repository.createCandidate({
      target: active,
      requestId: `req_bridge_history_${ordinal}`,
      candidateId: `candidate_bridge_history_${ordinal}_0001`,
      html: ordinal === 2 ? v2Html : html(`V${ordinal}`),
      expectedSourceSha256: active.sourceSha256,
    });
    active = (await repository.promoteCandidate({
      target: active,
      candidateId: candidate.candidate.candidateId,
    })).target;
    if (ordinal === 2) v2WorkingCopyPath = active.exactSourcePath;
  }
  assert.equal(active.versionId, "ver_0006");

  const finderRenamedV2 = join(
    ensured.body.projectRoot,
    "history-bridge-V2 Finder renamed.html",
  );
  await rename(v2WorkingCopyPath, finderRenamedV2);

  const viewed = await bridge.requestJson(
    `/version-file?sourcePath=${encodeURIComponent(active.exactSourcePath)}&versionId=ver_0002`,
  );
  assert.equal(viewed.response.status, 200, JSON.stringify(viewed.body));
  assert.equal(viewed.body.readOnly, true);
  assert.equal(viewed.body.content, v2Html);
  assert.equal(viewed.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(viewed.body.workingCopyId, "work_ver_0002");
  assert.equal(viewed.body.visibleWorkingCopyPath, finderRenamedV2);
  assert.equal(viewed.body.visibleWorkingCopyPath.includes("/.pageroot/"), false);
  assert.match(viewed.body.workingCopySha256, /^sha256:[a-f0-9]{64}$/u);
  const reboundManifest = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.equal(
    reboundManifest.workingCopies.find(
      (entry) => entry.workingCopyId === "work_ver_0002",
    )?.sourceRelativePath,
    "history-bridge-V2 Finder renamed.html",
  );
  const beforeContinue = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(active.exactSourcePath)}`,
  );
  assert.equal(beforeContinue.body.sourcePath, active.exactSourcePath);
  assert.equal(beforeContinue.body.latestVersionId, "ver_0006");

  const request = {
    sourcePath: active.exactSourcePath,
    projectId: active.projectId,
    documentId: active.documentId,
    versionId: "ver_0002",
    operationId: "bridge_history_continue_v2_0001",
  };
  const continued = await postJson(bridge, "/history-version/continue", request);
  assert.equal(continued.response.status, 200, JSON.stringify(continued.body));
  assert.equal(continued.body.openTarget.workingCopyId, "work_ver_0002");
  assert.equal(continued.body.historyActivation.state, "desktop-pending");
  assert.equal(continued.body.operationId, request.operationId);

  const replayedAfterLostResponse = await postJson(bridge, "/history-version/continue", {
    ...request,
    operationId: "bridge_history_retry_after_loss_0001",
  });
  assert.equal(replayedAfterLostResponse.response.status, 200, JSON.stringify(replayedAfterLostResponse.body));
  assert.equal(replayedAfterLostResponse.body.replayed, true);
  assert.equal(replayedAfterLostResponse.body.operationId, request.operationId);

  const confirmation = {
    sourcePath: active.exactSourcePath,
    projectId: active.projectId,
    documentId: active.documentId,
    previousWorkingCopyId: "work_ver_0006",
    activatedWorkingCopyId: "work_ver_0002",
    versionId: "ver_0002",
    operationId: request.operationId,
  };
  const confirmed = await postJson(bridge, "/history-version/desktop-confirmed", confirmation);
  assert.equal(confirmed.response.status, 200, JSON.stringify(confirmed.body));
  assert.equal(confirmed.body.confirmed, true);
  assert.equal(confirmed.body.historyActivation.state, "desktop-confirmed");
  const confirmedReplay = await postJson(
    bridge,
    "/history-version/desktop-confirmed",
    confirmation,
  );
  assert.equal(confirmedReplay.response.status, 200, JSON.stringify(confirmedReplay.body));
  assert.equal(confirmedReplay.body.confirmed, false);

  const replayedAfterConfirmationLoss = await postJson(bridge, "/history-version/continue", {
    ...request,
    operationId: "bridge_history_retry_after_confirm_0001",
  });
  assert.equal(replayedAfterConfirmationLoss.response.status, 200, JSON.stringify(replayedAfterConfirmationLoss.body));
  assert.equal(replayedAfterConfirmationLoss.body.operationId, request.operationId);

  const stale = await postJson(bridge, "/history-version/continue", {
    ...request,
    versionId: "ver_0003",
    operationId: "bridge_history_stale_v3_0001",
  });
  assert.equal(stale.response.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.error.code, "HISTORY_ACTIVATION_PREDECESSOR_CONFLICT");
});

test("project-file PROJECT.md remains available through the shared project-file inspector", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-rules-",
  });
  const sourcePath = await environment.createSource("rules.html", html("external V1"));
  const bridge = await environment.start();
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));

  const inspect = async () => bridge.requestJson(
    `/file?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&path=PROJECT.md`,
  );
  const initial = await inspect();
  assert.equal(initial.response.status, 200, JSON.stringify(initial.body));
  assert.equal(initial.body.relativePath, "PROJECT.md");
  assert.equal(initial.body.readOnly, false);
  assert.equal(initial.body.content, "# rules\n");

  const content = "# 项目规则\n\n- 只修改首页标题。\n";
  const saved = await postJson(bridge, "/project-file", {
    sourcePath: ensured.body.sourcePath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    content,
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  const refreshed = await inspect();
  assert.equal(refreshed.response.status, 200, JSON.stringify(refreshed.body));
  assert.equal(refreshed.body.content, content);

  const cleared = await postJson(bridge, "/project-file", {
    sourcePath: ensured.body.sourcePath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    content: "",
  });
  assert.equal(cleared.response.status, 200, JSON.stringify(cleared.body));
  assert.equal((await inspect()).body.content, "");
});

test("project-file Request becomes a Candidate on finalization and a Version only on adoption", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-candidate-",
  });
  const original = html("external V1");
  const sourcePath = await environment.createSource("candidate.html", original);
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));

  const request = await postJson(bridge, "/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: "将标题改为 Candidate",
    comments: [],
    changeEvents: [],
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  assert.equal(request.body.activeRun.status, "processing");
  const processingAiTask = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(processingAiTask.response.status, 200, JSON.stringify(processingAiTask.body));
  assert.equal(processingAiTask.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(processingAiTask.body.requestId, request.body.requestId);
  assert.equal(processingAiTask.body.candidatePath, null);
  assert.match(processingAiTask.body.aiTaskRelativePath, /^AI任务\//u);
  assert.equal(processingAiTask.body.aiTaskPath.includes("/.pageroot/"), false);
  const prompt = await readFile(
    join(ensured.body.projectRoot, ".pageroot", "requests", request.body.requestId, "PROMPT.md"),
    "utf8",
  );
  assert.match(prompt, /待审阅 Candidate/u);

  const outputPath = join(
    ensured.body.projectRoot,
    ".pageroot",
    ...request.body.outputRelativePath.split("/"),
  );
  const candidateHtml = html("Candidate V2");
  await writeFile(outputPath, candidateHtml, "utf8");
  const finalized = await finalizeProjectFileAttempt({
    projectRoot: ensured.body.projectRoot,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
  });
  assert.equal(finalized.status, "completed");

  const ready = await bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&requestId=${encodeURIComponent(request.body.requestId)}&attemptId=${encodeURIComponent(request.body.attemptId)}`,
  );
  assert.equal(ready.response.status, 200, JSON.stringify(ready.body));
  assert.equal(ready.body.status, "ready-to-open");
  assert.equal(ready.body.versionId, "ver_0002");
  assert.ok(["ready", "attention"].includes(ready.body.candidateAssessment.status));
  const readyAiTask = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(readyAiTask.response.status, 200, JSON.stringify(readyAiTask.body));
  assert.match(readyAiTask.body.candidatePath, /-V2-待审阅\.html$/u);
  assert.equal(await readFile(readyAiTask.body.candidatePath, "utf8"), candidateHtml);
  const controlRoot = join(ensured.body.projectRoot, ".pageroot");
  const candidateRecordPath = join(
    controlRoot,
    "requests",
    request.body.requestId,
    "candidate.json",
  );
  const [runtimeText, candidateRecord] = await Promise.all([
    readFile(join(controlRoot, "runtime-state.json")),
    readFile(candidateRecordPath),
  ]);
  const runtime = JSON.parse(runtimeText);
  assert.equal(
    runtime.activeRequest.candidateOutputSha256,
    sha256(Buffer.from(candidateHtml, "utf8")),
  );
  assert.equal(runtime.activeRequest.candidateRecordSha256, sha256(candidateRecord));
  const tamperedCandidateRecord = JSON.parse(candidateRecord.toString("utf8"));
  tamperedCandidateRecord.createdAt = "2000-01-01T00:00:00.000Z";
  await writeFile(candidateRecordPath, JSON.stringify(tamperedCandidateRecord), "utf8");
  const sealRejected = await bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&requestId=${encodeURIComponent(request.body.requestId)}&attemptId=${encodeURIComponent(request.body.attemptId)}`,
  );
  assert.equal(sealRejected.response.status, 409, JSON.stringify(sealRejected.body));
  assert.equal(sealRejected.body.error.code, "CANDIDATE_AUTHORITY_MISMATCH");
  await writeFile(candidateRecordPath, candidateRecord);
  const beforeAdoption = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(beforeAdoption.versions.map((version) => version.versionId), ["ver_0001"]);

  const review = await bridge.requestJson(
    `/version-file?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&versionId=ver_0002`,
  );
  assert.equal(review.response.status, 200, JSON.stringify(review.body));
  assert.equal(review.body.content, candidateHtml);
  assert.equal(review.body.candidate.status, "pending-review");

  const adopted = await postJson(bridge, "/ready-version/activate", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
    versionId: "ver_0002",
  });
  assert.equal(adopted.response.status, 200, JSON.stringify(adopted.body));
  assert.equal(adopted.body.versionId, "ver_0002");
  assert.match(adopted.body.sourcePath, /candidate-V2\.html$/u);
  const afterAdoption = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(afterAdoption.versions.map((version) => version.versionId), ["ver_0001", "ver_0002"]);
});

test("Bridge reveals a sealed terminal AI task after no-change", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-no-change-ai-task-",
  });
  const original = html("no-change source");
  const sourcePath = await environment.createSource("no-change.html", original);
  let bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  const request = await postJson(bridge, "/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: "不修改当前 HTML",
    comments: [],
    changeEvents: [],
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  await writeFile(
    join(
      ensured.body.projectRoot,
      ".pageroot",
      ...request.body.outputRelativePath.split("/"),
    ),
    original,
    "utf8",
  );
  await finalizeProjectFileAttempt({
    projectRoot: ensured.body.projectRoot,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
  });

  const status = await bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&requestId=${encodeURIComponent(request.body.requestId)}&attemptId=${encodeURIComponent(request.body.attemptId)}`,
  );
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.status, "no-change");
  await bridge.stop();
  bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const reopened = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(reopened.response.status, 200, JSON.stringify(reopened.body));
  assert.equal(reopened.body.activeRun, null);
  assert.equal(reopened.body.runtimeState.activeRun, null);
  assert.equal(reopened.body.recentRunOutcome?.status, "no-change");
  assert.equal(reopened.body.recentRunOutcome?.requestId, request.body.requestId);
  assert.equal(reopened.body.recentRunOutcome?.attemptId, request.body.attemptId);
  assert.equal(reopened.body.recentRunOutcome?.completionObserved, true);
  const terminalAiTask = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(terminalAiTask.response.status, 200, JSON.stringify(terminalAiTask.body));
  assert.equal(terminalAiTask.body.status, "no-change");
  assert.equal(terminalAiTask.body.requestId, request.body.requestId);
  assert.equal(terminalAiTask.body.candidatePath, null);
  assert.equal(
    await readFile(join(terminalAiTask.body.aiTaskPath, "PROMPT.md"), "utf8"),
    await readFile(
      join(ensured.body.projectRoot, ".pageroot", "requests", request.body.requestId, "PROMPT.md"),
      "utf8",
    ),
  );
  const requestPath = join(
    ensured.body.projectRoot,
    ".pageroot",
    "requests",
    request.body.requestId,
    "request.json",
  );
  const tamperedRequest = JSON.parse(await readFile(requestPath, "utf8"));
  tamperedRequest.completedAt = "2000-01-01T00:00:00.000Z";
  await writeFile(requestPath, JSON.stringify(tamperedRequest), "utf8");
  const tamperRejected = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(tamperRejected.response.status, 409, JSON.stringify(tamperRejected.body));
  assert.equal(tamperRejected.body.error.code, "REQUEST_RUNTIME_ANCHOR_MISMATCH");
});

test("a finalized but unusable Candidate remains an error and never creates a Version", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-project-file-validation-",
  });
  const sourcePath = await environment.createSource("validation.html", html("external V1"));
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  const request = await postJson(bridge, "/request", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    freezeCutoffRevision: 0,
    summary: "生成一个空页面",
    comments: [],
    changeEvents: [],
  });
  assert.equal(request.response.status, 201, JSON.stringify(request.body));
  const outputPath = join(
    ensured.body.projectRoot,
    ".pageroot",
    ...request.body.outputRelativePath.split("/"),
  );
  await writeFile(
    outputPath,
    "<!doctype html><html><head><title>empty</title></head><body></body></html>",
    "utf8",
  );
  await finalizeProjectFileAttempt({
    projectRoot: ensured.body.projectRoot,
    requestId: request.body.requestId,
    attemptId: request.body.attemptId,
  });

  const status = await bridge.requestJson(
    `/status?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}&requestId=${encodeURIComponent(request.body.requestId)}&attemptId=${encodeURIComponent(request.body.attemptId)}`,
  );
  assert.equal(status.response.status, 200, JSON.stringify(status.body));
  assert.equal(status.body.status, "error");
  assert.equal(status.body.request.error.code, "CANDIDATE_UNUSABLE");
  const terminalAiTask = await bridge.requestJson(
    `/ai-task?sourcePath=${encodeURIComponent(ensured.body.sourcePath)}`,
  );
  assert.equal(terminalAiTask.response.status, 200, JSON.stringify(terminalAiTask.body));
  assert.equal(terminalAiTask.body.status, "error");
  assert.equal(terminalAiTask.body.requestId, request.body.requestId);
  assert.equal(terminalAiTask.body.candidatePath, null);
  assert.equal(terminalAiTask.body.aiTaskPath.includes("/.pageroot/"), false);
  const manifest = JSON.parse(await readFile(
    join(ensured.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);
  await assert.rejects(access(join(
    ensured.body.projectRoot,
    ".pageroot",
    "requests",
    request.body.requestId,
    "candidate.json",
  )));
});

test("unmanaged HTML stays an import source and mutations fail closed without a v4 project", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-unmanaged-open-",
  });
  const original = html("unmanaged");
  const sourcePath = await environment.createSource("open.html", original);
  const bridge = await environment.start();

  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(preview.response.status, 200, JSON.stringify(preview.body));
  assert.equal(preview.body.registered, false);
  const source = await bridge.requestJson(
    `/source?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(source.response.status, 200, JSON.stringify(source.body));
  assert.equal(source.body.registered, false);
  assert.equal(source.body.content, original);

  const autosave = await postJson(bridge, "/autosave", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
    editRevision: 1,
    html: html("should not write"),
  });
  assert.equal(autosave.response.status, 404);
  assert.equal(autosave.body.error.code, "PROJECT_NOT_FOUND");

  const draft = await postJson(bridge, "/draft", {
    sourcePath,
    operationId: "draftop_unmanaged_1",
    expectedDraftRevision: 0,
    comments: [],
    changeEvents: [],
  });
  assert.equal(draft.response.status, 404);
  assert.equal(draft.body.error.code, "PROJECT_NOT_FOUND");

  const conflict = await bridge.requestJson(
    `/conflict-candidate?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(conflict.response.status, 404);
  assert.equal(conflict.body.error.code, "PROJECT_NOT_FOUND");
  assert.equal(await readFile(sourcePath, "utf8"), original);
});

test("v4 attachments, empty source history and absent conflicts stay bound to the project root", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-v4-attachments-",
  });
  const sourcePath = await environment.createSource("attach.html", html("attach"));
  const bridge = await environment.start();
  const preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: preview.body.currentHtmlSha256,
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  const workingPath = ensured.body.sourcePath;
  const commentId = "comment_attach";
  const attachmentId = "attachment_one";
  const fileName = "note.txt";
  const payload = Buffer.from("pageroot-v4-attachment", "utf8");
  const saved = await postJson(bridge, "/attachment", {
    sourcePath: workingPath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    commentId,
    attachmentId,
    fileName,
    mediaType: "text/plain",
    dataBase64: payload.toString("base64"),
    byteLength: payload.byteLength,
  });
  assert.equal(saved.response.status, 201, JSON.stringify(saved.body));
  assert.equal(saved.body.attachment.sha256, sha256(payload));
  assert.equal(
    saved.body.attachment.relativePath,
    `draft/attachments/${commentId}/${attachmentId}-${fileName}`,
  );
  const onDisk = await readFile(join(
    ensured.body.projectRoot,
    saved.body.attachment.relativePath,
  ));
  assert.deepEqual(onDisk, payload);

  const downloaded = await fetch(
    `${bridge.baseUrl}/attachment?sourcePath=${encodeURIComponent(workingPath)}&relativePath=${encodeURIComponent(saved.body.attachment.relativePath)}`,
  );
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), payload);

  const removed = await postJson(bridge, "/attachment/delete", {
    sourcePath: workingPath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    relativePath: saved.body.attachment.relativePath,
  });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  assert.equal(removed.body.removed, true);
  await assert.rejects(access(join(
    ensured.body.projectRoot,
    saved.body.attachment.relativePath,
  )));

  const history = await postJson(bridge, "/source-history/action", {
    sourcePath: workingPath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    actionId: "sourceaction_noop_undo",
    direction: "undo",
    expectedSourceSha256: ensured.body.sourceSha256,
  });
  assert.equal(history.response.status, 200, JSON.stringify(history.body));
  assert.equal(history.body.status, "history-no-op");
  assert.equal(history.body.content, html("attach"));
  assert.equal(history.body.sourceHistory.cursor, 0);

  const emptyConflict = await bridge.requestJson(
    `/conflict-candidate?sourcePath=${encodeURIComponent(workingPath)}`,
  );
  assert.equal(emptyConflict.response.status, 200, JSON.stringify(emptyConflict.body));
  assert.equal(emptyConflict.body.content, undefined);

  const resolve = await postJson(bridge, "/conflict/resolve", {
    sourcePath: workingPath,
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    resolution: "keep-external",
  });
  assert.equal(resolve.response.status, 404);
  assert.equal(resolve.body.error.code, "CONFLICT_NOT_FOUND");
});

test("open-classification is read-only and returns A/B/C without source keys or original paths", async (t) => {
  const environment = await createBridgeTestEnvironment(t, {
    prefix: "pageroot-open-classification-",
  });
  const original = html("classify original");
  const sourcePath = await environment.createSource("classify-me.html", original);
  const projectFilesRoot = join(environment.root, "project-files");
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: projectFilesRoot,
  });
  const registryFile = join(projectFilesRoot, ".pageroot-registry.json");

  const beforeImport = await postJson(bridge, "/project/open-classification", { sourcePath });
  assert.equal(beforeImport.response.status, 200, JSON.stringify(beforeImport.body));
  assert.equal(beforeImport.body.kind, "new-external");
  assert.equal(beforeImport.body.sourceFileName, "classify-me.html");
  assert.equal(beforeImport.body.visibleV1FileName, "classify-me-V1.html");
  assert.equal(beforeImport.body.sourceSha256, sha256(Buffer.from(original, "utf8")));
  assert.equal("importSourceKey" in beforeImport.body, false);
  assert.equal(JSON.stringify(beforeImport.body).includes(sourcePath), false);

  const ensured = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: beforeImport.body.sourceSha256,
  });
  assert.equal(ensured.response.status, 200, JSON.stringify(ensured.body));
  const registryBefore = await readFile(registryFile);

  const managed = await postJson(bridge, "/project/open-classification", {
    sourcePath: ensured.body.sourcePath,
  });
  assert.equal(managed.response.status, 200, JSON.stringify(managed.body));
  assert.equal(managed.body.kind, "managed-project");
  assert.equal(managed.body.openTarget.projectId, ensured.body.projectId);
  assert.equal(managed.body.openTarget.workingCopyId, "work_ver_0001");

  const known = await postJson(bridge, "/project/open-classification", { sourcePath });
  assert.equal(known.response.status, 200, JSON.stringify(known.body));
  assert.equal(known.body.kind, "known-external");
  assert.equal(known.body.projectId, ensured.body.projectId);
  assert.equal(known.body.sourceRelation, "unchanged");
  assert.equal(known.body.currentBasedOnVersionId, "ver_0001");
  assert.equal(known.body.latestOfficialVersionId, "ver_0001");
  assert.equal(known.body.currentDiffersFromBase, false);
  assert.equal(known.body.openTarget.workingCopyId, "work_ver_0001");
  assert.equal(known.body.openTarget.exactSourcePath, ensured.body.sourcePath);
  assert.equal("importSourceKey" in known.body, false);
  assert.equal(JSON.stringify(known.body).includes(sourcePath), false);
  assert.deepEqual(await readFile(registryFile), registryBefore);

  const edited = html("classify after edit");
  const saved = await postJson(bridge, "/autosave", {
    projectId: ensured.body.projectId,
    documentId: ensured.body.documentId,
    sourcePath: ensured.body.sourcePath,
    expectedSourceSha256: ensured.body.sourceSha256,
    editRevision: 1,
    html: edited,
  });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));

  const knownAfterEdit = await postJson(bridge, "/project/open-classification", { sourcePath });
  assert.equal(knownAfterEdit.response.status, 200, JSON.stringify(knownAfterEdit.body));
  assert.equal(knownAfterEdit.body.kind, "known-external");
  assert.equal(knownAfterEdit.body.projectId, ensured.body.projectId);
  assert.equal(knownAfterEdit.body.currentDiffersFromBase, true);
  assert.equal(knownAfterEdit.body.openTarget.workingCopyId, "work_ver_0001");
  assert.deepEqual(await readFile(registryFile), registryBefore);
});

