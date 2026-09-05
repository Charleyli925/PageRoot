import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { playwrightRetries } from "../../../scripts/playwright-retry-policy.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const artifactRoot = path.join(
  productRoot,
  "output/playwright/ai-closed-loop",
  "deterministic",
);

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /ai-(?:review-adoption|provider-availability|run-lifecycle|candidate-validation|request-comments)\.spec\.mjs/,
  outputDir: path.join(artifactRoot, "results"),
  workers: 1,
  // AI closed-loop assertions are product contracts: Candidate promotion,
  // Review and adoption must not retry. The hosted-window preflight absorbs
  // one environment stall before this suite starts.
  retries: playwrightRetries(),
  reporter: [
    ["list"],
    ["json", {
      outputFile: path.join(artifactRoot, "results.json"),
    }],
    ["html", {
      open: "never",
      outputFolder: path.join(artifactRoot, "report"),
    }],
  ],
  timeout: 180_000,
  expect: { timeout: 20_000 },
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
