import assert from "node:assert/strict";
import {
  lstat,
  readFile,
  readdir,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import Ajv2020 from "ajv/dist/2020.js";

import { sha256 } from "../bridge/lifecycle-core.mjs";
import { ProjectFileRepository } from "../bridge/project-file-repository.mjs";
import {
  inspectSourceElementIdentity,
  materializeIdentityPreservingSave,
  materializeSourceElementIdentity,
} from "../bridge/project-file-repository/working-copy.mjs";
import {
  fixture,
  importSource,
  json,
} from "./project-file-repository-harness.mjs";

const RAW_HTML = "<!doctype html>\r\n<html><head><title>旧项目</title></head><body><svg viewBox=\"0 0 10 10\"><rect width=\"10\" height=\"10\"/></svg><template><x-card>内容</x-card></template></body></html>";

function deterministicUuidFactory() {
  let counter = 0;
  return () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
}

function fileIdentity(information) {
  return {
    device: String(information.dev),
    inode: String(information.ino),
    birthtimeMs: Number(information.birthtimeMs || 0),
  };
}

async function rewriteAsLegacyWorkingCopy(imported, html) {
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const manifestPath = path.join(controlRoot, "manifest.json");
  const manifest = await json(manifestPath);
  const workingCopy = manifest.workingCopies.find(
    (entry) => entry.workingCopyId === imported.target.workingCopyId,
  );
  assert.ok(workingCopy);
  await writeFile(imported.target.exactSourcePath, html, "utf8");
  workingCopy.fileIdentity = fileIdentity(await lstat(imported.target.exactSourcePath));
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

  const statePath = path.join(controlRoot, workingCopy.stateRelativePath);
  const state = await json(statePath);
  const sourceSha256 = sha256(Buffer.from(html, "utf8"));
  state.currentSha256 = sourceSha256;
  state.differsFromBase = sourceSha256 !== state.baseSha256;
  state.saveState = "saved";
  delete state.sourceElementIdentitySchemaVersion;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  return { controlRoot, manifestPath, statePath, workingCopy, sourceSha256 };
}

async function assertMigrationSchema(value) {
  const schema = JSON.parse(await readFile(
    new URL("../schemas/source-element-identity-migration.v1.schema.json", import.meta.url),
    "utf8",
  ));
  const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
  ajv.addFormat(
    "date-time",
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u,
  );
  const validate = ajv.compile(schema);
  assert.equal(
    validate(value),
    true,
    ajv.errorsText(validate.errors, { separator: "\n" }),
  );
}

test("identity materialization preserves authored bytes outside start-tag insertions", () => {
  const existingId = "pr1_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";
  const source = RAW_HTML.replace("<body>", `<body data-pageroot-id=\"${existingId}\">`);
  const materialized = materializeSourceElementIdentity(source, {
    randomUUIDFactory: deterministicUuidFactory(),
  });

  assert.equal(materialized.changed, true);
  assert.equal(materialized.html.startsWith("<!doctype html>\r\n"), true);
  assert.equal(materialized.html.includes(`<body data-pageroot-id=\"${existingId}\">`), true);
  assert.equal(materialized.identity.complete, true);
  assert.equal(
    materialized.identity.totalElementCount,
    materialized.identity.identifiedElementCount,
  );
  assert.equal(materialized.identity.totalElementCount, 8);
  assert.equal(materialized.addedElementCount, 7);
  assert.equal(
    materialized.html.replace(/ data-pageroot-id="pr1_[a-f0-9]{32}"/gu, ""),
    source.replace(` data-pageroot-id=\"${existingId}\"`, ""),
  );

  const repeated = materializeSourceElementIdentity(materialized.html, {
    randomUUIDFactory: () => {
      throw new Error("idempotent materialization must not allocate");
    },
  });
  assert.equal(repeated.changed, false);
  assert.equal(repeated.html, materialized.html);
});

test("identity materialization refuses malformed and duplicate authored identities", () => {
  const duplicate = "pr1_bbbbbbbbbbbb4bbb9bbbbbbbbbbbbbbb";
  const invalid = RAW_HTML
    .replace("<html>", `<html data-pageroot-id=\"${duplicate}\">`)
    .replace("<head>", `<head data-pageroot-id=\"${duplicate}\">`);
  assert.throws(
    () => materializeSourceElementIdentity(invalid),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_INVALID"
      && error.details.issues.some((issue) => issue.code === "PAGEROOT_ID_DUPLICATE_VALUE"),
  );
  assert.throws(
    () => materializeSourceElementIdentity(
      RAW_HTML.replace("<html>", "<html data-pageroot-id=\"customer-value\">"),
    ),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_INVALID"
      && error.details.issues.some((issue) => issue.code === "PAGEROOT_ID_INVALID_FORMAT"),
  );
  assert.throws(
    () => materializeSourceElementIdentity(
      RAW_HTML.replace(
        "<html>",
        "<html data-pageroot-id=\"pr1_1111111111114111811111111111111&#x31;\">",
      ),
    ),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_INVALID",
  );
});

test("an identity-preserving save assigns IDs only to newly authored elements", () => {
  const current = materializeSourceElementIdentity(RAW_HTML, {
    randomUUIDFactory: deterministicUuidFactory(),
  }).html;
  const next = current.replace("</body>", "<br></body>");
  const saved = materializeIdentityPreservingSave(current, next, {
    randomUUIDFactory: () => "00000000-0000-4000-8000-999999999999",
  });

  assert.equal(saved.addedElementCount, 1);
  assert.match(
    saved.html,
    /<br data-pageroot-id="pr1_00000000000040008000999999999999">/u,
  );
  for (const pagerootId of inspectSourceElementIdentity(current).claimedIds) {
    assert.equal(saved.identity.claimedIds.has(pagerootId), true);
  }
  const removedIdentity = next.replace(/ data-pageroot-id="pr1_[a-f0-9]{32}"/u, "");
  assert.throws(
    () => materializeIdentityPreservingSave(current, removedIdentity),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST"
      && error.details.lostIds.length === 1,
  );
});

test("a new import writes identified Working Copy bytes without changing the external file or V1", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "new-project.html", RAW_HTML);
  const managed = await readFile(imported.target.exactSourcePath, "utf8");
  const manifest = await json(path.join(imported.target.projectRootPath, ".pageroot", "manifest.json"));
  const workingCopy = manifest.workingCopies[0];
  const state = await json(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    workingCopy.stateRelativePath,
  ));
  const snapshot = await readFile(path.join(
    imported.target.projectRootPath,
    ".pageroot",
    manifest.versions[0].snapshotRelativePath,
  ), "utf8");

  assert.equal(await readFile(imported.sourcePath, "utf8"), RAW_HTML);
  assert.equal(snapshot, RAW_HTML);
  assert.equal(manifest.versions[0].contentSha256, sha256(Buffer.from(RAW_HTML)));
  assert.equal(inspectSourceElementIdentity(managed).complete, true);
  assert.equal(imported.importSourceSha256, sha256(Buffer.from(RAW_HTML)));
  assert.equal(imported.target.sourceSha256, sha256(Buffer.from(managed)));
  assert.equal(state.baseSha256, sha256(Buffer.from(RAW_HTML)));
  assert.equal(state.currentSha256, imported.target.sourceSha256);
  assert.equal(state.differsFromBase, true);
  assert.equal(state.sourceElementIdentitySchemaVersion, 1);
});

