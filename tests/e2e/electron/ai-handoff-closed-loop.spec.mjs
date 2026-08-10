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
const READABLE_REWRITE_BEFORE = "综搜整体仍处于放缓背景，关键不在于单纯增加曝光，而在于识别商品需求，并用更匹配的供给承接；核心仍是让模型识别电商意图，再优化结果组织，把模糊兴趣转化为可验证需求。";
const READABLE_REWRITE_AFTER = "综搜放缓，但电商搜索仍有较高大盘。关键是识别内容浏览中的潜在商品需求，并用匹配供给承接。供给可归纳为电商意图识别、优化结果组织，将模糊兴趣转为可验证需求。";
const REVIEW_METRIC_BEFORE_CSS = `
      [data-review-metrics] {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }
      [data-review-metric] {
        display: grid;
        gap: 10px;
        padding: 18px;
        border: 2px solid #d9dcec;
        border-top: 4px solid #6d5ce7;
        border-radius: 16px;
        background: #ffffff;
        color: #2d2d39;
      }
      [data-review-metric] strong { color: #6d5ce7; font-size: 28px; }
      [data-review-metric] span { color: #555767; }
      [data-review-metric] small { color: #239b56; }
      [data-review-inherited-copy] { color: #555767; font-family: sans-serif; }
      [data-review-logical-card] { block-size: 54px; inline-size: 240px; overflow: hidden; }
`;
const REVIEW_METRIC_AFTER_CSS = `
      [data-review-metrics] {
        display: grid;
        grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 18px;
      }
      [data-review-metric] {
        display: grid;
        gap: 10px;
        padding: 18px;
        border: 2px solid #241d58;
        border-top: 4px solid #6d5ce7;
        border-radius: 16px;
        background: #241d58;
        color: #ffffff;
      }
      [data-review-metric] strong { color: #ffffff; font-size: 28px; }
      [data-review-metric] span { color: #dedcf2; }
      [data-review-metric] small { color: #9fe6bf; }
      [data-review-inherited-copy] { color: #ffffff; font-family: sans-serif; }
      [data-review-logical-card] { block-size: 84px; inline-size: 240px; overflow: hidden; }
`;

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
  const mainRendererUrl = page.url();
  const nativeWindow = await electronApp.evaluate(({ BrowserWindow }, rendererUrl) => {
    const window = BrowserWindow.getAllWindows().find((candidate) => (
      candidate.webContents.getURL() === rendererUrl
    ));
    if (!window) {
      throw new Error("PageRoot main BrowserWindow is unavailable during launch.");
    }
    window?.webContents.setBackgroundThrottling(false);
    return {
      focused: window?.isFocused() || false,
      visible: window?.isVisible() || false,
    };
  }, mainRendererUrl);
  const foreground = (
    injectedEnv.PAGEROOT_E2E_FOREGROUND
    ?? process.env.PAGEROOT_E2E_FOREGROUND
  ) === "1";
  expect(nativeWindow.visible).toBe(foreground);
  if (!foreground) expect(nativeWindow.focused).toBe(false);
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

