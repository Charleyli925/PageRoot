import assert from "node:assert/strict";
import test from "node:test";

import {
  createExternalFileOpenExitHandoff,
  createExternalFileOpenMailbox,
  externalOpenFailurePresentation,
  externalHtmlPathsFromArgv,
  normalizeExternalHtmlPath,
} from "../desktop/external-file-open.mjs";
import { ProjectFileError } from "../desktop/project-files.mjs";

function createMemoryFilesystem() {
  const files = new Map();
  const missing = (filePath) => Object.assign(
    new Error(`ENOENT: ${filePath}`),
    { code: "ENOENT" },
  );
  return {
    files,
    mkdirSync() {},
    readFileSync(filePath) {
      if (!files.has(filePath)) throw missing(filePath);
      return files.get(filePath);
    },
    renameSync(fromPath, toPath) {
      if (!files.has(fromPath)) throw missing(fromPath);
      files.set(toPath, files.get(fromPath));
      files.delete(fromPath);
    },
    unlinkSync(filePath) {
      if (!files.delete(filePath)) throw missing(filePath);
    },
    writeFileSync(filePath, contents, { flag } = {}) {
      if (flag === "wx" && files.has(filePath)) {
        throw Object.assign(new Error(`EEXIST: ${filePath}`), { code: "EEXIST" });
      }
      files.set(filePath, String(contents));
    },
  };
}

test("external HTML paths accept absolute html/htm paths and file URLs only", () => {
  assert.equal(
    normalizeExternalHtmlPath("/Users/demo/Qoder 输出/页面.HTML", { platform: "darwin" }),
    "/Users/demo/Qoder 输出/页面.HTML",
  );
  assert.equal(
    normalizeExternalHtmlPath(
      "file:///Users/demo/Qoder%20%E8%BE%93%E5%87%BA/page.htm",
      { platform: "darwin" },
    ),
    "/Users/demo/Qoder 输出/page.htm",
  );
  assert.throws(
    () => normalizeExternalHtmlPath("relative/page.html", { platform: "darwin" }),
    /绝对路径/u,
  );
  assert.throws(
    () => normalizeExternalHtmlPath("/Users/demo/page.txt", { platform: "darwin" }),
    /\.html 或 \.htm/u,
  );
});

test("external argv parsing ignores Chromium arguments and deduplicates HTML paths", () => {
  assert.deepEqual(
    externalHtmlPathsFromArgv([
      "/Applications/PageRoot.app/Contents/MacOS/PageRoot",
      "--original-process-start-time=123",
      "/Users/demo/report.html",
      "/Users/demo/notes.txt",
      "/Users/demo/report.html",
      "/Users/demo/archive.htm",
    ], { platform: "darwin" }),
    ["/Users/demo/report.html", "/Users/demo/archive.htm"],
  );
});

test("native external-open failures use stable product errors instead of raw paths", () => {
  const rawFilesystemFailure = Object.assign(
    new Error("ENOENT: no such file or directory, lstat '/Users/demo/客户页面.html'"),
    { code: "ENOENT" },
  );

  assert.deepEqual(externalOpenFailurePresentation(rawFilesystemFailure), {
    code: "EXTERNAL_OPEN_FAILED",
    message: "无法读取这个 HTML 文件。请确认文件仍存在且具有访问权限。",
  });
  assert.doesNotMatch(
    externalOpenFailurePresentation(rawFilesystemFailure).message,
    /ENOENT|客户页面|\/Users/u,
  );
  assert.deepEqual(
    externalOpenFailurePresentation(new ProjectFileError(
      "SOURCE_NOT_FOUND",
      "源 HTML 已不存在。",
      { sourcePath: "/Users/demo/客户页面.html" },
    )),
    {
      code: "SOURCE_NOT_FOUND",
      message: "源 HTML 已不存在。",
    },
  );
});

test("external opens received after committed shutdown are handed to the next launch in order", () => {
  const filesystem = createMemoryFilesystem();
  const handoffPath = "/Users/demo/Library/Application Support/PageRoot/external-open-handoff.json";
  const createHandoff = () => createExternalFileOpenExitHandoff({
    handoffPath,
    platform: "darwin",
    filesystem,
    createTemporaryPath: () => `${handoffPath}.tmp`,
  });

  const exiting = createHandoff();
  assert.equal(
    exiting.defer("/Users/demo/Qoder 输出/first.html"),
    "/Users/demo/Qoder 输出/first.html",
  );
  assert.equal(
    exiting.defer("/Users/demo/Qoder 输出/latest.htm"),
    "/Users/demo/Qoder 输出/latest.htm",
    "the newest request replaces an earlier unconsumed handoff",
  );

  const restarted = createHandoff();
  assert.equal(restarted.take(), "/Users/demo/Qoder 输出/first.html");
  assert.equal(restarted.take(), "/Users/demo/Qoder 输出/latest.htm");
  assert.equal(restarted.take(), null, "a consumed handoff cannot replay twice");
  assert.equal(filesystem.files.size, 0, "the one-shot record is removed after claim");
});

