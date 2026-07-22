import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const externalBaseUrl = process.env.PAGEROOT_BASE_URL || "";
const baseURL = externalBaseUrl || "http://localhost:3000";

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /native-dom-.*\.spec\.mjs/,
  outputDir: path.join(productRoot, "output/playwright/native-dom-browser/results"),
  fullyParallel: false,
  workers: 1,
  // Native caret/Selection regressions must never be hidden by a retry.
  retries: 0,
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/native-dom-browser/report"),
    }],
  ],
  expect: { timeout: 7_000 },
  timeout: 45_000,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    acceptDownloads: true,
    permissions: ["clipboard-read", "clipboard-write"],
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  webServer: externalBaseUrl ? undefined : {
    command: "npm run start",
    cwd: productRoot,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
