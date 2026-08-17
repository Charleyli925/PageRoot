import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";

import { sha256 } from "../../../scripts/lifecycle-core.mjs";
import { ProjectFileRepository } from "../../../scripts/project-file-repository.mjs";

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
  recordedInputEvents,
  replaceEditableIslandBytes,
  replaceUniqueBytes,
  setTextSelection,
  withBomAndCrLf,
} from "../browser/pageroot-driver.mjs";
import {
  closePageRootGracefully,
  createSourceFixture as createSharedSourceFixture,
  launchPageRoot,
  loadedDiskFrame as loadDiskFrame,
  removeValidatedTemporaryDirectory,
  removeSourceFixture as removeSharedSourceFixture,
  sendToMainRenderer,
  stopPageRoot,
  waitForProjectReady as waitForSharedProjectReady,
} from "./helpers/pageroot-app-fixture.mjs";

const ORIGINAL_LIST_TEXT = "列表项中的文字保持项目符号和缩进。";

function removeIsolatedUserData(isolatedUserData) {
  removeValidatedTemporaryDirectory(isolatedUserData, "pageroot-native-e2e-");
}

function createSourceFixture(
  fileName = "generated-native-e2e.html",
  transform = (source) => source,
) {
  return createSharedSourceFixture({ fileName, transform });
}

function removeSourceFixture(sourceDirectory) {
  removeSharedSourceFixture(sourceDirectory);
}

async function waitForProjectReady(page, timeout = 30_000) {
  return waitForSharedProjectReady(page, { timeout, includeFailureDetail: true });
}

async function loadedDiskFrame(page, sourcePath, caseId) {
  return loadDiskFrame(page, sourcePath, {
    expectedCase: caseId,
    includeEditor: true,
    timeout: 30_000,
  });
}

async function openRecentProject(
  page,
  sourcePath,
  caseId = "list-item",
  recentName = path.basename(sourcePath),
) {
  const visibleToast = page.locator(".toast.show");
  await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await visibleToast.isVisible()) {
    await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
    await expect(visibleToast).toBeHidden();
  }
  const processingDialog = page.getByRole("dialog", { name: "本轮处理" });
  if (await processingDialog.isVisible()) {
    await page.keyboard.press("Escape");
    await expect(processingDialog).toBeHidden();
  }
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.locator(".recent-file-row")
    .filter({ hasText: recentName })
    .click();
  return loadedDiskFrame(page, sourcePath, caseId);
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

async function managedWorkingCopyPath(page, externalSourcePath) {
  await waitForProjectReady(page);
  const externalPath = realpathSync(externalSourcePath);
  const extension = path.extname(externalPath);
  const expectedWorkingCopyName = `${path.basename(externalPath, extension)}-V1${extension}`;
  let active = null;
  await expect.poll(async () => {
    active = await page.evaluate(() => window.htmlAIProjects?.getActiveProject());
    const sourcePath = active?.sourcePath || "";
    if (!sourcePath) return "";
    try {
      const canonical = realpathSync(sourcePath);
      return path.basename(canonical) === expectedWorkingCopyName
        ? canonical
        : "";
    } catch {
      return "";
    }
  }).not.toBe("");
  expect(active?.sourcePath).toBeTruthy();
  return active.sourcePath;
}

async function bridgeJson(page, pathname, { method = "GET", body = null } = {}) {
  const runtime = await page.evaluate(() => ({
    port: window.htmlAIRuntime?.bridgePort || "",
    token: window.htmlAIRuntime?.bridgeAuthToken || "",
  }));
  if (!runtime.port || !runtime.token) {
    throw new Error("Electron did not expose a usable Bridge connection.");
  }
  const response = await fetch(`http://127.0.0.1:${runtime.port}${pathname}`, {
    method,
    headers: {
      "X-HTML-AI-Bridge-Token": runtime.token,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return {
    status: response.status,
    body: await response.json().catch(() => null),
  };
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
      error: document.querySelector(".source-conflict-banner span")?.textContent || "",
      synchronized:
        Number.isSafeInteger(editRevision)
        && editRevision > minimumRevision
        && editRevision === persistedRevision,
    };
  }, afterRevision), { timeout: 30_000 }).toMatchObject({
    state: "idle",
    error: "",
    synchronized: true,
  });
  return Number(await indicator.getAttribute("data-persisted-revision"));
}

async function clickEditHistoryMenu(electronApp, page, direction) {
  const mainRendererUrl = page.url();
  await electronApp.evaluate(
    ({ BrowserWindow, Menu }, { requestedDirection, rendererUrl }) => {
      const menu = Menu.getApplicationMenu();
      const expectedLabel = requestedDirection === "undo" ? "撤销" : "重做";
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
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL() === rendererUrl
      ));
      if (!mainWindow) {
        throw new Error("PageRoot main BrowserWindow is unavailable for Edit history.");
      }
      item.click(item, mainWindow, {});
    },
    { requestedDirection: direction, rendererUrl: mainRendererUrl },
  );
}

