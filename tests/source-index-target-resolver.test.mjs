import assert from "node:assert/strict";
import test from "node:test";

import {
  SOURCE_NODE_ATTRIBUTE,
  SourceIndexError,
  buildSourceIndex,
  createInsertionPointTargetRef,
  createTargetRef,
  instrumentPreviewHtml,
  resolveFromPreview,
  resolveTargetRef,
} from "../app/lib/source-patch-core.js";

function resolveNthOfTypeSelector(index, selector) {
  let candidates = [];
  const segments = selector.split(/\s*>\s*/u);
  for (const [segmentIndex, segment] of segments.entries()) {
    const match = /^([a-z][\w-]*):nth-of-type\((\d+)\)$/iu.exec(segment);
    assert.ok(match, `unsupported selector segment in test: ${segment}`);
    const [, tagName, ordinalText] = match;
    const ordinal = Number.parseInt(ordinalText, 10);
    const normalizedTagName = tagName.toLowerCase();
    if (segmentIndex === 0) {
      const sameTypeRoots = index.elements.filter(
        (element) => !element.parentId && element.tagName === normalizedTagName,
      );
      candidates = sameTypeRoots[ordinal - 1] ? [sameTypeRoots[ordinal - 1]] : [];
      continue;
    }
    candidates = candidates.flatMap((parent) => {
      const sameTypeChildren = parent.childElementIds
        .map((nodeId) => index.byNodeId.get(nodeId))
        .filter(
          (child) => child.type === "element" && child.tagName === normalizedTagName,
        );
      const child = sameTypeChildren[ordinal - 1];
      return child ? [child] : [];
    });
  }
  return candidates;
}

test("SourceIndex records exact UTF-16 element, tag, text, attribute, parent, and sibling ranges", () => {
  const html = `<!doctype html>\r\n<html>\r\n<head><title>UTF-16</title></head>\r\n<body>\r\n<section id='m1' class=card data-key="alpha">\r\n  <h2 title='中😀e\u0301'>中😀e\u0301 &amp; 标题</h2>\r\n  <!-- marker -->\r\n  <p class="copy">段落</p>\r\n</section>\r\n<script>const fake = "<article id='not-real'>";</script>\r\n<template><table><tr><td>模板表格</td></tr></table></template>\r\n</body>\r\n</html>`;
  const index = buildSourceIndex(html);
  const section = index.elements.find(
    (element) => element.stableAttributes["data-key"] === "alpha",
  );
  const heading = index.elements.find((element) => element.tagName === "h2");
  const paragraph = index.elements.find((element) => element.tagName === "p");
  const headingText = index.byNodeId.get(heading.textNodeIds[0]);
  const title = heading.attributesByName.get("title")[0];

  assert.equal(index.source, html);
  assert.match(index.sourceSha256, /^sha256:[a-f0-9]{64}$/);
  assert.equal(index.integrity.ok, true);
  assert.deepEqual(section.range, {
    startOffset: html.indexOf("<section"),
    endOffset: html.indexOf("</section>") + "</section>".length,
  });
  assert.equal(
    html.slice(section.startTagRange.startOffset, section.startTagRange.endOffset),
    `<section id='m1' class=card data-key="alpha">`,
  );
  assert.equal(
    html.slice(section.endTagRange.startOffset, section.endTagRange.endOffset),
    "</section>",
  );
  assert.equal(heading.parentId, section.nodeId);
  assert.equal(paragraph.parentId, section.nodeId);
  assert.equal(heading.nextElementSiblingId, paragraph.nodeId);
  assert.equal(paragraph.previousElementSiblingId, heading.nodeId);
  assert.equal(heading.siblingIndex, 0);
  assert.equal(paragraph.siblingIndex, 1);
  assert.equal(
    html.slice(headingText.range.startOffset, headingText.range.endOffset),
    "中😀e\u0301 &amp; 标题",
  );
  assert.equal(headingText.value, "中😀e\u0301 & 标题");
  assert.equal(title.quote, "'");
  assert.equal(html.slice(title.nameRange.startOffset, title.nameRange.endOffset), "title");
  assert.equal(
    html.slice(title.valueRange.startOffset, title.valueRange.endOffset),
    "中😀e\u0301",
  );
  assert.equal(index.elements.some((element) => element.tagName === "article"), false);

  const template = index.elements.find((element) => element.tagName === "template");
  const table = index.elements.find((element) => element.tagName === "table");
  const row = index.elements.find((element) => element.tagName === "tr");
  assert.equal(table.parentId, template.nodeId);
  assert.equal(row.parentId, table.nodeId);
  assert.equal(index.source.slice(0, headingText.range.startOffset).length, headingText.range.startOffset);
});

