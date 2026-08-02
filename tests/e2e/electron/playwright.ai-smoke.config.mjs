import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import aiConfig from "./playwright.ai-closed-loop.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  ...aiConfig,
  grep: /a verified AI result stays pending through desktop review until the user accepts it|a broad but related AI return is accepted without a target-scope error/u,
  outputDir: path.join(productRoot, "output/playwright/ai-closed-loop-smoke/results"),
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/ai-closed-loop-smoke/report"),
    }],
  ],
});