async function addCanvasComment(page, frame, caseId, text) {
  await page.keyboard.press("Escape");
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

const ECHARTS_STUB = `window.echarts = {
  init(host) {
    host.style.userSelect = "none";
    host.style.webkitTapHighlightColor = "rgba(0, 0, 0, 0)";
    host.style.position = "relative";
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    canvas.dataset.echartsRuntime = "true";
    const context = canvas.getContext("2d");
    context.fillStyle = "rgb(1, 2, 3)";
    context.fillRect(0, 0, 640, 360);
    host.append(canvas);
    return { setOption() { window.__PAGEROOT_ECHARTS_AUTHOR_SETTLED__ = true; } };
  }
};`;

async function assertFrozenRuntimeRetained(page, frame, baseline) {
  expect(frame.isDetached()).toBe(false);
  expect(await documentToken(page)).toBe(baseline.document);
  await expect(page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
  const canvas = await page.locator("[data-persist-state]").first().evaluate((element) => ({
    canvasGeneration: element.getAttribute("data-canvas-generation"),
  }));
  expect(canvas.canvasGeneration).toBe(baseline.canvasGeneration);
  expect(await frame.evaluate(() => ({
    rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__,
    chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
    frozenSnapshotCount: document.querySelectorAll(
      "#chart-host img[data-pageroot-edit-runtime-snapshot]",
    ).length,
    dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
    frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
  }))).toEqual({
    rendererAuthorExecutions: 1,
    chartCount: 1,
    frozenSnapshotCount: 0,
    dataImagePngCount: 0,
    frozen: "true",
  });
}

function requestDirectoryCount(workspace) {
  const projectsRoot = path.join(workspace, "projects");
  const legacyCount = !existsSync(projectsRoot) ? 0 : readdirSync(projectsRoot).reduce((total, projectDirectoryName) => {
    const requestsRoot = path.join(
      projectsRoot,
      projectDirectoryName,
      "requests",
    );
    return total + (
      existsSync(requestsRoot)
        ? readdirSync(requestsRoot).filter((entry) => !entry.startsWith(".")).length
        : 0
    );
  }, 0);
  const managedProjectsRoot = path.join(path.dirname(workspace), "project-files");
  if (!existsSync(managedProjectsRoot)) return legacyCount;
  return legacyCount + readdirSync(managedProjectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .reduce((total, entry) => {
      const requestsRoot = path.join(
        managedProjectsRoot,
        entry.name,
        ".pageroot",
        "requests",
      );
      return total + (
        existsSync(requestsRoot)
          ? readdirSync(requestsRoot).filter((name) => !name.startsWith(".")).length
          : 0
      );
    }, 0);
}

function workspaceContainsDraftComment(workspace, text) {
  const projectsRoot = path.join(workspace, "projects");
  const legacyContains = existsSync(projectsRoot) && readdirSync(projectsRoot).some((projectDirectoryName) => {
    const draftPath = path.join(
      projectsRoot,
      projectDirectoryName,
      "draft",
      "annotations.json",
    );
    if (!existsSync(draftPath)) return false;
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    return Array.isArray(draft.comments)
      && draft.comments.some((comment) => comment.text === text);
  });
  if (legacyContains) return true;
  const managedProjectsRoot = path.join(path.dirname(workspace), "project-files");
  if (!existsSync(managedProjectsRoot)) return false;
  return readdirSync(managedProjectsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .some((entry) => {
      const draftsRoot = path.join(
        managedProjectsRoot,
        entry.name,
        ".pageroot",
        "drafts",
      );
      return existsSync(draftsRoot) && readdirSync(draftsRoot)
        .filter((name) => name.endsWith(".json"))
        .some((name) => {
          const draft = JSON.parse(readFileSync(path.join(draftsRoot, name), "utf8"));
          return Array.isArray(draft.comments)
            && draft.comments.some((comment) => comment.text === text);
        });
    });
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

test("Electron first launch imports the welcome HTML as V1 and sends its comment to Qoder", async () => {
  const launched = await launchPageRoot();
  const welcomePath = path.join(launched.isolatedUserData, "欢迎来到源页.html");
  const welcomeLogoPath = path.join(
    launched.isolatedUserData,
    "brand-logo.png",
  );
  try {
    const canonicalWelcomePath = path.join(
      realpathSync(launched.isolatedUserData),
      "欢迎来到源页.html",
    );
    await waitForProjectReady(launched.page);
    let managedWelcomePath = "";
    await expect.poll(
      async () => {
        const active = await launched.page.evaluate(
          () => window.htmlAIProjects?.getActiveProject(),
        );
        managedWelcomePath = String(active?.sourcePath || "");
        return Boolean(
          managedWelcomePath && managedWelcomePath !== canonicalWelcomePath,
        );
      },
      { timeout: 20_000 },
    ).toBe(true);
    expect(path.basename(managedWelcomePath)).toBe("欢迎来到源页-V1.html");
    await expect(launched.page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "项目", exact: true }))
      .toBeEnabled({ timeout: 30_000 });
    await expect(launched.page.getByRole("button", { name: "全局评论", exact: true }))
      .toBeEnabled({ timeout: 30_000 });
    await expect(launched.page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
    await expect.poll(() => (
      existsSync(welcomePath)
      && existsSync(welcomeLogoPath)
      && existsSync(path.join(managedWelcomePath, "..", ".pageroot", "manifest.json"))
    )).toBe(true);
    expect(readFileSync(managedWelcomePath)).toEqual(readFileSync(welcomePath));
    const projectRoot = path.dirname(managedWelcomePath);
    const manifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(manifest.versions.map((version) => version.versionId)).toEqual(["ver_0001"]);
    expect(manifest.workingCopies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workingCopyId: "work_ver_0001",
        sourceRelativePath: "欢迎来到源页-V1.html",
      }),
    ]));

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
    await launched.page.getByRole("button", { name: /发给 AI/u }).click();
    await expect(
      launched.page.getByText("等待 AI 返回结果", { exact: true }),
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
    expect(changeRequest.projectId).toBe(manifest.projectId);
    expect(changeRequest.requirements.instructions[0].text)
      .toBe("把欢迎页主标题改得更简洁。");
  } finally {
    await stopPageRoot(
      launched.electronApp,
      launched.isolatedUserData,
    );
  }
});

test("Electron retries a managed Working Copy activation after the first response is lost", async () => {
  test.setTimeout(120_000);
  const source = createSourceFixture("managed-activation-retry.html");
  const launched = await launchPageRoot({ activeSourcePath: source.sourcePath });
  try {
    await waitForProjectReady(launched.page);
    const v1Path = await managedWorkingCopyPath(launched.page, source.sourcePath);
    const projectsRoot = path.dirname(path.dirname(v1Path));
    const repository = new ProjectFileRepository({ projectsRoot });
    const workspace = await repository.workspace({ sourcePath: v1Path });
    const candidate = await repository.createCandidate({
      target: workspace.target,
      requestId: "req_e2e_managed_activation_retry",
      candidateId: "candidate_e2e_managed_activation_retry_0001",
      html: "<!doctype html><html><head><title>V2 retry</title></head><body><p>V2 retry</p></body></html>",
      expectedSourceSha256: workspace.sourceSha256,
    });
    const promoted = await repository.promoteCandidate({
      target: workspace.target,
      candidateId: candidate.candidate.candidateId,
    });
    const expectedManagedPath = realpathSync(promoted.target.exactSourcePath);
    const payload = {
      previousSourcePath: v1Path,
      nextSourcePath: promoted.target.exactSourcePath,
      expectedSha256: promoted.target.sourceSha256,
      projectId: promoted.target.projectId,
      documentId: promoted.target.documentId,
      workingCopyId: promoted.target.workingCopyId,
      versionId: promoted.target.versionId,
      projectRootPath: promoted.target.projectRootPath,
      operationId: "e2e_managed_activation_retry_0001",
    };

    // The first call commits the main-process project state. Treat the return
    // value as lost, then replay exactly the same operation as the renderer
    // would after a Bridge response interruption.
    await launched.page.evaluate((input) => (
      window.htmlAIProjects.activateManagedWorkingCopy(input)
    ), payload);
    const replayed = await launched.page.evaluate((input) => (
      window.htmlAIProjects.activateManagedWorkingCopy(input)
    ), payload);
    expect(replayed.sourcePath).toBe(expectedManagedPath);
    expect(replayed.sha256).toBe(promoted.target.sourceSha256);
    const active = await launched.page.evaluate(() => window.htmlAIProjects.getActiveProject());
    expect(active?.sourcePath).toBe(expectedManagedPath);
    const state = JSON.parse(readFileSync(
      path.join(launched.isolatedUserData, "html-projects.json"),
      "utf8",
    ));
    expect(state.lastManagedActivation?.operationId).toBe(payload.operationId);
    const staleOperation = await launched.page.evaluate(async (input) => {
      try {
        const result = await window.htmlAIProjects.activateManagedWorkingCopy(input);
        return { inputOperationId: input.operationId, result };
      } catch (error) {
        return {
          inputOperationId: input.operationId,
          message: error?.message || null,
        };
      }
    }, {
      ...payload,
      operationId: "e2e_managed_activation_stale_0001",
    });
    const stateAfterStaleAttempt = JSON.parse(readFileSync(
      path.join(launched.isolatedUserData, "html-projects.json"),
      "utf8",
    ));
    expect(staleOperation).toMatchObject({
      inputOperationId: "e2e_managed_activation_stale_0001",
      message: "当前桌面文件已变化，不能提交过期的托管工作文件切换。",
    });
    expect(stateAfterStaleAttempt.lastManagedActivation?.operationId).toBe(payload.operationId);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(source.sourceDirectory);
  }
});

test("Electron Finder reveals verified project, visible Version Working Copy and derived AI task", async () => {
  test.setTimeout(120_000);
  const source = createSourceFixture("finder-derived-projections.html");
  const launched = await launchPageRoot({ activeSourcePath: source.sourcePath });
  try {
    await waitForProjectReady(launched.page);
    const initialWorkingCopyPath = await managedWorkingCopyPath(
      launched.page,
      source.sourcePath,
    );
    const projectsRoot = path.dirname(path.dirname(initialWorkingCopyPath));
    const repository = new ProjectFileRepository({ projectsRoot });
    let active = (await repository.workspace({ sourcePath: initialWorkingCopyPath })).target;
    let v2Target = null;
    for (let ordinal = 2; ordinal <= 6; ordinal += 1) {
      const candidate = await repository.createCandidate({
        target: active,
        requestId: `req_e2e_finder_${ordinal}`,
        candidateId: `candidate_e2e_finder_${ordinal}_0001`,
        html: `<!doctype html><html><head><title>Finder V${ordinal}</title></head><body><p>Finder V${ordinal}</p></body></html>`,
        expectedSourceSha256: active.sourceSha256,
      });
      active = (await repository.promoteCandidate({
        target: active,
        candidateId: candidate.candidate.candidateId,
      })).target;
      if (ordinal === 2) v2Target = active;
    }
    expect(v2Target?.workingCopyId).toBe("work_ver_0002");
    const continued = await repository.activateVersionWorkingCopy({
      target: active,
      versionId: "ver_0002",
      operationId: "e2e_finder_continue_v2_0001",
      expectedActiveWorkingCopyId: "work_ver_0006",
    });
    const desktopV2 = await launched.page.evaluate((payload) => (
      window.htmlAIProjects.activateManagedWorkingCopy(payload)
    ), {
      previousSourcePath: initialWorkingCopyPath,
      nextSourcePath: continued.target.exactSourcePath,
      expectedSha256: continued.target.sourceSha256,
      projectId: continued.target.projectId,
      documentId: continued.target.documentId,
      workingCopyId: continued.target.workingCopyId,
      versionId: continued.target.versionId,
      projectRootPath: continued.target.projectRootPath,
      operationId: continued.historyActivation.operationId,
    });
    expect(desktopV2.sourcePath).toBe(realpathSync(continued.target.exactSourcePath));
    await repository.confirmVersionWorkingCopyActivation({
      target: active,
      operationId: continued.historyActivation.operationId,
      previousWorkingCopyId: "work_ver_0006",
      activatedWorkingCopyId: "work_ver_0002",
      versionId: "ver_0002",
    });

    const revealedVersion = await launched.page.evaluate((sourcePath) => (
      window.htmlAIProjects.revealVersionFile({ sourcePath, versionId: "ver_0002" })
    ), desktopV2.sourcePath);
    expect(revealedVersion.versionPath).toBe(realpathSync(v2Target.exactSourcePath));
    expect(revealedVersion.versionPath.includes(`${path.sep}.pageroot${path.sep}`)).toBe(false);
    const openedRoot = await bridgeJson(launched.page, "/open-folder", {
      method: "POST",
      body: { sourcePath: desktopV2.sourcePath },
    });
    expect(openedRoot.status).toBe(200);
    expect(openedRoot.body.path).toBe(continued.target.projectRootPath);

    const requestId = "req_e2e_visible_ai_task_0001";
    const request = await repository.prepareRequest({
      target: continued.target,
      requestId,
      attemptId: "attempt_001",
      expectedSourceSha256: continued.target.sourceSha256,
      request: {
        freezeCutoffRevision: 0,
        summary: "从历史 Version 2 生成待审阅的 Version 7",
        comments: [],
        changeEvents: [],
        instructions: [],
        targets: [],
      },
      prompt: "# E2E AI task\n\n只生成候选 HTML。\n",
    });
    const processingTask = await launched.page.evaluate((sourcePath) => (
      window.htmlAIProjects.revealAiTask({ sourcePath })
    ), desktopV2.sourcePath);
    expect(processingTask.aiTaskPath).toMatch(/\/AI任务\/\d{4}-\d{2}-\d{2}-候选版本7$/u);
    expect(processingTask.aiTaskPath.includes(`${path.sep}.pageroot${path.sep}`)).toBe(false);
    expect(readFileSync(path.join(processingTask.aiTaskPath, "PROMPT.md"), "utf8"))
      .toBe("# E2E AI task\n\n只生成候选 HTML。\n");

    const candidateHtml = "<!doctype html><html><head><title>Finder V7</title></head><body><p>Finder V7 Candidate</p></body></html>";
    const completed = await repository.completeRequest({
      target: continued.target,
      requestId,
      attemptId: "attempt_001",
      html: candidateHtml,
    });
    expect(completed.status).toBe("candidate-ready");
    const readyTask = await launched.page.evaluate((sourcePath) => (
      window.htmlAIProjects.revealAiTask({ sourcePath })
    ), desktopV2.sourcePath);
    const readyProjection = await repository.materializeAiTaskProjection({
      target: continued.target,
      requestId,
      attemptId: "attempt_001",
      candidateId: request.candidateId,
    });
    expect(readyTask.aiTaskPath).toBe(realpathSync(readyProjection.taskPath));
    expect(readFileSync(readyProjection.candidatePath, "utf8")).toBe(candidateHtml);

    writeFileSync(readyProjection.candidatePath, "<!doctype html><html><head><title>tampered</title></head><body><p>tampered</p></body></html>", "utf8");
    const rebuiltTask = await launched.page.evaluate((sourcePath) => (
      window.htmlAIProjects.revealAiTask({ sourcePath })
    ), desktopV2.sourcePath);
    expect(rebuiltTask.aiTaskPath).not.toBe(realpathSync(readyProjection.taskPath));
    const hiddenCandidate = await repository.readCandidate({
      target: continued.target,
      candidateId: request.candidateId,
    });
    expect(hiddenCandidate.content).toBe(candidateHtml);
    const promoted = await repository.promoteCandidate({
      target: continued.target,
      candidateId: request.candidateId,
    });
    expect(promoted.version).toMatchObject({
      versionId: "ver_0007",
      basedOnVersionId: "ver_0002",
      previousVersionId: "ver_0006",
    });
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(source.sourceDirectory);
  }
});

test("Electron v4 registry only recovers Finder rename and protects moved copies plus Promotion collisions", async () => {
  test.setTimeout(120_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "finder-registry-state.html");
  const originalExternal = fixtureBuffer("source-fidelity.html");
  writeFileSync(sourcePath, originalExternal);
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  const outsideRoot = mkdtempSync(path.join(tmpdir(), "pageroot-managed-root-outside-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({ isolatedUserData });
    electronApp = launched.electronApp;

    const preview = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    );
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ registered: false });
    const ensured = await bridgeJson(launched.page, "/project/ensure", {
      method: "POST",
      body: {
        sourcePath,
        expectedSourceSha256: preview.body.sourceSha256,
        projectStorageVersion: "4.0.0",
      },
    });
    expect(ensured.status).toBe(200);
    expect(ensured.body).toMatchObject({
      registered: true,
      projectFileSchemaVersion: "4.0.0",
      imported: true,
    });
    expect(readFileSync(sourcePath)).toEqual(originalExternal);

    const firstTarget = ensured.body.openTarget;
    const projectsRoot = path.dirname(firstTarget.projectRootPath);
    const finderRenamedRoot = path.join(projectsRoot, "Finder 改名项目");
    const firstWorkingCopyName = path.basename(firstTarget.exactSourcePath);
    renameSync(firstTarget.projectRootPath, finderRenamedRoot);
    const finderRenamedPath = path.join(finderRenamedRoot, firstWorkingCopyName);

    const rootRecovered = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderRenamedPath)}`,
    );
    expect(rootRecovered.status).toBe(200);
    expect(rootRecovered.body).toMatchObject({
      registered: true,
      projectId: firstTarget.projectId,
      documentId: firstTarget.documentId,
    });
    expect(rootRecovered.body.openTarget.projectRootPath).toBe(finderRenamedRoot);

    const finderRenamedHtml = path.join(finderRenamedRoot, "Finder-B-V1.html");
    renameSync(finderRenamedPath, finderRenamedHtml);
    const htmlRecovered = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderRenamedHtml)}`,
    );
    expect(htmlRecovered.status).toBe(200);
    expect(htmlRecovered.body.openTarget).toMatchObject({
      projectId: firstTarget.projectId,
      workingCopyId: firstTarget.workingCopyId,
      exactSourcePath: finderRenamedHtml,
    });
    const renamedManifest = JSON.parse(readFileSync(
      path.join(finderRenamedRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(renamedManifest.workingCopies[0]).toMatchObject({
      sourceRelativePath: "Finder-B-V1.html",
      preferredFileStem: "Finder-B",
      preferredExtension: ".html",
      workingCopyId: firstTarget.workingCopyId,
    });

    const movedRoot = path.join(outsideRoot, "moved-project");
    const bytesBeforeMove = readFileSync(finderRenamedHtml);
    const targetBeforeMove = htmlRecovered.body.openTarget;
    renameSync(finderRenamedRoot, movedRoot);
    const movedHtml = path.join(movedRoot, "Finder-B-V1.html");
    const blockedSave = await bridgeJson(launched.page, "/autosave", {
      method: "POST",
      body: {
        ...targetBeforeMove,
        html: "<!doctype html><html><head><title>blocked</title></head><body><p>blocked</p></body></html>",
        expectedSourceSha256: targetBeforeMove.sourceSha256,
        editRevision: 1,
      },
    });
    expect(blockedSave.status).toBe(404);
    expect(blockedSave.body?.error?.code).toBe("REGISTERED_PROJECT_UNAVAILABLE");
    expect(readFileSync(movedHtml)).toEqual(bytesBeforeMove);

    const movedPreview = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(movedHtml)}`,
    );
    expect(movedPreview.status).toBe(200);
    expect(movedPreview.body).toMatchObject({ registered: false });

    renameSync(movedRoot, finderRenamedRoot);
    const returned = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderRenamedHtml)}`,
    );
    expect(returned.status).toBe(200);
    expect(returned.body).toMatchObject({
      registered: true,
      projectId: firstTarget.projectId,
      documentId: firstTarget.documentId,
    });

    const copiedRoot = path.join(projectsRoot, "Finder 副本项目");
    cpSync(finderRenamedRoot, copiedRoot, { recursive: true });
    const copiedHtml = path.join(copiedRoot, "Finder-B-V1.html");
    const copiedManifestPath = path.join(copiedRoot, ".pageroot", "manifest.json");
    const copiedManifestBefore = readFileSync(copiedManifestPath);
    const copiedPreview = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(copiedHtml)}`,
    );
    expect(copiedPreview.status).toBe(200);
    expect(copiedPreview.body).toMatchObject({ registered: false });
    expect(readFileSync(copiedManifestPath)).toEqual(copiedManifestBefore);

    const repository = new ProjectFileRepository({ projectsRoot });
    await repository.initialize();
    const workspace = await repository.workspace({ sourcePath: finderRenamedHtml });
    const candidate = await repository.createCandidate({
      target: workspace.target,
      requestId: "req_e2e_registered_root",
      candidateId: "candidate_e2e_registered_root_0001",
      html: "<!doctype html><html><head><title>Finder candidate</title></head><body><p>Candidate retained for explicit adoption.</p></body></html>",
      expectedSourceSha256: workspace.sourceSha256,
    });
    const userFile = path.join(finderRenamedRoot, "Finder-B-V2.html");
    const userDirectory = path.join(finderRenamedRoot, "Finder-B-V2-V2.html");
    const userSymlink = path.join(finderRenamedRoot, "Finder-B-V2-V2-V2.html");
    const userSymlinkTarget = path.join(outsideRoot, "user-symlink-target.html");
    writeFileSync(userFile, "user file must not be overwritten", "utf8");
    mkdirSync(userDirectory);
    writeFileSync(userSymlinkTarget, "user symlink target", "utf8");
    symlinkSync(userSymlinkTarget, userSymlink);

    const promoted = await repository.promoteCandidate({
      target: workspace.target,
      candidateId: candidate.candidate.candidateId,
    });
    expect(path.basename(promoted.target.exactSourcePath)).toBe("Finder-B-V2-V2-V2-V2.html");
    expect(readFileSync(userFile, "utf8")).toBe("user file must not be overwritten");
    expect(readdirSync(userDirectory)).toEqual([]);
    expect(readFileSync(userSymlinkTarget, "utf8")).toBe("user symlink target");
  } finally {
    if (electronApp) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(outsideRoot, "pageroot-managed-root-outside-");
    removeValidatedTemporaryDirectory(sourceDirectory, "pageroot-native-source-e2e-");
  }
});

test("Electron safely renames the managed V1 without starting a new project", async () => {
  const launched = await launchPageRoot();
  const externalOriginalPath = path.join(
    realpathSync(launched.isolatedUserData),
    "欢迎来到源页.html",
  );
  try {
    await waitForProjectReady(launched.page);
    let managedOriginalPath = "";
    await expect.poll(
      async () => {
        const active = await launched.page.evaluate(
          () => window.htmlAIProjects?.getActiveProject(),
        );
        managedOriginalPath = String(active?.sourcePath || "");
        return Boolean(
          managedOriginalPath && managedOriginalPath !== externalOriginalPath,
        );
      },
      { timeout: 20_000 },
    ).toBe(true);
    expect(path.basename(managedOriginalPath)).toBe("欢迎来到源页-V1.html");
    const projectRoot = path.dirname(managedOriginalPath);
    const renamedPath = path.join(projectRoot, "我的页面-V1.html");
    const originalBytes = readFileSync(externalOriginalPath);
    const originalManifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    const projectId = originalManifest.projectId;

    const title = launched.page.getByRole("button", {
      name: "重命名文件 欢迎来到源页-V1",
      exact: true,
    });
    await expect(title).toBeVisible();
    await title.click();
    const input = launched.page.getByRole("textbox", {
      name: "文件名（不含后缀）",
      exact: true,
    });
    await expect(input).toHaveValue("欢迎来到源页-V1");
    await expect(input.locator("..")).toContainText(".html");
    await input.fill("我的页面-V1");
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
      name: "重命名文件 我的页面-V1",
      exact: true,
    })).toBeVisible();
    expect(readFileSync(externalOriginalPath)).toEqual(originalBytes);
    expect(existsSync(managedOriginalPath)).toBe(false);
    expect(readFileSync(renamedPath)).toEqual(originalBytes);

    const state = JSON.parse(
      readFileSync(path.join(launched.isolatedUserData, "html-projects.json"), "utf8"),
    );
    expect(state.version).toBe(2);
    expect(state.activePath).toBe(renamedPath);
    expect(state.recent[0].path).toBe(renamedPath);
    expect(state.pendingRename).toBeNull();
    expect(state.lastRename.sourcePath).toBe(renamedPath);

    const renamedManifest = JSON.parse(readFileSync(
      path.join(projectRoot, ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(renamedManifest.projectId).toBe(projectId);
    expect(renamedManifest.documentId).toBe(originalManifest.documentId);
    expect(renamedManifest.workingCopies).toEqual(expect.arrayContaining([
      expect.objectContaining({
        workingCopyId: "work_ver_0001",
        sourceRelativePath: "我的页面-V1.html",
        preferredFileStem: "我的页面",
        preferredExtension: ".html",
      }),
    ]));
    const registry = JSON.parse(readFileSync(
      path.join(path.dirname(projectRoot), ".pageroot-registry.json"),
      "utf8",
    ));
    expect(realpathSync(registry.projects[projectId].registeredProjectRootPath))
      .toBe(realpathSync(projectRoot));
  } finally {
    await stopPageRoot(
      launched.electronApp,
      launched.isolatedUserData,
    );
  }
});

test("Electron keeps runtime visuals in Preview and source-backed static content in Edit", async () => {
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
    .runtime-scaled-frame {
      position: relative;
      width: 420px;
      height: 220px;
      overflow: hidden;
    }
    #runtime-scaled {
      position: absolute;
      top: 8px;
      left: 8px;
      transform: scale(1.25);
      transform-origin: top left;
    }
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
    <div
      id="runtime-svg"
      style="width: 40px; height: 20px; padding: 7px; border: 3px solid #0f172a; transform: translate(13px, 7px) scale(1.25); transform-origin: top left"
    ></div>
    <div id="runtime-delayed" style="width: 32px; height: 16px"></div>
    <canvas id="direct-runtime-canvas" width="36" height="18"></canvas>
    <svg id="direct-runtime-svg" width="44" height="22"></svg>
    <table><tbody id="runtime-table"></tbody></table>
    <div class="runtime-scaled-frame" id="runtime-scaled-frame">
      <div id="runtime-scaled"></div>
    </div>
  </section>
  <section id="panel-two" class="panel">
    <p data-native-case="preview-tab-copy" data-native-mode="native-editable">第二页可编辑正文</p>
    <svg id="static-chart" viewBox="0 0 10 10"><circle cx="5" cy="5" r="3"></circle></svg>
  </section>
  <script src="file://${runtimePath}"></script>
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
  const directCanvas = document.getElementById("direct-runtime-canvas");
  directCanvas.width = 800;
  directCanvas.height = 400;
  directCanvas.getContext("2d").fillRect(0, 0, 400, 200);
  const directSvg = document.getElementById("direct-runtime-svg");
  directSvg.setAttribute("width", "700");
  directSvg.setAttribute("height", "350");
  directSvg.innerHTML =
    '<rect width="700" height="350" fill="#7c3aed"></rect>';
  const scaledHost = document.getElementById("runtime-scaled");
  const scaledPanel = document.createElement("div");
  scaledPanel.dataset.runtimeScaled = "true";
  scaledPanel.style.cssText =
    "width:800px;height:360px;background:linear-gradient(90deg,#2563eb,#7c3aed)";
  scaledHost.append(scaledPanel);
  const fitScaledPanel = () => {
    const frame = document.getElementById("runtime-scaled-frame");
    const scale = Math.min(
      (frame.clientWidth - 16) / 800,
      (frame.clientHeight - 16) / 360,
    );
    scaledHost.style.transform = "scale(" + scale + ")";
  };
  window.addEventListener("resize", fitScaledPanel);
  fitScaledPanel();
  window.addEventListener("load", () => {
    window.setTimeout(() => {
      const delayedCanvas = document.createElement("canvas");
      delayedCanvas.width = 32;
      delayedCanvas.height = 16;
      delayedCanvas.getContext("2d").fillRect(0, 0, 16, 8);
      document.getElementById("runtime-delayed").append(delayedCanvas);
    }, 350);
  }, { once: true });
  document.body.dataset.runtimeReady = "true";
})();`,
    "utf8",
  );
  writeFileSync(
    sourcePath,
    readFileSync(sourcePath, "utf8").replace(
      `<script src="file://${runtimePath}"></script>`,
      `<script>${readFileSync(runtimePath, "utf8")}</script>`,
    ),
    "utf8",
  );
  const originalSource = readFileSync(sourcePath);

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

    await expect(editFrame.locator("#runtime-canvas canvas")).toHaveCount(0);
    await expect(editFrame.locator("#runtime-svg svg")).toHaveCount(0);
    await expect(editFrame.locator("[data-runtime-row]")).toHaveCount(0);
    await expect(editFrame.locator("#direct-runtime-svg rect")).toHaveCount(0);
    await expect(editFrame.locator("[data-pageroot-readonly-visual]")).toHaveCount(0);
    expect(readFileSync(sourcePath)).toEqual(originalSource);

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
    const resumedEditFrame = await currentEditorFrame(launched.page);
    await expect(resumedEditFrame.locator("#panel-two")).toBeVisible();
    await expect(resumedEditFrame.locator("#panel-two")).toHaveClass(/active/u);
    await expect(resumedEditFrame.locator("#panel-one")).toBeHidden();
    await expect(resumedEditFrame.locator("#static-chart")).toBeVisible();
    await expect(resumedEditFrame.locator("#runtime-canvas canvas")).toHaveCount(0);
    await expect(resumedEditFrame.locator("#runtime-svg svg")).toHaveCount(0);
    await expect(resumedEditFrame.locator("[data-runtime-chart]")).toHaveCount(0);
    await expect(resumedEditFrame.locator("[data-pageroot-readonly-visual]")).toHaveCount(0);
    expect(readFileSync(sourcePath)).toEqual(originalSource);

    await activateNativeEdit(resumedEditFrame, "preview-tab-copy");
    await expect(resumedEditFrame.locator(caseSelector("preview-tab-copy")))
      .toHaveAttribute("contenteditable", "true");
    await setTextSelection(resumedEditFrame, "preview-tab-copy", 0);
    await launched.page.keyboard.insertText("原位");
    await expect.poll(() => resumedEditFrame.locator(
      caseSelector("preview-tab-copy"),
    ).textContent()).toContain("原位");
    const managedSourcePath = await managedWorkingCopyPath(launched.page, sourcePath);
    await expect.poll(() => readFileSync(managedSourcePath, "utf8"))
      .toContain("原位");
    expect(readFileSync(sourcePath, "utf8")).not.toContain("原位");
    expect(readFileSync(sourcePath)).toEqual(originalSource);
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

