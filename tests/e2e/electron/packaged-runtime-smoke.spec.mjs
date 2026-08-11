import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

import {
  activateNativeEdit,
  caseSelector,
  currentEditorFrame,
  fixtureBuffer,
  keyShortcut,
  productRoot,
  requestExportCurrentHtml,
  replaceEditableIslandBytes,
  setTextSelection,
  withBomAndCrLf,
} from "../browser/pageroot-driver.mjs";

const packageVersion = JSON.parse(
  readFileSync(path.join(productRoot, "package.json"), "utf8"),
).version;

function packagedExecutable() {
  const appPath = process.env.PAGEROOT_PACKAGED_APP_PATH;
  if (!appPath || !path.isAbsolute(appPath) || path.extname(appPath) !== ".app") {
    throw new Error("PAGEROOT_PACKAGED_APP_PATH must name the absolute packaged PageRoot.app path.");
  }
  const executable = path.join(appPath, "Contents/MacOS/PageRoot");
  if (!existsSync(executable)) throw new Error(`Packaged PageRoot executable is missing: ${executable}`);
  return executable;
}

function seedActiveDiskProject(isolatedUserData, sourcePath) {
  writeFileSync(
    path.join(isolatedUserData, "html-projects.json"),
    JSON.stringify({
      version: 1,
      activePath: sourcePath,
      recent: [{
        path: sourcePath,
        name: path.basename(sourcePath),
        lastOpenedAt: Date.now(),
      }],
    }),
    "utf8",
  );
}

async function launchPackaged(isolatedUserData) {
  const electronApp = await electron.launch({
    executablePath: packagedExecutable(),
    cwd: productRoot,
    env: {
      ...process.env,
      PAGEROOT_E2E: "1",
      PAGEROOT_E2E_USER_DATA_DIR: isolatedUserData,
      HTML_AI_WORKSPACE: path.join(isolatedUserData, "workspace"),
    },
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await expect(page).toHaveTitle("源页");
  return { electronApp, page };
}

async function bridgeJson(page, pathname, {
  sourcePath,
  body,
} = {}) {
  const runtime = await page.evaluate(() => window.htmlAIRuntime);
  const url = new URL(`http://127.0.0.1:${runtime.bridgePort}${pathname}`);
  if (sourcePath) url.searchParams.set("sourcePath", sourcePath);
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      "x-html-ai-bridge-token": runtime.bridgeAuthToken,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Packaged Bridge ${pathname} failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }
  return payload;
}

async function closePackagedGracefully(electronApp, page) {
  const mainRendererUrl = page?.url();
  if (!mainRendererUrl) {
    throw new Error("PageRoot main renderer URL is unavailable for graceful close.");
  }
  const closed = electronApp.waitForEvent("close", { timeout: 35_000 });
  const requested = await electronApp.evaluate(({ BrowserWindow }, rendererUrl) => {
    const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
      candidate.webContents.getURL() === rendererUrl
    ));
    if (!mainWindow) return false;
    mainWindow.close();
    return true;
  }, mainRendererUrl);
  if (!requested) {
    throw new Error("PageRoot main BrowserWindow was unavailable for graceful close.");
  }
  await closed;
}

