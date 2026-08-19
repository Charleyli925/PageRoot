import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  REVIEW_TEXT_EVIDENCE_ADDED_COLOR,
  REVIEW_TEXT_EVIDENCE_MARKER_CSS,
  REVIEW_TEXT_EVIDENCE_REMOVED_COLOR,
  alignReviewTextEvidenceDotRows,
  reviewTextEvidenceIsPunctuationCode,
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

test("evidence units are character-sized and skip whitespace and punctuation", () => {
  assert.deepEqual(
    reviewTextEvidenceUnits("社交 9.1"),
    [
      { start: 0, end: 1 },
      { start: 1, end: 2 },
      { start: 3, end: 4 },
      { start: 5, end: 6 },
    ],
  );
  assert.deepEqual(
    reviewTextEvidenceUnits("甲，乙、丙；").map(({ start }) => start),
    [0, 2, 4],
  );
});

test("punctuation and symbols earn no green dot, letters and digits do", () => {
  for (const character of ["，", "、", "；", "：", "（", "）", "。", "—", "·", ",", ".", "%", "+", "/", "&"]) {
    assert.equal(
      reviewTextEvidenceIsPunctuationCode(character.codePointAt(0)),
      true,
      `${character} must not carry a dot`,
    );
  }
  for (const character of ["甲", "文", "9", "0", "a", "Z", "１", "ｚ"]) {
    assert.equal(
      reviewTextEvidenceIsPunctuationCode(character.codePointAt(0)),
      false,
      `${character} must keep its dot`,
    );
  }
});

test("the strike renders as dashes because a round cap cannot eat the gap", () => {
  for (const fontSize of [10, 11, 14, 16, 22, 28]) {
    for (const scale of [1, 1.6, 3]) {
      const geometry = reviewTextEvidenceMarkGeometry({
        left: 0,
        top: 0,
        right: fontSize,
        bottom: fontSize * 1.5,
      }, fontSize, scale);
      // A round cap grows every dash by one stroke thickness and takes the same
      // amount out of every gap; these are the widths actually painted.
      const paintedDash = geometry.dash + geometry.strikeThickness;
      const paintedGap = geometry.gap - geometry.strikeThickness;
      assert.ok(
        paintedGap > 1,
        `${fontSize}@${scale}: a ${paintedGap}px gap would read as a solid line`,
      );
      assert.ok(
        paintedGap >= paintedDash,
        `${fontSize}@${scale}: gap ${paintedGap} must not be tighter than dash ${paintedDash}`,
      );
      assert.equal(Math.round(paintedDash * 1e6), Math.round(geometry.visibleDash * 1e6));
      assert.equal(Math.round(paintedGap * 1e6), Math.round(geometry.visibleGap * 1e6));
    }
  }
});

test("a dot row gets one baseline, one radius, and no duplicates", () => {
  const row = alignReviewTextEvidenceDotRows([
    { x: 10, y: 30.4, radius: 1.3, em: 14 },
    { x: 24, y: 31.1, radius: 1.3, em: 14 },
    { x: 38, y: 29.8, radius: 1.4, em: 14 },
    { x: 24, y: 31.1, radius: 1.3, em: 14 },
  ]);
  assert.equal(row.length, 3, "a repeated position is drawn once");
  assert.equal(new Set(row.map((dot) => dot.y)).size, 1, "one baseline per row");
  assert.equal(new Set(row.map((dot) => dot.radius)).size, 1, "one radius per row");
  assert.equal(row[0].y, 31.1, "the row sits at its lowest baseline, never over a glyph");
  assert.deepEqual(row.map((dot) => dot.x), [10, 24, 38], "reading order survives");
});

test("dot rows never merge across glyph sizes or into the next line", () => {
  const mixedSizes = alignReviewTextEvidenceDotRows([
    { x: 10, y: 40, radius: 2.2, em: 28 },
    { x: 60, y: 34, radius: 1.3, em: 12 },
  ]);
  assert.equal(new Set(mixedSizes.map((dot) => dot.y)).size, 2);
  assert.equal(
    mixedSizes.find((dot) => dot.em === 12).y,
    34,
    "a small caption keeps its own depth beside a headline number",
  );

  const stackedLines = alignReviewTextEvidenceDotRows([
    { x: 10, y: 30, radius: 1.3, em: 14 },
    { x: 24, y: 35, radius: 1.3, em: 14 },
    { x: 10, y: 52, radius: 1.3, em: 14 },
    { x: 24, y: 57, radius: 1.3, em: 14 },
  ]);
  assert.equal(
    new Set(stackedLines.map((dot) => dot.y)).size,
    2,
    "a drifting row must not chain into the following text line",
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