test("an invalid shutdown handoff is discarded before it gains file authority", () => {
  const filesystem = createMemoryFilesystem();
  const handoffPath = "/Users/demo/Library/Application Support/PageRoot/external-open-handoff.json";
  filesystem.files.set(handoffPath, JSON.stringify({
    version: 1,
    sourcePath: "/Users/demo/not-html.txt",
  }));
  const handoff = createExternalFileOpenExitHandoff({
    handoffPath,
    platform: "darwin",
    filesystem,
    createTemporaryPath: () => `${handoffPath}.tmp`,
  });

  assert.equal(handoff.take(), null);
  assert.equal(filesystem.files.has(handoffPath), false);
});

test("external open mailbox preserves every opaque request in FIFO order", () => {
  let nextId = 0;
  const mailbox = createExternalFileOpenMailbox({
    createRequestId: () => `external_${++nextId}`,
    platform: "darwin",
  });
  const first = mailbox.publish("/Users/demo/first.html");
  const second = mailbox.publish("/Users/demo/second.htm");

  assert.equal(first.requestId, "external_1");
  assert.deepEqual(mailbox.peek(), first);
  assert.equal(mailbox.consume(second.requestId), null);
  assert.deepEqual(mailbox.consume(first.requestId), first);
  assert.deepEqual(mailbox.peek(), second);
  assert.deepEqual(mailbox.consume(second.requestId), second);
  assert.equal(mailbox.peek(), null);
  assert.equal(mailbox.consume(second.requestId), null);
});

test("external open mailbox holds its head until the renderer explicitly acknowledges it", async () => {
  let nextId = 0;
  const mailbox = createExternalFileOpenMailbox({
    createRequestId: () => `external_${++nextId}`,
    platform: "darwin",
  });
  const first = mailbox.publish("/Users/demo/first.html");
  const second = mailbox.publish("/Users/demo/second.html");
  let opens = 0;
  const opening = mailbox.begin(first.requestId, async () => {
    opens += 1;
    return { openKind: "confirmation", requestId: first.requestId };
  });
  assert.ok(opening);
  assert.equal(mailbox.begin(second.requestId, async () => null), null);
  assert.deepEqual(await opening, { openKind: "confirmation", requestId: first.requestId });
  assert.equal(opens, 1);
  assert.deepEqual(mailbox.peek(), first, "preparing a confirmation must not consume the head");
  assert.deepEqual(
    await mailbox.begin(first.requestId, async () => { opens += 1; }),
    { openKind: "confirmation", requestId: first.requestId },
    "a renderer retry reuses the in-flight result",
  );
  assert.equal(opens, 1);
  assert.equal(mailbox.acknowledge(second.requestId), null);
  assert.deepEqual(mailbox.acknowledge(first.requestId), first);
  assert.deepEqual(mailbox.peek(), second);
});

test("external open mailbox serializes accepted active-project mutations", async () => {
  let nextId = 0;
  const mailbox = createExternalFileOpenMailbox({
    createRequestId: () => `external_${++nextId}`,
    platform: "darwin",
  });
  const first = mailbox.publish("/Users/demo/first.html");
  let releaseFirst;
  const firstStarted = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstStarted;
  const firstHasStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  let activeOperations = 0;
  const order = [];
  const activate = async (request) => {
    activeOperations += 1;
    assert.equal(activeOperations, 1, "active-project mutations must not overlap");
    order.push(`start:${request.requestId}`);
    if (request.requestId === first.requestId) {
      markFirstStarted();
      await firstStarted;
    }
    order.push(`finish:${request.requestId}`);
    activeOperations -= 1;
    return request.sourcePath;
  };

  const firstOperation = mailbox.accept(first.requestId, activate);
  assert.ok(firstOperation);
  await firstHasStarted;
  const second = mailbox.publish("/Users/demo/second.htm");
  const secondOperation = mailbox.accept(second.requestId, activate);
  assert.ok(secondOperation);
  assert.deepEqual(order, [`start:${first.requestId}`]);

  releaseFirst();
  assert.deepEqual(
    await Promise.all([firstOperation, secondOperation]),
    [first.sourcePath, second.sourcePath],
  );
  assert.deepEqual(order, [
    `start:${first.requestId}`,
    `finish:${first.requestId}`,
    `start:${second.requestId}`,
    `finish:${second.requestId}`,
  ]);
});
