import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

function lastCssRule(css, selector) {
  const marker = `${selector} {`;
  const start = css.lastIndexOf(marker);
  assert.notEqual(start, -1, `missing CSS rule: ${selector}`);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS rule: ${selector}`);
  return css.slice(start, end + 1);
}

async function readWorkbenchCascadeCss() {
  const entryUrl = new URL("../app/globals.css", import.meta.url);
  const entry = await readFile(entryUrl, "utf8");
  const imports = [...entry.matchAll(/@import\s+"(\.\/styles\/[^"]+\.css)";/gu)]
    .map((match) => match[1]);
  assert.deepEqual(imports, [
    "./styles/tokens-and-base.css",
    "./styles/browser-workbench-shell.css",
    "./styles/workbench-shell.css",
    "./styles/review-v5.css",
    "./styles/review-v51.css",
    "./styles/review-v52-canvas.css",
    "./styles/comment-hierarchy.css",
    "./styles/project-resources.css",
    "./styles/about-and-chrome.css",
    "./styles/top-toolbar.css",
    "./styles/browser-workbench-ownership.css",
  ]);
  assert.equal(entry.trim(), imports.map((file) => `@import "${file}";`).join("\n"));
  const parts = await Promise.all(imports.map((file) => (
    readFile(new URL(file, entryUrl), "utf8")
  )));
  return parts.join("");
}

test("top toolbar keeps the approved restrained visual contract", async () => {
  const css = await readWorkbenchCascadeCss();

  const header = lastCssRule(css, ".workbench-header");
  assert.match(header, /background:\s*rgb\(253 252 249 \/ 92%\)/u);
  assert.match(header, /box-shadow:\s*none/u);
  assert.match(header, /backdrop-filter:\s*blur\(18px\) saturate\(116%\)/u);

  const modeFrame = lastCssRule(css, ".canvas-mode-switch");
  assert.match(modeFrame, /width:\s*147px/u);
  assert.match(modeFrame, /height:\s*34px/u);
  assert.match(modeFrame, /padding:\s*2\.5px/u);
  assert.match(modeFrame, /border:\s*1px solid rgb\(46 43 58 \/ 7\.5%\)/u);
  assert.match(modeFrame, /background:\s*transparent/u);

  const selectedLayer = lastCssRule(css, ".canvas-mode-switch::before");
  assert.match(selectedLayer, /top:\s*1\.5px/u);
  assert.match(selectedLayer, /width:\s*70px/u);
  assert.match(selectedLayer, /height:\s*29px/u);
  assert.match(selectedLayer, /background:\s*rgb\(91 82 219 \/ 7\.5%\)/u);
  assert.doesNotMatch(selectedLayer, /backdrop-filter|box-shadow|(?:^|\n)\s*border:/u);

  const sendButton = lastCssRule(css, ".header-actions .header-send-button");
  assert.match(sendButton, /height:\s*34px/u);
  assert.match(sendButton, /margin-left:\s*10px/u);
  assert.match(sendButton, /box-shadow:\s*0 2px 5px rgb\(65 57 166 \/ 14%\)/u);
});

test("a hover tooltip stays pointer-scoped and yields to the surface it opened", async () => {
  const css = await readWorkbenchCascadeCss();

  // Chromium leaves a clicked button focused. Revealing the bubble on any focus
  // state (:focus, or :focus-within which also matches the element itself)
  // pins it on screen long after the pointer left.
  assert.match(
    css,
    /\[data-tooltip\]:hover::after,\n\[data-tooltip\]:focus-visible::after \{/u,
  );
  assert.doesNotMatch(css, /\[data-tooltip\][^\n{,]*:focus-within::after/u);
  assert.doesNotMatch(css, /\[data-tooltip\][^\n{,]*:focus::after/u);

  const openedTrigger = lastCssRule(css, '[data-tooltip][aria-expanded="true"]::after');
  assert.match(openedTrigger, /opacity:\s*0/u);
  assert.match(openedTrigger, /visibility:\s*hidden/u);
  // The reveal rules carry the same specificity, so only source order keeps the
  // suppression in force while the trigger's own surface is open.
  assert.ok(
    css.lastIndexOf('[data-tooltip][aria-expanded="true"]::after')
      > css.lastIndexOf("[data-tooltip]:focus-visible::after"),
    "the opened-trigger suppression must follow every tooltip reveal rule",
  );
});