async function closePageRootGracefully(electronApp, page) {
  const mainRendererUrl = page?.url();
  if (!mainRendererUrl) {
    throw new Error("PageRoot main renderer URL is unavailable for graceful close.");
  }
  const closed = electronApp.waitForEvent("close", { timeout: 20_000 });
  const requested = await electronApp.evaluate(({ BrowserWindow }, rendererUrl) => {
    // Runtime snapshots own hidden offscreen BrowserWindows. The E2E close
    // must target the known app renderer instead of assuming array order.
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

async function sendToMainRenderer(electronApp, page, channel, payload) {
  const mainRendererUrl = page?.url();
  if (!mainRendererUrl) {
    throw new Error("PageRoot main renderer URL is unavailable for renderer IPC.");
  }
  const delivered = await electronApp.evaluate(
    ({ BrowserWindow }, { rendererUrl, messageChannel, messagePayload }) => {
      const mainWindow = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL() === rendererUrl
      ));
      if (!mainWindow) return false;
      mainWindow.webContents.send(messageChannel, messagePayload);
      return true;
    },
    {
      rendererUrl: mainRendererUrl,
      messageChannel: channel,
      messagePayload: payload,
    },
  );
  if (!delivered) {
    throw new Error("PageRoot main BrowserWindow was unavailable for renderer IPC.");
  }
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
  additionalComments = [],
) {
  await electronApp.evaluate(({ clipboard }) => clipboard.clear());
  await addComment(
    page,
    sourcePath,
    `只把这个列表项改为“${updatedText}”，其他地方保持不变。`,
  );
  for (const comment of additionalComments) {
    await addComment(
      page,
      sourcePath,
      comment.text,
      comment.targetCase,
      comment.targetSelector,
    );
  }
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
  expect(changeRequest.requirements.instructions).toHaveLength(
    1 + additionalComments.length,
  );
  expect(changeRequest.requirements.instructions.some(
    (instruction) => instruction.text.includes(updatedText),
  )).toBe(true);
  expect(changeRequest.requirements.preserveOutsideTargets).toBe(true);
  return { promptPath, requestRoot, changeRequest };
}

async function addComment(page, sourcePath, text = (
  `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`
), targetCase = "list-item", targetSelector = "") {
  const frame = await loadedDiskFrame(page, sourcePath);
  const target = frame.locator(targetSelector || caseSelector(targetCase));
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
  const changeRequest = JSON.parse(readFileSync(
    path.join(requestRoot, "change-request.json"),
    "utf8",
  ));
  const outputRelativePath = changeRequest.finalization?.outputRelativePath;
  if (
    typeof outputRelativePath !== "string"
    || !outputRelativePath.startsWith("output/")
  ) {
    throw new Error("Request is missing its frozen AI output path.");
  }
  const attemptRoot = path.join(
    requestRoot,
    "attempts",
    "attempt_001",
  );
  const outputPath = path.join(
    attemptRoot,
    ...outputRelativePath.split("/"),
  );
  mkdirSync(path.dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, output, "utf8");
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
    `    <style data-review-metric-theme>${REVIEW_METRIC_BEFORE_CSS}    </style>
    <section data-review-regression>
      <h2>核心结论</h2>
      <div data-review-regression-summary>在守住 EBITA 率底线的基础上，锁单确收实现 +8.52% 增长；21 天日均增量 +4.12 万，累计增量 +86.6 万。</div>
      <div data-review-semantic-copy>而非「让每个商品卖得更好」（品均基本持平）。这说明增长主要来自有效成交覆盖扩大。</div>
      <div data-review-readable-rewrite style="width: 360px; line-height: 1.7">${READABLE_REWRITE_BEFORE}</div>
      <p data-review-layout-only style="width: 240px; padding: 4px; border: 1px solid #c9ceda">同一段文字保持不变<br>只是换行位置调整。</p>
      <p data-review-cross-line style="width: 150px; line-height: 1.6">稳定前缀，稳定后缀。</p>
      <p data-review-stable-sentence-rewrite style="width: 150px; line-height: 1.6">稳定前句。旧方案覆盖多个指标、多个渠道、多个阶段，并给出较长说明。稳定后句。</p>
      <style data-review-marker-style>[data-review-injection-stability] span { display:block !important; padding:9px !important; }</style>
      <style data-review-projection-style>div, svg { outline:7px solid rgb(255 0 153) !important; }</style>
      <p data-review-injection-stability><span data-review-stable-left>稳定左侧</span><strong>旧词</strong><em data-review-stable-right>稳定右侧</em></p>
      <p class="review-comment-ordinary-target">普通段落评论定位保持独立。</p>
      <script>
        const ordinaryCommentTarget = document.querySelector(".review-comment-ordinary-target");
        const ordinaryCommentSibling = document.createElement("p");
        ordinaryCommentSibling.className = ordinaryCommentTarget.className;
        ordinaryCommentSibling.textContent = "运行时插入的同类段落";
        ordinaryCommentTarget.before(ordinaryCommentSibling);
      </script>
      <div data-review-metrics>
        <article data-review-metric="lock"><strong>+8.52%</strong><span>锁单确收增幅（显著 p&lt;0.01）</span><small>日均 52.5 万 vs 48.4 万</small></article>
        <article data-review-metric="ipv"><strong>+4.49%</strong><span>IPV 增幅（显著 p&lt;0.01）</span><small>日均 63.4 万 vs 60.7 万</small></article>
        <article data-review-metric="cvr"><strong>+6.85%</strong><span>CVR 增幅（显著 p&lt;0.01）</span><small>0.217% vs 0.203%</small></article>
      </div>
      <div data-review-inherited-copy style="width: 420px; padding: 24px; border: 2px solid #b8b8c7">内容级视觉调整</div>
      <div data-review-logical-card style="padding: 12px; border: 2px solid #b8b8c7">逻辑尺寸视觉调整</div>
      <div data-review-atomic-media style="display:flex;align-items:center;gap:6px">
        <span data-review-atomic-stable-before>稳定媒体前文。</span>
        <img data-review-atomic-removed alt="旧品牌图示" src="data:image/svg+xml,%3Csvg/%3E" width="28" height="20">
        <svg data-review-atomic-paired role="img" aria-label="趋势图" width="30" height="20" viewBox="0 0 30 20" fill="#8aa4c8"></svg>
        <input data-review-atomic-input name="品牌标识" type="text" value="品牌甲" style="width:60px;border:1px solid #9aa4b2">
        <span data-review-atomic-stable-after>稳定媒体后文。</span>
      </div>
      <div data-review-mixed-copy>
        <p data-review-reference>参考：示例日均确收约207万，增量4.12万/天约占2.0%。</p>
        <p data-review-delete-only>实验结果稳定。换言之，策略有效。</p>
        <p data-review-warning>⚠️ 近6天(7/23-<span><strong>7/28)增幅收窄至负值区间，需</strong></span>持续关注。</p>
      </div>
      <div data-review-numbered-lines>① 业务盘子：整体规模稳定。<br>② 实验贡献：日均增量明确。<br>③ 经营解读：效率保持稳定。</div>
      <ol data-review-list-items>
        <li>业务盘子稳定</li><li>实验贡献明确<ul data-review-nested-list><li>嵌套稳定项</li></ul></li><li>经营效率稳定</li>
      </ol>
      <table data-review-brand-table style="table-layout:fixed;width:210px;word-break:break-all">
        <thead><tr><th style="width:42px">品牌</th><th>类目</th><th>对照组</th></tr></thead>
        <tbody>
          <tr data-review-brand-row="alpha"><td>品牌甲</td><td>类目一</td><td>3.7万</td></tr>
          <tr data-review-brand-row="beta"><td>品牌乙</td><td>类目二</td><td>1.4万</td></tr>
          <tr data-review-brand-row="gamma"><td>品牌丙</td><td>类目三</td><td>2.3万</td></tr>
          <tr data-review-brand-row="delta"><td>品牌丁</td><td>类目二</td><td>3.7万</td></tr>
        </tbody>
      </table>
      <div data-review-break-layout><span>日均63<br><br>.4万<br>60.7万</span></div>
      <div data-review-deleted-copy><strong>品均拆解：</strong>总确收增长来自覆盖扩大。<br>待删除第一行<br>待删除第二行<br>待删除第三行<br>AI托管的核心价值保持不变。</div>
    </section>
    <section data-review-ebita-section>
      <h2>3EBITA分析</h2>
      <div data-review-ebita-copy><strong>结论：</strong>EBITA差异均在波动范围<br>内（0.06~0.13pt），AI托管未恶化盈利能力。</div>
    </section>
    <section data-review-anchor-only-section>
      <h2>删除锚点导航</h2>
      <div style="height:280px" aria-hidden="true"></div>
      <p data-review-anchor-only style="line-height:48px">稳定开头。<br>稳定中段。<br>只删除这句定位文字。稳定结尾。</p>
      <div style="height:360px" aria-hidden="true"></div>
    </section>
    <section data-review-runtime-snapshot>
      <h2>运行态 Snapshot</h2>
      <canvas id="review-runtime-snapshot-canvas" width="320" height="96"></canvas>
      <div id="review-runtime-snapshot-host" data-runtime-snapshot-host></div>
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
    <div class="indexed-review-tabs">
      <button type="button" class="indexed-review-tab active" onclick="switchIndexedReviewTab(0)">分行业表现</button>
      <button type="button" class="indexed-review-tab" onclick="switchIndexedReviewTab(1)">抖音搜盘表现</button>
    </div>
    <div class="indexed-review-panels">
      <section id="indexed-review-panel-one" class="indexed-review-panel active" style="display: block; min-height: 240px">
        <h2>分行业表现</h2><p>索引式页签第一页</p>
      </section>
      <section id="indexed-review-panel-two" class="indexed-review-panel" style="display: none; min-height: 960px">
        <h2>抖音搜盘表现</h2><p>索引式页签第二页</p>
      </section>
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
      function switchIndexedReviewTab(activeIndex) {
        document.querySelectorAll(".indexed-review-tab").forEach((tab, index) => {
          tab.classList.toggle("active", index === activeIndex);
        });
        document.querySelectorAll(".indexed-review-panel").forEach((panel, index) => {
          panel.classList.toggle("active", index === activeIndex);
          panel.style.display = index === activeIndex ? "block" : "none";
        });
      }
      const runtimeSnapshotVariant = "before";
      const runtimeSnapshotColor = runtimeSnapshotVariant === "before" ? "#9aaec2" : "#6d5ce7";
      const runtimeSnapshotWidth = runtimeSnapshotVariant === "before" ? 144 : 238;
      const runtimeSnapshotCanvas = document.querySelector("#review-runtime-snapshot-canvas");
      const runtimeSnapshotContext = runtimeSnapshotCanvas.getContext("2d");
      runtimeSnapshotContext.fillStyle = "#f5f3ff";
      runtimeSnapshotContext.fillRect(0, 0, 320, 96);
      runtimeSnapshotContext.fillStyle = runtimeSnapshotColor;
      runtimeSnapshotContext.fillRect(24, 20, runtimeSnapshotWidth, 56);
      const runtimeSnapshotHost = document.querySelector("#review-runtime-snapshot-host");
      runtimeSnapshotHost.innerHTML = '<svg viewBox="0 0 320 96" width="320" height="96" aria-label="运行态 SVG"><rect x="24" y="20" width="' + runtimeSnapshotWidth + '" height="56" fill="' + runtimeSnapshotColor + '"></rect></svg>';
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
  const ordinaryReviewCommentText = "这个普通段落也请保留。";
  try {
    const request = await addCommentAndSubmit(
      launched.page,
      launched.electronApp,
      fixture.sourcePath,
      UPDATED_TEXT,
      [{
        text: ordinaryReviewCommentText,
        targetSelector: ".review-comment-ordinary-target",
      }],
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
        .replace(REVIEW_METRIC_BEFORE_CSS, REVIEW_METRIC_AFTER_CSS)
        .replace(
          'const runtimeSnapshotVariant = "before";',
          'const runtimeSnapshotVariant = "after";',
        )
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
          '<p data-review-reference>参考：示例日均确收约207万，增量4.12万/天约占2.0%。</p>',
          '<p data-review-reference>参考：示例日均确收约207万，本实验增量4.12万/天约占2.0%。</p>',
        )
        .replace(
          '<p data-review-delete-only>实验结果稳定。换言之，策略有效。</p>',
          '<p data-review-delete-only>实验结果稳定。策略有效。</p>',
        )
        .replace(
          '<div data-review-numbered-lines>① 业务盘子：整体规模稳定。<br>② 实验贡献：日均增量明确。<br>③ 经营解读：效率保持稳定。</div>',
          '<div data-review-numbered-lines>① 业务盘子：整体规模稳定。<br>② 实验贡献：日均增量明确。<br>③ 经营解读：效率保持稳定。<br>④ 后续重点：继续观察新增商品。</div>',
        )
        .replace(
          '        <li>业务盘子稳定</li><li>实验贡献明确<ul data-review-nested-list><li>嵌套稳定项</li></ul></li><li>经营效率稳定</li>',
          '        <li>业务盘子稳定</li><li>实验贡献明确<ul data-review-nested-list><li>嵌套稳定项</li></ul></li><li>经营效率稳定</li><li data-review-added-list-item>后续观察新增商品</li>',
        )
        .replace(
          '          <tr data-review-brand-row="gamma"><td>品牌丙</td><td>类目三</td><td>2.3万</td></tr>',
          `          <tr data-review-brand-row="added"><td>品牌新增</td><td>类目二</td><td>1.4万</td></tr>
          <tr data-review-brand-row="gamma"><td>品牌丙</td><td>类目三</td><td>2.3万</td></tr>`,
        )
        .replace(
          '<div data-review-semantic-copy>而非「让每个商品卖得更好」（品均基本持平）。这说明增长主要来自有效成交覆盖扩大。</div>',
          '<div data-review-semantic-copy>而非「让每个商品卖得更好」（单品效率整体稳定，增幅仅+0.10%）。这说明增长主要来自有效成交覆盖扩大。</div>',
        )
        .replace(
          `<div data-review-readable-rewrite style="width: 360px; line-height: 1.7">${READABLE_REWRITE_BEFORE}</div>`,
          `<div data-review-readable-rewrite style="width: 360px; line-height: 1.7">${READABLE_REWRITE_AFTER}</div>`,
        )
        .replace(
          '<p data-review-layout-only style="width: 240px; padding: 4px; border: 1px solid #c9ceda">同一段文字保持不变<br>只是换行位置调整。</p>',
          '<p data-review-layout-only style="width: 240px; padding: 14px; border: 3px solid #6d5ce7">同一段文字保持不变只是<br>换行位置调整。</p>',
        )
        .replace(
          '<p data-review-cross-line style="width: 150px; line-height: 1.6">稳定前缀，稳定后缀。</p>',
          '<p data-review-cross-line style="width: 150px; line-height: 1.6">稳定前缀，新增说明需要跨越多个实际文字行并保持独立框选，稳定后缀。</p>',
        )
        .replace(
          '<p data-review-stable-sentence-rewrite style="width: 150px; line-height: 1.6">稳定前句。旧方案覆盖多个指标、多个渠道、多个阶段，并给出较长说明。稳定后句。</p>',
          '<p data-review-stable-sentence-rewrite style="width: 150px; line-height: 1.6">稳定前句。新方案改写全部口径、执行路径、验证方式，并补充另一组较长说明。稳定后句。</p>',
        )
        .replace(
          '<p data-review-injection-stability><span data-review-stable-left>稳定左侧</span><strong>旧词</strong><em data-review-stable-right>稳定右侧</em></p>',
          '<p data-review-injection-stability><span data-review-stable-left>稳定左侧</span><strong>新词</strong><em data-review-stable-right>稳定右侧</em></p>',
        )
        .replace(
          `      <div data-review-atomic-media style="display:flex;align-items:center;gap:6px">
        <span data-review-atomic-stable-before>稳定媒体前文。</span>
        <img data-review-atomic-removed alt="旧品牌图示" src="data:image/svg+xml,%3Csvg/%3E" width="28" height="20">
        <svg data-review-atomic-paired role="img" aria-label="趋势图" width="30" height="20" viewBox="0 0 30 20" fill="#8aa4c8"></svg>
        <input data-review-atomic-input name="品牌标识" type="text" value="品牌甲" style="width:60px;border:1px solid #9aa4b2">
        <span data-review-atomic-stable-after>稳定媒体后文。</span>
      </div>`,
          `      <div data-review-atomic-media style="display:flex;align-items:center;gap:6px">
        <span data-review-atomic-stable-before>稳定媒体前文。</span>
        <canvas data-review-atomic-added aria-label="新增画布图" width="28" height="20"></canvas>
        <svg data-review-atomic-paired role="img" aria-label="趋势图" width="30" height="20" viewBox="0 0 30 20" fill="#d26a81"></svg>
        <input data-review-atomic-input name="品牌标识" type="text" value="品牌甲" style="width:60px;border:3px solid #6d5ce7">
        <span data-review-atomic-stable-after>稳定媒体后文。</span>
      </div>`,
        )
        .replace(
          '<p data-review-warning>⚠️ 近6天(7/23-<span><strong>7/28)增幅收窄至负值区间，需</strong></span>持续关注。</p>',
          '<p data-review-warning>⚠️ 近6天（7/23—<strong>7/28）增幅收窄至负值区间，需</strong>持续关注定价调整和转化波动。</p>',
        )
        .replace(
          '<div data-review-break-layout><span>日均63<br><br>.4万<br>60.7万</span></div>',
          '<div data-review-break-layout>日均63.4万 vs 60.7万</div>',
        )
        .replace(
          '<div data-review-deleted-copy><strong>品均拆解：</strong>总确收增长来自覆盖扩大。<br>待删除第一行<br>待删除第二行<br>待删除第三行<br>AI托管的核心价值保持不变。</div>',
          '<div data-review-deleted-copy><strong>品均拆解：</strong>总确收增长来自覆盖扩大。<br>AI托管的核心价值保持不变，并应继续关注留存质量。</div>',
        )
        .replace(
          '<div data-review-ebita-copy><strong>结论：</strong>EBITA差异均在波动范围<br>内（0.06~0.13pt），AI托管未恶化盈利能力。</div>',
          '<div data-review-ebita-copy><strong>结论：</strong>EBITA差异均在波动范围内（0.06~0.13pt），AI托管未恶化盈利能力，建议继续保留实验策略。</div>',
        )
        .replace(
          '<p data-review-anchor-only style="line-height:48px">稳定开头。<br>稳定中段。<br>只删除这句定位文字。稳定结尾。</p>',
          '<p data-review-anchor-only style="line-height:48px">稳定开头。<br>稳定中段。<br>稳定结尾。</p>',
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
    const projectionIsCanonical = (frame) => frame.locator("html").evaluate(() => {
      const boxes = [...document.querySelectorAll("[data-pageroot-review-overlay-box]")];
      const holes = [...document.querySelectorAll("[data-pageroot-review-mask-hole]")];
      return boxes.length === holes.length && boxes.every((box, index) => {
        const hole = holes[index];
        return Math.abs(Number(box.getAttribute("data-left")) - Number(hole.getAttribute("data-left"))) < .02
          && Math.abs(Number(box.getAttribute("data-top")) - Number(hole.getAttribute("data-top"))) < .02
          && Math.abs(Number(box.getAttribute("data-width")) - Number(hole.getAttribute("data-width"))) < .02
          && Math.abs(Number(box.getAttribute("data-height")) - Number(hole.getAttribute("data-height"))) < .02
          && Boolean(box.getAttribute("data-path"))
          && box.getAttribute("data-path") === hole.getAttribute("d");
      });
    });
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
    const runtimeSnapshotSection = "section[data-review-runtime-snapshot]";
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect(frame.locator(runtimeSnapshotSection)).toHaveAttribute(
        "data-pageroot-review-runtime-marker",
        "true",
      );
      await expect(frame.locator("#review-runtime-snapshot-canvas"))
        .not.toHaveAttribute("data-pageroot-review-runtime-marker", "true");
      await expect(frame.locator(
        "[data-pageroot-review-runtime-host], [data-pageroot-review-runtime-source-box]",
      )).toHaveCount(0);
    }
    await afterReviewFrame.locator("html").evaluate(() => {
      document.documentElement.dataset.reviewPostLoadNavigationAttempted = "true";
      location.replace(
        "data:text/html,<html data-review-post-load-replacement=true></html>",
      );
    });
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-review-post-load-navigation-attempted", "true");
    await expect(afterReviewFrame.locator("html"))
      .not.toHaveAttribute("data-review-post-load-replacement", "true");
    await expect(afterReviewFrame.locator("html"))
      .not.toHaveAttribute("data-pageroot-preview-navigation-fallback", "true");
    await expect(afterReviewFrame.locator("html"))
      .toHaveAttribute("data-pageroot-review-filter", "all");
    await expect(beforeReviewFrame.locator('meta[http-equiv="refresh"]'))
      .toHaveCount(0);
    const reviewCommentMarkers = launched.page.locator(
      'section[data-side="before"] [data-testid="review-comment-marker"]',
    );
    await expect(reviewCommentMarkers).toHaveCount(2);
    const frozenReviewComment = `只把这个列表项改为“${UPDATED_TEXT}”，其他地方保持不变。`;
    const reviewCommentMarker = reviewCommentMarkers.filter({
      hasText: frozenReviewComment,
    });
    await expect(reviewCommentMarker).toHaveCount(1);
    await expect(reviewCommentMarkers.filter({
      hasText: ordinaryReviewCommentText,
    })).toHaveCount(1);
    await expect(reviewCommentMarker).toHaveAttribute("role", "note");
    await expect(reviewCommentMarker).not.toHaveAttribute("tabindex", /.+/u);
    await expect(reviewCommentMarker).toHaveCSS("width", "30px");
    await expect(reviewCommentMarker).toHaveCSS("height", "30px");
    await expect(reviewCommentMarker).toHaveCSS("font-size", "15px");
    await expect(reviewCommentMarker).toHaveCSS("background-color", "rgb(98, 88, 214)");
    await expect(reviewCommentMarker).toHaveCSS("color", "rgb(255, 255, 255)");
    await expect(launched.page.locator(
      'section[data-side="after"] [data-testid="review-comment-marker"]',
    )).toHaveCount(0);
    await expect.poll(() => beforeReviewFrame.locator("html").evaluate(
      (element, text) => element.innerHTML.includes(text),
      frozenReviewComment,
    )).toBe(false);
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(
      (element, text) => element.innerHTML.includes(text),
      frozenReviewComment,
    )).toBe(false);
    await reviewCommentMarker.hover();
    const reviewCommentBubble = reviewCommentMarker.getByTestId("review-comment-bubble");
    await expect(reviewCommentBubble).toContainText(frozenReviewComment);
    await expect(reviewCommentBubble).toBeVisible();
    const beforeReviewViewport = launched.page.locator(
      'section[data-side="before"] [aria-label="修改前画布滚动区"]',
    );
    await expect.poll(async () => {
      const [bubbleBox, viewportBox] = await Promise.all([
        reviewCommentBubble.boundingBox(),
        beforeReviewViewport.boundingBox(),
      ]);
      if (!bubbleBox || !viewportBox) return false;
      return bubbleBox.x >= viewportBox.x + 4
        && bubbleBox.x + bubbleBox.width <= viewportBox.x + viewportBox.width - 4;
    }).toBe(true);
    if (process.env.PAGEROOT_CAPTURE_REVIEW) {
      const captureDirectory = path.join(productRoot, "output", "design-qa");
      mkdirSync(captureDirectory, { recursive: true });
      await launched.page.screenshot({
        path: path.join(captureDirectory, "ai-review-comment.png"),
        animations: "disabled",
      });
    }
    await launched.page.locator('section[data-side="before"] > header').hover();
    await expect(reviewCommentBubble).toBeHidden();
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeHidden();
    await beforeReviewFrame.getByRole("button", { name: "审阅标签二" })
      .evaluate((button) => button.click());
    await expect.poll(async () => beforeReviewFrame.locator("html").evaluate(() => {
      const transitioning = document.documentElement.hasAttribute(
        "data-pageroot-review-transitioning",
      );
      return !transitioning || (
        document.querySelectorAll("[data-pageroot-review-transition-mask]").length === 1
        && document.querySelectorAll("[data-pageroot-review-projection-layer]").length === 0
      );
    })).toBe(true);
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => (
        !document.documentElement.hasAttribute("data-pageroot-review-transitioning")
      ))),
    ).then((states) => states.every(Boolean))).toBe(true);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => {
        const filter = document.documentElement.dataset.pagerootReviewFilter || "all";
        return [...document.querySelectorAll("[data-pageroot-review-overlay-box]")]
          .every((box) => {
            const changeId = box.getAttribute("data-pageroot-review-overlay-box");
            return [...document.querySelectorAll(
              '[data-pageroot-review-marker="' + changeId + '"]',
            )].some((marker) => {
              const markerTypes = String(
                marker.getAttribute("data-pageroot-review-marker-types") || "",
              ).split(/\s+/u);
              const matchesFilter = filter === "all" || markerTypes.includes(filter);
              if (!matchesFilter) return false;
              if (markerTypes.includes("text")) {
                const range = document.createRange();
                range.selectNodeContents(marker);
                const visible = [...range.getClientRects()]
                  .some((rect) => rect.width > 1 && rect.height > 1);
                range.detach();
                return visible;
              }
              return [...marker.getClientRects()]
                .some((rect) => rect.width > 1 && rect.height > 1);
            });
          });
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    await expect(beforeReviewFrame.locator("#indexed-review-panel-one")).toBeVisible();
    await expect(afterReviewFrame.locator("#indexed-review-panel-one")).toBeVisible();
    await afterReviewFrame.getByRole("button", { name: "抖音搜盘表现" })
      .evaluate((button) => button.click());
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => {
      const documentHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body?.scrollHeight || 0,
      );
      const layer = document.documentElement.hasAttribute(
        "data-pageroot-review-transitioning",
      )
        ? document.querySelector("[data-pageroot-review-transition-mask]")
        : document.querySelector("[data-pageroot-review-projection-layer]");
      return Boolean(layer && layer.getBoundingClientRect().height >= documentHeight - 1);
    })).toBe(true);
    await expect(afterReviewFrame.locator("#indexed-review-panel-two")).toBeVisible();
    await expect(beforeReviewFrame.locator("#indexed-review-panel-two")).toBeVisible();
    await expect(afterReviewFrame.locator("#indexed-review-panel-one")).toBeHidden();
    await expect(beforeReviewFrame.locator("#indexed-review-panel-one")).toBeHidden();
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
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator(
        "[data-pageroot-review-overlay-box]",
      ).evaluateAll((boxes) => {
        if (!boxes.length) return false;
        const textGroups = new Map();
        const standaloneBoxes = [];
        boxes.forEach((box) => {
          const textGroup = box.getAttribute("data-text-group");
          const key = textGroup
            ? [
              box.getAttribute("data-pageroot-review-overlay-box"),
              box.getAttribute("data-tone"),
              textGroup,
            ].join("|")
            : "";
          if (!key) {
            standaloneBoxes.push(box);
            return;
          }
          const grouped = textGroups.get(key) || [];
          grouped.push(box);
          textGroups.set(key, grouped);
        });
        const validLabel = (label) => {
          const text = label?.textContent?.trim() || "";
          return text.length >= 2 && text.length <= 10;
        };
        return standaloneBoxes.every((box) => {
          const labels = box.querySelectorAll("[data-pageroot-review-overlay-label]");
          return labels.length === 1 && validLabel(labels[0]);
        }) && [...textGroups.values()].every((group) => {
          const labels = group.flatMap((box) => (
            [...box.querySelectorAll("[data-pageroot-review-overlay-label]")]
          ));
          return labels.length === 1 && validLabel(labels[0]);
        });
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    const nestedOverlayPairs = await afterReviewFrame.locator(
      "[data-pageroot-review-overlay-box]",
    ).evaluateAll((boxes) => boxes.flatMap((outer, outerIndex) => {
      const outerRect = outer.getBoundingClientRect();
      return boxes.flatMap((inner, innerIndex) => {
        if (outerIndex === innerIndex) return [];
        const innerRect = inner.getBoundingClientRect();
        const sameOwner = outer.getAttribute("data-pageroot-review-semantic-owner")
          === inner.getAttribute("data-pageroot-review-semantic-owner");
        const sameFact = outer.getAttribute("data-pageroot-review-fact")
          === inner.getAttribute("data-pageroot-review-fact");
        const nested = outer.getAttribute("data-pageroot-review-overlay-box")
          === inner.getAttribute("data-pageroot-review-overlay-box")
          && sameOwner
          && sameFact
          && innerRect.width * innerRect.height < outerRect.width * outerRect.height * .86
          && innerRect.left >= outerRect.left - 2
          && innerRect.top >= outerRect.top - 2
          && innerRect.right <= outerRect.right + 2
          && innerRect.bottom <= outerRect.bottom + 2;
        return nested ? [{
          changeId: outer.getAttribute("data-pageroot-review-overlay-box"),
          outer: {
            summary: outer.textContent,
            tone: outer.getAttribute("data-tone"),
            rect: [outerRect.x, outerRect.y, outerRect.width, outerRect.height],
          },
          inner: {
            summary: inner.textContent,
            tone: inner.getAttribute("data-tone"),
            rect: [innerRect.x, innerRect.y, innerRect.width, innerRect.height],
          },
        }] : [];
      });
    }));
    expect(nestedOverlayPairs).toEqual([]);
    const addedRowSemanticOwner = await afterReviewFrame.locator(
      '[data-review-brand-row="added"]',
    ).getAttribute("data-pageroot-review-semantic-owner");
    expect(addedRowSemanticOwner).toBeTruthy();
    const allModeAddedRowFrames = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-pageroot-review-semantic-owner="${addedRowSemanticOwner}"]`,
    );
    await expect(allModeAddedRowFrames).toHaveCount(1);
    await expect(allModeAddedRowFrames).toHaveAttribute("data-tone", "structure");
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-pageroot-review-semantic-owner="${addedRowSemanticOwner}"]`,
    )).toHaveCount(1);
    await expect.poll(() => allModeAddedRowFrames.evaluate((frame) => {
      const row = document.querySelector('[data-review-brand-row="added"]');
      if (!row) return false;
      const frameRect = frame.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return Math.abs(frameRect.left - (rowRect.left - 3)) < .75
        && Math.abs(frameRect.top - (rowRect.top - 3)) < .75
        && Math.abs(frameRect.width - (rowRect.width + 6)) < .75
        && Math.abs(frameRect.height - (rowRect.height + 6)) < .75;
    })).toBe(true);
    const removedAtomicOwner = await beforeReviewFrame.locator(
      "[data-review-atomic-removed]",
    ).getAttribute("data-pageroot-review-semantic-owner");
    const addedAtomicOwner = await afterReviewFrame.locator(
      "[data-review-atomic-added]",
    ).getAttribute("data-pageroot-review-semantic-owner");
    expect(removedAtomicOwner).toBeTruthy();
    expect(addedAtomicOwner).toBeTruthy();
    await expect(beforeReviewFrame.locator(
      '[data-review-atomic-removed][data-pageroot-review-structure="removed"]',
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-atomic-added][data-pageroot-review-structure="added"]',
    )).toHaveCount(1);
    for (const [frame, owner] of [
      [beforeReviewFrame, removedAtomicOwner],
      [afterReviewFrame, addedAtomicOwner],
    ]) {
      await expect(frame.locator(
        `[data-pageroot-review-overlay-box][data-tone="structure"][data-pageroot-review-semantic-owner="${owner}"]`,
      )).toHaveCount(1);
      await expect(frame.locator(
        `[data-pageroot-review-mask-hole][data-pageroot-review-semantic-owner="${owner}"]`,
      )).toHaveCount(1);
    }
    await expect(beforeReviewFrame.locator(
      '[data-review-atomic-stable-before] [data-pageroot-review-text], [data-review-atomic-stable-after] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-atomic-stable-before] [data-pageroot-review-text], [data-review-atomic-stable-after] [data-pageroot-review-text]',
    )).toHaveCount(0);
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
    await expect.poll(() => deletedPriority.evaluate(
      (element) => getComputedStyle(element).textDecorationStyle,
    )).toBe("dashed");
    const addedText = afterReviewFrame.locator(
      '[data-pageroot-review-text="added"]',
    ).filter({ hasText: UPDATED_TEXT });
    await expect.poll(() => addedText.evaluate(
      (element) => getComputedStyle(element).textDecorationLine,
    )).toBe("none");
    expect(await addedText.evaluate((element) => getComputedStyle(element).color))
      .toBe(await addedText.evaluate((element) => getComputedStyle(element.parentElement).color));
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator(
        "[data-review-injection-stability]",
      ).evaluate((target) => {
        const marker = target.querySelector("[data-pageroot-review-text]");
        const left = target.querySelector("[data-review-stable-left]");
        const right = target.querySelector("[data-review-stable-right]");
        if (!marker || !left || !right) return false;
        const range = document.createRange();
        range.selectNodeContents(marker);
        const rangeRects = [...range.getClientRects()]
          .filter((rect) => rect.width > 1 && rect.height > 1).length;
        range.detach();
        const snapshot = () => [left, right].map((element) => {
          const rect = element.getBoundingClientRect();
          return [rect.left, rect.top, rect.right, rect.bottom];
        });
        const wrapped = snapshot();
        const placeholder = document.createComment("review-marker-position");
        const text = document.createTextNode(marker.textContent || "");
        marker.before(placeholder);
        marker.replaceWith(text);
        const unwrapped = snapshot();
        text.replaceWith(marker);
        placeholder.remove();
        const maximumDelta = Math.max(...wrapped.flatMap((rect, index) => (
          rect.map((value, coordinate) => Math.abs(value - unwrapped[index][coordinate]))
        )));
        return rangeRects > 0
          && marker.getClientRects().length === 0
          && getComputedStyle(marker).display === "contents"
          && maximumDelta < .25;
      })),
    ).then((results) => results.every(Boolean))).toBe(true);
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"]',
    ).count()).toBeGreaterThan(0);
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-removed"]',
    ).count()).toBeGreaterThan(0);
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"]',
    ).first().evaluate((element) => {
      const shape = element.querySelector("[data-pageroot-review-overlay-shape]");
      return shape ? getComputedStyle(shape).stroke : getComputedStyle(element).borderTopColor;
    }))
      .toBe("rgb(35, 155, 86)");
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-removed"]',
    ).first().evaluate((element) => {
      const shape = element.querySelector("[data-pageroot-review-overlay-shape]");
      return shape ? getComputedStyle(shape).stroke : getComputedStyle(element).borderTopColor;
    }))
      .toBe("rgb(209, 75, 68)");
    await expect(beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-removed"][data-shaped="true"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="text-added"][data-shaped="true"]',
    )).toHaveCount(0);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator(
        '[data-pageroot-review-overlay-box][data-scope="text-phrase"]',
      ).evaluateAll((boxes) => boxes.every((box) => (
        box.getBoundingClientRect().width >= 24
      )))),
    ).then((states) => states.every(Boolean))).toBe(true);
    const beforeRewriteMarker = beforeReviewFrame.locator(
      '[data-review-readable-rewrite] [data-pageroot-review-text="removed"]',
    ).first();
    const afterRewriteMarker = afterReviewFrame.locator(
      '[data-review-readable-rewrite] [data-pageroot-review-text="added"]',
    ).first();
    await expect(beforeRewriteMarker).toHaveAttribute(
      "data-pageroot-review-summary",
      "段落改写",
    );
    await expect(afterRewriteMarker).toHaveAttribute(
      "data-pageroot-review-summary",
      "段落改写",
    );
    const beforeRewriteGroup = await beforeRewriteMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    const afterRewriteGroup = await afterRewriteMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    expect(beforeRewriteGroup).toBeTruthy();
    expect(afterRewriteGroup).toBeTruthy();
    const beforeRewriteFrame = beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-removed"][data-text-group="${beforeRewriteGroup}"]`,
    );
    const afterRewriteFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-text-group="${afterRewriteGroup}"]`,
    );
    await expect(beforeRewriteFrame).toHaveCount(1);
    await expect(afterRewriteFrame).toHaveCount(1);
    await expect(beforeRewriteFrame).toHaveAttribute("data-scope", "text-block");
    await expect(afterRewriteFrame).toHaveAttribute("data-scope", "text-block");
    await expect(beforeRewriteFrame).toHaveAttribute(
      "data-pageroot-review-fragment-count",
      "1",
    );
    await expect(afterRewriteFrame).toHaveAttribute(
      "data-pageroot-review-fragment-count",
      "1",
    );
    await expect(beforeRewriteFrame.locator(
      "[data-pageroot-review-overlay-label]",
    )).toHaveText("段落改写");
    await expect(afterRewriteFrame.locator(
      "[data-pageroot-review-overlay-label]",
    )).toHaveText("段落改写");
    await expect.poll(() => beforeRewriteFrame.evaluate((element) => ({
      color: getComputedStyle(element).borderTopColor,
      style: getComputedStyle(element).borderTopStyle,
    }))).toEqual({ color: "rgb(209, 75, 68)", style: "dashed" });
    await expect.poll(() => afterRewriteFrame.evaluate((element) => ({
      color: getComputedStyle(element).borderTopColor,
      style: getComputedStyle(element).borderTopStyle,
    }))).toEqual({ color: "rgb(35, 155, 86)", style: "dashed" });
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "实验效果概览" })).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "实验效果概览" }))
      .toHaveAttribute("data-pageroot-review-summary", "新增内容");
    await expect(beforeReviewFrame.locator(
      '[data-review-reference] [data-pageroot-review-text-context="removed"]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      "[data-review-reference]",
    )).toHaveAttribute(
      "data-pageroot-review-text-anchors",
      /text-\d+-\d+@\d+/u,
    );
    await expect(afterReviewFrame.locator(
      '[data-review-reference] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "本实验" })).toHaveAttribute(
      "data-pageroot-review-summary",
      "新增内容",
    );
    await expect(afterReviewFrame.locator(
      '[data-review-reference] [data-pageroot-review-text="added"]',
    )).toHaveAttribute("data-pageroot-review-text-operation", "insert");
    await expect(beforeReviewFrame.locator(
      '[data-review-delete-only] [data-pageroot-review-text="removed"]',
    )).toHaveText("换言之，");
    await expect(beforeReviewFrame.locator(
      '[data-review-delete-only] [data-pageroot-review-text="removed"]',
    )).toHaveAttribute("data-pageroot-review-summary", "删除内容");
    await expect(afterReviewFrame.locator(
      '[data-review-delete-only] [data-pageroot-review-text-context="added"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      "[data-review-delete-only]",
    )).toHaveAttribute(
      "data-pageroot-review-text-anchors",
      /text-\d+-\d+@\d+/u,
    );
    await expect(beforeReviewFrame.locator(
      '[data-review-anchor-only] [data-pageroot-review-text="removed"]',
    )).toHaveText("只删除这句定位文字。");
    await expect(afterReviewFrame.locator(
      '[data-review-anchor-only] [data-pageroot-review-text]',
    )).toHaveCount(0);
    const anchorOnlyChangeId = await afterReviewFrame.locator(
      "[data-review-anchor-only-section]",
    ).getAttribute("data-pageroot-review-id");
    expect(anchorOnlyChangeId).toBeTruthy();
    await expect(afterReviewFrame.locator(
      "[data-review-anchor-only]",
    )).toHaveAttribute("data-pageroot-review-anchor-change", anchorOnlyChangeId);
    const anchorOffsets = await afterReviewFrame.locator(
      "[data-review-anchor-only]",
    ).evaluate((anchor) => String(
      anchor.getAttribute("data-pageroot-review-text-anchors") || "",
    ).split(/\s+/).filter(Boolean).map((encoded) => (
      Number(encoded.slice(encoded.lastIndexOf("@") + 1))
    )));
    expect(anchorOffsets).toContain("稳定开头。稳定中段。".length);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text="added"]',
    )).toHaveText("④ 后续重点：继续观察新增商品。");
    await expect(afterReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text="added"]',
    )).toHaveCount(1);
    const numberedLineMarker = afterReviewFrame.locator(
      '[data-review-numbered-lines] [data-pageroot-review-text="added"]',
    );
    const numberedLineGroup = await numberedLineMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    expect(numberedLineGroup).toBeTruthy();
    const numberedLineFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-text-group="${numberedLineGroup}"]`,
    );
    await expect(numberedLineFrame).toHaveCount(1);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-text-group="${numberedLineGroup}"]`,
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-text-group="${numberedLineGroup}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole][data-text-group="${numberedLineGroup}"]`,
    )).toHaveCount(1);
    await expect(numberedLineFrame.locator(
      "[data-pageroot-review-overlay-label]",
    )).toHaveCount(1);
    await expect(numberedLineFrame).not.toHaveAttribute("data-scope", "text-block");
    await expect.poll(async () => {
      const frameBox = await numberedLineFrame.boundingBox();
      const ownerBox = await afterReviewFrame.locator(
        "[data-review-numbered-lines]",
      ).boundingBox();
      return Boolean(frameBox && ownerBox && frameBox.height < ownerBox.height * 0.55);
    }).toBe(true);
    await expect(beforeReviewFrame.locator(
      '[data-review-list-items] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-list-items] [data-pageroot-review-text="added"]',
    )).toHaveText("后续观察新增商品");
    await expect(afterReviewFrame.locator(
      '[data-review-list-items] li:not([data-review-added-list-item]) [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-nested-list] [data-pageroot-review-text], [data-review-nested-list][data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-nested-list] [data-pageroot-review-text], [data-review-nested-list][data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-brand-table] [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-brand-row="added"] [data-pageroot-review-text="added"]',
    )).toHaveCount(3);
    const addedRowGroups = await afterReviewFrame.locator(
      '[data-review-brand-row="added"] [data-pageroot-review-text="added"]',
    ).evaluateAll((markers) => [...new Set(markers.map((marker) => (
      marker.getAttribute("data-pageroot-review-text-group")
    )))].filter(Boolean));
    expect(addedRowGroups).toHaveLength(3);
    const addedRowSemanticOwners = await afterReviewFrame.locator(
      '[data-review-brand-row="added"] [data-pageroot-review-text="added"]',
    ).evaluateAll((markers) => [...new Set(markers.map((marker) => (
      marker.getAttribute("data-pageroot-review-semantic-owner")
    )))].filter(Boolean));
    expect(addedRowSemanticOwners).toEqual([addedRowSemanticOwner]);
    const addedRowFrames = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-pageroot-review-semantic-owner="${addedRowSemanticOwners[0]}"]`,
    );
    const addedRowRangeRectCount = await afterReviewFrame.locator(
      '[data-review-brand-row="added"] [data-pageroot-review-text="added"]',
    ).evaluateAll((markers) => markers.reduce((total, marker) => {
      const range = document.createRange();
      range.selectNodeContents(marker);
      const count = [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1).length;
      range.detach();
      return total + count;
    }, 0));
    expect(addedRowRangeRectCount).toBeGreaterThan(3);
    await expect(addedRowFrames).toHaveCount(addedRowRangeRectCount);
    await expect.poll(() => addedRowFrames.evaluateAll((frames) => {
      const row = document.querySelector('[data-review-brand-row="added"]');
      if (!row) return false;
      const rowRect = row.getBoundingClientRect();
      return frames.every((frame) => {
        const rect = frame.getBoundingClientRect();
        const geometryOwnerId = frame.getAttribute("data-pageroot-review-geometry-owner");
        const geometryOwner = [...document.querySelectorAll(
          '[data-pageroot-review-geometry-owner="' + geometryOwnerId + '"]',
        )].find((candidate) => (
          candidate.matches("td, th")
          && !candidate.hasAttribute("data-pageroot-review-text")
        ));
        const ownerRect = geometryOwner?.getBoundingClientRect();
        return frame.getAttribute("data-scope") !== "text-block"
          && frame.getAttribute("data-shaped") !== "true"
          && frame.getAttribute("data-pageroot-review-fragment-count") === "1"
          && Boolean(ownerRect)
          && rect.left >= ownerRect.left - 4
          && rect.right <= ownerRect.right + 4
          && rect.left >= rowRect.left - 4
          && rect.top >= rowRect.top - 4
          && rect.right <= rowRect.right + 4
          && rect.bottom <= rowRect.bottom + 4;
      });
    })).toBe(true);
    await expect(afterReviewFrame.locator(
      '[data-review-brand-row]:not([data-review-brand-row="added"]) [data-pageroot-review-text]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-layout-only] [data-pageroot-review-text], [data-review-layout-only] [data-pageroot-review-text-context]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-layout-only] [data-pageroot-review-text], [data-review-layout-only] [data-pageroot-review-text-context]',
    )).toHaveCount(0);
    const layoutProjectionFactsBySide = await Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator(
        "[data-review-layout-only]",
      ).evaluate((element) => JSON.parse(
        element.getAttribute("data-pageroot-review-projection-facts") || "[]",
      ))),
    );
    layoutProjectionFactsBySide.forEach((facts) => {
      const boxFact = facts.find((fact) => (
        fact.type === "style" && fact.scope === "box" && fact.operation !== "layout"
      ));
      const layoutFact = facts.find((fact) => (
        fact.type === "style" && fact.operation === "layout"
      ));
      expect(boxFact).toMatchObject({ summary: "视觉调整" });
      expect(layoutFact).toMatchObject({ scope: "content", summary: "换行调整" });
      expect(layoutFact.id).not.toBe(boxFact.id);
      expect(layoutFact.semanticOwnerId).toBe(boxFact.semanticOwnerId);
      expect(layoutFact.geometryOwnerId).toBe(boxFact.geometryOwnerId);
    });
    const [beforeLayoutFacts, afterLayoutFacts] = layoutProjectionFactsBySide;
    const beforeLayoutChangeId = await beforeReviewFrame.locator(
      "[data-review-layout-only]",
    ).getAttribute("data-pageroot-review-marker");
    const afterLayoutChangeId = await afterReviewFrame.locator(
      "[data-review-layout-only]",
    ).getAttribute("data-pageroot-review-marker");
    expect(beforeLayoutChangeId).toBeTruthy();
    expect(afterLayoutChangeId).toBeTruthy();
    const beforeLayoutBoxFact = beforeLayoutFacts.find((fact) => (
      fact.type === "style" && fact.scope === "box" && fact.operation !== "layout"
    ));
    const beforeLayoutFact = beforeLayoutFacts.find((fact) => (
      fact.type === "style" && fact.operation === "layout"
    ));
    const afterLayoutBoxFact = afterLayoutFacts.find((fact) => (
      fact.type === "style" && fact.scope === "box" && fact.operation !== "layout"
    ));
    const afterLayoutFact = afterLayoutFacts.find((fact) => (
      fact.type === "style" && fact.operation === "layout"
    ));
    const crossLineMarker = afterReviewFrame.locator(
      '[data-review-cross-line] [data-pageroot-review-text="added"]',
    );
    await expect(crossLineMarker).toHaveAttribute(
      "data-pageroot-review-text-operation",
      "insert",
    );
    const crossLineGroup = await crossLineMarker.getAttribute(
      "data-pageroot-review-text-group",
    );
    expect(crossLineGroup).toBeTruthy();
    const crossLineRectCount = await crossLineMarker.evaluate((element) => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const count = [...range.getClientRects()]
        .filter((rect) => rect.width > 1 && rect.height > 1).length;
      range.detach();
      return count;
    });
    expect(crossLineRectCount).toBeGreaterThan(1);
    const crossLineFrames = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-text-group="${crossLineGroup}"]`,
    );
    await expect(crossLineFrames).toHaveCount(crossLineRectCount);
    await expect.poll(() => crossLineFrames.evaluateAll((frames) => frames.every((frame) => (
      frame.getAttribute("data-scope") === "text-line"
      && frame.getAttribute("data-shaped") !== "true"
      && frame.getAttribute("data-pageroot-review-fragment-count") === "1"
    )))).toBe(true);
    await expect(crossLineFrames.locator(
      "[data-pageroot-review-overlay-label]",
    )).toHaveCount(1);
    for (const [frame, tone] of [
      [beforeReviewFrame, "removed"],
      [afterReviewFrame, "added"],
    ]) {
      await expect.poll(() => frame.locator("html").evaluate((_documentElement, expectedTone) => {
        const owner = document.querySelector("[data-review-stable-sentence-rewrite]");
        const marker = owner?.querySelector(
          '[data-pageroot-review-text="' + expectedTone + '"]',
        );
        if (!owner || !marker) return { matches: false, reason: "marker-missing" };
        const groupId = marker.getAttribute("data-pageroot-review-text-group") || "";
        const markers = [...owner.querySelectorAll(
          '[data-pageroot-review-text="' + expectedTone + '"][data-pageroot-review-text-group="' + groupId + '"]',
        )];
        const markerRects = markers.flatMap((candidate) => {
          const markerRange = document.createRange();
          markerRange.selectNodeContents(candidate);
          const rects = [...markerRange.getClientRects()]
            .filter((rect) => rect.width > 1 && rect.height > 1)
            .map((rect) => ({
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            }));
          markerRange.detach();
          return rects;
        });
        const markerRectCount = markerRects.length;
        const markerLineCount = markerRects.reduce((lines, rect) => {
          const matchingLine = lines.find((line) => line.some((candidate) => {
            const overlap = Math.max(0, Math.min(candidate.bottom, rect.bottom)
              - Math.max(candidate.top, rect.top));
            const height = Math.max(1, Math.min(
              candidate.bottom - candidate.top,
              rect.bottom - rect.top,
            ));
            return overlap / height >= .5;
          }));
          if (matchingLine) matchingLine.push(rect);
          else lines.push([rect]);
          return lines;
        }, []).length;
        const stableRanges = String(
          owner.getAttribute("data-pageroot-review-stable-text-ranges") || "",
        ).split(/\s+/).map((value) => {
          const match = /^(\d+):(\d+)$/u.exec(value);
          return match ? { start: Number(match[1]), end: Number(match[2]) } : null;
        }).filter((range) => range && range.end > range.start);
        const textNodes = [];
        const textWalker = document.createTreeWalker(owner, NodeFilter.SHOW_TEXT);
        let textNode = textWalker.nextNode();
        while (textNode) {
          if (!textNode.parentElement?.closest("script, style, noscript, template")) {
            textNodes.push(textNode);
          }
          textNode = textWalker.nextNode();
        }
        const boundaryAt = (offset) => {
          let remaining = Math.max(0, Math.trunc(offset));
          for (const node of textNodes) {
            const length = node.textContent?.length || 0;
            if (remaining <= length) return { node, offset: remaining };
            remaining -= length;
          }
          const node = textNodes.at(-1);
          return node ? { node, offset: node.textContent?.length || 0 } : null;
        };
        const stableRects = stableRanges.flatMap((sourceRange) => {
          const start = boundaryAt(sourceRange.start);
          const end = boundaryAt(sourceRange.end);
          if (!start || !end) return [];
          const range = document.createRange();
          range.setStart(start.node, start.offset);
          range.setEnd(end.node, end.offset);
          const rects = [...range.getClientRects()]
            .filter((rect) => rect.width > 1 && rect.height > 1)
            .map((rect) => ({
              left: rect.left,
              top: rect.top,
              right: rect.right,
              bottom: rect.bottom,
            }));
          range.detach();
          return rects;
        });
        const frames = [...document.querySelectorAll(
          '[data-pageroot-review-overlay-box][data-text-group="' + groupId + '"]',
        )];
        const holes = [...document.querySelectorAll(
          '[data-pageroot-review-mask-hole][data-text-group="' + groupId + '"]',
        )];
        const intersectsStableText = frames.some((frame) => {
          const rect = frame.getBoundingClientRect();
          return stableRects.some((stableRect) => (
            Math.min(rect.right, stableRect.right) - Math.max(rect.left, stableRect.left) > 1
            && Math.min(rect.bottom, stableRect.bottom) - Math.max(rect.top, stableRect.top) > 1
          ));
        });
        const overlaps = (left, right) => (
          Math.min(left.right, right.right) - Math.max(left.left, right.left) > 1
          && Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top) > 1
        );
        const matches = markerRectCount >= 3
            && markerLineCount >= 3
            && frames.length >= markerLineCount
            && holes.length === frames.length
            && markerRects.every((rect) => frames.some((frame) => (
              overlaps(rect, frame.getBoundingClientRect())
            )))
            && frames.every((frame) => markerRects.some((rect) => (
              overlaps(frame.getBoundingClientRect(), rect)
            )))
            && frames.every((frame) => (
              frame.getAttribute("data-scope") !== "text-block"
              && frame.getAttribute("data-shaped") !== "true"
              && frame.getAttribute("data-pageroot-review-fragment-count") === "1"
            ))
            && frames.filter((frame) => (
              frame.querySelector("[data-pageroot-review-overlay-label]")
            )).length === 1
            && stableRanges.length === 2
            && stableRects.length >= 2
            && !intersectsStableText
            && ![...owner.querySelectorAll("[data-pageroot-review-text]")].some((candidate) => (
              /稳定(?:前|后)句/u.test(candidate.textContent || "")
            ));
        return {
          matches,
          markerRectCount,
          markerLineCount,
          markerCount: markers.length,
          frameCount: frames.length,
          holeCount: holes.length,
          stableRangeCount: stableRanges.length,
          stableRectCount: stableRects.length,
          intersectsStableText,
        };
      }, tone)).toMatchObject({ matches: true });
    }
    const addedChartChangeId = await afterReviewFrame.locator(
      "[data-review-added-chart] [data-pageroot-review-marker]",
    ).first().getAttribute("data-pageroot-review-marker");
    expect(addedChartChangeId).toBeTruthy();
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${addedChartChangeId}"] [data-pageroot-review-overlay-label]`,
    ).filter({ hasText: /^新增内容$/u }).first()).toBeVisible();
    const warningRemovedText = await beforeReviewFrame.locator(
      '[data-review-warning] [data-pageroot-review-text="removed"]',
    ).allTextContents();
    expect(warningRemovedText.join(""))
      .not.toContain("7/28)增幅收窄至负值区间，需");
    await expect(beforeReviewFrame.locator(
      '[data-review-semantic-copy] [data-pageroot-review-text="removed"]',
    )).toHaveText("品均基本持平");
    await expect(afterReviewFrame.locator(
      '[data-review-semantic-copy] [data-pageroot-review-text="added"]',
    )).toHaveText("单品效率整体稳定，增幅仅+0.10%");
    await expect(beforeReviewFrame.locator(
      '[data-review-deleted-copy] [data-pageroot-review-text="removed"]',
    ).filter({ hasText: /^待删除第/u })).toHaveCount(3);
    await expect(beforeReviewFrame.locator(
      '[data-review-break-layout] [data-pageroot-review-text-context="removed"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-break-layout] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "vs" })).toHaveCount(1);
    await expect(beforeReviewFrame.locator(
      '[data-review-ebita-copy] [data-pageroot-review-text-context="removed"]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-ebita-copy] [data-pageroot-review-text="added"]',
    ).filter({ hasText: "建议继续保留实验策略" })).toBeVisible();
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
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-projection-layer], [data-pageroot-review-mask-layer], [data-pageroot-review-overlay-box], [data-pageroot-review-overlay-shape-svg]',
    ).evaluateAll((elements) => elements.length > 0 && elements.every((element) => (
      getComputedStyle(element).outlineStyle === "none"
    )))).toBe(true);
    await expect.poll(async () => {
      const boxes = await afterReviewFrame.locator(
        '[data-pageroot-review-overlay-box]',
      ).evaluateAll((elements) => elements.map((element) => ({
        left: Number.parseFloat(element.style.left),
        top: Number.parseFloat(element.style.top),
        width: Number.parseFloat(element.style.width),
        height: Number.parseFloat(element.style.height),
        path: element.getAttribute("data-path"),
      })));
      const holes = await afterReviewFrame.locator(
        '[data-pageroot-review-mask-hole]',
      ).evaluateAll((elements) => elements.map((element) => ({
        left: Number(element.getAttribute("data-left")),
        top: Number(element.getAttribute("data-top")),
        width: Number(element.getAttribute("data-width")),
        height: Number(element.getAttribute("data-height")),
        path: element.getAttribute("d"),
      })));
      return boxes.length === holes.length && boxes.every((box, index) => (
        Math.abs(box.left - holes[index].left) < 0.02
        && Math.abs(box.top - holes[index].top) < 0.02
        && Math.abs(box.width - holes[index].width) < 0.02
        && Math.abs(box.height - holes[index].height) < 0.02
        && Boolean(holes[index].path)
        && box.path === holes[index].path
      ));
    }).toBe(true);
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => {
      const path = document.querySelector("[data-pageroot-review-mask-dim]");
      const boxes = [...document.querySelectorAll("[data-pageroot-review-overlay-box]")];
      const changedText = document.querySelector('[data-pageroot-review-marker-types~="text"]');
      const range = changedText ? document.createRange() : null;
      range?.selectNodeContents(changedText);
      const changedRect = range ? [...range.getClientRects()].find((rect) => (
        rect.width > 1 && rect.height > 1
      )) : null;
      range?.detach();
      if (!(path instanceof SVGGeometryElement) || !changedRect) return false;
      const changedPointIsDimmed = path.isPointInFill(new DOMPoint(
        changedRect.left + scrollX + changedRect.width / 2,
        changedRect.top + scrollY + changedRect.height / 2,
      ));
      let outsidePointIsDimmed = false;
      for (let y = 8; y < Math.min(400, document.documentElement.scrollHeight); y += 24) {
        for (let x = 8; x < Math.min(600, document.documentElement.scrollWidth); x += 24) {
          const inFrame = boxes.some((box) => {
            const rect = box.getBoundingClientRect();
            return x >= rect.left + scrollX && x <= rect.right + scrollX
              && y >= rect.top + scrollY && y <= rect.bottom + scrollY;
          });
          if (!inFrame && path.isPointInFill(new DOMPoint(x, y))) {
            outsidePointIsDimmed = true;
            break;
          }
        }
        if (outsidePointIsDimmed) break;
      }
      return !changedPointIsDimmed && outsidePointIsDimmed;
    })).toBe(true);
    await expect.poll(() => beforeReviewFrame.locator("html").evaluate(() => {
      const dim = document.querySelector("[data-pageroot-review-mask-dim]");
      const shapedBoxes = [...document.querySelectorAll(
        '[data-pageroot-review-overlay-box][data-shaped="true"]',
      )];
      if (!(dim instanceof SVGGeometryElement)) return false;
      if (!shapedBoxes.length) return true;
      return shapedBoxes.every((box) => {
        const changeId = box.getAttribute("data-pageroot-review-overlay-box");
        const hole = [...document.querySelectorAll("[data-pageroot-review-mask-hole]")]
          .find((candidate) => (
            candidate.getAttribute("data-pageroot-review-mask-hole") === changeId
          ));
        if (!(hole instanceof SVGGeometryElement)) return false;
        const rect = box.getBoundingClientRect();
        for (let row = 1; row < 8; row += 1) {
          for (let column = 1; column < 8; column += 1) {
            const point = new DOMPoint(
              rect.left + scrollX + rect.width * column / 8,
              rect.top + scrollY + rect.height * row / 8,
            );
            if (!hole.isPointInFill(point) && dim.isPointInFill(point)) return true;
          }
        }
        return false;
      });
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
    const anchorOnlyMapItem = launched.page.getByRole("button", {
      name: /删除锚点导航/u,
    });
    await expect(anchorOnlyMapItem).toBeVisible();
    await anchorOnlyMapItem.click();
    await expect.poll(async () => afterReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-focus",
    )).toBe(anchorOnlyChangeId);
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => {
      const anchor = document.querySelector("[data-review-anchor-only]");
      if (!anchor) return false;
      const targetNode = [...anchor.childNodes].find((node) => (
        node.nodeType === Node.TEXT_NODE
        && node.textContent?.includes("稳定结尾。")
      ));
      if (!targetNode) return false;
      const range = document.createRange();
      range.selectNodeContents(targetNode);
      const targetTop = range.getBoundingClientRect().top;
      range.detach();
      return Math.abs(targetTop - Math.max(18, innerHeight * .12)) <= 28;
    })).toBe(true);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-mask-hole="${anchorOnlyChangeId}"]`,
    )).toHaveCount(0);
    const reopenOutline = launched.page.getByRole("button", { name: "打开内容地图" });
    if (await reopenOutline.isVisible()) await reopenOutline.click();
    const ebitaChangeId = await beforeReviewFrame.locator(
      "[data-review-ebita-section]",
    ).getAttribute("data-pageroot-review-id");
    expect(ebitaChangeId).toBeTruthy();
    await launched.page.getByRole("button", {
      name: /3EBITA分析：文本调整/u,
    }).click();
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-focus",
    )).toBe(ebitaChangeId);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${ebitaChangeId}"]`,
    )).toHaveCount(0);
    await expect.poll(() => afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${ebitaChangeId}"]`,
    ).count()).toBeGreaterThan(0);
    await beforeCounter.click();
    await expect(afterCounter).toHaveAttribute("data-count", "3");
    await expect(launched.page.getByRole("button", { name: "打开内容地图" }))
      .toBeVisible();
    await launched.page.getByRole("button", { name: "打开内容地图" }).click();
    const movedOutlineItem = launched.page.getByRole("button", {
      name: /标签一详情：位置调整/u,
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
    await expect.poll(async () => beforeReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("all");
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${beforeLayoutChangeId}"][data-pageroot-review-fact="style:${beforeLayoutBoxFact.id}"]`,
    )).toHaveCount(1);
    await expect(beforeReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${beforeLayoutChangeId}"][data-pageroot-review-fact="style:${beforeLayoutFact.id}"]`,
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${afterLayoutChangeId}"][data-pageroot-review-fact="style:${afterLayoutBoxFact.id}"]`,
    )).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${afterLayoutChangeId}"][data-pageroot-review-fact="style:${afterLayoutFact.id}"]`,
    )).toHaveCount(1);
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
    await expect.poll(() => beforeReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="structure"]',
    ).first().evaluate((element) => {
      const shape = element.querySelector("[data-pageroot-review-overlay-shape]");
      return shape ? getComputedStyle(shape).stroke : getComputedStyle(element).borderTopColor;
    }))
      .toBe("rgb(22, 119, 200)");
    await expect(afterReviewFrame.locator(
      '[data-review-added-chart][data-pageroot-review-structure]',
    )).toHaveCount(1);
    const structureAddedRowFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="structure"][data-pageroot-review-semantic-owner="${addedRowSemanticOwner}"]`,
    );
    await expect(structureAddedRowFrame).toHaveCount(1);
    await expect(afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box][data-tone="text-added"][data-pageroot-review-semantic-owner="${addedRowSemanticOwner}"]`,
    )).toHaveCount(0);
    await expect.poll(() => structureAddedRowFrame.evaluate((frame) => {
      const row = document.querySelector('[data-review-brand-row="added"]');
      if (!row) return false;
      const frameRect = frame.getBoundingClientRect();
      const rowRect = row.getBoundingClientRect();
      return Math.abs(frameRect.left - (rowRect.left - 3)) < .75
        && Math.abs(frameRect.top - (rowRect.top - 3)) < .75
        && Math.abs(frameRect.width - (rowRect.width + 6)) < .75
        && Math.abs(frameRect.height - (rowRect.height + 6)) < .75;
    })).toBe(true);
    await expect(beforeReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-metrics] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator(
      '[data-review-mixed-copy] [data-pageroot-review-structure], [data-review-break-layout] [data-pageroot-review-structure], [data-review-ebita-copy] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-mixed-copy] [data-pageroot-review-structure], [data-review-break-layout] [data-pageroot-review-structure], [data-review-ebita-copy] [data-pageroot-review-structure]',
    )).toHaveCount(0);
    await launched.page.getByRole("button", { name: "视觉变化" }).click();
    await expect.poll(async () => afterReviewFrame.locator("html").getAttribute(
      "data-pageroot-review-filter",
    )).toBe("style");
    await expect(afterReviewFrame.locator("[data-pageroot-review-style]").first())
      .toBeVisible();
    for (const [frame, tone] of [
      [beforeReviewFrame, "before"],
      [afterReviewFrame, "after"],
    ]) {
      for (const selector of [
        "[data-review-atomic-paired]",
        "[data-review-atomic-input]",
      ]) {
        const atomicElement = frame.locator(`${selector}[data-pageroot-review-style="${tone}"]`);
        await expect(atomicElement).toHaveCount(1);
        const owner = await atomicElement.getAttribute("data-pageroot-review-style-owner");
        expect(owner).toBeTruthy();
        await expect(frame.locator(
          `[data-pageroot-review-overlay-owner="${owner}"][data-tone="style"]`,
        )).toHaveCount(1);
        await expect(frame.locator(
          `[data-pageroot-review-mask-owner="${owner}"]`,
        )).toHaveCount(1);
      }
    }
    await expect(beforeReviewFrame.locator(
      '[data-review-layout-only][data-pageroot-review-style="before"]',
    )).toHaveAttribute("data-pageroot-review-style-scope", "box");
    await expect(afterReviewFrame.locator(
      '[data-review-layout-only][data-pageroot-review-style="after"]',
    )).toHaveAttribute("data-pageroot-review-style-scope", "box");
    const boxStyleFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${afterLayoutChangeId}"][data-tone="style"][data-pageroot-review-fact="style:${afterLayoutBoxFact.id}"]`,
    );
    const layoutStyleFrame = afterReviewFrame.locator(
      `[data-pageroot-review-overlay-box="${afterLayoutChangeId}"][data-tone="style"][data-pageroot-review-fact="style:${afterLayoutFact.id}"]`,
    );
    await expect(boxStyleFrame).toHaveCount(1);
    await expect(layoutStyleFrame).toHaveCount(1);
    await expect(boxStyleFrame).toHaveAttribute("data-scope", "box");
    await expect(layoutStyleFrame).toHaveAttribute("data-scope", "content");
    await expect(boxStyleFrame.locator(
      "[data-pageroot-review-overlay-label]",
    )).toHaveText("视觉调整");
    await expect(layoutStyleFrame.locator(
      "[data-pageroot-review-overlay-label]",
    )).toHaveText("换行调整");
    await expect.poll(() => layoutStyleFrame.evaluate((frame) => {
      const owner = document.querySelector("[data-review-layout-only]");
      if (!owner) return false;
      const frameRect = frame.getBoundingClientRect();
      const ownerRect = owner.getBoundingClientRect();
      return frameRect.left >= ownerRect.left - 4
        && frameRect.top >= ownerRect.top - 4
        && frameRect.right <= ownerRect.right + 4
        && frameRect.bottom <= ownerRect.bottom + 4;
    })).toBe(true);
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="style"]',
    ).first()).toBeAttached();
    await expect.poll(() => afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="style"]',
    ).first().evaluate((element) => {
      const shape = element.querySelector("[data-pageroot-review-overlay-shape]");
      return shape ? getComputedStyle(shape).stroke : getComputedStyle(element).borderTopColor;
    }))
      .toBe("rgb(109, 92, 231)");
    await expect(beforeReviewFrame.locator(
      '[data-review-regression-summary][data-pageroot-review-style], [data-review-regression-summary] [data-pageroot-review-style]',
    )).toHaveCount(0);
    await expect(afterReviewFrame.locator(
      '[data-review-regression-summary][data-pageroot-review-style], [data-review-regression-summary] [data-pageroot-review-style]',
    )).toHaveCount(0);
    await expect(beforeReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator('[data-review-tab-panel="two"]'))
      .toBeVisible();
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-overlay-box][data-tone="style"] [data-pageroot-review-overlay-label]',
    ).filter({ hasText: /^视觉调整$/u }).first()).toHaveText("视觉调整");
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => {
        const copy = document.querySelector("[data-review-inherited-copy]");
        if (!copy || copy.getAttribute("data-pageroot-review-style-scope") !== "content") {
          return false;
        }
        const owner = copy.getAttribute("data-pageroot-review-style-owner");
        const overlay = [...document.querySelectorAll("[data-pageroot-review-overlay-owner]")]
          .find((candidate) => candidate.getAttribute("data-pageroot-review-overlay-owner") === owner);
        if (!owner || !overlay || overlay.getAttribute("data-scope") !== "content") return false;
        const copyRect = copy.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        return overlayRect.left >= copyRect.left - 4
          && overlayRect.top >= copyRect.top - 4
          && overlayRect.right <= copyRect.right + 4
          && overlayRect.bottom <= copyRect.bottom + 4
          && overlayRect.width < copyRect.width * .75
          && overlayRect.height < copyRect.height * .75;
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => {
        const card = document.querySelector("[data-review-logical-card]");
        if (!card || card.getAttribute("data-pageroot-review-style-scope") !== "box") return false;
        const owner = card.getAttribute("data-pageroot-review-style-owner");
        const overlay = [...document.querySelectorAll("[data-pageroot-review-overlay-owner]")]
          .find((candidate) => candidate.getAttribute("data-pageroot-review-overlay-owner") === owner);
        if (!owner || !overlay || overlay.getAttribute("data-scope") !== "box") return false;
        const cardRect = card.getBoundingClientRect();
        const overlayRect = overlay.getBoundingClientRect();
        return Math.abs(overlayRect.left - (cardRect.left - 3)) < .75
          && Math.abs(overlayRect.top - (cardRect.top - 3)) < .75
          && Math.abs(overlayRect.width - (cardRect.width + 6)) < .75
          && Math.abs(overlayRect.height - (cardRect.height + 6)) < .75;
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
    await expect.poll(async () => Promise.all(
      [beforeReviewFrame, afterReviewFrame].map((frame) => frame.locator("html").evaluate(() => {
        const cards = [...document.querySelectorAll("[data-review-metric]")];
        if (cards.length !== 3) return false;
        const owners = cards.map((card) => (
          card.getAttribute("data-pageroot-review-style-owner") || ""
        ));
        if (owners.some((owner) => !owner) || new Set(owners).size !== cards.length) return false;
        return cards.every((card, index) => {
          const owner = owners[index];
          const overlays = [...document.querySelectorAll(
            '[data-pageroot-review-overlay-owner]',
          )].filter((candidate) => (
            candidate.getAttribute("data-pageroot-review-overlay-owner") === owner
          ));
          const holes = [...document.querySelectorAll(
            '[data-pageroot-review-mask-owner]',
          )].filter((candidate) => (
            candidate.getAttribute("data-pageroot-review-mask-owner") === owner
          ));
          if (overlays.length !== 1 || holes.length !== 1) return false;
          const overlay = overlays[0];
          const hole = holes[0];
          const cardRect = card.getBoundingClientRect();
          const overlayRect = overlay.getBoundingClientRect();
          const expectedDocumentLeft = cardRect.left + scrollX - 3;
          const expectedDocumentTop = cardRect.top + scrollY - 3;
          const expectedWidth = cardRect.width + 6;
          const expectedHeight = cardRect.height + 6;
          return card.getAttribute("data-pageroot-review-style-scope") === "box"
            && overlay.getAttribute("data-scope") === "box"
            && overlay.getAttribute("data-shaped") !== "true"
            && overlay.getAttribute("data-pageroot-review-fragment-count") === "1"
            && Math.abs(overlayRect.left - (cardRect.left - 3)) < .75
            && Math.abs(overlayRect.top - (cardRect.top - 3)) < .75
            && Math.abs(overlayRect.width - expectedWidth) < .75
            && Math.abs(overlayRect.height - expectedHeight) < .75
            && Math.abs(Number(hole.getAttribute("data-left")) - expectedDocumentLeft) < .75
            && Math.abs(Number(hole.getAttribute("data-top")) - expectedDocumentTop) < .75
            && Math.abs(Number(hole.getAttribute("data-width")) - expectedWidth) < .75
            && Math.abs(Number(hole.getAttribute("data-height")) - expectedHeight) < .75
            && Boolean(hole.getAttribute("d"));
        });
      })),
    ).then((states) => states.every(Boolean))).toBe(true);
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
    const crossLineProjectionState = () => afterReviewFrame.locator("html").evaluate(() => {
        const marker = document.querySelector(
          '[data-review-cross-line] [data-pageroot-review-text="added"]',
        );
        if (!marker) return { matches: false, reason: "marker-missing" };
        const groupId = marker.getAttribute("data-pageroot-review-text-group") || "";
        const range = document.createRange();
        range.selectNodeContents(marker);
        const rangeRectCount = [...range.getClientRects()]
          .filter((rect) => rect.width > 1 && rect.height > 1).length;
        range.detach();
        const frames = [...document.querySelectorAll(
          '[data-pageroot-review-overlay-box][data-text-group="' + groupId + '"]',
        )];
        const labelCount = frames.filter((frame) => (
          frame.querySelector("[data-pageroot-review-overlay-label]")
        )).length;
        const framesArePlain = frames.every((frame) => (
            frame.getAttribute("data-shaped") !== "true"
            && frame.getAttribute("data-pageroot-review-fragment-count") === "1"
        ));
        return {
          matches: frames.length === rangeRectCount
            && labelCount === 1
            && framesArePlain,
          rangeRectCount,
          frameCount: frames.length,
          labelCount,
          framesArePlain,
          filter: document.documentElement.dataset.pagerootReviewFilter,
        };
      });
    await launched.page.getByRole("button", { name: "适应", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "适应", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(crossLineProjectionState).toMatchObject({ matches: true });
    await expect.poll(() => projectionIsCanonical(afterReviewFrame)).toBe(true);
    await launched.page.getByRole("button", { name: "100%", exact: true }).click();
    await expect(launched.page.getByRole("button", { name: "100%", exact: true }))
      .toHaveAttribute("aria-pressed", "true");
    await expect.poll(crossLineProjectionState).toMatchObject({ matches: true });
    const originalWindowBounds = await launched.electronApp.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ));
      return window?.getBounds() || null;
    });
    expect(originalWindowBounds).toBeTruthy();
    const originalViewportWidth = await launched.page.evaluate(() => innerWidth);
    const resizedBounds = { ...originalWindowBounds, width: originalWindowBounds.width + 180 };
    await launched.electronApp.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ))?.setBounds(bounds, false);
    }, resizedBounds);
    await expect.poll(() => launched.page.evaluate(
      (original) => innerWidth - original >= 120,
      originalViewportWidth,
    )).toBe(true);
    await expect.poll(crossLineProjectionState).toMatchObject({ matches: true });
    await expect.poll(() => projectionIsCanonical(afterReviewFrame)).toBe(true);
    await launched.electronApp.evaluate(({ BrowserWindow }, bounds) => {
      BrowserWindow.getAllWindows().find((candidate) => (
        candidate.webContents.getURL().includes("/dist-desktop/renderer/")
        || candidate.getTitle() === "源页"
      ))?.setBounds(bounds, false);
    }, originalWindowBounds);
    await expect.poll(() => launched.page.evaluate(
      (original) => Math.abs(innerWidth - original) <= 2,
      originalViewportWidth,
    )).toBe(true);
    await expect.poll(crossLineProjectionState).toMatchObject({ matches: true });
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

    const originalAfterMaximum = await afterReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    ));
    await afterReviewFrame.locator("html").evaluate(() => {
      const spacer = document.createElement("div");
      spacer.setAttribute("data-review-sync-height-probe", "true");
      spacer.style.height = "1600px";
      spacer.style.pointerEvents = "none";
      document.body.append(spacer);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    ))).toBeGreaterThan(originalAfterMaximum + 1_400);
    await launched.page.waitForTimeout(180);
    await beforeReviewFrame.locator("html").evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      dispatchEvent(new WheelEvent("wheel", { deltaY: 1_600 }));
      window.scrollTo(0, maximum);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBeGreaterThan(1);
    const unequalHeightFollowerSamples = [];
    for (let index = 0; index < 8; index += 1) {
      await launched.page.waitForTimeout(20);
      unequalHeightFollowerSamples.push(await afterReviewFrame.locator("html").evaluate(
        () => window.scrollY,
      ));
    }
    const settledUnequalHeightFollowerSamples = unequalHeightFollowerSamples.slice(-5);
    expect(
      Math.max(...settledUnequalHeightFollowerSamples)
        - Math.min(...settledUnequalHeightFollowerSamples),
    ).toBeLessThanOrEqual(1);
    const unequalHeightFollower = await afterReviewFrame.locator("html").evaluate(() => ({
      top: scrollY,
      maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
    }));
    expect(unequalHeightFollower.maximum - unequalHeightFollower.top).toBeGreaterThan(1_000);
    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: 1_200 }));
    });
    await launched.page.waitForTimeout(160);
    expect(await afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBeCloseTo(unequalHeightFollower.top, 0);
    await afterReviewFrame.locator('[data-review-sync-height-probe="true"]')
      .evaluate((spacer) => spacer.remove());
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => (
      Math.max(0, document.documentElement.scrollHeight - innerHeight)
    ))).toBe(originalAfterMaximum);

    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: -120 }));
      window.scrollTo(0, 0);
    });
    await expect.poll(() => afterReviewFrame.locator("html").evaluate(() => window.scrollY))
      .toBe(0);
    await launched.page.waitForTimeout(180);
    const sourceScrollResult = await beforeReviewFrame.locator("html").evaluate(() => {
      const outlines = [...document.querySelectorAll("[data-pageroot-outline-id]")]
        .filter((element) => element.getBoundingClientRect().height > 0);
      const target = outlines[Math.floor(outlines.length / 2)];
      if (!target) return { maximum: 0, target: 0, actual: scrollY, count: 0 };
      const rect = target.getBoundingClientRect();
      const nextTop = scrollY + rect.top + rect.height / 2 - innerHeight / 3;
      dispatchEvent(new WheelEvent("wheel", { deltaY: 900 }));
      window.scrollTo(0, nextTop);
      return {
        maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
        target: nextTop,
        actual: scrollY,
        count: outlines.length,
      };
    });
    const followerScrollMetrics = await afterReviewFrame.locator("html").evaluate(() => ({
      maximum: Math.max(0, document.documentElement.scrollHeight - innerHeight),
      actual: scrollY,
    }));
    expect(sourceScrollResult.actual).toBeGreaterThan(1);
    expect(followerScrollMetrics.maximum).toBeGreaterThan(1);
    const followerScrollSamples = [];
    for (let index = 0; index < 8; index += 1) {
      await launched.page.waitForTimeout(20);
      followerScrollSamples.push(await afterReviewFrame.locator("html").evaluate(
        () => window.scrollY,
      ));
    }
    expect(followerScrollSamples.at(-1)).toBeGreaterThan(1);
    const settledFollowerSamples = followerScrollSamples.slice(-5);
    expect(Math.max(...settledFollowerSamples) - Math.min(...settledFollowerSamples))
      .toBeLessThanOrEqual(1);
    const referenceOutlineAnchor = (frame) => frame.locator("html").evaluate(() => {
      const referenceLine = innerHeight / 3;
      const outlines = [...document.querySelectorAll("[data-pageroot-outline-id]")]
        .filter((element) => element.getBoundingClientRect().height > 0);
      const anchor = outlines.find((element) => element.getBoundingClientRect().bottom > referenceLine)
        || outlines.at(-1);
      if (!anchor) return { outlineId: "", ratio: 0 };
      const rect = anchor.getBoundingClientRect();
      return {
        outlineId: anchor.getAttribute("data-pageroot-outline-id") || "",
        ratio: Math.max(0, Math.min(1, (referenceLine - rect.top) / Math.max(1, rect.height))),
      };
    });
    const beforeOutlineAnchor = await referenceOutlineAnchor(beforeReviewFrame);
    expect(beforeOutlineAnchor.outlineId).not.toBe("");
    const afterOutlineProgress = () => afterReviewFrame.locator(
      `[data-pageroot-outline-id="${beforeOutlineAnchor.outlineId}"]`,
    ).evaluate((element) => {
      const referenceLine = innerHeight / 3;
      const rect = element.getBoundingClientRect();
      return Math.max(0, Math.min(1, (referenceLine - rect.top) / Math.max(1, rect.height)));
    });
    await expect.poll(afterOutlineProgress).toBeCloseTo(beforeOutlineAnchor.ratio, 1);

    await beforeReviewFrame.locator("html").evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      dispatchEvent(new WheelEvent("wheel", { deltaY: 1_600 }));
      window.scrollTo(0, maximum * .82);
      window.scrollTo(0, maximum * .26);
    });
    const reversalSamples = [];
    for (let index = 0; index < 7; index += 1) {
      await launched.page.waitForTimeout(20);
      reversalSamples.push(await afterReviewFrame.locator("html").evaluate(() => window.scrollY));
    }
    const settledReversalSamples = reversalSamples.slice(-4);
    expect(Math.max(...settledReversalSamples) - Math.min(...settledReversalSamples))
      .toBeLessThanOrEqual(1);

    await afterReviewFrame.locator("html").evaluate(() => {
      const maximum = Math.max(0, document.documentElement.scrollHeight - innerHeight);
      dispatchEvent(new WheelEvent("wheel", { deltaY: -900 }));
      window.scrollTo(0, maximum * .18);
    });
    const sideSwitchSamples = [];
    for (let index = 0; index < 7; index += 1) {
      await launched.page.waitForTimeout(20);
      sideSwitchSamples.push(await beforeReviewFrame.locator("html").evaluate(() => window.scrollY));
    }
    const settledSideSwitchSamples = sideSwitchSamples.slice(-4);
    expect(Math.max(...settledSideSwitchSamples) - Math.min(...settledSideSwitchSamples))
      .toBeLessThanOrEqual(1);

    await beforeReviewFrame.locator("html").evaluate(() => {
      dispatchEvent(new WheelEvent("wheel", { deltaY: -1_200 }));
      window.scrollTo(0, 0);
    });
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

