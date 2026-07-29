import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import {
  createOpenInDefaultBrowserOperation,
} from "../desktop/open-in-default-browser.mjs";
import {
  assertTrustedRendererEvent,
} from "../desktop/project-ipc-security.mjs";
import { ProjectFileError } from "../desktop/project-files.mjs";

function createHarness({
  assertKnownProjectPath = async () => {},
  inspectHtmlFile = async () => {},
} = {}) {
  const openedUrls = [];
  const operation = createOpenInDefaultBrowserOperation({
    assertKnownProjectPath,
    inspectHtmlFile,
    openExternal: async (sourceUrl) => {
      openedUrls.push(sourceUrl);
    },
  });
  return { openedUrls, operation };
}

test("the default-browser operation launches one validated known HTML file URL", async () => {
  const sourcePath = path.join(
    os.tmpdir(),
    "pageroot-default-browser-test",
    "页面 A.html",
  );
  const checks = [];
  const { openedUrls, operation } = createHarness({
    assertKnownProjectPath: async (candidate) => {
      checks.push(["known", candidate]);
    },
    inspectHtmlFile: async (candidate) => {
      checks.push(["file", candidate]);
    },
  });

  assert.deepEqual(await operation(sourcePath), {
    sourcePath: path.resolve(sourcePath),
  });
  assert.deepEqual(checks, [
    ["known", path.resolve(sourcePath)],
    ["file", path.resolve(sourcePath)],
  ]);
  assert.deepEqual(openedUrls, [pathToFileURL(path.resolve(sourcePath)).href]);
});

test("malformed and non-HTML paths fail before project or shell authority", async () => {
  let knownChecks = 0;
  let fileChecks = 0;
  const { openedUrls, operation } = createHarness({
    assertKnownProjectPath: async () => {
      knownChecks += 1;
    },
    inspectHtmlFile: async () => {
      fileChecks += 1;
    },
  });

  for (const sourcePath of [
    null,
    "",
    "invalid\0path.html",
    path.join(os.tmpdir(), "report.txt"),
  ]) {
    await assert.rejects(() => operation(sourcePath), TypeError);
  }
  assert.equal(knownChecks, 0);
  assert.equal(fileChecks, 0);
  assert.deepEqual(openedUrls, []);
});

test("unknown projects and unsafe HTML filesystem entries never launch the shell", async () => {
  let fileChecks = 0;
  const unknown = createHarness({
    assertKnownProjectPath: async (sourcePath) => {
      throw new ProjectFileError(
        "UNKNOWN_SOURCE",
        "只能打开已经由工作台打开的 HTML 文件。",
        { sourcePath },
      );
    },
    inspectHtmlFile: async () => {
      fileChecks += 1;
    },
  });

  await assert.rejects(
    () => unknown.operation(path.join(os.tmpdir(), "unknown.html")),
    (error) => error?.code === "UNKNOWN_SOURCE",
  );
  assert.equal(fileChecks, 0);
  assert.deepEqual(unknown.openedUrls, []);

  const unsafe = createHarness({
    inspectHtmlFile: async (sourcePath) => {
      throw new ProjectFileError(
        "UNSAFE_SOURCE",
        "只能打开普通 HTML 文件，不能打开文件夹或符号链接。",
        { sourcePath },
      );
    },
  });
  await assert.rejects(
    () => unsafe.operation(path.join(os.tmpdir(), "unsafe.html")),
    (error) => error?.code === "UNSAFE_SOURCE",
  );
  assert.deepEqual(unsafe.openedUrls, []);
});

test("untrusted renderer senders and frames are rejected before shell launch", async () => {
  const trustedUrl =
    "file:///Applications/PageRoot.app/Contents/Resources/app.asar/desktop/renderer/index.html";
  const trustedFrame = {
    url: trustedUrl,
  };
  const webContents = { mainFrame: trustedFrame };
  const mainWindow = { webContents };
  const { openedUrls, operation } = createHarness();
  const invoke = async (event) => {
    assertTrustedRendererEvent(event, {
      mainWindow,
      isTrustedRendererUrl: (url) => url === trustedUrl,
    });
    return operation(path.join(os.tmpdir(), "known.html"));
  };

  const untrustedEvents = [
    {
      sender: {},
      senderFrame: trustedFrame,
    },
    {
      sender: webContents,
      senderFrame: { url: trustedFrame.url },
    },
  ];
  for (const event of untrustedEvents) {
    await assert.rejects(
      () => invoke(event),
      (error) => error?.code === "UNAUTHORIZED_FILE_REQUEST",
    );
  }
  trustedFrame.url = "https://example.invalid/untrusted";
  await assert.rejects(
    () => invoke({
      sender: webContents,
      senderFrame: trustedFrame,
    }),
    (error) => error?.code === "UNAUTHORIZED_FILE_REQUEST",
  );
  assert.deepEqual(openedUrls, []);
});
