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
const PICKER_TEXT = "项目切换原子发布验收通过";

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

function createSourceFixture(
  fileName = "generated-ai-loop.html",
  transform = (source) => source,
) {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), "pageroot-ai-loop-source-"),
  );
  const sourcePath = path.join(sourceDirectory, fileName);
  const source = fixtureBuffer("complex-layout.html").toString("utf8");
  writeFileSync(sourcePath, transform(source), "utf8");
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

async function waitForProjectReady(page, timeout = 60_000) {
  await expect.poll(async () => {
    await page.bringToFront();
    const state = await page.locator("main.workbench").getAttribute("data-project-state");
    if (state === "ready") return state;
    const stage = await page.evaluate(() => window.__PAGEROOT_HYDRATION_STAGE__);
    const visibleFailure = state === "failed"
      ? await page.locator('[aria-label="项目读取失败"]').textContent().catch(() => "")
      : "";
    return `${state}:${stage || "unmarked"}:${visibleFailure || "no-detail"}`;
  }, { timeout }).toBe("ready");
}

async function loadedDiskFrame(
  page,
  sourcePath,
  { editable = true, expectedCase = "list-item" } = {},
) {
  const canonicalSourcePath = realpathSync(sourcePath);
  await expect.poll(
    async () => (await page.evaluate(() => window.htmlAIProjects?.getActiveProject()))?.sourcePath,
    { timeout: 20_000 },
  ).toBe(canonicalSourcePath);
  await waitForProjectReady(page);
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
    caseSelector(expectedCase),
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
), targetCase = "list-item") {
  const frame = await loadedDiskFrame(page, sourcePath);
  const target = frame.locator(caseSelector(targetCase));
  await page.keyboard.press("Escape");
  await frame.locator("body").click({ position: { x: 2, y: 2 } });
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
    await page.keyboard.press("Escape");
    await expect(processingDialog).toBeHidden();
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
  return readdirSync(projectsRoot).reduce((total, projectDirectoryName) => {
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
}

function workspaceContainsDraftComment(workspace, text) {
  const projectsRoot = path.join(workspace, "projects");
  if (!existsSync(projectsRoot)) return false;
  return readdirSync(projectsRoot).some((projectDirectoryName) => {
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
}

function rewriteWorkspaceDraftComment(workspace, text, update) {
  const projectsRoot = path.join(workspace, "projects");
  if (!existsSync(projectsRoot)) return false;
  for (const projectDirectoryName of readdirSync(projectsRoot)) {
    const draftPath = path.join(
      projectsRoot,
      projectDirectoryName,
      "draft",
      "annotations.json",
    );
    if (!existsSync(draftPath)) continue;
    const draft = JSON.parse(readFileSync(draftPath, "utf8"));
    const comment = Array.isArray(draft.comments)
      ? draft.comments.find((candidate) => candidate.text === text)
      : null;
    if (!comment) continue;
    update(comment);
    draft.draftRevision = Math.max(0, Number(draft.draftRevision) || 0) + 1;
    draft.updatedAt = new Date().toISOString();
    writeFileSync(draftPath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
    return true;
  }
  return false;
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
  return JSON.parse(result.stdout);
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
  const registry = JSON.parse(
    readFileSync(path.join(workspace, "project-registry.json"), "utf8"),
  );
  const directory = path.join(
    workspace,
    "projects",
    registry.projects[projectId].storageDirectoryName,
    "working",
  );
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((fileName) => fileName.endsWith(".html"))
    .map((fileName) => path.join(directory, fileName));
}

test("a verified AI result stays pending through desktop review until the user accepts it", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("generated-ai-loop.html", (source) => source.replace(
    "  </main>",
    `    <section data-review-regression>
      <h2>核心结论</h2>
      <div data-review-regression-summary>在守住 EBITA 率底线的基础上，锁单确收实现 +8.52% 增长；21 天日均增量 +4.12 万，累计增量 +86.6 万。</div>
      <div data-review-metrics>
        <article data-review-metric="lock"><strong>+8.52%</strong><span>锁单确收增幅（显著 p&lt;0.01）</span><small>日均 52.5 万 vs 48.4 万</small></article>
        <article data-review-metric="ipv"><strong>+4.49%</strong><span>IPV 增幅（显著 p&lt;0.01）</span><small>日均 63.4 万 vs 60.7 万</small></article>
        <article data-review-metric="cvr"><strong>+6.85%</strong><span>CVR 增幅（显著 p&lt;0.01）</span><small>0.217% vs 0.203%</small></article>
      </div>
    </section>
    <div class="tabs" role="tablist" aria-label="Review interaction fixture">
      <button type="button" data-review-tab-button data-p="review-p1">审阅标签一</button>
      <button type="button" data-review-tab-button data-p="review-p2">审阅标签二</button>
    </div>
    <div data-review-priority><strong>优先顺序：</strong>先处理稳定性，再补齐体验细节。</div>
    <button type="button" id="review-counter" data-review-counter>交互计数 <span>0</span></button>
    <input id="review-sync-input" aria-label="审阅同步输入" value="">
    <div class="panel" id="review-p1" data-review-tab-panel="one">
      <article><h2>标签一概览</h2><p>第一块完整内容</p></article>
      <article><h2>标签一详情</h2><p>第二块完整内容</p></article>
    </div>
    <div class="panel" id="review-p2" data-review-tab-panel="two" hidden>
      <article><h2>标签二概览</h2><p>第三块完整内容</p></article>
      <article><h2>标签二详情</h2><p>第四块完整内容</p></article>
    </div>
    <script>
      document.querySelectorAll("[data-review-tab-button]").forEach((button) => {
        button.addEventListener("click", () => {
          document.querySelectorAll("[data-review-tab-panel]").forEach((panel) => {
            panel.hidden = panel.id !== button.dataset.p;
          });
        });
      });
      document.querySelector("[data-review-counter]").addEventListener("click", (event) => {
        const button = event.currentTarget;
        const nextCount = Number(button.dataset.count || 0) + 1;
        button.dataset.count = String(nextCount);
        button.querySelector("span").textContent = String(nextCount);
      });
      document.documentElement.dataset.reviewFixtureReady = "true";
    </script>
  </main>`,
  ));
  const pickerSourcePath = path.join(fixture.sourceDirectory, "picker-target.html");
  writeFileSync(
    pickerSourcePath,
    fixtureBuffer("complex-layout.html")
      .toString("utf8")
      .replace(ORIGINAL_TEXT, PICKER_TEXT),
    "utf8",
  );
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    const attemptRoot = path.join(
      request.requestRoot,
      "attempts",
      "attempt_001",
    );
    writeFileSync(path.join(attemptRoot, ".DS_Store"), "Finder metadata");
    writeFileSync(
      path.join(attemptRoot, "output", ".DS_Store"),
      "Finder metadata",
    );
    await launched.page.waitForTimeout(3_500);
    await expect(
      launched.page.locator(".handoff-process-board li"),
    ).toHaveCount(4);
    const aiProgressStep = launched.page
      .locator(".handoff-process-board li")
      .filter({
        has: launched.page.locator("strong", {
          hasText: /^等待 AI 完成$/u,
        }),
      });
    await expect(
      aiProgressStep,
    ).toHaveAttribute("data-state", "current");
    writeAiOutput(request.requestRoot, (base) => {
      expect(base.match(new RegExp(ORIGINAL_TEXT, "gu"))).toHaveLength(1);
      return base
        .replace(ORIGINAL_TEXT, UPDATED_TEXT)
        .replace(
          "      <div data-review-regression-summary>",
          `      <div data-review-added-chart>
        <strong>实验效果概览</strong>
        <div><span>锁单确收</span><progress max="100" value="82"></progress></div>
        <div><span>CVR</span><progress max="100" value="69"></progress></div>
        <p>读图：规模增长由转化效率提升与动销覆盖扩大共同驱动。</p>
      </div>
      <div data-review-regression-summary>`,
        )
        .replace(
          '    <div data-review-priority><strong>优先顺序：</strong>先处理稳定性，再补齐体验细节。</div>\n',
          "",
        )
        .replace(
          "<article><h2>标签一概览</h2><p>第一块完整内容</p></article>\n      <article><h2>标签一详情</h2><p>第二块完整内容</p></article>",
          "<article><h2>标签一详情</h2><p>第二块完整内容</p></article>\n      <article><h2>标签一概览</h2><p>第一块完整内容</p></article>",
        )
        .replace(
          "<article><h2>标签二详情</h2><p>第四块完整内容</p></article>",
          "<article style=\"padding: 24px; border-radius: 16px\"><h2>标签二详情</h2><p>第四块完整内容</p></article>",
        );
    });
    runOfficialFinalizer(request.requestRoot, request.changeRequest);

    await expect(launched.page.getByText(
      "修改结果已完成检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(
      aiProgressStep,
    ).toHaveAttribute("data-state", "done");
    const pending = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(pending.sourcePath).toBe(realpathSync(fixture.sourcePath));
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    await expect.poll(
      () => workingHtmlFiles(launched.workspace, request.changeRequest.projectId).length,
      { timeout: 20_000 },
    ).toBe(1);

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", {
      name: "显示并固定审阅工具",
    }).click();
    const pinnedToolbarHandle = launched.page.getByRole("button", {
      name: "收起审阅工具",
    });
    await expect(pinnedToolbarHandle).toBeVisible();
    await expect.poll(async () => {
      const toolbarHandleBox = await pinnedToolbarHandle.boundingBox();
      const beforePaneHeaderBox = await launched.page
        .locator('section[data-side="before"] > header')
        .boundingBox();
      if (!toolbarHandleBox || !beforePaneHeaderBox) return -100;
      return beforePaneHeaderBox.y - (toolbarHandleBox.y + toolbarHandleBox.height);
    }).toBeGreaterThanOrEqual(-1);
    const beforeReviewFrame = launched.page.frameLocator(
      'iframe[title^="修改前"]',
    );
    const afterReviewFrame = launched.page.frameLocator(
      'iframe[title^="修改后"]',
    );
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    ), { timeout: 30_000 }).toBe("all");
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-focus",
    )).not.toBe("all");
    await expect(launched.page.getByRole("slider", {
      name: "非修改区域上下文可见度",
    })).toHaveValue("18");
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(launched.page.getByRole("button", {
      name: "双页对比（修改前与 AI 修改后）",
    })).toHaveAttribute("aria-pressed", "true");
    await expect(launched.page.getByRole("button", { name: "查看全部变化" }))
      .toHaveAttribute("aria-pressed", "true");
    await expect(beforeReviewFrame.locator("html"))
      .toHaveAttribute("data-author-script-ran", "true");
    await expect(beforeReviewFrame.locator("html"))
      .toHaveAttribute("data-review-fixture-ready", "true");
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-review-fixture-ready", "true");
    await expect(beforeReviewFrame.locator('meta[http-equiv="refresh"]'))
      .toHaveCount(0);
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeHidden();
    await beforeReviewFrame.getByRole("button", { name: "审阅标签二" })
      .evaluate((button) => button.click());
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    const beforeCounter = beforeReviewFrame.locator("[data-review-counter]");
    const afterCounter = afterReviewFrame.locator("[data-review-counter]");
    await beforeCounter.evaluate((button) => button.click());
    await expect(beforeCounter).toHaveAttribute("data-count", "1");
    await expect(afterCounter).toHaveAttribute("data-count", "1");
    await beforeReviewFrame.getByRole("textbox", { name: "审阅同步输入" })
      .fill("双页动作同步");
    await expect(afterReviewFrame.getByRole("textbox", { name: "审阅同步输入" }))
      .toHaveValue("双页动作同步");
    await launched.page.getByRole("button", { name: "独立滚动" }).click();
    await afterCounter.evaluate((button) => button.click());
    await expect(beforeCounter).toHaveAttribute("data-count", "2");
    await expect(afterCounter).toHaveAttribute("data-count", "2");
    await afterReviewFrame.getByRole("textbox", { name: "审阅同步输入" })
      .fill("反向动作同步");
    await expect(beforeReviewFrame.getByRole("textbox", { name: "审阅同步输入" }))
      .toHaveValue("反向动作同步");
    await launched.page.getByRole("button", { name: "同步滚动" }).click();
    await expect.poll(() => beforeReviewFrame.locator(
      "[data-pageroot-review-overlay-box]",
    ).count()).toBeGreaterThan(0);
    await expect.poll(() => afterReviewFrame.locator(
      "[data-pageroot-review-overlay-box]",
    ).count()).toBeGreaterThan(0);
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"], [data-pageroot-review-overlay-box][data-tone="structure"], [data-pageroot-review-overlay-box][data-tone="style"], [data-pageroot-review-overlay-box][data-tone="mixed"]',
    ).count()).toBeGreaterThan(0);
    expect(await afterReviewFrame.locator(
      "[data-pageroot-review-overlay-box]",
    ).evaluateAll((boxes) => boxes.some((outer, outerIndex) => {
      const outerRect = outer.getBoundingClientRect();
      return boxes.some((inner, innerIndex) => {
        if (outerIndex === innerIndex) return false;
        const innerRect = inner.getBoundingClientRect();
        return outer.getAttribute("data-pageroot-review-overlay-box")
          === inner.getAttribute("data-pageroot-review-overlay-box")
          && innerRect.width * innerRect.height < outerRect.width * outerRect.height * .86
          && innerRect.left >= outerRect.left - 2
          && innerRect.top >= outerRect.top - 2
          && innerRect.right <= outerRect.right + 2
          && innerRect.bottom <= outerRect.bottom + 2;
      });
    }))).toBe(false);
    await expect.poll(async () => beforeReviewFrame.locator(
      "[data-pageroot-review-id]",
    ).first().evaluate((element) => getComputedStyle(element).outlineStyle)).toBe("none");
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-all-changes.png"),
        animations: "disabled",
      });
    }
    await launched.page.getByRole("button", { name: "文案变化" }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("text");
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-focus",
    )).not.toBe("all");
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-text="removed"]',
    ).filter({ hasText: ORIGINAL_TEXT })).toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-text="added"]',
    ).filter({ hasText: UPDATED_TEXT })).toBeVisible();
    const deletedPriority = beforeReviewFrame.locator(
      '[data-pageroot-review-text="removed"]',
    ).filter({ hasText: /优先顺序/u });
    await expect(deletedPriority).toHaveCount(1);
    await expect.poll(() => deletedPriority.evaluate(
      (element) => getComputedStyle(element).textDecorationLine,
    )).toContain("line-through");
    const addedText = afterReviewFrame.locator(
      '[data-pageroot-review-text="added"]',
    ).filter({ hasText: UPDATED_TEXT });
    await expect.poll(() => addedText.evaluate(
      (element) => getComputedStyle(element).textDecorationLine,
    )).toBe("none");
    expect(await addedText.evaluate((element) => getComputedStyle(element).color))
      .toBe(await addedText.evaluate((element) => getComputedStyle(element.parentElement).color));
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"]',
    ).count()).toBeGreaterThan(0);
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-removed"]',
    ).count()).toBeGreaterThan(0);
    expect(await afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"]',
    ).first().evaluate((element) => getComputedStyle(element).borderTopColor))
      .toBe("rgb(35, 155, 86)");
    expect(await beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-removed"]',
    ).first().evaluate((element) => getComputedStyle(element).borderTopColor))
      .toBe("rgb(209, 75, 68)");
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "实验效果概览" })).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-regression-summary] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-text]',
    )).toHaveCount(0);
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-text-changes.png"),
        animations: "disabled",
      });
    }
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-text]',
    ).filter({ hasText: "第二块完整内容" })).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-text]',
    ).filter({ hasText: "第二块完整内容" })).toHaveCount(0);
    const textMask = afterReviewFrame.locator(
      '[data-pageroot-review-mask-dim]',
    );
    await expect(textMask).toBeAttached();
    await expect.poll(() => textMask.getAttribute("fill-opacity"))
      .toBe("0.82");
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-mask-layer]',
    ).evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      borderWidth: getComputedStyle(element).borderTopWidth,
    }))).toEqual({ background: "rgba(0, 0, 0, 0)", borderWidth: "0px" });
    await expect.poll(async () => {
      const boxes = await afterReviewFrame.locator(
        '[data-pageroot-review-overlay-box]',
      ).evaluateAll((elements) => elements.map((element) => ({
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
      })));
      const holes = await afterReviewFrame.locator(
        '[data-pageroot-review-mask-hole]',
      ).evaluateAll((elements) => elements.map((element) => ({
        left: Number(element.getAttribute("x")),
        top: Number(element.getAttribute("y")),
        width: Number(element.getAttribute("width")),
        height: Number(element.getAttribute("height")),
      })));
      return boxes.length === holes.length && boxes.every((box, index) => (
        Math.abs(box.left - holes[index].left) < 0.02
        && Math.abs(box.top - holes[index].top) < 0.02
        && Math.abs(box.width - holes[index].width) < 0.02
        && Math.abs(box.height - holes[index].height) < 0.02
      ));
    }).toBe(true);
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => {
      const path = document.querySelector("[data-pageroot-review-mask-dim]");
      const boxes = [...document.querySelectorAll("[data-pageroot-review-overlay-box]")]
        .map((element) => ({
          left: Number.parseFloat(element.style.left),
          top: Number.parseFloat(element.style.top),
          width: Number.parseFloat(element.style.width),
          height: Number.parseFloat(element.style.height),
        }));
      const first = boxes[0];
      if (!(path instanceof SVGGeometryElement) || !first) return false;
      const insideFrameIsDimmed = path.isPointInFill(new DOMPoint(
        first.left + first.width / 2,
        first.top + first.height / 2,
      ));
      let outsidePointIsDimmed = false;
      for (let y = 8; y < Math.min(400, document.documentElement.scrollHeight); y += 24) {
        for (let x = 8; x < Math.min(600, document.documentElement.scrollWidth); x += 24) {
          const inFrame = boxes.some((box) => (
            x >= box.left && x <= box.left + box.width
            && y >= box.top && y <= box.top + box.height
          ));
          if (!inFrame && path.isPointInFill(new DOMPoint(x, y))) {
            outsidePointIsDimmed = true;
            break;
          }
        }
        if (outsidePointIsDimmed) break;
      }
      return !insideFrameIsDimmed && outsidePointIsDimmed;
    })).toBe(true);
    await launched.page.getByRole("slider", {
      name: "非修改区域上下文可见度",
    }).fill("0");
    await expect.poll(async () => Number(await beforeReviewFrame.locator("html").evaluate(
      (element) => element.style.getPropertyValue("--pageroot-review-context-opacity"),
    ))).toBe(0);
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-mask-dim]',
    ).getAttribute("fill-opacity")).toBe("1");
    await launched.page.getByRole("slider", {
      name: "非修改区域上下文可见度",
    }).fill("50");
    await expect.poll(async () => Number(await beforeReviewFrame.locator("html").evaluate(
      (element) => element.style.getPropertyValue("--pageroot-review-context-opacity"),
    ))).toBeCloseTo(0.5, 4);
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-mask-dim]',
    ).getAttribute("fill-opacity")).toBe("0.5");
    await launched.page.getByRole("slider", {
      name: "非修改区域上下文可见度",
    }).fill("100");
    await expect.poll(async () => Number(await beforeReviewFrame.locator("html").evaluate(
      (element) => element.style.getPropertyValue("--pageroot-review-context-opacity"),
    ))).toBe(1);
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-mask-dim]',
    ).getAttribute("fill-opacity")).toBe("0");
    await launched.page.getByRole("slider", {
      name: "非修改区域上下文可见度",
    }).fill("18");
    await launched.page.getByRole("button", {
      name: "打开内容地图",
    }).click();
    const outlineItems = launched.page.getByTestId("review-outline-item");
    await expect.poll(() => outlineItems.count()).toBeGreaterThan(5);
    await expect(launched.page.getByText("审阅标签一", { exact: true })).toBeVisible();
    await expect(launched.page.getByText("审阅标签二", { exact: true })).toBeVisible();
    expect(await launched.page.locator(
      '[data-testid="review-outline-item"][data-changed="false"]',
    ).count()).toBeGreaterThan(0);
    const viewportWidth = await launched.page.evaluate(() => window.innerWidth);
    await expect.poll(async () => {
      const drawer = launched.page.locator('aside[aria-label="页面内容地图"]');
      const handleBox = await drawer.locator(":scope > div").first().boundingBox();
      const panelBox = await drawer.locator(':scope > div[aria-hidden="false"]').boundingBox();
      if (!handleBox || !panelBox) return false;
      const handleGap = panelBox.x - (handleBox.x + handleBox.width);
      const rightGap = panelBox.x + panelBox.width - viewportWidth;
      return Math.abs(handleGap) <= 1 && Math.abs(rightGap) <= 1;
    }).toBe(true);
    const changedMapItem = launched.page.locator(
      '[data-testid="review-outline-item"][data-changed="true"]',
    ).first();
    const unchangedMapItem = launched.page.locator(
      '[data-testid="review-outline-item"][data-changed="false"]',
    ).first();
    expect(await changedMapItem.evaluate((element) => getComputedStyle(element).opacity))
      .toBe("1");
    expect(Number(await unchangedMapItem.evaluate((element) => getComputedStyle(element).opacity)))
      .toBeLessThan(0.7);
    await beforeCounter.click();
    await expect(afterCounter).toHaveAttribute("data-count", "3");
    await expect(launched.page.getByRole("button", { name: "打开内容地图" }))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "打开内容地图" }).click();
    const movedOutlineItem = launched.page.getByRole("button", {
      name: /标签一详情：结构变化/u,
    });
    await expect(movedOutlineItem).toBeVisible();
    await movedOutlineItem.click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("text");
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(launched.page.getByRole("slider", {
      name: "非修改区域上下文可见度",
    })).toHaveValue("18");
    await launched.page.getByRole("button", { name: "查看全部变化" }).click();
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="one"]'))
      .toBeVisible();
    const nextChangeButton = launched.page.getByRole("button", { name: "下一处变化" });
    const totalChanges = Number((await nextChangeButton.locator("xpath=..")
      .locator("small").textContent())?.replace("/", "") || 0);
    let navigatorReachedSecondPanel = false;
    for (let index = 0; index < totalChanges; index += 1) {
      await nextChangeButton.click();
      if (await beforeReviewFrame.locator('[data-review-tab-panel="two"]').isVisible()) {
        navigatorReachedSecondPanel = true;
        break;
      }
    }
    expect(navigatorReachedSecondPanel).toBe(true);
    await expect(afterReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "结构变化" }).click();
    await expect(launched.page.getByRole("button", { name: "打开内容地图" }))
      .toBeVisible();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("structure");
    await expect(beforeReviewFrame.locator("[data-pageroot-review-structure]").first())
      .toBeVisible();
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="structure"]',
    ).first()).toBeAttached();
    expect(await beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="structure"]',
    ).first().evaluate((element) => getComputedStyle(element).borderTopColor))
      .toBe("rgb(22, 119, 200)");
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart][data-pageroot-review-structure]',
    )).toHaveCount(1);
    await expect(beforeReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    await launched.page.getByRole("button", { name: "视觉变化" }).click();
    await expect.poll(async () => afterReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("style");
    await expect(afterReviewFrame.locator("[data-pageroot-review-style]").first())
      .toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="style"]',
    ).first()).toBeAttached();
    expect(await afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="style"]',
    ).first().evaluate((element) => getComputedStyle(element).borderTopColor))
      .toBe("rgb(109, 92, 231)");
    await expect(beforeReviewFrame.locator(
      '[data-review-regression] [data-pageroot-review-style]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-regression] [data-pageroot-review-style]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect(launched.page.getByText(/视觉变化/u).first())
      .toBeVisible();
    await launched.page.getByRole("button", {
      name: /单独查看修改前/,
    }).click();
    await expect(launched.page.locator('[data-view="before"]')).toBeVisible();
    await expect(launched.page.locator('section[data-side="after"]')).toHaveAttribute("hidden", "");
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("style");
    await expect.poll(async () => {
      const viewport = await launched.page.locator('[aria-label="修改前画布滚动区"]').boundingBox();
      const frame = await launched.page.locator('iframe[title^="修改前"]').boundingBox();
      if (!viewport || !frame) return 100;
      return Math.abs((frame.x + frame.width) - (viewport.x + viewport.width));
    }).toBeLessThanOrEqual(2);
    await launched.page.getByRole("button", {
      name: "双页对比（修改前与 AI 修改后）",
    }).click();
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("style");
    const wholePageButton = launched.page.getByRole("button", {
      name: "双页对比（修改前与 AI 修改后）",
    });
    await wholePageButton.focus();
    await wholePageButton.press("ArrowRight");
    await expect(launched.page.locator('[data-view="before"]')).toBeVisible();
    const leftPageButton = launched.page.getByRole("button", {
      name: /单独查看修改前/u,
    });
    await expect(leftPageButton).toBeFocused();
    await leftPageButton.press("ArrowLeft");
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect(wholePageButton).toBeFocused();
    await launched.page.getByRole("button", {
      name: /单独查看 AI 修改后/,
    }).click();
    await expect(launched.page.locator('[data-view="after"]')).toBeVisible();
    await expect(launched.page.locator('section[data-side="before"]')).toHaveAttribute("hidden", "");
    await launched.page.getByRole("button", { name: "查看全部变化" }).click();
    await expect(launched.page.locator('[data-view="after"]')).toBeVisible();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("all");
    await wholePageButton.click();
    await expect(launched.page.locator('[data-view="split"]')).toBeVisible();
    await expect.poll(async () => {
      const grid = await launched.page.locator('[data-view="split"]').boundingBox();
      const beforePane = await launched.page.locator('section[data-side="before"]').boundingBox();
      const afterPane = await launched.page.locator('section[data-side="after"]').boundingBox();
      if (!grid || !beforePane || !afterPane) return false;
      return beforePane.x - grid.x <= 4
        && grid.x + grid.width - (afterPane.x + afterPane.width) <= 4
        && afterPane.x - (beforePane.x + beforePane.width) <= 4;
    }).toBe(true);
    const beforeViewport = launched.page.locator('[aria-label="修改前画布滚动区"]');
    const afterViewport = launched.page.locator('[aria-label="修改后画布滚动区"]');
    await launched.page.waitForTimeout(450);
    const sourceLeft = await beforeViewport.evaluate((element) => {
      element.scrollLeft = Math.max(1, Math.round(
        (element.scrollWidth - element.clientWidth) * .35,
      ));
      element.dispatchEvent(new Event("scroll"));
      return element.scrollLeft;
    });
    expect(sourceLeft).toBeGreaterThan(0);
    await expect.poll(() => afterViewport.evaluate((element) => element.scrollLeft))
      .toBe(sourceLeft);

    await beforeReviewFrame.locator("html").evaluate(() => {
      const outlines = [...document.querySelectorAll("[data-pageroot-outline-id]")]
        .filter((element) => element.getBoundingClientRect().height > 0);
      const target = outlines[Math.floor(outlines.length / 2)];
      target?.scrollIntoView({ block: "start", behavior: "auto" });
    });
    const visibleOutlineAnchor = (frame) => frame.locator("html").evaluate(() => {
      const outlines = [...document.querySelectorAll("[data-pageroot-outline-id]")]
        .filter((element) => element.getBoundingClientRect().height > 0);
      const anchor = outlines.find((element) => element.getBoundingClientRect().bottom > 1)
        || outlines.at(-1);
      if (!anchor) return { outlineId: "", ratio: 0 };
      const rect = anchor.getBoundingClientRect();
      return {
        outlineId: anchor.getAttribute("data-pageroot-outline-id") || "",
        ratio: Math.max(0, Math.min(1, (0 - rect.top) / Math.max(1, rect.height))),
      };
    });
    const beforeOutlineAnchor = await visibleOutlineAnchor(beforeReviewFrame);
    expect(beforeOutlineAnchor.outlineId).not.toBe("");
    const afterOutlineProgress = () => afterReviewFrame.locator(
      `[data-pageroot-outline-id="${beforeOutlineAnchor.outlineId}"]`,
    ).evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return Math.max(0, Math.min(1, (0 - rect.top) / Math.max(1, rect.height)));
    });
    await expect.poll(afterOutlineProgress).toBeCloseTo(beforeOutlineAnchor.ratio, 1);
    await beforeReviewFrame.locator("html").evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBe(0);
    await beforeReviewFrame.locator("html").evaluate(() => {
      window.scrollTo(0, 0);
      dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
    });
    await launched.page.waitForTimeout(120);
    expect(await afterReviewFrame.locator("html").evaluate(() => window.scrollY)).toBe(0);
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.getByRole("slider", {
        name: "非修改区域上下文可见度",
      }).fill("18");
      await wholePageButton.click();
      await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
        "data-pageroot-review-filter",
      )).toBe("all");
      await Promise.all([
        beforeViewport.evaluate((element) => { element.scrollLeft = 0; }),
        afterViewport.evaluate((element) => { element.scrollLeft = 0; }),
        beforeReviewFrame.locator("html").evaluate(() => window.scrollTo(0, 0)),
        afterReviewFrame.locator("html").evaluate(() => window.scrollTo(0, 0)),
      ]);
      const closeMapButton = launched.page.getByRole("button", {
        name: "收起内容地图",
      }).first();
      if (await closeMapButton.isVisible()) await closeMapButton.click();
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-final.png"),
        animations: "disabled",
      });
      await launched.page.getByRole("button", {
        name: "打开内容地图",
      }).click();
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-map.png"),
        animations: "disabled",
      });
    }
    await launched.page.getByRole("button", {
      name: "打开 AI 修改后",
    }).click();
    await expect(launched.page.getByRole("dialog", {
      name: /打开 AI 修改后（.+）？/u,
    })).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "继续审阅" }))
      .toBeFocused();
    await launched.page.evaluate(() => {
      window.__pagerootSawHandoffFlash = false;
      window.__pagerootHandoffFlashEvents = [];
      window.__pagerootHandoffObserver = new MutationObserver(() => {
        const panel = document.querySelector(".handoff-panel");
        const review = document.querySelector('[data-testid="ai-review-workspace"]');
        const reviewCoversWindow = Boolean(
          review
          && review.getClientRects().length > 0
          && getComputedStyle(review).position === "fixed",
        );
        if (panel && panel.getClientRects().length > 0 && !reviewCoversWindow) {
          window.__pagerootSawHandoffFlash = true;
          window.__pagerootHandoffFlashEvents.push({
            panelText: panel.textContent?.slice(0, 120) || "",
            reviewPresent: Boolean(review),
            drawer: document.querySelector(".side-drawer")?.getAttribute("data-drawer") || "",
            sourceTitle: document.querySelector(".window-file-title-row strong")?.textContent || "",
          });
        }
      });
      window.__pagerootHandoffObserver.observe(document.body, { childList: true, subtree: true });
    });
    await launched.page.getByRole("button", { name: "确认并打开" }).click();
    await expect.poll(async () => launched.page.evaluate(async () => {
      const project = await window.htmlAIProjects?.getActiveProject();
      const reviewVisible = Boolean(document.querySelector('[data-testid="ai-review-workspace"]'));
      const visibleAlert = [...document.querySelectorAll('[role="alert"]')]
        .find((element) => element.getClientRects().length > 0)?.textContent || "";
      return `${project?.sourcePath || ""}|review=${reviewVisible}|alert=${visibleAlert}`;
    }), { timeout: 30_000 }).toMatch(/\/working\/generated-ai-loop-V1\.1\.html\|review=false/u);
    const opened = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(opened.sourcePath).not.toBe(fixture.sourcePath);
    expect(opened.sourcePath).toMatch(/\/working\/generated-ai-loop-V1\.1\.html$/u);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(readFileSync(opened.sourcePath, "utf8")).toContain(UPDATED_TEXT);
    expect(await launched.page.evaluate(() => {
      window.__pagerootHandoffObserver?.disconnect();
      return window.__pagerootHandoffFlashEvents;
    })).toEqual([]);
    await expect(launched.page.locator(".handoff-panel").filter({ visible: true }))
      .toHaveCount(0);
    const openedFrame = await loadedDiskFrame(launched.page, opened.sourcePath);
    await expect(openedFrame.locator(caseSelector("list-item")))
      .toHaveText(UPDATED_TEXT);

    await expect(launched.page.locator(".save-status"))
      .toHaveText("已安全保存", { timeout: 30_000 });
    await launched.page.getByRole("button", { name: "预览", exact: true }).click();
    const previewFrame = launched.page.frameLocator(
      'iframe[title="HTML 交互预览"]',
    );
    await expect(previewFrame.locator(caseSelector("list-item")))
      .toHaveText(UPDATED_TEXT, { timeout: 30_000 });
    await expect(launched.page.locator(".save-status"))
      .toHaveText("已安全保存", { timeout: 30_000 });
    await launched.page.getByRole("button", { name: "编辑", exact: true }).click();

    await launched.electronApp.evaluate(({ dialog }, sourcePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [sourcePath],
      });
    }, pickerSourcePath);
    await launched.page.getByRole("button", {
      name: "打开新的本地 HTML",
      exact: true,
    }).click();
    const pickerFrame = await loadedDiskFrame(
      launched.page,
      pickerSourcePath,
    );
    await expect(pickerFrame.locator(caseSelector("list-item")))
      .toHaveText(PICKER_TEXT);
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
      "修改结果已完成检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "直接打开" }).click();
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
      "修改结果已完成检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "直接打开" }).click();
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

