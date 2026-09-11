import assert from "node:assert/strict";
import test from "node:test";

import {
  compareElementScopedMutation,
  compareElementSourceDelta,
  formattedMarkerAppendedPattern,
  SOURCE_SCOPE_POLICIES,
} from "./e2e/electron/real-html/source-scope.mjs";

const SOURCE_ID = "pr1_aaaaaaaaaaaa4aaa8aaaaaaaaaaaaaaa";

function sourcePair() {
  const before = Buffer.from(`<p data-pageroot-id="${SOURCE_ID}">SAFE</p>`);
  const after = Buffer.from(`<p data-pageroot-id="${SOURCE_ID}">EVIL</p>`);
  const beforeStart = before.indexOf("SAFE");
  const afterStart = after.indexOf("EVIL");
  return {
    before,
    after,
    beforeRange: { start: beforeStart, end: beforeStart + 4 },
    afterRange: { start: afterStart, end: afterStart + 4 },
  };
}

test("source-scope helper rejects observed-after-derived expectations", () => {
  const pair = sourcePair();
  const report = compareElementSourceDelta({
    ...pair,
    sourceId: SOURCE_ID,
    expectedBefore: "SAFE",
    expectedAfter: "SAFE",
    domSelector: `[data-pageroot-id="${SOURCE_ID}"]`,
  });
  assert.equal(report.ok, false);
  assert.equal(report.errors[0].code, "REGION_EXPECTED_AFTER_MISMATCH");
  assert.throws(
    () => compareElementSourceDelta({
      ...pair,
      sourceId: SOURCE_ID,
      expectedBefore: "SAFE",
      domSelector: `[data-pageroot-id="${SOURCE_ID}"]`,
    }),
    (error) => error?.code === "SOURCE_SCOPE_EXPECTATION_REQUIRED",
  );
});

test("source-scope helper requires an explicit subrange", () => {
  const pair = sourcePair();
  assert.throws(
    () => compareElementSourceDelta({
      before: pair.before,
      after: pair.after,
      sourceId: SOURCE_ID,
      expectedBefore: "SAFE",
      expectedAfter: "EVIL",
    }),
    (error) => error?.code === "SOURCE_SCOPE_RANGE_REQUIRED",
  );
});