test("SourceIndex retains duplicate attributes and marks implicit/incomplete boundaries instead of inventing source", () => {
  const html = `<main><div id=a ID=b class=x class='y' style="color:red" style='color:blue'>x`;
  const index = buildSourceIndex(html);
  const div = index.elements.find((element) => element.tagName === "div");
  assert.equal(div.attributesByName.get("id").length, 2);
  assert.equal(div.attributesByName.get("class").length, 2);
  assert.equal(div.attributesByName.get("style").length, 2);
  assert.equal(div.explicitEndTag, false);
  assert.equal(index.parseErrors.some((error) => error.code === "duplicate-attribute"), true);
  assert.equal(Object.hasOwn(div.stableAttributes, "id"), false);
});

test("instrumented preview injects ephemeral node IDs without changing the source index", () => {
  const html = `<main><h1>标题</h1><img src=x></main>`;
  const index = buildSourceIndex(html);
  const preview = instrumentPreviewHtml(index);
  assert.equal(index.source, html);
  assert.equal(html.includes(SOURCE_NODE_ATTRIBUTE), false);
  assert.equal(preview.nodeIds.length, index.elements.length);
  for (const nodeId of preview.nodeIds) {
    assert.match(preview.html, new RegExp(`${SOURCE_NODE_ATTRIBUTE}="${nodeId}"`));
  }
  assert.throws(
    () => instrumentPreviewHtml(`<main ${SOURCE_NODE_ATTRIBUTE}="user-value"></main>`),
    (error) => error instanceof SourceIndexError
      && error.code === "PREVIEW_ATTRIBUTE_COLLISION",
  );
});

test("instrumented preview preserves byte output for large element sets", () => {
  const html = `<!doctype html><main>${Array.from(
    { length: 4_000 },
    (_, index) => `<section data-row="${index}"><span>row ${index}</span></section>`,
  ).join("")}</main>`;
  const index = buildSourceIndex(html);
  let legacyOutput = html;
  const insertions = index.elements
    .map((element) => ({
      offset: element.closingDelimiterOffset,
      value: ` ${SOURCE_NODE_ATTRIBUTE}="${element.nodeId}"`,
    }))
    .sort((left, right) => right.offset - left.offset);
  for (const insertion of insertions) {
    legacyOutput = legacyOutput.slice(0, insertion.offset)
      + insertion.value
      + legacyOutput.slice(insertion.offset);
  }

  const preview = instrumentPreviewHtml(index);
  assert.equal(preview.html, legacyOutput);
  assert.equal(preview.nodeIds.length, 8_001);
});

test("fallback selectors use CSS nth-of-type ordinals across mixed-tag siblings and identify the preview node", () => {
  const html = `<!doctype html><html><head><title>Selector</title></head><body><main><h1>A</h1><p>B</p><aside>C</aside><p>D</p></main></body></html>`;
  const index = buildSourceIndex(html);
  const preview = instrumentPreviewHtml(index);
  const previewIndex = buildSourceIndex(preview.html);
  const expectedSelectors = new Map([
    ["html", "html:nth-of-type(1)"],
    ["head", "html:nth-of-type(1) > head:nth-of-type(1)"],
    ["body", "html:nth-of-type(1) > body:nth-of-type(1)"],
    ["main", "html:nth-of-type(1) > body:nth-of-type(1) > main:nth-of-type(1)"],
    ["h1", "html:nth-of-type(1) > body:nth-of-type(1) > main:nth-of-type(1) > h1:nth-of-type(1)"],
    ["p:B", "html:nth-of-type(1) > body:nth-of-type(1) > main:nth-of-type(1) > p:nth-of-type(1)"],
    ["aside", "html:nth-of-type(1) > body:nth-of-type(1) > main:nth-of-type(1) > aside:nth-of-type(1)"],
    ["p:D", "html:nth-of-type(1) > body:nth-of-type(1) > main:nth-of-type(1) > p:nth-of-type(2)"],
  ]);

  for (const element of index.elements) {
    const key = element.tagName === "p"
      ? `p:${element.textContent}`
      : element.tagName;
    const expected = expectedSelectors.get(key);
    if (!expected) continue;
    assert.equal(element.selector, expected);
    assert.deepEqual(
      resolveNthOfTypeSelector(index, element.selector).map((candidate) => candidate.nodeId),
      [element.nodeId],
    );
    const [previewElement] = resolveNthOfTypeSelector(previewIndex, element.selector);
    assert.equal(
      previewElement.attributesByName.get(SOURCE_NODE_ATTRIBUTE)?.[0]?.rawValue,
      element.nodeId,
    );
  }
});

