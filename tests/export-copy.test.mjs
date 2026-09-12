import assert from "node:assert/strict";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createSafeExportDefaultPath,
  isProtectedExportDestination,
  normalizeHtmlExportPath,
  normalizedPathKey,
  pathsReferToSameFile,
  PROJECT_IPC_PROTOCOL,
  PROJECT_IPC_VERSION,
  runProjectIpcOperation,
  selectExportDestination,
  exportHtmlCopyToFile,
  createExportRevealAccess,
} from "../desktop/export-copy.mjs";
import { ProjectFileError, writeHtmlCopy } from "../desktop/project-files.mjs";
import { readLastExportDirectory, recordLastExportDirectory } from "../desktop/ui-preferences.mjs";

async function exportFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "pageroot-export-flow-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const downloadsDirectory = path.join(root, "Downloads");
  const externalDirectory = path.join(root, "Exports");
  const projectsRoot = path.join(root, "Projects");
  await Promise.all([downloadsDirectory, externalDirectory, projectsRoot].map((value) => mkdir(value)));
  return { root, downloadsDirectory, externalDirectory, projectsRoot,
    userDataPath: path.join(root, "preferences"),
    html: '<!doctype html><html data-pageroot-id="id"><body>frozen export</body></html>',
    suggestedName: "用户项目-版本 2.html" };
}

test("export remembers only a successful external destination and reuses it after restart", async (t) => {
  const value = await exportFixture(t);
  const destination = path.join(value.externalDirectory, "分享.html");
  const exported = await exportHtmlCopyToFile({ ...value, showSaveDialog: async (defaultPath) => {
    assert.equal(path.dirname(defaultPath), value.downloadsDirectory);
    return { filePath: destination };
  } });
  assert.equal(exported.path, destination);
  assert.equal(exported.exported, true);
  assert.equal(await readFile(destination, "utf8"), value.html);
  assert.equal(await readLastExportDirectory(value), value.externalDirectory);
  assert.equal(await exportHtmlCopyToFile({ ...value, showSaveDialog: async (defaultPath) => {
    assert.equal(path.dirname(defaultPath), value.externalDirectory);
    return { canceled: true };
  } }), null);
  assert.equal(await readLastExportDirectory(value), value.externalDirectory);
  await assert.rejects(exportHtmlCopyToFile({ ...value,
    showSaveDialog: async () => ({ filePath: path.join(value.downloadsDirectory, "failure.html") }),
    writeCopy: async () => { throw new Error("injected write failure"); },
  }), /injected write failure/);
  assert.equal(await readLastExportDirectory(value), value.externalDirectory);
});

test("unavailable or managed remembered directories fall back to Downloads", async (t) => {
  const value = await exportFixture(t);
  for (const directoryPath of [path.join(value.root, "gone"), value.projectsRoot]) {
    await recordLastExportDirectory({ ...value, directoryPath });
    await exportHtmlCopyToFile({ ...value, showSaveDialog: async (defaultPath) => {
      assert.equal(path.dirname(defaultPath), value.downloadsDirectory);
      return { canceled: true };
    } });
  }
});

test("a preference write failure preserves the verified export receipt", async (t) => {
  const value = await exportFixture(t);
  const blockedPreferences = path.join(value.root, "blocked-preferences");
  await writeFile(blockedPreferences, "ordinary file");
  const destination = path.join(value.externalDirectory, "verified.html");
  const receipt = await exportHtmlCopyToFile({ ...value, userDataPath: blockedPreferences,
    showSaveDialog: async () => ({ filePath: destination }),
  });
  assert.equal(receipt.exported, true);
  assert.equal(await readFile(destination, "utf8"), value.html);
});

