import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import browserConfig from "./playwright.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

const smokeTitles = [
  "pure browser use stays in a formal read-only preview",
  "the edit iframe is same-origin but never executes author scripts or refresh",
  "clicking outside the editor surface dismisses its selection and toolbar",
  "review evidence, table pairing, and historical comment pins stay truthful",
  "edit mode reveals semantic source content without running authored actions or changing bytes",
  "source reversal shortcuts are blocked and never change committed bytes",
  "one text edit changes only the authorized UTF-8 bytes, including BOM and CRLF",
  "visible empty inline boundary stays structurally intact while surrounding text remains editable",
  "IME confirmation replays at the frozen left-style caret",
  "out-of-band mutation restores the last safe draft and reports in the viewport",
  "one unsaved comment blocks a second target and Canvas selection keeps its scroll",
  "indexed script tabs keep hidden comments grouped, suppress ghost markers, and shrink the canvas",
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
