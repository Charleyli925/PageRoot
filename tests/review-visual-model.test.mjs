import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewVisualEvidence,
  reviewVisualVerdict,
} from "../app/workbench/review/review-visual-model.js";

const A = "sm1_11111111111141118111111111111111";
const B = "sm1_22222222222242229222222222222222";
const C = "sm1_3333333333334333a333333333333333";
const D = "sm1_4444444444444444b444444444444444";
const E = "sm1_55555555555545558555555555555555";
const html = (body) => `<!doctype html><html data-stemmio-id="${A}"><body data-stemmio-id="${B}">${body}</body></html>`;

test("visual enhancement rejects incomplete or duplicate identity without cancelling source Review", () => {
  const incomplete = buildReviewVisualEvidence("<p>same</p>", "<p>changed</p>", "s");
  assert.equal(incomplete.binding.identity, "unsupported");
  assert.deepEqual(incomplete.evidence, []);
  const duplicate = buildReviewVisualEvidence(
    `<main data-stemmio-id="${A}"><p data-stemmio-id="${A}">one</p></main>`,
    `<main data-stemmio-id="${A}"><p data-stemmio-id="${A}">two</p></main>`, "s",
  );
  assert.equal(duplicate.binding.identity, "unsupported");
});

test("only same stable ID produces source evidence; a move remains a candidate", () => {
  const before = html(`<p data-stemmio-id="${A}">old</p>`);
  const after = html(`<section data-stemmio-id="${A}">new</section>`);
  const result = buildReviewVisualEvidence(before, after, "s");
  assert.equal(result.binding.identity, "unsupported", "duplicate root IDs correctly fail closed");
  const cleanBefore = `<main data-stemmio-id="${A}"><section data-stemmio-id="${C}"></section><p data-stemmio-id="${B}">old</p></main>`;
  const cleanAfter = `<main data-stemmio-id="${A}"><section data-stemmio-id="${C}"><p data-stemmio-id="${B}">new</p></section></main>`;
  const clean = buildReviewVisualEvidence(cleanBefore, cleanAfter, "s");
  assert.equal(clean.binding.identity, "supported");
  const changed = clean.evidence.find((entry) => entry.stableId === B);
  assert.ok(changed?.kinds.includes("text"));
  assert.ok(changed?.kinds.includes("moved"));
});

test("identical modern pages do not schedule observation-only candidates", () => {
  const source = `<main data-stemmio-id="${A}"><p data-stemmio-id="${B}">same</p></main>`;
  const result = buildReviewVisualEvidence(source, source, "same-session");
  assert.equal(result.binding.identity, "supported");
  assert.deepEqual(result.evidence, []);
});

test("page-level CSS and Script source-only edits never fan out to Stable-ID hosts", () => {
  const before = `<main data-stemmio-id="${A}"><p data-stemmio-id="${B}">same</p></main><style data-stemmio-id="${D}">/* before */ .card { color: red; }</style><script data-stemmio-id="${E}">/* before */</script>`;
  const after = `<main data-stemmio-id="${A}"><p data-stemmio-id="${B}">same</p></main><style data-stemmio-id="${D}">/* after */ .card { color: red; }</style><script data-stemmio-id="${E}">/* after */</script>`;
  const result = buildReviewVisualEvidence(before, after, "source-only");

  assert.equal(result.binding.identity, "supported");
  assert.deepEqual(result.evidence, []);
});

test("verdict is fail-closed and source candidates cannot promote themselves", () => {
  const { binding, evidence } = buildReviewVisualEvidence(
    `<main data-stemmio-id="${A}">old</main>`, `<main data-stemmio-id="${A}">new</main>`, "session",
  );
  const candidate = evidence[0];
  const observation = (side, fingerprint, extra = {}) => ({
    sessionId: "session", side, sourceHash: binding.sourceHash[side], generation: 3,
    stableId: candidate.stableId, visible: true, fingerprint, ...extra,
  });
  assert.equal(reviewVisualVerdict(candidate, undefined, undefined, binding, 3), "unverified");
  assert.equal(reviewVisualVerdict(candidate, observation("before", "a"), observation("after", "a"), binding, 3), "unchanged");
  assert.equal(reviewVisualVerdict(candidate, observation("before", "a"), observation("after", "b"), binding, 3), "changed");
  assert.equal(reviewVisualVerdict(candidate, observation("before", "a"), observation("after", "b", { unverified: true }), binding, 3), "unverified");
  assert.equal(reviewVisualVerdict(candidate, observation("before", "a"), observation("after", "b", { generation: 2 }), binding, 3), "unverified");
  assert.equal(reviewVisualVerdict(candidate, observation("before", "a"), observation("after", "b", { sourceHash: "sha256:stale" }), binding, 3), "unverified");
  assert.equal(reviewVisualVerdict(candidate, observation("before", "a"), observation("after", "b", { sessionId: "stale" }), binding, 3), "unverified");
});

