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
  replaceEditableIslandBytes,
  replaceUniqueBytes,
  selectionSnapshot,
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
  const page = electronApp.windows()[0];
  await page?.evaluate(() => {
    window.__PAGEROOT_CLOSE_ABORT_REASON__ = null;
    window.addEventListener("html-ai:close-aborted", (event) => {
      window.__PAGEROOT_CLOSE_ABORT_REASON__ = event.detail?.reason || "unknown";
    }, { once: true });
  });
  const closed = electronApp.waitForEvent("close", { timeout: 35_000 });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  try {
    await closed;
  } catch (error) {
    const reason = await page?.evaluate(
      () => window.__PAGEROOT_CLOSE_ABORT_REASON__,
    ).catch(() => null);
    throw new Error(
      `PageRoot graceful close did not complete${reason ? `: ${reason}` : "."}`,
      { cause: error },
    );
  }
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
    contenteditable: "true",
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
      throw new Error("Electron source-authority fence lost the retired native host reference.");
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
      state: element.getAttribute("data-persist-state"),
      editRevision,
      persistedRevision,
      synchronized:
        Number.isSafeInteger(editRevision)
        && editRevision > minimumRevision
        && editRevision === persistedRevision,
    };
  }, afterRevision), { timeout: 30_000 }).toMatchObject({
    state: "idle",
    synchronized: true,
  });
  return Number(await indicator.getAttribute("data-persisted-revision"));
}

async function clickEditHistoryMenu(electronApp, direction) {
  await electronApp.evaluate(
    ({ BrowserWindow, Menu }, requestedDirection) => {
      const menu = Menu.getApplicationMenu();
      const expectedLabel = requestedDirection === "undo" ? "Undo" : "Redo";
      const editMenu = menu?.items.find((item) => (
        item.submenu?.items.some(
          (candidate) => candidate.label === expectedLabel,
        )
      ));
      const item = editMenu?.submenu?.items.find(
        (candidate) => candidate.label === expectedLabel,
      );
      if (!item?.click) {
        throw new Error(`Edit > ${expectedLabel} is not installed.`);
      }
      item.click(item, BrowserWindow.getAllWindows()[0], {});
    },
    direction,
  );
}

async function selectAuthoredCase(frame, caseId) {
  await frame.locator(caseSelector(caseId)).evaluate((element) => {
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      clientX: rect.left + Math.min(4, rect.width / 2),
      clientY: rect.top + Math.min(4, rect.height / 2),
      view: window,
    }));
  });
}