test("Electron Edit does not execute an inline authored runtime script", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-inline-handler-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "inline-handler-report.html");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Inline handler runtime visual</title></head>
<body onload="const c=document.createElement('canvas');c.width=120;c.height=30;c.getContext('2d').fillRect(0,0,120,30);document.querySelector('div').append(c)">
  <main><div data-native-case="inline-handler-runtime" style="width: 120px; height: 30px"></div></main>
</body>
</html>`;
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame: editFrame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "inline-handler-runtime",
    );
    await expect(editFrame.locator(
      '[data-native-case="inline-handler-runtime"] canvas',
    )).toHaveCount(0);
    await expect(editFrame.locator("[data-pageroot-readonly-visual]")).toHaveCount(0);
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-inline-handler-source-e2e-",
    );
  }
});

test("Electron edit Canvas keeps root scrolling in the shared stage across a scrollbar threshold", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "iframe-root-scroll-feedback.html");
  const original = fixtureBuffer("iframe-root-scroll-feedback.html");
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    const { editor } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "iframe-root-scroll-feedback",
    );
    const iframe = editor.locator('iframe[title*="HTML"]');
    const mainRendererUrl = launched.page.url();

    const waitForAnimationFrames = (count) => launched.page.evaluate(
      (frameCount) => new Promise((resolve) => {
        let remaining = frameCount;
        const nextFrame = () => {
          remaining -= 1;
          if (remaining <= 0) {
            resolve();
            return;
          }
          requestAnimationFrame(nextFrame);
        };
        requestAnimationFrame(nextFrame);
      }),
      count,
    );
    const resizeMainWindow = async (width, height = 960) => {
      await electronApp.evaluate(
        ({ BrowserWindow }, { rendererUrl, nextWidth, nextHeight }) => {
          const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
            candidate.webContents.getURL() === rendererUrl
          ));
          if (!mainWindow) {
            throw new Error("PageRoot main BrowserWindow is unavailable for scrollbar feedback.");
          }
          mainWindow.setContentSize(nextWidth, nextHeight);
        },
        {
          rendererUrl: mainRendererUrl,
          nextWidth: width,
          nextHeight: height,
        },
      );
      await expect.poll(async () => electronApp.evaluate(
        ({ BrowserWindow }, rendererUrl) => {
          const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
            candidate.webContents.getURL() === rendererUrl
          ));
          return mainWindow?.getContentSize() || null;
        },
        mainRendererUrl,
      )).toEqual([width, height]);
      await waitForAnimationFrames(4);
    };
    const rootMetrics = () => iframe.evaluate((frameElement) => {
      const documentNode = frameElement.contentDocument;
      const frameWindow = frameElement.contentWindow;
      if (!documentNode?.body || !frameWindow) {
        throw new Error("Iframe document is unavailable for scrollbar feedback metrics.");
      }
      const root = documentNode.documentElement;
      const body = documentNode.body;
      return {
        iframeWidth: frameElement.clientWidth,
        iframeHeight: frameElement.clientHeight,
        generation: frameElement.getAttribute("data-frame-generation"),
        rootClientWidth: root.clientWidth,
        viewportWidth: frameWindow.innerWidth,
        rootOverflowY: getComputedStyle(root).overflowY,
        bodyOverflowY: getComputedStyle(body).overflowY,
        rootScrollY: frameWindow.scrollY,
        naturalContentHeight: Math.ceil(Math.max(
          root.getBoundingClientRect().height,
          body.getBoundingClientRect().height,
        )),
      };
    });
    const resizeForIframeWidth = async (targetWidth) => {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const metrics = await rootMetrics();
        if (metrics.iframeWidth === targetWidth) return metrics;
        const pageWidth = await launched.page.evaluate(() => (
          document.documentElement.clientWidth
        ));
        await resizeMainWindow(Math.max(
          1_100,
          Math.round(pageWidth + targetWidth - metrics.iframeWidth),
        ));
      }
      throw new Error(`Could not reach iframe width ${targetWidth}px for scrollbar feedback.`);
    };

    await iframe.evaluate((frameElement) => {
      window.__PAGEROOT_SCROLLBAR_FEEDBACK_DOCUMENT__ = frameElement.contentDocument;
      window.__PAGEROOT_SCROLLBAR_FEEDBACK_GENERATION__ =
        frameElement.getAttribute("data-frame-generation");
    });

    await resizeForIframeWidth(899);
    const thresholdMetrics = await resizeForIframeWidth(900);
    expect(thresholdMetrics.iframeWidth).toBe(900);
    await expect.poll(async () => {
      const metrics = await rootMetrics();
      return (
        metrics.rootOverflowY === "hidden"
        && metrics.bodyOverflowY === "hidden"
        && metrics.rootClientWidth === metrics.viewportWidth
        && metrics.iframeHeight >= metrics.naturalContentHeight
      );
    }).toBe(true);

    const stableSamples = await iframe.evaluate(async (frameElement) => {
      const samples = [];
      for (let index = 0; index < 120; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(resolve));
        const documentNode = frameElement.contentDocument;
        const frameWindow = frameElement.contentWindow;
        if (!documentNode?.body || !frameWindow) {
          throw new Error("Iframe document was replaced during scrollbar sampling.");
        }
        samples.push({
          iframeHeight: frameElement.clientHeight,
          rootClientWidth: documentNode.documentElement.clientWidth,
          viewportWidth: frameWindow.innerWidth,
          rootScrollY: frameWindow.scrollY,
        });
      }
      return samples;
    });
    expect(new Set(stableSamples.map((sample) => sample.iframeHeight)).size).toBe(1);
    expect(stableSamples.every((sample) => (
      sample.rootClientWidth === sample.viewportWidth && sample.rootScrollY === 0
    ))).toBe(true);

    const nestedScroll = await iframe.evaluate((frameElement) => {
      const frameWindow = frameElement.contentWindow;
      const nested = frameElement.contentDocument?.getElementById("nested-scroll-probe");
      if (!frameWindow || !(nested instanceof frameWindow.HTMLElement)) {
        throw new Error("Nested authored scroll probe is missing.");
      }
      nested.scrollTop = 48;
      return {
        overflowY: getComputedStyle(nested).overflowY,
        scrollTop: nested.scrollTop,
      };
    });
    expect(nestedScroll.overflowY).toBe("auto");
    expect(nestedScroll.scrollTop).toBeGreaterThan(0);

    const reviewStage = launched.page.locator(".review-scroll-stage");
    await reviewStage.evaluate((element) => {
      element.scrollTop = 0;
    });
    const iframeBox = await iframe.boundingBox();
    if (!iframeBox) throw new Error("Iframe is not visible for shared-stage wheel routing.");
    await launched.page.mouse.move(
      iframeBox.x + Math.min(120, iframeBox.width / 2),
      iframeBox.y + Math.min(120, iframeBox.height / 2),
    );
    await launched.page.mouse.wheel(0, 720);
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    expect((await rootMetrics()).rootScrollY).toBe(0);

    await resizeForIframeWidth(901);
    await waitForAnimationFrames(8);
    expect(await iframe.evaluate((frameElement) => (
      frameElement.contentDocument
        === window.__PAGEROOT_SCROLLBAR_FEEDBACK_DOCUMENT__
      && frameElement.getAttribute("data-frame-generation")
        === window.__PAGEROOT_SCROLLBAR_FEEDBACK_GENERATION__
    ))).toBe(true);
    expect(readFileSync(sourcePath).equals(original)).toBe(true);
  } finally {
    if (electronApp) await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});

test("Electron Edit preserves imported source-relative ECharts assets and native source editing", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-runtime-report.html");
  const runtimeScriptPath = path.join(sourceDirectory, "echarts.js");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>One-shot ECharts Edit runtime</title><link rel="stylesheet" href="echarts-runtime.css"></head>
<body>
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <p class="runtime-resource-probe" data-native-case="runtime-editable">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  const sourceSha256 = sha256(source);
  writeFileSync(runtimeScriptPath, `window.echarts = {
  init(host) {
    host.style.userSelect = "none";
    host.style.webkitTapHighlightColor = "rgba(0, 0, 0, 0)";
    host.style.position = "relative";
    host.style.transform = "scale(0.75)";
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    canvas.dataset.echartsRuntime = "true";
    const context = canvas.getContext("2d");
    context.fillStyle = "rgb(1, 2, 3)";
    context.fillRect(0, 0, 640, 360);
    host.append(canvas);
    return { setOption() { window.__PAGEROOT_ECHARTS_AUTHOR_SETTLED__ = true; } };
  }
};`, "utf8");
  writeFileSync(
    path.join(sourceDirectory, "echarts-runtime.css"),
    ".runtime-resource-probe { color: rgb(1, 2, 3); }",
    "utf8",
  );
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-editable",
    );
    const activeProject = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()
    ));
    if (typeof activeProject?.sourcePath !== "string") {
      throw new Error("The imported managed Working Copy did not become active.");
    }
    const managedSourcePath = activeProject.sourcePath;
    expect(managedSourcePath).not.toBe(sourcePath);
    expect(activeProject.html).toBe(source);
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozenSnapshotCount: document.querySelectorAll(
        "#chart-host img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
      bootstrapCount: document.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length,
      staticScripts: document.querySelectorAll('script[type="application/x-html-canvas-disabled"]').length,
      stubScripts: document.querySelectorAll(
        'script[type="application/x-pageroot-edit-runtime-source"]',
      ).length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      base: document.baseURI,
      stylesheetColor: getComputedStyle(document.querySelector(".runtime-resource-probe")).color,
      hostInlineStyle: document.querySelector("#chart-host").getAttribute("style"),
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozenSnapshotCount: 0,
      dataImagePngCount: 0,
      bootstrapCount: 1,
      staticScripts: 0,
      stubScripts: 2,
      frozen: "true",
      base: expect.stringMatching(/^pageroot-edit-runtime:/u),
      stylesheetColor: "rgb(1, 2, 3)",
      hostInlineStyle: expect.stringMatching(
        /(?=.*user-select: none)(?=.*transform: scale\(0\.75\))/u,
      ),
    });
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    const renderState = await launched.page.locator(".save-status").evaluate((element) => ({
      canvasGeneration: element.getAttribute("data-canvas-generation"),
      renderGeneration: element.getAttribute("data-render-generation"),
      renderedSha256: element.getAttribute("data-rendered-sha256"),
    }));
    expect(renderState.canvasGeneration).toEqual(expect.any(String));
    expect(renderState.renderGeneration).toBe(renderState.canvasGeneration);
    expect(renderState.renderedSha256).toBe(sourceSha256);
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);
    const runtimeDocument = await documentToken(frame);
    const replay = await launched.page.evaluate(async () => {
      const host = document.querySelector("main.workbench");
      const fiberKey = host && Object.getOwnPropertyNames(host).find((key) => (
        key.startsWith("__reactFiber$")
      ));
      const seed = fiberKey ? host?.[fiberKey] : null;
      const visited = new Set();
      const stack = seed ? [seed] : [];
      let runtime = null;
      while (stack.length && visited.size < 12_000) {
        const fiber = stack.pop();
        if (!fiber || visited.has(fiber)) continue;
        visited.add(fiber);
        for (let hook = fiber.memoizedState; hook; hook = hook.next) {
          const candidate = hook.memoizedState?.editRuntime;
          if (candidate?.grant?.hosts?.length) runtime = candidate;
        }
        if (runtime) break;
        if (fiber.return) stack.push(fiber.return);
        if (fiber.child) stack.push(fiber.child);
        if (fiber.sibling) stack.push(fiber.sibling);
      }
      const active = await window.htmlAIProjects?.getActiveProject?.();
      if (!runtime?.grant?.hosts?.length || !active?.html || !window.htmlAIEditRuntime) {
        return { state: "setup-failed" };
      }
      try {
        await window.htmlAIEditRuntime.prepare({
          contractVersion: 1,
          requestId: "edit-runtime-replay-fence-0001",
          sourceSha256: runtime.sourceSha256,
          html: active.html,
          hosts: runtime.grant.hosts,
          canvasGeneration: runtime.canvasGeneration,
        });
        return { state: "resolved" };
      } catch (cause) {
        return {
          state: "rejected",
          message: String(cause?.message || cause),
        };
      }
    });
    expect(replay).toMatchObject({
      state: "rejected",
      message: "当前画布的运行时准备已经完成。",
    });
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(await documentToken(launched.page)).toBe(runtimeDocument);
    const runtimeCanvasState = await launched.page.locator("[data-persist-state]").first().evaluate(
      (element) => ({
        canvasGeneration: element.getAttribute("data-canvas-generation"),
        editRevision: element.getAttribute("data-edit-revision"),
        persistedRevision: element.getAttribute("data-persisted-revision"),
      }),
    );

    await addCanvasComment(
      launched.page,
      frame,
      "runtime-editable",
      "运行时图表旁的原生评论。",
    );
    expect({
      document: await documentToken(launched.page),
      canvas: await launched.page.locator("[data-persist-state]").first().evaluate(
        (element) => ({
          canvasGeneration: element.getAttribute("data-canvas-generation"),
          editRevision: element.getAttribute("data-edit-revision"),
          persistedRevision: element.getAttribute("data-persisted-revision"),
        }),
      ),
    }).toEqual({ document: runtimeDocument, canvas: runtimeCanvasState });

    const editable = await activateNativeEdit(frame, "runtime-editable");
    await expect(editable).toHaveAttribute("contenteditable", "true");
    await setTextSelection(frame, "runtime-editable", 0);
    await launched.page.keyboard.insertText("原位");
    await expect.poll(() => readFileSync(managedSourcePath, "utf8"))
      .toContain("原位静态来源文字保持可编辑。");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
    await launched.page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(await documentToken(launched.page)).toBe(runtimeDocument);
    expect(frame.isDetached()).toBe(false);
    expect(await frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozenSnapshotCount: document.querySelectorAll(
        "#chart-host img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
    }))).toEqual({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozenSnapshotCount: 0,
      dataImagePngCount: 0,
    });
    expect(readFileSync(managedSourcePath, "utf8")).not.toMatch(
      /data-pageroot-edit-runtime|data-echarts-runtime/u,
    );

    await launched.page.keyboard.press("Escape");
    await expect.poll(async () => (
      await frame.locator(caseSelector("runtime-editable")).getAttribute("contenteditable")
    )).not.toBe("true");
    await launched.page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(await documentToken(launched.page)).toBe(runtimeDocument);
    expect(frame.isDetached()).toBe(false);

    await addCanvasComment(
      launched.page,
      frame,
      "runtime-editable",
      "结束编辑后的精确定位评论。",
    );
    await launched.page.keyboard.press(process.platform === "darwin" ? "Meta+S" : "Control+S");
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(await documentToken(launched.page)).toBe(runtimeDocument);
    expect(frame.isDetached()).toBe(false);
    expect(await frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozenSnapshotCount: document.querySelectorAll(
        "#chart-host img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
    }))).toEqual({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozenSnapshotCount: 0,
      dataImagePngCount: 0,
    });
    expect(workspaceContainsDraftComment(
      launched.workspace,
      "结束编辑后的精确定位评论。",
    )).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-source-e2e-",
    );
  }
});

test("Electron Edit keeps frozen one-shot iframe through structural line-break and sibling reorder", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-structure-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-structure.html");
  const editableText = "静态来源文字保持可编辑。";
  const siblingText = "第二段可移动。";
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>One-shot structural Edit runtime</title></head>
<body>
  <p data-native-case="runtime-editable">${editableText}</p>
  <p data-native-case="runtime-sibling">${siblingText}</p>
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  writeFileSync(path.join(sourceDirectory, "echarts.js"), ECHARTS_STUB, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-editable",
    );
    const activeProject = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()
    ));
    if (typeof activeProject?.sourcePath !== "string") {
      throw new Error("The imported managed Working Copy did not become active.");
    }
    const managedSourcePath = activeProject.sourcePath;
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      bootstrapCount: document.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length,
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozen: "true",
      bootstrapCount: 1,
    });
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    const baseline = {
      document: await documentToken(launched.page),
      canvasGeneration: await launched.page.locator("[data-persist-state]").first()
        .evaluate((element) => element.getAttribute("data-canvas-generation")),
    };

    const editable = await activateNativeEdit(frame, "runtime-editable");
    await expect(editable).toHaveAttribute("contenteditable", "true");
    await setTextSelection(frame, "runtime-editable", editableText.length);
    await launched.page.keyboard.press("Enter");
    await expect.poll(() => editable.evaluate((element) => element.innerHTML))
      .toContain("<br>");
    await launched.page.keyboard.press("Escape");
    await expect.poll(async () => (
      frame.isDetached()
        ? "detached"
        : await frame.locator(caseSelector("runtime-editable")).getAttribute("contenteditable")
    )).not.toBe("true");
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await assertFrozenRuntimeRetained(launched.page, frame, baseline);
    expect(readFileSync(managedSourcePath, "utf8")).toMatch(/<br\s*\/?>/u);

    await frame.locator(caseSelector("runtime-editable")).click();
    const moveDown = launched.page.getByRole("button", { name: "下移" });
    await expect(moveDown).toBeEnabled();
    await moveDown.click();
    await expect.poll(() => readFileSync(managedSourcePath, "utf8")).toMatch(
      new RegExp(`${siblingText}[\\s\\S]*${editableText}`, "u"),
    );
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    await assertFrozenRuntimeRetained(launched.page, frame, baseline);
    expect(readFileSync(managedSourcePath, "utf8")).not.toMatch(
      /data-pageroot-edit-runtime|data-echarts-runtime/u,
    );
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-structure-e2e-",
    );
  }
});

test("Electron Edit keeps frozen author canvas when unused empty hosts have no paint", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-unused-host-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-unused-host.html");
  const runtimeScriptPath = path.join(sourceDirectory, "echarts.js");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Unused empty host Edit runtime</title></head>
<body>
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <div id="data-table"></div>
  <p class="runtime-resource-probe" data-native-case="runtime-unused-host">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  writeFileSync(runtimeScriptPath, `window.echarts = {
  init(host) {
    host.style.userSelect = "none";
    host.style.webkitTapHighlightColor = "rgba(0, 0, 0, 0)";
    host.style.position = "relative";
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 360;
    canvas.dataset.echartsRuntime = "true";
    host.append(canvas);
    return { setOption() { window.__PAGEROOT_ECHARTS_AUTHOR_SETTLED__ = true; } };
  }
};`, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-unused-host",
    );
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      unusedHostPaint: document.querySelectorAll("#data-table canvas, #data-table svg").length,
      frozenSnapshotCount: document.querySelectorAll(
        "img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
      bootstrapCount: document.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length,
      hostCount: document.querySelectorAll("[data-pageroot-edit-runtime-host]").length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      resultState: JSON.parse(
        document.documentElement.getAttribute("data-pageroot-edit-runtime-result") || "null",
      )?.state || null,
      base: document.baseURI,
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      unusedHostPaint: 0,
      frozenSnapshotCount: 0,
      dataImagePngCount: 0,
      bootstrapCount: 1,
      hostCount: 2,
      frozen: "true",
      resultState: "frozen",
      base: expect.stringMatching(/^pageroot-edit-runtime:/u),
    });
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-unused-host-e2e-",
    );
  }
});

test("Electron Edit drains MessageChannel callbacks before accepting the frozen iframe", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-message-channel-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-message-channel.html");
  const probeText = "冻结后源码文字不得被端口改写。";
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>One-shot MessageChannel freeze</title></head>
<body>
  <p data-native-case="runtime-message-probe">${probeText}</p>
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
    const probe = document.querySelector("[data-native-case=runtime-message-probe]");
    const channel = new MessageChannel();
    channel.port2.onmessage = () => {
      if (document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen") === "true") {
        probe.textContent = ["端口在冻结后", "改写了源码文字"].join("");
        return;
      }
      channel.port1.postMessage("ping");
    };
    channel.port1.postMessage("start");
  </script>
</body>
</html>`;
  writeFileSync(path.join(sourceDirectory, "echarts.js"), ECHARTS_STUB, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-message-probe",
    );
    const activeProject = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()
    ));
    if (typeof activeProject?.sourcePath !== "string") {
      throw new Error("The imported managed Working Copy did not become active.");
    }
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      probe: document.querySelector("[data-native-case=runtime-message-probe]")?.textContent || "",
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozen: "true",
      probe: probeText,
    });
    await launched.page.waitForTimeout(800);
    expect(await frame.evaluate(() => (
      document.querySelector("[data-native-case=runtime-message-probe]")?.textContent || ""
    ))).toBe(probeText);
    const savedSource = readFileSync(activeProject.sourcePath, "utf8");
    expect(savedSource).toContain(`data-native-case="runtime-message-probe">${probeText}</p>`);
    expect(savedSource).not.toContain("端口在冻结后改写了源码文字");
    expect(frame.isDetached()).toBe(false);
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-message-channel-e2e-",
    );
  }
});

