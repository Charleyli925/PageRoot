import assert from "node:assert/strict";
import test from "node:test";

import {
  applyPatchPlan,
  buildSourceIndex,
  createTargetRef,
  planSourcePatch,
} from "../app/lib/source-patch-core.js";
import {
  buildSourceTextMap,
  sourceAnchorToTextOffset,
  textOffsetToSourceAnchor,
  textRangeToSourceEdit,
} from "../app/lib/source-text-map.js";

const FUZZ_SEED = 0x50a9e123;
const FUZZ_CASE_COUNT = 128;
const INLINE_TAGS = [
  "span",
  "strong",
  "em",
  "mark",
  "code",
  "small",
  "b",
  "i",
  "u",
  "sub",
  "sup",
];
const SOURCE_TOKENS = [
  { raw: "A", decoded: "A" },
  { raw: "甲", decoded: "甲" },
  { raw: "文", decoded: "文" },
  { raw: "😀", decoded: "😀" },
  { raw: "e\u0301", decoded: "e\u0301" },
  { raw: "&amp;", decoded: "&" },
  { raw: "&#38;", decoded: "&" },
  { raw: "&lt;", decoded: "<" },
  { raw: "&#x1F600;", decoded: "😀" },
  { raw: "&nbsp;", decoded: "\u00a0" },
  { raw: "\r\n", decoded: "\n" },
];
const REPLACEMENTS = [
  "",
  "改",
  "X&<",
  "🌏",
  "新e\u0301",
  "\n",
  "\u00a0",
];

function createRandom(seed) {
  let state = seed >>> 0;
  return {
    integer(limit) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      return state % limit;
    },
  };
}

function isSafeUtf16Boundary(value, offset) {
  if (offset <= 0 || offset >= value.length) return true;
  const previous = value.charCodeAt(offset - 1);
  const next = value.charCodeAt(offset);
  return !(
    previous >= 0xd800
    && previous <= 0xdbff
    && next >= 0xdc00
    && next <= 0xdfff
  );
}

function safeOffsets(value) {
  return Array.from({ length: value.length + 1 }, (_, offset) => offset)
    .filter((offset) => isSafeUtf16Boundary(value, offset));
}

function wrapInline(raw, random, caseIndex, tokenIndex) {
  let output = raw;
  const depth = random.integer(4);
  for (let level = 0; level < depth; level += 1) {
    const tagName = INLINE_TAGS[random.integer(INLINE_TAGS.length)];
    output = `<${tagName} data-fuzz='${caseIndex}-${tokenIndex}-${level}'>${output}</${tagName}>`;
  }
  return output;
}

function buildFuzzCase(random, caseIndex) {
  const tokenCount = 5 + random.integer(8);
  const tokens = Array.from({ length: tokenCount }, () => (
    SOURCE_TOKENS[random.integer(SOURCE_TOKENS.length)]
  ));
  if (caseIndex % 8 === 0) {
    tokens[0] = SOURCE_TOKENS[10];
    tokens[1] = SOURCE_TOKENS[5];
    tokens[2] = SOURCE_TOKENS[3];
  }
  const nestedSource = tokens
    .map((token, tokenIndex) => wrapInline(token.raw, random, caseIndex, tokenIndex))
    .join("");
  const hostSource = random.integer(2) === 0
    ? nestedSource
    : `<span data-outer='${caseIndex}'><em>${nestedSource}</em></span>`;
  return {
    decodedText: tokens.map((token) => token.decoded).join(""),
    html: [
      "<!doctype html>",
      "<html><head><meta charset='utf-8'><title>fuzz</title></head>",
      `<body data-outside='keep-${caseIndex}'>`,
      `<aside><!-- untouched-${caseIndex} -->范围外 &amp; bytes</aside>`,
      `<p id='fuzz-${caseIndex}' data-quote=\"keep\">${hostSource}</p>`,
      "<footer>tail</footer></body></html>",
      "",
    ].join("\r\n"),
  };
}

function elementById(index, id) {
  const element = index.elements.find((candidate) => candidate.stableAttributes.id === id);
  assert.ok(element, `missing source element #${id}`);
  return element;
}

function reconstructFromPatches(source, patches) {
  return [...patches]
    .sort((left, right) => right.startOffset - left.startOffset)
    .reduce((value, patch) => {
      assert.equal(
        value.slice(patch.startOffset, patch.endOffset),
        patch.before,
        "patch precondition must identify the exact raw source bytes",
      );
      return `${value.slice(0, patch.startOffset)}${patch.after}${value.slice(patch.endOffset)}`;
    }, source);
}