test("TargetResolver returns exact, rebound after reorder/class change, ambiguous, and orphaned", () => {
  const base = `<main id="root"><section class="old" data-key="a"><h2>Alpha 唯一标题</h2></section><section data-key="b"><h2>Beta</h2></section></main>`;
  const baseIndex = buildSourceIndex(base);
  const alpha = baseIndex.elements.find(
    (element) => element.stableAttributes["data-key"] === "a",
  );
  const alphaRef = createTargetRef(baseIndex, alpha.nodeId, { level: "module" });
  assert.deepEqual(
    Object.keys(alphaRef).sort(),
    [
      "expectedSourceSha256",
      "fingerprint",
      "label",
      "level",
      "resolution",
      "selector",
      "sourceAnchor",
      "targetId",
      "textQuote",
    ],
  );
  assert.equal(resolveTargetRef(baseIndex, alphaRef).resolution, "exact");

  const reordered = `<main id="root"><section data-key="b"><h2>Beta</h2></section><section class="renamed" data-key="a"><h2>Alpha 唯一标题</h2></section></main>`;
  const rebound = resolveTargetRef(buildSourceIndex(reordered), alphaRef);
  assert.equal(rebound.resolution, "orphaned");
  assert.equal(rebound.reason, "pageroot-identity-incomplete");

  const classOnlyBase = `<main><section class="old"><h2>只出现一次</h2></section><section><h2>其他</h2></section></main>`;
  const classOnlyIndex = buildSourceIndex(classOnlyBase);
  const classOnlyTarget = classOnlyIndex.elements.find(
    (element) => element.tagName === "section" && element.textContent === "只出现一次",
  );
  const classOnlyRef = createTargetRef(classOnlyIndex, classOnlyTarget.nodeId);
  const classChanged = `<!-- shifted --><main><section class="new"><h2>只出现一次</h2></section><section><h2>其他</h2></section></main>`;
  assert.equal(resolveTargetRef(buildSourceIndex(classChanged), classOnlyRef).resolution, "orphaned");

  const duplicates = `<main><section><h2>相同</h2></section><section><h2>相同</h2></section></main>`;
  const duplicateIndex = buildSourceIndex(duplicates);
  const duplicateRef = createTargetRef(
    duplicateIndex,
    duplicateIndex.elements.filter((element) => element.tagName === "section")[0].nodeId,
  );
  const ambiguous = resolveTargetRef(buildSourceIndex(`<!-- shifted -->${duplicates}`), duplicateRef);
  assert.equal(ambiguous.resolution, "orphaned");

  const removed = `<main id="root"><section data-key="b"><h2>Beta</h2></section></main>`;
  assert.equal(resolveTargetRef(buildSourceIndex(removed), alphaRef).resolution, "orphaned");
});

