/**
 * Section-level insertion and removal wording.
 *
 * Whole-section presence is not the only insertion a reviewer sees. A card
 * added inside a section that exists on both sides is still an insertion, and
 * the marker layer already knows it: a text footprint carries an operation and
 * a structural mark carries a tone. Deciding from that evidence is what lets a
 * section caption say 新增内容 instead of falling through to a generic
 * 结构调整 while dozens of insertion dots sit inside it.
 *
 * The decision is pure on purpose: the caller walks the DOM and hands over
 * plain marks, so the rule that turns evidence into wording stays testable
 * without a document.
 */

const TEXT_INSERT = "insert";
const TEXT_DELETE = "delete";
const STRUCTURE_ADDED = "added";
const STRUCTURE_REMOVED = "removed";
// "none" is the only text operation that carries no change at all. "layout"
// looks harmless but has its own caption (换行调整) in this vocabulary, so a
// section that both gains content and reflows is not a pure insertion.
// A footprint is only ever labelled "layout" when nothing textual changed, so
// treating it as disqualifying never swallows a genuine insertion.
const NEUTRAL_TEXT_OPERATIONS = new Set(["", "none"]);

/**
 * Returns "insert", "delete", or null for a section's collected marks.
 *
 * A structural mark is required. A section only earns the block-level wording
 * when a whole element was added or removed inside it; a few appended words
 * are already well described by "文本调整", and the marker beside them already
 * reads "新增内容", so relabelling the entire section for them would
 * over-claim. Text footprints in the same direction corroborate the structural
 * mark but never stand in for it.
 *
 * The answer is deliberately exclusive. "新增内容" and "…调整" are alternatives
 * in this vocabulary rather than labels that stack, so a section reports an
 * insertion only when every change it contains is one. A section that both
 * gains and loses content, or that carries any rewrite, reflow, in-place or
 * move evidence, keeps the type-derived wording — claiming "新增内容" there
 * would describe one part of the change and hide the rest.
 */
export function reviewSectionChangeOperation(marks) {
  if (!Array.isArray(marks)) return null;
  let structuralInsertions = 0;
  let structuralDeletions = 0;
  let insertions = 0;
  let deletions = 0;
  let mixed = 0;
  marks.forEach((mark) => {
    const textOperation = mark?.textOperation;
    if (textOperation === TEXT_INSERT) insertions += 1;
    else if (textOperation === TEXT_DELETE) deletions += 1;
    else if (!NEUTRAL_TEXT_OPERATIONS.has(textOperation ?? "")) mixed += 1;
    const structureTone = mark?.structureTone;
    if (structureTone === STRUCTURE_ADDED) structuralInsertions += 1;
    else if (structureTone === STRUCTURE_REMOVED) structuralDeletions += 1;
    else if (structureTone) mixed += 1;
  });
  insertions += structuralInsertions;
  deletions += structuralDeletions;
  if (mixed || (insertions && deletions)) return null;
  if (structuralInsertions) return TEXT_INSERT;
  return structuralDeletions ? TEXT_DELETE : null;
}
