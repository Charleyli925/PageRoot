import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
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
  documentToken,
  fixtureBuffer,
  geometrySnapshot,
  installInputRecorder,
  keyShortcut,
  loadFixture,
  nativeEditingState,
  productRoot,
  recordedInputEvents,
  replaceUniqueBytes,
  setTextSelection,
  withBomAndCrLf,
} from "../browser/pageroot-driver.mjs";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");

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

async function launchPageRoot(options = {}) {
  const isolatedUserData = options.isolatedUserData
    || mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  mkdirSync(isolatedUserData, { recursive: true });
  if (options.activeSourcePath) {
    seedActiveDiskProject(isolatedUserData, options.activeSourcePath);
  }
  const electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [path.join(productRoot, "desktop/main.mjs")],
    cwd: productRoot,
    env: {
      ...process.env,
      PAGEROOT_E2E: "1",
      PAGEROOT_E2E_USER_DATA_DIR: isolatedUserData,
      HTML_AI_WORKSPACE: path.join(isolatedUserData, "workspace"),
    },
  });
  const page = await electronApp.firstWindow();
  await electronApp.evaluate(({ app, BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window?.webContents.setBackgroundThrottling(false);
    window?.show();
    app.focus({ steal: true });
    window?.focus();
  });
  await page.bringToFront();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.visibilityState === "visible");
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  return { electronApp, page, isolatedUserData };
}

function removeValidatedTemporaryDirectory(directoryPath, namePrefix) {
  const resolved = path.resolve(directoryPath);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith(namePrefix)
  ) {
    throw new Error(`Refusing to remove non-E2E temporary data: ${directoryPath}`);
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

function removeIsolatedUserData(isolatedUserData) {
  removeValidatedTemporaryDirectory(isolatedUserData, "pageroot-native-e2e-");
}

async function stopPageRoot(electronApp, isolatedUserData, { cleanup = true } = {}) {
  const electronProcess = electronApp.process();
  const applicationClosed = electronApp
    .waitForEvent("close", { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  const waitForExit = (timeout) => new Promise((resolve) => {
    if (electronProcess.exitCode !== null || electronProcess.signalCode !== null) {
      resolve(true);
      return;
    }
    let timer = null;
    const onExit = () => {
      if (timer) clearTimeout(timer);
      resolve(true);
    };
    timer = setTimeout(() => {
      electronProcess.off("exit", onExit);
      resolve(false);
    }, timeout);
    electronProcess.once("exit", onExit);
  });

  const exitRequest = electronApp
    .evaluate(({ app }) => app.exit(0))
    .catch(() => {});
  await Promise.race([
    exitRequest,
    new Promise((resolve) => setTimeout(resolve, 1_000)),
  ]);
  if (!await waitForExit(3_000)) {
    electronProcess.kill("SIGKILL");
    await waitForExit(3_000);
  }
  await applicationClosed;
  if (cleanup) removeIsolatedUserData(isolatedUserData);
}

async function closePageRootGracefully(electronApp) {
  const closed = electronApp.waitForEvent("close", { timeout: 15_000 });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await closed;
}

async function waitForProjectReady(page, timeout = 30_000) {
  await expect.poll(async () => {
    await page.bringToFront();
    const state = await page.locator("main.workbench").getAttribute("data-project-state");
    if (state === "ready") return state;
    const stage = await page.evaluate(() => window.__PAGEROOT_HYDRATION_STAGE__);
    return `${state}:${stage || "unmarked"}`;
  }, { timeout }).toBe("ready");
}

async function loadedDiskFrame(page, sourcePath, caseId) {
  await expect.poll(
    async () => (await page.evaluate(() => window.htmlAIProjects?.getActiveProject()))?.sourcePath,
    { timeout: 15_000 },
  ).toBe(realpathSync(sourcePath));
  await waitForProjectReady(page);
  await expect(page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "项目", exact: true }))
    .toBeEnabled({ timeout: 30_000 });
  await expect(page.getByRole("button", { name: "全局评论", exact: true }))
    .toBeEnabled({ timeout: 30_000 });
  await expect(page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  await editor.waitFor({ state: "visible" });
  const editorHandle = await editor.elementHandle();
  await page.waitForFunction(
    (element) => element?.getAttribute("data-render-verified") === "true",
    editorHandle,
  );
  const iframe = editor.locator('iframe[title*="HTML"]');
  const iframeHandle = await iframe.elementHandle();
  const frame = await iframeHandle?.contentFrame();
  if (!frame) throw new Error("PageRoot Electron canvas did not expose its edit frame.");
  await frame.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)),
    caseSelector(caseId),
  );
  return { editor, frame };
}

