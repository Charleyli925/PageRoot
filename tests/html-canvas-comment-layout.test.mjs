import assert from "node:assert/strict";
import test from "node:test";

import { insertionLayoutNeedsRefresh } from "../app/components/html-canvas-insertion-layout.js";

function documentNode() {
  return { identity: Math.random() };
}

test("insertion layout refreshes only when source or document identity changes", () => {
  const firstDocument = documentNode();
  const first = { sourceSha256: "sha256:one", documentNode: firstDocument };
  assert.equal(insertionLayoutNeedsRefresh(null, first), true);
  assert.equal(insertionLayoutNeedsRefresh(first, first), false);
  assert.equal(
    insertionLayoutNeedsRefresh(first, {
      sourceSha256: "sha256:one",
      documentNode: firstDocument,
    }),
    false,
  );
  assert.equal(
    insertionLayoutNeedsRefresh(first, {
      sourceSha256: "sha256:two",
      documentNode: firstDocument,
    }),
    true,
  );
  assert.equal(
    insertionLayoutNeedsRefresh(first, {
      sourceSha256: "sha256:one",
      documentNode: documentNode(),
    }),
    true,
  );
  assert.equal(insertionLayoutNeedsRefresh(first, null), true);
  assert.equal(insertionLayoutNeedsRefresh(null, null), false);
});
