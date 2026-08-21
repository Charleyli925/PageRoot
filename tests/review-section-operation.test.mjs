import assert from "node:assert/strict";
import test from "node:test";

import { reviewSectionChangeOperation } from "../app/lib/review-section-operation.js";

const textMark = (textOperation) => ({ textOperation, structureTone: "" });
const structureMark = (structureTone) => ({ textOperation: "", structureTone });

test("a whole element added inside a surviving section reports an insertion", () => {
  assert.equal(
    reviewSectionChangeOperation([structureMark("added")]),
    "insert",
    "a card added inside a section that exists on both sides is still an insertion",
  );
  assert.equal(
    reviewSectionChangeOperation([structureMark("added"), textMark("insert")]),
    "insert",
    "text inserted with the new element corroborates it",
  );
  assert.equal(
    reviewSectionChangeOperation([structureMark("added"), structureMark("added")]),
    "insert",
  );
});

test("appended words alone keep the type-derived wording", () => {
  // A sentence that grew is already described by 文本调整, and the marker beside
  // it already reads 新增内容. Relabelling the whole section for it would
  // over-claim, so a structural mark is required.
  assert.equal(reviewSectionChangeOperation([textMark("insert")]), null);
  assert.equal(reviewSectionChangeOperation([textMark("delete")]), null);
  assert.equal(
    reviewSectionChangeOperation([textMark("insert"), textMark("insert")]),
    null,
  );
});

test("a section whose every change is a removal reports one", () => {
  assert.equal(reviewSectionChangeOperation([structureMark("removed")]), "delete");
  assert.equal(
    reviewSectionChangeOperation([structureMark("removed"), textMark("delete")]),
    "delete",
  );
});

test("mixed evidence keeps the type-derived wording instead of naming half the change", () => {
  assert.equal(
    reviewSectionChangeOperation([structureMark("added"), textMark("delete")]),
    null,
    "a section that both gains and loses content is neither",
  );
  assert.equal(
    reviewSectionChangeOperation([structureMark("added"), structureMark("removed")]),
    null,
  );
  assert.equal(
    reviewSectionChangeOperation([structureMark("added"), textMark("replace")]),
    null,
    "a rewrite alongside an insertion is not a pure insertion",
  );
  ["before", "after", "from", "to"].forEach((tone) => {
    assert.equal(
      reviewSectionChangeOperation([structureMark("added"), structureMark(tone)]),
      null,
      `in-place or move evidence (${tone}) disqualifies an insertion claim`,
    );
  });
});

test("a reflow disqualifies an exclusive insertion claim", () => {
  // Regression: a paragraph that both gained a sentence and lost a <br> would
  // otherwise read as 新增内容 and hide the reflow, which carries its own
  // caption (换行调整) in this vocabulary.
  assert.equal(
    reviewSectionChangeOperation([structureMark("added"), textMark("layout")]),
    null,
  );
  assert.equal(reviewSectionChangeOperation([textMark("layout")]), null);
});

test("evidence-free and content-neutral marks decide nothing", () => {
  assert.equal(reviewSectionChangeOperation([]), null);
  assert.equal(reviewSectionChangeOperation(null), null);
  assert.equal(
    reviewSectionChangeOperation([textMark("none"), structureMark("added")]),
    "insert",
    "a marker with no change at all must not disqualify a real insertion",
  );
});

test("a text operation only counts when a text marker carries it", () => {
  // review-document only reads the operation attribute from elements that also
  // carry data-pageroot-review-text, so an operation-free mark is inert.
  assert.equal(
    reviewSectionChangeOperation([{ textOperation: "", structureTone: "" }]),
    null,
  );
});