test("a legacy Working Copy migrates once and records an auditable committed transaction", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "legacy.html", RAW_HTML);
  const legacy = await rewriteAsLegacyWorkingCopy(imported, RAW_HTML);

  const workspace = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(workspace.workingCopyIdentityMigrated, true);
  assert.equal(workspace.workingCopyIdentityAdopted, false);
  assert.equal(inspectSourceElementIdentity(workspace.content).complete, true);
  assert.equal(workspace.workingCopyState.sourceElementIdentitySchemaVersion, 1);
  assert.notEqual(workspace.sourceSha256, legacy.sourceSha256);

  const transactionsRoot = path.join(legacy.controlRoot, "transactions");
  const identityTransactions = (await readdir(transactionsRoot)).filter(
    (name) => name.startsWith("identity_") && name.endsWith(".json"),
  );
  assert.equal(identityTransactions.length, 1);
  const transaction = await json(path.join(transactionsRoot, identityTransactions[0]));
  await assertMigrationSchema(transaction);
  assert.equal(transaction.schemaVersion, "1.0.0");
  assert.equal(transaction.state, "committed");
  assert.equal(transaction.outcome, "migrated");
  assert.equal(transaction.expectedSourceSha256, legacy.sourceSha256);
  assert.equal(transaction.targetSourceSha256, workspace.sourceSha256);
  assert.ok(transaction.addedElementCount > 0);
  assert.equal(
    await readFile(path.join(
      imported.target.projectRootPath,
      ".pageroot",
      (await json(legacy.manifestPath)).versions[0].snapshotRelativePath,
    ), "utf8"),
    RAW_HTML,
  );

  const reopened = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(reopened.workingCopyIdentityMigrated, false);
  assert.equal(reopened.workingCopyIdentityAdopted, false);
  assert.equal(reopened.content, workspace.content);
  assert.equal(
    (await readdir(transactionsRoot)).filter((name) => name.startsWith("identity_")).length,
    1,
  );
});

