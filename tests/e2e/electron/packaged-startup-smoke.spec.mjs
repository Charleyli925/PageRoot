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
  assertPackagedAppIdentity,
  expectedPackagedAppIdentity,
  readPackagedPlistIdentity,
} from "../../../scripts/packaged-app-identity.mjs";
import { waitForProjectReady, seedDismissedFirstEditGuide } from "./helpers/pageroot-app-fixture.mjs";

const productRoot = path.resolve(import.meta.dirname, "../../..");
const packageJson = JSON.parse(
  readFileSync(path.join(productRoot, "package.json"), "utf8"),
);
const expectedIdentity = expectedPackagedAppIdentity({
  packageJson,
  environment: process.env,
});

function packagedApplication() {
  const appPath = process.env.PAGEROOT_PACKAGED_APP_PATH;
  if (!appPath || !path.isAbsolute(appPath) || path.extname(appPath) !== ".app") {
    throw new Error("PAGEROOT_PACKAGED_APP_PATH must name an absolute packaged .app path.");
  }
  const productName = path.basename(appPath, ".app");
  const executable = path.join(appPath, "Contents", "MacOS", productName);
  if (!existsSync(executable)) {
    throw new Error(`Packaged application executable is missing: ${executable}`);
  }
  return { appPath, executable };
}

function removeIsolatedDirectory(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("pageroot-native-e2e-packaged-startup-")
  ) {
    throw new Error(`Refusing to remove non-packaged-startup directory: ${directory}`);
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

async function stopPackagedAppForCleanup(electronApp) {
  const electronProcess = electronApp.process();
  const closed = electronApp.waitForEvent("close", { timeout: 5_000 }).catch(() => null);
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
  await closed;
  if (electronProcess.exitCode === null && electronProcess.signalCode === null) {
    electronProcess.kill("SIGKILL");
  }
}

async function closePackagedGracefully(electronApp, page) {
  const mainRendererUrl = page?.url();
  if (!mainRendererUrl) {
    throw new Error("PageRoot main renderer URL is unavailable for graceful close.");
  }
  const closed = electronApp.waitForEvent("close", { timeout: 30_000 });
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

test("packaged app preserves identity and imports external HTML as V1 across startup states", async () => {
  test.setTimeout(180_000);
  const isolatedUserData = mkdtempSync(
    path.join(tmpdir(), "pageroot-native-e2e-packaged-startup-"),
  );
  const startupAlias = path.join(isolatedUserData, "qoder-startup.html");
  const liveAlias = path.join(isolatedUserData, "qoder-live.htm");
  writeFileSync(
    startupAlias,
    "<!doctype html><html><head><title>Startup</title></head><body><main>Qoder startup HTML</main></body></html>",
    "utf8",
  );
  writeFileSync(
    liveAlias,
    "<!doctype html><html><head><title>Live</title></head><body><main>Qoder live HTML</main></body></html>",
    "utf8",
  );
  const startupSourcePath = realpathSync(startupAlias);
  const liveSourcePath = realpathSync(liveAlias);
  seedDismissedFirstEditGuide(isolatedUserData);
  const startupOriginal = readFileSync(startupSourcePath);
  const liveOriginal = readFileSync(liveSourcePath);
  const packagedApp = packagedApplication();
  let electronApp = null;
  try {
    electronApp = await electron.launch({
      executablePath: packagedApp.executable,
      cwd: productRoot,
      args: [startupSourcePath],
      env: {
        ...process.env,
        PAGEROOT_E2E: "1",
        PAGEROOT_E2E_USER_DATA_DIR: isolatedUserData,
        HTML_AI_WORKSPACE: path.join(isolatedUserData, "workspace"),
        HTML_AI_PROJECT_FILES_ROOT: path.join(isolatedUserData, "project-files"),
      },
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle("源页");
    await expect(page.locator("main.workbench")).toBeVisible();
    await waitForProjectReady(page, { timeout: 60_000 });
    await expect(page.getByRole("button", { name: "项目", exact: true }))
      .toBeEnabled({ timeout: 30_000 });
    await expect(
      page.getByTestId("html-canvas-editor").filter({ visible: true }).first(),
    ).toHaveAttribute("data-render-verified", "true", { timeout: 30_000 });
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const runtime = await page.evaluate(() => window.htmlAIRuntime);
    expect(runtime?.appVersion).toBe(expectedIdentity.version);
    const runtimeIdentity = await electronApp.evaluate(({ app }) => ({
      name: app.getName(),
      version: app.getVersion(),
    }));
    const plistIdentity = await readPackagedPlistIdentity(packagedApp.appPath);
    assertPackagedAppIdentity({
      ...runtimeIdentity,
      bundleId: plistIdentity.bundleId,
    }, expectedIdentity);
    expect(plistIdentity.bundleVersion).toBe(expectedIdentity.version);
    expect(runtimeIdentity).toEqual({
      name: expectedIdentity.name,
      version: expectedIdentity.version,
    });
    expect(runtime?.bridgePort).toMatch(/^[1-9]\d{0,4}$/u);
    expect(Number(runtime?.bridgePort)).toBeGreaterThan(0);
    expect(Number(runtime?.bridgePort)).toBeLessThanOrEqual(65_535);
    await expect.poll(
      async () => (await page.evaluate(
        () => window.htmlAIProjects?.getActiveProject(),
      ))?.sourcePath,
      { timeout: 30_000 },
    ).toMatch(/\/qoder-startup-V1\.html$/u);
    const startupManagedSourcePath = await page.evaluate(async () => (
      await window.htmlAIProjects?.getActiveProject()
    )?.sourcePath || "");
    expect(startupManagedSourcePath).not.toBe(startupSourcePath);
    expect(readFileSync(startupSourcePath)).toEqual(startupOriginal);
    expect(readFileSync(startupManagedSourcePath)).toEqual(startupOriginal);

    await electronApp.evaluate(({ app }, sourcePath) => {
      app.emit("open-file", { preventDefault() {} }, sourcePath);
    }, liveSourcePath);
    await waitForProjectReady(page, { timeout: 60_000 });
    await expect.poll(
      async () => (await page.evaluate(
        () => window.htmlAIProjects?.getActiveProject(),
      ))?.sourcePath,
      { timeout: 30_000 },
    ).toMatch(/\/qoder-live-V1\.htm$/u);
    const liveManagedSourcePath = await page.evaluate(async () => (
      await window.htmlAIProjects?.getActiveProject()
    )?.sourcePath || "");
    expect(liveManagedSourcePath).not.toBe(liveSourcePath);
    expect(readFileSync(liveSourcePath)).toEqual(liveOriginal);
    expect(readFileSync(liveManagedSourcePath)).toEqual(liveOriginal);
    await expect.poll(
      () => page.locator("main.workbench").getAttribute("data-project-state"),
      { timeout: 30_000 },
    ).toBe("ready");

    await closePackagedGracefully(electronApp, page);
    electronApp = null;
  } finally {
    if (electronApp) await stopPackagedAppForCleanup(electronApp);
    removeIsolatedDirectory(isolatedUserData);
  }
});