test("operation-scoped oracle rejects changes outside the Stable-ID element", () => {
  const before = `<main data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p data-pageroot-id="${SOURCE_ID}">before</p></main>`;
  const validAfter = `<main data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p data-pageroot-id="${SOURCE_ID}">before TOKEN</p></main>`;
  const valid = compareElementScopedMutation({
    before,
    after: validAfter,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.outsideUnchanged, true);

  const outsideChanged = compareElementScopedMutation({
    before,
    after: `<main class="changed" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p data-pageroot-id="${SOURCE_ID}">after TOKEN</p></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(outsideChanged.ok, false);
  assert.equal(outsideChanged.outsideUnchanged, false);

  const targetAttributeChanged = compareElementScopedMutation({
    before,
    after: `<main data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p class="corrupt" data-pageroot-id="${SOURCE_ID}">after TOKEN</p></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_INPUT_DELETE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(targetAttributeChanged.ok, false);
  assert.equal(targetAttributeChanged.outsideUnchanged, false);

  const targetContentCorrupted = compareElementScopedMutation({
    before,
    after: `<main data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb"><p data-pageroot-id="${SOURCE_ID}">UNRELATED DAMAGE TOKEN</p></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_PASTE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: / TOKEN/u,
  });
  assert.equal(targetContentCorrupted.ok, false);
  assert.equal(targetContentCorrupted.preservedBeforeContent, false);
});

test("operation-scoped oracle requires a closed normalization policy", () => {
  assert.throws(() => compareElementScopedMutation({
    before: `<p data-pageroot-id="${SOURCE_ID}">before</p>`,
    after: `<p data-pageroot-id="${SOURCE_ID}">after</p>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: "anything-goes",
    expectedAppendedPattern: /after/u,
  }), { code: "SOURCE_SCOPE_POLICY_INVALID" });
});

test("operation-scoped oracle rejects a marker that already existed before input", () => {
  const report = compareElementScopedMutation({
    before: `<p data-pageroot-id="${SOURCE_ID}">TOKEN</p>`,
    after: `<p data-pageroot-id="${SOURCE_ID}">TOKEN</p>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_PASTE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: /TOKEN/u,
  });
  assert.equal(report.ok, false);
  assert.deepEqual(report.unexpectedBefore, ["TOKEN"]);
});

test("operation-scoped oracle rejects extra appended garbage around a valid marker", () => {
  const report = compareElementScopedMutation({
    before: `<p data-pageroot-id="${SOURCE_ID}">Original</p>`,
    after: `<p data-pageroot-id="${SOURCE_ID}">Original<script>corruption()</script> TOKEN EXTRA</p>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_PASTE,
    expectedAfterContains: ["TOKEN"],
    expectedAppendedPattern: /TOKEN/u,
  });
  assert.equal(report.ok, false);
  assert.equal(report.appendedShapeValid, false);
});

test("format oracle permits only the Stable ID and three requested declarations", () => {
  const before = `<p data-pageroot-id="${SOURCE_ID}">Original</p>`;
  const marker = "PRQA_0_FORMAT";
  const pattern = formattedMarkerAppendedPattern(marker);
  const validAfter = `<p data-pageroot-id="${SOURCE_ID}">Original <span style="all: unset; display: inline !important; font-weight: 700; font-style: italic; text-decoration-line: underline" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb">${marker}</span></p>`;
  assert.equal(compareElementScopedMutation({
    before,
    after: validAfter,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT,
    expectedAfterContains: [marker],
    expectedAppendedPattern: pattern,
  }).ok, true);

  for (const appended of [
    ` <span onclick="steal()" style="all:unset;display:inline!important;font-weight:700;font-style:italic;text-decoration-line:underline" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb">${marker}</span>`,
    ` <span style="all:unset;display:inline!important;font-weight:700;font-style:italic;text-decoration-line:underline;background:url(javascript:evil)" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb">${marker}</span>`,
    ` <span style="all:unset;display:inline!important;font-weight:700;font-style:italic;text-decoration-line:underline" class="unexpected" data-pageroot-id="pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb">${marker}</span>`,
  ]) {
    const rejected = compareElementScopedMutation({
      before,
      after: `<p data-pageroot-id="${SOURCE_ID}">Original${appended}</p>`,
      sourceId: SOURCE_ID,
      normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT,
      expectedAfterContains: [marker],
      expectedAppendedPattern: pattern,
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.appendedShapeValid, false);
  }
});

test("newline and format oracles reject a Stable ID reused from a sibling", () => {
  const siblingId = "pr1_bbbbbbbbbbbb4bbb8bbbbbbbbbbbbbbb";
  const before = `<main data-pageroot-id="pr1_cccccccccccc4ccc8ccccccccccccccc"><p data-pageroot-id="${SOURCE_ID}">Original</p><aside data-pageroot-id="${siblingId}">Sibling</aside></main>`;
  const newlineMarker = "PRQA_NEWLINE";
  const newline = compareElementScopedMutation({
    before,
    after: `<main data-pageroot-id="pr1_cccccccccccc4ccc8ccccccccccccccc"><p data-pageroot-id="${SOURCE_ID}">Original BEFORE<br data-pageroot-id="${siblingId}">${newlineMarker}</p><aside data-pageroot-id="${siblingId}">Sibling</aside></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_NEWLINE,
    expectedAfterContains: [newlineMarker],
    expectedAppendedPattern: new RegExp(
      ` BEFORE<br data-pageroot-id="${siblingId}">${newlineMarker}`,
      "u",
    ),
  });
  assert.equal(newline.ok, false);
  assert.equal(newline.sourceIdentityValid, false);
  assert.equal(newline.freshStableIdsValid, false);

  const formatMarker = "PRQA_FORMAT";
  const format = compareElementScopedMutation({
    before,
    after: `<main data-pageroot-id="pr1_cccccccccccc4ccc8ccccccccccccccc"><p data-pageroot-id="${SOURCE_ID}">Original <span style="all: unset; display: inline !important; font-weight: 700; font-style: italic; text-decoration-line: underline" data-pageroot-id="${siblingId}">${formatMarker}</span></p><aside data-pageroot-id="${siblingId}">Sibling</aside></main>`,
    sourceId: SOURCE_ID,
    normalizationPolicy: SOURCE_SCOPE_POLICIES.TEXT_FORMAT,
    expectedAfterContains: [formatMarker],
    expectedAppendedPattern: formattedMarkerAppendedPattern(formatMarker),
  });
  assert.equal(format.ok, false);
  assert.equal(format.sourceIdentityValid, false);
  assert.equal(format.freshStableIdsValid, false);
});