test("Electron Edit keeps frozen author canvas beside an authored inline PNG", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-authored-png-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-authored-png.html");
  const authoredPng = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>One-shot authored PNG Edit runtime</title></head>
<body>
  <img data-native-case="runtime-authored-png" alt="logo" src="${authoredPng}">
  <main id="chart-host" data-native-case="runtime-chart" style="width: 640px; height: 360px"></main>
  <p data-native-case="runtime-png-editable">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ = (window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0) + 1;
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  writeFileSync(path.join(sourceDirectory, "echarts.js"), ECHARTS_STUB, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    const { frame } = await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-png-editable",
    );
    await expect.poll(() => frame.evaluate(() => ({
      rendererAuthorExecutions: window.__PAGEROOT_ECHARTS_AUTHOR_EXECUTIONS__ || 0,
      chartCount: document.querySelectorAll("#chart-host canvas[data-echarts-runtime=true]").length,
      frozenSnapshotCount: document.querySelectorAll(
        "img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      authoredPngCount: document.querySelectorAll(
        "img[data-native-case=runtime-authored-png]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      resultState: JSON.parse(
        document.documentElement.getAttribute("data-pageroot-edit-runtime-result") || "null",
      )?.state || null,
    })), { timeout: 6_000 }).toMatchObject({
      rendererAuthorExecutions: 1,
      chartCount: 1,
      frozenSnapshotCount: 0,
      authoredPngCount: 1,
      dataImagePngCount: 1,
      frozen: "true",
      resultState: "frozen",
    });
    await expect(launched.page.locator("[data-runtime-bootstrap-count=\"1\"]")).toHaveCount(1);
    expect(frame.isDetached()).toBe(false);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-authored-png-e2e-",
    );
  }
});

