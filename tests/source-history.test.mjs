import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  validateSourceHistoryOperationBytes,
} from "../shared/source-history.mjs";

const sha256 = (value) => (
  `sha256:${createHash("sha256").update(value).digest("hex")}`
);

function replacementOperation({
  before,
  after,
  beforeText,
  afterText,
  kind,
  index,
}) {
  const startOffset = before.indexOf(beforeText);
  assert.notEqual(startOffset, -1);
  return {
    operationId: `sourceop_current_${kind}_${String(index).padStart(3, "0")}`,
    kind,
    editRevision: index,
    createdAt: "2026-09-04T00:00:00.000Z",
    beforeSourceSha256: sha256(before),
    afterSourceSha256: sha256(after),
    forwardPatches: [{
      startOffset,
      endOffset: startOffset + beforeText.length,
      before: beforeText,
      after: afterText,
      kind,
    }],
    reversePatches: [{
      startOffset,
      endOffset: startOffset + afterText.length,
      before: afterText,
      after: beforeText,
      kind: `inverse:${kind}`,
    }],
    beforeTarget: { id: `target-${kind}` },
    afterTarget: { id: `target-${kind}` },
  };
}

test("current save evidence validates text, style, structure, and reorder bytes", () => {
  const sources = [
    '<main><p class="plain">one</p><aside>A</aside><section>B</section></main>',
  ];
  sources.push(sources.at(-1).replace("one", "two"));
  sources.push(sources.at(-1).replace('class="plain"', 'class="heavy"'));
  sources.push(sources.at(-1).replace("</p>", "<span>new</span></p>"));
  sources.push(sources.at(-1).replace(
    "<aside>A</aside><section>B</section>",
    "<section>B</section><aside>A</aside>",
  ));
  const changes = [
    ["one", "two", "text"],
    ['class="plain"', 'class="heavy"', "style"],
    ["</p>", "<span>new</span></p>", "structure"],
    [
      "<aside>A</aside><section>B</section>",
      "<section>B</section><aside>A</aside>",
      "reorder",
    ],
  ];
  const operations = changes.map(([beforeText, afterText, kind], index) => (
    replacementOperation({
      before: sources[index],
      after: sources[index + 1],
      beforeText,
      afterText,
      kind,
      index: index + 1,
    })
  ));

  const steps = validateSourceHistoryOperationBytes(
    operations,
    sources[0],
    sources.at(-1),
    sha256,
  );
  assert.deepEqual(
    steps.map((step) => step.operation.kind),
    ["text", "style", "structure", "reorder"],
  );
  assert.equal(steps.at(-1).afterHtml, sources.at(-1));
});

test("current save evidence rejects stale, forged, and non-invertible patches", () => {
  const before = "<p>one</p>";
  const after = "<p>two</p>";
  const operation = replacementOperation({
    before,
    after,
    beforeText: "one",
    afterText: "two",
    kind: "text",
    index: 1,
  });

  assert.throws(
    () => validateSourceHistoryOperationBytes(
      [operation],
      before.replace("one", "stale"),
      after,
      sha256,
    ),
    (error) => error?.code === "SOURCE_HISTORY_OPERATION_CHAIN_MISMATCH",
  );

  const forged = structuredClone(operation);
  forged.forwardPatches[0].after = "evil";
  assert.throws(
    () => validateSourceHistoryOperationBytes([forged], before, after, sha256),
    (error) => error?.code === "SOURCE_HISTORY_RESULT_MISMATCH",
  );

  const nonInvertible = structuredClone(operation);
  nonInvertible.reversePatches[0].after = "other";
  assert.throws(
    () => validateSourceHistoryOperationBytes([nonInvertible], before, after, sha256),
    (error) => error?.code === "SOURCE_HISTORY_RESULT_MISMATCH",
  );
});
