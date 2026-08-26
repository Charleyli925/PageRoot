import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electronConfig from "./playwright.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");
const smokeId = process.env.PAGEROOT_SMOKE_SUITE || "electron-smoke";

export default defineConfig({
  ...electronConfig,
  outputDir: path.join(productRoot, "output/playwright", smokeId, "results"),
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright", smokeId, "report"),
    }],
  ],
});
