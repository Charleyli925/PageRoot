import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /native-dom-electron\.spec\.mjs/,
  outputDir: path.join(productRoot, "output/playwright/native-dom-electron/results"),
  workers: 1,
  // CI absorbs one transient Electron launch/hydration stall per test. Local
  // runs stay retry-free so caret/Selection regressions are never hidden, and
  // every retried failure still retains its trace, video and screenshot.
  retries: process.env.CI ? 1 : 0,
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/native-dom-electron/report"),
    }],
  ],
  timeout: 75_000,
  expect: { timeout: 10_000 },
  use: {
    acceptDownloads: true,
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