test("Electron Edit rejects unsafe ECharts host styling without persisting it", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-rejection-source-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-runtime-rejection.html");
  const runtimeScriptPath = path.join(sourceDirectory, "echarts.js");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Rejected ECharts Edit runtime</title></head>
<body>
  <main id="chart-host" style="width: 640px; height: 360px"></main>
  <p data-native-case="runtime-rejected-editable">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  const sourceSha256 = sha256(source);
  writeFileSync(runtimeScriptPath, `window.echarts = {
  init(host) {
    host.style.position = "fixed";
    const canvas = document.createElement("canvas");
    canvas.dataset.echartsRuntime = "unsafe";
    host.append(canvas);
    return { setOption() {} };
  }
};`, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-rejected-editable",
    );
    // A rejected one-shot frame is replaced by the ordinary static frame; wait
    // beyond the fixed runtime deadline before reading the current iframe.
    await launched.page.waitForTimeout(4_500);
    const frame = await currentEditorFrame(launched.page);
    await expect.poll(() => frame.evaluate(() => ({
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
      result: document.documentElement.getAttribute("data-pageroot-edit-runtime-result"),
      bootstrapCount: document.querySelectorAll("[data-pageroot-edit-runtime-bootstrap]").length,
      runtimeMarkerCount: [...document.querySelectorAll("*")].filter((element) => (
        [...element.attributes].some((attribute) => (
          attribute.name.startsWith("data-pageroot-edit-runtime")
        ))
      )).length,
      canvasCount: document.querySelectorAll("#chart-host canvas").length,
      runtimeCanvasCount: document.querySelectorAll("canvas[data-echarts-runtime]").length,
      hostStyle: document.querySelector("#chart-host").getAttribute("style"),
    })), { timeout: 2_000 }).toMatchObject({
      frozen: null,
      result: null,
      bootstrapCount: 0,
      runtimeMarkerCount: 0,
      canvasCount: 0,
      runtimeCanvasCount: 0,
      hostStyle: expect.stringMatching(/width:\s*640px.*height:\s*360px/u),
    });
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-rejection-source-e2e-",
    );
  }
});

