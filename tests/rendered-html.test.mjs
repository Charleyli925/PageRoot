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
    "写评论后再发送",
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
  assert.match(modeFrame, /width:\s*172px/u);
  assert.match(modeFrame, /height:\s*40px/u);
  assert.match(modeFrame, /padding:\s*3px/u);
  assert.match(modeFrame, /border:\s*1px solid rgb\(46 43 58 \/ 7\.5%\)/u);
  assert.match(modeFrame, /background:\s*transparent/u);

  const selectedLayer = lastCssRule(css, ".canvas-mode-switch::before");
  assert.match(selectedLayer, /top:\s*2px/u);
  assert.match(selectedLayer, /width:\s*82px/u);
  assert.match(selectedLayer, /height:\s*34px/u);
  assert.match(selectedLayer, /background:\s*rgb\(91 82 219 \/ 7\.5%\)/u);
  assert.doesNotMatch(selectedLayer, /backdrop-filter|box-shadow|(?:^|\n)\s*border:/u);

  const hiddenGlobalComment = lastCssRule(
    css,
    ".header-actions > .global-comment-button",
  );
  assert.match(hiddenGlobalComment, /display:\s*none/u);

  const sendButton = lastCssRule(css, ".header-actions .header-send-button");
  assert.match(sendButton, /height:\s*40px/u);
  assert.match(sendButton, /margin-left:\s*12px/u);
  assert.match(sendButton, /box-shadow:\s*0 2px 6px rgb\(65 57 166 \/ 14%\)/u);
});
