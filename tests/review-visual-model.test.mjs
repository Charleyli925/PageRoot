import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewVisualEvidence,
  reviewVisualVerdict,
} from "../app/workbench/review/review-visual-model.js";

const A = "pr1_11111111111141118111111111111111";
const B = "pr1_22222222222242229222222222222222";
const C = "pr1_3333333333334333a333333333333333";
const html = (body) => `<!doctype html><html data-pageroot-id="${A}"><body data-pageroot-id="${B}">${body}</body></html>`;

test("formal visual review rejects incomplete or duplicate identity without legacy pairing", () => {
  const incomplete = buildReviewVisualEvidence("<p>same</p>", "<p>changed</p>", "s");
  assert.equal(incomplete.binding.identity, "unsupported");
  assert.deepEqual(incomplete.evidence, []);
  const duplicate = buildReviewVisualEvidence(
    `<main data-pageroot-id="${A}"><p data-pageroot-id="${A}">one</p></main>`,
    `<main data-pageroot-id="${A}"><p data-pageroot-id="${A}">two</p></main>`, "s",
  );
  assert.equal(duplicate.binding.identity, "unsupported");
});

test("only same stable ID produces source evidence; a move remains a candidate", () => {
  const before = html(`<p data-pageroot-id="${A}">old</p>`);
  const after = html(`<section data-pageroot-id="${A}">new</section>`);
  const result = buildReviewVisualEvidence(before, after, "s");
  assert.equal(result.binding.identity, "unsupported", "duplicate root IDs correctly fail closed");
  const cleanBefore = `<main data-pageroot-id="${A}"><section data-pageroot-id="${C}"></section><p data-pageroot-id="${B}">old</p></main>`;
  const cleanAfter = `<main data-pageroot-id="${A}"><section data-pageroot-id="${C}"><p data-pageroot-id="${B}">new</p></section></main>`;
  const clean = buildReviewVisualEvidence(cleanBefore, cleanAfter, "s");
  assert.equal(clean.binding.identity, "supported");
  const changed = clean.evidence.find((entry) => entry.stableId === B);
  assert.ok(changed?.kinds.includes("text"));
  assert.ok(changed?.kinds.includes("moved"));
});

test("identical modern pages still produce real unchanged observation candidates", () => {
  const source = `<main data-pageroot-id="${A}"><p data-pageroot-id="${B}">same</p></main>`;
  const result = buildReviewVisualEvidence(source, source, "same-session");
  assert.equal(result.binding.identity, "supported");
  assert.equal(result.evidence.length, 2);
  assert.ok(result.evidence.every((entry) => entry.kinds.join() === "observation"));
});

test("verdict is fail-closed and source candidates cannot promote themselves", () => {
  const { binding, evidence } = buildReviewVisualEvidence(
    `<main data-pageroot-id="${A}">old</main>`, `<main data-pageroot-id="${A}">new</main>`, "session",
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
  const before = `<main data-pageroot-id="${A}"></main>`;
  const after = `<main data-pageroot-id="${A}"><p data-pageroot-id="${B}">added</p></main>`;
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
  assert.equal(reviewVisualVerdict(added, undefined, { ...present, visible: false }, addedResult.binding, 4), "unchanged");

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

test("runtime differences without source evidence and dynamic output stay unverified", () => {
  const identical = `<main data-pageroot-id="${A}">same</main>`;
  const observationOnly = buildReviewVisualEvidence(identical, identical, "runtime-session");
  const evidence = observationOnly.evidence[0];
  const observation = (side, fingerprint) => ({
    sessionId: "runtime-session",
    side,
    sourceHash: observationOnly.binding.sourceHash[side],
    generation: 2,
    stableId: A,
    visible: true,
    fingerprint,
  });
  assert.equal(reviewVisualVerdict(
    evidence,
    observation("before", "a"),
    observation("after", "b"),
    observationOnly.binding,
    2,
  ), "unverified");

  const dynamicBefore = `<main data-pageroot-id="${A}" class="old"></main><script data-pageroot-id="${C}">Math.random()</script>`;
  const dynamicAfter = `<main data-pageroot-id="${A}" class="new"></main><script data-pageroot-id="${C}">Math.random()</script>`;
  const dynamic = buildReviewVisualEvidence(dynamicBefore, dynamicAfter, "dynamic-session");
  assert.ok(dynamic.evidence.find((entry) => entry.stableId === A)?.kinds.includes("dynamic-runtime"));

  const dynamicAddedBefore = `<main data-pageroot-id="${A}"></main><script data-pageroot-id="${C}">Math.random()</script>`;
  const dynamicAddedAfter = `<main data-pageroot-id="${A}"><p data-pageroot-id="${B}">added</p></main><script data-pageroot-id="${C}">Math.random()</script>`;
  const dynamicAdded = buildReviewVisualEvidence(
    dynamicAddedBefore,
    dynamicAddedAfter,
    "dynamic-added-session",
  );
  const added = dynamicAdded.evidence.find((entry) => entry.stableId === B);
  assert.ok(added?.kinds.includes("dynamic-runtime"));
  const present = {
    sessionId: "dynamic-added-session",
    side: "after",
    sourceHash: dynamicAdded.binding.sourceHash.after,
    generation: 8,
    stableId: B,
    visible: true,
    fingerprint: "stable-sample",
  };
  assert.equal(
    reviewVisualVerdict(added, undefined, present, dynamicAdded.binding, 8),
    "unverified",
  );

  const dynamicRemoved = buildReviewVisualEvidence(
    dynamicAddedAfter,
    dynamicAddedBefore,
    "dynamic-removed-session",
  );
  const removed = dynamicRemoved.evidence.find((entry) => entry.stableId === B);
  assert.ok(removed?.kinds.includes("dynamic-runtime"));
  assert.equal(reviewVisualVerdict(removed, {
    ...present,
    sessionId: "dynamic-removed-session",
    side: "before",
    sourceHash: dynamicRemoved.binding.sourceHash.before,
  }, undefined, dynamicRemoved.binding, 8), "unverified");
});
