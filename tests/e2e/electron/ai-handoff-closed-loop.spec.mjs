import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  readdirSync,
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
  fixtureBuffer,
  productRoot,
  setTextSelection,
} from "../browser/pageroot-driver.mjs";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const ORIGINAL_TEXT = "列表项中的文字保持项目符号和缩进。";
const UPDATED_TEXT = "自动闭环验收通过";
const SECOND_UPDATED_TEXT = "自动闭环第二版通过";

function seedActiveDiskProject(
  isolatedUserData,
  sourcePath,
  recentSourcePaths = [sourcePath],
) {
  writeFileSync(
    path.join(isolatedUserData, "html-projects.json"),
    JSON.stringify({
      version: 1,
      activePath: sourcePath,
      recent: recentSourcePaths.map((recentPath, index) => ({
        path: recentPath,
        name: path.basename(recentPath),
        lastOpenedAt: Date.now() - index,
      })),
    }),
    "utf8",
  );
}

async function launchPageRoot({
  activeSourcePath = null,
  recentSourcePaths = activeSourcePath ? [activeSourcePath] : [],
  isolatedUserData: existingUserData = null,
  injectedEnv = {},
} = {}) {
  const isolatedUserData = existingUserData || mkdtempSync(
    path.join(tmpdir(), "pageroot-native-e2e-ai-loop-"),
  );
  const workspace = path.join(isolatedUserData, "workspace");
  if (activeSourcePath) {
    seedActiveDiskProject(isolatedUserData, activeSourcePath, recentSourcePaths);
  }
  const electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [path.join(productRoot, "desktop/main.mjs")],
    cwd: productRoot,
    env: {
      ...process.env,
      PAGEROOT_E2E: "1",
      PAGEROOT_E2E_USER_DATA_DIR: isolatedUserData,
      HTML_AI_WORKSPACE: workspace,
      ...injectedEnv,
    },
  });
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { electronApp, page, isolatedUserData, workspace };
}

function removeAiLoopUserData(isolatedUserData) {
  const resolved = path.resolve(isolatedUserData);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("pageroot-native-e2e-ai-loop-")
  ) {
    throw new Error(`Refusing to clean a non-E2E directory: ${resolved}`);
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

async function stopPageRoot(electronApp, isolatedUserData) {
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

  removeAiLoopUserData(isolatedUserData);
}

async function closePageRootGracefully(electronApp) {
  const closed = electronApp.waitForEvent("close", { timeout: 20_000 });
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.close();
  });
  await closed;
}

function createSourceFixture(fileName = "generated-ai-loop.html") {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-ai-loop-source-"),
  );
  const sourcePath = path.join(sourceDirectory, fileName);
  writeFileSync(sourcePath, fixtureBuffer("complex-layout.html"));
  return { sourceDirectory, sourcePath, original: readFileSync(sourcePath) };
}

