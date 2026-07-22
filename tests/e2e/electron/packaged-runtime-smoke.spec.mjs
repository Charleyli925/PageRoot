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

import {
  activateNativeEdit,
  fixtureBuffer,
  keyShortcut,
  loadFixture,
  productRoot,
  replaceUniqueBytes,
  setTextSelection,
  withBomAndCrLf,
} from "../browser/pageroot-driver.mjs";

function packagedExecutable() {
  const appPath = process.env.PAGEROOT_PACKAGED_APP_PATH;
  if (!appPath || !path.isAbsolute(appPath) || path.extname(appPath) !== ".app") {
    throw new Error("PAGEROOT_PACKAGED_APP_PATH must name the absolute packaged PageRoot.app path.");
  }
  const executable = path.join(appPath, "Contents/MacOS/PageRoot");
  if (!existsSync(executable)) throw new Error(`Packaged PageRoot executable is missing: ${executable}`);
  return executable;
}

function removeIsolatedDirectory(directory) {
  const resolved = path.resolve(directory);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("pageroot-native-e2e-")
  ) {
    throw new Error(`Refusing to remove non-E2E directory: ${directory}`);
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

test("packaged PageRoot boots in isolation and exports one byte-exact authored DOM edit", async () => {
  const isolatedUserData = mkdtempSync(path.join(tmpdir(), "pageroot-native-e2e-packaged-"));
  const exportedPath = path.join(isolatedUserData, "packaged-export.html");
  const originalToken = "SOURCE_FIDELITY_TOKEN_001";
  const replacement = "PackagedRuntime_OK_源页";
  const original = withBomAndCrLf(fixtureBuffer("source-fidelity.html"));
  const expected = replaceUniqueBytes(original, originalToken, replacement);
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
    const runtime = await page.evaluate(() => window.htmlAIRuntime);
    expect(runtime?.appVersion).toMatch(/^\d+\.\d+\.\d+$/u);
    await electronApp.evaluate(({ dialog }, destination) => {
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: destination,
      });
    }, exportedPath);

    const { frame } = await loadFixture(page, "source-fidelity.html", { buffer: original });
    await activateNativeEdit(frame, "source-fidelity");
    await setTextSelection(frame, "source-fidelity", 0, originalToken.length);
    await page.keyboard.insertText(replacement);
    await page.keyboard.press(keyShortcut("S"));
    await page.getByRole("button", { name: "导出 HTML 副本", exact: true }).click();
    await expect.poll(() => existsSync(exportedPath), { timeout: 15_000 }).toBe(true);
    const exported = readFileSync(exportedPath);
    expect(exported.equals(expected), "packaged export must differ only at the authorized bytes").toBe(true);
  } finally {
    if (electronApp) {
      const electronProcess = electronApp.process();
      const closed = electronApp.waitForEvent("close", { timeout: 10_000 }).catch(() => null);
      await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
      await closed;
      if (electronProcess.exitCode === null && electronProcess.signalCode === null) {
        electronProcess.kill("SIGKILL");
      }
    }
    removeIsolatedDirectory(isolatedUserData);
  }
});
