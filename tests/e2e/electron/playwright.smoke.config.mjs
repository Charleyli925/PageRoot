import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electronConfig from "./playwright.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  ...electronConfig,
  grep: /Electron first launch registers the welcome HTML and sends its comment to Qoder|Electron safely renames the saved current HTML without starting a new project|Electron interactive preview runs authored scripts and edits the selected Tab|Electron edit mode reveals safe semantic content without changing disk bytes|Electron uses the authored DOM caret, Selection and controlled beforeinput|Electron persists an Apple Pinyin boundary composition with left affinity|Electron persists text, style, structure, and reorder undo while focused fields stay native|Electron restores the active text selection and keeps comment anchors stable through source undo|Electron native field undo consumes a live composition without leaving interim pinyin|Electron keeps declared Edit charts source-backed through Tabs, comments, IME, and Canvas renewal/u,
  outputDir: path.join(productRoot, "output/playwright/native-dom-electron-smoke/results"),
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/native-dom-electron-smoke/report"),
    }],
  ],
});