function removeSourceFixture(sourceDirectory) {
  const resolved = path.resolve(sourceDirectory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("pageroot-ai-loop-source-")
  ) {
    throw new Error(`Refusing to clean a non-E2E source directory: ${resolved}`);
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

async function loadedDiskFrame(page, sourcePath, { editable = true } = {}) {
  const canonicalSourcePath = realpathSync(sourcePath);
  await expect.poll(
    async () => (await page.evaluate(() => window.htmlAIProjects?.getActiveProject()))?.sourcePath,
    { timeout: 20_000 },
  ).toBe(canonicalSourcePath);
  await expect(page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
  // The former loading card is no longer rendered, so its absence cannot
  // prove that hydration finished. Wait on the actual interaction boundary
  // before selecting, commenting, or starting a native edit.
  await expect(page.getByRole("button", { name: "项目", exact: true }))
    .toBeEnabled({ timeout: 60_000 });
  if (editable) {
    await expect(page.getByRole("button", { name: "全局评论", exact: true }))
      .toBeEnabled({ timeout: 60_000 });
  }
  await expect(page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  await editor.waitFor({ state: "visible", timeout: 60_000 });
  const editorHandle = await editor.elementHandle();
  await page.waitForFunction(
    (element) => element?.getAttribute("data-render-verified") === "true",
    editorHandle,
    { timeout: 60_000 },
  );
  const iframe = editor.locator('iframe[title*="HTML"]').first();
  await iframe.waitFor({ state: "attached", timeout: 60_000 });
  let frame = null;
  await expect.poll(async () => {
    const iframeHandle = await iframe.elementHandle();
    frame = await iframeHandle?.contentFrame() || null;
    return Boolean(frame);
  }, { timeout: 60_000 }).toBe(true);
  if (!frame) throw new Error("PageRoot did not expose the Electron edit frame.");
  await frame.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)),
    caseSelector("list-item"),
    { timeout: 60_000 },
  );
  return frame;
}

async function addCommentAndSubmit(
  page,
  electronApp,
  sourcePath,
  updatedText = UPDATED_TEXT,
) {
  await electronApp.evaluate(({ clipboard }) => clipboard.clear());
  await addComment(
    page,
    sourcePath,
    `只把这个列表项改为“${updatedText}”，其他地方保持不变。`,
  );
  await page.getByRole("button", { name: /发送至 Qoder/u }).click();
  await expect(page.getByText("等待 QoderWork 返回修改结果", { exact: true }))
    .toBeVisible();
  let promptPath = "";
  await expect.poll(async () => {
    const copied = await electronApp.evaluate(({ clipboard }) => clipboard.readText());
    const match = copied.match(/请执行\s+(.+?\/PROMPT\.md)\s+中的单轮任务/u);
    promptPath = match?.[1] || "";
    return Boolean(promptPath && existsSync(promptPath));
  }, { timeout: 20_000 }).toBe(true);
  const requestRoot = path.dirname(promptPath);
  const changeRequest = JSON.parse(
    readFileSync(path.join(requestRoot, "change-request.json"), "utf8"),
  );
  expect(changeRequest.requirements.instructions).toHaveLength(1);
  expect(changeRequest.requirements.instructions[0].text).toContain(updatedText);
  expect(changeRequest.requirements.preserveOutsideTargets).toBe(true);
  return { promptPath, requestRoot, changeRequest };
}

async function addComment(page, sourcePath, text = (
  `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`
)) {
  const frame = await loadedDiskFrame(page, sourcePath);
  const target = frame.locator(caseSelector("list-item"));
  await target.scrollIntoViewIfNeeded();
  await target.click();
  const commentButton = page.getByRole("button", { name: /给.+留评论/u })
    .filter({ visible: true })
    .first();
  await expect(commentButton).toBeVisible();
  await commentButton.click();
  const composer = page.getByRole("textbox", { name: "评论内容" });
  await composer.fill(text);
  await page.getByRole("button", { name: "评论", exact: true }).click();
  await expect(page.locator(".comment-card").filter({ hasText: text }))
    .toHaveCount(1);
}

async function openRecentProject(page, sourcePath, options) {
  const visibleToast = page.locator(".toast.show");
  await visibleToast.waitFor({ state: "visible", timeout: 2_000 }).catch(() => {});
  if (await visibleToast.isVisible()) {
    await visibleToast.getByRole("button", { name: "关闭提醒" }).click();
    await expect(visibleToast).toBeHidden();
  }
  const processingDialog = page.getByRole("dialog", { name: "本轮处理" });
  if (await processingDialog.isVisible()) {
    await processingDialog.getByRole("button", { name: "关闭处理面板" }).click();
  }
  await page.getByRole("button", { name: "项目", exact: true }).click();
  await page.locator(".recent-file-row")
    .filter({ hasText: path.basename(sourcePath) })
    .click();
  return loadedDiskFrame(page, sourcePath, options);
}

function requestDirectoryCount(workspace) {
  const projectsRoot = path.join(workspace, "projects");
  if (!existsSync(projectsRoot)) return 0;
  return readdirSync(projectsRoot).reduce((total, projectId) => {
    const requestsRoot = path.join(projectsRoot, projectId, "requests");
    return total + (
      existsSync(requestsRoot)
        ? readdirSync(requestsRoot).filter((entry) => !entry.startsWith(".")).length
        : 0
    );
  }, 0);
}

function writeAiOutput(requestRoot, transform) {
  const base = readFileSync(
    path.join(requestRoot, "input", "base", "index.html"),
    "utf8",
  );
  const output = transform(base);
  const outputDirectory = path.join(
    requestRoot,
    "attempts",
    "attempt_001",
    "output",
  );
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(path.join(outputDirectory, "index.html"), output, "utf8");
}

function runOfficialFinalizer(requestRoot, changeRequest) {
  const command = changeRequest.finalization.finalizerCommand;
  const result = spawnSync("/bin/zsh", ["-lc", command], {
    cwd: requestRoot,
    encoding: "utf8",
    env: process.env,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`Finalizer failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function recordOfficialSupplement(workspace, requestRoot, changeRequest, payload) {
  const result = spawnSync(process.execPath, [
    path.join(productRoot, "scripts", "record-user-supplement.mjs"),
    "--workspace",
    workspace,
    "--project-id",
    changeRequest.projectId,
    "--request-id",
    path.basename(requestRoot),
    "--attempt-id",
    "attempt_001",
  ], {
    cwd: requestRoot,
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: process.env,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(`Supplement recorder failed:\n${result.stdout}\n${result.stderr}`);
  }
  return JSON.parse(result.stdout);
}

function workingHtmlFiles(workspace, projectId) {
  const directory = path.join(workspace, "projects", projectId, "working");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".html"))
    .map((fileName) => path.join(directory, fileName));
}

test("a verified AI result stays pending until the user opens the new HTML", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => {
      expect(base.match(new RegExp(ORIGINAL_TEXT, "gu"))).toHaveLength(1);
      return base.replace(ORIGINAL_TEXT, UPDATED_TEXT);
    });
    runOfficialFinalizer(request.requestRoot, request.changeRequest);

    await expect(launched.page.getByText(
      "修改结果已通过检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    const pending = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(pending.sourcePath).toBe(realpathSync(fixture.sourcePath));
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);

    await launched.page.getByRole("button", {
      name: "打开最新版",
    }).click();
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/working\/generated-ai-loop-V1\.1\.html$/u),
    });
    const opened = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(opened.sourcePath).not.toBe(fixture.sourcePath);
    expect(opened.sourcePath).toMatch(/\/working\/generated-ai-loop-V1\.1\.html$/u);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(readFileSync(opened.sourcePath, "utf8")).toContain(UPDATED_TEXT);
    const openedFrame = await loadedDiskFrame(launched.page, opened.sourcePath);
    await expect(openedFrame.locator(caseSelector("list-item")))
      .toHaveText(UPDATED_TEXT);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("two AI versions activate in order and survive relaunch without identity drift", async () => {
  test.setTimeout(240_000);
  const fixture = createSourceFixture("sequential-ai-loop.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  let activeApp = launched.electronApp;
  let activeAppClosed = false;
  try {
    const firstRequest = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      firstRequest.requestRoot,
      (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    );
    runOfficialFinalizer(firstRequest.requestRoot, firstRequest.changeRequest);
    await expect(launched.page.getByText(
      "修改结果已通过检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "打开最新版" }).click();
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/working\/sequential-ai-loop-V1\.1\.html$/u),
    });
    const firstActive = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    await expect((await loadedDiskFrame(
      launched.page,
      firstActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(UPDATED_TEXT);

    const secondRequest = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      firstActive.sourcePath,
      SECOND_UPDATED_TEXT,
    );
    writeAiOutput(
      secondRequest.requestRoot,
      (base) => base.replace(UPDATED_TEXT, SECOND_UPDATED_TEXT),
    );
    runOfficialFinalizer(secondRequest.requestRoot, secondRequest.changeRequest);
    await expect(launched.page.getByText(
      "修改结果已通过检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "打开最新版" }).click();
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/working\/sequential-ai-loop-V1\.2\.html$/u),
    });
    const secondActive = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(readFileSync(firstActive.sourcePath, "utf8")).toContain(UPDATED_TEXT);
    expect(readFileSync(firstActive.sourcePath, "utf8"))
      .not.toContain(SECOND_UPDATED_TEXT);
    expect(readFileSync(secondActive.sourcePath, "utf8"))
      .toContain(SECOND_UPDATED_TEXT);
    await expect((await loadedDiskFrame(
      launched.page,
      secondActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(SECOND_UPDATED_TEXT);

    const registry = JSON.parse(readFileSync(
      path.join(launched.workspace, "project-registry.json"),
      "utf8",
    ));
    expect(Object.values(registry.projects)).toHaveLength(1);
    const sourceRecords = Object.values(registry.sources).filter(
      (record) => record.projectId === secondRequest.changeRequest.projectId,
    );
    expect(sourceRecords.filter((record) => record.role === "current"))
      .toHaveLength(1);

    await closePageRootGracefully(launched.electronApp);
    activeAppClosed = true;
    const relaunched = await launchPageRoot({
      isolatedUserData: launched.isolatedUserData,
    });
    activeApp = relaunched.electronApp;
    activeAppClosed = false;
    await expect.poll(async () => (
      relaunched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: secondActive.sourcePath,
    });
    await expect((await loadedDiskFrame(
      relaunched.page,
      secondActive.sourcePath,
    )).locator(caseSelector("list-item"))).toHaveText(SECOND_UPDATED_TEXT);
  } finally {
    if (activeAppClosed) {
      removeAiLoopUserData(launched.isolatedUserData);
    } else {
      await stopPageRoot(activeApp, launched.isolatedUserData);
    }
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("an internal AI supplement is sealed, scope-authorized, opened, and shown in history", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("supplement-ai-loop.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    const instructionId = request.changeRequest.requirements
      .instructions[0].instructionId;
    const supplementText = "把“校验通过”改为“补充指令已回写”。";
    const supplement = recordOfficialSupplement(
      launched.workspace,
      request.requestRoot,
      request.changeRequest,
      {
        idempotencyKey: "e2e-internal-ai-prompt-001",
        action: "add",
        refersTo: [instructionId],
        userText: supplementText,
        targetDescription: "独立校验结果",
        evidenceState: "text-only",
        attachments: [],
      },
    );
    expect(supplement.recordId).toBe("supplement_0001");

    writeAiOutput(request.requestRoot, (base) => base
      .replace(ORIGINAL_TEXT, UPDATED_TEXT)
      .replace("校验通过", "补充指令已回写"));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByText(
      "修改结果已通过检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(launched.page.getByText(
      "有一项范围校验需要你决定",
      { exact: true },
    )).toHaveCount(0);

    const archive = JSON.parse(readFileSync(path.join(
      request.requestRoot,
      "attempts",
      "attempt_001",
      "USER_SUPPLEMENT.json",
    ), "utf8"));
    expect(archive.status).toBe("sealed");
    expect(archive.records).toHaveLength(1);
    expect(archive.records[0].refersTo).toContain(instructionId);

    await launched.page.getByRole("button", { name: "打开最新版" }).click();
    await expect.poll(async () => (
      launched.page.evaluate(() => window.htmlAIProjects?.getActiveProject())
    ), { timeout: 30_000 }).toMatchObject({
      sourcePath: expect.stringMatching(/\/working\/supplement-ai-loop-V1\.1\.html$/u),
    });
    const active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    const frame = await loadedDiskFrame(launched.page, active.sourcePath);
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(UPDATED_TEXT);
    await expect(frame.locator(caseSelector("standalone-output")))
      .toHaveText("补充指令已回写");

    await launched.page.getByRole("button", { name: "项目", exact: true }).click();
    await launched.page.getByRole("button", { name: "版本历史" }).click();
    await launched.page.getByRole("button", { name: /V2 版本 2/u }).click();
    await launched.page.getByText(
      "查看本版修改来源与校验",
      { exact: true },
    ).click();
    await expect(launched.page.getByText("内部 AI 对话补充", { exact: true }))
      .toBeVisible();
    await expect(launched.page.getByText(supplementText, { exact: true }))
      .toBeVisible();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a no-change result returns to editable requirements without a dead end", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("no-change-recovery.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base);
    runOfficialFinalizer(request.requestRoot, request.changeRequest);

    await expect(launched.page.getByText(
      "这次没有产生有效变化",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(launched.page.getByText(
      "原评论和附件都已保留，调整要求后可以重新发送",
      { exact: true },
    )).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "返回编辑" }))
      .toBeVisible();
    await expect(launched.page.getByRole("button", { name: "调整要求后重试" }))
      .toBeVisible();
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    await launched.page.getByRole("button", { name: "调整要求后重试" }).click();
    const editor = launched.page.getByRole("textbox", { name: /编辑评论/u });
    await expect(editor).toBeVisible();
    await expect(editor).toHaveValue(new RegExp(UPDATED_TEXT, "u"));
    await expect(launched.page.getByRole("button", { name: /发送至 Qoder/u }))
      .toBeEnabled();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a clipboard handoff failure keeps the frozen Request recoverable", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: { PAGEROOT_E2E_QODER_HANDOFF_FAILURE: "1" },
  });
  try {
    const clipboardSentinel = "PAGEROOT_QODER_HANDOFF_FAILURE_SENTINEL";
    await launched.electronApp.evaluate(
      ({ clipboard }, value) => clipboard.writeText(value),
      clipboardSentinel,
    );
    const frame = await loadedDiskFrame(launched.page, fixture.sourcePath);
    await frame.locator(caseSelector("list-item")).click();
    await launched.page.getByRole("button", { name: /给.+留评论/u })
      .filter({ visible: true })
      .first()
      .click();
    await launched.page.getByRole("textbox", { name: "评论内容" })
      .fill(`改为 ${UPDATED_TEXT}`);
    await launched.page.getByRole("button", { name: "评论", exact: true }).click();
    await launched.page.getByRole("button", { name: /发送至 Qoder/u }).click();
    await expect(launched.page.getByText("等待 QoderWork 返回修改结果", { exact: true }))
      .toBeVisible();
    expect(await launched.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(clipboardSentinel);
    await expect(launched.page.getByRole("button", { name: "复制失败 · 查看" }))
      .toBeVisible();
    const handoffError = launched.page.getByRole("alert")
      .filter({ hasText: "交接内容还没有复制" });
    await expect(handoffError).toBeVisible();
    await handoffError.getByRole("button", { name: "关闭提醒" }).click();
    await expect(handoffError).toBeHidden();
    const retryCopy = launched.page.getByRole("button", { name: "重新复制本轮要求" });
    await expect(retryCopy).toBeVisible();
    await retryCopy.click();
    await expect(handoffError).toBeVisible();
    const projectsRoot = path.join(launched.workspace, "projects");
    await expect.poll(() => (
      existsSync(projectsRoot)
        ? readdirSync(projectsRoot).some((projectId) => (
            existsSync(path.join(projectsRoot, projectId, "requests"))
          ))
        : false
    )).toBe(true);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a failed handoff in project A does not block project B or replace its state", async () => {
  test.setTimeout(180_000);
  const projectA = createSourceFixture("project-a.html");
  const projectB = createSourceFixture("project-b.html");
  const launched = await launchPageRoot({
    activeSourcePath: projectA.sourcePath,
    recentSourcePaths: [projectA.sourcePath, projectB.sourcePath],
    injectedEnv: { PAGEROOT_E2E_QODER_HANDOFF_FAILURE: "1" },
  });
  try {
    await addComment(launched.page, projectA.sourcePath);
    await launched.page.getByRole("button", { name: /发送至 Qoder/u }).click();
    await expect(launched.page.getByRole("alert")
      .filter({ hasText: "交接内容还没有复制" }))
      .toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(1);

    const processingDialog = launched.page.getByRole("dialog", { name: "本轮处理" });
    await expect(processingDialog).toBeVisible();
    await launched.page.keyboard.press("Escape");
    await expect(processingDialog).toBeHidden();
    await launched.page.getByRole("button", { name: "复制失败 · 查看" }).click();
    await expect(processingDialog).toBeVisible();
    await launched.page.getByRole("button", { name: "项目", exact: true }).click();
    await launched.page.locator(".recent-file-row")
      .filter({ hasText: path.basename(projectB.sourcePath) })
      .click();
    await loadedDiskFrame(launched.page, projectB.sourcePath);
    await expect(launched.page.getByRole("button", { name: "发送至 Qoder" }))
      .toBeDisabled();
    await addComment(launched.page, projectB.sourcePath);
    await expect(launched.page.getByRole("button", { name: /发送至 Qoder/u }))
      .toBeEnabled();
    await launched.page.getByRole("button", { name: /发送至 Qoder/u }).click();
    await expect(launched.page.getByText(
      "等待 QoderWork 返回修改结果",
      { exact: true },
    )).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "复制失败 · 查看" }))
      .toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(2);

    await openRecentProject(launched.page, projectA.sourcePath, { editable: false });
    await expect(launched.page.getByRole("button", { name: "复制失败 · 查看" }))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "复制失败 · 查看" }).click();
    await expect(launched.page.getByText("交接内容尚未复制", { exact: true }))
      .toBeVisible();

    await openRecentProject(launched.page, projectB.sourcePath, { editable: false });
    await expect(launched.page.getByRole("button", { name: "复制失败 · 查看" }))
      .toBeVisible();
    expect(readFileSync(projectA.sourcePath).equals(projectA.original)).toBe(true);
    expect(readFileSync(projectB.sourcePath).equals(projectB.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("a rapid double click creates exactly one durable Request", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("double-submit.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await launched.electronApp.evaluate(({ clipboard }) => clipboard.clear());
    await addComment(launched.page, fixture.sourcePath);
    await launched.page.getByRole("button", { name: /发送至 Qoder/u }).dblclick({
      delay: 0,
    });
    await expect(launched.page.getByText(
      "等待 QoderWork 返回修改结果",
      { exact: true },
    )).toBeVisible();
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(1);
    await launched.page.waitForTimeout(1_000);
    expect(requestDirectoryCount(launched.workspace)).toBe(1);
    const copied = await launched.electronApp.evaluate(
      ({ clipboard }) => clipboard.readText(),
    );
    expect(copied).toMatch(/请执行\s+.+?\/PROMPT\.md\s+中的单轮任务/u);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("an unknown Request outcome stays fail-closed and can be reconciled explicitly", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("unknown-request-outcome.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await addComment(launched.page, fixture.sourcePath);
    await launched.page.evaluate(() => {
      const originalFetch = window.fetch.bind(window);
      let requestDispatched = false;
      window.__PAGEROOT_ALLOW_UNKNOWN_REQUEST_RECONCILE__ = false;
      window.fetch = async (input, init) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          window.location.href,
        );
        if (url.pathname === "/request" && !requestDispatched) {
          requestDispatched = true;
          const response = await originalFetch(input, init);
          if (!response.ok) return response;
          throw new DOMException(
            "Test injected an unknown POST outcome.",
            "TimeoutError",
          );
        }
        if (
          url.pathname === "/workspace"
          && requestDispatched
          && !window.__PAGEROOT_ALLOW_UNKNOWN_REQUEST_RECONCILE__
        ) {
          throw new DOMException(
            "Test keeps reconciliation unavailable.",
            "TimeoutError",
          );
        }
        return originalFetch(input, init);
      };
    });

    await launched.page.getByRole("button", { name: /发送至 Qoder/u }).click();
    await expect(launched.page.getByText(
      "需要确认任务是否已经建立",
      { exact: true },
    )).toBeVisible({ timeout: 30_000 });
    await expect(launched.page.getByRole("button", { name: "立即重新核对" }))
      .toBeVisible();
    await expect(launched.page.getByRole("button", { name: "重新打开源页" }).first())
      .toBeVisible();
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(1);

    await launched.page.evaluate(() => {
      window.__PAGEROOT_ALLOW_UNKNOWN_REQUEST_RECONCILE__ = true;
    });
    await launched.page.getByRole("button", { name: "立即重新核对" }).click();
    await expect(launched.page.getByText(
      "等待 QoderWork 返回修改结果",
      { exact: true },
    )).toBeVisible({ timeout: 20_000 });
    await expect(launched.page.getByRole("button", {
      name: "取消发送，继续编辑",
    })).toBeEnabled();
    expect(requestDirectoryCount(launched.workspace)).toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("project resources expose clear rules and protect unsaved edits", async () => {
  const fixture = createSourceFixture("project-resources.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath);
    const projectCount = () => {
      const projectsRoot = path.join(launched.workspace, "projects");
      return existsSync(projectsRoot)
        ? readdirSync(projectsRoot).filter((entry) => !entry.startsWith(".")).length
        : 0;
    };
    expect(projectCount()).toBe(0);
    await launched.page.getByRole("button", { name: "项目", exact: true }).click();
    await launched.page.waitForTimeout(250);
    expect(projectCount()).toBe(0);
    await launched.page.getByText("项目资料", { exact: true }).click();
    const rulesButton = launched.page.getByRole("button", {
      name: /项目长期规则.*以后每次 AI 修改都会读取.*可编辑/u,
    });
    await expect(rulesButton).toBeVisible();
    await expect(launched.page.getByRole("button", {
      name: /项目记录文件夹.*查看每轮要求、AI 返回与历史文件.*Finder/u,
    })).toBeVisible();
    await rulesButton.click();
    await expect(launched.page.getByText("管理 AI 修改规则", { exact: true }))
      .toBeVisible();
    await expect(launched.page.getByText(
      "每次发送至 Qoder 时，源页都会把这份规则与本轮要求一起交接。保存只影响后续任务，不会修改当前 HTML。",
      { exact: true },
    )).toBeVisible();
    const rulesEditor = launched.page.getByRole("textbox", { name: "项目长期规则" });
    await expect(rulesEditor).toBeEnabled();
    const originalRules = await rulesEditor.inputValue();
    await rulesEditor.fill(`${originalRules}\n\n- 测试未保存保护`);
    await launched.page.getByRole("button", { name: "返回项目" }).click();
    await expect(launched.page.getByText(
      "项目规则还有未保存修改",
      { exact: true },
    )).toBeVisible();
    await expect(rulesEditor).toBeVisible();
    await launched.page.getByRole("button", { name: "还原修改" }).click();
    await launched.page.getByRole("button", { name: "返回项目" }).click();
    await expect(launched.page.getByText("当前文件", { exact: true })).toBeVisible();
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a global comment stays exact through first project registration", async () => {
  const fixture = createSourceFixture("global-comment-registration.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const frame = await loadedDiskFrame(launched.page, fixture.sourcePath);
    await launched.page.getByRole("button", { name: "全局评论" }).click();
    await launched.page.getByRole("textbox", { name: "评论内容" })
      .fill("保持整个页面的视觉层级。");
    await launched.page.getByRole("button", { name: "评论", exact: true }).click();
    const globalComment = launched.page.locator(".comment-card")
      .filter({ hasText: "保持整个页面的视觉层级。" });
    await expect(globalComment).toHaveAttribute("data-resolution", "exact");

    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_TEXT.length);
    await launched.page.keyboard.insertText("首次登记后仍精确");
    await expect.poll(
      () => readFileSync(fixture.sourcePath, "utf8"),
      { timeout: 20_000 },
    ).toContain("首次登记后仍精确");

    await expect(globalComment).toHaveAttribute("data-resolution", "exact");
    await expect(globalComment.getByText("原位置已变化")).toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: /发送至 Qoder/u }))
      .toBeEnabled();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("an automatic update result appears above the Qoder action", async () => {
  const fixture = createSourceFixture("update-indicator.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath);
    await launched.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(
        "html-updates:status",
        {
          status: "available",
          currentVersion: "0.8.6",
          latestVersion: "9.9.9",
          minimumMacOS: "12.0",
          architecture: "arm64",
          publishedAt: "2026-07-23T00:00:00.000Z",
        },
      );
    });
    await expect(launched.page.getByRole("button", {
      name: "发现 PageRoot 9.9.9，打开 GitHub 更新页面",
    })).toBeVisible();

    await launched.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(
        "html-updates:status",
        {
          status: "current",
          currentVersion: "0.8.6",
          latestVersion: "0.8.6",
          minimumMacOS: "12.0",
          architecture: "arm64",
          publishedAt: "2026-07-23T00:00:00.000Z",
        },
      );
    });
    await expect(launched.page.getByRole("button", {
      name: /打开 GitHub 更新页面/u,
    })).toHaveCount(0);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("rapid project switching and immediate close preserve the last native edit", async () => {
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
    let frame = await loadedDiskFrame(firstLaunch.page, projectA.sourcePath);
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_TEXT.length);
    await firstLaunch.page.keyboard.insertText(switchedText);
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(switchedText);

    await firstLaunch.page.getByRole("button", { name: "项目", exact: true }).click();
    await firstLaunch.page.locator(".recent-file-row")
      .filter({ hasText: "close-switch-b.html" })
      .click();
    await loadedDiskFrame(firstLaunch.page, projectB.sourcePath);
    await expect.poll(
      () => readFileSync(projectA.sourcePath, "utf8"),
      { timeout: 20_000 },
    ).toContain(switchedText);

    frame = await openRecentProject(firstLaunch.page, projectA.sourcePath);
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(switchedText);
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, switchedText.length);
    await firstLaunch.page.keyboard.insertText(closeText);
    await expect(frame.locator(caseSelector("list-item"))).toHaveText(closeText);

    await closePageRootGracefully(firstLaunch.electronApp);
    firstClosed = true;
    reopened = await launchPageRoot({
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    const reopenedFrame = await loadedDiskFrame(
      reopened.page,
      projectA.sourcePath,
    );
    await expect(reopenedFrame.locator(caseSelector("list-item")))
      .toHaveText(closeText);
    expect(readFileSync(projectA.sourcePath, "utf8")).toContain(closeText);
  } finally {
    if (reopened) {
      await stopPageRoot(reopened.electronApp, reopened.isolatedUserData);
    } else if (!firstClosed) {
      await stopPageRoot(
        firstLaunch.electronApp,
        firstLaunch.isolatedUserData,
      );
    } else {
      removeAiLoopUserData(firstLaunch.isolatedUserData);
    }
    removeSourceFixture(projectA.sourceDirectory);
    removeSourceFixture(projectB.sourceDirectory);
  }
});

test("output without the mandatory finalizer never creates or opens a version", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
    await launched.page.waitForTimeout(3_500);
    await expect(launched.page.getByText("等待 QoderWork 返回修改结果", { exact: true }))
      .toBeVisible();
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a malformed AI HTML return is rejected before completion or opening", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      request.requestRoot,
      () => `<html><body><p>${UPDATED_TEXT}</p>`,
    );
    expect(() => runOfficialFinalizer(request.requestRoot, request.changeRequest))
      .toThrow(/INVALID_HTML_DOCUMENT|complete HTML document/u);
    const attemptRoot = path.join(
      request.requestRoot,
      "attempts",
      "attempt_001",
    );
    expect(existsSync(path.join(attemptRoot, "completion.json"))).toBe(false);
    await launched.page.waitForTimeout(3_500);
    await expect(launched.page.getByText("等待 QoderWork 返回修改结果", { exact: true }))
      .toBeVisible();
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a soft out-of-scope AI return waits for an explicit waiver and open", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base
      .replace(ORIGINAL_TEXT, UPDATED_TEXT)
      .replace(
        "<title>PageRoot native DOM editing matrix</title>",
        "<title>unauthorized title mutation</title>",
      ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByText("有一项范围校验需要你决定", { exact: true })
      .filter({ visible: true }).first())
      .toBeVisible({ timeout: 30_000 });
    let active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(active.sourcePath).toBe(realpathSync(fixture.sourcePath));
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    await launched.page.getByRole("button", { name: "无视本校验，继续" }).click();
    await expect(launched.page.getByText(
      "修改结果已通过检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(active.sourcePath).toBe(realpathSync(fixture.sourcePath));
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("a committed version that the desktop cannot activate stays visibly blocked", async () => {
  const fixture = createSourceFixture();
  const launched = await launchPageRoot({
    activeSourcePath: fixture.sourcePath,
    injectedEnv: { PAGEROOT_E2E_GENERATED_VERSION_OPEN_FAILURE: "1" },
  });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(request.requestRoot, (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByText(
      "修改结果已通过检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", {
      name: "打开最新版",
    }).click();
    await expect(launched.page.getByText(/新版本文件暂时无法打开|最新版暂时无法打开/u)
      .filter({ visible: true }).first())
      .toBeVisible({ timeout: 30_000 });
    const active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(active.sourcePath).toBe(realpathSync(fixture.sourcePath));
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});
