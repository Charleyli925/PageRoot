import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  htmlSha256,
  persistHtmlFile,
  readHtmlFile,
  resetProjectFileQueuesForTests,
  writeHtmlCopy,
} from "../desktop/project-files.mjs";

function page(title) {
  return `<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`;
}

test("desktop writer serializes revisions and never lets an older write win", async (t) => {
  resetProjectFileQueuesForTests();
  const directory = await mkdtemp(join(tmpdir(), "html-ai-writer-"));
  const sourcePath = join(directory, "source.html");
  const initial = page("initial");
  await writeFile(sourcePath, initial, "utf8");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const first = persistHtmlFile({
    projectId: "project_test",
    documentId: "doc_test",
    sourcePath,
    html: page("revision-1"),
    expectedSha256: htmlSha256(initial),
    editRevision: 1,
  });
  const second = persistHtmlFile({
    projectId: "project_test",
    documentId: "doc_test",
    sourcePath,
    html: page("revision-2"),
    expectedSha256: htmlSha256(initial),
    editRevision: 2,
  });
  const [savedOne, savedTwo] = await Promise.all([first, second]);
  assert.equal(savedOne.persistedRevision, 1);
  assert.equal(savedTwo.persistedRevision, 2);
  assert.equal(await readFile(sourcePath, "utf8"), page("revision-2"));

  const stale = await persistHtmlFile({
    projectId: "project_test",
    documentId: "doc_test",
    sourcePath,
    html: page("revision-1"),
    expectedSha256: savedTwo.sha256,
    editRevision: 1,
  });
  assert.equal(stale.skipped, true);
  assert.equal(await readFile(sourcePath, "utf8"), page("revision-2"));
});

test("desktop writer reports structured external conflicts without overwriting", async (t) => {
  resetProjectFileQueuesForTests();
  const directory = await mkdtemp(join(tmpdir(), "html-ai-writer-conflict-"));
  const sourcePath = join(directory, "source.html");
  const initial = page("initial");
  const external = page("external");
  await writeFile(sourcePath, initial, "utf8");
  await writeFile(sourcePath, external, "utf8");
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    persistHtmlFile({
      projectId: "project_test",
      documentId: "doc_test",
      sourcePath,
      html: page("workbench"),
      expectedSha256: htmlSha256(initial),
      editRevision: 1,
    }),
    (error) => {
      assert.equal(error.code, "SOURCE_CHANGED");
      assert.equal(error.details.expectedSha256, htmlSha256(initial));
      assert.equal(error.details.actualSha256, htmlSha256(external));
      return true;
    },
  );
  assert.equal(await readFile(sourcePath, "utf8"), external);
});

test("export creates an independent copy and readback reports exact hash", async (t) => {
  resetProjectFileQueuesForTests();
  const directory = await mkdtemp(join(tmpdir(), "html-ai-export-"));
  const destinationPath = join(directory, "copy.html");
  const html = page("export");
  t.after(() => rm(directory, { recursive: true, force: true }));

  const exported = await writeHtmlCopy({ destinationPath, html });
  const inspected = await readHtmlFile({ sourcePath: destinationPath });
  assert.equal(exported.sha256, htmlSha256(html));
  assert.equal(inspected.sha256, exported.sha256);
  assert.equal(inspected.html, html);
});

test("desktop reader fails closed on non-UTF-8 HTML without rewriting bytes", async (t) => {
  resetProjectFileQueuesForTests();
  const directory = await mkdtemp(join(tmpdir(), "pageroot-encoding-"));
  const sourcePath = join(directory, "legacy-encoding.html");
  const original = Buffer.concat([
    Buffer.from("<!doctype html><html><body>", "utf8"),
    Buffer.from([0xff, 0xfe]),
    Buffer.from("</body></html>", "utf8"),
  ]);
  await writeFile(sourcePath, original);
  t.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    readHtmlFile({ sourcePath }),
    (error) => {
      assert.equal(error.code, "UNSUPPORTED_HTML_ENCODING");
      assert.match(error.message, /UTF-8/u);
      return true;
    },
  );
  assert.deepEqual(await readFile(sourcePath), original);
});
