import assert from "node:assert/strict";
import test from "node:test";

import {
  baseHrefFromSourcePath,
  disableExecutableMarkup,
  previewSessionBaseUrl,
  resolvePreviewBaseHref,
} from "../app/components/html-preview-sandbox.js";

test("preview sandbox disables scripts without losing authored type metadata", () => {
  const disabled = disableExecutableMarkup(
    '<script type="module" data-x="1">run()</script><script>run2()</script>',
  );
  assert.doesNotMatch(disabled, /<script type="module"/);
  assert.match(disabled, /type="application\/x-html-canvas-disabled"/);
  assert.match(disabled, /data-html-canvas-original-script-type="module"/);
  assert.match(
    disabled,
    /data-html-canvas-original-script-type="__html_canvas_missing__"/,
  );
});

test("preview sandbox derives an encoded directory base without query state", () => {
  assert.equal(
    baseHrefFromSourcePath("/Users/example/My Page/index.html"),
    "file:///Users/example/My%20Page/",
  );
  assert.equal(
    baseHrefFromSourcePath("https://example.com/a/page.html?q=1#x"),
    "https://example.com/a/",
  );
  assert.equal(baseHrefFromSourcePath("relative/page.html"), undefined);
});

test("desktop preview sessions expose a stable same-session asset root", () => {
  assert.equal(
    previewSessionBaseUrl("pageroot-preview://0123456789abcdef0123456789abcdef/index.html?reload=2#top"),
    "pageroot-preview://0123456789abcdef0123456789abcdef/",
  );
  assert.equal(
    resolvePreviewBaseHref("assets/", "pageroot-preview://0123456789abcdef0123456789abcdef/"),
    "pageroot-preview://0123456789abcdef0123456789abcdef/assets/",
  );
  assert.equal(
    resolvePreviewBaseHref("", "pageroot-preview://0123456789abcdef0123456789abcdef/"),
    "pageroot-preview://0123456789abcdef0123456789abcdef/",
  );
  assert.equal(
    resolvePreviewBaseHref("file:///tmp/outside/", "pageroot-preview://0123456789abcdef0123456789abcdef/"),
    "pageroot-preview://0123456789abcdef0123456789abcdef/",
  );
  assert.equal(
    resolvePreviewBaseHref(
      "pageroot-preview://ffffffffffffffffffffffffffffffff/assets/",
      "pageroot-preview://0123456789abcdef0123456789abcdef/",
    ),
    "pageroot-preview://0123456789abcdef0123456789abcdef/",
  );
});
