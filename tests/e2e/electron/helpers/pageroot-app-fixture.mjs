import { createRequire } from "node:module";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect } from "@playwright/test";
import { _electron as electron } from "playwright";

import {
  caseSelector,
  fixtureBuffer,
  productRoot,
} from "../../browser/pageroot-driver.mjs";
import {
  FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
  FIRST_REAL_HTML_EDIT_GUIDE_KEY,
  UI_PREFERENCES_FILE_NAME,
  UI_PREFERENCES_SCHEMA_VERSION,
} from "../../../../desktop/ui-preferences.mjs";

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

// Creates leftover pre-v4 project records solely to verify the v4
// incompatibility boundary: the Electron client must ignore them and import
// the source as a fresh V1. User disk data is not deleted.
export async function seedLegacyV3Project({ isolatedUserData, sourcePath }) {
  if (!isolatedUserData || !sourcePath) {
    throw new TypeError("旧项目预置需要隔离用户目录和源 HTML 路径。");
  }
  mkdirSync(isolatedUserData, { recursive: true });
  const workspace = path.join(isolatedUserData, "workspace");
  const projectId = `project_${randomBytes(8).toString("hex")}`;
  const documentId = `doc_${randomBytes(8).toString("hex")}`;
  const createdAt = new Date().toISOString();
  const storageDirectoryName = `pre-v4-legacy__${projectId.slice(-8)}`;
  const projectRoot = path.join(workspace, "projects", storageDirectoryName);
  mkdirSync(path.join(projectRoot, "versions"), { recursive: true });
  writeFileSync(
    path.join(workspace, "project-registry.json"),
    `${JSON.stringify({
      schemaVersion: "3.0.0",
      projects: {
        [projectId]: {
          displayName: path.basename(sourcePath, path.extname(sourcePath)),
          sourcePath,
          createdAt,
          storageDirectoryName,
        },
      },
    }, null, 2)}\n`,
  );
  writeFileSync(
    path.join(projectRoot, "project.json"),
    `${JSON.stringify({
      schemaVersion: "3.0.0",
      projectId,
      documentId,
      sourcePath,
      createdAt,
      storageDirectoryName,
    }, null, 2)}\n`,
  );
  return {
    projectId,
    documentId,
    workspace,
    projectRoot,
    registered: true,
  };
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

export function seedDismissedFirstEditGuide(isolatedUserData) {
  mkdirSync(isolatedUserData, { recursive: true });
  writeFileSync(
    path.join(isolatedUserData, UI_PREFERENCES_FILE_NAME),
    `${JSON.stringify({
      schemaVersion: UI_PREFERENCES_SCHEMA_VERSION,
      firstRealHtmlEditGuide: {
        key: FIRST_REAL_HTML_EDIT_GUIDE_KEY,
        generation: FIRST_REAL_HTML_EDIT_GUIDE_GENERATION,
        status: "dismissed",
        presentedAt: null,
        dismissedAt: "2020-01-01T00:00:00.000Z",
      },
      builtInWelcomeProjectId: null,
    }, null, 2)}\n`,
    "utf8",
  );
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

const DEFAULT_RENDERER_MOUNT_TIMEOUT = 20_000;
const RENDERER_MOUNT_POLL_MS = 100;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function pageHasRendererMount(page) {
  return page.evaluate(() => Boolean(document.querySelector("main.workbench"))).catch(() => false);
}

export async function ensureRendererMounted(page, {
  timeout = DEFAULT_RENDERER_MOUNT_TIMEOUT,
  reload = (target) => target.reload({ waitUntil: "domcontentloaded" }),
} = {}) {
  const waitUntilMounted = async () => {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      if (await pageHasRendererMount(page)) return true;
      await sleep(RENDERER_MOUNT_POLL_MS);
    }
    return pageHasRendererMount(page);
  };

  if (await waitUntilMounted()) return { reloaded: false };
  await reload(page);
  if (await waitUntilMounted()) return { reloaded: true };
  throw new Error("PageRoot renderer did not mount after launch reload.");
}

export async function launchPageRoot({
  activeSourcePath = null,
  recentSourcePaths = activeSourcePath ? [activeSourcePath] : [],
  isolatedUserData: existingUserData = null,
  injectedEnv = {},
  userDataPrefix = DEFAULT_USER_DATA_PREFIX,
  firstEditGuide = false,
} = {}) {
  const isolatedUserData = existingUserData || mkdtempSync(
    path.join(tmpdir(), userDataPrefix),
  );
  mkdirSync(isolatedUserData, { recursive: true });
  const workspace = path.join(isolatedUserData, "workspace");
  if (!firstEditGuide) seedDismissedFirstEditGuide(isolatedUserData);
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
          ...(firstEditGuide ? { PAGEROOT_E2E_FIRST_EDIT_GUIDE: "1" } : {}),
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
  const mainRendererUrl = page.url();
  const nativeWindow = await waitForMainBrowserWindow(electronApp, mainRendererUrl);
  await page.waitForFunction(() => document.visibilityState === "visible");
  await page.evaluate(() => new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  }));
  await ensureRendererMounted(page);
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
  const importButton = page.getByRole("button", { name: "导入并打开" });
  const continueButton = page.getByRole("button", { name: "继续当前项目" });
  const confirmationKind = async () => {
    if (await importButton.isVisible().catch(() => false)) return "import";
    if (await continueButton.isVisible().catch(() => false)) return "continue";
    return "";
  };
  const projectState = async () => {
    let snapshot;
    try {
      snapshot = await page.evaluate(() => ({
        state: document.querySelector("main.workbench")?.getAttribute("data-project-state") || null,
        stage: window.__PAGEROOT_HYDRATION_STAGE__ || null,
      }));
    } catch (error) {
      return `transient:${error instanceof Error ? error.name : "evaluate"}:no-detail`;
    }
    if (snapshot.state === "ready") return "ready";
    const visibleFailure = includeFailureDetail && snapshot.state === "failed"
      ? await page.locator('[aria-label="项目读取失败"]').textContent().catch(() => "")
      : "";
    return `${snapshot.state || "missing"}:${snapshot.stage || "unmarked"}:${visibleFailure || "no-detail"}`;
  };

  let pendingConfirmation = "";
  await expect.poll(async () => {
    pendingConfirmation = await confirmationKind();
    if (pendingConfirmation) return "confirm";
    return projectState();
  }, { timeout }).toMatch(/^(?:ready|confirm)$/u);

  // Last-active external HTML can overlay confirmation after welcome is already ready.
  if (!pendingConfirmation) {
    try {
      await importButton.or(continueButton).waitFor({ state: "visible", timeout: 1_500 });
      pendingConfirmation = await confirmationKind();
    } catch {
      pendingConfirmation = "";
    }
  }

  if (pendingConfirmation === "import" || pendingConfirmation === "continue") {
    const button = pendingConfirmation === "import" ? importButton : continueButton;
    if (pendingConfirmation === "import") {
      const importDialog = page.getByRole("dialog", { name: /导入 PageRoot/u });
      await expect(importDialog).toContainText("复制并保存为");
      await expect(importDialog).toContainText(
        "成功导入后，同意将原文件移至废纸篓。",
      );
      await expect(importDialog.getByRole("checkbox"))
        .not.toBeChecked();
      await expect(importDialog.getByRole("button", { name: /^打开 /u }))
        .toBeVisible();
    }
    await button.focus();
    await button.click();
    await expect.poll(async () => {
      if (await confirmationKind()) return "confirming";
      return projectState();
    }, { timeout }).toBe("ready");
  }
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