async function addCanvasComment(page, frame, caseId, text) {
  await page.keyboard.press("Escape");
  await frame.locator("body").click({ position: { x: 2, y: 2 } });
  const target = frame.locator(caseSelector(caseId));
  await target.scrollIntoViewIfNeeded();
  await target.click();
  const commentButton = page.getByRole("button", { name: /给.+留评论/u })
    .filter({ visible: true })
    .first();
  await expect(commentButton).toBeVisible();
  await commentButton.click();
  await page.getByRole("textbox", { name: "评论内容" }).fill(text);
  await page.getByRole("button", { name: "评论", exact: true }).click();
  const card = page.locator(".comment-card").filter({ hasText: text });
  await expect(card).toHaveCount(1);
  await expect(card).toHaveAttribute("data-resolution", /^(?:exact|rebound)$/u);
  return card;
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
    expect(registry.projects[projectIds[0]].displayName).toBe("欢迎来到源页");
    expect(registry.projects[projectIds[0]].storageDirectoryName)
      .toMatch(/^欢迎来到源页__\d{8}-\d{6}__[a-f0-9]{8}$/);
    expect(existsSync(
      path.join(
        workspace,
        "projects",
        registry.projects[projectIds[0]].storageDirectoryName,
        "versions",
        "ver_0001",
        "committed.json",
      ),
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
    await expect.poll(() => welcomeFrame
      .locator('base[data-html-canvas-injected-base="true"]')
      .getAttribute("href")).toMatch(/^pageroot-preview:/u);
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

test("Electron safely renames the saved current HTML without starting a new project", async () => {
  const launched = await launchPageRoot();
  const originalPath = path.join(
    realpathSync(launched.isolatedUserData),
    "欢迎来到源页.html",
  );
  const renamedPath = path.join(
    realpathSync(launched.isolatedUserData),
    "我的页面.html",
  );
  const workspace = path.join(launched.isolatedUserData, "workspace");
  try {
    await waitForProjectReady(launched.page);
    await expect.poll(
      async () => (
        await launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
      )?.sourcePath,
      { timeout: 20_000 },
    ).toBe(originalPath);
    const originalBytes = readFileSync(originalPath);
    const originalRegistry = JSON.parse(
      readFileSync(path.join(workspace, "project-registry.json"), "utf8"),
    );
    const [projectId] = Object.keys(originalRegistry.projects);

    const title = launched.page.getByRole("button", {
      name: "重命名文件 欢迎来到源页",
      exact: true,
    });
    await expect(title).toBeVisible();
    await title.dblclick();
    const input = launched.page.getByRole("textbox", {
      name: "文件名（不含后缀）",
      exact: true,
    });
    await expect(input).toHaveValue("欢迎来到源页");
    await expect(input.locator("..")).toContainText(".html");
    await input.fill("我的页面");
    const header = launched.page.locator("header.workbench-header");
    await expect(header).toHaveAttribute("data-file-renaming", "true");
    const fileHeader = launched.page.locator(".window-file");
    const fileHeaderBox = await fileHeader.boundingBox();
    expect(fileHeaderBox).not.toBeNull();
    await fileHeader.click({
      position: {
        x: fileHeaderBox.width - 8,
        y: fileHeaderBox.height / 2,
      },
    });

    await expect(input).toHaveCount(0);
    await expect(header).not.toHaveAttribute("data-file-renaming", "true");
    await expect.poll(
      async () => (
        await launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
      )?.sourcePath,
      { timeout: 20_000 },
    ).toBe(renamedPath);
    await expect(launched.page.getByRole("button", {
      name: "重命名文件 我的页面",
      exact: true,
    })).toBeVisible();
    expect(existsSync(originalPath)).toBe(false);
    expect(readFileSync(renamedPath)).toEqual(originalBytes);

    const state = JSON.parse(
      readFileSync(path.join(launched.isolatedUserData, "html-projects.json"), "utf8"),
    );
    expect(state.version).toBe(2);
    expect(state.activePath).toBe(renamedPath);
    expect(state.recent[0].path).toBe(renamedPath);
    expect(state.pendingRename).toBeNull();
    expect(state.lastRename.sourcePath).toBe(renamedPath);

    const renamedRegistry = JSON.parse(
      readFileSync(path.join(workspace, "project-registry.json"), "utf8"),
    );
    expect(Object.keys(renamedRegistry.projects)).toEqual([projectId]);
    expect(renamedRegistry.projects[projectId].sourcePath).toBe(renamedPath);
    const storageDirectoryName =
      renamedRegistry.projects[projectId].storageDirectoryName;
    expect(storageDirectoryName).toBe(
      originalRegistry.projects[projectId].storageDirectoryName,
    );
    const project = JSON.parse(
      readFileSync(
        path.join(workspace, "projects", storageDirectoryName, "project.json"),
        "utf8",
      ),
    );
    expect(project.documentId).toBe(originalRegistry.projects[projectId].documentId);
    expect(project.sourcePath).toBe(renamedPath);
    expect(project.displayName).toBe(
      originalRegistry.projects[projectId].displayName,
    );
  } finally {
    await stopPageRoot(
      launched.electronApp,
      launched.isolatedUserData,
    );
  }
});

test("Electron interactive preview runs authored scripts and edits the selected Tab", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-preview-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "interactive-report.html");
  const runtimePath = path.join(sourceDirectory, "runtime.js");
  writeFileSync(
    sourcePath,
    `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    .panel { display: none; }
    .panel.active { display: block; }
  </style>
</head>
<body>
  <nav>
    <button id="tab-one" class="tab active" aria-selected="true">第一页</button>
    <button id="tab-two" class="tab" aria-selected="false">第二页</button>
  </nav>
  <section id="panel-one" class="panel active">
    <p>第一页正文</p>
    <div id="runtime-canvas" data-native-case="runtime-visual-host" style="width: 32px; height: 16px"></div>
    <div id="runtime-svg" style="width: 40px; height: 20px"></div>
    <table><tbody id="runtime-table"></tbody></table>
  </section>
  <section id="panel-two" class="panel">
    <p data-native-case="preview-tab-copy" data-native-mode="native-editable">第二页可编辑正文</p>
    <svg id="static-chart" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"></circle></svg>
  </section>
  <script src="./runtime.js"></script>
</body>
</html>`,
    "utf8",
  );
  writeFileSync(
    runtimePath,
    `(() => {
  const tabs = [
    ["tab-one", "panel-one"],
    ["tab-two", "panel-two"],
  ];
  for (const [tabId, panelId] of tabs) {
    document.getElementById(tabId).addEventListener("click", () => {
      for (const [otherTabId, otherPanelId] of tabs) {
        const active = otherTabId === tabId;
        document.getElementById(otherTabId).classList.toggle("active", active);
        document.getElementById(otherTabId).setAttribute("aria-selected", String(active));
        document.getElementById(otherPanelId).classList.toggle("active", active);
      }
    });
  }
  const canvas = document.createElement("canvas");
  canvas.width = 32;
  canvas.height = 16;
  canvas.dataset.drawn = "true";
  document.getElementById("runtime-canvas").append(canvas);
  canvas.getContext("2d").fillRect(0, 0, 16, 8);
  document.getElementById("runtime-table").innerHTML =
    '<tr data-runtime-row><td>动态行一</td></tr><tr data-runtime-row><td>动态行二</td></tr>';
  const runtimeSvg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  runtimeSvg.setAttribute("data-runtime-chart", "true");
  runtimeSvg.setAttribute("width", "40");
  runtimeSvg.setAttribute("height", "20");
  runtimeSvg.innerHTML = '<rect width="40" height="20" fill="#2563eb"></rect>';
  document.getElementById("runtime-svg").append(runtimeSvg);
  document.body.dataset.runtimeReady = "true";
})();`,
    "utf8",
  );

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame: editFrame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "preview-tab-copy",
    );

    await expect(editFrame.locator(
      '#runtime-canvas img[data-pageroot-readonly-visual="runtime-bitmap"]',
    )).toBeVisible({ timeout: 20_000 });
    await expect(editFrame.locator(
      '#runtime-svg img[data-pageroot-readonly-visual="runtime-bitmap"]',
    )).toBeVisible();
    await expect(editFrame.locator(
      '#runtime-table > tr[data-pageroot-readonly-visual="runtime-bitmap-row"] img[data-pageroot-readonly-visual="runtime-bitmap"]',
    )).toBeVisible();
    await expect(editFrame.locator("#runtime-canvas canvas")).toHaveCount(0);
    await expect(editFrame.locator("#runtime-svg svg")).toHaveCount(0);
    await expect(editFrame.locator("[data-runtime-row]")).toHaveCount(0);
    await addCanvasComment(
      launched.page,
      editFrame,
      "runtime-visual-host",
      "请调整这张运行时图表",
    );
    expect(readFileSync(sourcePath, "utf8")).not.toMatch(
      /data-pageroot-readonly-visual|data-runtime-row|data-runtime-chart|data-drawn/u,
    );

    await launched.page.getByRole("button", {
      name: "预览",
      exact: true,
    }).click();
    const previewIframe = launched.page.locator(
      'iframe[title="HTML 交互预览"]',
    );
    await expect(previewIframe).toBeVisible();
    await expect.poll(() => launched.page.frames().some(
      (frame) => /^pageroot-preview:/u.test(frame.url()),
    ), {
      message: "PageRoot Electron should expose its interactive preview frame.",
    }).toBe(true);
    const previewFrame = launched.page.frames().find(
      (frame) => /^pageroot-preview:/u.test(frame.url()),
    );
    if (!previewFrame) {
      throw new Error("PageRoot Electron did not expose its interactive preview frame.");
    }
    await previewFrame.waitForFunction(
      () => document.body.dataset.runtimeReady === "true",
    );
    expect(previewFrame.url()).toMatch(/^pageroot-preview:/u);
    expect(await previewFrame.evaluate(() => ({
      projects: typeof window.htmlAIProjects,
      preview: typeof window.htmlAIPreview,
      runtime: typeof window.htmlAIRuntime,
    }))).toEqual({
      projects: "undefined",
      preview: "undefined",
      runtime: "undefined",
    });
    await expect(previewFrame.locator("#runtime-canvas canvas"))
      .toHaveAttribute("data-drawn", "true");
    await expect(previewFrame.locator("[data-runtime-row]")).toHaveCount(2);
    await expect(previewFrame.locator("[data-runtime-chart]")).toHaveCount(1);

    await previewFrame.locator("#tab-two").click();
    await expect(previewFrame.locator("#panel-two")).toBeVisible();
    await expect(previewFrame.locator("#panel-one")).toBeHidden();

    await launched.page.getByRole("button", {
      name: "编辑",
      exact: true,
    }).click();
    await expect(launched.page.getByRole("button", {
      name: "编辑",
      exact: true,
    })).toHaveAttribute("aria-pressed", "true");
    await expect(launched.page.locator(".canvas-edit-surface"))
      .toHaveAttribute("data-runtime-visual-status", "ready", {
        timeout: 20_000,
      });

    await expect(editFrame.locator("#panel-two")).toBeVisible();
    await expect(editFrame.locator("#panel-two")).toHaveClass(/active/u);
    await expect(editFrame.locator("#panel-one")).toBeHidden();
    await expect(editFrame.locator("#static-chart")).toBeVisible();
    await expect(editFrame.locator(
      '#runtime-canvas img[data-pageroot-readonly-visual="runtime-bitmap"]',
    )).toHaveCount(1, { timeout: 20_000 });
    await expect(editFrame.locator("#runtime-canvas canvas")).toHaveCount(0);
    await expect(editFrame.locator(
      '#runtime-table > tr[data-pageroot-readonly-visual="runtime-bitmap-row"]',
    )).toHaveCount(1);
    await expect(editFrame.locator("#runtime-table")).not.toContainText("动态行一");
    await expect(editFrame.locator(
      '#runtime-svg img[data-pageroot-readonly-visual="runtime-bitmap"]',
    )).toHaveCount(1);
    await expect(editFrame.locator("[data-runtime-chart]")).toHaveCount(0);
    expect(readFileSync(sourcePath, "utf8")).not.toMatch(
      /data-pageroot-readonly-visual|data-runtime-row|data-runtime-chart|data-drawn/u,
    );

    await activateNativeEdit(editFrame, "preview-tab-copy");
    await expect(editFrame.locator(caseSelector("preview-tab-copy")))
      .toHaveAttribute("contenteditable", "true");
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-preview-source-e2e-",
    );
  }
});

