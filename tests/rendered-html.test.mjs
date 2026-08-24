import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

function lastCssRule(css, selector) {
  const marker = `${selector} {`;
  const start = css.lastIndexOf(marker);
  assert.notEqual(start, -1, `missing CSS rule: ${selector}`);
  const end = css.indexOf("}", start);
  assert.notEqual(end, -1, `unterminated CSS rule: ${selector}`);
  return css.slice(start, end + 1);
}

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(new URL(pathname, "http://localhost"), {
      headers: { accept: "text/html" },
    }),
    {
      ASSETS: {
        fetch: async () => new Response("Not found", { status: 404 }),
      },
    },
    {
      waitUntil() {},
      passThroughOnException() {},
    },
  );
}

test("server-renders the public workbench without retired hosting or editor surfaces", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/iu);

  const html = await response.text();
  assert.match(html, /<title>源页<\/title>/iu);
  assert.match(
    html,
    /<link[^>]+rel=["']icon["'][^>]+href=["']\/favicon\.png["'][^>]*>/iu,
  );
  assert.match(
    html,
    /<meta[^>]+property=["']og:image["'][^>]+content=["'][^"']*\/brand-logo\.png["'][^>]*>/iu,
  );
  assert.match(
    html,
    /<meta[^>]+name=["']twitter:card["'][^>]+content=["']summary_large_image["'][^>]*>/iu,
  );
  await access(new URL("../public/favicon.png", import.meta.url));
  await access(new URL("../public/brand-logo.png", import.meta.url));
  await access(new URL("../public/qoder-logo.png", import.meta.url));

  for (const entryPoint of [
    "编辑",
    "预览",
    "项目",
    "全局评论",
    // The header opens the conversation and no longer narrates the round, so its label
    // is fixed rather than describing what is missing before a send.
    "AI 助手",
    "评论会显示在这里",
  ]) {
    assert.match(html, new RegExp(entryPoint, "u"));
  }
  assert.match(html, /\saria-label=["'][^"']+["']/iu);
  assert.doesNotMatch(
    html,
    /codex-preview|_sites-preview|react-loading-skeleton|data-lexical-editor|pageroot-text-editor/iu,
  );
});

test("top toolbar keeps the approved restrained visual contract", async () => {
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

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
  const css = await readFile(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );

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

test("the anchored open-HTML popover keeps click-outside dismissal reachable", async () => {
  const css = await readFile(
    new URL("../app/workbench/open-html-dialog.module.css", import.meta.url),
    "utf8",
  );

  const backdrop = lastCssRule(css, ".backdrop");
  assert.match(backdrop, /inset:\s*0/u);
  // The dismiss area covers the draggable title bar the popover hangs from.
  // Without no-drag macOS keeps handling those clicks as a window drag and the
  // click-outside dismissal never reaches the DOM.
  assert.match(backdrop, /-webkit-app-region:\s*no-drag/u);
});