function removeIsolatedDirectory(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("pageroot-native-e2e-")
  ) {
    throw new Error(`Refusing to remove non-E2E directory: ${directory}`);
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

test("packaged PageRoot preserves outside-island bytes and reconciles draft revision before close", async () => {
  test.setTimeout(120_000);
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-packaged-"));
  const sourcePathAlias = path.join(isolatedUserData, "packaged-source.html");
  const exportedPath = path.join(isolatedUserData, "packaged-export.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "PackagedRuntime_OK_源页";
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  const expected = replaceEditableIslandBytes(
    original,
    "source-fidelity",
    `<span title='single-quoted' data-order-b="2" data-order-a='1'>${replacement}</span>`,
  );
  writeFileSync(sourcePathAlias, original);
  const sourcePath = realpathSync(sourcePathAlias);
  seedActiveDiskProject(isolatedUserData, sourcePath);
  let electronApp = null;
  try {
    let launched = await launchPackaged(isolatedUserData);
    electronApp = launched.electronApp;
    let page = launched.page;
    const runtime = await page.evaluate(() => window.htmlAIRuntime);
    expect(runtime?.appVersion).toBe(packageVersion);
    await electronApp.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: destination,
      });
    }, exportedPath);

    await expect.poll(
      async () => (await page.evaluate(
        () => window.htmlAIProjects?.getActiveProject(),
      ))?.sourcePath,
      { timeout: 30_000 },
    ).toBe(sourcePath);
    await expect(page.locator("main.workbench"))
      .toHaveAttribute("data-project-state", "ready", { timeout: 30_000 });
    let frame = await currentEditorFrame(page);
    await frame.waitForFunction(
      (selector) => Boolean(document.querySelector(selector)),
      caseSelector("source-fidelity"),
    );
    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await page.keyboard.insertText(replacement);
    await page.keyboard.press(keyShortcut("S"));
    await expect.poll(
      () => readFileSync(sourcePath).equals(expected),
      { timeout: 30_000 },
    ).toBe(true);
    await requestExportCurrentHtml(page);
    await expect.poll(() => existsSync(exportedPath), { timeout: 15_000 }).toBe(true);
    const exported = readFileSync(exportedPath);
    expect(exported.equals(expected), "packaged export must differ only at the authorized bytes").toBe(true);

    const opened = await bridgeJson(page, "/workspace", { sourcePath });
    const staleRendererRevision = opened.runtimeState.draft.draftRevision;
    const external = await bridgeJson(page, "/draft", {
      body: {
        operationId: "draftop_packaged_external_delete_0001",
        sourcePath,
        projectId: opened.projectId,
        documentId: opened.documentId,
        expectedDraftRevision: staleRendererRevision,
        comments: [],
        changeEvents: [],
        deletedCommentIds: ["comment_packaged_external_deleted"],
      },
    });
    expect(external.activeDraft.draftRevision).toBe(staleRendererRevision + 1);

    frame = await currentEditorFrame(page);
    await frame.waitForFunction(
      (selector) => Boolean(document.querySelector(selector)),
      caseSelector("source-fidelity"),
    );
    await frame.locator(caseSelector("source-fidelity")).click();
    const toolbar = page.getByRole("toolbar", { name: /编辑/u });
    await toolbar.getByRole("button", { name: /留评论/u }).click();
    await page.getByRole("textbox", { name: "评论内容" })
      .fill("打包环境 Revision 自动合并");
    await page.getByRole("button", { name: "评论", exact: true }).click();

    const expectedRevision = staleRendererRevision + 2;
    await expect.poll(async () => {
      const workspace = await bridgeJson(page, "/workspace", { sourcePath });
      return {
        revision: workspace.runtimeState.draft.draftRevision,
        comments: workspace.runtimeState.draft.comments.map(
          (comment) => comment.text,
        ),
        changeEventCount: workspace.runtimeState.draft.changeEvents.length,
        changeEventsUseCanonicalIdentity: workspace.runtimeState.draft.changeEvents
          .every((event) => (
            Object.hasOwn(event, "basedOnVersionId")
            && !Object.hasOwn(event, "baseVersionId")
          )),
        deletedCommentIds: workspace.runtimeState.draft.deletedCommentIds,
      };
    }, { timeout: 30_000 }).toEqual({
      revision: expectedRevision,
      comments: ["打包环境 Revision 自动合并"],
      changeEventCount: 1,
      changeEventsUseCanonicalIdentity: true,
      deletedCommentIds: ["comment_packaged_external_deleted"],
    });

    await closePackagedGracefully(electronApp, page);
    electronApp = null;

    launched = await launchPackaged(isolatedUserData);
    electronApp = launched.electronApp;
    page = launched.page;
    await expect.poll(
      async () => (await page.evaluate(
        () => window.htmlAIProjects?.getActiveProject(),
      ))?.sourcePath,
      { timeout: 30_000 },
    ).toBe(sourcePath);
    await expect(page.locator("main.workbench"))
      .toHaveAttribute("data-project-state", "ready", { timeout: 30_000 });
    const reopenedBeforeClose = await bridgeJson(page, "/workspace", { sourcePath });
    expect(reopenedBeforeClose.runtimeState.draft.draftRevision).toBe(expectedRevision);
    await closePackagedGracefully(electronApp, page);
    electronApp = null;

    launched = await launchPackaged(isolatedUserData);
    electronApp = launched.electronApp;
    page = launched.page;
    const reopenedAfterClose = await bridgeJson(page, "/workspace", { sourcePath });
    expect(reopenedAfterClose.runtimeState.draft.draftRevision).toBe(expectedRevision);
    expect(reopenedAfterClose.runtimeState.draft.deletedCommentIds)
      .toEqual(["comment_packaged_external_deleted"]);
    expect(reopenedAfterClose.runtimeState.draft.comments.map((comment) => comment.text))
      .toEqual(["打包环境 Revision 自动合并"]);
    expect(reopenedAfterClose.runtimeState.draft.changeEvents).toHaveLength(1);
    expect(reopenedAfterClose.runtimeState.draft.changeEvents[0])
      .toHaveProperty("basedOnVersionId");
    expect(reopenedAfterClose.runtimeState.draft.changeEvents[0])
      .not.toHaveProperty("baseVersionId");
  } finally {
    if (electronApp) {
      const electronProcess = electronApp.process();
      const closed = electronApp.waitForEvent("close", { timeout: 10_000 }).catch(() => null);
      await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await closed;
      if (electronProcess.exitCode === null && electronProcess.signalCode === null) {
        electronProcess.kill("SIGKILL");
      }
    }
    removeIsolatedDirectory(isolatedUserData);
  }
});
