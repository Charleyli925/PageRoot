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

function html(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1></body></html>`;
}

async function postJson(bridge, pathname, body) {
  return bridge.postJson(pathname, body);
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
