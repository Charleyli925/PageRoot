import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import test from "node:test";

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
    "复制AI任务Prompt",
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
