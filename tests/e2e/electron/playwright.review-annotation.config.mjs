import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import aiConfig from "./playwright.ai-closed-loop.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const artifactRoot = path.join(productRoot, "output/playwright/review-annotation");

export default defineConfig({
  ...aiConfig,
  testMatch: /review-annotation-clarity\.spec\.mjs/,
  grep: undefined,
  outputDir: path.join(artifactRoot, "results"),
  timeout: 240_000,
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(artifactRoot, "report"),
    }],
  ],
});