test("added and removed elements require only the trusted present-side observation", () => {
  const before = `<main data-stemmio-id="${A}"></main>`;
  const after = `<main data-stemmio-id="${A}"><p data-stemmio-id="${B}">added</p></main>`;
  const addedResult = buildReviewVisualEvidence(before, after, "added-session");
  const added = addedResult.evidence.find((entry) => entry.kinds.includes("added"));
  const present = {
    sessionId: "added-session",
    side: "after",
    sourceHash: addedResult.binding.sourceHash.after,
    generation: 4,
    stableId: B,
    visible: true,
    fingerprint: "visible",
  };
  assert.equal(reviewVisualVerdict(added, undefined, present, addedResult.binding, 4), "changed");
  assert.equal(reviewVisualVerdict(added, undefined, { ...present, visible: false }, addedResult.binding, 4), "unverified");

  const removedResult = buildReviewVisualEvidence(after, before, "removed-session");
  const removed = removedResult.evidence.find((entry) => entry.kinds.includes("removed"));
  const beforePresent = {
    ...present,
    sessionId: "removed-session",
    side: "before",
    sourceHash: removedResult.binding.sourceHash.before,
  };
  assert.equal(reviewVisualVerdict(removed, beforePresent, undefined, removedResult.binding, 4), "changed");
});

test("external runtime does not erase deterministic source facts", () => {
  const before = `<main data-stemmio-id="${A}"><p data-stemmio-id="${B}">old</p></main><script data-stemmio-id="${C}" src="echarts.min.js"></script>`;
  const after = `<main data-stemmio-id="${A}"><p data-stemmio-id="${B}">new</p></main><script data-stemmio-id="${C}" src="echarts.min.js"></script>`;
  const result = buildReviewVisualEvidence(before, after, "external-runtime");
  assert.deepEqual(result.evidence.map((entry) => entry.stableId), [B]);
  assert.deepEqual(result.evidence[0].kinds, ["text"]);
});

test("equal bounded summaries never prove a pure style source candidate unchanged", () => {
  const before = `<main data-stemmio-id="${A}" style="left:0"></main>`;
  const after = `<main data-stemmio-id="${A}" style="left:120px"></main>`;
  const result = buildReviewVisualEvidence(before, after, "style-session");
  const evidence = result.evidence[0];
  const observation = (side) => ({
    sessionId: "style-session",
    side,
    sourceHash: result.binding.sourceHash[side],
    generation: 2,
    stableId: A,
    visible: true,
    fingerprint: "same-bounded-summary",
  });
  assert.equal(reviewVisualVerdict(
    evidence,
    observation("before"),
    observation("after"),
    result.binding,
    2,
  ), "unverified");
});

test("hidden text, parent-class effects and cross-parent moves remain source evidence", () => {
  const before = `<main data-stemmio-id="${A}" class="theme-old"><section data-stemmio-id="${C}"><p data-stemmio-id="${B}">old</p></section></main>`;
  const after = `<main data-stemmio-id="${A}" class="theme-new"><section data-stemmio-id="${C}"></section><p data-stemmio-id="${B}">new</p></main>`;
  const result = buildReviewVisualEvidence(before, after, "hidden-source");
  assert.ok(result.evidence.find((entry) => entry.stableId === A)?.kinds.includes("attribute"));
  const movedText = result.evidence.find((entry) => entry.stableId === B);
  assert.ok(movedText?.kinds.includes("moved"));
  assert.ok(movedText?.kinds.includes("text"));
  const hidden = (side) => ({
    sessionId: "hidden-source",
    side,
    sourceHash: result.binding.sourceHash[side],
    generation: 5,
    stableId: B,
    visible: false,
    fingerprint: "hidden",
  });
  assert.equal(reviewVisualVerdict(
    movedText,
    hidden("before"),
    hidden("after"),
    result.binding,
    5,
  ), "unverified");
});

test("long pages schedule only actual source evidence beyond the first 1000 stable IDs", () => {
  const stableId = (index) => `sm1_${index.toString(16).padStart(12, "0")}40008${"0".repeat(15)}`;
  const elements = Array.from({ length: 1_101 }, (_, index) => (
    `<p data-stemmio-id="${stableId(index + 2)}">item-${index}</p>`
  ));
  const before = `<main data-stemmio-id="${stableId(1)}">${elements.join("")}</main>`;
  elements[1_050] = `<p data-stemmio-id="${stableId(1_052)}">changed</p>`;
  const after = `<main data-stemmio-id="${stableId(1)}">${elements.join("")}</main>`;
  const result = buildReviewVisualEvidence(before, after, "long-page");
  assert.equal(result.binding.identity, "supported");
  assert.deepEqual(result.evidence.map((entry) => entry.stableId), [stableId(1_052)]);
  assert.ok(result.evidence[0].kinds.includes("text"));
});