test("export excludes every managed project path and external aliases to its authority files", async (t) => {
  const value = await exportFixture(t);
  const active = path.join(value.projectsRoot, "active", "work.html");
  const other = path.join(value.projectsRoot, "other", "work.html");
  const history = path.join(value.projectsRoot, "other", ".pageroot", "versions", "v1.html");
  const metadata = path.join(value.projectsRoot, "other", ".pageroot", "manifest.json");
  for (const filePath of [active, other, history, metadata]) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `authority:${filePath}`);
  }
  const alias = path.join(value.externalDirectory, "project-alias");
  await symlink(path.dirname(other), alias, "dir");
  const targets = [active, other, history, metadata, path.join(alias, "work.html")];
  for (const [index, filePath] of [other, history, metadata].entries()) {
    const hardLink = path.join(value.externalDirectory, `linked-${index}.html`);
    await link(filePath, hardLink);
    targets.push(hardLink);
  }
  for (const target of targets) {
    assert.equal(await isProtectedExportDestination(target, [active], { protectedRoots: [value.projectsRoot] }), true, target);
  }
  let dialogCount = 0;
  await assert.rejects(exportHtmlCopyToFile({ ...value, sourcePath: active, activePath: active,
    showSaveDialog: async () => { dialogCount += 1; return { filePath: other }; },
  }), { code: "EXPORT_OVER_SOURCE" });
  assert.equal(dialogCount, 1);
  assert.equal(await readFile(other, "utf8"), `authority:${other}`);
  assert.deepEqual(await readdir(value.downloadsDirectory), []);
  assert.equal(await readLastExportDirectory(value), null);
});

test("ordinary external overwrite and unrelated external hard links remain supported", async (t) => {
  const value = await exportFixture(t);
  const original = path.join(value.externalDirectory, "original.html");
  const destination = path.join(value.externalDirectory, "shared.html");
  await writeFile(original, "original bytes");
  await link(original, destination);
  assert.equal(await isProtectedExportDestination(destination, [], { protectedRoots: [value.projectsRoot] }), false);
  const receipt = await exportHtmlCopyToFile({ ...value, showSaveDialog: async () => ({ filePath: destination }) });
  assert.equal(receipt.path, destination);
  assert.equal(await readFile(destination, "utf8"), value.html);
  assert.equal(await readFile(original, "utf8"), "original bytes");
});

test("export rechecks authority immediately before publishing and does not remember a rejected write", async (t) => {
  const value = await exportFixture(t);
  const authority = path.join(value.projectsRoot, "version.html");
  const destination = path.join(value.externalDirectory, "race.html");
  await writeFile(authority, "immutable version");
  await assert.rejects(exportHtmlCopyToFile({ ...value,
    showSaveDialog: async () => ({ filePath: destination }),
    writeCopy: async (input) => {
      await link(authority, destination);
      return writeHtmlCopy(input);
    },
  }), { code: "EXPORT_OVER_SOURCE" });
  assert.equal(await readFile(authority, "utf8"), "immutable version");
  assert.equal(await readFile(destination, "utf8"), "immutable version");
  assert.equal(await readLastExportDirectory(value), null);
});

test("Finder access accepts only bounded successful export receipts from this session", () => {
  const access = createExportRevealAccess();
  const first = path.join(os.tmpdir(), "export-0.html");
  assert.equal(access.allows(first), false);
  access.record(null);
  access.record({ path: first, exported: false });
  assert.equal(access.allows(first), false);
  for (let index = 0; index <= 32; index += 1) {
    access.record({ path: path.join(os.tmpdir(), `export-${index}.html`), exported: true });
  }
  assert.equal(access.allows(first), false);
  assert.equal(access.allows(path.join(os.tmpdir(), "export-32.html")), true);
  assert.equal(access.allows(path.join(os.tmpdir(), "unrelated.html")), false);
});

test("the default export name is a free numbered copy and never the source", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-name-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "页面.html");
  const firstCopyPath = path.join(directory, "页面-副本.html");
  await writeFile(sourcePath, "<html></html>", "utf8");

  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "页面.html",
      sourcePath,
      activePath: sourcePath,
    }),
    firstCopyPath,
  );

  await writeFile(firstCopyPath, "existing copy", "utf8");
  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "页面.html",
      sourcePath,
      activePath: sourcePath,
    }),
    path.join(directory, "页面-副本-2.html"),
  );
});

test("a dotted product version remains part of the export file name", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-version-"));
  t.after(() => rm(directory, { recursive: true, force: true }));

  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "复杂HTML综合测试页-V1.3",
      sourcePath: null,
      activePath: null,
    }),
    path.join(directory, "复杂HTML综合测试页-V1.3-副本.html"),
  );
});

test("the selected destination gets one canonical HTML extension", () => {
  assert.equal(
    normalizeHtmlExportPath("/tmp/复杂HTML综合测试页-V1.3"),
    path.resolve("/tmp/复杂HTML综合测试页-V1.3.html"),
  );
  assert.equal(
    normalizeHtmlExportPath("/tmp/页面.htm"),
    path.resolve("/tmp/页面.htm"),
  );
  assert.equal(
    normalizeHtmlExportPath("/tmp/页面.notes"),
    path.resolve("/tmp/页面.notes.html"),
  );
});