test("an internal AI supplement is sealed, applied, opened, and shown in history", async () => {
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
      "修改结果已完成检查",
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

    await launched.page.getByRole("button", { name: "直接打开" }).click();
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

test("a no-change result returns to editing and remains reopenable", async () => {
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
    await expect(launched.page.getByRole("button", { name: "修改要求" }))
      .toHaveCount(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    await launched.page.getByRole("button", { name: "返回编辑" }).click();
    await expect(launched.page.getByRole("button", { name: "上轮处理" }))
      .toBeVisible();
    await expect(launched.page.getByRole("button", { name: /发送至 Qoder/u }))
      .toBeEnabled();
    await launched.page.getByRole("button", { name: "上轮处理" }).click();
    await expect(launched.page.getByText(
      "这次没有产生有效变化",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible();
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("returning from review restores the editable pre-AI version and preserves the candidate", async () => {
  test.setTimeout(180_000);
  const fixture = createSourceFixture("return-before-ai.html");
  const commentText = `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`;
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    writeAiOutput(
      request.requestRoot,
      (base) => base.replace(ORIGINAL_TEXT, UPDATED_TEXT),
    );
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByText(
      "修改结果已完成检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    const candidateFiles = workingHtmlFiles(
      launched.workspace,
      request.changeRequest.projectId,
    );
    expect(candidateFiles).toHaveLength(1);
    expect(readFileSync(candidateFiles[0], "utf8")).toContain(UPDATED_TEXT);

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", { name: "返回 AI 修改前" }).click();
    const dialog = launched.page.getByRole("dialog", {
      name: /返回 AI 修改前（版本 \d+）？/u,
    });
    await expect(dialog).toBeVisible();
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-return-confirmation.png"),
        animations: "disabled",
      });
    }
    await expect(dialog.getByText(/确认后不会采用这次 AI 返回的 版本 \d+。/u))
      .toBeVisible();
    await expect(dialog.getByText(/将继续使用 版本 \d+（AI 修改前）为基线重新修改。/u))
      .toBeVisible();
    await expect(dialog.getByRole("button", {
      name: "AI 返回的 HTML 已自动保留，点击在 Finder 中显示。",
    })).toBeVisible();
    const [returnBackground, continueBackground] = await Promise.all([
      dialog.getByRole("button", { name: "返回修改前版本" })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      dialog.getByRole("button", { name: "继续审阅" })
        .evaluate((element) => getComputedStyle(element).backgroundColor),
    ]);
    expect(returnBackground).not.toBe(continueBackground);
    await dialog.getByRole("button", { name: "返回修改前版本" }).click();

    await expect(launched.page.getByTestId("ai-review-workspace")).toHaveCount(0);
    await loadedDiskFrame(launched.page, fixture.sourcePath);
    await expect(launched.page.locator(".comment-card").filter({ hasText: commentText }))
      .toHaveCount(1);
    const restored = await launched.page.evaluate(
      () => window.htmlAIProjects?.getActiveProject(),
    );
    expect(restored.sourcePath).toBe(realpathSync(fixture.sourcePath));
    const registry = JSON.parse(readFileSync(
      path.join(launched.workspace, "project-registry.json"),
      "utf8",
    ));
    const runtime = JSON.parse(readFileSync(path.join(
      launched.workspace,
      "projects",
      registry.projects[request.changeRequest.projectId].storageDirectoryName,
      "runtime-state.json",
    ), "utf8"));
    expect(runtime.lifecycleState).toBe("editing");
    expect(runtime.activeRun).toBeNull();
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
    expect(existsSync(candidateFiles[0])).toBe(true);
    expect(readFileSync(candidateFiles[0], "utf8")).toContain(UPDATED_TEXT);
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
    const processingDialog = launched.page.getByRole("dialog", { name: "本轮处理" });
    const handoffError = processingDialog.getByText(
      "交接内容尚未复制",
      { exact: true },
    );
    await expect(handoffError).toBeVisible();
    await expect(launched.page.getByRole("alert")
      .filter({ hasText: "交接内容还没有复制" })).toHaveCount(0);
    await launched.page.keyboard.press("Escape");
    await expect(processingDialog).toBeHidden();
    await launched.page.getByRole("button", { name: "复制失败 · 查看" }).click();
    await expect(processingDialog).toBeVisible();
    const retryCopy = launched.page.getByRole("button", { name: "重新复制" });
    await expect(retryCopy).toBeVisible();
    await expect(launched.page.getByRole("button", { name: "取消本轮" }))
      .toBeVisible();
    await retryCopy.click();
    await expect(handoffError).toBeVisible();
    const projectsRoot = path.join(launched.workspace, "projects");
    await expect.poll(() => (
      existsSync(projectsRoot)
        ? readdirSync(projectsRoot).some((projectDirectoryName) => (
            existsSync(path.join(
              projectsRoot,
              projectDirectoryName,
              "requests",
            ))
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
    const processingDialog = launched.page.getByRole("dialog", { name: "本轮处理" });
    await expect(processingDialog.getByText(
      "交接内容尚未复制",
      { exact: true },
    ))
      .toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(1);

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
    await expect(processingDialog).toBeVisible();
    await expect(launched.page.getByText("交接内容尚未复制", { exact: true }))
      .toBeVisible();
    await launched.page.keyboard.press("Escape");
    await expect(processingDialog).toBeHidden();
    await expect(launched.page.getByRole("button", { name: "复制失败 · 查看" }))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "复制失败 · 查看" }).click();
    await expect(launched.page.getByText("交接内容尚未复制", { exact: true }))
      .toBeVisible();

    await openRecentProject(launched.page, projectB.sourcePath, { editable: false });
    await expect(processingDialog).toBeVisible();
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

test("ending a copied run still warns after restart and blocks late finalization", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("cancel-copied-run.html");
  let launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
    );
    await closePageRootGracefully(launched.electronApp);
    launched = await launchPageRoot({
      activeSourcePath: fixture.sourcePath,
      isolatedUserData: launched.isolatedUserData,
    });
    await expect(launched.page.getByText(
      "等待 QoderWork 返回修改结果",
      { exact: true },
    )).toBeVisible();
    const endRound = launched.page.getByRole("button", {
      name: "结束本轮并继续编辑",
    }).filter({ visible: true }).first();
    await expect(endRound).toBeEnabled();
    await endRound.click();

    const warning = launched.page.getByRole("dialog", {
      name: "AI Agent 可能仍在修改",
    });
    await expect(warning).toBeVisible();
    await expect(warning.getByText(
      "结束本轮后，AI Agent 的修改将不会保存到源页。建议先停止 AI Agent。",
      { exact: true },
    )).toBeVisible();
    const continueWaiting = warning.getByRole("button", { name: "继续等待" });
    await expect(continueWaiting).toBeFocused();
    await continueWaiting.click();
    await expect(warning).toBeHidden();
    await expect(endRound).toBeEnabled();

    await endRound.click();
    await warning.getByRole("button", {
      name: "结束本轮并继续编辑",
    }).click();
    await expect(warning).toBeHidden();
    const cancellationNotice = launched.page.locator(".toast.show").filter({
      hasText: "本轮已结束，已恢复编辑",
    });
    await expect(cancellationNotice).toBeVisible();
    await expect(cancellationNotice.getByText(
      "AI Agent 不会被自动停止；如仍在运行，请手动停止。",
      { exact: true },
    )).toBeVisible();
    await expect(launched.page.getByRole("button", {
      name: "全局评论",
      exact: true,
    })).toBeEnabled();
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);

    writeAiOutput(request.requestRoot, (base) => (
      base.replace(ORIGINAL_TEXT, UPDATED_TEXT)
    ));
    const lateFinalization = runOfficialFinalizer(
      request.requestRoot,
      request.changeRequest,
    );
    expect(lateFinalization).toMatchObject({
      ok: true,
      status: "cancelled",
      accepted: false,
      retryable: false,
    });
    expect(lateFinalization.message)
      .toBe("本轮已在源页结束。请停止 AI Agent，不要重试。");
    expect(existsSync(path.join(
      request.requestRoot,
      "attempts",
      "attempt_001",
      "completion.json",
    ))).toBe(false);
    expect(
      workingHtmlFiles(
        launched.workspace,
        request.changeRequest.projectId,
      ),
    ).toHaveLength(0);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("an unknown Request outcome stays fail-closed and reconciles automatically", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("unknown-request-outcome.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await addComment(launched.page, fixture.sourcePath);
    let requestDispatched = false;
    let allowUnknownRequestReconcile = false;
    const bridgeRoute = "**/*";
    const injectUnknownRequestOutcome = async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/request" && !requestDispatched) {
        requestDispatched = true;
        const response = await route.fetch();
        if (!response.ok()) {
          await route.fulfill({ response });
          return;
        }
        await route.abort("timedout");
        return;
      }
      if (
        url.pathname === "/workspace"
        && requestDispatched
        && !allowUnknownRequestReconcile
      ) {
        await route.abort("timedout");
        return;
      }
      await route.continue();
    };
    await launched.page.route(bridgeRoute, injectUnknownRequestOutcome);

    await launched.page.getByRole("button", { name: /发送至 Qoder/u }).click();
    await expect(launched.page.getByText(
      "正在确认这次发送是否成功",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(launched.page.getByRole("button", { name: "立即重新核对" }))
      .toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "重新打开源页" }).first())
      .toHaveCount(0);
    await expect.poll(
      () => requestDirectoryCount(launched.workspace),
      { timeout: 20_000 },
    ).toBe(1);

    allowUnknownRequestReconcile = true;
    await expect(launched.page.getByText(
      "等待 QoderWork 返回修改结果",
      { exact: true },
    )).toBeVisible({ timeout: 20_000 });
    await launched.page.unroute(bridgeRoute, injectUnknownRequestOutcome);
    await expect(launched.page.getByRole("button", {
      name: "结束本轮并继续编辑",
    })).toBeEnabled();
    expect(requestDirectoryCount(launched.workspace)).toBe(1);
    expect(readFileSync(fixture.sourcePath).equals(fixture.original)).toBe(true);
  } finally {
    await stopPageRoot(launched.electronApp, launched.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("project resources expose clear rules and drain edits before leaving", async () => {
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
    const projectsRoot = path.join(launched.workspace, "projects");
    const [projectDirectoryName] = readdirSync(projectsRoot)
      .filter((entry) => !entry.startsWith("."));
    const projectRulesPath = path.join(
      projectsRoot,
      projectDirectoryName,
      "PROJECT.md",
    );
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

test("a persisted legacy global comment stays exact after restart and sends directly", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("global-comment-restart.html");
  const firstLaunch = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  const commentText = "重启后仍然保持整个页面的视觉层级。";
  let activeLaunch = firstLaunch;
  try {
    const frame = await loadedDiskFrame(firstLaunch.page, fixture.sourcePath);
    await firstLaunch.page.getByRole("button", { name: "全局评论" }).click();
    await firstLaunch.page.getByRole("textbox", { name: "评论内容" })
      .fill(commentText);
    await firstLaunch.page.getByRole("button", { name: "评论", exact: true }).click();
    await expect(firstLaunch.page.locator(".comment-card")
      .filter({ hasText: commentText }))
      .toHaveAttribute("data-resolution", "exact");
    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_TEXT.length);
    await firstLaunch.page.keyboard.insertText("重启兼容测试");
    await expect.poll(
      () => readFileSync(fixture.sourcePath, "utf8"),
      { timeout: 20_000 },
    ).toContain("重启兼容测试");
    await expect.poll(
      () => workspaceContainsDraftComment(firstLaunch.workspace, commentText),
      { timeout: 20_000 },
    ).toBe(true);

    await closePageRootGracefully(firstLaunch.electronApp);
    expect(workspaceContainsDraftComment(firstLaunch.workspace, commentText)).toBe(true);
    expect(rewriteWorkspaceDraftComment(
      firstLaunch.workspace,
      commentText,
      (comment) => {
        delete comment.target.fingerprint;
        comment.target.resolution = "orphaned";
      },
    )).toBe(true);
    activeLaunch = await launchPageRoot({
      activeSourcePath: fixture.sourcePath,
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    expect(workspaceContainsDraftComment(activeLaunch.workspace, commentText)).toBe(true);
    await loadedDiskFrame(activeLaunch.page, fixture.sourcePath);
    const recoveredComment = activeLaunch.page.locator(".comment-card")
      .filter({ hasText: commentText });
    await expect(recoveredComment).toHaveAttribute("data-resolution", "exact");
    await expect(recoveredComment.getByText("原位置已变化")).toHaveCount(0);

    await activeLaunch.page.getByRole("button", { name: /发送至 Qoder/u }).click();
    await expect(activeLaunch.page.getByText(
      "等待 QoderWork 返回修改结果",
      { exact: true },
    )).toBeVisible({ timeout: 30_000 });
    await expect(activeLaunch.page.getByText(/评论需要重新定位/u)).toHaveCount(0);
  } finally {
    await stopPageRoot(activeLaunch.electronApp, firstLaunch.isolatedUserData);
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
  try {
    const frame = await loadedDiskFrame(firstLaunch.page, fixture.sourcePath);
    await addComment(firstLaunch.page, fixture.sourcePath, firstComment, "list-item");
    await addComment(firstLaunch.page, fixture.sourcePath, secondComment, "table-cell");

    await activateNativeEdit(frame, "list-item");
    await setTextSelection(frame, "list-item", 0, ORIGINAL_TEXT.length);
    await firstLaunch.page.keyboard.insertText("失联评论登记测试");
    await expect.poll(
      () => workspaceContainsDraftComment(firstLaunch.workspace, secondComment),
      { timeout: 20_000 },
    ).toBe(true);
    await closePageRootGracefully(firstLaunch.electronApp);

    const externallyChanged = readFileSync(fixture.sourcePath, "utf8")
      .replace(
        /<li data-native-case="list-item"[^>]*>[\s\S]*?<\/li>/u,
        "",
      )
      .replace(
        /<td data-native-case="table-cell"[^>]*>[\s\S]*?<\/td>/u,
        "",
      );
    writeFileSync(fixture.sourcePath, externallyChanged, "utf8");

    activeLaunch = await launchPageRoot({
      activeSourcePath: fixture.sourcePath,
      isolatedUserData: firstLaunch.isolatedUserData,
    });
    const recoveredFrame = await loadedDiskFrame(
      activeLaunch.page,
      fixture.sourcePath,
      { expectedCase: "flex-copy" },
    );
    const recoveredComments = activeLaunch.page.locator(".comment-card");
    await expect(recoveredComments).toHaveCount(2);
    await expect(recoveredComments.filter({ hasText: firstComment }))
      .toHaveAttribute("data-resolution", "orphaned");
    await expect(recoveredComments.filter({ hasText: secondComment }))
      .toHaveAttribute("data-resolution", "orphaned");

    await activeLaunch.page.getByRole("button", { name: /发送至 Qoder/u }).click();
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
      "等待 QoderWork 返回修改结果",
      { exact: true },
    )).toBeVisible({ timeout: 30_000 });
    await expect.poll(
      () => requestDirectoryCount(activeLaunch.workspace),
      { timeout: 20_000 },
    ).toBe(1);
  } finally {
    await stopPageRoot(activeLaunch.electronApp, firstLaunch.isolatedUserData);
    removeSourceFixture(fixture.sourceDirectory);
  }
});

test("automatic update actions sit on the HTML icon and the icon opens About", async () => {
  const fixture = createSourceFixture("update-indicator.html");
  const launched = await launchPageRoot({ activeSourcePath: fixture.sourcePath });
  try {
    await loadedDiskFrame(launched.page, fixture.sourcePath);
    const evidenceDirectory = path.join(
      productRoot,
      "output/design-qa/comment-presentation-header-polish",
    );
    mkdirSync(evidenceDirectory, { recursive: true });
    const captureHeader = async (fileName, { badgeExpected = true } = {}) => {
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
          viewportWidth: window.innerWidth,
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
      await launched.page.screenshot({
        path: path.join(evidenceDirectory, fileName),
        clip: {
          x: 0,
          y: 0,
          width: Math.min(900, geometry.viewportWidth),
          height: geometry.header.height,
        },
      });
      return geometry;
    };

    const noUpdateGeometry = await captureHeader("no-update.png", {
      badgeExpected: false,
    });

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
      name: "发现 PageRoot 9.9.9，下载更新",
    })).toBeVisible();
    const newGeometry = await captureHeader("new-update.png");

    await launched.page.getByRole("button", { name: "关于源页" }).click();
    await expect(launched.page.getByRole("dialog", { name: "源页" }))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "关闭关于源页" }).click();
    await expect(launched.page.locator("dialog.about-dialog[open]"))
      .toHaveCount(0);
    await launched.page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));

    await launched.electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.webContents.send(
        "html-updates:status",
        {
          status: "downloaded",
          currentVersion: "0.8.6",
          latestVersion: "9.9.9",
          minimumMacOS: "12.0",
          architecture: "arm64",
          publishedAt: "2026-07-23T00:00:00.000Z",
        },
      );
    });
    await expect(launched.page.getByRole("button", {
      name: "PageRoot 9.9.9 已下载，重启更新",
    })).toBeVisible();
    await expect(launched.page.getByRole("dialog", {
      name: "现在重启并安装更新？",
    })).toBeVisible();
    await launched.page.getByRole("button", { name: "稍后" }).click();
    await expect(launched.page.locator("dialog.restart-update-dialog[open]"))
      .toHaveCount(0);
    await launched.page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const restartGeometry = await captureHeader("restart-update.png");
    for (const geometry of [newGeometry, restartGeometry]) {
      expect(geometry.icon).toEqual(noUpdateGeometry.icon);
      expect(geometry.cluster).toEqual(noUpdateGeometry.cluster);
      expect(geometry.fileCopy).toEqual(noUpdateGeometry.fileCopy);
    }
    writeFileSync(
      path.join(evidenceDirectory, "header-geometry.json"),
      JSON.stringify({
        viewport: { width: newGeometry.viewportWidth },
        none: noUpdateGeometry,
        available: newGeometry,
        downloaded: restartGeometry,
      }, null, 2),
      "utf8",
    );
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

test("a broad but related AI return is accepted without a target-scope error", async () => {
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
    await expect(launched.page.getByText(
      "修改结果已完成检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await expect(launched.page.getByText("已记录评论范围外的额外变化", { exact: true }))
      .toHaveCount(0);
    await expect(launched.page.getByRole("button", { name: "采用这些额外变化" }))
      .toHaveCount(0);
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
      "修改结果已完成检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });
    await launched.page.getByRole("button", {
      name: "直接打开",
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
