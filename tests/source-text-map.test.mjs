import assert from "node:assert/strict";
import test from "node:test";

import { buildSourceIndex } from "../app/lib/source-index.js";
import {
  SourceTextMapError,
  buildSourceTextMap,
  sourceAnchorToTextOffset,
  sourceSegmentsToTextRange,
  textOffsetToSourceAnchor,
  textRangeToSourceEdit,
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

test("a non-collapsed replacement stays inside the first emptied inline text node", () => {
  const index = buildSourceIndex(`<p id="copy"><span>replace me</span></p>`);
  const map = buildSourceTextMap(index, elementById(index, "copy").nodeId);
  const edit = textRangeToSourceEdit(map, 0, map.textLength, "left");

  assert.deepEqual(edit.insertAt, {
    kind: "text",
    textNodeId: map.runs[0].textNodeId,
    utf16Offset: 0,
    affinity: "right",
  });
  assert.deepEqual(edit.deleteSegments, [{
    textNodeId: map.runs[0].textNodeId,
    startOffset: 0,
    endOffset: map.textLength,
  }]);
});

test("a replacement crossing from an exact run boundary uses the surviving left source owner", () => {
  const index = buildSourceIndex(
    `<p id="copy">真实 <strong>DOM</strong> 光标要像</p>`,
  );
  const map = buildSourceTextMap(index, elementById(index, "copy").nodeId);
  const [, strongRun, trailingRun] = map.runs;
  const strong = index.elements.find((element) => element.tagName === "strong");
  assert.ok(strong);

  assert.deepEqual(textRangeToSourceEdit(map, 3, 9, "left"), {
    deleteSegments: [
      {
        textNodeId: strongRun.textNodeId,
        startOffset: 0,
        endOffset: strongRun.text.length,
      },
      {
        textNodeId: trailingRun.textNodeId,
        startOffset: 0,
        endOffset: 3,
      },
    ],
    insertAt: {
      kind: "child-boundary",
      parentNodeId: elementById(index, "copy").nodeId,
      beforeNodeId: strong.nodeId,
      affinity: "right",
    },
  });
});

test("inline range ownership never leaks root text into a preceding wrapper", () => {
  const index = buildSourceIndex(
    `<p id="copy"><strong>A</strong>B<i>C</i></p>`,
  );
  const map = buildSourceTextMap(index, elementById(index, "copy").nodeId);
  const [, rootRun, italicRun] = map.runs;

  assert.deepEqual(textRangeToSourceEdit(map, 1, 3, "left"), {
    deleteSegments: [
      { textNodeId: rootRun.textNodeId, startOffset: 0, endOffset: 1 },
      { textNodeId: italicRun.textNodeId, startOffset: 0, endOffset: 1 },
    ],
    insertAt: {
      kind: "text",
      textNodeId: rootRun.textNodeId,
      utf16Offset: 0,
      affinity: "right",
    },
  });
});

test("nested inline ranges choose only the outermost wrapper actually crossed", () => {
  const index = buildSourceIndex(
    `<p id="copy"><strong><em>A</em>B</strong>C</p>`,
  );
  const paragraph = elementById(index, "copy");
  const strong = index.elements.find((element) => element.tagName === "strong");
  const emphasis = index.elements.find((element) => element.tagName === "em");
  assert.ok(strong && emphasis);
  const map = buildSourceTextMap(index, paragraph.nodeId);
  const [emphasisRun, strongRun, rootRun] = map.runs;
  const deleteSegments = [
    { textNodeId: emphasisRun.textNodeId, startOffset: 0, endOffset: 1 },
    { textNodeId: strongRun.textNodeId, startOffset: 0, endOffset: 1 },
  ];

  assert.deepEqual(textRangeToSourceEdit(map, 0, 2, "left"), {
    deleteSegments,
    insertAt: {
      kind: "child-boundary",
      parentNodeId: strong.nodeId,
      beforeNodeId: emphasis.nodeId,
      affinity: "right",
    },
  });
  assert.deepEqual(textRangeToSourceEdit(map, 0, 3, "left"), {
    deleteSegments: [
      ...deleteSegments,
      { textNodeId: rootRun.textNodeId, startOffset: 0, endOffset: 1 },
    ],
    insertAt: {
      kind: "child-boundary",
      parentNodeId: paragraph.nodeId,
      beforeNodeId: strong.nodeId,
      affinity: "right",
    },
  });
});

test("an empty transparent wrapper cannot steal boundary insertion ownership", () => {
  const index = buildSourceIndex(
    `<p id="copy"><span></span><strong>A</strong>B</p>`,
  );
  const paragraph = elementById(index, "copy");
  const strong = index.elements.find((element) => element.tagName === "strong");
  assert.ok(strong);
  const map = buildSourceTextMap(index, paragraph.nodeId);
  const [strongRun, rootRun] = map.runs;

  assert.deepEqual(textRangeToSourceEdit(map, 0, 2, "left"), {
    deleteSegments: [
      { textNodeId: strongRun.textNodeId, startOffset: 0, endOffset: 1 },
      { textNodeId: rootRun.textNodeId, startOffset: 0, endOffset: 1 },
    ],
    insertAt: {
      kind: "child-boundary",
      parentNodeId: paragraph.nodeId,
      beforeNodeId: strong.nodeId,
      affinity: "right",
    },
  });
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
  assert.deepEqual(textRangeToSourceEdit(map, 3, 3, "left"), {
    deleteSegments: [],
    insertAt: {
      kind: "text",
      textNodeId: run.textNodeId,
      utf16Offset: 3,
      affinity: "left",
    },
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
