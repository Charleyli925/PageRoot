import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { playwrightRetries } from "../../../scripts/playwright-retry-policy.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /ci-environment-preflight\.spec\.mjs/,
  outputDir: path.join(productRoot, "output/playwright/electron-ci-preflight/results"),
  workers: 1,
  // This suite is the only @infra-sensitive Electron check. CI may retry it
  // once for hosted WindowServer stalls; product suites stay retry-free.
  retries: playwrightRetries({ infraSensitive: true }),
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
