import assert from "node:assert/strict";
import { access, readFile, writeFile } from "node:fs/promises";
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
  const bridge = await environment.start({
    HTML_AI_PROJECT_FILES_ROOT: join(environment.root, "project-files"),
  });
  const legacyPreview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
  );
  assert.equal(legacyPreview.response.status, 200);
  assert.equal(legacyPreview.body.registered, false);
  const legacy = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: legacyPreview.body.currentHtmlSha256,
  });
  assert.equal(legacy.response.status, 200, JSON.stringify(legacy.body));
  assert.equal(legacy.body.registered, true);
  assert.notEqual(legacy.body.projectFileSchemaVersion, "4.0.0");

  const v4Preview = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(sourcePath)}&projectStorageVersion=4.0.0`,
  );
  assert.equal(v4Preview.response.status, 200, JSON.stringify(v4Preview.body));
  assert.equal(v4Preview.body.registered, false);
  assert.equal(v4Preview.body.projectId, null);
  const v4Source = await bridge.requestJson(
    `/source?sourcePath=${encodeURIComponent(sourcePath)}&projectStorageVersion=4.0.0`,
  );
  assert.equal(v4Source.response.status, 200, JSON.stringify(v4Source.body));
  assert.equal(v4Source.body.registered, false);
  assert.equal(v4Source.body.content, original);

  const imported = await postJson(bridge, "/project/ensure", {
    sourcePath,
    expectedSourceSha256: v4Preview.body.currentHtmlSha256,
    projectStorageVersion: "4.0.0",
  });
  assert.equal(imported.response.status, 200, JSON.stringify(imported.body));
  assert.equal(imported.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(imported.body.imported, true);
  assert.notEqual(imported.body.projectId, legacy.body.projectId);
  assert.match(imported.body.sourcePath, /pre-v4-V1\.html$/u);
  assert.equal(await readFile(sourcePath, "utf8"), original);
  const manifest = JSON.parse(await readFile(
    join(imported.body.projectRoot, ".pageroot", "manifest.json"),
    "utf8",
  ));
  assert.deepEqual(manifest.versions.map((version) => version.versionId), ["ver_0001"]);

  const reopened = await bridge.requestJson(
    `/workspace?sourcePath=${encodeURIComponent(imported.body.sourcePath)}&projectStorageVersion=4.0.0`,
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
  }
  assert.equal(active.versionId, "ver_0006");

  const viewed = await bridge.requestJson(
    `/version-file?sourcePath=${encodeURIComponent(active.exactSourcePath)}&versionId=ver_0002`,
  );
  assert.equal(viewed.response.status, 200, JSON.stringify(viewed.body));
  assert.equal(viewed.body.readOnly, true);
  assert.equal(viewed.body.content, v2Html);
  assert.equal(viewed.body.projectFileSchemaVersion, "4.0.0");
  assert.equal(viewed.body.workingCopyId, "work_ver_0002");
  assert.match(viewed.body.visibleWorkingCopyPath, /history-bridge-V2\.html$/u);
  assert.equal(viewed.body.visibleWorkingCopyPath.includes("/.pageroot/"), false);
  assert.match(viewed.body.workingCopySha256, /^sha256:[a-f0-9]{64}$/u);
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
