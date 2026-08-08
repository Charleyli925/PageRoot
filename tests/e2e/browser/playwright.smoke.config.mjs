import { defineConfig } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

import browserConfig from "./playwright.config.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const productRoot = path.resolve(currentDirectory, "../../..");

const smokeTitles = [
  "pure browser use stays in a formal read-only preview",
  "the edit iframe is same-origin but never executes author scripts or refresh",
  "edit mode reveals semantic source content without running authored actions or changing bytes",
  "source reversal shortcuts are blocked and never change committed bytes",
  "one text edit changes only the authorized UTF-8 bytes, including BOM and CRLF",
  "visible empty inline boundary stays structurally intact while surrounding text remains editable",
  "mixed block parents fall back to safe inline hosts and exact bare-text fragments",
  "bare-text fragments persist toolbar and shortcut formatting through guarded source patches",
  "deleting a bare-text fragment ends its session without a blocked resume",
  "IME confirmation replays at the frozen left-style caret",
  "out-of-band mutation restores the last safe draft and reports in the viewport",
  "one unsaved comment blocks a second target and Canvas selection keeps its scroll",
  "indexed script tabs keep hidden comments grouped, suppress ghost markers, and shrink the canvas",
  "path-only review comments bind against a real parsed DOM",
  "path-only review comments fail closed when the parsed path and tag diverge",
  "path-only review comments fail closed when a same-tag parser decoy shifts the target",
  "path-only review comments keep a bound target when a later same-tag node is unrelated",
  "fingerprintless runtime hosts fail closed when a same-tag parser decoy shifts the target",
  "identical fingerprintless runtime siblings keep their separate frozen paths",
  "identical path-only comment siblings keep their separate frozen paths",
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