test("Electron edit mode projects runtime visuals in an opt-in real HTML file", async () => {
  const sourcePath = process.env.PAGEROOT_REAL_HTML_PATH;
  test.skip(
    !sourcePath || !existsSync(sourcePath),
    "Set PAGEROOT_REAL_HTML_PATH to an existing local HTML file.",
  );
  const originalBytes = readFileSync(sourcePath);
  const launched = await launchPageRoot({ activeSourcePath: sourcePath });
  try {
    const editFrame = await currentEditorFrame(launched.page);
    await editFrame.waitForFunction(() => Boolean(document.querySelector("#np1a")));
    await expect(editFrame.locator(
      '#np1a img[data-pageroot-readonly-visual="runtime-bitmap"]',
    )).toBeVisible({ timeout: 30_000 });
    await expect(editFrame.locator(
      '#np1b img[data-pageroot-readonly-visual="runtime-bitmap"]',
    )).toBeVisible();
    await expect(editFrame.locator(
      '#cat-tbody img[data-pageroot-readonly-visual="runtime-bitmap"]',
    )).toHaveCount(1);
    await expect(editFrame.locator("#np1a svg, #np1a canvas")).toHaveCount(0);
    await expect(editFrame.locator("#cat-tbody > tr:not([data-pageroot-readonly-visual])"))
      .toHaveCount(0);
    expect(readFileSync(sourcePath)).toEqual(originalBytes);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
  }
});

