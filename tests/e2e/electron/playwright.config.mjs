import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /(?:electron-(?:project-lifecycle|workbench-tabs|edit-runtime|native-input|comments-and-rules|source-recovery)|conflict-force-unlock)\.spec\.mjs/,
  outputDir: path.join(productRoot, "output/playwright/native-dom-electron/results"),
  workers: 1,
  // CI absorbs one transient Electron launch/hydration stall per test. Local
  // runs stay retry-free so caret/Selection regressions are never hidden. A
  // retried failure keeps trace, video and screenshot evidence, and the JSON
  // reporter feeds the machine-readable flaky summary that CI always uploads.
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["json", {
      outputFile: path.join(productRoot, "output/playwright/native-dom-electron/results.json"),
    }],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/native-dom-electron/report"),
    }],
  ],
  // Native waitForProjectReady/loadedDiskFrame use a 60s hydration budget so
  // CI import confirmation plus canvas verify can finish; keep the test
  // budget above that plus iframe/editor assertions.
  timeout: 120_000,
  expect: { timeout: 10_000 },
  use: {
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
});
