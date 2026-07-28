import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  htmlSha256,
  readHtmlFile,
} from "../desktop/project-files.mjs";
import {
  recoverPendingSourceRename,
  renameHtmlSource,
  validateSourceRenamePayload,
} from "../desktop/source-rename.mjs";

const HTML = "<!doctype html><html><body><h1>源页测试</h1></body></html>";
const SOURCE_SHA256 = htmlSha256(HTML);

function projectState(sourcePath) {
  return {
    version: 2,
    activePath: sourcePath,
    recent: [{
      path: sourcePath,
      name: path.basename(sourcePath),
      lastOpenedAt: 100,
    }],
    pendingRename: null,
    lastRename: null,
  };
}

function renamePayload(sourcePath, stem = "新的文件名") {
  return {
    operationId: "rename_test_operation_0001",
    sourcePath,
    stem,
    expectedSha256: SOURCE_SHA256,
  };
}

async function createFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "pageroot-rename-test-"));
  const sourcePath = path.join(directory, "原文件.html");
  await writeFile(sourcePath, HTML, "utf8");
  t.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    sourcePath: await realpath(sourcePath),
  };
}

function serviceOptions(payload, state, writes, rebinds) {
  return {
    payload,
    state,
    persistState: async () => {
      writes.push(structuredClone(state));
    },
    resolveKnownSource: realpath,
    readProject: (sourcePath) => readHtmlFile({ sourcePath }),
    rebindWorkspace: async (sourcePath, expectedSha256) => {
      rebinds.push({ sourcePath, expectedSha256 });
      return true;
    },
    platform: "linux",
    now: () => 1_000,
  };
}

test("source rename preserves exact bytes and atomically moves active and recent identity", async (t) => {
  const fixture = await createFixture(t);
  const state = projectState(fixture.sourcePath);
  const writes = [];
  const rebinds = [];
  const result = await renameHtmlSource(serviceOptions(
    renamePayload(fixture.sourcePath),
    state,
    writes,
    rebinds,
  ));
  const targetPath = await realpath(
    path.join(fixture.directory, "新的文件名.html"),
  );

  assert.equal(result.sourcePath, targetPath);
  assert.equal(result.previousSourcePath, fixture.sourcePath);
  assert.equal(result.stem, "新的文件名");
  assert.equal(result.extension, ".html");
  assert.equal(result.sha256, SOURCE_SHA256);
  assert.equal(result.workspaceRelinked, true);
  assert.equal(await readFile(targetPath, "utf8"), HTML);
  await assert.rejects(access(fixture.sourcePath), { code: "ENOENT" });
  assert.equal(state.activePath, targetPath);
  assert.deepEqual(state.recent.map((entry) => entry.path), [targetPath]);
  assert.equal(state.recent[0].name, "新的文件名.html");
  assert.equal(state.pendingRename, null);
  assert.equal(state.lastRename.operationId, "rename_test_operation_0001");
  assert.equal(writes.length, 2);
  assert.deepEqual(rebinds, [{
    sourcePath: targetPath,
    expectedSha256: SOURCE_SHA256,
  }]);
});

test("source rename refuses a live destination and does not overwrite either file", async (t) => {
  const fixture = await createFixture(t);
  const destinationPath = path.join(fixture.directory, "已有文件.html");
  await writeFile(destinationPath, "<html>已有内容</html>", "utf8");
  const state = projectState(fixture.sourcePath);
  const writes = [];

  await assert.rejects(
    renameHtmlSource(serviceOptions(
      renamePayload(fixture.sourcePath, "已有文件"),
      state,
      writes,
      [],
    )),
    (error) => {
      assert.equal(error.code, "RENAME_DESTINATION_EXISTS");
      assert.equal(error.message, "同一文件夹里已经有这个文件名。");
      return true;
    },
  );

  assert.equal(await readFile(fixture.sourcePath, "utf8"), HTML);
  assert.equal(await readFile(destinationPath, "utf8"), "<html>已有内容</html>");
  assert.equal(state.activePath, fixture.sourcePath);
  assert.equal(state.pendingRename, null);
  assert.equal(writes.length, 0);
});