test("Electron Edit records same-origin parent access as an accepted direct-runtime risk", async () => {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-edit-runtime-parent-escape-e2e-"),
  );
  const sourcePath = path.join(sourceDirectory, "echarts-runtime-parent-escape.html");
  const runtimeScriptPath = path.join(sourceDirectory, "echarts.js");
  const source = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>Isolated ECharts runtime</title></head>
<body>
  <main id="chart-host" style="width: 320px; height: 120px"></main>
  <p data-native-case="runtime-isolated-editable">静态来源文字保持可编辑。</p>
  <script src="echarts.js"></script>
  <script>
    const chart = window.echarts.init(document.querySelector("#chart-host"));
    chart.setOption({ series: [] });
  </script>
</body>
</html>`;
  const sourceSha256 = sha256(source);
  writeFileSync(runtimeScriptPath, `window.echarts = {
  init(host) {
    window.parent.document.documentElement.setAttribute("data-pageroot-author-escape", "true");
    const canvas = document.createElement("canvas");
    canvas.width = 320;
    canvas.height = 120;
    canvas.dataset.echartsRuntime = "parent-escape";
    host.append(canvas);
    return { setOption() {} };
  }
};`, "utf8");
  writeFileSync(sourcePath, source, "utf8");

  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(
      launched.page,
      sourcePath,
      "runtime-isolated-editable",
    );
    // Direct one-shot Edit runs in the final visible iframe. Same-origin
    // window.parent access is a known, accepted product risk (ADR 0025) and
    // is not a screenshot-fallback gate. The source file still must not
    // persist runtime descendants or PNG substitutes.
    await launched.page.waitForTimeout(4_500);
    const frame = await currentEditorFrame(launched.page);
    await expect.poll(() => frame.evaluate(() => ({
      runtimeCanvasCount: document.querySelectorAll("canvas[data-echarts-runtime]").length,
      snapshotCount: document.querySelectorAll(
        "img[data-pageroot-edit-runtime-snapshot]",
      ).length,
      dataImagePngCount: document.querySelectorAll('img[src^="data:image/png"]').length,
      frozen: document.documentElement.getAttribute("data-pageroot-edit-runtime-frozen"),
    })), { timeout: 2_000 }).toMatchObject({
      runtimeCanvasCount: 1,
      snapshotCount: 0,
      dataImagePngCount: 0,
      frozen: "true",
    });
    await expect(launched.page.locator(".save-status")).toHaveText("已安全保存");
    const editable = await activateNativeEdit(frame, "runtime-isolated-editable");
    await expect(editable).toHaveAttribute("contenteditable", "true");
    expect(sha256(readFileSync(sourcePath, "utf8"))).toBe(sourceSha256);
    expect(readFileSync(sourcePath, "utf8")).toBe(source);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-edit-runtime-parent-escape-e2e-",
    );
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
    const { editor, frame } = await loadFixture(page, "complex-layout.html");
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

    const toolbar = editor.getByRole("toolbar");
    await page.locator(".comments-panel.comment-rail").click({
      position: { x: 4, y: 4 },
    });
    await expect(toolbar).toHaveCount(0);
    await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
    await expect(frame.locator(caseSelector("heading-inline")))
      .not.toHaveAttribute("contenteditable", "true");

    await activateNativeEdit(frame, "heading-inline");
    await expect(toolbar).toBeVisible();
    await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(1);

    await page.locator(".workbench-header").click({
      position: { x: 720, y: 4 },
    });
    await expect(toolbar).toHaveCount(0);
    await expect(frame.locator("[data-html-canvas-selected]")).toHaveCount(0);
    await expect(frame.locator(caseSelector("heading-inline")))
      .not.toHaveAttribute("contenteditable", "true");
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

test("Electron rapid project switching and immediate close preserve the last native edit", async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("close-switch-a.html");
  const projectB = createSourceFixture("close-switch-b.html");
  const firstLaunch = await launchPageRoot({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
  });
  let firstClosed = false;
  let reopened = null;
  try {
    const switchedText = "快速切换仍然安全写回";
    const closeText = "关闭前最后一次原位编辑";
    let { frame } = await loadedDiskFrame(
      firstLaunch.page,
      projectA.sourcePath,
      "list-item",
    );
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_LIST_TEXT.length);
    await firstLaunch.page.keyboard.insertText(switchedText);
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(switchedText);
    const projectAWorkingCopyPath = await managedWorkingCopyPath(
      firstLaunch.page,
      projectA.sourcePath,
    );

    await firstLaunch.page.getByRole("button", { name: "项目", exact: true }).click();
    await firstLaunch.page.locator(".recent-file-row")
      .filter({ hasText: "close-switch-b.html" })
      .click();
    await loadedDiskFrame(firstLaunch.page, projectB.sourcePath, "list-item");
    await expect.poll(
      () => readFileSync(projectAWorkingCopyPath, "utf8"),
      { timeout: 20_000 },
    ).toContain(switchedText);
    expect(readFileSync(projectA.sourcePath, "utf8")).not.toContain(switchedText);

    ({ frame } = await openRecentProject(
      firstLaunch.page,
      projectAWorkingCopyPath,
      "list-item",
      path.basename(projectA.sourcePath),
    ));
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(switchedText);
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, switchedText.length);
    await firstLaunch.page.keyboard.insertText(closeText);
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(closeText);

    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);
    firstClosed = true;
    reopened = await launchPageRoot({
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    const { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      projectAWorkingCopyPath,
      "list-item",
    );
    await expect(reopenedFrame.locator(caseSelector("list-item")))
      .toHaveText(closeText);
    expect(readFileSync(projectAWorkingCopyPath, "utf8")).toContain(closeText);
    expect(readFileSync(projectA.sourcePath, "utf8")).not.toContain(closeText);
  } finally {
    if (reopened) {
      await stopPageRoot(reopened.electronApp, reopened.isolatedUserData);
    } else if (!firstClosed) {
      await stopPageRoot(
        firstLaunch.electronApp,
        firstLaunch.isolatedUserData,
      );
    } else {
      removeIsolatedUserData(firstLaunch.isolatedUserData);
    }
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("project resources drain edited rules before leaving", async () => {
  const fixture = createSourceFixture("project-resources.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const { frame } = await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const projectCount = () => {
      const projectsRoot = path.join(path.dirname(launched.workspace), "project-files");
      return existsSync(projectsRoot)
        ? readdirSync(projectsRoot).filter((entry) => !entry.startsWith(".")).length
        : 0;
    };
    expect(projectCount()).toBe(1);
    await addCanvasComment(
      launched.page,
      frame,
      "list-item",
      "创建受管项目后再编辑项目资料。",
    );
    const managedSourcePath = await managedWorkingCopyPath(launched.page, fixture.sourcePath);
    await loadedDiskFrame(launched.page, managedSourcePath, "list-item");
    const projectRoot = path.dirname(managedSourcePath);
    expect(projectCount()).toBe(1);
    await launched.page.getByRole("button", { name: "项目", exact: true }).click();
    expect(projectCount()).toBe(1);
    await launched.page.getByText("项目资料", { exact: true }).click();
    const rulesButton = launched.page.getByRole("button", {
      name: /项目长期规则.*以后每次 AI 修改都会读取.*可编辑/u,
    });
    await expect(rulesButton).toBeVisible();
    await expect(launched.page.getByRole("button", {
      name: /项目记录文件夹.*查看每轮要求、AI 返回与历史文件.*在文件夹中打开/u,
    })).toBeVisible();
    await rulesButton.click();
    await expect(launched.page.getByText("管理 AI 修改规则", { exact: true }))
      .toBeVisible();
    await expect(launched.page.getByText(
      "修改会自动保存。每次发送至 Qoder 时，源页都会把这份规则与本轮要求一起交接；规则只影响后续任务，不会修改当前 HTML。",
      { exact: true },
    )).toBeVisible();
    const rulesEditor = launched.page.getByRole("textbox", { name: "项目长期规则" });
    await expect(rulesEditor).toBeEnabled();
    const originalRules = await rulesEditor.inputValue();
    const updatedRules = `${originalRules}\n\n- 测试自动保存保护`;
    await rulesEditor.fill(updatedRules);
    await launched.page.getByRole("button", { name: "返回项目" }).click();
    await expect(launched.page.getByText("当前文件", { exact: true })).toBeVisible();
    const projectRulesPath = path.join(projectRoot, "PROJECT.md");
    await expect.poll(
      () => readFileSync(projectRulesPath, "utf8"),
      { timeout: 20_000 },
    ).toBe(updatedRules);

    await launched.page.getByText("项目资料", { exact: true }).click();
    await rulesButton.click();
    await expect(rulesEditor).toHaveValue(updatedRules);
    await rulesEditor.fill(`${updatedRules}\n- 这行只用于验证还原`);
    await launched.page.getByRole("button", { name: "还原修改" }).click();
    await expect(rulesEditor).toHaveValue(updatedRules);
    await launched.page.getByRole("button", { name: "返回项目" }).click();
    await expect(launched.page.getByText("当前文件", { exact: true })).toBeVisible();
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("multiple orphaned comments relink in sequence and resume the original send", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("orphaned-comments-resume-send.html");
  const firstLaunch = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  const firstComment = "把原列表项改成更简洁的表达。";
  const secondComment = "把原表格单元格改成更清楚的说明。";
  let activeLaunch = firstLaunch;
  let firstAppClosed = false;
  try {
    const { frame: firstCommentFrame } = await loadedDiskFrame(
      firstLaunch.page,
      fixture.sourcePath,
      "list-item",
    );
    await addCanvasComment(
      firstLaunch.page,
      firstCommentFrame,
      "list-item",
      firstComment,
    );
    const managedSourcePath = await managedWorkingCopyPath(
      firstLaunch.page,
      fixture.sourcePath,
    );
    const { frame: secondCommentFrame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "table-cell",
    );
    await addCanvasComment(
      firstLaunch.page,
      secondCommentFrame,
      "table-cell",
      secondComment,
    );
    const { frame: editingFrame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "list-item",
    );

    await activateNativeEdit(editingFrame, "list-item");
    await setTextSelection(editingFrame, "list-item", 0, ORIGINAL_LIST_TEXT.length);
    await firstLaunch.page.keyboard.insertText("失联评论登记测试");
    await expect.poll(
      () => workspaceContainsDraftComment(firstLaunch.workspace, secondComment),
      { timeout: 20_000 },
    ).toBe(true);
    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);
    firstAppClosed = true;

    const externallyChanged = readFileSync(managedSourcePath, "utf8")
      .replace(
        /<li data-native-case="list-item"[^>]*>[\s\S]*?<\/li>/u,
        "",
      )
      .replace(
        /<td data-native-case="table-cell"[^>]*>[\s\S]*?<\/td>/u,
        "",
      );
    writeFileSync(managedSourcePath, externallyChanged, "utf8");

    activeLaunch = await launchPageRoot({
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    const { frame: recoveredFrame } = await loadedDiskFrame(
      activeLaunch.page,
      managedSourcePath,
      "flex-copy",
    );
    const recoveredComments = activeLaunch.page.locator(".comment-card");
    await expect(recoveredComments).toHaveCount(2);
    await expect(recoveredComments.filter({ hasText: firstComment }))
      .toHaveAttribute("data-resolution", "orphaned");
    await expect(recoveredComments.filter({ hasText: secondComment }))
      .toHaveAttribute("data-resolution", "orphaned");

    await activeLaunch.page.getByRole("button", { name: /发给 AI/u }).click();
    await expect(activeLaunch.page.getByText("2 条评论需要重新定位", { exact: true }))
      .toBeVisible();
    await activeLaunch.page.getByRole("button", { name: "开始重新定位" }).click();

    await recoveredFrame.locator(caseSelector("flex-copy")).click();
    await expect(activeLaunch.page.getByText("1 条评论需要重新定位", { exact: true }))
      .toBeVisible();
    await expect(recoveredComments.filter({ hasText: firstComment }))
      .toHaveAttribute("data-resolution", "exact");
    await expect(recoveredComments.filter({ hasText: secondComment }))
      .toHaveAttribute("data-resolution", "orphaned");

    await recoveredFrame.locator(caseSelector("grid-card")).click();
    await expect(activeLaunch.page.getByText(
      "等待 AI 返回结果",
      { exact: true },
    )).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => requestDirectoryCount(activeLaunch.workspace),
      { timeout: 20_000 },
    ).toBe(1);
  } finally {
    if (activeLaunch !== firstLaunch) {
      await stopPageRoot(activeLaunch.electronApp, firstLaunch.isolatedUserData);
    } else if (!firstAppClosed) {
      await stopPageRoot(firstLaunch.electronApp, firstLaunch.isolatedUserData);
    } else {
      removeIsolatedUserData(firstLaunch.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("automatic update actions keep the header geometry and About lifecycle", async () => {
  const fixture = createSourceFixture("update-indicator.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const captureHeader = async ({ badgeExpected = true } = {}) => {
      const geometry = await launched.page.evaluate(() => {
        const rect = (selector) => {
          const element = document.querySelector(selector);
          if (!element) return null;
          const box = element.getBoundingClientRect();
          return {
            left: box.left,
            top: box.top,
            right: box.right,
            bottom: box.bottom,
            width: box.width,
            height: box.height,
          };
        };
        return {
          header: rect(".workbench-header"),
          cluster: rect(".window-file-icon-cluster"),
          icon: rect(".window-file-about-button"),
          badge: rect(".window-file-update-badge"),
          badgeLabel: rect(".window-file-update-badge > span"),
          fileCopy: rect(".window-file-copy"),
        };
      });
      expect(geometry.header).not.toBeNull();
      expect(geometry.cluster).not.toBeNull();
      expect(geometry.icon).not.toBeNull();
      expect(geometry.fileCopy).not.toBeNull();
      expect(Math.abs(
        (geometry.icon.top + geometry.icon.bottom) / 2
        - (geometry.cluster.top + geometry.cluster.bottom) / 2,
      )).toBeLessThanOrEqual(0.5);
      if (badgeExpected) {
        expect(geometry.badge).not.toBeNull();
        expect(geometry.badgeLabel).not.toBeNull();
        expect(geometry.badgeLabel.top).toBeGreaterThanOrEqual(
          geometry.header.top,
        );
        expect(geometry.badgeLabel.bottom).toBeLessThanOrEqual(
          geometry.header.bottom,
        );
        expect(geometry.badgeLabel.right).toBeLessThanOrEqual(
          geometry.fileCopy.left - 8,
        );
        expect(geometry.badgeLabel.top).toBeLessThan(geometry.icon.bottom);
      } else {
        expect(geometry.badge).toBeNull();
        expect(geometry.badgeLabel).toBeNull();
      }
      return geometry;
    };

    const noUpdateGeometry = await captureHeader({ badgeExpected: false });
    const updateStatus = {
      currentVersion: "0.8.6",
      latestVersion: "9.9.9",
      minimumMacOS: "12.0",
      architecture: "arm64",
      publishedAt: "2026-07-23T00:00:00.000Z",
    };
    await sendToMainRenderer(
      launched.electronApp,
      launched.page,
      "html-updates:status",
      { ...updateStatus, status: "available" },
    );
    await expect(launched.page.getByRole("button", {
      name: "发现 PageRoot 9.9.9，下载更新",
    })).toBeVisible();
    const availableGeometry = await captureHeader();

    await launched.page.getByRole("button", { name: "关于源页" }).click();
    await expect(launched.page.getByRole("dialog", { name: "源页" }))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "关闭关于源页" }).click();
    await expect(launched.page.locator("dialog.about-dialog[open]"))
      .toHaveCount(0);

    await sendToMainRenderer(
      launched.electronApp,
      launched.page,
      "html-updates:status",
      { ...updateStatus, status: "downloaded" },
    );
    await expect(launched.page.getByRole("button", {
      name: "PageRoot 9.9.9 已下载，重启更新",
    })).toBeVisible();
    await expect(launched.page.getByRole("dialog", {
      name: "现在重启并安装更新？",
    })).toBeVisible();
    await launched.page.getByRole("button", { name: "稍后" }).click();
    await expect(launched.page.locator("dialog.restart-update-dialog[open]"))
      .toHaveCount(0);
    const downloadedGeometry = await captureHeader();
    for (const geometry of [availableGeometry, downloadedGeometry]) {
      expect(geometry.icon).toEqual(noUpdateGeometry.icon);
      expect(geometry.cluster).toEqual(noUpdateGeometry.cluster);
      expect(geometry.fileCopy).toEqual(noUpdateGeometry.fileCopy);
    }
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
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
    const { frame } = await loadedDiskFrame(launched.page, sourcePath, "list-item");
    await addCanvasComment(
      launched.page,
      frame,
      "list-item",
      "创建受管项目以验证项目规则读取失败。",
    );
    const managedSourcePath = await managedWorkingCopyPath(launched.page, sourcePath);
    await loadedDiskFrame(launched.page, managedSourcePath, "list-item");

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
    const mainRendererUrl = launched.page.url();
    await launched.electronApp.evaluate(({ BrowserWindow }, rendererUrl) => {
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL() === rendererUrl
      ));
      if (!mainWindow) {
        throw new Error("PageRoot main BrowserWindow is unavailable for workspace recovery.");
      }
      mainWindow.webContents.send(
        "html-app:workspace-unavailable",
        {
          title: "本地项目资料暂时不可用",
          message: "当前页面内容仍保留。可先导出当前编辑，再重新打开源页。",
        },
      );
    }, mainRendererUrl);

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

test("Electron migrates an exact legacy V4 Registry before opening an editable, commentable external V1", async () => {
  test.setTimeout(120_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "旧Registry迁移后的编辑";
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  const sourcePath = path.join(sourceDirectory, "legacy-registry-opening.html");
  const seedSourcePath = path.join(sourceDirectory, "legacy-registry-seed.html");
  writeFileSync(sourcePath, original);
  writeFileSync(seedSourcePath, original);

  const projectsRoot = path.join(isolatedUserData, "project-files");
  const seedRepository = new ProjectFileRepository({ projectsRoot });
  await seedRepository.importExternal({
    sourcePath: seedSourcePath,
    expectedSourceSha256: sha256(original),
  });
  const registryPath = path.join(projectsRoot, ".pageroot-registry.json");
  const currentRegistry = JSON.parse(readFileSync(registryPath, "utf8"));
  const legacyRegistry = {
    schemaVersion: "4.0.0",
    updatedAt: currentRegistry.updatedAt,
    projects: Object.fromEntries(Object.entries(currentRegistry.projects).map(([projectId, record]) => [
      projectId,
      {
        projectRootPath: record.registeredProjectRootPath,
        updatedAt: record.updatedAt,
      },
    ])),
  };
  const legacyRegistryBytes = Buffer.from(
    `${JSON.stringify(legacyRegistry, null, 2)}\n`,
    "utf8",
  );
  const legacyRegistrySha256 = sha256(legacyRegistryBytes);
  writeFileSync(registryPath, legacyRegistryBytes);

  let firstApp = null;
  let reopenedApp = null;
  try {
    const firstLaunch = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    firstApp = firstLaunch.electronApp;
    const managedSourcePath = await managedWorkingCopyPath(firstLaunch.page, sourcePath);
    let { frame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "source-fidelity",
    );
    await expect(firstLaunch.page.locator("main.workbench"))
      .toHaveAttribute("data-project-state", "ready");
    await expect(firstLaunch.page.locator(".save-status"))
      .toContainText("已安全保存");
    await expect(firstLaunch.page.getByRole("button", { name: "全局评论", exact: true }))
      .toBeEnabled();
    const migratedRegistry = JSON.parse(readFileSync(registryPath, "utf8"));
    expect(migratedRegistry.pendingImports).toEqual({});
    const backupPath = path.join(
      projectsRoot,
      ".pageroot-registry-backups",
      `${legacyRegistrySha256.slice("sha256:".length)}.json`,
    );
    expect(readFileSync(backupPath)).toEqual(legacyRegistryBytes);
    expect(readFileSync(sourcePath)).toEqual(original);

    const firstComment = "旧 Registry 已迁移，评论定位正常。";
    await addCanvasComment(firstLaunch.page, frame, "source-fidelity", firstComment);
    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await firstLaunch.page.keyboard.insertText(replacement);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(firstLaunch.page, 0);
    await expect(firstLaunch.page.locator(".save-status"))
      .toContainText("已安全保存");
    expect(readFileSync(sourcePath)).toEqual(original);
    expect(managedSourcePath).not.toBe(realpathSync(sourcePath));
    expect(readFileSync(managedSourcePath, "utf8")).toContain(replacement);

    await closePageRootGracefully(firstApp, firstLaunch.page);
    firstApp = null;

    const reopened = await launchPageRoot({ isolatedUserData });
    reopenedApp = reopened.electronApp;
    const { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      managedSourcePath,
      "source-fidelity",
    );
    await expect(reopened.page.locator("main.workbench"))
      .toHaveAttribute("data-project-state", "ready");
    await expect(reopened.page.locator(".save-status"))
      .toContainText("已安全保存");
    await activateNativeEdit(reopenedFrame, "source-fidelity");
    await addCanvasComment(
      reopened.page,
      reopenedFrame,
      "source-fidelity",
      "重开后仍可定位并评论。",
    );
    expect(readFileSync(sourcePath)).toEqual(original);
    expect(readFileSync(managedSourcePath, "utf8")).toContain(replacement);

    await closePageRootGracefully(reopenedApp, reopened.page);
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
    const managedSourcePath = await managedWorkingCopyPath(
      firstLaunch.page,
      sourcePath,
    );
    let { frame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
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
      readFileSync(managedSourcePath).equals(expected),
      "checkpoint/autosave must write only the authorized V1 bytes",
    ).toBe(true);
    expect(readFileSync(sourcePath)).toEqual(original);

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

    await closePageRootGracefully(firstApp, firstLaunch.page);
    firstApp = null;

    const reopened = await launchPageRoot({ isolatedUserData });
    reopenedApp = reopened.electronApp;
    const { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      managedSourcePath,
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
    expect(readFileSync(sourcePath)).toEqual(original);
    expect(readFileSync(managedSourcePath).equals(expected)).toBe(true);

    await closePageRootGracefully(reopenedApp, reopened.page);
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

test("Electron keeps V1 autosave separate from focused-field undo", async () => {
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
  try {
    const firstLaunch = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    firstApp = firstLaunch.electronApp;
    const managedSourcePath = await managedWorkingCopyPath(
      firstLaunch.page,
      sourcePath,
    );
    const { frame } = await loadedDiskFrame(
      firstLaunch.page,
      managedSourcePath,
      "source-fidelity",
    );
    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await firstLaunch.page.keyboard.insertText(replacement);
    await firstLaunch.page.keyboard.press(keyShortcut("S"));
    await expectCheckpointPersisted(
      firstLaunch.page,
      0,
    );
    expect(readFileSync(managedSourcePath).equals(expected)).toBe(true);
    expect(readFileSync(sourcePath)).toEqual(original);

    await firstLaunch.page.getByRole("button", { name: "全局评论" }).click();
    const commentInput = firstLaunch.page.getByRole("textbox", {
      name: "评论内容",
    });
    await commentInput.fill("原文");
    await commentInput.focus();
    await firstLaunch.page.keyboard.press("End");
    await firstLaunch.page.keyboard.insertText("新增");
    await expect(commentInput).toHaveValue("原文新增");
    await clickEditHistoryMenu(firstApp, firstLaunch.page, "undo");
    await expect(commentInput).toHaveValue("原文");
    expect(
      readFileSync(managedSourcePath).equals(expected),
      "native comment undo must not touch the managed V1",
    ).toBe(true);

    const manifest = JSON.parse(readFileSync(
      path.join(path.dirname(managedSourcePath), ".pageroot", "manifest.json"),
      "utf8",
    ));
    expect(manifest.versions.map((version) => version.versionId)).toEqual(["ver_0001"]);
    expect(readFileSync(sourcePath)).toEqual(original);

    await closePageRootGracefully(firstApp, firstLaunch.page);
    firstApp = null;
  } finally {
    if (firstApp) await stopPageRoot(firstApp, isolatedUserData, { cleanup: false });
    removeIsolatedUserData(isolatedUserData);
    removeValidatedTemporaryDirectory(
      sourceDirectory,
      "pageroot-native-source-e2e-",
    );
  }
});

test("Electron keeps the active text selection and comment anchors stable after V1 autosave", async () => {
  test.setTimeout(90_000);
  const sourceDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-source-e2e-"));
  const sourcePath = path.join(sourceDirectory, "history-selection-comments.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "无感撤回";
  const tallFixture = fixtureBuffer("source-fidelity.html")
    .toString("utf8")
    .replace(
      "</body>",
      "  <div aria-hidden='true' style='height: 1200px'></div>\n</body>",
    );
  const original = withBomAndCrLf(Buffer.from(tallFixture, "utf8"));
  writeFileSync(sourcePath, original);

  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-"));
  let electronApp = null;
  try {
    const launched = await launchPageRoot({
      isolatedUserData,
      activeSourcePath: sourcePath,
    });
    electronApp = launched.electronApp;
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      sourcePath,
    );
    let { frame } = await loadedDiskFrame(
      launched.page,
      managedSourcePath,
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
    await expectCheckpointPersisted(launched.page, 0);
    frame = await currentEditorFrame(launched.page);
    await expect.poll(() => nativeEditingState(frame, "source-fidelity"))
      .toMatchObject({
        targetIsActive: true,
        activeCase: "source-fidelity",
        selectionInside: true,
      });

    const reviewStage = launched.page.locator(".review-scroll-stage");
    await expect.poll(() => reviewStage.evaluate((element) => (
      element.scrollHeight - element.clientHeight
    ))).toBeGreaterThan(240);
    await reviewStage.evaluate((element) => {
      element.scrollTop = 240;
    });
    await expect.poll(() => reviewStage.evaluate((element) => element.scrollTop))
      .toBe(240);

    await commentCard.evaluate((element) => {
      element.setAttribute("data-history-qa-card", "true");
      window.__PAGEROOT_HISTORY_VISUAL_SAMPLES__ = [];
      window.__PAGEROOT_HISTORY_VISUAL_SAMPLING__ = true;
      const initialEditor = document.querySelector('[data-testid="html-canvas-editor"]');
      window.__PAGEROOT_HISTORY_FRAME__ = initialEditor?.querySelector("iframe") || null;
      const sample = () => {
        const card = document.querySelector('[data-history-qa-card="true"]');
        const editor = document.querySelector('[data-testid="html-canvas-editor"]');
        const frame = editor?.querySelector("iframe") || null;
        const stage = document.querySelector(".review-scroll-stage");
        window.__PAGEROOT_HISTORY_VISUAL_SAMPLES__.push(card && editor && frame && stage
          ? {
              top: card.getBoundingClientRect().top,
              resolution: card.getAttribute("data-resolution"),
              recovery: card.textContent.includes("原位置已变化"),
              sameFrame: frame === window.__PAGEROOT_HISTORY_FRAME__,
              generation: frame.getAttribute("data-frame-generation"),
              verified: editor.getAttribute("data-render-verified"),
              visibility: getComputedStyle(frame).visibility,
              scrollTop: stage.scrollTop,
            }
          : null);
        if (window.__PAGEROOT_HISTORY_VISUAL_SAMPLING__) {
          requestAnimationFrame(sample);
        }
      };
      requestAnimationFrame(sample);
    });

    await launched.page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    expect(readFileSync(managedSourcePath, "utf8")).toContain(replacement);
    expect(readFileSync(sourcePath)).toEqual(original);
    frame = await currentEditorFrame(launched.page);
    await expect.poll(() => nativeEditingState(frame, "source-fidelity"))
      .toMatchObject({
        targetIsActive: true,
        contenteditable: "true",
        activeCase: "source-fidelity",
        selectionInside: true,
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
    expect(visualSamples.every((sample) => (
      sample.sameFrame
      && sample.verified === "true"
      && sample.visibility === "visible"
    ))).toBe(true);
    expect(new Set(visualSamples.map((sample) => sample.generation)).size).toBe(1);
    const sampledTops = visualSamples.map((sample) => sample.top);
    expect(Math.max(...sampledTops) - Math.min(...sampledTops))
      .toBeLessThanOrEqual(2);
    const sampledScrollTops = visualSamples.map((sample) => sample.scrollTop);
    expect(Math.max(...sampledScrollTops) - Math.min(...sampledScrollTops))
      .toBeLessThanOrEqual(1);
    expect(sampledScrollTops.every((scrollTop) => scrollTop === 240)).toBe(true);
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
    const managedSourcePath = await managedWorkingCopyPath(
      firstLaunch.page,
      sourcePath,
    );
    expect(
      readFileSync(sourcePath).equals(original),
      "the caller-owned HTML must remain byte-for-byte unchanged after V1 import",
    ).toBe(true);
    expect(
      readFileSync(managedSourcePath).equals(expected),
      "boundary IME commit must persist only the left-affinity island change in V1",
    ).toBe(true);

    await expect.poll(() => frame.locator(caseSelector("heading-inline")).innerHTML())
      .toContain("你好<em");

    await closePageRootGracefully(firstApp, firstLaunch.page);
    firstApp = null;
    const projectRoot = path.dirname(managedSourcePath);
    const manifest = JSON.parse(
      readFileSync(path.join(projectRoot, ".pageroot", "manifest.json"), "utf8"),
    );
    const workingCopy = manifest.workingCopies.find(
      (entry) => entry.workingCopyId === "work_ver_0001",
    );
    expect(manifest.versions.map((entry) => entry.versionId)).toEqual(["ver_0001"]);
    expect(workingCopy).toBeTruthy();
    const draft = JSON.parse(
      readFileSync(
        path.join(
          projectRoot,
          ".pageroot",
          "drafts",
          `${workingCopy.workingCopyId}.json`,
        ),
        "utf8",
      ),
    );
    const runtimeState = JSON.parse(
      readFileSync(path.join(projectRoot, ".pageroot", "runtime-state.json"), "utf8"),
    );
    expect(draft.draftRevision).toBeGreaterThan(0);
    expect(draft.changeEvents.length).toBeGreaterThan(0);
    expect(runtimeState.activeWorkingCopyId).toBe(workingCopy.workingCopyId);
    const reopened = await launchPageRoot({ isolatedUserData });
    reopenedApp = reopened.electronApp;
    const { frame: reopenedFrame } = await loadedDiskFrame(
      reopened.page,
      managedSourcePath,
      "heading-inline",
    );
    const reopenedHtml = await reopenedFrame.locator(
      caseSelector("heading-inline"),
    ).innerHTML();
    expect(reopenedHtml).toContain("你好<em");
    expect(reopenedHtml).not.toContain("<i>");
    expect(readFileSync(sourcePath).equals(original)).toBe(true);
    expect(readFileSync(managedSourcePath).equals(expected)).toBe(true);

    await closePageRootGracefully(reopenedApp, reopened.page);
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

function comparableDesktopPath(value) {
  const resolved = path.resolve(String(value || "")).normalize("NFC");
  if (resolved === "/private/var" || resolved.startsWith("/private/var/")) {
    return resolved.slice("/private".length);
  }
  if (resolved === "/private/tmp" || resolved.startsWith("/private/tmp/")) {
    return resolved.slice("/private".length);
  }
  return resolved;
}

function sameDesktopSourcePath(left, right) {
  return comparableDesktopPath(left) === comparableDesktopPath(right);
}

function titleStemLocator(page) {
  return page.locator(".window-file-title-row strong").first();
}

async function waitForTitleStem(page, stem) {
  await expect(titleStemLocator(page)).toHaveText(stem, { timeout: 30_000 });
}

async function waitForActiveSourcePath(page, expectedPath) {
  await expect.poll(async () => {
    try {
      const active = await page.evaluate(() => (
        window.htmlAIProjects?.getActiveProject()
      ));
      return sameDesktopSourcePath(active?.sourcePath, expectedPath);
    } catch {
      return false;
    }
  }).toBe(true);
}

async function waitForDesktopActivePath(isolatedUserData, expectedPath) {
  await expect.poll(async () => {
    try {
      const state = await readDesktopProjectState(isolatedUserData);
      return sameDesktopSourcePath(state.activePath, expectedPath);
    } catch {
      return false;
    }
  }, { timeout: 30_000 }).toBe(true);
}

async function readDesktopProjectState(isolatedUserData) {
  return JSON.parse(readFileSync(
    path.join(isolatedUserData, "html-projects.json"),
    "utf8",
  ));
}

async function readManagedManifest(sourcePath) {
  return JSON.parse(readFileSync(
    path.join(path.dirname(sourcePath), ".pageroot", "manifest.json"),
    "utf8",
  ));
}

test("Electron follows a same-directory Finder rename then a title-bar rename", async () => {
  const fixture = createSourceFixture("finder-rename-sync.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(
      launched.page,
      fixture.sourcePath,
      "list-item",
    );
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const beforeIds = {
      projectId: beforeTarget.projectId,
      documentId: beforeTarget.documentId,
      workingCopyId: beforeTarget.workingCopyId || beforeTarget.activeWorkingCopyId,
      versionId: beforeTarget.versionId
        || beforeTarget.currentExactVersionId
        || beforeTarget.currentBasedOnVersionId,
    };
    const beforeManifest = await readManagedManifest(managedSourcePath);
    const beforeVersionCount = beforeManifest.versions.length;
    const finderName = "Finder 新名字-V1.html";
    const finderPath = path.join(path.dirname(managedSourcePath), finderName);
    renameSync(managedSourcePath, finderPath);

    await waitForTitleStem(launched.page, path.basename(finderName, ".html"));
    await waitForActiveSourcePath(launched.page, finderPath);
    const { frame } = await loadedDiskFrame(
      launched.page,
      finderPath,
      "list-item",
    );

    const afterWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderPath)}`,
    );
    const afterTarget = afterWorkspace.body?.openTarget || afterWorkspace.body;
    expect(afterTarget.projectId).toBe(beforeIds.projectId);
    expect(afterTarget.documentId).toBe(beforeIds.documentId);
    expect(afterTarget.workingCopyId || afterTarget.activeWorkingCopyId)
      .toBe(beforeIds.workingCopyId);
    expect(
      afterTarget.versionId
      || afterTarget.currentExactVersionId
      || afterTarget.currentBasedOnVersionId,
    ).toBe(beforeIds.versionId);
    const desktopState = await readDesktopProjectState(isolatedUserData);
    expect(sameDesktopSourcePath(desktopState.activePath, finderPath)).toBe(true);
    expect(sameDesktopSourcePath(desktopState.recent[0].path, finderPath)).toBe(true);
    expect(sameDesktopSourcePath(
      desktopState.activeManagedLocator.sourcePath,
      finderPath,
    )).toBe(true);
    const afterManifest = await readManagedManifest(finderPath);
    expect(afterManifest.versions.length).toBe(beforeVersionCount);
    expect(afterManifest.workingCopies[0].sourceRelativePath).toBe(finderName);

    const beforeRevision = Number(
      await launched.page.locator("[data-persist-state]").first()
        .getAttribute("data-persisted-revision"),
    );
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, 0);
    await launched.page.keyboard.insertText("定位后仍可编辑。");
    await launched.page.keyboard.press("Escape");
    await expectCheckpointPersisted(launched.page, beforeRevision);
    expect(readFileSync(finderPath, "utf8")).toContain("定位后仍可编辑。");
    expect(readFileSync(finderPath, "utf8")).toContain(ORIGINAL_LIST_TEXT);
    await addCanvasComment(
      launched.page,
      await currentEditorFrame(launched.page),
      "list-item",
      "Finder 改名后评论仍保留。",
    );

    await launched.page.getByRole("button", { name: /重命名文件/u }).click();
    const renameInput = launched.page.getByRole("textbox", { name: "文件名（不含后缀）" });
    await expect(renameInput).toBeFocused();
    await renameInput.fill("pageroot-renamed-V1");
    await renameInput.press("Enter");
    const pagerootPath = path.join(
      path.dirname(finderPath),
      "pageroot-renamed-V1.html",
    );
    await waitForTitleStem(launched.page, "pageroot-renamed-V1");
    await expect.poll(() => existsSync(pagerootPath)).toBe(true);
    const finalManifest = await readManagedManifest(pagerootPath);
    expect(finalManifest.versions.length).toBe(beforeVersionCount);
    expect(readFileSync(pagerootPath, "utf8")).toContain("定位后仍可编辑。");
    await expect(launched.page.locator(".comment-card").filter({
      hasText: "Finder 改名后评论仍保留。",
    })).toHaveCount(1);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron follows a title-bar rename, then Finder, then another title-bar rename", async () => {
  const fixture = createSourceFixture("title-bar-finder-loop.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const beforeIds = {
      projectId: beforeTarget.projectId,
      documentId: beforeTarget.documentId,
      workingCopyId: beforeTarget.workingCopyId || beforeTarget.activeWorkingCopyId,
    };
    const projectDirectory = path.dirname(managedSourcePath);

    await launched.page.getByRole("button", { name: /重命名文件/u }).click();
    const firstInput = launched.page.getByRole("textbox", { name: "文件名（不含后缀）" });
    await expect(firstInput).toBeFocused();
    await firstInput.fill("title-first-V1");
    await firstInput.press("Enter");
    const titleBarPath = path.join(projectDirectory, "title-first-V1.html");
    await waitForTitleStem(launched.page, "title-first-V1");
    await expect.poll(() => existsSync(titleBarPath)).toBe(true);
    await waitForActiveSourcePath(launched.page, titleBarPath);
    await expect(launched.page.locator("#window-file-rename-error")).toHaveCount(0);

    const finderName = "finder-second-V1.html";
    const finderPath = path.join(projectDirectory, finderName);
    renameSync(titleBarPath, finderPath);
    await waitForTitleStem(launched.page, path.basename(finderName, ".html"));
    await waitForActiveSourcePath(launched.page, finderPath);
    await expect(launched.page.locator("#window-file-rename-error")).toHaveCount(0);

    await launched.page.getByRole("button", { name: /重命名文件/u }).click();
    const secondInput = launched.page.getByRole("textbox", { name: "文件名（不含后缀）" });
    await expect(secondInput).toBeFocused();
    await expect(secondInput).toHaveValue("finder-second-V1");
    await secondInput.fill("title-third-V1");
    await secondInput.press("Enter");
    const finalPath = path.join(projectDirectory, "title-third-V1.html");
    await waitForTitleStem(launched.page, "title-third-V1");
    await expect.poll(() => existsSync(finalPath)).toBe(true);
    await waitForActiveSourcePath(launched.page, finalPath);
    await expect(launched.page.locator("#window-file-rename-error")).toHaveCount(0);

    const afterWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(finalPath)}`,
    );
    const afterTarget = afterWorkspace.body?.openTarget || afterWorkspace.body;
    expect(afterTarget.projectId).toBe(beforeIds.projectId);
    expect(afterTarget.documentId).toBe(beforeIds.documentId);
    expect(afterTarget.workingCopyId || afterTarget.activeWorkingCopyId)
      .toBe(beforeIds.workingCopyId);
    const afterManifest = await readManagedManifest(finalPath);
    expect(afterManifest.workingCopies[0].sourceRelativePath)
      .toBe("title-third-V1.html");
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron keeps PageRoot bytes when Finder renames and edits the same file", async () => {
  const fixture = createSourceFixture("finder-rename-conflict.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const finderPath = path.join(
      path.dirname(managedSourcePath),
      "finder-conflict-V1.html",
    );
    const original = readFileSync(managedSourcePath);
    renameSync(managedSourcePath, finderPath);
    writeFileSync(finderPath, `${original.toString("utf8")}\n<!-- finder-external -->\n`, "utf8");

    await waitForTitleStem(launched.page, "finder-conflict-V1");
    await waitForActiveSourcePath(launched.page, finderPath);
    await expect.poll(async () => (
      launched.page.locator("[data-persist-state]").first().getAttribute("data-persist-state")
    )).toBe("conflict");
    expect(readFileSync(finderPath, "utf8")).toContain("finder-external");
    const editorFrame = await currentEditorFrame(launched.page);
    await expect(editorFrame.locator(caseSelector("list-item")))
      .toContainText(ORIGINAL_LIST_TEXT);
    expect(await editorFrame.locator("body").innerHTML()).not.toContain("finder-external");
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Desktop fails closed when the Working Copy is replaced between Bridge reconcile and Desktop read", async () => {
  const fixture = createSourceFixture("reconcile-hash-race.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({
      activeSourcePath: fixture.sourcePath,
      injectedEnv: { PAGEROOT_E2E_RECONCILE_REPLACE_BEFORE_READ: "1" },
    });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const expectedSha256 = beforeWorkspace.body?.currentHtmlSha256;
    const beforeState = await readDesktopProjectState(isolatedUserData);

    // Drive the exact race window: the Bridge verifies the Working Copy, and
    // the E2E injection replaces its bytes before Desktop reads them again.
    const outcome = await launched.page.evaluate(async (payload) => {
      try {
        const result = await window.htmlAIProjects.reconcileActiveManagedSource(payload);
        return { resolved: true, result };
      } catch (error) {
        return {
          resolved: false,
          message: String(error?.message || error || ""),
        };
      }
    }, {
      operationId: "reconcile_e2e_hash_race_0001",
      previousSourcePath: managedSourcePath,
      expectedSourceSha256: expectedSha256,
      projectId: beforeTarget.projectId,
      documentId: beforeTarget.documentId,
      workingCopyId: beforeTarget.workingCopyId,
      versionId: beforeTarget.versionId,
      reason: "safe-action",
    });

    // contextBridge strips custom error fields, so assert the dedicated
    // fail-closed message plus the untouched state instead of the code.
    expect(outcome).toEqual({
      resolved: false,
      message: "托管工作文件与已确认的项目内容不一致，当前文件没有切换。",
    });

    // The replacement must have landed inside the race window.
    expect(readFileSync(managedSourcePath, "utf8"))
      .toContain("data-e2e-reconcile-hash-race");

    // Fail closed: neither the active path nor the managed locator may move.
    const afterState = await readDesktopProjectState(isolatedUserData);
    expect(afterState.activePath).toBe(beforeState.activePath);
    expect(afterState.activeManagedLocator).toEqual(beforeState.activeManagedLocator);

    const activeProject = await launched.page.evaluate(() => (
      window.htmlAIProjects?.getActiveProject()
    ));
    expect(sameDesktopSourcePath(activeProject?.sourcePath, managedSourcePath)).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron does not follow a copied Working Copy or leave the title stuck after a real rename error", async () => {
  const fixture = createSourceFixture("finder-rename-copy.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const originalStem = path.basename(managedSourcePath, path.extname(managedSourcePath));
    const copiedPath = path.join(
      path.dirname(managedSourcePath),
      "copied-working-copy.html",
    );
    cpSync(managedSourcePath, copiedPath);
    const copyDeadline = Date.now() + 800;
    await expect.poll(async () => {
      const current = await launched.page.evaluate(() => (
        window.htmlAIProjects?.getActiveProject()
      ));
      if (current?.sourcePath !== managedSourcePath) return current?.sourcePath || "";
      return Date.now() >= copyDeadline ? managedSourcePath : "";
    }).toBe(managedSourcePath);
    await expect(titleStemLocator(launched.page)).toHaveText(originalStem);

    await launched.page.getByRole("button", { name: /重命名文件/u }).click();
    const renameInput = launched.page.getByRole("textbox", { name: "文件名（不含后缀）" });
    await renameInput.fill("bad/name");
    await launched.page.locator("[data-persist-state]").first().click({ force: true });
    await expect(launched.page.locator("#window-file-rename-error")).toBeVisible();
    await launched.page.locator("body").click({ position: { x: 12, y: 12 }, force: true });
    await expect(launched.page.getByRole("button", { name: /重命名文件/u })).toBeVisible();
    await expect(titleStemLocator(launched.page)).toHaveText(originalStem);
    expect(existsSync(managedSourcePath)).toBe(true);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron restores a Finder rename after the process is killed", async () => {
  const fixture = createSourceFixture("finder-rename-restart.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const finderName = "重启后仍是同一文件-V1.html";
    const finderPath = path.join(path.dirname(managedSourcePath), finderName);
    renameSync(managedSourcePath, finderPath);
    await waitForTitleStem(launched.page, path.basename(finderName, ".html"));
    await waitForActiveSourcePath(launched.page, finderPath);

    await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    electronApp = null;
    const relaunched = await launchPageRoot({ isolatedUserData });
    electronApp = relaunched.electronApp;
    await waitForTitleStem(relaunched.page, path.basename(finderName, ".html"));
    await waitForActiveSourcePath(relaunched.page, finderPath);
    const afterWorkspace = await bridgeJson(
      relaunched.page,
      `/workspace?sourcePath=${encodeURIComponent(finderPath)}`,
    );
    const afterTarget = afterWorkspace.body?.openTarget || afterWorkspace.body;
    expect(afterTarget.projectId).toBe(beforeTarget.projectId);
    expect(afterTarget.documentId).toBe(beforeTarget.documentId);
    expect(afterTarget.workingCopyId).toBe(beforeTarget.workingCopyId);
    expect(readFileSync(finderPath, "utf8")).toContain(ORIGINAL_LIST_TEXT);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData, { cleanup: false });
    }
    if (isolatedUserData) removeIsolatedUserData(isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron follows a same-parent project folder rename then a title-bar rename", async () => {
  const fixture = createSourceFixture("finder-folder-rename.html");
  let electronApp = null;
  let isolatedUserData = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const beforeWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(managedSourcePath)}`,
    );
    const beforeTarget = beforeWorkspace.body?.openTarget || beforeWorkspace.body;
    const projectRoot = path.dirname(managedSourcePath);
    const renamedRoot = path.join(path.dirname(projectRoot), "Finder 项目文件夹");
    const relocatedPath = path.join(renamedRoot, path.basename(managedSourcePath));
    renameSync(projectRoot, renamedRoot);
    await waitForDesktopActivePath(isolatedUserData, relocatedPath);
    await waitForActiveSourcePath(launched.page, relocatedPath);
    await waitForTitleStem(
      launched.page,
      path.basename(managedSourcePath, path.extname(managedSourcePath)),
    );

    await launched.page.getByRole("button", { name: /重命名文件/u }).click();
    const renameInput = launched.page.getByRole("textbox", { name: "文件名（不含后缀）" });
    await expect(renameInput).toBeFocused();
    await renameInput.fill("folder-renamed-V1");
    await renameInput.press("Enter");
    const pagerootPath = path.join(renamedRoot, "folder-renamed-V1.html");
    await waitForTitleStem(launched.page, "folder-renamed-V1");
    await expect.poll(() => existsSync(pagerootPath)).toBe(true);
    const afterWorkspace = await bridgeJson(
      launched.page,
      `/workspace?sourcePath=${encodeURIComponent(pagerootPath)}`,
    );
    const afterTarget = afterWorkspace.body?.openTarget || afterWorkspace.body;
    expect(afterTarget.projectId).toBe(beforeTarget.projectId);
    expect(afterTarget.workingCopyId).toBe(beforeTarget.workingCopyId);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("Electron does not follow a Working Copy moved out of the registered project root", async () => {
  const fixture = createSourceFixture("finder-rename-escaped.html");
  let electronApp = null;
  let isolatedUserData = null;
  let outsideDirectory = null;
  try {
    const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
    electronApp = launched.electronApp;
    isolatedUserData = launched.isolatedUserData;
    await loadedDiskFrame(launched.page, fixture.sourcePath, "list-item");
    const managedSourcePath = await managedWorkingCopyPath(
      launched.page,
      fixture.sourcePath,
    );
    const originalStem = path.basename(managedSourcePath, path.extname(managedSourcePath));
    outsideDirectory = mkdtempSync(path.join(tmpdir(), "pageroot-native-escaped-"));
    const escapedPath = path.join(outsideDirectory, path.basename(managedSourcePath));
    renameSync(managedSourcePath, escapedPath);
    const moveDeadline = Date.now() + 1_200;
    await expect.poll(async () => {
      try {
        const state = await readDesktopProjectState(isolatedUserData);
        if (sameDesktopSourcePath(state.activePath, escapedPath)) return "followed";
      } catch {
        return "";
      }
      return Date.now() >= moveDeadline ? "stayed" : "";
    }).toBe("stayed");
    await expect(titleStemLocator(launched.page)).toHaveText(originalStem);
    expect(existsSync(escapedPath)).toBe(true);
    expect(existsSync(managedSourcePath)).toBe(false);
  } finally {
    if (electronApp && isolatedUserData) {
      await stopPageRoot(electronApp, isolatedUserData);
    }
    if (outsideDirectory) {
      removeValidatedTemporaryDirectory(outsideDirectory, "pageroot-native-escaped-");
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

