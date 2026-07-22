import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const artifactRoot = path.join(
  productRoot,
  "output/playwright/ai-closed-loop",
  "deterministic",
);

export default defineConfig({
  testDir: currentDirectory,
  testMatch: /ai-handoff-closed-loop\.spec\.mjs/,
  outputDir: path.join(artifactRoot, "results"),
  workers: 1,
  retries: 0,
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(artifactRoot, "report"),
    }],
  ],
  timeout: 90_000,
  expect: { timeout: 20_000 },
  use: {
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
