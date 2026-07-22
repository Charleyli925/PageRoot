import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

import {
  caseSelector,
  fixtureBuffer,
  productRoot,
} from "../browser/pageroot-driver.mjs";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const ORIGINAL_TEXT = "列表项中的文字保持项目符号和缩进。";
const UPDATED_TEXT = "自动闭环验收通过";

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

async function launchPageRoot({ activeSourcePath, injectedEnv = {} }) {
  const isolatedUserData = mkdtempSync(
    path.join(tmpdir(), "pageroot-native-e2e-ai-loop-"),
  );
  const workspace = path.join(isolatedUserData, "workspace");
  seedActiveDiskProject(isolatedUserData, activeSourcePath);
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

async function stopPageRoot(electronApp, isolatedUserData) {
  const electronProcess = electronApp.process();
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await new Promise((resolve) => {
    if (electronProcess.exitCode !== null || electronProcess.signalCode !== null) {
      resolve();
      return;
    }
    const timer = setTimeout(() => {
      electronProcess.kill("SIGKILL");
      resolve();
    }, 5_000);
    electronProcess.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
  const resolved = path.resolve(isolatedUserData);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("pageroot-native-e2e-ai-loop-")
  ) {
    throw new Error(`Refusing to clean a non-E2E directory: ${resolved}`);
  }
  rmSync(resolved, { recursive: true, force: true });
}

function createSourceFixture() {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-ai-loop-source-"),
  );
  const sourcePath = path.join(sourceDirectory, "generated-ai-loop.html");
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
  rmSync(resolved, { recursive: true, force: true });
}

async function loadedDiskFrame(page, sourcePath) {
  await expect.poll(
    async () => (await page.evaluate(() => window.htmlAIProjects?.getActiveProject()))?.sourcePath,
    { timeout: 20_000 },
  ).toBe(sourcePath);
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  await editor.waitFor({ state: "visible" });
  const editorHandle = await editor.elementHandle();
  await page.waitForFunction(
    (element) => element?.getAttribute("data-render-verified") === "true",
    editorHandle,
  );
  const iframeHandle = await editor.locator('iframe[title*="HTML"]').elementHandle();
  const frame = await iframeHandle?.contentFrame();
  if (!frame) throw new Error("PageRoot did not expose the Electron edit frame.");
  await frame.waitForFunction(
    (selector) => Boolean(document.querySelector(selector)),
    caseSelector("list-item"),
  );
  return frame;
}

async function addCommentAndSubmit(page, electronApp, sourcePath) {
  await electronApp.evaluate(({ clipboard }) => clipboard.clear());
  const frame = await loadedDiskFrame(page, sourcePath);
  const target = frame.locator(caseSelector("list-item"));
  await target.scrollIntoViewIfNeeded();
  await target.click();
  const commentButton = page.getByRole("button", { name: /给.+留评论/u })
    .filter({ visible: true })
    .first();
  await expect(commentButton).toBeVisible();
  await commentButton.click();
  const composer = page.getByRole("textbox", { name: "本轮修改评论" });
  await composer.fill(`只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`);
  await page.getByRole("button", { name: "发送评论" }).click();
  await expect(page.getByRole("textbox", { name: "评论 1" }))
    .toHaveValue(new RegExp(UPDATED_TEXT, "u"));
  await page.getByRole("button", { name: "一键发送至 QoderWork" }).click();
  await expect(page.getByText("等待 QoderWork 完成修改", { exact: true }))
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
  expect(changeRequest.requirements.instructions[0].text).toContain(UPDATED_TEXT);
  expect(changeRequest.requirements.preserveOutsideTargets).toBe(true);
  return { promptPath, requestRoot, changeRequest };
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

function workingHtmlFiles(workspace, projectId) {
  const directory = path.join(workspace, "projects", projectId, "working");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".html"))
    .map((fileName) => path.join(directory, fileName));
}

test("a verified AI result stays pending until the user opens the new HTML", async () => {
  test.setTimeout(90_000);
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
      "最新版已通过检查，等待你打开",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    const pending = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(pending.sourcePath).toBe(fixture.sourcePath);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);

    await launched.page.getByRole("button", {
      name: "打开 Qoder 返回的最新版",
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
    await launched.page.getByRole("textbox", { name: "本轮修改评论" })
      .fill(`改为 ${UPDATED_TEXT}`);
    await launched.page.getByRole("button", { name: "发送评论" }).click();
    await launched.page.getByRole("button", { name: "一键发送至 QoderWork" }).click();
    await expect(launched.page.getByText("等待 QoderWork 完成修改", { exact: true }))
      .toBeVisible();
    expect(await launched.electronApp.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe(clipboardSentinel);
    const processButton = launched.page.getByRole("button", { name: "查看本轮处理" });
    if (await processButton.isVisible()) await processButton.click();
    await expect(launched.page.getByText("等待复制到剪贴板", { exact: true }))
      .toBeVisible();
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
    await expect(launched.page.getByText("等待 QoderWork 完成修改", { exact: true }))
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
    await expect(launched.page.getByText("等待 QoderWork 完成修改", { exact: true }))
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
    expect(active.sourcePath).toBe(fixture.sourcePath);
    expect(workingHtmlFiles(launched.workspace, request.changeRequest.projectId)).toHaveLength(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    await launched.page.getByRole("button", { name: "无视本校验，继续" }).click();
    await expect(launched.page.getByText(
      "最新版已通过检查，等待你打开",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(active.sourcePath).toBe(fixture.sourcePath);
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
      "最新版已通过检查，等待你打开",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", {
      name: "打开 Qoder 返回的最新版",
    }).click();
    await expect(launched.page.getByText(/新版本文件暂时无法打开|最新版暂时无法打开/u)
      .filter({ visible: true }).first())
      .toBeVisible({ timeout: 30_000 });
    const active = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(active.sourcePath).toBe(fixture.sourcePath);
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
