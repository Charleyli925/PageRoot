import assert from "node:assert/strict";
import test from "node:test";

import {
  insertionLayoutNeedsRefresh,
  structuralInsertionKey,
  uniqueStructuralInsertionPoints,
} from "../app/components/html-canvas-insertion-layout.js";

function documentNode() {
  return { identity: Math.random() };
}

function selection(id, offset, selector = "body") {
  return {
    id,
    selector,
    sourceAnchor: { startOffset: offset, endOffset: offset },
  };
}

function legacyGeometricDedup(points) {
  return points.filter((point, pointIndex, list) => (
    !list.slice(0, pointIndex).some((existing) => {
      if (Math.abs(existing.top - point.top) > 3) return false;
      const overlap = Math.min(existing.left + existing.width, point.left + point.width)
        - Math.max(existing.left, point.left);
      return overlap >= Math.min(existing.width, point.width) * 0.8;
    })
  ));
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

test("source and document identity stay valid when only layout geometry changes", () => {
  const firstDocument = documentNode();
  const authority = { sourceSha256: "sha256:one", documentNode: firstDocument };
  const scrolled = {
    sourceSha256: "sha256:one",
    documentNode: firstDocument,
    scrollTop: 480,
    frameWidth: 720,
  };
  const resized = {
    sourceSha256: "sha256:one",
    documentNode: firstDocument,
    frameWidth: 1100,
    commentRailOpen: false,
  };
  assert.equal(insertionLayoutNeedsRefresh(authority, scrolled), false);
  assert.equal(insertionLayoutNeedsRefresh(authority, resized), false);
  assert.equal(
    Object.keys(authority).sort().join(","),
    "documentNode,sourceSha256",
  );
});

test("geometric overlap does not drop distinct source insertion identities", () => {
  const overlapping = [
    {
      selection: selection("target_a", 40),
      kind: "boundary",
      left: 16,
      top: 120,
      width: 640,
    },
    {
      selection: selection("target_b", 180),
      kind: "boundary",
      left: 16,
      top: 121,
      width: 640,
    },
  ];
  const legacy = legacyGeometricDedup(overlapping);
  assert.equal(legacy.length, 1);
  assert.equal(legacy[0].selection.id, "target_a");

  const structural = uniqueStructuralInsertionPoints(overlapping);
  assert.equal(structural.length, 2);
  assert.deepEqual(
    structural.map((point) => structuralInsertionKey(point.selection)),
    ["body:40", "body:180"],
  );
  assert.equal(
    structural.find((point) => point.selection.sourceAnchor.startOffset === 180)?.selection.id,
    "target_b",
  );
});