test("source rename rejects a stale content Hash before creating an intent record", async (t) => {
  const fixture = await createFixture(t);
  const state = projectState(fixture.sourcePath);
  const writes = [];
  const payload = {
    ...renamePayload(fixture.sourcePath),
    expectedSha256:
      "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  };

  await assert.rejects(
    renameHtmlSource(serviceOptions(payload, state, writes, [])),
    (error) => {
      assert.equal(error.code, "RENAME_SOURCE_CHANGED");
      return true;
    },
  );

  assert.equal(await readFile(fixture.sourcePath, "utf8"), HTML);
  assert.equal(state.pendingRename, null);
  assert.equal(writes.length, 0);
});

test("prepared rename recovers after a crash before the filesystem move", async (t) => {
  const fixture = await createFixture(t);
  const targetPath = path.join(fixture.directory, "恢复后的文件名.html");
  const state = projectState(fixture.sourcePath);
  state.pendingRename = {
    version: 1,
    operationId: "rename_recovery_before_move",
    previousPath: fixture.sourcePath,
    sourcePath: targetPath,
    stem: "恢复后的文件名",
    expectedSha256: SOURCE_SHA256,
    preparedAt: 900,
  };
  const writes = [];

  const recovery = await recoverPendingSourceRename({
    state,
    readProject: (sourcePath) => readHtmlFile({ sourcePath }),
    persistState: async () => writes.push(structuredClone(state)),
    platform: "linux",
    now: () => 1_000,
  });
  const canonicalTargetPath = await realpath(targetPath);

  assert.equal(recovery.recovered, true);
  assert.equal(await readFile(targetPath, "utf8"), HTML);
  await assert.rejects(access(fixture.sourcePath), { code: "ENOENT" });
  assert.equal(state.activePath, canonicalTargetPath);
  assert.equal(state.pendingRename, null);
  assert.equal(state.lastRename.completedAt, 1_000);
  assert.equal(writes.length, 1);
});

test("prepared rename recovers after a crash between filesystem move and state commit", async (t) => {
  const fixture = await createFixture(t);
  const targetPath = path.join(fixture.directory, "已经移动.html");
  await rename(fixture.sourcePath, targetPath);
  const state = projectState(fixture.sourcePath);
  state.pendingRename = {
    version: 1,
    operationId: "rename_recovery_after_move",
    previousPath: fixture.sourcePath,
    sourcePath: targetPath,
    stem: "已经移动",
    expectedSha256: SOURCE_SHA256,
    preparedAt: 900,
  };
  const writes = [];

  const recovery = await recoverPendingSourceRename({
    state,
    readProject: (sourcePath) => readHtmlFile({ sourcePath }),
    persistState: async () => writes.push(structuredClone(state)),
    platform: "linux",
    now: () => 1_000,
  });
  const canonicalTargetPath = await realpath(targetPath);

  assert.equal(recovery.recovered, true);
  assert.equal(state.activePath, canonicalTargetPath);
  assert.equal(state.recent[0].path, canonicalTargetPath);
  assert.equal(state.pendingRename, null);
  assert.equal(state.lastRename.operationId, "rename_recovery_after_move");
  assert.equal(writes.length, 1);
});

test("replaying the same rename operation returns its durable result without moving again", async (t) => {
  const fixture = await createFixture(t);
  const state = projectState(fixture.sourcePath);
  const payload = renamePayload(fixture.sourcePath);
  const writes = [];
  const rebinds = [];
  const options = serviceOptions(payload, state, writes, rebinds);

  const first = await renameHtmlSource(options);
  const second = await renameHtmlSource(options);

  assert.equal(second.sourcePath, first.sourcePath);
  assert.equal(second.replayed, true);
  assert.equal(second.sha256, SOURCE_SHA256);
  assert.equal(writes.length, 2);
  assert.equal(rebinds.length, 1);
});

test("rename payload keeps the HTML extension outside the editable stem", () => {
  const sourcePath = "/Users/demo/页面.htm";
  assert.deepEqual(
    validateSourceRenamePayload({
      ...renamePayload(sourcePath, "新版页面.htm"),
      sourcePath,
    }),
    {
      operationId: "rename_test_operation_0001",
      sourcePath,
      stem: "新版页面",
      extension: ".htm",
      expectedSha256: SOURCE_SHA256,
      targetPath: "/Users/demo/新版页面.htm",
    },
  );
  assert.throws(
    () => validateSourceRenamePayload(renamePayload(sourcePath, "../越界")),
    (error) => error.code === "INVALID_RENAME_STEM",
  );
  assert.throws(
    () => validateSourceRenamePayload(renamePayload(sourcePath, ".隐藏文件")),
    (error) => error.code === "INVALID_RENAME_STEM",
  );
});
