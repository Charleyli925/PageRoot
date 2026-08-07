import assert from "node:assert/strict";
import test from "node:test";

import {
  createExternalFileOpenMailbox,
  externalHtmlPathsFromArgv,
  normalizeExternalHtmlPath,
} from "../desktop/external-file-open.mjs";

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

test("external open mailbox authorizes only its latest opaque request", () => {
  let nextId = 0;
  const mailbox = createExternalFileOpenMailbox({
    createRequestId: () => `external_${++nextId}`,
    platform: "darwin",
  });
  const first = mailbox.publish("/Users/demo/first.html");
  const second = mailbox.publish("/Users/demo/second.htm");

  assert.equal(first.requestId, "external_1");
  assert.deepEqual(mailbox.peek(), second);
  assert.equal(mailbox.consume(first.requestId), null);
  assert.deepEqual(mailbox.consume(second.requestId), second);
  assert.equal(mailbox.peek(), null);
  assert.equal(mailbox.consume(second.requestId), null);
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
