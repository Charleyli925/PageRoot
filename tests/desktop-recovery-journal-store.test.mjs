import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createRecoveryJournalStore } from "../desktop/recovery-journal-store.mjs";

const HASH_A = `sha256:${"a".repeat(64)}`;

function checkpoint(overrides = {}) {
  return {
    projectId: "project_0123456789abcdef",
    documentId: "doc_0123456789abcdef",
    sourcePath: "/tmp/report.html",
    workingCopyId: "working_0001",
    expectedSourceSha256: HASH_A,
    revision: 7,
    html: "<!doctype html><html><body>saved locally</body></html>",
    ...overrides,
  };
}

async function fixture(t) {
  const parent = await mkdtemp(path.join(os.tmpdir(), "pageroot-recovery-journal-"));
  t.after(async () => {
    const { rm } = await import("node:fs/promises");
    await rm(parent, { recursive: true, force: true });
  });
  const rootPath = path.join(parent, "journals");
  const store = createRecoveryJournalStore({
    rootPath,
    now: () => new Date("2026-09-01T01:02:03.000Z"),
  });
  return { parent, rootPath, store };
}

test("recovery journal atomically commits and reads back exact verified HTML", async (t) => {
  const { rootPath, store } = await fixture(t);
  const committed = await store.commit(checkpoint());

  assert.equal(committed.recoveryHtmlSha256.length, 71);
  assert.equal(committed.journalSha256.length, 71);
  assert.equal(committed.revision, 7);
  assert.equal(committed.byteLength, Buffer.byteLength(checkpoint().html));
  assert.equal("journalPath" in committed, false);

  const recovered = await store.readVerified({
    projectId: committed.projectId,
    documentId: committed.documentId,
    expectedJournalSha256: committed.journalSha256,
  });
  assert.equal(recovered.html, checkpoint().html);
  assert.equal(recovered.recoveryHtmlSha256, committed.recoveryHtmlSha256);

  const names = await (await import("node:fs/promises")).readdir(rootPath);
  assert.equal(names.length, 1);
  assert.match(names[0], /^[a-f0-9]{64}\.json$/u);
  assert.equal(names.some((name) => name.endsWith(".tmp")), false);
});

test("recovery journal refuses stale CAS commit and stale removal", async (t) => {
  const { store } = await fixture(t);
  const first = await store.commit(checkpoint());
  const second = await store.commit(checkpoint({
    revision: 8,
    html: "<!doctype html><html><body>newer</body></html>",
    expectedJournalSha256: first.journalSha256,
  }));

  await assert.rejects(
    store.commit(checkpoint({
      revision: 9,
      expectedJournalSha256: first.journalSha256,
    })),
    (error) => error.code === "RECOVERY_JOURNAL_CAS_MISMATCH",
  );
  await assert.rejects(
    store.remove({
      projectId: first.projectId,
      documentId: first.documentId,
      expectedJournalSha256: first.journalSha256,
    }),
    (error) => error.code === "RECOVERY_JOURNAL_CAS_MISMATCH",
  );
  assert.equal((await store.readVerified({
    projectId: second.projectId,
    documentId: second.documentId,
  })).revision, 8);
  await assert.rejects(
    store.commit(checkpoint({ revision: 7 })),
    (error) => error.code === "RECOVERY_JOURNAL_STALE_REVISION",
  );
  await assert.rejects(
    store.remove({ projectId: second.projectId, documentId: second.documentId }),
    (error) => error.code === "RECOVERY_JOURNAL_CAS_REQUIRED",
  );
});

test("one corrupt recovery entry does not hide other recoverable documents", async (t) => {
  const { rootPath, store } = await fixture(t);
  const valid = await store.commit(checkpoint());
  await writeFile(path.join(rootPath, `${"f".repeat(64)}.json`), "not json");

  const listed = await store.listRecoverable();
  assert.equal(listed.invalidCount, 1);
  assert.equal(listed.entries.length, 1);
  assert.equal(listed.entries[0].journalSha256, valid.journalSha256);
  assert.equal("html" in listed.entries[0], false);
});

test("recovery journal rejects symlink roots and tampered HTML hashes", async (t) => {
  const unsafe = await fixture(t);
  const realRoot = path.join(unsafe.parent, "real");
  await mkdir(realRoot);
  await symlink(realRoot, unsafe.rootPath);
  await assert.rejects(
    unsafe.store.initialize(),
    (error) => error.code === "RECOVERY_JOURNAL_ROOT_UNSAFE",
  );

  const safe = await fixture(t);
  await safe.store.commit(checkpoint());
  const [name] = await (await import("node:fs/promises")).readdir(safe.rootPath);
  const filePath = path.join(safe.rootPath, name);
  const envelope = JSON.parse(await readFile(filePath, "utf8"));
  envelope.html = "<!doctype html><html><body>tampered</body></html>";
  await writeFile(filePath, JSON.stringify(envelope));
  await assert.rejects(
    safe.store.readVerified(checkpoint()),
    (error) => error.code === "RECOVERY_JOURNAL_HASH_MISMATCH",
  );
});

test("recovery journal serializes one document without blocking another", async (t) => {
  const { store } = await fixture(t);
  const [left, right] = await Promise.all([
    store.commit(checkpoint({ documentId: "doc_1111111111111111" })),
    store.commit(checkpoint({ documentId: "doc_2222222222222222" })),
  ]);
  const listed = await store.listRecoverable();
  assert.equal(listed.entries.length, 2);
  assert.notEqual(left.journalSha256, right.journalSha256);
});
