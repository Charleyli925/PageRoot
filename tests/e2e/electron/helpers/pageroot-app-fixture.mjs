import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "@playwright/test";
import { _electron as electron } from "playwright";

import {
  caseSelector,
  fixtureBuffer,
  productRoot,
} from "../../browser/pageroot-driver.mjs";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const DEFAULT_USER_DATA_PREFIX = "pageroot-native-e2e-";
const DEFAULT_CLOSE_TIMEOUT = 5_000;
const DEFAULT_EXIT_REQUEST_TIMEOUT = 1_000;
const DEFAULT_EXIT_TIMEOUT = 3_000;
const DEFAULT_TERMINATE_TIMEOUT = 1_000;
const DEFAULT_CLOSE_OBSERVATION_GRACE = 1_000;
const DEFAULT_SOURCE_PREFIX = "pageroot-native-e2e-source-";
const DEFAULT_MAIN_WINDOW_TIMEOUT = 15_000;
const stopPromiseKey = Symbol("pagerootAppFixtureStopPromise");

async function reserveLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address !== "object") {
    server.close();
    throw new Error("无法为旧项目预置 Bridge 分配本地端口。");
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

async function waitForChildExit(child, timeout = 2_000) {
  if (child.exitCode !== null) return true;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(false);
    }, timeout);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

async function stopSeedBridge(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  if (await waitForChildExit(child)) return;
  child.kill("SIGKILL");
  await waitForChildExit(child);
}

async function waitForSeedBridge(baseUrl, child, stderr) {
  const deadline = Date.now() + 10_000;
  let lastError = null;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`旧项目预置 Bridge 提前退出：${stderr() || child.exitCode}`);
    }
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `旧项目预置 Bridge 启动超时：${lastError?.message || "unknown error"}\n${stderr()}`,
  );
}

