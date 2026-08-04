import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

const productRoot = path.resolve(import.meta.dirname, "../../..");
const packageVersion = JSON.parse(
  readFileSync(path.join(productRoot, "package.json"), "utf8"),
).version;
const expectedAppVersion = process.env.PAGEROOT_EXPECTED_APP_VERSION || packageVersion;
const expectedProductName = process.env.PAGEROOT_EXPECTED_PRODUCT_NAME || "PageRoot";

function packagedExecutable() {
  const appPath = process.env.PAGEROOT_PACKAGED_APP_PATH;
  if (!appPath || !path.isAbsolute(appPath) || path.extname(appPath) !== ".app") {
    throw new Error("PAGEROOT_PACKAGED_APP_PATH must name an absolute packaged .app path.");
  }
  const productName = path.basename(appPath, ".app");
  const executable = path.join(appPath, "Contents", "MacOS", productName);
  if (!existsSync(executable)) {
    throw new Error(`Packaged application executable is missing: ${executable}`);
  }
  return executable;
}

function removeIsolatedDirectory(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("pageroot-native-e2e-developer-preview-")
  ) {
    throw new Error(`Refusing to remove non-preview directory: ${directory}`);
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

test("developer preview opens the latest runtime and closes cleanly", async () => {
  test.setTimeout(60_000);
  const isolatedUserData = mkdtempSync(
    path.join(tmpdir(), "pageroot-native-e2e-developer-preview-"),
  );
  let electronApp = null;
  try {
    electronApp = await electron.launch({
      executablePath: packagedExecutable(),
      cwd: productRoot,
      env: {
        ...process.env,
        PAGEROOT_E2E: "1",
        PAGEROOT_E2E_USER_DATA_DIR: isolatedUserData,
        HTML_AI_WORKSPACE: path.join(isolatedUserData, "workspace"),
      },
    });
    const page = await electronApp.firstWindow();
    await page.waitForLoadState("domcontentloaded");
    await expect(page).toHaveTitle("源页");
    await expect(page.locator("main.workbench")).toBeVisible();
    await expect(page.locator("main.workbench"))
      .toHaveAttribute("data-project-state", "ready", { timeout: 30_000 });
    await expect(page.getByRole("button", { name: "项目", exact: true }))
      .toBeEnabled({ timeout: 30_000 });
    await expect(
      page.getByTestId("html-canvas-editor").filter({ visible: true }).first(),
    ).toHaveAttribute("data-render-verified", "true", { timeout: 30_000 });
    await page.evaluate(() => new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    const runtime = await page.evaluate(() => window.htmlAIRuntime);
    expect(runtime?.appVersion).toBe(expectedAppVersion);
    const appIdentity = await electronApp.evaluate(({ app }) => ({
      name: app.getName(),
      version: app.getVersion(),
    }));
    expect(appIdentity).toEqual({
      name: expectedProductName,
      version: expectedAppVersion,
    });
    expect(runtime?.bridgePort).toMatch(/^[1-9]\d{0,4}$/u);
    expect(Number(runtime?.bridgePort)).toBeGreaterThan(0);
    expect(Number(runtime?.bridgePort)).toBeLessThanOrEqual(65_535);

    const closed = electronApp.waitForEvent("close", { timeout: 30_000 });
    await electronApp.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]?.close();
    });
    await closed;
    electronApp = null;
  } finally {
    if (electronApp) await stopPackagedAppForCleanup(electronApp);
    removeIsolatedDirectory(isolatedUserData);
  }
});