test("anonymous SVG shapes rebind through authored geometry without weakening true ambiguity", () => {
  const base = `<svg viewBox="0 0 100 40"><rect x="4" y="4" width="24" height="12"></rect><rect x="36" y="4" width="24" height="12"></rect></svg>`;
  const baseIndex = buildSourceIndex(base);
  const firstRect = baseIndex.elements.find(
    (element) => element.tagName === "rect" && element.stableAttributes.x === "4",
  );
  assert.ok(firstRect);
  const targetRef = createTargetRef(baseIndex, firstRect.nodeId);
  const shifted = `<!-- unrelated source edit -->${base}`;
  const rebound = resolveTargetRef(buildSourceIndex(shifted), targetRef);
  assert.equal(rebound.resolution, "orphaned");

  const trulyRepeated = `<svg><rect x="4" y="4" width="24" height="12"></rect><rect x="4" y="4" width="24" height="12"></rect></svg>`;
  const repeatedIndex = buildSourceIndex(trulyRepeated);
  const repeatedRect = repeatedIndex.elements.find(
    (element) => element.tagName === "rect",
  );
  const repeatedRef = createTargetRef(repeatedIndex, repeatedRect.nodeId);
  const ambiguous = resolveTargetRef(
    buildSourceIndex(`<!-- shifted -->${trulyRepeated}`),
    repeatedRef,
  );
  assert.equal(ambiguous.resolution, "orphaned");
});

test("inline formatting wrappers preserve complete element TargetRef text identity", () => {
  const original = `<section><p>打开原生对话框</p><p>其他文字</p></section>`;
  const originalIndex = buildSourceIndex(original);
  const paragraph = originalIndex.elements.find(
    (element) => element.tagName === "p" && element.textContent === "打开原生对话框",
  );
  assert.ok(paragraph);
  const targetRef = createTargetRef(originalIndex, paragraph.nodeId);
  const formatted = `<section><p>打开<span style="all: unset; display: inline !important; font-weight: 700">原生</span>对话框</p><p>其他文字</p></section>`;
  const formattedIndex = buildSourceIndex(formatted);
  const resolution = resolveTargetRef(formattedIndex, targetRef);

  assert.equal(targetRef.textQuote, "打开原生对话框");
  assert.equal(resolution.resolution, "orphaned");
});

test("insertion-point refs rebind through stable parent and sibling fingerprints", () => {
  const base = `<main id="root"><section data-key="a">A</section><section data-key="b">B</section></main>`;
  const baseIndex = buildSourceIndex(base);
  const parent = baseIndex.elements.find((element) => element.tagName === "main");
  const before = baseIndex.elements.find(
    (element) => element.stableAttributes["data-key"] === "b",
  );
  const targetRef = createInsertionPointTargetRef(baseIndex, {
    parentId: parent.nodeId,
    beforeSiblingId: before.nodeId,
  });
  assert.deepEqual(
    Object.keys(targetRef).sort(),
    [
      "expectedSourceSha256",
      "fingerprint",
      "label",
      "level",
      "resolution",
      "selector",
      "sourceAnchor",
      "targetId",
    ],
  );
  assert.equal(targetRef.sourceAnchor.startOffset, targetRef.sourceAnchor.endOffset);
  assert.equal(targetRef.fingerprint.tagName, "main");
  assert.equal(targetRef.fingerprint.stableAttributes.id, "root");
  assert.equal(resolveTargetRef(baseIndex, targetRef).resolution, "exact");

  const next = `<main id="root"><section data-key="c">C</section><section data-key="a">A</section><section data-key="b">B</section></main>`;
  const nextIndex = buildSourceIndex(next);
  const rebound = resolveTargetRef(nextIndex, targetRef);
  assert.equal(rebound.resolution, "orphaned");
});

