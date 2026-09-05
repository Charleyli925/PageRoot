import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { playwrightRetries } from "../../../scripts/playwright-retry-policy.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /(?:electron-(?:project-lifecycle|workbench-tabs|edit-runtime|native-input|comments-and-rules|source-recovery|runtime-continuity|runtime-scripts)|conflict-force-unlock)\.spec\.mjs/,
  outputDir: path.join(productRoot, "output/playwright/native-dom-electron/results"),
  workers: 1,
  // Product-contract Electron tests never retry. Hosted-window stalls are
  // proven first by the @infra-sensitive CI preflight, which may retry once.
  // release-gate refuses attestation when this suite reports flaky or retries.
  retries: playwrightRetries(),
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