async function waitForFreshDiskFrame(page, previousDocumentToken, caseId) {
  await expect.poll(async () => {
    try {
      return await documentToken(page);
    } catch {
      return previousDocumentToken;
    }
  }).not.toBe(previousDocumentToken);
  const frame = await currentEditorFrame(page);
  await frame.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)),
    caseSelector(caseId),
  );
  await expect.poll(() => nativeEditingState(page, caseId)).toMatchObject({
    targetIsActive: true,
    contenteditable: "plaintext-only",
    isContentEditable: true,
    activeCase: caseId,
    selectionInside: true,
  });
  return frame;
}

async function rememberCurrentNativeHost(page, caseId) {
  const iframe = page
    .getByTestId("html-canvas-editor")
    .filter({ visible: true })
    .first()
    .locator('iframe[title*="HTML"]');
  await iframe.evaluate((frameElement, selector) => {
    window.__PAGEROOT_ELECTRON_RETIRED_NATIVE_HOST__ =
      frameElement.contentDocument?.querySelector(selector) || null;
  }, caseSelector(caseId));
}

async function retiredNativeHostState(page) {
  return page.evaluate(() => {
    const host = window.__PAGEROOT_ELECTRON_RETIRED_NATIVE_HOST__;
    if (!host || host.nodeType !== 1) {
      throw new Error("Electron History Fence lost the retired native host reference.");
    }
    const state = {
      contenteditable: host.getAttribute("contenteditable"),
      editingMarker: host.getAttribute("data-html-canvas-editing"),
    };
    delete window.__PAGEROOT_ELECTRON_RETIRED_NATIVE_HOST__;
    return state;
  });
}

async function expectCheckpointPersisted(page, afterRevision) {
  const indicator = page.locator("[data-persist-state]").first();
  await expect.poll(async () => indicator.evaluate((element, minimumRevision) => {
    const editRevision = Number(element.getAttribute("data-edit-revision"));
    const persistedRevision = Number(
      element.getAttribute("data-persisted-revision"),
    );
    return {
      idle: element.getAttribute("data-persist-state") === "idle",
      synchronized:
        Number.isSafeInteger(editRevision)
        && editRevision > minimumRevision
        && editRevision === persistedRevision,
    };
  }, afterRevision), { timeout: 15_000 }).toEqual({ idle: true, synchronized: true });
  return Number(await indicator.getAttribute("data-persisted-revision"));
}

async function replayApplePinyinStyledWrapperCommit(frame, caseId) {
  const target = frame.locator(caseSelector(caseId));
  const originalText = await target.textContent();
  const wordStart = originalText.indexOf("Word");
  if (wordStart < 0) throw new Error("Apple Pinyin fixture word is missing.");
  await setTextSelection(frame, caseId, wordStart, wordStart + 4);
  await target.evaluate((element) => {
    const dispatchCompositionInput = (data) => {
      element.dispatchEvent(new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: false,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      element.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data,
        inputType: "insertCompositionText",
        isComposing: true,
      }));
    };
    const authoredEm = element.querySelector("em");
    if (!(authoredEm instanceof HTMLElement)) {
      throw new Error("Authored em wrapper is missing.");
    }
    element.dispatchEvent(new CompositionEvent("compositionstart", {
      bubbles: true,
      data: "Word",
    }));
    authoredEm.textContent = "ni";
    dispatchCompositionInput("ni");
    const temporaryItalic = document.createElement("i");
    temporaryItalic.textContent = "ni hao";
    authoredEm.replaceWith(temporaryItalic);
    dispatchCompositionInput("ni hao");
    temporaryItalic.textContent = "你好";
    dispatchCompositionInput("你好");
    element.dispatchEvent(new CompositionEvent("compositionend", {
      bubbles: true,
      data: "你好",
    }));
  });
}

