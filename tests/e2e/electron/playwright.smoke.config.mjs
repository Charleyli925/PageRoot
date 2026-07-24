import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electronConfig from "./playwright.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  ...electronConfig,
  grep: /Electron first launch registers the welcome HTML and sends its comment to Qoder|Electron uses the authored DOM caret, Selection and beforeinput|Electron canonicalizes and persists an Apple Pinyin styled-wrapper composition/u,
  outputDir: path.join(productRoot, "output/playwright/native-dom-electron-smoke/results"),
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/native-dom-electron-smoke/report"),
    }],
  ],
});
