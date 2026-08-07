import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceIndex } from "../app/lib/source-index.js";
import {
  SourceTextMapError,
  buildSourceTextFragmentMap,
  buildSourceTextMap,
  sourceAnchorToTextOffset,
  sourceSegmentsToTextRange,
  textOffsetToSourceAnchor,
  textRangeToSourceSegments,
} from "../app/lib/source-text-map.js";

function elementById(index, id) {
  return index.elements.find((element) => element.stableAttributes.id === id);
}

test("maps decoded UTF-16 text across authored inline elements without layout semantics", () => {
  const html = `<p id="copy">甲<strong>中😀</strong><em>&amp;尾</em></p>`;
  const index = buildSourceIndex(html);
  const paragraph = elementById(index, "copy");
  const map = buildSourceTextMap(index, paragraph.nodeId);

  assert.equal(map.rootNodeId, paragraph.nodeId);
  assert.equal(map.text, "甲中😀&尾");
  assert.equal(map.textLength, 6);
  assert.equal(map.boundaryCount, 0);
  assert.deepEqual(map.runs.map((run) => run.kind), ["text", "text", "text"]);
  assert.equal(
    html.slice(map.runs[2].sourceStart, map.runs[2].sourceEnd),
    "&amp;尾",
  );

  const segments = textRangeToSourceSegments(map, 1, 5);
  assert.deepEqual(
    segments.map(({ startOffset, endOffset }) => ({ startOffset, endOffset })),
    [
      { startOffset: 0, endOffset: 3 },
      { startOffset: 0, endOffset: 1 },
    ],
  );
  assert.deepEqual(sourceSegmentsToTextRange(map, segments), {
    startOffset: 1,
    endOffset: 5,
  });
});

test("isolates one exact direct text node from a structurally complex parent", () => {
  const index = buildSourceIndex(
    `<div id="mixed"><div>chart</div><b>强调</b>裸&amp;文本<span>尾注</span></div>`,
  );
  const textNode = index.textNodes.find((node) => node.value === "裸&文本");
  const map = buildSourceTextFragmentMap(index, textNode.nodeId);

  assert.equal(map.rootNodeId, elementById(index, "mixed").nodeId);
  assert.equal(map.text, "裸&文本");
  assert.equal(map.textRunCount, 1);
  assert.equal(map.boundaryCount, 0);
  assert.deepEqual(textRangeToSourceSegments(map, 0, map.textLength), [{
    textNodeId: textNode.nodeId,
    startOffset: 0,
    endOffset: textNode.value.length,
  }]);
});

test("round-trips text and child-boundary source anchors with explicit affinity", () => {
  const index = buildSourceIndex(`<p id="copy"><strong>甲</strong>乙</p>`);
  const paragraph = elementById(index, "copy");
  const map = buildSourceTextMap(index, paragraph.nodeId);
  const [strongRun, plainRun] = map.runs;

  assert.deepEqual(textOffsetToSourceAnchor(map, 1, "left"), {
    kind: "text",
    textNodeId: strongRun.textNodeId,
    utf16Offset: 1,
    affinity: "left",
  });
  assert.deepEqual(textOffsetToSourceAnchor(map, 1, "right"), {
    kind: "text",
    textNodeId: plainRun.textNodeId,
    utf16Offset: 0,
    affinity: "right",
  });
  for (let offset = 0; offset <= map.textLength; offset += 1) {
    const anchor = textOffsetToSourceAnchor(map, offset, "right");
    assert.equal(sourceAnchorToTextOffset(map, anchor), offset);
  }
  assert.equal(sourceAnchorToTextOffset(map, map.endAnchor), map.textLength);
});

test("keeps hard breaks and structural children explicit and rejects text-only edits across them", () => {
  const index = buildSourceIndex(`<p id="copy">A<br>B<img src=x>C</p>`);
  const paragraph = elementById(index, "copy");
  const map = buildSourceTextMap(index, paragraph.nodeId);

  assert.equal(map.text, `A\nB\ufffcC`);
  assert.deepEqual(
    map.runs.map((run) => run.kind),
    ["text", "hard-break", "text", "structure", "text"],
  );
  assert.throws(
    () => textRangeToSourceSegments(map, 0, 3),
    (error) => error instanceof SourceTextMapError
      && error.code === "SOURCE_STRUCTURE_BOUNDARY_CROSSED",
  );
  assert.throws(
    () => textRangeToSourceSegments(map, 2, 5),
    (error) => error instanceof SourceTextMapError
      && error.code === "SOURCE_STRUCTURE_BOUNDARY_CROSSED",
  );
});

test("treats wbr as a preserved zero-width source boundary", () => {
  const index = buildSourceIndex(
    `<p id="copy">Hypertext<wbr>Markup<wbr>Language</p>`,
  );
  const map = buildSourceTextMap(index, elementById(index, "copy").nodeId);

  assert.equal(map.text, "HypertextMarkupLanguage");
  assert.equal(map.boundaryCount, 0);
  assert.deepEqual(map.runs.map((run) => run.kind), ["text", "text", "text"]);
});

test("projects a nested child list as one immutable structure beside its heading", () => {
  const index = buildSourceIndex(
    `<li id="copy">发现阶段<ul><li>访谈</li><li>审计</li></ul></li>`,
  );
  const map = buildSourceTextMap(index, elementById(index, "copy").nodeId);

  assert.equal(map.text, `发现阶段\ufffc`);
  assert.deepEqual(map.runs.map((run) => run.kind), ["text", "structure"]);
  assert.equal(map.runs[1].tagName, "ul");
});

test("uses source text-node offsets rather than invented raw entity offsets", () => {
  const index = buildSourceIndex(`<p id="copy">&amp;&#x1F600;X</p>`);
  const map = buildSourceTextMap(index, elementById(index, "copy").nodeId);
  const run = map.runs[0];

  assert.equal(map.text, "&😀X");
  assert.deepEqual(textRangeToSourceSegments(map, 1, 3), [{
    textNodeId: run.textNodeId,
    startOffset: 1,
    endOffset: 3,
  }]);
  assert.deepEqual(textOffsetToSourceAnchor(map, 3, "left"), {
    kind: "text",
    textNodeId: run.textNodeId,
    utf16Offset: 3,
    affinity: "left",
  });
  assert.throws(
    () => textRangeToSourceSegments(map, 1, 2),
    (error) => error instanceof SourceTextMapError
      && error.code === "UNSAFE_UTF16_BOUNDARY",
  );
});

test("fails closed for foreign content, missing targets, and non-contiguous segments", () => {
  const index = buildSourceIndex(`<main><p id="a">AB</p><svg id="s"><text>X</text></svg></main>`);
  const paragraph = elementById(index, "a");
  const svg = elementById(index, "s");
  const map = buildSourceTextMap(index, paragraph.nodeId);
  const run = map.runs[0];

  assert.throws(
    () => buildSourceTextMap(index, svg.nodeId),
    (error) => error instanceof SourceTextMapError
      && error.code === "NON_HTML_SOURCE_TEXT_HOST",
  );
  assert.throws(
    () => buildSourceTextMap(index, "missing"),
    (error) => error instanceof SourceTextMapError
      && error.code === "SOURCE_TARGET_ORPHANED",
  );
  assert.throws(
    () => sourceSegmentsToTextRange(map, [
      { textNodeId: run.textNodeId, startOffset: 0, endOffset: 1 },
      { textNodeId: run.textNodeId, startOffset: 1, endOffset: 2 },
    ]),
    (error) => error instanceof SourceTextMapError
      && error.code === "NON_CONTIGUOUS_SOURCE_TEXT_SEGMENTS",
  );
});