test("Electron first launch registers the welcome HTML and sends its comment to Qoder", async () => {
  const launched = await launchPageRoot();
  const welcomePath = path.join(launched.isolatedUserData, "欢迎来到源页.html");
  const welcomeLogoPath = path.join(
    launched.isolatedUserData,
    "brand-logo.png",
  );
  const workspace = path.join(launched.isolatedUserData, "workspace");
  try {
    const canonicalWelcomePath = path.join(
      realpathSync(launched.isolatedUserData),
      "欢迎来到源页.html",
    );
    await waitForProjectReady(launched.page);
    await expect.poll(
      async () => (
        await launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
      )?.sourcePath,
      { timeout: 20_000 },
    ).toBe(canonicalWelcomePath);
    await expect(launched.page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "项目", exact: true }))
      .toBeEnabled({ timeout: 30_000 });
    await expect(launched.page.getByRole("button", { name: "全局评论", exact: true }))
      .toBeEnabled({ timeout: 30_000 });
    await expect(launched.page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
    await expect.poll(() => (
      existsSync(welcomePath)
      && existsSync(welcomeLogoPath)
      && existsSync(path.join(workspace, "project-registry.json"))
    )).toBe(true);

    const registry = JSON.parse(
      readFileSync(path.join(workspace, "project-registry.json"), "utf8"),
    );
    const projectIds = Object.keys(registry.projects);
    expect(projectIds).toHaveLength(1);
    expect(registry.projects[projectIds[0]].sourcePath).toBe(canonicalWelcomePath);
    expect(existsSync(
      path.join(workspace, "projects", projectIds[0], "versions", "ver_0001", "committed.json"),
    )).toBe(true);

    const editor = launched.page.getByTestId("html-canvas-editor")
      .filter({ visible: true })
      .first();
    await editor.waitFor({ state: "visible" });
    const editorHandle = await editor.elementHandle();
    await launched.page.waitForFunction(
      (element) => element?.getAttribute("data-render-verified") === "true",
      editorHandle,
    );
    const welcomeFrame = await currentEditorFrame(launched.page);
    await expect.poll(() =>
      welcomeFrame.locator('img[alt="源页 Logo"]').evaluate(
        (image) => image.complete && image.naturalWidth > 0,
      )
    ).toBe(true);
    await launched.electronApp.evaluate(({ clipboard }) => clipboard.clear());
    await launched.page.getByRole("button", { name: "全局评论" }).click();
    await launched.page.getByRole("textbox", { name: "评论内容" })
      .fill("把欢迎页主标题改得更简洁。");
    await launched.page.getByRole("button", { name: "评论", exact: true }).click();
    await launched.page.getByRole("button", { name: /发送至 Qoder/u }).click();
    await expect(
      launched.page.getByText("等待 QoderWork 返回修改结果", { exact: true }),
    ).toBeVisible();

    let promptPath = "";
    await expect.poll(async () => {
      const copied = await launched.electronApp.evaluate(
        ({ clipboard }) => clipboard.readText(),
      );
      promptPath = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u)?.[1] || "";
      return Boolean(promptPath && existsSync(promptPath));
    }, { timeout: 20_000 }).toBe(true);
    const changeRequest = JSON.parse(
      readFileSync(path.join(path.dirname(promptPath), "change-request.json"), "utf8"),
    );
    expect(changeRequest.projectId).toBe(projectIds[0]);
    expect(changeRequest.requirements.instructions[0].text)
      .toBe("把欢迎页主标题改得更简洁。");
  } finally {
    await stopPageRoot(
      launched.electronApp,
      launched.isolatedUserData,
    );
  }
});

test("Electron uses the authored DOM caret, Selection and beforeinput", async () => {
  const { electronApp, page, isolatedUserData } = await launchPageRoot();
  try {
    const { frame } = await loadFixture(page, "complex-layout.html");
    const initialDocument = await documentToken(frame);
    await activateNativeEdit(frame, "heading-inline");
    expect(await nativeEditingState(frame, "heading-inline")).toMatchObject({
      contenteditable: "plaintext-only",
      isContentEditable: true,
      activeIsLegacySurface: false,
      legacySurfaceCount: 0,
    });
    await installInputRecorder(frame);
    await setTextSelection(frame, "heading-inline", 3, 9);
    await page.keyboard.insertText("Electron原位");

    expect(await documentToken(frame)).toBe(initialDocument);
    expect(await frame.locator(caseSelector("heading-inline")).textContent()).toContain("Electron原位");
    const events = await recordedInputEvents(frame);
    expect(events.some(({ type, inputType }) => type === "beforeinput" && inputType === "insertText")).toBe(true);
    expect(events.some(({ type }) => type === "input")).toBe(true);
  } finally {
    await stopPageRoot(electronApp, isolatedUserData);
  }
});

