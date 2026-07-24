import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /ci-environment-preflight\.spec\.mjs/,
  outputDir: path.join(productRoot, "output/playwright/electron-ci-preflight/results"),
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/electron-ci-preflight/report"),
    }],
  ],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
