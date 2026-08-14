import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "../node_modules/schema-utils/node_modules/ajv/dist/2020.js";
import { sha256 } from "../scripts/lifecycle-core.mjs";
import { ProjectFileRepository } from "../scripts/project-file-repository.mjs";

function html(label) {
  return `<!doctype html><html><head><title>${label}</title></head><body><h1>${label}</h1></body></html>`;
}

async function json(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function validate(schemaName, value) {
  const schema = JSON.parse(await readFile(
    new URL(`../schemas/${schemaName}`, import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
  });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const check = ajv.compile(schema);
  assert.equal(
    check(value),
    true,
    `${schemaName}: ${ajv.errorsText(check.errors, { separator: "\n" })}`,
  );
}

async function validateRejects(schemaName, value) {
  const schema = JSON.parse(await readFile(
    new URL(`../schemas/${schemaName}`, import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
  });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const check = ajv.compile(schema);
  assert.equal(check(value), false, `${schemaName} unexpectedly accepted invalid runtime authority`);
}

test("v4 schemas accept repository-produced identity, Working Copy, Candidate and Promotion facts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-project-file-schema-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceRoot = path.join(root, "sources");
  const projectsRoot = path.join(root, "projects");
  await mkdir(sourceRoot, { recursive: true });
  const sourcePath = path.join(sourceRoot, "schema.htm");
  const initial = html("V1");
  await writeFile(sourcePath, initial, "utf8");

  const repository = new ProjectFileRepository({ projectsRoot });
  const imported = await repository.importExternal({
    sourcePath,
    expectedSourceSha256: sha256(Buffer.from(initial, "utf8")),
  });
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const initialManifest = await json(path.join(controlRoot, "manifest.json"));
  await Promise.all([
    validate("project-registry.v4.schema.json", await json(path.join(
      projectsRoot,
      ".pageroot-registry.json",
    ))),
    validate("project-identity.v4.schema.json", await json(path.join(controlRoot, "project.json"))),
    validate("project-manifest.v4.schema.json", initialManifest),
    validate("project-runtime-state.v4.schema.json", await json(path.join(controlRoot, "runtime-state.json"))),
    validate(
      "working-copy-state.v4.schema.json",
      await json(path.join(controlRoot, "working-copies", "work_ver_0001.json")),
    ),
  ]);

  const candidate = await repository.createCandidate({
    target: imported.target,
    requestId: "req_schema",
    candidateId: "candidate_schema_0001",
    html: html("V2"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const candidatePath = path.join(controlRoot, "requests", "req_schema", "candidate.json");
  const candidateRuntime = await json(path.join(controlRoot, "runtime-state.json"));
  await Promise.all([
    validate("candidate.v4.schema.json", await json(candidatePath)),
    validate("project-runtime-state.v4.schema.json", candidateRuntime),
  ]);
  assert.match(candidateRuntime.activeRequest.candidateOutputSha256, /^sha256:[a-f0-9]{64}$/u);
  assert.match(candidateRuntime.activeRequest.candidateRecordSha256, /^sha256:[a-f0-9]{64}$/u);
  const missingCandidateSeal = structuredClone(candidateRuntime);
  delete missingCandidateSeal.activeRequest.candidateOutputSha256;
  const wrongCandidateSealType = structuredClone(candidateRuntime);
  wrongCandidateSealType.activeRequest.candidateRecordSha256 = 42;
  const malformedCandidateSeal = structuredClone(candidateRuntime);
  malformedCandidateSeal.activeRequest.candidateOutputSha256 = "sha256:not-a-digest";
  const missingPendingReviewSeal = structuredClone(candidateRuntime);
  missingPendingReviewSeal.activeRequest.candidateOutputSha256 = null;
  await Promise.all([
    validateRejects("project-runtime-state.v4.schema.json", missingCandidateSeal),
    validateRejects("project-runtime-state.v4.schema.json", wrongCandidateSealType),
    validateRejects("project-runtime-state.v4.schema.json", malformedCandidateSeal),
    validateRejects("project-runtime-state.v4.schema.json", missingPendingReviewSeal),
  ]);

  const promoted = await repository.promoteCandidate({
    target: imported.target,
    candidateId: candidate.candidate.candidateId,
  });
  const transaction = await json(path.join(
    controlRoot,
    "transactions",
    `promote_${candidate.candidate.candidateId}`,
    "transaction.json",
  ));
  await Promise.all([
    validate("candidate.v4.schema.json", await json(candidatePath)),
    validate("promotion-transaction.v4.schema.json", transaction),
    validate("project-manifest.v4.schema.json", await json(path.join(controlRoot, "manifest.json"))),
    validate("project-runtime-state.v4.schema.json", await json(path.join(controlRoot, "runtime-state.json"))),
    validate(
      "working-copy-state.v4.schema.json",
      await json(path.join(controlRoot, "working-copies", "work_ver_0002.json")),
    ),
  ]);
  assert.equal(promoted.version.versionId, "ver_0002");

  const invalidManifest = { ...initialManifest, fileNaming: { stem: "legacy" } };
  const schema = JSON.parse(await readFile(
    new URL("../schemas/project-manifest.v4.schema.json", import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({ strict: true, strictRequired: false });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const check = ajv.compile(schema);
  assert.equal(check(invalidManifest), false);
  const nestedWorkingCopy = structuredClone(initialManifest);
  nestedWorkingCopy.workingCopies[0].sourceRelativePath = "nested/schema-V1.htm";
  assert.equal(check(nestedWorkingCopy), false);
});