test("Electron proves the controlled and observer-guarded fallback lanes", async () => {
  const { electronApp, page, isolatedUserData } = await launchPageRoot();
  try {
    const { editor, frame } = await loadFixture(page, "complex-layout.html");
    const controlledCase = "collapsed-whitespace-copy";
    await frame.locator(caseSelector(controlledCase)).scrollIntoViewIfNeeded();
    const beforeGeometry = await geometrySnapshot(frame, controlledCase);
    const originalText = await frame.locator(caseSelector(controlledCase)).textContent();
    const controlledTarget = await activateNativeEdit(frame, controlledCase);
    await expect(controlledTarget).toHaveAttribute("contenteditable", "true");
    await expect(editor).toHaveAttribute("data-native-host-mode", "true");
    expect(await geometrySnapshot(frame, controlledCase)).toEqual(beforeGeometry);

    await setTextSelection(frame, controlledCase, 0, 4);
    await electronApp.evaluate(({ clipboard }, text) => {
      clipboard.writeText(text);
    }, "<b>Electron纯文字</b>");
    await page.keyboard.press(keyShortcut("V"));
    await expect.poll(() => controlledTarget.textContent())
      .toContain("<b>Electron纯文字</b>");
    expect(await controlledTarget.locator("b").count()).toBe(0);
    await expect.poll(() => editor.getAttribute("data-undo-depth"))
      .toBe("1");

    await page.keyboard.press(keyShortcut("Z"));
    await expect.poll(() => editor.getAttribute("data-undo-depth"))
      .toBe("0");
    await expect.poll(() => (
      page
        .getByTestId("html-canvas-editor")
        .filter({ visible: true })
        .first()
        .locator('iframe[title*="HTML"]')
        .contentFrame()
        .locator(caseSelector(controlledCase))
        .textContent()
    )).toBe(originalText);

    const guardedCase = "display-contents-copy";
    await activateNativeEdit(page, guardedCase);
    await expect(editor).toHaveAttribute(
      "data-native-event-delivery-mode",
      "observer-guarded",
    );
    await setTextSelection(page, guardedCase, 0);
    await page.keyboard.insertText("电");
    await expect.poll(() => (
      page
        .getByTestId("html-canvas-editor")
        .filter({ visible: true })
        .first()
        .locator('iframe[title*="HTML"]')
        .contentFrame()
        .locator(caseSelector(guardedCase))
        .textContent()
    )).toContain("电观察器保护");
  } finally {
    await stopPageRoot(electronApp, isolatedUserData);
  }
});

test("PROJECT.md read failure never becomes editable data and recovers in place", async () => {
  test.setTimeout(60_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "project-rules-recovery.html");
  writeFileSync(sourcePath, fixtureBuffer("complex-layout.html"));
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    await loadedDiskFrame(launched.page, sourcePath, "list-item");

    await launched.page.getByRole("button", { name: "项目", exact: true }).click();
    await launched.page.getByText("项目资料", { exact: true }).click();
    const projectRules = launched.page.getByRole("button", {
      name: /项目长期规则/u,
    });
    await expect(projectRules).toBeEnabled({ timeout: 20_000 });

    await launched.page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      let rejectNextProjectRulesRead = true;
      window.fetch = (input, init) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          window.location.href,
        );
        if (
          rejectNextProjectRulesRead
          && url.pathname === "/file"
          && url.searchParams.get("path") === "PROJECT.md"
        ) {
          rejectNextProjectRulesRead = false;
          return Promise.resolve(new Response(JSON.stringify({
            ok: false,
            error: { message: "测试注入：项目规则暂时不可读。" },
          }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }));
        }
        return originalFetch(input, init);
      };
    });

    await projectRules.click();
    const failure = launched.page.getByRole("alert")
      .filter({ hasText: "内容没有读取成功" });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText("项目规则暂时不可读");
    await expect(launched.page.getByRole("textbox", { name: "项目长期规则" }))
      .toHaveCount(0);
    await expect(failure.getByRole("button", { name: "重试读取" })).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "返回项目" })).toBeVisible();

    await failure.getByRole("button", { name: "重试读取" }).click();
    const editor = launched.page.getByRole("textbox", { name: "项目长期规则" });
    await expect(editor).toBeVisible();
    await expect(editor).not.toHaveValue(/测试注入|文件尚未生成/u);
  } finally {
    if (electronApp) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});

