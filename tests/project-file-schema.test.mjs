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

async function v4Fixture(name) {
  return json(new URL(`../fixtures/v4/${name}`, import.meta.url));
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

test("committed v4 fixtures independently validate each persisted-record contract", async () => {
  const fixturePairs = [
    ["project-registry.v4.schema.json", "project-registry.valid.json"],
    ["project-identity.v4.schema.json", "project-identity.valid.json"],
    ["project-manifest.v4.schema.json", "project-manifest.valid.json"],
    ["project-runtime-state.v4.schema.json", "project-runtime-state.processing.json"],
    ["working-copy-state.v4.schema.json", "working-copy-state.valid.json"],
    ["candidate.v4.schema.json", "candidate.pending-review.json"],
    ["promotion-transaction.v4.schema.json", "promotion-transaction.prepared.json"],
  ];
  await Promise.all(fixturePairs.map(async ([schemaName, fixtureName]) => {
    await validate(schemaName, await v4Fixture(fixtureName));
  }));

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
  assert.equal(check(await v4Fixture("project-manifest.unknown-field.json")), false);
});

test("v4 schemas accept repository-produced lifecycle facts", async (t) => {
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

  const request = await repository.prepareRequest({
    target: imported.target,
    requestId: "req_schema",
    attemptId: "attempt_001",
    expectedSourceSha256: imported.target.sourceSha256,
    request: { summary: "schema candidate" },
    prompt: "# schema candidate\n",
  });
  const candidate = await repository.createCandidate({
    target: imported.target,
    requestId: "req_schema",
    candidateId: request.candidateId,
    html: html("V2"),
    expectedSourceSha256: imported.target.sourceSha256,
  });
  const candidatePath = path.join(controlRoot, "requests", "req_schema", "candidate.json");
  await Promise.all([
    validate("candidate.v4.schema.json", await json(candidatePath)),
    validate(
      "project-runtime-state.v4.schema.json",
      await json(path.join(controlRoot, "runtime-state.json")),
    ),
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