test("Electron edit mode reveals safe semantic content without changing disk bytes", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-presentation-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "presentation-actions.html");
  const original = fixtureBuffer("presentation-actions.html");
  writeFileSync(sourcePath, original);

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { editor, frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "presentation-root",
    );

    await frame.locator(caseSelector("details-tab")).click();
    await editor.getByRole("button", {
      name: "切换到此页签",
      exact: true,
    }).click();
    await expect(frame.locator(caseSelector("overview-panel"))).toBeHidden();
    await expect(frame.locator(caseSelector("details-panel"))).toBeVisible();

    await frame.locator(caseSelector("native-summary")).click({
      modifiers: ["Alt"],
    });
    await expect(frame.locator(caseSelector("native-details")))
      .toHaveAttribute("open", "");

    await frame.locator(caseSelector("more-toggle")).click({
      modifiers: ["Alt"],
    });
    await expect(frame.locator(caseSelector("more-toggle")))
      .toHaveAttribute("aria-expanded", "true");
    await expect(frame.locator(caseSelector("more-content"))).toBeVisible();

    expect(await frame.evaluate(() => ({
      authorAction: document.documentElement.dataset.authorAction ?? null,
      authorScriptRan: document.documentElement.dataset.authorScriptRan ?? null,
    }))).toEqual({
      authorAction: null,
      authorScriptRan: null,
    });
    expect(readFileSync(sourcePath).equals(original)).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-presentation-source-e2e-",
    );
  }
});

