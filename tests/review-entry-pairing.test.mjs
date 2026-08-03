import assert from "node:assert/strict";
import test from "node:test";

import { pairReviewEntries } from "../app/review-demo/review-entry-pairing.js";

function entry({ identity = "", context = "", text, tagName = "TD", order }) {
  return { identity, context, text, tagName, order };
}

test("table cells with repeated copy stay attached to their semantic row and column", () => {
  const before = [
    entry({ identity: "TD:Tory Burch:1", context: "TR:Tory Burch", text: "箱包皮具", order: 0 }),
    entry({ identity: "TD:RALPH LAUREN:1", context: "TR:RALPH LAUREN", text: "箱包皮具", order: 1 }),
  ];
  const after = [
    entry({ identity: "TD:RALPH LAUREN:1", context: "TR:RALPH LAUREN", text: "箱包皮具", order: 0 }),
  ];

  const result = pairReviewEntries(before, after);

  assert.deepEqual(
    result.pairs.map((pair) => [pair.before.identity, pair.after.identity]),
    [["TD:RALPH LAUREN:1", "TD:RALPH LAUREN:1"]],
  );
  assert.deepEqual(result.beforeOnly.map((item) => item.identity), ["TD:Tory Burch:1"]);
  assert.equal(result.afterOnly.length, 0);
});

test("unique unchanged copy can still follow a reordered card", () => {
  const before = [
    entry({ context: "catalog", text: "Alpha", tagName: "H3", order: 0 }),
    entry({ context: "catalog", text: "Beta", tagName: "H3", order: 1 }),
  ];
  const after = [
    entry({ context: "catalog", text: "Beta", tagName: "H3", order: 0 }),
    entry({ context: "catalog", text: "Alpha", tagName: "H3", order: 1 }),
  ];

  const result = pairReviewEntries(before, after);

  assert.deepEqual(
    result.pairs.map((pair) => [pair.before.text, pair.after.text]),
    [["Alpha", "Alpha"], ["Beta", "Beta"]],
  );
  assert.equal(result.beforeOnly.length, 0);
  assert.equal(result.afterOnly.length, 0);
});

test("unrelated repeated copy is not used as a global identity", () => {
  const before = [
    entry({ context: "TR:removed", text: "箱包皮具", order: 0 }),
    entry({ context: "TR:kept", text: "箱包皮具", order: 1 }),
  ];
  const after = [
    entry({ context: "TR:kept", text: "箱包皮具", order: 0 }),
  ];

  const result = pairReviewEntries(before, after);

  assert.equal(result.pairs.length, 1);
  assert.equal(result.pairs[0].before.context, "TR:kept");
  assert.equal(result.beforeOnly[0].context, "TR:removed");
});
