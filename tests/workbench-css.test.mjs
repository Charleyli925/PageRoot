import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { deriveWorkbenchInspector } from "../app/workbench/inspector-presentation.js";

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
    "./styles/workbench-shell.css",
    "./styles/workbench-tabs.css",
    "./styles/review-v5.css",
    "./styles/review-v51.css",
    "./styles/review-v52-canvas.css",
    "./styles/comment-hierarchy.css",
    "./styles/project-resources.css",
    "./styles/about-and-chrome.css",
    "./styles/top-toolbar.css",
    "./styles/workbench-chrome.css",
  ]);
  assert.equal(entry.trim(), imports.map((file) => `@import "${file}";`).join("\n"));
  const parts = await Promise.all(imports.map((file) => (
    readFile(new URL(file, entryUrl), "utf8")
  )));
  return parts.join("");
}

test("top toolbar keeps one compact cross-mode visual contract", async () => {
  const css = await readWorkbenchCascadeCss();

  const header = lastCssRule(css, ".workbench > .workbench-header");
  assert.match(header, /grid-template-columns:\s*minmax\(0, 1fr\)/u);
  assert.match(header, /background:\s*var\(--chrome-toolbar-surface\)/u);
  assert.match(
    css,
    /\.workbench > \.workbench-tabbar,\n\.workbench > \.workbench-header \{[\s\S]*?backdrop-filter:\s*blur\(22px\)/u,
  );

  const modeFrame = lastCssRule(css, ".canvas-mode-switch");
  assert.match(modeFrame, /width:\s*180px/u);
  assert.match(modeFrame, /height:\s*34px/u);
  assert.match(modeFrame, /grid-template-columns:\s*repeat\(3, 1fr\)/u);
  assert.match(modeFrame, /padding:\s*2px/u);
  assert.match(modeFrame, /border-color:\s*var\(--chrome-divider\)/u);

  const selectedLayer = lastCssRule(css, ".canvas-mode-switch::before");
  assert.match(selectedLayer, /display:\s*none/u);

  const sendButton = css.match(
    /\.header-actions \.header-send-button,\n\.workbench-review-tools-slot > \.header-send-button \{[\s\S]*?\}/u,
  );
  assert.ok(sendButton, "missing shared send/review decision button rule");
  assert.match(sendButton[0], /height:\s*32px/u);
  assert.match(sendButton[0], /margin:\s*0/u);
  assert.match(sendButton[0], /box-shadow:\s*0 2px 5px rgb\(65 57 166 \/ 13%\)/u);
});

test("global sidebar owns the full shell column and start page has no card surface", async () => {
  const css = await readWorkbenchCascadeCss();

  assert.match(
    css,
    /\.workbench\[data-left-sidebar="open"\] \{\s*--workbench-sidebar-width:\s*264px/u,
  );
  assert.match(css, /--chrome-sidebar-surface:\s*rgb\(239 239 243 \/ 72%\)/u);
  assert.match(css, /\.workbench-toolbar-primary,\n\.workbench-toolbar-center,\n\.workbench-toolbar-actions \{/u);
  assert.match(css, /grid-template-columns:\s*180px minmax\(0, 1fr\) auto/u);
  assert.match(css, /\.workbench-resizer\s*\{[\s\S]*?-webkit-app-region:\s*no-drag/u);
  assert.match(css, /\.workbench-sidebar-titlebar\s*\{[\s\S]*?border-bottom:\s*0/u);
  assert.match(css, /\.workbench-tooltip-overlay\s*\{[\s\S]*?position:\s*fixed/u);
  const sidebar = lastCssRule(css, ".workbench-global-sidebar");
  const shell = lastCssRule(css, ".workbench > .workbench-global-sidebar");
  assert.match(shell, /grid-column:\s*1/u);
  assert.match(shell, /grid-row:\s*1 \/ 4/u);
  assert.doesNotMatch(sidebar, /position:\s*fixed/u);

  const startContent = lastCssRule(css, ".workbench-start-content");
  assert.match(startContent, /width:\s*min\(520px, 100%\)/u);
  assert.doesNotMatch(startContent, /border|box-shadow|background/u);
});

test("embedded review stays in the content row instead of covering the header", async () => {
  const css = await readWorkbenchCascadeCss();
  const stage = css.match(/\.workbench > \.review-scroll-stage \{[\s\S]*?\}/u);
  assert.ok(stage, "missing .workbench > .review-scroll-stage rule");
  assert.match(stage[0], /position:\s*relative/u);
  assert.doesNotMatch(stage[0], /overflow:\s*hidden/u);

  const header = lastCssRule(css, ".workbench-header");
  assert.doesNotMatch(header, /z-index:\s*80/u);
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

test("the shell owns the outer grid and one fixed inspector contract", async () => {
  const stylesUrl = new URL("../app/styles/", import.meta.url);
  const [tokens, shell, tabs, reviewV5, reviewV51, reviewModule, noticeBar, workbench] =
    await Promise.all([
      readFile(new URL("tokens-and-base.css", stylesUrl), "utf8"),
      readFile(new URL("workbench-shell.css", stylesUrl), "utf8"),
      readFile(new URL("workbench-tabs.css", stylesUrl), "utf8"),
      readFile(new URL("review-v5.css", stylesUrl), "utf8"),
      readFile(new URL("review-v51.css", stylesUrl), "utf8"),
      readFile(new URL("../app/workbench/ai-review-workspace.module.css", import.meta.url), "utf8"),
      readFile(new URL("../app/components/NoticeBar.module.css", import.meta.url), "utf8"),
      readFile(new URL("../app/workbench.tsx", import.meta.url), "utf8"),
    ]);
  const outerGridRule = /\.workbench(?:\[[^\]]+\])?\s*\{[^}]*grid-template-(?:columns|rows)/u;

  assert.match(shell, /--workbench-inspector-width:\s*376px/u);
  assert.match(
    shell,
    /grid-template-columns:\s*var\(--workbench-sidebar-width\)\s+minmax\(0, 1fr\)/u,
  );
  assert.match(
    shell,
    /\.workbench > \.workbench-header\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 250px\)\s+minmax\(0, 1fr\)/u,
  );
  assert.match(
    shell,
    /\.workbench > \.workbench-header > \.header-actions\s*\{[\s\S]*?justify-self:\s*stretch/u,
  );
  assert.match(
    shell,
    /\.workbench > \.review-scroll-stage\[data-inspector="comments"\][\s\S]*?var\(--workbench-inspector-width\)/u,
  );
  assert.match(
    shell,
    /\.workbench > \.review-scroll-stage\[data-inspector="ai"\][\s\S]*?position: absolute/u,
  );
  assert.doesNotMatch(tokens, outerGridRule);
  assert.doesNotMatch(tabs, outerGridRule);
  assert.doesNotMatch(reviewV5, outerGridRule);
  assert.doesNotMatch(reviewV51, outerGridRule);
  assert.doesNotMatch(tabs, /--workbench-sidebar-width:\s*240px/u);
  assert.doesNotMatch(reviewModule, /:has\(/u);
  assert.doesNotMatch(noticeBar, /--notice-rail-width/u);
  assert.match(noticeBar, /--workbench-inspector-width/u);
  assert.equal((workbench.match(/data-inspector=\{workbenchInspector\}/gu) || []).length, 1);

  assert.equal(deriveWorkbenchInspector({
    canvasMode: "edit",
    commentsAvailable: true,
  }), "comments");
  assert.equal(deriveWorkbenchInspector({
    canvasMode: "preview",
    aiVisible: true,
  }), "ai");
  assert.equal(deriveWorkbenchInspector({
    canvasMode: "preview",
    aiVisible: true,
    reviewVisible: true,
  }), "review");
  assert.equal(deriveWorkbenchInspector({
    canvasMode: "edit",
    commentsAvailable: false,
  }), "none");
});