// Creates a pre-v4 project solely to verify the v4 incompatibility boundary:
// the Electron client must ignore it and import the source as a fresh V1.
export async function seedLegacyV3Project({ isolatedUserData, sourcePath }) {
  if (!isolatedUserData || !sourcePath) {
    throw new TypeError("旧项目预置需要隔离用户目录和源 HTML 路径。");
  }
  mkdirSync(isolatedUserData, { recursive: true });
  const workspace = path.join(isolatedUserData, "workspace");
  const projectFilesRoot = path.join(isolatedUserData, "project-files");
  const port = await reserveLoopbackPort();
  let stderr = "";
  const child = spawn(process.execPath, [
    path.join(productRoot, "scripts", "workspace-bridge.mjs"),
  ], {
    cwd: productRoot,
    env: {
      ...process.env,
      HTML_AI_ALLOW_FILE_ORIGIN: "1",
      HTML_AI_BRIDGE_PORT: String(port),
      HTML_AI_WORKSPACE: workspace,
      HTML_AI_PROJECT_FILES_ROOT: projectFilesRoot,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk}`.slice(-16_384);
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  try {
    await waitForSeedBridge(baseUrl, child, () => stderr);
    const preview = await fetch(
      `${baseUrl}/workspace?sourcePath=${encodeURIComponent(sourcePath)}`,
    );
    const previewBody = await preview.json().catch(() => null);
    if (!preview.ok || previewBody?.registered !== false) {
      throw new Error("旧项目预置没有获得未注册的源 HTML。\n" + stderr);
    }
    const ensured = await fetch(`${baseUrl}/project/ensure`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourcePath,
        expectedSourceSha256: previewBody.currentHtmlSha256,
      }),
    });
    const ensuredBody = await ensured.json().catch(() => null);
    if (
      !ensured.ok
      || ensuredBody?.registered !== true
      || ensuredBody?.projectFileSchemaVersion === "4.0.0"
    ) {
      throw new Error("旧项目预置未建立 v3 项目。\n" + stderr);
    }
    return ensuredBody;
  } finally {
    await stopSeedBridge(child);
  }
}

/**
 * Keeps the initial close listener alive through every bounded shutdown path.
 * The extra grace avoids racing a final SIGKILL close event at the exact timer
 * boundary, while a caller-provided larger timeout remains authoritative.
 */
export function closeObservationTimeout(timeout = DEFAULT_CLOSE_TIMEOUT) {
  const shutdownBudget = DEFAULT_EXIT_REQUEST_TIMEOUT
    + DEFAULT_EXIT_TIMEOUT
    + (DEFAULT_TERMINATE_TIMEOUT * 2)
    + DEFAULT_CLOSE_OBSERVATION_GRACE;
  return Math.max(timeout, shutdownBudget);
}

function collectProcessDiagnostics(electronProcess) {
  const diagnostics = {
    stdout: [],
    stderr: [],
  };
  const attach = (stream, lines) => {
    if (!stream?.on) return;
    stream.on("data", (chunk) => {
      if (lines.length < 40) lines.push(String(chunk));
    });
  };
  attach(electronProcess?.stdout, diagnostics.stdout);
  attach(electronProcess?.stderr, diagnostics.stderr);
  return diagnostics;
}

function waitForProcessExit(electronProcess, timeout) {
  return new Promise((resolve) => {
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
}

/**
 * Builds the close-before-cleanup contract without module-global state.
 * Exported so the teardown ordering can be verified without launching Electron.
 */
export function createCloseFirstCleanup({
  requestExit,
  waitForExit,
  waitForClose,
  terminate,
  cleanup,
  exitTimeout = DEFAULT_EXIT_TIMEOUT,
  terminateTimeout = DEFAULT_TERMINATE_TIMEOUT,
}) {
  let stopPromise = null;
  return async function stop() {
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      await requestExit();
      let processExited = await waitForExit(exitTimeout);
      if (!processExited) {
        await terminate("SIGTERM");
        processExited = await waitForExit(terminateTimeout);
        if (!processExited) {
          await terminate("SIGKILL");
          processExited = await waitForExit(terminateTimeout);
        }
      }
      const closeObserved = await waitForClose();
      if (!closeObserved && !processExited) {
        throw new Error("PageRoot exit could not be confirmed; temporary data was preserved.");
      }
      await cleanup();
    })();
    return stopPromise;
  };
}

export function seedActiveDiskProject(
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

export function createSourceFixture({
  fileName = "generated-e2e-source.html",
  transform = (source) => source,
  sourceFixtureName = "complex-layout.html",
  sourceDirectoryPrefix = DEFAULT_SOURCE_PREFIX,
} = {}) {
  const sourceDirectory = mkdtempSync(
    path.join(tmpdir(), sourceDirectoryPrefix),
  );
  const sourcePath = path.join(sourceDirectory, fileName);
  const source = fixtureBuffer(sourceFixtureName).toString("utf8");
  writeFileSync(sourcePath, transform(source), "utf8");
  return { sourceDirectory, sourcePath, original: readFileSync(sourcePath) };
}

export function removeSourceFixture(
  sourceDirectory,
  sourceDirectoryPrefix = DEFAULT_SOURCE_PREFIX,
) {
  removeValidatedTemporaryDirectory(sourceDirectory, sourceDirectoryPrefix);
}

export async function waitForMainBrowserWindow(
  electronApp,
  rendererUrl,
  { timeout = DEFAULT_MAIN_WINDOW_TIMEOUT } = {},
) {
  let nativeWindow = null;
  await expect.poll(async () => {
    nativeWindow = await electronApp.evaluate(({ BrowserWindow }, expectedRendererUrl) => {
      const window = BrowserWindow.getAllWindows().find((candidate) => (
        !candidate.isDestroyed()
        && candidate.webContents.getURL() === expectedRendererUrl
      ));
      if (!window) return null;
      window.webContents.setBackgroundThrottling(false);
      return {
        focused: window.isFocused(),
        visible: window.isVisible(),
      };
    }, rendererUrl);
    return nativeWindow !== null;
  }, {
    timeout,
    message: "PageRoot main BrowserWindow did not become available during launch.",
  }).toBe(true);
  return nativeWindow;
}

export async function launchPageRoot({
  activeSourcePath = null,
  recentSourcePaths = activeSourcePath ? [activeSourcePath] : [],
  isolatedUserData: existingUserData = null,
  injectedEnv = {},
  userDataPrefix = DEFAULT_USER_DATA_PREFIX,
} = {}) {
  const isolatedUserData = existingUserData || mkdtempSync(
    path.join(tmpdir(), userDataPrefix),
  );
  mkdirSync(isolatedUserData, { recursive: true });
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
          // New project-file imports deliberately live outside the legacy
          // workspace. Keep that user-owned root inside this isolated E2E
          // profile so tests exercise the real import handoff without
          // creating Finder projects in the developer's Documents folder.
          HTML_AI_PROJECT_FILES_ROOT: path.join(isolatedUserData, "project-files"),
          ...injectedEnv,
    },
  });
  const diagnostics = collectProcessDiagnostics(electronApp.process());
  const page = await electronApp.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(() => document.visibilityState === "visible");
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  const mainRendererUrl = page.url();
  const nativeWindow = await waitForMainBrowserWindow(electronApp, mainRendererUrl);
  const foreground = (
    injectedEnv.PAGEROOT_E2E_FOREGROUND
    ?? process.env.PAGEROOT_E2E_FOREGROUND
  ) === "1";
  expect(nativeWindow.visible).toBe(foreground);
  if (!foreground) expect(nativeWindow.focused).toBe(false);
  return {
    electronApp,
    page,
    isolatedUserData,
    workspace,
    diagnostics: {
      ...diagnostics,
      userDataPath: isolatedUserData,
      workspacePath: workspace,
    },
  };
}

export function removeValidatedTemporaryDirectory(directoryPath, namePrefix) {
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

export async function stopPageRoot(
  electronApp,
  isolatedUserData,
  {
    cleanup = true,
    cleanupPrefix = DEFAULT_USER_DATA_PREFIX,
    closeTimeout = DEFAULT_CLOSE_TIMEOUT,
  } = {},
) {
  if (electronApp[stopPromiseKey]) return electronApp[stopPromiseKey];
  const electronProcess = electronApp.process();
  const applicationClosed = electronApp
    .waitForEvent("close", { timeout: closeObservationTimeout(closeTimeout) })
    .then(() => true)
    .catch(() => false);
  const stop = createCloseFirstCleanup({
    requestExit: () => Promise.race([
      electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {}),
      new Promise((resolve) => setTimeout(resolve, DEFAULT_EXIT_REQUEST_TIMEOUT)),
    ]),
    waitForExit: (timeout) => waitForProcessExit(electronProcess, timeout),
    waitForClose: () => applicationClosed,
    terminate: async (signal) => {
      if (electronProcess.exitCode === null && electronProcess.signalCode === null) {
        electronProcess.kill(signal);
      }
    },
    cleanup: () => {
      if (cleanup) removeValidatedTemporaryDirectory(isolatedUserData, cleanupPrefix);
    },
  });
  const stopPromise = stop();
  Object.defineProperty(electronApp, stopPromiseKey, {
    value: stopPromise,
  });
  return stopPromise;
}

export async function closePageRootGracefully(electronApp, page, {
  timeout = 35_000,
} = {}) {
  const mainRendererUrl = page?.url();
  if (!mainRendererUrl) {
    throw new Error("PageRoot main renderer URL is unavailable for graceful close.");
  }
  await page.evaluate(() => {
    window.__PAGEROOT_CLOSE_ABORT_REASON__ = null;
    window.addEventListener("html-ai:close-aborted", (event) => {
      window.__PAGEROOT_CLOSE_ABORT_REASON__ = event.detail?.reason || "unknown";
    }, { once: true });
  });
  const closed = electronApp.waitForEvent("close", { timeout });
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
  try {
    await closed;
  } catch (error) {
    const reason = await page.evaluate(
      () => window.__PAGEROOT_CLOSE_ABORT_REASON__,
    ).catch(() => null);
    throw new Error(
      `PageRoot graceful close did not complete${reason ? `: ${reason}` : "."}`,
      { cause: error },
    );
  }
}

export async function sendToMainRenderer(electronApp, page, channel, payload) {
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

export async function waitForProjectReady(page, {
  timeout = 60_000,
  includeFailureDetail = true,
} = {}) {
  await expect.poll(async () => {
    const state = await page.locator("main.workbench").getAttribute("data-project-state");
    if (state === "ready") return state;
    const stage = await page.evaluate(() => window.__PAGEROOT_HYDRATION_STAGE__);
    const visibleFailure = includeFailureDetail && state === "failed"
      ? await page.locator('[aria-label="项目读取失败"]').textContent().catch(() => "")
      : "";
    return `${state}:${stage || "unmarked"}:${visibleFailure || "no-detail"}`;
  }, { timeout }).toBe("ready");
}

export async function loadedDiskFrame(
  page,
  sourcePath,
  {
    editable = true,
    expectedCase = "list-item",
    timeout = 60_000,
    includeEditor = false,
  } = {},
) {
  const canonicalSourcePath = realpathSync(sourcePath);
  await waitForProjectReady(page, { timeout });
  const extension = path.extname(canonicalSourcePath);
  const expectedWorkingCopyName = `${path.basename(canonicalSourcePath, extension)}-V1${extension}`;
  let activeSourcePath = "";
  await expect.poll(
    async () => {
      activeSourcePath = (
        await page.evaluate(() => window.htmlAIProjects?.getActiveProject())
      )?.sourcePath || "";
      if (!activeSourcePath) return "";
      const canonicalActiveSourcePath = realpathSync(activeSourcePath);
      return canonicalActiveSourcePath === canonicalSourcePath
        || path.basename(canonicalActiveSourcePath) === expectedWorkingCopyName
        ? canonicalActiveSourcePath
        : "";
    },
    { timeout: Math.min(timeout, 20_000) },
  ).not.toBe("");
  const canonicalActiveSourcePath = realpathSync(activeSourcePath);
  if (canonicalActiveSourcePath !== canonicalSourcePath) {
    // The desktop v4 opening boundary immediately imports every external HTML
    // into its own V1 Working Copy. Keep fixture callers honest about that
    // transition instead of preserving the retired external-preview contract.
    expect(path.basename(canonicalActiveSourcePath)).toBe(expectedWorkingCopyName);
  }
  await expect(page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "项目", exact: true }))
    .toBeEnabled({ timeout });
  if (editable) {
    await expect(page.getByRole("button", { name: "全局评论", exact: true }))
      .toBeEnabled({ timeout });
  }
  await expect(page.locator('[aria-label="项目读取失败"]')).toHaveCount(0);
  const editor = page.getByTestId("html-canvas-editor").filter({ visible: true }).first();
  await editor.waitFor({ state: "visible", timeout });
  await expect(editor).toHaveAttribute("data-render-verified", "true", { timeout });
  const iframe = editor.locator('iframe[title*="HTML"]').first();
  await iframe.waitFor({ state: "attached", timeout });
  let frame = null;
  await expect.poll(async () => {
    try {
      const iframeHandle = await iframe.elementHandle();
      const candidate = await iframeHandle?.contentFrame() || null;
      if (!candidate) return false;
      if (await candidate.locator(caseSelector(expectedCase)).count() !== 1) {
        return false;
      }
      frame = candidate;
      return true;
    } catch (error) {
      if (/Frame was detached|Execution context was destroyed/u.test(String(error))) {
        return false;
      }
      throw error;
    }
  }, { timeout }).toBe(true);
  if (!frame) throw new Error("PageRoot did not expose the Electron edit frame.");
  return includeEditor ? { editor, frame, sourcePath: canonicalActiveSourcePath } : frame;
}
