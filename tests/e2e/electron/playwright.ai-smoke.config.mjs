import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import aiConfig from "./playwright.ai-closed-loop.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const smokeId = process.env.PAGEROOT_SMOKE_SUITE || "ai-smoke";

export default defineConfig({
  ...aiConfig,
  outputDir: path.join(productRoot, "output/playwright", smokeId, "results"),
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright", smokeId, "report"),
    }],
  ],
});
