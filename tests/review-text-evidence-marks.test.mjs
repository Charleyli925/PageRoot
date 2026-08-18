import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REVIEW_TEXT_EVIDENCE_ADDED_COLOR,
  REVIEW_TEXT_EVIDENCE_MARKER_CSS,
  REVIEW_TEXT_EVIDENCE_REMOVED_COLOR,
  reviewTextEvidenceMarkGeometry,
  reviewTextEvidenceStyleViolations,
  reviewTextEvidenceUnits,
} from "../app/lib/review-text-evidence-marks.js";

const reviewDocument = await readFile(
  new URL("../app/workbench/review-document.ts", import.meta.url),
  "utf8",
);
const interactionFlow = await readFile(
  new URL("../docs/INTERACTION_FLOW.md", import.meta.url),
  "utf8",
);
const changeRequestProtocol = await readFile(
  new URL("../docs/CHANGE_REQUEST_PROTOCOL.md", import.meta.url),
  "utf8",
);

test("character-evidence CSS cannot recolor, resize, or use emphasis", () => {
  assert.deepEqual(reviewTextEvidenceStyleViolations(REVIEW_TEXT_EVIDENCE_MARKER_CSS), []);
  assert.match(reviewDocument, /REVIEW_TEXT_EVIDENCE_MARKER_CSS/);
  assert.match(reviewDocument, /reviewTextEvidenceMarkGeometry/);
  assert.doesNotMatch(reviewDocument, /text-emphasis-style:\s*filled/u);
  assert.doesNotMatch(reviewDocument, /color:\s*#a13f3b/u);
  assert.match(reviewDocument, /data-pageroot-review-text-mark/u);
  assert.equal(REVIEW_TEXT_EVIDENCE_REMOVED_COLOR, "#c74f4a");
  assert.equal(REVIEW_TEXT_EVIDENCE_ADDED_COLOR, "#239b56");
});

test("green dots sit in existing leading and do not invent a half-em gap", () => {
  const loose = reviewTextEvidenceMarkGeometry({
    left: 0,
    top: 0,
    right: 16,
    bottom: 24,
  }, 16, 1);
  assert.equal(loose.addedClearance, 0);
  assert.ok(loose.dotY > loose.glyphBottom);
  assert.ok(loose.dotY + loose.dotRadius <= 24);
  assert.ok(loose.strikeY > loose.glyphTop && loose.strikeY < loose.glyphBottom);

  const tight = reviewTextEvidenceMarkGeometry({
    left: 0,
    top: 0,
    right: 16,
    bottom: 16,
  }, 16, 1);
  assert.ok(tight.addedClearance > 0);
  assert.ok(tight.addedClearance < 16 * 0.55);
  assert.ok(tight.dotY > tight.glyphBottom);
});

test("evidence units are character-sized and skip whitespace", () => {
  assert.deepEqual(
    reviewTextEvidenceUnits("社交 9.1"),
    [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 4, end: 5 },
      { start: 5, end: 6 },
    ],
  );
});

test("product and protocol freeze the character-evidence mark contract", () => {
  for (const source of [interactionFlow, changeRequestProtocol]) {
    assert.match(source, /字符证据标记（冻结合同）/u);
    assert.match(source, /红色横虚线穿过被删/u);
    assert.match(source, /绿色实点/u);
    assert.match(source, /不得改变作者颜色、字号、字重、行距/u);
    assert.match(source, /text-emphasis/u);
  }
});