test("workspace failure keeps the current page visible with export and relaunch paths", async () => {
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "workspace-recovery.html");
  writeFileSync(sourcePath, fixtureBuffer("complex-layout.html"));
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    await loadedDiskFrame(launched.page, sourcePath, "list-item");
    await launched.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(
        "html-app:workspace-unavailable",
        {
          title: "本地项目资料暂时不可用",
          message: "当前页面内容仍保留。可先导出当前编辑，再重新打开源页。",
        },
      );
    });

    const recovery = launched.page.getByRole("alert")
      .filter({ hasText: "本地项目资料暂时不可用" });
    await expect(recovery).toBeVisible();
    await expect(recovery.getByRole("button", { name: "导出当前编辑" }))
      .toBeVisible();
    await expect(recovery.getByRole("button", { name: "重新打开源页" }))
      .toBeVisible();
    await expect(launched.page.getByRole("button", { name: "全局评论" }))
      .toBeDisabled();
    await expect(launched.page.getByTestId("html-canvas-editor")
      .filter({ visible: true })
      .first()
      .locator('iframe[title*="本轮已锁定"]')).toBeVisible();
  } finally {
    if (electronApp) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});

test("Electron autosaves one authorized disk patch and reopens the same undo-redo result", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "native-source-fidelity.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "Electron磁盘原位_OK";
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  const expected = replaceUniqueBytes(original, originalToken, replacement);
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let firstApp = null;
  let reopenedApp = null;
  try {
    const firstLaunch = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    firstApp = firstLaunch.electronApp;
    let { frame } = await loadedDiskFrame(
      firstLaunch.page,
      sourcePath,
      "source-fidelity",
    );
    expect(
      readFileSync(sourcePath).equals(original),
      "opening and registering a disk project must not rewrite its HTML",
    ).toBe(true);
    let persistedRevision = 0;

    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await firstLaunch.page.keyboard.insertText(replacement);
    expect(await frame.locator(caseSelector("source-fidelity")).textContent()).toBe(replacement);
    expect(await frame.evaluate(() => ({
      lexical: document.querySelectorAll("[data-lexical-editor]").length,
      mirror: document.querySelectorAll("[data-html-canvas-text-flow-surface]").length,
      editableCases: Array.from(document.querySelectorAll("[contenteditable]")).map(
        (element) => element.getAttribute("data-native-case"),
      ),
    }))).toEqual({
      lexical: 0,
      mirror: 0,
      editableCases: ["source-fidelity"],
    });
    await rememberCurrentNativeHost(firstLaunch.page, "source-fidelity");
    let previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    persistedRevision = await expectCheckpointPersisted(
      firstLaunch.page,
      persistedRevision,
    );
    expect(
      readFileSync(sourcePath).equals(expected),
      "checkpoint/autosave must write only the authorized bytes",
    ).toBe(true);

    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "source-fidelity",
    );
    expect(await retiredNativeHostState(firstLaunch.page)).toEqual({
      contenteditable: null,
      editingMarker: null,
    });

    previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("Z"));
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "source-fidelity",
    );
    await expect.poll(() => frame.locator(caseSelector("source-fidelity")).textContent())
      .toBe(originalToken);
    previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    persistedRevision = await expectCheckpointPersisted(
      firstLaunch.page,
      persistedRevision,
    );
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "source-fidelity",
    );
    expect(
      readFileSync(sourcePath).equals(original),
      "undo must restore the exact original disk bytes",
    ).toBe(true);

    previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(
      `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+Z`,
    );
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "source-fidelity",
    );
    await expect.poll(() => frame.locator(caseSelector("source-fidelity")).textContent())
      .toBe(replacement);
    previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(
      firstLaunch.page,
      persistedRevision,
    );
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "source-fidelity",
    );
    expect(
      readFileSync(sourcePath).equals(expected),
      "redo must replay the identical authorized bytes",
    ).toBe(true);

    await closePageRootGracefully(firstApp);
    firstApp = null;

    const reopened = await launchPageRoot({ isolatedUserData });
    reopenedApp = reopened.electronApp;
    const { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      sourcePath,
      "source-fidelity",
    );
    expect(await reopenedFrame.locator(caseSelector("source-fidelity")).textContent())
      .toBe(replacement);
    await activateNativeEdit(reopenedFrame, "source-fidelity");
    expect(await nativeEditingState(reopenedFrame, "source-fidelity")).toMatchObject({
      targetIsActive: true,
      contenteditable: "plaintext-only",
      activeIsLegacySurface: false,
      legacySurfaceCount: 0,
    });
    expect(await reopenedFrame.locator("[data-lexical-editor]").count()).toBe(0);
    expect(readFileSync(sourcePath).equals(expected)).toBe(true);

    await closePageRootGracefully(reopenedApp);
    reopenedApp = null;
  } finally {
    if (firstApp) await stopPageRoot(firstApp, isolatedUserData, { cleanup: false });
    if (reopenedApp) await stopPageRoot(reopenedApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});