test("deterministic nested-inline source-map fuzz preserves entities, Unicode, CRLF, and inverse bytes", () => {
  const random = createRandom(FUZZ_SEED);
  const coverage = {
    crlf: 0,
    mappedCrLf: 0,
    entity: 0,
    emoji: 0,
    insertion: 0,
    deletion: 0,
    multiRun: 0,
  };

  for (let caseIndex = 0; caseIndex < FUZZ_CASE_COUNT; caseIndex += 1) {
    const fixture = buildFuzzCase(random, caseIndex);
    const sourceIndex = buildSourceIndex(fixture.html);
    const host = elementById(sourceIndex, `fuzz-${caseIndex}`);
    const sourceMap = buildSourceTextMap(sourceIndex, host.nodeId);
    const label = `seed=${FUZZ_SEED} case=${caseIndex}`;

    assert.equal(sourceMap.text, fixture.decodedText, `${label}: decoded text drift`);
    assert.equal(sourceMap.boundaryCount, 0, `${label}: transparent inline became structural`);
    assert.ok(sourceMap.textRunCount >= 1, `${label}: source text runs missing`);
    if (fixture.html.includes("\r\n")) coverage.crlf += 1;
    if (sourceMap.text.includes("\n")) coverage.mappedCrLf += 1;
    if (/&(?:amp|lt|nbsp|#38|#x1F600);/u.test(fixture.html)) coverage.entity += 1;
    if (sourceMap.text.includes("😀")) coverage.emoji += 1;

    const offsets = safeOffsets(sourceMap.text);
    for (const offset of offsets) {
      for (const affinity of ["left", "right"]) {
        const anchor = textOffsetToSourceAnchor(sourceMap, offset, affinity);
        assert.equal(
          sourceAnchorToTextOffset(sourceMap, anchor),
          offset,
          `${label}: anchor round-trip failed at ${offset}/${affinity}`,
        );
      }
    }

    let startOffset = offsets[random.integer(offsets.length)];
    let endOffset = offsets[random.integer(offsets.length)];
    if (startOffset > endOffset) [startOffset, endOffset] = [endOffset, startOffset];
    if (caseIndex % 5 === 0) endOffset = startOffset;
    let nextText = REPLACEMENTS[random.integer(REPLACEMENTS.length)];
    const beforeText = sourceMap.text.slice(startOffset, endOffset);
    if (beforeText === nextText) nextText = beforeText ? "替" : "插";
    if (startOffset === endOffset) coverage.insertion += 1;
    if (nextText === "" && startOffset !== endOffset) coverage.deletion += 1;

    const sourceEdit = textRangeToSourceEdit(
      sourceMap,
      startOffset,
      endOffset,
      caseIndex % 2 === 0 ? "left" : "right",
    );
    if (sourceEdit.deleteSegments.length > 1) coverage.multiRun += 1;
    const targetRef = createTargetRef(sourceIndex, host.nodeId, {
      level: "subregion",
      targetId: `fuzz_target_${caseIndex}`,
    });
    const result = applyPatchPlan(planSourcePatch({
      type: "replace-text-range",
      targetRef,
      replacements: [{
        ...sourceEdit,
        beforeText,
        nextText,
      }],
      beforeText,
      expectedSourceSha256: sourceIndex.sourceSha256,
    }, sourceIndex), fixture.html);

    assert.equal(result.scopeReport.outsideUnchanged, true, `${label}: scope widened`);
    assert.equal(result.scopeReport.verdict, "allowed", `${label}: scope rejected`);
    assert.equal(result.parseIntegrity.ok, true, `${label}: parse integrity failed`);
    assert.equal(
      result.html,
      reconstructFromPatches(fixture.html, result.patches),
      `${label}: output was not composed only from declared raw patches`,
    );

    const refreshedTarget = result.refreshedTargetRefs.find(
      (candidate) => candidate.targetId === targetRef.targetId,
    );
    assert.ok(refreshedTarget, `${label}: refreshed target missing`);
    assert.equal(refreshedTarget.resolution, "exact", `${label}: target did not rebind exactly`);
    const refreshedMap = buildSourceTextMap(
      result.sourceIndex,
      refreshedTarget,
      { allowEmpty: true },
    );
    assert.equal(
      refreshedMap.text,
      `${sourceMap.text.slice(0, startOffset)}${nextText}${sourceMap.text.slice(endOffset)}`,
      `${label}: patched source text differs from the native edit intent`,
    );

    const restored = applyPatchPlan(result.inversePlan, result.html).html;
    assert.deepEqual(
      Buffer.from(restored, "utf8"),
      Buffer.from(fixture.html, "utf8"),
      `${label}: inverse did not restore every UTF-8 byte`,
    );
  }

  assert.equal(coverage.crlf, FUZZ_CASE_COUNT);
  assert.ok(coverage.mappedCrLf > 0, "mapped CRLF normalization was not exercised");
  assert.ok(coverage.entity >= FUZZ_CASE_COUNT / 2, "entity coverage is unexpectedly low");
  assert.ok(coverage.emoji >= FUZZ_CASE_COUNT / 2, "emoji coverage is unexpectedly low");
  assert.ok(coverage.insertion > 0, "insertion cases were not generated");
  assert.ok(coverage.deletion > 0, "deletion cases were not generated");
  assert.ok(coverage.multiRun > 0, "cross-inline replacement cases were not generated");
});
