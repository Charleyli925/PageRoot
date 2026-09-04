import assert from "node:assert/strict";
import test from "node:test";

import {
  firstEndTag,
  hasCompleteDocumentStructure,
  metaContentByName,
  parseHtmlSource,
  rawStartTagAttributes,
} from "../bridge/html-source-parser.mjs";

test("document identity comes only from a real explicit head meta", () => {
  const html = `<!doctype html>
<html>
<head>
  <script>const fake = '<meta name="html-ai-document-id" content="doc_aaaaaaaaaaaaaaaa">';</script>
  <!-- <meta name="html-ai-document-id" content="doc_bbbbbbbbbbbbbbbb"> -->
  <template><meta name="html-ai-document-id" content="doc_cccccccccccccccc"></template>
  <meta name="html-ai-document-id" content="doc_0123456789abcdef">
</head>
<body>
  <meta name="html-ai-document-id" content="doc_dddddddddddddddd">
</body>
</html>`;
  assert.equal(
    metaContentByName(html, "html-ai-document-id"),
    "doc_0123456789abcdef",
  );
  assert.equal(firstEndTag(html, "head")?.start, html.lastIndexOf("</head>"));
  assert.equal(hasCompleteDocumentStructure(html), true);
});

test("parser-added implicit structure never passes the complete-document gate", () => {
  const fragment = "<title>隐式 head</title><main>fragment</main>";
  assert.ok(parseHtmlSource(fragment).document);
  assert.equal(hasCompleteDocumentStructure(fragment), false);
  assert.equal(metaContentByName(fragment, "html-ai-document-id"), null);
  assert.equal(
    hasCompleteDocumentStructure(
      `<!doctype svg><html><head><script>const fake = "<!doctype html>";</script></head><body></body></html>`,
    ),
    false,
  );
  assert.equal(
    hasCompleteDocumentStructure(
      `<html><head><script>const fake = "<!doctype html>";</script></head><body></body></html>`,
    ),
    false,
  );
});

test("parse5 fostered metadata outside the explicit head cannot become identity", () => {
  const afterHead = `<!doctype html>
<html>
<head><title>显式 head 已结束</title></head>
<meta name="html-ai-document-id" content="doc_0123456789abcdef">
<body><main>内容</main></body>
</html>`;
  assert.equal(hasCompleteDocumentStructure(afterHead), true);
  assert.equal(metaContentByName(afterHead, "html-ai-document-id"), null);
});

test("raw start-tag attributes keep authored duplicates instead of parse5 last-wins", () => {
  const html = `<div class="a" id="x" class="b">text</div>`;
  const parsed = parseHtmlSource(html);
  const div = parsed.elements.find((token) => token.name === "div");
  const raw = rawStartTagAttributes(
    parsed.source,
    div.node.sourceCodeLocation.startTag,
  );
  assert.deepEqual(
    raw.map((attribute) => [attribute.name, attribute.value]),
    [
      ["class", "a"],
      ["id", "x"],
      ["class", "b"],
    ],
  );
  assert.deepEqual(
    raw.map((attribute) => ({
      rawName: attribute.rawName,
      raw: attribute.raw,
      quote: attribute.quote,
      range: html.slice(attribute.range.startOffset, attribute.range.endOffset),
      valueRange: html.slice(
        attribute.valueRange.startOffset,
        attribute.valueRange.endOffset,
      ),
    })),
    [
      { rawName: "class", raw: 'class="a"', quote: '"', range: 'class="a"', valueRange: "a" },
      { rawName: "id", raw: 'id="x"', quote: '"', range: 'id="x"', valueRange: "x" },
      { rawName: "class", raw: 'class="b"', quote: '"', range: 'class="b"', valueRange: "b" },
    ],
  );
});

test("raw unquoted attributes stop before a source self-closing delimiter", () => {
  const html = `<svg><circle style=color:blue data-kind=dot/></svg>`;
  const parsed = parseHtmlSource(html);
  const circle = parsed.elements.find((token) => token.name === "circle");
  const attributes = rawStartTagAttributes(
    parsed.source,
    circle.node.sourceCodeLocation.startTag,
  );
  assert.deepEqual(
    attributes.map((attribute) => [
      attribute.name,
      attribute.rawValue,
      html.slice(attribute.range.startOffset, attribute.range.endOffset),
    ]),
    [
      ["style", "color:blue", "style=color:blue"],
      ["data-kind", "dot", "data-kind=dot"],
    ],
  );
});

test("a leading UTF-8 BOM still locates explicit html, head and body start tags", () => {
  const payload = "<!doctype html>\r\n<html lang='zh'><head></head><body><p>字</p></body></html>";
  const source = `\uFEFF${payload}`;
  const parsed = parseHtmlSource(source);
  for (const tagName of ["html", "head", "body"]) {
    const token = parsed.elements.find((element) => element.name === tagName);
    assert.ok(token?.start >= 0, tagName);
    assert.equal(source[token.start], "<");
    assert.equal(
      source.slice(token.start, token.start + tagName.length + 1),
      `<${tagName}`,
    );
    assert.equal(source.slice(token.start, token.end).endsWith(">"), true);
  }
});
