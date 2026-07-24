import { createRequire } from "node:module";
import {
  mkdtempSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";

const require = createRequire(import.meta.url);
const electronExecutable = require("electron");
const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const fixtureMain = path.join(currentDirectory, "fixtures/ci-preflight-main.mjs");

function removePreflightUserData(directoryPath) {
  const resolved = path.resolve(directoryPath);
  if (
    path.dirname(resolved) !== path.resolve(tmpdir())
    || !path.basename(resolved).startsWith("pageroot-native-e2e-preflight-")
  ) {
    throw new Error(`Refusing to remove non-preflight data: ${resolved}`);
  }
  rmSync(resolved, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 100,
  });
}

async function stopPreflightApp(electronApp) {
  if (!electronApp) return;
  const electronProcess = electronApp.process();
  await electronApp.evaluate(({ app }) => app.exit(0)).catch(() => {});
  if (electronProcess.exitCode !== null || electronProcess.signalCode !== null) return;
  const exited = await new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), 5_000);
    electronProcess.once("exit", () => {
      clearTimeout(timer);
      resolve(true);
    });
  });
  if (!exited && electronProcess.exitCode === null && electronProcess.signalCode === null) {
    electronProcess.kill("SIGKILL");
  }
}

test("hosted macOS can show, schedule and paint a synthetic Electron renderer", async () => {
  const isolatedUserData = mkdtempSync(
    path.join(tmpdir(), "pageroot-native-e2e-preflight-"),
  );
  let electronApp = null;
  try {
    electronApp = await electron.launch({
      executablePath: electronExecutable,
      args: [fixtureMain],
      cwd: productRoot,
      timeout: 15_000,
      env: {
        ...process.env,
        PAGEROOT_ELECTRON_PREFLIGHT_USER_DATA: isolatedUserData,
      },
    });
    const page = await electronApp.firstWindow({ timeout: 15_000 });
    const nativeWindow = await electronApp.evaluate(({ app, BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window?.webContents.setBackgroundThrottling(false);
      window?.show();
      app.focus({ steal: true });
      window?.focus();
      return {
        count: BrowserWindow.getAllWindows().length,
        visible: window?.isVisible() || false,
        minimized: window?.isMinimized() || false,
        destroyed: window?.isDestroyed() ?? true,
      };
    });
    await page.bringToFront();
    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 });
    await page.waitForFunction(() => document.visibilityState === "visible", null, {
      timeout: 10_000,
    });
    const rendererSchedule = await page.evaluate(() => new Promise((resolve, reject) => {
      const startedAt = performance.now();
      let frameCount = 0;
      const timeout = setTimeout(() => {
        reject(new Error("Renderer timers or animation frames did not advance."));
      }, 5_000);
      const onFrame = () => {
        frameCount += 1;
        if (frameCount < 2) {
          requestAnimationFrame(onFrame);
          return;
        }
        setTimeout(() => {
          clearTimeout(timeout);
          resolve({
            elapsedMs: performance.now() - startedAt,
            frameCount,
            visibilityState: document.visibilityState,
            bodyChildCount: document.body?.childElementCount || 0,
          });
        }, 0);
      };
      requestAnimationFrame(onFrame);
    }));

    expect(nativeWindow).toEqual({
      count: 1,
      visible: true,
      minimized: false,
      destroyed: false,
    });
    expect(rendererSchedule.visibilityState).toBe("visible");
    expect(rendererSchedule.frameCount).toBeGreaterThanOrEqual(2);
    expect(rendererSchedule.bodyChildCount).toBeGreaterThan(0);
    expect(rendererSchedule.elapsedMs).toBeLessThan(5_000);
    await expect(page.getByTestId("electron-preflight-ready")).toHaveText(
      "Electron environment ready",
    );
  } finally {
    await stopPreflightApp(electronApp);
    removePreflightUserData(isolatedUserData);
  }
});
