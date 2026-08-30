import assert from "node:assert/strict";
import test from "node:test";

import {
  EDIT_RUNTIME_CSP,
  baseHrefFromSourcePath,
  disableExecutableMarkup,
} from "../app/components/html-preview-sandbox.js";

test("Edit runtime CSP keeps workers outside the admitted program closure", () => {
  assert.match(EDIT_RUNTIME_CSP, /worker-src 'none'/u);
  assert.doesNotMatch(EDIT_RUNTIME_CSP, /worker-src[^;]*blob:/u);
});

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