test("a pre-load review navigation falls back without trusting the replacement page", async () => {
  test.setTimeout(120_000);
  const fixture = createSourceFixture("review-navigation-fallback.html", (source) => source.replace(
    "  </main>",
    `    <section data-review-navigation-fallback>
      <h2>运行态导航安全回归</h2>
      <div id="review-navigation-chart"></div>
      <script>
        const reviewNavigationVariant = "before";
        document.querySelector("#review-navigation-chart").textContent = reviewNavigationVariant;
        const reviewReplacementHtml = '<!doctype html>'
          + '<html data-review-navigation-replacement="true"><body></body></html>';
        location.replace(
          "data:text/html;charset=utf-8," + encodeURIComponent(reviewReplacementHtml),
        );
      </script>
    </section>
  </main>`,
  ));
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
        'const reviewNavigationVariant = "before";',
        'const reviewNavigationVariant = "after";',
      ));
    runOfficialFinalizer(request.requestRoot, request.changeRequest);
    await expect(launched.page.getByText(
      "修改结果已完成检查",
      { exact: true },
    ).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 });

    await launched.page.getByRole("button", { name: "审阅对比" }).click();
    await expect(launched.page.getByTestId("ai-review-workspace"))
      .toBeVisible({ timeout: 30_000 });
    const beforeReviewFrame = launched.page.frameLocator('iframe[title^="修改前"]');
    const afterReviewFrame = launched.page.frameLocator('iframe[title^="修改后"]');
    for (const frame of [beforeReviewFrame, afterReviewFrame]) {
      await expect(frame.locator("html")).toHaveAttribute(
        "data-pageroot-preview-navigation-fallback",
        "true",
        { timeout: 30_000 },
      );
      await expect(frame.locator("html"))
        .not.toHaveAttribute("data-review-navigation-replacement", "true");
      await expect(frame.locator("html"))
        .toHaveAttribute("data-pageroot-review-filter", "all");
    }
    await expect(afterReviewFrame.locator(
      '[data-pageroot-review-marker-types~="text"]',
    ).filter({ hasText: UPDATED_TEXT }).first()).toBeVisible();
    await expect(launched.page.getByText(
      "审阅画布未能安全载入，请返回本轮处理页面后重试。",
      { exact: true },
    )).toHaveCount(0);
    await launched.page.getByRole("button", {
      name: "显示并固定审阅工具",
    }).click();
    await expect(launched.page.getByRole("button", { name: "收起审阅工具" }))
      .toBeVisible();
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

    await closePageRootGracefully(launched.electronApp, launched.page);
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
    const sendToQoder = launched.page.getByRole("button", { name: /发送至 Qoder/u });
    await expect(sendToQoder).toBeEnabled();
    await sendToQoder.click();
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
    await closePageRootGracefully(launched.electronApp, launched.page);
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

    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);
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
    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);

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

    await sendToMainRenderer(
      launched.electronApp,
      launched.page,
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

    await sendToMainRenderer(
      launched.electronApp,
      launched.page,
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

    await closePageRootGracefully(firstLaunch.electronApp, firstLaunch.page);
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
