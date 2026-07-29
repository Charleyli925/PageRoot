import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /packaged-startup-smoke\.spec\.mjs/u,
  outputDir: path.join(productRoot, "output/playwright/packaged-startup/results"),
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/packaged-startup/report"),
    }],
  ],
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
