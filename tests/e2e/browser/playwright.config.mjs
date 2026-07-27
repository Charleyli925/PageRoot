import { defineConfig, devices } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const externalBaseUrl = process.env.PAGEROOT_BASE_URL || "";
const localPort = process.env.PORT || "3000";
const baseURL = externalBaseUrl || `http://localhost:${localPort}`;

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /native-dom-.*\.spec\.mjs/,
  // These suites specify the retired V1 per-keystroke tracker, format
  // skeleton and IME-tail state machine. V2 replaces them with the single
  // editable-island contract covered by native-dom-v2-editable-island plus
  // the source, boundary, zero-boundary and lease suites.
  testIgnore: /native-dom-(?:controller-command-policy|editing|format-skeleton|ime-epoch-regressions|session-finalization|structure-guard)\.spec\.mjs/,
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
    // A green gate must belong to this checkout's freshly built renderer.
    // Reusing an unrelated local server can silently validate stale code.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
