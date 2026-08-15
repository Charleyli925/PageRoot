import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electronConfig from "./playwright.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

export default defineConfig({
  ...electronConfig,
  grep: /Electron first launch imports the welcome HTML as V1 and sends its comment to Qoder|Electron safely renames the managed V1 without starting a new project|Electron keeps runtime visuals in Preview and source-backed static content in Edit|Electron Edit preserves imported source-relative ECharts assets and native source editing|Electron Edit keeps frozen one-shot iframe through structural line-break and sibling reorder|Electron Edit rejects unsafe ECharts host styling without persisting it|Electron edit mode reveals safe semantic content without changing disk bytes|Electron edit Canvas keeps root scrolling in the shared stage across a scrollbar threshold|Electron uses the authored DOM caret, Selection and controlled beforeinput|Electron persists an Apple Pinyin boundary composition with left affinity|Electron keeps V1 autosave separate from focused-field undo|Electron keeps the active text selection and comment anchors stable after V1 autosave|Electron native field undo consumes a live composition without leaving interim pinyin/u,
  outputDir: path.join(productRoot, "output/playwright/native-dom-electron-smoke/results"),
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/native-dom-electron-smoke/report"),
    }],
  ],
});
