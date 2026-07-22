import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import aiConfig from "./playwright.ai-closed-loop.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  ...aiConfig,
  grep: /a verified AI result stays pending until the user opens the new HTML|a soft out-of-scope AI return waits for an explicit waiver and open/u,
  outputDir: path.join(productRoot, "output/playwright/ai-closed-loop-smoke/results"),
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/ai-closed-loop-smoke/report"),
    }],
  ],
});
