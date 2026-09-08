import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import aiConfig from "./playwright.ai-closed-loop.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const smokeId = process.env.PAGEROOT_SMOKE_SUITE || "ai-smoke";

export default defineConfig({
  ...aiConfig,
  // A changed on-demand Review spec must be discoverable by the selected gate.
  testMatch: [aiConfig.testMatch, /review-annotation-clarity\.spec\.mjs/],
  outputDir: path.join(productRoot, "output/playwright", smokeId, "results"),
  reporter: [
    ["list"],
    ["json", {
      outputFile: path.join(productRoot, "output/playwright", smokeId, "results.json"),
    }],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright", smokeId, "report"),
    }],
  ],
});
