import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import browserConfig from "./playwright.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

const smokeTitles = [
  "pure browser use stays in a formal read-only preview",
  "the edit iframe is same-origin but never executes author scripts or refresh",
  "plain insertion undo restores the transaction-start caret and redo restores the after caret",
  "nested bold, italic, color, size, span attributes and outside bytes survive an internal edit",
  "one text edit changes only the authorized UTF-8 bytes, including BOM and CRLF",
  "visible empty inline boundary stays selectable/commentable and never becomes editable",
];
const escapedTitles = smokeTitles.map((title) => title.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"));

export default defineConfig({
  ...browserConfig,
  grep: new RegExp(escapedTitles.join("|"), "u"),
  outputDir: path.join(productRoot, "output/playwright/native-dom-browser-smoke/results"),
  reporter: [
    ["list"],
    ["html", {
      open: "never",
      outputFolder: path.join(productRoot, "output/playwright/native-dom-browser-smoke/report"),
    }],
  ],
});