test("the default export name skips aliases and existing paths", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-alias-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.htm");
  const hardLinkCopy = path.join(directory, "source-副本.htm");
  await writeFile(sourcePath, "<html></html>", "utf8");
  await link(sourcePath, hardLinkCopy);

  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "source.htm",
      sourcePath,
      activePath: sourcePath,
    }),
    path.join(directory, "source-副本-2.htm"),
  );
});

test("the default export name also avoids a different active project", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-active-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "draft.html");
  const activePath = path.join(directory, "draft-副本.html");
  await writeFile(sourcePath, "<html>draft</html>", "utf8");
  await writeFile(activePath, "<html>active</html>", "utf8");

  assert.equal(
    await createSafeExportDefaultPath({
      directoryPath: directory,
      suggestedName: "draft.html",
      sourcePath,
      activePath,
    }),
    path.join(directory, "draft-副本-2.html"),
  );
});

test("macOS path comparison protects case and Unicode aliases", async () => {
  const composed = "/tmp/项目/ÉXAMPLE.HTML";
  const decomposed = "/tmp/项目/e\u0301xample.html";
  assert.equal(
    normalizedPathKey(composed, "darwin"),
    normalizedPathKey(decomposed, "darwin"),
  );
  assert.equal(
    await pathsReferToSameFile(composed, decomposed, {
      platform: "darwin",
      statFile: async () => {
        throw Object.assign(new Error("not found"), { code: "ENOENT" });
      },
    }),
    true,
  );
});

test("existing inode identity protects hard links to the source", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-inode-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.html");
  const aliasPath = path.join(directory, "alias.html");
  await writeFile(sourcePath, "<html></html>", "utf8");
  await link(sourcePath, aliasPath);

  assert.equal(await pathsReferToSameFile(sourcePath, aliasPath), true);
  assert.equal(
    await isProtectedExportDestination(aliasPath, [sourcePath]),
    true,
  );
});

test("selecting the source rejects without writing an unselected alternative", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-retry-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.html");
  const defaultPath = path.join(directory, "source-副本.html");
  await writeFile(sourcePath, "<html></html>", "utf8");

  await assert.rejects(selectExportDestination({
    defaultPath,
    protectedPaths: [sourcePath],
    showSaveDialog: async () => ({ canceled: false, filePath: sourcePath }),
  }), { code: "EXPORT_OVER_SOURCE" });
  await assert.rejects(readFile(defaultPath), { code: "ENOENT" });
});

test("canceling the save dialog is a normal null result", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "html-ai-export-cancel-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourcePath = path.join(directory, "source.html");
  await writeFile(sourcePath, "<html></html>", "utf8");

  const selected = await selectExportDestination({
    defaultPath: path.join(directory, "source-副本.html"),
    protectedPaths: [sourcePath],
    showSaveDialog: async () => ({ canceled: true }),
  });

  assert.equal(selected, null);
  assert.equal(await readFile(sourcePath, "utf8"), "<html></html>");
});

test("project IPC envelopes preserve safe errors and redact unknown failures", async () => {
  const success = await runProjectIpcOperation(async () => ({ path: "/tmp/copy.html" }));
  assert.deepEqual(success, {
    protocol: PROJECT_IPC_PROTOCOL,
    version: PROJECT_IPC_VERSION,
    ok: true,
    value: { path: "/tmp/copy.html" },
  });

  const expected = await runProjectIpcOperation(async () => {
    throw new ProjectFileError(
      "EXPORT_OVER_SOURCE",
      "源文件没有被改动。",
      { destinationPath: "/tmp/source.html" },
    );
  });
  assert.equal(expected.ok, false);
  assert.equal(expected.error.code, "EXPORT_OVER_SOURCE");
  assert.equal(expected.error.message, "源文件没有被改动。");
  assert.equal(expected.error.details.destinationPath, "/tmp/source.html");
  assert.equal("stack" in expected.error, false);
  assert.equal("name" in expected.error, false);

  const unknown = await runProjectIpcOperation(async () => {
    throw new Error("secret internal stack and channel");
  });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, "FILE_OPERATION_FAILED");
  assert.equal(
    unknown.error.message,
    "本地文件操作没有完成，请重试或选择其他位置。",
  );
  assert.doesNotMatch(JSON.stringify(unknown), /secret|channel|stack/i);
});