test("Electron canonicalizes and persists an Apple Pinyin styled-wrapper composition", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "apple-pinyin-styled-wrapper.html");
  const original = fixtureBuffer("complex-layout.html");
  const expected = replaceUniqueBytes(
    original,
    "<em>Word</em>",
    "<em>你好</em>",
  );
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let firstApp = null;
  let reopenedApp = null;
  try {
    const firstLaunch = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    firstApp = firstLaunch.electronApp;
    const loaded = await loadedDiskFrame(
      firstLaunch.page,
      sourcePath,
      "heading-inline",
    );
    const { editor } = loaded;
    let { frame } = loaded;
    await activateNativeEdit(frame, "heading-inline");
    await replayApplePinyinStyledWrapperCommit(frame, "heading-inline");

    await expect.poll(() => editor.getAttribute("data-undo-depth")).toBe("1");
    await expect(firstLaunch.page.locator(".round-record-counts"))
      .toHaveText("0 条评论 · 1 项直接编辑记录");
    await expect.poll(() => frame.locator(caseSelector("heading-inline")).innerHTML())
      .toContain("<em");
    const committedHtml = await frame.locator(caseSelector("heading-inline")).innerHTML();
    expect(committedHtml).toContain(">你好</em>");
    expect(committedHtml).not.toContain("<i>");
    expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();

    let persistedRevision = 0;
    let previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    persistedRevision = await expectCheckpointPersisted(
      firstLaunch.page,
      persistedRevision,
    );
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "heading-inline",
    );
    expect(
      readFileSync(sourcePath).equals(expected),
      "styled-wrapper IME commit must persist only Word -> 你好",
    ).toBe(true);

    previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("Z"));
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "heading-inline",
    );
    await expect.poll(() => frame.locator(caseSelector("heading-inline")).innerHTML())
      .toContain(">Word</em>");
    previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    persistedRevision = await expectCheckpointPersisted(
      firstLaunch.page,
      persistedRevision,
    );
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "heading-inline",
    );
    expect(
      readFileSync(sourcePath).equals(original),
      "IME undo must restore the byte-exact original fixture",
    ).toBe(true);

    previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(
      `${process.platform === "darwin" ? "Meta" : "Control"}+Shift+Z`,
    );
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "heading-inline",
    );
    await expect.poll(() => frame.locator(caseSelector("heading-inline")).innerHTML())
      .toContain(">你好</em>");
    previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(firstLaunch.page, persistedRevision);
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "heading-inline",
    );
    expect(
      readFileSync(sourcePath).equals(expected),
      "IME redo must reproduce the identical forward SourcePatch",
    ).toBe(true);

    await closePageRootGracefully(firstApp);
    firstApp = null;
    const reopened = await launchPageRoot({ isolatedUserData });
    reopenedApp = reopened.electronApp;
    const { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      sourcePath,
      "heading-inline",
    );
    const reopenedHtml = await reopenedFrame.locator(
      caseSelector("heading-inline"),
    ).innerHTML();
    expect(reopenedHtml).toContain(">你好</em>");
    expect(reopenedHtml).not.toContain("<i>");
    expect(readFileSync(sourcePath).equals(expected)).toBe(true);

    await closePageRootGracefully(reopenedApp);
    reopenedApp = null;
  } finally {
    if (firstApp) await stopPageRoot(firstApp, isolatedUserData, { cleanup: false });
    if (reopenedApp) await stopPageRoot(reopenedApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});

test("Electron Chromium commits a composition without leaving interim pinyin", async () => {
  const { electronApp, page, isolatedUserData } = await launchPageRoot();
  try {
    const { frame } = await loadFixture(page, "complex-layout.html");
    await activateNativeEdit(frame, "list-item");
    await installInputRecorder(frame);
    await setTextSelection(frame, "list-item", 0, 3);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "zhongwen",
      selectionStart: 8,
      selectionEnd: 8,
    });
    await cdp.send("Input.insertText", { text: "中文" });

    const text = await frame.locator(caseSelector("list-item")).textContent();
    expect(text).toContain("中文");
    expect(text).not.toContain("zhongwen");
    const events = await recordedInputEvents(frame);
    expect(events.some(({ type }) => type === "compositionstart")).toBe(true);
    expect(events.some(({ type }) => type === "compositionend")).toBe(true);
  } finally {
    await stopPageRoot(electronApp, isolatedUserData);
  }
});
