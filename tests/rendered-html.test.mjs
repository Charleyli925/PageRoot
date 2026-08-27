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
    // The header opens the conversation and no longer narrates the round, so its label
    // is fixed rather than describing what is missing before a send.
    "AI 助手",
  ]) {
    assert.match(html, new RegExp(entryPoint, "u"));
  }
  // CommentRailContainer owns a client-only controller capability. Its local
  // snapshot and presentation state intentionally do not render from the
  // server-side Workbench shell.
  assert.doesNotMatch(html, /全局评论|评论会显示在这里/u);
  assert.match(html, /\saria-label=["'][^"']+["']/iu);
  assert.doesNotMatch(
    html,
    /codex-preview|_sites-preview|react-loading-skeleton|data-lexical-editor|pageroot-text-editor/iu,
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