test("a complete legacy identity set is adopted without rewriting Working Copy HTML", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "adopt-existing.html", RAW_HTML);
  const before = await readFile(imported.target.exactSourcePath, "utf8");
  const controlRoot = path.join(imported.target.projectRootPath, ".pageroot");
  const manifest = await json(path.join(controlRoot, "manifest.json"));
  const workingCopy = manifest.workingCopies[0];
  const statePath = path.join(controlRoot, workingCopy.stateRelativePath);
  const state = await json(statePath);
  delete state.sourceElementIdentitySchemaVersion;
  await writeFile(statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");

  const workspace = await value.repository.workspace({
    sourcePath: imported.target.exactSourcePath,
  });
  assert.equal(workspace.workingCopyIdentityMigrated, false);
  assert.equal(workspace.workingCopyIdentityAdopted, true);
  assert.equal(workspace.content, before);
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), before);
  const transactionName = (await readdir(path.join(controlRoot, "transactions"))).find(
    (name) => name.startsWith("identity_") && name.endsWith(".json"),
  );
  assert.ok(transactionName);
  const transaction = await json(path.join(controlRoot, "transactions", transactionName));
  assert.equal(transaction.outcome, "adopted-existing");
  assert.equal(transaction.expectedSourceSha256, transaction.targetSourceSha256);
});

test("restart recovery completes every published migration crash window", async (t) => {
  for (const failpoint of [
    "identity-migration-prepared",
    "identity-migration-source-written",
    "identity-migration-metadata-written",
  ]) {
    await t.test(failpoint, async (child) => {
      const value = await fixture(child);
      const imported = await importSource(value, `${failpoint}.html`, RAW_HTML);
      await rewriteAsLegacyWorkingCopy(imported, RAW_HTML);
      const interrupted = new ProjectFileRepository({
        projectsRoot: value.projects,
        failpoint(name) {
          return name === failpoint;
        },
      });
      await interrupted.initialize();
      await assert.rejects(
        interrupted.workspace({ sourcePath: imported.target.exactSourcePath }),
        (error) => error?.code === "INJECTED_FAILPOINT",
      );

      const recoveredRepository = new ProjectFileRepository({ projectsRoot: value.projects });
      await recoveredRepository.initialize();
      const recovered = await recoveredRepository.workspace({
        sourcePath: imported.target.exactSourcePath,
      });
      assert.equal(inspectSourceElementIdentity(recovered.content).complete, true);
      assert.equal(recovered.workingCopyState.sourceElementIdentitySchemaVersion, 1);
      assert.equal(recovered.workingCopyIdentityMigrated, false);
    });
  }
});

test("restart recovery rejects a migration record whose staged paths do not match its recovery ID", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "tampered-recovery-path.html", RAW_HTML);
  const legacy = await rewriteAsLegacyWorkingCopy(imported, RAW_HTML);
  const interrupted = new ProjectFileRepository({
    projectsRoot: value.projects,
    failpoint(name) {
      return name === "identity-migration-prepared";
    },
  });
  await interrupted.initialize();
  await assert.rejects(
    interrupted.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error?.code === "INJECTED_FAILPOINT",
  );

  const transactionName = (await readdir(path.join(legacy.controlRoot, "transactions"))).find(
    (name) => name.startsWith("identity_") && name.endsWith(".json"),
  );
  assert.ok(transactionName);
  const transactionPath = path.join(legacy.controlRoot, "transactions", transactionName);
  const transaction = await json(transactionPath);
  transaction.previousRelativePath = transaction.nextRelativePath;
  await writeFile(transactionPath, `${JSON.stringify(transaction, null, 2)}\n`, "utf8");

  const recoveredRepository = new ProjectFileRepository({ projectsRoot: value.projects });
  await recoveredRepository.initialize();
  await assert.rejects(
    recoveredRepository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error?.code === "IDENTITY_MIGRATION_INVALID",
  );
});

test("an already migrated Working Copy fails closed after identity loss", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "identity-loss.html", RAW_HTML);
  const managed = await readFile(imported.target.exactSourcePath, "utf8");
  const damaged = managed.replace(/ data-pageroot-id="pr1_[a-f0-9]{32}"/u, "");
  await writeFile(imported.target.exactSourcePath, damaged, "utf8");

  await assert.rejects(
    value.repository.workspace({ sourcePath: imported.target.exactSourcePath }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), damaged);
});

test("a normal save cannot publish HTML that drops the adopted identity contract", async (t) => {
  const value = await fixture(t);
  const imported = await importSource(value, "save-identity-loss.html", RAW_HTML);
  const before = await readFile(imported.target.exactSourcePath, "utf8");

  await assert.rejects(
    value.repository.saveWorkingCopy({
      target: imported.target,
      html: RAW_HTML,
      expectedSourceSha256: imported.target.sourceSha256,
      editRevision: 1,
    }),
    (error) => error?.code === "SOURCE_ELEMENT_IDENTITY_LOST",
  );
  assert.equal(await readFile(imported.target.exactSourcePath, "utf8"), before);
});
