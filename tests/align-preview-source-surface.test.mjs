import assert from "node:assert/strict";
import test from "node:test";

import { alignPreviewSourceSurface } from "../app/lib/align-preview-source-surface.js";
import { buildSourceIndex } from "../app/lib/source-index.js";

function element(tagName, descendants = []) {
  return {
    tagName: tagName.toUpperCase(),
    contains(other) {
      return descendants.includes(other)
        || descendants.some((descendant) => descendant.contains(other));
    },
  };
}

function preorder(nodes) {
  return nodes;
}

test("alignPreviewSourceSurface maps island leaves past unmapped source descendants", () => {
  const sourceIndex = buildSourceIndex(
    "<!doctype html><html><body><p>hi<br>there</p><p>next</p></body></html>",
  );
  const firstParagraph = element("p");
  const secondParagraph = element("p");
  const body = element("body", [firstParagraph, secondParagraph]);
  const html = element("html", [body, firstParagraph, secondParagraph]);
  const aligned = alignPreviewSourceSurface(
    sourceIndex,
    preorder([html, body, firstParagraph, secondParagraph]),
  );
  assert.ok(aligned);
  assert.equal(aligned.length, 4);
  assert.deepEqual(
    aligned.map((entry) => sourceIndex.byNodeId.get(entry.nodeId).tagName),
    ["html", "body", "p", "p"],
  );
  assert.equal(
    sourceIndex.elements.some((entry) => entry.tagName === "br"),
    true,
  );
});

test("alignPreviewSourceSurface keeps equal-length wrapper spans in document order", () => {
  const sourceIndex = buildSourceIndex(
    "<!doctype html><html><body><div>a<span>b</span>c</div></body></html>",
  );
  const span = element("span");
  const div = element("div", [span]);
  const body = element("body", [div, span]);
  const html = element("html", [body, div, span]);
  const aligned = alignPreviewSourceSurface(
    sourceIndex,
    preorder([html, body, div, span]),
  );
  assert.ok(aligned);
  assert.deepEqual(
    aligned.map((entry) => sourceIndex.byNodeId.get(entry.nodeId).tagName),
    ["html", "body", "div", "span"],
  );
});

test("alignPreviewSourceSurface rejects leftover source elements and tag drift", () => {
  const sourceIndex = buildSourceIndex(
    "<!doctype html><html><body><p>hi<br>there</p><p>next</p></body></html>",
  );
  const firstParagraph = element("p");
  const body = element("body", [firstParagraph]);
  const html = element("html", [body, firstParagraph]);
  assert.equal(
    alignPreviewSourceSurface(sourceIndex, [html, body, firstParagraph]),
    null,
  );
  const decoy = element("span");
  const decoyBody = element("body", [decoy]);
  const decoyHtml = element("html", [decoyBody, decoy]);
  assert.equal(
    alignPreviewSourceSurface(sourceIndex, [decoyHtml, decoyBody, decoy]),
    null,
  );
});