test("createTargetRef rejects inconsistent levels and text level anchors the actual single text node", () => {
  const html = `<main><p id="plain">唯一文字</p><p id="mixed">文字<strong>强调</strong></p></main>`;
  const index = buildSourceIndex(html);
  const plain = index.elements.find(
    (element) => element.stableAttributes.id === "plain",
  );
  const mixed = index.elements.find(
    (element) => element.stableAttributes.id === "mixed",
  );
  const plainText = index.byNodeId.get(plain.textNodeIds[0]);

  const textRef = createTargetRef(index, plain.nodeId, { level: "text" });
  assert.deepEqual(textRef.sourceAnchor, {
    startOffset: plainText.range.startOffset,
    endOffset: plainText.range.endOffset,
    sourceSha256: index.sourceSha256,
  });
  const exact = resolveTargetRef(index, textRef);
  assert.equal(exact.resolution, "exact");
  assert.equal(exact.target.nodeId, plainText.nodeId);
  assert.equal(
    resolveFromPreview(index, plain.nodeId, { level: "text" }).target.nodeId,
    plainText.nodeId,
  );
  assert.equal(
    resolveFromPreview(index, plain.nodeId, { level: "module" }).target.type,
    "element",
  );

  assert.throws(
    () => createTargetRef(index, mixed.nodeId, { level: "text" }),
    /exactly one direct text node/u,
  );
  assert.throws(
    () => createTargetRef(index, plainText.nodeId, { level: "module" }),
    /only create a text-level/u,
  );
  assert.throws(
    () => createTargetRef(index, plain.nodeId, { level: "insertion-point" }),
    /module, subregion, or text/u,
  );

  assert.throws(
    () => resolveTargetRef(index, { ...textRef, level: "bogus" }),
    /TargetRef level must be/u,
  );
  const forgedModule = resolveTargetRef(index, {
    ...textRef,
    level: "module",
  });
  assert.equal(forgedModule.resolution, "orphaned");
  const elementRef = createTargetRef(index, plain.nodeId);
  const forgedText = resolveTargetRef(index, {
    ...elementRef,
    level: "text",
  });
  assert.equal(forgedText.resolution, "orphaned");
});

test("insertion exact validates zero-width in-bounds child boundary and parent identity", () => {
  const html = `<main id="root"><section data-key="a">A</section><section data-key="b">B</section></main>`;
  const index = buildSourceIndex(html);
  const parent = index.elements.find((element) => element.tagName === "main");
  const before = index.elements.find(
    (element) => element.stableAttributes["data-key"] === "b",
  );
  const valid = createInsertionPointTargetRef(index, {
    parentId: parent.nodeId,
    beforeSiblingId: before.nodeId,
  });
  assert.equal(resolveTargetRef(index, valid).resolution, "exact");

  const nonZeroWidth = {
    ...valid,
    sourceAnchor: {
      ...valid.sourceAnchor,
      endOffset: valid.sourceAnchor.endOffset + 1,
    },
  };
  assert.equal(resolveTargetRef(index, nonZeroWidth).resolution, "orphaned");

  const arbitraryInterior = {
    ...valid,
    sourceAnchor: {
      ...valid.sourceAnchor,
      startOffset: before.startTagRange.startOffset + 2,
      endOffset: before.startTagRange.startOffset + 2,
    },
  };
  assert.equal(resolveTargetRef(index, arbitraryInterior).resolution, "orphaned");

  const outOfBounds = {
    ...valid,
    sourceAnchor: {
      ...valid.sourceAnchor,
      startOffset: html.length + 10,
      endOffset: html.length + 10,
    },
  };
  assert.equal(resolveTargetRef(index, outOfBounds).resolution, "orphaned");

  const wrongParent = {
    ...valid,
    selector: "#missing-parent",
    fingerprint: {
      ...valid.fingerprint,
      stableAttributes: { id: "missing-parent" },
    },
  };
  assert.equal(resolveTargetRef(index, wrongParent).resolution, "orphaned");
});

test("insertion rebound never treats positional nth selector as parent identity", () => {
  const base = `<main><section><p>共同前缀</p><i>A</i></section><section><p>共同前缀</p><i>B</i></section></main>`;
  const baseIndex = buildSourceIndex(base);
  const sections = baseIndex.elements.filter((element) => element.tagName === "section");
  const firstItalic = baseIndex.elements.find(
    (element) => element.tagName === "i" && element.textContent === "A",
  );
  const targetRef = createInsertionPointTargetRef(baseIndex, {
    parentId: sections[0].nodeId,
    beforeSiblingId: firstItalic.nodeId,
  });
  assert.match(targetRef.selector, /nth-of-type/u);

  const reordered = `<main><section><p>共同前缀</p><i>B</i></section><section><p>共同前缀</p><i>A</i></section></main>`;
  const resolution = resolveTargetRef(buildSourceIndex(reordered), targetRef);
  assert.equal(resolution.resolution, "orphaned");
  assert.equal(resolution.reason, "pageroot-identity-incomplete");
});