test("Electron uses the authored DOM caret, Selection and controlled beforeinput", async () => {
  const { electronApp, page, isolatedUserData } = await launchPageRoot();
  try {
    const { frame } = await loadFixture(page, "complex-layout.html");
    const initialDocument = await documentToken(frame);
    await activateNativeEdit(frame, "heading-inline");
    expect(await nativeEditingState(frame, "heading-inline")).toMatchObject({
      contenteditable: "true",
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
    expect(events.some(({ type }) => type === "input")).toBe(false);
  } finally {
    await stopPageRoot(electronApp, isolatedUserData);
  }
});

test("Electron proves one V2 editable-island lane across complex projections", async () => {
  const { electronApp, page, isolatedUserData } = await launchPageRoot();
  try {
    const { editor, frame } = await loadFixture(page, "complex-layout.html");
    const controlledCase = "collapsed-whitespace-copy";
    await frame.locator(caseSelector(controlledCase)).scrollIntoViewIfNeeded();
    const beforeGeometry = await geometrySnapshot(frame, controlledCase);
    const controlledTarget = await activateNativeEdit(frame, controlledCase);
    await expect(controlledTarget).toHaveAttribute("contenteditable", "true");
    await expect(editor).toHaveAttribute(
      "data-native-host-mode",
      "v2-editable-island",
    );
    await expect(editor).toHaveAttribute(
      "data-native-event-delivery-mode",
      "native-editable-island",
    );
    expect(await geometrySnapshot(frame, controlledCase)).toEqual(beforeGeometry);

    await setTextSelection(frame, controlledCase, 0, 4);
    await electronApp.evaluate(({ clipboard }, text) => {
      clipboard.writeText(text);
    }, "<b>Electron纯文字</b>");
    await page.keyboard.press(keyShortcut("V"));
    await expect.poll(() => controlledTarget.textContent())
      .toContain("<b>Electron纯文字</b>");
    expect(await controlledTarget.locator("b").count()).toBe(0);

    const secondProjectionCase = "display-contents-copy";
    await activateNativeEdit(page, secondProjectionCase);
    await expect(editor).toHaveAttribute(
      "data-native-host-mode",
      "v2-editable-island",
    );
    await expect(editor).toHaveAttribute(
      "data-native-event-delivery-mode",
      "native-editable-island",
    );
    await setTextSelection(page, secondProjectionCase, 0);
    await page.keyboard.insertText("电");
    await expect.poll(() => (
      page
        .getByTestId("html-canvas-editor")
        .filter({ visible: true })
        .first()
        .locator('iframe[title*="HTML"]')
        .contentFrame()
        .locator(caseSelector(secondProjectionCase))
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

    const projectFileRoute = "**/file?**";
    const rejectProjectRulesRead = async (route) => {
      const url = new URL(route.request().url());
      if (url.searchParams.get("path") === "PROJECT.md") {
        await route.fulfill({
          status: 503,
          contentType: "application/json",
          body: JSON.stringify({
            ok: false,
            error: { message: "测试注入：项目规则暂时不可读。" },
          }),
        });
        return;
      }
      await route.continue();
    };
    await launched.page.route(projectFileRoute, rejectProjectRulesRead);

    await projectRules.click();
    const failure = launched.page.getByRole("alert")
      .filter({ hasText: "内容没有读取成功" });
    await expect(failure).toBeVisible();
    await expect(failure).toContainText("项目规则暂时不可读");
    await expect(launched.page.getByRole("textbox", { name: "项目长期规则" }))
      .toHaveCount(0);
    await expect(failure.getByRole("button", { name: "重试读取" })).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "返回项目" })).toBeVisible();

    await launched.page.unroute(projectFileRoute, rejectProjectRulesRead);
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

test("Electron autosaves one authorized disk patch and reopens the same forward result", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "native-source-fidelity.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "Electron磁盘原位_OK";
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  const expected = replaceEditableIslandBytes(
    original,
    "source-fidelity",
    `<span title='single-quoted' data-order-b="2" data-order-a='1'>${replacement}</span>`,
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
    let { frame } = await loadedDiskFrame(
      firstLaunch.page,
      sourcePath,
      "source-fidelity",
    );
    expect(
      readFileSync(sourcePath).equals(original),
      "opening and registering a disk project must not rewrite its HTML",
    ).toBe(true);
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
    const previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(
      firstLaunch.page,
      0,
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

    await expect.poll(() => frame.locator(caseSelector("source-fidelity")).textContent())
      .toBe(replacement);

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
      contenteditable: "true",
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

test("Electron persists text, style, structure, and reorder undo while focused fields stay native", async () => {
  test.setTimeout(120_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "persistent-source-history.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "撤销历史已持久化";
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  const expected = replaceEditableIslandBytes(
    original,
    "source-fidelity",
    `<span title='single-quoted' data-order-b="2" data-order-a='1'>${replacement}</span>`,
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
    const { frame } = await loadedDiskFrame(
      firstLaunch.page,
      sourcePath,
      "source-fidelity",
    );
    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await firstLaunch.page.keyboard.insertText(replacement);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    const firstPersistedRevision = await expectCheckpointPersisted(
      firstLaunch.page,
      0,
    );
    expect(readFileSync(sourcePath).equals(expected)).toBe(true);
    await closePageRootGracefully(firstApp);
    firstApp = null;

    const reopened = await launchPageRoot({ isolatedUserData });
    reopenedApp = reopened.electronApp;
    let { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      sourcePath,
      "source-fidelity",
    );
    await reopened.page.getByRole("button", { name: "全局评论" }).click();
    const commentInput = reopened.page.getByRole("textbox", {
      name: "评论内容",
    });
    await commentInput.fill("原文");
    await commentInput.focus();
    await reopened.page.keyboard.press("End");
    await reopened.page.keyboard.insertText("新增");
    await expect(commentInput).toHaveValue("原文新增");
    await clickEditHistoryMenu(reopenedApp, "undo");
    await expect(commentInput).toHaveValue("原文");
    expect(
      readFileSync(sourcePath).equals(expected),
      "native comment undo must not touch the source journal",
    ).toBe(true);

    await reopenedFrame.locator(caseSelector("source-fidelity")).click();
    await clickEditHistoryMenu(reopenedApp, "undo");
    const undoRevision = await expectCheckpointPersisted(
      reopened.page,
      firstPersistedRevision,
    );
    expect(
      readFileSync(sourcePath).equals(original),
      "Edit > Undo must restore the exact pre-edit source bytes after restart",
    ).toBe(true);
    reopenedFrame = await currentEditorFrame(reopened.page);
    await reopenedFrame.locator(caseSelector("source-fidelity")).click();
    await reopened.page.keyboard.press(keyShortcut("Shift+Z"));
    let latestRevision = await expectCheckpointPersisted(
      reopened.page,
      undoRevision,
    );
    expect(
      readFileSync(sourcePath).equals(expected),
      "Shift+Cmd/Ctrl+Z must reapply the exact retained source patch",
    ).toBe(true);

    reopenedFrame = await currentEditorFrame(reopened.page);
    await selectAuthoredCase(reopenedFrame, "source-fidelity");
    const boldButton = reopened.page.getByRole("button", {
      name: "加粗",
      exact: true,
    });
    await expect(boldButton).toBeEnabled();
    await boldButton.click();
    latestRevision = await expectCheckpointPersisted(
      reopened.page,
      latestRevision,
    );
    const styledBytes = readFileSync(sourcePath);
    expect(styledBytes.equals(expected)).toBe(false);
    expect(styledBytes.toString("utf8")).toContain("font-weight: 700");
    await clickEditHistoryMenu(reopenedApp, "undo");
    latestRevision = await expectCheckpointPersisted(
      reopened.page,
      latestRevision,
    );
    expect(
      readFileSync(sourcePath).equals(expected),
      "style undo must restore the exact bytes before the toolbar command",
    ).toBe(true);
    await clickEditHistoryMenu(reopenedApp, "redo");
    latestRevision = await expectCheckpointPersisted(
      reopened.page,
      latestRevision,
    );
    expect(readFileSync(sourcePath).equals(styledBytes)).toBe(true);

    reopenedFrame = await currentEditorFrame(reopened.page);
    await activateNativeEdit(reopenedFrame, "source-fidelity");
    const styledText = await reopenedFrame
      .locator(caseSelector("source-fidelity"))
      .textContent();
    await setTextSelection(
      reopenedFrame,
      "source-fidelity",
      styledText.length,
    );
    await reopened.page.keyboard.press("Enter");
    await reopened.page.keyboard.press(keyShortcut("S"));
    latestRevision = await expectCheckpointPersisted(
      reopened.page,
      latestRevision,
    );
    const structuredBytes = readFileSync(sourcePath);
    expect(structuredBytes.equals(styledBytes)).toBe(false);
    expect(structuredBytes.toString("utf8")).toContain("<br>");
    await clickEditHistoryMenu(reopenedApp, "undo");
    latestRevision = await expectCheckpointPersisted(
      reopened.page,
      latestRevision,
    );
    expect(
      readFileSync(sourcePath).equals(styledBytes),
      "editable-island structure undo must remove only the inserted break",
    ).toBe(true);
    await clickEditHistoryMenu(reopenedApp, "redo");
    latestRevision = await expectCheckpointPersisted(
      reopened.page,
      latestRevision,
    );
    expect(readFileSync(sourcePath).equals(structuredBytes)).toBe(true);

    reopenedFrame = await currentEditorFrame(reopened.page);
    await selectAuthoredCase(reopenedFrame, "source-fidelity");
    const moveDownButton = reopened.page.getByRole("button", {
      name: "下移",
      exact: true,
    });
    await expect(moveDownButton).toBeEnabled();
    await moveDownButton.click();
    latestRevision = await expectCheckpointPersisted(
      reopened.page,
      latestRevision,
    );
    const reorderedBytes = readFileSync(sourcePath);
    const reorderedText = reorderedBytes.toString("utf8");
    expect(reorderedBytes.equals(structuredBytes)).toBe(false);
    expect(reorderedText.indexOf('title="entity spellings"'))
      .toBeLessThan(reorderedText.indexOf('data-native-case="source-fidelity"'));
    await clickEditHistoryMenu(reopenedApp, "undo");
    latestRevision = await expectCheckpointPersisted(
      reopened.page,
      latestRevision,
    );
    expect(
      readFileSync(sourcePath).equals(structuredBytes),
      "move undo must restore the exact sibling order and bytes",
    ).toBe(true);
    await clickEditHistoryMenu(reopenedApp, "redo");
    await expectCheckpointPersisted(reopened.page, latestRevision);
    expect(readFileSync(sourcePath).equals(reorderedBytes)).toBe(true);

    await reopened.page.getByRole("button", {
      name: "项目",
      exact: true,
    }).click();
    await reopened.page.locator(".project-advanced > summary").click();
    await reopened.page.locator(".project-rule-card").click();
    const projectRules = reopened.page.getByRole("textbox", {
      name: "项目长期规则",
      exact: true,
    });
    await expect(projectRules).toBeEnabled();
    const originalRules = await projectRules.inputValue();
    await projectRules.focus();
    await reopened.page.keyboard.press("End");
    await reopened.page.keyboard.insertText("\n临时新增规则");
    await expect(projectRules).toHaveValue(`${originalRules}\n临时新增规则`);
    await clickEditHistoryMenu(reopenedApp, "undo");
    await expect(projectRules).toHaveValue(originalRules);
    expect(
      readFileSync(sourcePath).equals(reorderedBytes),
      "native project-rule undo must not alter canvas source history",
    ).toBe(true);

    const workspace = path.join(isolatedUserData, "workspace");
    const registry = JSON.parse(
      readFileSync(path.join(workspace, "project-registry.json"), "utf8"),
    );
    const project = Object.values(registry.projects).find(
      (record) => record.sourcePath === realpathSync(sourcePath),
    );
    const history = JSON.parse(readFileSync(
      path.join(
        workspace,
        "projects",
        project.storageDirectoryName,
        "history",
        "source-operations.json",
      ),
      "utf8",
    ));
    expect(history.cursor).toBe(4);
    expect(history.entries.map((entry) => entry.kind))
      .toEqual(["text", "style", "text", "reorder"]);
    expect(history.appliedActions.map((action) => action.direction))
      .toEqual([
        "undo",
        "redo",
        "undo",
        "redo",
        "undo",
        "redo",
        "undo",
        "redo",
      ]);

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

test("Electron restores the active text selection and keeps comment anchors stable through source undo", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "history-selection-comments.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "无感撤回";
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    let { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "source-fidelity",
    );
    const commentText = "撤回后仍然定位在这一段。";
    const commentCard = await addCanvasComment(
      launched.page,
      frame,
      "source-fidelity",
      commentText,
    );

    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await launched.page.keyboard.insertText(replacement);
    await launched.page.keyboard.press(keyShortcut("S"));
    const persistedRevision = await expectCheckpointPersisted(launched.page, 0);
    frame = await currentEditorFrame(launched.page);
    await expect.poll(() => nativeEditingState(frame, "source-fidelity"))
      .toMatchObject({
        targetIsActive: true,
        activeCase: "source-fidelity",
        selectionInside: true,
      });

    await commentCard.evaluate((element) => {
      element.setAttribute("data-history-qa-card", "true");
      window.__PAGEROOT_HISTORY_VISUAL_SAMPLES__ = [];
      window.__PAGEROOT_HISTORY_VISUAL_SAMPLING__ = true;
      const sample = () => {
        const card = document.querySelector('[data-history-qa-card="true"]');
        window.__PAGEROOT_HISTORY_VISUAL_SAMPLES__.push(card
          ? {
              top: card.getBoundingClientRect().top,
              resolution: card.getAttribute("data-resolution"),
              recovery: card.textContent.includes("原位置已变化"),
            }
          : null);
        if (window.__PAGEROOT_HISTORY_VISUAL_SAMPLING__) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    });

    await clickEditHistoryMenu(electronApp, "undo");
    await expectCheckpointPersisted(launched.page, persistedRevision);
    await expect.poll(() => readFileSync(sourcePath).equals(original)).toBe(true);
    frame = await currentEditorFrame(launched.page);
    await expect.poll(() => nativeEditingState(frame, "source-fidelity"))
      .toMatchObject({
        targetIsActive: true,
        contenteditable: "true",
        activeCase: "source-fidelity",
        selectionInside: true,
      });
    await expect.poll(() => selectionSnapshot(frame, "source-fidelity"))
      .toMatchObject({
        anchorOffset: 0,
        focusOffset: originalToken.length,
        text: originalToken,
      });
    await expect(commentCard).toHaveAttribute("data-resolution", /^(?:exact|rebound)$/u);
    await expect(commentCard.getByText("原位置已变化")).toHaveCount(0);

    const visualSamples = await launched.page.evaluate(() => {
      window.__PAGEROOT_HISTORY_VISUAL_SAMPLING__ = false;
      return window.__PAGEROOT_HISTORY_VISUAL_SAMPLES__;
    });
    expect(visualSamples.every(Boolean)).toBe(true);
    expect(visualSamples.some((sample) => (
      sample.recovery
      || !["exact", "rebound"].includes(sample.resolution)
    ))).toBe(false);
    const sampledTops = visualSamples.map((sample) => sample.top);
    expect(Math.max(...sampledTops) - Math.min(...sampledTops))
      .toBeLessThanOrEqual(2);
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

test("Electron native field undo consumes a live composition without leaving interim pinyin", async () => {
  test.setTimeout(60_000);
  const launched = await launchPageRoot();
  try {
    await waitForProjectReady(launched.page);
    await launched.page.getByRole("button", { name: "项目", exact: true }).click();
    await launched.page.locator(".project-advanced > summary").click();
    await launched.page.locator(".project-rule-card").click();
    const projectRules = launched.page.getByRole("textbox", {
      name: "项目长期规则",
      exact: true,
    });
    await expect(projectRules).toBeEnabled();
    const originalRules = await projectRules.inputValue();
    await projectRules.evaluate((element) => {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
    const cdp = await launched.page.context().newCDPSession(launched.page);
    await cdp.send("Input.imeSetComposition", {
      text: "shui",
      selectionStart: 4,
      selectionEnd: 4,
    });
    await cdp.send("Input.imeSetComposition", {
      text: "shuifei",
      selectionStart: 7,
      selectionEnd: 7,
    });
    await cdp.send("Input.insertText", { text: "水费" });
    await expect(projectRules).toHaveValue(`${originalRules}水费`);

    await launched.page.keyboard.press(keyShortcut("Z"));
    await expect(projectRules).toHaveValue(originalRules);
    await expect(projectRules).not.toHaveValue(/shui|shuifei/u);

    await projectRules.evaluate((element) => {
      element.focus();
      element.setSelectionRange(element.value.length, element.value.length);
    });
    await cdp.send("Input.imeSetComposition", {
      text: "dianfei",
      selectionStart: 7,
      selectionEnd: 7,
    });
    await expect(projectRules).toHaveValue(`${originalRules}dianfei`);
    const restoreRules = launched.page.getByRole("button", { name: "还原修改" });
    await expect(restoreRules).toBeEnabled();
    await projectRules.evaluate((element) => {
      window.__PAGEROOT_RETIRED_PROJECT_RULES_EDITOR__ = element;
    });
    await restoreRules.click();
    await launched.page.evaluate((lateValue) => {
      const retired = window.__PAGEROOT_RETIRED_PROJECT_RULES_EDITOR__;
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        "value",
      )?.set;
      valueSetter?.call(retired, lateValue);
      retired?.dispatchEvent(new InputEvent("input", {
        bubbles: true,
        data: "dianfei",
        inputType: "insertCompositionText",
        isComposing: true,
      }));
      retired?.dispatchEvent(new CompositionEvent("compositionend", {
        bubbles: true,
        data: "dianfei",
      }));
      delete window.__PAGEROOT_RETIRED_PROJECT_RULES_EDITOR__;
    }, `${originalRules}dianfei`);
    await expect(projectRules).toHaveValue(originalRules);
    await expect(projectRules).not.toHaveValue(/dianfei/u);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
  }
});

test("Electron persists an Apple Pinyin boundary composition with left affinity", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "apple-pinyin-styled-wrapper.html");
  const original = fixtureBuffer("complex-layout.html");
  const expected = replaceUniqueBytes(
    original,
    "<em>Word</em>",
    "你好<em></em>",
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

    await expect(firstLaunch.page.locator(".round-record-counts"))
      .toHaveText("0 条评论 · 1 项直接编辑记录");
    await expect.poll(() => frame.locator(caseSelector("heading-inline")).innerHTML())
      .toContain("<em");
    const committedHtml = await frame.locator(caseSelector("heading-inline")).innerHTML();
    expect(committedHtml).toContain("你好<em></em>");
    expect(committedHtml).not.toContain("<i>");
    expect(await editor.getAttribute("data-edit-block-detail")).toBeNull();

    const previousDocumentToken = await documentToken(firstLaunch.page);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(
      firstLaunch.page,
      0,
    );
    frame = await waitForFreshDiskFrame(
      firstLaunch.page,
      previousDocumentToken,
      "heading-inline",
    );
    expect(
      readFileSync(sourcePath).equals(expected),
      "boundary IME commit must persist only the left-affinity island change",
    ).toBe(true);

    await expect.poll(() => frame.locator(caseSelector("heading-inline")).innerHTML())
      .toContain("你好<em");

    await closePageRootGracefully(firstApp);
    firstApp = null;
    const workspace = path.join(isolatedUserData, "workspace");
    const registry = JSON.parse(
      readFileSync(path.join(workspace, "project-registry.json"), "utf8"),
    );
    const projectEntry = Object.entries(registry.projects).find(
      ([, project]) => project.sourcePath === realpathSync(sourcePath),
    );
    expect(projectEntry, "the first durable edit must establish one project authority")
      .toBeTruthy();
    const [, persistedProject] = projectEntry;
    const projectRoot = path.join(
      workspace,
      "projects",
      persistedProject.storageDirectoryName,
    );
    const annotations = JSON.parse(
      readFileSync(path.join(projectRoot, "draft", "annotations.json"), "utf8"),
    );
    const runtimeState = JSON.parse(
      readFileSync(path.join(projectRoot, "runtime-state.json"), "utf8"),
    );
    expect(annotations.draftRevision).toBeGreaterThan(0);
    expect(annotations.editEvents.length).toBeGreaterThan(0);
    expect(runtimeState.draft.draftRevision).toBe(annotations.draftRevision);
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
    expect(reopenedHtml).toContain("你好<em");
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
