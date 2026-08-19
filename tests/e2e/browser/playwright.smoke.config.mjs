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
  "clicking a filled module's padding selects that module",
  "hovering a filled module's padding advertises the same module click selects",
  "text-edit hover caption hugs its copy instead of a fixed ribbon",
  "text-edit hover caption stays at the right canvas edge",
  "text-edit hover caption stays inside a narrow canvas",
  "clicking a canvas selects the dedicated surface instead of the wrapping module",
  "double-clicking a canvas reports the dedicated root and stays comment-only",
  "first double-click places a caret; a second double-click selects the word",
  "IME confirmation replays at the frozen left-style caret",
  "layout fingerprint CSS no longer blocks native edit entry",
  "style-boundary and empty-inline place a caret instead of refusing",
  "canvas text mismatch remounts from source then enters",
  "complex parent prefers an exact text-fragment instead of comment-only",
  "unauthorized island mutation still rolls back after fail-open entry",
  "fail-open entry still writes only the selected island bytes",
  "a repeated header command waits for composition and replays only once",
  "out-of-band mutation restores the last safe draft and reports in the viewport",
  "one unsaved comment blocks a second target and Canvas selection keeps its scroll",
  "indexed script tabs keep hidden comments grouped, suppress ghost markers, and shrink the canvas",
  "path-only review comments bind against a real parsed DOM",
  "source-backed comment IDs survive an authored RegExp exec mutation",
  "review comment keys survive an authored String replace mutation",
  "path-only review comments fail closed when the parsed path and tag diverge",
  "path-only review comments fail closed when a same-tag parser decoy shifts the target",
  "path-only review comments keep a bound target when a later same-tag node is unrelated",
  "identical path-only comment siblings keep their separate frozen paths",
  "mixed-shape path-only comment decoys fail closed",
  "runtime projection binds exact hosts and adds facts without outline geometry",
  "hostile authored listeners cannot observe or forge runtime projection capability",
  "comment and runtime bindings keep separate ports in the same first bootstrap",
  "empty runtime projection preserves static facts",
  "cross-session side and source runtime results preserve static facts",
  "parser-time target replacement fails closed without rebinding",
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
